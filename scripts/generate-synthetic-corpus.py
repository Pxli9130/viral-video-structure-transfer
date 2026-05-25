#!/usr/bin/env python3
"""Deterministic synthetic corpus generator.

Produces small 720x1280 9:16 mp4 fixtures using OpenCV + ffmpeg, with no
external assets and no internet. Each generator emits per-frame PNGs into a
temp dir, then ffmpeg muxes them into h264. Same input args → same bytes.

Usage:
    python scripts/generate-synthetic-corpus.py --root test_videos/corpus
    python scripts/generate-synthetic-corpus.py --only 003_synthetic_thin_orbit
"""

from __future__ import annotations

import argparse
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import cv2  # type: ignore[import-not-found]
import numpy as np


WIDTH = 720
HEIGHT = 1280
FPS = 30


def resolve_tool(name: str) -> str:
    conda_base = os.environ.get("CONDA_BASE", "/home/pxli/anaconda3")
    conda_env = os.environ.get("VIRAL_CONDA_ENV", "viral")
    candidate = Path(conda_base) / "envs" / conda_env / "bin" / name
    if candidate.exists():
        return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    raise RuntimeError(f"{name} not on PATH and not found in conda env {conda_env}")


def run(cmd: list[str]) -> None:
    cmd = [resolve_tool(cmd[0]), *cmd[1:]]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {result.stderr or result.stdout}")


def encode_pngs(frames_dir: Path, out_mp4: Path, fps: int = FPS) -> None:
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg",
        "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame_%05d.png"),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(out_mp4),
    ])


def write_frame(frames_dir: Path, index: int, frame: np.ndarray) -> None:
    cv2.imwrite(str(frames_dir / f"frame_{index:05d}.png"), frame)


def put_text_center(canvas: np.ndarray, text: str, y_ratio: float, color: tuple[int, int, int], size: float, thickness: int = 4) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    (text_w, text_h), _ = cv2.getTextSize(text, font, size, thickness)
    x = (canvas.shape[1] - text_w) // 2
    y = int(canvas.shape[0] * y_ratio) + text_h // 2
    cv2.putText(canvas, text, (x, y), font, size, color, thickness, cv2.LINE_AA)


# --- 002 wide ribbon ---------------------------------------------------------

