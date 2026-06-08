// pipeline-v5/renderV5.ts
// Stage 13/16 render: turn a RenderRecipeV5 into final.mp4 via the FIXED V5Final Remotion composition
// (driven by input props). Heavy deps (@remotion/bundler, @remotion/renderer) are dynamic-imported so
// importing this module stays cheap and test-safe. A procedural FFmpeg audio bed is muxed when the
// recipe asks for audio but no real audio asset is present (routing-and-fallbacks.md §7).

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v5 } from "@vvst/shared";
import { renderSemaphore, RENDER_TABS_PER_JOB, RENDER_TIMEOUT_MS } from "./concurrency.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");

export type AssetMap = Record<string, { src: string; type?: string }>;

/** Build the V5Final composition input props from a FinalVideoProgram (pure — no chrome). */
export function buildV5RenderInputProps(
  finalProgram: v5.FinalVideoProgram,
  assetMap: AssetMap = {}
): { recipe: v5.RenderRecipeV5; assetMap: AssetMap } {
  const recipe = finalProgram.renderRecipe;
  // Default assetMap from recipe.assets when the caller didn't resolve served URLs.
  const map: AssetMap = { ...assetMap };
  for (const a of recipe.assets) {
    if (!map[a.id]) map[a.id] = { src: a.uri };
  }
  return { recipe, assetMap: map };
}

export function resolveBin(name: "ffmpeg" | "ffprobe"): string {
  const condaBase = process.env.CONDA_BASE;
  const env = process.env.VIRAL_CONDA_ENV ?? "viral";
  const override = name === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  const condaPath = condaBase ? path.join(condaBase, "envs", env, "bin", name) : undefined;
  // 1. an absolute override that actually exists wins.
  if (override && path.isAbsolute(override) && existsSync(override)) return override;
  // 2. the conda env binary is the most reliable in this repo — prefer it over a bare-name override
  //    (e.g. .env's FFMPEG_PATH=ffmpeg, which is NOT on PATH for standalone scripts/tsx).
  if (condaPath && existsSync(condaPath)) return condaPath;
  // 3. fall back to the override as given (may resolve via PATH), then the bare name.
  return override || name;
}
function resolveFfmpeg(): string {
  return resolveBin("ffmpeg");
}

/** Best-effort: does the file have an audio stream? */
function probeHasAudio(p: string): boolean {
  try {
    const r = spawnSync(resolveBin("ffprobe"), ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", p], { encoding: "utf8" });
    return r.status === 0 && /audio/.test(r.stdout || "");
  } catch {
    return false;
  }
}

export interface ProceduralAudioOpts {
  bpm?: number | null;
  /** Learned beat timestamps (s) from sample rhythm, used only for synthesized fallback timing. */
  beatGridSec?: number[];
  /** Strong onsets (s) from sample rhythm, used only for synthesized fallback impacts. */
  strongBeatsSec?: number[];
  /** Normalized RMS power curve from sample rhythm, used only to shape synthesized fallback energy. */
  energyCurve?: Array<{ t: number; value: number }>;
  /** Cue times (s) for beat-synced hits/impacts. */
  hitTimes?: number[];
  /** Riser end time (s) — a swell into the CTA. */
  riserTime?: number;
}

function cleanTimes(values: unknown, durationSec: number, limit: number): number[] {
  if (!Array.isArray(values)) return [];
  const out = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map((v) => Number(Math.max(0, Math.min(durationSec, v)).toFixed(3)))
    .sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const t of out) {
    if (!deduped.length || Math.abs(t - deduped[deduped.length - 1]) >= 0.08) deduped.push(t);
  }
  return deduped.slice(0, limit);
}

function regularBeatTimes(durationSec: number, bpm?: number | null): number[] {
  const safeBpm = bpm && bpm > 30 && bpm < 300 ? bpm : 120;
  const interval = 60 / safeBpm;
  const out: number[] = [];
  for (let t = 0; t <= durationSec + 0.001 && out.length < 96; t += interval) out.push(Number(t.toFixed(3)));
  return out;
}

function midpointTimes(times: number[], durationSec: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const t = (times[i] + times[i + 1]) / 2;
    if (t >= 0 && t <= durationSec) out.push(Number(t.toFixed(3)));
  }
  return out.slice(0, 96);
}

