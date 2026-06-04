// contracts-v5/common.ts
// Canonical leaf types for spec_v5 (Program-KB Dual Codegen). This module is the SINGLE
// source of truth for the small reusable types that the v5 artifact contracts compose.
//
// Why this file exists: the spec_v5 doc set shipped three divergent representations of the
// same types (spec_v5/data-contracts.md, spec_v5/schemas/*.json, and the single-file mirror
// spec_v5_program_kb_dual_codegen.md). The feasibility audit (2026-06-04) confirmed pervasive
// field/enum drift. We reconcile each type to ONE canonical superset here; spec docs and the
// JSON Schemas are aligned to match. The v5 ARCHITECTURE is unchanged — only naming/shape is
// canonicalized.

/** 9:16 portrait is the default short-form target. */
export type AspectRatioV5 = "9:16" | "16:9" | "1:1";

/**
 * Provenance/reuse policy for an asset. Canonical 5-value union from data-contracts.md.
 * The single-file mirror's shorthand (`sample_evidence`, `user_uploaded`, `generated`) maps:
 *   sample_evidence  -> sample_evidence_only
 *   user_uploaded    -> user_owned_reusable
 *   generated        -> generated_reusable
 */
export type SourcePolicyV5 =
  | "sample_evidence_only"
  | "user_owned_reusable"
  | "generated_reusable"
  | "licensed_reusable"
  | "system_procedural";

/** Role an ingested asset plays in a v5 project. */
export type AssetRoleV5 =
  | "sample_video"
  | "target_video"
  | "target_image"
  | "target_text"
  | "generated_asset"
  | "audio_asset";

/**
 * Unified reusability policy for candidate/knowledge elements and recipes. Superset of the
 * three source vocabularies:
 *   - CandidateElement: direct_reuse | parametric_reuse | regenerate_only | evidence_only
 *   - AssetRecipe:      regenerate_only | evidence_only
 *   - AudioRecipe:      regenerate_only | procedural_recreate | evidence_only
 *   - KnowledgeElement: (data-contracts nested) reusable | regenerate_only | evidence_only
 * `reusable` (data-contracts) is represented here as `direct_reuse`.
 */
export type ReusablePolicyV5 =
  | "direct_reuse"
  | "parametric_reuse"
  | "regenerate_only"
  | "procedural_recreate"
  | "evidence_only";

/** Section role used across the neutral program, composition program, and gap report. */
export type SectionRoleV5 =
  | "hook"
  | "setup"
  | "proof"
  | "demo"
  | "benefit"
  | "transition"
  | "cta";

/** The 16 reusable knowledge element kinds (identical across all v5 docs). */
export type KnowledgeElementKindV5 =
  | "structure_pattern"
  | "hook_pattern"
  | "segment_template"
  | "rhythm_pattern"
  | "motion_pattern"
  | "transition_pattern"
  | "typography_pattern"
  | "layout_pattern"
  | "palette_pattern"
  | "visual_asset_pattern"
  | "image_prompt_recipe"
  | "audio_pattern"
  | "sfx_pattern"
  | "voiceover_pattern"
  | "cta_pattern"
  | "remotion_snippet";

export const KNOWLEDGE_ELEMENT_KINDS_V5: readonly KnowledgeElementKindV5[] = [
  "structure_pattern",
  "hook_pattern",
  "segment_template",
  "rhythm_pattern",
  "motion_pattern",
  "transition_pattern",
  "typography_pattern",
  "layout_pattern",
  "palette_pattern",
  "visual_asset_pattern",
  "image_prompt_recipe",
  "audio_pattern",
  "sfx_pattern",
  "voiceover_pattern",
  "cta_pattern",
  "remotion_snippet"
];

/** Placeholder slot kinds — sample-specific content that must be replaced/generated. */
export type PlaceholderKindV5 =
  | "hero"
  | "hero_head"
  | "hero_product"
  | "product_closeup"
  | "background"
  | "logo"
  | "main_title"
  | "subtitle_text"
  | "voiceover"
  | "sfx"
  | "audio_pattern"
  | "cta_card";

export type ReplacementPolicyV5 = "target_asset" | "generate" | "text_fallback" | "optional";
export type SlotSafetyPolicyV5 = "must_replace_sample" | "can_use_user_asset" | "procedural_only";

/**
 * A required content slot discovered during neutral reconstruction. Canonical superset of
 * data-contracts.md PlaceholderSlot (evidenceRef singular, replacementPolicy, safetyPolicy)
 * and the example shape (evidenceRefs array, sectionId/startSec/endSec, sourcePolicy).
 */
