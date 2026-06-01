import type {
  GenerationRequest,
  NaturalLanguageEditPlan,
  NaturalLanguageRecipePatch,
  RecipePatchOperation,
  RenderRecipe,
  RenderRecipeAudioLayer,
  RenderRecipeLayer,
  RenderRecipeMotionAtomLayer,
  RenderRecipeTextLayer,
  Timeline
} from "../types.js";

const RESEMBLE_SAMPLE = /(像原视频|更像样例|sample|高保真|贴近原片|贴近样例)/i;
const REMOVE_DEBUG = /(去掉|隐藏|不要).*(解释|调试|debug|phase|映射|mapping|说明性文字|解释性文字)/i;
const WHITE_PREMIUM = /(白底|白色背景|高质感风格|白底高质感|premium\s*poster|clean\s*poster|干净背景|极简白)/i;
const RIBBON_SLOW_PREMIUM = /(ribbon|彩带).*(慢|更慢|高级|高质感|克制|premium)/i;
const CTA_EARLY = /(cta|行动|引导|结尾).*(提前|更早|前置)/i;
const LESS_SUBTITLE = /(减少|降低|更少|少一点).*(字幕|文字|copy|caption)|视觉主导|增强视觉/i;
const SLOW_RHYTHM = /(放慢|更慢|慢一点|slower|slow).*(节奏|tempo|rhythm)?/i;
const FAST_RHYTHM = /(加快|更快|快一点|提速|fast).*(节奏|tempo|rhythm)?/i;
const SOFT_CTA = /(cta|结尾|引导).*(柔|缓|温和|soft)/i;
const DIRECT_CTA = /(cta|结尾|引导).*(直接|直白|强|strong|direct)/i;
const STRONGER_OPENING = /(开头|前[0-3三]秒|hook|钩子).*(抓人|更强|吸引|冲击|刺激)|抓人一些/i;
const LESS_TEXT_MORE_RHYTHM = /(减少|降低|更少|少一点).*(字幕|文字|copy|caption).*(节奏|动感|rhythm|beat)|增强节奏感/i;
const PRODUCT_INFO_EARLY = /(商品|产品|卖点|信息).*(提前|前置|更早)/i;

