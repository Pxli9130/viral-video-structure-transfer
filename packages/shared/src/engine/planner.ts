import type { VLMVideoAnalysis } from "../adapters.js";
import type {
  Asset,
  AssetKeyframe,
  AnalysisPurpose,
  AnalyzerMode,
  AspectRatio,
  EditingTechnique,
  FillAction,
  FillStrategy,
  GapCategory,
  GapRepairOption,
  GapReportItem,
  GenerationRequest,
  GenerationResult,
  KnowledgeAtom,
  MotionAtomSpec,
  MotionSpec,
  PackagingSpec,
  PlaceholderSpec,
  RendererBackend,
  RenderRecipe,
  RenderRecipeClip,
  RenderRecipePrimitive,
  RenderRecipeFamily,
  RequiredSlot,
  ReplacementSlot,
  SlotReplacementBinding,
  RibbonMotionGeometry,
  RhythmSpec,
  SegmentRole,
  ShotCandidate,
  HeroObjectDescriptor,
  SlotMapping,
  SlotModality,
  SlotType,
  SourcePolicyBlock,
  SourceVideoUnderstanding,
  StoryboardItem,
  StructureSegment,
  StructureTemplate,
  TargetAssetInput,
  TargetAssetKind,
  TechniqueAtom,
  Timeline,
  TimelineClip,
  TimelineClipType,
  TimelineLayer,
  TimelineMappingItem,
  TranscriptSegment,
  VisualStyleSpec,
  VisualFormFamily,
  VideoAnalysisResult,
  Vertical
} from "../types.js";
import { augmentTemplateWithInducedSlots, bindSlotEvidence, clickToReplaceForFamily, induceSlotsFromAnalysis, primaryRendererCapabilityForFamily } from "./slotInduction.js";
import {
  validateAssetAnalysis,
  validateGenerationRequest,
  validateStructureTemplate,
  validateTimeline
} from "../validation.js";
import {
  extractBrandName,
  extractCtaTextFromPrompt,
  extractProductNameFromPrompt,
  migrateRenderRecipeToV4_1,
  sanitizeDisplayText
} from "./renderRecipeV41.js";
import { extractTechniqueAtoms } from "./atomExtractor.js";
import { buildDefaultProviderDecisions, buildModelRouteSummary } from "../model-router/index.js";
import { applyRankedRepairOptions, rankGapRepairOptions } from "./gapRepairRanker.js";
import { compileProviderPromptPlan } from "./providerPromptCompiler.js";
import { generateStructureExplanation } from "./structureExplanation.js";
import { lintRenderRecipe } from "./recipeLint.js";
import { critiqueVideoOffline } from "./videoCritic.js";

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

/**
 * Turn an arbitrary string (theme, filename, CJK title) into a safe filename token:
 * keep letters/digits/CJK, collapse everything else to "_", drop a trailing extension,
 * cap length codepoint-safely. Deterministic (no clock/hash).
 */
export function sanitizeNameToken(input: string, maxLen = 40): string {
  const token = (input ?? "")
    .normalize("NFKC")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const capped = [...token].slice(0, maxLen).join("");
  return capped || "untitled";
}

/** ISO minute precision ("2026-05-29T00:00Z"): stable within a run, differentiates repeat analyses. */
export function nameTimestamp(iso: string): string {
  const base = (iso && iso.length >= 16 ? iso.slice(0, 16) : new Date(0).toISOString().slice(0, 16)) + "Z";
  return base;
}

/** Compact filename timestamp ("20260529T143052Z") for user-facing render output files. */
export function fileTimestamp(iso: string): string {
  return (iso || nowIso()).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function inferAspectRatio(width: number, height: number): AspectRatio {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.08) return "9:16";
  if (Math.abs(ratio - 16 / 9) < 0.08) return "16:9";
  return "1:1";
}

export interface MockAnalysisInput {
  assetId: string;
  projectId: string;
  filename?: string;
  purpose?: AnalysisPurpose;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
}

const SAMPLE_SHOT_TAGS: string[][] = [
  ["hook_candidate", "product_like"],
  ["usage_scene"],
  ["product_like", "text_card_candidate"],
  ["comparison_candidate"],
  ["cta_candidate"]
];

const SOURCE_SHOT_TAGS: string[][] = [
  ["hook_candidate", "background"],
  ["product_like"],
  ["usage_scene"],
  ["person_scene"],
  ["product_like", "comparison_candidate"],
  ["background"],
  ["text_card_candidate"],
  ["cta_candidate"]
];

export function buildMockVideoAnalysis(input: MockAnalysisInput): VideoAnalysisResult {
  const purpose = input.purpose ?? "sample";
  const durationSec = clamp(round(input.durationSec ?? (purpose === "source" ? 30 : 15)), 3, 300);
  const width = Math.round(input.width ?? 720);
  const height = Math.round(input.height ?? 1280);
  const fps = Math.round(input.fps ?? 30);
  const shotCount = purpose === "source" ? Math.min(8, Math.max(4, Math.ceil(durationSec / 6))) : 5;
  const baseDuration = durationSec / shotCount;
  const palette = purpose === "source" ? SOURCE_SHOT_TAGS : SAMPLE_SHOT_TAGS;

  const shots: ShotCandidate[] = Array.from({ length: shotCount }).map((_, index) => {
    const startSec = round(index * baseDuration);
    const endSec = index === shotCount - 1 ? durationSec : round((index + 1) * baseDuration);
    return {
      id: `${purpose}_shot_${index + 1}`,
      startSec,
      endSec,
      durationSec: round(endSec - startSec),
      thumbnailPath: `mock://${input.assetId}/frame-${index + 1}.png`,
      tags: palette[index % palette.length] ?? ["background"],
      confidence: 0.7 + (index % 4) * 0.05,
      notes: purpose === "sample" ? "Deterministic mock shot." : "Heuristic mock shot for evaluator-style source video."
    };
  });

  const keyframes: AssetKeyframe[] = shots.map((shot, index) => ({
    id: `keyframe_${index + 1}`,
    timeSec: shot.startSec,
    path: shot.thumbnailPath,
    description: `${input.filename ?? "video"} keyframe ${index + 1}`,
    tags: shot.tags
  }));

  return {
    id: stableId("analysis", input.assetId, purpose, durationSec, width, height),
    assetId: input.assetId,
    projectId: input.projectId,
    purpose,
    metadata: {
      durationSec,
      width,
      height,
      fps,
      hasAudio: true,
      codec: "mock-h264"
    },
    keyframes,
    shots,
    transcript:
      purpose === "sample"
        ? [
            { startSec: 0, endSec: durationSec * 0.2, text: "Hook line: stop scroll." },
            { startSec: durationSec * 0.2, endSec: durationSec * 0.7, text: "Selling points and benefits." },
            { startSec: durationSec * 0.7, endSec: durationSec, text: "CTA and recap." }
          ]
        : [{ startSec: 0, endSec: durationSec, text: "Mock source transcript (no ASR)." }],
    ocr: [],
    warnings: [],
    analyzerMode: "mock",
    createdAt: nowIso()
  };
}

const REQUIRED_SLOT_BLUEPRINT: Array<{
  id: string;
  role: SegmentRole;
  slotType: SlotType;
  description: string;
  preferredTags: string[];
}> = [
  { id: "slot_hook_visual", role: "hook", slotType: "hook_visual", description: "Opening product/result visual", preferredTags: ["hook_candidate", "product_like"] },
  { id: "slot_product_closeup", role: "body", slotType: "product_closeup", description: "Concrete product/feature closeup", preferredTags: ["product_like"] },
  { id: "slot_usage_scene", role: "body", slotType: "usage_scene", description: "Usage / context / scenario", preferredTags: ["usage_scene"] },
  { id: "slot_subtitle_text", role: "body", slotType: "subtitle_text", description: "Selling point subtitle copy", preferredTags: ["text_card_candidate"] },
  { id: "slot_comparison", role: "proof", slotType: "comparison", description: "Proof / contrast / before-after", preferredTags: ["comparison_candidate"] },
  { id: "slot_cta_visual", role: "cta", slotType: "cta_visual", description: "Closing CTA visual / card", preferredTags: ["cta_candidate"] }
];

function uniqueVerticals(vertical: Vertical, extras: string[] = []): string[] {
  const set = new Set<string>([vertical, ...extras]);
  return Array.from(set);
}

function summariseVlm(vlm: VLMVideoAnalysis | undefined): string {
  if (!vlm?.videoSummary) return "";
  return vlm.videoSummary.slice(0, 160);
}

function abstractHookAtomName(observed: string | undefined): string {
  const text = (observed ?? "").toLowerCase();
  if (!text) return "Result-first hook";
  if (/result|outcome|after|效果|结果/.test(text)) return "Result-first hook";
  if (/pain|problem|before|痛点|问题/.test(text)) return "Pain-point hook";
  if (/product|hero|closeup|close-up|device|bottle|商品|产品|特写/.test(text)) return "Product-first hook";
  if (/title|headline|text|card|字幕|标题|文案/.test(text)) return "Title-card hook";
  return "Attention-first hook";
}

function abstractProofAtomName(observed: string | undefined): string {
  const text = (observed ?? "").toLowerCase();
  if (!text) return "Proof by contrast card";
  if (/contrast|comparison|before|after|\bvs\b|对比|前后/.test(text)) return "Contrast proof beat";
  if (/metric|stat|number|data|%|倍|数据/.test(text)) return "Metric proof beat";
  if (/review|testimonial|social|口碑|评价/.test(text)) return "Social-proof beat";
  if (/climax|peak|reveal|高潮|爆点/.test(text)) return "Climax proof beat";
  return "Proof by contrast card";
}

function abstractCtaAtomName(observed: string | undefined): string {
  const text = (observed ?? "").toLowerCase();
  if (!text) return "Readable CTA end card";
  if (/brand|handle|logo|reveal|品牌|账号|标识/.test(text)) return "Brand-reveal CTA";
  if (/buy|shop|click|learn|download|点击|购买|了解|领取/.test(text)) return "Direct action CTA";
  if (/follow|subscribe|关注|订阅/.test(text)) return "Follow CTA";
  if (/soft|save|remember|收藏|保存/.test(text)) return "Soft CTA end card";
  return "Readable CTA end card";
}

function abstractSellingPointAtomName(sellingPoints: string[]): string {
  if (sellingPoints.length > 1) return "Benefit-stack selling-point card";
  if (sellingPoints.length === 1) return "Single-benefit selling-point card";
  return "Crop-zoom + benefit overlay";
}

function abstractReusablePatternName(pattern: string): string {
  const text = pattern.toLowerCase();
  if (/transition|slide|wipe|cut|转场|切换/.test(text)) return "Reusable transition motif";
  if (/motion|loop|3d|ribbon|camera|zoom|spin|动画|运镜/.test(text)) return "Reusable motion motif";
  if (/color|palette|neon|gradient|色彩|配色/.test(text)) return "Reusable color system";
  if (/cover|title|lock|thumbnail|封面|标题/.test(text)) return "Reusable cover layout";
  if (/subtitle|caption|text|字幕|文案/.test(text)) return "Reusable subtitle treatment";
  if (/cta|closing|end|结尾|引导/.test(text)) return "Reusable CTA ending";
  if (/proof|comparison|contrast|对比|证明/.test(text)) return "Reusable proof layout";
  return "Reusable shot pattern";
}

function buildStructureAtoms(
  templateId: string,
  projectId: string,
  vertical: Vertical,
  vlm?: VLMVideoAnalysis
): KnowledgeAtom[] {
  const vlmSummary = summariseVlm(vlm);
  const sellingPoints = vlm?.structure?.sellingPoints ?? [];
  const subtitleDensity = vlm?.packaging?.subtitleDensity;
  const titleCards = vlm?.packaging?.titleCards ?? [];
  const peakRatio = typeof vlm?.rhythm?.peakTimeRatio === "number" ? vlm!.rhythm.peakTimeRatio!.toFixed(2) : undefined;
  const avgShot = typeof vlm?.rhythm?.avgShotLength === "number" ? vlm!.rhythm.avgShotLength!.toFixed(2) : undefined;

  const baseAtoms: KnowledgeAtom[] = [
    {
      id: stableId("atom_hook", templateId),
      projectId,
      templateId,
      role: "hook",
      category: "hook_pattern",
      name: abstractHookAtomName(vlm?.structure?.hook),
      description: vlm?.structure?.hook
        ? `Observed opening: ${vlm.structure.hook}`
        : "Open with the clearest product/result frame and a short benefit claim.",
      applicableVerticals: uniqueVerticals(vertical),
      usageRules: "Use when prompt contains a concrete product or pain point.",
      exampleMapping: vlmSummary || "0–20% segment opens with product crop and top-bar headline.",
      confidence: 0.85
    },
    {
      id: stableId("atom_rhythm", templateId),
      projectId,
      templateId,
      role: "body",
      category: "rhythm_pattern",
      name: avgShot ? `Rhythm: ~${avgShot}s avg shot` : "Fast cuts with value pulses",
      description: avgShot
        ? `Source video pace: avg shot ${avgShot}s${peakRatio ? `, climax near ratio ${peakRatio}` : ""}.`
        : "Alternate 1.5–2.5s shots, one benefit per cut.",
      applicableVerticals: uniqueVerticals(vertical),
      usageRules: "Use when target duration is under 20s and pace is fast.",
      confidence: 0.8
    },
    {
      id: stableId("atom_subtitle", templateId),
      projectId,
      templateId,
      role: "body",
      category: "subtitle_style",
      name: subtitleDensity ? `${subtitleDensity.toUpperCase()} subtitle density` : "Bold MG subtitle",
      description: titleCards.length
        ? `Title-card style observed: ${titleCards.slice(0, 2).join("; ")}.`
        : "Lower-third bold subtitle, one benefit per shot.",
      applicableVerticals: uniqueVerticals(vertical),
      usageRules: "Use high subtitle density when source visuals are weak.",
      confidence: 0.78
    },
    {
      id: stableId("atom_proof", templateId),
      projectId,
      templateId,
      role: "proof",
      category: "packaging_pattern",
      name: abstractProofAtomName(vlm?.structure?.climax),
      description: vlm?.structure?.climax
        ? `Climax beat observed: ${vlm.structure.climax}`
        : "Split layout for before/after or pain/solution.",
      applicableVerticals: uniqueVerticals(vertical),
      usageRules: "Use when source has comparison footage or prompt mentions improvement.",
      confidence: 0.75
    },
    {
      id: stableId("atom_cta", templateId),
      projectId,
      templateId,
      role: "cta",
      category: "cta_pattern",
      name: abstractCtaAtomName(vlm?.structure?.cta),
      description: vlm?.structure?.cta
        ? `Observed CTA pattern: ${vlm.structure.cta}`
        : "Hold final CTA with benefit recap and brand mark.",
      applicableVerticals: uniqueVerticals(vertical),
      usageRules: "Use for any marketing/promo output.",
      confidence: 0.9
    },
    {
      id: stableId("atom_gap_fill", templateId),
      projectId,
      templateId,
      role: "body",
      category: "gap_fill_strategy",
      name: abstractSellingPointAtomName(sellingPoints),
      description: sellingPoints.length
        ? `Reuse this card pattern for selling points: ${sellingPoints.join(", ")}.`
        : "Reuse the strongest source shot with crop/zoom; overlay benefit text.",
      applicableVerticals: uniqueVerticals(vertical),
      usageRules: "Use when product closeup or usage slots have no direct source.",
      confidence: 0.82
    }
  ];

  const reusable = vlm?.reusablePatterns ?? [];
  const patternAtoms: KnowledgeAtom[] = reusable.slice(0, 4).map((pattern, index) => ({
    id: stableId("atom_pattern", templateId, pattern, index),
    projectId,
    templateId,
    role: /hook|opening/i.test(pattern) ? "hook" : /cta|closing|end/i.test(pattern) ? "cta" : /proof|comparison|contrast/i.test(pattern) ? "proof" : "body",
    category: /transition/i.test(pattern) ? "transition_pattern" : /subtitle|caption|text/i.test(pattern) ? "subtitle_style" : "shot_pattern",
    name: abstractReusablePatternName(pattern),
    description: vlmSummary
      ? `Pattern '${pattern}' observed in: ${vlmSummary}`
      : `Pattern '${pattern}' observed in source video.`,
    applicableVerticals: uniqueVerticals(vertical),
    usageRules: "Replay this pattern when reconstruction calls for a similar beat.",
    confidence: 0.7
  }));

  return [...baseAtoms, ...patternAtoms];
}

function buildEditingTechniques(): EditingTechnique[] {
  return [
    {
      id: "tech_crop_zoom_reuse",
      name: "Crop/zoom reuse",
      category: "shot_transform",
      description: "Reuse a source shot with crop, push-in or repeat to satisfy a visual slot.",
      usageRules: "Limit reuse to twice; vary motion direction."
    },
    {
      id: "tech_title_bar_emphasis",
      name: "Title bar emphasis",
      category: "packaging",
      description: "Bold title bar + short subtitle to make weak footage understandable.",
      usageRules: "Use high subtitle density for B-end MG."
    },
    {
      id: "tech_hard_cut",
      name: "Hard-cut transitions",
      category: "transition",
      description: "Hard cuts between segments to keep MG pace.",
      usageRules: "Avoid soft dissolves in fast-pace promos."
    }
  ];
}

function buildSegments(vlm?: VLMVideoAnalysis): StructureSegment[] {
  const hookIntent = vlm?.structure?.hook
    ? `Observed hook: ${vlm.structure.hook}`
    : "Stop scroll with a product-like visual and a clear benefit promise.";
  const setup = vlm?.structure?.setup;
  const sellingPoints = vlm?.structure?.sellingPoints?.length
    ? `Selling points: ${vlm.structure.sellingPoints.join("; ")}.`
    : "";
  const bodyIntent = setup || sellingPoints
    ? [setup ? `Setup: ${setup}` : null, sellingPoints || null].filter(Boolean).join(" ")
    : "Explain core value with usage, closeup and MG selling-point cards.";
  const proofIntent = vlm?.structure?.climax
    ? `Observed climax: ${vlm.structure.climax}`
    : "Show proof, comparison or social trust before the close.";
  const ctaIntent = vlm?.structure?.cta
    ? `Observed CTA: ${vlm.structure.cta}`
    : "Close with action and a final remembered benefit.";
  return [
    {
      id: "seg_hook",
      role: "hook",
      startRatio: 0,
      endRatio: 0.2,
      intent: hookIntent,
      scriptPattern: "Open with the pain point or visible result in one line.",
      slots: ["slot_hook_visual", "slot_subtitle_text"],
      recommendedDurationSec: 3
    },
    {
      id: "seg_body",
      role: "body",
      startRatio: 0.2,
      endRatio: 0.7,
      intent: bodyIntent,
      scriptPattern: "One benefit per shot, alternating closeup, usage and text card.",
      slots: ["slot_product_closeup", "slot_usage_scene", "slot_subtitle_text"],
      recommendedDurationSec: 8
    },
    {
      id: "seg_proof",
      role: "proof",
      startRatio: 0.7,
      endRatio: 0.85,
      intent: proofIntent,
      scriptPattern: "Before/after or pain/solution; concrete and skimmable.",
      slots: ["slot_comparison"],
      recommendedDurationSec: 2
    },
    {
      id: "seg_cta",
      role: "cta",
      startRatio: 0.85,
      endRatio: 1,
      intent: ctaIntent,
      scriptPattern: "CTA verb + strongest benefit recap.",
      slots: ["slot_cta_visual", "slot_subtitle_text"],
      recommendedDurationSec: 2
    }
  ];
}

function buildRequiredSlots(): RequiredSlot[] {
  return REQUIRED_SLOT_BLUEPRINT.map((blueprint) => ({
    id: blueprint.id,
    role: blueprint.role,
    slotType: blueprint.slotType,
    required: true,
    description: blueprint.description,
    preferredTags: blueprint.preferredTags,
    fallbackStrategies: ["reuse_with_crop_zoom", "text_card", "packaging_overlay"] as FillStrategy[]
  }));
}

