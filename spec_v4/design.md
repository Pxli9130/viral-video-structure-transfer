# 04. Design: Core Protocols

## 1. VideoEvidenceBundle

`VideoEvidenceBundle` is the single source of low-level evidence.

```ts
export type VideoEvidenceBundle = {
  version: "evidence-v4";
  sampleId: string;

  meta: {
    durationSec: number;
    fps: number;
    width: number;
    height: number;
    aspectRatio: "9:16" | "16:9" | "1:1" | string;
  };

  shots: Array<{
    id: string;
    startSec: number;
    endSec: number;
    durationSec: number;
    thumbnailPath?: string;
    motionScore: number;
    sceneChangeType: "hard_cut" | "soft_cut" | "fade" | "unknown";
    sourceFrameRefs: string[];
  }>;

  rhythm: {
    bpm?: number;
    beatTimestampsSec: number[];
    onsetTimestampsSec: number[];
    energyCurve: Array<{ t: number; value: number }>;
    cutDensity: number;
    climaxRanges: Array<[number, number]>;
  };

  typographyEvidence: Array<{
    id: string;
    startSec: number;
    endSec: number;
    text?: string;
    role?: "headline" | "subtitle" | "badge" | "cta" | "price" | "unknown";
    bboxNorm: { x: number; y: number; w: number; h: number };
    fontSizeRatio?: number;
    color?: string;
    stroke?: boolean;
    shadow?: boolean;
    animationHint?: "pop" | "scale" | "flash" | "sweep" | "slide" | "typewriter" | "none";
    evidenceRefs: string[];
  }>;

  visualElementGraph: {
    elements: Array<{
      id: string;
      family:
        | "hero_object"
        | "media_card"
        | "ribbon"
        | "ui_panel"
        | "badge"
        | "sticker"
        | "watermark"
        | "background"
        | "unknown";
      startSec: number;
      endSec: number;
      bboxTrack: Array<{ t: number; bboxNorm: { x: number; y: number; w: number; h: number } }>;
      motionPattern?: "orbit" | "slide" | "spin" | "scale_pop" | "sweep" | "static" | "unknown";
      confidence: number;
      labelSource: "cv" | "ocr" | "vlm" | "hybrid";
    }>;
    relations: Array<{ from: string; to: string; type: "overlays" | "follows" | "syncs_with" | "masks" | "near" }>;
  };

  motionAtoms: Array<{
    id: string;
    type:
      | "parametric_ribbon_surface"
      | "text_sweep_mask"
      | "card_orbit"
      | "hero_spin"
      | "impact_flash"
      | "light_sweep";
    startSec: number;
    endSec: number;
    params: Record<string, unknown>;
    evidenceRefs: string[];
  }>;

  audioStructure: {
    estimatedLayers: Array<{
      kind: "kick" | "bass" | "hat" | "drone" | "riser" | "impact" | "voice" | "music";
      weight: number;
      accentPattern?: number[];
    }>;
    style?: "beat_cut_dark" | "marketing_glossy" | "motion_graph_ambient" | "unknown";
  };

  frameSheets: {
    globalSheet?: string;
    shotSheet?: string;
    transitionSheet?: string;
    textSheet?: string;
    motionSheet?: string;
  };

  safety: {
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
    watermarkRegions?: Array<{ bboxNorm: { x: number; y: number; w: number; h: number } }>;
  };
};
```

## 2. TechniqueAtom

TechniqueAtoms are reusable creative units.

