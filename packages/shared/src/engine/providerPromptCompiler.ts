import type { ModelTask, ProviderDecision } from "../model-router/types.js";
import type { GapReportItem, RendererBackend, StructureTemplate, VisualFormFamily } from "../types.js";

export type ProviderPromptPlan = {
  provider: string;
  task: ModelTask;
  prompt: string;
  negativePrompt?: string;
  durationSec?: number;
  referenceAssetIds?: string[];
  safetyNotes: string[];
  provenanceRequired: boolean;
  fallbackConfig?: unknown;
};

export interface ProviderPromptCompilerInput {
  gap: GapReportItem;
  selectedProvider?: string;
  providerDecision: ProviderDecision;
  productTheme?: {
    name?: string;
    productName?: string;
    brandName?: string;
    category?: string;
    sellingPoints?: string[];
    cta?: string;
    ctaText?: string;
  };
  techniqueAtoms?: StructureTemplate["techniqueAtoms"];
  referenceAssetIds?: string[];
  durationSec?: number;
}

const SAMPLE_REF = /sample|source_sample|evidence:\/\/|frame_|keyframe|shot_/i;

function cleanText(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/prompt|生成|换成|学习样例|不复制样例|watermark|水印/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 180) : fallback;
}

function productLine(input: ProviderPromptCompilerInput): string {
  const product = cleanText(input.productTheme?.productName ?? input.productTheme?.name, "target product");
  const category = cleanText(input.productTheme?.category, "commercial product");
  const points = (input.productTheme?.sellingPoints ?? []).map((item) => cleanText(item, "")).filter(Boolean).slice(0, 3);
  return [product, category, ...points].join(", ");
}

function familyForGap(gap: GapReportItem): VisualFormFamily | "poster_layout" {
  return gap.visualFormFamily ?? (/cta|brand/i.test(gap.gapType ?? gap.slotId) ? "brand_cta" : /motion|hero|object/i.test(gap.gapType ?? gap.slotId) ? "object_motion" : "poster_layout");
}

function atomHints(input: ProviderPromptCompilerInput): string {
  const atoms = input.techniqueAtoms ?? [];
  return atoms.slice(0, 3).map((atom) => `${atom.name}: ${atom.visualPattern}`).join("; ");
}

function safeReferences(referenceAssetIds: string[] | undefined): string[] {
  const unsafe = (referenceAssetIds ?? []).filter((id) => SAMPLE_REF.test(id));
  if (unsafe.length) throw new Error(`Provider prompt compiler rejected sample/evidence references: ${unsafe.join(", ")}`);
  return referenceAssetIds ?? [];
}

function fallbackBackendFor(provider: string): RendererBackend | "procedural_audio" {
  if (provider === "seedance_2_0" || provider === "remotion_procedural_motion") return "remotion_recipe_compose";
  if (provider === "volcengine_seedream" || provider === "google_gemini_image" || provider === "deterministic_local_image_fill" || provider === "remotion_shape_card") return "image_card";
  return "procedural_audio";
}

function negativePrompt(): string {
  return [
    "do not copy sample frames",
    "do not reproduce original sample brand, watermark, platform UI, face, or person identity",
    "no random readable text",
    "no logo unless provided by user asset",
    "no reference to source video file paths"
  ].join("; ");
}

