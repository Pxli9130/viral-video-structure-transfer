// contracts-v5/knowledge.ts
// KnowledgeElement (the central reusable product asset), KbCurationDecision, and SelectionSet.
// Canonical = superset reconciling data-contracts.md and the single-file mirror:
//   - reusablePolicy is TOP-LEVEL (single-file) — not nested under safety (audit SC-05).
//   - KbCurationDecision is a FLAT object (schema) extended with assignedTags/assignedCompatibility
//     so the ML judge's tags+compatibility output has a home (audit PVS-03/SC-04).

import type {
  AssetRecipeV5,
  AudioRecipeV5,
  CompatibilityV5,
  CreativeBriefV5,
  KnowledgeElementKindV5,
  PlaceholderSlotV5,
  ReusablePolicyV5,
  SectionRoleV5
} from "./common.js";

export interface KnowledgeElement {
  id: string;
  kind: KnowledgeElementKindV5;
  name: string;
  description: string;
  tags: string[];

  source: {
    sourceSampleId: string;
    reconstructionProgramId: string;
    evidenceRefs: string[];
    sourceTimeRangeSec?: [number, number];
  };

  /** Canonical top-level reuse policy (data-contracts' safety.reusablePolicy is folded into this). */
  reusablePolicy: ReusablePolicyV5;

  slots: PlaceholderSlotV5[];
  payload: Record<string, unknown>;

  style?: {
    palette?: string[];
    typography?: string;
    mood?: string[];
    pacing?: "slow" | "medium" | "fast";
  };

  compatibility: CompatibilityV5;

  remotion?: {
    snippetRef?: string;
    componentName?: string;
    propsSchemaRef?: string;
    fixtureRef?: string;
    allowedImports?: string[];
  };

  assetRecipe?: AssetRecipeV5;
  audioRecipe?: AudioRecipeV5;

  safety: {
    noCopyChecked: boolean;
    samplePixelsRemoved: boolean;
    sampleAudioRemoved: boolean;
    sampleTextRemoved: boolean;
    renderable: boolean;
  };

  quality: {
    confidence: number;
    usefulness: number;
    distinctiveness?: number;
    coherenceRisk?: number;
    visualImpact?: number;
    reuseCount?: number;
  };

  preview?: {
    thumbnail?: string;
    previewMp4?: string;
  };
}

export type KbDecisionAction =
  | "store_new"
  | "merge_existing"
  | "store_variant"
  | "reject"
  | "evidence_only"
  | "pending_review";

export interface KbCurationDecision {
  id: string;
  candidateId: string;
  action: KbDecisionAction;
  targetElementId?: string;
  parentElementId?: string;
  assignedName?: string;
  assignedKind?: KnowledgeElementKindV5;
  /** Judge-assigned tags + compatibility (PVS-03: these need a home on the decision). */
  assignedTags?: string[];
  assignedCompatibility?: CompatibilityV5;
  hardRuleResult?: string;
  embeddingMatches?: Array<{ elementId: string; score: number }>;
  mlJudgeReason?: string;
  reason?: string;
  createdElementId?: string;
}

export interface SelectionSetItem {
  elementId: string;
  reason?: string;
  locked?: boolean;
  appliedRole?: SectionRoleV5 | "audio" | string;
  priority?: number;
}

export interface SelectionSet {
  id: string;
  projectId?: string;
  mode?: "manual" | "assisted" | "hybrid";
  selected: SelectionSetItem[];
  userBrief?: CreativeBriefV5;
}
