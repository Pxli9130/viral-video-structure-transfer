import type {
  AnalysisPurpose,
  Asset,
  FillAction,
  FillStrategyName,
  GapReportItem,
  GenerationRequest,
  GenerationResult,
  SlotMapping,
  SlotType,
  SourceTag,
  SourceVideoUnderstanding,
  StructureAtom,
  StructureSlot,
  StructureTemplate,
  Timeline,
  TimelineClip,
  VideoAnalysisResult,
  VideoShotCandidate,
  Vertical
} from "./types.js";
import { validateGenerationRequest, validateStructureTemplate, validateTimeline } from "./validation.js";

export function stableId(prefix: string, ...parts: unknown[]): string {
  const input = parts.map((part) => JSON.stringify(part)).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function inferAspectRatio(width: number, height: number): "9:16" | "16:9" | "1:1" | "4:5" {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(ratio - 16 / 9) < 0.08) return "16:9";
  if (Math.abs(ratio - 1) < 0.08) return "1:1";
  return "4:5";
}

export interface MockAnalysisInput {
  assetId: string;
  filename?: string;
  purpose?: AnalysisPurpose;
  durationSec?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export function buildMockVideoAnalysis(input: MockAnalysisInput): VideoAnalysisResult {
  const durationSec = clamp(round(input.durationSec ?? (input.durationMs ?? 15000) / 1000), 3, 300);
  const width = Math.round(input.width ?? 720);
  const height = Math.round(input.height ?? 1280);
  const fps = Math.round(input.fps ?? 30);
  const purpose = input.purpose ?? "sample";
  const shotCount = purpose === "source" ? Math.min(8, Math.max(4, Math.ceil(durationSec / 6))) : 5;
  const baseDuration = durationSec / shotCount;
  const shotTags: SourceTag[][] =
    purpose === "source"
      ? [
          ["product_like", "background"],
          ["background"],
          ["usage_scene"],
          ["text_card_candidate"],
          ["product_like"],
          ["background"],
          ["comparison"],
          ["cta_candidate"]
        ]
      : [
          ["product_like"],
          ["usage_scene"],
          ["product_like", "text_card_candidate"],
          ["comparison"],
          ["cta_candidate"]
        ];

  const candidates: VideoShotCandidate[] = Array.from({ length: shotCount }).map((_, index) => {
    const startSec = round(index * baseDuration);
    const endSec = index === shotCount - 1 ? durationSec : round((index + 1) * baseDuration);
    return {
      id: `${purpose}_shot_${index + 1}`,
      startSec,
      endSec,
      durationSec: round(endSec - startSec),
      thumbnailPath: `mock://${input.assetId}/frame-${index + 1}`,
      tags: shotTags[index] ?? ["background"],
      confidence: 0.72 + (index % 3) * 0.06
    };
  });

  return {
    id: stableId("analysis", input.assetId, purpose, durationSec, width, height),
    assetId: input.assetId,
    purpose,
    mode: "mock",
    metadata: {
      durationSec,
      width,
      height,
      fps,
      aspectRatio: inferAspectRatio(width, height),
      codec: "mock-h264",
      hasAudio: true
    },
    keyframes: candidates.map((candidate, index) => ({
      id: `keyframe_${index + 1}`,
      timestampSec: candidate.startSec,
      path: candidate.thumbnailPath,
      label: `${input.filename ?? "video"} frame ${index + 1}`
    })),
    shotCandidates: candidates,
    transcript:
      purpose === "sample"
        ? "Mock sample transcript: hook, product value, proof, CTA."
        : "Mock source transcript: product visuals, environment shots and sparse action.",
    createdAt: nowIso()
  };
}

function slot(id: string, slotType: SlotType, description: string, preferredAssetTags: string[]): StructureSlot {
  return {
    id,
    slotType,
    required: true,
    description,
    preferredAssetTags,
    fallbackAllowed: true
  };
}

export function buildFallbackTemplate(
  analysis: VideoAnalysisResult,
  vertical: Vertical = "b2b_marketing_mg",
  projectId?: string
): StructureTemplate {
  const durationSec = analysis.metadata.durationSec;
  const hookEnd = round(durationSec * 0.2);
  const bodyEnd = round(durationSec * 0.7);
  const proofEnd = round(durationSec * 0.85);
  const createdAt = nowIso();
  const segments = [
    {
      id: "seg_hook",
      role: "hook" as const,
      startSec: 0,
      endSec: hookEnd,
      intent: "Stop scroll with a product-like visual and a clear benefit promise.",
      pacing: "fast" as const,
      sourceRationale: "The first 20% establishes attention before users scroll away.",
      requiredSlots: [slot("slot_hook_visual", "hook_visual", "Opening product/result visual", ["product_like"])],
      shots: [
        {
          id: "shot_hook_1",
          startSec: 0,
          endSec: hookEnd,
          shotType: "product_closeup" as const,
          visualIntent: "Show the strongest product/result frame.",
          motion: "push_in",
          transitionIn: "none",
          transitionOut: "hard_cut",
          textOverlay: "Open with a pain point or visible result."
        }
      ],
      packagingRefs: ["card_hook_title"]
    },
    {
      id: "seg_body",
      role: "body" as const,
      startSec: hookEnd,
      endSec: bodyEnd,
      intent: "Explain core value with usage, closeup and MG selling point cards.",
      pacing: "fast" as const,
      sourceRationale: "The middle alternates material and text packaging to maintain clarity.",
      requiredSlots: [
        slot("slot_product_closeup", "product_closeup", "Product or feature closeup", ["product_like"]),
        slot("slot_usage_scene", "usage_scene", "Usage/process/context scene", ["usage_scene"]),
        slot("slot_text_subtitle", "text_or_subtitle", "Short benefit copy", ["text_card_candidate"])
      ],
      shots: [
        {
          id: "shot_body_1",
          startSec: hookEnd,
          endSec: round(hookEnd + (bodyEnd - hookEnd) / 3),
          shotType: "product_closeup" as const,
          visualIntent: "Crop into a concrete feature.",
          motion: "zoom",
          transitionOut: "hard_cut",
          textOverlay: "One selling point per shot."
        },
        {
          id: "shot_body_2",
          startSec: round(hookEnd + (bodyEnd - hookEnd) / 3),
          endSec: round(hookEnd + ((bodyEnd - hookEnd) * 2) / 3),
          shotType: "usage_scene" as const,
          visualIntent: "Show how the product fits the target scenario.",
          motion: "cut",
          transitionOut: "slide",
          textOverlay: "Context benefit."
        },
        {
          id: "shot_body_3",
          startSec: round(hookEnd + ((bodyEnd - hookEnd) * 2) / 3),
          endSec: bodyEnd,
          shotType: "text_card" as const,
          visualIntent: "MG selling point card.",
          motion: "slide",
          transitionOut: "hard_cut",
          textOverlay: "Benefit card."
        }
      ],
      packagingRefs: ["card_selling_point"]
    },
    {
      id: "seg_proof",
      role: "proof" as const,
      startSec: bodyEnd,
      endSec: proofEnd,
      intent: "Create contrast or proof so the product claim feels justified.",
      pacing: "medium" as const,
      sourceRationale: "A proof beat reduces pure-ad feel and improves conversion clarity.",
      requiredSlots: [slot("slot_comparison_scene", "comparison_scene", "Comparison or proof visual", ["comparison"])],
      shots: [
        {
          id: "shot_proof_1",
          startSec: bodyEnd,
          endSec: proofEnd,
          shotType: "comparison" as const,
          visualIntent: "Before/after, problem/solution or benefit contrast.",
          motion: "slide",
          transitionOut: "hard_cut",
          textOverlay: "Contrast benefit."
        }
      ],
      packagingRefs: ["card_proof"]
    },
    {
      id: "seg_cta",
      role: "cta" as const,
      startSec: proofEnd,
      endSec: durationSec,
      intent: "Close with action and a final remembered benefit.",
      pacing: "medium" as const,
      sourceRationale: "The final frame holds long enough for CTA readability.",
      requiredSlots: [slot("slot_cta_visual", "cta_visual", "CTA card or end frame", ["cta_candidate"])],
      shots: [
        {
          id: "shot_cta_1",
          startSec: proofEnd,
          endSec: durationSec,
          shotType: "cta" as const,
          visualIntent: "End card with CTA.",
          motion: "static",
          transitionOut: "none",
          textOverlay: "Click to learn more."
        }
      ],
      packagingRefs: ["card_cta"]
    }
  ];

  return {
    schemaVersion: "1.1",
    id: stableId("template", analysis.assetId, durationSec, vertical),
    projectId,
    name: "B2B MG Promo Structure: Hook Body Proof CTA",
    vertical,
    sourceExample: {
      assetId: analysis.assetId,
      filename: `sample-${analysis.assetId}.mp4`,
      durationSec,
      width: analysis.metadata.width,
      height: analysis.metadata.height,
      fps: analysis.metadata.fps,
      thumbnailPath: analysis.keyframes[0]?.path
    },
    summary: "Reusable B-end marketing/MG pattern with hook, value body, proof and CTA.",
    targetDurationSec: durationSec,
    aspectRatio: analysis.metadata.aspectRatio,
    segments,
    packaging: {
      style: "mg_motion",
      subtitle: {
        density: "high",
        position: "lower_third",
        fontHint: "bold sans-serif",
        safeArea: "central 80% vertical safe area"
      },
      cards: [
        { id: "card_hook_title", purpose: "hook title bar", style: "bold top title with product crop" },
        { id: "card_selling_point", purpose: "selling point card", style: "MG card with icon/sticker" },
        { id: "card_proof", purpose: "proof/comparison card", style: "split contrast layout" },
        { id: "card_cta", purpose: "CTA end card", style: "centered CTA plus benefit recap" }
      ],
      stickers: ["arrow_highlight", "benefit_badge"],
      transitions: ["hard_cut", "slide", "push_in"],
      coverSuggestion: "Product name plus strongest benefit badge."
    },
    rhythm: {
      averageShotDurationSec: round(durationSec / 5),
      pace: "fast",
      climaxPosition: "70-85%",
      beatNotes: "Fast opening, value cards through the middle, readable CTA hold."
    },
    qualityRules: [
      {
        id: "qr_no_sample_visual_copy",
        rule: "Do not copy original sample visuals into reconstructed output.",
        reason: "The engine transfers structure, not copyrighted or unauthorized content.",
        severity: "critical"
      },
      {
        id: "qr_no_empty_slots",
        rule: "Every timeline slot must resolve to source material, a generated card or a placeholder.",
        reason: "The reviewer must see a complete preview.",
        severity: "critical"
      },
      {
        id: "qr_mobile_caption",
        rule: "Captions should be short and readable on vertical mobile layout.",
        reason: "B-end MG promos rely on quick comprehension.",
        severity: "warning"
      }
    ],
    structureAtoms: [
      {
        id: "atom_hook_result_first",
        role: "hook",
        name: "Result-first hook",
        description: "Open with the clearest product/result frame and a short benefit claim.",
        applicableWhen: "Use when the prompt contains a concrete product or pain point.",
        requiresSlots: ["hook_visual", "text_or_subtitle"],
        replacementPolicy: "Use best source visual, otherwise product crop plus text card.",
        sourceSegmentIds: ["seg_hook"]
      },
      {
        id: "atom_selling_point_card",
        role: "body",
        name: "MG selling point card",
        description: "Turn one benefit into a short animated card/overlay.",
        applicableWhen: "Use when source footage lacks a clear demonstration shot.",
        requiresSlots: ["text_or_subtitle"],
        replacementPolicy: "Use text_card or packaging_overlay.",
        sourceSegmentIds: ["seg_body"]
      },
      {
        id: "atom_proof_contrast",
        role: "proof",
        name: "Proof by contrast",
        description: "Show before/after, problem/solution or old/new comparison.",
        applicableWhen: "Use when the prompt includes a pain point or measurable improvement.",
        requiresSlots: ["comparison_scene"],
        replacementPolicy: "Use split text card if no comparison footage exists.",
        sourceSegmentIds: ["seg_proof"]
      },
      {
        id: "atom_cta_end_card",
        role: "cta",
        name: "Readable CTA end card",
        description: "Hold final CTA with benefit recap.",
        applicableWhen: "Use for any marketing/promo output.",
        requiresSlots: ["cta_visual", "text_or_subtitle"],
        replacementPolicy: "Use packaging_overlay or text_card.",
        sourceSegmentIds: ["seg_cta"]
      }
    ],
    editingTechniques: [
      {
        id: "tech_crop_zoom_reuse",
        name: "Crop/zoom reuse",
        description: "Reuse a source shot with crop, push-in or repeat to satisfy a visual slot.",
        params: { motion: "push_in", maxReuseCount: 2 }
      },
      {
        id: "tech_title_bar_emphasis",
        name: "Title bar emphasis",
        description: "Use a bold title bar and short subtitle to make weak footage understandable.",
        params: { position: "top", density: "high" }
      }
    ],
    qualityRationale:
      "The structure is effective for B-end/MG marketing because it alternates concrete visuals, benefit cards and a proof beat before the CTA.",
    replacementPolicy: {
      allowSourceVideoReuse: true,
      allowTextCardSubstitution: true,
      allowAigcPlaceholder: true,
      notes: "Sample visuals are never reused; source footage and generated cards are allowed."
    },
    sourcePolicy: {
      sampleSource: "demo_only",
      commercialUse: false,
      doNotCopyOriginalContent: true,
      notes: "Mock fallback template transfers structure only."
    },
    createdAt,
    updatedAt: createdAt
  };
}

export function parsePromptToBrief(request: GenerationRequest): Required<NonNullable<GenerationRequest["brief"]>> {
  const prompt = request.prompt;
  const explicit = request.brief ?? {};
  const lineValue = (label: string): string | undefined => {
    const match = prompt.match(new RegExp(`(?:${label})[:：]\\s*([^\\n]+)`, "i"));
    return match?.[1]?.trim();
  };
  const selling = explicit.sellingPoints?.length
    ? explicit.sellingPoints
    : (lineValue("卖点|selling points|benefits") ?? "")
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean);

