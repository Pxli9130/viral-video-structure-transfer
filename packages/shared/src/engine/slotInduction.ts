import type { VLMVideoAnalysis } from "../adapters.js";
import type {
  AcceptedReplacementAssetType,
  FillStrategy,
  InducedSlotStatus,
  InducedVisualSlot,
  KnowledgeAtom,
  RendererCapability,
  ReplacementVisualForm,
  RequiredSlot,
  SegmentRole,
  SlotModality,
  SlotSourceEvidence,
  SlotType,
  StructureSegment,
  StructureTemplate,
  VideoAnalysisResult,
  VisualFormFamily
} from "../types.js";

const REQUIRED_CONFIDENCE = 0.65;
const SUGGESTED_CONFIDENCE = 0.45;

export const RENDERER_CAPABILITIES: RendererCapability[] = [
  {
    id: "card_stack_motion",
    handles: ["media_cards"],
    requiredAssetTypes: ["image", "image_set"],
    minCount: 3,
    proceduralPossible: false,
    fallbackRenderer: "generic_asset_proxy"
  },
  {
    id: "feature_list_scroller",
    handles: ["ui_showcase"],
    requiredAssetTypes: ["copy_list"],
    minCount: 3,
    proceduralPossible: true,
    fallbackRenderer: "text_card"
  },
  {
    id: "neon_geometry_typography",
    handles: ["geometric_mg"],
    requiredAssetTypes: [],
    minCount: 0,
    proceduralOnly: true,
    proceduralPossible: true,
    fallbackRenderer: "shape_proxy"
  },
  {
    id: "hero_montage_proxy",
    handles: ["live_action_montage"],
    requiredAssetTypes: ["image", "video", "image_set", "video_set"],
    minCount: 2,
    proceduralPossible: false,
    fallbackRenderer: "generic_asset_proxy"
  },
  {
    id: "logo_cta_hold",
    handles: ["brand_cta"],
    requiredAssetTypes: ["logo", "copy"],
    minCount: 1,
    proceduralPossible: true,
    fallbackRenderer: "text_logo_card"
  },
  {
    id: "kinetic_text_card",
    handles: ["kinetic_typography"],
    requiredAssetTypes: ["copy"],
    minCount: 1,
    proceduralPossible: true,
    fallbackRenderer: "text_card"
  },
  {
    id: "rotating_object_proxy",
    handles: ["object_motion"],
    requiredAssetTypes: ["image", "video", "gif", "glb", "lottie"],
    minCount: 1,
    proceduralPossible: false,
    fallbackRenderer: "generic_asset_proxy"
  }
];

export function rendererCapabilitiesForFamily(family: VisualFormFamily): RendererCapability[] {
  return RENDERER_CAPABILITIES.filter((capability) => capability.handles.includes(family));
}

export function primaryRendererCapabilityForFamily(family: VisualFormFamily): RendererCapability | undefined {
  return rendererCapabilitiesForFamily(family)[0];
}

export function inducedSlotStatus(confidence: number): InducedSlotStatus {
  if (confidence >= REQUIRED_CONFIDENCE) return "required";
  if (confidence >= SUGGESTED_CONFIDENCE) return "suggested";
  return "evidence_only";
}

function evidenceTexts(
  analysis: VideoAnalysisResult | undefined,
  template: StructureTemplate | undefined,
  atoms: KnowledgeAtom[],
  vlm?: VLMVideoAnalysis
): string[] {
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
    ...(analysis?.shots ?? []).flatMap((shot) => [shot.notes, ...(shot.tags ?? [])]),
    template?.name,
    template?.videoType,
    template?.visualStyle?.layout,
    template?.visualStyle?.motionAsset,
    template?.packaging.coverStyle,
    template?.packaging.titleCardStyle,
    template?.packaging.overlayStyle,
    template?.qualityRationale,
    ...atoms.flatMap((atom) => [atom.name, atom.description, atom.usageRules, atom.exampleMapping])
  ].filter((value): value is string => Boolean(value && String(value).trim()));
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function confidenceFrom(text: string, strong: RegExp[], weak: RegExp[], requires?: (text: string) => boolean): number {
  if (requires && !requires(text)) return 0;
  const strongHits = countMatches(text, strong);
  const weakHits = countMatches(text, weak);
  if (!strongHits && !weakHits) return 0;
  return Math.min(0.92, 0.4 + strongHits * 0.27 + weakHits * 0.08);
}

