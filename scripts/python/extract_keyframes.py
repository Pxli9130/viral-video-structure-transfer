#!/usr/bin/env python3
"""Extract evenly-spaced keyframes and naive shot candidates via ffmpeg.

Usage:
    python extract_keyframes.py <video_path> <output_dir> [--max-frames N] [--shot-seconds S]

Writes <output_dir>/keyframe_<idx>.jpg and emits JSON on stdout:
{
  "keyframes": [{"id": "keyframe_1", "timeSec": 0.0, "path": "..."}],
  "shots": [{"id": "shot_1", "startSec": 0, "endSec": 5, "durationSec": 5, "thumbnailPath": "...", "confidence": 0.6}]
}
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> str:
    if shutil.which(cmd[0]) is None:
        raise RuntimeError(f"{cmd[0]} not found on PATH")
    completed = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return completed.stdout


def probe_duration(video_path: str) -> float:
    output = run([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-print_format",
        "json",
        video_path,
    ])
    payload = json.loads(output)
    return float(payload.get("format", {}).get("duration", 0) or 0)


def extract_frame(video_path: str, time_sec: float, out_path: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{time_sec:.3f}",
        "-i",
        video_path,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video_path")
    parser.add_argument("output_dir")
    parser.add_argument("--max-frames", type=int, default=6)
    parser.add_argument("--shot-seconds", type=float, default=5.0)
    parser.add_argument("--purpose", default="source")
    args = parser.parse_args()

    video = args.video_path
    if not Path(video).exists():
        print(f"File not found: {video}", file=sys.stderr)
        return 1

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        duration = probe_duration(video)
    except subprocess.CalledProcessError as exc:
        print(f"ffprobe failed: {exc.stderr.strip()}", file=sys.stderr)
        return exc.returncode

    if duration <= 0:
        print("Unable to determine duration (got <= 0).", file=sys.stderr)
        return 1

    frames = max(1, min(args.max_frames, int(duration / max(args.shot_seconds, 0.5)) + 1))
    keyframes = []
    shots = []
    for index in range(frames):
        ratio = (index + 0.5) / frames
        time_sec = round(min(duration - 0.1, max(0.0, ratio * duration)), 3)
        frame_path = out_dir / f"keyframe_{index + 1}.jpg"
        try:
            extract_frame(video, time_sec, frame_path)
        except subprocess.CalledProcessError as exc:
            print(f"ffmpeg failed at {time_sec}s: {exc.stderr.strip()}", file=sys.stderr)
            return exc.returncode
        keyframes.append({
            "id": f"keyframe_{index + 1}",
            "timeSec": time_sec,
            "path": str(frame_path)
        })
        start = round(max(0.0, (index / frames) * duration), 3)
        end = round(min(duration, ((index + 1) / frames) * duration), 3)
        shots.append({
            "id": f"{args.purpose}_shot_{index + 1}",
            "startSec": start,
            "endSec": end,
            "durationSec": round(end - start, 3),
            "thumbnailPath": str(frame_path),
            "confidence": 0.6 + 0.05 * (index % 3),
            "tags": []
        })

    json.dump({"keyframes": keyframes, "shots": shots, "durationSec": round(duration, 3)}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