  return {
    topic: explicit.topic ?? lineValue("主题|topic") ?? "B2B marketing promo",
    productName: explicit.productName ?? lineValue("商品|产品|product") ?? lineValue("主题|topic") ?? "Demo product",
    targetAudience: explicit.targetAudience ?? lineValue("目标用户|audience") ?? "business users",
    sellingPoints: selling.length ? selling : ["clear value", "easy to understand", "mobile-friendly"],
    tone: explicit.tone ?? lineValue("风格|style") ?? "fast MG promo",
    cta: explicit.cta ?? lineValue("CTA") ?? "Click to learn more",
    forbiddenContent: explicit.forbiddenContent ?? []
  };
}

function mergeTags(...tagGroups: Array<Array<string | undefined> | undefined>): SourceTag[] {
  const allowed = new Set<SourceTag>([
    "product_like",
    "person_scene",
    "usage_scene",
    "background",
    "text_card_candidate",
    "comparison",
    "cta_candidate"
  ]);
  const tags = new Set<SourceTag>();
  for (const group of tagGroups) {
    for (const tag of group ?? []) {
      if (tag && allowed.has(tag as SourceTag)) tags.add(tag as SourceTag);
    }
  }
  return Array.from(tags);
}

export function understandSourceVideo(
  analysis: VideoAnalysisResult | undefined,
  sourceAsset: Asset | undefined,
  request: GenerationRequest
): SourceVideoUnderstanding {
  if (!analysis || !sourceAsset) {
    return {
      summary: "No source video was provided; reconstruction will rely on text cards and placeholders.",
      candidates: [],
      warnings: ["No source video provided. Preview is storyboard/text-card based."]
    };
  }

  const manualTags = sourceAsset.tags ?? [];
  const promptTags = request.prompt.match(/使用|usage|过程|场景|office|学生|办公室/i)
    ? ["usage_scene"]
    : request.prompt.match(/对比|comparison|before|after/i)
      ? ["comparison"]
      : [];

  return {
    assetId: sourceAsset.id,
    summary: `Mock source understanding generated ${analysis.shotCandidates.length} shot candidate(s).`,
    candidates: analysis.shotCandidates.map((candidate, index) => ({
      ...candidate,
      tags: mergeTags(candidate.tags, index === 0 ? ["product_like"] : [], manualTags, promptTags)
    })),
    warnings: analysis.mode === "mock" ? ["Using deterministic mock source-video analysis."] : []
  };
}

