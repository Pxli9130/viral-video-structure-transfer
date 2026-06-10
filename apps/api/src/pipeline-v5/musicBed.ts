// pipeline-v5/musicBed.ts
// Generate an ORIGINAL instrumental music bed via Google Lyria for the CREATE / mix_elements path, so its
// final audio is AI-generated rather than only the procedural synthesized bed. This mirrors the proven
// same_template music wiring (runSameTemplateGeneration.generateGoogleMusicBed) but is driven by generic
// CREATE inputs (CompositionProgram.audioPlan + brief) instead of a TemplateCapsule.
//
// Contract: returns the stitched bed file; THROWS on failure so the caller can fall back to the procedural
// bed (the render path already degrades to procedural when no music file is supplied).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GoogleAudioAdapter, googleAudioLiveEnabled, type GoogleGeneratedAudioAsset } from "../adapters/googleAudio.js";
import { resolveBin } from "./renderV5.js";

/** Structural audio hints (decoupled from the exact contract export names). Both CompositionProgram.audioPlan
 *  and a KnowledgeElement's AudioRecipeV5 are structurally assignable to this. */
export interface AudioBedHints {
  mood?: string[];
  instruments?: string[];
  bpm?: number;
  cuePoints?: Array<{ t: number; type: string }>;
  cues?: Array<{ t: number; type: string }>;
  energyCurve?: Array<{ t: number; value: number }>;
}

export interface LyriaMusicBed {
  id: string;
  path: string;
  provider: "google_lyria_music";
  modelId?: string;
  segmentCount: number;
}

export interface LyriaMusicBedInput {
  /** Product theme/prompt for the bed (brief.theme ?? brief.prompt). */
  theme?: string;
  durationSec: number;
  /** CompositionProgram.audioPlan (mood/bpm/cues/energyCurve) — primary hint source for the CREATE path. */
  audioPlan?: AudioBedHints;
  /** Optional richer per-element AudioRecipeV5 (instruments/cuePoints…) when one was selected. */
  audioRecipe?: AudioBedHints;
  env?: Record<string, string | undefined>;
  /** Generation output dir; the bed is written under <outDir>/materials/audio. */
  outDir: string;
  generationId: string;
}

/** Lyria is reachable when the Gemini key is set and Google cloud audio is enabled (same gate as the adapter). */
export function lyriaMusicAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim()) && googleAudioLiveEnabled(env as NodeJS.ProcessEnv);
}

/** Strip prompt/sample-copy pollution from a free-text hint (same rule the adapter enforces). */
function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/prompt|watermark|水印|学习样例|不要复制|不复制|sample\s+(audio|video|frame)|copy\s+the\s+sample/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 700) : undefined;
}

function bedPrompt(
  input: LyriaMusicBedInput,
  durationSec: number,
  segmentIndex: number,
  segmentCount: number,
  previousSummary?: string,
  previousSectionBrief?: string
): string {
  const recipe = input.audioRecipe;
  const plan = input.audioPlan;
  const theme = clean(input.theme) ?? "a modern product advertisement";
  const mood =
    (recipe?.mood ?? plan?.mood ?? []).map(clean).filter((v): v is string => Boolean(v)).slice(0, 6).join(", ") ||
    "modern, polished, energetic";
  const instruments =
    (recipe?.instruments ?? []).map(clean).filter((v): v is string => Boolean(v)).slice(0, 8).join(", ") ||
    "clean synth bass, soft percussion, bright plucks, subtle risers";
  const bpm = recipe?.bpm ?? plan?.bpm;
  const cuePoints = recipe?.cuePoints ?? plan?.cues ?? [];
  const cueTimes = cuePoints
    .map((cue) => (Number.isFinite(cue.t) ? `${cue.type} at ${cue.t.toFixed(1)}s` : undefined))
    .filter((v): v is string => Boolean(v))
    .slice(0, 8)
    .join(", ");
  const energy = (recipe?.energyCurve ?? plan?.energyCurve ?? [])
    .map((point) => `${point.t.toFixed(1)}s=${point.value.toFixed(2)}`)
    .slice(0, 8)
    .join(", ");
  const section =
    segmentCount <= 1
      ? `Create one complete section for a ${Math.round(durationSec)} second vertical ad.`
      : `Create section ${segmentIndex + 1} of ${segmentCount}, exactly 30 seconds, continuing the same track identity.`;
  return [
    `Original instrumental music bed for a vertical product video about ${theme}.`,
    section,
    `Mood: ${mood}.`,
    `Instrumentation: ${instruments}.`,
    bpm ? `Tempo around ${Math.round(bpm)} BPM, steady enough for visual edits.` : "Tempo should be steady enough for visual edits.",
    energy ? `Energy shape: ${energy}.` : "Energy should rise gently toward the final call-to-action.",
    cueTimes ? `Important cue moments: ${cueTimes}.` : "Add light impacts and risers at major visual changes.",
    previousSectionBrief ? `Previous section brief: ${previousSectionBrief}.` : undefined,
    previousSummary ? `Previous generated section structure: ${previousSummary}. Keep the same key, tempo, instrumentation, and mix character.` : undefined,
    "Start on a clean downbeat and end with a bar that can crossfade into the next section.",
    "No vocals. No copyrighted melody. Clean commercial mix."
  ]
    .filter(Boolean)
    .join(" ");
}

