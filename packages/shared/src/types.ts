export type Vertical = "b2b_marketing_mg" | "vlog" | "talking_head" | "beat_cut" | "short_drama" | "ecommerce";
export type AspectRatio = "9:16" | "16:9" | "1:1";
export type AssetRole =
  | "example_video"
  | "source_video"
  | "user_image"
  | "user_text"
  | "generated_card"
  | "generated_background"
  | "render_output";
export type AssetType = "video" | "image" | "text" | "audio" | "output";
export type AssetStatus = "uploaded" | "processing" | "ready" | "failed";
export type SourcePolicy = "user_authorized" | "open_download_or_user_uploaded" | "demo_only" | "unknown";
export type AnalysisPurpose = "sample" | "source";
export type AnalyzerMode = "mock" | "ffmpeg" | "ffmpeg_opencv" | "ffmpeg_vlm_asr";
export type RendererTarget = "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
export type RendererBackend = "remotion_mg" | "ffmpeg_compose" | "image_card" | "aigc_video_fill_stub";
export type CreativeOutputMode = "explainable_demo" | "final_creative" | "high_fidelity_style";
export type TargetAssetKind = "image" | "video" | "logo" | "copy" | "cta_info" | "background_image";
export type AcceptedReplacementAssetType = "image" | "video" | "gif" | "logo" | "copy" | "glb" | "lottie";
export type ReplacementSlotStatus = "missing" | "proxy_generated" | "user_replaced" | "rendered";
export type VisualFormFamily =
  | "media_cards"
  | "kinetic_typography"
  | "ui_showcase"
  | "geometric_mg"
  | "object_motion"
  | "live_action_montage"
  | "brand_cta"
  | "unknown";
export type SlotModality =
  | "text"
  | "copy_list"
  | "image"
  | "image_set"
  | "video_clip"
  | "video_set"
  | "image_or_video_set"
  | "logo"
  | "ui_list"
  | "shape"
  | "audio"
  | "image_or_video_or_3d_model";
export type InducedSlotStatus = "required" | "suggested" | "evidence_only";
export type KnownReplacementVisualForm =
  | "rotating_object"
  | "product_card"
  | "background"
  | "logo"
  | "cta"
  | "text_card"
  | "ribbon_motif"
  | "rotating_3d_object"
  | "kinetic_text_card"
  | "action_montage_sequence"
  | "match_cut_sequence"
  | "stacked_media_cards"
  | "image_collage_grid"
  | "feature_list_ui"
  | "neon_geometry_frame"
  | "cinematic_hero_montage"
  | "logo_hold"
  | "generic_visual_proxy";
export type ReplacementVisualForm = KnownReplacementVisualForm | (string & {});
export type RibbonSurfaceType = "thin_line" | "wide_band" | "textured_band" | "particle_trail";
export type RibbonPathFamily = "vertical_helix" | "planar_orbit" | "diagonal_sweep" | "horizontal_wave" | "spiral_in" | "wave_loop" | "unknown";
export type RibbonAxis = "screen_y" | "screen_z" | "screen_x" | "diagonal" | "unknown";
export type RibbonDepthBehavior = "flat" | "perspective_only" | "front_back_crossing" | "occlusion_with_title";
export type RibbonLayoutRelation = "around_title" | "background_only" | "foreground_sweep" | "border_frame";
export type RibbonTextRelation = "text_on_ribbon" | "near_ribbon" | "none";

export interface RibbonMotionGeometry {
  surfaceType: RibbonSurfaceType;
  pathFamily: RibbonPathFamily;
  axis: RibbonAxis;
  depthBehavior: RibbonDepthBehavior;
  layoutRelation: RibbonLayoutRelation;
  textRelation: RibbonTextRelation;
  confidence?: number;
  evidenceFrames?: number[];
  turns?: number;
  radiusX?: number;
  radiusZ?: number;
  pitchY?: number;
}

export type JobType = "analysis" | "template_extraction" | "generation" | "render" | "export";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export type SegmentRole = "hook" | "setup" | "body" | "proof" | "transition" | "cta";
export type SlotType =
  | "hook_visual"
  | "product_closeup"
  | "usage_scene"
  | "comparison"
  | "proof_visual"
  | "cta_visual"
  | "subtitle_text"
  | "title_card"
  | "transition"
  | "background";