function roleForFamily(family: VisualFormFamily, text: string): SegmentRole {
  if (family === "brand_cta") return "cta";
  if (family === "object_motion" || family === "media_cards") return "hook";
  if (family === "live_action_montage" && /(proof|climax|对比|证明|高潮|爆点)/i.test(text)) return "proof";
  if (family === "live_action_montage") return "body";
  return "body";
}

function slotTypeForFamily(family: VisualFormFamily, role: SegmentRole): SlotType {
  if (family === "brand_cta") return "cta_visual";
  if (family === "kinetic_typography") return "title_card";
  if (family === "ui_showcase") return "title_card";
  if (family === "geometric_mg") return "background";
  if (family === "live_action_montage") return role === "proof" ? "comparison" : "usage_scene";
  return "hook_visual";
}

function modalityForFamily(family: VisualFormFamily): SlotModality {
  switch (family) {
    case "media_cards":
      return "image_set";
    case "kinetic_typography":
      return "text";
    case "ui_showcase":
      return "ui_list";
    case "geometric_mg":
      return "shape";
    case "object_motion":
      return "image_or_video_or_3d_model";
    case "live_action_montage":
      return "image_or_video_set";
    case "brand_cta":
      return "logo";
    default:
      return "image";
  }
}

function visualFormForFamily(family: VisualFormFamily): ReplacementVisualForm {
  switch (family) {
    case "media_cards":
      return "stacked_media_cards";
    case "kinetic_typography":
      return "kinetic_text_card";
    case "ui_showcase":
      return "feature_list_ui";
    case "geometric_mg":
      return "neon_geometry_frame";
    case "object_motion":
      return "rotating_3d_object";
    case "live_action_montage":
      return "cinematic_hero_montage";
    case "brand_cta":
      return "logo_hold";
    default:
      return "generic_visual_proxy";
  }
}

function motionForFamily(family: VisualFormFamily): string {
  switch (family) {
    case "media_cards":
      return "cascade_stack_to_grid";
    case "kinetic_typography":
      return "beat_scale_typography";
    case "ui_showcase":
      return "scroll_or_highlight";
    case "geometric_mg":
      return "morph_or_pulse";
    case "object_motion":
      return "spin_orbit_screen_y";
    case "live_action_montage":
      return "beat_cut_zoom_sequence";
    case "brand_cta":
      return "clean_hold";
    default:
      return "generic_proxy_motion";
  }
}

function layoutForFamily(family: VisualFormFamily): string {
  switch (family) {
    case "media_cards":
      return "centered_layered_cards";
    case "kinetic_typography":
      return "centered_bold_text";
    case "ui_showcase":
      return "feature_list_panel";
    case "geometric_mg":
      return "foreground_shape_frame";
    case "object_motion":
      return "center_hero_object";
    case "live_action_montage":
      return "full_screen_montage_grid";
    case "brand_cta":
      return "center_logo_cta_hold";
    default:
      return "center_visual_proxy";
  }
}

function requirementForFamily(family: VisualFormFamily): { required: boolean; type: string; minCount?: number } {
  const capability = primaryRendererCapabilityForFamily(family);
  switch (family) {
    case "media_cards":
      return { required: true, type: "image_set", minCount: capability?.minCount ?? 3 };
    case "live_action_montage":
      return { required: true, type: "image_or_video_set", minCount: capability?.minCount ?? 2 };
    case "brand_cta":
      return { required: true, type: "logo_or_brand_copy", minCount: 1 };
    case "object_motion":
      return { required: true, type: "image_or_video_or_3d_model", minCount: 1 };
    case "ui_showcase":
      return { required: false, type: "copy_list", minCount: 3 };
    case "kinetic_typography":
      return { required: false, type: "copy", minCount: 1 };
    case "geometric_mg":
      return { required: false, type: "none", minCount: 0 };
    default:
      return { required: true, type: "visual_asset", minCount: 1 };
  }
}

export function clickToReplaceForFamily(family: VisualFormFamily): boolean {
  return family === "media_cards" || family === "live_action_montage" || family === "brand_cta" || family === "object_motion";
}