function editingMotifEvidenceHaystack(analysis: VideoAnalysisResult | undefined, vlm: VLMVideoAnalysis | undefined): string {
  return [
    vlm?.videoSummary,
    vlm?.videoType,
    vlm?.structure?.hook,
    vlm?.structure?.setup,
    vlm?.structure?.climax,
    vlm?.structure?.cta,
    ...(vlm?.structure?.sellingPoints ?? []),
    vlm?.packaging?.coverStyle,
    vlm?.packaging?.colorStyle,
    ...(vlm?.packaging?.titleCards ?? []),
    ...(vlm?.packaging?.stickers ?? []),
    ...(vlm?.reusablePatterns ?? []),
    ...(vlm?.materialGapsForNewVideo ?? []),
    ...(vlm?.shots ?? []).flatMap((shot) => [shot.visual, shot.purpose, shot.transition]),
    analysis?.primaryMotif?.motif,
    ...(analysis?.motifCandidates ?? []).map((candidate) => candidate.motif),
    ...(analysis?.keyframes ?? []).flatMap((frame) => [frame.description, ...(frame.tags ?? [])]),
    ...(analysis?.shots ?? []).flatMap((shot) => [shot.notes, ...(shot.tags ?? [])])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferRotatingSemanticLabel(haystack: string): string {
  if (/helmet|头盔/.test(haystack)) return "helmet";
  if (/(?:\bhead\b|face|avatar|头像|人头|头部)/.test(haystack)) return "head";
  if (/(?:\blogo\b|brand|标识|品牌)/.test(haystack)) return "logo";
  if (/(?:object|product|hero|主体|主视觉|物体)/.test(haystack)) return "hero_object";
  return "unknown_object";
}

function motifSlotsFromEvidence(analysis: VideoAnalysisResult | undefined, vlm: VLMVideoAnalysis | undefined): RequiredSlot[] {
  const haystack = editingMotifEvidenceHaystack(analysis, vlm);
  const hasRotatingHero =
    /(rotat|spin|orbit|3d|three[-\s]?d|logo intro|visual logo|opening logo|hero object|helmet|head|avatar|旋转|三维|3d|头盔|头像|开头.*(?:logo|标识|主视觉))/.test(haystack) &&
    /(intro|opening|hook|logo|head|helmet|object|hero|开头|片头|主视觉|主体|物体|标识)/.test(haystack);
  const hasKineticText = /(kinetic|dynamic text|text[_\s-]*card|typography|subtitle|caption|bold text|字幕|文字|动效字|标题卡|黑底强字幕)/.test(haystack);
  const hasBeatMontage = /(beat|sync|montage|action|cinematic|movie|gunshot|punch|卡点|混剪|动作|电影|节奏|鼓点)/.test(haystack);
  const hasMatchCut = /(match[_\s-]*cut|seamless action|action matching|transition motif|转场|匹配剪辑|动作匹配|无缝)/.test(haystack);
  const hasCtaEndSlate = /(cta|call[-\s]*to[-\s]*action|end slate|closing|结尾|引导|关注|练习|行动号召)/.test(haystack);

  const slots: RequiredSlot[] = [];
  if (hasRotatingHero) {
    slots.push({
      id: "slot_rotating_hero_object_intro",
      role: "hook",
      slotType: "hook_visual",
      required: true,
      description: "Opening rotating 3D hero object/logo/head-like visual motif",
      preferredTags: ["rotating_object_candidate", "hook_candidate"],
      fallbackStrategies: ["proxy_placeholder", "user_asset_replace", "aigc_placeholder"],
      visualForm: "rotating_3d_object",
      semanticLabel: inferRotatingSemanticLabel(haystack),
      motionSpec: { type: "spin", axis: "screen_y", speed: 0.8, preserveFromSlot: true },
      clickToReplace: true
    });
  }
  if (hasKineticText) {
    slots.push({
      id: "slot_kinetic_text_card_sequence",
      role: "body",
      slotType: "title_card",
      required: true,
      description: "Kinetic bold text-card sequence synchronized to the edit rhythm",
      preferredTags: ["text_card_candidate"],
      fallbackStrategies: ["text_card", "packaging_overlay"],
      visualForm: "kinetic_text_card",
      semanticLabel: "kinetic_text",
      motionSpec: { type: "scale", speed: 0.5, preserveFromSlot: true },
      clickToReplace: false
    });
  }
  if (hasBeatMontage) {
    slots.push({
      id: "slot_beat_sync_action_montage",
      role: "body",
      slotType: "usage_scene",
      required: true,
      description: "Beat-synced action or cinematic montage clip sequence",
      preferredTags: ["action_montage_candidate", "usage_scene"],
      fallbackStrategies: ["proxy_placeholder", "aigc_placeholder", "text_card"],
      visualForm: "action_montage_sequence",
      semanticLabel: "action_montage",
      motionSpec: { type: "crop_zoom", speed: 0.95, preserveFromSlot: true },
      clickToReplace: true
    });
  }
  if (hasMatchCut) {
    slots.push({
      id: "slot_cinematic_match_cut_sequence",
      role: "proof",
      slotType: "comparison",
      required: true,
      description: "Cinematic match-cut proof sequence with aligned action beats",
      preferredTags: ["match_cut_candidate", "comparison_candidate"],
      fallbackStrategies: ["proxy_placeholder", "text_card", "packaging_overlay"],
      visualForm: "match_cut_sequence",
      semanticLabel: "match_cut_sequence",
      motionSpec: { type: "crop_zoom", speed: 0.9, preserveFromSlot: true },
      clickToReplace: true
    });
  }
  if (hasCtaEndSlate) {
    slots.push({
      id: "slot_cta_end_slate",
      role: "cta",
      slotType: "cta_visual",
      required: true,
      description: "CTA end-slate visual/card adapted to the new target",
      preferredTags: ["cta_candidate"],
      fallbackStrategies: ["packaging_overlay", "text_card"],
      visualForm: "cta",
      semanticLabel: "cta_end_slate",
      motionSpec: { type: "scale", speed: 0.35, preserveFromSlot: true },
      clickToReplace: true
    });
  }
  return slots;
}

function addSlotToSegment(segments: StructureSegment[], segmentId: string, slotId: string): StructureSegment[] {
  return segments.map((segment) => {
    if (segment.id !== segmentId || segment.slots.includes(slotId)) return segment;
    return { ...segment, slots: [...segment.slots, slotId] };
  });
}

function augmentTemplateWithEditingMotifs(template: StructureTemplate, analysis: VideoAnalysisResult, vlm?: VLMVideoAnalysis): StructureTemplate {
  const motifSlots = motifSlotsFromEvidence(analysis, vlm);
  if (!motifSlots.length) return template;
  const existing = new Set(template.requiredSlots.map((slot) => slot.id));
  const slotsToAdd = motifSlots.filter((slot) => !existing.has(slot.id));
  if (!slotsToAdd.length) return template;
  let segments = template.segments;
  for (const slot of slotsToAdd) {
    if (slot.id === "slot_rotating_hero_object_intro") segments = addSlotToSegment(segments, "seg_hook", slot.id);
    if (slot.id === "slot_kinetic_text_card_sequence") segments = addSlotToSegment(segments, "seg_body", slot.id);
    if (slot.id === "slot_beat_sync_action_montage") segments = addSlotToSegment(segments, "seg_body", slot.id);
    if (slot.id === "slot_cinematic_match_cut_sequence") segments = addSlotToSegment(segments, "seg_proof", slot.id);
    if (slot.id === "slot_cta_end_slate") segments = addSlotToSegment(segments, "seg_cta", slot.id);
  }
  return {
    ...template,
    segments,
    requiredSlots: [...template.requiredSlots, ...slotsToAdd],
    qualityRationale: `${template.qualityRationale} Motif slots extracted: ${slotsToAdd.map((slot) => slot.id).join(", ")}.`
  };
}

function buildPackaging(vlm?: VLMVideoAnalysis): PackagingSpec {
  const subtitleStyle = vlm?.packaging?.subtitleDensity
    ? `${vlm.packaging.subtitleDensity} density · ${vlm.packaging.titleCards?.[0] ?? "lower-third bold sans-serif"}`
    : "lower-third bold sans-serif, single benefit per shot";
  const titleCardStyle = vlm?.packaging?.titleCards?.[0] ?? "MG card with icon/sticker and 1-line headline";
  const overlayStyle = vlm?.packaging?.stickers?.length
    ? `stickers: ${vlm.packaging.stickers.slice(0, 3).join(", ")}`
    : "highlight box + arrow for key spec";
  const transitionStyle = vlm?.shots?.find((s) => s.transition && s.transition !== "none")?.transition
    ? `observed transitions include ${vlm!.shots
        .map((s) => s.transition)
        .filter((t): t is string => Boolean(t) && t !== "none")
        .slice(0, 3)
        .join(", ")}`
    : "hard cut + occasional slide";
  const coverStyle = vlm?.packaging?.coverStyle ?? "product name + strongest benefit badge";
  return { subtitleStyle, titleCardStyle, overlayStyle, transitionStyle, coverStyle };
}

function paceFromAvg(avg: number | undefined): RhythmSpec["pace"] {
  if (avg === undefined) return "fast";
  if (avg < 1.5) return "fast";
  if (avg < 3) return "medium";
  if (avg < 5) return "slow";
  return "mixed";
}

function buildRhythm(durationSec: number, vlm?: VLMVideoAnalysis, analysis?: VideoAnalysisResult): RhythmSpec {
  const ev = analysis?.evidenceTimeline;
  const evAvg = ev?.stats?.avgShotDurationSec;
  const avg = evAvg ?? vlm?.rhythm?.avgShotLength ?? round(durationSec / 5);
  const peakRatio = vlm?.rhythm?.peakTimeRatio ?? 0.7;
  const bpm = ev?.beatGrid?.status === "ok" ? ev.beatGrid.bpm : undefined;
  const beatCount = ev?.beatGrid?.beats?.length;
  const evFast = ev?.stats?.fastZones?.length
    ? `fast zones: ${ev.stats.fastZones.slice(0, 4).map(([a, b]) => `${a}-${b}s`).join(", ")}`
    : null;
  const beatNotes = [
    bpm ? `~${bpm} BPM beat grid` : null,
    evFast,
    vlm?.rhythm?.notes,
    vlm?.rhythm?.fastSections?.length ? `fast: ${vlm.rhythm.fastSections.join(", ")}` : null,
    vlm?.rhythm?.peakMoments?.length ? `peaks: ${vlm.rhythm.peakMoments.join(", ")}` : null
  ]
    .filter(Boolean)
    .join(" | ") || "Fast opening, value pulses through the middle, readable CTA hold.";
  return {
    pace: paceFromAvg(avg),
    averageShotDurationSec: round(avg),
    peakTimeRatio: peakRatio,
    bpm: bpm ?? undefined,
    beatCount: beatCount ?? undefined,
    notes: beatNotes
  };
}

function parseRawVlm(raw: string | undefined): Record<string, any> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function parseTimeRange(value: unknown): { startSec: number; endSec: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const startSec = Number(match[1]);
  const endSec = Number(match[2]);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return undefined;
  return { startSec, endSec };
}

function normaliseExcludeSegments(input: unknown, durationSec: number): StructureTemplate["excludeSegments"] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item: any) => {
      const range = parseTimeRange(item?.time ?? item?.range);
      const startSec = Number(item?.startSec ?? item?.start_sec ?? item?.start ?? range?.startSec);
      const endSec = Number(item?.endSec ?? item?.end_sec ?? item?.end ?? range?.endSec);
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return undefined;
      return {
        startSec: round(clamp(startSec, 0, durationSec)),
        endSec: round(clamp(endSec, 0, durationSec)),
        reason: String(item?.reason ?? item?.notes ?? "Excluded from transferable creative structure.")
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function excludeSegmentsFromVlm(vlm: VLMVideoAnalysis | undefined, durationSec: number): StructureTemplate["excludeSegments"] {
  const raw = parseRawVlm(vlm?.raw);
  return normaliseExcludeSegments(vlm?.excludeSegments ?? raw?.excludeSegments ?? raw?.exclude_segments, durationSec);
}

function transferableDurationSec(durationSec: number, excludeSegments: StructureTemplate["excludeSegments"]): number {
  if (!excludeSegments?.length) return durationSec;
  const excludedSec = excludeSegments.reduce((sum, segment) => sum + Math.max(0, segment.endSec - segment.startSec), 0);
  return Math.max(1, round(durationSec - excludedSec));
}

function videoTypeFromVlm(vlm: VLMVideoAnalysis | undefined, vertical: Vertical): string {
  if (vlm?.videoType) return vlm.videoType;
  const haystack = [vlm?.videoSummary, vlm?.packaging?.coverStyle, vlm?.packaging?.titleCards?.join(" "), vlm?.packaging?.stickers?.join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // beat_cut is determined by the deterministic evidence timeline (cuts + beats + dark bg
  // + montage), not by VLM keywords like "montage" which also appear in MG promos.
  if (/motion|mg|poster|ribbon|title card|动态海报|海报|彩带/.test(haystack)) return "motion_graphic_marketing_poster";
  if (/talking|口播|person|face/.test(haystack)) return "talking_head";
  if (/vlog/.test(haystack)) return "vlog";
  return vertical;
}

/**
 * Determine videoType with the deterministic evidence timeline taking priority over the
 * VLM summary: fast cuts + an audio beat grid + dark background + an action montage are a
 * strong, hallucination-proof signal of a beat_cut / editing-tutorial sample.
 */
function detectVideoType(vlm: VLMVideoAnalysis | undefined, vertical: Vertical, analysis?: VideoAnalysisResult): string {
  const ev = analysis?.evidenceTimeline;
  if (ev) {
    const beats = ev.beatGrid?.beats?.length ?? 0;
    const hasBeatAudio = ev.beatGrid?.status === "ok" && beats >= 20;
    const fast = (ev.stats?.medianShotDurationSec ?? 99) < 2.6 || (ev.stats?.cutDensity ?? 0) > 0.22;
    const dark = (ev.stats?.blackBgRatio ?? 0) > 0.4;
    const montage = ev.shots?.some((shot) => shot.family === "live_action_montage") ?? false;
    const score = (fast ? 1 : 0) + (dark ? 1 : 0) + (montage ? 1 : 0) + (hasBeatAudio ? 1 : 0);
    if (score >= 3) return "beat_cut";
  }
  return videoTypeFromVlm(vlm, vertical);
}

function colorProgressionFromText(text: string | undefined): string[] | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  const colors: string[] = [];
  const push = (name: string) => {
    if (lower.includes(name) && !colors.includes(name)) colors.push(name);
  };
  ["blue", "purple", "pink", "orange", "yellow", "green", "red", "black", "white"].forEach(push);
  return colors.length ? colors : undefined;
}

const DEFAULT_PARAMETRIC_RIBBON: RibbonMotionGeometry = {
  surfaceType: "wide_band",
  pathFamily: "planar_orbit",
  axis: "screen_z",
  depthBehavior: "perspective_only",
  layoutRelation: "around_title",
  textRelation: "text_on_ribbon",
  confidence: 0.55,
  evidenceFrames: []
};

function normaliseRibbonMotionGeometry(input: unknown, fallback: RibbonMotionGeometry = DEFAULT_PARAMETRIC_RIBBON): RibbonMotionGeometry {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<RibbonMotionGeometry>;
  const pathFamily = raw.pathFamily ?? fallback.pathFamily;
  const axis =
    raw.axis ??
    (pathFamily === "vertical_helix" ? "screen_y" : pathFamily === "planar_orbit" ? "screen_z" : pathFamily === "horizontal_wave" ? "screen_x" : fallback.axis);
  return {
    surfaceType: raw.surfaceType ?? fallback.surfaceType,
    pathFamily,
    axis,
    depthBehavior: raw.depthBehavior ?? fallback.depthBehavior,
    layoutRelation: raw.layoutRelation ?? fallback.layoutRelation,
    textRelation: raw.textRelation ?? fallback.textRelation,
    confidence: raw.confidence ?? fallback.confidence,
    evidenceFrames: Array.isArray(raw.evidenceFrames) ? raw.evidenceFrames : fallback.evidenceFrames,
    turns: raw.turns ?? fallback.turns,
    radiusX: raw.radiusX ?? fallback.radiusX,
    radiusZ: raw.radiusZ ?? fallback.radiusZ,
    pitchY: raw.pitchY ?? fallback.pitchY
  };
}

function visualStyleFromVlm(vlm: VLMVideoAnalysis | undefined, analysis?: VideoAnalysisResult): VisualStyleSpec | undefined {
  const explicit = vlm?.visualStyle;
  const packaging = vlm?.packaging;
  const analysisRibbonMotion = analysis?.motionGeometry?.ribbonMotion;
  if (!explicit && !packaging && !analysisRibbonMotion) return undefined;
  const stickers = packaging?.stickers ?? [];
  const motionAsset = explicit?.motionAsset ?? stickers.find((item) => /ribbon|orbit|彩带/i.test(item)) ?? stickers[0];
  return {
    background: explicit?.background ?? packaging?.coverStyle,
    layout: explicit?.layout ?? packaging?.titleCards?.[0],
    motionAsset,
    colorProgression: explicit?.colorProgression ?? colorProgressionFromText(packaging?.colorStyle),
    typography: explicit?.typography ?? packaging?.titleCards?.[0],
    ribbonMotion: explicit?.ribbonMotion
      ? normaliseRibbonMotionGeometry(explicit.ribbonMotion)
      : analysisRibbonMotion
        ? normaliseRibbonMotionGeometry(analysisRibbonMotion)
        : undefined
  };
}

function motionAtomFromRibbonMotion(ribbonMotion: RibbonMotionGeometry, durationSec: number): MotionAtomSpec {
  const normalised = normaliseRibbonMotionGeometry(ribbonMotion);
  return {
    type: "parametric_ribbon_surface",
    fulfilledBy: "procedural_generation",
    keywords: ["STRUCTURE", "REMIX", "TIMELINE", "AIGC", "CREATION"],
    colorProgression: ["#2563eb", "#7c3aed", "#ec4899", "#f97316", "#eab308", "#22c55e"],
    gradientStops: ["#2563eb", "#7c3aed", "#ec4899", "#f97316", "#eab308", "#22c55e"],
    style: "mg_motion",
    density: 3,
    speed: 0.92,
    opacity: 0.62,
    bandWidth: normalised.surfaceType === "thin_line" ? 10 : 82,
    edgeWidth: normalised.surfaceType === "thin_line" ? 2 : 14,
    frontLayerCount: normalised.surfaceType === "thin_line" ? 1 : 2,
    backLayerCount: normalised.surfaceType === "thin_line" ? 1 : 2,
    textOnRibbon: normalised.textRelation === "text_on_ribbon",
    depthLayering: normalised.depthBehavior !== "flat",
    twistIntensity: 0.56,
    perspectiveStrength: 0.48,
    specularHighlight: normalised.surfaceType !== "thin_line",
    shadowOpacity: 0.42,
    climaxBuild: true,
    ...normalised,
    startSec: 0,
    endSec: durationSec
  };
}

function motionAtomsFromUnknown(value: unknown): MotionAtomSpec[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MotionAtomSpec =>
    Boolean(item && typeof item === "object" && (item as { type?: unknown }).type === "parametric_ribbon_surface")
  );
}

function motionAtomsFromVisualEvidence(analysis: VideoAnalysisResult): MotionAtomSpec[] {
  const ev = analysis.evidenceTimeline;
  const graph = ev?.visualElementGraph;
  const elements = graph?.elements ?? [];
  const source = elements.find((element) => {
    const haystack = [
      element.family,
      element.motionPattern,
      element.positionClass,
      element.sizeClass,
      element.appearance?.objectDescriptor
    ].join(" ").toLowerCase();
    return /ribbon|orbit|helix|sweep|light_sweep|hero_object/.test(haystack);
  });
  if (!source) return [];
  const pattern = String(source.motionPattern ?? source.appearance?.objectDescriptor ?? "").toLowerCase();
  const timeRange = Array.isArray(source.timeRangeSec) ? source.timeRangeSec : undefined;
  const track = Array.isArray(source.bboxTrackNorm) ? source.bboxTrackNorm : [];
  const evidenceFrames = track
    .map((item) => (typeof item === "object" && item && typeof (item as { t?: unknown }).t === "number" ? (item as { t: number }).t : undefined))
    .filter((value): value is number => value !== undefined)
    .slice(0, 8);
  const graphPalette = graph?.globalStyle?.palette;
  const palette = Array.isArray(graphPalette) && graphPalette.every((item): item is string => typeof item === "string") && graphPalette.length
    ? graphPalette
    : RIBBON_COLORS;
  return [{
    type: "parametric_ribbon_surface",
    fulfilledBy: "procedural_generation",
    keywords: pattern.includes("light") ? ["LIGHT", "SWEEP", "PRODUCT"] : RIBBON_KEYWORDS,
    colorProgression: palette,
    style: "mg_motion",
    density: pattern.includes("impact") ? 4 : 3,
    speed: pattern.includes("slow") ? 0.62 : 0.92,
    opacity: pattern.includes("light") ? 0.46 : 0.62,
    bandWidth: pattern.includes("light") ? 56 : 82,
    edgeWidth: pattern.includes("light") ? 8 : 14,
    gradientStops: palette,
    frontLayerCount: pattern.includes("light") ? 1 : 2,
    backLayerCount: pattern.includes("light") ? 1 : 2,
    textOnRibbon: /text|title|caption/.test(pattern),
    depthLayering: /orbit|helix|hero_object/.test(`${source.family} ${pattern}`),
    twistIntensity: pattern.includes("helix") ? 0.66 : 0.42,
    perspectiveStrength: pattern.includes("orbit") || pattern.includes("helix") ? 0.5 : 0.28,
    specularHighlight: pattern.includes("light"),
    shadowOpacity: 0.34,
    climaxBuild: true,
    surfaceType: "wide_band",
    pathFamily: pattern.includes("helix") ? "vertical_helix" : pattern.includes("diagonal") ? "diagonal_sweep" : "horizontal_wave",
    axis: pattern.includes("vertical") || pattern.includes("helix") ? "screen_y" : "screen_x",
    depthBehavior: /orbit|helix/.test(pattern) ? "front_back_crossing" : "perspective_only",
    layoutRelation: "around_title",
    textRelation: /text|title|caption/.test(pattern) ? "text_on_ribbon" : "none",
    confidence: source.evidence?.confidence ?? 0.72,
    evidenceFrames,
    startSec: typeof timeRange?.[0] === "number" ? timeRange[0] : 0,
    endSec: typeof timeRange?.[1] === "number" ? timeRange[1] : analysis.metadata.durationSec
  }];
}

function evidenceMotionAtomsFromAnalysis(analysis: VideoAnalysisResult, vlm?: VLMVideoAnalysis): MotionAtomSpec[] {
  const ev = analysis.evidenceTimeline as (VideoAnalysisResult["evidenceTimeline"] & { motionAtoms?: unknown }) | undefined;
  const direct = [
    ...motionAtomsFromUnknown(ev?.motionAtoms),
    ...motionAtomsFromUnknown((analysis as { motionAtoms?: unknown }).motionAtoms),
    ...motionAtomsFromUnknown((analysis as { renderPlan?: { motionAtoms?: unknown } }).renderPlan?.motionAtoms)
  ];
  if (direct.length) return direct;
  const ribbonMotion = analysis.motionGeometry?.ribbonMotion ?? vlm?.visualStyle?.ribbonMotion;
  if (ribbonMotion) return [motionAtomFromRibbonMotion(ribbonMotion, analysis.metadata.durationSec)];
  return motionAtomsFromVisualEvidence(analysis);
}

export function attachEvidenceToTemplate(
  baseTemplate: StructureTemplate,
  analysis: VideoAnalysisResult,
  vlm?: VLMVideoAnalysis
): StructureTemplate {
  const ev = analysis.evidenceTimeline;
  const motionAtoms = evidenceMotionAtomsFromAnalysis(analysis, vlm);
  const enriched: StructureTemplate = {
    ...baseTemplate,
    ...(ev?.heroDescriptor ? { heroDescriptor: ev.heroDescriptor } : {}),
    ...(ev?.typographyEvidence ? { typographyEvidence: ev.typographyEvidence } : {}),
    ...(ev?.visualElementGraph ? { visualElementGraph: ev.visualElementGraph } : {}),
    ...(ev?.audioStructure ? { audioStructure: ev.audioStructure } : {}),
    ...(motionAtoms.length ? { motionAtoms } : {})
  };
  const techniqueAtoms = extractTechniqueAtoms(enriched);
  return {
    ...enriched,
    ...(techniqueAtoms.length ? { techniqueAtoms } : {})
  };
}

function buildSourcePolicy(): SourcePolicyBlock {
  return {
    sampleSource: "demo_only",
    commercialUse: false,
    notes: "Mock fallback template transfers structure only; does not reuse sample visuals."
  };
}

function shortLabel(text: string, max = 70): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const slice = cleaned.slice(0, max);
  const lastStop = Math.max(slice.lastIndexOf("."), slice.lastIndexOf(","), slice.lastIndexOf(":"));
  return (lastStop > max / 2 ? slice.slice(0, lastStop) : slice).trim() + "…";
}

function nameFromVlm(vlm: VLMVideoAnalysis | undefined, fallback: string, sampleLabel: string, ts: string): string {
  const seed = vlm?.structure?.hook || vlm?.videoSummary;
  const base = !vlm || !seed ? fallback : `Learned MG Structure · ${shortLabel(seed, 80)}`;
  // Always surface the original sample filename + a per-run timestamp so the KB is browsable.
  return `${base} · ${sampleLabel} · ${ts}`;
}

function qualityRationaleFromVlm(vlm: VLMVideoAnalysis | undefined): string {
  if (!vlm) {
    return "Hook + value body + proof + CTA mirrors successful B-end MG promos; replacement policy keeps the system from copying sample frames.";
  }
  const reusable = vlm.reusablePatterns?.length ? `Reusable patterns: ${vlm.reusablePatterns.join("; ")}.` : "";
  const gaps = vlm.materialGapsForNewVideo?.length ? `Likely gaps for new source: ${vlm.materialGapsForNewVideo.join(", ")}.` : "";
  const summary = vlm.videoSummary ? `Source summary: ${vlm.videoSummary}` : "";
  return [summary, reusable, gaps, "Replacement policy keeps the system from copying sample frames."]
    .filter(Boolean)
    .join(" ");
}

/** Derive the original sample filename for template naming, e.g. "editing.mov". */
function deriveSampleLabel(analysis: VideoAnalysisResult): string {
  // 1. The real uploaded filename, threaded from Asset.filename in production.
  if (analysis.sourceFilename && analysis.sourceFilename.trim()) return analysis.sourceFilename.trim();
  const candidates = [
    (analysis.primaryMotif?.evidence as Record<string, unknown> | undefined)?.source,
    analysis.evidenceTimeline?.sourceAssetId,
    analysis.assetId
  ].filter((v): v is string => typeof v === "string");
  // 2. A literal filename inside any candidate string.
  for (const c of candidates) {
    const m = c.match(/[\w.-]+\.(mov|mp4|webm|mkv|avi|m4v)/i);
    if (m) return m[0];
  }
  // 3. Recover a filename from underscore-encoded asset ids like "asset_editing_mov_sample" → "editing.mov".
  for (const c of candidates) {
    const m = c.match(/([a-z0-9][a-z0-9-]*)_(mov|mp4|webm|mkv|avi|m4v)(?:_|$)/i);
    if (m) return `${m[1]}.${m[2].toLowerCase()}`;
  }
  return "sample";
}

/** Beat-cut required slots (ids/roles/families/renderer candidates) — the learned editing-tutorial grammar. */
type BeatCutSlotSpec = {
  id: string;
  role: SegmentRole;
  slotType: SlotType;
  family: VisualFormFamily;
  candidates: string[];
  label: string;
  motif: string;
  modality: SlotModality;
  /** assetRequirement.type — what kind of material truly fills this slot. */
  assetType: string;
  minCount: number;
  fallbackStrategies: FillStrategy[];
};

// The 8 v2 beat-cut slots: a moving hero object, a global dark moving background, kinetic +
// storyboard text cards, a moving-source action montage (with a target→AIGC→procedural fallback
// ladder), an impact flash, a global BGM beat grid, and a motivation CTA. background + BGM are
// `global` (span the whole sample) so the renderer cannot quietly drop them.
const BEAT_CUT_SLOT_SPECS: BeatCutSlotSpec[] = [
  { id: "slot_moving_hero_object", role: "hook", slotType: "hook_visual", family: "object_motion", candidates: ["neon_hero_intro", "rotating_object_proxy"], label: "霓虹旋转主视觉开场", motif: "rotating neon hero object intro on dark background", modality: "video_clip", assetType: "moving_visual", minCount: 1, fallbackStrategies: ["procedural_generation", "aigc_generated_material", "prompt_copy"] },
  { id: "slot_dark_background", role: "global", slotType: "background", family: "background", candidates: ["dark_tech_bg_image_or_procedural_motion"], label: "暗黑科技动态背景", motif: "dark tech background with slow light streaks / scanlines", modality: "image", assetType: "image_or_procedural_video", minCount: 1, fallbackStrategies: ["procedural_generation", "aigc_generated_material", "prompt_copy"] },
  { id: "slot_kinetic_text_card", role: "setup", slotType: "title_card", family: "kinetic_typography", candidates: ["beat_text_card", "kinetic_text_card"], label: "动效文字卡序列", motif: "kinetic black title card sequence with bold center red/yellow text", modality: "text", assetType: "text", minCount: 1, fallbackStrategies: ["procedural_generation", "aigc_generated_material", "prompt_copy"] },
  { id: "slot_storyboard_rule_card", role: "body", slotType: "title_card", family: "storyboard", candidates: ["tutorial_rule_card", "beat_text_card"], label: "分镜规则卡", motif: "storyboard rule cards: shot=timeline, BGM=cut, subtitle=structure", modality: "text", assetType: "text", minCount: 1, fallbackStrategies: ["procedural_generation", "aigc_generated_material", "prompt_copy"] },
  { id: "slot_moving_source_montage", role: "proof", slotType: "proof_visual", family: "live_action_montage", candidates: ["action_montage_sequence", "action_montage"], label: "卡点动作混剪", motif: "beat-sync action montage from target moving clips, hard cuts + crop zooms", modality: "video_set", assetType: "moving_visual", minCount: 3, fallbackStrategies: ["target_source_clips_by_motion", "aigc_generated_material", "procedural_dynamic_proxy"] },
  { id: "slot_impact_flash", role: "transition", slotType: "transition", family: "live_action_montage", candidates: ["impact_flash_stamp", "beat_text_card"], label: "冲击闪切印记", motif: "red impact flash stamp on the strongest beats", modality: "shape", assetType: "procedural", minCount: 1, fallbackStrategies: ["procedural_generation", "aigc_generated_material", "prompt_copy"] },
  { id: "slot_bgm_grid", role: "global", slotType: "audio", family: "audio", candidates: ["beat_grid_152bpm"], label: "BGM 卡点网格", motif: "BGM beat grid; visual cut points align to onsets", modality: "audio", assetType: "audio", minCount: 1, fallbackStrategies: ["procedural_generation", "prompt_copy"] },
  { id: "slot_motivation_cta", role: "cta", slotType: "cta_visual", family: "brand_cta", candidates: ["motivation_cta_card", "motivation_cta", "logo_cta_hold"], label: "行动号召收尾卡", motif: "motivation CTA end slate hold", modality: "logo", assetType: "text_or_logo", minCount: 1, fallbackStrategies: ["procedural_generation", "aigc_generated_material", "prompt_copy"] }
];

/**
 * Build a beat-cut / editing-tutorial StructureTemplate: the learned visual grammar with
 * named, evidence-bound slots (hero intro, kinetic rule cards, beat-sync montage, impact
 * flash, CTA), a 152-BPM-style rhythm, and clean (non-placeholder) naming. Sample frames
 * remain evidence only.
 */
export function buildBeatCutTemplate(
  analysis: VideoAnalysisResult,
  vertical: Vertical,
  projectId: string,
  vlm?: VLMVideoAnalysis
): StructureTemplate {
  const durationSec = analysis.metadata.durationSec;
  const templateId = stableId("template", analysis.assetId, durationSec, "beat_cut");
  // Name timestamp comes from the analysis time (deterministic for fixtures), not a fresh clock.
  const createdAt = analysis.createdAt ?? nowIso();
  const sampleLabel = deriveSampleLabel(analysis);
  const ts = nameTimestamp(createdAt);
  const ev = analysis.evidenceTimeline;

  const requiredSlots: RequiredSlot[] = BEAT_CUT_SLOT_SPECS.map((spec) => ({
    id: spec.id,
    role: spec.role,
    slotType: spec.slotType,
    required: true,
    description: `${spec.label} · ${spec.motif}`,
    preferredTags: [spec.family, spec.role],
    fallbackStrategies: spec.fallbackStrategies,
    visualForm: spec.candidates[0],
    visualFormFamily: spec.family,
    modality: spec.modality,
    assetRequirement: { required: true, type: spec.assetType, minCount: spec.minCount },
    rendererCandidates: spec.candidates,
    sourceEvidence: bindSlotEvidence(spec.role, spec.family, 0.82, [spec.motif, spec.label], ev),
    confidence: 0.82,
    semanticLabel: spec.label,
    clickToReplace: true
  }));

  // 6 time-segments; global slots (background, BGM) are referenced across several segments so the
  // renderer must carry them throughout, matching the v2 ideal template's segment.slots lists.
  const segDefs: Array<{ role: SegmentRole; startRatio: number; endRatio: number; primary: string; slots: string[] }> = [
    { role: "hook", startRatio: 0, endRatio: 0.16, primary: "slot_moving_hero_object", slots: ["slot_moving_hero_object", "slot_dark_background", "slot_bgm_grid"] },
    { role: "setup", startRatio: 0.16, endRatio: 0.36, primary: "slot_kinetic_text_card", slots: ["slot_kinetic_text_card", "slot_dark_background", "slot_bgm_grid"] },
    { role: "body", startRatio: 0.36, endRatio: 0.55, primary: "slot_storyboard_rule_card", slots: ["slot_storyboard_rule_card", "slot_dark_background", "slot_bgm_grid"] },
    { role: "proof", startRatio: 0.55, endRatio: 0.74, primary: "slot_moving_source_montage", slots: ["slot_moving_source_montage", "slot_dark_background", "slot_bgm_grid"] },
    { role: "transition", startRatio: 0.74, endRatio: 0.86, primary: "slot_impact_flash", slots: ["slot_impact_flash", "slot_dark_background", "slot_bgm_grid"] },
    { role: "cta", startRatio: 0.86, endRatio: 1, primary: "slot_motivation_cta", slots: ["slot_motivation_cta", "slot_bgm_grid"] }
  ];
  const segments: StructureSegment[] = segDefs.map((seg, i) => ({
    id: `seg_beatcut_${i}_${seg.role}`,
    role: seg.role,
    startRatio: seg.startRatio,
    endRatio: seg.endRatio,
    intent: requiredSlots.find((s) => s.id === seg.primary)?.description ?? seg.role,
    scriptPattern: requiredSlots.find((s) => s.id === seg.primary)?.semanticLabel ?? seg.role,
    slots: seg.slots,
    recommendedDurationSec: round((seg.endRatio - seg.startRatio) * 15)
  }));

  const bpm = ev?.beatGrid?.status === "ok" ? ev.beatGrid.bpm : undefined;
  const atomDefs: Array<[SegmentRole, KnowledgeAtom["category"], string, string]> = [
    ["hook", "hook_pattern", "Neon rotating hero-object intro", "Open on a dark rotating neon hero object before any text."],
    ["body", "rhythm_pattern", `${bpm ? Math.round(bpm) : 152} BPM beat-cut rhythm`, "Cut on the beat grid; fast 1.4–1.8s shots with crop-zoom energy."],
    ["body", "subtitle_style", "Black-bg bold center red/yellow typography", "Center bold Chinese title cards with red/yellow keyword emphasis."],
    ["setup", "transition_pattern", "Hard cut on every beat", "Use hard cuts aligned to the beat grid, never dissolves."],
    ["proof", "shot_pattern", "Beat-sync action montage", "Action montage with hard cuts, speed ramps and red impact flash stamps."],
    ["cta", "cta_pattern", "Motivation end-slate CTA", "Close on a held motivational CTA card, no platform branding."],
    ["body", "gap_fill_strategy", "Procedural beat-cut card on missing material", "When material is missing, render a procedural beat-cut style card rather than a static placeholder."]
  ];
  const structureAtoms: KnowledgeAtom[] = atomDefs.map(([role, category, name, description], i) => ({
    id: stableId("atom", templateId, role, category, String(i)),
    projectId,
    templateId,
    role,
    category,
    name,
    description,
    applicableVerticals: ["beat_cut", vertical],
    usageRules: `Transfer ${name.toLowerCase()} structure only; do not copy sample frames/audio.`,
    confidence: 0.85
  }));

  const template: StructureTemplate = {
    id: templateId,
    projectId,
    name: `Learned Beat-Cut Editing Tutorial Structure · ${sampleLabel} · ${ts}`,
    sourceAssetFilename: sampleLabel,
    heroDescriptor: ev?.heroDescriptor,
    typographyEvidence: ev?.typographyEvidence,
    visualElementGraph: ev?.visualElementGraph,
    audioStructure: ev?.audioStructure,
    vertical,
    sourceSampleIds: [analysis.assetId],
    videoType: "beat_cut",
    visualStyle: {
      background: "dark_tech_black",
      layout: "center_bold_typography",
      motionAsset: "beat_synced_cards_and_montage",
      colorProgression: ["black", "red", "yellow", "white"],
      typography: "bold_center_cjk_red_yellow_white"
    },
    excludeSegments: excludeSegmentsFromVlm(vlm, durationSec),
    targetDurationSec: 15,
    segments,
    requiredSlots,
    inducedSlots: induceSlotsFromAnalysis(analysis, undefined, structureAtoms, vlm),
    rhythm: buildRhythm(durationSec, vlm, analysis),
    packaging: {
      subtitleStyle: "bold_center_cjk_red_yellow_white",
      titleCardStyle: "black_bg_kinetic_typography",
      overlayStyle: "red_impact_flash",
      transitionStyle: "hard_cut_on_beat",
      coverStyle: "neon_hero_dark_tech"
    },
    structureAtoms,
    editingTechniques: buildEditingTechniques(),
    replacementPolicy: {
      doNotCopySampleVisuals: true,
      allowedTransfer: ["structure", "rhythm", "packaging", "subtitle_style", "cta_pattern", "transition_pattern"],
      forbiddenTransfer: ["original_video_frames", "original_audio", "original_voiceover", "person_likeness"]
    },
    qualityRationale: `Beat-cut editing-tutorial structure transferred from ${sampleLabel}: neon hero intro → kinetic rule cards → beat-sync action montage → impact flash → motivation CTA, locked to a ${bpm ? Math.round(bpm) : 152} BPM beat grid. Sample frames/audio are structure evidence only and are never copied.`,
    aiEnrichmentStatus: vlm ? "ok" : "skipped",
    sourcePolicy: buildSourcePolicy(),
    createdAt,
    updatedAt: createdAt
  };
  return attachEvidenceToTemplate(template, analysis, vlm);
}

export function buildFallbackTemplate(
  analysis: VideoAnalysisResult,
  vertical: Vertical = "b2b_marketing_mg",
  projectId?: string,
  vlm?: VLMVideoAnalysis
): StructureTemplate {
  if (detectVideoType(vlm, vertical, analysis) === "beat_cut") {
    return buildBeatCutTemplate(analysis, vertical, projectId ?? analysis.projectId, vlm);
  }
  const durationSec = analysis.metadata.durationSec;
  const excludeSegments = excludeSegmentsFromVlm(vlm, durationSec);
  const templateId = stableId("template", analysis.assetId, durationSec, vertical);
  const owningProject = projectId ?? analysis.projectId;
  const createdAt = analysis.createdAt ?? nowIso();
  const sampleLabel = deriveSampleLabel(analysis);
  const ts = nameTimestamp(createdAt);
  const defaultName = "B2B MG Promo Structure: Hook Body Proof CTA";
  const template: StructureTemplate = {
    id: templateId,
    projectId: owningProject,
    name: nameFromVlm(vlm, defaultName, sampleLabel, ts),
    sourceAssetFilename: sampleLabel,
    vertical,
    sourceSampleIds: [analysis.assetId],
    videoType: detectVideoType(vlm, vertical, analysis),
    visualStyle: visualStyleFromVlm(vlm, analysis),
    excludeSegments,
    targetDurationSec: transferableDurationSec(durationSec, excludeSegments),
    segments: buildSegments(vlm),
    requiredSlots: buildRequiredSlots(),
    rhythm: buildRhythm(durationSec, vlm, analysis),
    packaging: buildPackaging(vlm),
    structureAtoms: buildStructureAtoms(templateId, owningProject, vertical, vlm),
    editingTechniques: buildEditingTechniques(),
    replacementPolicy: {
      doNotCopySampleVisuals: true,
      allowedTransfer: ["structure", "rhythm", "packaging", "subtitle_style", "cta_pattern"],
      forbiddenTransfer: ["original_video_frames", "original_audio", "original_voiceover", "person_likeness"]
    },
    qualityRationale: qualityRationaleFromVlm(vlm),
    aiEnrichmentStatus: vlm ? "ok" : "skipped",
    sourcePolicy: buildSourcePolicy(),
    createdAt,
    updatedAt: createdAt
  };
  return attachEvidenceToTemplate(augmentTemplateWithInducedSlots(template, analysis, vlm), analysis, vlm);
}

export interface ParsedBrief {
  topic: string;
  productName: string;
  brandName?: string;
  targetAudience: string;
  sellingPoints: string[];
  tone: string;
  cta: string;
  rawPrompt: string;
  forbiddenContent: string[];
}

export function parsePromptToBrief(request: GenerationRequest): ParsedBrief {
  const prompt = request.prompt;
  const matchLine = (label: string): string | undefined => {
    const match = prompt.match(new RegExp(`(?:${label})[:：]\\s*([^\\n]+)`, "i"));
    return match?.[1]?.trim();
  };
  const matchLooseProduct = (): string | undefined => {
    const firstLine = prompt
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return undefined;
    const cleaned = firstLine
      .replace(/^(subject|topic|product|主题|商品|产品)\s*[:：-]\s*/i, "")
      .replace(/\b(?:ad|promo|launch|video|short)\b.*$/i, "")
      .trim();
    return cleaned.length >= 2 ? cleaned : undefined;
  };
  const looseSellingPoints = prompt.match(/(?:selling points|benefits|usp)\s+([^\n]+)/i)?.[1]?.trim();
  const sellingPointsRaw =
    matchLine("卖点|selling points|benefits|usp") ??
    looseSellingPoints ??
    (prompt.match(/[突强]出([^\n。]+)/)?.[1] ?? "");
  const sellingPoints = sellingPointsRaw
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const rawProduct = matchLine("商品|产品|product") ?? matchLine("主题|topic") ?? matchLooseProduct();
  const productName = sanitizeDisplayText(rawProduct, extractProductNameFromPrompt(prompt, "Demo product"));
  const cta = extractCtaTextFromPrompt(prompt, sanitizeDisplayText(matchLine("CTA|引导|结尾"), "Click to learn more", 18));
  return {
    topic: productName,
    productName,
    ...(extractBrandName(productName) ? { brandName: extractBrandName(productName) } : {}),
    targetAudience: matchLine("目标用户|audience|target") ?? "business users",
    sellingPoints: sellingPoints.length ? sellingPoints : ["clear value", "easy to understand", "mobile-friendly"],
    tone: matchLine("风格|style|tone") ?? "fast MG promo",
    cta,
    rawPrompt: prompt,
    forbiddenContent: request.constraints?.forbiddenWords ?? []
  };
}

interface TranscriptQuality {
  validCueCount: number;
  charCount: number;
  coverageRatio: number;
  charsPerSec: number;
  usableScript: boolean;
  subtitleDense: boolean;
}

function meaningfulTextLength(text: string): number {
  return (text.match(/[\p{L}\p{N}\u4e00-\u9fff]/gu) ?? []).length;
}

function isNoiseTranscriptText(text: string): boolean {
  const clean = text.trim().toLowerCase();
  if (!clean) return true;
  if (/^\[[^\]]*(music|noise|silence|applause|音乐|噪音|静音)[^\]]*\]$/.test(clean)) return true;
  if (/^(uh+|um+|嗯+|啊+|啦+|la+|hi|ok|okay|test|字幕)$/i.test(clean)) return true;
  return meaningfulTextLength(clean) < 4;
}