```ts
export type TechniqueAtom = {
  id: string;
  name: string;
  category: "hook" | "rhythm" | "typography" | "transition" | "motion_graph" | "poster" | "cta" | "audio" | "layout";
  sourceSampleId: string;
  sourceEvidenceRefs: string[];

  visualPattern: {
    family:
      | "kinetic_typography"
      | "image_card_orbit"
      | "ribbon_poster"
      | "product_hero"
      | "source_montage"
      | "impact_flash"
      | "feature_card_stack"
      | "cta_slate";
    description: string;
    colorPalette?: string[];
    layoutMotif?: string;
    motionMotif?: string;
  };

  timingPattern: {
    startRole?: "opening" | "middle" | "climax" | "ending";
    durationRangeSec: [number, number];
    beatSync?: boolean;
    cutDensity?: "low" | "medium" | "high";
    accentBeats?: number[];
  };

  requiredAssets: Array<{
    role: "hero_image" | "source_video_shots" | "media_cards" | "logo" | "selling_points" | "background" | "cta_text" | "audio";
    type: "image" | "video" | "text" | "audio" | "generated" | "none";
    minCount: number;
    importance: "low" | "medium" | "high";
  }>;

  renderer: {
    preferred: "remotion" | "ffmpeg";
    component:
      | "KineticTypographySweep"
      | "ParametricRibbonSurface"
      | "MediaCardCascade"
      | "ProductPosterHero"
      | "SourceClipBeatMontage"
      | "FeatureCardStack"
      | "ImpactFlash"
      | "CTAEndSlate";
    fallbackComponent?: string;
  };

  transferRules: {
    canUseTargetImages: boolean;
    canUseSourceVideo: boolean;
    canUseAigcFill: boolean;
    samplePixelsAllowed: false;
    fallbackStrategies: Array<"structure_reorder" | "text_fill" | "packaging_fill" | "aigc_fill" | "asset_reuse" | "procedural_motion">;
  };
};
```

## 3. StructureTemplate

```ts
export type StructureTemplate = {
  version: "structure-template-v4";
  id: string;
  sourceSampleIds: string[];
  videoType: "editing_tutorial" | "marketing_poster" | "motion_graph_ad" | "product_ad" | "mixed";

  scriptStructure: Array<{
    id: string;
    role: "hook" | "setup" | "proof" | "demo" | "benefit" | "climax" | "cta" | "outro";
    startSec: number;
    endSec: number;
    viewerPurpose: string;
    sourceEvidenceRefs: string[];
  }>;

  rhythmStructure: {
    bpm?: number;
    beatGridSec: number[];
    avgShotDurationSec: number;
    cutDensity: "low" | "medium" | "high";
    fastZones: Array<[number, number]>;
    climaxRanges: Array<[number, number]>;
  };

  packagingStructure: {
    colorPalette: string[];
    typographySystem: {
      textTracks: string[];
      dominantPlacements: Array<"center" | "top" | "bottom" | "left" | "right" | "diagonal">;
      fontSizeRangeRatio: [number, number];
      animationHints: string[];
    };
    motionAtoms: VideoEvidenceBundle["motionAtoms"];
    visualElementFamilies: Record<string, number>;
  };

  templateSlots: TemplateSlot[];
  techniqueAtoms: TechniqueAtom[];

  evidenceSummary: {
    visualElements: number;
    typographyRuns: number;
    motionAtoms: number;
    audioLayers: number;
    heroDescriptors: number;
  };

  safety: {
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
  };
};
```

## 4. AssetProfile

```ts
export type AssetProfile = {
  id: string;
  kind: "image" | "video" | "text" | "audio" | "generated";
  uri?: string;
  text?: string;

  provenance: {
    source: "user_uploaded" | "aigc_generated" | "fixture" | "source_video" | "sample_evidence";
    sampleDerived: boolean;
    renderable: boolean;
    notes?: string;
  };

  image?: {
    subject?: "product" | "person" | "scene" | "logo" | "screenshot" | "unknown";
    bboxNorm?: { x: number; y: number; w: number; h: number };
    dominantColors?: string[];
    suitableFor: Array<"hero" | "card" | "background" | "cta" | "cover">;
  };

  video?: {
    shots: Array<{
      id: string;
      startSec: number;
      endSec: number;
      motionScore: number;
      suitableFor: Array<"opening" | "demo" | "proof" | "transition" | "cta">;
    }>;
    highlights: Array<{ startSec: number; endSec: number; reason: string }>;
  };

  textFeatures?: {
    sellingPoints: string[];
    ctaCandidates: string[];
    keywords: string[];
    subtitleCandidates: string[];
  };
};
```

