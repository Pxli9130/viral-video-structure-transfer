import type { RecipePatchOperation, RenderRecipe, RenderRecipeAudioLayer, RenderRecipeLayer, RenderRecipeMotionAtomLayer, RenderRecipeTextLayer } from "../types.js";
import { naturalEditToRecipePatch } from "./naturalLanguageEdit.js";
import { lintRenderRecipe } from "./recipeLint.js";

export type NaturalEditPatchPlan = {
  intent: string;
  patches: unknown[];
  renderNeeded: boolean;
  explanationZh: string;
  safetyChecked: boolean;
  updatedRecipe?: RenderRecipe;
};

function inferIntent(command: string): string {
  if (/开头|hook|抓人/.test(command)) return "stronger_opening";
  if (/减少|字幕|节奏/.test(command)) return "less_text_more_rhythm";
  if (/商品|产品|卖点|信息.*提前|提前/.test(command)) return "product_info_earlier";
  if (/结尾|CTA|cta|明显/.test(command)) return "stronger_cta";
  if (/高级|质感|premium|更干净/.test(command)) return "premium_quality";
  return "unrecognized";
}

function normalizeCommand(command: string): string {
  const intent = inferIntent(command);
  if (intent === "stronger_cta") return `${command} CTA 提前 更直接`;
  if (intent === "premium_quality") return `${command} 减少字幕 高质感风格 ribbon 更慢 高级`;
  return command;
}

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

function moveLayer(layer: RenderRecipeLayer, deltaSec: number): void {
  layer.startSec = round(Math.max(0, layer.startSec + deltaSec));
}

function deterministicFallbackPatch(command: string, recipe: RenderRecipe): { recipe: RenderRecipe; operations: RecipePatchOperation[]; renderNeeded: boolean; summary: string } {
  const intent = inferIntent(command);
  const updated = cloneRecipe(recipe);
  const operations: RecipePatchOperation[] = [];
  if (intent === "stronger_cta") {
    const ctaClip = updated.clips.find((clip) => clip.role === "cta") ?? updated.clips[updated.clips.length - 1];
    const ctaLayers = textLayers(updated).filter((layer) => layer.text.role === "cta" || layer.clipId === ctaClip?.clipId);
    if (ctaClip) {
      const before = ctaClip.durationSec ?? ctaClip.endSec - ctaClip.startSec;
      ctaClip.startSec = round(Math.max(0, ctaClip.startSec - 0.6));
      ctaClip.durationSec = round(Math.max(before, before * 1.18));
      ctaClip.endSec = round(ctaClip.startSec + ctaClip.durationSec);
      operations.push({ op: "move", path: `/clips/${ctaClip.clipId}`, value: { startSec: ctaClip.startSec, durationSec: ctaClip.durationSec }, reason: "结尾 CTA 更早出现并停留更久。" });
    }
    for (const layer of ctaLayers) {
      const before = layer.typography.fontSizeRatio;
      layer.typography.fontSizeRatio = round(Math.min(0.18, before * 1.22));
      layer.typography.colorRole = "accent";
      layer.animation.enter = layer.animation.enter === "none" ? "pop" : layer.animation.enter ?? "pop";
      layer.durationSec = round(layer.durationSec * 1.18);
      moveLayer(layer, -0.6);
      operations.push({ op: "scale", path: `/layers/${layer.id}/cta_emphasis`, value: { fontSizeRatio: layer.typography.fontSizeRatio, colorRole: "accent" }, reason: "CTA 文案变大、对比更强。" });
    }
  }
  if (intent === "premium_quality") {
    const removable = new Set(textLayers(updated).filter((layer) => layer.text.role === "subtitle").filter((_, index) => index % 2 === 1).map((layer) => layer.id));
    if (removable.size) {
      updated.layers = (updated.layers ?? []).filter((layer) => !removable.has(layer.id));
      operations.push({ op: "remove", path: "/layers[text.role=subtitle every_other]", value: Array.from(removable), reason: "整体更高级：减少字幕密度。" });
    }
    for (const layer of motionLayers(updated)) {
      if (layer.atom.kind === "parametric_ribbon_surface") {
        layer.atom.opacity = round(Math.max(0.28, layer.atom.opacity * 0.72));
        layer.atom.twist = round(Math.max(0.12, layer.atom.twist * 0.72));
        operations.push({ op: "scale", path: `/layers/${layer.id}/atom`, value: { opacity: layer.atom.opacity, twist: layer.atom.twist }, reason: "整体更高级：降低运动噪声。" });
      }
    }
    for (const layer of audioLayers(updated)) {
      if (layer.audio.kind === "hat" || layer.audio.kind === "impact") layer.audio.weight = round(Math.max(0.05, layer.audio.weight * 0.65));
    }
    updated.global.palette = Array.from(new Set(["#f8fafc", "#0f172a", "#14b8a6", ...updated.global.palette])).slice(0, 8);
    operations.push({ op: "replace", path: "/global/palette", value: updated.global.palette, reason: "整体更高级：使用更干净的配色。" });
  }
  updated.warnings = Array.from(new Set([...(updated.warnings ?? []), `naturalEdit=${command}`]));
  return {
    recipe: updated,
    operations,
    renderNeeded: operations.length > 0,
    summary: operations.map((operation) => operation.reason).join(" ")
  };
}

export function planNaturalEditPatch(command: string, recipe: RenderRecipe): NaturalEditPatchPlan {
  const base = naturalEditToRecipePatch(normalizeCommand(command), recipe);
  const fallback = base.operations.length ? undefined : deterministicFallbackPatch(command, recipe);
  const updatedRecipe = fallback?.recipe ?? base.updatedRecipe;
  const operations = fallback?.operations ?? base.operations;
  const renderNeeded = fallback?.renderNeeded ?? base.renderNeeded;
  const summary = fallback?.summary ?? base.summary;
  const report = lintRenderRecipe(updatedRecipe);
  const sourcePolicyIntact =
    updatedRecipe.sourcePolicy.sampleFrameCopyAllowed === false &&
    updatedRecipe.sourcePolicy.sampleAudioCopyAllowed === false &&
    updatedRecipe.sourcePolicy.sampleUse === recipe.sourcePolicy.sampleUse;
  const safetyChecked = report.status !== "fail" && sourcePolicyIntact;
  return {
    intent: inferIntent(command),
    patches: operations,
    renderNeeded,
    explanationZh: safetyChecked
      ? `已生成确定性改片补丁：${summary}`
      : `改片补丁未通过安全检查：${report.issues.map((issue) => issue.kind).join("、") || "sourcePolicy changed"}`,
    safetyChecked,
    updatedRecipe
  };
}
