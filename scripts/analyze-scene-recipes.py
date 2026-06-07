#!/usr/bin/env python3
# Content-neutral per-scene visual recipe extractor (V5.1 source-faithful reconstruction).
# Reads JSON on stdin: { storageRoot, keyFrames:[{timeSec, frameRef}], sections:[{id,role,startSec,endSec}],
#                        motion:{ peaks:[sec...], cutDensity:float } }
# Writes JSON to stdout: [ SceneVisualRecipeV5-shaped objects ].
# Captures ONLY structure (positions / motion labels / grading / palette) — never pixels or OCR text.
import json, os, sys
import numpy as np
try:
    import cv2
except Exception as e:
    print("[]"); sys.exit(0)

GRID_X = [("left", 0.0, 0.34), ("center", 0.34, 0.66), ("right", 0.66, 1.01)]
GRID_Y = [("top", 0.0, 0.34), ("center", 0.34, 0.66), ("bottom", 0.66, 1.01)]

def anchor(cx, cy):
    xs = next((n for n, a, b in GRID_X if a <= cx < b), "center")
    ys = next((n for n, a, b in GRID_Y if a <= cy < b), "center")
    if xs == "center" and ys == "center":
        return "center"
    return f"{ys}_{xs}"

def hexrgb(b, g, r):
    return "#%02X%02X%02X" % (int(r), int(g), int(b))

def palette(img, k=4):
    small = cv2.resize(img, (80, 142), interpolation=cv2.INTER_AREA).reshape(-1, 3).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 8, 1.0)
    _, labels, centers = cv2.kmeans(small, k, None, crit, 2, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k)
    order = np.argsort(-counts)
    return [hexrgb(*centers[i]) for i in order]

