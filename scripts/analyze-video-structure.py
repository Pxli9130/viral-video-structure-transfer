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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(cmd: list[str]) -> str:
    if shutil.which(cmd[0]) is None:
        raise RuntimeError(f"{cmd[0]} not found on PATH")
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
        "ontology": MOTIF_ONTOLOGY,
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
        platform_tail=platform_tail,
    )
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        f"wrote {out_path} duration={metadata['durationSec']}s shots={len(shots)} "
        f"motifs={[(m['motif'], m['confidence']) for m in motifs[:3]]} "
        f"exclude_segments={len(payload['excludeSegments'])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