function acceptedAssetTypesForFamily(family: VisualFormFamily): AcceptedReplacementAssetType[] {
  switch (family) {
    case "media_cards":
      return ["image", "video", "gif"];
    case "live_action_montage":
      return ["image", "video", "gif"];
    case "brand_cta":
      return ["logo", "image", "copy"];
    case "object_motion":
      return ["image", "video", "gif", "glb", "lottie"];
    case "ui_showcase":
    case "kinetic_typography":
      return ["copy", "image"];
    default:
      return ["image", "video"];
  }
}

function fallbackStrategiesForFamily(family: VisualFormFamily): FillStrategy[] {
  switch (family) {
    case "media_cards":
      return ["proxy_placeholder", "user_asset_replace", "aigc_placeholder"];
    case "live_action_montage":
      return ["proxy_placeholder", "user_asset_replace", "aigc_placeholder", "text_card"];
    case "brand_cta":
      return ["proxy_placeholder", "user_asset_replace", "packaging_overlay", "text_card"];
    case "object_motion":
      return ["proxy_placeholder", "user_asset_replace", "aigc_placeholder"];
    case "geometric_mg":
      return ["procedural_generation", "packaging_overlay"];
    case "ui_showcase":
      return ["text_card", "packaging_overlay", "procedural_generation"];
    case "kinetic_typography":
      return ["text_card", "packaging_overlay"];
    default:
      return ["proxy_placeholder", "text_card"];
  }
}

function stableSlotId(family: VisualFormFamily, role: SegmentRole, index: number): string {
  if (family === "object_motion" && role === "hook") return "slot_rotating_hero_object_intro";
  if (family === "live_action_montage") return "slot_beat_sync_action_montage";
  return `auto_slot_${role}_${family}_${String(index).padStart(3, "0")}`;
}

function sourceEvidenceForFamily(family: VisualFormFamily, confidence: number, texts: string[]): SlotSourceEvidence {
  const summary = texts.find((text) => text.length > 12) ?? family;
  return {
    confidence,
    frameIds: [],
    textEvidence: texts.slice(0, 4),
    summary
  };
}

type FamilySpec = {
  family: VisualFormFamily;
  strong: RegExp[];
  weak: RegExp[];
  requires?: (text: string) => boolean;
};

const FAMILY_SPECS: FamilySpec[] = [
  {
    family: "media_cards",
    strong: [
      /(?:card stack|stacked (?:media )?cards|cascading cards|cascade(?:d|ing)? card|floating cards)/i,
      /(?:collage|image collage|media formats|rapid collage|多卡片|卡片堆叠|素材卡片|拼贴)/i
    ],
    weak: [/(?:image set|media cards|gallery|asset grid|图片组|素材墙)/i],
    requires: (text) => /(?:card|cards|collage|media formats|gallery|卡片|拼贴|素材)/i.test(text) && !/(?:plain text card|static poster|single card|纯文字卡|静态海报)/i.test(text)
  },
  {
    family: "ui_showcase",
    strong: [/(?:feature list|tool list|ui list|feature_list_scroller|menu highlight|功能列表|工具列表|UI列表)/i],
    weak: [/(?:dashboard|interface|sidebar|control panel|界面|面板|菜单)/i],
    requires: (text) => /(?:feature|tool|ui|interface|dashboard|功能|工具|界面|列表|菜单)/i.test(text)
  },
  {
    family: "geometric_mg",
    strong: [/(?:neon geometry|geometric line|line frame|polygon|shape frame|霓虹几何|几何线框|多边形)/i],
    weak: [/(?:geometry|neon|shape|line art|几何|线条|图形)/i]
  },
  {
    family: "live_action_montage",
    strong: [/(?:beat[-_\s]?sync.*montage|cinematic.*montage|action montage|hero montage|match cut|电影混剪|动作混剪|卡点混剪|匹配剪辑)/i],
    weak: [/(?:montage|cinematic|action clips|movie clips|beat cut|混剪|电影镜头|动作镜头|卡点)/i]
  },
  {
    family: "brand_cta",
    strong: [/(?:logo hold|brand transition|brand reveal|end slate|final logo|cta end slate|品牌标识|品牌转场|结尾标识|收尾品牌)/i],
    weak: [/(?:logo|brand logo|handle reveal|品牌|标识)/i],
    requires: (text) => /(?:logo|brand|end slate|handle reveal|品牌|标识|结尾)/i.test(text) && !/generic b2b promo/i.test(text)
  },
  {
    family: "kinetic_typography",
    strong: [/(?:kinetic typography|split kinetic typography|dynamic text|text[_\s-]*card(?: sequence)?|bold typography|动效字|动态文字|强字幕|文字卡序列)/i],
    weak: [/(?:subtitle|caption|title card|typography|text timing|字幕|标题卡|文案卡)/i]
  },
  {
    family: "object_motion",
    strong: [/(?:rotating (?:3d )?(?:object|logo|head|helmet)|3d logo intro|spin(?:ning)? (?:object|logo)|rotating_3d_object|旋转(?:3D)?(?:物体|头盔|头像|标识|主视觉))/i],
    weak: [/(?:orbit|spin|helmet|head|avatar|hero object|logo intro|三维|头盔|头像|主视觉)/i],
    requires: (text) => /(?:rotat|spin|orbit|3d|helmet|head|avatar|hero object|logo intro|旋转|三维|头盔|头像|主视觉)/i.test(text)
  }
];

