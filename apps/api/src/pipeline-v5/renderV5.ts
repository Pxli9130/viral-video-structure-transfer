// pipeline-v5/renderV5.ts
// Stage 13/16 render: turn a RenderRecipeV5 into final.mp4 via the FIXED V5Final Remotion composition
// (driven by input props). Heavy deps (@remotion/bundler, @remotion/renderer) are dynamic-imported so
// importing this module stays cheap and test-safe. A procedural FFmpeg audio bed is muxed when the
// recipe asks for audio but no real audio asset is present (routing-and-fallbacks.md §7).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v5 } from "@vvst/shared";

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

function resolveBin(name: "ffmpeg" | "ffprobe"): string {
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

/** Best-effort procedural audio bed (sine + soft noise) muxed under a silent render. */
export function muxProceduralAudio(videoPath: string, outPath: string, durationSec: number): { ok: boolean; error?: string } {
  const ffmpeg = resolveFfmpeg();
  const args = [
    "-y",
    "-i", videoPath,
    "-f", "lavfi", "-t", String(Math.max(1, durationSec)),
    "-i", "sine=frequency=110:sample_rate=44100",
    "-f", "lavfi", "-t", String(Math.max(1, durationSec)),
    "-i", "anoisesrc=color=brown:amplitude=0.04:sample_rate=44100",
    "-filter_complex", "[1:a][2:a]amix=inputs=2:duration=shortest,volume=0.18[a]",
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-shortest",
    outPath
  ];
  const res = spawnSync(ffmpeg, args, { stdio: "pipe", encoding: "utf8" });
  if (res.status === 0) return { ok: true };
  return { ok: false, error: (res.stderr || res.error?.message || "ffmpeg failed").slice(-400) };
}

export interface RenderV5Options {
  finalProgram: v5.FinalVideoProgram;
  assetMap?: AssetMap;
  outPath: string;
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
    const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
      import("@remotion/bundler"),
      import("@remotion/renderer")
    ]);
    if (!bundleLocation) bundleLocation = await bundle({ entryPoint });
    inputProps = buildV5RenderInputProps(opts.finalProgram, opts.assetMap);
    const composition = await selectComposition({ serveUrl: bundleLocation, id: "V5Final", inputProps });
    const remotionMp4 = opts.proceduralAudio ? `${opts.outPath}.silent.mp4` : opts.outPath;
    await renderMedia({ composition, serveUrl: bundleLocation, codec: "h264", outputLocation: remotionMp4, inputProps });

    let finalMp4 = remotionMp4;
    let audioMuxed = false;
    const wantsAudio = opts.proceduralAudio && recipe.audioLayers.length > 0 && recipe.audioLayers.every((a) => !a.uri);
    if (wantsAudio) {
      const mux = muxProceduralAudio(remotionMp4, opts.outPath, durationSec);
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
