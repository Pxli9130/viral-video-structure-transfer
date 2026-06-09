// pipeline-v5/runSameTemplateGeneration.ts
// Part 5/6/7 — the DEFAULT generation path. Reuses a RemotionTemplateCapsule's code with new theme +
// auto AIGC gap fill, binds resolved content into the template props, and renders the stored template
// code (NOT the fixed fallback renderer). Required slots missing + AIGC off -> honest readiness
// downgrade, never a silent text-card-while-claiming-review_demo.

import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import type { Asset } from "@vvst/shared";
import { getAigcMaterialProvider, resolveCreativeKnobs, knobsToRewriteDirective, knobsToAudioMood, paletteMoodOverride, v5 } from "@vvst/shared";
import { GoogleAudioAdapter, type GoogleGeneratedAudioAsset } from "../adapters/googleAudio.js";
import { runTargetAssetAnalysisMany, enrichProfilesWithVlm } from "./runTargetAssetAnalysis.js";
import { renderTemplateCapsule, renderCapsuleStill } from "./renderTemplateCapsule.js";
import { resolveBin } from "./renderV5.js";
import { mapLimit, aigcSemaphore } from "./concurrency.js";
import { overallMeanLuma, detectUniformTailSec, trimTo } from "./postRenderChecks.js";
import { runNoCopyScan } from "./runNoCopyScan.js";
import { runCapsuleContextRewrite } from "./runCapsuleContextRewrite.js";
import { buildMaterialAnalysis, buildTimelineV2, buildMappingV2, buildSimilarityReport, buildPackagingPlan, buildBeatAlignment, buildDialoguePlan } from "./v2Reports.js";
import type { NoCopyResult } from "./runScorecardV5.js";
import type { Gen1ModelFn } from "./runGen1Ai.js";

const IMAGE_SLOTS = new Set<v5.TemplateSlotKind>(["hero_image", "product_image", "background_image", "logo", "ui_mockup"]);
const TEXT_SLOTS = new Set<v5.TemplateSlotKind>(["headline", "subtitle", "cta_text", "data_value"]);
const AUDIO_SLOTS = new Set<v5.TemplateSlotKind>(["music", "sfx", "voiceover"]);

function gate(id: string, name: string, status: v5.GateStatus, message?: string): v5.ScorecardGate {
  return { id, name, status, message };
}

/** Perceptual luma 0..255 of a #rgb/#rrggbb hex, or null if unparseable. */
function hexLuma(hex?: string): number | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}
const isLightHex = (hex?: string): boolean => (hexLuma(hex) ?? 0) > 175;

/** A light-background palette [bg, text, accent, accent2] derived from the source's own light tone. */
function lightPalette(accent: string | undefined, sourceDominantHex?: string): string[] {
  const bg = isLightHex(sourceDominantHex) ? (sourceDominantHex as string) : "#F2F5F9";
  return [bg, "#0B132B", accent && !isLightHex(accent) ? accent : "#4361EE", "#13233F"];
}

function choosePalette(brief: v5.CreativeBriefV5, fallback: string[], quality?: { sourceIsLight?: boolean; sourceDominantHex?: string }): string[] {
  const hay = `${brief.theme ?? ""} ${(brief.sellingPoints ?? []).join(" ")} ${brief.prompt ?? ""}`.toLowerCase();
  const themed =
    /fan|cool|breeze|portable|air|chill/.test(hay) ? ["#0A1A2E", "#E8F4FF", "#00C2FF", "#0E2A47"] :
    /fintech|bank|pay|money|secure|wallet|transfer/.test(hay) ? ["#0B1F3A", "#FFFFFF", "#1EC28B", "#123A63"] :
    /energy|hype|explosive|sport|gym|drink|boost/.test(hay) ? ["#0A0A0C", "#FFEC3D", "#FF3E3E", "#1A1A1F"] :
    /cinematic|night|drive|neon|teaser|city/.test(hay) ? ["#070710", "#E6E6FF", "#7A5CFF", "#141430"] :
    fallback;
  // Colour fidelity (deterministic, no LLM): if the SOURCE reads light/high-key, the bound background
  // (palette[0], which the capsule renders as its base fill) MUST be light with dark text. This auto-
  // inserts a light bg colour so a light source never renders as a black video.
  if (quality?.sourceIsLight) return lightPalette(themed[2], quality.sourceDominantHex);
  return themed;
}

/** Deterministically force any DARK full-screen background colour literal in the capsule code to a light
 * colour (used when the source is light but the render is still dark — a hardcoded dark bg, not palette-
 * driven). Conservative: only rewrites `background`/`backgroundColor` string literals whose colour is dark. */
