// contracts-v5/composition.ts
// CREATE-side planning contracts: TargetAssetProfile, CompositionProgram (planner JSON-only output),
// and GapReportV5. Canonical = data-contracts.md reconciled with composition-program.example.json
// (selectedElements carries appliedRole+priority; slotPlan is an ARRAY — audit SC-02/PVS-05/CREATE-04).

import type {
  AspectRatioV5,
  CreativeBriefV5,
  PlaceholderKindV5,
  PlacementHintV5,
  SectionRoleV5,
  StylePlanV5
} from "./common.js";

export interface TargetAssetProfile {
  id: string;
  assetId: string;
  kind: "image" | "video" | "text" | "logo" | "audio";
  labels: string[];
  qualityScore?: number;
  /** Best section to use this asset in. */
  bestSection?: SectionRoleV5;
  cropSuggestions?: Array<{ x: number; y: number; w: number; h: number; reason?: string }>;
  extractedText?: string;
  motionSummary?: string;
  hasAudio?: boolean;
}

export interface CompositionSection {
  id: string;
  role: SectionRoleV5;
  startSec: number;
  endSec: number;
  purpose: string;
  elementRefs: string[];
  requiredSlots: string[];
  plannedText?: string;
}

export interface SlotPlan {
  id: string;
  sectionId?: string;
  kind: PlaceholderKindV5 | string;
  required: boolean;
  sourceElementId?: string;
  placementHint?: PlacementHintV5;
  preferredFill?: "target_asset" | "generate" | "text" | "procedural";
}

export interface MaterialFill {
  slotId: string;
  strategy: "asset_reuse" | "text_fill" | "packaging_fill" | "aigc_fill" | "procedural_fill";
  assetRecipeId?: string;
  note?: string;
}

export interface MaterialPlan {
  fills: MaterialFill[];
}

export interface AudioLayerPlan {
  id: string;
  kind: "music" | "voiceover" | "sfx" | "procedural_mix";
  audioRecipeId?: string;
  startSec?: number;
  endSec?: number;
  gainDb?: number;
  duckUnderVoiceover?: boolean;
}

export interface AudioPlan {
  layers: AudioLayerPlan[];
  bedRecipeId?: string;
  mood?: string[];
  bpm?: number;
}

export interface CompositionSelectedElement {
  elementId: string;
  appliedRole: string;
  priority: number;
  reason?: string;
  locked?: boolean;
}

/** Stage 10 output: a coherent JSON plan. Contains NO Remotion code (Gen2 produces that). */
export interface CompositionProgram {
  id: string;
  projectId: string;
  generationId?: string;
  creativeBrief: CreativeBriefV5;
  selectedElements: CompositionSelectedElement[];
  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: AspectRatioV5;
  };
  sections: CompositionSection[];
  stylePlan: StylePlanV5;
  slotPlan: SlotPlan[];
  materialPlan: MaterialPlan;
  audioPlan: AudioPlan;
  explanation: {
    howElementsCombine: string[];
    whyThisStructureFitsBrief: string;
    possibleRisks: string[];
  };
}

export type GapStatus = "matched" | "weak_match" | "missing" | "not_needed_after_replan";

export type GapRepairStrategy =
  | "asset_reuse"
  | "text_fill"
  | "packaging_fill"
  | "aigc_fill"
  | "procedural_fill"
  | "structure_reorder";

export interface GapV5 {
  id: string;
  slotId: string;
  sourceElementId?: string;
  status: GapStatus;
  required: string;
  matchedAssetIds: string[];
  reason: string;
  impact: "low" | "medium" | "high";
  selectedRepair: GapRepairStrategy;
  expectedVisualOrAudioResult: string;
}

export interface GapReportV5 {
  id: string;
  compositionProgramId?: string;
  gaps: GapV5[];
}
