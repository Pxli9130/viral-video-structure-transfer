// contracts-v5/templateCapsule.ts
// "Same Template Reconstruction Mode" (V5.1) contracts. Gen1 produces a reusable, props-driven Remotion
// template (RemotionTemplateCapsule) that reconstructs a sample's STRUCTURE/timing/motion/typography/
// transitions/audio-cues — never its content. The default generation mode reuses the template code with
// new theme/assets + auto AIGC gap fill. Safety boundary: template CODE is reusable; sample PIXELS/
// AUDIO/TEXT/LOGO are NOT.

import type { AssetRecipeV5, AudioRecipeV5 } from "./common.js";
import type { CreativeBriefV5 } from "./common.js";
import type { KnowledgeElement } from "./knowledge.js";

export type TemplateSectionRole = "hook" | "setup" | "benefit" | "proof" | "demo" | "transition" | "cta" | "other";

export type TemplateSlotKind =
  | "hero_image"
  | "product_image"
  | "background_image"
  | "logo"
  | "headline"
  | "subtitle"
  | "cta_text"
  | "voiceover"
  | "music"
  | "sfx"
  | "data_value"
  | "ui_mockup"
  | "other";

export type TemplateSlotReplacementPolicy =
  | "user_asset"
  | "aigc_generate"
  | "text_generate"
  | "procedural_generate"
  | "optional";

export interface TemplateSlot {
  id: string;
  kind: TemplateSlotKind;
  required: boolean;
  /** The role this slot played in the original sample (e.g. "opening hero head"). */
  originalRole: string;
  replacementPolicy: TemplateSlotReplacementPolicy;
  /** Path into boundProps where this slot's content is injected (e.g. "assets.heroImage"). */
  propPath?: string;
  /** Human/AIGC description of what this slot shows (from the Gen1 model's assetPlan). */
  description?: string;
  /** For AI-reconstructed footage slots ("missing 素材" the code can't draw itself): whether the
   *  AIGC fill should be a still image (ken-burns) or a real moving video (text-to-video / Seedance). */
  mediaKind?: "image" | "video";
  /** Ready-to-use AIGC prompt that recreates this footage in a copyright-safe, theme-appropriate way. */
  aigcPrompt?: string;
  /** Camera / motion hint (e.g. "slow push-in", "whip pan") for ken-burns or t2v. */
  motionHint?: string;
}

export interface RemotionTemplateCapsule {
  id: string;
  sourceSampleId: string;
  /** Project that learned this capsule — enables per-project KB scoping (optional/global if absent). */
  projectId?: string;
  /** Content-neutral per-scene visual recipes — what makes this capsule reconstruct ITS source's look. */
  sceneRecipes?: SceneVisualRecipeV5[];
  name: string;
  description?: string;
  tags: string[];

  codeBundle: {
    files: Array<{ path: string; content: string }>;
    entryFile: string;
    componentName: string;
  };

  propsSchema: Record<string, unknown>;
  slotSchema: TemplateSlot[];

  timingSignature: {
    durationSec: number;
    fps: number;
    sections: Array<{
      id: string;
      role: TemplateSectionRole;
      startSec: number;
      endSec: number;
      internalBeats: number[];
    }>;
  };

  motionSignature: {
    motifs: string[];
    transitionTypes: string[];
    typographyAnimationTypes: string[];
    beatSyncedCueCount: number;
    activeMotionCoverage?: number;
  };

  assetRecipes: AssetRecipeV5[];
  audioRecipes: AudioRecipeV5[];

  fixtures: {
    neutralFixture: Record<string, unknown>;
    samplePreviewFixture?: Record<string, unknown>;
    exampleThemeFixture?: Record<string, unknown>;
  };

  safety: {
    sampleVideoPassthroughAllowed: false;
    samplePixelsReusable: false;
    sampleAudioReusable: false;
    sampleTextReusable: false;
    onlyTemplateCodeReusable: true;
  };

  quality: {
    compilePassed: boolean;
    renderPreviewPassed: boolean;
    reconstructionFidelityScore?: number;
    noCopyTemplatePassed: boolean;
    /** Honest provenance of codeBundle: "ai" = Gemini TSX promoted through the gates; else deterministic. */
    codeOrigin?: "ai" | "deterministic";
    /** How the per-scene recipes were derived: cv2 keyframes, VLM, or role-varied fallback. */
    recipeSource?: "vlm" | "cv2" | "fallback";
    warnings: string[];
  };
}

export interface LearningOutput {
  sampleId: string;
  evidenceArtifactId?: string;
  templateCapsule: RemotionTemplateCapsule;
  elements: KnowledgeElement[];
  reconstructionPreview?: {
    neutralPreviewMp4?: string;
    fidelityScore?: number;
    warnings: string[];
  };
}

// ---- Generation modes + options ----

export type GenerationMode = "same_template" | "modify_template" | "mix_elements";
export type AigcGapFillMode = "auto_on" | "off" | "ask";

