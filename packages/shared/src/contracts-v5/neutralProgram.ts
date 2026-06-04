// contracts-v5/neutralProgram.ts
// Gen1 output: NeutralReconstructionProgram — a content-neutral, typed, executable reconstruction
// of a sample video. Canonical required keys = neutral-reconstruction-program.schema.json
// (id, sourceSampleId, evidenceTimelineId, typedSpec, remotionProject, placeholders, timingMap,
// safety). The single-file mirror omitted evidenceTimelineId; we keep it (audit SC-06/PVS-04).

import type {
  AspectRatioV5,
  AssetRecipeV5,
  AudioRecipeV5,
  KnowledgeElementKindV5,
  PlaceholderSlotV5,
  RemotionProjectV5,
  ReusablePolicyV5,
  SectionRoleV5,
  StylePlanV5,
  TimingSegmentV5
} from "./common.js";

export interface ProgramLayer {
  id: string;
  type: "media" | "text" | "shape" | "background" | "audio" | "cta" | "transition";
  /** Slot this layer is bound to (placeholder during reconstruction). */
  placeholderId?: string;
  startSec?: number;
  endSec?: number;
  style?: Record<string, unknown>;
  motion?: { kind: string; intensity?: number } & Record<string, unknown>;
  evidenceRefs?: string[];
}

export interface ProgramScene {
  id: string;
  role: SectionRoleV5;
  startSec: number;
  endSec: number;
  intent?: string;
  layers: ProgramLayer[];
  motionGrammar?: string[];
  packagingGrammar?: string[];
  evidenceRefs: string[];
}

export interface AudioCue {
  t: number;
  type: "impact" | "hit" | "riser" | "duck" | "beat";
  role?: string;
  evidenceRef?: string;
}

export interface ProgramRhythm {
  cutDensity?: "low" | "medium" | "high";
  beatAlignedCuts?: boolean;
  peakMomentsSec?: number[];
  pacingCurve?: Array<{ timeSec: number; value: number }>;
}

export interface ProgramPackaging {
  typographySystem?: string;
  subtitleStyle?: Record<string, unknown>;
  titleCardStyle?: Record<string, unknown>;
  palette?: string[];
}

/** The typed spec at the heart of the neutral program. `scenes` is canonical (layers nest in scenes). */
export interface RenderProgramSpecV5 {
  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: AspectRatioV5;
    background?: string;
  };
  scenes: ProgramScene[];
  globalStyle: StylePlanV5;
  audioCues: AudioCue[];
  rhythm?: ProgramRhythm;
  packaging?: ProgramPackaging;
}

export interface ReconstructionQuality {
  structureCoverage: number;
  timingCoverage: number;
  placeholderCoverage: number;
  warnings: string[];
}

export interface NeutralReconstructionSafety {
  samplePixelsRemoved: boolean;
  sampleTextSanitized: boolean;
  sampleAudioRemoved: boolean;
  /** Must stay empty — any entry means sample material leaked into renderable output. */
  renderableSampleMaterialRefs?: string[];
}

export interface NeutralReconstructionProgram {
  id: string;
  sourceSampleId: string;
  evidenceTimelineId: string;
  evidenceRefs?: string[];

  typedSpec: RenderProgramSpecV5;
  remotionProject: RemotionProjectV5;

  placeholders: PlaceholderSlotV5[];
  timingMap: TimingSegmentV5[];

  learnedAssetRecipes?: AssetRecipeV5[];
  learnedAudioRecipes?: AudioRecipeV5[];

  reconstructionQuality?: ReconstructionQuality;
  safety: NeutralReconstructionSafety;

  /** True when produced by the deterministic neutral-template fallback rather than the AI. */
  fallbackUsed?: boolean;
  fallbackReason?: string;
}

export interface RemotionSnippetRef {
  snippetRef?: string;
  componentName?: string;
  propsSchemaRef?: string;
  fixtureRef?: string;
}

/** Stage 5 output: a reusable element proposed from the neutral program, pre-curation. */
export interface CandidateElement {
  id: string;
  proposedName: string;
  kind: KnowledgeElementKindV5;
  sourceProgramId: string;
  sourceSampleId: string;
  evidenceRefs: string[];
  summary: string;
  reusablePolicy: ReusablePolicyV5;
  slots: PlaceholderSlotV5[];
  remotionSnippet?: RemotionSnippetRef;
  assetRecipe?: AssetRecipeV5;
  audioRecipe?: AudioRecipeV5;
  /** Free-form payload for kind-specific data (rhythm curve, motion params, etc.). */
  payload?: Record<string, unknown>;
  qualityHints?: string[];
}
