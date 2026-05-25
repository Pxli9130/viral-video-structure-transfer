import type { GenerationRequest, NaturalLanguageEditPlan, Timeline } from "../types.js";

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

  return {
    instruction,
    operations,
    patchedControls,
    promptAddendum: operations.length ? `Edit intent: ${instruction}` : undefined,
    summary: reasons.length ? `结构化改片：${reasons.join("；")}` : `未识别明确改片意图：${instruction}`
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