export type AtomCategory =
  | "hook_pattern"
  | "rhythm_pattern"
  | "subtitle_style"
  | "packaging_pattern"
  | "transition_pattern"
  | "cta_pattern"
  | "gap_fill_strategy"
  | "shot_pattern";

export type FillStrategy =
  | "reuse_with_crop_zoom"
  | "text_card"
  | "packaging_overlay"
  | "reorder_structure"
  | "procedural_generation"
  | "aigc_placeholder"
  | "aigc_generated_asset"
  | "proxy_placeholder"
  | "user_asset_replace";

export type AigcMaterialProviderId =
  | "mock_provider"
  | "local_folder_provider"
  | "volcengine_seedream"
  | "ark_seedance_provider_stub"
  | "image_provider"
  | "copy_provider"
  | "none";
export type AigcMaterialAssetType = "image" | "image_set" | "short_video" | "copy" | "logo_placeholder";
export type GeneratedAssetCandidateType = "image" | "video" | "copy";

export interface MotionSpec {
  type: "spin" | "scale" | "crop_zoom" | "ribbon_follow" | "pulse" | "slide" | "cascade" | "none";
  axis?: "x" | "y" | "z" | "screen_x" | "screen_y" | "screen_z";
  speed?: number;
  durationSec?: number;
  easing?: string;
  preserveFromSlot?: boolean;
  [key: string]: unknown;
}

export interface PlaceholderSpec {
  type: "proxy_shape" | "proxy_card" | "aigc_draft" | "procedural_object";
  shape?: "sphere" | "circle" | "cube" | "plane" | "ribbon" | "generic_product" | "helmet_silhouette";
  color?: string;
  label?: string;
  motion?: MotionSpec;
  [key: string]: unknown;
}

export interface SlotReplacementBinding {
  slotId: string;
  assetId: string;
  applyMotionFromSlot?: boolean;
  createdAt?: string;
}

export interface SlotAssetRequirement {
  required: boolean;
  type: string;
  minCount?: number;
  preferredAspect?: string;
}

export interface SlotSourceEvidence {
  timeRange?: [number, number];
  frameIds?: string[];
  framePaths?: string[];
  textEvidence?: string[];
  confidence: number;
  summary?: string;
  signalSource?: string;
  evidenceKinds?: string[];
}

export interface SlotReplacementPolicy {
  clickToReplace: boolean;
  acceptedAssetTypes: AcceptedReplacementAssetType[];
}

export interface RendererCapability {
  id: string;
  handles: VisualFormFamily[];
  requiredAssetTypes: string[];
  minCount?: number;
  proceduralOnly?: boolean;
  proceduralPossible?: boolean;
  fallbackRenderer: string;
}

export interface InducedVisualSlot {
  id: string;
  role: SegmentRole;
  modality: SlotModality;
  visualForm: ReplacementVisualForm;
  visualFormFamily: VisualFormFamily;
  motionPattern: string;
  layoutRelation: string;
  assetRequirement: SlotAssetRequirement;
  sourceEvidence: SlotSourceEvidence;
  rendererCandidates: string[];
  fallbackStrategies: FillStrategy[];
  replacementPolicy: SlotReplacementPolicy;
  confidence: number;
  status: InducedSlotStatus;
}

export interface AigcMaterialFillConfig {
  enabled: boolean;
  provider: AigcMaterialProviderId;
  maxAssetsPerRun: number;
  maxCostUsd?: number;
  allowExternalUpload: boolean;
  allowSampleFramesToProvider: boolean;
  requireUserApprovalBeforeRender: boolean;
  cacheEnabled: boolean;
}