function energyPeaks(curve: Array<{ t: number; value: number }> | undefined, durationSec: number): Array<{ t: number; value: number }> {
  if (!curve?.length) return [];
  const cleaned = curve
    .map((p) => ({
      t: Number(Math.max(0, Math.min(durationSec, p.t)).toFixed(3)),
      value: Math.max(0, Math.min(1, p.value))
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
    .sort((a, b) => a.t - b.t);
  const candidates: Array<{ t: number; value: number }> = [];
  for (let i = 0; i < cleaned.length; i++) {
    const prev = cleaned[i - 1]?.value ?? 0;
    const next = cleaned[i + 1]?.value ?? 0;
    if (cleaned[i].value >= 0.58 && cleaned[i].value >= prev && cleaned[i].value >= next) candidates.push(cleaned[i]);
  }
  const byPower = candidates.sort((a, b) => b.value - a.value);
  const selected: Array<{ t: number; value: number }> = [];
  for (const p of byPower) {
    if (selected.every((s) => Math.abs(s.t - p.t) >= 0.35)) selected.push(p);
    if (selected.length >= 18) break;
  }
  return selected.sort((a, b) => a.t - b.t);
}

function pulseExpr(times: number[], freq: number, amp: number, width: number): string {
  if (!times.length) return "0";
  return times
    .map((t) => `${amp.toFixed(3)}*sin(2*PI*${freq}*t)*exp(-${width}*pow(t-${t.toFixed(3)}\\,2))`)
    .join("+");
}

/** Build the ffmpeg args for a cue-aware procedural mix (harmonic bed + bpm kick + cue hits + riser). */
export function buildProceduralAudioArgs(videoPath: string, outPath: string, durationSec: number, opts: ProceduralAudioOpts = {}): string[] {
  const dur = Math.max(1, durationSec);
  const sr = 44100;
  const ev = (expr: string) => `aevalsrc=exprs=${expr}:d=${dur}:s=${sr}`;
  // commas inside fn args must be escaped (\,) for the lavfi filtergraph parser.
  const beats = cleanTimes(opts.beatGridSec, dur, 96);
  const beatTimes = beats.length >= 2 ? beats : regularBeatTimes(dur, opts.bpm);
  const hats = midpointTimes(beatTimes, dur);
  const peaks = energyPeaks(opts.energyCurve, dur);
  const strong = cleanTimes([...(opts.strongBeatsSec ?? []), ...(opts.hitTimes ?? []), ...peaks.map((p) => p.t)], dur, 32);
  const avgEnergy = opts.energyCurve?.length
    ? opts.energyCurve.reduce((sum, p) => sum + Math.max(0, Math.min(1, p.value)), 0) / opts.energyCurve.length
    : 0.45;
  const bedGain = 0.12 + Math.min(0.08, avgEnergy * 0.08);
  const bed = ev(`${bedGain.toFixed(3)}*sin(2*PI*110*t)+0.08*sin(2*PI*55*t)+0.05*sin(2*PI*220*t)`);
  const kick = ev(pulseExpr(beatTimes, 85, 0.7, 120));
  const hat = ev(pulseExpr(hats, 1450, 0.11 + Math.min(0.08, avgEnergy * 0.08), 260));
  const hits = strong.slice(0, 16).map((ti) => `0.7*sin(2*PI*1250*t)*exp(-650*pow(t-${Math.max(0, ti).toFixed(2)}\\,2))`);
  for (const peak of peaks.slice(0, 12)) {
    hits.push(`${(0.16 + peak.value * 0.28).toFixed(3)}*sin(2*PI*180*t)*exp(-70*pow(t-${peak.t.toFixed(3)}\\,2))`);
  }
  if (typeof opts.riserTime === "number") {
    const rt = Math.max(0, opts.riserTime);
    // rising noise-ish swell ~1s before the cue
    hits.push(`0.5*sin(2*PI*(300+260*(t-${(rt - 1).toFixed(2)}))*t)*exp(-9*pow(t-${rt.toFixed(2)}\\,2))`);
  }
  const hitSrc = ev(hits.length ? hits.join("+") : "0");

  return [
    "-y",
    "-i", videoPath,
    "-f", "lavfi", "-i", bed,
    "-f", "lavfi", "-i", kick,
    "-f", "lavfi", "-i", hat,
    "-f", "lavfi", "-i", hitSrc,
    "-filter_complex", "[1:a][2:a][3:a][4:a]amix=inputs=4:duration=longest:normalize=0,volume=1.45,alimiter=limit=0.95[a]",
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest",
    outPath
  ];
}

/** Best-effort cue-aware procedural audio muxed under a silent render. ASYNC (spawn, not spawnSync) so it
 *  never blocks the Node event loop — critical under concurrent renders, where a blocked loop starves the
 *  in-process asset server that ANOTHER render's compositor fetches material images/videos from (a stalled
 *  fetch makes the Remotion compositor crash with a frame_cache panic). */
export function muxProceduralAudio(videoPath: string, outPath: string, durationSec: number, opts: ProceduralAudioOpts = {}): Promise<{ ok: boolean; error?: string }> {
  const ffmpeg = resolveFfmpeg();
  const args = buildProceduralAudioArgs(videoPath, outPath, durationSec, opts);
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { stdio: "ignore" });
    p.on("error", (e) => resolve({ ok: false, error: String(e.message).slice(-400) }));
    p.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `ffmpeg mux exit ${code}` }));
  });
}