function analyzeTranscriptQuality(transcript: TranscriptSegment[], totalDurationSec: number): TranscriptQuality {
  const meaningful = transcript.filter((cue) => !isNoiseTranscriptText(cue.text ?? ""));
  const charCount = meaningful.reduce((sum, cue) => sum + meaningfulTextLength(cue.text ?? ""), 0);
  const coverageSec = meaningful.reduce((sum, cue) => sum + Math.max(0, cue.endSec - cue.startSec), 0);
  const duration = Math.max(1, totalDurationSec);
  const coverageRatio = Math.min(1, coverageSec / duration);
  const charsPerSec = charCount / duration;
  return {
    validCueCount: meaningful.length,
    charCount,
    coverageRatio,
    charsPerSec,
    usableScript: meaningful.length >= 1 && charCount >= 12,
    subtitleDense: meaningful.length >= 2 && charCount >= 24 && coverageRatio >= 0.18 && charsPerSec >= 0.6
  };
}

function hasRenderableAssetPath(asset: Asset | undefined): boolean {
  return Boolean(asset?.path && asset.path.trim().length > 0);
}

function materialPolicyForSourceAsset(
  sourceAsset: Asset | undefined,
  request: GenerationRequest
): Pick<SourceVideoUnderstanding, "materialRole" | "renderable" | "sourcePolicy" | "reusableAsMaterial" | "materialBlockReason"> {
  if (!sourceAsset) {
    return {
      materialRole: "unusable",
      renderable: false,
      reusableAsMaterial: false,
      materialBlockReason: "No source material asset was provided."
    };
  }
  const renderable = hasRenderableAssetPath(sourceAsset);
  const sourcePolicy = sourceAsset.sourcePolicy;
  const sampleReuseAuthorized = request.constraints?.sampleAssetReuse === "authorized";
  if (sourceAsset.metadata?.mock === true) {
    return {
      materialRole: "mock",
      renderable,
      sourcePolicy,
      reusableAsMaterial: false,
      materialBlockReason: renderable
        ? "Mock source assets are evidence fixtures and cannot satisfy required visual slots."
        : "Mock source assets without renderable paths cannot satisfy required visual slots."
    };
  }
  if (!renderable) {
    return {
      materialRole: "unusable",
      renderable: false,
      sourcePolicy,
      reusableAsMaterial: false,
      materialBlockReason: "Source asset has no renderable path and cannot satisfy required visual slots."
    };
  }
  if (sourcePolicy === "demo_only" && !sampleReuseAuthorized) {
    return {
      materialRole: "sample_reference",
      renderable,
      sourcePolicy,
      reusableAsMaterial: false,
      materialBlockReason: "Demo/sample reference footage is structure evidence only unless sampleAssetReuse is authorized."
    };
  }
  return {
    materialRole: sourcePolicy === "demo_only" ? "sample_reference" : "target_material",
    renderable,
    sourcePolicy,
    reusableAsMaterial: true
  };
}

export function understandSourceVideo(
  analysis: VideoAnalysisResult | undefined,
  sourceAsset: Asset | undefined,
  request: GenerationRequest,
  vlm?: VLMVideoAnalysis
): SourceVideoUnderstanding {
  const materialPolicy = materialPolicyForSourceAsset(sourceAsset, request);
  if (!analysis || !sourceAsset) {
    const targetAssetCount = targetAssetsForRequest(request).length;
    return {
      summary: targetAssetCount
        ? `No source video was provided; reconstruction will use ${targetAssetCount} target asset(s), procedural motion, and packaging fill.`
        : "No source video was provided; reconstruction will rely on text cards and packaging fill.",
      candidates: [],
      warnings: [
        targetAssetCount
          ? "No source video provided. Target assets will be mapped to template slots before procedural/text fallback."
          : "No source video provided. Preview is storyboard/text-card based."
      ],
      transcript: [],
      ocrText: [],
      ...materialPolicy
    };
  }
  const promptLower = request.prompt.toLowerCase();
  const promptTags: string[] = [];
  if (/使用|usage|过程|场景|office|学生|办公室|how to|demo/.test(promptLower)) promptTags.push("usage_scene");
  if (/对比|comparison|before|after|vs/.test(promptLower)) promptTags.push("comparison_candidate");
  if (/cta|购买|了解|点击|click|learn|buy/.test(promptLower)) promptTags.push("cta_candidate");

  const manualTags = sourceAsset.tags ?? [];
  const vlmShots = vlm?.shots ?? [];
  const transcript = analysis.transcript ?? [];
  const ocrText = (analysis.ocr ?? []).map((row: any) => String(row.text ?? "")).filter(Boolean);
  const summarySegments = [
    `Source analyzer=${analysis.analyzerMode}`,
    `shots=${analysis.shots.length}`,
    vlm ? `vlm=${vlmShots.length} segments` : null,
    transcript.length ? `asr=${transcript.length} cues` : null,
    ocrText.length ? `ocr=${ocrText.length} frames` : null,
    vlm?.videoSummary ? `summary: ${vlm.videoSummary.slice(0, 140)}` : null
  ]
    .filter(Boolean)
    .join("; ");

  return {
    assetId: sourceAsset.id,
    analysisId: analysis.id,
    summary: summarySegments,
    candidates: analysis.shots.map((shot, index) => {
      const blended = new Set<string>(shot.tags);
      manualTags.forEach((tag) => blended.add(tag));
      if (index === 0) blended.add("hook_candidate");
      promptTags.forEach((tag) => blended.add(tag));
      // ASR: shots overlapping a transcript cue with substantive text become text_card_candidate carriers.
      const hasAsrText = transcript.some(
        (cue) => cue.endSec > shot.startSec && cue.startSec < shot.endSec && !isNoiseTranscriptText(cue.text ?? "")
      );
      if (hasAsrText) blended.add("text_card_candidate");
      // OCR: any on-screen text in the keyframe window also flags subtitle/text-card candidacy.
      if (ocrText.length) blended.add("text_card_candidate");
      return { ...shot, tags: Array.from(blended) };
    }),
    warnings: [
      ...(analysis.analyzerMode === "mock" ? ["Using deterministic mock source-video analysis."] : []),
      ...(materialPolicy.reusableAsMaterial ? [] : [materialPolicy.materialBlockReason ?? "Source material is blocked by policy."]),
      ...(vlm?.materialGapsForNewVideo?.length ? [`VLM flagged gaps: ${vlm.materialGapsForNewVideo.join(", ")}`] : [])
    ],
    transcript,
    ocrText,
    ...materialPolicy,
    blockedCandidateShotIds: materialPolicy.reusableAsMaterial ? [] : analysis.shots.map((shot) => shot.id)
  };
}

function preferredTagForSlot(slotType: SlotType): string {
  const map: Record<SlotType, string> = {
    hook_visual: "hook_candidate",
    product_closeup: "product_like",
    usage_scene: "usage_scene",
    comparison: "comparison_candidate",
    proof_visual: "comparison_candidate",
    cta_visual: "cta_candidate",
    subtitle_text: "text_card_candidate",
    title_card: "text_card_candidate",
    transition: "background",
    background: "background",
    audio: "bgm_candidate"
  };
  return map[slotType];
}

function inferTargetAssetKind(role: string | undefined): TargetAssetKind {
  const text = (role ?? "").toLowerCase();
  if (/logo|brand|标识|品牌/.test(text)) return "logo";
  if (/cta|action|引导|行动|结尾/.test(text)) return "cta_info";
  if (/background|bg|背景/.test(text)) return "background_image";
  if (/copy|text|title|文案|标题/.test(text)) return "copy";
  if (/video|clip|素材/.test(text)) return "video";
  return "image";
}

function targetAssetsForRequest(request: GenerationRequest): TargetAssetInput[] {
  const explicit = request.targetAssets ?? [];
  const legacy = (request.assets ?? []).map((asset): TargetAssetInput => ({
    id: asset.assetId,
    kind: inferTargetAssetKind(asset.role),
    role: asset.role,
    tags: asset.role ? [asset.role] : undefined
  }));
  const seen = new Set<string>();
  return [...explicit, ...legacy].filter((asset) => {
    if (!asset.id || seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

function replacementBindingsForRequest(request: GenerationRequest): SlotReplacementBinding[] {
  const seen = new Set<string>();
  return (request.replacementBindings ?? []).filter((binding) => {
    if (!binding.slotId || !binding.assetId || seen.has(binding.slotId)) return false;
    seen.add(binding.slotId);
    return true;
  });
}

function replacementBindingFor(
  request: GenerationRequest,
  slotId: string | undefined,
  gapType?: GapCategory,
  missingMotif?: string
): SlotReplacementBinding | undefined {
  const bindings = replacementBindingsForRequest(request);
  return bindings.find((binding) => {
    if (slotId && binding.slotId === slotId) return true;
    if (gapType && (binding.slotId === gapType || binding.slotId.includes(gapType))) return true;
    if (missingMotif && (binding.slotId === missingMotif || binding.slotId.includes(missingMotif))) return true;
    return false;
  });
}

function targetAssetForId(request: GenerationRequest, assetId: string | undefined): TargetAssetInput | undefined {
  if (!assetId) return undefined;
  return targetAssetsForRequest(request).find((asset) => asset.id === assetId);
}

function targetAssetsForIds(request: GenerationRequest, assetIds: string[] | undefined): TargetAssetInput[] {
  if (!assetIds?.length) return [];
  const byId = new Map(targetAssetsForRequest(request).map((asset) => [asset.id, asset]));
  return assetIds.map((assetId) => byId.get(assetId)).filter((asset): asset is TargetAssetInput => Boolean(asset));
}

function textFromTargetAsset(asset: TargetAssetInput | undefined): string | undefined {
  if (!asset) return undefined;
  if (asset.text?.trim()) return asset.text.trim();
  const featureList = asset.metadata?.features;
  if (Array.isArray(featureList) && featureList.length) return featureList.map((item) => String(item)).join("\n");
  if (typeof asset.metadata?.brandName === "string" && asset.metadata.brandName.trim()) return asset.metadata.brandName.trim();
  if (typeof asset.metadata?.cta === "string" && asset.metadata.cta.trim()) return asset.metadata.cta.trim();
  return undefined;
}

const REPLACEABLE_SLOT_TYPES = new Set<SlotType>([
  "hook_visual",
  "product_closeup",
  "usage_scene",
  "comparison",
  "proof_visual",
  "cta_visual",
  "background"
]);

function isReplaceableVisualSlot(slotType: SlotType | undefined): boolean {
  return Boolean(slotType && REPLACEABLE_SLOT_TYPES.has(slotType));
}

function visualFormForFamily(family: VisualFormFamily | undefined): ReplacementSlot["visualForm"] | undefined {
  if (family === "media_cards") return "stacked_media_cards";
  if (family === "kinetic_typography") return "kinetic_text_card";
  if (family === "ui_showcase") return "feature_list_ui";
  if (family === "geometric_mg") return "neon_geometry_frame";
  if (family === "object_motion") return "rotating_3d_object";
  if (family === "live_action_montage") return "cinematic_hero_montage";
  if (family === "brand_cta") return "logo_hold";
  return undefined;
}

function visualFormForSlot(slotType: SlotType | undefined, gapType?: GapCategory, family?: VisualFormFamily): ReplacementSlot["visualForm"] {
  const fromFamily = visualFormForFamily(family);
  if (fromFamily) return fromFamily;
  if (gapType === "dynamic_3d_ribbon_asset") return "ribbon_motif";
  if (gapType === "rotating_hero_object_missing") return "rotating_3d_object";
  if (gapType === "action_montage_missing") return "action_montage_sequence";
  if (gapType === "match_cut_sequence_missing") return "match_cut_sequence";
  if (gapType === "media_cards_missing") return "stacked_media_cards";
  if (gapType === "ui_showcase_missing") return "feature_list_ui";
  if (gapType === "geometric_mg_missing") return "neon_geometry_frame";
  if (gapType === "brand_cta_missing") return "logo_hold";
  if (slotType === "product_closeup" || slotType === "hook_visual" || slotType === "usage_scene") return "rotating_object";
  if (slotType === "background") return "background";
  if (slotType === "cta_visual") return "cta";
  if (slotType === "title_card" || slotType === "subtitle_text") return "text_card";
  return "product_card";
}

function acceptedAssetTypesForFamily(family: VisualFormFamily | undefined): ReplacementSlot["acceptedAssetTypes"] | undefined {
  if (family === "media_cards") return ["image", "video", "gif"];
  if (family === "live_action_montage") return ["video", "gif", "image"];
  if (family === "brand_cta") return ["logo", "image", "copy"];
  if (family === "object_motion") return ["image", "video", "gif", "glb", "lottie"];
  if (family === "ui_showcase" || family === "kinetic_typography") return ["copy", "image"];
  return undefined;
}

function acceptedAssetTypesForSlot(slotType: SlotType | undefined, gapType?: GapCategory, family?: VisualFormFamily): ReplacementSlot["acceptedAssetTypes"] {
  const fromFamily = acceptedAssetTypesForFamily(family);
  if (fromFamily) return fromFamily;
  if (gapType === "dynamic_3d_ribbon_asset") return ["image", "video", "gif"];
  if (gapType === "rotating_hero_object_missing") return ["image", "video", "gif", "glb", "lottie"];
  if (gapType === "action_montage_missing" || gapType === "match_cut_sequence_missing") return ["video", "gif", "image"];
  if (slotType === "cta_visual") return ["image", "logo", "copy"];
  if (slotType === "subtitle_text" || slotType === "title_card") return ["copy", "image"];
  if (slotType === "background") return ["image", "video"];
  return ["image", "video", "gif"];
}

function motionSpecForSlot(slotType: SlotType | undefined, gapType?: GapCategory, family?: VisualFormFamily): MotionSpec {
  if (family === "media_cards") return { type: "cascade", speed: 0.85, preserveFromSlot: true };
  if (family === "ui_showcase") return { type: "slide", speed: 0.55, preserveFromSlot: true };
  if (family === "geometric_mg") return { type: "pulse", speed: 0.75, preserveFromSlot: true };
  if (family === "live_action_montage") return { type: "crop_zoom", speed: 0.95, preserveFromSlot: true };
  if (family === "brand_cta") return { type: "scale", speed: 0.35, preserveFromSlot: true };
  if (family === "object_motion") return { type: "spin", axis: "screen_y", speed: 0.8, preserveFromSlot: true };
  if (gapType === "dynamic_3d_ribbon_asset") {
    return { type: "ribbon_follow", axis: "screen_y", speed: 0.92, preserveFromSlot: true };
  }
  if (gapType === "rotating_hero_object_missing") {
    return { type: "spin", axis: "screen_y", speed: 0.8, preserveFromSlot: true };
  }
  if (gapType === "action_montage_missing" || gapType === "match_cut_sequence_missing") {
    return { type: "crop_zoom", speed: 0.95, preserveFromSlot: true };
  }
  if (slotType === "product_closeup" || slotType === "hook_visual" || slotType === "usage_scene") {
    return { type: "spin", axis: "y", speed: 0.8, preserveFromSlot: true };
  }
  if (slotType === "background") {
    return { type: "crop_zoom", speed: 0.45, preserveFromSlot: true };
  }
  return { type: "scale", speed: 0.35, preserveFromSlot: true };
}

function placeholderSpecForSlot(slotType: SlotType | undefined, label: string, gapType?: GapCategory, family?: VisualFormFamily): PlaceholderSpec {
  const motion = motionSpecForSlot(slotType, gapType, family);
  if (family === "media_cards") {
    return { type: "proxy_card", shape: "plane", color: "#0EA5E9", label: "Card stack proxy", motion };
  }
  if (family === "ui_showcase") {
    return { type: "proxy_card", shape: "plane", color: "#14B8A6", label: "Feature list proxy", motion };
  }
  if (family === "geometric_mg") {
    return { type: "procedural_object", shape: "plane", color: "#A855F7", label: "Neon geometry proxy", motion };
  }
  if (family === "live_action_montage") {
    return { type: "proxy_card", shape: "plane", color: "#F97316", label: "Beat montage proxy", motion };
  }
  if (family === "brand_cta") {
    return { type: "proxy_card", shape: "plane", color: "#111827", label: "Logo / CTA placeholder", motion };
  }
  if (family === "object_motion") {
    return { type: "proxy_shape", shape: "sphere", color: "#E53935", label: "Rotating hero object placeholder", motion };
  }
  if (gapType === "dynamic_3d_ribbon_asset") {
    return {
      type: "procedural_object",
      shape: "ribbon",
      color: "#7C3AED",
      label: "Dynamic ribbon placeholder",
      motion
    };
  }
  if (gapType === "rotating_hero_object_missing") {
    return {
      type: "proxy_shape",
      shape: "sphere",
      color: "#E53935",
      label: "Rotating hero object placeholder",
      motion
    };
  }
  if (gapType === "action_montage_missing" || gapType === "match_cut_sequence_missing") {
    return {
      type: "proxy_card",
      shape: "plane",
      color: "#2563EB",
      label,
      motion
    };
  }
  if (slotType === "cta_visual" || slotType === "title_card" || slotType === "subtitle_text") {
    return {
      type: "proxy_card",
      shape: "plane",
      color: "#CBD5E1",
      label,
      motion
    };
  }
  return {
    type: "proxy_shape",
    shape: "sphere",
    color: "#E53935",
    label,
    motion
  };
}

function shouldExposeReplacementSlot(mapping: SlotMapping): boolean {
  if (mapping.clickToReplace === false) return false;
  if (mapping.clickToReplace === true) return mapping.status !== "matched";
  if (mapping.visualFormFamily) return mapping.status !== "matched" && clickToReplaceForFamily(mapping.visualFormFamily);
  return mapping.status !== "matched" && isReplaceableVisualSlot(mapping.slotType);
}

function targetAssetKindsForSlot(slotType: SlotType): TargetAssetKind[] {
  const map: Record<SlotType, TargetAssetKind[]> = {
    hook_visual: ["video", "image", "background_image", "logo"],
    product_closeup: ["image", "video", "logo"],
    usage_scene: ["video", "image", "background_image"],
    comparison: ["image", "video", "copy"],
    proof_visual: ["image", "video", "copy"],
    cta_visual: ["cta_info", "logo", "copy", "image"],
    subtitle_text: ["copy", "cta_info"],
    title_card: ["copy", "logo"],
    transition: ["video", "background_image", "image"],
    background: ["background_image", "image", "video"],
    audio: []
  };
  return map[slotType];
}

function targetAssetKindsForFamily(family: VisualFormFamily | undefined): TargetAssetKind[] | undefined {
  if (family === "media_cards") return ["image", "video", "background_image"];
  if (family === "live_action_montage") return ["video", "image", "background_image"];
  if (family === "brand_cta") return ["logo", "cta_info", "copy", "image"];
  if (family === "object_motion") return ["image", "video", "logo"];
  if (family === "ui_showcase" || family === "kinetic_typography") return ["copy", "cta_info", "image"];
  if (family === "geometric_mg") return ["copy", "background_image", "image"];
  return undefined;
}

function targetAssetCanRenderForSlot(asset: TargetAssetInput, slotType: SlotType, family?: VisualFormFamily): boolean {
  const hasPathOrUrl = Boolean(asset.path || asset.url);
  const hasText = Boolean(asset.text && asset.text.trim().length > 0);
  if (family === "ui_showcase" || family === "kinetic_typography") return hasText || hasPathOrUrl || asset.kind === "copy";
  if (family === "geometric_mg") return true;
  if (family === "brand_cta" && (asset.kind === "copy" || asset.kind === "cta_info")) return hasText || hasPathOrUrl;
  if (slotType === "subtitle_text" || slotType === "title_card") return hasText || hasPathOrUrl || asset.kind === "copy";
  if (slotType === "cta_visual" && (asset.kind === "copy" || asset.kind === "cta_info")) return hasText || hasPathOrUrl;
  return hasPathOrUrl;
}

function targetAssetScore(asset: TargetAssetInput, slotType: SlotType, family?: VisualFormFamily): number {
  const kinds = targetAssetKindsForFamily(family) ?? targetAssetKindsForSlot(slotType);
  let score = kinds.includes(asset.kind) ? 0.64 : 0.22;
  const haystack = [asset.role, asset.filename, asset.text, ...(asset.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
  const isGeneratedMaterial = asset.metadata?.materialRole === "aigc_generated_material" || asset.tags?.includes("aigc_generated_material");
  if (isGeneratedMaterial && family && asset.role && asset.role !== family) {
    score = Math.min(score, 0.36);
  }
  if (family === "brand_cta" && asset.kind !== "logo" && !/(logo|brand|cta|品牌|标识|行动|结尾)/.test(haystack)) {
    score = Math.min(score, 0.36);
  }
  if (family === "media_cards" && /(card|collage|image|gallery|media|素材|卡片|拼贴)/.test(haystack)) score += 0.24;
  if (family === "ui_showcase" && /(feature|list|tool|ui|功能|工具|列表|界面)/.test(haystack)) score += 0.24;
  if (family === "kinetic_typography" && /(kinetic|typography|motion text|brand|headline|动效|文字)/.test(haystack)) score += 0.24;
  if (family === "live_action_montage" && /(montage|action|clip|video|cinematic|动作|混剪|镜头)/.test(haystack)) score += 0.24;
  if (family === "brand_cta" && /(logo|brand|cta|品牌|标识|行动)/.test(haystack)) score += 0.24;
  if (family === "object_motion" && /(object|hero|logo|product|avatar|helmet|主视觉|主体|标识)/.test(haystack)) score += 0.24;
  if (/hook|开头|首屏/.test(haystack) && slotType === "hook_visual") score += 0.24;
  if (/product|feature|商品|产品|卖点|功能/.test(haystack) && slotType === "product_closeup") score += 0.22;
  if (/usage|scene|context|场景|使用/.test(haystack) && slotType === "usage_scene") score += 0.22;
  if (/compare|proof|case|对比|证明|案例/.test(haystack) && (slotType === "comparison" || slotType === "proof_visual")) score += 0.22;
  if (/cta|action|logo|brand|引导|行动|结尾|品牌/.test(haystack) && slotType === "cta_visual") score += 0.22;
  if (/copy|title|headline|text|文案|标题/.test(haystack) && (slotType === "subtitle_text" || slotType === "title_card")) score += 0.2;
  if (!targetAssetCanRenderForSlot(asset, slotType, family)) score = Math.min(score, 0.36);
  return clamp(score, 0, 0.96);
}

function bestTargetAssetForSlot(slotType: SlotType, assets: TargetAssetInput[], family?: VisualFormFamily): { asset: TargetAssetInput; score: number } | undefined {
  const candidates = assets
    .map((asset) => ({ asset, score: targetAssetScore(asset, slotType, family) }))
    .filter((candidate) => candidate.score >= 0.38)
    .sort((a, b) => b.score - a.score);
  return candidates[0];
}

function targetAssetSetForSlot(slot: RequiredSlot, assets: TargetAssetInput[]): { assets: TargetAssetInput[]; score: number } | undefined {
  if (slot.visualFormFamily !== "media_cards") return undefined;
  const minCount = Math.max(slot.assetRequirement?.minCount ?? 4, 4);
  const candidates = assets
    .map((asset) => ({ asset, score: targetAssetScore(asset, slot.slotType, slot.visualFormFamily) }))
    .filter((candidate) => candidate.score >= 0.62 && targetAssetCanRenderForSlot(candidate.asset, slot.slotType, slot.visualFormFamily))
    .sort((a, b) => b.score - a.score);
  if (candidates.length < minCount) return undefined;
  return {
    assets: candidates.slice(0, Math.max(minCount, 4)).map((candidate) => candidate.asset),
    score: clamp(candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length, 0, 0.96)
  };
}

function partialTargetAssetSetForSlot(slot: RequiredSlot, assets: TargetAssetInput[]): { assets: TargetAssetInput[]; score: number; minCount: number; missingCount: number } | undefined {
  if (slot.visualFormFamily !== "media_cards") return undefined;
  const minCount = Math.max(slot.assetRequirement?.minCount ?? 4, 4);
  const candidates = assets
    .map((asset) => ({ asset, score: targetAssetScore(asset, slot.slotType, slot.visualFormFamily) }))
    .filter((candidate) => candidate.score >= 0.62 && targetAssetCanRenderForSlot(candidate.asset, slot.slotType, slot.visualFormFamily))
    .sort((a, b) => b.score - a.score);
  if (candidates.length === 0 || candidates.length >= minCount) return undefined;
  return {
    assets: candidates.map((candidate) => candidate.asset),
    score: clamp(candidates.reduce((sum, candidate) => sum + candidate.score, 0) / candidates.length, 0, 0.88),
    minCount,
    missingCount: minCount - candidates.length
  };
}

function overlapsExcludeSegment(shot: ShotCandidate, segment: NonNullable<StructureTemplate["excludeSegments"]>[number]): boolean {
  return shot.endSec > segment.startSec && shot.startSec < segment.endSec;
}

function isExcludedSampleShot(template: StructureTemplate, source: SourceVideoUnderstanding, shot: ShotCandidate, request: GenerationRequest): boolean {
  if (!source.assetId || !template.sourceSampleIds.includes(source.assetId)) return false;
  if (request.constraints?.sampleAssetReuse !== "authorized") return true;
  return (template.excludeSegments ?? []).some((segment) => overlapsExcludeSegment(shot, segment));
}

function sourceMaterialBlockReason(template: StructureTemplate, source: SourceVideoUnderstanding, request: GenerationRequest): string | undefined {
  if (!source.assetId || source.candidates.length === 0) return undefined;
  if (source.materialBlockReason && !source.reusableAsMaterial) return source.materialBlockReason;
  if (template.sourceSampleIds.includes(source.assetId) && request.constraints?.sampleAssetReuse !== "authorized") {
    return `Source shots from sample/reference asset ${source.assetId} are evidence only; set sampleAssetReuse="authorized" to reuse them as material.`;
  }
  if (source.reusableAsMaterial === false) return "Source candidates are blocked by material-pool policy.";
  return undefined;
}

function candidateMatchesSlot(shot: ShotCandidate, slot: RequiredSlot): boolean {
  const preferredTags = slot.preferredTags?.length ? slot.preferredTags : [preferredTagForSlot(slot.slotType)];
  return preferredTags.some((tag) => shot.tags.includes(tag)) || shot.tags.includes(preferredTagForSlot(slot.slotType));
}

export function matchSlots(
  template: StructureTemplate,
  source: SourceVideoUnderstanding,
  request: GenerationRequest
): SlotMapping[] {
  const targetAssets = targetAssetsForRequest(request);
  const sourceBlockedReason = sourceMaterialBlockReason(template, source, request);
  const sourceCanProvideMaterial = Boolean(source.assetId && source.reusableAsMaterial !== false && !sourceBlockedReason);
  return template.requiredSlots.map((slot) => {
    const preferred = preferredTagForSlot(slot.slotType);
    const slotMetadata = {
      visualForm: slot.visualForm,
      visualFormFamily: slot.visualFormFamily,
      modality: slot.modality,
      inducedSlotId: slot.inducedSlotId,
      assetRequirement: slot.assetRequirement,
      rendererCandidates: slot.rendererCandidates,
      sourceEvidence: slot.sourceEvidence,
      semanticLabel: slot.semanticLabel,
      motionSpec: slot.motionSpec,
      clickToReplace: slot.clickToReplace
    };
    const targetAssetCandidates = targetAssets
      .filter((asset) => targetAssetScore(asset, slot.slotType, slot.visualFormFamily) >= 0.38)
      .sort((a, b) => targetAssetScore(b, slot.slotType, slot.visualFormFamily) - targetAssetScore(a, slot.slotType, slot.visualFormFamily));
    if (slot.visualFormFamily === "geometric_mg") {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "matched",
        candidateShotIds: [],
        targetAssetCandidateIds: [],
        assetAvailability: "target_asset_mapped",
        ...slotMetadata,
        confidence: Math.max(slot.confidence ?? 0.72, 0.78),
        reason: "Mapped geometric_mg to procedural_not_required; no target visual asset is needed.",
        risks: ["Procedural MG renderer must preserve the induced geometry rhythm."]
      };
    }
    const targetAssetSet = targetAssetSetForSlot(slot, targetAssets);
    if (targetAssetSet) {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "matched",
        candidateShotIds: [],
        selectedAssetId: targetAssetSet.assets[0]?.id,
        selectedTargetAssetId: targetAssetSet.assets[0]?.id,
        selectedTargetAssetIds: targetAssetSet.assets.map((asset) => asset.id),
        selectedTargetAssetKind: targetAssetSet.assets[0]?.kind,
        targetAssetCandidateIds: targetAssetCandidates.map((asset) => asset.id),
        assetAvailability: "target_asset_mapped",
        ...slotMetadata,
        confidence: targetAssetSet.score,
        reason: `Mapped ${slot.visualFormFamily} to target image set (${targetAssetSet.assets.map((asset) => asset.id).join(", ")}).`,
        risks: []
      };
    }
    const partialTargetAssetSet = partialTargetAssetSetForSlot(slot, targetAssets);
    if (partialTargetAssetSet) {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "weak_match",
        candidateShotIds: [],
        selectedAssetId: partialTargetAssetSet.assets[0]?.id,
        selectedTargetAssetId: partialTargetAssetSet.assets[0]?.id,
        selectedTargetAssetIds: partialTargetAssetSet.assets.map((asset) => asset.id),
        selectedTargetAssetKind: partialTargetAssetSet.assets[0]?.kind,
        targetAssetCandidateIds: targetAssetCandidates.map((asset) => asset.id),
        assetAvailability: "target_asset_weak_match",
        missingCount: partialTargetAssetSet.missingCount,
        ...slotMetadata,
        confidence: partialTargetAssetSet.score,
        reason: `Only ${partialTargetAssetSet.assets.length}/${partialTargetAssetSet.minCount} required media-card assets are available; render a mixed target/proxy card stack.`,
        risks: ["Partial media-card set; fill plan must preserve visible proxy placeholders for missing cards."]
      };
    }
    const bestTargetAsset = bestTargetAssetForSlot(slot.slotType, targetAssets, slot.visualFormFamily);
    if (bestTargetAsset && bestTargetAsset.score >= 0.62) {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "matched",
        candidateShotIds: [],
        selectedAssetId: bestTargetAsset.asset.id,
        selectedTargetAssetId: bestTargetAsset.asset.id,
        selectedTargetAssetKind: bestTargetAsset.asset.kind,
        targetAssetCandidateIds: targetAssetCandidates.map((asset) => asset.id),
        assetAvailability: "target_asset_mapped",
        ...slotMetadata,
        confidence: bestTargetAsset.score,
        reason: `Mapped ${slot.slotType} to target ${bestTargetAsset.asset.kind} asset ${bestTargetAsset.asset.id}.`,
        risks: bestTargetAsset.asset.path || bestTargetAsset.asset.url || bestTargetAsset.asset.text ? [] : ["Target asset has metadata only; renderer may need a fallback."]
      };
    }
    if (slot.visualFormFamily === "brand_cta") {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "missing",
        candidateShotIds: [],
        targetAssetCandidateIds: targetAssetCandidates.map((asset) => asset.id),
        assetAvailability: targetAssets.length > 0 ? "target_asset_weak_match" : "no_user_asset_available",
        missingCount: 1,
        ...slotMetadata,
        confidence: 0,
        reason: "No renderable target logo or brand CTA asset is available; sample brand evidence is blocked as material.",
        risks: ["Brand CTA must use a proxy/logo placeholder until a target logo or authorized brand asset is supplied."]
      };
    }
    const evidenceCandidateShots = source.candidates.filter((shot) => candidateMatchesSlot(shot, slot));
    const candidateShots = sourceCanProvideMaterial
      ? evidenceCandidateShots.filter((shot) => !isExcludedSampleShot(template, source, shot, request))
      : [];
    if (candidateShots.length > 0) {
      const best = candidateShots[0];
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "matched",
        candidateShotIds: candidateShots.map((shot) => shot.id),
        selectedShotId: best.id,
        selectedAssetId: source.assetId,
        targetAssetCandidateIds: targetAssetCandidates.map((asset) => asset.id),
        assetAvailability: "source_video_mapped",
        ...slotMetadata,
        confidence: clamp(0.7 + (best.confidence ?? 0.7) * 0.2, 0.7, 0.95),
        reason: `Matched ${slot.slotType} to source shot ${best.id} via tag ${preferred}.`,
        risks: []
      };
    }
    if (bestTargetAsset) {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "weak_match",
        candidateShotIds: [],
        selectedAssetId: bestTargetAsset.asset.id,
        selectedTargetAssetId: bestTargetAsset.asset.id,
        selectedTargetAssetKind: bestTargetAsset.asset.kind,
        targetAssetCandidateIds: targetAssetCandidates.map((asset) => asset.id),
        assetAvailability: "target_asset_weak_match",
        ...slotMetadata,
        confidence: bestTargetAsset.score,
        reason: `Target asset ${bestTargetAsset.asset.id} exists for ${slot.slotType}, but the role/kind match is weak.`,
        risks: ["Weak target-asset fit; fill plan should reinforce with copy, packaging, or procedural generation."]
      };
    }
    const promptCanSupport =
      slot.slotType === "subtitle_text" ||
      slot.slotType === "title_card" ||
      slot.slotType === "cta_visual" ||
      (slot.slotType === "comparison" && /对比|对照|before|after|vs/.test(request.prompt));
    if (promptCanSupport) {
      return {
        slotId: slot.id,
        slotRole: slot.role,
        slotType: slot.slotType,
        status: "weak_match",
        candidateShotIds: [],
        targetAssetCandidateIds: [],
        assetAvailability: targetAssets.length > 0 ? "target_asset_weak_match" : "no_user_asset_available",
        ...slotMetadata,
        confidence: 0.45,
        reason: "No source shot matched; prompt copy can drive a card or overlay.",
        risks: ["Weak visual support; rely on packaging fill."]
      };
    }
    return {
      slotId: slot.id,
      slotRole: slot.role,
      slotType: slot.slotType,
      status: "missing",
      candidateShotIds: evidenceCandidateShots.map((shot) => shot.id),
      targetAssetCandidateIds: [],
      assetAvailability: "no_user_asset_available",
      ...slotMetadata,
      confidence: 0,
      reason: sourceBlockedReason
        ? `Blocked source evidence for ${slot.slotType}: ${sourceBlockedReason}`
        : `No source candidate with tag ${preferred} for ${slot.slotType}.`,
      risks: [
        "Required slot missing; fill plan must supply replacement.",
        ...(sourceBlockedReason && evidenceCandidateShots.length ? [sourceBlockedReason] : [])
      ]
    };
  });
}

