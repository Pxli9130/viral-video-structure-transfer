import { EXTERNAL_VLM_SAMPLE_MEDIA_POLICY, QUALITY_JUDGE_WITH_SAMPLE_POLICY, isAigcProviderClass } from "./providerPolicy.js";
import { MODEL_PROVIDER_REGISTRY, MODEL_ROUTE_TABLE, MODEL_TASKS } from "./modelRegistry.js";
import type {
  EffectScope,
  FeatureGate,
  MediaAccessPolicy,
  ModelProviderDefinition,
  ModelRouteConfig,
  ModelRouteSummary,
  ModelRouterOptions,
  ModelTask,
  ProviderAvailability,
  ProviderDecision
} from "./types.js";

function envFromOptions(options: ModelRouterOptions): Record<string, string | undefined> {
  if (options.env) return options.env;
  return typeof process !== "undefined" ? process.env : {};
}

function envMissing(provider: ModelProviderDefinition, env: Record<string, string | undefined>): string[] {
  const vars = provider.envVars ?? [];
  if (!vars.length) return [];
  if (vars.some((key) => Boolean(env[key]?.trim()))) return [];
  return vars;
}

function capabilityMissing(provider: ModelProviderDefinition, options: ModelRouterOptions): { binaryMissing: string[]; packageMissing: string[] } {
  const caps = options.localCapabilities ?? {};
  const binaryMissing = (provider.binaries ?? []).filter((name) => caps[`binary:${name}`] === false);
  const packageMissing = (provider.packages ?? []).filter((name) => caps[`package:${name}`] === false);
  return { binaryMissing, packageMissing };
}

export function normalizeProviderId(providerId: string): { providerId: string; warning?: string } {
  const provider = MODEL_PROVIDER_REGISTRY[providerId];
  if (provider?.aliasFor) {
    return {
      providerId: provider.aliasFor,
      warning: provider.deprecationWarning ?? `${providerId} is deprecated; use ${provider.aliasFor}.`
    };
  }
  return { providerId };
}

function policyFor(provider: ModelProviderDefinition, task: ModelTask, options: ModelRouterOptions): MediaAccessPolicy {
  if (provider.id === "gemini_vlm_current" && task === "video_structure_vlm" && options.allowCloud === true && options.allowSampleMediaExternal === true) {
    return EXTERNAL_VLM_SAMPLE_MEDIA_POLICY;
  }
  if (provider.id === "gemini_vlm_judge" && task === "quality_judge" && options.allowCloud === true && options.allowQualityJudgeSampleFrames === true) {
    return QUALITY_JUDGE_WITH_SAMPLE_POLICY;
  }
  if (isAigcProviderClass(provider.providerClass)) {
    return {
      ...provider.mediaAccessPolicy,
      samplePixelsAllowed: false,
      sampleAudioAllowed: false,
      sampleVideoUploadAllowed: false,
      rawPromptRenderable: false,
      generatedAssetProvenanceRequired: true
    };
  }
  return provider.mediaAccessPolicy;
}

function providerAvailable(
  provider: ModelProviderDefinition,
  task: ModelTask,
  options: ModelRouterOptions
): ProviderAvailability {
  const env = envFromOptions(options);
  const envMissingVars = envMissing(provider, env);
  const { binaryMissing, packageMissing } = capabilityMissing(provider, options);
  if (provider.cloud && options.allowCloud !== true) {
    return { provider: provider.id, available: false, reason: "cloud provider disabled by router options" };
  }
  if (provider.cloud && envMissingVars.length) {
    return { provider: provider.id, available: false, reason: "required provider env vars are missing", envMissing: envMissingVars };
  }
  if (!provider.implemented) {
    return { provider: provider.id, available: false, reason: "provider candidate is registered but not implemented yet" };
  }
  if (binaryMissing.length || packageMissing.length) {
    return {
      provider: provider.id,
      available: false,
      reason: "local provider dependencies are missing",
      ...(binaryMissing.length ? { binaryMissing } : {}),
      ...(packageMissing.length ? { packageMissing } : {})
    };
  }
  if (provider.id === "gemini_vlm_current" && task === "video_structure_vlm" && options.allowSampleMediaExternal !== true) {
    return { provider: provider.id, available: false, reason: "external sample video upload is blocked by default" };
  }
  if (provider.id === "gemini_vlm_judge" && task === "quality_judge" && options.allowQualityJudgeSampleFrames !== true) {
    return { provider: provider.id, available: true, reason: "output-frame judge only; sample comparison frames blocked by default" };
  }
  return { provider: provider.id, available: true };
}