export interface RenderV5Options {
  finalProgram: v5.FinalVideoProgram;
  assetMap?: AssetMap;
  outPath: string;
  /** Source BPM for the procedural kick (beat-synced bed). */
  bpm?: number | null;
  beatGridSec?: number[];
  strongBeatsSec?: number[];
  energyCurve?: Array<{ t: number; value: number }>;
  entryPoint?: string;
  /** Reuse a prior bundle to avoid re-bundling per render. */
  bundleLocation?: string;
  /** Add a procedural audio bed when the recipe wants audio but has no real audio asset. */
  proceduralAudio?: boolean;
}

export interface RenderV5Result {
  ok: boolean;
  finalMp4?: string;
  remotionMp4?: string;
  bundleLocation?: string;
  audioMuxed: boolean;
  /** Whether the final file actually carries an audio stream (probed; robust to mux hiccups). */
  hasAudio: boolean;
  durationSec: number;
  warnings: string[];
  error?: string;
}

/** Render final.mp4 from a FinalVideoProgram. Requires the Remotion render env (chrome-headless). */
export async function renderFinalVideoV5(opts: RenderV5Options): Promise<RenderV5Result> {
  const warnings: string[] = [];
  const recipe = opts.finalProgram.renderRecipe;
  const durationSec = recipe.composition.durationSec;
  const entryPoint = opts.entryPoint ?? path.resolve(repoRoot, "apps/api/remotion/index.tsx");
  if (!existsSync(entryPoint)) {
    return { ok: false, audioMuxed: false, hasAudio: false, durationSec, warnings, error: `Remotion entry not found at ${entryPoint}` };
  }

  let bundleLocation = opts.bundleLocation;
  let inputProps: { recipe: v5.RenderRecipeV5; assetMap: AssetMap };
  try {
    const remotionMp4 = opts.proceduralAudio ? `${opts.outPath}.silent.mp4` : opts.outPath;
    inputProps = buildV5RenderInputProps(opts.finalProgram, opts.assetMap);
    // Bound by the SHARED render semaphore + tab cap (same budget as renderTemplateCapsule) so this path
    // can't blow memory under concurrent generate requests.
    await renderSemaphore.run(async () => {
      const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
        import("@remotion/bundler"),
        import("@remotion/renderer")
      ]);
      if (!bundleLocation) bundleLocation = await bundle({ entryPoint });
      const composition = await selectComposition({ serveUrl: bundleLocation, id: "V5Final", inputProps });
      await renderMedia({ composition, serveUrl: bundleLocation, codec: "h264", outputLocation: remotionMp4, inputProps, concurrency: RENDER_TABS_PER_JOB, timeoutInMilliseconds: RENDER_TIMEOUT_MS });
    });

    let finalMp4 = remotionMp4;
    let audioMuxed = false;
    const wantsAudio = opts.proceduralAudio && recipe.audioLayers.length > 0 && recipe.audioLayers.every((a) => !a.uri);
    if (wantsAudio) {
      // Derive beat-synced hit/riser cues from the recipe's audio layers.
      const hitTimes = recipe.audioLayers.flatMap((a) => (a.kind === "sfx" && a.id !== "sfx_riser" ? a.cueAlignSec ?? [] : []));
      const riserLayer = recipe.audioLayers.find((a) => a.id === "sfx_riser");
      const mux = await muxProceduralAudio(remotionMp4, opts.outPath, durationSec, {
        bpm: opts.bpm ?? recipe.rhythm?.bpm ?? null,
        beatGridSec: opts.beatGridSec ?? recipe.rhythm?.beatGridSec,
        strongBeatsSec: opts.strongBeatsSec ?? recipe.rhythm?.strongBeatsSec,
        energyCurve: opts.energyCurve ?? recipe.rhythm?.energyCurve,
        hitTimes,
        riserTime: riserLayer?.cueAlignSec?.[0]
      });
      if (mux.ok) {
        finalMp4 = opts.outPath;
        audioMuxed = true;
      } else {
        // Mux hiccup: keep the rendered file as the final output (it still carries Remotion's
        // audio track) so final.mp4 always exists and the audio gate stays robust.
        warnings.push(`procedural audio mux failed: ${mux.error}`);
        finalMp4 = remotionMp4;
      }
    }
    const hasAudio = audioMuxed || probeHasAudio(finalMp4);
    return { ok: true, finalMp4, remotionMp4, bundleLocation, audioMuxed, hasAudio, durationSec, warnings };
  } catch (err) {
    return { ok: false, audioMuxed: false, hasAudio: false, durationSec, warnings, error: err instanceof Error ? err.message : String(err) };
  }
}
