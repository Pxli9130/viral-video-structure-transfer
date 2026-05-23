import type {
  Asset,
  AnalyzerMode,
  GenerationRequest,
  KnowledgeAtom,
  RendererTarget,
  RenderOutput,
  StructureTemplate,
  TranscriptSegment,
  VideoAnalysisResult,
  Vertical
} from "./types.js";

/**
 * Adapter abstractions for v1.2 NFR-001 extensibility.
 * Concrete implementations live in apps/api/src/adapters and call out to
 * conda viral python helpers, FFmpeg, or external providers when configured.
 */

export interface AnalyzeVideoOptions {
  analyzerMode?: AnalyzerMode;
  durationHintSec?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface VideoToolAdapter {
  readonly name: string;
  analyze(asset: Asset, projectId: string, purpose: "sample" | "source", options?: AnalyzeVideoOptions): Promise<VideoAnalysisResult>;
}

export interface RendererAdapter {
  readonly target: RendererTarget;
  render(timeline: import("./types.js").Timeline, generationId: string): Promise<RenderOutput>;
}

export interface StructureExtractionRequest {
  analysis: VideoAnalysisResult;
  projectId: string;
  vertical: Vertical;
  prompt?: string;
  vlm?: VLMVideoAnalysis;
}

export interface AIAdapter {
  readonly name: string;
  readonly available: boolean;
  extractStructure(request: StructureExtractionRequest): Promise<StructureTemplate>;
  reviseInstruction?(input: { generationId: string; instruction: string }): Promise<{ summary: string; patchedControls?: Partial<GenerationRequest["controls"]> }>;
}

export interface ASRAdapter {
  readonly name: string;
  readonly available: boolean;
  transcribe(asset: Asset): Promise<TranscriptSegment[]>;
}

export interface OCRAdapter {
  readonly name: string;
  readonly available: boolean;
  recognizeFrames(asset: Asset, frames: Array<{ path: string; timeSec: number }>): Promise<Array<{ timeSec: number; text: string }>>;
}

export interface VLMShotInsight {
  start: number;
  end: number;
  visual: string;
  cameraMotion?: string;
  subtitleText?: string;
  overlayStyle?: string;
  transition?: string;
  bgmCue?: string;
  purpose?: string;
}

export interface VLMVideoAnalysis {
  videoSummary: string;
  shots: VLMShotInsight[];
  structure: {
    hook?: string;
    setup?: string;
    sellingPoints?: string[];
    climax?: string;
    cta?: string;
  };
  rhythm: {
    avgShotLength?: number;
    fastSections?: string[];
    slowSections?: string[];
    peakMoments?: string[];
    peakTimeRatio?: number;
    notes?: string;
  };
  packaging: {
    subtitleDensity?: string;
    titleCards?: string[];
    stickers?: string[];
    colorStyle?: string;
    coverStyle?: string;
  };
  reusablePatterns?: string[];
  materialGapsForNewVideo?: string[];
  recommendedTimelineForRemotion?: unknown;
  raw?: string;
}

export interface VLMAdapter {
  readonly name: string;
  readonly available: boolean;
  describeFrames(frames: Array<{ path: string; timeSec: number }>): Promise<Array<{ timeSec: number; tags: string[]; description: string }>>;
  describeVideo?(asset: Asset, opts?: { mimeType?: string; purpose?: "sample" | "source" }): Promise<VLMVideoAnalysis>;
}

export interface AtomQuery {
  projectId?: string;
  vertical?: Vertical;
  role?: string;
  category?: string;
}

export interface KnowledgeBaseSnapshot {
  projectId: string;
  templates: StructureTemplate[];
  atoms: KnowledgeAtom[];
  editingTechniques: StructureTemplate["editingTechniques"];
  counts: {
    templates: number;
    atoms: number;
    techniques: number;
  };
}

export interface StorageAdapter {
  readonly name: string;
  read<T>(collection: string): Promise<T[]>;
  upsert<T extends { id: string }>(collection: string, value: T): Promise<T>;
  remove(collection: string, id: string): Promise<void>;
}
