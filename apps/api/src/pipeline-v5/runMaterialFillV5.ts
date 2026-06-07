// pipeline-v5/runMaterialFillV5.ts
// Stage 12 — EXECUTE the gap-report's fill decisions (audit GAP-1: every aigc_fill was declared but
// nothing was produced). For each missing/weak VISUAL slot this produces a fill that the compose stage
// binds into the recipe:
//   - provider path (key-gated): call the existing AIGC image provider (Gemini image / Seedream) with a
//     brief built from the slot+brief -> a real generated image asset -> a `media` layer.
//   - offline path (default, zero APIs): a `generated_visual` design spec -> the DesignedVisualLayer
//     built-in renders a composed gradient/geometry/hero visual (NOT a flat colour card).
// Either way the slot stops being an empty placeholder, and materialPlan.fills / recipe.assets reflect it.

import { promises as fs } from "node:fs";
import path from "node:path";
import { getAigcMaterialProvider, type MaterialGenerationBrief } from "@vvst/shared";
import { v5 } from "@vvst/shared";

const VISUAL_KINDS = new Set<v5.PlaceholderKindV5>(["hero", "hero_head", "hero_product", "product_closeup", "background", "logo"]);

export type DesignFamily = "hero_product" | "product_closeup" | "logo" | "background" | "scene" | "app_mockup" | "media_cards";

export interface DesignSpec {
  family: DesignFamily;
  palette: string[];
  gradient?: [string, string];
  headline?: string;
  seed: number;
}

export interface SlotFill {
  slotId: string;
  mode: "media" | "generated_visual";
  asset?: v5.GeneratedVisualAsset;
  design?: DesignSpec;
  prompt?: string;
  provider?: string;
}

export interface MaterialFillResultV5 {
  fills: Map<string, SlotFill>;
  generatedAssets: v5.GeneratedVisualAsset[];
  materialFills: v5.MaterialFill[];
  warnings: string[];
  generatedImageCount: number;
}

export interface MaterialFillInput {
  composition: v5.CompositionProgram;
  gapReport: v5.GapReportV5;
  projectId: string;
  generationId: string;
  outDir: string;
  publicPathPrefix: string;
  /** Allow real external image generation (Gemini/Seedream). Default false -> offline designed visuals. */
  allowExternalProvider?: boolean;
  providerId?: string;
  /** Cap real image generations per generation (latency/cost). Remaining slots use designed visuals. */
  maxGenerated?: number;
  env?: Record<string, string | undefined>;
}

function familyFor(kind: v5.PlaceholderKindV5): DesignFamily {
  if (kind === "logo") return "logo";
  if (kind === "background") return "background";
  if (kind === "product_closeup") return "product_closeup";
  if (kind === "hero" || kind === "hero_product" || kind === "hero_head") return "hero_product";
  return "media_cards";
}

function visualFormFamilyFor(kind: v5.PlaceholderKindV5): string {
  if (kind === "logo") return "brand_cta";
  if (kind === "background") return "background";
  return "object_motion";
}

function shade(hex: string, factor = 0.6): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.replace("#", "#"));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function buildImageBrief(args: {
  slotId: string;
  kind: v5.PlaceholderKindV5;
  projectId: string;
  generationId: string;
  theme: string;
  palette: string[];
  aspectRatio: string;
  headline?: string;
}): MaterialGenerationBrief {
  const promptByKind: Record<string, string> = {
    logo: `A clean modern brand emblem / logo mark for "${args.theme}", centered on a solid studio background, vector-like, premium, no text. Do not copy any existing brand.`,
    background: `A premium abstract background for a "${args.theme}" advertisement, soft gradient, depth, cinematic lighting, no text, no product.`,
    hero_product: `A photorealistic hero product shot for "${args.theme}", centered, dramatic studio lighting, glossy, clean dark background, advertising quality, no text.`,
    hero_head: `A premium hero subject for "${args.theme}", centered, strong rim light, clean background, advertising quality, no text.`,
    product_closeup: `A close-up detail shot for "${args.theme}", shallow depth of field, premium studio lighting, no text.`
  };
  const prompt = promptByKind[args.kind] ?? `A premium advertising visual for "${args.theme}", clean composition, studio lighting, no text.`;
  return {
    id: `brief_${args.generationId}_${args.slotId}`,
    projectId: args.projectId,
    generationId: args.generationId,
    slotId: args.slotId,
    visualFormFamily: visualFormFamilyFor(args.kind) as MaterialGenerationBrief["visualFormFamily"],
    visualForm: args.kind,
    assetType: "image",
    count: 1,
    targetTheme: args.theme,
    promptPack: [prompt],
    styleConstraints: {
      aspectRatio: (args.aspectRatio as MaterialGenerationBrief["styleConstraints"]["aspectRatio"]) ?? "9:16",
      palette: args.palette,
      colorPalette: args.palette,
      noTextUnlessRequested: true,
      avoidSampleLookalike: true
    },
    structureConstraints: {
      intendedRendererCapability: "remotion_media_layer",
      motionPattern: "static_hero",
      slotRole: args.kind
    },
    negativePrompts: ["watermark", "sample logo", "exact original product", "on-image text", "caption"],
    evidenceRefs: { sampleEvidenceFrameIds: [], note: "sample evidence is for structure only; do not copy visual content" },
    privacyPolicy: { externalUploadAllowed: true, sampleFramesAllowedToProvider: false, targetAssetsAllowedToProvider: false }
  };
}