def generate_synthetic_wide_ribbon(work_dir: Path, out_mp4: Path, duration_sec: float = 14.0) -> None:
    """Wide colorful ribbon surface orbiting a minimalist title. Should trigger
    wide_surface_ribbon_2_5d via large colored band width + high colorful foreground."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    palette = [
        (245, 95, 60),     # blue → red ordering in BGR
        (200, 70, 220),    # purple
        (95, 105, 240),    # pink
        (40, 140, 245),    # orange
        (45, 200, 240),    # yellow
        (90, 200, 80),     # green
    ]
    for i in range(total):
        t = i / FPS
        canvas = np.full((HEIGHT, WIDTH, 3), 250, dtype=np.uint8)  # off-white
        # Title centred
        put_text_center(canvas, "WIDE RIBBON DEMO", 0.40, (40, 40, 40), 1.4, 5)
        put_text_center(canvas, "STRUCTURE TRANSFER", 0.47, (90, 90, 90), 0.9, 2)
        # 6 wide bands sweeping diagonally with phase offset; thicker than orbit case.
        for band_idx, color in enumerate(palette):
            phase = t * 0.7 + band_idx * 0.55
            y_center = int(HEIGHT * (0.55 + 0.25 * math.sin(phase * 1.2 + band_idx)))
            x_offset = int(WIDTH * 0.5 + math.cos(phase + band_idx) * WIDTH * 0.32)
            # Wide curved band: draw a thick polyline making an arch.
            pts = []
            for k in range(-WIDTH // 2, WIDTH // 2, 12):
                x = x_offset + k
                # arch with depth illusion
                y = y_center + int(math.sin(k * 0.013 + phase) * 110)
                pts.append((x, y))
            pts_arr = np.array(pts, dtype=np.int32)
            cv2.polylines(canvas, [pts_arr], False, color, thickness=78, lineType=cv2.LINE_AA)
            # Sparse keyword overlay on a couple of bands.
            if band_idx % 2 == 0:
                cv2.putText(
                    canvas,
                    ["STRUCTURE", "REMIX", "TIMELINE", "AIGC", "CREATION", "VIRAL"][band_idx % 6],
                    (max(20, x_offset - 180), y_center + 14),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.95,
                    (250, 250, 250),
                    2,
                    cv2.LINE_AA,
                )
        # Soft footer line
        put_text_center(canvas, "AI FULL-STACK CHALLENGE 2026", 0.92, (110, 110, 110), 0.7, 2)
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


def draw_helix_strand(canvas: np.ndarray, t: float, phase: float, color: tuple[int, int, int], front: bool) -> None:
    h, w = canvas.shape[:2]
    cx = w // 2
    top = int(h * 0.12)
    bottom = int(h * 0.86)
    radius = int(w * 0.31)
    turns = 1.35
    steps = 96
    points = []
    depths = []
    for idx in range(steps + 1):
        p = idx / steps
        theta = p * turns * math.pi * 2 + phase + t * 0.95
        y = int(top + (bottom - top) * p)
        x = int(cx + math.sin(theta) * radius + (p - 0.5) * w * 0.08)
        z = math.cos(theta)
        points.append((x, y))
        depths.append(z)
    for idx in range(len(points) - 1):
        z = (depths[idx] + depths[idx + 1]) * 0.5
        is_front = z >= 0
        if is_front != front:
            continue
        thickness = int(42 + 34 * ((z + 1) * 0.5))
        cv2.line(canvas, points[idx], points[idx + 1], color, thickness, cv2.LINE_AA)
        if front:
            cv2.line(canvas, points[idx], points[idx + 1], (255, 255, 255), max(3, thickness // 7), cv2.LINE_AA)


def generate_synthetic_vertical_helix_ribbon(work_dir: Path, out_mp4: Path, duration_sec: float = 14.0) -> None:
    """Wide DNA-like ribbon around the screen Y axis. Expected geometry:
    wide_band + vertical_helix + screen_y + front/back crossing."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    palette = [(240, 110, 60), (205, 80, 225), (90, 110, 245), (45, 150, 245), (60, 200, 225), (90, 205, 90)]
    for i in range(total):
        t = i / FPS
        canvas = np.full((HEIGHT, WIDTH, 3), 248, dtype=np.uint8)
        cv2.putText(canvas, "05.25", (48, 92), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (45, 45, 45), 2, cv2.LINE_AA)
        cv2.putText(canvas, "2026", (52, HEIGHT - 96), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (55, 55, 55), 2, cv2.LINE_AA)
        for idx, phase in enumerate([0.0, math.pi]):
            draw_helix_strand(canvas, t, phase, palette[idx * 2], front=False)
        put_text_center(canvas, "VERTICAL HELIX", 0.40, (22, 22, 22), 1.35, 5)
        put_text_center(canvas, "SCREEN Y AXIS", 0.47, (80, 80, 80), 0.82, 2)
        for idx, phase in enumerate([0.0, math.pi]):
            draw_helix_strand(canvas, t, phase, palette[(idx * 2 + 2 + int(t * 0.4)) % len(palette)], front=True)
        cv2.putText(canvas, "STRUCTURE   REMIX   AIGC", (90, int(HEIGHT * 0.68)), cv2.FONT_HERSHEY_SIMPLEX, 0.72, (255, 255, 255), 2, cv2.LINE_AA)
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


def generate_synthetic_planar_orbit_ribbon(work_dir: Path, out_mp4: Path, duration_sec: float = 14.0) -> None:
    """Wide ribbon orbit around the screen Z axis. Must not classify as vertical helix."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    palette = [(245, 95, 60), (200, 70, 220), (95, 105, 240), (40, 140, 245)]
    cx, cy = WIDTH // 2, int(HEIGHT * 0.48)
    for i in range(total):
        t = i / FPS
        canvas = np.full((HEIGHT, WIDTH, 3), 248, dtype=np.uint8)
        put_text_center(canvas, "PLANAR ORBIT", 0.39, (30, 30, 30), 1.3, 5)
        put_text_center(canvas, "SCREEN Z AXIS", 0.46, (90, 90, 90), 0.82, 2)
        for idx, color in enumerate(palette):
            angle = (t * 46 + idx * 38) % 360
            start = int((t * 80 + idx * 62) % 360)
            end = start + 185
            axes = (int(WIDTH * (0.38 + idx * 0.025)), int(HEIGHT * (0.105 + idx * 0.012)))
            cv2.ellipse(canvas, (cx, cy), axes, angle, start, end, color, 54, cv2.LINE_AA)
            cv2.ellipse(canvas, (cx, cy), axes, angle, start + 20, start + 58, (255, 255, 255), 8, cv2.LINE_AA)
        put_text_center(canvas, "orbit only, no y-axis helix", 0.91, (120, 120, 120), 0.65, 2)
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


def generate_synthetic_diagonal_sweep_ribbon(work_dir: Path, out_mp4: Path, duration_sec: float = 14.0) -> None:
    """Wide bands sweeping diagonally across the frame."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    palette = [(245, 95, 60), (200, 70, 220), (95, 105, 240), (40, 140, 245), (90, 200, 80)]
    for i in range(total):
        t = i / FPS
        canvas = np.full((HEIGHT, WIDTH, 3), 249, dtype=np.uint8)
        put_text_center(canvas, "DIAGONAL SWEEP", 0.40, (30, 30, 30), 1.18, 4)
        put_text_center(canvas, "foreground sweep", 0.47, (90, 90, 90), 0.8, 2)
        for band_idx, color in enumerate(palette):
            phase = t * 0.75 + band_idx * 0.5
            x0 = int(-WIDTH * 0.25 + math.sin(phase) * WIDTH * 0.22)
            y0 = int(HEIGHT * (0.18 + band_idx * 0.12))
            pts = []
            for k in range(0, int(WIDTH * 1.6), 18):
                x = x0 + k
                y = y0 + int(k * 0.82 + math.sin(k * 0.018 + phase) * 58)
                pts.append((x, y))
            cv2.polylines(canvas, [np.array(pts, dtype=np.int32)], False, color, thickness=64, lineType=cv2.LINE_AA)
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


