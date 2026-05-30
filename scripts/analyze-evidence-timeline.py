#!/usr/bin/env python3
"""Evidence-first analyzer: scene cuts (PySceneDetect) + beat grid (librosa) +
per-shot keyframes + deterministic visual/style tags + stats.

Emits a VisualEvidenceTimeline JSON (schema: visual-evidence-timeline-v1) that the
downstream VLM/LLM must cite instead of hallucinating. Keeps OCR/ASR optional so
the API can rely on its own adapters and just bind text by timestamp.

Usage:
  python scripts/analyze-evidence-timeline.py --video <path> --out <json>
      --frames-dir <dir> [--frames-url-prefix <prefix>] [--source-asset-id <id>]
      [--ocr] [--asr] [--asr-model tiny] [--max-shots 40]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

try:
    import cv2
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": f"cv2 import failed: {exc!r}"}))
    sys.exit(3)


def resolve_bin(name):
    env = os.environ.get("FFMPEG_PATH" if name == "ffmpeg" else "FFPROBE_PATH")
    if env and (os.path.isabs(env) and os.path.exists(env)):
        return env
    found = shutil.which(name)
    if found:
        return found
    conda_base = os.environ.get("CONDA_BASE")
    conda_env = os.environ.get("VIRAL_CONDA_ENV", "viral")
    if conda_base:
        cand = os.path.join(conda_base, "envs", conda_env, "bin", name)
        if os.path.exists(cand):
            return cand
    return name


FFMPEG = resolve_bin("ffmpeg")
FFPROBE = resolve_bin("ffprobe")


def ffprobe_metadata(video):
    cmd = [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", video]
    out = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(out.stdout or "{}")
    meta = {"durationSec": 0.0, "width": None, "height": None, "fps": None, "hasAudio": False, "codec": None}
    fmt = data.get("format", {})
    try:
        meta["durationSec"] = float(fmt.get("duration", 0.0))
    except Exception:
        pass
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video" and meta["width"] is None:
            meta["width"] = stream.get("width")
            meta["height"] = stream.get("height")
            meta["codec"] = stream.get("codec_name")
            rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1"
            try:
                num, den = rate.split("/")
                den = float(den) or 1.0
                meta["fps"] = round(float(num) / den, 3)
            except Exception:
                pass
        if stream.get("codec_type") == "audio":
            meta["hasAudio"] = True
    return meta


def tc_seconds(tc):
    try:
        return float(tc.get_seconds())
    except Exception:
        try:
            return float(tc.seconds)
        except Exception:
            return 0.0


def detect_scene_cuts(video, duration):
    """PySceneDetect ContentDetector -> list of (start, end). Fallback to uniform split."""
    detector_name = "pyscenedetect_content"
    scenes = []
    try:
        from scenedetect import detect, ContentDetector
        raw = detect(video, ContentDetector(threshold=27.0))
        for s, e in raw:
            start = tc_seconds(s)
            end = tc_seconds(e)
            if end - start >= 0.25:
                scenes.append((start, end))
    except Exception as exc:
        scenes = []
        detector_name = f"fallback_uniform ({exc!r})"
    if len(scenes) < 2:
        # Fallback: uniform ~2s shots so downstream still gets a shot grid.
        detector_name = "fallback_uniform"
        step = 2.0
        scenes = []
        t = 0.0
        while t < duration:
            scenes.append((t, min(duration, t + step)))
            t += step
    return scenes, detector_name


def extract_keyframe(video, time_sec, out_path, width=320):
    cmd = [
        FFMPEG, "-y", "-ss", f"{max(0.0, time_sec):.3f}", "-i", video,
        "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", out_path,
    ]
    subprocess.run(cmd, capture_output=True, text=True)
    return os.path.exists(out_path)


def frame_features(img):
    """Deterministic per-frame features used to tag family/style."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2].astype(np.float32)
    s = hsv[:, :, 1].astype(np.float32)
    mean_v = float(v.mean())  # 0..255 brightness
    mean_s = float(s.mean())
    dark_ratio = float((v < 60).mean())
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 180)
    edge_density = float((edges > 0).mean())
    # text-like: many short horizontal edge runs in central band
    h, w = gray.shape
    band = edges[int(h * 0.30):int(h * 0.80), :]
    text_score = float((band > 0).mean())
    # red/yellow emphasis presence (HSV hue near red/orange/yellow with high sat)
    hue = hsv[:, :, 0].astype(np.float32)
    red_mask = (((hue < 15) | (hue > 165)) & (s > 90) & (v > 90))
    yellow_mask = ((hue >= 18) & (hue <= 38) & (s > 90) & (v > 120))
    red_ratio = float(red_mask.mean())
    yellow_ratio = float(yellow_mask.mean())
    # central object: saturated/bright blob near center vs edges
    cy0, cy1 = int(h * 0.25), int(h * 0.75)
    cx0, cx1 = int(w * 0.25), int(w * 0.75)
    center_v = float(v[cy0:cy1, cx0:cx1].mean())
    return {
        "meanV": mean_v, "meanS": mean_s, "darkRatio": dark_ratio,
        "edgeDensity": edge_density, "textScore": text_score,
        "redRatio": red_ratio, "yellowRatio": yellow_ratio, "centerV": center_v,
    }