const SLOT_GAP_LABELS: Record<SlotType, { category: GapCategory; en: string; zh: string; strategies: FillStrategy[] }> = {
  hook_visual: {
    category: "hook_visual_missing",
    en: "Opening hook visual is missing",
    zh: "缺少开头吸引镜头",
    strategies: ["reuse_with_crop_zoom", "packaging_overlay", "aigc_placeholder"]
  },
  product_closeup: {
    category: "product_closeup_missing",
    en: "Product closeup visual is missing",
    zh: "缺少商品特写镜头",
    strategies: ["reuse_with_crop_zoom", "aigc_placeholder", "text_card"]
  },
  usage_scene: {
    category: "usage_scene_missing",
    en: "Usage scene visual is missing",
    zh: "缺少使用过程镜头",
    strategies: ["reuse_with_crop_zoom", "aigc_placeholder", "text_card"]
  },
  comparison: {
    category: "comparison_missing",
    en: "Comparison / before-after visual is missing",
    zh: "缺少对比镜头",
    strategies: ["text_card", "packaging_overlay", "reorder_structure"]
  },
  proof_visual: {
    category: "comparison_missing",
    en: "Proof visual is missing",
    zh: "缺少证据/对比镜头",
    strategies: ["text_card", "packaging_overlay"]
  },
  cta_visual: {
    category: "cta_visual_missing",
    en: "Closing CTA visual is missing",
    zh: "缺少结尾 CTA 镜头",
    strategies: ["packaging_overlay", "text_card"]
  },
  subtitle_text: {
    category: "subtitle_text_missing",
    en: "Subtitle / on-screen copy is missing",
    zh: "缺少字幕文案",
    strategies: ["text_card", "reorder_structure"]
  },
  title_card: {
    category: "title_card_missing",
    en: "Title card / 卖点卡片 is missing",
    zh: "缺少卖点卡片/标题条",
    strategies: ["text_card", "packaging_overlay"]
  },
  transition: {
    category: "transition_missing",
    en: "Transition shot is missing",
    zh: "缺少转场镜头",
    strategies: ["reorder_structure", "packaging_overlay"]
  },
  background: {
    category: "background_missing",
    en: "Background / B-roll is missing",
    zh: "缺少背景/铺垫镜头",
    strategies: ["reuse_with_crop_zoom", "aigc_placeholder", "reorder_structure"]
  },
  audio: {
    category: "bgm_missing",
    en: "BGM / beat grid is missing",
    zh: "缺少 BGM / 卡点节奏",
    strategies: ["procedural_generation", "prompt_copy"]
  }
};

function gapMetaForMapping(mapping: SlotMapping): { category: GapCategory; en: string; zh: string; strategies: FillStrategy[] } {
  if (mapping.visualFormFamily === "media_cards") {
    return {
      category: "media_cards_missing",
      en: "Media card stack assets are missing",
      zh: "缺少卡片堆叠素材组",
      strategies: ["proxy_placeholder", "user_asset_replace", "aigc_placeholder"]
    };
  }
  if (mapping.visualFormFamily === "ui_showcase") {
    return {
      category: "ui_showcase_missing",
      en: "Feature-list UI content is missing or weak",
      zh: "缺少功能列表/UI 展示内容",
      strategies: ["text_card", "packaging_overlay", "procedural_generation"]
    };
  }
  if (mapping.visualFormFamily === "geometric_mg") {
    return {
      category: "geometric_mg_missing",
      en: "Procedural geometric MG motif is required",
      zh: "需要程序化几何动效",
      strategies: ["procedural_generation", "packaging_overlay"]
    };
  }
  if (mapping.visualFormFamily === "live_action_montage") {
    return {
      category: "action_montage_missing",
      en: "Live/action montage material is missing",
      zh: "缺少动作/高光混剪素材组",
      strategies: ["proxy_placeholder", "user_asset_replace", "aigc_placeholder", "text_card"]
    };
  }
  if (mapping.visualFormFamily === "brand_cta") {
    return {
      category: "brand_cta_missing",
      en: "Logo / brand CTA asset is missing",
      zh: "缺少品牌 Logo / CTA 素材",
      strategies: ["proxy_placeholder", "user_asset_replace", "packaging_overlay", "text_card"]
    };
  }
  if (mapping.visualFormFamily === "object_motion") {
    return {
      category: "rotating_hero_object_missing",
      en: "Rotating hero object intro is missing",
      zh: "缺少旋转主视觉素材",
      strategies: ["proxy_placeholder", "user_asset_replace", "aigc_placeholder"]
    };
  }
  if (mapping.slotId === "slot_rotating_hero_object_intro" || mapping.visualForm === "rotating_3d_object") {
    return {
      category: "rotating_hero_object_missing",
      en: "Rotating hero object intro is missing",
      zh: "缺少旋转主视觉素材",
      strategies: ["proxy_placeholder", "user_asset_replace", "aigc_placeholder"]
    };
  }
  if (mapping.slotId === "slot_beat_sync_action_montage" || mapping.visualForm === "action_montage_sequence") {
    return {
      category: "action_montage_missing",
      en: "Beat-sync action montage clips are missing",
      zh: "缺少卡点动作混剪素材",
      strategies: ["proxy_placeholder", "aigc_placeholder", "text_card"]
    };
  }
  if (mapping.slotId === "slot_cinematic_match_cut_sequence" || mapping.visualForm === "match_cut_sequence") {
    return {
      category: "match_cut_sequence_missing",
      en: "Cinematic match-cut proof clips are missing",
      zh: "缺少动作匹配/对比证明镜头",
      strategies: ["proxy_placeholder", "text_card", "packaging_overlay"]
    };
  }
  return SLOT_GAP_LABELS[mapping.slotType];
}

export interface GapReportContext {
  source?: SourceVideoUnderstanding;
  template?: StructureTemplate;
  request?: GenerationRequest;
}

const RIBBON_MOTIF_PATTERN = /parametric[_\s-]*ribbon[_\s-]*surface|vertical[_\s-]*helix|3d[_\s-]*ribbon[_\s-]*orbit|ribbon[_\s-]*orbit|3d\s*彩带|动态\s*彩带/i;

function ribbonMotionForTemplate(template: StructureTemplate | undefined): RibbonMotionGeometry | undefined {
  return template?.visualStyle?.ribbonMotion ? normaliseRibbonMotionGeometry(template.visualStyle.ribbonMotion) : undefined;
}

function hasRibbonOrbitMotif(template: StructureTemplate | undefined): boolean {
  if (!template) return false;
  if (ribbonMotionForTemplate(template)) return true;
  const haystack = [
    template.visualStyle?.motionAsset,
    template.packaging.overlayStyle,
    template.packaging.titleCardStyle,
    template.packaging.coverStyle,
    template.qualityRationale,
    ...template.structureAtoms.flatMap((atom) => [atom.name, atom.description, atom.usageRules, atom.exampleMapping])
  ]
    .filter(Boolean)
    .join(" ");
  return RIBBON_MOTIF_PATTERN.test(haystack);
}

function repairOptionsForGap(gap: {
  gapType?: GapCategory;
  slotType?: SlotType;
  visualFormFamily?: VisualFormFamily;
  recommendedFillStrategies?: FillStrategy[];
}): GapRepairOption[] {
  const options: GapRepairOption[] = [];
  const add = (option: GapRepairOption) => {
    if (!options.some((item) => item.strategy === option.strategy)) options.push(option);
  };
  const visualFamily = gap.visualFormFamily;
  const slotType = gap.slotType;
  const gapType = gap.gapType;

  if (slotType === "subtitle_text" || slotType === "title_card" || gapType === "voiceover_or_script_missing" || gapType === "subtitle_density_low") {
    add({
      strategy: "text_fill",
      label: "Generate target copy/text from the brief",
      renderer: "remotion_mg",
      requiredInputs: ["target_brief_copy"],
      risk: "low",
      preservesStructure: true,
      reason: "The missing material is textual; target copy can fill it without copying sample pixels."
    });
  }
  if (slotType === "cta_visual" || visualFamily === "brand_cta" || gapType === "brand_cta_missing") {
    add({
      strategy: "packaging_fill",
      label: "Render CTA/end-slate packaging",
      renderer: "remotion_recipe_compose",
      requiredInputs: ["cta_copy", "brand_or_product_name"],
      risk: "low",
      preservesStructure: true,
      reason: "CTA visual can be recreated as deterministic packaging from target brief fields."
    });
  }
  if (
    visualFamily === "geometric_mg" ||
    visualFamily === "kinetic_typography" ||
    gapType === "dynamic_3d_ribbon_asset" ||
    gapType === "rotating_hero_object_missing" ||
    gapType === "bgm_missing"
  ) {
    add({
      strategy: "procedural_motion",
      label: "Use local procedural motion/audio",
      renderer: visualFamily === "geometric_mg" || gapType === "dynamic_3d_ribbon_asset" ? "remotion_recipe_compose" : "ffmpeg_compose",
      requiredInputs: ["template_motion_or_audio_evidence"],
      risk: "medium",
      preservesStructure: true,
      reason: "The technique is structural; local procedural rendering preserves motion timing without sending sample media to providers."
    });
  }
  if (
    visualFamily === "media_cards" ||
    visualFamily === "object_motion" ||
    visualFamily === "live_action_montage" ||
    gapType === "moving_material_missing" ||
    gapType === "media_cards_missing" ||
    gapType === "action_montage_missing"
  ) {
    add({
      strategy: "asset_reuse",
      label: "Use uploaded target/source material",
      renderer: "ffmpeg_compose",
      requiredInputs: ["target_image_or_video"],
      risk: "low",
      preservesStructure: true,
      reason: "Real target material is the highest-fidelity fill when the sample only supplies structure."
    });
    add({
      strategy: "aigc_fill",
      label: "Optionally generate target material",
      renderer: "remotion_mg",
      requiredInputs: ["text_only_generation_prompt", "provider_env_opt_in"],
      risk: "medium",
      preservesStructure: true,
      reason: "External AIGC is optional and must use text-only prompts with generated-asset provenance."
    });
  }
  if (gap.recommendedFillStrategies?.includes("reorder_structure")) {
    add({
      strategy: "structure_reorder",
      label: "Merge into a matched sibling slot",
      renderer: "remotion_mg",
      requiredInputs: ["matched_sibling_slot"],
      risk: "medium",
      preservesStructure: false,
      reason: "When no asset or procedural component can fill the slot, reordering keeps the ad coherent."
    });
  }
  if (!options.length) {
    add({
      strategy: "packaging_fill",
      label: "Use deterministic packaging fallback",
      renderer: "remotion_mg",
      requiredInputs: ["target_brief_copy"],
      risk: "medium",
      preservesStructure: true,
      reason: "A visible deterministic fill is safer than silently dropping the missing slot."
    });
  }
  return options;
}

function selectRepairOption(options: GapRepairOption[]): GapRepairOption {
  const rank = new Map([
    ["asset_reuse", 6],
    ["procedural_motion", 5],
    ["text_fill", 4],
    ["packaging_fill", 3],
    ["structure_reorder", 2],
    ["aigc_fill", 1]
  ]);
  return options.slice().sort((a, b) => (rank.get(b.strategy) ?? 0) - (rank.get(a.strategy) ?? 0))[0] ?? options[0];
}

function expectedVisualResultForGap(gap: {
  gapType?: GapCategory;
  gapLabel?: string;
  slotType?: SlotType;
  visualFormFamily?: VisualFormFamily;
}, repair: GapRepairOption): string {
  const label = gap.gapLabel ?? gap.gapType ?? gap.visualFormFamily ?? gap.slotType ?? "missing material";
  if (repair.strategy === "asset_reuse") return `${label}: target asset is placed with learned timing/geometry.`;
  if (repair.strategy === "procedural_motion") return `${label}: local procedural motion/audio visibly fills the learned technique.`;
  if (repair.strategy === "text_fill") return `${label}: target copy is rendered in learned typography layout.`;
  if (repair.strategy === "packaging_fill") return `${label}: deterministic CTA/packaging card replaces the missing visual.`;
  if (repair.strategy === "aigc_fill") return `${label}: optional generated target material may replace the procedural fallback.`;
  return `${label}: slot is merged into a matched neighboring structure.`;
}

function withRepairOptions(gap: GapReportItem): GapReportItem {
  if (gap.status === "matched") return gap;
  const repairOptions = repairOptionsForGap(gap);
  const selectedRepair = selectRepairOption(repairOptions);
  return {
    ...gap,
    repairOptions,
    selectedRepair,
    expectedVisualResult: expectedVisualResultForGap(gap, selectedRepair)
  };
}