# --- 003 thin orbit ----------------------------------------------------------

def generate_synthetic_thin_orbit(work_dir: Path, out_mp4: Path, duration_sec: float = 12.0) -> None:
    """Thin animated arc lines on a quiet background. Must NOT classify as wide
    ribbon: small foreground area, narrow band, only stroke edges visible."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    line_colors = [(220, 130, 60), (200, 140, 230), (160, 220, 220)]
    cx, cy = WIDTH // 2, int(HEIGHT * 0.5)
    for i in range(total):
        t = i / FPS
        canvas = np.full((HEIGHT, WIDTH, 3), 245, dtype=np.uint8)  # near-white
        # Title centred (intentionally static)
        put_text_center(canvas, "THIN ORBIT", 0.38, (50, 50, 50), 1.3, 4)
        put_text_center(canvas, "single line traces", 0.44, (110, 110, 110), 0.7, 2)
        # Three thin orbiting arcs (NOT thick bands).
        for arc_idx, color in enumerate(line_colors):
            phase = t * 1.4 + arc_idx * 1.3
            rx = int(WIDTH * (0.34 + arc_idx * 0.04))
            ry = int(HEIGHT * (0.10 + arc_idx * 0.03))
            angle = (phase * 70) % 360
            # Draw arc as polyline of 32 points around the ellipse, only an arc segment.
            pts = []
            for k in range(32):
                theta_deg = angle + k * 5
                theta = math.radians(theta_deg)
                x = int(cx + rx * math.cos(theta))
                y = int(cy + ry * math.sin(theta))
                pts.append((x, y))
            pts_arr = np.array(pts, dtype=np.int32)
            cv2.polylines(canvas, [pts_arr], False, color, thickness=4, lineType=cv2.LINE_AA)
        # Footer
        put_text_center(canvas, "STROKE-ONLY MOTIF", 0.92, (130, 130, 130), 0.6, 2)
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


# --- 004 static poster -------------------------------------------------------

def generate_synthetic_static_poster(work_dir: Path, out_mp4: Path, duration_sec: float = 10.0) -> None:
    """Centred poster, near-zero motion (only a 1-pixel breathing drift to keep
    h264 happy). Should classify as static_poster."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    base = np.full((HEIGHT, WIDTH, 3), 248, dtype=np.uint8)
    put_text_center(base, "STATIC POSTER", 0.40, (35, 35, 35), 1.6, 5)
    put_text_center(base, "No motion · No motif", 0.47, (100, 100, 100), 0.85, 2)
    put_text_center(base, "2026 · DESIGN FAIR", 0.92, (140, 140, 140), 0.7, 2)
    # Add a small framed accent.
    cv2.rectangle(base, (60, 60), (WIDTH - 60, HEIGHT - 60), (210, 210, 210), 4)
    for i in range(total):
        canvas = base.copy()
        # Sub-pixel breathing so codec sees small diffs but motion score stays tiny.
        offset_y = int(2 * math.sin(i / FPS * 0.5))
        if offset_y:
            shifted = np.roll(canvas, offset_y, axis=0)
            canvas = shifted
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


# --- 005 platform UI tail ----------------------------------------------------

