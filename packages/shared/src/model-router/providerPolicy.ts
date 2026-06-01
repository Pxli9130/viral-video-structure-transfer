import type { MediaAccessPolicy, ProviderClass } from "./types.js";

export const BLOCK_SAMPLE_MEDIA_POLICY: MediaAccessPolicy = {
  samplePixelsAllowed: false,
  sampleAudioAllowed: false,
  sampleVideoUploadAllowed: false,
  outputPixelsAllowed: false,
  userAssetsAllowed: false,
  rawPromptRenderable: false,
  generatedAssetProvenanceRequired: false
};

export const DETERMINISTIC_LOCAL_POLICY: MediaAccessPolicy = {
  ...BLOCK_SAMPLE_MEDIA_POLICY
};

export const LOCAL_ANALYSIS_POLICY: MediaAccessPolicy = {
  ...BLOCK_SAMPLE_MEDIA_POLICY,
  samplePixelsAllowed: true,
  sampleAudioAllowed: true
};

export const EXTERNAL_VLM_DEFAULT_POLICY: MediaAccessPolicy = {
  ...BLOCK_SAMPLE_MEDIA_POLICY,
  generatedAssetProvenanceRequired: false
};

export const EXTERNAL_VLM_SAMPLE_MEDIA_POLICY: MediaAccessPolicy = {
  ...EXTERNAL_VLM_DEFAULT_POLICY,
  samplePixelsAllowed: true,
  sampleAudioAllowed: true,
  sampleVideoUploadAllowed: true
};

export const QUALITY_JUDGE_DEFAULT_POLICY: MediaAccessPolicy = {
  ...BLOCK_SAMPLE_MEDIA_POLICY,
  outputPixelsAllowed: true
};

export const QUALITY_JUDGE_WITH_SAMPLE_POLICY: MediaAccessPolicy = {
  ...QUALITY_JUDGE_DEFAULT_POLICY,
  samplePixelsAllowed: true
};

export const AIGC_GENERATION_POLICY: MediaAccessPolicy = {
  samplePixelsAllowed: false,
  sampleAudioAllowed: false,
  sampleVideoUploadAllowed: false,
  outputPixelsAllowed: false,
  userAssetsAllowed: false,
  rawPromptRenderable: false,
  generatedAssetProvenanceRequired: true
};

export const AIGC_GENERATION_WITH_USER_ASSETS_POLICY: MediaAccessPolicy = {
  ...AIGC_GENERATION_POLICY,
  userAssetsAllowed: true
};

export function isAigcProviderClass(providerClass: ProviderClass): boolean {
  return providerClass === "image_generation" || providerClass === "video_generation" || providerClass === "audio_generation";
}

export function policyAllowsSampleExternalUpload(policy: MediaAccessPolicy): boolean {
  return policy.sampleVideoUploadAllowed || policy.samplePixelsAllowed || policy.sampleAudioAllowed;
}