function requiredTagForSlot(slotType: SlotType): SourceTag | undefined {
  const map: Partial<Record<SlotType, SourceTag>> = {
    hook_visual: "product_like",
    product_closeup: "product_like",
    usage_scene: "usage_scene",
    comparison_scene: "comparison",
    proof_visual: "comparison",
    cta_visual: "cta_candidate",
    text_or_subtitle: "text_card_candidate",
    background: "background"
  };
  return map[slotType];
}

export function matchSlots(template: StructureTemplate, source: SourceVideoUnderstanding, request: GenerationRequest): SlotMapping[] {
  const prompt = request.prompt.toLowerCase();
  return template.segments.flatMap((segment) =>
    segment.requiredSlots.map((slotDef) => {
      const requiredTag = requiredTagForSlot(slotDef.slotType);
      const direct = requiredTag
        ? source.candidates.find((candidate) => candidate.tags.includes(requiredTag))
        : undefined;
      if (direct) {
        return {
          slotId: slotDef.id,
          segmentId: segment.id,
          slotType: slotDef.slotType,
          status: "matched" as const,
          sourceShotId: direct.id,
          assetId: source.assetId,
          confidence: direct.confidence,
          explanation: `Matched ${slotDef.slotType} to source shot ${direct.id} using tag ${requiredTag}.`
        };
      }

      const promptCanSupport =
        slotDef.slotType === "text_or_subtitle" ||
        slotDef.slotType === "cta_visual" ||
        (slotDef.slotType === "comparison_scene" && /对比|缓解|before|after|problem|solution/.test(prompt));
      if (promptCanSupport) {
        return {
          slotId: slotDef.id,
          segmentId: segment.id,
          slotType: slotDef.slotType,
          status: "weak_match" as const,
          confidence: 0.45,
          explanation: "No strong source shot exists, but prompt copy can support a card or overlay."
        };
      }

      return {
        slotId: slotDef.id,
        segmentId: segment.id,
        slotType: slotDef.slotType,
        status: "missing" as const,
        confidence: 0,
        explanation: `No source-video candidate satisfies ${slotDef.slotType}.`
      };
    })
  );
}