export function generateGapReport(mappings: SlotMapping[], context: GapReportContext = {}): GapReportItem[] {
  const transcript = context.source?.transcript ?? [];
  const ocrText = context.source?.ocrText ?? [];
  const sourceDurationSec = Math.max(1, ...(context.source?.candidates ?? []).map((candidate) => candidate.endSec));
  const transcriptQuality = analyzeTranscriptQuality(transcript, sourceDurationSec);
  const hasOcrText = ocrText.some((text) => meaningfulTextLength(text) >= 2);
  const hasScript = transcriptQuality.usableScript || hasOcrText;
  const subtitleSignals = context.source?.candidates?.filter((c) => c.tags.includes("text_card_candidate")).length ?? 0;

  const slotGaps: GapReportItem[] = mappings
    .filter((mapping) => mapping.status !== "matched")
    .map((mapping) => {
      const meta = gapMetaForMapping(mapping);
      const severity: GapReportItem["severity"] = mapping.status === "missing" ? "high" : "medium";
      return {
        slotId: mapping.slotId,
        slotType: mapping.slotType,
        slotRole: mapping.slotRole,
        status: mapping.status,
        severity,
        reason: mapping.reason,
        impact:
          mapping.status === "missing"
            ? `${meta?.en ?? mapping.slotType + " missing"}; must be filled via 文案/包装/AIGC 补全或结构重排.`
            : `${meta?.en ?? mapping.slotType} weak; needs packaging or text card support.`,
        gapType: meta?.category,
        gapLabel: meta?.en,
        gapLabelZh: meta?.zh,
        recommendedFillStrategies: shouldExposeReplacementSlot(mapping)
          ? Array.from(new Set(["proxy_placeholder" as const, ...(meta?.strategies ?? [])]))
          : meta?.strategies,
        placeholderSpec: shouldExposeReplacementSlot(mapping)
          ? placeholderSpecForSlot(mapping.slotType, `${meta?.en ?? mapping.slotType} placeholder`, meta?.category, mapping.visualFormFamily)
          : undefined,
        acceptedAssetTypes: shouldExposeReplacementSlot(mapping) ? acceptedAssetTypesForSlot(mapping.slotType, meta?.category, mapping.visualFormFamily) : undefined,
        clickToReplace: shouldExposeReplacementSlot(mapping) || undefined,
        replacementSlotId: shouldExposeReplacementSlot(mapping) ? mapping.slotId : undefined,
        visualForm: mapping.visualForm,
        visualFormFamily: mapping.visualFormFamily,
        modality: mapping.modality,
        inducedSlotId: mapping.inducedSlotId,
        rendererCandidates: mapping.rendererCandidates,
        sourceEvidence: mapping.sourceEvidence,
        assetRequirement: mapping.assetRequirement,
        missingCount: mapping.missingCount,
        assetAvailability: mapping.assetAvailability,
        mappedAssetId: mapping.selectedTargetAssetId ?? mapping.selectedAssetId,
        fillSource: mapping.assetAvailability === "target_asset_weak_match" ? "target_asset" : mapping.assetAvailability === "source_video_mapped" ? "source_video" : "none"
      };
    });

  const subtitleSlotMissing = slotGaps.some((g) => g.slotType === "subtitle_text" && g.status !== "matched");
  const hasSourceContext = Boolean(context.source && context.source.assetId);
  if (hasSourceContext && !hasScript && subtitleSlotMissing) {
    slotGaps.push({
      slotId: "synthetic_voiceover_or_script_gap",
      status: "missing",
      severity: "high",
      reason: "Source video has no usable ASR transcript and the template's subtitle slot has no direct material.",
      impact: "缺少口播或脚本，重构时需依赖 LLM 文案/字幕生成。",
      gapType: "voiceover_or_script_missing",
      gapLabel: "Voiceover or script copy is missing",
      gapLabelZh: "缺少口播或脚本",
      recommendedFillStrategies: ["text_card", "packaging_overlay"]
    });
  } else if (
    hasSourceContext &&
    hasScript &&
    (subtitleSignals === 0 || (transcript.length > 0 && !transcriptQuality.subtitleDense && !hasOcrText))
  ) {
    slotGaps.push({
      slotId: "synthetic_subtitle_density_gap",
      status: "weak_match",
      severity: "low",
      reason: `Transcript is available but subtitle support is weak (valid cues=${transcriptQuality.validCueCount}, coverage=${Math.round(
        transcriptQuality.coverageRatio * 100
      )}%, density=${transcriptQuality.charsPerSec.toFixed(2)} chars/sec).`,
      impact: "字幕密度偏低，重构时应当主动叠加卖点字幕。",
      gapType: "subtitle_density_low",
      gapLabel: "Subtitle density is low",
      gapLabelZh: "字幕密度偏低",
      recommendedFillStrategies: ["text_card", "packaging_overlay"]
    });
  }

  if (hasRibbonOrbitMotif(context.template)) {
    slotGaps.push({
      slotId: "synthetic_dynamic_3d_ribbon_asset_gap",
      status: "missing",
      severity: "high",
      reason: "Template requires a 3D ribbon/orbit dynamic visual motif, but no user-provided dynamic ribbon asset is available for the new video.",
      impact: "缺少动态 3D 彩带主视觉；应由程序化 motion atom 补全，而不是退化成静态文字卡。",
      gapType: "dynamic_3d_ribbon_asset",
      gapLabel: "Dynamic 3D ribbon/orbit visual is missing",
      gapLabelZh: "缺少动态 3D 彩带主视觉",
      recommendedFillStrategies: ["procedural_generation", "proxy_placeholder"],
      placeholderSpec: placeholderSpecForSlot(undefined, "Dynamic ribbon placeholder", "dynamic_3d_ribbon_asset"),
      acceptedAssetTypes: acceptedAssetTypesForSlot(undefined, "dynamic_3d_ribbon_asset"),
      clickToReplace: true,
      replacementSlotId: "synthetic_dynamic_3d_ribbon_asset_gap",
      assetAvailability: "no_user_asset_available",
      fillSource: "procedural_generation",
      fulfilledByBackend: "remotion_mg"
    });
  }

  // v2 beat-cut honest gaps. The system stays explicit about what it lacks even though it still
  // renders a credible dynamic output: no real moving footage -> a procedural dynamic montage; no
  // authorized BGM -> a synthesized beat track. Sample visuals are never copied to "fill" these.
  if (context.template?.videoType === "beat_cut") {
    const movingSlots = (context.template.requiredSlots ?? []).filter(
      (s) => s.assetRequirement?.type === "moving_visual" || s.visualFormFamily === "live_action_montage" || s.visualFormFamily === "object_motion"
    );
    // A real TARGET moving clip fills the slot; so does a genuinely reusable, DISTINCT (non-sample)
    // authorized source video (v1.3 source-first). A self-reconstruction match to the sample does
    // NOT, because the montage must never copy sample frames.
    const sourceReusableForGap =
      context.source?.reusableAsMaterial === true &&
      context.source.materialRole === "target_material" &&
      !(context.template?.sourceSampleIds ?? []).includes(context.source.assetId ?? "");
    const movingMatched = movingSlots.some((s) => {
      const m = mappings.find((mm) => mm.slotId === s.id);
      if (m?.status !== "matched") return false;
      const targetFilled = Boolean(m.selectedTargetAssetId || (m.selectedTargetAssetIds?.length ?? 0) > 0);
      const sourceFilled = m.assetAvailability === "source_video_mapped" && sourceReusableForGap;
      return targetFilled || sourceFilled;
    });
    if (movingSlots.length > 0 && !movingMatched) {
      slotGaps.push({
        slotId: "slot_moving_source_montage",
        status: "missing",
        severity: "high",
        reason: "No target moving clips were provided for the beat-cut hero/montage slots; sample frames must not be copied, so a dynamic procedural montage is rendered instead of real footage.",
        impact: "缺少 moving 素材（动作镜头/主视觉），动作蒙太奇只能用动态程序化代理，无法还原真实影视动作。",
        gapType: "moving_material_missing",
        gapLabel: "Moving source material is missing",
        gapLabelZh: "缺少 moving 素材",
        recommendedFillStrategies: ["target_source_clips_by_motion", "aigc_generated_material", "procedural_dynamic_proxy"]
      });
    }
    const bgmAuthorized = context.request?.constraints?.sampleAssetReuse === "authorized";
    if (!bgmAuthorized) {
      slotGaps.push({
        slotId: "slot_bgm_grid",
        status: "weak_match",
        severity: "medium",
        reason: "No authorized sample BGM; a synthesized beat track at the detected BPM keeps cuts beat-aligned.",
        impact: "缺少授权 BGM，使用合成卡点节拍替代；节奏可还原，但音色非原片。",
        gapType: "bgm_missing",
        gapLabel: "Authorized BGM is missing (synth beat used)",
        gapLabelZh: "缺少授权 BGM（已用合成卡点）",
        recommendedFillStrategies: ["procedural_generation", "prompt_copy"]
      });
    }
  }

  // Dedupe by (gapType, slotId): a slot-level gap + a synthetic gap of the same type (e.g. two
  // bgm_missing for slot_bgm_grid) collapse to the most severe single entry.
  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const dedup = new Map<string, GapReportItem>();
  for (const gap of slotGaps) {
    const key = `${gap.gapType}:${gap.slotId}`;
    const existing = dedup.get(key);
    if (!existing || (severityRank[gap.severity] ?? 0) > (severityRank[existing.severity] ?? 0)) dedup.set(key, gap);
  }
  return Array.from(dedup.values()).map(withRepairOptions);
}


interface StrategyContext {
  mapping: SlotMapping;
  hasReusableVisual: boolean;
  request: GenerationRequest;
  segmentMatchedSiblings: SlotMapping[];
  totalUnmatchedInSegment: number;
  replacementBinding?: SlotReplacementBinding;
}

function chooseStrategy(ctx: StrategyContext): FillStrategy {
  if (ctx.replacementBinding) return "user_asset_replace";
  const allowAigc = ctx.request.controls?.allowAigcPlaceholder ?? true;
  const allowReorder = ctx.mapping.status !== "matched" && ctx.segmentMatchedSiblings.length > 0;
  const slotType = ctx.mapping.slotType;
  // BGM/audio slot is filled by the procedural beat track (synth_beat), never an AIGC image stub —
  // keep the fill plan consistent with renderPlan.audioPolicy.
  if (slotType === "audio" || ctx.mapping.visualFormFamily === "audio") return "procedural_generation";
  if (ctx.mapping.visualFormFamily === "background") return "procedural_generation";
  if (ctx.mapping.visualFormFamily === "geometric_mg") return "procedural_generation";
  if (ctx.mapping.visualFormFamily === "ui_showcase" || ctx.mapping.visualFormFamily === "kinetic_typography") return "procedural_generation";
  if (ctx.mapping.visualFormFamily === "unknown" && ctx.mapping.status !== "matched") return "proxy_placeholder";
  if (
    ctx.mapping.status !== "matched" &&
    (ctx.mapping.visualFormFamily === "media_cards" ||
      ctx.mapping.visualFormFamily === "live_action_montage" ||
      ctx.mapping.visualFormFamily === "brand_cta" ||
      ctx.mapping.visualFormFamily === "object_motion")
  ) {
    return "proxy_placeholder";
  }
  if ((slotType === "subtitle_text" || slotType === "title_card" || slotType === "background" || slotType === "transition") && allowReorder) {
    return "reorder_structure";
  }
  if ((slotType === "hook_visual" || slotType === "product_closeup") && ctx.hasReusableVisual) return "reuse_with_crop_zoom";
  if (slotType === "usage_scene" && ctx.hasReusableVisual) return "reuse_with_crop_zoom";
  if (isReplaceableVisualSlot(slotType) && ctx.mapping.status === "missing") return "proxy_placeholder";
  if (slotType === "comparison" || slotType === "proof_visual") return "text_card";
  if (slotType === "cta_visual") return "packaging_overlay";
  if (slotType === "subtitle_text" || slotType === "title_card") return "text_card";
  if (allowAigc) return "aigc_placeholder";
  return "text_card";
}

export function createFillPlan(
  mappings: SlotMapping[],
  source: SourceVideoUnderstanding,
  request: GenerationRequest,
  template?: StructureTemplate
): FillAction[] {
  const hasReusableVisual = Boolean(source.reusableAsMaterial && source.candidates.length > 0);
  const brief = parsePromptToBrief(request);
  const ribbonAtom = ribbonAtomTypeForRequest(request, template);
  const ribbonMotion = ribbonMotionForTemplate(template) ?? DEFAULT_PARAMETRIC_RIBBON;
  const mappingsBySegment = new Map<string, SlotMapping[]>();
  for (const m of mappings) {
    const list = mappingsBySegment.get(m.slotRole) ?? [];
    list.push(m);
    mappingsBySegment.set(m.slotRole, list);
  }
  const slotFillPlan = mappings
    .filter((mapping) => mapping.status !== "matched")
    .map((mapping) => {
      const siblings = mappingsBySegment.get(mapping.slotRole) ?? [];
      const matchedSiblings = siblings.filter((sib) => sib.slotId !== mapping.slotId && sib.status === "matched");
      const unmatchedInSegment = siblings.filter((sib) => sib.status !== "matched").length;
      const gapMeta = gapMetaForMapping(mapping);
      const replacementBinding = replacementBindingFor(request, mapping.slotId, gapMeta?.category);
      const replacementAsset = targetAssetForId(request, replacementBinding?.assetId);
      const placeholderSpec = placeholderSpecForSlot(mapping.slotType, `${gapMeta?.en ?? mapping.slotType} placeholder`, gapMeta?.category, mapping.visualFormFamily);
      const motionSpec = mapping.motionSpec ?? motionSpecForSlot(mapping.slotType, gapMeta?.category, mapping.visualFormFamily);
      const rendererCapability = mapping.visualFormFamily ? primaryRendererCapabilityForFamily(mapping.visualFormFamily) : undefined;
      const proceduralAtom =
        mapping.visualFormFamily === "geometric_mg"
          ? "neon_geometry_typography"
          : rendererCapability?.id ?? ribbonAtom;
      const strategy = chooseStrategy({
        mapping,
        hasReusableVisual,
        request,
        segmentMatchedSiblings: matchedSiblings,
        totalUnmatchedInSegment: unmatchedInSegment,
        replacementBinding
      });
      const targetClipId = stableId("clip", request.projectId, mapping.slotId, strategy);
      const mergeIntoClipId = strategy === "reorder_structure" ? matchedSiblings[0]?.slotId : undefined;
      const action: FillAction = {
        slotId: mapping.slotId,
        strategy,
        reason:
          strategy === "reuse_with_crop_zoom"
            ? "Reuse the strongest available source shot with crop/zoom and benefit overlay."
            : strategy === "user_asset_replace"
              ? `Bind uploaded replacement asset ${replacementBinding?.assetId ?? "unknown"} to ${mapping.slotType} and preserve the slot motion.`
              : strategy === "proxy_placeholder"
                ? `Generate a visible proxy placeholder for ${mapping.slotType}; user can replace it while keeping timing and motion.`
            : strategy === "packaging_overlay"
              ? "Use title bar, sticker, highlight and CTA overlay to compensate for weak material."
              : strategy === "reorder_structure"
                ? `Reorder: merge ${mapping.slotType} responsibilities into matched sibling slot ${mergeIntoClipId ?? "(adjacent)"}, dropping the gap clip.`
                : strategy === "procedural_generation"
                  ? "Fulfill the missing dynamic visual motif with a renderer-backed procedural motion atom."
                : strategy === "aigc_placeholder"
                  ? "Mark a placeholder prompt for future generated asset."
                  : "Use deterministic text/MG card driven by prompt brief.",
        targetClipId,
        rendererInstructions:
          strategy === "user_asset_replace"
            ? {
                renderer: "remotion_mg",
                fallbackRenderer: "ffmpeg_compose",
                strategy,
                fulfilledBy: "user_asset",
                requiredInputs: ["managed_uploaded_asset", "slot_motion"],
                replacementSlotId: mapping.slotId,
                boundAssetId: replacementBinding?.assetId,
                replacementAssetKind: replacementAsset?.kind ?? "image",
                applyMotionFromSlot: replacementBinding?.applyMotionFromSlot ?? true,
                motionSpec,
                placeholderSpec,
                visualFormFamily: mapping.visualFormFamily,
                rendererCandidates: mapping.rendererCandidates,
                rendererCapability,
                capabilityId: rendererCapability?.id
              }
            : strategy === "proxy_placeholder"
              ? {
                  renderer: "remotion_mg",
                  fallbackRenderer: "image_card",
                  strategy,
                  fulfilledBy: "proxy_placeholder",
                  requiredInputs: ["slot_intent", "slot_motion"],
                  replacementSlotId: mapping.slotId,
                  placeholderSpec,
                  acceptedAssetTypes: acceptedAssetTypesForSlot(mapping.slotType, gapMeta?.category, mapping.visualFormFamily),
                  motionSpec,
                  clickToReplace: shouldExposeReplacementSlot(mapping),
                  visualFormFamily: mapping.visualFormFamily,
                  rendererCandidates: mapping.rendererCandidates,
                  rendererCapability,
                  capabilityId: rendererCapability?.id,
                  targetAssetIds: mapping.selectedTargetAssetIds ?? (mapping.selectedTargetAssetId ? [mapping.selectedTargetAssetId] : undefined),
                  missingCount: mapping.missingCount,
                  materialSource: mapping.assetAvailability === "target_asset_weak_match" ? "target_material_partial" : "proxy_placeholder"
                }
              : strategy === "text_card"
            ? { renderer: "image_card", fallbackRenderer: "remotion_mg", strategy, fulfilledBy: "text_or_copy", requiredInputs: ["prompt_copy"], text: `${brief.productName}: ${brief.sellingPoints[0] ?? brief.topic}`, layout: "centered" }
            : strategy === "packaging_overlay"
              ? { renderer: "remotion_mg", fallbackRenderer: "image_card", strategy, fulfilledBy: "text_or_copy", requiredInputs: ["copy", "logo_or_cta_optional"], headline: brief.cta, sticker: "benefit_badge" }
                : strategy === "reuse_with_crop_zoom"
                  ? { renderer: "ffmpeg_compose", fallbackRenderer: "remotion_mg", strategy, fulfilledBy: "source_video", requiredInputs: ["source_clip_or_target_asset"], motion: "crop_zoom", fit: "cover" }
                : strategy === "procedural_generation"
                  ? {
                      renderer: "remotion_mg",
                      fallbackRenderer: "ffmpeg_compose",
                      strategy,
                      atom: proceduralAtom,
                      fulfilledBy: "procedural_generation",
                      requiredInputs:
                        mapping.visualFormFamily === "geometric_mg"
                          ? ["procedural_shape_motif"]
                          : mapping.visualFormFamily === "ui_showcase"
                            ? ["prompt_copy", "feature_list"]
                            : mapping.visualFormFamily === "kinetic_typography"
                              ? ["prompt_copy", "typography_timing"]
                              : ["template_motion_geometry"],
                      ribbonMotion,
                      visualFormFamily: mapping.visualFormFamily,
                      rendererCandidates: mapping.rendererCandidates,
                      rendererCapability,
                      capabilityId: rendererCapability?.id,
                      placeholderSpec,
                      motionSpec
                    }
                : strategy === "aigc_placeholder"
                  ? { renderer: "aigc_video_fill_stub", fallbackRenderer: "image_card", strategy, fulfilledBy: "aigc_stub", requiredInputs: ["prompt", "slot_intent"], aigcPrompt: `Clean vertical MG background for ${brief.productName}` }
                : { renderer: "remotion_mg", fallbackRenderer: "image_card", strategy, fulfilledBy: "text_or_copy", requiredInputs: ["matched_sibling_slot"], mergeIntoSlotId: mergeIntoClipId, note: "Merge this slot's copy into adjacent matched sibling at render time." }
      };
      const instructions = action.rendererInstructions ?? {};
      return {
        ...action,
        capabilityId: typeof instructions.capabilityId === "string" ? instructions.capabilityId : rendererCapability?.id,
        backend: instructions.renderer as RendererBackend | undefined,
        fallbackUsed: Boolean(mapping.visualFormFamily && !rendererCapability),
        fallbackReason: mapping.visualFormFamily && !rendererCapability ? `No registered renderer capability for ${mapping.visualFormFamily}; using strategy ${strategy}.` : undefined,
        visualFormFamily: mapping.visualFormFamily,
        selectedStrategy: strategy,
        fulfilledBy: instructions.fulfilledBy as FillAction["fulfilledBy"]
      };
    });

  const matchedCapabilityFillPlan: FillAction[] = mappings
    .filter((mapping) => mapping.status === "matched")
    .flatMap((mapping): FillAction[] => {
      const selectedAssets = targetAssetsForIds(request, mapping.selectedTargetAssetIds ?? (mapping.selectedTargetAssetId ? [mapping.selectedTargetAssetId] : []));
      const selectedAsset = selectedAssets[0] ?? targetAssetForId(request, mapping.selectedTargetAssetId);
      const targetCopy = textFromTargetAsset(selectedAsset);
      const selectedAssetsGenerated = selectedAssets.length > 0 && selectedAssets.every((asset) => asset.metadata?.materialRole === "aigc_generated_material" || asset.tags?.includes("aigc_generated_material"));
      const effectiveFamily = mapping.visualFormFamily ?? (selectedAssetsGenerated ? "unknown" : undefined);
      const rendererCapability = effectiveFamily ? primaryRendererCapabilityForFamily(effectiveFamily) : undefined;
      const placeholderSpec = placeholderSpecForSlot(mapping.slotType, `${effectiveFamily ?? mapping.slotType} target fill`, undefined, effectiveFamily);
      const motionSpec = mapping.motionSpec ?? motionSpecForSlot(mapping.slotType, undefined, effectiveFamily);
      const strategy: FillStrategy =
        selectedAssetsGenerated
          ? "aigc_generated_asset"
          : mapping.visualFormFamily === "media_cards" || mapping.visualFormFamily === "brand_cta"
          ? selectedAssetsGenerated
            ? "aigc_generated_asset"
            : "user_asset_replace"
          : mapping.visualFormFamily === "ui_showcase" || mapping.visualFormFamily === "kinetic_typography" || mapping.visualFormFamily === "geometric_mg"
            ? "procedural_generation"
            : "proxy_placeholder";
      if (
        !selectedAssetsGenerated &&
        mapping.visualFormFamily !== "media_cards" &&
        mapping.visualFormFamily !== "brand_cta" &&
        mapping.visualFormFamily !== "ui_showcase" &&
        mapping.visualFormFamily !== "kinetic_typography" &&
        mapping.visualFormFamily !== "geometric_mg"
      ) {
        return [];
      }
      const action: FillAction = {
        slotId: mapping.slotId,
        strategy,
        reason:
          strategy === "user_asset_replace"
            ? `Use matched target material for ${mapping.visualFormFamily}; preserve slot motion and layout.`
            : mapping.visualFormFamily === "geometric_mg"
              ? "No external asset required; render the induced geometric MG family procedurally."
              : `Render ${mapping.visualFormFamily} with matched target copy through its renderer capability.`,
        targetClipId: stableId("clip", request.projectId, mapping.slotId, strategy, "target_asset"),
        rendererInstructions: {
          renderer: "remotion_mg",
          fallbackRenderer: "ffmpeg_compose",
          strategy,
          fulfilledBy: strategy === "aigc_generated_asset" ? "aigc_generated_material" : strategy === "user_asset_replace" ? "target_asset" : "procedural_generation",
          requiredInputs:
            effectiveFamily === "media_cards"
              ? ["target_image_set", "slot_motion"]
              : effectiveFamily === "brand_cta"
                ? ["target_logo", "brand_copy", "slot_motion"]
                : effectiveFamily === "ui_showcase"
                  ? ["target_copy", "feature_list"]
                  : effectiveFamily === "kinetic_typography"
                    ? ["target_copy", "typography_timing"]
                    : strategy === "aigc_generated_asset"
                      ? ["generated_target_asset", "slot_motion"]
                      : ["procedural_shape_motif"],
          replacementSlotId: strategy === "user_asset_replace" || strategy === "aigc_generated_asset" ? mapping.slotId : undefined,
          boundAssetId: selectedAsset?.id,
          targetAssetIds: selectedAssets.map((asset) => asset.id),
          replacementAssetKind: selectedAsset?.kind ?? "image",
          applyMotionFromSlot: true,
          motionSpec,
          placeholderSpec,
          visualFormFamily: effectiveFamily,
          rendererCandidates: mapping.rendererCandidates,
          rendererCapability,
          capabilityId: rendererCapability?.id,
          targetCopy,
          featureList: Array.isArray(selectedAsset?.metadata?.features) ? selectedAsset?.metadata?.features : undefined,
          brandName: typeof selectedAsset?.metadata?.brandName === "string" ? selectedAsset.metadata.brandName : undefined,
          cta: typeof selectedAsset?.metadata?.cta === "string" ? selectedAsset.metadata.cta : undefined,
          materialSource: strategy === "aigc_generated_asset" ? "aigc_generated_material" : effectiveFamily === "geometric_mg" ? "procedural_not_required" : "target_material"
        }
      };
      return [{
        ...action,
        capabilityId: rendererCapability?.id,
        backend: action.rendererInstructions?.renderer as RendererBackend | undefined,
        fallbackUsed: false,
        visualFormFamily: effectiveFamily,
        selectedStrategy: strategy,
        fulfilledBy: action.rendererInstructions?.fulfilledBy as FillAction["fulfilledBy"]
      }];
    });

  const plannedSlotIds = new Set([...slotFillPlan, ...matchedCapabilityFillPlan].map((action) => action.slotId));
  const boundSlotFillPlan: FillAction[] = replacementBindingsForRequest(request)
    .filter((binding) => !plannedSlotIds.has(binding.slotId))
    .flatMap((binding): FillAction[] => {
      const mapping = mappings.find((item) => item.slotId === binding.slotId);
      if (!mapping) return [];
      const gapMeta = gapMetaForMapping(mapping);
      const replacementAsset = targetAssetForId(request, binding.assetId);
      const placeholderSpec = placeholderSpecForSlot(mapping.slotType, `${gapMeta?.en ?? mapping.slotType} placeholder`, gapMeta?.category, mapping.visualFormFamily);
      const motionSpec = mapping.motionSpec ?? motionSpecForSlot(mapping.slotType, gapMeta?.category, mapping.visualFormFamily);
      const rendererCapability = mapping.visualFormFamily ? primaryRendererCapabilityForFamily(mapping.visualFormFamily) : undefined;
      const action: FillAction = {
        slotId: binding.slotId,
        strategy: "user_asset_replace",
        reason: `Bind uploaded replacement asset ${binding.assetId} to ${mapping.slotType} and preserve the slot motion.`,
        targetClipId: stableId("clip", request.projectId, binding.slotId, "user_asset_replace"),
        rendererInstructions: {
          renderer: "remotion_mg",
          fallbackRenderer: "ffmpeg_compose",
          strategy: "user_asset_replace",
          fulfilledBy: "user_asset",
          requiredInputs: ["managed_uploaded_asset", "slot_motion"],
          replacementSlotId: binding.slotId,
          boundAssetId: binding.assetId,
          replacementAssetKind: replacementAsset?.kind ?? "image",
          applyMotionFromSlot: binding.applyMotionFromSlot ?? true,
          motionSpec,
          placeholderSpec,
          visualFormFamily: mapping.visualFormFamily,
          rendererCandidates: mapping.rendererCandidates,
          rendererCapability,
          capabilityId: rendererCapability?.id
        }
      };
      return [{
        ...action,
        capabilityId: rendererCapability?.id,
        backend: action.rendererInstructions?.renderer as RendererBackend | undefined,
        fallbackUsed: false,
        visualFormFamily: mapping.visualFormFamily,
        selectedStrategy: "user_asset_replace",
        fulfilledBy: "user_asset"
      }];
    });

  const baseFillPlan = [...slotFillPlan, ...matchedCapabilityFillPlan, ...boundSlotFillPlan];

  if (!hasRibbonOrbitMotif(template)) return baseFillPlan;
  const ribbonBinding = replacementBindingFor(request, "synthetic_dynamic_3d_ribbon_asset_gap", "dynamic_3d_ribbon_asset", "dynamic_3d_ribbon_asset");
  if (ribbonBinding) {
    const replacementAsset = targetAssetForId(request, ribbonBinding.assetId);
    const placeholderSpec = placeholderSpecForSlot(undefined, "Dynamic ribbon placeholder", "dynamic_3d_ribbon_asset");
    return [
      ...baseFillPlan,
      {
        slotId: "synthetic_dynamic_3d_ribbon_asset_gap",
        strategy: "user_asset_replace",
        reason: `dynamic_3d_ribbon_asset -> user_asset_replace -> ${ribbonBinding.assetId}; slot motion preserved.`,
        targetClipId: stableId("motion_atom", request.projectId, "dynamic_3d_ribbon_asset", ribbonBinding.assetId),
        rendererInstructions: {
          renderer: "remotion_mg",
          fallbackRenderer: "ffmpeg_compose",
          strategy: "user_asset_replace",
          fulfilledBy: "user_asset",
          requiredInputs: ["managed_uploaded_asset", "template_motion_geometry"],
          replacementSlotId: "synthetic_dynamic_3d_ribbon_asset_gap",
          boundAssetId: ribbonBinding.assetId,
          replacementAssetKind: replacementAsset?.kind ?? "image",
          applyMotionFromSlot: ribbonBinding.applyMotionFromSlot ?? true,
          motionSpec: motionSpecForSlot(undefined, "dynamic_3d_ribbon_asset"),
          placeholderSpec,
          missingMotif: "dynamic_3d_ribbon_asset",
          ribbonMotion
        }
      }
    ];
  }
  return [
    ...baseFillPlan,
    {
      slotId: "synthetic_dynamic_3d_ribbon_asset_gap",
      strategy: "procedural_generation",
      reason: `dynamic_3d_ribbon_asset -> fulfilled_by_procedural_generation -> ${ribbonAtom} rendered.`,
      targetClipId: stableId("motion_atom", request.projectId, ribbonAtom),
      rendererInstructions: {
        renderer: "remotion_mg",
        fallbackRenderer: "ffmpeg_compose",
        strategy: "procedural_generation",
        atom: ribbonAtom,
        fulfilledBy: "procedural_generation",
        requiredInputs: ["template_motion_geometry", "poster_copy"],
        missingMotif: "dynamic_3d_ribbon_asset",
        ribbonMotion
      }
    }
  ];
}

function creativeModeFor(request: GenerationRequest): NonNullable<GenerationRequest["controls"]>["creativeMode"] {
  return request.controls?.creativeMode ?? "explainable_demo";
}

function isFinalCreativeMode(request: GenerationRequest): boolean {
  const mode = creativeModeFor(request);
  return mode === "final_creative" || mode === "high_fidelity_style";
}

function polishedPosterCopy(slotType: SlotType, brief: ParsedBrief): string {
  const title = brief.productName || brief.topic;
  const cleanTitle = /爆款结构迁移引擎/.test(title) ? "爆款结构迁移引擎" : title;
  if (slotType === "hook_visual") return cleanTitle;
  if (slotType === "product_closeup") return "Viral Structure Transfer Engine";
  if (slotType === "usage_scene") return "Sample Analysis";
  if (slotType === "subtitle_text" || slotType === "title_card") return "Material Gap";
  if (slotType === "comparison" || slotType === "proof_visual") return "Video Recomposition";
  if (slotType === "cta_visual") return brief.cta || "Upload. Analyze. Remix.";
  return cleanTitle;
}

