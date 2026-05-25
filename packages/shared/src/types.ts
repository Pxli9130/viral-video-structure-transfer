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
export type RendererTarget = "mock_preview" | "html_preview" | "ffmpeg" | "remotion" | "hyperframes";

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
  | "aigc_placeholder";

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
  warnings: string[];
  analyzerMode: AnalyzerMode;
  createdAt: string;
}

export interface RequiredSlot {
  id: string;
  role: SegmentRole;
  slotType: SlotType;
  required: boolean;
  description: string;
  preferredTags?: string[];
  fallbackStrategies?: FillStrategy[];
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
  notes?: string;
}

export interface PackagingSpec {
  subtitleStyle?: string;
  titleCardStyle?: string;
  overlayStyle?: string;
  transitionStyle?: string;
  coverStyle?: string;
}

export interface StructureTemplate {
  id: string;
  projectId: string;
  name: string;
  vertical: Vertical;
  sourceSampleIds: string[];
  targetDurationSec?: number;
  segments: StructureSegment[];
  requiredSlots: RequiredSlot[];
  rhythm: RhythmSpec;
  packaging: PackagingSpec;
  structureAtoms: KnowledgeAtom[];
  editingTechniques: EditingTechnique[];
  replacementPolicy: ReplacementPolicy;
  qualityRationale: string;
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
}

export interface GenerationConstraints {
  forbiddenWords?: string[];
  mustMention?: string[];
  noSampleVisualCopy?: boolean;
}

export interface GenerationRequest {
  projectId: string;
  inputMode: "video_plus_prompt" | "brief_assets" | "prompt_only";
  sourceVideo?: GenerationRequestSourceVideo;
  selectedTemplateIds?: string[];
  selectedAtomIds?: string[];
  assets?: GenerationRequestAsset[];
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
  | "dynamic_3d_ribbon_asset";

export interface GapReportItem {
  slotId: string;
  status: SlotMatchStatus;
  severity: "low" | "medium" | "high";
  reason: string;
  impact: string;
  gapType?: GapCategory;
  gapLabel?: string;
  gapLabelZh?: string;
  recommendedFillStrategies?: FillStrategy[];
  slotType?: SlotType;
  slotRole?: SegmentRole;
}

export interface FillAction {
  slotId: string;
  strategy: FillStrategy;
  reason: string;
  targetClipId: string;
  rendererInstructions?: Record<string, unknown>;
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
  gapFillStrategy?: "none" | FillStrategy;
}

export interface TimelineMappingItem {
  templateSegmentId: string;
  atomIds: string[];
  targetClipIds: string[];
  explanation: string;
}

export interface MotionAtomSpec {
  type: "ribbon_orbit" | "3d_ribbon_orbit";
  fulfilledBy: "procedural_generation";
  keywords: string[];
  colorProgression: string[];
  style: "mg_motion" | "clean_premium";
  density: number;
  speed: number;
  opacity: number;
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
  adapterOptions?: Record<string, unknown>;
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
  renderPlan?: RenderPlan;
  warnings?: string[];
  createdAt: string;
}

export interface GenerationResult {
  id: string;
  projectId: string;
  request: GenerationRequest;
  selectedTemplateIds: string[];
  selectedAtoms: KnowledgeAtom[];
  sourceUnderstanding: SourceVideoUnderstanding;
  slotMapping: SlotMapping[];
  gapReport: GapReportItem[];
  fillPlan: FillAction[];
  storyboard: StoryboardItem[];
  timeline: Timeline;
  validation: {
    generationRequest: ValidationResult;
    timeline: ValidationResult;
  };
  migrationExplanation: string;
  warnings: string[];
  createdAt: string;
}

export interface RenderOutput {
  renderId: string;
  generationId: string;
  rendererTarget: RendererTarget;
  status: JobStatus;
  outputPath?: string;
  previewHtml?: string;
  error?: string;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
