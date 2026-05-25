#!/usr/bin/env python3
"""Optional ASR helper. Tries faster-whisper; falls back to clear error JSON.

Usage:
    python asr_faster_whisper.py <video_or_audio_path> [--model tiny]

Stdout JSON:
    [{"startSec": 0.0, "endSec": 1.2, "text": "..."}]

When faster-whisper is not installed (the model is large), we emit an empty
array and a stderr note so the Node side can fall back to mock transcript.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()

    if not Path(args.path).exists():
        print(f"File not found: {args.path}", file=sys.stderr)
        return 1

    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]
    except ImportError:
        print("faster_whisper is not installed in this env; emitting empty transcript.", file=sys.stderr)
        json.dump([], sys.stdout)
        return 0

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, _ = model.transcribe(args.path, language=args.language)
        result = [
            {
                "startSec": round(segment.start, 3),
                "endSec": round(segment.end, 3),
                "text": segment.text.strip()
            }
            for segment in segments
        ]
    except Exception as exc:  # noqa: BLE001
        print(f"faster-whisper failed: {exc}", file=sys.stderr)
        json.dump([], sys.stdout)
        return 0

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