function cloneRecipe(recipe: RenderRecipe): RenderRecipe {
  return JSON.parse(JSON.stringify(recipe)) as RenderRecipe;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function recipeTextLayers(recipe: RenderRecipe): RenderRecipeTextLayer[] {
  return (recipe.layers ?? []).filter((layer): layer is RenderRecipeTextLayer => layer.type === "text");
}

function recipeMotionLayers(recipe: RenderRecipe): RenderRecipeMotionAtomLayer[] {
  return (recipe.layers ?? []).filter((layer): layer is RenderRecipeMotionAtomLayer => layer.type === "motion_atom");
}

function recipeAudioLayers(recipe: RenderRecipe): RenderRecipeAudioLayer[] {
  return (recipe.layers ?? []).filter((layer): layer is RenderRecipeAudioLayer => layer.type === "audio");
}

function pushOperation(ops: RecipePatchOperation[], op: RecipePatchOperation): void {
  ops.push(op);
}

function moveLayer(layer: RenderRecipeLayer, deltaSec: number): void {
  layer.startSec = round(Math.max(0, layer.startSec + deltaSec));
}

export function parseNaturalLanguageEdit(instruction: string): NaturalLanguageEditPlan {
  const operations: NaturalLanguageEditPlan["operations"] = [];
  const patchedControls: NaturalLanguageEditPlan["patchedControls"] = {};
  const reasons: string[] = [];

  if (RESEMBLE_SAMPLE.test(instruction)) {
    patchedControls.creativeMode = "high_fidelity_style";
    patchedControls.stylePreset = "sample_like";
    operations.push({ type: "change_output_mode", value: "high_fidelity_style", reason: "User asked to move closer to the sample visual grammar." });
    operations.push({ type: "change_style_preset", value: "sample_like", reason: "Use sample-style layout transfer without sample asset copy." });
    reasons.push("切到 high_fidelity_style");
  }

  if (REMOVE_DEBUG.test(instruction)) {
    patchedControls.creativeMode = patchedControls.creativeMode ?? "final_creative";
    operations.push({ type: "remove_debug_labels", value: true, reason: "Hide phase/mapping/gap explanation from the rendered creative video." });
    reasons.push("隐藏解释性文字");
  }

  if (WHITE_PREMIUM.test(instruction)) {
    patchedControls.packagingStyle = "clean";
    patchedControls.stylePreset = "white_poster";
    if (!patchedControls.creativeMode) patchedControls.creativeMode = "final_creative";
    operations.push({ type: "change_style_preset", value: "white_poster", reason: "Use white/off-white premium poster treatment." });
    reasons.push("白底高质感风格");
  }

  if (RIBBON_SLOW_PREMIUM.test(instruction)) {
    patchedControls.ribbon = { speedMultiplier: 0.72, densityMultiplier: 0.82, premiumFinish: true };
    patchedControls.packagingStyle = patchedControls.packagingStyle ?? "clean";
    operations.push({
      type: "adjust_ribbon",
      value: patchedControls.ribbon,
      reason: "Slow down and simplify ribbon motion while preserving the parametric motif."
    });
    reasons.push("ribbon 更慢更克制");
  }

  if (CTA_EARLY.test(instruction)) {
    patchedControls.ctaTiming = "early";
    operations.push({ type: "adjust_cta_timing", value: "early", reason: "Move CTA intent earlier in the reconstructed timeline." });
    reasons.push("CTA 前置");
  }

  if (SLOW_RHYTHM.test(instruction)) {
    patchedControls.pace = "slow";
    reasons.push("节奏放慢");
  } else if (FAST_RHYTHM.test(instruction)) {
    patchedControls.pace = "fast";
    reasons.push("节奏加快");
  }

  if (SOFT_CTA.test(instruction)) {
    patchedControls.ctaStyle = "soft";
    reasons.push("CTA 更柔和");
  } else if (DIRECT_CTA.test(instruction)) {
    patchedControls.ctaStyle = "direct";
    reasons.push("CTA 更直接");
  }

  if (LESS_SUBTITLE.test(instruction)) {
    patchedControls.subtitleDensity = "minimal";
    patchedControls.packagingStyle = patchedControls.packagingStyle ?? "clean";
    operations.push({ type: "reduce_subtitle_density", value: "minimal", reason: "Reduce text density and make visuals dominant." });
    reasons.push("减少字幕、增强视觉主导");
  }

  if (STRONGER_OPENING.test(instruction)) {
    patchedControls.hookIntensity = "aggressive";
    patchedControls.pace = patchedControls.pace ?? "fast";
    operations.push({ type: "change_style_preset", value: "strong_opening", reason: "Increase hook motion/text emphasis for a stronger opening." });
    reasons.push("开头更抓人");
  }

  if (LESS_TEXT_MORE_RHYTHM.test(instruction)) {
    patchedControls.subtitleDensity = "minimal";
    patchedControls.pace = "fast";
    operations.push({ type: "reduce_subtitle_density", value: "minimal", reason: "Reduce subtitle load and increase rhythmic emphasis." });
    reasons.push("字幕更少、节奏更强");
  }

  if (PRODUCT_INFO_EARLY.test(instruction)) {
    patchedControls.ctaTiming = "early";
    operations.push({ type: "adjust_cta_timing", value: "early", reason: "Move product/selling-point information earlier." });
    reasons.push("商品信息提前");
  }

  return {
    instruction,
    operations,
    patchedControls,
    promptAddendum: operations.length ? `Edit intent: ${instruction}` : undefined,
    summary: reasons.length ? `结构化改片：${reasons.join("；")}` : `未识别明确改片意图：${instruction}`
  };
}

export function naturalEditToRecipePatch(command: string, recipe: RenderRecipe): NaturalLanguageRecipePatch {
  const updated = cloneRecipe(recipe);
  const operations: RecipePatchOperation[] = [];
  const textLayers = recipeTextLayers(updated);
  const motionLayers = recipeMotionLayers(updated);
  const audioLayers = recipeAudioLayers(updated);
  const hookClip = updated.clips.find((clip) => clip.role === "hook") ?? updated.clips[0];

  if (STRONGER_OPENING.test(command)) {
    if (hookClip) {
      const before = hookClip.durationSec ?? hookClip.endSec - hookClip.startSec;
      const after = round(Math.min(before * 1.12, before + 0.8));
      hookClip.durationSec = after;
      hookClip.endSec = round(hookClip.startSec + after);
      pushOperation(operations, { op: "replace", path: `/clips/${hookClip.clipId}/durationSec`, value: after, reason: "Opening command increases hook hold slightly." });
      for (const layer of updated.layers ?? []) {
        if (layer.clipId === hookClip.clipId) layer.durationSec = round(Math.min(layer.durationSec * 1.12, layer.durationSec + 0.8));
      }
    }
    for (const layer of textLayers.filter((layer) => layer.clipId === hookClip?.clipId).slice(0, 2)) {
      const before = layer.typography.fontSizeRatio;
      layer.typography.fontSizeRatio = round(Math.min(0.18, before * 1.18));
      layer.animation.enter = layer.animation.enter === "none" ? "pop" : layer.animation.enter ?? "pop";
      pushOperation(operations, { op: "scale", path: `/layers/${layer.id}/typography/fontSizeRatio`, value: layer.typography.fontSizeRatio, reason: "Opening text becomes larger and more animated." });
    }
    for (const layer of motionLayers) {
      if (layer.atom.kind === "parametric_ribbon_surface") {
        layer.atom.opacity = round(Math.min(0.92, layer.atom.opacity * 1.16));
        layer.atom.twist = round(Math.min(1, layer.atom.twist * 1.12));
        pushOperation(operations, { op: "scale", path: `/layers/${layer.id}/atom`, value: { opacity: layer.atom.opacity, twist: layer.atom.twist }, reason: "Opening motion atom is made more intense." });
      }
    }
  }

  if (LESS_TEXT_MORE_RHYTHM.test(command)) {
    const removable = new Set(textLayers.filter((layer) => layer.text.role === "subtitle").filter((_, index) => index % 2 === 1).map((layer) => layer.id));
    if (removable.size) {
      updated.layers = (updated.layers ?? []).filter((layer) => !removable.has(layer.id));
      pushOperation(operations, { op: "remove", path: "/layers[text.role=subtitle every_other]", value: Array.from(removable), reason: "Reduce subtitle density while preserving headline/CTA text." });
    } else {
      for (const layer of textLayers.filter((layer) => layer.text.role === "subtitle")) {
        layer.durationSec = round(Math.max(0.35, layer.durationSec * 0.72));
      }
      pushOperation(operations, { op: "scale", path: "/layers[text.role=subtitle]/durationSec", value: 0.72, reason: "Shorten subtitle exposure when there are too few text layers to remove." });
    }
    for (const layer of audioLayers) {
      if (layer.audio.kind === "kick" || layer.audio.kind === "hat" || layer.audio.kind === "impact") {
        layer.audio.weight = round(Math.min(1, layer.audio.weight + 0.16));
      }
    }
    pushOperation(operations, { op: "scale", path: "/layers[type=audio]/rhythmicWeights", value: "+0.16 kick/hat/impact", reason: "Increase rhythm density." });
    for (const layer of motionLayers) {
      if (layer.atom.kind === "parametric_ribbon_surface") layer.atom.opacity = round(Math.min(0.9, layer.atom.opacity + 0.08));
    }
  }

  if (PRODUCT_INFO_EARLY.test(command)) {
    const productLayers = (updated.layers ?? []).filter((layer) =>
      layer.type === "media" ||
      (layer.type === "text" && ["headline", "selling_point", "subtitle"].includes(layer.text.role))
    );
    for (const layer of productLayers.slice(0, 5)) moveLayer(layer, -1.25);
    pushOperation(operations, { op: "move", path: "/layers[media|selling_point]", value: "-1.25s", reason: "Move product and selling-point information earlier." });
    const ctaClip = updated.clips.find((clip) => clip.role === "cta");
    if (ctaClip) {
      const before = ctaClip.startSec;
      ctaClip.startSec = round(Math.max(0, ctaClip.startSec - 1));
      ctaClip.endSec = round(Math.max(ctaClip.startSec + 0.35, ctaClip.endSec - 1));
      pushOperation(operations, { op: "move", path: `/clips/${ctaClip.clipId}`, value: { before, after: ctaClip.startSec }, reason: "CTA/product decision point moves earlier." });
    }
  }

  if (!operations.length) {
    const plan = parseNaturalLanguageEdit(command);
    return {
      command,
      summary: plan.summary,
      operations: [],
      updatedRecipe: updated,
      renderNeeded: false
    };
  }

  updated.warnings = Array.from(new Set([...(updated.warnings ?? []), `naturalEdit=${command}`]));
  return {
    command,
    summary: `Recipe patch: ${operations.map((operation) => operation.reason).join(" ")}`,
    operations,
    updatedRecipe: updated,
    renderNeeded: true
  };
}

export function applyNaturalLanguageEditToRequest(request: GenerationRequest, plan: NaturalLanguageEditPlan): GenerationRequest {
  return {
    ...request,
    controls: { ...(request.controls ?? {}), ...plan.patchedControls },
    prompt: plan.promptAddendum ? `${request.prompt}\n[edit]: ${plan.promptAddendum}` : request.prompt
  };
}

export function applyNaturalLanguageEditToTimeline(timeline: Timeline, plan: NaturalLanguageEditPlan): Timeline {
  const removeDebug = plan.operations.some((operation) => operation.type === "remove_debug_labels");
  const ribbonPatch = plan.patchedControls.ribbon;
  const ctaEarly = plan.patchedControls.ctaTiming === "early";
  return {
    ...timeline,
    clips: timeline.clips.map((clip) => ({
      ...clip,
      startSec: ctaEarly && clip.role === "cta" ? Math.max(0, clip.startSec - 2) : clip.startSec,
      subtitleText: removeDebug ? (clip.subtitleText ?? "").replace(/\[?Phase[^\n]+/gi, "").trim() : clip.subtitleText,
      layers: clip.layers.map((layer) => ({
        ...layer,
        text: removeDebug && layer.text ? layer.text.replace(/\[?Phase[^\n]+/gi, "").trim() : layer.text
      }))
    })),
    renderPlan: {
      ...timeline.renderPlan,
      motionAtoms: timeline.renderPlan?.motionAtoms?.map((atom) =>
        ribbonPatch
          ? {
              ...atom,
              speed: Math.round(atom.speed * (ribbonPatch.speedMultiplier ?? 1) * 100) / 100,
              density: Math.max(1, Math.round(atom.density * (ribbonPatch.densityMultiplier ?? 1))),
              style: ribbonPatch.premiumFinish ? "clean_premium" : atom.style
            }
          : atom
      ),
      adapterOptions: {
        ...(timeline.renderPlan?.adapterOptions ?? {}),
        editOperations: plan.operations.map((operation) => operation.type)
      }
    }
  };
}
