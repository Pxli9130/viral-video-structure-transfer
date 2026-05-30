import type {
  AigcMaterialFillConfig,
  FillAction,
  GapReportItem,
  GenerationRequest,
  InducedVisualSlot,
  MaterialGenerationBrief,
  TargetAssetInput,
  VisualFormFamily
} from "../types.js";

export const DEFAULT_AIGC_MATERIAL_FILL_CONFIG: AigcMaterialFillConfig = {
  enabled: false,
  provider: "mock_provider",
  maxAssetsPerRun: 8,
  allowExternalUpload: false,
  allowSampleFramesToProvider: false,
  requireUserApprovalBeforeRender: true,
  cacheEnabled: true
};

function stableId(prefix: string, ...parts: unknown[]): string {
  const input = parts.map((part) => JSON.stringify(part)).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function configFor(config?: Partial<AigcMaterialFillConfig>): AigcMaterialFillConfig {
  return { ...DEFAULT_AIGC_MATERIAL_FILL_CONFIG, ...(config ?? {}) };
}

function requestAllowsAigc(request: GenerationRequest, config: AigcMaterialFillConfig): boolean {
  return request.controls?.allowAigcMaterialGeneration === true || config.enabled === true;
}

function inferTargetTheme(request: GenerationRequest): string {
  return request.prompt.split(/\r?\n/).find((line) => /主题|product|topic/i.test(line))?.trim() ?? request.prompt.slice(0, 160);
}

function promptLines(request: GenerationRequest): string[] {
  return request.prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function slotForGap(gap: GapReportItem, inducedSlots: InducedVisualSlot[] | undefined): InducedVisualSlot | undefined {
  return inducedSlots?.find((slot) => slot.id === gap.inducedSlotId || slot.id === gap.slotId || slot.visualFormFamily === gap.visualFormFamily);
}

function familyForGap(gap: GapReportItem): VisualFormFamily | "poster_layout" | undefined {
  if (gap.visualFormFamily) return gap.visualFormFamily;
  const haystack = [gap.gapType, gap.slotId, gap.slotType, gap.visualForm].join(" ").toLowerCase();
  if (/media[_\s-]?cards|card[_\s-]?stack/.test(haystack)) return "media_cards";
  if (/brand|cta|logo/.test(haystack)) return "brand_cta";
  if (/montage|action|beat[_\s-]?cut|match[_\s-]?cut/.test(haystack)) return "live_action_montage";
  if (/product|object|hero|closeup|close-up|rotating/.test(haystack)) return "object_motion";
  if (/poster|cover|background/.test(haystack)) return "poster_layout";
  if (/ui|feature[_\s-]?list|showcase/.test(haystack)) return "ui_showcase";
  if (/subtitle|title|text|typography/.test(haystack)) return "kinetic_typography";
  if (/hook|proof|usage|comparison|visual/.test(haystack)) return "unknown";
  return undefined;
}

function promptPackFor(family: VisualFormFamily | "poster_layout", count: number, targetTheme: string): string[] {
  const base = {
    media_cards: "Clean abstract SaaS/product interface card, bold motion-graph composition, no logo, no watermark, no letters, no words, no readable text, icon-and-shape UI only",
    live_action_montage: "Cinematic product/lifestyle still for beat-cut montage, original generic scene, no watermark, no sample-like person",
    object_motion: "Generic hero object still, isolated, clean lighting, original target-theme visual, no logo",
    poster_layout: "Original poster background image, clean commercial layout, no copied sample branding",
    unknown: "Generic original visual placeholder for motion-graph slot, no watermark, no sample-like content",
    brand_cta: "Brand CTA placeholder panel using target copy only, no fabricated logo",
    kinetic_typography: "Short kinetic typography copy, no copied sample wording",
    ui_showcase: "Feature-list copy for target product UI showcase, no sample wording",
    geometric_mg: "Procedural neon geometry; no generated external asset needed",
    background: "Original dark-tech background image with subtle light streaks, no copied sample frames, no watermark",
    storyboard: "Storyboard rule-card copy for the target tutorial structure, no sample wording",
    audio: "Procedural beat-grid track; no external generated asset needed"
  } satisfies Record<VisualFormFamily | "poster_layout", string>;
  return Array.from({ length: Math.max(1, count) }, (_, index) => `${base[family]} · ${targetTheme} · variant ${index + 1}`);
}

function briefAssetTypeFor(family: VisualFormFamily | "poster_layout" | undefined, gap: GapReportItem): MaterialGenerationBrief["assetType"] | undefined {
  if (family === "media_cards") return "image_set";
  if (family === "live_action_montage") return "image_set";
  if (family === "object_motion") return "image";
  if (family === "brand_cta") return "logo_placeholder";
  if (family === "kinetic_typography" || family === "ui_showcase") return "copy";
  if (family === "geometric_mg") return undefined;
  if (gap.visualForm === "text_card") return undefined;
  return family === "unknown" ? "image" : undefined;
}

function briefCountFor(family: VisualFormFamily | "poster_layout" | undefined, gap: GapReportItem): number {
  if (family === "media_cards") return Math.max(gap.missingCount ?? gap.assetRequirement?.minCount ?? 4, 4);
  if (family === "live_action_montage") return Math.max(gap.missingCount ?? 3, 3);
  return Math.max(gap.missingCount ?? 1, 1);
}

function hasTargetMaterialForFamily(family: VisualFormFamily | "poster_layout" | undefined, targetAssets: TargetAssetInput[] | undefined): boolean {
  if (!family || !targetAssets?.length) return false;
  if (family === "geometric_mg") return true;
  if (family === "media_cards") {
    return targetAssets.filter((asset) => asset.role === family || asset.tags?.includes("media_card")).length >= 4;
  }
  if (family === "brand_cta") {
    return targetAssets.some((asset) => asset.kind === "logo" || asset.role === family || asset.tags?.includes("brand_cta"));
  }
  return targetAssets.some((asset) => asset.role === family || asset.tags?.includes(family));
}

export function createMaterialGenerationBriefs(input: {
  gapReport: GapReportItem[];
  inducedSlots?: InducedVisualSlot[];
  fillPlan?: FillAction[];
  request: GenerationRequest;
  visualEvidence?: unknown;
  targetAssets?: TargetAssetInput[];
  config?: Partial<AigcMaterialFillConfig>;
  generationId?: string;
}): MaterialGenerationBrief[] {
  const config = configFor(input.config);
  if (!requestAllowsAigc(input.request, config)) return [];
  const targetTheme = inferTargetTheme(input.request);
  const copyContext = promptLines(input.request);
  const briefs: MaterialGenerationBrief[] = [];
  for (const gap of input.gapReport) {
    const family = familyForGap(gap);
    if (hasTargetMaterialForFamily(family, input.targetAssets)) continue;
    const assetType = briefAssetTypeFor(family, gap);
    if (!assetType) continue;
    if ((family === "kinetic_typography" || family === "ui_showcase") && config.provider !== "copy_provider") continue;
    const slot = slotForGap(gap, input.inducedSlots);
    const count = briefCountFor(family, gap);
    const promptPack = promptPackFor(family ?? "unknown", count, targetTheme);
    briefs.push({
      id: stableId("aigc_brief", input.request.projectId, input.generationId, gap.slotId, family, assetType, count),
      projectId: input.request.projectId,
      generationId: input.generationId ?? "pending_generation",
      slotId: gap.slotId,
      visualFormFamily: family ?? "unknown",
      visualForm: gap.visualForm ?? slot?.visualForm ?? "generic_visual_proxy",
      assetType,
      count,
      targetTheme,
      copyContext,
      promptPack,
      styleConstraints: {
        aspectRatio: input.request.target.aspectRatio,
        mood: input.request.controls?.packagingStyle ?? "mg_motion",
        noTextUnlessRequested: family === "brand_cta" || assetType === "copy",
        avoidSampleLookalike: true
      },
      structureConstraints: {
        intendedRendererCapability: gap.rendererCandidates?.[0] ?? slot?.rendererCandidates[0] ?? "generic_asset_proxy",
        motionPattern: slot?.motionPattern ?? "preserve_slot_motion",
        slotRole: gap.slotRole ?? slot?.role ?? "body",
        durationSec: undefined
      },
      negativePrompts: [
        "do not copy sample frames",
        "no sample branding",
        "no watermarks",
        "no platform UI marks",
        family === "brand_cta" ? "do not fabricate a real logo" : "no readable random text"
      ],
      evidenceRefs: {
        sampleEvidenceFrameIds: gap.sourceEvidence?.frameIds ?? slot?.sourceEvidence.frameIds ?? [],
        note: "sample evidence is for structure only; do not copy visual content"
      },
      privacyPolicy: {
        externalUploadAllowed: config.allowExternalUpload,
        sampleFramesAllowedToProvider: config.allowSampleFramesToProvider,
        targetAssetsAllowedToProvider: config.allowExternalUpload
      }
    });
  }
  return briefs.slice(0, Math.max(0, config.maxAssetsPerRun));
}
