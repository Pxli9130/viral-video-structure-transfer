// contracts-v5/finalProgram.ts
// Gen2 output + renderer contracts: FinalVideoProgram, RenderRecipeV5, RenderLayer/AudioLayer, and the
// generated-asset contracts (GeneratedVisualAsset, GeneratedAudioAsset) that were referenced by the
// material/audio prompts but never defined (audit PVS-02).

import type { AspectRatioV5, ProvenanceV5, RemotionProjectV5 } from "./common.js";

export interface AudioLayer {
  id: string;
  kind: "music" | "voiceover" | "sfx" | "procedural_mix" | "bed";
  /** Renderable audio path (target/generated/procedural only — never sample audio). */
  uri?: string;
  startSec: number;
  endSec?: number;
  gainDb?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  duckUnderVoiceover?: boolean;
  /** Beat/cue alignment hints (seconds) for hit synchronization. */
  cueAlignSec?: number[];
  provenance?: ProvenanceV5;
}

export type RenderLayerType =
  | "media"
  | "text"
  | "shape"
  | "motion"
  | "transition"
  | "packaging"
  | "audio"
  | "debug";

export interface RenderLayer {
  id: string;
  type: RenderLayerType;
  sectionId?: string;
  startSec: number;
  endSec: number;
  /** Renderable asset ref (must resolve to a target/generated asset, never a sample path). */
  assetId?: string;
  text?: string;
  style?: Record<string, unknown>;
  motion?: Record<string, unknown>;
  evidenceRefs?: string[];
  /** Why this layer exists if it has no evidence (fallback reasons keep the no-copy gate honest). */
  fallbackReason?: string;
}

/** Renderer-neutral recipe — the inspection + deterministic-fallback format (gen2 §7). */
export interface RenderRecipeV5 {
  version: "render-recipe-v5";
  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: AspectRatioV5;
    background?: string;
  };
  layers: RenderLayer[];
  audioLayers: AudioLayer[];
  assets: Array<{ id: string; uri: string; provenance: ProvenanceV5 }>;
  provenance?: ProvenanceV5[];
  explanations?: string[];
}

export interface GeneratedVisualAsset {
  id: string;
  kind: "image" | "video" | "poster" | "card" | "background";
  uri: string;
  provenance: ProvenanceV5;
  usageHint?: string;
}

export interface GeneratedAudioAsset {
  id: string;
  kind: "music" | "voiceover" | "sfx" | "procedural_mix";
  uri?: string;
  audioLayer: AudioLayer;
  provenance: ProvenanceV5;
}

export interface FinalVideoProgram {
  id: string;
  compositionProgramId: string;
  remotionProject: RemotionProjectV5;
  renderRecipe: RenderRecipeV5;
  explanation: {
    usedElements: Array<{
      elementId: string;
      sourceSampleId: string;
      appliedAtSec: number;
      reason: string;
    }>;
    gapFillDecisions: string[];
    audioDecisions: string[];
  };
  validation: {
    schemaPassed: boolean;
    tsCompilePassed: boolean;
    noCopyPassed: boolean;
    warnings: string[];
  };
  /** True when the deterministic compose fallback produced this instead of AI codegen. */
  fallbackUsed?: boolean;
  fallbackReason?: string;
}
