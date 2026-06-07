// apps/api/remotion/v5/recipeTypes.ts
// LOCAL types mirroring contracts-v5 RenderRecipeV5, defined here so the Remotion browser bundle never
// imports @vvst/shared (which pulls node-only deps). Keep structurally in sync with
// packages/shared/src/contracts-v5/finalProgram.ts.

export type AssetMap = Record<string, { src: string; type?: "image" | "video" | string; ext?: string }>;

export type RenderLayerType =
  | "media"
  | "generated_visual"
  | "text"
  | "shape"
  | "motion"
  | "transition"
  | "packaging"
  | "audio"
  | "debug";

// ---- Motion system (so the recipe expresses real animation, not just a static layer) ----
export interface LayerMotion {
  intro?: { type?: "pop" | "slide_up" | "slide_left" | "wipe" | "blur_in" | "scale_rotate"; durationSec?: number };
  loop?: { type?: "float" | "drift" | "pulse" | "ken_burns" | "parallax" | "sway"; amplitude?: number; speed?: number };
  /** Beat-synced visual hits at absolute times (seconds) — drives scale pops / flashes / whips. */
  beatTriggers?: Array<{ t: number; action?: "scale_hit" | "flash" | "shake" | "whip" | "color_pulse"; intensity?: number }>;
  outro?: { type?: "whip" | "flash" | "zoom_out" | "fade"; durationSec?: number };
}
export interface ImageTreatment {
  preset?: "ken_burns" | "duotone" | "spotlight" | "masked_reveal" | "static";
  tint?: string;
  mask?: "none" | "circle" | "diagonal" | "rounded";
  zoom?: number;
  panX?: number;
  panY?: number;
}
export interface KineticText {
  split?: "word" | "char" | "line";
  preset?: "beat_cut" | "slam" | "type_pulse" | "tracking_expand" | "rise";
  beatTimes?: number[];
  emphasisWords?: string[];
}

export interface RenderLayerV5 {
  id: string;
  type: RenderLayerType;
  sectionId?: string;
  startSec: number;
  endSec: number;
  assetId?: string;
  text?: string;
  style?: Record<string, unknown> & { imageTreatment?: ImageTreatment; kineticText?: KineticText };
  motion?: LayerMotion;
  fallbackReason?: string;
}

export interface AudioLayerV5 {
  id: string;
  kind: string;
  uri?: string;
  startSec: number;
  endSec?: number;
  gainDb?: number;
}

export interface RenderRecipeV5 {
  version: "render-recipe-v5";
  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
    background?: string;
  };
  layers: RenderLayerV5[];
  audioLayers: AudioLayerV5[];
  assets: Array<{ id: string; uri: string }>;
  explanations?: string[];
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