export async function runMaterialFillV5(input: MaterialFillInput): Promise<MaterialFillResultV5> {
  const warnings: string[] = [];
  const fills = new Map<string, SlotFill>();
  const generatedAssets: v5.GeneratedVisualAsset[] = [];
  const materialFills: v5.MaterialFill[] = [];
  const palette = input.composition.stylePlan.palette.length ? input.composition.stylePlan.palette : ["#0A0A0A", "#FFFFFF", "#F7C948"];
  const theme = input.composition.creativeBrief.theme ?? input.composition.creativeBrief.prompt ?? "the product";
  const aspectRatio = input.composition.composition.aspectRatio;
  const maxGenerated = input.maxGenerated ?? 4;
  let generatedImageCount = 0;

  const gapBySlot = new Map(input.gapReport.gaps.map((g) => [g.slotId, g]));
  const provider = input.allowExternalProvider ? getAigcMaterialProvider((input.providerId as never) ?? (input.env?.AIGC_IMAGE_PROVIDER as never) ?? "google_gemini_image") : undefined;

  for (const slot of input.composition.slotPlan) {
    const kind = slot.kind as v5.PlaceholderKindV5;
    if (!VISUAL_KINDS.has(kind)) continue; // text/cta handled elsewhere
    const gap = gapBySlot.get(slot.id);
    // Only fill slots that aren't already bound to a real target asset.
    if (gap && gap.status === "matched" && gap.matchedAssetIds.length) continue;

    const section = input.composition.sections.find((s) => s.id === slot.sectionId);
    const headline = kind === "hero" || kind === "hero_product" || kind === "hero_head" ? section?.plannedText : undefined;
    const seed = (slot.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 9973) + 1;
    const design: DesignSpec = { family: familyFor(kind), palette, gradient: [palette[0], shade(palette[0], 0.5)], headline, seed };

    let fill: SlotFill = { slotId: slot.id, mode: "generated_visual", design };

    if (provider && generatedImageCount < maxGenerated && (gap?.impact === "high" || gap?.impact === "medium" || slot.required)) {
      try {
        const brief = buildImageBrief({ slotId: slot.id, kind, projectId: input.projectId, generationId: input.generationId, theme, palette, aspectRatio, headline });
        await fs.mkdir(input.outDir, { recursive: true });
        const candidates = await provider.generate(brief, {
          outputDir: input.outDir,
          publicPathPrefix: input.publicPathPrefix,
          env: input.env,
          allowExternalProviderCall: true
        });
        const c = candidates[0];
        if (c?.path) {
          const asset: v5.GeneratedVisualAsset = {
            id: `genasset_${slot.id}`,
            kind: "image",
            uri: c.path,
            provenance: { assetId: `genasset_${slot.id}`, source: "aigc_generated", createdByStage: "material_fill_v5", promptRef: c.prompt, samplePixelsUsed: false },
            usageHint: `${kind} for ${section?.role ?? "section"}`
          };
          generatedAssets.push(asset);
          generatedImageCount += 1;
          fill = { slotId: slot.id, mode: "media", asset, prompt: c.prompt, provider: c.provider };
        }
      } catch (err) {
        warnings.push(`material fill (${slot.id}) provider failed: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}; using designed visual.`);
      }
    }

    fills.set(slot.id, fill);
    materialFills.push({
      slotId: slot.id,
      strategy: fill.mode === "media" ? "aigc_fill" : "packaging_fill",
      note: fill.mode === "media" ? `generated image via ${fill.provider}` : `designed ${design.family} visual (offline)`
    });
  }

  return { fills, generatedAssets, materialFills, warnings, generatedImageCount };
}