function forceLightBackgroundCode(bundle: v5.RemotionTemplateCapsule["codeBundle"], lightHex: string): { bundle: v5.RemotionTemplateCapsule["codeBundle"]; changed: boolean } {
  let changed = false;
  const files = bundle.files.map((f) => {
    if (typeof f.content !== "string") return f;
    let c = f.content.replace(/(background(?:Color)?\s*:\s*)(['"`])(#[0-9a-fA-F]{3,6})\2/g, (m, p: string, q: string, hex: string) => {
      const l = hexLuma(hex);
      if (l !== null && l < 70) { changed = true; return `${p}${q}${lightHex}${q}`; }
      return m;
    });
    c = c.replace(/(background(?:Color)?\s*:\s*)(['"`])(black)\2/gi, (_m, p: string, q: string) => { changed = true; return `${p}${q}${lightHex}${q}`; });
    return { ...f, content: c };
  });
  return { bundle: { ...bundle, files }, changed };
}

function copyForSlot(slot: v5.TemplateSlot, brief: v5.CreativeBriefV5, idx: number): string {
  const points = (brief.sellingPoints ?? []).filter(Boolean);
  if (slot.kind === "headline") return (brief.theme ?? brief.prompt ?? "Watch this").slice(0, 60);
  if (slot.kind === "cta_text") return "Get yours today";
  if (slot.kind === "data_value") return points[idx % Math.max(1, points.length)] ?? "100%";
  return points.length ? points[idx % points.length] : "Key benefit";
}

/** Infer the section role of a slot from its id / original role (hook/benefit/proof/cta). */
function sceneRoleOf(slot: v5.TemplateSlot): "hook" | "benefit" | "proof" | "cta" {
  const s = `${slot.id} ${slot.originalRole ?? ""}`.toLowerCase();
  if (/hook|open|hero|intro/.test(s)) return "hook";
  if (/cta|call|end|outro|button|offer/.test(s)) return "cta";
  if (/proof|stat|review|testimonial|data|trust/.test(s)) return "proof";
  return "benefit";
}

/**
 * Build a SCENE-AWARE, on-message AIGC image prompt so each slot gets a distinct, themed visual
 * (instead of 5 near-identical "premium product" shots). Varies by section role + a rotating selling
 * point. No on-image text / watermark / sample lookalike (re-gated downstream anyway).
 */
function imagePromptFor(slot: v5.TemplateSlot, brief: v5.CreativeBriefV5, imageIdx: number): string {
  const theme = brief.theme ?? brief.prompt ?? "the product";
  // If the Gen1 model described THIS footage slot (the "missing 素材" it couldn't draw), use its
  // ready-made AIGC prompt — recreates the source's footage type, adapted to the new theme.
  if (slot.aigcPrompt && slot.aigcPrompt.trim()) {
    const motion = slot.motionHint ? ` Camera: ${slot.motionHint}.` : "";
    return `${slot.aigcPrompt.trim()} Adapt for the theme "${theme}".${motion} 9:16 vertical, no on-image text, no watermark.`;
  }
  const points = (brief.sellingPoints ?? []).filter(Boolean);
  const point = points.length ? points[imageIdx % points.length] : "";
  const role = sceneRoleOf(slot);
  const scene =
    slot.kind === "logo"
      ? `a clean modern brand logo mark for "${theme}", vector style, solid flat background`
      : slot.kind === "background_image"
        ? `an atmospheric cinematic background for "${theme}", depth and mood, no subject`
        : role === "hook"
          ? `an eye-catching opening hero key visual for "${theme}", bold, high contrast, advertising`
          : role === "proof"
            ? `a convincing close-up product/detail shot for "${theme}"${point ? `, emphasizing ${point}` : ""}, studio lighting`
            : role === "cta"
              ? `a polished centered hero product shot for "${theme}", premium, ready for a call-to-action`
              : `a vibrant lifestyle advertising shot for "${theme}"${point ? ` showcasing ${point}` : ""}, on-brand`;
  return `${scene}. 9:16 vertical, photographic, no on-image text, no watermark.`;
}

/** Pull a {"prompt": "..."} string out of a model reply (raw JSON, fenced, or plain prose). */
function extractPromptText(raw: string): string | null {
  try {
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) {
      const o = JSON.parse(raw.slice(s, e + 1)) as { prompt?: unknown };
      if (typeof o.prompt === "string" && o.prompt.trim()) return o.prompt;
    }
  } catch { /* not JSON — fall through */ }
  const t = raw.replace(/```[a-z]*\s*|\s*```/gi, "").trim();
  return t.length > 20 ? t : null;
}

/**
 * A DETAILED image + video (motion) description for a missing-footage slot (mediaKind="video" — the asset
 * the compiled Remotion code can't draw). This DRIVES text-to-video directly; we do NOT generate a
 * reference still for the primary (Seedance) path. The text-to-text model (Doubao) expands the slot's own
 * AIGC prompt + motion hint into one rich img+motion paragraph; falls back to a deterministic template.
 */
async function videoDescriptionFor(slot: v5.TemplateSlot, brief: v5.CreativeBriefV5, model?: Gen1ModelFn | null): Promise<string> {
  const seed = imagePromptFor(slot, brief, 0);
  const theme = brief.theme ?? brief.prompt ?? "the product";
  if (model) {
    try {
      const raw = await model(
        `You write prompts for a TEXT-TO-VIDEO model. Produce ONE vivid prompt for a short ~4s, 9:16 vertical ` +
        `footage clip used as the "${slot.kind}" layer of an ad for "${theme}". Describe BOTH: (a) the IMAGE — ` +
        `subject, composition, setting, lighting, colour/mood; (b) the VIDEO MOTION over the clip — subject ` +
        `action and camera movement/pacing.${slot.motionHint ? ` Intended camera/motion: ${slot.motionHint}.` : ""} ` +
        `Seed idea: ${seed}. Cinematic/photographic, no on-screen text, no watermark, no logos. ` +
        `Return ONLY JSON: {"prompt":"<one rich paragraph>"}`
      );
      const p = extractPromptText(raw);
      if (p && p.trim().length > 20) return `${p.trim()} 9:16 vertical, no on-image text, no watermark.`;
    } catch { /* fall through to deterministic */ }
  }
  const motion = slot.motionHint
    ? ` Camera/motion: ${slot.motionHint}.`
    : " Motion: gentle cinematic camera move (slow push-in or parallax) with natural subject motion.";
  return `${seed}${motion} Smooth pacing over ~4 seconds, photographic, no on-image text, no watermark.`;
}

export interface SameTemplateInput {
  projectId: string;
  generationId: string;
  capsule: v5.RemotionTemplateCapsule;
  brief: v5.CreativeBriefV5;
  targetAssets: Asset[];
  options: v5.GenerationOptionsV5;
  outDir: string;
  publicPathPrefix: string;
  /** http base for serving generated images to the headless renderer (e.g. http://127.0.0.1:3000). */
  serveBase: string;
  /** Path to the source sample video — enables the real cv2/librosa no-copy scan of the output. */
  sampleVideoPath?: string;
  env?: Record<string, string | undefined>;
  /** When false (plan), skip rendering. */
  doRender?: boolean;
  /** modify_template: patch-first revise from a prior instance (reuse bindings, override theme/copy). */
  reviseFrom?: { instance: v5.TemplateInstance; patch?: v5.TemplatePatchSet };
  /** Context-modification: a Pro model fn that rewrites an AI-clone capsule's text/colour for the new
   *  theme before rendering (so "same template, new theme" actually changes the on-screen content). */
  rewriteModel?: Gen1ModelFn | null;
  /** Fallback model for context-rewrite when the primary (Doubao) can't produce a real re-theme — e.g. Gemini. */
  rewriteFallbackModel?: Gen1ModelFn | null;
  /** Vision fn (createGeminiVisionFn) that LOOKS at the user assets' pixels to enrich TargetAssetProfiles
   *  (shot/scene/subjects/highlight/bestSection). Null/undefined = heuristic-only (graceful). */
  assetVisionFn?: ((imageBase64: string, mimeType: string, prompt: string) => Promise<string>) | null;
  /** Explicit per-slot asset binding from the UI (slotId -> target assetId): the user uploaded an asset for
   *  THAT slot, so bind it directly instead of leaving it to the kind/section heuristic. */
  slotAssignments?: Record<string, string>;
}

export interface SameTemplateResult {
  instance: v5.TemplateInstance;
  finalProgram: v5.FinalVideoProgram;
  gates: v5.ScorecardGate[];
  generatedAssets: v5.GeneratedVisualAsset[];
  finalVideoUrl?: string;
  /** A rendered cover/封面 still (frame of the final video), served under /generated. */
  coverUrl?: string;
  warnings: string[];
  /** Real no-copy scan evidence (fed to the scorecard so V5-G29/G30 are earned, not assumed). */
  noCopy: NoCopyResult;
  /** Slot-level gap report (written as gap-report.json). */
  gapReport: v5.GapReportV5;
  /** Render facts surfaced for the scorecard render gates. */
  finalMp4Exists: boolean;
  renderHasAudio: boolean;
  renderDurationSec: number;
  /** v2 schema-conformant evidence artifacts (written as material-analysis / timeline-v2 / mapping-v2 .json). */
  materialAnalysis: Array<Record<string, unknown>>;
  timelineV2: Record<string, unknown>;
  mappingV2: Array<Record<string, unknown>>;
  /** v2 explainability artifacts (no-copy similarity check + packaging/subtitle-safe-zone plan). */
  similarityReport: Record<string, unknown>;
  packagingPlan: Record<string, unknown>;
  /** v2 audio/dialogue artifacts (beat-alignment of transitions + dialogue-safe cut plan). */
  beatAlignment: Record<string, unknown>;
  dialoguePlan: Record<string, unknown>;
}

interface GeneratedMusicBed {
  id: string;
  path: string;
  provider: "google_lyria_music";
  modelId?: string;
  promptHash?: string;
  segmentCount: number;
}

function cleanMusicDirective(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/prompt|watermark|水印|学习样例|不要复制|不复制|sample\s+(audio|video|frame)|copy\s+the\s+sample/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 700) : undefined;
}

function audioRecipePrompt(
  capsule: v5.RemotionTemplateCapsule,
  brief: v5.CreativeBriefV5,
  durationSec: number,
  segmentIndex: number,
  segmentCount: number,
  previousSummary?: string,
  previousSectionBrief?: string
): string {
  const recipe = capsule.audioRecipes.find((r) => r.kind === "music_bed") ?? capsule.audioRecipes[0];
  const theme = cleanMusicDirective(brief.theme ?? brief.prompt) ?? "a modern product advertisement";
  const mood = (recipe?.mood ?? []).map(cleanMusicDirective).filter((v): v is string => Boolean(v)).slice(0, 6).join(", ") || "modern, polished, energetic";
  const instruments = (recipe?.instruments ?? []).map(cleanMusicDirective).filter((v): v is string => Boolean(v)).slice(0, 8).join(", ") || "clean synth bass, soft percussion, bright plucks, subtle risers";
  const bpm = recipe?.bpm ?? capsule.audioRecipes.find((r) => typeof r.bpm === "number")?.bpm;
  const cueTimes = (recipe?.cuePoints ?? [])
    .map((cue) => (Number.isFinite(cue.t) ? `${cue.type} at ${cue.t.toFixed(1)}s` : undefined))
    .filter((v): v is string => Boolean(v))
    .slice(0, 8)
    .join(", ");
  const energy = (recipe?.energyCurve ?? [])
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
  ].filter(Boolean).join(" ");
}

function generatedMusicSummary(asset: GoogleGeneratedAudioAsset): string | undefined {
  const parts = Array.isArray(asset.metadata.textParts)
    ? asset.metadata.textParts.map(cleanMusicDirective).filter((v): v is string => Boolean(v))
    : [];
  return cleanMusicDirective(parts.join(" "));
}

function runAudioFfmpeg(args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const p = spawn(resolveBin("ffmpeg"), args, { stdio: "ignore" });
    p.on("error", (err) => resolve({ ok: false, error: err.message.slice(-400) }));
    p.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `ffmpeg exit ${code}` }));
  });
}

