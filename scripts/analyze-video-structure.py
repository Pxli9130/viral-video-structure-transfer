#!/usr/bin/env python3
"""Generic video structure analyzer.

Runs OpenCV + ffmpeg over an arbitrary input video and emits a structured
JSON document describing metadata, shot boundaries, motion energy, dominant
HSV palette over time, colorful-foreground ratio, OCR-free motif evidence,
and motif candidates with confidence.

The output is shaped so that scripts/run-marketing-poster-case.mjs can
consume it instead of the inline `marketingAnalysis()` fixture.

Usage:
    python analyze-video-structure.py --input <video> --out <analysis.json> [--sample-fps 2] [--max-shots 12]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import cv2  # type: ignore[import-not-found]
import numpy as np


# ---------------------------------------------------------------------------
# Motif ontology — kept in sync with packages/shared motif definitions.
# Each motif comes with the evidence keys it expects, so the runner can map
# them into renderer atom selection.
# ---------------------------------------------------------------------------

MOTIF_ONTOLOGY = {
    "wide_surface_ribbon_2_5d": {
        "label": "Wide colorful ribbon surface (2.5D)",
        "evidence_keys": ["band_width_estimate", "curved_colored_surface", "colorful_foreground_ratio_peak"],
    },
    "orbit_line_2d": {
        "label": "Thin 2D orbit / arc lines",
        "evidence_keys": ["band_width_estimate", "edge_density_avg"],
    },
    "textured_3d_band": {
        "label": "Textured 3D band with depth",
        "evidence_keys": ["band_width_estimate", "edge_density_avg", "shadow_evidence"],
    },
    "kinetic_typography": {
        "label": "Kinetic typography / animated text",
        "evidence_keys": ["text_motion_evidence", "central_layout_stability"],
    },
    "product_card": {
        "label": "Static product card / poster",
        "evidence_keys": ["central_layout_stability", "motion_energy_avg"],
    },
    "particle_trail": {
        "label": "Particle / shimmer trail",
        "evidence_keys": ["motion_energy_avg", "edge_density_avg"],
    },
    "platform_ui_tail": {
        "label": "Platform UI / profile tail",
        "evidence_keys": ["tail_palette_shift", "tail_layout_break"],
    },
    "static_poster": {
        "label": "Static poster / minimal motion",
        "evidence_keys": ["motion_energy_avg", "central_layout_stability"],
    },
}

RIBBON_MOTION_ONTOLOGY = {
    "surfaceType": ["thin_line", "wide_band", "textured_band", "particle_trail"],
    "pathFamily": ["vertical_helix", "planar_orbit", "diagonal_sweep", "horizontal_wave", "spiral_in", "wave_loop", "unknown"],
    "axis": ["screen_y", "screen_z", "screen_x", "diagonal", "unknown"],
    "depthBehavior": ["flat", "perspective_only", "front_back_crossing", "occlusion_with_title"],
    "layoutRelation": ["around_title", "background_only", "foreground_sweep", "border_frame"],
    "textRelation": ["text_on_ribbon", "near_ribbon", "none"],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def resolve_tool(name: str) -> str:
    conda_base = os.environ.get("CONDA_BASE", "/home/pxli/anaconda3")
    conda_env = os.environ.get("VIRAL_CONDA_ENV", "viral")
    candidate = Path(conda_base) / "envs" / conda_env / "bin" / name
    if candidate.exists():
        return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    raise RuntimeError(f"{name} not found on PATH and not found in conda env {conda_env}")


def run(cmd: list[str]) -> str:
    cmd = [resolve_tool(cmd[0]), *cmd[1:]]
    completed = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return completed.stdout


def ffprobe_metadata(video: str) -> dict:
    output = run([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,width,height,avg_frame_rate,codec_name",
        "-of",
        "json",
        video,
    ])
    payload = json.loads(output)
    video_stream = next((s for s in payload.get("streams", []) if s.get("codec_type") == "video"), {})
    has_audio = any(s.get("codec_type") == "audio" for s in payload.get("streams", []))
    fps = 30.0
    rate = str(video_stream.get("avg_frame_rate", "30/1"))
    if "/" in rate:
        num, den = rate.split("/", 1)
        try:
            num_f = float(num)
            den_f = float(den)
            if den_f:
                fps = num_f / den_f
        except ValueError:
            pass
    return {
        "durationSec": float(payload.get("format", {}).get("duration", 0) or 0),
        "width": int(video_stream.get("width", 0) or 0),
        "height": int(video_stream.get("height", 0) or 0),
        "fps": round(fps, 3),
        "hasAudio": has_audio,
        "codec": video_stream.get("codec_name", "unknown"),
    }


def sample_frames(video: str, sample_fps: float = 2.0) -> list[tuple[float, np.ndarray]]:
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV cannot open {video}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total_frames == 0:
        cap.release()
        return []
    step = max(int(round(src_fps / sample_fps)), 1)
    frames: list[tuple[float, np.ndarray]] = []
    frame_idx = 0
    while frame_idx < total_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if not ok:
            break
        time_sec = frame_idx / src_fps
        frames.append((round(time_sec, 3), frame))
        frame_idx += step
    cap.release()
    return frames


def motion_energy_curve(frames: list[tuple[float, np.ndarray]]) -> list[dict]:
    if len(frames) < 2:
        return []
    series = []
    prev_gray = cv2.cvtColor(frames[0][1], cv2.COLOR_BGR2GRAY)
    for time_sec, frame in frames[1:]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(gray, prev_gray)
        energy = float(diff.mean()) / 255.0
        series.append({"timeSec": time_sec, "energy": round(energy, 4)})
        prev_gray = gray
    return series


def detect_shots(motion: list[dict], duration_sec: float, max_shots: int = 12) -> list[dict]:
    """Histogram-diff style scene cut: spike if energy is far above local median."""
    if not motion:
        return [{"startSec": 0.0, "endSec": duration_sec, "durationSec": duration_sec, "confidence": 0.4, "tags": ["background"]}]
    energies = np.array([row["energy"] for row in motion])
    times = np.array([row["timeSec"] for row in motion])
    threshold = max(float(np.median(energies)) * 2.5, 0.05)
    cuts = [0.0]
    for t, e in zip(times, energies):
        if e >= threshold and (t - cuts[-1]) > max(0.6, duration_sec / max_shots):
            cuts.append(float(t))
    cuts.append(duration_sec)
    cuts = sorted(set(round(t, 3) for t in cuts))
    shots = []
    for index, (start, end) in enumerate(zip(cuts[:-1], cuts[1:])):
        duration = round(end - start, 3)
        if duration < 0.4:
            continue
        # Average motion energy inside this shot determines confidence.
        in_range = energies[(times >= start) & (times <= end)]
        avg_energy = float(in_range.mean()) if in_range.size else 0.0
        shots.append({
            "id": f"shot_{index + 1}",
            "startSec": round(start, 3),
            "endSec": round(end, 3),
            "durationSec": duration,
            "tags": [],
            "confidence": round(0.55 + min(0.4, avg_energy * 8), 3),
            "notes": f"Energy={avg_energy:.3f}",
        })
    # If we somehow exceed max_shots, merge the shortest adjacent shots until under cap.
    while len(shots) > max_shots:
        shortest = min(range(len(shots)), key=lambda i: shots[i]["durationSec"])
        if shortest + 1 < len(shots):
            shots[shortest]["endSec"] = shots[shortest + 1]["endSec"]
            shots[shortest]["durationSec"] = round(shots[shortest]["endSec"] - shots[shortest]["startSec"], 3)
            del shots[shortest + 1]
        elif shortest > 0:
            shots[shortest - 1]["endSec"] = shots[shortest]["endSec"]
            shots[shortest - 1]["durationSec"] = round(shots[shortest - 1]["endSec"] - shots[shortest - 1]["startSec"], 3)
            del shots[shortest]
        else:
            break
    return shots


def dominant_palette_over_time(frames: list[tuple[float, np.ndarray]], bins: int = 6) -> list[dict]:
    palette = []
    for time_sec, frame in frames:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0], None, [bins], [0, 180])
        hist = hist.flatten() / max(hist.sum(), 1.0)
        dominant_bin = int(np.argmax(hist))
        bin_size = 180 // bins
        dominant_hue = dominant_bin * bin_size + bin_size // 2
        # Saturation/value mean of brightest pixels
        sat = float(hsv[:, :, 1].mean()) / 255.0
        val = float(hsv[:, :, 2].mean()) / 255.0
        palette.append({
            "timeSec": time_sec,
            "dominantHue": int(dominant_hue),
            "saturation": round(sat, 3),
            "value": round(val, 3),
        })
    return palette


def colorful_foreground_ratio(frames: list[tuple[float, np.ndarray]]) -> list[dict]:
    series = []
    for time_sec, frame in frames:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        # Saturated, mid/high value mask = colorful foreground
        mask = ((hsv[:, :, 1] > 80) & (hsv[:, :, 2] > 90)).astype(np.uint8)
        ratio = float(mask.mean())
        series.append({"timeSec": time_sec, "ratio": round(ratio, 4)})
    return series


def central_layout_stability(frames: list[tuple[float, np.ndarray]]) -> float:
    """Lower diff in centre = stable static layout (e.g. poster)."""
    if len(frames) < 2:
        return 0.0
    diffs = []
    h, w = frames[0][1].shape[:2]
    cx0, cx1 = int(w * 0.25), int(w * 0.75)
    cy0, cy1 = int(h * 0.2), int(h * 0.8)
    prev = cv2.cvtColor(frames[0][1][cy0:cy1, cx0:cx1], cv2.COLOR_BGR2GRAY)
    for _, frame in frames[1:]:
        crop = cv2.cvtColor(frame[cy0:cy1, cx0:cx1], cv2.COLOR_BGR2GRAY)
        diffs.append(float(cv2.absdiff(crop, prev).mean()) / 255.0)
        prev = crop
    if not diffs:
        return 0.0
    # 1.0 = perfectly stable; 0 = fully changing
    return round(1.0 - min(1.0, float(np.mean(diffs)) * 6), 3)


def edge_density(frames: list[tuple[float, np.ndarray]]) -> float:
    densities = []
    for _, frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 80, 160)
        densities.append(float(edges.mean()) / 255.0)
    return round(float(np.mean(densities)) if densities else 0.0, 4)


def band_width_estimate(frames: list[tuple[float, np.ndarray]]) -> int:
    """Estimate ribbon band width via continuous saturated runs along rows."""
    if not frames:
        return 0
    widths = []
    for _, frame in frames:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = ((hsv[:, :, 1] > 100) & (hsv[:, :, 2] > 90)).astype(np.uint8)
        for row in mask:
            run_lengths = []
            current = 0
            for value in row:
                if value:
                    current += 1
                else:
                    if current:
                        run_lengths.append(current)
                    current = 0
            if current:
                run_lengths.append(current)
            if run_lengths:
                widths.append(max(run_lengths))
    if not widths:
        return 0
    # Use 90th percentile to capture peak band width while ignoring noise.
    return int(np.percentile(widths, 90))


def saturated_mask(frame: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    return ((hsv[:, :, 1] > 80) & (hsv[:, :, 2] > 90)).astype(np.uint8)


def sign_changes(values: list[float]) -> int:
    if len(values) < 4:
        return 0
    diffs = np.diff(np.array(values, dtype=np.float64))
    diffs = diffs[np.abs(diffs) > 1.5]
    if len(diffs) < 2:
        return 0
    signs = np.sign(diffs)
    return int(np.sum(signs[1:] != signs[:-1]))


def ribbon_frame_stats(frames: list[tuple[float, np.ndarray]]) -> list[dict]:
    stats = []
    for time_sec, frame in frames:
        mask = saturated_mask(frame)
        h, w = mask.shape[:2]
        ys, xs = np.where(mask > 0)
        ratio = float(len(xs)) / float(max(1, h * w))
        if len(xs) < max(40, int(h * w * 0.002)):
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        bbox_w = max(1, x1 - x0 + 1)
        bbox_h = max(1, y1 - y0 + 1)
        row_centers: list[float] = []
        sample_rows = np.linspace(y0, y1, 72).astype(int)
        for row in sample_rows:
            row_xs = np.where(mask[row, :] > 0)[0]
            if len(row_xs) >= 3:
                row_centers.append(float(np.mean(row_xs)))
        row_std = float(np.std(row_centers)) / w if row_centers else 0.0
        row_sign_changes = sign_changes(row_centers)
        coords = np.column_stack((xs, ys)).astype(np.float32)
        if len(coords) > 4000:
            coords = coords[np.linspace(0, len(coords) - 1, 4000).astype(int)]
        orientation_deg = 0.0
        if len(coords) >= 8:
            centered = coords - coords.mean(axis=0)
            cov = np.cov(centered, rowvar=False)
            eigvals, eigvecs = np.linalg.eigh(cov)
            vec = eigvecs[:, int(np.argmax(eigvals))]
            orientation_deg = float(np.degrees(np.arctan2(vec[1], vec[0])))
            if orientation_deg > 90:
                orientation_deg -= 180
            if orientation_deg < -90:
                orientation_deg += 180
        stats.append({
            "timeSec": time_sec,
            "ratio": ratio,
            "bbox": [round(x0 / w, 4), round(y0 / h, 4), round(x1 / w, 4), round(y1 / h, 4)],
            "center": [round(float(xs.mean()) / w, 4), round(float(ys.mean()) / h, 4)],
            "bboxWidth": round(bbox_w / w, 4),
            "bboxHeight": round(bbox_h / h, 4),
            "verticalCoverage": round(len(np.unique(ys)) / h, 4),
            "horizontalCoverage": round(len(np.unique(xs)) / w, 4),
            "rowCenterStd": round(row_std, 4),
            "rowSignChanges": row_sign_changes,
            "orientationDeg": round(orientation_deg, 2),
        })
    return stats


def classify_ribbon_motion_geometry(
    frames: list[tuple[float, np.ndarray]],
    foreground_curve: list[dict],
    band_width: int,
    layout_stability: float,
    edge_density_avg: float,
) -> dict | None:
    stats = ribbon_frame_stats(frames)
    fg_peak = max((row["ratio"] for row in foreground_curve), default=0.0)
    if fg_peak < 0.006 and band_width < 6:
        return None

    if band_width >= 40 or fg_peak >= 0.05:
        surface_type = "wide_band"
    elif edge_density_avg > 0.05 and band_width >= 24:
        surface_type = "textured_band"
    else:
        surface_type = "thin_line"

    if not stats:
        return {
            "surfaceType": surface_type,
            "pathFamily": "unknown",
            "axis": "unknown",
            "depthBehavior": "flat" if surface_type == "thin_line" else "perspective_only",
            "layoutRelation": "background_only",
            "textRelation": "none",
            "confidence": 0.2,
            "evidenceFrames": [],
        }

    centers_x = np.array([row["center"][0] for row in stats], dtype=float)
    centers_y = np.array([row["center"][1] for row in stats], dtype=float)
    avg_vcov = float(np.mean([row["verticalCoverage"] for row in stats]))
    avg_hcov = float(np.mean([row["horizontalCoverage"] for row in stats]))
    avg_bbox_w = float(np.mean([row["bboxWidth"] for row in stats]))
    avg_bbox_h = float(np.mean([row["bboxHeight"] for row in stats]))
    avg_row_std = float(np.mean([row["rowCenterStd"] for row in stats]))
    avg_sign_changes = float(np.mean([row["rowSignChanges"] for row in stats]))
    median_abs_angle = float(np.median([abs(row["orientationDeg"]) for row in stats]))
    center_x_range = float(centers_x.max() - centers_x.min()) if len(centers_x) else 0.0
    center_y_range = float(centers_y.max() - centers_y.min()) if len(centers_y) else 0.0

    path_family = "unknown"
    axis = "unknown"
    confidence = 0.45
    vertical_helix_signal = (
        surface_type in ("wide_band", "textured_band")
        and (
            (avg_vcov >= 0.48 and avg_row_std >= 0.075 and avg_sign_changes >= 1.0 and center_x_range >= 0.18)
            or (avg_vcov >= 0.65 and median_abs_angle >= 75 and avg_sign_changes >= 4.0)
        )
    )
    planar_orbit_signal = avg_hcov >= 0.35 and (
        surface_type == "thin_line" or (avg_bbox_w >= avg_bbox_h * 1.22 and avg_vcov <= 0.58 and center_y_range <= 0.14)
    )
    if surface_type == "thin_line":
        path_family = "planar_orbit"
        axis = "screen_z"
        confidence = 0.58 + min(0.2, avg_hcov * 0.16)
    elif vertical_helix_signal:
        path_family = "vertical_helix"
        axis = "screen_y"
        confidence = 0.58 + min(0.25, avg_row_std) + min(0.12, avg_vcov * 0.12)
    elif planar_orbit_signal:
        path_family = "planar_orbit"
        axis = "screen_z"
        confidence = 0.58 + min(0.2, avg_hcov * 0.16)
    elif avg_hcov >= 0.62 and avg_vcov <= 0.42 and (center_y_range >= 0.035 or median_abs_angle < 18):
        path_family = "horizontal_wave"
        axis = "screen_x"
        confidence = 0.58 + min(0.2, avg_hcov * 0.18)
    elif 18 <= median_abs_angle <= 72 and avg_bbox_w >= 0.48 and avg_bbox_h >= 0.22:
        path_family = "diagonal_sweep"
        axis = "diagonal"
        confidence = 0.58 + min(0.2, median_abs_angle / 180)
    else:
        path_family = "planar_orbit" if surface_type != "particle_trail" else "unknown"
        axis = "screen_z" if path_family == "planar_orbit" else "unknown"
        confidence = 0.48

    depth_behavior = "flat"
    if surface_type in ("wide_band", "textured_band"):
        if path_family == "vertical_helix":
            depth_behavior = "front_back_crossing" if layout_stability < 0.72 else "occlusion_with_title"
        elif path_family in ("planar_orbit", "diagonal_sweep", "spiral_in"):
            depth_behavior = "perspective_only"
    layout_relation = "around_title" if path_family in ("vertical_helix", "planar_orbit") else "foreground_sweep"
    text_relation = "text_on_ribbon" if surface_type != "thin_line" and fg_peak >= 0.05 else "near_ribbon" if path_family != "unknown" else "none"
    evidence_frames = [round(float(row["timeSec"]), 2) for row in sorted(stats, key=lambda row: row["ratio"], reverse=True)[:3]]

    result = {
        "surfaceType": surface_type,
        "pathFamily": path_family,
        "axis": axis,
        "depthBehavior": depth_behavior,
        "layoutRelation": layout_relation,
        "textRelation": text_relation,
        "confidence": round(min(0.92, confidence), 3),
        "evidenceFrames": sorted(evidence_frames),
        "turns": 1.25 if path_family == "vertical_helix" else None,
        "radiusX": 260 if path_family == "vertical_helix" else None,
        "radiusZ": 160 if path_family == "vertical_helix" else None,
        "pitchY": 960 if path_family == "vertical_helix" else None,
        "cvEvidence": {
            "avgVerticalCoverage": round(avg_vcov, 4),
            "avgHorizontalCoverage": round(avg_hcov, 4),
            "avgBboxWidth": round(avg_bbox_w, 4),
            "avgBboxHeight": round(avg_bbox_h, 4),
            "avgRowCenterStd": round(avg_row_std, 4),
            "avgRowSignChanges": round(avg_sign_changes, 3),
            "medianAbsOrientationDeg": round(median_abs_angle, 2),
            "centerXRange": round(center_x_range, 4),
            "centerYRange": round(center_y_range, 4),
            "foregroundPeak": round(fg_peak, 4),
            "bandWidthEstimate": int(band_width),
        },
    }
    return {key: value for key, value in result.items() if value is not None}


def detect_platform_tail(frames: list[tuple[float, np.ndarray]], duration_sec: float) -> dict | None:
    """Mark a tail segment when the final ~10% of frames flips palette or layout."""
    if len(frames) < 6:
        return None
    pivot = max(int(len(frames) * 0.85), 1)
    head_frames = frames[:pivot]
    tail_frames = frames[pivot:]

    def mean_hsv(frames_slice: list[tuple[float, np.ndarray]]) -> tuple[float, float, float]:
        if not frames_slice:
            return 0.0, 0.0, 0.0
        sums = np.zeros(3, dtype=np.float64)
        for _, frame in frames_slice:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            sums += hsv.reshape(-1, 3).mean(axis=0)
        return tuple(sums / len(frames_slice))

    head_mean = np.array(mean_hsv(head_frames))
    tail_mean = np.array(mean_hsv(tail_frames))
    diff = float(np.linalg.norm(head_mean - tail_mean))
    head_stability = central_layout_stability(head_frames)
    tail_stability = central_layout_stability(tail_frames)
    stability_break = head_stability > 0.55 and tail_stability < 0.45
    palette_shift = diff > 35
    if not (palette_shift or stability_break):
        return None
    start = tail_frames[0][0]
    return {
        "startSec": round(start, 3),
        "endSec": round(duration_sec, 3),
        "reason": (
            "Tail palette/layout shifts sharply (palette_diff="
            f"{diff:.1f}, head_stability={head_stability:.2f}, tail_stability={tail_stability:.2f}); "
            "likely platform UI / recording tail. Excluded from transferable structure."
        ),
        "evidence": {
            "palette_shift": round(diff, 2),
            "head_layout_stability": head_stability,
            "tail_layout_stability": tail_stability,
        },
    }


# ---------------------------------------------------------------------------
# Motif classification
# ---------------------------------------------------------------------------


def classify_motifs(
    motion_curve: list[dict],
    palette: list[dict],
    foreground_curve: list[dict],
    layout_stability: float,
    edge_density_avg: float,
    band_width: int,
    duration_sec: float,
) -> list[dict]:
    if not motion_curve:
        return []
    motion_avg = float(np.mean([row["energy"] for row in motion_curve]))
    fg_peak = max((row["ratio"] for row in foreground_curve), default=0.0)
    palette_variety = len({row["dominantHue"] for row in palette})
    # Heuristic confidences.
    candidates = []

    # Wide ribbon 2.5D surface: large bright colored area, big band width, high palette variety
    wide_ribbon_conf = 0.0
    if fg_peak > 0.05:
        wide_ribbon_conf += 0.35
    if band_width >= 40:
        wide_ribbon_conf += 0.25
    if palette_variety >= 3:
        wide_ribbon_conf += 0.2
    if motion_avg > 0.02:
        wide_ribbon_conf += 0.1
    if layout_stability > 0.5:
        wide_ribbon_conf += 0.05
    candidates.append({
        "motif": "wide_surface_ribbon_2_5d",
        "confidence": round(min(wide_ribbon_conf, 0.95), 3),
        "evidence": {
            "colorful_foreground_ratio_peak": round(fg_peak, 4),
            "band_width_estimate": int(band_width),
            "palette_variety": palette_variety,
            "motion_energy_avg": round(motion_avg, 4),
            "central_layout_stability": layout_stability,
        },
    })

    # Orbit thin lines: low band width, high edge density, lower foreground ratio
    orbit_conf = 0.0
    if band_width < 35:
        orbit_conf += 0.3
    if edge_density_avg > 0.04:
        orbit_conf += 0.25
    if fg_peak < 0.08:
        orbit_conf += 0.2
    if motion_avg > 0.01:
        orbit_conf += 0.1
    candidates.append({
        "motif": "orbit_line_2d",
        "confidence": round(min(orbit_conf, 0.9), 3),
        "evidence": {
            "band_width_estimate": int(band_width),
            "edge_density_avg": edge_density_avg,
        },
    })

    # Static poster: very low motion, high layout stability
    poster_conf = 0.0
    if motion_avg < 0.015:
        poster_conf += 0.3
    if layout_stability > 0.6:
        poster_conf += 0.3
    if palette_variety <= 2:
        poster_conf += 0.15
    candidates.append({
        "motif": "static_poster",
        "confidence": round(min(poster_conf, 0.9), 3),
        "evidence": {
            "motion_energy_avg": round(motion_avg, 4),
            "central_layout_stability": layout_stability,
        },
    })

    # Kinetic typography: large layout shift + edges + medium motion
    kt_conf = 0.0
    if 0.02 <= motion_avg <= 0.08:
        kt_conf += 0.25
    if edge_density_avg > 0.045:
        kt_conf += 0.25
    if 0.45 <= layout_stability <= 0.75:
        kt_conf += 0.2
    candidates.append({
        "motif": "kinetic_typography",
        "confidence": round(min(kt_conf, 0.85), 3),
        "evidence": {
            "motion_energy_avg": round(motion_avg, 4),
            "edge_density_avg": edge_density_avg,
            "central_layout_stability": layout_stability,
        },
    })

    return sorted(candidates, key=lambda c: c["confidence"], reverse=True)


# ---------------------------------------------------------------------------
# Mapping to runner-friendly analysis JSON
# ---------------------------------------------------------------------------


def shot_tags_from_metrics(
    shot: dict,
    motion: list[dict],
    palette: list[dict],
    foreground: list[dict],
    duration_sec: float,
) -> list[str]:
    tags: list[str] = []
    # Hook candidate: first ~20% of duration
    if shot["startSec"] < duration_sec * 0.2:
        tags.append("hook_candidate")
    # CTA candidate: last ~15% of duration
    if shot["endSec"] > duration_sec * 0.85:
        tags.append("cta_candidate")
    # Use foreground average inside shot to decide visual richness
    fg_avg = np.mean([row["ratio"] for row in foreground if shot["startSec"] <= row["timeSec"] <= shot["endSec"]] or [0])
    if fg_avg > 0.06:
        tags.append("text_card_candidate")
    if fg_avg > 0.1:
        tags.append("background")
    # Motion: high energy → usage/comparison candidates
    motion_in = [row["energy"] for row in motion if shot["startSec"] <= row["timeSec"] <= shot["endSec"]]
    motion_avg = float(np.mean(motion_in)) if motion_in else 0.0
    if motion_avg > 0.04:
        tags.append("comparison_candidate")
    if motion_avg > 0.02 and not tags:
        tags.append("background")
    if not tags:
        tags.append("background")
    return sorted(set(tags))


def build_analysis_payload(
    video: str,
    metadata: dict,
    motion: list[dict],
    shots: list[dict],
    palette: list[dict],
    foreground: list[dict],
    layout_stability: float,
    edge_density_avg: float,
    band_width: int,
    motif_candidates: list[dict],
    ribbon_motion: dict | None,
    platform_tail: dict | None,
) -> dict:
    duration = metadata["durationSec"]
    motion_avg = float(np.mean([row["energy"] for row in motion])) if motion else 0.0
    fg_peak = max((row["ratio"] for row in foreground), default=0.0)
    enriched_shots = []
    for shot in shots:
        tags = shot_tags_from_metrics(shot, motion, palette, foreground, duration)
        enriched_shots.append({**shot, "tags": tags})
    keyframes = []
    if shots:
        for index, shot in enumerate(enriched_shots):
            t = round(min(duration - 0.1, max(0.1, shot["startSec"] + shot["durationSec"] / 2)), 3)
            keyframes.append({
                "id": f"keyframe_{index + 1}",
                "timeSec": t,
                "description": f"Shot {index + 1} centred at {t}s (motion notes: {shot['notes']})",
                "tags": shot["tags"],
            })
    exclude_segments = []
    if platform_tail:
        exclude_segments.append({
            "startSec": platform_tail["startSec"],
            "endSec": platform_tail["endSec"],
            "reason": platform_tail["reason"],
        })
    primary_motif = motif_candidates[0] if motif_candidates else None
    return {
        "schemaVersion": "analyzer-v1",
        "source": {
            "video": video,
            "analyzer": "scripts/analyze-video-structure.py",
            "analyzerMode": "ffmpeg_opencv",
        },
        "metadata": metadata,
        "motion": {
            "energyCurve": motion,
            "energyAverage": round(motion_avg, 4),
        },
        "palette": palette,
        "foregroundRatio": foreground,
        "stability": {
            "centralLayoutStability": layout_stability,
            "edgeDensityAvg": edge_density_avg,
            "colorfulForegroundRatioPeak": round(fg_peak, 4),
            "bandWidthEstimate": int(band_width),
        },
        "shots": enriched_shots,
        "keyframes": keyframes,
        "excludeSegments": exclude_segments,
        "platformTailCandidate": platform_tail,
        "motifCandidates": motif_candidates,
        "primaryMotif": primary_motif,
        "motionGeometry": {"ribbonMotion": ribbon_motion} if ribbon_motion else {},
        "ontology": {
            **MOTIF_ONTOLOGY,
            "ribbon_motion": RIBBON_MOTION_ONTOLOGY,
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to input video")
    parser.add_argument("--out", required=True, help="Path to write analysis JSON")
    parser.add_argument("--sample-fps", type=float, default=2.0, help="Sampling FPS for CV passes")
    parser.add_argument("--max-shots", type=int, default=10, help="Cap on detected shot count")
    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"Input video not found: {args.input}", file=sys.stderr)
        return 1

    metadata = ffprobe_metadata(args.input)
    frames = sample_frames(args.input, sample_fps=args.sample_fps)
    if not frames:
        print("No frames sampled; cannot analyze", file=sys.stderr)
        return 2
    motion = motion_energy_curve(frames)
    shots = detect_shots(motion, metadata["durationSec"], max_shots=args.max_shots)
    palette = dominant_palette_over_time(frames)
    foreground = colorful_foreground_ratio(frames)
    layout_stability = central_layout_stability(frames)
    edge_density_avg = edge_density(frames)
    band_width = band_width_estimate(frames)
    ribbon_motion = classify_ribbon_motion_geometry(
        frames=frames,
        foreground_curve=foreground,
        band_width=band_width,
        layout_stability=layout_stability,
        edge_density_avg=edge_density_avg,
    )
    platform_tail = detect_platform_tail(frames, metadata["durationSec"])
    motifs = classify_motifs(
        motion_curve=motion,
        palette=palette,
        foreground_curve=foreground,
        layout_stability=layout_stability,
        edge_density_avg=edge_density_avg,
        band_width=band_width,
        duration_sec=metadata["durationSec"],
    )
    payload = build_analysis_payload(
        video=str(Path(args.input)),
        metadata=metadata,
        motion=motion,
        shots=shots,
        palette=palette,
        foreground=foreground,
        layout_stability=layout_stability,
        edge_density_avg=edge_density_avg,
        band_width=band_width,
        motif_candidates=motifs,
        ribbon_motion=ribbon_motion,
        platform_tail=platform_tail,
    )
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        f"wrote {out_path} duration={metadata['durationSec']}s shots={len(shots)} "
        f"motifs={[(m['motif'], m['confidence']) for m in motifs[:3]]} "
        f"ribbon_motion={ribbon_motion.get('pathFamily') if ribbon_motion else 'none'} "
        f"exclude_segments={len(payload['excludeSegments'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
