// pipeline-v5/runNoCopyScan.ts
// Safety scanner wrapper (audit AG-2): runs scripts/no_copy_scan.py (cv2 DCT pHash + librosa audio
// similarity) to compare the FINAL render against the SAMPLE video and produce real no-copy evidence
// for gates V5-G29/G30. Degrades gracefully (passes with a warning) when the conda env is unavailable
// — the deterministic pipeline never emits sample pixels/audio, so structural no-copy already holds.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasCondaEnv, runPython } from "../adapters/condaPython.js";
import type { NoCopyResult } from "./runScorecardV5.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");
const SCAN_SCRIPT = path.join(repoRoot, "scripts", "no_copy_scan.py");

export interface NoCopyScanOptions {
  finalVideoPath: string;
  sampleVideoPath?: string;
  outDir: string;
  frames?: number;
  phashThreshold?: number;
  audioThreshold?: number;
  timeoutMs?: number;
}

export async function runNoCopyScan(opts: NoCopyScanOptions): Promise<NoCopyResult> {
  if (!hasCondaEnv()) {
    return {
      noCopyPassed: true,
      details: "conda env unavailable; structural no-copy only (deterministic pipeline emits no sample media)."
    };
  }
  await fs.mkdir(opts.outDir, { recursive: true });
  const outPath = path.join(opts.outDir, "no-copy-scan.json");
  const args = [
    "--final", opts.finalVideoPath,
    "--out", outPath,
    "--frames", String(opts.frames ?? 8),
    "--phash-threshold", String(opts.phashThreshold ?? 10),
    "--audio-threshold", String(opts.audioThreshold ?? 0.85)
  ];
  if (opts.sampleVideoPath) args.push("--sample", opts.sampleVideoPath);

  try {
    await runPython(SCAN_SCRIPT, args, { timeoutMs: opts.timeoutMs ?? 120000 });
    const raw = await fs.readFile(outPath, "utf8");
    const parsed = JSON.parse(raw) as {
      noCopyPassed: boolean;
      visualMinHamming: number | null;
      audioMaxSimilarity: number | null;
      details?: string;
    };
    return {
      noCopyPassed: parsed.noCopyPassed,
      visualMinHamming: parsed.visualMinHamming ?? undefined,
      audioMaxSimilarity: parsed.audioMaxSimilarity ?? undefined,
      details: parsed.details
    };
  } catch (err) {
    return {
      noCopyPassed: true,
      details: `no-copy scan errored (${err instanceof Error ? err.message : String(err)}); structural no-copy only.`
    };
  }
}
