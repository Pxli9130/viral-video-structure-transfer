#!/usr/bin/env python3
"""Visual / audio acceptance evaluator for generated videos.

Checks a rendered MP4 plus its companion generation/timeline/report payloads
against deterministic criteria, returning a structured evaluation JSON and
exiting non-zero when must-pass gates fail.

Usage:
    python evaluate-generated-video.py \
        --video docs/artifacts/marketing_case/ai_challenge_poster_main.mp4 \
        --analysis docs/artifacts/marketing_case/analysis.marketing.json \
        --generation docs/artifacts/marketing_case/generation-result.json \
        --report docs/artifacts/marketing_case/report.md \
        --out docs/artifacts/marketing_case/evaluation.main.json
"""

from __future__ import annotations

import argparse
import hashlib
import os
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import cv2  # type: ignore[import-not-found]
import numpy as np


REQUIRED_PHASES = ["hook", "sample_analysis", "material_gap", "recomposition", "structure_mapping", "cta"]
DEFAULT_FORBIDDEN = ["造物", "逐空", "小红书", "Xiaohongshu"]


def resolve_tool(name: str) -> str:
    env_name = f"{name.upper()}_PATH"
    explicit = os.environ.get(env_name)
    if explicit and Path(explicit).exists():
        return explicit
    conda_base = os.environ.get("CONDA_BASE", "/home/pxli/anaconda3")
    conda_env = os.environ.get("VIRAL_CONDA_ENV", "viral")
    conda_tool = Path(conda_base) / "envs" / conda_env / "bin" / name
    if conda_tool.exists():
        return str(conda_tool)
    found = shutil.which(name)
    return found or name


FFMPEG_BIN = resolve_tool("ffmpeg")
FFPROBE_BIN = resolve_tool("ffprobe")


def run(cmd: list[str]) -> str:
    completed = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return completed.stdout


