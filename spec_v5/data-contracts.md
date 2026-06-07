# 04 — Data Contracts

This file describes the main TypeScript-style contracts. JSON Schemas are in `schemas/`.

## Asset

```ts
type AssetRole =
  | "sample_video"
  | "target_video"
  | "target_image"
  | "target_text"
  | "generated_asset"
  | "audio_asset";

type SourcePolicy =
  | "sample_evidence_only"
  | "user_owned_reusable"
  | "generated_reusable"
  | "licensed_reusable"
  | "system_procedural";

interface Asset {
  id: string;
  projectId: string;
  role: AssetRole;
  path: string;
  mimeType: string;
  sourcePolicy: SourcePolicy;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

## EvidenceTimelineV5

```ts
interface EvidenceTimelineV5 {
  id: string;
  assetId: string;
  video: {
    durationSec: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
    hasAudio: boolean;
  };
  shots: EvidenceShot[];
  keyFrames: EvidenceFrame[];
  textEvidence: TextEvidence[];
  speechEvidence: SpeechEvidence;
  audioEvidence: AudioEvidence;
  motionEvidence: MotionEvidence;
  contactSheetRef: string;
  recommendedVideoInputPolicy: VideoInputPolicy;
  warnings: string[];
}
```

## NeutralReconstructionProgram

```ts
interface NeutralReconstructionProgram {
  id: string;
  sourceSampleId: string;
  evidenceTimelineId: string;
  evidenceRefs: string[];

  typedSpec: RenderProgramSpecV5;

  remotionProject: RemotionProject;

  placeholders: PlaceholderSlot[];
  timingMap: TimingSegment[];
  learnedAssetRecipes: AssetRecipe[];
  learnedAudioRecipes: AudioRecipe[];

  reconstructionQuality: {
    structureCoverage: number;
    timingCoverage: number;
    placeholderCoverage: number;
    warnings: string[];
  };

  safety: {
    samplePixelsRemoved: boolean;
    sampleTextSanitized: boolean;
    sampleAudioRemoved: boolean;
    renderableSampleMaterialRefs: string[];
  };
}
```

## RenderProgramSpecV5

```ts
interface RenderProgramSpecV5 {
  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
  };
  scenes: ProgramScene[];
  globalStyle: StylePlan;
  audioCues: AudioCue[];
}
```

## ProgramScene

```ts
interface ProgramScene {
  id: string;
  role: "hook" | "setup" | "proof" | "demo" | "benefit" | "transition" | "cta";
  startSec: number;
  endSec: number;
  layers: ProgramLayer[];
  motionGrammar: string[];
  packagingGrammar: string[];
  evidenceRefs: string[];
}
```

## PlaceholderSlot

```ts
interface PlaceholderSlot {
  id: string;
  kind:
    | "hero"
    | "hero_head"
    | "hero_product"
    | "product_closeup"
    | "background"
    | "logo"
    | "subtitle_text"
    | "voiceover"
    | "sfx"
    | "cta_card";
  required: boolean;
  evidenceRef: string;
  replacementPolicy: "target_asset" | "generate" | "text_fallback" | "optional";
  safetyPolicy: "must_replace_sample" | "can_use_user_asset" | "procedural_only";
}
```

## AssetRecipe

```ts
interface AssetRecipe {
  id: string;
  kind:
    | "hero_head"
    | "hero_product"
    | "background"
    | "cover"
    | "product_card"
    | "sticker"
    | "comparison_card";
  observedDescription: {
    subject: string;
    shape?: string;
    material?: string;
    lighting?: string;
    camera?: string;
    composition?: string;
    mood?: string;
  };
  generationPromptTemplate: string;
  negativePrompt: string;
  placementHint: PlacementHint;
  reusablePolicy: "regenerate_only" | "evidence_only";
  evidenceRefs: string[];
}
```

## AudioRecipe

```ts
interface AudioRecipe {
  id: string;
  kind: "music_bed" | "impact" | "whoosh" | "riser" | "voiceover_style" | "ducking_pattern";
  bpm?: number;
  mood: string[];
  instruments?: string[];
  energyCurve?: Array<{ t: number; value: number }>;
  cuePoints: Array<{ t: number; type: "hit" | "riser" | "impact" | "duck"; role: string }>;
  generationPromptTemplate: string;
  negativePrompt: string;
  reusablePolicy: "regenerate_only" | "procedural_recreate" | "evidence_only";
  evidenceRefs: string[];
}
```

## KnowledgeElement

```ts
type KnowledgeElementKind =
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

interface KnowledgeElement {
  id: string;
  kind: KnowledgeElementKind;
  name: string;
  description: string;
  tags: string[];
  source: {
    sourceSampleId: string;
    reconstructionProgramId: string;
    evidenceRefs: string[];
  };
  payload: Record<string, unknown>;
  slots: PlaceholderSlot[];
  compatibility: Compatibility;
  remotion?: {
    snippetRef?: string;
    componentName?: string;
    propsSchemaRef?: string;
    fixtureRef?: string;
  };
  safety: {
    noCopyChecked: boolean;
    samplePixelsRemoved: boolean;
    sampleAudioRemoved: boolean;
    sampleTextRemoved: boolean;
    reusablePolicy: "reusable" | "regenerate_only" | "evidence_only";
  };
  quality: {
    confidence: number;
    usefulness: number;
    distinctiveness: number;
    coherenceRisk: number;
  };
  preview?: {
    thumbnail?: string;
    previewMp4?: string;
  };
}
```

## KbCurationDecision

```ts
type KbDecisionAction =
  | "store_new"
  | "merge_existing"
  | "store_variant"
  | "reject"
  | "evidence_only"
  | "pending_review";

interface KbCurationDecision {
  id: string;
  candidateId: string;
  action: KbDecisionAction;
  targetElementId?: string;
  parentElementId?: string;
  assignedName?: string;
  assignedKind?: KnowledgeElementKind;
  hardRuleResult?: string;
  embeddingMatches?: Array<{ elementId: string; score: number }>;
  mlJudgeReason?: string;
  createdElementId?: string;
}
```

## CompositionProgram

```ts
interface CompositionProgram {
  id: string;
  projectId: string;
  creativeBrief: CreativeBrief;
  selectedElements: Array<{ elementId: string; appliedRole: string; priority: number }>;
  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: string;
  };
  sections: CompositionSection[];
  stylePlan: StylePlan;
  slotPlan: SlotPlan[];
  materialPlan: MaterialPlan;
  audioPlan: AudioPlan;
  explanation: {
    howElementsCombine: string[];
    whyThisStructureFitsBrief: string;
    possibleRisks: string[];
  };
}
```

## FinalVideoProgram

```ts
interface FinalVideoProgram {
  id: string;
  compositionProgramId: string;
  remotionProject: RemotionProject;
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
}
```

## ScorecardV5

```ts
interface ScorecardV5 {
  id: string;
  generationId: string;
  gates: Array<{ id: string; name: string; status: "pass" | "fail" | "warn"; message?: string }>;
  rubricCoverage: Array<{ rubricItem: string; status: "done" | "partial" | "missing"; evidenceArtifactRefs: string[] }>;
  renderQuality: Record<string, unknown>;
  safety: Record<string, unknown>;
  warnings: string[];
}
```