function providerOrThrow(providerId: string): ModelProviderDefinition {
  const normalized = normalizeProviderId(providerId).providerId;
  const provider = MODEL_PROVIDER_REGISTRY[normalized];
  if (!provider) throw new Error(`Model provider ${providerId} is not registered.`);
  return provider;
}

function routeOrThrow(task: ModelTask): ModelRouteConfig {
  const route = MODEL_ROUTE_TABLE[task];
  if (!route) throw new Error(`Model task ${task} is not registered.`);
  return route;
}

function featureEnabled(featureGate: FeatureGate | undefined, options: ModelRouterOptions): boolean {
  if (!featureGate) return false;
  return (options.enabledFeatures ?? []).includes(featureGate);
}

function activeRequired(route: ModelRouteConfig, options: ModelRouterOptions): boolean {
  return route.requiredForCoreDemo || Boolean(route.requiredWhenFeatureEnabled && featureEnabled(route.featureGate, options));
}

function canAffectPixels(effectScope: EffectScope, providerClass: ModelProviderDefinition["providerClass"]): boolean {
  if (effectScope === "planning_affects_recipe" || effectScope === "rendering_affects_pixels") return true;
  if (effectScope === "generation_affects_assets") return providerClass !== "audio_generation" && providerClass !== "disabled";
  return false;
}

function canAffectAudio(effectScope: EffectScope, providerClass: ModelProviderDefinition["providerClass"]): boolean {
  if (effectScope === "audio_affects_final_mix") return providerClass !== "disabled";
  return effectScope === "generation_affects_assets" && providerClass === "audio_generation";
}

function sampleAccessFor(provider: ModelProviderDefinition | undefined, policy: MediaAccessPolicy): Pick<
  ProviderDecision,
  | "consumesSamplePixelsLocally"
  | "consumesSampleAudioLocally"
  | "consumesSampleVideoLocally"
  | "consumesSamplePixelsExternally"
  | "consumesSampleAudioExternally"
  | "consumesSampleVideoExternally"
  | "consumesSamplePixels"
  | "consumesSampleAudio"
> {
  const external = provider?.cloud === true;
  const consumesSamplePixelsLocally = !external && policy.samplePixelsAllowed;
  const consumesSampleAudioLocally = !external && policy.sampleAudioAllowed;
  const consumesSampleVideoLocally = !external && policy.sampleVideoUploadAllowed;
  const consumesSamplePixelsExternally = external && policy.samplePixelsAllowed;
  const consumesSampleAudioExternally = external && policy.sampleAudioAllowed;
  const consumesSampleVideoExternally = external && policy.sampleVideoUploadAllowed;
  return {
    consumesSamplePixelsLocally,
    consumesSampleAudioLocally,
    consumesSampleVideoLocally,
    consumesSamplePixelsExternally,
    consumesSampleAudioExternally,
    consumesSampleVideoExternally,
    consumesSamplePixels: consumesSamplePixelsLocally || consumesSamplePixelsExternally,
    consumesSampleAudio: consumesSampleAudioLocally || consumesSampleAudioExternally
  };
}

function formatUnavailable(availability: ProviderAvailability): string {
  const parts = [availability.reason ?? "unavailable"];
  if (availability.envMissing?.length) parts.push(`envMissing=${availability.envMissing.join(",")}`);
  if (availability.binaryMissing?.length) parts.push(`binaryMissing=${availability.binaryMissing.join(",")}`);
  if (availability.packageMissing?.length) parts.push(`packageMissing=${availability.packageMissing.join(",")}`);
  return parts.join("; ");
}

