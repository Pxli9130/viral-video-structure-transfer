import type { ModelRouteSummary, ProviderDecision } from "./model-router/types.js";
// Type-only imports (erased at compile time) — no runtime dependency / cycle / fs pull.
import type { MotifFamily } from "./engine/creativeEffectSpec.js";
import type { EffectSelectionResult } from "./engine/effectRegistry.js";

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
export type RendererTarget = "html_preview" | "ffmpeg" | "remotion" | "remotion_recipe" | "hyperframes";
export type RendererBackend = "remotion_mg" | "remotion_recipe_compose" | "ffmpeg_compose" | "image_card" | "aigc_video_fill_stub";
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
  | "background"
  | "storyboard"
  | "audio"
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

export type SegmentRole = "hook" | "setup" | "body" | "proof" | "transition" | "cta" | "global";
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
  | "background"
  | "audio";

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
  | "user_asset_replace"
  // v2 beat-cut moving-material fallback ladder
  | "aigc_generated_material"
  | "prompt_copy"
  | "target_source_clips_by_motion"
  | "procedural_dynamic_proxy";

export type GapRepairStrategy =
  | "structure_reorder"
  | "text_fill"
  | "packaging_fill"
  | "aigc_fill"
  | "asset_reuse"
  | "procedural_motion";

export type AigcMaterialProviderId =
  | "deterministic_local_image_fill"
  | "mock_provider"
  | "google_gemini_image"
  | "local_folder_provider"
  | "volcengine_seedream"
  | "seedance_2_0"
  | "ark_seedance_provider_stub"
  | "happyhorse_r2v"
  | "image_provider"
  | "copy_provider"
  | "none";
export type AigcMaterialAssetType = "image" | "image_set" | "short_video" | "copy" | "logo_placeholder";
export type GeneratedAssetCandidateType = "image" | "video" | "copy";

export type AssetProfileKind = "image" | "video" | "text" | "audio" | "generated";

export interface AssetProfile {
  id: string;
  kind: AssetProfileKind;
  role?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  hasAudio?: boolean;
  provenance: "user_uploaded" | "source_video" | "aigc_generated_material" | "procedural" | "fixture" | "unknown";
  renderable: boolean;
  policy?: {
    sampleFrameCopyAllowed?: boolean;
    sampleAudioCopyAllowed?: boolean;
    externalProviderAllowed?: boolean;
  };
  notes?: string[];
}

export type TechniqueAtomCategory =
  | "typography"
  | "motion_atom"
  | "media_layout"
  | "source_montage"
  | "poster_layout"
  | "transition"
  | "cta"
  | "audio"
  | "comparison"
  | "object_reveal"
  | "pricing";

export interface TechniqueAtom {
  id: string;
  name:
    | "KineticTypographySweep"
    | "ParametricRibbonSurface"
    | "MediaCardCascade"
    | "ProductPosterHero"
    | "SourceClipBeatMontage"
    | "FeatureCardStack"
    | "ImpactFlash"
    | "CTAEndSlate"
    | "PriceBadgePulse"
    | "LightLeakTransition"
    | "ObjectTrackReveal"
    | "SplitScreenCompare"
    | (string & {});
  category: TechniqueAtomCategory;
  sourceSampleId: string;
  sourceEvidenceRefs: string[];
  visualPattern: string;
  timingPattern: string;
  requiredAssets: AssetProfileKind[];
  renderer: {
    preferred: RendererBackend;
    component: RenderRecipePrimitive | string;
  };
  fallbackComponent?: RenderRecipePrimitive | string;
  transferRules: string[];
  qualityHints: string[];
  confidence: number;
  fallbackReason?: string;
}

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

export type OptionalProviderId =
  | "seedance_2_0"
  | "seedream_4_0"
  | "google_gemini_tts"
  | "google_lyria_music"
  | "local_remotion_procedural"
  | "local_ffmpeg_procedural"
  | "local_faster_whisper"
  | "local_read_only_report";

export type ProviderTask =
  | "video_generation"
  | "image_generation"
  | "speech_to_text"
  | "text_to_speech"
  | "sound_effects"
  | "music_generation"
  | "audio_isolation"
  | "forced_alignment"
  | "model_discovery"
  | "voice_discovery"
  | "procedural_motion"
  | "procedural_audio";