export function induceSlotsFromAnalysis(
  analysis: VideoAnalysisResult | undefined,
  template?: StructureTemplate,
  atoms: KnowledgeAtom[] = template?.structureAtoms ?? [],
  vlm?: VLMVideoAnalysis
): InducedVisualSlot[] {
  const texts = evidenceTexts(analysis, template, atoms, vlm);
  const haystack = texts.join(" \n ").toLowerCase();
  const slots: InducedVisualSlot[] = [];
  let counter = 1;

  for (const spec of FAMILY_SPECS) {
    const confidence = confidenceFrom(haystack, spec.strong, spec.weak, spec.requires);
    if (confidence < SUGGESTED_CONFIDENCE) continue;
    const role = roleForFamily(spec.family, haystack);
    const capability = primaryRendererCapabilityForFamily(spec.family);
    const status = inducedSlotStatus(confidence);
    const assetRequirement = requirementForFamily(spec.family);
    const clickToReplace = assetRequirement.required && clickToReplaceForFamily(spec.family);
    slots.push({
      id: stableSlotId(spec.family, role, counter),
      role,
      modality: modalityForFamily(spec.family),
      visualForm: visualFormForFamily(spec.family),
      visualFormFamily: spec.family,
      motionPattern: motionForFamily(spec.family),
      layoutRelation: layoutForFamily(spec.family),
      assetRequirement,
      sourceEvidence: sourceEvidenceForFamily(spec.family, confidence, texts.filter((text) => spec.strong.some((pattern) => pattern.test(text)) || spec.weak.some((pattern) => pattern.test(text)))),
      rendererCandidates: capability ? [capability.id, capability.fallbackRenderer] : ["generic_asset_proxy"],
      fallbackStrategies: fallbackStrategiesForFamily(spec.family),
      replacementPolicy: {
        clickToReplace,
        acceptedAssetTypes: acceptedAssetTypesForFamily(spec.family)
      },
      confidence,
      status
    });
    counter += 1;
  }

  return slots.sort((a, b) => b.confidence - a.confidence);
}

function semanticLabelForFamily(family: VisualFormFamily): string {
  switch (family) {
    case "media_cards":
      return "media_card_stack";
    case "kinetic_typography":
      return "kinetic_text";
    case "ui_showcase":
      return "feature_list_ui";
    case "geometric_mg":
      return "neon_geometry";
    case "object_motion":
      return "unknown_object";
    case "live_action_montage":
      return "action_montage";
    case "brand_cta":
      return "brand_cta";
    default:
      return "visual_slot";
  }
}

