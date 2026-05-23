#!/usr/bin/env python3
"""Optional OCR helper. Tries easyocr; emits empty array if unavailable.

Usage:
    python ocr_easyocr.py <frame_path> [frame_path ...]

Stdout JSON:
    [{"path": "...", "text": "extracted text"}]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    paths = [arg for arg in argv[1:] if not arg.startswith("--")]
    if not paths:
        print("Usage: ocr_easyocr.py <frame_path> [frame_path ...]", file=sys.stderr)
        return 2
    for path in paths:
        if not Path(path).exists():
            print(f"File not found: {path}", file=sys.stderr)
            return 1
    try:
        import easyocr  # type: ignore[import-not-found]
    except ImportError:
        print("easyocr is not installed; emitting empty OCR result.", file=sys.stderr)
        json.dump([], sys.stdout)
        return 0

    try:
        reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
        results = []
        for path in paths:
            lines = reader.readtext(path, detail=0, paragraph=True)
            results.append({"path": path, "text": "\n".join(lines)})
    except Exception as exc:  # noqa: BLE001
        print(f"easyocr failed: {exc}", file=sys.stderr)
        json.dump([], sys.stdout)
        return 0

    json.dump(results, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
