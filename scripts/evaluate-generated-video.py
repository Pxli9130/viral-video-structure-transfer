#!/usr/bin/env python3
"""Visual / audio acceptance evaluator for generated videos.

Checks a rendered MP4 plus its companion generation/timeline/report payloads
against deterministic criteria, returning a structured evaluation JSON and
exiting non-zero when must-pass gates fail.

Usage:
    python evaluate-generated-video.py \
        --video docs/marketing_case_artifacts/ai_challenge_poster_main.mp4 \
        --analysis docs/marketing_case_artifacts/analysis.marketing.json \
        --generation docs/marketing_case_artifacts/generation-result.json \
        --report docs/marketing_case_artifacts/report.md \
        --out docs/marketing_case_artifacts/evaluation.main.json
"""

from __future__ import annotations

import argparse
import hashlib
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


def run(cmd: list[str]) -> str:
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
        ["ffmpeg", "-hide_banner", "-i", video, "-af", "volumedetect", "-f", "null", "/dev/null"],
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
    matched = expected_atom in actual_types
    return {"expected": expected_atom, "actual": actual_types, "matched": matched}


def detect_forbidden(report_text: str, forbidden: list[str]) -> list[str]:
    return [word for word in forbidden if word in report_text]


def evaluate(
    video: str,
    analysis_path: str | None,
    generation_path: str | None,
    report_path: str | None,
    expected_atom: str | None,
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

    summary = {
        "video": str(video),
        "metadata": metadata,
        "audio": loudness,
        "motion": {"avgFrameDiff": round(motion_avg, 4), "threshold": min_motion},
        "foreground": fg,
        "phases": phases,
        "motif": motif_check,
        "hash": hash_file(video),
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates),
        "forbiddenHits": forbidden_hits,
    }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--analysis", default=None)
    parser.add_argument("--generation", default=None)
    parser.add_argument("--report", default=None)
    parser.add_argument("--expected-atom", default="wide_3d_ribbon_surface")
    parser.add_argument("--min-motion", type=float, default=0.012)
    parser.add_argument("--min-band-width", type=int, default=40)
    parser.add_argument("--out", required=True)
    parser.add_argument("--allow-fail", action="store_true", help="Always exit 0 even if gates fail")
    args = parser.parse_args()

    if not Path(args.video).exists():
        print(f"video not found: {args.video}", file=sys.stderr)
        return 1
    if shutil.which("ffprobe") is None or shutil.which("ffmpeg") is None:
        print("ffprobe/ffmpeg not on PATH", file=sys.stderr)
        return 1

    summary = evaluate(
        video=args.video,
        analysis_path=args.analysis,
        generation_path=args.generation,
        report_path=args.report,
        expected_atom=args.expected_atom,
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