export function compileProviderPromptPlan(input: ProviderPromptCompilerInput): ProviderPromptPlan {
  const provider = input.selectedProvider ?? input.providerDecision.selectedProvider;
  const references = safeReferences(input.referenceAssetIds);
  const family = familyForGap(input.gap);
  const product = productLine(input);
  const atoms = atomHints(input);
  const durationSec = input.durationSec ?? 4;
  const base = `Create original ${family} material for ${product}. Preserve only the learned structure: ${input.gap.reason}. ${atoms ? `Technique hints: ${atoms}.` : ""}`.trim();
  const safetyNotes = [
    "Sample media is structure evidence only.",
    "No sample frames/audio/video are passed as generation references.",
    "Generated output requires provenance before render.",
    "Raw provider prompt is not renderable display text."
  ];

  if (provider === "seedance_2_0") {
    return {
      provider,
      task: "video_fill",
      prompt: `${base} Produce a short product-motion clip with target-only visuals and clear foreground motion.`,
      negativePrompt: negativePrompt(),
      durationSec: Math.min(Math.max(durationSec, 1), 6),
      referenceAssetIds: references,
      safetyNotes,
      provenanceRequired: true,
      fallbackConfig: { backend: "remotion_recipe_compose", mode: "procedural_motion", gapId: input.gap.slotId }
    };
  }
  if (provider === "volcengine_seedream" || provider === "google_gemini_image" || provider === "deterministic_local_image_fill") {
    return {
      provider,
      task: "image_fill",
      prompt: `${base} Produce a clean original still/poster asset; avoid copied sample composition details beyond abstract layout.`,
      negativePrompt: negativePrompt(),
      referenceAssetIds: references,
      safetyNotes,
      provenanceRequired: true,
      fallbackConfig: { backend: "image_card", mode: "local_packaging_fill", gapId: input.gap.slotId }
    };
  }
  if (
    provider === "google_gemini_tts" ||
    provider === "google_lyria_music" ||
    provider === "procedural_synth"
  ) {
    const task: ModelTask =
      provider === "google_gemini_tts"
        ? "voiceover"
        : provider === "google_lyria_music" || /music|bgm/i.test(input.gap.gapType ?? input.gap.slotId)
          ? "music"
          : "sound_effect";
    return {
      provider,
      task,
      prompt: `${base} Generate original ${task === "voiceover" ? "voiceover" : task === "music" ? "music bed" : "short sound effect"} matching the target rhythm without copying sample audio.`,
      negativePrompt: "do not copy or remix sample audio; no recognizable copyrighted melody",
      durationSec,
      referenceAssetIds: references,
      safetyNotes,
      provenanceRequired: true,
      fallbackConfig: { backend: "procedural_audio", mode: task === "music" ? "synth_bgm" : task === "voiceover" ? "subtitle_only" : "impact_riser", gapId: input.gap.slotId }
    };
  }
  if (provider === "remotion_procedural_motion" || provider === "remotion_shape_card" || provider === "ffmpeg_proxy_motion") {
    return {
      provider,
      task: provider === "ffmpeg_proxy_motion" || provider === "remotion_procedural_motion" ? "video_fill" : "image_fill",
      prompt: `${base} Use deterministic local renderer primitives only.`,
      negativePrompt: negativePrompt(),
      referenceAssetIds: references,
      safetyNotes,
      provenanceRequired: provider !== "ffmpeg_proxy_motion",
      fallbackConfig: { backend: fallbackBackendFor(provider), mode: provider, gapId: input.gap.slotId }
    };
  }
  return {
    provider,
    task: input.providerDecision.task,
    prompt: base,
    negativePrompt: negativePrompt(),
    referenceAssetIds: references,
    safetyNotes,
    provenanceRequired: input.providerDecision.generatedAssetProvenanceRequired,
    fallbackConfig: { backend: fallbackBackendFor(provider), mode: "deterministic_fallback", gapId: input.gap.slotId }
  };
}

export function compilePromptPlanWithFallback(input: ProviderPromptCompilerInput, fallbackProvider: string): ProviderPromptPlan[] {
  const primary = compileProviderPromptPlan(input);
  const fallback = compileProviderPromptPlan({
    ...input,
    selectedProvider: fallbackProvider,
    providerDecision: { ...input.providerDecision, selectedProvider: fallbackProvider, fallbackUsed: true, fallbackReason: `Fallback prompt plan for unavailable ${primary.provider}.` }
  });
  return [primary, fallback];
}