def classify(feat, index, shot_count):
    """Return (family, visualTags, styleTags) from deterministic features."""
    tags = []
    style = []
    if feat["darkRatio"] > 0.45 or feat["meanV"] < 70:
        style.append("dark_bg")
        tags.append("dark_background")
    if feat["redRatio"] > 0.015:
        style.append("red_emphasis")
        tags.append("red_accent")
    if feat["yellowRatio"] > 0.015:
        style.append("yellow_emphasis")
    high_text = feat["textScore"] > 0.06 and feat["edgeDensity"] > 0.05
    photographic = feat["meanS"] > 60 and feat["edgeDensity"] > 0.08 and not high_text
    # family decision
    is_dark = feat["darkRatio"] > 0.4 or feat["meanV"] < 80
    if index == 0:
        family = "object_motion"  # hook / hero intro
        tags.append("hook_candidate")
    elif index >= shot_count - 1:
        family = "brand_cta"
        tags.append("cta_candidate")
    elif high_text and is_dark:
        family = "kinetic_typography"
        tags.append("text_card")
        style.append("bold_center_text")
    elif photographic:
        family = "live_action_montage"
        tags.append("action_candidate")
    elif high_text:
        family = "kinetic_typography"
        tags.append("text_card")
    else:
        family = "object_motion" if is_dark else "ui_showcase"
    if feat["centerV"] > feat["meanV"] * 1.1 and is_dark and not high_text:
        tags.append("center_hero_object")
    return family, tags, style


def beat_grid(video, has_audio):
    if not has_audio:
        return {"status": "no_audio", "beats": [], "onsets": [], "source": "librosa"}
    tmp_wav = None
    try:
        import librosa
        fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        cmd = [FFMPEG, "-y", "-i", video, "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", tmp_wav]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(tmp_wav) or os.path.getsize(tmp_wav) < 1000:
            return {"status": "no_audio", "beats": [], "onsets": [], "source": "librosa"}
        y, sr = librosa.load(tmp_wav, sr=22050, mono=True)
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(np.atleast_1d(tempo).astype(float)[0]) if np.size(tempo) else 0.0
        beat_times = [round(float(t), 3) for t in librosa.frames_to_time(beats, sr=sr)]
        onset_frames = librosa.onset.onset_detect(y=y, sr=sr, backtrack=True)
        onset_times = [round(float(t), 3) for t in librosa.frames_to_time(onset_frames, sr=sr)]
        # keep strong onsets only (subsample if huge)
        if len(onset_times) > 400:
            onset_times = onset_times[::2]
        return {"status": "ok", "bpm": round(bpm, 1), "beats": beat_times, "onsets": onset_times, "source": "librosa"}
    except Exception as exc:
        return {"status": "unavailable", "beats": [], "onsets": [], "source": f"librosa_error:{exc!r}"}
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.remove(tmp_wav)


