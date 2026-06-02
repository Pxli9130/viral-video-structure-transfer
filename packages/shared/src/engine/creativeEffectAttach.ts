// attachCreativeEffectToRenderRecipe — backward-compatible migration helper. Given a recipe, a
// CreativeEffectSpec and an EffectSelectionResult, it derives normalized, props-only effect runtime
// props from the recipe/layers/context and attaches the optional effect fields. Never leaks sample
// file paths. Old recipes are unaffected unless this is called.

import type { RenderRecipe } from "../types.js";
import {
  MOTIF_DEFAULT_COLORS,
  looksLikeSamplePath,
  type CreativeEffectRuntimeProps,
  type CreativeEffectSpec,
  type MotifFamily
} from "./creativeEffectSpec.js";
import type { EffectSelectionResult } from "./effectRegistry.js";

export interface AttachEffectContext {
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  beats?: number[];
  stylePack?: unknown;
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function proceduralBeats(durationSec: number, bpm: number): number[] {
  const safeBpm = bpm > 40 && bpm < 300 ? bpm : 120;
  const interval = 60 / safeBpm;
  const beats: number[] = [];
  for (let t = 0; t < durationSec && beats.length < 256; t += interval) beats.push(Number(t.toFixed(3)));
  return beats;
}

function collectTexts(recipe: RenderRecipe): CreativeEffectRuntimeProps["texts"] {
  const out: NonNullable<CreativeEffectRuntimeProps["texts"]> = [];
  const seen = new Set<string>();
  const push = (text: unknown, role: string) => {
    if (typeof text !== "string") return;
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed) || looksLikeSamplePath(trimmed)) return;
    seen.add(trimmed);
    out.push({ text: trimmed, role });
  };
  const theme = recipe.productTheme;
  push(theme?.name, "product_name");
  push(theme?.ctaText ?? theme?.cta, "cta");
  for (const point of theme?.sellingPoints ?? []) push(point, "selling_point");
  for (const clip of recipe.clips ?? []) push(clip.text?.copy, "clip_copy");
  for (const layer of recipe.layers ?? []) {
    const text = (layer as { text?: { content?: unknown; copy?: unknown } }).text;
    push(text?.content ?? text?.copy, "layer_text");
  }
  return out;
}

function collectAssets(recipe: RenderRecipe): CreativeEffectRuntimeProps["assets"] {
  const out: NonNullable<CreativeEffectRuntimeProps["assets"]> = [];
  const seen = new Set<string>();
  const push = (id: unknown, role: string, type?: string) => {
    if (typeof id !== "string" || !id || seen.has(id) || looksLikeSamplePath(id)) return;
    seen.add(id);
    out.push({ id, role, ...(type ? { type } : {}) });
  };
  for (const clip of recipe.clips ?? []) {
    const material = clip.material;
    if (material && material.kind !== "source_video") {
      for (const assetId of material.assetIds ?? []) push(assetId, clip.role ?? "clip", material.kind);
    }
  }
  for (const layer of recipe.layers ?? []) {
    const material = (layer as { type?: string; material?: { assetIds?: string[] } }).material;
    if (layer && (layer as { type?: string }).type === "media") {
      for (const assetId of material?.assetIds ?? []) push(assetId, "media_layer", "media");
    }
  }
  return out;
}

/** Build normalized, sample-safe runtime props for an effect from the recipe + context. */
export function buildEffectRuntimeProps(
  recipe: RenderRecipe,
  motifFamily: MotifFamily,
  context: AttachEffectContext = {}
): CreativeEffectRuntimeProps {
  const width = context.width ?? recipe.global?.width ?? recipe.composition?.width ?? 720;
  const height = context.height ?? recipe.global?.height ?? recipe.composition?.height ?? 1280;
  const fps = context.fps ?? recipe.global?.fps ?? recipe.composition?.fps ?? 30;
  const durationSec = context.durationSec ?? recipe.global?.durationSec ?? recipe.composition?.durationSec ?? 15;

  const paletteColors = (recipe.global?.palette ?? []).filter((c): c is string => typeof c === "string" && HEX_RE.test(c));
  const colors = paletteColors.length ? paletteColors : MOTIF_DEFAULT_COLORS[motifFamily];

  const beatGrid = (recipe.global?.beatGridSec ?? []).filter((b): b is number => typeof b === "number" && Number.isFinite(b));
  const beats = beatGrid.length ? beatGrid : context.beats?.length ? context.beats : proceduralBeats(durationSec, recipe.global?.bpm ?? 120);

  return {
    width,
    height,
    fps,
    durationSec,
    assets: collectAssets(recipe),
    texts: collectTexts(recipe),
    colors,
    beats,
    ...(context.stylePack !== undefined ? { stylePack: context.stylePack } : {}),
    productTheme: recipe.productTheme
  };
}

/**
 * Attach the creative-effect selection + derived props to a RenderRecipe (returns a new recipe).
 * Backward-compatible: only adds optional fields. effectPropsById maps each selected program id to
 * the shared normalized runtime props.
 */
export function attachCreativeEffectToRenderRecipe(
  recipe: RenderRecipe,
  spec: CreativeEffectSpec,
  selection: EffectSelectionResult,
  context: AttachEffectContext = {}
): RenderRecipe {
  const motifFamily = selection.motifFamily ?? spec.motifFamily;
  const runtimeProps = buildEffectRuntimeProps(recipe, motifFamily, context);
  const effectPropsById: Record<string, CreativeEffectRuntimeProps> = {};
  for (const programId of selection.effectProgramIds) effectPropsById[programId] = runtimeProps;
  return {
    ...recipe,
    creativeEffectSpecId: spec.id,
    motifFamily,
    effectProgramIds: selection.effectProgramIds,
    effectPropsById,
    effectSelection: selection,
    ...(selection.fallbackReason ? { effectFallbackReason: selection.fallbackReason } : {})
  };
}