export interface GenerationOptionsV5 {
  generationMode: GenerationMode; // default: same_template
  templateCapsuleId?: string;
  selectedElementIds?: string[];

  aigcGapFill: {
    mode: AigcGapFillMode; // default: auto_on
    imageFill: "aigc" | "procedural" | "off";
    audioFill: "aigc" | "procedural" | "off";
    textFill: "llm" | "off";
  };

  fallbackPolicy: {
    allowTextCardFallback: boolean;
    allowProceduralVisualFallback: boolean;
    downgradeIfMissingRequiredSlots: boolean;
  };
}

export const DEFAULT_GENERATION_OPTIONS_V5: GenerationOptionsV5 = {
  generationMode: "same_template",
  aigcGapFill: {
    mode: "auto_on",
    imageFill: "aigc",
    audioFill: "procedural",
    textFill: "llm"
  },
  fallbackPolicy: {
    allowTextCardFallback: true,
    allowProceduralVisualFallback: true,
    downgradeIfMissingRequiredSlots: true
  }
};

// ---- Template binding / instance ----

export type SlotBindingStatus =
  | "user_asset"
  | "aigc_generated"
  | "text_generated"
  | "procedural_generated"
  | "missing";

export interface TemplateSlotBinding {
  slotId: string;
  status: SlotBindingStatus;
  assetId?: string;
  /** Resolved renderable uri (target/generated only — never a sample path). */
  uri?: string;
  text?: string;
  audioId?: string;
  provenance?: Record<string, unknown>;
  warnings: string[];
}

// ---- Per-scene content-neutral visual recipe (source-faithful reconstruction) ----
// Captures HOW each source scene looks (positions / motion / grading) — NEVER pixels or copied text —
// so the generated template reconstructs the source's composition, not a generic gradient+card family.
export type AnchorV5 =
  | "top_left" | "top_center" | "top_right"
  | "center_left" | "center" | "center_right"
  | "bottom_left" | "bottom_center" | "bottom_right";
export type CameraMoveV5 = "static" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down";
export type TransitionInV5 = "hard_cut" | "dissolve" | "fade_from_black" | "slide_left" | "slide_right" | "whip_pan" | "zoom_in" | "flash";
export type GradingMoodV5 = "neutral" | "dark_moody" | "high_key" | "warm" | "cool" | "high_contrast" | "desaturated" | "vibrant";
export type TextAnimV5 = "none" | "per_char_reveal" | "word_stagger" | "pop" | "scale" | "flash" | "slide_up";

/**
 * Rich CONTENT-NEUTRAL per-scene detail from a VLM looking at the source keyframe — describes the
 * STRUCTURE (composition, layout zones, motion-graphics elements, typography style, treatment) so the
 * codegen can reconstruct the actual look, NOT a generic card. Never contains the sample's readable
 * text, brand names, or identifiable subjects.
 */
export interface SceneVlmDetailV5 {
  composition: string;
  layoutZones: string[];
  graphicElements: string[];
  typography: { position?: string; sizeClass?: string; weight?: string; case?: string; alignment?: string; animation?: string };
  treatment: string;
}

export interface SceneVisualRecipeV5 {
  sectionId: string;
  role: string;
  /** How this scene enters (derived from cut/shot boundary + motion). */
  transitionIn: TransitionInV5;
  /** Dominant subject placement + camera behaviour (content-neutral). */
  subject?: { anchor: AnchorV5; areaRatio: number; cameraMove: CameraMoveV5; motionIntensity: number };
  /** Where on-screen copy sits + how it animates (position/animation only, NEVER the sample's text). */
  textAnchor: AnchorV5;
  textAnim: TextAnimV5;
  /** Per-scene colour grading (the source's colour world) — drives the rendered look. */
  grading: { mood: GradingMoodV5; brightness: number; saturation: number; palette: string[] };
  /** Rich VLM structural detail (when VLM analysis is enabled). */
  vlm?: SceneVlmDetailV5;
  source: "deterministic" | "vlm";
  confidence: number;
}

/** A patch-first revision of a same_template generation (the modify_template mode). */
export interface TemplatePatchSet {
  /** New theme string (re-themes the template). */
  theme?: string;
  /** Override the runtime palette. */
  palette?: string[];
  /** propKey (e.g. "headline") -> new copy text. */
  copyOverrides?: Record<string, string>;
  /** When true, the route runs a FRESH generation (new visuals) instead of a copy/theme-only revise. */
  regenerateImages?: boolean;
}

export interface TemplateInstance {
  id: string;
  templateCapsuleId: string;
  creativeBrief: CreativeBriefV5;
  boundProps: Record<string, unknown>;
  slotBindings: TemplateSlotBinding[];
  gapReportId: string;
  readinessImpact: {
    missingRequiredSlotCount: number;
    usedFallbackCount: number;
    readinessLevel: "technical_demo" | "review_demo" | "shippable_candidate";
    warnings: string[];
  };
}

// ---- Template validation ----

export interface TemplateGateResult {
  id: string;
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface TemplateValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  gates: TemplateGateResult[];
}