function promptLooksChinese(brief: ParsedBrief, request: GenerationRequest): boolean {
  const joined = [request.prompt, brief.topic, brief.productName, brief.targetAudience, ...brief.sellingPoints, brief.cta].join("\n");
  const cjk = (joined.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (joined.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk >= latin * 0.2;
}

function subtitleForSlot(slotType: SlotType, brief: ParsedBrief, request: GenerationRequest): string {
  if (isFinalCreativeMode(request)) return polishedPosterCopy(slotType, brief);
  const zh = promptLooksChinese(brief, request);
  if (zh) {
    if (slotType === "cta_visual") return brief.cta;
    if (slotType === "usage_scene") return `${brief.targetAudience} 使用场景`;
    if (slotType === "comparison" || slotType === "proof_visual") return `${brief.sellingPoints[0]} 对比更清楚`;
    if (slotType === "hook_visual") return `${brief.productName} · ${brief.sellingPoints[0]}`;
    if (slotType === "product_closeup") return brief.sellingPoints[0];
    if (slotType === "subtitle_text" || slotType === "title_card") return brief.sellingPoints[1] ?? brief.topic;
    return brief.topic;
  }
  if (slotType === "cta_visual") return brief.cta;
  if (slotType === "usage_scene") return `${brief.productName} fits ${brief.targetAudience}`;
  if (slotType === "comparison" || slotType === "proof_visual") return `${brief.sellingPoints[0]} with clearer everyday value`;
  if (slotType === "hook_visual") return `${brief.productName}: ${brief.sellingPoints[0]}`;
  if (slotType === "product_closeup") return `${brief.sellingPoints[0]} in one compact design`;
  if (slotType === "subtitle_text" || slotType === "title_card") return brief.sellingPoints[1] ?? brief.topic;
  return brief.topic;
}

function slotsForPace(slotIds: string[], template: StructureTemplate, controls: GenerationRequest["controls"] | undefined): string[] {
  if (controls?.pace !== "slow") return slotIds;
  const visualSlots = slotIds.filter((slotId) => {
    const slot = template.requiredSlots.find((item) => item.id === slotId);
    return slot?.slotType !== "subtitle_text" && slot?.slotType !== "title_card";
  });
  return visualSlots.length > 0 ? visualSlots : slotIds;
}

function renderBackgroundForControls(controls: GenerationRequest["controls"] | undefined): string {
  if (controls?.creativeMode === "high_fidelity_style") return "#f4efe4";
  if (controls?.creativeMode === "final_creative" && controls?.packagingStyle === "mg_motion") return "#f7f1e8";
  if (controls?.packagingStyle === "clean") return "#f8fafc";
  if (controls?.packagingStyle === "bold") return "#7f1d1d";
  return "#0f172a";
}

function clipTypeForFill(strategy: FillStrategy | undefined): TimelineClipType {
  if (strategy === "reuse_with_crop_zoom") return "video";
  if (strategy === "text_card") return "text_card";
  if (strategy === "packaging_overlay") return "generated_card";
  if (strategy === "procedural_generation") return "generated_card";
  if (strategy === "aigc_placeholder") return "placeholder";
  if (strategy === "aigc_generated_asset") return "generated_card";
  if (strategy === "proxy_placeholder") return "placeholder";
  if (strategy === "user_asset_replace") return "image";
  return "generated_card";
}

const RIBBON_KEYWORDS = ["STRUCTURE", "REMIX", "TIMELINE", "AIGC", "CREATION"];
const RIBBON_COLORS = ["#2563eb", "#7c3aed", "#ec4899", "#f97316", "#eab308", "#22c55e"];

function ribbonAtomTypeForRequest(_request: GenerationRequest, _template?: StructureTemplate): MotionAtomSpec["type"] {
  return "parametric_ribbon_surface";
}

function buildMotionAtoms(fillPlan: FillAction[], request: GenerationRequest, durationSec: number): MotionAtomSpec[] {
  const ribbonAction = fillPlan.find(
    (action) =>
      action.strategy === "procedural_generation" &&
      String(action.rendererInstructions?.atom ?? "").includes("ribbon")
  );
  if (!ribbonAction) return [];
  const highFidelity = request.controls?.creativeMode === "high_fidelity_style";
  const clean = request.controls?.packagingStyle === "clean";
  const aggressive = request.controls?.hookIntensity === "aggressive";
  const style: MotionAtomSpec["style"] = clean && !highFidelity ? "clean_premium" : "mg_motion";
  const densityBase = highFidelity ? 4 : clean ? 2 : aggressive ? 5 : 3;
  const speedBase = highFidelity ? 0.82 : clean ? 0.55 : aggressive ? 1.35 : 0.92;
  const density = Math.max(1, Math.round(densityBase * (request.controls?.ribbon?.densityMultiplier ?? 1)));
  const speed = round(speedBase * (request.controls?.ribbon?.speedMultiplier ?? 1));
  const opacity = highFidelity ? 0.74 : clean ? 0.32 : aggressive ? 0.82 : 0.62;
  const atomType = String(ribbonAction.rendererInstructions?.atom ?? "");
  const legacyFallback = atomType.includes("ribbon_orbit") && !atomType.includes("3d")
    ? { ...DEFAULT_PARAMETRIC_RIBBON, surfaceType: "thin_line" as const, depthBehavior: "flat" as const }
    : DEFAULT_PARAMETRIC_RIBBON;
  const ribbonMotion = normaliseRibbonMotionGeometry(ribbonAction.rendererInstructions?.ribbonMotion, legacyFallback);
  const thinRibbon = ribbonMotion.surfaceType === "thin_line";
  return [
    {
      type: "parametric_ribbon_surface",
      fulfilledBy: "procedural_generation",
      keywords: RIBBON_KEYWORDS,
      colorProgression: RIBBON_COLORS,
      style: request.controls?.ribbon?.premiumFinish && !highFidelity ? "clean_premium" : style,
      density,
      speed,
      opacity,
      bandWidth: thinRibbon ? (clean ? 8 : 10) : highFidelity ? 122 : clean ? 54 : aggressive ? 104 : 82,
      edgeWidth: thinRibbon ? 2 : highFidelity ? 20 : clean ? 10 : aggressive ? 18 : 14,
      gradientStops: RIBBON_COLORS,
      frontLayerCount: thinRibbon ? 1 : highFidelity ? 3 : clean ? 1 : aggressive ? 3 : 2,
      backLayerCount: thinRibbon ? 1 : highFidelity ? 2 : clean ? 1 : aggressive ? 3 : 2,
      textOnRibbon: ribbonMotion.textRelation === "text_on_ribbon",
      depthLayering: ribbonMotion.depthBehavior === "front_back_crossing" || ribbonMotion.depthBehavior === "occlusion_with_title" || ribbonMotion.depthBehavior === "perspective_only",
      twistIntensity: thinRibbon ? 0.12 : highFidelity ? 0.82 : clean ? 0.28 : aggressive ? 0.78 : 0.56,
      perspectiveStrength: thinRibbon ? 0.12 : highFidelity ? 0.74 : clean ? 0.22 : aggressive ? 0.68 : 0.48,
      specularHighlight: true,
      shadowOpacity: thinRibbon ? 0.12 : highFidelity ? 0.38 : clean ? 0.18 : aggressive ? 0.58 : 0.42,
      climaxBuild: true,
      surfaceType: ribbonMotion.surfaceType,
      pathFamily: ribbonMotion.pathFamily,
      axis: ribbonMotion.axis,
      depthBehavior: ribbonMotion.depthBehavior,
      layoutRelation: ribbonMotion.layoutRelation,
      textRelation: ribbonMotion.textRelation,
      confidence: ribbonMotion.confidence,
      evidenceFrames: ribbonMotion.evidenceFrames,
      turns: ribbonMotion.turns ?? (ribbonMotion.pathFamily === "vertical_helix" ? 1.25 : undefined),
      radiusX: ribbonMotion.radiusX,
      radiusZ: ribbonMotion.radiusZ,
      pitchY: ribbonMotion.pitchY,
      startSec: 0,
      endSec: durationSec
    }
  ];
}

function replacementSlotsFromGapReport(gapReport: GapReportItem[], fillPlan: FillAction[]): ReplacementSlot[] {
  const fromGaps = gapReport
    .filter((gap) => gap.clickToReplace || gap.placeholderSpec || gap.replacementSlotId)
    .map((gap) => {
      const fill =
        fillPlan.find((action) => action.slotId === gap.slotId) ??
        fillPlan.find((action) => action.rendererInstructions?.missingMotif && action.rendererInstructions.missingMotif === gap.gapType);
      const instructions = fill?.rendererInstructions ?? {};
      const boundAssetId = typeof instructions.boundAssetId === "string" ? instructions.boundAssetId : undefined;
      const replacementSlotId = gap.replacementSlotId ?? gap.slotId;
      const motionSpec = (instructions.motionSpec ?? gap.placeholderSpec?.motion ?? motionSpecForSlot(gap.slotType, gap.gapType)) as MotionSpec;
      const placeholderSpec = (instructions.placeholderSpec ?? gap.placeholderSpec ?? placeholderSpecForSlot(gap.slotType, gap.gapLabel ?? replacementSlotId, gap.gapType)) as PlaceholderSpec;
      const status: ReplacementSlot["status"] =
        fill?.strategy === "user_asset_replace" && boundAssetId
          ? "user_replaced"
          : fill?.strategy === "aigc_generated_asset" && boundAssetId
            ? "rendered"
          : fill?.strategy === "procedural_generation"
            ? "proxy_generated"
            : "proxy_generated";
      return {
        slotId: replacementSlotId,
        semanticLabel: gap.gapLabelZh ?? gap.gapLabel ?? gap.slotType ?? gap.gapType ?? replacementSlotId,
        visualForm: gap.visualForm ?? visualFormForSlot(gap.slotType, gap.gapType, gap.visualFormFamily),
        visualFormFamily: gap.visualFormFamily,
        modality: gap.modality,
        status,
        placeholderSpec,
        acceptedAssetTypes: gap.acceptedAssetTypes ?? acceptedAssetTypesForSlot(gap.slotType, gap.gapType, gap.visualFormFamily),
        boundAssetId,
        motionSpec,
        applyMotionFromSlot: instructions.applyMotionFromSlot === false ? false : true,
        gapType: gap.gapType,
        rendererBackend: (instructions.renderer ?? gap.fulfilledByBackend) as ReplacementSlot["rendererBackend"],
        targetClipId: fill?.targetClipId
      };
    });
  const seen = new Set(fromGaps.map((slot) => slot.slotId));
  const fromBoundActions = fillPlan
    .filter((action) => (action.strategy === "user_asset_replace" || action.strategy === "aigc_generated_asset") && !seen.has(action.rendererInstructions?.replacementSlotId ?? action.slotId))
    .map((action) => {
      const instructions = action.rendererInstructions ?? {};
      const slotId = instructions.replacementSlotId ?? action.slotId;
      return {
        slotId,
        semanticLabel: `Replacement slot ${slotId}`,
        visualForm: "product_card" as const,
        status: (action.strategy === "aigc_generated_asset" ? "rendered" : "user_replaced") as ReplacementSlot["status"],
        placeholderSpec: instructions.placeholderSpec as PlaceholderSpec | undefined,
        acceptedAssetTypes: ["image", "video", "gif", "logo", "copy", "glb", "lottie"] as ReplacementSlot["acceptedAssetTypes"],
        boundAssetId: typeof instructions.boundAssetId === "string" ? instructions.boundAssetId : undefined,
        motionSpec: instructions.motionSpec as MotionSpec | undefined,
        applyMotionFromSlot: instructions.applyMotionFromSlot === false ? false : true,
        rendererBackend: instructions.renderer as ReplacementSlot["rendererBackend"],
        targetClipId: action.targetClipId
      };
    });
  return [...fromGaps, ...fromBoundActions];
}

export interface BuildTimelineInput {
  template: StructureTemplate;
  request: GenerationRequest;
  source: SourceVideoUnderstanding;
  mappings: SlotMapping[];
  fillPlan: FillAction[];
  generationId: string;
}

const KNOWN_BEAT_PRIMITIVES = new Set([
  "neon_hero_intro",
  "beat_text_card",
  "tutorial_rule_card",
  "action_montage",
  "impact_flash_stamp",
  "motivation_cta"
]);

// ---- v1.3 RenderRecipe compiler (spec_v3/schemas/render-recipe.schema.json) ----
// Maps the internal beat-cut primitive vocabulary onto the renderer-agnostic recipe component
// vocabulary the RemotionRecipeRenderer dispatches on. The recipe is built from the SAME
// styledClips array buildTimeline emits, so it never drifts from the rendered clips.

function recipeComponentFor(
  motionPrimitive: string | undefined,
  opts: { isFan: boolean; hasSourcePixels: boolean }
): RenderRecipePrimitive {
  switch (motionPrimitive) {
    case "neon_hero_intro":
      return opts.isFan ? "FanHeroSpin" : "ProductHeroOrbit";
    case "action_montage":
      return opts.hasSourcePixels ? "SourceClipBeatMontage" : "DynamicProxyMontage";
    case "impact_flash_stamp":
      return "ImpactFlash";
    case "motivation_cta":
      return "CTAEndSlate";
    case "beat_text_card":
    case "tutorial_rule_card":
      return "TypographyLayoutSequence";
    default:
      return "TypographyLayoutSequence";
  }
}

function recipeFamilyFor(component: RenderRecipePrimitive): RenderRecipeFamily {
  switch (component) {
    case "ProductHeroOrbit":
    case "FanHeroSpin":
    case "ProductPosterHero":
    case "ObjectTrackReveal":
      return "product_hero";
    case "SourceClipBeatMontage":
      return "source_video_montage";
    case "DynamicProxyMontage":
      return "procedural_proxy";
    case "TypographyLayoutSequence":
    case "KineticTypographySweep":
    case "PriceBadgePulse":
      return "kinetic_typography";
    case "FeatureCardStack":
    case "MediaCardCascade":
    case "SplitScreenCompare":
      return "media_cards";
    case "ImpactFlash":
    case "LightLeakTransition":
      return "impact_fx";
    case "CTAEndSlate":
      return "brand_cta";
    case "ParametricRibbonSurface":
      return "procedural_proxy";
    default:
      return "procedural_proxy";
  }
}

function recipeMotionFor(component: RenderRecipePrimitive): RenderRecipeClip["motion"]["pattern"] {
  switch (component) {
    case "FanHeroSpin":
      return "spin";
    case "ProductHeroOrbit":
    case "ProductPosterHero":
    case "ObjectTrackReveal":
      return "orbit";
    case "SourceClipBeatMontage":
      return "hard_cut";
    case "DynamicProxyMontage":
    case "ParametricRibbonSurface":
    case "LightLeakTransition":
      return "pan";
    case "TypographyLayoutSequence":
    case "KineticTypographySweep":
    case "PriceBadgePulse":
      return "zoom_pulse";
    case "FeatureCardStack":
    case "MediaCardCascade":
    case "SplitScreenCompare":
      return "card_stack";
    case "ImpactFlash":
      return "shake";
    case "CTAEndSlate":
      return "zoom_pulse";
    default:
      return "none";
  }
}

const TECHNIQUE_COMPONENTS: ReadonlySet<string> = new Set([
  "SourceClipBeatMontage",
  "ProductPosterHero",
  "FeatureCardStack",
  "MediaCardCascade",
  "KineticTypographySweep",
  "ParametricRibbonSurface",
  "ImpactFlash",
  "CTAEndSlate",
  "PriceBadgePulse",
  "LightLeakTransition",
  "ObjectTrackReveal",
  "SplitScreenCompare"
]);

function isRenderRecipePrimitive(value: unknown): value is RenderRecipePrimitive {
  return (
    (typeof value === "string" && TECHNIQUE_COMPONENTS.has(value)) ||
    value === "ProductHeroOrbit" ||
    value === "FanHeroSpin" ||
    value === "TypographyLayoutSequence" ||
    value === "DynamicProxyMontage"
  );
}

function techniqueAtomsForClip(clip: TimelineClip, template: StructureTemplate): TechniqueAtom[] {
  const atoms = template.techniqueAtoms ?? extractTechniqueAtoms(template);
  const fam = String(clip.visualFormFamily ?? "");
  const role = clip.role;
  const wants: TechniqueAtom["name"][] = [];
  if (role === "cta" || fam === "brand_cta") wants.push("CTAEndSlate");
  if (role === "hook") wants.push("ProductPosterHero", "ObjectTrackReveal", "ParametricRibbonSurface", "KineticTypographySweep");
  if (fam === "media_cards") wants.push("MediaCardCascade", "FeatureCardStack");
  if (fam === "live_action_montage") wants.push("SourceClipBeatMontage");
  if (fam === "object_motion") wants.push("ObjectTrackReveal", "ProductPosterHero");
  if (fam === "kinetic_typography" || Boolean(clip.subtitleText)) wants.push("KineticTypographySweep", "PriceBadgePulse");
  if (fam === "geometric_mg") wants.push("ParametricRibbonSurface", "LightLeakTransition");
  if (role === "transition") wants.push("ImpactFlash", "LightLeakTransition", "ParametricRibbonSurface");
  if (role === "proof") wants.push("SourceClipBeatMontage", "SplitScreenCompare", "FeatureCardStack", "ProductPosterHero");
  return atoms
    .filter((atom) => wants.includes(atom.name))
    .sort((a, b) => {
      const ai = wants.indexOf(a.name);
      const bi = wants.indexOf(b.name);
      if (ai !== bi) return ai - bi;
      return b.confidence - a.confidence;
    });
}

function componentFromTechniqueAtoms(
  clip: TimelineClip,
  template: StructureTemplate,
  opts: { fallback: RenderRecipePrimitive; hasSourcePixels: boolean; hasTargetMaterial: boolean }
): { component: RenderRecipePrimitive; atomIds: string[]; reason?: string } {
  const candidates = techniqueAtomsForClip(clip, template);
  for (const atom of candidates) {
    const component = atom.renderer.component;
    if (!isRenderRecipePrimitive(component)) continue;
    if (component === "SourceClipBeatMontage" && !opts.hasSourcePixels) continue;
    if ((component === "MediaCardCascade" || component === "FeatureCardStack") && !opts.hasTargetMaterial && clip.visualFormFamily !== "media_cards") continue;
    if ((component === "ProductPosterHero" || component === "ObjectTrackReveal") && !opts.hasTargetMaterial && !opts.hasSourcePixels && clip.role !== "hook") continue;
    return {
      component,
      atomIds: [atom.id],
      reason: `TechniqueAtom ${atom.name} (${atom.sourceEvidenceRefs.length ? atom.sourceEvidenceRefs[0] : atom.fallbackReason}) → ${component}`
    };
  }
  return { component: opts.fallback, atomIds: [] };
}

function recipeTypographyLayout(
  layoutRole: string | undefined
): RenderRecipeClip["layout"]["typographyLayout"] {
  if (!layoutRole) return undefined;
  const r = layoutRole.toLowerCase();
  if (r.includes("center") || r.includes("headline") || r.includes("title")) return "center_title";
  if (r.includes("lower") || r.includes("sub")) return "lower_third";
  if (r.includes("diag")) return "diagonal_tag";
  if (r.includes("scatter") || r.includes("keyword")) return "keyword_scatter";
  if (r.includes("top")) return "top_tag";
  return undefined;
}

function recipeAnimationHint(hint: string | undefined): RenderRecipeClip["text"]["animationHint"] {
  switch (hint) {
    case "per_char_reveal":
    case "shake":
    case "scale":
    case "flash":
      return hint;
    default:
      return "none";
  }
}

function recipePrimitiveReason(clip: TimelineClip, component: RenderRecipePrimitive): string {
  const fam = clip.visualFormFamily;
  let signal: string;
  if (clip.role === "hook") signal = "role=hook";
  else if (clip.role === "cta") signal = "role=cta";
  else if (fam === "live_action_montage" || fam === "object_motion") signal = `family=${fam}`;
  else if (fam === "brand_cta") signal = "family=brand_cta";
  else if (fam === "kinetic_typography") signal = "family=kinetic_typography";
  else if (clip.role === "proof") signal = "role=proof";
  else signal = clip.subtitleText ? "subtitle_present" : "default";
  return `${signal} → ${clip.motionPrimitive ?? "beat_text_card"} → ${component}`;
}

const COLOR_ROLE_HEX: Record<string, string> = {
  black: "#05060a",
  dark: "#05060a",
  white: "#f5f5f5",
  red: "#e11d2a",
  yellow: "#f5c518",
  amber: "#f5c518",
  blue: "#22d3ee",
  cyan: "#22d3ee",
  teal: "#14b8a6",
  purple: "#a855f7",
  pink: "#f472b6",
  orange: "#f97316",
  green: "#22c55e"
};

function normalizeRecipeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (shortHex) return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`;
  if (/^0x[0-9a-f]{6}$/i.test(text)) return `#${text.slice(2)}`;
  return COLOR_ROLE_HEX[text] ?? undefined;
}

function colorsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(colorsFromUnknown);
  if (typeof value !== "string") return [];
  const exact = normalizeRecipeColor(value);
  if (exact) return [exact];
  return value
    .split(/[,/|+_\s-]+/)
    .map((part) => normalizeRecipeColor(part))
    .filter((color): color is string => Boolean(color));
}

function recipePalette(background: string, isBeatCut: boolean, template: StructureTemplate): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: unknown) => {
    for (const color of colorsFromUnknown(value)) {
      if (!seen.has(color)) {
        seen.add(color);
        out.push(color);
      }
    }
  };
  add(background);
  add(template.visualElementGraph?.globalStyle?.palette);
  add(template.visualStyle?.colorProgression);
  add(template.heroDescriptor?.palette);
  for (const typo of template.typographyEvidence ?? []) add(typo.colorRole);

  const fallback = isBeatCut
    ? [background, "#e11d2a", "#f5c518", "#f5f5f5", "#22d3ee"]
    : [background, "#0ea5e9", "#a855f7", "#f5f5f5"];
  for (const color of fallback) add(color);
  return out.slice(0, 8);
}

function recipeAudioLayers(
  estimated: Record<string, unknown> | undefined,
  audioStructure: Record<string, unknown> | undefined = undefined
): RenderRecipe["global"]["audioPlan"]["layers"] {
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);
  const e = estimated ?? {};
  const layers: RenderRecipe["global"]["audioPlan"]["layers"] = {};
  const kick = num(e.kick) ?? num(e.bass_kick);
  if (kick !== undefined) {
    layers.kick = kick;
  }
  const bass = num(e.bass) ?? num(e.bass_kick);
  if (bass !== undefined) layers.bass = bass;
  const drone = num(e.drone) ?? num(e.music_harmonic);
  if (drone !== undefined) layers.drone = drone;
  const hats = num(e.hats) ?? num(e.hats_air);
  if (hats !== undefined) layers.hats = hats;
  const riser = num(e.riser);
  if (riser !== undefined) layers.riser = riser;
  const impact = num(e.impact);
  if (impact !== undefined) layers.impact = impact;
  const strongBeats = Array.isArray(audioStructure?.strongBeats) ? audioStructure.strongBeats.length : 0;
  const onsets = Array.isArray(audioStructure?.onsets) ? audioStructure.onsets.length : 0;
  const centroid = typeof audioStructure?.spectralCentroidMean === "number" ? audioStructure.spectralCentroidMean : undefined;
  const flatness = typeof audioStructure?.spectralFlatnessMean === "number" ? audioStructure.spectralFlatnessMean : undefined;
  if (layers.hats === undefined && centroid !== undefined) layers.hats = Math.max(0.08, Math.min(1, centroid / 5200));
  if (layers.drone === undefined && flatness !== undefined) layers.drone = Math.max(0.08, Math.min(0.8, 1 - flatness));
  if (layers.impact === undefined && strongBeats > 0) layers.impact = Math.min(1, 0.18 + strongBeats / 40);
  if (layers.riser === undefined && onsets > 8) layers.riser = Math.min(0.8, 0.12 + onsets / 80);
  return layers;
}

interface BuildRenderRecipeArgs {
  styledClips: TimelineClip[];
  isBeatCut: boolean;
  videoType: string | undefined;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  durationSec: number;
  synthBeat: { bpm: number; beats: number[] };
  audioPolicy: "sample_bgm" | "synth_beat" | "silent";
  background: string;
  brief: ParsedBrief;
  template: StructureTemplate;
  source: SourceVideoUnderstanding;
  request: GenerationRequest;
  warnings: string[];
  motionAtoms?: MotionAtomSpec[];
}

function bboxNormObject(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return undefined;
  const [x, y, w, h] = value;
  return { x, y, w, h };
}

function evidenceRefsForRecipeClip(template: StructureTemplate, clip: TimelineClip): string[] {
  const sample = template.sourceSampleIds[0] ?? "sample";
  if (clip.sourceShotId) return [`evidence://${sample}/shot/${clip.sourceShotId}`];
  const typo = clip.layers
    .map((layer) => (layer.style as { typography?: { textLayerId?: string } } | undefined)?.typography?.textLayerId)
    .find(Boolean);
  if (typo) return [`evidence://${sample}/typography/${typo}`];
  return [`evidence://${sample}/clip/${clip.id}`];
}

function materialProvenanceForRecipe(kind: RenderRecipeClip["material"]["kind"], assetIds: string[]): RenderRecipeClip["material"]["provenance"] {
  if (kind === "source_video") return "source_video";
  if (kind === "generated_target_asset" || assetIds.some((id) => /^fan_|^aigc_|generated/i.test(id))) return "aigc_generated";
  if (kind === "target_image" || kind === "target_image_set") return "user_uploaded";
  return undefined;
}

function estimatedAudioLayerCount(template: StructureTemplate): number {
  const layers = (template.audioStructure?.estimatedLayers as Record<string, unknown> | undefined) ?? {};
  return Object.values(layers).filter((value) => typeof value === "number" && Number.isFinite(value)).length;
}

/**
 * Compile the renderer-agnostic RenderRecipe from the final styled clips. Source of truth for what
 * each renderer draws; never re-derives a primitive from role alone (see recipePrimitiveReason).
 */