export interface ProviderPolicy {
  id: OptionalProviderId;
  displayName: string;
  tasks: ProviderTask[];
  optional: true;
  envVars: string[];
  mayReceiveSampleFrames: false;
  mayReceiveSampleAudio: false;
  mayReceiveUserAssets: boolean;
  generatedProvenance: "aigc_generated_material" | "processed_user_audio" | "read_only_report" | "procedural";
  fallbackProviderId: OptionalProviderId;
  fallbackReason: string;
}

export interface ProviderRoute {
  task: ProviderTask;
  requestedProviderId?: OptionalProviderId;
  selectedProviderId: OptionalProviderId;
  available: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  policy: ProviderPolicy;
}

export interface ProviderCallRecord {
  providerId: OptionalProviderId;
  task: ProviderTask;
  selectedAt: string;
  available: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  sampleFramesSentExternally: false;
  sampleAudioSentExternally: false;
  userAssetsSentExternally: boolean;
  provenance: "aigc_generated_material" | "processed_user_audio" | "read_only_report" | "procedural";
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

/** A multi-family confidence score for a shot/evidence window (v2). */
export interface EvidenceFamilyScore {
  family: VisualFormFamily | string;
  confidence: number;
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
  /** v2: optical-flow mean magnitude for this shot (0..1+), motion-blindness fix. */
  motionEnergy?: number;
  /** v2: all families scoring above threshold, not only the argmax `family`. */
  evidenceFamilies?: EvidenceFamilyScore[];
  confidence: number;
  evidencePaths?: string[];
}

/** v2: a candidate moving foreground region detected by optical flow. */
export interface MovingObjectCandidate {
  startSec: number;
  endSec: number;
  confidence: number;
  /** Normalized [x, y, w, h] of the dominant moving region (0..1). */
  region?: [number, number, number, number];
  motionEnergy?: number;
}

/** v2: per-frame metrics sampled over N frames; the single source of truth the gate reuses on the render. */
export interface FrameMetricSample {
  timeSec: number;
  blackBgRatio: number;
  redYellowRatio: number;
  motionDiffMean: number;
  cutLikeCount: number;
}

/** v2: high-level style fingerprint + transfer policy derived from evidence. */
export interface DetectedStyle {
  videoType?: string;
  bpm?: number;
  blackBgRatioApprox?: number;
  mustTransfer?: string[];
  mustNotCopy?: string[];
}

/** v3: the opening moving hero object (head/helmet/mask) so the renderer can draw a real silhouette. */
export interface HeroObjectDescriptor {
  objectType: string;
  objectDescriptor: string;
  dominantPosition?: string;
  palette?: string[];
  motionPattern?: string;
  motionEnergy?: number;
  timeRangeSec?: [number, number];
  evidenceFrameIds?: string[];
  confidence?: number;
}

/** v3 VisualElementGraph: a located visual element (CV/flow/OCR find it; the VLM only labels it). */
export interface VisualElementNode {
  id: string;
  family: string;
  timeRangeSec: [number, number];
  bboxTrackNorm?: Array<{ t: number; bbox: [number, number, number, number] }>;
  pointTracks?: Array<{ t: number; points: Array<[number, number]> }>;
  centerTrajectory?: Array<[number, number]>;
  areaRatioCurve?: number[];
  orientationCurve?: number[] | null;
  motionPattern?: string;
  sizeClass?: string;
  positionClass?: string;
  appearance?: Record<string, unknown>;
  text?: Record<string, unknown>;
  evidence?: { frameIds?: Array<string | undefined>; detector?: string; confidence?: number };
  providerSource?: string;
}

export interface VisualElementShotNode {
  shotId: string;
  startSec: number;
  endSec: number;
  role?: string;
  cutTypeIn?: string;
  cutTypeOut?: string;
  dominantElements?: string[];
  motionClass?: string;
  cameraMotion?: string;
  textDensity?: string;
  beatSync?: { cutOnBeat?: boolean; nearestBeatDeltaMs?: number };
  rendererRole?: string;
}

export interface VisualElementGraph {
  schemaVersion: string;
  fpsSampled?: number;
  elementCount?: number;
  heavyTracker?: string;
  elements: VisualElementNode[];
  shots?: VisualElementShotNode[];
  globalStyle?: Record<string, unknown>;
}

/** v3: one on-screen text region's layout/colour/animation, so the renderer can vary typography. */
export interface TypographyEvidenceItem {
  textLayerId: string;
  timeSec: number;
  shotId?: string;
  text?: string;
  bboxNorm: [number, number, number, number];
  layoutRole: string;
  colorRole: string;
  fontSizeRatio: number;
  animationHint: string;
  beatAligned?: boolean;
  confidence?: number;
  providerSource?: string;
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
  /** v2 aggregate frame metrics (means over the sampled frames). */
  redYellowRatio?: number;
  motionDiffMean?: number;
  cutLikeCount?: number;
  sampledFrames?: number;
}

/**
 * Deterministic, timestamped evidence the downstream VLM/LLM must cite instead of
 * hallucinating. Produced by scripts/analyze-visual-evidence.py + analyze-audio-beats.py.
 */
export interface VisualEvidenceTimeline {
  schemaVersion: "visual-evidence-timeline-v1" | "visual-evidence-timeline-v2";
  sourceAssetId?: string;
  sourceAssetFilename?: string;
  durationSec: number;
  hasAudio: boolean;
  shots: EvidenceShot[];
  sceneCuts: SceneCut[];
  beatGrid: BeatGrid;
  evidenceFrames: EvidenceFrameRef[];
  contactSheetPath?: string;
  stats: VisualEvidenceStats;
  /** v2: 60-frame metric samples; the gate recomputes the same shape on the render to compare. */
  frameMetrics?: FrameMetricSample[];
  /** v2: moving foreground regions (optical flow) used to ground moving-material slots. */
  movingObjectCandidates?: MovingObjectCandidate[];
  /** v2: rolled-up family→confidence over the whole sample (the 6-family summary). */
  evidenceFamilies?: EvidenceFamilyScore[];
  /** v2: style fingerprint + transfer policy. */
  detectedStyle?: DetectedStyle;
  /** v3: opening hero-object (head/mask) descriptor. */
  heroDescriptor?: HeroObjectDescriptor;
  /** v3: per-region typography layout/colour/animation evidence. */
  typographyEvidence?: TypographyEvidenceItem[];
  /** v3: element-level evidence graph (located elements + shot nodes). */
  visualElementGraph?: VisualElementGraph;
  /** v3: audio structure (spectral richness + coarse layer estimate) beyond beat ticks. */
  audioStructure?: Record<string, unknown>;
  /** v4.1: explicit motion atoms detected from the sample evidence. */
  motionAtoms?: MotionAtomSpec[];
  ocrStatus: "ok" | "skipped" | "unavailable";
  asrStatus: "ok" | "skipped" | "unavailable";
  analyzerMode: string;
  warnings: string[];
}

export interface VideoAnalysisResult {
  id: string;
  assetId: string;
  /** Original uploaded sample filename (e.g. "editing.mov"), threaded for human-readable naming. */
  sourceFilename?: string;
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
  providerDecisions?: ProviderDecision[];
  modelRouteSummary?: ModelRouteSummary;
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
  /** Original sample filename surfaced in the template name (e.g. "editing.mov"). */
  sourceAssetFilename?: string;
  videoType?: string;
  visualStyle?: VisualStyleSpec;
  /** v1.4: real per-sample dominant colors (hex) from evidenceTimeline.stats.dominantPalette, used
   * to lead the render palette so different samples render with their own color identity. */
  dominantHexPalette?: string[];
  /** v3: learned opening hero-object (head/mask) descriptor for the style-locked renderer. */
  heroDescriptor?: HeroObjectDescriptor;
  /** v3: learned typography layout/colour/animation evidence. */
  typographyEvidence?: TypographyEvidenceItem[];
  /** v3: located element graph (hero/text/bg/impact/cta tracks) for the renderer. */
  visualElementGraph?: VisualElementGraph;
  /** v3: learned audio structure (spectral richness + coarse layer balance) for procedural BGM. */
  audioStructure?: Record<string, unknown>;
  /** v4.1: sample-derived procedural motion atoms such as parametric ribbons. */
  motionAtoms?: MotionAtomSpec[];
  /** v4.1 PR2: evidence-derived reusable visual/audio/renderer techniques. */
  techniqueAtoms?: TechniqueAtom[];
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
  providerDecisionRefs?: string[];
  modelRouteSummary?: ModelRouteSummary;
  buildEvidenceSource?: "deterministic_evidence" | "vlm" | "fallback";
  sourcePolicy: SourcePolicyBlock;
  createdAt: string;
  updatedAt?: string;
}

export interface TemplateRecord {
  id: string;
  projectId: string;
  sourceAssetId: string;
  /** Original sample filename for KB display (e.g. "editing.mov"). */
  sourceAssetFilename?: string;
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
  subtitleGenerationMode?: "off" | "prompt_only" | "ark_doubao" | "auto" | "llm";
  subtitleDensity?: "minimal" | "medium" | "dense";
  stylePreset?: "sample_like" | "clean_premium" | "white_poster" | "bold_mg";
  ctaTiming?: "early" | "default" | "late";
  /** v1.3: opt in to evidence+material driven primitive selection (used by demo:final). Default OFF
   *  keeps the role-only beat-cut selection so golden output stays byte-identical. */
  recipeEvidencePrimitives?: boolean;
  /** v1.3: opt in to SAMPLE-ADAPTIVE timeline structure — clip count + durations derived from the
   *  sample's real shot signature (visualElementGraph shots + BPM) instead of a fixed segment mold.
   *  Default OFF keeps the fixed beat-cut structure (goldens byte-identical). */
  recipeAdaptiveStructure?: boolean;
  /** v1.4: opt in to creative-effect selection on the RenderRecipe (motif → effect program). Default
   *  OFF keeps old recipes unchanged. May also be enabled via ENABLE_CREATIVE_EFFECTS=1. */
  enableCreativeEffects?: boolean;
  /** v1.4: prefer a validated generated effect over the built-in (else PREFER_GENERATED_EFFECTS=1). */
  preferGeneratedEffects?: boolean;
  /** v1.4: fail (no legacy fallback) when no motif-specific effect exists (else STRICT_EFFECT_COVERAGE=1). */
  strictEffectCoverage?: boolean;
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
  | "opening_hook_visual_missing"
  | "hook_visual_missing"
  | "product_closeup_missing"
  | "use_case_video_missing"
  | "usage_scene_missing"
  | "comparison_missing"
  | "source_moving_material_missing"
  | "cta_visual_missing"
  | "logo_missing"
  | "text_selling_points_missing"
  | "motion_atom_renderer_missing"
  | "audio_layer_missing"
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
  | "induced_visual_slot_missing"
  // v2 beat-cut honest gaps
  | "moving_material_missing"
  | "bgm_missing";

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
  repairOptions?: GapRepairOption[];
  selectedRepair?: GapRepairOption;
  rankedRepairOptions?: unknown[];
  providerDecisions?: ProviderDecision[];
  providerPromptPlans?: unknown[];
  expectedVisualResult?: string;
}

export interface GapRepairOption {
  strategy: GapRepairStrategy;
  label: string;
  renderer?: RendererBackend;
  requiredInputs: string[];
  risk: "low" | "medium" | "high";
  preservesStructure: boolean;
  reason: string;
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
  providerDecision?: ProviderDecision;
  providerPromptPlans?: unknown[];
  rankedRepairOptions?: unknown[];
  visualFormFamily?: VisualFormFamily;
  selectedStrategy?: FillStrategy;
  fulfilledBy?: RendererInstruction["fulfilledBy"];
  repairSourceGapId?: string;
  expectedVisualResult?: string;
}

export interface FillPlan {
  actions: FillAction[];
  source: "planner" | "repair_options";
  createdAt?: string;
  notes?: string[];
}

export type VersionStrategy = "high_click" | "high_conversion" | "high_quality";

export interface VersionDiffItem {
  dimension:
    | "hook_duration"
    | "text_density"
    | "cta_placement"
    | "motion_intensity"
    | "audio_density"
    | "selling_point_order"
    | "packaging_style";
  before: unknown;
  after: unknown;
  reason: string;
}

export interface VersionDiff {
  strategy: VersionStrategy;
  summary: string;
  changedDimensions: VersionDiffItem[];
}

export interface RecipePatchOperation {
  op: "add" | "remove" | "replace" | "move" | "scale";
  path: string;
  value?: unknown;
  from?: string;
  reason: string;
}

export interface NaturalLanguageRecipePatch {
  command: string;
  summary: string;
  operations: RecipePatchOperation[];
  updatedRecipe: RenderRecipe;
  renderNeeded: boolean;
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
export type LayerKind =
  | "base_visual"
  | "subtitle"
  | "title_bar"
  | "sticker"
  | "arrow"
  | "highlight"
  | "background"
  | "audio"
  // v2 beat-cut layered-clip kinds
  | "moving_material"
  | "moving_video"
  | "ticker"
  | "beat_bars"
  | "text"
  | "text_overlay"
  | "transition";

export interface TimelineLayer {
  id: string;
  kind: LayerKind;
  text?: string;
  style?: Record<string, unknown>;
  timing?: Record<string, unknown>;
  assetId?: string;
  sourceShotId?: string;
  /** v2: which required slot this layer realizes (e.g. slot_dark_background). */
  slotId?: string;
  /** v2: motion verb for the layer (e.g. "rotate_y+orbit+beat_scale", "hard-cut / crop-zoom"). */
  motion?: string;
  /** v2: asset sourcing policy for moving layers (e.g. "target clips or generated/procedural proxy; never sample frames"). */
  assetPolicy?: string;
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
  /** v1.3: human-auditable reason the primitive was selected (set when evidence-driven selection is on). */
  primitiveReason?: string;
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
  /** v2: first-class BGM/beat plan; beat grid + policy + scheduled sfx drive beat-aligned cuts. */
  audioPlan?: {
    policy: "synth_beat_unless_sample_authorized" | "sample_bgm" | "synth_beat" | "user_bgm" | "silent";
    bpm?: number;
    required?: boolean;
    beatGridSec?: number[];
    sfx?: string[];
    /** v3: learned layer balance (bass_kick / music_harmonic / hats_air) the BGM renderer mixes by. */
    layers?: Record<string, number>;
    /** v3: strong beat timestamps copied from evidence for procedural impacts. */
    strongBeatsSec?: number[];
    spectralCentroidMean?: number;
    spectralFlatnessMean?: number;
  };
  adapterOptions?: Record<string, unknown>;
  /** v1.3: renderer-agnostic render contract — see RenderRecipe and spec_v3/schemas/render-recipe.schema.json. */
  renderRecipe?: RenderRecipe;
}

export type RenderRecipePrimitive =
  | "SourceClipBeatMontage"
  | "ProductHeroOrbit"
  | "FanHeroSpin"
  | "ProductPosterHero"
  | "FeatureCardStack"
  | "MediaCardCascade"
  | "KineticTypographySweep"
  | "ParametricRibbonSurface"
  | "TypographyLayoutSequence"
  | "ImpactFlash"
  | "PriceBadgePulse"
  | "LightLeakTransition"
  | "ObjectTrackReveal"
  | "SplitScreenCompare"
  | "CTAEndSlate"
  | "DynamicProxyMontage";

export type RenderRecipeFamily =
  | "source_video_montage"
  | "product_hero"
  | "media_cards"
  | "kinetic_typography"
  | "feature_list"
  | "impact_fx"
  | "brand_cta"
  | "procedural_proxy";

export interface RenderRecipeClip {
  /** v4.1 compatibility id; equals clipId for migrated legacy clips. */
  id?: string;
  clipId: string;
  role: "hook" | "setup" | "body" | "proof" | "transition" | "cta";
  startSec: number;
  endSec: number;
  /** v4.1 compatibility duration; computed from endSec - startSec. */
  durationSec?: number;
  atomIds?: string[];
  layerIds?: string[];
  evidenceRefs?: string[];
  slotId: string;
  visualFormFamily: RenderRecipeFamily;
  selectedPrimitive: RenderRecipePrimitive;
  /** Human-auditable reason the primitive was selected from evidence + material (never role alone). */
  primitiveReason: string;
  rendererTarget: "remotion_recipe" | "ffmpeg" | "hyperframes_recipe";
  material: {
    kind: "source_video" | "target_image" | "target_image_set" | "generated_target_asset" | "procedural" | "none";
    assetIds: string[];
    sourceShotIds?: string[];
    policy: "renderable" | "evidence_only" | "missing";
    provenance?: "user_uploaded" | "aigc_generated" | "source_video" | "fixture";
  };
  layout: {
    positionClass?: string;
    bboxTrackNorm?: unknown[];
    bboxNorm?: BBoxNormObject;
    mediaBBoxNorm?: BBoxNormObject;
    typographyLayout?: "center_title" | "lower_third" | "diagonal_tag" | "keyword_scatter" | "top_tag";
  };
  motion: {
    pattern: "orbit" | "spin" | "zoom_pulse" | "hard_cut" | "shake" | "pan" | "card_stack" | "none";
    beatAligned: boolean;
    beatTimestampsSec: number[];
    trajectory?: unknown[];
  };
  text: {
    copy: string;
    colorRoles: string[];
    animationHint: "per_char_reveal" | "shake" | "scale" | "flash" | "none";
    fontSizeRatio?: number;
  };
}

export interface BBoxNormObject {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RenderRecipeLayer =
  | RenderRecipeMediaLayer
  | RenderRecipeTextLayer
  | RenderRecipeMotionAtomLayer
  | RenderRecipeAudioLayer
  | RenderRecipeShapeLayer
  | RenderRecipeTransitionLayer;

export interface RenderRecipeBaseLayer {
  id: string;
  type: "media" | "text" | "motion_atom" | "audio" | "shape" | "transition";
  clipId?: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  evidenceRefs: string[];
  fallbackReason?: string;
}

export interface RenderRecipeMediaLayer extends RenderRecipeBaseLayer {
  type: "media";
  material: {
    kind: "source_video" | "target_image" | "target_image_set" | "generated_target_asset" | "procedural";
    assetIds: string[];
    sourceShotIds?: string[];
    policy: "renderable" | "missing" | "evidence_only";
    provenance: "user_uploaded" | "aigc_generated" | "source_video" | "fixture";
  };
  layout: {
    bboxNorm?: BBoxNormObject;
    fit: "cover" | "contain" | "heroFill" | "cardInset" | "backgroundFill";
    minAreaRatio?: number;
    safeArea?: "full" | "title" | "body" | "cta";
  };
  motion?: {
    pattern: "static" | "zoom" | "pan" | "orbit" | "spin" | "card_stack" | "hard_cut";
    beatAligned?: boolean;
    beatTimestampsSec?: number[];
    keyframes?: Array<{ t: number; x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }>;
  };
}

export interface RenderRecipeTextLayer extends RenderRecipeBaseLayer {
  type: "text";
  text: {
    content: string;
    role: "headline" | "subtitle" | "badge" | "selling_point" | "cta" | "price";
    maxChars?: number;
  };
  layout: {
    bboxNorm: BBoxNormObject;
    align: "left" | "center" | "right";
    anchor?: "center" | "top-left" | "bottom-center";
  };
  typography: {
    fontSizeRatio: number;
    weight?: number;
    colorRole?: "primary" | "accent" | "on_dark" | "muted";
    color?: string;
    stroke?: { color: string; widthRatio: number };
    shadow?: { color: string; blurRatio: number; dxRatio: number; dyRatio: number };
    background?: { color: string; radiusRatio: number; paddingRatio: number };
  };
  animation: {
    enter?: "pop" | "scale" | "slide_left" | "slide_right" | "sweep" | "typewriter" | "none";
    exit?: "fade" | "slide" | "none";
    beatReactive?: { property: "scale" | "opacity" | "x" | "y" | "rotation"; amplitude: number; beatRefs: number[] };
  };
}

export interface RenderRecipeMotionAtomLayer extends RenderRecipeBaseLayer {
  type: "motion_atom";
  atom:
    | {
        kind: "parametric_ribbon_surface";
        direction: "right_to_left" | "left_to_right";
        path: "s_curve_orbit" | "diagonal_sweep" | "horizontal_wave";
        thicknessRatio: number;
        twist: number;
        opacity: number;
        colorRoles: string[];
      }
    | {
        kind: "text_sweep_mask";
        targetTextLayerId: string;
        direction: "right_to_left" | "left_to_right";
        widthRatio: number;
        softnessRatio: number;
      }
    | { kind: "impact_flash"; intensity: number; beatRefs: number[] }
    | { kind: "light_sweep"; direction: "diagonal" | "horizontal" | "vertical"; opacity: number };
  fallback?: { renderer: "ffmpeg" | "remotion"; mode: "2d_svg" | "simple_overlay" | "skip"; reason: string };
}

export interface RenderRecipeAudioLayer extends RenderRecipeBaseLayer {
  type: "audio";
  audio: {
    kind: "kick" | "bass" | "hat" | "drone" | "riser" | "impact" | "voice" | "music";
    policy: "procedural" | "user_audio" | "licensed" | "missing";
    weight: number;
    bpm?: number;
    accentPattern?: number[];
    atSec?: number[];
    densityCurve?: Array<{ t: number; value: number }>;
  };
}

export interface RenderRecipeShapeLayer extends RenderRecipeBaseLayer {
  type: "shape";
}

export interface RenderRecipeTransitionLayer extends RenderRecipeBaseLayer {
  type: "transition";
}

/**
 * v1.3 Source-first render contract. Compiled from StructureTemplate + VisualElementGraph +
 * SourceVideoUnderstanding + SlotMapping + GapReport + FillPlan + TargetMaterialManifest +
 * ProductBrief and carried at `timeline.renderPlan.renderRecipe`. It is the ONLY thing a renderer
 * reads to decide pixels — no renderer may re-derive a primitive from `clip.role`. Mirrors
 * spec_v3/schemas/render-recipe.schema.json. Sample/reference material is structure evidence only;
 * only source_video / target / generated_target material may reach the canvas.
 */
export interface RenderRecipe {
  schemaVersion: "render-recipe-v1";
  /** v4.1 layer-based contract marker. Legacy fields remain for old renderers. */
  version?: "render-recipe-v4.1";
  versionStrategy?: VersionStrategy;
  versionDiff?: VersionDiff;
  composition?: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: AspectRatio | (string & {});
  };
  videoType: "product_mg" | "beat_cut_product" | "motion_graph" | "fallback_cards";
  productTheme: {
    name: string;
    category: string;
    sellingPoints: string[];
    cta: string;
    productName?: string;
    brandName?: string;
    brief?: string;
    ctaText?: string;
    generationPrompt?: string;
    rawPrompt?: string;
  };
  sourcePolicy: {
    sampleUse: "structure_evidence_only" | "authorized_reuse";
    sourceVideoUse: "renderable_user_material" | "missing";
    targetAssetUse: "renderable_target_material" | "missing";
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
  };
  evidenceSummary?: {
    sourceSampleIds: string[];
    preservedEvidence: {
      visualElements: number;
      typographyRuns: number;
      motionAtoms: number;
      audioLayers: number;
    };
    droppedEvidence: Array<{ kind: string; stage: string; reason: string; severity: "info" | "warn" | "fatal" }>;
  };
  providerDecisions?: ProviderDecision[];
  modelRouteSummary?: ModelRouteSummary;
  recipeLintReport?: unknown;
  videoCriticReport?: unknown;
  structureExplanation?: unknown;
  layers?: RenderRecipeLayer[];
  motionAtoms?: MotionAtomSpec[];
  global: {
    aspectRatio: AspectRatio | (string & {});
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    palette: string[];
    bpm?: number;
    beatGridSec?: number[];
    cutPattern: {
      targetCutCount: number;
      avgShotDurationSec: number;
      fastZones: Array<[number, number]>;
    };
    audioPlan: {
      policy: "procedural_bgm" | "user_bgm" | "authorized_sample_bgm" | "silent";
      layers: {
        kick?: number;
        bass?: number;
        drone?: number;
        hats?: number;
        riser?: number;
        impact?: number;
      };
    };
  };
  clips: RenderRecipeClip[];
  warnings: string[];
  /** v1.4 optional creative-effect selection (backward-compatible; old recipes omit these). */
  creativeEffectSpecId?: string;
  motifFamily?: MotifFamily;
  effectProgramIds?: string[];
  effectPropsById?: Record<string, unknown>;
  effectFallbackReason?: string;
  effectSelection?: EffectSelectionResult;
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
  providerDecisions?: ProviderDecision[];
  modelRouteSummary?: ModelRouteSummary;
  recipeLintReport?: unknown;
  videoCriticReport?: unknown;
  structureExplanation?: unknown;
  migrationExplanation: string;
  warnings: string[];
  aigcMaterialFill?: {
    enabled: boolean;
    provider: AigcMaterialProviderId;
    providers?: AigcMaterialProviderId[];
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
  /** v1.4 creative-effect recording (present only when the recipe carries an effect selection). */
  effectProgramIds?: string[];
  effectFallbackReason?: string;
  effectSelectionSource?: string;
  /** FFmpeg motif-fallback recording (set by the FFmpeg renderer when Remotion is unavailable). */
  ffmpegEffectFallbackUsed?: boolean;
  fallbackVisualLayersAdded?: string[];
  error?: string;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