export interface MaterialGenerationBrief {
  id: string;
  projectId: string;
  generationId: string;
  slotId: string;
  visualFormFamily: VisualFormFamily | "poster_layout";
  visualForm: ReplacementVisualForm;
  assetType: AigcMaterialAssetType;
  count: number;
  targetTheme: string;
  targetBrand?: string;
  targetAudience?: string;
  copyContext?: string[];
  promptPack?: string[];
  styleConstraints: {
    aspectRatio: AspectRatio | (string & {});
    palette?: string[];
    colorPalette?: string[];
    mood?: string;
    noTextUnlessRequested: boolean;
    avoidSampleLookalike: true;
  };
  structureConstraints: {
    intendedRendererCapability: string;
    motionPattern: string;
    slotRole: string;
    durationSec?: number;
  };
  negativePrompts: string[];
  evidenceRefs: {
    sampleEvidenceFrameIds: string[];
    note: "sample evidence is for structure only; do not copy visual content";
  };
  privacyPolicy: {
    externalUploadAllowed: boolean;
    sampleFramesAllowedToProvider: boolean;
    targetAssetsAllowedToProvider: boolean;
  };
}

export interface GeneratedAssetQualityResult {
  candidateId: string;
  slotId: string;
  usable: boolean;
  slotFitScore?: number;
  targetThemeFitScore?: number;
  noSampleCopyScore?: number;
  textArtifactRisk?: number;
  deterministicChecks: Array<{ id: string; passed: boolean; value?: unknown }>;
  vlmStatus: "not_configured" | "skipped_infra" | "not_run" | "ok" | "failed";
  issues: string[];
}

export interface GeneratedAssetCandidate {
  id: string;
  briefId: string;
  slotId: string;
  provider: AigcMaterialProviderId;
  model: string;
  type: GeneratedAssetCandidateType;
  materialRole: "aigc_generated_material";
  path: string;
  prompt: string;
  negativePrompt?: string;
  provenance: {
    generatedAt: string;
    userApproved: boolean;
    externalProviderUsed: boolean;
    sampleFramesSentExternally: boolean;
    targetAssetsSentExternally: boolean;
  };
  quality: {
    vlmScore?: number;
    slotFitScore?: number;
    noSampleCopyScore?: number;
    usable?: boolean;
    issues?: string[];
  };
}

export interface ReplacementSlot {
  slotId: string;
  semanticLabel: string;
  visualForm: ReplacementVisualForm;
  visualFormFamily?: VisualFormFamily;
  modality?: SlotModality;
  status: ReplacementSlotStatus;
  placeholderSpec?: PlaceholderSpec;
  acceptedAssetTypes: AcceptedReplacementAssetType[];
  boundAssetId?: string;
  motionSpec?: MotionSpec;
  applyMotionFromSlot?: boolean;
  gapType?: GapCategory;
  rendererBackend?: RendererBackend;
  targetClipId?: string;
}

export type SourceTag =
  | "hook_candidate"
  | "product_like"
  | "usage_scene"
  | "person_scene"
  | "comparison_candidate"
  | "background"
  | "cta_candidate"
  | "text_card_candidate";

export interface Project {
  id: string;
  name: string;
  vertical: Vertical;
  aspectRatio: AspectRatio;
  targetDurationSec: number;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  role: AssetRole;
  type: AssetType;
  filename: string;
  path?: string;
  mimeType?: string;
  sourcePolicy: SourcePolicy;
  text?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  status: AssetStatus;
  createdAt: string;
}

export interface JobStep {
  name: string;
  status: StepStatus;
  message?: string;
}

export interface Job {
  id: string;
  projectId?: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  steps: JobStep[];
  inputSummary?: Record<string, unknown>;
  outputRefs?: Record<string, unknown>;
  error?: { message?: string; details?: unknown };
  createdAt: string;
  updatedAt: string;
}

export interface AssetKeyframe {
  id: string;
  timeSec: number;
  path?: string;
  description?: string;
  tags?: string[];
}