export function buildRenderRecipe(args: BuildRenderRecipeArgs): RenderRecipe {
  const {
    styledClips, isBeatCut, aspectRatio, width, height, durationSec,
    synthBeat, audioPolicy, background, brief, template, source, request, warnings
  } = args;
  const name = sanitizeDisplayText(brief.productName || brief.topic, "Product");
  const ctaText = sanitizeDisplayText(brief.cta, "Click to learn more", 36);
  const isFan = /fan|风扇|涡轮|turbo/i.test(`${name} ${brief.sellingPoints.join(" ")} ${request.prompt}`);
  const sampleIds = new Set(template.sourceSampleIds ?? []);
  const sourceIsDistinct =
    Boolean(source.assetId) && source.reusableAsMaterial === true && !sampleIds.has(source.assetId ?? "");
  const anyTargetAsset =
    (request.targetAssets?.length ?? 0) > 0 ||
    styledClips.some((c) => (c.layers ?? []).some((l) => Boolean(l.assetId)));
  const targetAssetKindById = new Map((request.targetAssets ?? []).map((asset) => [asset.id, asset.kind]));
  const isRenderableMediaAsset = (assetId: string | undefined): boolean => {
    if (!assetId) return false;
    const kind = targetAssetKindById.get(assetId);
    return !kind || kind === "image" || kind === "video" || kind === "logo" || kind === "background_image";
  };

  const videoType: RenderRecipe["videoType"] = isBeatCut
    ? "beat_cut_product"
    : args.videoType === "motion_graph"
      ? "motion_graph"
      : "product_mg";
  const audioStructure = (template.audioStructure ?? {}) as Record<string, unknown>;
  const learnedBeatGrid = Array.isArray(audioStructure.strongBeats)
    ? audioStructure.strongBeats
        .map((value) => (typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(3)) : undefined))
        .filter((value): value is number => value !== undefined)
        .slice(0, 64)
    : [];
  const learnedBpm = typeof audioStructure.bpm === "number" && Number.isFinite(audioStructure.bpm) ? audioStructure.bpm : synthBeat.bpm;

  const templateTypoStyles = (template.typographyEvidence ?? [])
    .slice()
    .sort((a, b) => b.fontSizeRatio - a.fontSizeRatio)
    .map((t) => ({
      textLayerId: t.textLayerId,
      layoutRole: t.layoutRole,
      colorRole: t.colorRole,
      animationHint: t.animationHint,
      bboxNorm: t.bboxNorm,
      fontSizeRatio: t.fontSizeRatio
    }));
  let templateTypoCursor = 0;
  const clips: RenderRecipeClip[] = styledClips.map((clip) => {
    const layerAssetId = (clip.layers ?? []).find((l) => Boolean(l.assetId) && isRenderableMediaAsset(l.assetId))?.assetId;
    const hasSourcePixels = isRenderableMediaAsset(clip.sourceAssetId) || Boolean(layerAssetId);
    const fallbackComponent = recipeComponentFor(clip.motionPrimitive, { isFan, hasSourcePixels });
    const heroLayer = (clip.layers ?? []).find((l) => l.kind === "moving_material" || l.kind === "moving_video");
    const heroElement = (heroLayer?.style as
      | { heroElement?: { positionClass?: string; centerTrajectory?: Array<[number, number]> } }
      | undefined)?.heroElement;
    const learnedGeometry = (clip.layers ?? [])
      .map((l) => (l.style as { elementGeometry?: { bbox?: [number, number, number, number]; motionPattern?: string; reuseReason?: string } } | undefined)?.elementGeometry)
      .find((value) => value?.bbox);
    const textLayer = (clip.layers ?? []).find(
      (l) => l.kind === "text" || l.kind === "text_overlay" || l.kind === "ticker"
    );
    let typo = (textLayer?.style as
      | { typography?: { layoutRole?: string; colorRole?: string; animationHint?: string; bboxNorm?: [number, number, number, number]; fontSizeRatio?: number; textLayerId?: string } }
      | undefined)?.typography;
    if (!typo && clip.subtitleText && templateTypoStyles.length) {
      typo = templateTypoStyles[templateTypoCursor++ % templateTypoStyles.length];
    }

    let materialKind: RenderRecipeClip["material"]["kind"];
    const assetIds: string[] = [];
    if (isRenderableMediaAsset(clip.sourceAssetId)) {
      materialKind = clip.sourceAssetId === source.assetId ? "source_video" : "target_image";
      assetIds.push(clip.sourceAssetId as string);
    } else if (layerAssetId) {
      materialKind = "target_image";
      assetIds.push(layerAssetId);
    } else {
      materialKind = "procedural";
    }
    const selected = componentFromTechniqueAtoms(clip, template, {
      fallback: fallbackComponent,
      hasSourcePixels,
      hasTargetMaterial: assetIds.length > 0
    });
    const component = selected.component;
    const policy: RenderRecipeClip["material"]["policy"] =
      materialKind !== "procedural" ? "renderable" : component === "DynamicProxyMontage" ? "missing" : "renderable";

    const typographyLayout = recipeTypographyLayout(typo?.layoutRole);
    const evidenceRefs = evidenceRefsForRecipeClip(template, clip);
    const clipId = clip.id;
    const layerIds = [
      ...(materialKind !== "procedural" && assetIds.length ? [`layer_${clipId}_media`] : []),
      ...(clip.subtitleText ? [`layer_${clipId}_text`] : [])
    ];
    const materialProvenance = materialProvenanceForRecipe(materialKind, assetIds);
    return {
      id: clipId,
      clipId: clip.id,
      role: clip.role === "global" ? "body" : clip.role,
      startSec: clip.startSec,
      endSec: round(clip.startSec + clip.durationSec),
      durationSec: clip.durationSec,
      atomIds: selected.atomIds,
      layerIds,
      evidenceRefs,
      slotId: (clip.layers ?? []).find((l) => l.slotId)?.slotId ?? clip.id,
      visualFormFamily: recipeFamilyFor(component),
      selectedPrimitive: component,
      primitiveReason: selected.reason ?? clip.primitiveReason ?? recipePrimitiveReason(clip, component),
      rendererTarget: "remotion_recipe",
      material: {
        kind: materialKind,
        assetIds,
        ...(clip.sourceShotId ? { sourceShotIds: [clip.sourceShotId] } : {}),
        policy,
        ...(materialProvenance ? { provenance: materialProvenance } : {})
      },
      layout: {
        ...(heroElement?.positionClass ? { positionClass: heroElement.positionClass } : {}),
        ...(heroElement?.centerTrajectory?.length ? { bboxTrackNorm: heroElement.centerTrajectory } : {}),
        ...(bboxNormObject(typo?.bboxNorm) ? { bboxNorm: bboxNormObject(typo?.bboxNorm) } : {}),
        ...(bboxNormObject(learnedGeometry?.bbox) ? { mediaBBoxNorm: bboxNormObject(learnedGeometry?.bbox) } : {}),
        ...(typographyLayout ? { typographyLayout } : {})
      },
      motion: {
        pattern: recipeMotionFor(component),
        beatAligned: isBeatCut,
        beatTimestampsSec: clip.beatTimestamps ?? [],
        ...(heroElement?.centerTrajectory?.length ? { trajectory: heroElement.centerTrajectory } : {})
      },
      text: {
        copy: clip.subtitleText ?? "",
        colorRoles: typo?.colorRole ? [typo.colorRole] : ["red", "yellow", "white"],
        animationHint: recipeAnimationHint(typo?.animationHint),
        ...(typeof typo?.fontSizeRatio === "number" && Number.isFinite(typo.fontSizeRatio) ? { fontSizeRatio: typo.fontSizeRatio } : {})
      }
    };
  });

  const legacyRecipe: RenderRecipe = {
    schemaVersion: "render-recipe-v1",
    videoType,
    productTheme: {
      name,
      productName: name,
      ...(brief.brandName ? { brandName: brief.brandName } : {}),
      category: isFan ? "portable_fan" : "physical_product",
      sellingPoints: brief.sellingPoints,
      cta: ctaText,
      ctaText,
      generationPrompt: brief.rawPrompt
    },
    sourcePolicy: {
      sampleUse: request.constraints?.sampleAssetReuse === "authorized" ? "authorized_reuse" : "structure_evidence_only",
      sourceVideoUse: sourceIsDistinct ? "renderable_user_material" : "missing",
      targetAssetUse: anyTargetAsset ? "renderable_target_material" : "missing",
      sampleFrameCopyAllowed: false,
      sampleAudioCopyAllowed: false
    },
    evidenceSummary: {
      sourceSampleIds: template.sourceSampleIds ?? [],
      preservedEvidence: {
        visualElements: template.visualElementGraph?.elements?.length ?? 0,
        typographyRuns: template.typographyEvidence?.length ?? 0,
        motionAtoms: (args.motionAtoms ?? template.motionAtoms ?? []).length,
        audioLayers: estimatedAudioLayerCount(template)
      },
      droppedEvidence: []
    },
    motionAtoms: args.motionAtoms ?? template.motionAtoms ?? [],
    global: {
      aspectRatio,
      width,
      height,
      fps: 30,
      durationSec,
      palette: recipePalette(background, isBeatCut, template),
      ...(learnedBpm ? { bpm: learnedBpm } : {}),
      ...((isBeatCut || learnedBeatGrid.length) ? { beatGridSec: learnedBeatGrid.length ? learnedBeatGrid : synthBeat.beats } : {}),
      cutPattern: {
        targetCutCount: clips.length,
        avgShotDurationSec: round(durationSec / Math.max(1, clips.length)),
        fastZones: []
      },
      audioPlan: {
        policy:
          audioPolicy === "sample_bgm" ? "authorized_sample_bgm" : audioPolicy === "synth_beat" ? "procedural_bgm" : "silent",
        layers: recipeAudioLayers(template.audioStructure?.estimatedLayers as Record<string, unknown> | undefined, audioStructure)
      }
    },
    clips,
    warnings
  };
  return migrateRenderRecipeToV4_1(legacyRecipe, {
    motionAtoms: args.motionAtoms ?? template.motionAtoms ?? [],
    evidenceSummary: legacyRecipe.evidenceSummary,
    rawPrompt: brief.rawPrompt
  });
}

/** The beat-cut primitive for a slot = its first renderer candidate that is a known primitive. */
function beatPrimitiveFromSlot(slot: RequiredSlot | undefined): string | undefined {
  return slot?.rendererCandidates?.find((candidate) => KNOWN_BEAT_PRIMITIVES.has(candidate));
}

/** Strip placeholder/proxy strings from a beat-cut clip so the output never shows debug labels. */
const FORBIDDEN_VISUAL_TEXT = /placeholder|proxy|missing|运动图插槽|B2B MG Promo|generic landing page/i;
function sanitizeBeatCutLayers(layers: TimelineLayer[], clipId: string): TimelineLayer[] {
  const cleaned: TimelineLayer[] = layers
    .filter((layer) => layer.kind !== "base_visual" || Boolean(layer.assetId))
    .map((layer): TimelineLayer => {
      const style = layer.style ? { ...layer.style } : undefined;
      if (style) {
        delete (style as Record<string, unknown>).placeholderSpec;
        if (typeof style.fillStrategy === "string" && FORBIDDEN_VISUAL_TEXT.test(style.fillStrategy)) {
          style.fillStrategy = "procedural_generation";
        }
        for (const [key, value] of Object.entries(style)) {
          if (typeof value === "string" && FORBIDDEN_VISUAL_TEXT.test(value)) delete (style as Record<string, unknown>)[key];
        }
      }
      const text = layer.text && FORBIDDEN_VISUAL_TEXT.test(layer.text) ? undefined : layer.text;
      return { ...layer, text, style };
    });
  if (!cleaned.some((layer) => layer.kind === "background")) {
    cleaned.unshift({ id: stableId("layer_bg", clipId, "beatcut"), kind: "background", style: { color: "#05060a" } });
  }
  return cleaned;
}

/**
 * Build the typed v2 layered-clip contract for a beat-cut clip from its motion primitive:
 * a global dark moving background, the moving/text/transition material for the primitive, and
 * (for the montage) a moving_video layer whose assetPolicy forbids copying sample frames. The
 * renderer reads `kind`/`slotId`/`motion`/`assetPolicy` to drive style-locked motion. Any real
 * matched source-asset layer on the clip is preserved.
 */
function beatCutLayersForClip(
  clip: TimelineClip,
  primitive: string,
  subtitleText: string | undefined,
  cta: string | undefined,
  heroDescriptor?: HeroObjectDescriptor,
  typoHint?: { layoutRole?: string; colorRole?: string; animationHint?: string; bboxNorm?: [number, number, number, number] },
  heroElement?: { positionClass?: string; motionPattern?: string; centerTrajectory?: Array<[number, number]> }
): TimelineLayer[] {
  const id = (kind: string) => stableId("layer", clip.id, kind, primitive);
  const bg = (motion: string): TimelineLayer => ({
    id: id("bg"), kind: "background", slotId: "slot_dark_background", motion, style: { color: "#05060a" }
  });
  // Text layers carry the sample-derived typography hint (layout/colour/animation) so the renderer
  // varies placement instead of always centering.
  const text = (content: string | undefined, motion: string, slotId?: string): TimelineLayer => ({
    id: id("text"), kind: "text", slotId, text: content, motion,
    style: { position: typoHint?.layoutRole ?? "center", emphasis: "red_yellow_white", ...(typoHint ? { typography: typoHint } : {}) }
  });
  const layers: TimelineLayer[] = [];
  // Preserve a real matched source-asset visual (target moving clip / image), if any.
  const realAsset = clip.layers.find((l) => l.kind === "base_visual" && Boolean(l.assetId));
  switch (primitive) {
    case "neon_hero_intro":
      layers.push(bg("slow_light_streaks+scanlines"));
      layers.push({
        id: id("hero"), kind: "moving_material", slotId: "slot_moving_hero_object",
        motion: heroDescriptor?.motionPattern ?? "rotate_y+orbit+beat_scale",
        assetPolicy: "generated/procedural hero object; never sample frames",
        style: {
          color: "#22d3ee",
          ...(heroDescriptor ? { heroDescriptor } : {}),
          // located element (from the VisualElementGraph) the renderer positions the silhouette by
          ...(heroElement ? { heroElement: { positionClass: heroElement.positionClass, motionPattern: heroElement.motionPattern, centerTrajectory: (heroElement.centerTrajectory ?? []).slice(0, 8) } } : {})
        }
      });
      layers.push(text(subtitleText, "scale_on_beat"));
      break;
    case "beat_text_card":
      layers.push(bg("black_card+red_line"));
      layers.push(text(subtitleText, "scale_on_beat", "slot_kinetic_text_card"));
      break;
    case "tutorial_rule_card":
      layers.push(bg("black_card"));
      layers.push(text(subtitleText, "hard_cut_per_line", "slot_storyboard_rule_card"));
      layers.push({ id: id("bars"), kind: "beat_bars", motion: "per-beat pulse", style: { color: "#fbbf24" } });
      break;
    case "action_montage":
      layers.push(bg("dark_streaks"));
      layers.push({ id: id("montage"), kind: "moving_video", slotId: "slot_moving_source_montage", motion: "hard-cut / crop-zoom / diagonal wipe", assetPolicy: "target clips or generated/procedural proxy; never sample frames", style: {} });
      layers.push({ id: id("overlay"), kind: "text_overlay", text: subtitleText, motion: "impact on beat", style: { emphasis: "red_yellow_white", ...(typoHint ? { typography: typoHint } : {}) } });
      break;
    case "impact_flash_stamp":
      layers.push(bg("dark"));
      layers.push({ id: id("flash"), kind: "transition", slotId: "slot_impact_flash", motion: "white flash + red radial stamp on strong beats", style: {} });
      break;
    case "motivation_cta":
      layers.push(bg("dark"));
      layers.push(text(subtitleText, "final hold + pulse", "slot_motivation_cta"));
      layers.push({ id: id("ticker"), kind: "ticker", text: cta ?? "剪辑方法迁移，不复制原片内容", motion: "scroll", style: { color: "#b91c1c" } });
      break;
    default:
      layers.push(bg("dark"));
      layers.push(text(subtitleText, "scale_on_beat"));
  }
  if (realAsset) layers.splice(1, 0, realAsset);
  return layers;
}

/** Pick the beat-cut style primitive the renderer should draw for a clip (role + family). */
function beatCutPrimitiveForClip(clip: TimelineClip): string {
  if (clip.role === "hook") return "neon_hero_intro";
  if (clip.role === "cta") return "motivation_cta";
  const fam = clip.visualFormFamily;
  if (fam === "live_action_montage") return "action_montage";
  if (fam === "object_motion") return "action_montage";
  if (fam === "brand_cta") return "motivation_cta";
  if (fam === "kinetic_typography") return "beat_text_card";
  if (clip.role === "proof") return "action_montage";
  return clip.subtitleText ? "tutorial_rule_card" : "beat_text_card";
}

/**
 * v1.3 evidence + material driven primitive selection (flag-guarded by controls.recipeEvidencePrimitives).
 * Reads the template's visual evidence (hero descriptor, element graph, typography, audio structure) and
 * the clip's material availability so DIFFERENT samples yield DIFFERENT primitive sequences — this is what
 * removes the sample-blind mold. Returns the internal beat-cut primitive plus an auditable reason. The
 * default (flag OFF) path stays on beatCutPrimitiveForClip so golden output is unchanged.
 */
export function selectPrimitive(args: {
  clip: TimelineClip;
  template: StructureTemplate;
  hasSourcePixels: boolean;
}): { primitive: string; reason: string } {
  const { clip, template, hasSourcePixels } = args;
  const fam = clip.visualFormFamily;
  const elements = template.visualElementGraph?.elements ?? [];
  const hasHero = Boolean(template.heroDescriptor) || elements.some((e) => e.family === "hero_object");
  const hasImpact =
    elements.some((e) => e.family === "impact_fx") ||
    Array.isArray((template.audioStructure as { onsets?: unknown[] } | undefined)?.onsets);
  const typo = template.typographyEvidence ?? [];
  const hasRuleList = typo.some((t) => /list|rule|bullet|step/i.test(`${t.layoutRole ?? ""}`));

  if (clip.role === "cta" || fam === "brand_cta") {
    return { primitive: "motivation_cta", reason: `${clip.role === "cta" ? "role=cta" : "family=brand_cta"} → motivation_cta` };
  }
  if (clip.role === "transition" && hasImpact) {
    return { primitive: "impact_flash_stamp", reason: "role=transition + impact_fx/onset evidence → impact_flash_stamp" };
  }
  if (clip.role === "hook") {
    if (hasHero) return { primitive: "neon_hero_intro", reason: "role=hook + hero_object/heroDescriptor evidence → neon_hero_intro" };
    if (hasSourcePixels) return { primitive: "action_montage", reason: "role=hook + source/target pixels available → action_montage" };
    return { primitive: "neon_hero_intro", reason: "role=hook (no hero evidence; default product hero) → neon_hero_intro" };
  }
  if (fam === "live_action_montage" || fam === "object_motion" || clip.role === "proof") {
    if (hasSourcePixels) return { primitive: "action_montage", reason: `${fam ?? "role=proof"} + source/target pixels → action_montage (source-first montage)` };
    if (hasImpact && clip.role === "transition") return { primitive: "impact_flash_stamp", reason: "impact evidence → impact_flash_stamp" };
    return { primitive: "action_montage", reason: `${fam ?? "role=proof"} (no source pixels) → action_montage (procedural proxy)` };
  }
  if (fam === "kinetic_typography" || typo.length > 0 || Boolean(clip.subtitleText)) {
    if (hasRuleList || (Boolean(clip.subtitleText) && clip.role === "body")) {
      return { primitive: "tutorial_rule_card", reason: "typography rule/list evidence or body subtitle → tutorial_rule_card" };
    }
    return { primitive: "beat_text_card", reason: "typography/kinetic evidence → beat_text_card" };
  }
  const fallback = clip.subtitleText ? "tutorial_rule_card" : "beat_text_card";
  return { primitive: fallback, reason: `default → ${fallback}` };
}

/** Synthesize a regular beat grid at the transferred BPM (we transfer rhythm, not sample audio). */
function synthesizeBeatGrid(bpmInput: number | undefined, durationSec: number): { bpm: number; beats: number[] } {
  const bpm = bpmInput && bpmInput > 40 && bpmInput < 300 ? bpmInput : 120;
  const interval = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0; t < durationSec - 0.001; t += interval) beats.push(Number(t.toFixed(3)));
  return { bpm, beats };
}

/**
 * v1.3 sample-adaptive beat-cut structure: derive the segment plan (clip count + per-clip duration +
 * role/slot arrangement) from the sample's REAL shot signature (visualElementGraph shots + BPM) instead
 * of a fixed 6-segment mold. Different samples (different shot counts / durations / BPM) therefore yield
 * structurally different timelines — this is what breaks the within-videoType "mold". Flag-guarded.
 */
function adaptiveBeatCutSegments(template: StructureTemplate): StructureSegment[] {
  const shots = (template.visualElementGraph?.shots ?? []) as Array<{ startSec?: number; endSec?: number }>;
  const bpm = template.rhythm?.bpm && template.rhythm.bpm > 40 ? template.rhythm.bpm : 120;
  // Clip count scales with the sample's tempo (faster → more cuts in the same target window). Distinct per sample.
  const N = clamp(Math.round(bpm / 22), 4, 9);
  // Per-clip duration profile resampled from the sample's real shot-duration distribution, so the
  // output inherits the sample's actual rhythm (mix of long/short shots), not a uniform split.
  const shotDurs = shots
    .map((s) => Math.max(0.25, Number(s.endSec ?? 0) - Number(s.startSec ?? 0)))
    .filter((d) => Number.isFinite(d) && d > 0);
  const picked: number[] = [];
  for (let i = 0; i < N; i += 1) {
    picked.push(shotDurs.length ? shotDurs[Math.floor((i * shotDurs.length) / N)] : (60 / bpm) * (2 + (i % 3)));
  }
  const total = picked.reduce((a, b) => a + b, 0) || N;
  const roleAt = (i: number): SegmentRole => {
    if (i === 0) return "hook";
    if (i === N - 1) return "cta";
    if (i === N - 2 && N >= 4) return "transition";
    const mid: SegmentRole[] = ["setup", "body", "proof"];
    return mid[(i - 1) % mid.length];
  };
  const bodyCycle = ["slot_moving_source_montage", "slot_kinetic_text_card", "slot_storyboard_rule_card"];
  let bodyCursor = 0;
  const slotFor = (role: SegmentRole): string => {
    if (role === "hook") return "slot_moving_hero_object";
    if (role === "cta") return "slot_motivation_cta";
    if (role === "transition") return "slot_impact_flash";
    return bodyCycle[bodyCursor++ % bodyCycle.length];
  };
  const segments: StructureSegment[] = [];
  let acc = 0;
  for (let i = 0; i < N; i += 1) {
    const startRatio = acc / total;
    acc += picked[i];
    const endRatio = i === N - 1 ? 1 : acc / total;
    const role = roleAt(i);
    segments.push({
      id: `adaptive_seg_${i + 1}_${role}`,
      role,
      startRatio: Number(startRatio.toFixed(4)),
      endRatio: Number(endRatio.toFixed(4)),
      intent: `adaptive ${role} (sample-driven: ${N} clips @ ${Math.round(bpm)}bpm)`,
      slots: [slotFor(role)]
    });
  }
  return segments;
}

/** Representative element geometry (size+position+motion) from the learned VisualElementGraph, so the
 *  FFmpeg renderer composites the real asset at the SAMPLE's actual element bbox/motion instead of
 *  always full-bleed + a fixed pan. Only image-bearing roles get geometry (text clips stay procedural). */
function elementGeometryForClip(
  clip: TimelineClip,
  template: StructureTemplate
): { bbox: [number, number, number, number]; motionPattern?: string; reuseReason?: string; fit?: "heroFill" | "cover" | "contain" | "cardInset" | "backgroundFill"; minAreaRatio?: number } | undefined {
  const wantsImage =
    clip.role === "hook" || clip.role === "proof" ||
    clip.visualFormFamily === "object_motion" || clip.visualFormFamily === "live_action_montage" || clip.visualFormFamily === "media_cards";
  if (!wantsImage) return undefined;
  const elements = (template.visualElementGraph?.elements ?? []).filter((e) => (e.bboxTrackNorm?.length ?? 0) > 0);
  if (!elements.length) return undefined;
  const family = String(clip.visualFormFamily ?? "");
  const preferredFamilies =
    clip.role === "hook"
      ? [/hero|product|object/i, /poster/i, /media_card|card/i]
      : family === "live_action_montage"
        ? [/montage|live_action|shot|video/i, /media_card|card/i, /hero|product|object/i]
        : family === "object_motion"
          ? [/object|hero|product/i, /poster/i]
          : clip.role === "proof"
            ? [/compare|split/i, /media_card|card/i, /montage|live_action/i, /hero|product|object/i]
            : [/hero|product|object/i];
  let candidates: typeof elements = [];
  for (const pattern of preferredFamilies) {
    candidates = elements.filter((e) => pattern.test(e.family));
    if (candidates.length) break;
  }
  const reuseReason = candidates.length ? undefined : "No role/family-specific element track; using round-robin over all located visual elements.";
  const pool = candidates.length ? candidates : elements;
  const seed = Array.from(`${clip.id}:${clip.sourceShotId ?? ""}:${family}:${clip.role}`).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const el = pool[seed % pool.length];
  const track = (el?.bboxTrackNorm ?? []) as Array<{ t: number; bbox: [number, number, number, number] }>;
  if (!track.length) return undefined;
  let bbox = track[Math.floor(track.length / 2)]?.bbox ?? track[0].bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;
  const minAreaRatio = clip.role === "hook" ? 0.18 : clip.visualFormFamily === "object_motion" ? 0.14 : 0.1;
  const area = Math.max(0, bbox[2]) * Math.max(0, bbox[3]);
  if (area > 0 && area < minAreaRatio) {
    const scale = Math.sqrt(minAreaRatio / area);
    const cx = bbox[0] + bbox[2] / 2;
    const cy = bbox[1] + bbox[3] / 2;
    const nw = Math.min(0.9, bbox[2] * scale);
    const nh = Math.min(0.9, bbox[3] * scale);
    bbox = [
      Math.max(0, Math.min(1 - nw, cx - nw / 2)),
      Math.max(0, Math.min(1 - nh, cy - nh / 2)),
      nw,
      nh
    ];
  }
  return {
    bbox,
    motionPattern: el?.motionPattern,
    ...(reuseReason ? { reuseReason } : {}),
    fit: clip.role === "hook" ? "heroFill" : family === "live_action_montage" ? "cover" : "contain",
    minAreaRatio
  };
}

function attachElementGeometry(
  layers: TimelineLayer[],
  geom: { bbox: [number, number, number, number]; motionPattern?: string; reuseReason?: string; fit?: string; minAreaRatio?: number } | undefined
): TimelineLayer[] {
  if (!geom || !layers.length) return layers;
  const index = layers.findIndex((layer) => layer.kind === "moving_material" || layer.kind === "moving_video" || layer.kind === "base_visual");
  const target = index >= 0 ? index : 0;
  return layers.map((layer, i) => i === target ? { ...layer, style: { ...(layer.style ?? {}), elementGeometry: geom } } : layer);
}