def grading(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[..., 0].astype(np.float32), hsv[..., 1].astype(np.float32), hsv[..., 2].astype(np.float32)
    brightness = float(V.mean() / 255.0)
    saturation = float(S.mean() / 255.0)
    contrast = float(V.std())
    dark = float((V < 50).mean())
    meanhue = float(np.median(H[S > 40])) if (S > 40).any() else float(np.median(H))
    if dark > 0.5:
        mood = "dark_moody"
    elif contrast > 78:
        mood = "high_contrast"
    elif brightness > 0.7 and saturation < 0.32:
        mood = "high_key"
    elif saturation > 0.55:
        mood = "vibrant"
    elif saturation < 0.16:
        mood = "desaturated"
    elif meanhue < 28 or meanhue > 160:
        mood = "warm"
    elif 80 < meanhue < 140:
        mood = "cool"
    else:
        mood = "neutral"
    return {"mood": mood, "brightness": round(brightness, 3), "saturation": round(saturation, 3), "palette": palette(img)}

def subject(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    mag = cv2.GaussianBlur(mag, (0, 0), 9)
    thr = mag.mean() + 0.8 * mag.std()
    mask = (mag > thr).astype(np.uint8)
    ys, xs = np.where(mask > 0)
    h, w = g.shape
    if len(xs) < 50:
        return {"anchor": "center", "areaRatio": 0.4, "cx": 0.5, "cy": 0.5, "conf": 0.3}
    cx, cy = float(xs.mean() / w), float(ys.mean() / h)
    bbox = (xs.max() - xs.min()) * (ys.max() - ys.min())
    area = min(0.95, float(bbox) / (w * h))
    conf = min(0.9, 0.3 + float(mask.mean()) * 2.0)
    return {"anchor": anchor(cx, cy), "areaRatio": round(area, 3), "cx": cx, "cy": cy, "conf": round(conf, 2)}

def text_anchor(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    try:
        mser = cv2.MSER_create()
        regions, _ = mser.detectRegions(g)
    except Exception:
        regions = []
    bands = {"top": 0, "center": 0, "bottom": 0}
    for r in regions:
        x, y, bw, bh = cv2.boundingRect(r.reshape(-1, 1, 2))
        if bh == 0:
            continue
        ar = bw / bh
        if 0.15 < ar < 8 and bh < h * 0.18 and bw > 3:  # text-like glyph blob
            cyr = (y + bh / 2) / h
            band = "top" if cyr < 0.34 else ("center" if cyr < 0.66 else "bottom")
            bands[band] += 1
    best = max(bands, key=bands.get)
    strong = bands[best] >= 6
    return (f"{best}_center" if best != "center" else "center"), strong

def camera_move(frames, motion_intensity):
    if len(frames) >= 2:
        a = cv2.cvtColor(cv2.resize(frames[0], (160, 284)), cv2.COLOR_BGR2GRAY).astype(np.float32)
        b = cv2.cvtColor(cv2.resize(frames[-1], (160, 284)), cv2.COLOR_BGR2GRAY).astype(np.float32)
        try:
            (dx, dy), resp = cv2.phaseCorrelate(a, b)
        except Exception:
            dx, dy = 0.0, 0.0
        ndx, ndy = dx / 160.0, dy / 284.0
        if abs(ndx) > 0.05 and abs(ndx) > abs(ndy):
            return "pan_right" if ndx > 0 else "pan_left"
        if abs(ndy) > 0.05:
            return "tilt_down" if ndy > 0 else "tilt_up"
    if motion_intensity > 0.55:
        return "push_in"
    if motion_intensity < 0.2:
        return "static"
    return "push_in"

def transition_in(idx, motion_intensity, cut_density):
    if idx == 0:
        return "fade_from_black"
    if motion_intensity > 0.6:
        return "whip_pan" if (idx % 2 == 0) else "zoom_in"
    if cut_density > 0.5:
        return "hard_cut"
    return ["dissolve", "slide_left", "slide_right", "dissolve"][idx % 4]

def text_anim(mood, motion_intensity):
    if motion_intensity > 0.6 or mood in ("vibrant", "high_contrast"):
        return "pop"
    if mood == "dark_moody":
        return "slide_up"
    return "word_stagger"

def load(storage_root, frame_ref):
    p = os.path.join(storage_root, str(frame_ref).lstrip("/"))
    if os.path.isfile(p):
        return cv2.imread(p)
    return None

def main():
    # config from a file path arg (preferred, for runPython) or stdin.
    if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
        cfg = json.load(open(sys.argv[1]))
    else:
        cfg = json.load(sys.stdin)
    root = cfg.get("storageRoot", "storage")
    kfs = cfg.get("keyFrames", [])
    sections = cfg.get("sections", [])
    motion = cfg.get("motion", {}) or {}
    peaks = motion.get("peaks", []) or []
    cd = motion.get("cutDensity", 0.3)
    cut_density = {"low": 0.2, "medium": 0.5, "high": 0.8}.get(cd, None) if isinstance(cd, str) else None
    if cut_density is None:
        try:
            cut_density = float(cd)
        except Exception:
            cut_density = 0.3
    out = []
    for idx, sec in enumerate(sections):
        s0, s1 = float(sec.get("startSec", 0)), float(sec.get("endSec", 0))
        in_sec = [k for k in kfs if s0 <= float(k.get("timeSec", -1)) < s1]
        if not in_sec and kfs:
            in_sec = [min(kfs, key=lambda k: abs(float(k.get("timeSec", 0)) - (s0 + s1) / 2))]
        frames = [f for f in (load(root, k.get("frameRef")) for k in in_sec) if f is not None]
        # motion intensity for this section = density of motion peaks inside the window
        dur = max(0.5, s1 - s0)
        npk = len([p for p in peaks if s0 <= float(p) < s1])
        motion_intensity = min(1.0, npk / dur) if peaks else (0.5 if frames else 0.3)
        try:
            if not frames:
                raise ValueError("no frame")
            prim = frames[0]
            gr = grading(prim)
            sub = subject(prim)
            tanchor, strong = text_anchor(prim)
            cam = camera_move(frames, motion_intensity)
            rec = {
                "sectionId": sec.get("id"),
                "role": sec.get("role", ""),
                "transitionIn": transition_in(idx, motion_intensity, cut_density),
                "subject": {"anchor": sub["anchor"], "areaRatio": sub["areaRatio"], "cameraMove": cam,
                            "motionIntensity": round(motion_intensity, 3)},
                "textAnchor": tanchor if strong else ("center" if sec.get("role") == "hook" else "bottom_center"),
                "textAnim": text_anim(gr["mood"], motion_intensity),
                "grading": gr,
                "source": "deterministic",
                "confidence": round(0.45 + 0.4 * sub["conf"], 2),
            }
        except Exception as e:
            rec = {
                "sectionId": sec.get("id"), "role": sec.get("role", ""),
                "transitionIn": transition_in(idx, motion_intensity, cut_density),
                "subject": {"anchor": "center", "areaRatio": 0.4, "cameraMove": "push_in", "motionIntensity": round(motion_intensity, 3)},
                "textAnchor": "center" if sec.get("role") == "hook" else "bottom_center",
                "textAnim": "word_stagger",
                "grading": {"mood": "neutral", "brightness": 0.5, "saturation": 0.4, "palette": ["#101216", "#FFFFFF", "#F7C948", "#1A1A1A"]},
                "source": "deterministic", "confidence": 0.3,
            }
        out.append(rec)
    print(json.dumps(out))

if __name__ == "__main__":
    main()
