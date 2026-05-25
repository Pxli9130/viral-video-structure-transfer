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
  GapReportItem,
  GenerationRequest,
  GenerationResult,
  KnowledgeAtom,
  MotionAtomSpec,
  PackagingSpec,
  RequiredSlot,
  RibbonMotionGeometry,
  RhythmSpec,
  SegmentRole,
  ShotCandidate,
  SlotMapping,
  SlotType,
  SourcePolicyBlock,
  SourceVideoUnderstanding,
  StoryboardItem,
  StructureSegment,
  StructureTemplate,
  TargetAssetInput,
  TargetAssetKind,
  Timeline,
  TimelineClip,
  TimelineClipType,
  TimelineLayer,
  TimelineMappingItem,
  TranscriptSegment,
  VisualStyleSpec,
  VideoAnalysisResult,
  Vertical
} from "../types.js";
import {
  validateAssetAnalysis,
  validateGenerationRequest,
  validateStructureTemplate,
  validateTimeline
} from "../validation.js";

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

function buildRhythm(durationSec: number, vlm?: VLMVideoAnalysis): RhythmSpec {
  const avg = vlm?.rhythm?.avgShotLength ?? round(durationSec / 5);
  const peakRatio = vlm?.rhythm?.peakTimeRatio ?? 0.7;
  const beatNotes = [
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
  if (/motion|mg|poster|ribbon|title card|动态海报|海报|彩带/.test(haystack)) return "motion_graphic_marketing_poster";
  if (/talking|口播|person|face/.test(haystack)) return "talking_head";
  if (/vlog/.test(haystack)) return "vlog";
  return vertical;
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

function nameFromVlm(vlm: VLMVideoAnalysis | undefined, fallback: string): string {
  if (!vlm) return fallback;
  const seed = vlm.structure?.hook || vlm.videoSummary;
  if (!seed) return fallback;
  return `Learned MG Structure · ${shortLabel(seed, 80)}`;
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

export function buildFallbackTemplate(
  analysis: VideoAnalysisResult,
  vertical: Vertical = "b2b_marketing_mg",
  projectId?: string,
  vlm?: VLMVideoAnalysis
): StructureTemplate {
  const durationSec = analysis.metadata.durationSec;
  const excludeSegments = excludeSegmentsFromVlm(vlm, durationSec);
  const templateId = stableId("template", analysis.assetId, durationSec, vertical);
  const owningProject = projectId ?? analysis.projectId;
  const createdAt = nowIso();
  const defaultName = "B2B MG Promo Structure: Hook Body Proof CTA";
  return {
    id: templateId,
    projectId: owningProject,
    name: nameFromVlm(vlm, defaultName),
    vertical,
    sourceSampleIds: [analysis.assetId],
    videoType: videoTypeFromVlm(vlm, vertical),
    visualStyle: visualStyleFromVlm(vlm, analysis),
    excludeSegments,
    targetDurationSec: transferableDurationSec(durationSec, excludeSegments),
    segments: buildSegments(vlm),
    requiredSlots: buildRequiredSlots(),
    rhythm: buildRhythm(durationSec, vlm),
    packaging: buildPackaging(vlm),
    structureAtoms: buildStructureAtoms(templateId, owningProject, vertical, vlm),
    editingTechniques: buildEditingTechniques(),
    replacementPolicy: {
      doNotCopySampleVisuals: true,
      allowedTransfer: ["structure", "rhythm", "packaging", "subtitle_style", "cta_pattern"],
      forbiddenTransfer: ["original_video_frames", "original_audio", "original_voiceover", "person_likeness"]
    },
    qualityRationale: qualityRationaleFromVlm(vlm),
    sourcePolicy: buildSourcePolicy(),
    createdAt,
    updatedAt: createdAt
  };
}

export interface ParsedBrief {
  topic: string;
  productName: string;
  targetAudience: string;
  sellingPoints: string[];
  tone: string;
  cta: string;
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
  const topic = matchLine("主题|topic") ?? matchLine("商品|产品|product") ?? matchLooseProduct() ?? "B2B marketing promo";
  return {
    topic,
    productName: matchLine("商品|产品|product") ?? matchLine("主题|topic") ?? matchLooseProduct() ?? "Demo product",
    targetAudience: matchLine("目标用户|audience|target") ?? "business users",
    sellingPoints: sellingPoints.length ? sellingPoints : ["clear value", "easy to understand", "mobile-friendly"],
    tone: matchLine("风格|style|tone") ?? "fast MG promo",
    cta: matchLine("CTA|引导|结尾") ?? "Click to learn more",
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

export function understandSourceVideo(
  analysis: VideoAnalysisResult | undefined,
  sourceAsset: Asset | undefined,
  request: GenerationRequest,
  vlm?: VLMVideoAnalysis
): SourceVideoUnderstanding {
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
      ocrText: []
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
      ...(vlm?.materialGapsForNewVideo?.length ? [`VLM flagged gaps: ${vlm.materialGapsForNewVideo.join(", ")}`] : [])
    ],
    transcript,
    ocrText
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
    background: "background"
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
    background: ["background_image", "image", "video"]
  };
  return map[slotType];
}

function targetAssetScore(asset: TargetAssetInput, slotType: SlotType): number {
  const kinds = targetAssetKindsForSlot(slotType);
  let score = kinds.includes(asset.kind) ? 0.64 : 0.22;
  const haystack = [asset.role, asset.filename, asset.text, ...(asset.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
  if (/hook|开头|首屏/.test(haystack) && slotType === "hook_visual") score += 0.24;
  if (/product|feature|商品|产品|卖点|功能/.test(haystack) && slotType === "product_closeup") score += 0.22;
  if (/usage|scene|context|场景|使用/.test(haystack) && slotType === "usage_scene") score += 0.22;
  if (/compare|proof|case|对比|证明|案例/.test(haystack) && (slotType === "comparison" || slotType === "proof_visual")) score += 0.22;
  if (/cta|action|logo|brand|引导|行动|结尾|品牌/.test(haystack) && slotType === "cta_visual") score += 0.22;
  if (/copy|title|headline|text|文案|标题/.test(haystack) && (slotType === "subtitle_text" || slotType === "title_card")) score += 0.2;
  return clamp(score, 0, 0.96);
}

function bestTargetAssetForSlot(slotType: SlotType, assets: TargetAssetInput[]): { asset: TargetAssetInput; score: number } | undefined {
  const candidates = assets
    .map((asset) => ({ asset, score: targetAssetScore(asset, slotType) }))
    .filter((candidate) => candidate.score >= 0.38)
    .sort((a, b) => b.score - a.score);
  return candidates[0];
}

function overlapsExcludeSegment(shot: ShotCandidate, segment: NonNullable<StructureTemplate["excludeSegments"]>[number]): boolean {
  return shot.endSec > segment.startSec && shot.startSec < segment.endSec;
}

function isExcludedSampleShot(template: StructureTemplate, source: SourceVideoUnderstanding, shot: ShotCandidate, request: GenerationRequest): boolean {
  if (!source.assetId || !template.sourceSampleIds.includes(source.assetId)) return false;
  if (request.constraints?.sampleAssetReuse !== "authorized") return true;
  return (template.excludeSegments ?? []).some((segment) => overlapsExcludeSegment(shot, segment));
}

export function matchSlots(
  template: StructureTemplate,
  source: SourceVideoUnderstanding,
  request: GenerationRequest
): SlotMapping[] {
  const targetAssets = targetAssetsForRequest(request);
  return template.requiredSlots.map((slot) => {
    const preferred = preferredTagForSlot(slot.slotType);
    const targetAssetCandidates = targetAssets
      .filter((asset) => targetAssetScore(asset, slot.slotType) >= 0.38)
      .sort((a, b) => targetAssetScore(b, slot.slotType) - targetAssetScore(a, slot.slotType));
    const bestTargetAsset = bestTargetAssetForSlot(slot.slotType, targetAssets);
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
        confidence: bestTargetAsset.score,
        reason: `Mapped ${slot.slotType} to target ${bestTargetAsset.asset.kind} asset ${bestTargetAsset.asset.id}.`,
        risks: bestTargetAsset.asset.path || bestTargetAsset.asset.url || bestTargetAsset.asset.text ? [] : ["Target asset has metadata only; renderer may need a fallback."]
      };
    }
    const candidateShots = source.candidates.filter((shot) => shot.tags.includes(preferred) && !isExcludedSampleShot(template, source, shot, request));
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
      candidateShotIds: [],
      targetAssetCandidateIds: [],
      assetAvailability: "no_user_asset_available",
      confidence: 0,
      reason: `No source candidate with tag ${preferred} for ${slot.slotType}.`,
      risks: ["Required slot missing; fill plan must supply replacement."]
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
  }
};

export interface GapReportContext {
  source?: SourceVideoUnderstanding;
  template?: StructureTemplate;
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
      const meta = SLOT_GAP_LABELS[mapping.slotType] ?? null;
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
        recommendedFillStrategies: meta?.strategies,
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
      recommendedFillStrategies: ["procedural_generation"],
      assetAvailability: "no_user_asset_available",
      fillSource: "procedural_generation",
      fulfilledByBackend: "remotion_mg"
    });
  }

  return slotGaps;
}


interface StrategyContext {
  mapping: SlotMapping;
  hasReusableVisual: boolean;
  request: GenerationRequest;
  segmentMatchedSiblings: SlotMapping[];
  totalUnmatchedInSegment: number;
}

function chooseStrategy(ctx: StrategyContext): FillStrategy {
  const allowAigc = ctx.request.controls?.allowAigcPlaceholder ?? true;
  const allowReorder = ctx.mapping.status !== "matched" && ctx.segmentMatchedSiblings.length > 0;
  const slotType = ctx.mapping.slotType;
  if ((slotType === "subtitle_text" || slotType === "title_card" || slotType === "background" || slotType === "transition") && allowReorder) {
    return "reorder_structure";
  }
  if ((slotType === "hook_visual" || slotType === "product_closeup") && ctx.hasReusableVisual) return "reuse_with_crop_zoom";
  if (slotType === "usage_scene" && ctx.hasReusableVisual) return "reuse_with_crop_zoom";
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
  const hasReusableVisual = source.candidates.length > 0;
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
      const strategy = chooseStrategy({
        mapping,
        hasReusableVisual,
        request,
        segmentMatchedSiblings: matchedSiblings,
        totalUnmatchedInSegment: unmatchedInSegment
      });
      const targetClipId = stableId("clip", request.projectId, mapping.slotId, strategy);
      const mergeIntoClipId = strategy === "reorder_structure" ? matchedSiblings[0]?.slotId : undefined;
      const action: FillAction = {
        slotId: mapping.slotId,
        strategy,
        reason:
          strategy === "reuse_with_crop_zoom"
            ? "Reuse the strongest available source shot with crop/zoom and benefit overlay."
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
          strategy === "text_card"
            ? { renderer: "image_card", fallbackRenderer: "remotion_mg", strategy, fulfilledBy: "text_or_copy", requiredInputs: ["prompt_copy"], text: `${brief.productName}: ${brief.sellingPoints[0] ?? brief.topic}`, layout: "centered" }
            : strategy === "packaging_overlay"
              ? { renderer: "remotion_mg", fallbackRenderer: "image_card", strategy, fulfilledBy: "text_or_copy", requiredInputs: ["copy", "logo_or_cta_optional"], headline: brief.cta, sticker: "benefit_badge" }
                : strategy === "reuse_with_crop_zoom"
                  ? { renderer: "ffmpeg_compose", fallbackRenderer: "remotion_mg", strategy, fulfilledBy: "source_video", requiredInputs: ["source_clip_or_target_asset"], motion: "crop_zoom", fit: "cover" }
                : strategy === "procedural_generation"
                  ? { renderer: "remotion_mg", fallbackRenderer: "ffmpeg_compose", strategy, atom: ribbonAtom, fulfilledBy: "procedural_generation", requiredInputs: ["template_motion_geometry"], ribbonMotion }
                : strategy === "aigc_placeholder"
                  ? { renderer: "aigc_video_fill_stub", fallbackRenderer: "image_card", strategy, fulfilledBy: "aigc_stub", requiredInputs: ["prompt", "slot_intent"], aigcPrompt: `Clean vertical MG background for ${brief.productName}` }
                  : { renderer: "remotion_mg", fallbackRenderer: "image_card", strategy, fulfilledBy: "text_or_copy", requiredInputs: ["matched_sibling_slot"], mergeIntoSlotId: mergeIntoClipId, note: "Merge this slot's copy into adjacent matched sibling at render time." }
      };
      return action;
    });

  if (!hasRibbonOrbitMotif(template)) return slotFillPlan;
  return [
    ...slotFillPlan,
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

function subtitleForSlot(slotType: SlotType, brief: ParsedBrief, request: GenerationRequest): string {
  if (isFinalCreativeMode(request)) return polishedPosterCopy(slotType, brief);
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

export interface BuildTimelineInput {
  template: StructureTemplate;
  request: GenerationRequest;
  source: SourceVideoUnderstanding;
  mappings: SlotMapping[];
  fillPlan: FillAction[];
  generationId: string;
}

export function buildTimeline(input: BuildTimelineInput): { timeline: Timeline; storyboard: StoryboardItem[] } {
  const { template, request, source, mappings, fillPlan, generationId } = input;
  const totalSec = request.target.targetDurationSec;
  const brief = parsePromptToBrief(request);
  const clips: TimelineClip[] = [];
  const storyboard: StoryboardItem[] = [];
  const mapping: TimelineMappingItem[] = [];

  let cursor = 0;
  for (const segment of template.segments) {
    const segmentDuration = Math.max(0.6, round((segment.endRatio - segment.startRatio) * totalSec));
    const slotIds = segment.slots.filter((slotId) => template.requiredSlots.some((slot) => slot.id === slotId));
    const slotsForSegment = slotsForPace(slotIds.length > 0 ? slotIds : segment.slots, template, request.controls);
    const perSlotDuration = round(segmentDuration / Math.max(slotsForSegment.length, 1));
    const segmentClipIds: string[] = [];

    for (const slotId of slotsForSegment) {
      const slot = template.requiredSlots.find((item) => item.id === slotId);
      const mappingForSlot = mappings.find((item) => item.slotId === slotId);
      const fillForSlot = fillPlan.find((item) => item.slotId === slotId);
      const matched = mappingForSlot?.status === "matched";
      const strategy: "none" | FillStrategy = matched ? "none" : (fillForSlot?.strategy ?? "text_card");
      const clipId = matched
        ? stableId("clip", generationId, slotId)
        : fillForSlot?.targetClipId ?? stableId("clip", generationId, slotId, "fill");
      const slotType: SlotType = slot?.slotType ?? "background";
      const subtitle = subtitleForSlot(slotType, brief, request);
      const durationSec = perSlotDuration;
      const role = segment.role;
      const targetAssetId = mappingForSlot?.selectedTargetAssetId;
      const sourceAssetId = matched ? (targetAssetId ?? source.assetId) : undefined;
      const sourceShotId = matched ? mappingForSlot?.selectedShotId : undefined;
      const clipType: TimelineClipType = matched
        ? mappingForSlot?.selectedTargetAssetKind === "image" || mappingForSlot?.selectedTargetAssetKind === "logo" || mappingForSlot?.selectedTargetAssetKind === "background_image"
          ? "image"
          : mappingForSlot?.selectedTargetAssetKind === "copy" || mappingForSlot?.selectedTargetAssetKind === "cta_info"
            ? "text_card"
            : "video"
        : clipTypeForFill(fillForSlot?.strategy);

      const layers: TimelineLayer[] = [
        {
          id: stableId("layer_bg", clipId),
          kind: "background",
          style: { color: renderBackgroundForControls(request.controls), assetAvailability: mappingForSlot?.assetAvailability }
        }
      ];
      if (matched && sourceAssetId) {
        layers.push({
          id: stableId("layer_visual", clipId, sourceAssetId),
          kind: "base_visual",
          assetId: sourceAssetId,
          sourceShotId,
          timing: { fit: "cover", motion: "crop_zoom", targetAssetKind: mappingForSlot?.selectedTargetAssetKind }
        });
      } else {
        layers.push({
          id: stableId("layer_card", clipId, subtitle),
          kind: strategy === "packaging_overlay" ? "title_bar" : "base_visual",
          text: subtitle,
          style: { card: template.packaging.titleCardStyle, role, strategy }
        });
      }
      layers.push({
        id: stableId("layer_subtitle", clipId, subtitle),
        kind: "subtitle",
        text: subtitle,
        style: { position: "lower_third", density: request.controls?.subtitleDensity ?? "high" }
      });
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
        subtitleText: subtitle,
        transitionIn: cursor === 0 ? "none" : "hard_cut",
        transitionOut: "hard_cut",
        layers,
        gapFillStrategy: strategy
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

  const timeline: Timeline = {
    id: stableId("timeline", generationId, request.prompt),
    projectId: request.projectId,
    generationId,
    durationSec,
    aspectRatio,
    rendererTarget: "html_preview",
    clips,
    mapping,
      gapReport: generateGapReport(mappings, { source, template }),
      fillPlan,
      renderPlan: {
      width: aspectRatio === "9:16" ? 720 : 1280,
        height: aspectRatio === "9:16" ? 1280 : 720,
        fps: 30,
        background: renderBackgroundForControls(request.controls),
        motionAtoms: buildMotionAtoms(fillPlan, request, durationSec),
        rendererBackend: "remotion_mg",
        adapterOptions: {
        pace: request.controls?.pace ?? "fast",
        packagingStyle: request.controls?.packagingStyle ?? "mg_motion",
        hookIntensity: request.controls?.hookIntensity ?? "strong",
        ctaStyle: request.controls?.ctaStyle ?? "direct",
        creativeMode: request.controls?.creativeMode ?? "explainable_demo",
        subtitleDensity: request.controls?.subtitleDensity ?? "dense",
        stylePreset: request.controls?.stylePreset ?? (request.controls?.creativeMode === "high_fidelity_style" ? "sample_like" : "bold_mg"),
        ctaTiming: request.controls?.ctaTiming ?? "default",
        noSampleVisualCopy: request.constraints?.noSampleVisualCopy ?? true,
        sampleAssetReuse: request.constraints?.sampleAssetReuse ?? "disabled"
      },
      notes: "P0 renderer target is html_preview; FFmpeg/Remotion/HyperFrames available as adapters."
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
}

export function generateMigrationResult(input: GenerateMigrationInput): GenerationResult {
  const { template, request, sourceAsset, sourceAnalysis, sourceVlm } = input;
  const requestValidation = validateGenerationRequest(request);
  if (!requestValidation.valid) {
    throw new Error(`Invalid generation request: ${requestValidation.errors.join("; ")}`);
  }
  const generationId = input.generationIdSalt
    ? stableId("generation", request.projectId, request.prompt, request.selectedTemplateIds, request.controls, input.generationIdSalt)
    : stableId("generation", request.projectId, request.prompt, request.selectedTemplateIds, request.controls);
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

  return {
    id: generationId,
    projectId: request.projectId,
    request,
    selectedTemplateIds: request.selectedTemplateIds ?? [template.id],
    selectedAtoms,
    sourceUnderstanding: source,
    slotMapping,
    gapReport: timeline.gapReport,
    fillPlan,
    storyboard,
    timeline,
    validation: {
      generationRequest: requestValidation,
      timeline: timelineValidation
    },
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