export function requiredSlotFromInducedSlot(slot: InducedVisualSlot): RequiredSlot {
  const slotType = slotTypeForFamily(slot.visualFormFamily, slot.role);
  return {
    id: slot.id,
    role: slot.role,
    slotType,
    required: slot.status === "required",
    description: `${slot.visualFormFamily}: ${slot.visualForm} (${slot.motionPattern})`,
    preferredTags: [`${slot.visualFormFamily}_candidate`, `${slot.visualForm}_candidate`],
    fallbackStrategies: slot.fallbackStrategies,
    visualForm: slot.visualForm,
    visualFormFamily: slot.visualFormFamily,
    modality: slot.modality,
    inducedSlotId: slot.id,
    assetRequirement: slot.assetRequirement,
    rendererCandidates: slot.rendererCandidates,
    sourceEvidence: slot.sourceEvidence,
    confidence: slot.confidence,
    semanticLabel: semanticLabelForFamily(slot.visualFormFamily),
    motionSpec:
      slot.visualFormFamily === "object_motion"
        ? { type: "spin", axis: "screen_y", speed: 0.8, preserveFromSlot: true }
        : slot.visualFormFamily === "media_cards"
          ? { type: "cascade", speed: 0.85, preserveFromSlot: true }
          : slot.visualFormFamily === "live_action_montage"
            ? { type: "crop_zoom", speed: 0.95, preserveFromSlot: true }
            : slot.visualFormFamily === "geometric_mg"
              ? { type: "pulse", speed: 0.7, preserveFromSlot: true }
              : { type: "scale", speed: 0.5, preserveFromSlot: true },
    clickToReplace: slot.replacementPolicy.clickToReplace
  };
}

function segmentIdForRole(role: SegmentRole): string {
  if (role === "hook") return "seg_hook";
  if (role === "proof") return "seg_proof";
  if (role === "cta") return "seg_cta";
  return "seg_body";
}

function addSlotToSegment(segments: StructureSegment[], role: SegmentRole, slotId: string): StructureSegment[] {
  const segmentId = segmentIdForRole(role);
  return segments.map((segment) => {
    if (segment.id !== segmentId || segment.slots.includes(slotId)) return segment;
    return { ...segment, slots: [slotId, ...segment.slots] };
  });
}

function coarseSlotOverridden(slot: RequiredSlot, induced: InducedVisualSlot[]): boolean {
  if (!induced.some((item) => item.status === "required")) return false;
  if (slot.slotType === "subtitle_text" || slot.slotType === "title_card") return false;
  return induced.some((item) => {
    if (item.status !== "required") return false;
    if (item.role !== slot.role) return false;
    if (item.visualFormFamily === "media_cards" && slot.slotType === "hook_visual") return true;
    if (item.visualFormFamily === "object_motion" && slot.slotType === "hook_visual") return true;
    if (item.visualFormFamily === "live_action_montage" && (slot.slotType === "usage_scene" || slot.slotType === "comparison" || slot.slotType === "proof_visual")) return true;
    if (item.visualFormFamily === "brand_cta" && slot.slotType === "cta_visual") return true;
    if (item.visualFormFamily === "ui_showcase" && slot.slotType === "usage_scene") return true;
    if (item.visualFormFamily === "geometric_mg" && slot.slotType === "background") return true;
    return false;
  });
}

export function augmentTemplateWithInducedSlots(
  template: StructureTemplate,
  analysis: VideoAnalysisResult,
  vlm?: VLMVideoAnalysis
): StructureTemplate {
  const inducedSlots = induceSlotsFromAnalysis(analysis, template, template.structureAtoms, vlm);
  if (!inducedSlots.length) return { ...template, inducedSlots: [] };

  const requiredInduced = inducedSlots.filter((slot) => slot.status === "required");
  const inducedRequiredSlots = requiredInduced.map(requiredSlotFromInducedSlot);
  const existingIds = new Set(inducedRequiredSlots.map((slot) => slot.id));
  const secondarySlots = template.requiredSlots.filter((slot) => !existingIds.has(slot.id) && !coarseSlotOverridden(slot, inducedSlots));
  let segments = template.segments;
  for (const slot of inducedRequiredSlots) {
    segments = addSlotToSegment(segments, slot.role, slot.id);
  }

  return {
    ...template,
    segments,
    inducedSlots,
    requiredSlots: [...inducedRequiredSlots, ...secondarySlots],
    qualityRationale: `${template.qualityRationale} Open-world induced slots: ${inducedSlots
      .map((slot) => `${slot.visualFormFamily}:${slot.status}:${slot.confidence.toFixed(2)}`)
      .join(", ")}.`
  };
}
