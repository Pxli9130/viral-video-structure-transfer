import type { ModelRouteSummary } from "../model-router/types.js";
import type { RenderRecipe } from "../types.js";
import { lintRenderRecipe } from "./recipeLint.js";

export type VideoCriticReport = {
  score: number;
  issues: Array<{
    severity: "info" | "warn" | "fatal";
    kind:
      | "missing_media"
      | "text_overcrowded"
      | "cta_unclear"
      | "raw_prompt_risk"
      | "sample_copy_risk"
      | "weak_gap_repair"
      | "audio_too_generic"
      | "primitive_collapse"
      | "duration_or_resolution_issue";
    message: string;
    evidencePath?: string;
  }>;
  suggestions: string[];
  confidence: "low" | "medium" | "high";
  deterministicGateRefs: string[];
};

export interface VideoCriticInput {
  renderRecipe?: RenderRecipe;
  finalGateReport?: { gates?: Array<{ id?: string; status?: string; notes?: string }>; status?: string };
  renderMetrics?: { width?: number; height?: number; durationSec?: number; motionDiffMean?: number; cutLikeCount?: number };
  routeSummary?: ModelRouteSummary;
}

function primitiveHistogram(recipe: RenderRecipe | undefined): Record<string, number> {
  return (recipe?.clips ?? []).reduce<Record<string, number>>((out, clip) => {
    out[clip.selectedPrimitive] = (out[clip.selectedPrimitive] ?? 0) + 1;
    return out;
  }, {});
}

export function critiqueVideoOffline(input: VideoCriticInput): VideoCriticReport {
  const issues: VideoCriticReport["issues"] = [];
  const suggestions: string[] = [];
  const refs: string[] = [];
  const recipe = input.renderRecipe;
  if (recipe) {
    const lint = lintRenderRecipe(recipe);
    refs.push("recipe_lint");
    for (const issue of lint.issues) {
      if (issue.kind === "missing_media_layer") issues.push({ severity: issue.severity, kind: "missing_media", message: issue.message, evidencePath: issue.path });
      if (issue.kind === "raw_prompt_render_risk") issues.push({ severity: "fatal", kind: "raw_prompt_risk", message: issue.message, evidencePath: issue.path });
      if (issue.kind === "sample_asset_render_risk") issues.push({ severity: "fatal", kind: "sample_copy_risk", message: issue.message, evidencePath: issue.path });
      if (issue.kind === "empty_audio_layers") issues.push({ severity: "warn", kind: "audio_too_generic", message: issue.message, evidencePath: issue.path });
    }
    const textLayers = (recipe.layers ?? []).filter((layer) => layer.type === "text");
    const duration = recipe.global.durationSec || 1;
    if (textLayers.length / duration > 0.55) {
      issues.push({ severity: "warn", kind: "text_overcrowded", message: `${textLayers.length} text layers over ${duration}s may overcrowd the frame.`, evidencePath: "/layers" });
      suggestions.push("Reduce subtitle density or shorten secondary copy.");
    }
    const ctaLayers = textLayers.filter((layer) => layer.text.role === "cta");
    if (!ctaLayers.length) {
      issues.push({ severity: "warn", kind: "cta_unclear", message: "No CTA text layer found.", evidencePath: "/layers" });
      suggestions.push("Add or emphasize a CTA layer near the ending.");
    }
    const hist = primitiveHistogram(recipe);
    if (Object.keys(hist).length <= 1 && (recipe.clips?.length ?? 0) >= 3) {
      issues.push({ severity: "warn", kind: "primitive_collapse", message: `Primitive histogram collapsed: ${JSON.stringify(hist)}.`, evidencePath: "/clips" });
      suggestions.push("Use more than one primitive family when sample structure contains distinct scenes.");
    }
  } else {
    issues.push({ severity: "fatal", kind: "missing_media", message: "No RenderRecipe supplied to offline critic." });
  }

  const metrics = input.renderMetrics;
  if (metrics) {
    refs.push("render_metrics");
    if ((metrics.width && metrics.height && metrics.height < metrics.width) || (metrics.durationSec && (metrics.durationSec < 3 || metrics.durationSec > 60))) {
      issues.push({ severity: "warn", kind: "duration_or_resolution_issue", message: `Render metrics look unusual: ${metrics.width ?? "?"}x${metrics.height ?? "?"}, ${metrics.durationSec ?? "?"}s.` });
    }
  }

  for (const gate of input.finalGateReport?.gates ?? []) {
    if (gate.status === "fail") {
      refs.push(gate.id ?? "final_gate");
      issues.push({ severity: "fatal", kind: "weak_gap_repair", message: `Final gate failed: ${gate.id ?? "unknown"} ${gate.notes ?? ""}`.trim() });
    }
  }

  if (input.routeSummary) {
    refs.push("model_route_summary");
    if (input.routeSummary.summary.externalSampleMediaUploads > 0) {
      issues.push({ severity: "warn", kind: "sample_copy_risk", message: `${input.routeSummary.summary.externalSampleMediaUploads} external sample media upload routes recorded; verify analysis-only policy.` });
    }
  }

  if (!suggestions.length) suggestions.push("Keep deterministic gates as the source of truth; optional VLM critic should not override hard safety gates.");
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "fatal" ? 28 : issue.severity === "warn" ? 10 : 3), 0);
  const score = Math.max(0, Math.min(100, 92 - penalty));
  return {
    score,
    issues,
    suggestions,
    confidence: recipe ? "medium" : "low",
    deterministicGateRefs: Array.from(new Set(refs))
  };
}
