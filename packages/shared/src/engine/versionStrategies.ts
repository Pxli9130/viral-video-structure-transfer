import type {
  GenerationRequest,
  RenderRecipe,
  RenderRecipeAudioLayer,
  RenderRecipeLayer,
  RenderRecipeMotionAtomLayer,
  RenderRecipeTextLayer,
  VersionDiff,
  VersionDiffItem,
  VersionStrategy
} from "../types.js";

export interface RecipeVersionResult {
  strategy: VersionStrategy;
  recipe: RenderRecipe;
  diff: VersionDiff;
}

const VERSION_PROMPTS: Record<VersionStrategy, string> = {
  high_click: "High-click version: shorter hook, larger opening text, stronger motion/audio accents, CTA visible earlier.",
  high_conversion: "High-conversion version: product info and proof appear earlier, CTA stays visible longer, selling points are benefit-first.",
  high_quality: "High-quality version: fewer subtitles, smoother motion, softer audio, cleaner packaging."
};

function cloneRecipe(recipe: RenderRecipe): RenderRecipe {
  return JSON.parse(JSON.stringify(recipe)) as RenderRecipe;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function textLayers(recipe: RenderRecipe): RenderRecipeTextLayer[] {
  return (recipe.layers ?? []).filter((layer): layer is RenderRecipeTextLayer => layer.type === "text");
}

function motionLayers(recipe: RenderRecipe): RenderRecipeMotionAtomLayer[] {
  return (recipe.layers ?? []).filter((layer): layer is RenderRecipeMotionAtomLayer => layer.type === "motion_atom");
}

function audioLayers(recipe: RenderRecipe): RenderRecipeAudioLayer[] {
  return (recipe.layers ?? []).filter((layer): layer is RenderRecipeAudioLayer => layer.type === "audio");
}

function scaleLayerDuration(layer: RenderRecipeLayer, scale: number, min = 0.35): void {
  layer.durationSec = round(Math.max(min, layer.durationSec * scale));
}

function pushDiff(out: VersionDiffItem[], item: VersionDiffItem): void {
  if (!out.some((existing) => existing.dimension === item.dimension)) out.push(item);
}

function moveLayerEarlier(layer: RenderRecipeLayer, deltaSec: number): void {
  layer.startSec = round(Math.max(0, layer.startSec - deltaSec));
}

export function applyVersionStrategyToRequest(request: GenerationRequest, strategy: VersionStrategy): GenerationRequest {
  const controls = request.controls ?? {};
  const patched: Partial<GenerationRequest["controls"]> =
    strategy === "high_click"
      ? { pace: "fast", hookIntensity: "aggressive", ctaStyle: "direct", subtitleDensity: "dense", packagingStyle: "mg_motion" }
      : strategy === "high_conversion"
        ? { pace: "medium", hookIntensity: "strong", ctaStyle: "direct", ctaTiming: "early", subtitleDensity: "dense", packagingStyle: "bold" }
        : { pace: "slow", hookIntensity: "safe", ctaStyle: "soft", subtitleDensity: "minimal", packagingStyle: "clean", stylePreset: "clean_premium" };
  return {
    ...request,
    controls: { ...controls, ...patched },
    prompt: `${request.prompt}\n[versionStrategy=${strategy}]: ${VERSION_PROMPTS[strategy]}`
  };
}

export function applyVersionStrategyToRecipe(recipe: RenderRecipe, strategy: VersionStrategy): RecipeVersionResult {
  const next = cloneRecipe(recipe);
  const changes: VersionDiffItem[] = [];
  const texts = textLayers(next);
  const motions = motionLayers(next);
  const audios = audioLayers(next);
  const hookClip = next.clips.find((clip) => clip.role === "hook") ?? next.clips[0];
  const ctaClip = next.clips.find((clip) => clip.role === "cta");
  const ctaLayers = (next.layers ?? []).filter((layer) => layer.clipId === ctaClip?.clipId || layer.id.toLowerCase().includes("cta"));

  if (strategy === "high_click") {
    if (hookClip) {
      const before = hookClip.durationSec ?? hookClip.endSec - hookClip.startSec;
      hookClip.durationSec = round(Math.max(0.6, before * 0.82));
      hookClip.endSec = round(hookClip.startSec + hookClip.durationSec);
      for (const layer of next.layers ?? []) if (layer.clipId === hookClip.clipId) scaleLayerDuration(layer, 0.82);
      pushDiff(changes, { dimension: "hook_duration", before, after: hookClip.durationSec, reason: "High-click trims the opening to reach the first proof faster." });
    }
    for (const layer of texts.slice(0, 2)) layer.typography.fontSizeRatio = round(Math.min(0.18, layer.typography.fontSizeRatio * 1.16));
    pushDiff(changes, { dimension: "text_density", before: "baseline", after: "larger opening text", reason: "High-click makes the hook easier to read while scrolling." });
    for (const layer of motions) {
      if (layer.atom.kind === "parametric_ribbon_surface") layer.atom.opacity = round(Math.min(0.9, layer.atom.opacity * 1.18));
    }
    pushDiff(changes, { dimension: "motion_intensity", before: "baseline", after: "stronger motion atom opacity", reason: "High-click increases visual energy." });
    for (const layer of audios) if (layer.audio.kind === "impact" || layer.audio.kind === "riser") layer.audio.weight = round(Math.min(1, layer.audio.weight + 0.18));
    pushDiff(changes, { dimension: "audio_density", before: "baseline", after: "more impact/riser", reason: "High-click adds stronger audio accents." });
    for (const layer of ctaLayers) moveLayerEarlier(layer, 0.8);
    if (ctaLayers.length) pushDiff(changes, { dimension: "cta_placement", before: "baseline", after: "0.8s earlier", reason: "CTA enters earlier for click intent." });
  } else if (strategy === "high_conversion") {
    const before = [...next.productTheme.sellingPoints];
    next.productTheme.sellingPoints = [...next.productTheme.sellingPoints].sort((a, b) => {
      const score = (text: string) => (/快|强|省|低|降|充|quiet|fast|save/i.test(text) ? 0 : 1);
      return score(a) - score(b);
    });
    pushDiff(changes, { dimension: "selling_point_order", before, after: next.productTheme.sellingPoints, reason: "High-conversion puts concrete benefits before softer claims." });
    for (const layer of (next.layers ?? []).filter((layer) => layer.type === "media" || layer.type === "text").slice(1, 4)) moveLayerEarlier(layer, 0.9);
    pushDiff(changes, { dimension: "cta_placement", before: "baseline", after: "product/proof layers 0.9s earlier", reason: "Product information appears earlier." });
    for (const layer of ctaLayers) layer.durationSec = round(layer.durationSec * 1.25);
    if (ctaLayers.length) pushDiff(changes, { dimension: "hook_duration", before: "baseline CTA", after: "longer CTA hold", reason: "Conversion version holds action intent longer." });
    for (const layer of texts) if (layer.text.role === "selling_point" || layer.text.role === "subtitle") layer.typography.fontSizeRatio = round(Math.min(0.15, layer.typography.fontSizeRatio * 1.08));
    pushDiff(changes, { dimension: "text_density", before: "baseline", after: "benefit text emphasized", reason: "Conversion version increases legibility for claims." });
  } else {
    const beforeCount = texts.length;
    const removable = new Set(texts.filter((layer) => layer.text.role === "subtitle").filter((_, index) => index % 2 === 1).map((layer) => layer.id));
    next.layers = (next.layers ?? []).filter((layer) => !removable.has(layer.id));
    pushDiff(changes, { dimension: "text_density", before: beforeCount, after: textLayers(next).length, reason: "High-quality reduces subtitle clutter." });
    for (const layer of motionLayers(next)) {
      if (layer.atom.kind === "parametric_ribbon_surface") {
        layer.atom.opacity = round(Math.max(0.28, layer.atom.opacity * 0.72));
        layer.atom.twist = round(Math.max(0.12, layer.atom.twist * 0.72));
      }
    }
    pushDiff(changes, { dimension: "motion_intensity", before: "baseline", after: "softer opacity/twist", reason: "High-quality uses smoother motion." });
    for (const layer of audioLayers(next)) {
      if (layer.audio.kind === "hat" || layer.audio.kind === "impact") layer.audio.weight = round(Math.max(0.05, layer.audio.weight * 0.62));
      if (layer.audio.kind === "drone" || layer.audio.kind === "music") layer.audio.weight = round(Math.min(1, layer.audio.weight + 0.12));
    }
    pushDiff(changes, { dimension: "audio_density", before: "baseline", after: "softer hats/impact and more bed", reason: "High-quality makes audio less aggressive." });
    next.global.palette = Array.from(new Set(["#f8fafc", "#0f172a", "#14b8a6", ...next.global.palette])).slice(0, 8);
    pushDiff(changes, { dimension: "packaging_style", before: "baseline palette", after: "clean premium palette", reason: "High-quality shifts to cleaner packaging." });
  }

  const diff: VersionDiff = {
    strategy,
    summary: VERSION_PROMPTS[strategy],
    changedDimensions: changes
  };
  next.versionStrategy = strategy;
  next.versionDiff = diff;
  next.warnings = Array.from(new Set([...(next.warnings ?? []), `versionStrategy=${strategy}`]));
  return { strategy, recipe: next, diff };
}

export function buildRecipeVersions(recipe: RenderRecipe, strategies: VersionStrategy[] = ["high_click", "high_conversion", "high_quality"]): RecipeVersionResult[] {
  return strategies.map((strategy) => applyVersionStrategyToRecipe(recipe, strategy));
}
