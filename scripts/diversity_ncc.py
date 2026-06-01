#!/usr/bin/env python3
"""Cross-sample render diversity probe (Spec v1.3 anti-overfit gate).

Samples N frames from two rendered MP4s at matched relative timestamps and computes a
luminance-normalized cross-correlation (NCC) per frame pair, plus a color-histogram
correlation. High NCC across UNRELATED sample inputs = the sample-blind mold the
overfit investigation flagged. Emits JSON to stdout (and --out if given).

Usage: diversity_ncc.py A.mp4 B.mp4 [--frames 9] [--out path.json]
Requires: ffmpeg/ffprobe + numpy + PIL (conda env 'viral').
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


def duration(path: str) -> float:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    try:
        return float(json.loads(out.stdout)["format"]["duration"])
    except Exception:
        return 0.0


def frame_at(path: str, t: float, dst: str, w: int = 96, h: int = 170) -> bool:
    r = subprocess.run(
        [FFMPEG, "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1",
         "-vf", f"scale={w}:{h}", dst],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and Path(dst).exists()


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(np.float64).ravel()
    b = b.astype(np.float64).ravel()
    a -= a.mean()
    b -= b.mean()
    da = np.sqrt((a * a).sum())
    db = np.sqrt((b * b).sum())
    if da < 1e-6 or db < 1e-6:
        return 0.0
    return float((a * b).sum() / (da * db))


def hist_corr(a_rgb: np.ndarray, b_rgb: np.ndarray) -> float:
    def hist(img):
        h = []
        for c in range(3):
            hc, _ = np.histogram(img[:, :, c], bins=16, range=(0, 255))
            h.append(hc / max(1, hc.sum()))
        return np.concatenate(h)
    ha, hb = hist(a_rgb), hist(b_rgb)
    ha -= ha.mean(); hb -= hb.mean()
    da = np.sqrt((ha * ha).sum()); db = np.sqrt((hb * hb).sum())
    if da < 1e-9 or db < 1e-9:
        return 0.0
    return float((ha * hb).sum() / (da * db))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--frames", type=int, default=9)
    ap.add_argument("--label-a", default="demo_a")
    ap.add_argument("--label-b", default="demo_b")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    da, db = duration(args.a), duration(args.b)
    if da <= 0 or db <= 0:
        print(json.dumps({"error": "could not probe durations", "durationA": da, "durationB": db}))
        sys.exit(1)

    nccs, hists = [], []
    n_identical = 0
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(args.frames):
            frac = (i + 0.5) / args.frames
            pa = str(Path(tmp) / f"a_{i}.png")
            pb = str(Path(tmp) / f"b_{i}.png")
            if not frame_at(args.a, frac * da, pa) or not frame_at(args.b, frac * db, pb):
                continue
            ia = np.asarray(Image.open(pa).convert("RGB"))
            ib = np.asarray(Image.open(pb).convert("RGB"))
            ga = np.asarray(Image.open(pa).convert("L"))
            gb = np.asarray(Image.open(pb).convert("L"))
            v = ncc(ga, gb)
            nccs.append(v)
            hists.append(hist_corr(ia, ib))
            if np.array_equal(ia, ib):
                n_identical += 1

    result = {
        "labelA": args.label_a,
        "labelB": args.label_b,
        "frames": len(nccs),
        "layout_ncc_mean": round(float(np.mean(nccs)), 4) if nccs else None,
        "layout_ncc_max": round(float(np.max(nccs)), 4) if nccs else None,
        "color_hist_corr_mean": round(float(np.mean(hists)), 4) if hists else None,
        "n_identical_frames": n_identical,
        "interpretation": "layout_ncc_mean >= 0.85 across unrelated samples = MOLD (fail); < 0.70 = diverse (good)",
    }
    out = json.dumps(result, indent=2, ensure_ascii=False)
    print(out)
    if args.out:
        Path(args.out).write_text(out + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