export interface PlaceholderSlotV5 {
  id: string;
  kind: PlaceholderKindV5;
  required: boolean;
  /** Section this slot belongs to (optional — top-level slots allowed). */
  sectionId?: string;
  startSec?: number;
  endSec?: number;
  /** Evidence refs that justify the slot. Always an array (singular evidenceRef is deprecated). */
  evidenceRefs: string[];
  replacementPolicy: ReplacementPolicyV5;
  safetyPolicy?: SlotSafetyPolicyV5;
  sourcePolicy?: SourcePolicyV5;
}

export interface BBoxNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacementHintV5 {
  sectionRole: SectionRoleV5;
  bboxNorm?: BBoxNorm;
  motion?: string;
  durationSec?: number;
}

/** Recipe for REGENERATING a visual asset (never copies sample pixels). */
export interface AssetRecipeV5 {
  id: string;
  kind:
    | "hero_head"
    | "hero_product"
    | "background"
    | "cover"
    | "product_card"
    | "sticker"
    | "logo_placeholder"
    | "comparison_card";
  observedDescription: {
    subject: string;
    shape?: string;
    material?: string;
    lighting?: string;
    camera?: string;
    composition?: string;
    mood?: string;
    styleKeywords?: string[];
  };
  generationPromptTemplate: string;
  negativePrompt: string;
  placementHint: PlacementHintV5;
  reusablePolicy: Extract<ReusablePolicyV5, "regenerate_only" | "evidence_only">;
  evidenceRefs: string[];
}

export type AudioCueType = "hit" | "riser" | "impact" | "duck";

export interface AudioCuePoint {
  /** Time in seconds (canonical key is `t`; example's `timeSec` is aligned to this). */
  t: number;
  type: AudioCueType;
  role: string;
}

/** Recipe for REGENERATING/synthesizing audio (never copies sample audio). */
export interface AudioRecipeV5 {
  id: string;
  kind: "music_bed" | "impact" | "whoosh" | "riser" | "voiceover_style" | "ducking_pattern";
  bpm?: number;
  mood: string[];
  instruments?: string[];
  energyCurve?: Array<{ t: number; value: number }>;
  cuePoints: AudioCuePoint[];
  generationPromptTemplate: string;
  negativePrompt: string;
  reusablePolicy: Extract<ReusablePolicyV5, "regenerate_only" | "procedural_recreate" | "evidence_only">;
  evidenceRefs: string[];
}

/** A multi-file Remotion project emitted by Gen1 (reconstruction) or Gen2 (final). */
export interface RemotionProjectV5 {
  entryFile: string;
  componentName: string;
  files: Array<{ path: string; content: string }>;
  propsSchema: unknown;
  fixture: unknown;
  /** Imports the generated code is permitted to use (renderer-spec §5). */
  allowedImports?: string[];
}

/** How Gen1 should "see" the sample video (pipeline.md Stage 3 / single-file §4.3). */
export interface VideoInputPolicyV5 {
  mode?: "auto" | "global" | "global_detail" | "long";
  globalPass: {
    useWholeVideo: boolean;
    fps: number;
  };
  detailPass?: {
    enabled: boolean;
    chunkMode: "scene_aware" | "beat_window";
    overlapSec: number;
    fps: number;
  };
}

/** One row of the neutral program's timing map. */
export interface TimingSegmentV5 {
  id: string;
  startSec: number;
  endSec: number;
  role: SectionRoleV5 | string;
  visualTechnique?: string;
  motionTechnique?: string;
  audioCue?: string;
  evidenceRefs: string[];
}

/** Global style harmonization plan (used by neutral program and composition program). */
export interface StylePlanV5 {
  palette: string[];
  typographySystem: string;
  motionIntensity: "low" | "medium" | "high";
  textDensity: "low" | "medium" | "high";
  pacing: "slow" | "medium" | "fast";
  coherenceNotes: string[];
}

/** User creative brief for the create pipeline. */
export interface CreativeBriefV5 {
  prompt?: string;
  theme?: string;
  vertical?: string;
  variant?: "high_click" | "high_conversion" | "high_quality";
  targetDurationSec?: number;
  aspectRatio?: AspectRatioV5;
  sellingPoints?: string[];
}

/** Cross-element compatibility metadata used by the planner to avoid incoherent combinations. */
export interface CompatibilityV5 {
  aspectRatios: string[];
  verticals: string[];
  canCombineWith: string[];
  conflictsWith: string[];
  styleTags?: string[];
  pacingTags?: string[];
}

/** Provenance for any generated/reused final asset (security-and-safety.md §6). */
export interface ProvenanceV5 {
  assetId?: string;
  source:
    | "target_user"
    | "generated"
    | "aigc_generated"
    | "licensed"
    | "procedural"
    | "target_asset_reuse";
  createdByStage?: string;
  providerDecisionId?: string;
  promptRef?: string;
  promptHash?: string;
  sourceKnowledgeElementIds?: string[];
  /** Hard invariants — sample material never enters final reusable output. */
  samplePixelsUsed?: false;
  sampleAudioUsed?: false;
}