def generate_synthetic_platform_ui_tail(work_dir: Path, out_mp4: Path, duration_sec: float = 16.0, tail_sec: float = 3.0) -> None:
    """13s creative content (a soft ribbon-ish animation) followed by a 3s
    abrupt UI tail (white screen with @profile / followers count). The analyzer
    should detect platform_ui_tail exclude segment via sharp palette + layout
    break near the end."""
    work_dir.mkdir(parents=True, exist_ok=True)
    total = int(duration_sec * FPS)
    creative_end = int((duration_sec - tail_sec) * FPS)
    creative_palette = [(240, 110, 60), (200, 100, 220), (90, 110, 240), (50, 150, 245)]
    for i in range(total):
        t = i / FPS
        if i < creative_end:
            canvas = np.full((HEIGHT, WIDTH, 3), 30, dtype=np.uint8)  # dark navy creative bed
            put_text_center(canvas, "CREATIVE CONTENT", 0.20, (240, 240, 240), 1.1, 3)
            # Soft animated bands (not wide enough to qualify as a ribbon motif on
            # the creative side; the FIXTURE just wants tail detection).
            for band_idx, color in enumerate(creative_palette):
                phase = t * 0.8 + band_idx * 0.4
                y_center = int(HEIGHT * (0.55 + 0.18 * math.sin(phase)))
                pts = []
                for k in range(-WIDTH // 2, WIDTH // 2, 18):
                    x = WIDTH // 2 + k
                    y = y_center + int(math.cos(k * 0.018 + phase) * 70)
                    pts.append((x, y))
                pts_arr = np.array(pts, dtype=np.int32)
                cv2.polylines(canvas, [pts_arr], False, color, thickness=22, lineType=cv2.LINE_AA)
            put_text_center(canvas, "Phase 1–4", 0.86, (200, 200, 200), 0.7, 2)
        else:
            # Abrupt platform UI tail: white screen with profile UI mock.
            canvas = np.full((HEIGHT, WIDTH, 3), 252, dtype=np.uint8)
            # Avatar circle
            cv2.circle(canvas, (WIDTH // 2, int(HEIGHT * 0.30)), 70, (220, 220, 220), -1)
            put_text_center(canvas, "@creator_demo", 0.42, (50, 50, 50), 1.0, 3)
            put_text_center(canvas, "12.3K followers · Follow", 0.48, (100, 100, 100), 0.7, 2)
            cv2.rectangle(canvas, (60, int(HEIGHT * 0.55)), (WIDTH - 60, int(HEIGHT * 0.55) + 70), (240, 240, 240), -1)
            put_text_center(canvas, "Recent posts", 0.61, (50, 50, 50), 0.65, 2)
            for row in range(3):
                top = int(HEIGHT * 0.65) + row * 130
                cv2.rectangle(canvas, (60, top), (WIDTH - 60, top + 110), (235, 235, 235), -1)
        write_frame(work_dir, i, canvas)
    encode_pngs(work_dir, out_mp4)


# --- registry ----------------------------------------------------------------

GENERATORS = {
    "002_synthetic_wide_ribbon": generate_synthetic_wide_ribbon,
    "003_synthetic_thin_orbit": generate_synthetic_thin_orbit,
    "004_synthetic_static_poster": generate_synthetic_static_poster,
    "005_synthetic_platform_ui_tail": generate_synthetic_platform_ui_tail,
    "006_synthetic_vertical_helix_ribbon": generate_synthetic_vertical_helix_ribbon,
    "007_synthetic_planar_orbit_ribbon": generate_synthetic_planar_orbit_ribbon,
    "008_synthetic_diagonal_sweep_ribbon": generate_synthetic_diagonal_sweep_ribbon,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="test_videos/corpus", help="Corpus root directory")
    parser.add_argument("--only", default=None, help="Only generate the named fixture id")
    parser.add_argument("--keep-frames", action="store_true", help="Keep the per-frame PNG temp dir for debug")
    args = parser.parse_args()

    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    only = args.only.strip() if args.only else None

    generated: list[str] = []
    skipped: list[str] = []

    for fixture_id, generator in GENERATORS.items():
        if only and fixture_id != only:
            continue
        fixture_dir = root / fixture_id
        out_mp4 = fixture_dir / "video.mp4"
        frames_dir = fixture_dir / ".frames_tmp"
        if frames_dir.exists():
            shutil.rmtree(frames_dir)
        try:
            print(f"generating {fixture_id} → {out_mp4}")
            generator(frames_dir, out_mp4)
            generated.append(fixture_id)
        finally:
            if not args.keep_frames and frames_dir.exists():
                shutil.rmtree(frames_dir, ignore_errors=True)

    # Update fingerprint.txt for each generated fixture.
    import hashlib
    for fixture_id in generated:
        out_mp4 = root / fixture_id / "video.mp4"
        digest = hashlib.sha256(out_mp4.read_bytes()).hexdigest()
        (root / fixture_id / "fingerprint.txt").write_text(digest + "\n", encoding="utf-8")
        print(f"  sha256({fixture_id}) = {digest}")

    print(f"done: generated={len(generated)} skipped={len(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
