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


# A normalized frame-to-frame diff above this looks like a hard cut (tuned on editing.mov).
CUT_LIKE_THRESHOLD = 0.10


def _red_yellow_ratio(img_bgr):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    hue = hsv[:, :, 0].astype(np.float32)
    s = hsv[:, :, 1].astype(np.float32)
    v = hsv[:, :, 2].astype(np.float32)
    red = (((hue < 15) | (hue > 165)) & (s > 90) & (v > 90))
    yellow = ((hue >= 18) & (hue <= 38) & (s > 90) & (v > 120))
    return float((red | yellow).mean())


def _dark_ratio(img_bgr):
    v = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32)
    return float((v < 60).mean())


def sample_frame_metrics(video, n=60, width=240):
    """Sample n evenly-spaced frames; emit per-frame {timeSec, blackBgRatio, redYellowRatio,
    motionDiffMean(absdiff vs prev /255), cutLikeCount(0/1)} + Farneback flow magnitude per
    consecutive pair (for per-shot motionEnergy + moving-object candidates). This is the single
    source of truth the render-quality gate reuses on the rendered MP4."""
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        return {"frameMetrics": [], "aggregate": {"sampledFrames": 0}, "flow": []}
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 1:
        cap.release()
        return {"frameMetrics": [], "aggregate": {"sampledFrames": 0}, "flow": []}
    idxs = [int(round(j * (total - 1) / max(1, n - 1))) for j in range(n)]
    prev_gray = None
    frame_metrics = []
    flow_samples = []
    diffs = []
    cut_like = 0
    for fi in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        h0, w0 = frame.shape[:2]
        if not w0 or not h0:
            continue
        small = cv2.resize(frame, (width, max(2, int(round(h0 * (width / float(w0)))))), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        t = round(fi / fps, 3)
        dark = _dark_ratio(small)
        ry = _red_yellow_ratio(small)
        diff = 0.0
        flow_mag = 0.0
        region = None
        is_cut = 0
        if prev_gray is not None and prev_gray.shape == gray.shape:
            diff = float(cv2.absdiff(gray, prev_gray).mean()) / 255.0
            diffs.append(diff)
            if diff > CUT_LIKE_THRESHOLD:
                cut_like += 1
                is_cut = 1
            try:
                flow = cv2.calcOpticalFlowFarneback(prev_gray, gray, None, 0.5, 2, 13, 3, 5, 1.1, 0)
                mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
                flow_mag = float(mag.mean())
                thr = float(mag.mean() + mag.std())
                ys, xs = np.where(mag > max(thr, 0.5))
                if xs.size > 5:
                    gh, gw = gray.shape
                    region = [round(float(xs.min()) / gw, 3), round(float(ys.min()) / gh, 3),
                              round(float(xs.max() - xs.min()) / gw, 3), round(float(ys.max() - ys.min()) / gh, 3)]
            except Exception:
                flow_mag = diff
        # contentStd: spatial stdev of grayscale luma (0..1). A blank/uniform frame (flat black, flat
        # white, or any solid color) is ~0; a frame with text/panels/shapes is higher EVEN IF dark — so
        # it detects empty frames without penalizing legitimately dark-but-populated motifs (e.g. a dark
        # UI pitch). The blank-section gate keys off this, not blackBgRatio (which over-flags dark designs).
        content_std = round(float(gray.std()) / 255.0, 4)
        frame_metrics.append({
            "timeSec": t, "blackBgRatio": round(dark, 4), "redYellowRatio": round(ry, 4),
            "motionDiffMean": round(diff, 4), "cutLikeCount": is_cut, "contentStd": content_std,
        })
        flow_samples.append({"timeSec": t, "flowMag": flow_mag, "region": region})
        prev_gray = gray
    cap.release()
    agg = {
        "blackBgRatio": round(float(np.mean([f["blackBgRatio"] for f in frame_metrics])), 4) if frame_metrics else 0.0,
        "redYellowRatio": round(float(np.mean([f["redYellowRatio"] for f in frame_metrics])), 4) if frame_metrics else 0.0,
        "motionDiffMean": round(float(np.mean(diffs)), 4) if diffs else 0.0,
        "cutLikeCount": int(cut_like),
        "sampledFrames": len(frame_metrics),
    }
    return {"frameMetrics": frame_metrics, "aggregate": agg, "flow": flow_samples}


def audio_metrics(video):
    """Spectral richness of the rendered/sample audio (librosa) — so the gate can require a real
    layered soundtrack instead of a bare click. Returns means of centroid/flatness + chroma variance."""
    tmp_wav = None
    try:
        import librosa
        fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        proc = subprocess.run([FFMPEG, "-y", "-i", video, "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", tmp_wav], capture_output=True, text=True)
        if proc.returncode != 0 or not os.path.exists(tmp_wav) or os.path.getsize(tmp_wav) < 1000:
            return {"hasAudio": False}
        y, sr = librosa.load(tmp_wav, sr=22050, mono=True)
        if y.size < sr // 2:
            return {"hasAudio": False}
        sc = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
        sf = float(np.mean(librosa.feature.spectral_flatness(y=y)))
        cv = float(np.mean(np.var(librosa.feature.chroma_stft(y=y, sr=sr), axis=1)))
        os_mean = float(np.mean(librosa.onset.onset_strength(y=y, sr=sr)))
        return {"hasAudio": True, "spectralCentroidMean": round(sc, 1), "spectralFlatnessMean": round(sf, 5),
                "chromaVarMean": round(cv, 5), "onsetStrengthMean": round(os_mean, 4)}
    except Exception as exc:
        return {"hasAudio": False, "error": repr(exc)}
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.remove(tmp_wav)


def _resample_track(points, n=6):
    if not points:
        return []
    if len(points) <= n:
        return points
    step = (len(points) - 1) / (n - 1)
    return [points[int(round(i * step))] for i in range(n)]


def heavy_vision_available():
    """Heavy element trackers (Grounded-SAM2 / SAM2 / RAFT / CoTracker) are opt-in + off in CI.
    Returns the configured tracker name only when ENABLE_HEAVY_VISION_ANALYZER=true AND it imports."""
    if os.environ.get("ENABLE_HEAVY_VISION_ANALYZER", "").lower() not in ("1", "true", "yes"):
        return None
    tracker = os.environ.get("ELEMENT_TRACKER", "grounded_sam2")
    try:
        if tracker in ("grounded_sam2", "sam2"):
            import sam2  # noqa: F401
            return tracker
    except Exception:
        return None
    return None


def audio_structure(video, beat_grid):
    """Audio structure evidence beyond beat ticks: spectral richness + a coarse layer estimate
    (bass/kick, music/harmonic, hats/air) from band energy. Demucs/Essentia stem separation is an
    opt-in heavy adapter (off by default); this is the offline rule-based version."""
    am = audio_metrics(video)
    out = {**am, "bpm": beat_grid.get("bpm"), "beatGrid": (beat_grid.get("beats") or [])[:64],
           "strongBeats": (beat_grid.get("onsets") or [])[:32]}
    if not am.get("hasAudio"):
        return out
    tmp_wav = None
    try:
        import librosa
        fd, tmp_wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        proc = subprocess.run([FFMPEG, "-y", "-i", video, "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", tmp_wav], capture_output=True, text=True)
        if proc.returncode == 0 and os.path.exists(tmp_wav) and os.path.getsize(tmp_wav) > 1000:
            y, sr = librosa.load(tmp_wav, sr=22050, mono=True)
            S = np.abs(librosa.stft(y, n_fft=2048))
            freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
            def band(lo, hi):
                m = (freqs >= lo) & (freqs < hi)
                return float(np.mean(S[m, :])) if m.any() else 0.0
            low, mid, high = band(20, 160), band(160, 4000), band(4000, 11000)
            total = low + mid + high + 1e-9
            out["estimatedLayers"] = {
                "bass_kick": round(low / total, 3),
                "music_harmonic": round(mid / total, 3),
                "hats_air": round(high / total, 3),
                "drumDensityHint": "high" if (am.get("onsetStrengthMean", 0) > 1.5) else "medium",
            }
    except Exception as exc:
        out["layerError"] = repr(exc)
    finally:
        if tmp_wav and os.path.exists(tmp_wav):
            os.remove(tmp_wav)
    return out


def build_element_graph(shots, scenes, beats, onsets, flow_samples, hero_descriptor, typography_evidence, duration, fps_sampled):
    """Element-level evidence: locate hero/text/background/impact/cta/watermark elements (CV + flow +
    OCR boxes) with bbox tracks, trajectories, area curves, motion + layout — so the renderer draws
    located elements instead of guessing. The VLM (separately) only *labels* these candidates."""
    elements = []
    counter = [0]

    def new_id(prefix):
        counter[0] += 1
        return f"{prefix}_{counter[0]:03d}"

    # hero_object — bbox track from optical-flow moving regions inside the hero shot window
    if hero_descriptor and hero_descriptor.get("timeRangeSec"):
        a, b = hero_descriptor["timeRangeSec"]
        raw = [{"t": round(s["timeSec"], 3), "bbox": s["region"]} for s in flow_samples if s.get("region") and (a - 0.6) <= s["timeSec"] <= (b + 0.6)]
        if not raw:
            raw = [{"t": round(a, 3), "bbox": [0.3, 0.16, 0.4, 0.32]}]
        centers = [[round(t["bbox"][0] + t["bbox"][2] / 2, 3), round(t["bbox"][1] + t["bbox"][3] / 2, 3)] for t in raw]
        areas = [round(t["bbox"][2] * t["bbox"][3], 4) for t in raw]
        cy = sum(c[1] for c in centers) / len(centers)
        pos = "upper_center" if cy < 0.42 else "center" if cy < 0.62 else "lower_third"
        elements.append({
            "id": "hero_001", "family": "hero_object", "timeRangeSec": [round(a, 3), round(b, 3)],
            "bboxTrackNorm": _resample_track(raw, 6), "centerTrajectory": centers[:8], "areaRatioCurve": areas[:8],
            "motionPattern": hero_descriptor.get("motionPattern"), "sizeClass": "large" if (areas and max(areas) > 0.18) else "medium",
            "positionClass": pos, "orientationCurve": None,
            "appearance": {"dominantColors": hero_descriptor.get("palette", []), "glow": True, "silhouette": True, "objectDescriptor": hero_descriptor.get("objectDescriptor")},
            "evidence": {"frameIds": hero_descriptor.get("evidenceFrameIds", []), "detector": "optical_flow_region+heuristic", "confidence": hero_descriptor.get("confidence", 0.6)},
        })

    # background (global dark layer)
    elements.append({
        "id": "bg_001", "family": "background", "timeRangeSec": [0, round(duration, 3)], "positionClass": "full_screen", "sizeClass": "full_screen",
        "motionPattern": "slow_light_sweep", "appearance": {"dominantColors": ["black"], "glow": False, "silhouette": False, "objectDescriptor": "dark cinematic background with light streaks"},
        "evidence": {"frameIds": [], "detector": "global_stats", "confidence": 0.9},
    })

    # kinetic typography + watermark elements (from OCR bbox evidence)
    for ty in typography_evidence:
        bbox = ty["bboxNorm"]
        cx, cy = bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2
        is_wm = (cy > 0.85 or cx > 0.82) and bbox[3] < 0.06
        fam = "watermark" if is_wm else "kinetic_typography"
        elements.append({
            "id": new_id("wm" if is_wm else "text"), "family": fam, "timeRangeSec": [ty["timeSec"], round(ty["timeSec"] + 0.4, 3)],
            "bboxTrackNorm": [{"t": ty["timeSec"], "bbox": bbox}], "positionClass": ty["layoutRole"], "sizeClass": "large" if ty["fontSizeRatio"] > 0.1 else "small",
            "motionPattern": ty["animationHint"],
            "appearance": {"dominantColors": [ty["colorRole"]], "objectDescriptor": "kinetic caption" if fam == "kinetic_typography" else "creator watermark"},
            "text": {"rawText": ty.get("text"), "layoutRole": ty["layoutRole"], "fontSizeRatio": ty["fontSizeRatio"], "colorRoles": [ty["colorRole"]], "animationHint": ty["animationHint"]},
            "evidence": {"frameIds": [ty.get("shotId")], "detector": "easyocr_bbox", "confidence": ty.get("confidence", 0.5)},
        })

    # impact_fx (strong beats / onsets)
    for ot in (onsets or [])[:6]:
        elements.append({"id": new_id("impact"), "family": "impact_fx", "timeRangeSec": [round(ot, 3), round(ot + 0.15, 3)], "positionClass": "center", "sizeClass": "full_screen",
                         "motionPattern": "flash", "appearance": {"dominantColors": ["red", "white"]}, "evidence": {"frameIds": [], "detector": "librosa_onset", "confidence": 0.6}})

    # cta (end region)
    elements.append({"id": "cta_001", "family": "cta", "timeRangeSec": [round(max(0.0, duration - 12), 3), round(duration, 3)], "positionClass": "center", "sizeClass": "medium",
                     "motionPattern": "hold_pulse", "appearance": {"dominantColors": ["red", "yellow", "white"], "objectDescriptor": "motivation CTA end slate"}, "evidence": {"frameIds": [], "detector": "role_region", "confidence": 0.6}})

    def role_for(i, n):
        r = i / max(1, n - 1)
        return "hook" if r < 0.16 else "setup" if r < 0.36 else "body" if r < 0.55 else "proof" if r < 0.74 else "transition" if r < 0.86 else "cta"

    shot_nodes = []
    for i, (s, e) in enumerate(scenes):
        mid = (s + e) / 2.0
        dom = [el["id"] for el in elements if el["timeRangeSec"][0] <= mid <= el["timeRangeSec"][1]][:4]
        fs = [x["flowMag"] for x in flow_samples if s <= x["timeSec"] < e]
        me = float(np.mean(fs)) if fs else 0.0
        beat_aligned = any(abs(b - s) < 0.12 for b in beats) if beats else False
        nearest = min([abs(b - s) for b in beats], default=1.0) if beats else 1.0
        text_here = any(el["family"] == "kinetic_typography" and el["timeRangeSec"][0] <= mid <= el["timeRangeSec"][1] for el in elements)
        shot_nodes.append({
            "shotId": f"shot_{i:03d}", "startSec": round(s, 3), "endSec": round(e, 3), "role": role_for(i, len(scenes)),
            "cutTypeIn": "hard_cut" if i > 0 else "open", "cutTypeOut": "hard_cut" if i < len(scenes) - 1 else "end",
            "dominantElements": dom, "motionClass": "high_motion" if me > 1.2 else "medium_motion" if me > 0.5 else "low_motion",
            "cameraMotion": "dynamic" if me > 1.5 else "slight", "textDensity": "high" if text_here else "low",
            "beatSync": {"cutOnBeat": bool(beat_aligned), "nearestBeatDeltaMs": int(round(nearest * 1000))}, "rendererRole": role_for(i, len(scenes)),
        })

    return {
        "schemaVersion": "visual-element-graph-v1", "fpsSampled": round(fps_sampled, 2), "elementCount": len(elements),
        "heavyTracker": heavy_vision_available() or "none (optical-flow + ocr rule-based)",
        "elements": elements, "shots": shot_nodes,
        "globalStyle": {"palette": ["black", "red", "yellow", "white", "blue"], "background": "dark_cinematic", "typography": "bold_center_cjk_red_yellow_white", "motion": "beat_synced_hard_cut"},
    }


def segment_metrics(video, segments, per=16, width=240):
    """Per-segment motionDiffMean + cutLikeCount over a list of [startSec, endSec] ranges — so the
    gate can require per-clip motion (a static early clip can't hide behind the global average)."""
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        return []
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    out = []
    for seg in segments:
        a, b = float(seg[0]), float(seg[1])
        fa = max(0, int(a * fps))
        fb = min(total - 1, int(b * fps))
        if fb <= fa:
            out.append({"startSec": round(a, 3), "endSec": round(b, 3), "motionDiffMean": 0.0, "cutLikeCount": 0, "sampledFrames": 0})
            continue
        idxs = [int(fa + j * (fb - fa) / max(1, per - 1)) for j in range(per)]
        prev = None
        diffs = []
        cut = 0
        for fi in idxs:
            cap.set(cv2.CAP_PROP_POS_FRAMES, fi)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            w0 = frame.shape[1] or 1
            small = cv2.resize(frame, (width, max(2, int(round(frame.shape[0] * (width / float(w0)))))), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            if prev is not None and prev.shape == gray.shape:
                d = float(cv2.absdiff(gray, prev).mean()) / 255.0
                diffs.append(d)
                if d > CUT_LIKE_THRESHOLD:
                    cut += 1
            prev = gray
        out.append({"startSec": round(a, 3), "endSec": round(b, 3),
                    "motionDiffMean": round(float(np.mean(diffs)), 4) if diffs else 0.0,
                    "cutLikeCount": int(cut), "sampledFrames": len(diffs) + 1 if diffs else 0})
    cap.release()
    return out


def shot_motion_energy(start, end, flow_samples):
    vals = [s["flowMag"] for s in flow_samples if start <= s["timeSec"] < end]
    if not vals and flow_samples:
        nearest = min(flow_samples, key=lambda s: abs(s["timeSec"] - (start + end) / 2.0))
        vals = [nearest["flowMag"]]
    return round(float(np.mean(vals)), 4) if vals else 0.0


def moving_object_candidates(flow_samples):
    """Contiguous high-flow sample runs -> moving-region candidates with a representative bbox."""
    mags = [s["flowMag"] for s in flow_samples]
    if not mags:
        return []
    mean_mag = float(np.mean(mags))
    thr = max(mean_mag * 1.2, 0.4)
    out = []
    cur = None
    for s in flow_samples:
        if s["flowMag"] >= thr:
            if cur is None:
                cur = {"startSec": s["timeSec"], "endSec": s["timeSec"], "mags": [s["flowMag"]], "region": s.get("region")}
            else:
                cur["endSec"] = s["timeSec"]
                cur["mags"].append(s["flowMag"])
                if cur.get("region") is None and s.get("region"):
                    cur["region"] = s.get("region")
        elif cur is not None:
            out.append(cur)
            cur = None
    if cur is not None:
        out.append(cur)
    cands = []
    for c in out:
        me = float(np.mean(c["mags"]))
        cands.append({
            "startSec": round(c["startSec"], 3), "endSec": round(c["endSec"], 3),
            "confidence": round(min(1.0, (me / (mean_mag + 1e-6)) * 0.5), 3) if mean_mag else 0.5,
            "region": c.get("region"), "motionEnergy": round(me, 4),
        })
    return cands


def family_scores(feat, motion_energy, motion_hi, index, shot_count):
    """Multi-family confidence scores (0..1) for the 6 v2 visual families. A shot can score in
    several families; the argmax stays `family` for back-compat, the array is `evidenceFamilies`."""
    scores = {}
    is_dark = feat["darkRatio"] > 0.4 or feat["meanV"] < 80
    high_text = feat["textScore"] > 0.06 and feat["edgeDensity"] > 0.05
    photographic = feat["meanS"] > 60 and feat["edgeDensity"] > 0.08 and not high_text
    motion = motion_energy or 0.0
    if index == 0 or (is_dark and feat["centerV"] > feat["meanV"] * 1.05 and not high_text):
        scores["object_motion"] = round(min(1.0, 0.55 + motion), 3)
    if high_text and is_dark:
        scores["kinetic_typography"] = round(min(1.0, 0.6 + feat["redRatio"] + feat["yellowRatio"]), 3)
    if high_text and 0 < index < shot_count - 1:
        scores["storyboard"] = round(min(1.0, 0.5 + feat["textScore"]), 3)
    if is_dark and feat["edgeDensity"] < 0.08 and not high_text:
        scores["background"] = round(min(1.0, 0.6 + (0.08 - min(0.08, feat["edgeDensity"])) * 3), 3)
    if motion_hi or photographic:
        scores["live_action_montage"] = round(min(1.0, 0.5 + motion * 0.3 + (0.2 if photographic else 0.0)), 3)
    if index >= shot_count - 1:
        scores["brand_cta"] = 0.7
    return scores


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
        boxes = {}
        for p in frame_paths:
            try:
                detailed = reader.readtext(p, detail=1, paragraph=False)
                results[p] = [t for (_b, t, _c) in detailed if t and str(t).strip()]
                boxes[p] = [
                    {"text": t, "bbox": [[float(x), float(y)] for (x, y) in b], "conf": float(c)}
                    for (b, t, c) in detailed if t and str(t).strip()
                ]
            except Exception:
                results[p] = []
                boxes[p] = []
        return {"status": "ok", "byFrame": results, "boxes": boxes}
    except Exception as exc:
        return {"status": "unavailable", "byFrame": {}, "boxes": {}, "error": repr(exc)}


def _color_role(img, bbox):
    """Dominant text colour inside a bbox: red / yellow / white (drives RedYellowKeywordEmphasis)."""
    xs = [p[0] for p in bbox]
    ys = [p[1] for p in bbox]
    x0, y0, x1, y1 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
    roi = img[max(0, y0):max(1, y1), max(0, x0):max(1, x1)]
    if roi.size == 0:
        return "white"
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    h = hsv[:, :, 0].astype(np.float32)
    s = hsv[:, :, 1].astype(np.float32)
    v = hsv[:, :, 2].astype(np.float32)
    red = float((((h < 15) | (h > 165)) & (s > 80) & (v > 80)).mean())
    yellow = float(((h >= 18) & (h <= 40) & (s > 80) & (v > 110)).mean())
    white = float(((s < 55) & (v > 165)).mean())
    if red > 0.05 and red >= yellow:
        return "red"
    if yellow > 0.05:
        return "yellow"
    if white > 0.08:
        return "white"
    return "white"


def _layout_role(cx, cy, w):
    """Approximate the on-screen role of a text box from its normalized centre + width."""
    if cy >= 0.66:
        return "lower_third"
    if cy <= 0.30 and cx <= 0.4:
        return "top_left_tag"
    if cy <= 0.30:
        return "top_tag"
    if w < 0.42 and (cx < 0.34 or cx > 0.66):
        return "keyword_scatter"
    if w >= 0.5 and 0.35 <= cy <= 0.65:
        return "center_title"
    return "center_title"


def build_typography_evidence(ocr_boxes, frames_dir, scenes, beats, max_items=24):
    """Turn OCR boxes into TypographyEvidenceV2: per-box bboxNorm + layoutRole + colorRole +
    fontSizeRatio + animationHint + beatAligned, so the renderer can vary text layout/animation
    like the sample (instead of always centering text)."""
    items = []
    for i, (start, end) in enumerate(scenes):
        p = os.path.join(frames_dir, f"frame_{i:03d}.png")
        boxes = ocr_boxes.get(p, [])
        if not boxes:
            continue
        img = cv2.imread(p)
        if img is None:
            continue
        ih, iw = img.shape[:2]
        mid = round((start + end) / 2.0, 3)
        beat_aligned = any(abs(b - start) < 0.2 for b in beats) if beats else False
        for box in boxes:
            xs = [pt[0] for pt in box["bbox"]]
            ys = [pt[1] for pt in box["bbox"]]
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            w = (x1 - x0) / max(1.0, iw)
            h = (y1 - y0) / max(1.0, ih)
            cx = (x0 + (x1 - x0) / 2) / max(1.0, iw)
            cy = (y0 + (y1 - y0) / 2) / max(1.0, ih)
            role = _layout_role(cx, cy, w)
            color = _color_role(img, box["bbox"])
            big = h >= 0.10
            anim = ("flash" if beat_aligned and role == "center_title" else
                    "shake" if role == "keyword_scatter" else
                    "per_char_reveal" if big and role == "center_title" else
                    "pop" if role.endswith("tag") else "scale")
            items.append({
                "textLayerId": f"txt_{len(items):03d}",
                "timeSec": mid,
                "shotId": f"shot_{i:03d}",
                "text": str(box["text"]).strip()[:40],
                "bboxNorm": [round(x0 / iw, 3), round(y0 / ih, 3), round(w, 3), round(h, 3)],
                "layoutRole": role,
                "colorRole": color,
                "fontSizeRatio": round(h, 3),
                "animationHint": anim,
                "beatAligned": bool(beat_aligned),
                "confidence": round(float(box.get("conf", 0.0)), 3),
            })
            if len(items) >= max_items:
                return items
    return items


def build_hero_descriptor(shots, frames_dir, scenes):
    """Describe the opening moving hero object so the renderer can draw a head/mask-like silhouette
    (not just boxes). Heuristic-only (no external model): a dark, centred, glowing object_motion
    shot in the first ~15s reads as a head/helmet/mask motif."""
    hook_shots = [s for s in shots if s.get("startSec", 0) < 16 and (s.get("family") == "object_motion" or any(f.get("family") == "object_motion" for f in s.get("evidenceFamilies", [])))]
    if not hook_shots:
        hook_shots = [s for s in shots[:3]]
    if not hook_shots:
        return None
    hero = max(hook_shots, key=lambda s: s.get("motionEnergy", 0.0))
    idx = int(hero["shotId"].split("_")[-1]) if "shotId" in hero else 0
    img = cv2.imread(os.path.join(frames_dir, f"frame_{idx:03d}.png"))
    palette = ["black"]
    has_center_hero = "center_hero_object" in (hero.get("visualTags") or [])
    obj_type = "unknown"
    if img is not None:
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h = hsv[:, :, 0].astype(np.float32)
        s = hsv[:, :, 1].astype(np.float32)
        v = hsv[:, :, 2].astype(np.float32)
        red = float((((h < 15) | (h > 165)) & (s > 70) & (v > 70)).mean())
        blue = float(((h >= 95) & (h <= 130) & (s > 60) & (v > 60)).mean())
        purple = float(((h >= 130) & (h <= 160) & (s > 50) & (v > 50)).mean())
        dark = float((v < 70).mean())
        if dark > 0.45:
            palette = ["black"]
        if red > 0.01:
            palette.append("red")
        if blue > 0.01:
            palette.append("blue")
        if purple > 0.01:
            palette.append("purple")
        # A dark frame with a central bright/glowing object + red/blue neon reads as a head/mask.
        if dark > 0.4 and (has_center_hero or (red + blue + purple) > 0.02):
            obj_type = "head_like_mask"
    return {
        "objectType": obj_type,
        "objectDescriptor": "dark rotating neon head/helmet/mask hero object with red/blue rim glow on a black cinematic background" if obj_type == "head_like_mask" else "rotating hero object on dark background",
        "dominantPosition": "center",
        "palette": list(dict.fromkeys(palette)),
        "motionPattern": "slow_rotate+light_sweep" if hero.get("motionEnergy", 0) < 3 else "orbit+light_sweep",
        "motionEnergy": hero.get("motionEnergy", 0.0),
        "timeRangeSec": [hero.get("startSec", 0.0), hero.get("endSec", 0.0)],
        "evidenceFrameIds": hero.get("keyframeIds", []),
        "confidence": round(0.6 + min(0.3, hero.get("motionEnergy", 0.0) / 10.0), 3),
    }


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
    ap.add_argument("--out", default="")
    ap.add_argument("--frames-dir", default="")
    ap.add_argument("--frames-url-prefix", default="")
    ap.add_argument("--source-asset-id", default="")
    ap.add_argument("--source-asset-filename", default="")
    ap.add_argument("--ocr", action="store_true")
    ap.add_argument("--asr", action="store_true")
    ap.add_argument("--asr-model", default="tiny")
    ap.add_argument("--max-shots", type=int, default=48)
    ap.add_argument("--metrics-only", action="store_true",
                    help="print only ffprobe metadata + 60-frame metrics for an arbitrary mp4 (used by the render-quality gate)")
    ap.add_argument("--frame-samples", type=int, default=60)
    ap.add_argument("--segments", default="", help="comma list of start:end ranges for per-segment metrics, e.g. 0:2.4,2.4:5.4")
    ap.add_argument("--audio-metrics", action="store_true", help="also compute audio spectral richness (librosa) in --metrics-only mode")
    args = ap.parse_args()

    if not os.path.exists(args.video):
        print(json.dumps({"error": f"video not found: {args.video}"}))
        sys.exit(2)

    # Lightweight mode for the render gate: ffprobe + the same 60-frame metric pass, no
    # scenedetect/librosa/keyframes. Keeps the sample and the render measured identically.
    if args.metrics_only:
        meta_only = ffprobe_metadata(args.video)
        fm = sample_frame_metrics(args.video, n=args.frame_samples)
        out_obj = {
            "ok": True,
            "metadata": {
                "durationSec": round(meta_only["durationSec"] or 0.0, 3),
                "width": meta_only["width"], "height": meta_only["height"],
                "hasAudio": bool(meta_only["hasAudio"]), "hasVideo": meta_only["width"] is not None,
                **fm["aggregate"],
            },
            "frameMetrics": fm["frameMetrics"],
        }
        if args.segments:
            segs = []
            for part in args.segments.split(","):
                if ":" in part:
                    a, b = part.split(":", 1)
                    try:
                        segs.append([float(a), float(b)])
                    except ValueError:
                        pass
            out_obj["segments"] = segment_metrics(args.video, segs)
        if args.audio_metrics:
            out_obj["audio"] = audio_metrics(args.video)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as fh:
                json.dump(out_obj, fh, ensure_ascii=False)
        print(json.dumps(out_obj))
        return

    if not args.frames_dir or not args.out:
        print(json.dumps({"error": "--frames-dir and --out are required unless --metrics-only"}))
        sys.exit(2)
    os.makedirs(args.frames_dir, exist_ok=True)

    meta = ffprobe_metadata(args.video)
    duration = meta["durationSec"] or 0.0
    warnings = []

    # Motion-aware pass (v2): 60-frame metrics + Farneback flow for per-shot motionEnergy + moving candidates.
    metrics = sample_frame_metrics(args.video, n=args.frame_samples)
    flow_samples = metrics["flow"]
    flow_mags = [s["flowMag"] for s in flow_samples]
    motion_median = float(np.median(flow_mags)) if flow_mags else 0.0

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
        # v2: per-shot motion energy (optical flow) + multi-family scores.
        m_energy = shot_motion_energy(start, end, flow_samples)
        motion_hi = bool(m_energy > max(motion_median * 1.25, 0.35))
        fam_scores = family_scores(feat, m_energy, motion_hi, i, len(scenes)) if feat else {}
        ev_families = [{"family": k, "confidence": v} for k, v in sorted(fam_scores.items(), key=lambda kv: -kv[1])]
        if motion_hi and "action_candidate" not in vtags:
            vtags = vtags + ["action_candidate"]
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
            "motionEnergy": m_energy,
            "evidenceFamilies": ev_families,
            "confidence": round(min(1.0, 0.55 + (feat["edgeDensity"] if feat else 0.0)), 3),
            "evidencePaths": [public_path],
        })

    # OCR / ASR (optional; API path can also bind its own adapters' output)
    ocr_status = "skipped"
    ocr_boxes_global = None
    if args.ocr:
        ocr = run_ocr([os.path.join(args.frames_dir, f"frame_{i:03d}.png") for i in range(len(scenes))])
        ocr_status = "ok" if ocr["status"] == "ok" else "unavailable"
        if ocr["status"] == "ok":
            by = ocr["byFrame"]
            ocr_boxes_global = ocr.get("boxes", {})
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
    agg = metrics["aggregate"]

    # v2: moving-object candidates (optical flow) + a rolled-up 6-family summary.
    moving_candidates = moving_object_candidates(flow_samples)
    fam_summary = {}
    for shot in shots:
        for ef in shot.get("evidenceFamilies", []):
            fam_summary[ef["family"]] = max(fam_summary.get(ef["family"], 0.0), ef["confidence"])
    if grid.get("status") == "ok" and len(beats) >= 8:
        fam_summary["bgm"] = round(min(1.0, 0.6 + len(beats) / 400.0), 3)
    evidence_families = [{"family": k, "confidence": v} for k, v in sorted(fam_summary.items(), key=lambda kv: -kv[1])]

    # v3: hero-object descriptor (head/mask) + typography layout evidence. Typography needs OCR
    # boxes; if --ocr was not requested, run a light OCR pass on the most text-heavy frames only
    # (fast) so the renderer can still vary text layout. Both are best-effort.
    hero_descriptor = build_hero_descriptor(shots, args.frames_dir, scenes)
    typography_evidence = []
    if ocr_boxes_global:
        typography_evidence = build_typography_evidence(ocr_boxes_global, args.frames_dir, scenes, beats)
    else:
        text_idx = sorted(range(len(shots)), key=lambda i: -(("text_card" in (shots[i].get("visualTags") or [])) * 1.0 + len(shots[i].get("ocrText") or []) * 0.1))[:10]
        light = run_ocr([os.path.join(args.frames_dir, f"frame_{i:03d}.png") for i in text_idx])
        if light.get("status") == "ok":
            typography_evidence = build_typography_evidence(light.get("boxes", {}), args.frames_dir, scenes, beats)

    # v3 element graph: locate hero/text/background/impact/cta/watermark elements (CV+flow+OCR) with
    # bbox tracks + motion + layout, plus shot nodes. Audio structure beyond beat ticks.
    fps_sampled = (len(metrics["frameMetrics"]) / duration) if duration else 0.0
    element_graph = build_element_graph(shots, scenes, beats, grid.get("onsets", []), flow_samples, hero_descriptor, typography_evidence, duration, fps_sampled)
    audio_struct = audio_structure(args.video, grid)

    # v2: deterministic videoType + style fingerprint (survives LLM failure).
    is_beat_cut = (cut_density > 0.18 or med_shot < 2.6) and black_bg_ratio > 0.4 and grid.get("status") == "ok" and len(beats) >= 20
    detected_style = {
        "videoType": "beat_cut" if is_beat_cut else "unknown",
        "bpm": grid.get("bpm"),
        "blackBgRatioApprox": agg.get("blackBgRatio", black_bg_ratio),
        "mustTransfer": ["shot rhythm", "BGM beat grid", "kinetic typography", "moving hero object",
                         "background layer style", "live-action montage layout", "CTA card pattern"],
        "mustNotCopy": ["sample frames", "sample audio", "creator watermark", "person likeness"],
    }

    timeline = {
        "schemaVersion": "visual-evidence-timeline-v2",
        "sourceAssetId": args.source_asset_id or None,
        "sourceAssetFilename": args.source_asset_filename or None,
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
        "frameMetrics": metrics["frameMetrics"],
        "movingObjectCandidates": moving_candidates,
        "evidenceFamilies": evidence_families,
        "detectedStyle": detected_style,
        "heroDescriptor": hero_descriptor,
        "typographyEvidence": typography_evidence,
        "visualElementGraph": element_graph,
        "audioStructure": audio_struct,
        "contactSheetPath": None,
        "stats": {
            "blackBgRatio": black_bg_ratio,
            "dominantPalette": palette,
            "textCardDensity": text_card_density,
            "cutDensity": cut_density,
            "avgShotDurationSec": round(avg_shot, 3),
            "medianShotDurationSec": round(med_shot, 3),
            "fastZones": fast_zones,
            "redYellowRatio": agg.get("redYellowRatio", 0.0),
            "motionDiffMean": agg.get("motionDiffMean", 0.0),
            "cutLikeCount": agg.get("cutLikeCount", 0),
            "sampledFrames": agg.get("sampledFrames", 0),
        },
        "ocrStatus": ocr_status,
        "asrStatus": asr_status,
        "analyzerMode": "evidence_timeline_v2",
        "warnings": warnings,
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(timeline, fh, ensure_ascii=False)
    print(json.dumps({"ok": True, "out": args.out, "shots": len(shots), "beats": len(beats),
                      "bpm": grid.get("bpm"), "detector": detector, "blackBgRatio": black_bg_ratio,
                      "motionDiffMean": agg.get("motionDiffMean", 0.0), "cutLikeCount": agg.get("cutLikeCount", 0),
                      "redYellowRatio": agg.get("redYellowRatio", 0.0),
                      "families": [f["family"] for f in evidence_families]}))


if __name__ == "__main__":
    main()