function strategiesForGap(slotType: SlotType, hasSourceVisual: boolean, request: GenerationRequest): FillStrategyName[] {
  if ((slotType === "hook_visual" || slotType === "product_closeup") && hasSourceVisual) {
    return ["reuse_with_crop_zoom", "packaging_overlay", "text_card"];
  }
  if (slotType === "usage_scene") {
    return hasSourceVisual ? ["reuse_with_crop_zoom", "text_card", "packaging_overlay"] : ["text_card", "aigc_placeholder"];
  }
  if (slotType === "comparison_scene" || slotType === "proof_visual") return ["text_card", "packaging_overlay", "reorder_structure"];
  if (slotType === "cta_visual") return ["packaging_overlay", "text_card"];
  if (request.controls?.allowReorder) return ["reorder_structure", "text_card"];
  return ["text_card", "packaging_overlay"];
}

export function generateGapReport(
  mappings: SlotMapping[],
  source: SourceVideoUnderstanding,
  request: GenerationRequest
): GapReportItem[] {
  const hasSourceVisual = source.candidates.length > 0;
  return mappings
    .filter((mapping) => mapping.status !== "matched")
    .map((mapping) => ({
      id: stableId("gap", mapping.slotId, mapping.status),
      slotId: mapping.slotId,
      gapType: mapping.slotType,
      severity: mapping.status === "missing" ? "high" : "medium",
      impact:
        mapping.status === "missing"
          ? `${mapping.slotType} has no direct source-video material and must be filled.`
          : `${mapping.slotType} has weak prompt-only support and needs packaging support.`,
      recommendedStrategies: strategiesForGap(mapping.slotType, hasSourceVisual, request)
    }));
}