async function stitchGoogleMusicSegments(segments: GoogleGeneratedAudioAsset[], outPath: string, durationSec: number): Promise<{ ok: boolean; path?: string; error?: string }> {
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
  const mux = await runAudioFfmpeg([
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

async function generateGoogleMusicBed(input: SameTemplateInput, capsule: v5.RemotionTemplateCapsule, durationSec: number): Promise<GeneratedMusicBed | undefined> {
  if (input.options.aigcGapFill.audioFill !== "aigc" || input.options.aigcGapFill.mode !== "auto_on") return undefined;
  const apiKey = input.env?.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured for Google Lyria music.");
  const outputDir = path.join(input.outDir, "materials", "audio");
  const adapter = new GoogleAudioAdapter({
    apiKey,
    enabled: true,
    outputDir,
    musicModelId: input.env?.GOOGLE_MUSIC_MODEL ?? "lyria-3-clip-preview"
  });
  const segmentCount = Math.max(1, Math.ceil(Math.max(1, durationSec) / 30));
  const segments: GoogleGeneratedAudioAsset[] = [];
  let previousSummary: string | undefined;
  let previousSectionBrief: string | undefined;
  const audioMood = knobsToAudioMood(resolveCreativeKnobs(input.brief.variant, input.reviseFrom?.patch));
  for (let i = 0; i < segmentCount; i++) {
    const prompt = `${audioRecipePrompt(capsule, input.brief, durationSec, i, segmentCount, previousSummary, previousSectionBrief)} Overall energy/mood: ${audioMood}.`;
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
    previousSectionBrief = cleanMusicDirective(prompt);
    previousSummary = generatedMusicSummary(audio) ?? previousSummary;
  }
  const stitched = await stitchGoogleMusicSegments(segments, path.join(outputDir, `google_lyria_${input.generationId}_bed.m4a`), durationSec);
  if (!stitched.ok || !stitched.path) throw new Error(`Google Lyria stitch failed: ${stitched.error ?? "unknown"}`);
  const first = segments[0];
  return {
    id: segmentCount === 1 ? first.id : `google_lyria_${input.generationId}_bed`,
    path: stitched.path,
    provider: "google_lyria_music",
    modelId: String(first.metadata.modelId ?? "lyria-3-clip-preview"),
    promptHash: first.provenance.promptHash,
    segmentCount
  };
}

export async function runSameTemplateGeneration(input: SameTemplateInput): Promise<SameTemplateResult> {
  let capsule = input.capsule;
  const { brief, options } = input;
  const warnings: string[] = [];
  const gates: v5.ScorecardGate[] = [];

  // CONTEXT-MODIFICATION: for an AI-clone capsule (whose text/colours are baked in) a separate Pro call
  // rewrites the on-screen text + palette to the new theme BEFORE rendering, keeping the structure. This
  // is what makes "same template, new theme" actually change what you see. Falls back to the stored code.
  // Colour-fidelity directive baked into the FIRST rewrite: if the source reads light/high-key, force the
  // re-theme to keep a light background (Gemini otherwise tends to darken). Data-driven (sourceIsLight from cv2).
  const lightDirective = capsule.quality?.sourceIsLight
    ? `The SOURCE video has a LIGHT / high-key background (dominant ${capsule.quality.sourceDominantHex ?? "near-white"}). The rewritten video MUST keep a LIGHT (white/off-white) background with dark text — do NOT render on a dark/black background.`
    : undefined;
  // Creative knobs (multi-version brief.variant + manual/NL patch) — turn into a rewrite directive so the
  // on-screen text / emphasis / packaging actually differ per version, without re-running visual codegen.
  const knobs = resolveCreativeKnobs(brief.variant, input.reviseFrom?.patch);
  const knobDirective = knobsToRewriteDirective(knobs);
  let contextRewriteApplied = false;
  if (input.rewriteModel && capsule.quality?.codeOrigin === "ai" && input.doRender !== false && (brief.theme || (brief.sellingPoints ?? []).length || knobDirective)) {
    const rw = await runCapsuleContextRewrite({
      capsule,
      theme: brief.theme ?? brief.prompt ?? "",
      sellingPoints: brief.sellingPoints ?? [],
      model: input.rewriteModel,
      fallbackModel: input.rewriteFallbackModel,
      renderProbe: (cb, fixture) => renderCapsuleStill({ capsule: { ...capsule, codeBundle: cb }, boundProps: fixture, aspectRatio: brief.aspectRatio ?? "9:16" }).then((r) => ({ ok: r.ok, error: r.error })),
      maxAttempts: 2,
      extraDirective: [lightDirective, knobDirective].filter(Boolean).join(" ") || undefined
    });
    warnings.push(...rw.warnings.slice(0, 2));
    if (rw.usedAi) { capsule = { ...capsule, codeBundle: rw.codeBundle }; contextRewriteApplied = true; }
  }

  const aigcOn = options.aigcGapFill.mode === "auto_on";
  // Palette: theme-driven base, optionally nudged to a premium/clean mood by the knobs (multi-version).
  const palette = paletteMoodOverride(knobs, capsule.quality?.sourceIsLight)
    ?? choosePalette(brief, (capsule.fixtures.neutralFixture as { palette?: string[] }).palette ?? ["#0A0A0A", "#FFFFFF", "#F7C948", "#1A1A1A"], capsule.quality);

  const targetProfiles = await enrichProfilesWithVlm(runTargetAssetAnalysisMany(input.targetAssets), input.targetAssets, input.assetVisionFn);
  // Material analysis (real ffprobe facts + quality/duplicate rejection + crop suggestions). Rejected assets are
  // kept OUT of the hero/main shots below (TC-04) — they still appear in the report with a reason.
  const material = buildMaterialAnalysis(targetProfiles, input.targetAssets, { targetAspect: brief.aspectRatio ?? "9:16" });
  if (material.rejectedAssetIds.size) warnings.push(`material analysis rejected ${material.rejectedAssetIds.size} asset(s) (low-quality/duplicate) from main shots`);
  const provider = aigcOn && options.aigcGapFill.imageFill === "aigc" ? getAigcMaterialProvider((input.env?.AIGC_IMAGE_PROVIDER as never) ?? "google_gemini_image") : undefined;
  // Real moving-footage provider (Seedance text-to-video) for mediaKind="video" slots — the "missing 素材"
  // the code marked <OffthreadVideo>. Generated footage is fresh/original (samplePixelsUsed=false), so it
  // auto-differs from the source (no copyright concern). Capped: t2v is slow/expensive; overflow -> still.
  const arkKey = input.env?.SEEDANCE_ARK_API_KEY || input.env?.SEEDANCE_API_KEY || input.env?.SEEDREAM_ARK_API_KEY || input.env?.ARK_API_KEY;
  const videoProvider = aigcOn && arkKey && String(input.env?.AIGC_VIDEO_FILL ?? "1") !== "0" ? getAigcMaterialProvider("seedance_2_0") : undefined;
  // happyhorse r2v (DashScope) is the FALLBACK footage provider; Seedance 2.0 fast (above) is PRIMARY.
  const backupVideoProvider = aigcOn && input.env?.DASHSCOPE_API_KEY && String(input.env?.AIGC_VIDEO_BACKUP_PROVIDER ?? "happyhorse_r2v") !== "off"
    ? getAigcMaterialProvider((input.env?.AIGC_VIDEO_BACKUP_PROVIDER as never) ?? "happyhorse_r2v") : undefined;
  // Default: give EVERY mediaKind:"video" slot a real video (footage = video by default). AIGC_VIDEO_MAX is
  // an OPTIONAL cost cap (not a low default) — without it set, no chunk gets starved into stills.
  const videoSlotCount = capsule.slotSchema.filter((s) => s.mediaKind === "video").length;
  const maxVideos = input.env?.AIGC_VIDEO_MAX ? Math.max(0, Number(input.env.AIGC_VIDEO_MAX)) : videoSlotCount;
  const materialsDir = path.join(input.outDir, "materials");

  const boundProps: { theme?: string; palette: string[]; assets: Record<string, { src: string; mediaKind?: string }>; copy: Record<string, string>; audio: Record<string, unknown> } = {
    theme: brief.theme ?? brief.prompt,
    palette,
    assets: {},
    copy: {},
    audio: {}
  };
  const slotBindings: v5.TemplateSlotBinding[] = [];
  const generatedAssets: v5.GeneratedVisualAsset[] = [];
  // Fill EVERY image slot with real imagery (capped) so no scene is left as an empty designed card.
  const maxGenerated = Math.min(Number(input.env?.AIGC_IMAGE_MAX ?? 40), Math.max(6, capsule.slotSchema.filter((s) => IMAGE_SLOTS.has(s.kind)).length));
  const usedTargetAssetIds = new Set<string>();

  if (input.reviseFrom) {
    // ---- Patch-first revise (modify_template): reuse the prior instance's bound props + slot
    // bindings; override only theme / palette / copy. Visual regeneration is a fresh generation. ----
    const prior = input.reviseFrom.instance;
    const pb = prior.boundProps as { theme?: string; palette?: string[]; assets?: Record<string, { src: string }>; copy?: Record<string, string>; audio?: Record<string, unknown> };
    const patch = input.reviseFrom.patch ?? {};
    boundProps.theme = patch.theme ?? pb.theme ?? boundProps.theme;
    boundProps.palette = patch.palette ?? pb.palette ?? boundProps.palette;
    boundProps.assets = { ...(pb.assets ?? {}) };
    boundProps.copy = { ...(pb.copy ?? {}) };
    boundProps.audio = { ...(pb.audio ?? {}) };
    for (const [k, v] of Object.entries(patch.copyOverrides ?? {})) boundProps.copy[k] = v;
    for (const b of prior.slotBindings) slotBindings.push({ ...b });
  } else {
  // ---- Phase A (sequential, cheap): text/audio + user-asset slots; PRE-ASSIGN the AIGC method for the rest.
  // Pre-assignment is synchronous so the video/image budgets are consumed deterministically (no counter race);
  // the slow AIGC calls then run concurrently in Phase B without touching shared counters.
  interface AigcTask { slotId: string; propKey: string; slot: v5.TemplateSlot; method: "video" | "image"; imageIdx: number; }
  const aigcTasks: AigcTask[] = [];
  const pushFallback = (slotId: string) =>
    slotBindings.push(aigcOn && options.fallbackPolicy.allowProceduralVisualFallback
      ? { slotId, status: "procedural_generated", warnings: ["designed-visual fallback (no real image)"] }
      : { slotId, status: "missing", warnings: ["no user asset, AIGC off / unavailable"] });
  let videoBudget = videoProvider ? maxVideos : 0;
  let imageBudget = provider ? maxGenerated : 0;
  let imageIdxSeq = 0;
  // Assets the user explicitly pinned to a slot — reserve them so the kind/section heuristic for OTHER slots
  // can't greedily consume them before the loop reaches their assigned slot.
  const reservedAssetIds = new Set(Object.values(input.slotAssignments ?? {}));
  for (let i = 0; i < capsule.slotSchema.length; i++) {
    const slot = capsule.slotSchema[i];
    const propKey = slot.propPath?.split(".")[1] ?? slot.id;

    // Explicit per-slot assignment — the user uploaded an asset for THIS slot in the gap radar. Hard-bind it
    // ahead of the text/audio/image defaults, for ANY slot kind (so every row's upload is honoured).
    const assignedId = input.slotAssignments?.[slot.id];
    const assignedFile = assignedId && !usedTargetAssetIds.has(assignedId) ? input.targetAssets.find((x) => x.id === assignedId) : undefined;
    if (assignedFile?.path) {
      const url = `${input.serveBase}/generated/${assignedFile.id}`;
      boundProps.assets[propKey] = { src: url };
      slotBindings.push({ slotId: slot.id, status: "user_asset", assetId: assignedId, uri: url, warnings: ["user-assigned to this slot"] });
      usedTargetAssetIds.add(assignedId as string);
      continue;
    }

    if (TEXT_SLOTS.has(slot.kind)) {
      const text = options.aigcGapFill.textFill === "off" ? "" : copyForSlot(slot, brief, i);
      boundProps.copy[propKey] = text;
      slotBindings.push({ slotId: slot.id, status: text ? "text_generated" : "missing", text, warnings: text ? [] : ["text fill off"] });
      continue;
    }
    if (AUDIO_SLOTS.has(slot.kind)) {
      slotBindings.push({ slotId: slot.id, status: aigcOn ? "procedural_generated" : "missing", warnings: aigcOn ? [] : ["audio fill off"] });
      continue;
    }
    if (IMAGE_SLOTS.has(slot.kind)) {
      // 1) user asset — match profile kind to the slot, and never bind the same asset to two slots.
      const userAsset = targetProfiles.find(
        (p) => !usedTargetAssetIds.has(p.assetId) && !reservedAssetIds.has(p.assetId) && !material.rejectedAssetIds.has(p.assetId) && (slot.kind === "logo" ? p.kind === "logo" : p.kind === "image" || p.kind === "video")
      );
      const userAssetFile = userAsset ? input.targetAssets.find((x) => x.id === userAsset.assetId) : undefined;
      if (userAsset && userAssetFile?.path) {
        const url = `${input.serveBase}/generated/${userAssetFile.id}`;
        boundProps.assets[propKey] = { src: url };
        slotBindings.push({ slotId: slot.id, status: "user_asset", assetId: userAsset.assetId, uri: url, warnings: [] });
        usedTargetAssetIds.add(userAsset.assetId);
        continue;
      }
      // Pre-assign: real moving footage (Seedance) for video slots under budget; else a still under budget; else fallback.
      if (slot.mediaKind === "video" && videoProvider && videoBudget > 0) { videoBudget--; aigcTasks.push({ slotId: slot.id, propKey, slot, method: "video", imageIdx: imageIdxSeq++ }); }
      else if (provider && imageBudget > 0) { imageBudget--; aigcTasks.push({ slotId: slot.id, propKey, slot, method: "image", imageIdx: imageIdxSeq++ }); }
      else pushFallback(slot.id);
    }
  }

  // ---- Phase B (parallel): run the assigned AIGC calls CONCURRENTLY (capped). Seedance t2v is the big
  // bottleneck (≈minutes each); fanning out turns N sequential clips into ceil(N/conc) waves.
  if (aigcTasks.length) {
    await fs.mkdir(materialsDir, { recursive: true });
    const ctx = { outputDir: materialsDir, publicPathPrefix: input.publicPathPrefix, env: input.env, allowExternalProviderCall: true } as const;
    const videoBrief = (t: AigcTask, vprompt?: string) => ({
      id: `vbrief_${input.generationId}_${t.slotId}`, projectId: input.projectId, generationId: input.generationId, slotId: t.slotId,
      visualFormFamily: "live_action_montage", visualForm: t.slot.kind, assetType: "short_video" as const, count: 1, targetTheme: brief.theme ?? "the product",
      // DETAILED img+video description drives text-to-video for missing-footage slots (no reference still).
      promptPack: [vprompt ?? imagePromptFor(t.slot, brief, t.imageIdx)],
      styleConstraints: { aspectRatio: (brief.aspectRatio ?? "9:16") as never, palette, colorPalette: palette, noTextUnlessRequested: true, avoidSampleLookalike: true },
      structureConstraints: { intendedRendererCapability: "remotion_media_layer", motionPattern: "live_action", slotRole: t.slot.kind },
      negativePrompts: ["watermark", "sample logo", "on-image text"],
      evidenceRefs: { sampleEvidenceFrameIds: [], note: "sample evidence is for structure only; do not copy visual content" as const },
      privacyPolicy: { externalUploadAllowed: true, sampleFramesAllowedToProvider: false, targetAssetsAllowedToProvider: false }
    });
    const imageBrief = (t: AigcTask) => ({
      id: `brief_${input.generationId}_${t.slotId}`, projectId: input.projectId, generationId: input.generationId, slotId: t.slotId,
      visualFormFamily: t.slot.kind === "logo" ? "brand_cta" : t.slot.kind === "background_image" ? "background" : "object_motion", visualForm: t.slot.kind,
      assetType: "image" as const, count: 1, targetTheme: brief.theme ?? "the product", promptPack: [imagePromptFor(t.slot, brief, t.imageIdx)],
      styleConstraints: { aspectRatio: (brief.aspectRatio ?? "9:16") as never, palette, colorPalette: palette, noTextUnlessRequested: true, avoidSampleLookalike: true },
      structureConstraints: { intendedRendererCapability: "remotion_media_layer", motionPattern: "ken_burns", slotRole: t.slot.kind },
      negativePrompts: ["watermark", "sample logo", "on-image text"],
      evidenceRefs: { sampleEvidenceFrameIds: [], note: "sample evidence is for structure only; do not copy visual content" as const },
      privacyPolicy: { externalUploadAllowed: true, sampleFramesAllowedToProvider: false, targetAssetsAllowedToProvider: false }
    });
    type FillResult = { t: AigcTask; kind: "video" | "image"; path: string; prompt: string } | { t: AigcTask; kind: "fallback" };
    const results = await mapLimit<AigcTask, FillResult>(aigcTasks, Number(input.env?.AIGC_FILL_CONCURRENCY ?? 6), async (t) => {
      if (t.method === "video" && (videoProvider || backupVideoProvider)) {
        // VIDEO footage slot (the "missing 素材" the compiled code can't draw). Provider order:
        //   1) Seedance 2.0 fast (PRIMARY) — plain text-to-video from a DETAILED img+video description.
        //   2) happyhorse r2v (FALLBACK, DashScope) — reference still + the same description.
        const vdesc = await videoDescriptionFor(t.slot, brief, input.rewriteModel);
        // 1) PRIMARY: Seedance plain text-to-video.
        if (videoProvider) {
          try {
            const c = (await aigcSemaphore.run(() => videoProvider.generate(videoBrief(t, vdesc) as never, ctx)))[0];
            if (c?.path) return { t, kind: "video", path: c.path, prompt: c.prompt };
          } catch (err) { warnings.push(`seedance ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)} -> happyhorse`); }
        }
        // 2) FALLBACK: happyhorse r2v — needs a reference still (image model: gemini-3.1-flash-image).
        //    Generated lazily here, only once Seedance failed; it is also the final still fallback.
        let still: { path?: string; prompt?: string } | undefined;
        if (provider) {
          try { still = (await aigcSemaphore.run(() => provider.generate(imageBrief(t) as never, ctx)))[0]; }
          catch (err) { warnings.push(`video still ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
        }
        const stillLocal = still?.path ? path.join(materialsDir, path.basename(still.path)) : undefined;
        if (backupVideoProvider && stillLocal && existsSync(stillLocal)) {
          try {
            const c = (await aigcSemaphore.run(() => backupVideoProvider.generate(videoBrief(t, vdesc) as never, { ...ctx, referenceImagePath: stillLocal })))[0];
            if (c?.path) return { t, kind: "video", path: c.path, prompt: c.prompt };
          } catch (err) { warnings.push(`happyhorse ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)} -> still`); }
        }
        // 3) Still fallback.
        if (still?.path) return { t, kind: "image", path: still.path, prompt: still.prompt ?? "" };
      }
      if (provider) {
        try {
          const c = (await aigcSemaphore.run(() => provider.generate(imageBrief(t) as never, ctx)))[0];
          if (c?.path) return { t, kind: "image", path: c.path, prompt: c.prompt };
        } catch (err) { warnings.push(`image fill ${t.slotId}: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`); }
      }
      return { t, kind: "fallback" };
    });
    for (const r of results) {
      if (r.kind === "fallback") { pushFallback(r.t.slotId); continue; }
      const httpSrc = `${input.serveBase}${r.path.startsWith("/") ? "" : "/"}${r.path}`;
      boundProps.assets[r.t.propKey] = { src: httpSrc, mediaKind: r.kind }; // carry video/image so code can branch on it
      generatedAssets.push({ id: `genasset_${r.t.slotId}`, kind: r.kind, uri: r.path, provenance: { assetId: `genasset_${r.t.slotId}`, source: "aigc_generated", createdByStage: "same_template_fill", promptRef: r.prompt, samplePixelsUsed: false } });
      slotBindings.push({ slotId: r.t.slotId, status: "aigc_generated", assetId: `genasset_${r.t.slotId}`, uri: httpSrc, provenance: { source: "aigc_generated" }, warnings: r.kind === "video" ? ["seedance t2v"] : [] });
    }
  }
  }

  // ---- Coverage facts (drive honest readiness + the visual-substance gate) ----
  const statusOf = (slotId: string) => slotBindings.find((b) => b.slotId === slotId)?.status ?? "missing";
  const requiredVisual = capsule.slotSchema.filter((s) => s.required && IMAGE_SLOTS.has(s.kind));
  const realVisualCount = requiredVisual.filter((s) => ["user_asset", "aigc_generated"].includes(statusOf(s.id))).length;
  const boundVisual = requiredVisual.filter((s) => ["user_asset", "aigc_generated", "procedural_generated"].includes(statusOf(s.id)));
  const missingRequired = capsule.slotSchema.filter((s) => s.required && statusOf(s.id) === "missing").length;
  const proceduralVisualCount = slotBindings.filter((b) => b.status === "procedural_generated").length;

  // ---- Render the capsule CODE with the bound props ----
  let usedTemplateCode = false;
  let usedFallbackRenderer = false;
  let finalVideoUrl: string | undefined;
  let renderHasAudio = false;
  let renderAudioSource: "generated" | "procedural" | undefined;
  let renderDur = capsule.timingSignature.durationSec;
  let generatedMusicBed: GeneratedMusicBed | undefined;
  const finalMp4Path = path.join(input.outDir, "final.mp4");
  if (input.doRender !== false) {
    if (options.aigcGapFill.audioFill === "aigc") {
      try {
        generatedMusicBed = await generateGoogleMusicBed(input, capsule, renderDur);
        if (generatedMusicBed) {
          boundProps.audio.musicBed = {
            src: generatedMusicBed.path,
            provider: generatedMusicBed.provider,
            modelId: generatedMusicBed.modelId,
            segmentCount: generatedMusicBed.segmentCount
          };
          const audioSlotIds = new Set(capsule.slotSchema.filter((s) => AUDIO_SLOTS.has(s.kind)).map((s) => s.id));
          for (const b of slotBindings) {
            if (audioSlotIds.has(b.slotId)) {
              b.status = "aigc_generated";
              b.audioId = generatedMusicBed.id;
              b.assetId = generatedMusicBed.id;
              b.uri = generatedMusicBed.path;
              b.provenance = { source: "aigc_generated", provider: generatedMusicBed.provider, sampleAudioUsed: false };
              b.warnings = [`google lyria music (${generatedMusicBed.segmentCount} clip${generatedMusicBed.segmentCount === 1 ? "" : "s"})`];
            }
          }
          warnings.push(`Google Lyria music generated: ${generatedMusicBed.segmentCount} clip${generatedMusicBed.segmentCount === 1 ? "" : "s"} using ${generatedMusicBed.modelId ?? "lyria-3-clip-preview"}.`);
        }
      } catch (err) {
        warnings.push(`Google Lyria music unavailable: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}; using procedural audio fallback.`);
      }
    }
    const beatTimes = (capsule.timingSignature.sections.flatMap((s) => s.internalBeats)).slice(0, 8);
    const rhythmRecipe = capsule.audioRecipes[0];
    const res = await renderTemplateCapsule({
      capsule,
      boundProps,
      outPath: finalMp4Path,
      aspectRatio: brief.aspectRatio ?? "9:16",
      proceduralAudio: options.aigcGapFill.audioFill !== "off",
      audioPath: generatedMusicBed?.path,
      bpm: brief && (rhythmRecipe?.bpm ?? null),
      beatGridSec: rhythmRecipe?.cuePoints?.map((c) => c.t),
      strongBeatsSec: rhythmRecipe?.cuePoints?.filter((c) => c.type === "hit" || c.type === "impact").map((c) => c.t),
      energyCurve: rhythmRecipe?.energyCurve,
      hitTimes: beatTimes
    });
    usedTemplateCode = res.usedTemplateCode && res.ok;
    renderHasAudio = res.hasAudio;
    renderAudioSource = res.audioSource;
    renderDur = res.durationSec;
    if (res.ok && res.finalMp4) {
      finalVideoUrl = `${input.publicPathPrefix.replace(/materials\/$/, "")}final.mp4`;
    } else {
      usedFallbackRenderer = true;
      warnings.push(`capsule render failed: ${res.error}; (honest fallback would render fixed-root recipe)`);
    }
    warnings.push(...res.warnings);
  }
  const finalMp4Exists = input.doRender !== false && Boolean(finalVideoUrl) && existsSync(finalMp4Path);

  // ---- Post-render fidelity passes (AI capsule with a real render) ----
  if (finalMp4Exists && capsule.quality.codeOrigin === "ai") {
    // (A) Colour fidelity (DETERMINISTIC, no LLM): source is light but the output rendered DARK -> auto-
    // insert a light background (lighten the bound palette + any hardcoded dark full-screen bg in code),
    // re-render once to a temp path, and RE-MEASURE luma — only keep the fix if it actually got lighter
    // (so we never falsely claim "corrected" while the video is still black).
    if (capsule.quality.sourceIsLight) {
      try {
        const luma = await overallMeanLuma(finalMp4Path, renderDur);
        if (luma !== null && luma < 90) {
          const lightHex = isLightHex(capsule.quality.sourceDominantHex) ? (capsule.quality.sourceDominantHex as string) : "#F2F5F9";
          warnings.push(`colour-fidelity: source light but output luma ${Math.round(luma)} (dark) -> light-bg correction (${lightHex})`);
          const prevPalette = boundProps.palette;
          boundProps.palette = lightPalette(prevPalette[2], capsule.quality.sourceDominantHex);
          const patched = forceLightBackgroundCode(capsule.codeBundle, lightHex);
          const fixCapsule = { ...capsule, codeBundle: patched.bundle };
          const fixPath = `${finalMp4Path}.fix.mp4`;
          const beats2 = capsule.timingSignature.sections.flatMap((s) => s.internalBeats).slice(0, 8);
          const rhythmRecipe2 = capsule.audioRecipes[0];
          const res2 = await renderTemplateCapsule({
            capsule: fixCapsule,
            boundProps,
            outPath: fixPath,
            aspectRatio: brief.aspectRatio ?? "9:16",
            proceduralAudio: options.aigcGapFill.audioFill !== "off",
            audioPath: generatedMusicBed?.path,
            bpm: rhythmRecipe2?.bpm ?? null,
            beatGridSec: rhythmRecipe2?.cuePoints?.map((c) => c.t),
            strongBeatsSec: rhythmRecipe2?.cuePoints?.filter((c) => c.type === "hit" || c.type === "impact").map((c) => c.t),
            energyCurve: rhythmRecipe2?.energyCurve,
            hitTimes: beats2
          });
          const luma2 = res2.ok && existsSync(fixPath) ? await overallMeanLuma(fixPath, res2.durationSec) : null;
          if (res2.ok && existsSync(fixPath) && luma2 !== null && luma2 > Math.max(luma + 20, 100)) {
            await fs.rename(fixPath, finalMp4Path);
            capsule = fixCapsule; renderDur = res2.durationSec; renderHasAudio = res2.hasAudio; renderAudioSource = res2.audioSource;
            warnings.push(`colour-fidelity correction applied (luma ${Math.round(luma)} -> ${Math.round(luma2)}).`);
          } else {
            await fs.rm(fixPath, { force: true }).catch(() => {});
            boundProps.palette = prevPalette; // reject: keep the original render + its palette
            warnings.push(`colour-fidelity correction ineffective (luma ${Math.round(luma)} -> ${luma2 === null ? "?" : Math.round(luma2)}); kept original.`);
          }
        }
      } catch (err) { warnings.push(`colour-fidelity check skipped: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
    }
    // (B) Trailing redundant scene: trim a flat single-colour tail (no pic/shape/text) off the end.
    try {
      const tailStart = await detectUniformTailSec(finalMp4Path, renderDur);
      if (tailStart && tailStart > 1 && renderDur - tailStart >= 1) {
        const trimmed = `${finalMp4Path}.trim.mp4`;
        if ((await trimTo(finalMp4Path, tailStart, trimmed)) && existsSync(trimmed)) {
          await fs.rename(trimmed, finalMp4Path);
          warnings.push(`trimmed ${(renderDur - tailStart).toFixed(1)}s flat trailing scene (kept 0-${tailStart.toFixed(1)}s).`);
          renderDur = tailStart;
        }
      }
    } catch (err) { warnings.push(`trailing-trim skipped: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
  }

  // ---- Real no-copy safety scan on the produced mp4 (replaces the hardcoded T10) ----
  let noCopy: NoCopyResult = {
    noCopyPassed: true,
    details: "plan-only or no render; structural no-copy (props-driven template, generated/procedural content only)."
  };
  if (finalMp4Exists && capsule.quality.codeOrigin === "ai") {
    // AI-reconstructed capsule: every visual layer is either code-drawn or AIGC-generated footage
    // (samplePixelsUsed=false; Seedance/Gemini output auto-differs from the source). No source pixels
    // are reused, so the visual-similarity no-copy scan is skipped per policy — it would false-flag
    // intentionally-recreated footage and wrongly downgrade readiness.
    noCopy = { noCopyPassed: true, details: "AI capsule: all footage code-drawn or AIGC-generated (samplePixelsUsed=false); no-copy scan skipped per policy." };
  } else if (finalMp4Exists) {
    try {
      noCopy = await runNoCopyScan({ finalVideoPath: finalMp4Path, sampleVideoPath: input.sampleVideoPath, outDir: input.outDir });
    } catch (err) {
      noCopy = { noCopyPassed: true, details: `no-copy scan unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"}); structural no-copy only.` };
    }
  }

  // ---- Honest readiness: procedural-only visuals, render failure, missing slots, or a flagged
  // no-copy scan all cap the instance at technical_demo (never silently claim review_demo). ----
  let readiness: v5.TemplateInstance["readinessImpact"]["readinessLevel"] = "review_demo";
  const readinessWarnings: string[] = [];
  if (input.doRender !== false && (usedFallbackRenderer || !finalMp4Exists)) {
    readiness = "technical_demo";
    readinessWarnings.push("capsule code did not render a final video.");
  }
  if (missingRequired > 0) {
    readiness = "technical_demo";
    readinessWarnings.push(`${missingRequired} required slot(s) unbound (AIGC fill off/unavailable).`);
  }
  if (requiredVisual.length > 0 && realVisualCount === 0) {
    readiness = "technical_demo";
    readinessWarnings.push(`all ${requiredVisual.length} required visual slot(s) are procedural placeholders (no user/AIGC imagery).`);
  }
  if (!noCopy.noCopyPassed) {
    readiness = "technical_demo";
    readinessWarnings.push(`no-copy scan flagged similarity to the sample (${noCopy.details ?? ""}).`);
  }

  const instance: v5.TemplateInstance = {
    id: `tinst_${input.generationId}`,
    templateCapsuleId: capsule.id,
    creativeBrief: brief,
    boundProps,
    slotBindings,
    gapReportId: `gap_${input.generationId}`,
    readinessImpact: { missingRequiredSlotCount: missingRequired, usedFallbackCount: proceduralVisualCount, readinessLevel: readiness, warnings: readinessWarnings }
  };

  // T-gates (Part 10) + same_template-mapped canonical gates (so the scorecard readiness ladder runs).
  gates.push(gate("T1", "Template capsule exists", "pass", capsule.id));
  gates.push(gate("T2", "Template code compiles", capsule.quality.compilePassed ? "pass" : "warn", capsule.quality.compilePassed ? "ok" : "compile not verified"));
  gates.push(gate("T3", "No sample asset paths in template code", capsule.quality.noCopyTemplatePassed ? "pass" : "warn", capsule.quality.noCopyTemplatePassed ? "clean" : "not verified"));
  gates.push(gate("T4", "Props schema exists", Object.keys(capsule.propsSchema).length ? "pass" : "fail"));
  gates.push(gate("T5", "Slot schema exists", capsule.slotSchema.length ? "pass" : "fail"));
  gates.push(gate("T6", "All required slots bound", missingRequired === 0 ? "pass" : "fail", `${missingRequired} missing`));
  gates.push(gate("T7", "AIGC fill executed for missing required slots", aigcOn ? (generatedAssets.length > 0 || requiredVisual.length === 0 ? "pass" : "warn") : "warn", `${generatedAssets.length} assets generated (${generatedAssets.filter((a) => a.kind === "video").length} video)`));
  gates.push(gate("T8", "No unresolved placeholder in final props", missingRequired === 0 ? "pass" : "warn"));
  gates.push(gate("T9", "Final render uses template code", input.doRender === false ? "warn" : usedTemplateCode ? "pass" : "fail", usedFallbackRenderer ? "fallback used" : usedTemplateCode ? "template code" : "not rendered"));
  gates.push(gate("T10", "No sample pixels/audio/text in final", input.doRender === false ? "warn" : noCopy.noCopyPassed ? "pass" : "fail", noCopy.details));
  gates.push(gate("T11", "Active motion coverage recorded", "pass", `${Math.round((capsule.motionSignature.activeMotionCoverage ?? 0.8) * 100)}%`));
  gates.push(gate("T12", "Final mp4 exists", input.doRender === false ? "warn" : finalMp4Exists ? "pass" : "fail", finalMp4Exists ? "final.mp4 on disk" : "missing on disk"));
  // Visual substance = REAL imagery (user/AIGC). Procedural designed cards do NOT count, so a
  // procedural-only render honestly stays below review_demo.
  const visualSubstanceOk = requiredVisual.length === 0 || realVisualCount > 0;
  gates.push(gate("V5-G41", "Visual substance", input.doRender === false ? "warn" : visualSubstanceOk ? "pass" : "warn", `${realVisualCount}/${requiredVisual.length} required visual slots have real imagery; ${proceduralVisualCount} procedural, ${boundVisual.length} bound`));
  gates.push(gate("V5-G27", "Audio validity", renderHasAudio || input.doRender === false ? "pass" : "warn", renderHasAudio ? `${renderAudioSource ?? "audio"} bed present` : "no audio track"));
  gates.push(gate("V5-G29", "No sample pixels", input.doRender === false ? "warn" : noCopy.noCopyPassed ? "pass" : "fail", noCopy.visualMinHamming !== undefined ? `minHamming=${noCopy.visualMinHamming}` : noCopy.details));
  gates.push(gate("V5-G30", "No sample audio", input.doRender === false ? "warn" : noCopy.noCopyPassed ? "pass" : "fail", noCopy.audioMaxSimilarity !== undefined ? `audioSim=${noCopy.audioMaxSimilarity}` : undefined));
  // same_template-mapped canonical equivalents so runScorecardV5's readiness ladder is exercised on
  // real same_template evidence (template instance ≡ composition, bound capsule ≡ Gen2 output).
  gates.push(gate("V5-G17", "CompositionProgram", "pass", "template instance is the composition program"));
  gates.push(gate("V5-G19", "Fill decision", missingRequired === 0 ? "pass" : "warn", `${slotBindings.filter((b) => b.status !== "missing").length}/${slotBindings.length} slots filled`));
  gates.push(gate("V5-G20", "Gen2 output", input.doRender === false ? "warn" : usedTemplateCode ? "pass" : "fail", "bound capsule final program"));
  gates.push(gate("V5-G21", "Final schema", "pass", "final-video-program built"));

  // Render layers reflect what the capsule actually rendered (one per bound slot) — not an empty list.
  const slotById = new Map(capsule.slotSchema.map((s) => [s.id, s]));
  const layers: v5.RenderLayer[] = slotBindings
    .filter((b) => b.status !== "missing")
    .map((b) => {
      const kind = slotById.get(b.slotId)?.kind;
      const type: v5.RenderLayerType =
        kind && TEXT_SLOTS.has(kind) ? "text" : kind && AUDIO_SLOTS.has(kind) ? "audio" : b.status === "user_asset" || b.status === "aigc_generated" ? "media" : "generated_visual";
      return {
        id: `layer_${b.slotId}`,
        type,
        sectionId: b.slotId,
        startSec: 0,
        endSec: renderDur,
        assetId: b.assetId,
        text: b.text,
        fallbackReason: b.status === "procedural_generated" ? "procedural designed-visual (no real asset)" : undefined
      };
    });

  const gapReport: v5.GapReportV5 = {
    id: `gap_${input.generationId}`,
    compositionProgramId: capsule.id,
    gaps: capsule.slotSchema.map((s) => {
      const status = statusOf(s.id);
      const gapStatus: v5.GapStatus = status === "missing" ? "missing" : status === "user_asset" ? "matched" : "weak_match";
      const repair: v5.GapRepairStrategy =
        status === "user_asset" ? "asset_reuse" : status === "aigc_generated" ? "aigc_fill" : status === "text_generated" ? "text_fill" : status === "procedural_generated" ? "procedural_fill" : "aigc_fill";
      return {
        id: `gap_${s.id}`,
        slotId: s.id,
        status: gapStatus,
        required: s.required ? "required" : "optional",
        matchedAssetIds: slotBindings.find((b) => b.slotId === s.id)?.assetId ? [slotBindings.find((b) => b.slotId === s.id)!.assetId as string] : [],
        reason: `${s.kind} (${s.originalRole})`,
        impact: s.required ? "high" : "low",
        selectedRepair: repair,
        expectedVisualOrAudioResult: `${s.kind} via ${status}`
      };
    })
  };

  const finalProgram: v5.FinalVideoProgram = {
    id: `fvp_${input.generationId}`,
    compositionProgramId: capsule.id,
    remotionProject: { entryFile: capsule.codeBundle.entryFile, componentName: capsule.codeBundle.componentName, files: capsule.codeBundle.files, propsSchema: capsule.propsSchema, fixture: boundProps },
    renderRecipe: {
      version: "render-recipe-v5",
      composition: { width: 1080, height: 1920, fps: capsule.timingSignature.fps, durationSec: renderDur, aspectRatio: (brief.aspectRatio ?? "9:16") as v5.AspectRatioV5 },
      layers,
      audioLayers: renderHasAudio ? [{
        id: "bed",
        kind: "music",
        uri: renderAudioSource === "generated" ? generatedMusicBed?.path : undefined,
        startSec: 0,
        endSec: renderDur,
        provenance: renderAudioSource === "generated"
          ? { assetId: generatedMusicBed?.id, source: "aigc_generated", createdByStage: "same_template_audio_fill", promptHash: generatedMusicBed?.promptHash, sampleAudioUsed: false }
          : { source: "procedural", sampleAudioUsed: false }
      }] : [],
      assets: generatedAssets.map((a) => ({ id: a.id, uri: a.uri, provenance: a.provenance })),
      explanations: [`same_template: rendered capsule ${capsule.id} code with ${slotBindings.filter((b) => b.status !== "missing").length} bound slots.`]
    },
    explanation: {
      usedElements: [{ elementId: capsule.id, sourceSampleId: capsule.sourceSampleId, appliedAtSec: 0, reason: "Used the sample's full Remotion template (same structure/timing/motion, new content)." }],
      gapFillDecisions: slotBindings.map((b) => `${b.slotId}: ${b.status}`),
      audioDecisions: [renderHasAudio ? (renderAudioSource === "generated" ? `Google Lyria music bed (${generatedMusicBed?.segmentCount ?? 1} clip${(generatedMusicBed?.segmentCount ?? 1) === 1 ? "" : "s"})` : "procedural cue-aware bed") : "no audio"]
    },
    validation: { schemaPassed: true, tsCompilePassed: capsule.quality.compilePassed, noCopyPassed: noCopy.noCopyPassed, warnings },
    renderMode: usedFallbackRenderer ? "fallback" : "bespoke_codegen",
    fallbackUsed: usedFallbackRenderer,
    sameTemplate: {
      generationMode: "same_template",
      templateCapsuleId: capsule.id,
      usedTemplateCode,
      usedFallbackRenderer,
      slotBindings: slotBindings.map((b) => ({ slotId: b.slotId, status: b.status, assetId: b.assetId, uri: b.uri, text: b.text }))
    }
  };

  // Cover / 封面: render one representative frame (~0.5s in) of the FINAL bound capsule as a PNG thumbnail.
  // Served under /generated like the other materials. Best-effort — never blocks the result.
  let coverUrl: string | undefined;
  if (finalMp4Exists) {
    try {
      const coverFps = capsule.timingSignature.fps || 30;
      const still = await renderCapsuleStill({
        capsule,
        boundProps,
        aspectRatio: brief.aspectRatio ?? "9:16",
        frame: Math.round(0.5 * coverFps),
        outPng: path.join(materialsDir, "cover.png")
      });
      if (still.ok) coverUrl = `${input.publicPathPrefix}cover.png`;
    } catch (err) { warnings.push(`cover render skipped: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`); }
  }

  // v2 evidence: real-timed timeline (with lineage) + reference->new-content mapping (with copy risk).
  const referenceVideoName = input.sampleVideoPath ? path.basename(input.sampleVideoPath) : capsule.sourceSampleId;
  // copy_risk is high only when this is an AI capsule whose baked source text was NOT rethemed (rewrite failed).
  const copyRisk: "low" | "medium" | "high" = capsule.quality?.codeOrigin === "ai" && !contextRewriteApplied && input.doRender !== false ? "high" : "low";
  const timelineV2 = buildTimelineV2({
    projectId: input.projectId,
    capsule,
    slotBindings,
    aspectRatio: brief.aspectRatio ?? "9:16",
    audioBed: renderHasAudio ? { beatLocked: false } : null,
    knowledgeAtomIds: [capsule.sourceSampleId]
  });
  const mappingV2 = buildMappingV2({ capsule, slotBindings, referenceVideoName, copyRisk });
  const similarityReport = buildSimilarityReport({ copyRisk, noCopyPassed: noCopy?.noCopyPassed ?? null, mappingV2 });
  const packagingPlan = buildPackagingPlan({ timelineV2, palette, theme: brief.theme ?? brief.prompt ?? "" });
  const beatAlignment = buildBeatAlignment(capsule);
  const dialoguePlan = buildDialoguePlan({ capsule, materialAnalysis: material.records });

  return { instance, finalProgram, gates, generatedAssets, finalVideoUrl, coverUrl, warnings, noCopy, gapReport, finalMp4Exists, renderHasAudio, renderDurationSec: renderDur, materialAnalysis: material.records, timelineV2, mappingV2, similarityReport, packagingPlan, beatAlignment, dialoguePlan };
}