export function buildTimeline(input: BuildTimelineInput): { timeline: Timeline; storyboard: StoryboardItem[] } {
  const { template, request, source, mappings, fillPlan, generationId } = input;
  const totalSec = request.target.targetDurationSec;
  const brief = parsePromptToBrief(request);
  const isBeatCut = template.videoType === "beat_cut";
  // v1.3: when adaptive structure is enabled, the segment plan (clip count + durations + slot arc) is
  // derived from THIS sample's real shot signature instead of the fixed beat-cut mold.
  const adaptiveStructure = isBeatCut && request.controls?.recipeAdaptiveStructure === true;
  const planSegments = adaptiveStructure ? adaptiveBeatCutSegments(template) : template.segments;
  const clips: TimelineClip[] = [];
  const storyboard: StoryboardItem[] = [];
  const mapping: TimelineMappingItem[] = [];
  const slotUseCounts = new Map<string, number>();

  let cursor = 0;
  for (const segment of planSegments) {
    const segmentDuration = Math.max(0.6, round((segment.endRatio - segment.startRatio) * totalSec));
    // Global slots (background, BGM) are carried as layers / render-plan audio, not as their own
    // clips — so a segment that lists them does not spawn extra clips for them.
    const nonGlobalSlots = segment.slots.filter((slotId) =>
      template.requiredSlots.some((slot) => slot.id === slotId && slot.role !== "global"));
    const slotIds = nonGlobalSlots.length > 0
      ? nonGlobalSlots
      : segment.slots.filter((slotId) => template.requiredSlots.some((slot) => slot.id === slotId));
    // Adaptive structure already chose exactly one slot per clip; don't let pace expansion re-split it.
    const slotsForSegment = adaptiveStructure
      ? (slotIds.length > 0 ? slotIds : segment.slots)
      : slotsForPace(slotIds.length > 0 ? slotIds : segment.slots, template, request.controls);
    const perSlotDuration = round(segmentDuration / Math.max(slotsForSegment.length, 1));
    const segmentClipIds: string[] = [];

    for (const slotId of slotsForSegment) {
      const slotOccurrence = slotUseCounts.get(slotId) ?? 0;
      slotUseCounts.set(slotId, slotOccurrence + 1);
      const slot = template.requiredSlots.find((item) => item.id === slotId);
      const mappingForSlot = mappings.find((item) => item.slotId === slotId);
      const fillForSlot = fillPlan.find((item) => item.slotId === slotId);
      const replacementFill = fillForSlot?.strategy === "user_asset_replace" || fillForSlot?.strategy === "aigc_generated_asset";
      const proxyFill = fillForSlot?.strategy === "proxy_placeholder";
      const proceduralFill = fillForSlot?.strategy === "procedural_generation";
      const familyRendererFill = Boolean(
        mappingForSlot?.visualFormFamily &&
          (replacementFill || proxyFill || proceduralFill)
      );
      const matched = mappingForSlot?.status === "matched" && !familyRendererFill;
      const strategy: "none" | FillStrategy = matched ? "none" : (fillForSlot?.strategy ?? "text_card");
      // Adaptive structure can reuse a slot across multiple clips, so the clip id must include the
      // segment id to stay unique. Non-adaptive first use is unchanged, but repeated slots also need
      // segment scoping or v4.1 layer ids collide and renderers overwrite media/text layers.
      const segmentScopedClipId = adaptiveStructure || slotOccurrence > 0;
      const clipId = matched
        ? (segmentScopedClipId ? stableId("clip", generationId, slotId, segment.id, slotOccurrence) : stableId("clip", generationId, slotId))
        : segmentScopedClipId
          ? stableId("clip", generationId, slotId, segment.id, slotOccurrence, "fill")
          : fillForSlot?.targetClipId ?? stableId("clip", generationId, slotId, "fill");
      const slotType: SlotType = slot?.slotType ?? "background";
      const subtitle = subtitleForSlot(slotType, brief, request);
      const durationSec = perSlotDuration;
      const role = segment.role;
      const targetAssetId = mappingForSlot?.selectedTargetAssetId;
      const targetAssetIds = mappingForSlot?.selectedTargetAssetIds ?? (targetAssetId ? [targetAssetId] : undefined);
      const replacementAssetId =
        typeof fillForSlot?.rendererInstructions?.boundAssetId === "string" ? fillForSlot.rendererInstructions.boundAssetId : undefined;
      const sourceAssetId = replacementFill ? replacementAssetId : matched ? (targetAssetId ?? source.assetId) : undefined;
      const sourceShotId = matched ? mappingForSlot?.selectedShotId : undefined;
      const clipType: TimelineClipType = matched
        ? mappingForSlot?.selectedTargetAssetKind === "image" || mappingForSlot?.selectedTargetAssetKind === "logo" || mappingForSlot?.selectedTargetAssetKind === "background_image"
          ? "image"
          : mappingForSlot?.selectedTargetAssetKind === "copy" || mappingForSlot?.selectedTargetAssetKind === "cta_info"
            ? "text_card"
            : "video"
        : replacementFill
          ? mappingForSlot?.visualFormFamily
            ? "generated_card"
            : fillForSlot?.rendererInstructions?.replacementAssetKind === "video"
            ? "video"
            : fillForSlot?.rendererInstructions?.replacementAssetKind === "copy" || fillForSlot?.rendererInstructions?.replacementAssetKind === "cta_info"
              ? "text_card"
              : "image"
        : proceduralFill && mappingForSlot?.visualFormFamily
          ? "generated_card"
        : clipTypeForFill(fillForSlot?.strategy);

      const layers: TimelineLayer[] = [
        {
          id: stableId("layer_bg", clipId),
          kind: "background",
          style: { color: renderBackgroundForControls(request.controls), assetAvailability: mappingForSlot?.assetAvailability }
        }
      ];
      if (replacementFill && sourceAssetId) {
        layers.push({
          id: stableId("layer_replacement", clipId, sourceAssetId),
          kind: "base_visual",
          assetId: sourceAssetId,
          timing: {
            fit: "contain",
            motion: "slot_preserved",
            motionSpec: fillForSlot?.rendererInstructions?.motionSpec,
            applyMotionFromSlot: fillForSlot?.rendererInstructions?.applyMotionFromSlot
          },
          style: {
            fillStrategy: fillForSlot?.strategy ?? "user_asset_replace",
            replacementSlotId: fillForSlot?.rendererInstructions?.replacementSlotId ?? slotId,
            placeholderSpec: fillForSlot?.rendererInstructions?.placeholderSpec,
            targetAssetIds,
            targetCopy: fillForSlot?.rendererInstructions?.targetCopy,
            featureList: fillForSlot?.rendererInstructions?.featureList,
            brandName: fillForSlot?.rendererInstructions?.brandName,
            cta: fillForSlot?.rendererInstructions?.cta,
            materialSource: fillForSlot?.rendererInstructions?.materialSource,
            capabilityId: fillForSlot?.rendererInstructions?.capabilityId,
            targetAssetKind: fillForSlot?.rendererInstructions?.replacementAssetKind,
            visualForm: slot?.visualForm,
            visualFormFamily: slot?.visualFormFamily,
            semanticLabel: slot?.semanticLabel
          }
        });
      } else if (matched && sourceAssetId) {
        layers.push({
          id: stableId("layer_visual", clipId, sourceAssetId),
          kind: "base_visual",
          assetId: sourceAssetId,
          sourceShotId,
          timing: { fit: "cover", motion: "crop_zoom", targetAssetKind: mappingForSlot?.selectedTargetAssetKind }
        });
      } else if (proxyFill) {
        const placeholderSpec = fillForSlot?.rendererInstructions?.placeholderSpec as PlaceholderSpec | undefined;
        layers.push({
          id: stableId("layer_proxy", clipId, slotId),
          kind: "base_visual",
          text: placeholderSpec?.label ?? `${slotType} placeholder`,
          timing: {
            fit: "contain",
            motion: "proxy_placeholder",
            motionSpec: fillForSlot?.rendererInstructions?.motionSpec
          },
          style: {
            fillStrategy: "proxy_placeholder",
            replacementSlotId: fillForSlot?.rendererInstructions?.replacementSlotId ?? slotId,
            placeholderSpec,
            targetCopy: fillForSlot?.rendererInstructions?.targetCopy,
            featureList: fillForSlot?.rendererInstructions?.featureList,
            brandName: fillForSlot?.rendererInstructions?.brandName,
            cta: fillForSlot?.rendererInstructions?.cta,
            materialSource: fillForSlot?.rendererInstructions?.materialSource,
            targetAssetIds: fillForSlot?.rendererInstructions?.targetAssetIds,
            missingCount: fillForSlot?.rendererInstructions?.missingCount,
            capabilityId: fillForSlot?.rendererInstructions?.capabilityId,
            acceptedAssetTypes: fillForSlot?.rendererInstructions?.acceptedAssetTypes,
            clickToReplace: true,
            visualForm: slot?.visualForm,
            visualFormFamily: slot?.visualFormFamily,
            semanticLabel: slot?.semanticLabel
          }
        });
      } else if (proceduralFill && slot?.visualFormFamily) {
        const placeholderSpec = fillForSlot?.rendererInstructions?.placeholderSpec as PlaceholderSpec | undefined;
        layers.push({
          id: stableId("layer_generated_family", clipId, slotId),
          kind: "base_visual",
          text: String(fillForSlot?.rendererInstructions?.targetCopy ?? placeholderSpec?.label ?? subtitle),
          timing: {
            fit: "contain",
            motion: "family_specific_procedural",
            motionSpec: fillForSlot?.rendererInstructions?.motionSpec
          },
          style: {
            fillStrategy: "procedural_generation",
            replacementSlotId: fillForSlot?.rendererInstructions?.replacementSlotId ?? slotId,
            placeholderSpec,
            targetCopy: fillForSlot?.rendererInstructions?.targetCopy,
            featureList: fillForSlot?.rendererInstructions?.featureList,
            brandName: fillForSlot?.rendererInstructions?.brandName,
            cta: fillForSlot?.rendererInstructions?.cta,
            materialSource: fillForSlot?.rendererInstructions?.materialSource,
            capabilityId: fillForSlot?.rendererInstructions?.capabilityId,
            visualForm: slot?.visualForm,
            visualFormFamily: slot?.visualFormFamily,
            semanticLabel: slot?.semanticLabel
          }
        });
      } else {
        layers.push({
          id: stableId("layer_card", clipId, subtitle),
          kind: strategy === "packaging_overlay" ? "title_bar" : "base_visual",
          text: subtitle,
          style: { card: template.packaging.titleCardStyle, role, strategy }
        });
      }
      const hasDuplicateBaseText = layers.some((layer) =>
        layer.kind === "base_visual" &&
        typeof layer.text === "string" &&
        layer.text.trim() === subtitle.trim()
      );
      const addSubtitleLayer = request.controls?.subtitleGenerationMode !== "off" && subtitle.trim().length > 0 && !hasDuplicateBaseText;
      if (addSubtitleLayer) layers.push({
        id: stableId("layer_subtitle", clipId, subtitle),
        kind: "subtitle",
        text: subtitle,
        style: { position: "lower_third", density: request.controls?.subtitleDensity ?? "high" }
      });
      const clipSubtitle = request.controls?.subtitleGenerationMode === "off" ? "" : subtitle;
      if (slot?.slotType === "cta_visual") {
        layers.push({
          id: stableId("layer_cta_overlay", clipId),
          kind: "highlight",
          text: brief.cta,
          style: { emphasis: "strong" }
        });
      }

      clips.push({
        id: clipId,
        role,
        startSec: round(cursor),
        durationSec,
        type: clipType,
        sourceAssetId,
        sourceShotId,
        visualIntent: slot?.description ?? segment.intent,
        scriptText: segment.scriptPattern ?? segment.intent,
        subtitleText: clipSubtitle,
        transitionIn: cursor === 0 ? "none" : "hard_cut",
        transitionOut: "hard_cut",
        layers,
        replacementSlotId: fillForSlot?.rendererInstructions?.replacementSlotId,
        placeholderSpec: isBeatCut ? undefined : (fillForSlot?.rendererInstructions?.placeholderSpec as PlaceholderSpec | undefined),
        gapFillStrategy: strategy,
        visualFormFamily: slot?.visualFormFamily,
        motionPrimitive: isBeatCut ? beatPrimitiveFromSlot(slot) : undefined
      });

      storyboard.push({
        clipId,
        timeRange: `${cursor.toFixed(1)}-${(cursor + durationSec).toFixed(1)}s`,
        shotDescription: slot?.description ?? segment.intent,
        subtitle,
        assetUsage: matched
          ? targetAssetId
            ? `Uses target ${mappingForSlot?.selectedTargetAssetKind ?? "asset"} ${targetAssetId}`
            : `Uses source shot ${sourceShotId ?? "unknown"}`
          : replacementFill && targetAssetIds?.length
            ? fillForSlot?.strategy === "aigc_generated_asset"
              ? `Uses AIGC generated asset set ${targetAssetIds.join(", ")}`
              : `Uses target asset set ${targetAssetIds.join(", ")}`
          : `Uses ${strategy} fill`,
        packaging: template.packaging.titleCardStyle ?? "default packaging",
        rationale: mappingForSlot?.reason ?? "Reconstructed by deterministic planner."
      });

      segmentClipIds.push(clipId);
      cursor = round(cursor + durationSec);
    }

    const atomIdsForSegment = template.structureAtoms
      .filter((atom) => atom.role === segment.role || atom.role === "body")
      .map((atom) => atom.id);

    mapping.push({
      templateSegmentId: segment.id,
      atomIds: Array.from(new Set(atomIdsForSegment)),
      targetClipIds: segmentClipIds,
      explanation: `Segment ${segment.role} mapped to ${segmentClipIds.length} clip(s); intent: ${segment.intent}.`
    });
  }

  const durationSec = round(cursor);
  const aspectRatio = request.target.aspectRatio;
  const timelineGapReport = generateGapReport(mappings, { source, template, request });
  const replacementSlots = replacementSlotsFromGapReport(timelineGapReport, fillPlan);

  // Beat-cut style program: decorate clips with the named primitive + style tokens + the
  // beats that fall inside each clip, so the renderer executes the learned visual grammar
  // (dark bg, bold center typography, beat-synced hard cuts) instead of generic proxy cards.
  const synthBeat = synthesizeBeatGrid(template.rhythm.bpm, durationSec);
  const sampleReuse = request.constraints?.sampleAssetReuse;
  const shouldRenderProceduralAudio = request.target.outputMode !== "timeline_only";
  const audioPolicy: "sample_bgm" | "synth_beat" | "silent" = isBeatCut
    ? sampleReuse === "authorized"
      ? "sample_bgm"
      : "synth_beat"
    : shouldRenderProceduralAudio
      ? "synth_beat"
      : "silent";
  const audioRef = audioPolicy === "sample_bgm" ? source.assetId : undefined;
  const audioStructure = (template.audioStructure ?? {}) as Record<string, unknown>;
  const strongBeatsSec = Array.isArray(audioStructure.strongBeats)
    ? audioStructure.strongBeats
        .map((value) => (typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(3)) : undefined))
        .filter((value): value is number => value !== undefined)
        .slice(0, 48)
    : undefined;
  const spectralCentroidMean =
    typeof audioStructure.spectralCentroidMean === "number" && Number.isFinite(audioStructure.spectralCentroidMean)
      ? audioStructure.spectralCentroidMean
      : undefined;
  const spectralFlatnessMean =
    typeof audioStructure.spectralFlatnessMean === "number" && Number.isFinite(audioStructure.spectralFlatnessMean)
      ? audioStructure.spectralFlatnessMean
      : undefined;
  const learnedAudioLayers = (audioStructure.estimatedLayers as Record<string, number> | undefined) ?? undefined;
  // Style tokens are the learned visual grammar; they also surface in explainability views.
  const baseStyleTokens = ["dark_tech", "black_bg", "red_yellow_white_text", "hard_cut", "beat_pulse", "impact_flash", "beat_sync"];
  // Clean Chinese copy pool from the brief so beat-cut cards never fall back to English
  // slot-description text (e.g. "kinetic_typography: kinetic_text_card").
  const hasCjk = (text: string | undefined): boolean => Boolean(text && /[一-鿿]/.test(text));
  const copyPool = [brief.topic, ...brief.sellingPoints].map((t) => (t ?? "").trim()).filter(Boolean);
  const cjkCopyPool = copyPool.filter(hasCjk);
  // Per-role fallback copy DERIVED FROM THE BRIEF (product), never engine/meta phrases. When the
  // brief carries no usable Chinese copy at all, fall back to neutral product-oriented lines (a real
  // LLM subtitle pass on the server replaces these with prompt-grounded copy when enabled). This is
  // why a render never shows meta text like "分镜=时间线 字幕=结构".
  const productNameRaw = ((hasCjk(brief.topic) ? brief.topic!.trim() : cjkCopyPool[0]) ?? "").replace(/^主题[:：]\s*/, "");
  const productName = (productNameRaw.split(/[；;。\n]/)[0] ?? productNameRaw).trim().slice(0, 16);
  const pickCjk = (i: number): string => (cjkCopyPool.length ? cjkCopyPool[i % cjkCopyPool.length] : (productName || "立即了解"));
  const beatCutCjkFallback: Partial<Record<SegmentRole, string>> = {
    hook: productName || "立即开看",
    setup: pickCjk(0),
    body: pickCjk(1),
    proof: pickCjk(2),
    transition: pickCjk(3),
    cta: hasCjk(brief.cta) ? brief.cta!.trim() : "立即了解"
  };
  const ctaCopy = hasCjk(brief.cta) ? brief.cta!.trim() : beatCutCjkFallback.cta!;
  let copyCursor = 0;
  // v3: learned hero descriptor + distinct sample typography styles (headlines first), cycled across
  // the text clips so each card's layout/animation varies and is grounded in the sample.
  const heroDescriptor = template.heroDescriptor;
  const heroElement = (template.visualElementGraph?.elements ?? []).find((e) => e.family === "hero_object");
  const typoStyles = (template.typographyEvidence ?? [])
    .slice()
    .sort((a, b) => b.fontSizeRatio - a.fontSizeRatio)
    .map((t) => ({
      textLayerId: t.textLayerId,
      layoutRole: t.layoutRole,
      colorRole: t.colorRole,
      animationHint: t.animationHint,
      bboxNorm: t.bboxNorm,
      fontSizeRatio: t.fontSizeRatio
    }))
    .filter((style, i, arr) => arr.findIndex((x) => x.layoutRole === style.layoutRole && x.colorRole === style.colorRole) === i);
  let typoCursor = 0;
  const styledClips: TimelineClip[] = isBeatCut
    ? clips.map((clip) => {
        const clipEnd = clip.startSec + clip.durationSec;
        const beatTimestamps = synthBeat.beats
          .filter((b) => b >= clip.startSec && b < clipEnd)
          .map((b) => Number((b - clip.startSec).toFixed(3)));
        let subtitleText = clip.subtitleText;
        if (!hasCjk(subtitleText)) {
          if (clip.role === "cta") subtitleText = ctaCopy;
          else if (clip.role === "hook") subtitleText = hasCjk(brief.topic) ? brief.topic!.trim() : beatCutCjkFallback.hook;
          else subtitleText = cjkCopyPool.length ? cjkCopyPool[copyCursor++ % cjkCopyPool.length] : beatCutCjkFallback[clip.role];
        }
        // Final guarantee: clean Chinese, single line (drawtext has no auto-wrap). Prefer the
        // curated per-role copy over a verbose/truncated prompt line so each card reads cleanly.
        if (!hasCjk(subtitleText) || (subtitleText && subtitleText.length > 16)) {
          subtitleText = beatCutCjkFallback[clip.role] ?? (hasCjk(subtitleText) ? `${subtitleText!.slice(0, 15)}…` : (productName || "立即了解"));
        }
        // Keep visualIntent clean (no English slot-description leak into explainability text).
        const visualIntent = clip.visualIntent && FORBIDDEN_VISUAL_TEXT.test(clip.visualIntent) ? subtitleText : clip.visualIntent;
        // Never copy sample visuals into a beat-cut clip: if the only source is the sample itself
        // (self-reconstruction), drop it so the renderer draws the style-locked primitive / dynamic
        // proxy instead of cropping sample frames. Real TARGET assets are kept.
        const noSampleCopy = request.constraints?.noSampleVisualCopy ?? true;
        // v1.3 source-first: a genuinely reusable, DISTINCT (non-sample) authorized source keeps its
        // pixels so the renderer composites real footage. Only an evidence-only / mock / learned-from-
        // sample source is dropped (the self-reconstruction case the overfit report flagged).
        const sourceReusable =
          source.reusableAsMaterial === true &&
          source.materialRole === "target_material" &&
          !(template.sourceSampleIds ?? []).includes(source.assetId ?? "");
        const sampleSourced =
          Boolean(clip.sourceAssetId) && clip.sourceAssetId === source.assetId && !sourceReusable;
        const dropSampleVisual = noSampleCopy && sampleSourced;
        // v1.3 evidence+material driven primitive selection (flag-guarded; default keeps the role-only
        // path so golden output is byte-identical). demo:final opts in via recipeEvidencePrimitives.
        const layerAssetId = clip.layers.find((l) => Boolean(l.assetId))?.assetId;
        const hasSourcePixels = !dropSampleVisual && (Boolean(clip.sourceAssetId) || Boolean(layerAssetId));
        let primitive = clip.motionPrimitive ?? "";
        let primitiveReason: string | undefined;
        if (!clip.motionPrimitive) {
          if (request.controls?.recipeEvidencePrimitives === true) {
            const sel = selectPrimitive({ clip, template, hasSourcePixels });
            primitive = sel.primitive;
            primitiveReason = sel.reason;
          } else {
            primitive = beatCutPrimitiveForClip(clip);
          }
        }
        const typoHint = clip.role === "hook"
          ? typoStyles[0]
          : typoStyles.length ? typoStyles[(typoCursor++) % typoStyles.length] : undefined;
        return {
          ...clip,
          ...(dropSampleVisual ? { sourceAssetId: undefined } : {}),
          subtitleText,
          visualIntent,
          transitionIn: clip.startSec === 0 ? "none" : "hard_cut",
          transitionOut: "hard_cut",
          motionPrimitive: primitive,
          ...(primitiveReason ? { primitiveReason } : {}),
          styleTokens: baseStyleTokens,
          beatTimestamps,
          placeholderSpec: undefined,
          layers: attachElementGeometry(
            beatCutLayersForClip(clip, primitive, subtitleText, ctaCopy, clip.role === "hook" ? heroDescriptor : undefined, typoHint, clip.role === "hook" ? heroElement : undefined),
            elementGeometryForClip(clip, template)
          )
        };
      })
    : clips;
  const timelineMotionAtoms = buildMotionAtoms(fillPlan, request, durationSec);
  const recipeMotionAtoms = timelineMotionAtoms.length ? timelineMotionAtoms : (template.motionAtoms ?? []);

  const timeline: Timeline = {
    id: stableId("timeline", generationId, request.prompt),
    projectId: request.projectId,
    generationId,
    durationSec,
    aspectRatio,
    rendererTarget: "html_preview",
    clips: styledClips,
    mapping,
    gapReport: timelineGapReport,
    fillPlan,
    replacementSlots,
    renderPlan: {
      width: aspectRatio === "9:16" ? 720 : 1280,
      height: aspectRatio === "9:16" ? 1280 : 720,
      fps: 30,
      background: isBeatCut ? "#05060a" : renderBackgroundForControls(request.controls),
      motionAtoms: recipeMotionAtoms,
      beatGrid: isBeatCut ? { status: "ok", bpm: synthBeat.bpm, beats: synthBeat.beats, source: "synth_from_bpm" } : undefined,
      audioPolicy,
      audioRef,
      audioPlan: audioPolicy !== "silent"
        ? {
            policy: audioPolicy === "sample_bgm" ? "sample_bgm" : isBeatCut ? "synth_beat_unless_sample_authorized" : "synth_beat",
            bpm: synthBeat.bpm,
            required: true,
            beatGridSec: synthBeat.beats,
            sfx: isBeatCut ? ["kick_on_segment_start", "flash_on_strong_beat", "ticker_clicks"] : ["soft_downbeat", "ambient_riser"],
            // v3: learned layer balance from the sample's audio structure drives the procedural mix.
            layers: learnedAudioLayers,
            strongBeatsSec,
            spectralCentroidMean,
            spectralFlatnessMean
          }
        : undefined,
      rendererBackend: "remotion_mg",
      adapterOptions: {
        pace: request.controls?.pace ?? "fast",
        packagingStyle: request.controls?.packagingStyle ?? "mg_motion",
        hookIntensity: request.controls?.hookIntensity ?? "strong",
        ctaStyle: request.controls?.ctaStyle ?? "direct",
        creativeMode: request.controls?.creativeMode ?? "explainable_demo",
        subtitleDensity: request.controls?.subtitleDensity ?? "dense",
        subtitleGenerationMode: request.controls?.subtitleGenerationMode ?? "prompt_only",
        subtitleStyle: template.packaging.subtitleStyle,
        titleCardStyle: template.packaging.titleCardStyle,
        subtitleStyleSource: "sample_template_packaging",
        stylePreset: request.controls?.stylePreset ?? (request.controls?.creativeMode === "high_fidelity_style" ? "sample_like" : "bold_mg"),
        ctaTiming: request.controls?.ctaTiming ?? "default",
        noSampleVisualCopy: request.constraints?.noSampleVisualCopy ?? true,
        sampleAssetReuse: request.constraints?.sampleAssetReuse ?? "disabled"
      },
      notes: "P0 renderer target is html_preview; FFmpeg/Remotion/HyperFrames available as adapters.",
      // v1.3: renderer-agnostic render contract compiled from the final styled clips.
      renderRecipe: buildRenderRecipe({
        styledClips,
        isBeatCut,
        videoType: template.videoType,
        aspectRatio,
        width: aspectRatio === "9:16" ? 720 : 1280,
        height: aspectRatio === "9:16" ? 1280 : 720,
        durationSec,
        synthBeat,
        audioPolicy,
        background: isBeatCut ? "#05060a" : renderBackgroundForControls(request.controls),
        brief,
        template,
        source,
        request,
        warnings: [],
        motionAtoms: recipeMotionAtoms
      })
    },
    warnings: [
      ...source.warnings,
      ...(request.target.vertical !== "b2b_marketing_mg"
        ? ["Current MVP is optimized for B-end marketing/MG-style outputs; this vertical is best-effort."]
        : [])
    ],
    createdAt: nowIso()
  };

  return { timeline, storyboard };
}

export interface GenerateMigrationInput {
  template: StructureTemplate;
  request: GenerationRequest;
  sourceAsset?: Asset;
  sourceAnalysis?: VideoAnalysisResult;
  sourceVlm?: VLMVideoAnalysis;
  generationIdSalt?: string;
  selectedTemplateReason?: string;
}

export function generateMigrationResult(input: GenerateMigrationInput): GenerationResult {
  const { template, request, sourceAsset, sourceAnalysis, sourceVlm } = input;
  const requestValidation = validateGenerationRequest(request);
  if (!requestValidation.valid) {
    throw new Error(`Invalid generation request: ${requestValidation.errors.join("; ")}`);
  }
  const generationId = input.generationIdSalt
    ? stableId("generation", request.projectId, request.prompt, request.sampleReferenceAssetId, request.selectedTemplateIds, request.controls, request.targetAssets, request.replacementBindings, input.generationIdSalt)
    : stableId("generation", request.projectId, request.prompt, request.sampleReferenceAssetId, request.selectedTemplateIds, request.controls, request.targetAssets, request.replacementBindings);
  const source = understandSourceVideo(sourceAnalysis, sourceAsset, request, sourceVlm);
  const slotMapping = matchSlots(template, source, request);
  const fillPlan = createFillPlan(slotMapping, source, request, template);
  const { timeline, storyboard } = buildTimeline({
    template,
    request,
    source,
    mappings: slotMapping,
    fillPlan,
    generationId
  });
  const timelineValidation = validateTimeline(timeline);
  if (!timelineValidation.valid) {
    throw new Error(`Invalid timeline: ${timelineValidation.errors.join("; ")}`);
  }

  const selectedAtomIds = new Set(request.selectedAtomIds ?? []);
  const selectedAtoms = selectedAtomIds.size > 0
    ? template.structureAtoms.filter((atom) => selectedAtomIds.has(atom.id))
    : template.structureAtoms;
  const providerDecisions = buildDefaultProviderDecisions();
  const modelRouteSummary = buildModelRouteSummary(providerDecisions);
  const routeForGap = (gap: GapReportItem) => {
    const haystack = [gap.gapType, gap.visualFormFamily, gap.visualForm, gap.slotId].join(" ").toLowerCase();
    if (/audio|bgm|music|sound/.test(haystack)) {
      return providerDecisions.find((decision) => decision.task === "music") ?? providerDecisions.find((decision) => decision.task === "sound_effect");
    }
    if (/motion|moving|hero|video|ribbon/.test(haystack)) return providerDecisions.find((decision) => decision.task === "video_fill");
    return providerDecisions.find((decision) => decision.task === "image_fill");
  };
  const rankedRepairOptions = rankGapRepairOptions({
    gapReport: timeline.gapReport,
    providerDecisions,
    versionStrategy: timeline.renderPlan?.renderRecipe?.versionStrategy
  });
  timeline.gapReport = applyRankedRepairOptions(timeline.gapReport, rankedRepairOptions).map((gap) => {
    const providerDecision = routeForGap(gap);
    const providerPromptPlans = providerDecision
      ? [
          compileProviderPromptPlan({
            gap,
            providerDecision,
            productTheme: timeline.renderPlan?.renderRecipe?.productTheme
          })
        ]
      : [];
    return {
      ...gap,
      ...(providerDecision ? { providerDecisions: [providerDecision] } : {}),
      ...(providerPromptPlans.length ? { providerPromptPlans } : {})
    };
  });
  const integratedFillPlan = timeline.fillPlan.map((action) => {
    const gap = timeline.gapReport.find((item) => item.slotId === action.slotId || item.slotId === action.repairSourceGapId);
    const providerDecision = gap ? routeForGap(gap) : undefined;
    const providerPromptPlans = gap?.providerPromptPlans ?? [];
    return {
      ...action,
      ...(providerDecision ? { providerDecision } : {}),
      ...(providerPromptPlans.length ? { providerPromptPlans } : {}),
      rankedRepairOptions: gap?.rankedRepairOptions ?? []
    };
  });
  timeline.fillPlan = integratedFillPlan;
  let recipeLintReport: unknown;
  let videoCriticReport: unknown;
  let structureExplanation: unknown;
  if (timeline.renderPlan?.renderRecipe) {
    timeline.renderPlan.renderRecipe.providerDecisions = providerDecisions;
    timeline.renderPlan.renderRecipe.modelRouteSummary = modelRouteSummary;
    recipeLintReport = lintRenderRecipe(timeline.renderPlan.renderRecipe, { audioStructure: template.audioStructure });
    videoCriticReport = critiqueVideoOffline({
      renderRecipe: timeline.renderPlan.renderRecipe,
      routeSummary: modelRouteSummary
    });
    structureExplanation = generateStructureExplanation({
      evidenceSummary: timeline.renderPlan.renderRecipe.evidenceSummary,
      techniqueAtoms: template.techniqueAtoms,
      gapReport: timeline.gapReport,
      fillPlan: integratedFillPlan,
      renderRecipe: timeline.renderPlan.renderRecipe,
      providerDecisions,
      modelRouteSummary
    });
    timeline.renderPlan.renderRecipe.recipeLintReport = recipeLintReport;
    timeline.renderPlan.renderRecipe.videoCriticReport = videoCriticReport;
    timeline.renderPlan.renderRecipe.structureExplanation = structureExplanation;
  }

  return {
    id: generationId,
    projectId: request.projectId,
    request,
    selectedTemplateIds: request.selectedTemplateIds ?? [template.id],
    selectedTemplateReason:
      input.selectedTemplateReason ??
      `selected template ${template.id}; sampleReferenceAssetId=${request.sampleReferenceAssetId ?? "not provided"}; seed B2B fallback is secondary when learned/current-sample template exists.`,
    selectedAtoms,
    sourceUnderstanding: source,
    slotMapping,
    gapReport: timeline.gapReport,
    fillPlan: integratedFillPlan,
    replacementSlots: timeline.replacementSlots,
    storyboard,
    timeline,
    validation: {
      generationRequest: requestValidation,
      timeline: timelineValidation
    },
    providerDecisions,
    modelRouteSummary,
    recipeLintReport,
    videoCriticReport,
    structureExplanation,
    migrationExplanation: `Transferred ${template.name} into a ${request.target.targetDurationSec}s ${request.target.vertical} reconstruction plan.`,
    warnings: timeline.warnings ?? [],
    createdAt: nowIso()
  };
}

export function validateGeneratedStructure(template: StructureTemplate) {
  return validateStructureTemplate(template);
}

export function validateGeneratedAnalysis(analysis: VideoAnalysisResult) {
  return validateAssetAnalysis(analysis);
}

export const ANALYZER_MODE_DEFAULT: AnalyzerMode = "mock";