export function createFillPlan(gaps: GapReportItem[], source: SourceVideoUnderstanding, request: GenerationRequest): FillAction[] {
  const firstReusable = source.candidates.find((candidate) => candidate.tags.includes("product_like")) ?? source.candidates[0];
  const allowAigc = request.controls?.allowAigcPlaceholder ?? true;
  return gaps.map((gap) => {
    const rawStrategy = gap.recommendedStrategies[0] ?? "text_card";
    const strategy =
      rawStrategy === "aigc_placeholder" && !allowAigc
        ? "text_card"
        : rawStrategy === "reuse_with_crop_zoom" && !firstReusable
          ? "text_card"
          : rawStrategy;
    const resultClipId = stableId("clip", gap.slotId, strategy);
    return {
      id: stableId("fill", gap.id, strategy),
      gapId: gap.id,
      strategy,
      description:
        strategy === "reuse_with_crop_zoom"
          ? "Reuse the strongest source-video shot with crop/zoom and benefit overlay."
          : strategy === "packaging_overlay"
            ? "Use title bar, sticker, highlight box and CTA overlay to compensate for weak material."
            : strategy === "reorder_structure"
              ? "Shorten or merge the weak slot into adjacent narrative structure."
              : strategy === "aigc_placeholder"
                ? "Create a placeholder prompt for future generated background replacement."
                : "Use a deterministic text/MG card based on the prompt.",
      resultClipId,
      sourceAssetIds: strategy === "reuse_with_crop_zoom" && source.assetId ? [source.assetId] : undefined,
      aigcPrompt:
        strategy === "aigc_placeholder"
          ? `Create a clean MG-style vertical placeholder for: ${parsePromptToBrief(request).productName}`
          : undefined
    };
  });
}

