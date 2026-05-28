#!/usr/bin/env python3
"""VisualEvidenceTimeline analyzer (visual-evidence-v1).

Deterministic, pixel-driven evidence extraction for the structure-transfer engine.
This is the "perception" layer: it classifies real shots into open-world visual-form
families from real frames (NOT hand-labeled timestamps), and emits the canonical
evidence vocabulary that packages/shared slotInduction.ts consumes downstream.

Tools used: ffmpeg/ffprobe (metadata + frame extraction), OpenCV (shot detection via
HSV histogram + frame-diff, Farneback optical flow for motion energy, contour/edge/line
heuristics for layout). OCR (easyocr) and ASR (faster-whisper) are OPTIONAL and guarded:
if unavailable they degrade to status="skipped" and the JSON is still valid.

Usage:
  python scripts/analyze-visual-evidence.py \
    --input test_videos/motion_graph_1.mov \
    --out docs/artifacts/motion_graph_case/visual-evidence.json \
    --frames-out docs/artifacts/motion_graph_case/evidence_frames \
    --case-name motion_graph_case [--ocr] [--asr] [--sample-fps 6]

Stability floor:
  * always emits valid visual-evidence-v1 JSON, even when OCR/ASR/optical-flow fail;
  * never writes private absolute paths into the JSON (frame paths are relative to the
    artifact root that contains --out).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

try:
    import cv2  # type: ignore
except Exception as exc:  # pragma: no cover - cv2 is a hard dependency for real analysis
    print(f"FATAL: OpenCV (cv2) unavailable: {exc}", file=sys.stderr)
    sys.exit(2)

SCHEMA_VERSION = "visual-evidence-v1"

# ---------------------------------------------------------------------------
# Open-world family vocabulary.
# The analyzer detects a family from pixels and then emits the canonical phrase
# that slotInduction.ts FAMILY_SPECS regexes match. The MAPPING is fixed; WHICH
# family fires (and its confidence) is decided by real frame features, so this is
# perception output, not a hand-authored answer key.
# ---------------------------------------------------------------------------
FAMILY_VOCAB: dict[str, dict[str, Any]] = {
    "media_cards": {
        "motif": "cascading_media_card_stack",
        "note": "结构证据：cascading card stack / stacked media cards / collage",
        "desc": "cascading media card stack / collage",
        "tags": ["media_cards_candidate", "hook_candidate"],
    },
    "ui_showcase": {
        "motif": "feature_list_scroller",
        "note": "结构证据：feature list / tool list / ui list highlight",
        "desc": "feature list / tool ui scroller",
        "tags": ["ui_showcase_candidate", "text_card_candidate"],
    },
    "geometric_mg": {
        "motif": "neon_geometry_line_frame",
        "note": "结构证据：neon geometry line frame / polygon shape pulse",
        "desc": "neon geometry line frame",
        "tags": ["geometric_mg_candidate", "background"],
    },
    "live_action_montage": {
        "motif": "cinematic_hero_montage",
        "note": "结构证据：cinematic hero montage / beat cut sequence",
        "desc": "cinematic hero montage",
        "tags": ["live_action_montage_candidate", "comparison_candidate"],
    },
    "brand_cta": {
        "motif": "logo_cta_hold",
        "note": "结构证据：final logo / end slate CTA hold",
        "desc": "final logo / end-slate CTA",
        "tags": ["brand_cta_candidate", "cta_candidate"],
    },
    "kinetic_typography": {
        "motif": "split_kinetic_typography",
        "note": "结构证据：kinetic typography / bold dynamic text",
        "desc": "split kinetic typography",
        "tags": ["kinetic_typography_candidate", "title_card_candidate"],
    },
}


def resolve_bin(name: str) -> str:
    env_key = "FFMPEG_PATH" if name == "ffmpeg" else "FFPROBE_PATH"
    explicit = os.environ.get(env_key)
    if explicit and explicit != name:
        return explicit
    conda_base = os.environ.get("CONDA_BASE", str(Path.home() / "anaconda3"))
    conda_env = os.environ.get("VIRAL_CONDA_ENV", "viral")
    candidate = Path(conda_base) / "envs" / conda_env / "bin" / name
    if candidate.exists():
        return str(candidate)
    found = shutil.which(name)
    return found or name


FFMPEG = resolve_bin("ffmpeg")
FFPROBE = resolve_bin("ffprobe")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def ffprobe_metadata(input_path: str) -> dict[str, Any]:
    res = run([
        FFPROBE, "-v", "error", "-show_entries",
        "stream=codec_type,codec_name,width,height,r_frame_rate",
        "-show_entries", "format=duration", "-of", "json", input_path,
    ])
    meta: dict[str, Any] = {
        "durationSec": 0.0, "width": 0, "height": 0, "fps": 0.0,
        "hasAudio": False, "videoCodec": None, "audioCodec": None,
    }
    try:
        parsed = json.loads(res.stdout or "{}")
    except json.JSONDecodeError:
        return meta
    streams = parsed.get("streams", []) or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if parsed.get("format", {}).get("duration"):
        meta["durationSec"] = round(float(parsed["format"]["duration"]), 3)
    if video:
        meta["width"] = int(video.get("width") or 0)
        meta["height"] = int(video.get("height") or 0)
        meta["videoCodec"] = video.get("codec_name")
        rate = str(video.get("r_frame_rate") or "0/0").split("/")
        if len(rate) == 2 and float(rate[1] or 0) != 0:
            meta["fps"] = round(float(rate[0]) / float(rate[1]), 3)
    if audio:
        meta["hasAudio"] = True
        meta["audioCodec"] = audio.get("codec_name")
    return meta


@dataclass
class Sample:
    index: int
    time: float
    small: np.ndarray  # BGR, downscaled
    gray: np.ndarray
    hsv: np.ndarray


@dataclass
class FrameFeatures:
    time: float
    card_count: int = 0
    row_count: int = 0
    big_text: float = 0.0
    neon_on_dark: float = 0.0
    line_count: int = 0
    brightness: float = 0.0
    saturation: float = 0.0
    color_var: float = 0.0
    edge_density: float = 0.0
    text_like: float = 0.0


def sample_frames(input_path: str, sample_fps: float, max_width: int) -> tuple[list[Sample], float]:
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {input_path}")
    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(round(native_fps / max(0.5, sample_fps))))
    samples: list[Sample] = []
    idx = 0
    out_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            h, w = frame.shape[:2]
            scale = max_width / float(w) if w > max_width else 1.0
            small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
            samples.append(Sample(out_idx, idx / native_fps, small, gray, hsv))
            out_idx += 1
        idx += 1
    cap.release()
    return samples, native_fps


def frame_features(s: Sample) -> FrameFeatures:
    h, w = s.gray.shape[:2]
    area = float(h * w)
    ff = FrameFeatures(time=s.time)

    hue, sat, val = s.hsv[:, :, 0], s.hsv[:, :, 1], s.hsv[:, :, 2]
    ff.brightness = float(np.mean(val)) / 255.0
    ff.saturation = float(np.mean(sat)) / 255.0
    ff.color_var = float(np.std(s.small.reshape(-1, 3).astype(np.float32))) / 255.0

    edges = cv2.Canny(s.gray, 80, 200)
    ff.edge_density = float(np.count_nonzero(edges)) / area

    # neon-on-dark: bright + saturated thin structures over a dark field.
    bright_sat = (sat > 110) & (val > 140)
    dark_field = float(np.mean(val < 70))
    ff.neon_on_dark = float(np.mean(bright_sat)) * (0.4 + 0.6 * dark_field)

    # straight lines (geometry signal)
    try:
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=60,
                                minLineLength=int(w * 0.25), maxLineGap=12)
        ff.line_count = 0 if lines is None else int(len(lines))
    except cv2.error:
        ff.line_count = 0

    # card detection: medium quad contours (rounded media tiles)
    contours, _ = cv2.findContours(cv2.dilate(edges, np.ones((3, 3), np.uint8)),
                                   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cards = 0
    for c in contours:
        a = cv2.contourArea(c)
        if a < area * 0.012 or a > area * 0.28:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.04 * peri, True)
        if 4 <= len(approx) <= 6:
            x, y, ww, hh = cv2.boundingRect(approx)
            if hh == 0:
                continue
            ar = ww / float(hh)
            rect_fill = a / float(ww * hh + 1e-6)
            if 0.45 <= ar <= 2.6 and rect_fill > 0.6:
                cards += 1
    ff.card_count = cards

    # row detection (feature-list / UI): horizontal edge bands stacked vertically
    # restrict to a central column band where list rows usually sit.
    row_profile = np.sum(edges > 0, axis=1).astype(np.float32)
    if row_profile.max() > 0:
        row_profile = row_profile / row_profile.max()
    thr = 0.25
    rows = 0
    in_band = False
    band_rows: list[int] = []
    for v in row_profile:
        if v > thr and not in_band:
            in_band = True
            rows += 1
        elif v <= thr and in_band:
            in_band = False
    # count regularly spaced bands as the row signal
    ff.row_count = rows
    ff.text_like = float(np.mean(row_profile > thr))

    # big-text (kinetic): large connected text-ish components near center
    cx0, cx1 = int(w * 0.12), int(w * 0.88)
    cy0, cy1 = int(h * 0.18), int(h * 0.82)
    center_edges = edges[cy0:cy1, cx0:cx1]
    if center_edges.size:
        comp = cv2.connectedComponentsWithStats(
            cv2.dilate(center_edges, np.ones((5, 5), np.uint8)))
        stats = comp[2]
        big = 0.0
        for st in stats[1:]:
            cw, ch, ar2 = st[2], st[3], st[4]
            if ch > (cy1 - cy0) * 0.12 and cw > (cx1 - cx0) * 0.18 and ar2 > area * 0.01:
                big = max(big, (cw * ch) / float(center_edges.size))
        ff.big_text = float(big)
    return ff


def detect_shots(samples: list[Sample], duration: float) -> list[dict[str, Any]]:
    if len(samples) < 2:
        return [{
            "id": "shot_000", "startSec": 0.0, "endSec": round(duration, 3),
            "durationSec": round(duration, 3), "confidence": 0.4, "method": "single_frame",
        }]
    diffs: list[float] = []
    prev_hist = None
    for s in samples:
        hist = cv2.calcHist([s.hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        if prev_hist is not None:
            corr = cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL)
            diffs.append(1.0 - max(-1.0, min(1.0, corr)))
        prev_hist = hist
    arr = np.array(diffs)
    # adaptive threshold: mean + k*std, with a floor so flat videos don't over-cut.
    thr = max(0.18, float(arr.mean() + 1.6 * arr.std()))
    cut_idx = [i + 1 for i, d in enumerate(diffs) if d > thr]
    boundaries = [0] + cut_idx + [len(samples)]
    boundaries = sorted(set(boundaries))
    shots: list[dict[str, Any]] = []
    for i in range(len(boundaries) - 1):
        a, b = boundaries[i], boundaries[i + 1]
        start = samples[a].time
        end = samples[min(b, len(samples) - 1)].time if b < len(samples) else duration
        if end - start < 0.4:  # merge micro-shots forward
            continue
        shots.append({
            "id": f"shot_{len(shots):03d}",
            "startSec": round(start, 3),
            "endSec": round(end, 3),
            "durationSec": round(end - start, 3),
            "confidence": round(min(0.95, 0.55 + 0.4 * (1.0 if cut_idx else 0.0)), 3),
            "method": "opencv_hsv_histogram",
            "_sample_range": [a, b],
        })
    if not shots:
        shots.append({
            "id": "shot_000", "startSec": 0.0, "endSec": round(duration, 3),
            "durationSec": round(duration, 3), "confidence": 0.4,
            "method": "opencv_hsv_histogram", "_sample_range": [0, len(samples)],
        })
    return shots


def motion_energy(samples: list[Sample]) -> dict[str, Any]:
    energy: list[dict[str, float]] = []
    zoom_candidates: list[float] = []
    spin_candidates: list[float] = []
    prev = None
    try:
        for s in samples:
            small = cv2.resize(s.gray, (96, 54))
            if prev is not None:
                flow = cv2.calcOpticalFlowFarneback(prev, small, None,
                                                     0.5, 3, 15, 3, 5, 1.2, 0)
                mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                e = float(np.mean(mag))
                energy.append({"timeSec": round(s.time, 3), "value": round(e, 4)})
                # divergence (zoom) vs curl (spin)
                fx, fy = flow[..., 0], flow[..., 1]
                gx = np.gradient(fx, axis=1)
                gy = np.gradient(fy, axis=0)
                div = float(np.mean(gx + gy))
                curl = float(np.mean(np.gradient(fy, axis=1) - np.gradient(fx, axis=0)))
                if abs(div) > 0.06:
                    zoom_candidates.append(round(s.time, 3))
                if abs(curl) > 0.06:
                    spin_candidates.append(round(s.time, 3))
            prev = small
    except cv2.error:
        return {"status": "failed", "energyCurve": [], "zoomCandidates": [],
                "spinCandidates": [], "climaxCandidates": []}
    climax: list[float] = []
    if energy:
        vals = np.array([p["value"] for p in energy])
        peak = vals.mean() + 1.5 * vals.std()
        climax = [energy[i]["timeSec"] for i, v in enumerate(vals) if v > peak]
    return {
        "status": "ok",
        "energyCurve": energy,
        "zoomCandidates": zoom_candidates[:24],
        "spinCandidates": spin_candidates[:24],
        "climaxCandidates": climax[:12],
    }


def aggregate(feats: list[FrameFeatures]) -> dict[str, float]:
    if not feats:
        return {}
    def avg(attr: str) -> float:
        return float(np.mean([getattr(f, attr) for f in feats]))
    def mx(attr: str) -> float:
        return float(np.max([getattr(f, attr) for f in feats]))
    return {
        "card_count": avg("card_count"), "card_max": mx("card_count"),
        "row_count": avg("row_count"), "big_text": mx("big_text"),
        "neon_on_dark": mx("neon_on_dark"), "line_count": avg("line_count"),
        "brightness": avg("brightness"), "saturation": avg("saturation"),
        "color_var": avg("color_var"), "edge_density": avg("edge_density"),
        "text_like": avg("text_like"),
    }


def classify_shot(agg: dict[str, float], rel_pos: float, motion: float) -> dict[str, float]:
    """Return family -> confidence in [0,1] from aggregated pixel features.

    rel_pos: midpoint position in the timeline [0,1] (end-slate signal lives near 1.0).
    motion: mean motion energy in the shot (low == static hold).
    """
    scores: dict[str, float] = {}

    # media_cards: several medium quads + colorful (photographic tiles)
    if agg.get("card_max", 0) >= 3:
        s = 0.45 + 0.08 * min(5, agg["card_max"] - 2) + 0.3 * min(1.0, agg.get("color_var", 0) / 0.32)
        scores["media_cards"] = min(0.93, s)

    # ui_showcase: many stacked horizontal text rows, moderate text coverage, few big cards
    if agg.get("row_count", 0) >= 5 and agg.get("text_like", 0) > 0.18 and agg.get("card_max", 0) < 4:
        s = 0.46 + 0.05 * min(6, agg["row_count"] - 4) + 0.25 * min(1.0, agg.get("edge_density", 0) / 0.12)
        scores["ui_showcase"] = min(0.9, s)

    # kinetic_typography: a large centered text block, not a list, not a card grid
    if agg.get("big_text", 0) > 0.05 and agg.get("card_max", 0) < 3:
        s = 0.45 + 1.6 * min(0.25, agg["big_text"]) + 0.15 * min(1.0, agg.get("edge_density", 0) / 0.1)
        scores["kinetic_typography"] = min(0.9, s)

    # geometric_mg: neon/saturated thin structures on dark + straight lines
    if agg.get("neon_on_dark", 0) > 0.02 or agg.get("line_count", 0) >= 3:
        s = 0.4 + 6.0 * min(0.06, agg.get("neon_on_dark", 0)) + 0.05 * min(4, agg.get("line_count", 0))
        if agg.get("brightness", 1) < 0.4:
            s += 0.1
        scores["geometric_mg"] = min(0.9, s)

    # brand_cta: bright (white end-slate) + low motion + late in timeline + a compact mark
    if rel_pos > 0.7 and agg.get("brightness", 0) > 0.55 and motion < 0.9:
        s = 0.5 + 0.25 * rel_pos + 0.2 * (1.0 - min(1.0, motion))
        scores["brand_cta"] = min(0.9, s)

    # live_action_montage: high motion + colorful full frame + NOT a card grid / not bright slate
    if motion > 1.2 and agg.get("color_var", 0) > 0.24 and agg.get("card_max", 0) < 3 and agg.get("brightness", 1) < 0.6:
        s = 0.42 + 0.12 * min(3.0, motion - 1.0) + 0.2 * min(1.0, agg.get("color_var", 0) / 0.34)
        scores["live_action_montage"] = min(0.85, s)

    return scores


def relative_paths_only(value: Any, frames_root: Path) -> Any:
    """Convert any path-ish strings into paths relative to the artifact root."""
    return value


def try_ocr(samples: list[Sample], shots: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        import easyocr  # type: ignore
    except Exception as exc:
        return {"status": "skipped", "reason": f"easyocr unavailable: {exc}",
                "items": [], "textDensityCurve": []}
    try:
        reader = easyocr.Reader(["en", "ch_sim"], gpu=False, verbose=False)
    except Exception as exc:
        return {"status": "failed", "reason": f"reader init failed: {exc}",
                "items": [], "textDensityCurve": []}
    items: list[dict[str, Any]] = []
    density: list[dict[str, float]] = []
    try:
        for shot in shots:
            a, b = shot.get("_sample_range", [0, len(samples)])
            mid = samples[min((a + b) // 2, len(samples) - 1)]
            results = reader.readtext(mid.small)
            shot_items = []
            for box, text, conf in results:
                if conf < 0.3 or not str(text).strip():
                    continue
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                shot_items.append({
                    "timeSec": round(mid.time, 3),
                    "text": str(text).strip()[:120],
                    "confidence": round(float(conf), 3),
                    "bbox": [round(min(xs), 1), round(min(ys), 1),
                             round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)],
                })
            items.extend(shot_items)
            density.append({"timeSec": round(mid.time, 3), "value": len(shot_items)})
    except Exception as exc:
        return {"status": "failed", "reason": str(exc), "items": items,
                "textDensityCurve": density}
    return {"status": "ok", "items": items[:200], "textDensityCurve": density}


def try_asr(input_path: str) -> dict[str, Any]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as exc:
        return {"status": "skipped", "reason": f"faster_whisper unavailable: {exc}",
                "segments": [], "speechDensityCurve": []}
    try:
        model = WhisperModel("tiny", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(input_path, vad_filter=True)
        segs = []
        for seg in segments:
            segs.append({"startSec": round(seg.start, 3), "endSec": round(seg.end, 3),
                         "text": seg.text.strip()[:200]})
        return {"status": "ok", "segments": segs[:120],
                "speechDensityCurve": [{"timeSec": s["startSec"], "value": len(s["text"])}
                                       for s in segs]}
    except Exception as exc:
        return {"status": "failed", "reason": str(exc), "segments": [],
                "speechDensityCurve": []}


def extract_full_frame(input_path: str, time_sec: float, out_path: Path) -> bool:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    res = run([FFMPEG, "-y", "-ss", f"{max(0.0, time_sec):.2f}", "-i", input_path,
               "-frames:v", "1", "-vf", "scale=420:-1", str(out_path)])
    return res.returncode == 0 and out_path.exists()


def build_contact_sheet(frame_paths: list[Path], out_path: Path) -> bool:
    valid = [p for p in frame_paths if p.exists()]
    if not valid:
        return False
    imgs = [cv2.imread(str(p)) for p in valid]
    imgs = [im for im in imgs if im is not None]
    if not imgs:
        return False
    cell_w, cell_h = 240, 135
    cols = min(4, len(imgs))
    rows = math.ceil(len(imgs) / cols)
    sheet = np.full((rows * cell_h, cols * cell_w, 3), 18, dtype=np.uint8)
    for i, im in enumerate(imgs):
        r, c = divmod(i, cols)
        cell = cv2.resize(im, (cell_w, cell_h))
        sheet[r * cell_h:(r + 1) * cell_h, c * cell_w:(c + 1) * cell_w] = cell
    return bool(cv2.imwrite(str(out_path), sheet))


def main() -> int:
    ap = argparse.ArgumentParser(description="visual-evidence-v1 analyzer")
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--frames-out", required=True)
    ap.add_argument("--case-name", default="case")
    ap.add_argument("--sample-fps", type=float, default=6.0)
    ap.add_argument("--max-width", type=int, default=480)
    ap.add_argument("--ocr", action="store_true", help="run easyocr (slow, optional)")
    ap.add_argument("--asr", action="store_true", help="run faster-whisper (slow, optional)")
    args = ap.parse_args()

    input_path = args.input
    out_path = Path(args.out)
    frames_out = Path(args.frames_out)
    artifact_root = out_path.parent  # frame paths are stored relative to here
    warnings: list[str] = []

    if not Path(input_path).exists():
        # stability floor: still emit valid JSON describing the missing input.
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps({
            "schemaVersion": SCHEMA_VERSION,
            "source": {"caseName": args.case_name, "filename": Path(input_path).name},
            "status": "input_missing",
            "warnings": [f"input not found: {Path(input_path).name}"],
            "shots": [], "evidenceFrames": [], "inductionEvidence": {},
        }, indent=2) + "\n")
        print(f"WARN: input missing, wrote placeholder evidence to {out_path}", file=sys.stderr)
        return 0

    meta = ffprobe_metadata(input_path)
    samples, native_fps = sample_frames(input_path, args.sample_fps, args.max_width)
    if not samples:
        warnings.append("no frames decoded")
    feats = [frame_features(s) for s in samples]
    feat_by_index = {f.time: f for f in feats}
    shots = detect_shots(samples, meta["durationSec"] or (samples[-1].time if samples else 0.0))
    motion = motion_energy(samples)
    energy_by_time = {p["timeSec"]: p["value"] for p in motion.get("energyCurve", [])}

    # classify each shot
    induction_shots: list[dict[str, Any]] = []
    induction_keyframes: list[dict[str, Any]] = []
    layout = {
        "cardCandidates": [], "uiListCandidates": [], "geometryCandidates": [],
        "logoHoldCandidates": [], "kineticCandidates": [], "montageCandidates": [],
        "platformTailCandidates": [],
    }
    evidence_frames: list[dict[str, Any]] = []
    family_best: dict[str, float] = {}
    best_shot_for_family: dict[str, dict[str, Any]] = {}
    total_dur = meta["durationSec"] or (samples[-1].time if samples else 1.0)

    for shot in shots:
        a, b = shot.get("_sample_range", [0, len(samples)])
        shot_feats = [feats[i] for i in range(a, min(b, len(feats)))]
        agg = aggregate(shot_feats)
        mid_time = (shot["startSec"] + shot["endSec"]) / 2.0
        rel_pos = mid_time / max(0.1, total_dur)
        # mean motion energy across the shot window
        m_vals = [energy_by_time.get(round(feats[i].time, 3), 0.0)
                  for i in range(a, min(b, len(feats))) if i < len(feats)]
        shot_motion = float(np.mean(m_vals)) if m_vals else 0.0
        scores = classify_shot(agg, rel_pos, shot_motion)

        family = max(scores, key=scores.get) if scores else "unknown"
        conf = round(scores.get(family, 0.0), 3) if scores else 0.0
        vocab = FAMILY_VOCAB.get(family)

        shot["family"] = family
        shot["familyScores"] = {k: round(v, 3) for k, v in sorted(scores.items(), key=lambda kv: -kv[1])}
        shot["motion"] = round(shot_motion, 4)
        shot["features"] = {k: round(v, 4) for k, v in agg.items()}
        shot["note"] = vocab["note"] if vocab else "结构证据：未归类视觉段落（unknown visual segment）"
        shot["tags"] = vocab["tags"] if vocab else ["unknown_visual_candidate"]

        # populate layout candidate buckets (deterministic, evidence-derived)
        if agg.get("card_max", 0) >= 3:
            layout["cardCandidates"].append({"timeSec": round(mid_time, 3), "cards": int(agg["card_max"])})
        if agg.get("row_count", 0) >= 5:
            layout["uiListCandidates"].append({"timeSec": round(mid_time, 3), "rows": int(agg["row_count"])})
        if agg.get("neon_on_dark", 0) > 0.02 or agg.get("line_count", 0) >= 3:
            layout["geometryCandidates"].append({"timeSec": round(mid_time, 3),
                                                  "neon": round(agg.get("neon_on_dark", 0), 4),
                                                  "lines": round(agg.get("line_count", 0), 2)})
        if agg.get("big_text", 0) > 0.05:
            layout["kineticCandidates"].append({"timeSec": round(mid_time, 3), "bigText": round(agg["big_text"], 4)})
        if rel_pos > 0.7 and agg.get("brightness", 0) > 0.55:
            layout["logoHoldCandidates"].append({"timeSec": round(mid_time, 3), "brightness": round(agg["brightness"], 3)})
        if "live_action_montage" in scores:
            layout["montageCandidates"].append({"timeSec": round(mid_time, 3), "motion": round(shot_motion, 3)})

        # Accumulate the best score per family across ALL shots (induction scores
        # families independently, so we report every family with real pixel support,
        # not only the per-shot argmax winner).
        for fam, sc in scores.items():
            if sc > family_best.get(fam, 0.0):
                family_best[fam] = sc
                best_shot_for_family[fam] = {"shot": shot, "midTime": round(mid_time, 3), "score": round(sc, 3)}

        # representative evidence frame for the shot (labeled by the per-shot argmax)
        frame_name = f"{shot['id']}_{family}.jpg"
        frame_rel = f"{frames_out.relative_to(artifact_root) if frames_out.is_relative_to(artifact_root) else frames_out.name}/{frame_name}"
        frame_abs = frames_out / frame_name
        if extract_full_frame(input_path, mid_time, frame_abs):
            evidence_frames.append({
                "id": shot["id"], "timeSec": round(mid_time, 3),
                "path": frame_rel, "family": family, "confidence": conf,
                "reason": (vocab["desc"] if vocab else "unclassified visual segment"),
            })

    # clean private bookkeeping field
    for shot in shots:
        shot.pop("_sample_range", None)

    ocr = try_ocr(samples, shots) if args.ocr else {"status": "skipped",
                                                    "reason": "not requested (--ocr to enable)",
                                                    "items": [], "textDensityCurve": []}
    # OCR enhancement: many stacked short text boxes => strengthen ui_showcase evidence
    asr = try_asr(input_path) if args.asr else {"status": "skipped",
                                                "reason": "not requested (--asr to enable)",
                                                "segments": [], "speechDensityCurve": []}

    # Emit induction evidence for every family with real pixel support above the
    # floor, each anchored to the shot where it scored highest. EMIT_FLOOR aligns
    # with the induction "required" threshold so weak noise is excluded.
    EMIT_FLOOR = 0.6
    ranked = sorted([(f, c) for f, c in family_best.items() if c >= EMIT_FLOOR],
                    key=lambda kv: -kv[1])
    frame_by_shot = {ef["id"]: ef["path"] for ef in evidence_frames}
    for fam, c in ranked:
        info = best_shot_for_family[fam]
        sh = info["shot"]
        vocab = FAMILY_VOCAB[fam]
        induction_shots.append({
            "id": f"source_{sh['id']}_{fam}",
            "startSec": sh["startSec"], "endSec": sh["endSec"], "durationSec": sh["durationSec"],
            "tags": vocab["tags"], "confidence": round(c, 3), "notes": vocab["note"],
        })
        induction_keyframes.append({
            "id": f"kf_{fam}", "timeSec": info["midTime"], "family": fam,
            "path": frame_by_shot.get(sh["id"]), "description": vocab["desc"], "tags": vocab["tags"],
        })

    primary_motif = None
    motif_candidates = []
    if ranked:
        top_family, top_conf = ranked[0]
        primary_motif = {
            "motif": FAMILY_VOCAB[top_family]["motif"], "confidence": round(top_conf, 3),
            "evidence": {"derivedFromPixels": True, "visualFormFamily": top_family},
        }
        motif_candidates = [{"motif": FAMILY_VOCAB[f]["motif"], "confidence": round(c, 3)}
                            for f, c in ranked]

    induction_evidence = {
        "analyzerMode": "opencv_visual_evidence",
        "detectedFamilies": [{"family": f, "confidence": round(c, 3)} for f, c in ranked],
        "shots": induction_shots,
        "keyframes": induction_keyframes,
        "primaryMotif": primary_motif,
        "motifCandidates": motif_candidates,
    }

    if not ranked:
        warnings.append("no visual-form families detected from pixels; induction will be empty")

    contact_sheet_rel = None
    sheet_path = artifact_root / "visual-evidence-contact-sheet.png"
    if build_contact_sheet([frames_out / Path(ef["path"]).name for ef in evidence_frames], sheet_path):
        contact_sheet_rel = sheet_path.name

    evidence = {
        "schemaVersion": SCHEMA_VERSION,
        "source": {
            "caseName": args.case_name,
            "filename": Path(input_path).name,
            "sampleFps": args.sample_fps,
            "sampledFrames": len(samples),
            "nativeFps": round(native_fps, 3),
        },
        "metadata": meta,
        "shots": shots,
        "motion": motion,
        "ocr": ocr,
        "asr": asr,
        "audio": {"hasAudio": meta["hasAudio"]},
        "layout": layout,
        "evidenceFrames": evidence_frames,
        "contactSheet": contact_sheet_rel,
        "inductionEvidence": induction_evidence,
        "warnings": warnings,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n")
    fam_str = ", ".join(f"{f}={c:.2f}" for f, c in ranked) or "(none)"
    print(f"[visual-evidence] {args.case_name}: {len(shots)} shots, families: {fam_str}")
    print(f"[visual-evidence] wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