function generatedSummary(asset: GoogleGeneratedAudioAsset): string | undefined {
  const parts = Array.isArray(asset.metadata.textParts)
    ? (asset.metadata.textParts as unknown[]).map(clean).filter((v): v is string => Boolean(v))
    : [];
  return clean(parts.join(" "));
}

function runFfmpeg(args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const p = spawn(resolveBin("ffmpeg"), args, { stdio: "ignore" });
    p.on("error", (err) => resolve({ ok: false, error: err.message.slice(-400) }));
    p.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `ffmpeg exit ${code}` }));
  });
}

/** Crossfade-stitch 30s Lyria segments into a single bed (single segment is returned as-is). */
async function stitchSegments(segments: GoogleGeneratedAudioAsset[], outPath: string, durationSec: number): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!segments.length) return { ok: false, error: "no Google music segments" };
  if (segments.length === 1) return { ok: true, path: segments[0].path };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const inputs = segments.flatMap((segment) => ["-i", segment.path]);
  const filters: string[] = [];
  let prev = "[0:a]";
  for (let i = 1; i < segments.length; i++) {
    const out = i === segments.length - 1 ? "[a]" : `[a${i}]`;
    filters.push(`${prev}[${i}:a]acrossfade=d=1.25:c1=tri:c2=tri${out}`);
    prev = out;
  }
  const mux = await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[a]",
    "-t", Math.max(1, durationSec).toFixed(2),
    "-c:a", "aac", "-b:a", "192k",
    outPath
  ]);
  return mux.ok ? { ok: true, path: outPath } : { ok: false, error: mux.error };
}

/** Generate (and stitch) a Lyria music bed for the CREATE path. Throws on failure; the caller should catch
 *  and let the renderer fall back to the procedural bed. */
export async function generateLyriaMusicBed(input: LyriaMusicBedInput): Promise<LyriaMusicBed> {
  const apiKey = input.env?.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured for Google Lyria music.");
  const outputDir = path.join(input.outDir, "materials", "audio");
  const adapter = new GoogleAudioAdapter({
    apiKey,
    enabled: true,
    outputDir,
    musicModelId: input.env?.GOOGLE_MUSIC_MODEL ?? "lyria-3-clip-preview"
  });
  const durationSec = Math.max(1, input.durationSec);
  const segmentCount = Math.max(1, Math.ceil(durationSec / 30));
  const segments: GoogleGeneratedAudioAsset[] = [];
  let previousSummary: string | undefined;
  let previousSectionBrief: string | undefined;
  for (let i = 0; i < segmentCount; i++) {
    const prompt = bedPrompt(input, durationSec, i, segmentCount, previousSummary, previousSectionBrief);
    // Lyria intermittently returns no inline audio ("did not include inline audio data") — retry a few
    // times before letting the whole bed fall back to procedural.
    let audio: GoogleGeneratedAudioAsset | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { audio = await adapter.generateMusic({ prompt, durationSec: Math.min(30, Math.max(3, durationSec - i * 30)) }); break; }
      catch (err) { lastErr = err; }
    }
    if (!audio) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    segments.push(audio);
    previousSectionBrief = clean(prompt);
    previousSummary = generatedSummary(audio) ?? previousSummary;
  }
  const stitched = await stitchSegments(segments, path.join(outputDir, `lyria_${input.generationId}_bed.m4a`), durationSec);
  if (!stitched.ok || !stitched.path) throw new Error(`Google Lyria stitch failed: ${stitched.error ?? "unknown"}`);
  const first = segments[0];
  return {
    id: segmentCount === 1 ? first.id : `lyria_${input.generationId}_bed`,
    path: stitched.path,
    provider: "google_lyria_music",
    modelId: String(first.metadata.modelId ?? "lyria-3-clip-preview"),
    segmentCount
  };
}
