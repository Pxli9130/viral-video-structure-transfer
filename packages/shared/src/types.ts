export type Vertical = "b2b_marketing_mg" | "vlog" | "talking_head" | "cutting_beat" | "short_drama" | "generic";
export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";
export type AssetRole = "example_video" | "source_video" | "user_image" | "user_text" | "generated_background" | "render_output";
export type AssetType = "video" | "image" | "text" | "audio" | "output";
export type AssetStatus = "uploaded" | "processing" | "ready" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type AnalysisPurpose = "sample" | "source";

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
  originalName: string;
  path?: string;
  mimeType?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  status: AssetStatus;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  type: "analysis" | "generation" | "render";
  status: JobStatus;
  progress: number;
  inputRef: string;
  outputRef?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface VideoShotCandidate {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  thumbnailPath?: string;
  tags: SourceTag[];
  confidence: number;
}

export interface VideoAnalysisResult {
  id: string;
  assetId: string;
  purpose: AnalysisPurpose;
  mode: "mock" | "ffprobe";
  metadata: {
    durationSec: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: AspectRatio;
    codec: string;
    hasAudio: boolean;
  };
  keyframes: Array<{
    id: string;
    timestampSec: number;
    path?: string;
    label: string;
  }>;
  shotCandidates: VideoShotCandidate[];
  transcript?: string;
  createdAt: string;
}

export type SegmentRole = "hook" | "body" | "proof" | "transition" | "cta" | "other";
export type Pacing = "slow" | "medium" | "fast" | "variable";
export type SlotType =
  | "hook_visual"
  | "product_closeup"
  | "usage_scene"
  | "comparison_scene"
  | "proof_visual"
  | "cta_visual"
  | "text_or_subtitle"
  | "background"
  | "other";
export type StructureShotType =
  | "product_closeup"
  | "usage_scene"
  | "comparison"
  | "lifestyle_scene"
  | "text_card"
  | "background"
  | "cta"
  | "unknown";

export interface StructureSlot {
  id: string;
  slotType: SlotType;
  required: boolean;
  description: string;
  preferredAssetTags?: string[];
  fallbackAllowed?: boolean;
}

export interface StructureShot {
  id: string;
  startSec: number;
  endSec: number;
  shotType: StructureShotType;
  visualIntent: string;
  motion?: string;
  transitionIn?: string;
  transitionOut?: string;
  textOverlay?: string;
}

export interface StructureSegment {
  id: string;
  role: SegmentRole;
  startSec: number;
  endSec: number;
  intent: string;
  pacing?: Pacing;
  sourceRationale?: string;
  requiredSlots: StructureSlot[];
  shots: StructureShot[];
  packagingRefs?: string[];
}

export interface StructureAtom {
  id: string;
  role: "hook" | "body" | "proof" | "transition" | "cta" | "packaging";
  name: string;
  description: string;
  applicableWhen: string;
  requiresSlots?: string[];
  replacementPolicy?: string;
  sourceSegmentIds?: string[];
}

export interface EditingTechnique {
  id: string;
  name: string;
  description: string;
  params?: Record<string, unknown>;
}

