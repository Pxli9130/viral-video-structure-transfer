import { buildDefaultProviderDecisions, buildModelRouteSummary, resolveModelRoute } from "./router.js";
import type { ModelRouteSummary, ModelRouterOptions, ModelTask, ProviderDecision } from "./types.js";

export function buildModelRouteSummaryForTasks(tasks: ModelTask[], options: ModelRouterOptions = {}): ModelRouteSummary {
  const decisions = tasks.map((task) => resolveModelRoute(task, options));
  return buildModelRouteSummary(decisions, options);
}

export function buildFullModelRouteSummary(options: ModelRouterOptions = {}): ModelRouteSummary {
  return buildModelRouteSummary(buildDefaultProviderDecisions(options), options);
}

export function decisionsForTasks(decisions: ProviderDecision[], tasks: ModelTask[]): ProviderDecision[] {
  const allowed = new Set<ModelTask>(tasks);
  return decisions.filter((decision) => allowed.has(decision.task));
}

export function attachModelRouteSummaryToAnalysis<T extends object>(
  analysis: T,
  summary: ModelRouteSummary,
  tasks: ModelTask[] = ["video_structure_vlm", "asr", "ocr", "visual_grounding", "audio_analysis", "quality_judge"]
): T & { modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] } {
  return {
    ...analysis,
    modelRouteSummary: summary,
    providerDecisions: decisionsForTasks(summary.decisions, tasks)
  };
}

export function attachModelRouteSummaryToTemplate<T extends object>(
  template: T,
  summary: ModelRouteSummary,
  buildEvidenceSource: "deterministic_evidence" | "vlm" | "fallback" = "deterministic_evidence"
): T & { modelRouteSummary: ModelRouteSummary; providerDecisionRefs: string[]; buildEvidenceSource: typeof buildEvidenceSource } {
  return {
    ...template,
    modelRouteSummary: summary,
    providerDecisionRefs: summary.decisions.map((decision) => `${decision.task}:${decision.selectedProvider}`),
    buildEvidenceSource
  };
}

export function attachModelRouteSummaryToRecipe<T extends object>(
  recipe: T,
  summary: ModelRouteSummary
): T & { modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] } {
  return {
    ...recipe,
    modelRouteSummary: summary,
    providerDecisions: summary.decisions
  };
}

export function attachModelRouteSummaryToGapReport<T extends object | Array<Record<string, unknown>>>(
  gapReport: T,
  summary: ModelRouteSummary,
  tasks: ModelTask[] = ["gap_reasoning", "gap_repair_ranking", "image_fill", "video_fill", "voiceover", "sound_effect", "music"]
): T extends Array<Record<string, unknown>>
  ? { items: T; modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] }
  : T & { modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] } {
  const payload = {
    modelRouteSummary: summary,
    providerDecisions: decisionsForTasks(summary.decisions, tasks)
  };
  if (Array.isArray(gapReport)) {
    return { items: gapReport, ...payload } as T extends Array<Record<string, unknown>>
      ? { items: T; modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] }
      : T & { modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] };
  }
  return { ...gapReport, ...payload } as T extends Array<Record<string, unknown>>
    ? { items: T; modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] }
    : T & { modelRouteSummary: ModelRouteSummary; providerDecisions: ProviderDecision[] };
}