function firstAvailableProvider(task: ModelTask, route: ModelRouteConfig, options: ModelRouterOptions): {
  provider: ModelProviderDefinition | undefined;
  fallbackUsed: boolean;
  fallbackReason?: string;
  rejectedProviders: ProviderDecision["rejectedProviders"];
  aliasWarnings: string[];
} {
  const rejectedProviders: ProviderDecision["rejectedProviders"] = [];
  const aliasWarnings: string[] = [];
  const requested = options.requestedProvider ? normalizeProviderId(options.requestedProvider) : undefined;
  if (requested?.warning) aliasWarnings.push(requested.warning);
  const providerIds = [
    requested?.providerId ?? route.primary,
    ...route.fallbacks,
    ...(route.localFallback && !route.fallbacks.includes(route.localFallback) ? [route.localFallback] : [])
  ];
  const seen = new Set<string>();
  for (const rawId of providerIds) {
    const normalized = normalizeProviderId(rawId);
    if (normalized.warning) aliasWarnings.push(normalized.warning);
    const id = normalized.providerId;
    if (seen.has(id)) continue;
    seen.add(id);
    const provider = providerOrThrow(id);
    const availability = providerAvailable(provider, task, options);
    if (availability.available) {
      const fallbackUsed = id !== route.primary || Boolean(requested && requested.providerId !== route.primary);
      return {
        provider,
        fallbackUsed,
        fallbackReason: fallbackUsed ? `Selected ${id} because ${rejectedProviders.map((item) => `${item.provider}: ${item.reason}`).join("; ") || `${route.primary} was not selected`}.` : undefined,
        rejectedProviders,
        aliasWarnings
      };
    }
    rejectedProviders.push({ provider: id, reason: formatUnavailable(availability) });
  }
  return { provider: undefined, fallbackUsed: true, rejectedProviders, aliasWarnings };
}

export function resolveModelRoute(task: ModelTask, options: ModelRouterOptions = {}): ProviderDecision {
  const route = routeOrThrow(task);
  const selected = firstAvailableProvider(task, route, options);
  const provider = selected.provider;
  if (!provider) {
    const activeRequiredForRun = activeRequired(route, options);
    const sampleAccess = sampleAccessFor(undefined, route.mediaAccessPolicy);
    return {
      task,
      selectedProvider: route.localFallback ?? "unavailable",
      providerClass: route.providerClass,
      selectedReason: "No registered provider or fallback was available.",
      fallbackUsed: true,
      fallbackReason: selected.rejectedProviders.map((item) => `${item.provider}: ${item.reason}`).join("; ") || "no provider available",
      rejectedProviders: selected.rejectedProviders,
      mediaAccessPolicy: route.mediaAccessPolicy,
      requiredForCoreDemo: route.requiredForCoreDemo,
      ...(route.requiredWhenFeatureEnabled !== undefined ? { requiredWhenFeatureEnabled: route.requiredWhenFeatureEnabled } : {}),
      ...(route.featureGate ? { featureGate: route.featureGate } : {}),
      effectScope: route.effectScope,
      canAffectFinalPixels: canAffectPixels(route.effectScope, route.providerClass),
      canAffectFinalAudio: canAffectAudio(route.effectScope, route.providerClass),
      ...sampleAccess,
      generatedAssetProvenanceRequired: route.mediaAccessPolicy.generatedAssetProvenanceRequired,
      severity: activeRequiredForRun ? "fatal" : "warning",
      warnings: selected.aliasWarnings
    };
  }

  const policy = policyFor(provider, task, options);
  const sampleAccess = sampleAccessFor(provider, policy);
  return {
    task,
    selectedProvider: provider.id,
    providerClass: provider.providerClass,
    selectedReason: selected.fallbackUsed
      ? `Fallback provider selected for ${task}.`
      : `Primary provider selected for ${task}.`,
    fallbackUsed: selected.fallbackUsed,
    ...(selected.fallbackUsed && selected.fallbackReason ? { fallbackReason: selected.fallbackReason } : {}),
    rejectedProviders: selected.rejectedProviders,
    mediaAccessPolicy: policy,
    requiredForCoreDemo: route.requiredForCoreDemo,
    ...(route.requiredWhenFeatureEnabled !== undefined ? { requiredWhenFeatureEnabled: route.requiredWhenFeatureEnabled } : {}),
    ...(route.featureGate ? { featureGate: route.featureGate } : {}),
    effectScope: route.effectScope,
    canAffectFinalPixels: canAffectPixels(route.effectScope, provider.providerClass),
    canAffectFinalAudio: canAffectAudio(route.effectScope, provider.providerClass),
    ...sampleAccess,
    generatedAssetProvenanceRequired: policy.generatedAssetProvenanceRequired,
    severity: "info",
    ...(selected.aliasWarnings.length ? { warnings: selected.aliasWarnings } : {})
  };
}

export function buildDefaultProviderDecisions(options: ModelRouterOptions = {}): ProviderDecision[] {
  return MODEL_TASKS.map((task) => resolveModelRoute(task, options));
}

