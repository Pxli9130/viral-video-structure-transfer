import { buildModelRouteSummary, validateProviderDecisionSafety } from "./router.js";
import type { ModelRouteSummary, ProviderDecision } from "./types.js";

export function summarizeProviderDecisions(decisions: ProviderDecision[]): ModelRouteSummary {
  return buildModelRouteSummary(decisions);
}

export function providerDecisionRows(decisions: ProviderDecision[]): Array<Record<string, string>> {
  return decisions.map((decision) => ({
    Task: decision.task,
    "Selected provider": decision.selectedProvider,
    "Fallback used?": decision.fallbackUsed ? "yes" : "no",
    Reason: decision.fallbackUsed ? decision.fallbackReason ?? decision.selectedReason : decision.selectedReason,
    Required: decision.requiredForCoreDemo ? "yes" : "no",
    "Feature gate": decision.featureGate ?? "",
    "Required when feature enabled": decision.requiredWhenFeatureEnabled ? "yes" : "no",
    "Effect scope": decision.effectScope,
    "Local sample media": [
      decision.consumesSamplePixelsLocally ? "pixels" : "",
      decision.consumesSampleAudioLocally ? "audio" : "",
      decision.consumesSampleVideoLocally ? "video" : ""
    ].filter(Boolean).join("+") || "no",
    "External sample media": [
      decision.consumesSamplePixelsExternally ? "pixels" : "",
      decision.consumesSampleAudioExternally ? "audio" : "",
      decision.consumesSampleVideoExternally ? "video" : ""
    ].filter(Boolean).join("+") || "no",
    "Consumes sample media externally": decision.consumesSampleVideoExternally ? "yes" : "no",
    "Can affect final pixels/audio": `${decision.canAffectFinalPixels ? "pixels" : ""}${decision.canAffectFinalPixels && decision.canAffectFinalAudio ? "+" : ""}${decision.canAffectFinalAudio ? "audio" : ""}` || "no",
    "Safety policy": [
      decision.mediaAccessPolicy.rawPromptRenderable ? "rawPromptRenderable" : "no_raw_prompt",
      decision.generatedAssetProvenanceRequired ? "provenance_required" : "no_generated_asset",
      decision.mediaAccessPolicy.samplePixelsAllowed ? "sample_pixels" : "no_sample_pixels",
      decision.mediaAccessPolicy.sampleAudioAllowed ? "sample_audio" : "no_sample_audio",
      decision.mediaAccessPolicy.sampleVideoUploadAllowed ? "sample_video_upload" : "no_sample_video_upload"
    ].join(",")
  }));
}

export function providerDecisionsMarkdown(decisions: ProviderDecision[]): string {
  const summary = summarizeProviderDecisions(decisions);
  const rows = providerDecisionRows(decisions);
  const lines = [
    "# Model Route Summary",
    "",
    `version: ${summary.version}`,
    `generatedAt: ${summary.generatedAt}`,
    `totalTasks: ${summary.summary.totalTasks}`,
    `requiredTasks: ${summary.summary.requiredTasks}`,
    `featureGatedRequiredTasks: ${summary.summary.featureGatedRequiredTasks}`,
    `fallbackUsed: ${summary.summary.fallbackUsed}`,
    `fatal: ${summary.summary.fatal}`,
    `unsafePolicyIssues: ${summary.summary.unsafePolicyIssues}`,
    `localSampleMediaAnalyses: ${summary.summary.localSampleMediaAnalyses}`,
    `externalSampleMediaUploads: ${summary.summary.externalSampleMediaUploads}`,
    "",
    "| Task | Selected provider | Fallback used? | Reason | Core required? | Feature gate | Effect scope | Local sample media | External sample media | Can affect final pixels/audio? | Safety policy |",
    "|---|---|---|---|---|---|---|---|---|---|---|"
  ];
  for (const row of rows) {
    lines.push(`| ${row.Task} | ${row["Selected provider"]} | ${row["Fallback used?"]} | ${row.Reason.replace(/\|/g, "/")} | ${row.Required} | ${row["Feature gate"]} | ${row["Effect scope"]} | ${row["Local sample media"]} | ${row["External sample media"]} | ${row["Can affect final pixels/audio"]} | ${row["Safety policy"]} |`);
  }
  const issues = decisions.flatMap((decision) => validateProviderDecisionSafety(decision));
  if (issues.length) {
    lines.push("", "## Safety Issues", "", ...issues.map((issue) => `- ${issue}`));
  }
  return `${lines.join("\n")}\n`;
}
