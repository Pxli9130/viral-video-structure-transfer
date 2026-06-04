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

export interface RenderLayerV5 {
  id: string;
  type: RenderLayerType;
  sectionId?: string;
  startSec: number;
  endSec: number;
  assetId?: string;
  text?: string;
  style?: Record<string, unknown>;
  motion?: Record<string, unknown>;
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