## 5. GapReport

```ts
export type GapReport = {
  version: "gap-report-v4";
  gaps: Array<{
    id: string;
    slotId: string;
    atomId?: string;
    status: "matched" | "weak_match" | "missing";
    requiredAsset: string;
    matchedAssetIds: string[];
    reason: string;
    impact: "low" | "medium" | "high";
    repairOptions: Array<{
      type: "structure_reorder" | "text_fill" | "packaging_fill" | "aigc_fill" | "asset_reuse" | "procedural_motion";
      description: string;
      selected: boolean;
      expectedVisualResult: string;
    }>;
  }>;
};
```

## 6. RenderRecipe v4

```ts
export type RenderRecipe = {
  version: "render-recipe-v4";

  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
  };

  productTheme: {
    productName: string;
    brandName?: string;
    brief?: string;
    sellingPoints: string[];
    ctaText: string;
    generationPrompt?: string;
  };

  sourcePolicy: {
    sampleUse: "structure_evidence_only" | "authorized_reuse";
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
    sourceVideoUse: "missing" | "renderable_user_material";
    targetAssetUse: "renderable_target_material" | "missing";
  };

  evidenceSummary: {
    sourceSampleIds: string[];
    preservedEvidence: {
      visualElements: number;
      typographyRuns: number;
      motionAtoms: number;
      audioLayers: number;
    };
    droppedEvidence: Array<{ kind: string; stage: string; reason: string; severity: "info" | "warn" | "fatal" }>;
  };

  clips: Array<{
    id: string;
    role: "hook" | "setup" | "proof" | "demo" | "benefit" | "transition" | "cta";
    startSec: number;
    durationSec: number;
    atomIds: string[];
    layerIds: string[];
    primitiveReason: string;
    evidenceRefs: string[];
  }>;

  layers: Array<MediaLayer | TextLayer | ShapeLayer | MotionAtomLayer | TransitionLayer | AudioLayer>;
  warnings: string[];
};
```

## 7. Layer Types

### MediaLayer

```ts
export type MediaLayer = {
  id: string;
  type: "media";
  clipId: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  material: {
    kind: "source_video" | "target_image" | "target_image_set" | "generated_target_asset" | "procedural";
    assetIds: string[];
    sourceShotIds?: string[];
    policy: "renderable" | "missing" | "evidence_only";
    provenance: "user_uploaded" | "aigc_generated" | "source_video" | "fixture";
  };
  layout: {
    bboxNorm?: { x: number; y: number; w: number; h: number };
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
  evidenceRefs: string[];
};
```

### TextLayer

```ts
export type TextLayer = {
  id: string;
  type: "text";
  clipId: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  text: {
    content: string;
    role: "headline" | "subtitle" | "badge" | "selling_point" | "cta" | "price";
    maxChars?: number;
  };
  layout: {
    bboxNorm: { x: number; y: number; w: number; h: number };
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
  evidenceRefs: string[];
};
```

### MotionAtomLayer

```ts
export type MotionAtomLayer = {
  id: string;
  type: "motion_atom";
  clipId?: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
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
  evidenceRefs: string[];
};
```

### AudioLayer

```ts
export type AudioLayer = {
  id: string;
  type: "audio";
  zIndex: number;
  startSec: number;
  durationSec: number;
  audio: {
    kind: "kick" | "bass" | "hat" | "drone" | "riser" | "impact" | "voice" | "music";
    policy: "procedural" | "user_audio" | "licensed" | "missing";
    weight: number;
    bpm?: number;
    accentPattern?: number[];
    atSec?: number[];
    densityCurve?: Array<{ t: number; value: number }>;
  };
  evidenceRefs: string[];
};
```

## 8. Compatibility Rules

1. Existing `recipe.clips[]` remains valid.
2. If `layers[]` exists, renderers should prefer layers.
3. If `layers[]` is missing, compile a best-effort layer view from old clips.
4. New fields should be optional where possible during migration, but gates should fail for learned sample cases if required evidence is missing.