def dominant_palette(frames_bgr, k=4):
    if not frames_bgr:
        return []
    samples = []
    for img in frames_bgr:
        small = cv2.resize(img, (24, 42), interpolation=cv2.INTER_AREA)
        samples.append(small.reshape(-1, 3))
    data = np.concatenate(samples, axis=0).astype(np.float32)
    if len(data) < k:
        return []
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    _, labels, centers = cv2.kmeans(data, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k)
    order = np.argsort(-counts)
    hexes = []
    for idx in order:
        b, g, r = centers[idx]
        hexes.append("#%02x%02x%02x" % (int(r), int(g), int(b)))
    return hexes


def run_ocr(frame_paths):
    try:
        import easyocr
        reader = easyocr.Reader(["ch_sim", "en"], gpu=False, verbose=False)
        results = {}
        for p in frame_paths:
            try:
                texts = reader.readtext(p, detail=0, paragraph=True)
                results[p] = [t for t in texts if t and t.strip()]
            except Exception:
                results[p] = []
        return {"status": "ok", "byFrame": results}
    except Exception as exc:
        return {"status": "unavailable", "byFrame": {}, "error": repr(exc)}


def run_asr(video, model_name):
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(video, vad_filter=True)
        out = [{"startSec": round(float(s.start), 2), "endSec": round(float(s.end), 2), "text": s.text.strip()} for s in segments]
        return {"status": "ok", "segments": out}
    except Exception as exc:
        return {"status": "unavailable", "segments": [], "error": repr(exc)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--frames-dir", required=True)
    ap.add_argument("--frames-url-prefix", default="")
    ap.add_argument("--source-asset-id", default="")
    ap.add_argument("--ocr", action="store_true")
    ap.add_argument("--asr", action="store_true")
    ap.add_argument("--asr-model", default="tiny")
    ap.add_argument("--max-shots", type=int, default=48)
    args = ap.parse_args()

    if not os.path.exists(args.video):
        print(json.dumps({"error": f"video not found: {args.video}"}))
        sys.exit(2)
    os.makedirs(args.frames_dir, exist_ok=True)

    meta = ffprobe_metadata(args.video)
    duration = meta["durationSec"] or 0.0
    warnings = []

    scenes, detector = detect_scene_cuts(args.video, duration)
    if len(scenes) > args.max_shots:
        # merge to cap shot count while preserving coverage
        factor = int(np.ceil(len(scenes) / args.max_shots))
        merged = []
        for i in range(0, len(scenes), factor):
            chunk = scenes[i:i + factor]
            merged.append((chunk[0][0], chunk[-1][1]))
        scenes = merged
        warnings.append(f"merged scenes by factor {factor} to cap at {args.max_shots}")

    scene_cuts = [
        {"index": i, "startSec": round(s, 3), "endSec": round(e, 3), "durationSec": round(e - s, 3), "detector": detector}
        for i, (s, e) in enumerate(scenes)
    ]

    grid = beat_grid(args.video, meta["hasAudio"])
    beats = grid.get("beats", [])

    shots = []
    evidence_frames = []
    frames_bgr = []
    dark_count = 0
    text_card_count = 0
    durations = []
    for i, (start, end) in enumerate(scenes):
        mid = (start + end) / 2.0
        frame_name = f"frame_{i:03d}.png"
        frame_path = os.path.join(args.frames_dir, frame_name)
        ok = extract_keyframe(args.video, mid, frame_path)
        feat = None
        family = "unknown"
        vtags, stags = [], []
        if ok:
            img = cv2.imread(frame_path)
            if img is not None:
                frames_bgr.append(img)
                feat = frame_features(img)
                family, vtags, stags = classify(feat, i, len(scenes))
                if feat["darkRatio"] > 0.45 or feat["meanV"] < 70:
                    dark_count += 1
                if "text_card" in vtags:
                    text_card_count += 1
        frame_id = f"ev_{i:03d}"
        public_path = (args.frames_url_prefix + frame_name) if args.frames_url_prefix else frame_path
        beat_aligned = any(abs(b - start) < 0.18 for b in beats) if beats else False
        durations.append(end - start)
        evidence_frames.append({
            "id": frame_id,
            "timeSec": round(mid, 3),
            "path": public_path,
            "family": family,
            "confidence": round(min(1.0, 0.5 + (feat["edgeDensity"] if feat else 0.0)), 3),
            "reason": ",".join(vtags) or family,
            "evidenceKinds": ["visual"],
        })
        shots.append({
            "shotId": f"shot_{i:03d}",
            "startSec": round(start, 3),
            "endSec": round(end, 3),
            "durationSec": round(end - start, 3),
            "keyframeIds": [frame_id],
            "cutBefore": i > 0,
            "cutAfter": i < len(scenes) - 1,
            "beatAligned": beat_aligned,
            "ocrText": [],
            "asrText": [],
            "visualTags": vtags,
            "styleTags": stags,
            "family": family,
            "confidence": round(min(1.0, 0.55 + (feat["edgeDensity"] if feat else 0.0)), 3),
            "evidencePaths": [public_path],
        })

    # OCR / ASR (optional; API path can also bind its own adapters' output)
    ocr_status = "skipped"
    if args.ocr:
        ocr = run_ocr([os.path.join(args.frames_dir, f"frame_{i:03d}.png") for i in range(len(scenes))])
        ocr_status = "ok" if ocr["status"] == "ok" else "unavailable"
        if ocr["status"] == "ok":
            by = ocr["byFrame"]
            for i, shot in enumerate(shots):
                p = os.path.join(args.frames_dir, f"frame_{i:03d}.png")
                shot["ocrText"] = by.get(p, [])
        else:
            warnings.append(f"ocr unavailable: {ocr.get('error','')}")
    asr_status = "skipped"
    if args.asr:
        asr = run_asr(args.video, args.asr_model)
        asr_status = "ok" if asr["status"] == "ok" else "unavailable"
        if asr["status"] == "ok":
            for shot in shots:
                texts = [seg["text"] for seg in asr["segments"]
                         if seg["endSec"] > shot["startSec"] and seg["startSec"] < shot["endSec"] and seg["text"]]
                shot["asrText"] = texts
        else:
            warnings.append(f"asr unavailable: {asr.get('error','')}")

    durations = [d for d in durations if d > 0]
    avg_shot = float(np.mean(durations)) if durations else 0.0
    med_shot = float(np.median(durations)) if durations else 0.0
    # fast zones: contiguous shots with duration < 1.2s
    fast_zones = []
    zone_start = None
    for i, (s, e) in enumerate(scenes):
        if (e - s) < 1.2:
            if zone_start is None:
                zone_start = s
            zone_end = e
        else:
            if zone_start is not None:
                fast_zones.append([round(zone_start, 2), round(zone_end, 2)])
                zone_start = None
    if zone_start is not None:
        fast_zones.append([round(zone_start, 2), round(zone_end, 2)])

    palette = dominant_palette(frames_bgr)
    cut_density = round(len(scenes) / duration, 3) if duration else 0.0
    black_bg_ratio = round(dark_count / max(1, len(scenes)), 3)
    text_card_density = round(text_card_count / max(1, len(scenes)), 3)

    timeline = {
        "schemaVersion": "visual-evidence-timeline-v1",
        "sourceAssetId": args.source_asset_id or None,
        "durationSec": round(duration, 3),
        "hasAudio": bool(meta["hasAudio"]),
        "shots": shots,
        "sceneCuts": scene_cuts,
        "beatGrid": {
            "status": grid.get("status", "unavailable"),
            "bpm": grid.get("bpm"),
            "beats": beats,
            "onsets": grid.get("onsets", []),
            "source": grid.get("source", "librosa"),
        },
        "evidenceFrames": evidence_frames,
        "contactSheetPath": None,
        "stats": {
            "blackBgRatio": black_bg_ratio,
            "dominantPalette": palette,
            "textCardDensity": text_card_density,
            "cutDensity": cut_density,
            "avgShotDurationSec": round(avg_shot, 3),
            "medianShotDurationSec": round(med_shot, 3),
            "fastZones": fast_zones,
        },
        "ocrStatus": ocr_status,
        "asrStatus": asr_status,
        "analyzerMode": "evidence_timeline_v1",
        "warnings": warnings,
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(timeline, fh, ensure_ascii=False)
    print(json.dumps({"ok": True, "out": args.out, "shots": len(shots), "beats": len(beats),
                      "bpm": grid.get("bpm"), "detector": detector, "blackBgRatio": black_bg_ratio}))


if __name__ == "__main__":
    main()
