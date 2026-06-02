export type ModelTask =
  | "video_structure_vlm"
  | "text_planning_llm"
  | "technique_atom_extraction"
  | "json_schema_repair"
  | "asset_understanding"
  | "gap_reasoning"
  | "transfer_planning"
  | "natural_edit"
  | "recipe_lint"
  | "provider_prompt_compilation"
  | "gap_repair_ranking"
  | "structure_explanation"
  | "version_strategy_planning"
  | "video_critic"
  | "technique_atom_kb_curator"
  | "asr"
  | "ocr"
  | "visual_grounding"
  | "audio_analysis"
  | "image_fill"
  | "video_fill"
  | "voiceover"
  | "sound_effect"
  | "music"
  | "audio_cleanup"
  | "forced_alignment"
  | "model_discovery"
  | "voice_discovery"
  | "dubbing"
  | "knowledge_retrieval"
  | "quality_judge";

export type ProviderClass =
  | "deterministic_local"
  | "text_llm"
  | "vlm"
  | "asr"
  | "ocr"
  | "visual_grounding"
  | "image_generation"
  | "video_generation"
  | "audio_generation"
  | "audio_cleanup"
  | "audio_analysis"
  | "capability_discovery"
  | "embedding"
  | "quality_judge"
  | "renderer"
  | "disabled";

export type FeatureGate =
  | "analysis"
  | "transfer"
  | "render"
  | "demo_report"
  | "natural_edit"
  | "multi_version"
  | "aigc_fill"
  | "quality_judge"
  | "knowledge_retrieval";

export type EffectScope =
  | "read_only_report"
  | "planning_affects_recipe"
  | "generation_affects_assets"
  | "rendering_affects_pixels"
  | "audio_affects_final_mix"
  | "quality_gate_only"
  | "no_effect";

export type MediaAccessPolicy = {
  samplePixelsAllowed: boolean;
  sampleAudioAllowed: boolean;
  sampleVideoUploadAllowed: boolean;
  outputPixelsAllowed: boolean;
  userAssetsAllowed: boolean;
  rawPromptRenderable: boolean;
  generatedAssetProvenanceRequired: boolean;
};

export type ProviderRoute = {
  task: ModelTask;
  primary: string;
  fallbacks: string[];
  requiredForCoreDemo: boolean;
  requiredWhenFeatureEnabled?: boolean;
  featureGate?: FeatureGate;
  localFallback?: string;
  envVars?: string[];
  providerClass: ProviderClass;
  effectScope: EffectScope;
  mediaAccessPolicy: MediaAccessPolicy;
  notes?: string;
};

export type ProviderAvailability = {
  provider: string;
  available: boolean;
  reason?: string;
  envMissing?: string[];
  disabledByEnv?: string[];
  binaryMissing?: string[];
  packageMissing?: string[];
  weightsMissing?: string[];
};

export type ProviderDecision = {
  task: ModelTask;
  selectedProvider: string;
  providerClass: ProviderClass;
  selectedReason: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  rejectedProviders: Array<{
    provider: string;
    reason: string;
  }>;
  mediaAccessPolicy: MediaAccessPolicy;
  requiredForCoreDemo: boolean;
  requiredWhenFeatureEnabled?: boolean;
  featureGate?: FeatureGate;
  effectScope: EffectScope;
  canAffectFinalPixels: boolean;
  canAffectFinalAudio: boolean;
  consumesSamplePixelsLocally: boolean;
  consumesSampleAudioLocally: boolean;
  consumesSampleVideoLocally: boolean;
  consumesSamplePixelsExternally: boolean;
  consumesSampleAudioExternally: boolean;
  consumesSamplePixels: boolean;
  consumesSampleAudio: boolean;
  consumesSampleVideoExternally: boolean;
  generatedAssetProvenanceRequired: boolean;
  severity: "info" | "warning" | "fatal";
  warnings?: string[];
};

export interface ModelProviderDefinition {
  id: string;
  displayName: string;
  providerClass: ProviderClass;
  cloud: boolean;
  implemented: boolean;
  envVars?: string[];
  enableEnvVars?: string[];
  heavyLocal?: boolean;
  weightEnvVars?: string[];
  binaries?: string[];
  packages?: string[];
  aliasFor?: string;
  deprecated?: boolean;
  deprecationWarning?: string;
  canAffectFinalPixels?: boolean;
  canAffectFinalAudio?: boolean;
  mediaAccessPolicy: MediaAccessPolicy;
  notes?: string;
}

export interface ModelRouteConfig extends ProviderRoute {
  canAffectFinalPixels?: boolean;
  canAffectFinalAudio?: boolean;
  candidateProviders?: string[];
}

export interface ModelRouterOptions {
  env?: Record<string, string | undefined>;
  allowCloud?: boolean;
  allowSampleMediaExternal?: boolean;
  allowQualityJudgeSampleFrames?: boolean;
  enabledFeatures?: FeatureGate[];
  autoPatch?: boolean;
  autoRepair?: boolean;
  requestedProvider?: string;
  localCapabilities?: Record<string, boolean>;
  now?: string;
}

export interface ModelRouteSummary {
  version: "model-router-v4.2";
  generatedAt: string;
  decisions: ProviderDecision[];
  summary: {
    totalTasks: number;
    requiredTasks: number;
    featureGatedRequiredTasks: number;
    fallbackUsed: number;
    fatal: number;
    unsafePolicyIssues: number;
    externalSampleMediaUploads: number;
    localSampleMediaAnalyses: number;
  };
  effectScopeSummary: Record<EffectScope, number>;
  featureGateSummary: Partial<Record<FeatureGate, number>>;
  unsafePolicyIssueMessages: string[];
  /** Compatibility aliases for older artifacts/tests. Prefer `summary.*` in new reports. */
  totalTasks: number;
  requiredTasks: number;
  fallbackUsed: number;
  fatal: number;
  consumesSampleMediaExternally: number;
  externalSampleMediaUploads: number;
  localSampleMediaAnalyses: number;
  canAffectFinalPixels: number;
  canAffectFinalAudio: number;
  unsafePolicyIssues: string[];
}
