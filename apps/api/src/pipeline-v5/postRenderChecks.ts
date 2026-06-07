// pipeline-v5/postRenderChecks.ts
// Pixel-level checks on a rendered final.mp4, all via ASYNC ffmpeg (never blocks the event loop):
//  - overallMeanLuma:   light-vs-dark fidelity (compare to the source's sourceIsLight).
//  - detectUniformTailSec: a trailing run of near-uniform single-colour frames (a redundant "just a flat
//    fill, no pic/shape/text" end scene) — its start time, so we can trim it.
//  - trimTo:            re-encode the mp4 to [0, toSec).

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBin } from "./renderV5.js";
import { nextSeq } from "./concurrency.js";

const tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../..", "storage", "generated", "v5", "_postcheck");

function runFfmpeg(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(resolveBin("ffmpeg"), args, { stdio: "ignore" });
    p.on("error", () => resolve(-1));
    p.on("close", (code) => resolve(code ?? -1));
  });
}

/** {mean, std} luma (0..255) of a downscaled gray frame at time t. null on failure. */
async function grayStats(mp4: string, t: number, size = 32): Promise<{ mean: number; std: number } | null> {
  await fs.mkdir(tmpDir, { recursive: true });
  const out = path.join(tmpDir, `f_${Date.now()}_${nextSeq()}.gray`);
  const code = await runFfmpeg(["-y", "-ss", Math.max(0, t).toFixed(3), "-i", mp4, "-frames:v", "1", "-vf", `scale=${size}:${size},format=gray`, "-f", "rawvideo", out]);
  try {
    if (code !== 0) return null;
    const buf = await fs.readFile(out);
    if (!buf.length) return null;
    let s = 0;
    for (const v of buf) s += v;
    const mean = s / buf.length;
    let v2 = 0;
    for (const v of buf) v2 += (v - mean) ** 2;
    return { mean, std: Math.sqrt(v2 / buf.length) };
  } catch {
    return null;
  } finally {
    await fs.rm(out, { force: true }).catch(() => {});
  }
}

/** Average luma over samples across the clip — for source/output light-vs-dark comparison. */
export async function overallMeanLuma(mp4: string, durationSec: number, samples = 6): Promise<number | null> {
  const ts = Array.from({ length: samples }, (_, i) => (Math.max(1, durationSec) * (i + 0.5)) / samples);
  const stats = (await Promise.all(ts.map((t) => grayStats(mp4, t)))).filter(Boolean) as Array<{ mean: number }>;
  if (!stats.length) return null;
  return stats.reduce((a, x) => a + x.mean, 0) / stats.length;
}

/** Start time (s) of a trailing run of near-uniform (flat single-colour) frames, or null if not worth trimming. */
export async function detectUniformTailSec(
  mp4: string,
  durationSec: number,
  opts: { stdThreshold?: number; minTailSec?: number; step?: number } = {}
): Promise<number | null> {
  const stdThreshold = opts.stdThreshold ?? 6; // gray std < 6 on 0..255 ≈ flat fill (no pic/shape/text)
  const minTailSec = opts.minTailSec ?? 1.0;
  const step = opts.step ?? 0.4;
  if (durationSec < minTailSec + 1) return null;
  let tailStart = durationSec;
  for (let t = durationSec - 0.15; t > 0.5; t -= step) {
    const st = await grayStats(mp4, t);
    if (st && st.std < stdThreshold) tailStart = t;
    else break;
  }
  const tailLen = durationSec - tailStart;
  return tailLen >= minTailSec ? +tailStart.toFixed(2) : null;
}

/** Re-encode mp4 to [0, toSec). Returns true on success. */
export async function trimTo(mp4: string, toSec: number, outPath: string): Promise<boolean> {
  const code = await runFfmpeg(["-y", "-i", mp4, "-t", toSec.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outPath]);
  return code === 0;
}
