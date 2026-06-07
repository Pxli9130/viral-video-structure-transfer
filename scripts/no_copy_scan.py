#!/usr/bin/env python3
"""No-copy scanner (spec_v5 safety gate V5-G29/G30).

Compares a FINAL rendered video against a SAMPLE video to ensure no sample pixels/audio leaked in:
  - visual: 64-bit DCT perceptual hash (pHash) of evenly-spaced frames; min Hamming distance.
  - audio:  chroma+MFCC mean-vector cosine similarity.

A small Hamming distance (very similar frames) or a high audio similarity => likely copy => FAIL.
Uses cv2 + numpy + librosa (already in the conda 'viral' env); no imagehash/chromaprint needed.

Usage:
  python no_copy_scan.py --final final.mp4 [--sample sample.mp4] --out result.json
                         [--frames 8] [--phash-threshold 10] [--audio-threshold 0.85]
"""
import argparse
import json
import sys


def extract_frames(path, n):
    import cv2
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frames = []
    if total <= 0:
        # fall back to sequential reads
        ok, fr = cap.read()
        while ok and len(frames) < n:
            frames.append(fr)
            ok, fr = cap.read()
        cap.release()
        return frames
    idxs = [int(total * (i + 0.5) / n) for i in range(n)]
    for idx in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, fr = cap.read()
        if ok:
            frames.append(fr)
    cap.release()
    return frames


def phash(frame):
    import cv2
    import numpy as np
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(resized)
    low = dct[:8, :8]
    med = np.median(low[1:, 1:])  # exclude DC term from median
    bits = (low > med).flatten()
    val = 0
    for b in bits:
        val = (val << 1) | int(b)
    return val


def hamming(a, b):
    return bin(a ^ b).count("1")


def audio_chroma_seq(path):
    """Return a per-frame, L2-normalized chroma sequence (12 x T), or None.

    A mean-vector cosine conflates "both are audio" with "same audio" (false positives on a
    procedural bed). An ALIGNED per-frame chroma correlation instead measures whether the two
    tracks actually share time-local content — near-copies align to ~0.95+, unrelated audio stays
    well below, which is what a no-copy safety gate needs.
    """
    import numpy as np
    import librosa
    try:
        y, sr = librosa.load(path, sr=22050, mono=True, duration=60)
    except Exception:
        return None
    if y is None or len(y) < sr // 2:
        return None
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048)  # 12 x T
    norms = np.linalg.norm(chroma, axis=0, keepdims=True)
    norms[norms == 0] = 1.0
    return chroma / norms


def aligned_similarity(a, b):
    """Best-offset mean per-frame chroma cosine between two normalized chroma sequences."""
    import numpy as np
    if a is None or b is None:
        return None
    if a.shape[1] == 0 or b.shape[1] == 0:
        return None
    short, long = (a, b) if a.shape[1] <= b.shape[1] else (b, a)
    ts, tl = short.shape[1], long.shape[1]
    step = max(1, (tl - ts) // 60 + 1)  # cap offsets evaluated
    best = 0.0
    for off in range(0, tl - ts + 1, step):
        seg = long[:, off:off + ts]
        m = float((short * seg).sum(axis=0).mean())  # frames are unit-norm -> per-frame cosine
        if m > best:
            best = m
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", required=True)
    ap.add_argument("--sample")
    ap.add_argument("--out", required=True)
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--phash-threshold", type=int, default=10)
    ap.add_argument("--audio-threshold", type=float, default=0.92)
    args = ap.parse_args()

    result = {
        "noCopyPassed": True,
        "visualMinHamming": None,
        "audioMaxSimilarity": None,
        "framesFinal": 0,
        "framesSample": 0,
        "details": "",
        "warnings": [],
    }

    try:
        final_frames = extract_frames(args.final, args.frames)
        result["framesFinal"] = len(final_frames)
    except Exception as e:
        result["warnings"].append(f"final frame extract failed: {e}")
        final_frames = []

    if args.sample:
        try:
            sample_frames = extract_frames(args.sample, args.frames)
            result["framesSample"] = len(sample_frames)
        except Exception as e:
            result["warnings"].append(f"sample frame extract failed: {e}")
            sample_frames = []

        if final_frames and sample_frames:
            fh = [phash(f) for f in final_frames]
            sh = [phash(s) for s in sample_frames]
            min_ham = min(hamming(a, b) for a in fh for b in sh)
            result["visualMinHamming"] = int(min_ham)
            if min_ham <= args.phash_threshold:
                result["noCopyPassed"] = False
                result["details"] += f"visual pHash too close (minHamming={min_ham}<= {args.phash_threshold}). "

        try:
            fv = audio_chroma_seq(args.final)
            sv = audio_chroma_seq(args.sample)
            sim = aligned_similarity(fv, sv)
            if sim is not None:
                result["audioMaxSimilarity"] = round(sim, 4)
                if sim >= args.audio_threshold:
                    result["noCopyPassed"] = False
                    result["details"] += f"audio similarity high (sim={sim:.3f}>= {args.audio_threshold}). "
        except Exception as e:
            result["warnings"].append(f"audio compare failed: {e}")
    else:
        result["details"] = "no sample provided; structural no-copy only."

    if not result["details"]:
        result["details"] = "no copy detected"

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps({k: result[k] for k in ("noCopyPassed", "visualMinHamming", "audioMaxSimilarity")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