export interface ShotCandidate {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  thumbnailPath?: string;
  tags: string[];
  confidence: number;
  notes?: string;
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

/** A still sampled from the source video, used as concrete evidence for slots/atoms. */
export interface EvidenceFrameRef {
  id: string;
  timeSec: number;
  /** Storage-relative or served path (never an absolute local path in public JSON). */
  path?: string;
  family?: VisualFormFamily | string;
  confidence?: number;
  reason?: string;
  evidenceKinds?: string[];
}

/** Audio beat grid derived deterministically (librosa) from the sample's audio track. */
export interface BeatGrid {
  status: "ok" | "skipped" | "no_audio" | "unavailable";
  bpm?: number;
  /** Beat onset times in seconds. */
  beats: number[];
  /** Strong onset times in seconds (impacts/accents). */
  onsets?: number[];
  source?: string;
}

/** A detected scene cut (PySceneDetect ContentDetector or OpenCV histogram fallback). */
export interface SceneCut {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  detector?: string;
}

/** One shot in the evidence timeline, carrying the perception signals bound to it. */
export interface EvidenceShot {
  shotId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  keyframeIds: string[];
  cutBefore?: boolean;
  cutAfter?: boolean;
  beatAligned?: boolean;
  ocrText?: string[];
  asrText?: string[];
  visualTags: string[];
  styleTags: string[];
  family?: VisualFormFamily | string;
  confidence: number;
  evidencePaths?: string[];
}

export interface VisualEvidenceStats {
  blackBgRatio?: number;
  dominantPalette?: string[];
  textCardDensity?: number;
  /** Cuts per second. */
  cutDensity?: number;
  avgShotDurationSec?: number;
  medianShotDurationSec?: number;
  fastZones?: Array<[number, number]>;
}

/**
 * Deterministic, timestamped evidence the downstream VLM/LLM must cite instead of
 * hallucinating. Produced by scripts/analyze-visual-evidence.py + analyze-audio-beats.py.
 */
export interface VisualEvidenceTimeline {
  schemaVersion: "visual-evidence-timeline-v1";
  sourceAssetId?: string;
  durationSec: number;
  hasAudio: boolean;
  shots: EvidenceShot[];
  sceneCuts: SceneCut[];
  beatGrid: BeatGrid;
  evidenceFrames: EvidenceFrameRef[];
  contactSheetPath?: string;
  stats: VisualEvidenceStats;
  ocrStatus: "ok" | "skipped" | "unavailable";
  asrStatus: "ok" | "skipped" | "unavailable";
  analyzerMode: string;
  warnings: string[];
}

export interface VideoAnalysisResult {
  id: string;
  assetId: string;
  projectId: string;
  purpose: AnalysisPurpose;
  metadata: {
    durationSec: number;
    width?: number;
    height?: number;
    fps?: number;
    hasAudio?: boolean;
    codec?: string;
  };
  keyframes: AssetKeyframe[];
  shots: ShotCandidate[];
  transcript?: TranscriptSegment[];
  ocr?: Array<Record<string, unknown>>;
  /** Evidence-first timeline (scene cuts + beat grid + frame-bound shots). */
  evidenceTimeline?: VisualEvidenceTimeline;
  warnings: string[];
  analyzerMode: AnalyzerMode;
  createdAt: string;
  primaryMotif?: {
    motif: string;
    confidence: number;
    evidence?: Record<string, unknown>;
  };
  motifCandidates?: Array<{
    motif: string;
    confidence: number;
    evidence?: Record<string, unknown>;
  }>;
  motionGeometry?: {
    ribbonMotion?: RibbonMotionGeometry;
  };
}

export interface RequiredSlot {
  id: string;
  role: SegmentRole;
  slotType: SlotType;
  required: boolean;
  description: string;
  preferredTags?: string[];
  fallbackStrategies?: FillStrategy[];
  visualForm?: ReplacementVisualForm;
  visualFormFamily?: VisualFormFamily;
  modality?: SlotModality;
  inducedSlotId?: string;
  assetRequirement?: SlotAssetRequirement;
  rendererCandidates?: string[];
  sourceEvidence?: SlotSourceEvidence;
  confidence?: number;
  semanticLabel?: string;
  motionSpec?: MotionSpec;
  clickToReplace?: boolean;
}

export interface StructureSegment {
  id: string;
  role: SegmentRole;
  startRatio: number;
  endRatio: number;
  intent: string;
  scriptPattern?: string;
  slots: string[];
  recommendedDurationSec?: number;
}

export interface KnowledgeAtom {
  id: string;
  projectId: string;
  templateId: string;
  role: SegmentRole;
  category: AtomCategory;
  name: string;
  description: string;
  applicableVerticals: string[];
  usageRules: string;
  exampleMapping?: string;
  confidence?: number;
}

export interface EditingTechnique {
  id: string;
  name: string;
  category: string;
  description: string;
  usageRules?: string;
}

export interface ReplacementPolicy {
  doNotCopySampleVisuals?: boolean;
  allowedTransfer?: string[];
  forbiddenTransfer?: string[];
}

export interface SourcePolicyBlock {
  sampleSource: SourcePolicy;
  commercialUse: boolean;
  notes?: string;
}

export interface RhythmSpec {
  pace: "slow" | "medium" | "fast" | "mixed";
  averageShotDurationSec: number;
  peakTimeRatio?: number;
  /** Detected musical tempo (librosa) when the sample has an audio beat. */
  bpm?: number;
  beatCount?: number;
  notes?: string;
}

export interface PackagingSpec {
  subtitleStyle?: string;
  titleCardStyle?: string;
  overlayStyle?: string;
  transitionStyle?: string;
  coverStyle?: string;
}

export interface VisualStyleSpec {
  background?: string;
  layout?: string;
  motionAsset?: string;
  colorProgression?: string[];
  typography?: string;
  ribbonMotion?: RibbonMotionGeometry;
}

export interface ExcludeSegment {
  startSec: number;
  endSec: number;
  reason: string;
}

export interface StructureTemplate {
  id: string;
  projectId: string;
  name: string;
  vertical: Vertical;
  sourceSampleIds: string[];
  videoType?: string;
  visualStyle?: VisualStyleSpec;
  excludeSegments?: ExcludeSegment[];
  targetDurationSec?: number;
  segments: StructureSegment[];
  requiredSlots: RequiredSlot[];
  inducedSlots?: InducedVisualSlot[];
  rhythm: RhythmSpec;
  packaging: PackagingSpec;
  structureAtoms: KnowledgeAtom[];
  editingTechniques: EditingTechnique[];
  replacementPolicy: ReplacementPolicy;
  qualityRationale: string;
  /** Whether AI (VLM/LLM) enrichment succeeded; "failed" must surface, never masquerade as a clean fallback. */
  aiEnrichmentStatus?: "ok" | "failed" | "skipped";
  aiEnrichmentError?: string;
  sourcePolicy: SourcePolicyBlock;
  createdAt: string;
  updatedAt?: string;
}

export interface TemplateRecord {
  id: string;
  projectId: string;
  sourceAssetId: string;
  name: string;
  vertical: Vertical;
  template: StructureTemplate;
  createdAt: string;
  updatedAt: string;
}

export interface ExampleAnalysis {
  id: string;
  projectId: string;
  assetId: string;
  purpose: AnalysisPurpose;
  video: VideoAnalysisResult;
  template?: StructureTemplate;
  vlm?: import("./adapters.js").VLMVideoAnalysis;
  createdAt: string;
}

export interface GenerationRequestSourceVideo {
  assetId: string;
  analysisId?: string;
}

export interface GenerationRequestAsset {
  assetId: string;
  role?: string;
}

export interface TargetAssetInput {
  id: string;
  kind: TargetAssetKind;
  role?: string;
  path?: string;
  url?: string;
  text?: string;
  filename?: string;
  mimeType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface GenerationTarget {
  vertical: Vertical;
  aspectRatio: AspectRatio;
  targetDurationSec: number;
  outputMode: "storyboard_preview" | "mp4_render" | "timeline_only";
}

export interface GenerationControls {
  pace?: "slow" | "medium" | "fast";
  hookIntensity?: "safe" | "strong" | "aggressive";
  packagingStyle?: "clean" | "bold" | "mg_motion";
  ctaStyle?: "soft" | "direct";
  allowAigcPlaceholder?: boolean;
  allowAigcMaterialGeneration?: boolean;
  allowExternalAigcProvider?: boolean;
  creativeMode?: CreativeOutputMode;
  subtitleGenerationMode?: "off" | "prompt_only" | "ark_doubao";
  subtitleDensity?: "minimal" | "medium" | "dense";
  stylePreset?: "sample_like" | "clean_premium" | "white_poster" | "bold_mg";
  ctaTiming?: "early" | "default" | "late";
  ribbon?: Partial<RibbonMotionGeometry> & {
    speedMultiplier?: number;
    densityMultiplier?: number;
    premiumFinish?: boolean;
  };
}

export interface GenerationConstraints {
  forbiddenWords?: string[];
  mustMention?: string[];
  noSampleVisualCopy?: boolean;
  sampleAssetReuse?: "disabled" | "authorized";
}

export interface GenerationRequest {
  projectId: string;
  inputMode: "video_plus_prompt" | "brief_assets" | "prompt_only";
  sourceVideo?: GenerationRequestSourceVideo;
  sampleReferenceAssetId?: string;
  selectedTemplateIds?: string[];
  selectedAtomIds?: string[];
  assets?: GenerationRequestAsset[];
  targetAssets?: TargetAssetInput[];
  replacementBindings?: SlotReplacementBinding[];
  prompt: string;
  target: GenerationTarget;
  controls?: GenerationControls;
  constraints?: GenerationConstraints;
}

export interface SourceVideoUnderstanding {
  assetId?: string;
  analysisId?: string;
  summary: string;
  candidates: ShotCandidate[];
  warnings: string[];
  transcript?: TranscriptSegment[];
  ocrText?: string[];
  materialRole?: "target_material" | "sample_reference" | "mock" | "unusable";
  renderable?: boolean;
  sourcePolicy?: SourcePolicy;
  reusableAsMaterial?: boolean;
  materialBlockReason?: string;
  blockedCandidateShotIds?: string[];
}

export type SlotMatchStatus = "matched" | "weak_match" | "missing";

export interface SlotMapping {
  slotId: string;
  slotRole: SegmentRole;
  slotType: SlotType;
  status: SlotMatchStatus;
  candidateShotIds: string[];
  selectedShotId?: string;
  selectedAssetId?: string;
  selectedTargetAssetId?: string;
  selectedTargetAssetIds?: string[];
  selectedTargetAssetKind?: TargetAssetKind;
  targetAssetCandidateIds?: string[];
  assetAvailability?: "target_asset_mapped" | "target_asset_weak_match" | "no_user_asset_available" | "source_video_mapped";
  missingCount?: number;
  visualForm?: ReplacementVisualForm;
  visualFormFamily?: VisualFormFamily;
  modality?: SlotModality;
  inducedSlotId?: string;
  assetRequirement?: SlotAssetRequirement;
  rendererCandidates?: string[];
  sourceEvidence?: SlotSourceEvidence;
  semanticLabel?: string;
  motionSpec?: MotionSpec;
  clickToReplace?: boolean;
  confidence: number;
  reason: string;
  risks: string[];
}

export type GapCategory =
  | "hook_visual_missing"
  | "product_closeup_missing"
  | "usage_scene_missing"
  | "comparison_missing"
  | "cta_visual_missing"
  | "subtitle_text_missing"
  | "title_card_missing"
  | "transition_missing"
  | "background_missing"
  | "voiceover_or_script_missing"
  | "subtitle_density_low"
  | "dynamic_3d_ribbon_asset"
  | "rotating_hero_object_missing"
  | "action_montage_missing"
  | "match_cut_sequence_missing"
  | "media_cards_missing"
  | "ui_showcase_missing"
  | "geometric_mg_missing"
  | "brand_cta_missing"
  | "induced_visual_slot_missing";

export interface GapReportItem {
  slotId: string;
  status: SlotMatchStatus;
  severity: "low" | "medium" | "high";
  reason: string;
  impact: string;
  missingCount?: number;
  gapType?: GapCategory;
  gapLabel?: string;
  gapLabelZh?: string;
  recommendedFillStrategies?: FillStrategy[];
  placeholderSpec?: PlaceholderSpec;
  acceptedAssetTypes?: AcceptedReplacementAssetType[];
  clickToReplace?: boolean;
  replacementSlotId?: string;
  slotType?: SlotType;
  slotRole?: SegmentRole;
  visualForm?: ReplacementVisualForm;
  visualFormFamily?: VisualFormFamily;
  modality?: SlotModality;
  inducedSlotId?: string;
  rendererCandidates?: string[];
  sourceEvidence?: SlotSourceEvidence;
  assetRequirement?: SlotAssetRequirement;
  assetAvailability?: SlotMapping["assetAvailability"];
  mappedAssetId?: string;
  fillSource?: "target_asset" | "source_video" | "procedural_generation" | "text_or_copy" | "proxy_placeholder" | "user_asset" | "none";
  fulfilledByBackend?: RendererBackend;
}

export interface RendererInstruction {
  renderer?: RendererBackend;
  fallbackRenderer?: RendererBackend;
  atom?: MotionAtomSpec["type"] | string;
  strategy?: FillStrategy;
  requiredInputs?: string[];
  fulfilledBy?: "target_asset" | "source_video" | "procedural_generation" | "aigc_stub" | "aigc_generated_material" | "text_or_copy" | "proxy_placeholder" | "user_asset";
  ribbonMotion?: RibbonMotionGeometry;
  placeholderSpec?: PlaceholderSpec;
  replacementSlotId?: string;
  boundAssetId?: string;
  replacementAssetKind?: TargetAssetKind;
  motionSpec?: MotionSpec;
  applyMotionFromSlot?: boolean;
  [key: string]: unknown;
}

export interface FillAction {
  slotId: string;
  strategy: FillStrategy;
  reason: string;
  targetClipId: string;
  rendererInstructions?: RendererInstruction;
  capabilityId?: string;
  backend?: RendererBackend;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  visualFormFamily?: VisualFormFamily;
  selectedStrategy?: FillStrategy;
  fulfilledBy?: RendererInstruction["fulfilledBy"];
}

export interface StoryboardItem {
  clipId: string;
  timeRange: string;
  shotDescription: string;
  subtitle: string;
  assetUsage: string;
  packaging: string;
  rationale?: string;
}

export type TimelineClipType = "video" | "image" | "text_card" | "generated_card" | "placeholder";
export type LayerKind = "base_visual" | "subtitle" | "title_bar" | "sticker" | "arrow" | "highlight" | "background" | "audio";

export interface TimelineLayer {
  id: string;
  kind: LayerKind;
  text?: string;
  style?: Record<string, unknown>;
  timing?: Record<string, unknown>;
  assetId?: string;
  sourceShotId?: string;
}

export interface TimelineClip {
  id: string;
  role: SegmentRole;
  startSec: number;
  durationSec: number;
  type: TimelineClipType;
  sourceAssetId?: string;
  sourceShotId?: string;
  visualIntent?: string;
  scriptText?: string;
  subtitleText?: string;
  transitionIn?: string;
  transitionOut?: string;
  layers: TimelineLayer[];
  replacementSlotId?: string;
  placeholderSpec?: PlaceholderSpec;
  gapFillStrategy?: "none" | FillStrategy;
  previewFrame?: string;
  sourceEvidenceFrame?: string;
  visualFormFamily?: VisualFormFamily;
  /** Beat onset times (sec, relative to this clip's start) for beat-synced motion/cuts. */
  beatTimestamps?: number[];
  /** Sample-derived style tokens the renderer executes (e.g. dark_bg, bold_center_cn, red_emphasis, hard_cut). */
  styleTokens?: string[];
  /** Named beat-cut style primitive the renderer should draw (beat_text_card, neon_hero_intro, action_montage, tutorial_rule_card, motivation_cta). */
  motionPrimitive?: string;
}

export interface TimelineMappingItem {
  templateSegmentId: string;
  atomIds: string[];
  targetClipIds: string[];
  explanation: string;
}

export interface MotionAtomSpec {
  type:
    | "ribbon_orbit"
    | "3d_ribbon_orbit"
    | "wide_3d_ribbon_surface"
    | "ribbon_surface_3d"
    | "true_3d_ribbon_mesh"
    | "ribbon_mesh_3d"
    | "parametric_ribbon_surface";
  fulfilledBy: "procedural_generation";
  keywords: string[];
  colorProgression: string[];
  style: "mg_motion" | "clean_premium";
  density: number;
  speed: number;
  opacity: number;
  bandWidth?: number;
  edgeWidth?: number;
  gradientStops?: string[];
  frontLayerCount?: number;
  backLayerCount?: number;
  textOnRibbon?: boolean;
  depthLayering?: boolean;
  twistIntensity?: number;
  perspectiveStrength?: number;
  specularHighlight?: boolean;
  shadowOpacity?: number;
  climaxBuild?: boolean;
  surfaceType?: RibbonSurfaceType;
  pathFamily?: RibbonPathFamily;
  axis?: RibbonAxis;
  depthBehavior?: RibbonDepthBehavior;
  layoutRelation?: RibbonLayoutRelation;
  textRelation?: RibbonTextRelation;
  confidence?: number;
  evidenceFrames?: number[];
  turns?: number;
  radiusX?: number;
  radiusZ?: number;
  pitchY?: number;
  startSec: number;
  endSec: number;
}

export interface RenderPlan {
  width?: number;
  height?: number;
  fps?: number;
  background?: string;
  motionAtoms?: MotionAtomSpec[];
  notes?: string;
  rendererTarget?: RendererTarget;
  rendererBackend?: RendererBackend;
  /** Beat grid driving beat-synced cuts/pulses across the timeline. */
  beatGrid?: BeatGrid;
  /** sample_bgm = carry authorized sample audio; synth_beat = generated click track; silent = no audio. */
  audioPolicy?: "sample_bgm" | "synth_beat" | "silent";
  /** Resolved audio source (asset id / managed ref / storage path) honoring audioPolicy + sample reuse rules. */
  audioRef?: string;
  adapterOptions?: Record<string, unknown>;
}

export type EditOperationType =
  | "change_output_mode"
  | "remove_debug_labels"
  | "adjust_ribbon"
  | "adjust_cta_timing"
  | "change_style_preset"
  | "reduce_subtitle_density";

export interface EditOperation {
  type: EditOperationType;
  value?: string | number | boolean | Record<string, unknown>;
  reason: string;
}

export interface NaturalLanguageEditPlan {
  instruction: string;
  operations: EditOperation[];
  patchedControls: Partial<GenerationControls>;
  promptAddendum?: string;
  summary: string;
}

export interface Timeline {
  id: string;
  projectId: string;
  generationId: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  rendererTarget: RendererTarget;
  clips: TimelineClip[];
  mapping: TimelineMappingItem[];
  gapReport: GapReportItem[];
  fillPlan: FillAction[];
  replacementSlots?: ReplacementSlot[];
  renderPlan?: RenderPlan;
  warnings?: string[];
  createdAt: string;
}

export interface GenerationResult {
  id: string;
  projectId: string;
  request: GenerationRequest;
  selectedTemplateIds: string[];
  selectedTemplateReason?: string;
  selectedAtoms: KnowledgeAtom[];
  sourceUnderstanding: SourceVideoUnderstanding;
  slotMapping: SlotMapping[];
  gapReport: GapReportItem[];
  fillPlan: FillAction[];
  replacementSlots?: ReplacementSlot[];
  storyboard: StoryboardItem[];
  timeline: Timeline;
  validation: {
    generationRequest: ValidationResult;
    timeline: ValidationResult;
  };
  migrationExplanation: string;
  warnings: string[];
  aigcMaterialFill?: {
    enabled: boolean;
    provider: AigcMaterialProviderId;
    requestedProvider?: AigcMaterialProviderId;
    providerFallbackReason?: string;
    providerErrors?: string[];
    externalProviderUsed: boolean;
    sampleFramesSentExternally: boolean;
    briefs: MaterialGenerationBrief[];
    candidates: GeneratedAssetCandidate[];
    quality: GeneratedAssetQualityResult[];
    generatedTargetAssets: TargetAssetInput[];
  };
  createdAt: string;
}

export interface RenderClipPreviewFrame {
  clipId: string;
  /** Public path (served under /generated) of a still extracted from the rendered clip. */
  previewFrame: string;
}

export interface RenderOutput {
  renderId: string;
  generationId: string;
  rendererTarget: RendererTarget;
  status: JobStatus;
  outputPath?: string;
  previewHtml?: string;
  /** Real stills sampled from the rendered timeline, one per clip, keyed by clip id. */
  clipPreviewFrames?: RenderClipPreviewFrame[];
  /** Quality signals: no_audio, placeholder_detected, fallback_template, no_source_clips, weak_style_transfer. */
  renderQualityWarnings?: string[];
  error?: string;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