export function buildModelRouteSummary(decisions: ProviderDecision[], options: Pick<ModelRouterOptions, "now" | "enabledFeatures"> = {}): ModelRouteSummary {
  const unsafePolicyIssues = decisions.flatMap((decision) => validateProviderDecisionSafety(decision));
  const effectScopeSummary = decisions.reduce(
    (out, decision) => {
      out[decision.effectScope] += 1;
      return out;
    },
    {
      read_only_report: 0,
      planning_affects_recipe: 0,
      generation_affects_assets: 0,
      rendering_affects_pixels: 0,
      audio_affects_final_mix: 0,
      quality_gate_only: 0,
      no_effect: 0
    } satisfies Record<EffectScope, number>
  );
  const featureGateSummary = decisions.reduce<Partial<Record<FeatureGate, number>>>((out, decision) => {
    if (!decision.featureGate) return out;
    out[decision.featureGate] = (out[decision.featureGate] ?? 0) + 1;
    return out;
  }, {});
  const featureEnabledFor = (decision: ProviderDecision): boolean =>
    Boolean(decision.featureGate && (options.enabledFeatures ?? []).includes(decision.featureGate));
  const featureGatedRequiredTasks = decisions.filter((item) => item.requiredWhenFeatureEnabled && featureEnabledFor(item)).length;
  const requiredTasks = decisions.filter((item) => item.requiredForCoreDemo).length + featureGatedRequiredTasks;
  const externalSampleMediaUploads = decisions.filter(
    (item) => item.consumesSamplePixelsExternally || item.consumesSampleAudioExternally || item.consumesSampleVideoExternally
  ).length;
  const localSampleMediaAnalyses = decisions.filter(
    (item) => item.consumesSamplePixelsLocally || item.consumesSampleAudioLocally || item.consumesSampleVideoLocally
  ).length;
  const fallbackUsed = decisions.filter((item) => item.fallbackUsed).length;
  const fatal = decisions.filter((item) => item.severity === "fatal").length;
  const canAffectFinalPixels = decisions.filter((item) => item.canAffectFinalPixels).length;
  const canAffectFinalAudio = decisions.filter((item) => item.canAffectFinalAudio).length;
  return {
    version: "model-router-v4.2",
    generatedAt: options.now ?? new Date().toISOString(),
    decisions,
    summary: {
      totalTasks: decisions.length,
      requiredTasks,
      featureGatedRequiredTasks,
      fallbackUsed,
      fatal,
      unsafePolicyIssues: unsafePolicyIssues.length,
      externalSampleMediaUploads,
      localSampleMediaAnalyses
    },
    effectScopeSummary,
    featureGateSummary,
    unsafePolicyIssueMessages: unsafePolicyIssues,
    totalTasks: decisions.length,
    requiredTasks,
    fallbackUsed,
    fatal,
    consumesSampleMediaExternally: externalSampleMediaUploads,
    externalSampleMediaUploads,
    localSampleMediaAnalyses,
    canAffectFinalPixels,
    canAffectFinalAudio,
    unsafePolicyIssues
  };
}

export function validateProviderDecisionSafety(decision: ProviderDecision): string[] {
  const issues: string[] = [];
  if (isAigcProviderClass(decision.providerClass)) {
    if (decision.mediaAccessPolicy.samplePixelsAllowed) issues.push(`${decision.task}: AIGC provider allows sample pixels`);
    if (decision.mediaAccessPolicy.sampleAudioAllowed) issues.push(`${decision.task}: AIGC provider allows sample audio`);
    if (decision.mediaAccessPolicy.sampleVideoUploadAllowed) issues.push(`${decision.task}: AIGC provider allows sample video upload`);
    if (!decision.generatedAssetProvenanceRequired) issues.push(`${decision.task}: generation provider does not require generated asset provenance`);
  }
  if (decision.mediaAccessPolicy.rawPromptRenderable) issues.push(`${decision.task}: rawPromptRenderable must be false`);
  if (decision.fallbackUsed && !decision.fallbackReason) issues.push(`${decision.task}: fallback used without fallbackReason`);
  if (decision.consumesSampleVideoExternally && !decision.mediaAccessPolicy.sampleVideoUploadAllowed) {
    issues.push(`${decision.task}: consumes sample video externally but policy does not allow it`);
  }
  if ((decision.consumesSamplePixelsExternally || decision.consumesSampleAudioExternally || decision.consumesSampleVideoExternally) && isAigcProviderClass(decision.providerClass)) {
    issues.push(`${decision.task}: AIGC provider consumes sample media externally`);
  }
  return issues;
}

export function assertProviderDecisionsSafe(decisions: ProviderDecision[]): void {
  const issues = decisions.flatMap((decision) => validateProviderDecisionSafety(decision));
  if (issues.length) throw new Error(`Unsafe provider decisions: ${issues.join("; ")}`);
}
