export * from "./adapters.js";
export * from "./engine/index.js";
export * from "./effectCodegen/index.js";
export {
  AIGC_GENERATION_POLICY,
  AIGC_GENERATION_WITH_USER_ASSETS_POLICY,
  BLOCK_SAMPLE_MEDIA_POLICY,
  DETERMINISTIC_LOCAL_POLICY,
  EXTERNAL_VLM_DEFAULT_POLICY,
  EXTERNAL_VLM_SAMPLE_MEDIA_POLICY,
  LOCAL_ANALYSIS_POLICY,
  LOCAL_PIXEL_ANALYSIS_POLICY,
  MODEL_PROVIDER_REGISTRY,
  MODEL_ROUTE_TABLE,
  MODEL_TASKS,
  QUALITY_JUDGE_DEFAULT_POLICY,
  QUALITY_JUDGE_WITH_SAMPLE_POLICY,
  assertProviderDecisionsSafe,
  attachModelRouteSummaryToAnalysis,
  attachModelRouteSummaryToGapReport,
  attachModelRouteSummaryToRecipe,
  attachModelRouteSummaryToTemplate,
  buildDefaultProviderDecisions,
  buildFullModelRouteSummary,
  buildModelRouteSummary,
  buildModelRouteSummaryForTasks,
  decisionsForTasks,
  isAigcProviderClass,
  normalizeProviderId,
  policyAllowsSampleExternalUpload,
  providerDecisionRows,
  providerDecisionsMarkdown,
  resolveModelRoute,
  summarizeProviderDecisions,
  validateProviderDecisionSafety
} from "./model-router/index.js";
export type {
  MediaAccessPolicy,
  EffectScope,
  FeatureGate,
  ModelProviderDefinition,
  ModelRouteConfig,
  ModelRouteSummary,
  ModelRouterOptions,
  ModelTask,
  ProviderAvailability,
  ProviderClass,
  ProviderDecision,
  ProviderRoute as ModelTaskProviderRoute
} from "./model-router/index.js";
export * from "./mockPipeline.js";
export * from "./schemas.js";
export * from "./types.js";
export * from "./validation.js";
// spec_v5 (Program-KB Dual Codegen) canonical contracts, namespaced to run in parallel with V4.
// Consume via: import { v5 } from "@vvst/shared";  type X = v5.NeutralReconstructionProgram;
export * as v5 from "./contracts-v5/index.js";