function subtitleForSlot(slotType: SlotType, request: GenerationRequest): string {
  const brief = parsePromptToBrief(request);
  if (slotType === "cta_visual") return brief.cta;
  if (slotType === "usage_scene") return `${brief.productName} fits ${brief.targetAudience}`;
  if (slotType === "comparison_scene" || slotType === "proof_visual") return `${brief.sellingPoints[0]} with clearer everyday value`;
  if (slotType === "hook_visual") return `${brief.productName}: ${brief.sellingPoints[0]}`;
  if (slotType === "product_closeup") return `${brief.sellingPoints[0]} in one compact design`;
  return brief.sellingPoints[1] ?? brief.topic;
}

export function buildTimeline(
  template: StructureTemplate,
  request: GenerationRequest,
  source: SourceVideoUnderstanding,
  mappings: SlotMapping[],
  gaps: GapReportItem[],
  fillPlan: FillAction[],
  generationId: string
): Timeline {
  let currentSec = 0;
  const maxClips = request.constraints?.maxClips ?? 8;
  const slots = template.segments.flatMap((segment) =>
    segment.requiredSlots.map((slotDef) => ({ segment, slotDef }))
  );
  const targetPerClip = clamp(request.target.targetDurationSec / Math.max(slots.length, 1), 1.2, 4);
  const clips: TimelineClip[] = [];

  for (const { segment, slotDef } of slots.slice(0, maxClips)) {
    const mapping = mappings.find((candidate) => candidate.slotId === slotDef.id);
    const fill = fillPlan.find((action) => action.gapId === gaps.find((gap) => gap.slotId === slotDef.id)?.id);
    const sourceShot = source.candidates.find((candidate) => candidate.id === mapping?.sourceShotId);
    const clipId = fill?.resultClipId ?? stableId("clip", generationId, slotDef.id);
    const durationSec = round(targetPerClip);
    const subtitle = subtitleForSlot(slotDef.slotType, request);
    const gapStrategy = mapping?.status === "matched" ? "none" : (fill?.strategy ?? "text_card");

    clips.push({
      id: clipId,
      sourceSlotId: slotDef.id,
      sourceSegmentId: segment.id,
      startSec: round(currentSec),
      durationSec,
      role: segment.role,
      visualIntent: slotDef.description,
      transitionIn: currentSec === 0 ? "none" : "hard_cut",
      transitionOut: "hard_cut",
      gapFillStrategy: gapStrategy,
      layers: [
        {
          id: stableId("layer_bg", clipId),
          type: "background",
          startOffsetSec: 0,
          durationSec,
          style: { color: request.controls?.packagingStyle === "clean" ? "#f8fafc" : "#0f172a" }
        },
        ...(mapping?.status === "matched" && source.assetId
          ? [
              {
                id: stableId("layer_video", clipId, source.assetId),
                type: "video" as const,
                assetId: source.assetId,
                sourceShotId: sourceShot?.id,
                startOffsetSec: 0,
                durationSec,
                transform: { fit: "cover", crop: "vertical", motion: "crop_zoom" }
              }
            ]
          : [
              {
                id: stableId("layer_card", clipId, subtitle),
                type: gapStrategy === "aigc_placeholder" ? ("generated_placeholder" as const) : ("text_card" as const),
                startOffsetSec: 0,
                durationSec,
                text: subtitle,
                placeholderPrompt: fill?.aigcPrompt,
                style: { card: template.packaging.style, role: segment.role }
              }
            ]),
        {
          id: stableId("layer_subtitle", clipId, subtitle),
          type: "subtitle",
          startOffsetSec: 0,
          durationSec,
          text: subtitle,
          style: { position: template.packaging.subtitle.position, density: template.packaging.subtitle.density }
        }
      ]
    });
    currentSec += durationSec;
  }

  const storyboard = clips.map((clip) => {
    const subtitle = clip.layers.find((layer) => layer.type === "subtitle")?.text ?? "";
    const mapping = mappings.find((candidate) => candidate.slotId === clip.sourceSlotId);
    return {
      clipId: clip.id,
      timeRange: `${clip.startSec.toFixed(1)}-${(clip.startSec + clip.durationSec).toFixed(1)}s`,
      shotDescription: clip.visualIntent,
      subtitle,
      assetUsage:
        mapping?.status === "matched"
          ? `Uses source video shot ${mapping.sourceShotId}.`
          : `Uses ${clip.gapFillStrategy} fill.`,
      packaging: `${template.packaging.style} cards, ${template.packaging.subtitle.density} subtitles`,
      rationale: mapping?.explanation ?? "Generated by deterministic reconstruction planner."
    };
  });

  return {
    schemaVersion: "1.1",
    id: stableId("timeline", generationId, request.prompt),
    projectId: request.projectId,
    generationId,
    targetDurationSec: round(currentSec),
    aspectRatio: request.target.aspectRatio,
    rendererTarget: "html_preview",
    clips,
    mapping: clips.map((clip) => {
      const mapping = mappings.find((candidate) => candidate.slotId === clip.sourceSlotId);
      return {
        sourceId: clip.sourceSlotId ?? clip.sourceSegmentId ?? clip.id,
        sourceType: "slot" as const,
        targetClipId: clip.id,
        status:
          mapping?.status === "matched" ? ("matched" as const) : mapping?.status === "weak_match" ? ("weak_match" as const) : ("missing_filled" as const),
        explanation: mapping?.explanation ?? "Slot was generated from fallback planning.",
        usedAssetIds: mapping?.assetId ? [mapping.assetId] : undefined
      };
    }),
    gapReport: gaps,
    fillPlan,
    storyboard,
    renderPlan: {
      width: request.target.aspectRatio === "9:16" ? 720 : 1280,
      height: request.target.aspectRatio === "9:16" ? 1280 : 720,
      fps: 30,
      background: request.controls?.packagingStyle === "clean" ? "#f8fafc" : "#0f172a",
      notes: "P0 renderer target is html_preview; FFmpeg/Remotion/HyperFrames are extension adapters."
    },
    migrationExplanation: `Transferred ${template.name} into a ${request.target.targetDurationSec}s ${request.target.vertical} reconstruction plan.`,
    warnings: [
      ...source.warnings,
      ...(request.target.vertical !== "b2b_marketing_mg"
        ? ["Current MVP is optimized for B-end marketing / MG-style outputs; this vertical is best-effort."]
        : [])
    ],
    createdAt: nowIso()
  };
}