def ffprobe_metadata(video: str) -> dict:
    output = run([
        FFPROBE_BIN,
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
    audio_stream = next((s for s in payload.get("streams", []) if s.get("codec_type") == "audio"), None)
    fps = 30.0
    rate = str(video_stream.get("avg_frame_rate", "30/1"))
    if "/" in rate:
        try:
            num, den = rate.split("/", 1)
            fps = float(num) / float(den) if float(den) else fps
        except (ValueError, ZeroDivisionError):
            pass
    return {
        "durationSec": float(payload.get("format", {}).get("duration", 0) or 0),
        "width": int(video_stream.get("width", 0) or 0),
        "height": int(video_stream.get("height", 0) or 0),
        "fps": round(fps, 3),
        "hasAudio": audio_stream is not None,
        "audioCodec": (audio_stream or {}).get("codec_name"),
    }


def measure_loudness(video: str) -> dict:
    completed = subprocess.run(
        [FFMPEG_BIN, "-hide_banner", "-i", video, "-af", "volumedetect", "-f", "null", "/dev/null"],
        check=False,
        capture_output=True,
        text=True,
    )
    stderr = completed.stderr
    mean_match = re.search(r"mean_volume:\s*(-?[0-9.]+) dB", stderr)
    max_match = re.search(r"max_volume:\s*(-?[0-9.]+) dB", stderr)
    mean_volume = float(mean_match.group(1)) if mean_match else float("-inf")
    max_volume = float(max_match.group(1)) if max_match else float("-inf")
    return {"meanVolumeDb": mean_volume, "maxVolumeDb": max_volume}


def hash_file(path: str) -> dict:
    data = Path(path).read_bytes()
    return {
        "bytes": len(data),
        "md5": hashlib.md5(data).hexdigest(),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def sample_motion_metric(video: str, sample_fps: float = 2.0) -> float:
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        return 0.0
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total == 0:
        cap.release()
        return 0.0
    step = max(int(round(fps / sample_fps)), 1)
    prev = None
    diffs: list[float] = []
    idx = 0
    while idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if prev is not None:
            diffs.append(float(cv2.absdiff(gray, prev).mean()) / 255.0)
        prev = gray
        idx += step
    cap.release()
    if not diffs:
        return 0.0
    return float(np.mean(diffs))


def frame_at_ratio(video: str, ratio: float) -> np.ndarray | None:
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        return None
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        cap.release()
        return None
    idx = int(max(0, min(total - 1, round((total - 1) * ratio))))
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    ok, frame = cap.read()
    cap.release()
    return frame if ok else None


def border_median_lab(frame: np.ndarray) -> np.ndarray:
    h, w = frame.shape[:2]
    pad_x = max(8, int(w * 0.08))
    pad_y = max(8, int(h * 0.08))
    border = np.concatenate(
        [
            frame[:pad_y, :, :].reshape(-1, 3),
            frame[h - pad_y :, :, :].reshape(-1, 3),
            frame[:, :pad_x, :].reshape(-1, 3),
            frame[:, w - pad_x :, :].reshape(-1, 3),
        ],
        axis=0,
    )
    lab = cv2.cvtColor(border.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).reshape(-1, 3)
    return np.median(lab, axis=0)


def colorful_ratio(frame: np.ndarray) -> float:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    return float(((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 90)).mean())


def dark_ratio(frame: np.ndarray, region: tuple[float, float, float, float]) -> float:
    h, w = frame.shape[:2]
    x0, y0, x1, y1 = region
    crop = frame[int(h * y0) : int(h * y1), int(w * x0) : int(w * x1)]
    if crop.size == 0:
        return 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    return float((gray < 92).mean())


def sequence_metrics(video: str, ratios: list[float]) -> dict:
    frames = [frame_at_ratio(video, ratio) for ratio in ratios]
    frames = [frame for frame in frames if frame is not None]
    if not frames:
        return {"backgroundLab": None, "colorRatios": [], "centerDark": 0.0, "topLeftDark": 0.0, "bottomLeftDark": 0.0}
    return {
        "backgroundLab": np.mean([border_median_lab(frame) for frame in frames], axis=0),
        "colorRatios": [colorful_ratio(frame) for frame in frames],
        "centerDark": float(np.mean([dark_ratio(frame, (0.22, 0.32, 0.78, 0.58)) for frame in frames])),
        "topLeftDark": float(np.mean([dark_ratio(frame, (0.02, 0.04, 0.34, 0.22)) for frame in frames])),
        "bottomLeftDark": float(np.mean([dark_ratio(frame, (0.02, 0.72, 0.42, 0.96)) for frame in frames])),
    }


def clip01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def detect_debug_text(generation_payload: dict | None) -> list[str]:
    if not generation_payload:
        return []
    debug_terms = [
        "PHASE ",
        "[Phase",
        "Sample Structure",
        "New Timeline",
        "素材补全",
        "样例拆解 in one compact design",
        "样例拆解 with clearer everyday value",
    ]
    texts: list[str] = []
    for item in generation_payload.get("storyboard") or []:
        texts.extend([str(item.get("subtitle") or ""), str(item.get("shotDescription") or ""), str(item.get("assetUsage") or "")])
    for clip in (generation_payload.get("timeline") or {}).get("clips", []):
        texts.extend([str(clip.get("subtitleText") or ""), str(clip.get("visualIntent") or "")])
        for layer in clip.get("layers") or []:
            texts.append(str(layer.get("text") or ""))
    blob = "\n".join(texts)
    return [term for term in debug_terms if term in blob]


def detect_explainable_overlay(generation_payload: dict | None) -> bool:
    if not generation_payload:
        return False
    for clip in (generation_payload.get("timeline") or {}).get("clips", []):
        if clip.get("phaseLabel") or clip.get("phaseSubtitle") or clip.get("mappingPairs"):
            return True
    return bool(detect_debug_text(generation_payload))


def evaluate_style_fidelity(sample_video: str | None, output_video: str, generation_payload: dict | None, creative_mode: str) -> dict:
    if not sample_video or not Path(sample_video).exists():
        return {"overall": 0.0, "reason": "sample video missing"}

    ratios = [0.05, 0.25, 0.45, 0.65, 0.82]
    sample = sequence_metrics(sample_video, ratios)
    output = sequence_metrics(output_video, ratios)
    if sample["backgroundLab"] is None or output["backgroundLab"] is None:
        return {"overall": 0.0, "reason": "could not sample frames"}

    bg_distance = float(np.linalg.norm(sample["backgroundLab"] - output["backgroundLab"]))
    background_color_similarity = clip01(1.0 - bg_distance / 70.0)

    center_dark = output["centerDark"]
    central_title_layout = clip01(center_dark / 0.032) * clip01((0.36 - center_dark) / 0.16)
    anchor_positions = clip01(output["topLeftDark"] / 0.018) * 0.5 + clip01(output["bottomLeftDark"] / 0.018) * 0.5

    sample_peak = max(sample["colorRatios"] or [0.0])
    output_peak = max(output["colorRatios"] or [0.0])
    ribbon_dominance = clip01(output_peak / max(0.08, sample_peak * 0.82))

    sample_curve = np.array(sample["colorRatios"], dtype=float)
    output_curve = np.array(output["colorRatios"], dtype=float)
    if len(sample_curve) == len(output_curve) and len(sample_curve) > 0:
        sample_norm = sample_curve / max(0.01, float(sample_curve.max()))
        output_norm = output_curve / max(0.01, float(output_curve.max()))
        motion_curve = clip01(1.0 - float(np.mean(np.abs(sample_norm - output_norm))) / 0.72)
    else:
        motion_curve = 0.0

    late_a = frame_at_ratio(output_video, 0.9)
    late_b = frame_at_ratio(output_video, 0.97)
    final_clean_hold = 0.0
    if late_a is not None and late_b is not None:
        diff = float(cv2.absdiff(cv2.cvtColor(late_a, cv2.COLOR_BGR2GRAY), cv2.cvtColor(late_b, cv2.COLOR_BGR2GRAY)).mean()) / 255.0
        final_clean_hold = clip01(1.0 - diff / 0.08)

    debug_hits = detect_debug_text(generation_payload)
    absence_of_debug_labels = 1.0 if not debug_hits else 0.15 if creative_mode == "explainable_demo" else 0.0

    weights = {
        "background_color_similarity": 0.16,
        "central_title_layout": 0.18,
        "anchor_positions": 0.12,
        "ribbon_dominance": 0.22,
        "motion_foreground_curve": 0.12,
        "final_clean_hold": 0.10,
        "absence_of_debug_labels": 0.10,
    }
    dimensions = {
        "background_color_similarity": background_color_similarity,
        "central_title_layout": central_title_layout,
        "anchor_positions": anchor_positions,
        "ribbon_dominance": ribbon_dominance,
        "motion_foreground_curve": motion_curve,
        "final_clean_hold": final_clean_hold,
        "absence_of_debug_labels": absence_of_debug_labels,
    }
    overall = sum(dimensions[key] * weight for key, weight in weights.items())
    target = 0.85 if creative_mode == "high_fidelity_style" else 0.4 if creative_mode == "explainable_demo" else 0.6
    return {
        "overall": round(overall, 4),
        "target": target,
        "passedTarget": overall >= target,
        "dimensions": {key: round(value, 4) for key, value in dimensions.items()},
        "debugTextHits": debug_hits,
        "sampleColorRatios": [round(float(v), 4) for v in sample["colorRatios"]],
        "outputColorRatios": [round(float(v), 4) for v in output["colorRatios"]],
    }


def colorful_foreground_peak(video: str, sample_fps: float = 2.0) -> dict:
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        return {"peak": 0.0, "avg": 0.0, "bandWidth": 0}
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(int(round(fps / sample_fps)), 1)
    ratios: list[float] = []
    widths: list[int] = []
    idx = 0
    while idx < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = ((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 90)).astype(np.uint8)
        ratios.append(float(mask.mean()))
        for row in mask:
            best = 0
            run_len = 0
            for value in row:
                if value:
                    run_len += 1
                    best = max(best, run_len)
                else:
                    run_len = 0
            if best > 0:
                widths.append(best)
        idx += step
    cap.release()
    if not ratios:
        return {"peak": 0.0, "avg": 0.0, "bandWidth": 0}
    band_width = int(np.percentile(widths, 90)) if widths else 0
    return {
        "peak": round(max(ratios), 4),
        "avg": round(float(np.mean(ratios)), 4),
        "bandWidth": band_width,
    }


def detect_phases(generation_payload: dict | None) -> dict:
    """Determine which required semantic phases the generation declares."""
    if not generation_payload:
        return {"detected": [], "missing": REQUIRED_PHASES[:]}
    haystacks: list[str] = []
    storyboard = generation_payload.get("storyboard") or []
    for item in storyboard:
        haystacks.append(json.dumps(item, ensure_ascii=False).lower())
    timeline = generation_payload.get("timeline") or {}
    for clip in timeline.get("clips", []):
        for layer in clip.get("layers", []):
            text = layer.get("text") or ""
            haystacks.append(str(text).lower())
        haystacks.append(json.dumps(clip, ensure_ascii=False).lower())
    request_prompt = ((generation_payload.get("request") or {}).get("prompt") or "").lower()
    haystacks.append(request_prompt)
    blob = "\n".join(haystacks)
    detected = []
    for phase in REQUIRED_PHASES:
        token = phase.lower()
        token_alt = token.replace("_", " ")
        # Loose match: allow phase keyword or its Chinese alias.
        zh_aliases = {
            "hook": ["hook", "钩子", "开场"],
            "sample_analysis": ["sample_analysis", "sample analysis", "样例解析", "样例分析", "样例拆解"],
            "material_gap": ["material_gap", "material gap", "素材缺口", "素材补全", "缺口"],
            "recomposition": ["recomposition", "重构", "重新编排", "重组"],
            "structure_mapping": ["structure_mapping", "structure mapping", "结构映射", "样例 -> 新", "样例 → 新"],
            "cta": ["cta", "立即", "号召", "行动"],
        }
        if any(alias.lower() in blob for alias in zh_aliases.get(phase, [token, token_alt])):
            detected.append(phase)
    missing = [phase for phase in REQUIRED_PHASES if phase not in detected]
    return {"detected": detected, "missing": missing}


def detect_motif_atom(generation_payload: dict | None, expected_atom: str | None) -> dict:
    if not generation_payload or not expected_atom:
        return {"expected": expected_atom, "actual": None, "matched": False}
    motion_atoms = (
        (generation_payload.get("timeline") or {}).get("renderPlan", {}).get("motionAtoms", [])
    )
    actual_types = [atom.get("type") for atom in motion_atoms if atom.get("type")]
    legacy_ribbon_atoms = {"wide_3d_ribbon_surface", "ribbon_surface_3d", "true_3d_ribbon_mesh", "ribbon_mesh_3d"}
    matched = expected_atom in actual_types or (expected_atom in legacy_ribbon_atoms and "parametric_ribbon_surface" in actual_types)
    return {"expected": expected_atom, "actual": actual_types, "matched": matched}


def primary_motion_atom(generation_payload: dict | None) -> dict | None:
    if not generation_payload:
        return None
    motion_atoms = (generation_payload.get("timeline") or {}).get("renderPlan", {}).get("motionAtoms", [])
    for atom in motion_atoms:
        if "ribbon" in str(atom.get("type", "")):
            return atom
    return None


def expected_ribbon_geometry(analysis_payload: dict | None) -> dict | None:
    if not analysis_payload:
        return None
    return (analysis_payload.get("motionGeometry") or {}).get("ribbonMotion")


def evaluate_motion_geometry(analysis_payload: dict | None, generation_payload: dict | None) -> dict:
    expected = expected_ribbon_geometry(analysis_payload)
    actual = primary_motion_atom(generation_payload)
    gates: list[dict] = []
    if not expected:
        return {"expected": None, "actual": actual, "gates": gates, "passed": True, "reason": "no sample ribbon geometry"}
    if not actual:
        gates.append({"id": "ribbon_geometry_present", "passed": False, "detail": "expected sample ribbon geometry but generation has no ribbon atom"})
        return {"expected": expected, "actual": None, "gates": gates, "passed": False}

    checks = [
        ("path_family_match", "pathFamily"),
        ("axis_match", "axis"),
        ("depth_behavior_match", "depthBehavior"),
    ]
    for gate_id, field in checks:
        gates.append({
            "id": gate_id,
            "passed": actual.get(field) == expected.get(field),
            "detail": f"expected {field}={expected.get(field)} actual={actual.get(field)}",
        })

    gates.append({
        "id": "negative_planar_orbit_not_vertical_helix",
        "passed": not (expected.get("pathFamily") == "planar_orbit" and actual.get("pathFamily") == "vertical_helix"),
        "detail": f"expected pathFamily={expected.get('pathFamily')} actual={actual.get('pathFamily')}",
    })
    gates.append({
        "id": "negative_thin_line_not_wide_band",
        "passed": not (expected.get("surfaceType") == "thin_line" and actual.get("surfaceType") == "wide_band"),
        "detail": f"expected surfaceType={expected.get('surfaceType')} actual={actual.get('surfaceType')}",
    })
    return {
        "expected": expected,
        "actual": actual,
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates),
    }


def detect_forbidden(report_text: str, forbidden: list[str]) -> list[str]:
    return [word for word in forbidden if word in report_text]


def evaluate(
    video: str,
    sample_video: str | None,
    analysis_path: str | None,
    generation_path: str | None,
    report_path: str | None,
    expected_atom: str | None,
    creative_mode: str,
    min_motion: float,
    min_band_width: int,
) -> dict:
    gates: list[dict] = []

    metadata = ffprobe_metadata(video)
    gates.append({
        "id": "playable_mp4",
        "passed": Path(video).suffix == ".mp4" and metadata["durationSec"] > 0,
        "detail": f"{metadata['durationSec']:.2f}s, {metadata['width']}x{metadata['height']}, fps={metadata['fps']}",
    })

    loudness = measure_loudness(video)
    # BGM pads sit lower than dialogue; just ensure the track is not effectively silent.
    # -45 mean threshold catches the old -91 dB silence; -25 max threshold ensures real signal.
    audio_pass = metadata["hasAudio"] and loudness["meanVolumeDb"] > -45 and loudness["maxVolumeDb"] > -25
    gates.append({
        "id": "audible_audio",
        "passed": audio_pass,
        "detail": f"hasAudio={metadata['hasAudio']} mean={loudness['meanVolumeDb']:.2f}dB max={loudness['maxVolumeDb']:.2f}dB",
    })

    motion_avg = sample_motion_metric(video)
    motion_pass = motion_avg >= min_motion
    gates.append({
        "id": "motion_above_threshold",
        "passed": motion_pass,
        "detail": f"avg_frame_diff={motion_avg:.4f} (threshold {min_motion})",
    })

    fg = colorful_foreground_peak(video)
    band_pass = fg["bandWidth"] >= min_band_width
    gates.append({
        "id": "wide_ribbon_band_width",
        "passed": band_pass,
        "detail": f"bandWidth={fg['bandWidth']} (threshold {min_band_width}); peak fg ratio={fg['peak']}",
    })

    analysis_payload = None
    if analysis_path and Path(analysis_path).exists():
        analysis_payload = json.loads(Path(analysis_path).read_text(encoding="utf-8"))
        primary_motif = (analysis_payload.get("primaryMotif") or {}).get("motif")
        gates.append({
            "id": "analyzer_primary_motif",
            "passed": primary_motif is not None,
            "detail": f"primary motif: {primary_motif}",
        })

    generation_payload = None
    if generation_path and Path(generation_path).exists():
        generation_payload = json.loads(Path(generation_path).read_text(encoding="utf-8"))

    phases = detect_phases(generation_payload)
    phase_pass = len(phases["missing"]) == 0
    gates.append({
        "id": "semantic_phases_present",
        "passed": phase_pass,
        "detail": f"detected {phases['detected']}; missing {phases['missing']}",
    })

    motif_check = detect_motif_atom(generation_payload, expected_atom)
    if expected_atom:
        gates.append({
            "id": "expected_renderer_atom",
            "passed": motif_check["matched"],
            "detail": f"expected={expected_atom} actual={motif_check['actual']}",
        })

    motion_geometry = evaluate_motion_geometry(analysis_payload, generation_payload)
    gates.extend(motion_geometry["gates"])

    forbidden_hits: list[str] = []
    report_text = ""
    if report_path and Path(report_path).exists():
        report_text = Path(report_path).read_text(encoding="utf-8")
        forbidden_hits = detect_forbidden(report_text, DEFAULT_FORBIDDEN)
    gates.append({
        "id": "no_forbidden_visible_text",
        "passed": len(forbidden_hits) == 0,
        "detail": f"forbidden hits: {forbidden_hits}",
    })

    style_fidelity = evaluate_style_fidelity(sample_video, video, generation_payload, creative_mode)
    style_target = float(style_fidelity.get("target", 0.0) or 0.0)
    gates.append({
        "id": "style_fidelity_to_sample",
        "passed": float(style_fidelity.get("overall", 0.0) or 0.0) >= style_target,
        "detail": f"score={style_fidelity.get('overall')} target={style_target} mode={creative_mode}",
    })

    debug_hits = style_fidelity.get("debugTextHits", []) if isinstance(style_fidelity, dict) else []
    if creative_mode == "final_creative":
        gates.append({
            "id": "final_creative_no_debug_labels",
            "passed": len(debug_hits) == 0,
            "detail": f"debug hits: {debug_hits}",
        })
    elif creative_mode == "high_fidelity_style":
        gates.append({
            "id": "high_fidelity_no_debug_labels",
            "passed": len(debug_hits) == 0,
            "detail": f"debug hits: {debug_hits}",
        })
    elif creative_mode == "explainable_demo":
        gates.append({
            "id": "explainable_demo_has_mapping_or_phase_labels",
            "passed": detect_explainable_overlay(generation_payload),
            "detail": "phase labels/mapping metadata present" if detect_explainable_overlay(generation_payload) else "no explainable phase/mapping evidence found",
        })

    summary = {
        "video": str(video),
        "sampleVideo": str(sample_video) if sample_video else None,
        "creativeMode": creative_mode,
        "metadata": metadata,
        "audio": loudness,
        "motion": {"avgFrameDiff": round(motion_avg, 4), "threshold": min_motion},
        "foreground": fg,
        "phases": phases,
        "motif": motif_check,
        "motionGeometry": motion_geometry,
        "styleFidelity": style_fidelity,
        "hash": hash_file(video),
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates),
        "forbiddenHits": forbidden_hits,
    }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--sample-video", default=None)
    parser.add_argument("--analysis", default=None)
    parser.add_argument("--generation", default=None)
    parser.add_argument("--report", default=None)
    parser.add_argument("--expected-atom", default="wide_3d_ribbon_surface")
    parser.add_argument("--creative-mode", default="explainable_demo", choices=["explainable_demo", "final_creative", "high_fidelity_style"])
    parser.add_argument("--min-motion", type=float, default=0.012)
    parser.add_argument("--min-band-width", type=int, default=40)
    parser.add_argument("--out", required=True)
    parser.add_argument("--allow-fail", action="store_true", help="Always exit 0 even if gates fail")
    args = parser.parse_args()

    if not Path(args.video).exists():
        print(f"video not found: {args.video}", file=sys.stderr)
        return 1
    if not Path(FFPROBE_BIN).exists() and shutil.which(FFPROBE_BIN) is None:
        print("ffprobe not found", file=sys.stderr)
        return 1
    if not Path(FFMPEG_BIN).exists() and shutil.which(FFMPEG_BIN) is None:
        print("ffmpeg not found", file=sys.stderr)
        return 1

    summary = evaluate(
        video=args.video,
        sample_video=args.sample_video,
        analysis_path=args.analysis,
        generation_path=args.generation,
        report_path=args.report,
        expected_atom=args.expected_atom,
        creative_mode=args.creative_mode,
        min_motion=args.min_motion,
        min_band_width=args.min_band_width,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path}")
    for gate in summary["gates"]:
        status = "PASS" if gate["passed"] else "FAIL"
        print(f"  {status}  {gate['id']:<32}  {gate['detail']}")
    print(f"overall: {'PASS' if summary['passed'] else 'FAIL'}")
    if not summary["passed"] and not args.allow_fail:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