export interface StructureTemplate {
  schemaVersion: "1.1";
  id: string;
  projectId?: string;
  name: string;
  vertical: Vertical;
  sourceExample: {
    assetId: string;
    filename?: string;
    durationSec: number;
    width?: number;
    height?: number;
    fps?: number;
    thumbnailPath?: string;
  };
  summary: string;
  targetDurationSec?: number;
  aspectRatio?: AspectRatio;
  segments: StructureSegment[];
  packaging: {
    style: "clean" | "bold" | "mg_motion" | "cinematic" | "ugc" | "generic";
    subtitle: {
      density: "low" | "medium" | "high";
      position: string;
      fontHint?: string;
      safeArea?: string;
    };
    cards: Array<{
      id: string;
      purpose: string;
      style: string;
    }>;
    stickers?: string[];
    transitions: string[];
    coverSuggestion?: string;
  };
  rhythm: {
    averageShotDurationSec: number;
    pace: Pacing;
    climaxPosition: string;
    beatNotes?: string;
  };
  qualityRules: Array<{
    id: string;
    rule: string;
    reason: string;
    severity?: "info" | "warning" | "critical";
  }>;
  structureAtoms: StructureAtom[];
  editingTechniques: EditingTechnique[];
  qualityRationale?: string;
  replacementPolicy?: {
    allowSourceVideoReuse?: boolean;
    allowTextCardSubstitution?: boolean;
    allowAigcPlaceholder?: boolean;
    notes?: string;
  };
  sourcePolicy: {
    sampleSource: "open_download_or_user_uploaded" | "user_authorized" | "demo_only" | "unknown";
    commercialUse: boolean;
    doNotCopyOriginalContent: boolean;
    notes?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface ExampleAnalysis {
  id: string;
  projectId: string;
  assetId: string;
  purpose: AnalysisPurpose;
  video: VideoAnalysisResult;
  template?: StructureTemplate;
  createdAt: string;
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

export interface AssetRef {
  assetId: string;
  role: Exclude<AssetRole, "render_output">;
  manualTags?: string[];
  notes?: string;
}

export interface GenerationRequest {
  schemaVersion: "1.1";
  requestId?: string;
  projectId: string;
  inputMode: "video_plus_prompt" | "brief_assets" | "prompt_only";
  selectedTemplateIds?: string[];
  knowledgeBaseScope?: {
    vertical?: Vertical;
    preferLatest?: boolean;
    allowedAtomRoles?: string[];
  };
  sourceVideo?: AssetRef;
  assets?: AssetRef[];
  prompt: string;
  brief?: {
    topic?: string;
    productName?: string;
    targetAudience?: string;
    sellingPoints?: string[];
    tone?: string;
    cta?: string;
    forbiddenContent?: string[];
  };
  target: {
    vertical: Vertical;
    targetDurationSec: number;
    aspectRatio: AspectRatio;
    outputMode: "storyboard_preview" | "mp4_render";
  };
  controls?: {
    pace?: "slow" | "medium" | "fast";
    hookIntensity?: "safe" | "strong" | "aggressive";
    packagingStyle?: "clean" | "bold" | "mg_motion";
    ctaStyle?: "soft" | "direct";
    allowAigcPlaceholder?: boolean;
    allowReorder?: boolean;
  };
  constraints?: {
    doNotUseSampleVisuals?: boolean;
    mustUseSourceVideo?: boolean;
    maxClips?: number;
    notes?: string;
  };
}

export type SourceTag =
  | "product_like"
  | "person_scene"
  | "usage_scene"
  | "background"
  | "text_card_candidate"
  | "comparison"
  | "cta_candidate";

export interface SourceVideoUnderstanding {
  assetId?: string;
  summary: string;
  candidates: VideoShotCandidate[];
  warnings: string[];
}

export type SlotMatchStatus = "matched" | "weak_match" | "missing";

export interface SlotMapping {
  slotId: string;
  segmentId: string;
  slotType: SlotType;
  status: SlotMatchStatus;
  sourceShotId?: string;
  assetId?: string;
  confidence: number;
  explanation: string;
}

export type FillStrategyName =
  | "reuse_with_crop_zoom"
  | "text_card"
  | "packaging_overlay"
  | "reorder_structure"
  | "aigc_placeholder";

export interface GapReportItem {
  id: string;
  slotId: string;
  gapType: SlotType;
  severity: "low" | "medium" | "high";
  impact: string;
  recommendedStrategies: FillStrategyName[];
}

export interface FillAction {
  id: string;
  gapId: string;
  strategy: FillStrategyName;
  description: string;
  resultClipId: string;
  sourceAssetIds?: string[];
  aigcPrompt?: string;
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

export interface TimelineLayer {
  id: string;
  type: "video" | "image" | "text_card" | "subtitle" | "shape" | "sticker" | "generated_placeholder" | "background";
  assetId?: string;
  sourceShotId?: string;
  startOffsetSec: number;
  durationSec: number;
  text?: string;
  style?: Record<string, unknown>;
  transform?: Record<string, unknown>;
  placeholderPrompt?: string;
}

export interface TimelineClip {
  id: string;
  sourceSlotId?: string;
  sourceSegmentId?: string;
  startSec: number;
  durationSec: number;
  role: SegmentRole;
  visualIntent: string;
  transitionIn?: string;
  transitionOut?: string;
  layers: TimelineLayer[];
  gapFillStrategy?: "none" | FillStrategyName;
}

export interface TimelineMapping {
  sourceId: string;
  sourceType?: "segment" | "slot" | "atom" | "technique";
  targetClipId: string;
  status: "matched" | "weak_match" | "missing_filled";
  explanation: string;
  usedAssetIds?: string[];
}

export interface Timeline {
  schemaVersion: "1.1";
  id: string;
  projectId?: string;
  generationId: string;
  targetDurationSec: number;
  aspectRatio: AspectRatio;
  rendererTarget: "mock_preview" | "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
  clips: TimelineClip[];
  mapping: TimelineMapping[];
  gapReport: GapReportItem[];
  fillPlan: FillAction[];
  storyboard: StoryboardItem[];
  renderPlan?: {
    width?: number;
    height?: number;
    fps?: number;
    background?: string;
    notes?: string;
    adapterOptions?: Record<string, unknown>;
  };
  migrationExplanation?: string;
  warnings?: string[];
  createdAt?: string;
}

export interface GenerationResult {
  id: string;
  projectId: string;
  request: GenerationRequest;
  selectedTemplateIds: string[];
  selectedAtoms: StructureAtom[];
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
  explanation: string;
  warnings: string[];
  createdAt: string;
}

export interface RenderOutput {
  renderId: string;
  generationId: string;
  rendererTarget: "mock_preview" | "html_preview" | "ffmpeg" | "remotion" | "hyperframes";
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
