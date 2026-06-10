#!/usr/bin/env python3
"""Local segment-level highlight detection for a (long) user video. No paid API.

Scene-cuts via PySceneDetect (fallback: sliding windows), then per-candidate motion / sharpness / brightness
scoring -> top highlight windows with a recommended structure slot. Output: JSON array on stdout.
"""
import sys, json, argparse


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--max-sec", type=float, default=7.0)
    ap.add_argument("--min-sec", type=float, default=2.0)
    args = ap.parse_args()
    try:
        import cv2
        import numpy as np
    except Exception:
        print("[]"); return

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print("[]"); return
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    dur = (total / fps) if fps else 0.0
    if dur <= 0:
        cap.release(); print("[]"); return

    # 1) candidate windows from scene cuts (else uniform sliding windows).
    windows = []
    try:
        from scenedetect import detect, ContentDetector
        scenes = detect(args.video, ContentDetector())
        for s in scenes:
            a, b = s[0].get_seconds(), s[1].get_seconds()
            if b - a >= args.min_sec:
                windows.append((a, min(b, a + args.max_sec)))
    except Exception:
        windows = []
    if not windows:
        t = 0.0
        while t < dur - args.min_sec:
            windows.append((round(t, 2), round(min(t + args.max_sec, dur), 2)))
            t += args.max_sec

    # 2) score each window: sample frames -> motion (frame diff), sharpness (Laplacian var), brightness (luma).
    scored = []
    for (a, b) in windows:
        n = 6
        prev = None
        motion, sharp, bright = [], [], []
        for k in range(n):
            t = a + (b - a) * (k / (n - 1) if n > 1 else 0)
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            bright.append(float(g.mean()))
            sharp.append(float(cv2.Laplacian(g, cv2.CV_64F).var()))
            if prev is not None:
                motion.append(float(np.abs(g.astype(np.int16) - prev.astype(np.int16)).mean()))
            prev = g
        if not bright:
            continue
        mo = float(np.mean(motion)) if motion else 0.0
        sh = float(np.mean(sharp))
        br = float(np.mean(bright))
        # composite: reward motion + sharpness, penalise too-dark/too-bright (|luma-128|).
        score = min(100.0, mo * 1.5 + min(sh / 20.0, 40.0) + max(0.0, (1 - abs(br - 128) / 128)) * 30.0)
        scored.append({"start_sec": round(a, 2), "end_sec": round(b, 2), "motion": round(mo, 1), "sharpness": round(sh, 1), "brightness": round(br, 1), "score": round(score, 1)})
    cap.release()
    if not scored:
        print("[]"); return

    mean_motion = sum(s["motion"] for s in scored) / len(scored)
    scored.sort(key=lambda r: -r["score"])
    top = scored[: args.top]
    for r in top:
        mid = (r["start_sec"] + r["end_sec"]) / 2
        if mid < dur * 0.25:
            slot = "hook"
        elif mid > dur * 0.70:
            slot = "cta"
        elif r["motion"] >= mean_motion:
            slot = "process"
        else:
            slot = "proof"
        r["recommended_slot"] = slot
        r["reason"] = f"运动{r['motion']}/清晰{r['sharpness']}/亮度{r['brightness']}→综合{r['score']}，适合 {slot} 槽位"
    # keep chronological for readability of the top set
    top.sort(key=lambda r: r["start_sec"])
    print(json.dumps(top, ensure_ascii=False))


if __name__ == "__main__":
    main()
