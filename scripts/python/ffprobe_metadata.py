#!/usr/bin/env python3
"""Extract video metadata via ffprobe and emit a stable JSON shape.

Usage:
    python ffprobe_metadata.py <video_path>

Exit code 0 with stdout JSON on success. Stderr carries human-readable
diagnostics. Designed to be invoked from Node child_process.spawn under the
`viral` conda environment.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


def run_ffprobe(video_path: str) -> dict:
    if shutil.which("ffprobe") is None:
        raise RuntimeError("ffprobe binary not found on PATH")

    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        video_path,
    ]
    completed = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


def normalise(probe: dict) -> dict:
    fmt = probe.get("format", {}) or {}
    duration_sec = float(fmt.get("duration", 0) or 0)
    streams = probe.get("streams", []) or []
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)

    fps = 0.0
    if video and video.get("avg_frame_rate"):
        try:
            num, den = video["avg_frame_rate"].split("/")
            fps = float(num) / float(den) if float(den) else 0.0
        except (ValueError, ZeroDivisionError):
            fps = 0.0

    return {
        "durationSec": round(duration_sec, 3),
        "width": int(video.get("width", 0)) if video else None,
        "height": int(video.get("height", 0)) if video else None,
        "fps": round(fps, 3) if fps else None,
        "hasAudio": audio is not None,
        "codec": (video or {}).get("codec_name") or None,
        "container": fmt.get("format_name"),
        "bitRate": int(fmt.get("bit_rate", 0)) if fmt.get("bit_rate") else None,
        "rawFormat": fmt,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: ffprobe_metadata.py <video_path>", file=sys.stderr)
        return 2
    video_path = argv[1]
    if not Path(video_path).exists():
        print(f"File not found: {video_path}", file=sys.stderr)
        return 1
    try:
        probe = run_ffprobe(video_path)
        result = normalise(probe)
    except subprocess.CalledProcessError as exc:
        print(f"ffprobe failed: {exc.stderr.strip()}", file=sys.stderr)
        return exc.returncode
    except Exception as exc:  # noqa: BLE001
        print(f"ffprobe error: {exc}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