export function generateMigrationResult(
  template: StructureTemplate,
  request: GenerationRequest,
  sourceAsset: Asset | undefined,
  sourceAnalysis: VideoAnalysisResult | undefined
): GenerationResult {
  const requestValidation = validateGenerationRequest(request);
  if (!requestValidation.valid) {
    throw new Error(`Invalid generation request: ${requestValidation.errors.join("; ")}`);
  }

  const generationId = stableId("generation", request.projectId, request.prompt, request.selectedTemplateIds);
  const sourceUnderstanding = understandSourceVideo(sourceAnalysis, sourceAsset, request);
  const slotMapping = matchSlots(template, sourceUnderstanding, request);
  const gapReport = generateGapReport(slotMapping, sourceUnderstanding, request);
  const fillPlan = createFillPlan(gapReport, sourceUnderstanding, request);
  const timeline = buildTimeline(template, request, sourceUnderstanding, slotMapping, gapReport, fillPlan, generationId);
  const timelineValidation = validateTimeline(timeline);
  if (!timelineValidation.valid) {
    throw new Error(`Invalid timeline: ${timelineValidation.errors.join("; ")}`);
  }

  return {
    id: generationId,
    projectId: request.projectId,
    request,
    selectedTemplateIds: [template.id],
    selectedAtoms: template.structureAtoms,
    sourceUnderstanding,
    slotMapping,
    gapReport,
    fillPlan,
    storyboard: timeline.storyboard,
    timeline,
    validation: {
      generationRequest: requestValidation,
      timeline: timelineValidation
    },
    explanation: timeline.migrationExplanation ?? "Generated v1.1 reconstruction result.",
    warnings: timeline.warnings ?? [],
    createdAt: nowIso()
  };
}

export function validateGeneratedStructure(template: StructureTemplate) {
  return validateStructureTemplate(template);
}
