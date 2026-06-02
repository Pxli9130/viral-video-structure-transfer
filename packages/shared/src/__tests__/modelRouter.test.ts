import { describe, expect, it } from "vitest";
import {
  buildDefaultProviderDecisions,
  buildModelRouteSummary,
  MODEL_TASKS,
  resolveModelRoute,
  validateProviderDecisionSafety
} from "../index.js";

describe("Spec v4.2 ModelTask router", () => {
  it("creates an offline decision for every task without cloud env vars", () => {
    const decisions = buildDefaultProviderDecisions({ env: {}, allowCloud: false });
    const summary = buildModelRouteSummary(decisions);

    expect(decisions).toHaveLength(MODEL_TASKS.length);
    expect(new Set(decisions.map((decision) => decision.task)).size).toBe(MODEL_TASKS.length);
    expect(summary.fatal).toBe(0);
    expect(summary.unsafePolicyIssues).toEqual([]);
    expect(decisions.every((decision) => decision.selectedProvider !== "unavailable")).toBe(true);
  });

  it("records cloud provider rejection and deterministic fallbacks", () => {
    const text = resolveModelRoute("text_planning_llm", { env: {}, allowCloud: true });
    const vlm = resolveModelRoute("video_structure_vlm", { env: {}, allowCloud: true, allowSampleMediaExternal: true });

    expect(text.selectedProvider).toBe("deterministic_planner");
    expect(text.fallbackUsed).toBe(true);
    expect(text.rejectedProviders.some((item) => item.reason.includes("envMissing"))).toBe(true);
    expect(vlm.selectedProvider).toBe("heuristic_vlm");
    expect(vlm.rejectedProviders.some((item) => item.provider === "gemini_vlm_current" && item.reason.includes("envMissing"))).toBe(true);
  });

  it("uses explicit local warning fallbacks when local ASR/OCR packages are unavailable", () => {
    const localCapabilities = {
      "package:faster_whisper": false,
      "package:easyocr": false
    };
    const asr = resolveModelRoute("asr", { env: {}, localCapabilities });
    const ocr = resolveModelRoute("ocr", { env: {}, localCapabilities });

    expect(asr.selectedProvider).toBe("no_asr_with_warning");
    expect(asr.fallbackUsed).toBe(true);
    expect(asr.fallbackReason).toContain("packageMissing=faster_whisper");
    expect(ocr.selectedProvider).toBe("no_ocr_with_warning");
    expect(ocr.fallbackReason).toContain("packageMissing=easyocr");
  });

  it("blocks sample media from AIGC generation routes by default", () => {
    for (const task of ["image_fill", "voiceover", "sound_effect", "music", "audio_cleanup", "dubbing"] as const) {
      const decision = resolveModelRoute(task, { env: {}, allowCloud: false });
      expect(decision.mediaAccessPolicy.samplePixelsAllowed).toBe(false);
      expect(decision.mediaAccessPolicy.sampleAudioAllowed).toBe(false);
      expect(decision.mediaAccessPolicy.sampleVideoUploadAllowed).toBe(false);
      expect(decision.consumesSamplePixelsExternally).toBe(false);
      expect(decision.consumesSampleAudioExternally).toBe(false);
      expect(decision.consumesSampleVideoExternally).toBe(false);
      if (decision.providerClass !== "disabled") {
        expect(decision.generatedAssetProvenanceRequired).toBe(true);
      }
      expect(decision.mediaAccessPolicy.rawPromptRenderable).toBe(false);
      expect(validateProviderDecisionSafety(decision)).toEqual([]);
    }
  });

  it("keeps ElevenLabs disabled when the key exists but live flags are off", () => {
    const decision = resolveModelRoute("music", {
      env: { ELEVENLABS_API_KEY: "test-key" },
      allowCloud: true
    });

    expect(decision.selectedProvider).toBe("skip_with_warning");
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.rejectedProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "elevenlabs_music",
          reason: expect.stringContaining("ElevenLabs live calls are disabled")
        })
      ])
    );
    expect(decision.consumesSampleAudioExternally).toBe(false);
  });

  it("selects ElevenLabs for allowed audio tasks without enabling sample audio upload", () => {
    const env = { ELEVENLABS_API_KEY: "test-key", ENABLE_ELEVENLABS_LIVE_TESTS: "1" };
    const scribe = resolveModelRoute("asr", { env, allowCloud: true });
    const tts = resolveModelRoute("voiceover", { env, allowCloud: true });
    const sfx = resolveModelRoute("sound_effect", { env, allowCloud: true });
    const music = resolveModelRoute("music", { env, allowCloud: true });
    const cleanup = resolveModelRoute("audio_cleanup", { env, allowCloud: true });
    const alignment = resolveModelRoute("forced_alignment", { env, allowCloud: true });

    expect(scribe.selectedProvider).toBe("elevenlabs_scribe");
    expect(tts.selectedProvider).toBe("elevenlabs_tts");
    expect(sfx.selectedProvider).toBe("elevenlabs_sound_effects");
    expect(music.selectedProvider).toBe("elevenlabs_music");
    expect(cleanup.selectedProvider).toBe("elevenlabs_audio_isolation");
    expect(alignment.selectedProvider).toBe("elevenlabs_forced_alignment");

    for (const decision of [scribe, tts, sfx, music, cleanup, alignment]) {
      expect(decision.mediaAccessPolicy.sampleAudioAllowed).toBe(false);
      expect(decision.consumesSampleAudioExternally).toBe(false);
      expect(decision.mediaAccessPolicy.samplePixelsAllowed).toBe(false);
      expect(decision.mediaAccessPolicy.sampleVideoUploadAllowed).toBe(false);
      expect(decision.mediaAccessPolicy.rawPromptRenderable).toBe(false);
      expect(validateProviderDecisionSafety(decision)).toEqual([]);
    }
    expect(tts.generatedAssetProvenanceRequired).toBe(true);
    expect(sfx.generatedAssetProvenanceRequired).toBe(true);
    expect(music.generatedAssetProvenanceRequired).toBe(true);
    expect(cleanup.mediaAccessPolicy.userAssetsAllowed).toBe(true);
  });

  it("records ElevenLabs sample-audio analysis only when external sample media is enabled", () => {
    const env = { ELEVENLABS_API_KEY: "test-key", ENABLE_ELEVENLABS_LIVE_TESTS: "1" };
    const blocked = resolveModelRoute("asr", { env, allowCloud: true });
    expect(blocked.selectedProvider).toBe("elevenlabs_scribe");
    expect(blocked.consumesSampleAudioExternally).toBe(false);
    expect(blocked.mediaAccessPolicy.sampleAudioAllowed).toBe(false);

    const allowed = resolveModelRoute("asr", { env, allowCloud: true, allowSampleMediaExternal: true });
    expect(allowed.selectedProvider).toBe("elevenlabs_scribe");
    expect(allowed.consumesSampleAudioExternally).toBe(true);
    expect(allowed.mediaAccessPolicy.sampleAudioAllowed).toBe(true);
    expect(validateProviderDecisionSafety(allowed)).toEqual([]);
  });

  it("routes ElevenLabs model and voice discovery as read-only report tasks", () => {
    const env = { ELEVENLABS_API_KEY: "test-key", ELEVENLABS_ENABLE_DISCOVERY: "1" };
    const models = resolveModelRoute("model_discovery", { env, allowCloud: true });
    const voices = resolveModelRoute("voice_discovery", { env, allowCloud: true });

    expect(models.selectedProvider).toBe("elevenlabs_models");
    expect(voices.selectedProvider).toBe("elevenlabs_voices_read");
    for (const decision of [models, voices]) {
      expect(decision.effectScope).toBe("read_only_report");
      expect(decision.canAffectFinalPixels).toBe(false);
      expect(decision.canAffectFinalAudio).toBe(false);
      expect(decision.mediaAccessPolicy).toMatchObject({
        samplePixelsAllowed: false,
        sampleAudioAllowed: false,
        sampleVideoUploadAllowed: false,
        rawPromptRenderable: false
      });
    }
  });

  it("keeps explicit user-asset policy for cloud AIGC while blocking sample media", () => {
    const decision = resolveModelRoute("image_fill", {
      requestedProvider: "google_gemini_image",
      env: { GEMINI_API_KEY: "test-key" },
      allowCloud: true
    });

    expect(decision.selectedProvider).toBe("google_gemini_image");
    expect(decision.mediaAccessPolicy.userAssetsAllowed).toBe(true);
    expect(decision.mediaAccessPolicy.samplePixelsAllowed).toBe(false);
    expect(decision.mediaAccessPolicy.sampleAudioAllowed).toBe(false);
    expect(decision.mediaAccessPolicy.sampleVideoUploadAllowed).toBe(false);
    expect(decision.generatedAssetProvenanceRequired).toBe(true);
    expect(validateProviderDecisionSafety(decision)).toEqual([]);
  });

  it("selects Seedance fast video fill from the shared Ark key without sample media upload", () => {
    const decision = resolveModelRoute("video_fill", {
      env: { SEEDREAM_ARK_API_KEY: "test-key" },
      allowCloud: true
    });

    expect(decision.selectedProvider).toBe("seedance_2_0");
    expect(decision.providerClass).toBe("video_generation");
    expect(decision.generatedAssetProvenanceRequired).toBe(true);
    expect(decision.mediaAccessPolicy.samplePixelsAllowed).toBe(false);
    expect(decision.mediaAccessPolicy.sampleAudioAllowed).toBe(false);
    expect(decision.mediaAccessPolicy.sampleVideoUploadAllowed).toBe(false);
    expect(decision.consumesSamplePixelsExternally).toBe(false);
    expect(decision.consumesSampleAudioExternally).toBe(false);
    expect(decision.consumesSampleVideoExternally).toBe(false);
    expect(validateProviderDecisionSafety(decision)).toEqual([]);
  });

  it("splits core requirements from feature-gated tasks and effect scopes", () => {
    const explanation = resolveModelRoute("structure_explanation", { env: {}, allowCloud: false });
    const version = resolveModelRoute("version_strategy_planning", { env: {}, allowCloud: false });
    const promptCompiler = resolveModelRoute("provider_prompt_compilation", { env: {}, allowCloud: false });
    const recipeLint = resolveModelRoute("recipe_lint", { env: {}, allowCloud: false });

    expect(explanation.requiredForCoreDemo).toBe(false);
    expect(explanation.requiredWhenFeatureEnabled).toBe(true);
    expect(explanation.featureGate).toBe("demo_report");
    expect(explanation.effectScope).toBe("read_only_report");
    expect(explanation.canAffectFinalPixels).toBe(false);
    expect(version.featureGate).toBe("multi_version");
    expect(promptCompiler.featureGate).toBe("aigc_fill");
    expect(promptCompiler.effectScope).toBe("generation_affects_assets");
    expect(recipeLint.effectScope).toBe("quality_gate_only");
    expect(recipeLint.canAffectFinalPixels).toBe(false);
  });

  it("distinguishes local sample analysis from external sample upload", () => {
    const asr = resolveModelRoute("asr", { env: {}, allowCloud: false });
    const ocr = resolveModelRoute("ocr", { env: {}, allowCloud: false });

    expect(asr.consumesSampleAudioLocally).toBe(true);
    expect(asr.consumesSampleAudioExternally).toBe(false);
    expect(ocr.consumesSamplePixelsLocally).toBe(true);
    expect(ocr.consumesSamplePixelsExternally).toBe(false);
  });

  it("gates external VLM sample-video upload and records it only when explicitly allowed", () => {
    const blocked = resolveModelRoute("video_structure_vlm", {
      env: { GEMINI_API_KEY: "test-key" },
      allowCloud: true
    });
    expect(blocked.selectedProvider).not.toBe("gemini_vlm_current");
    expect(blocked.consumesSampleVideoExternally).toBe(false);

    const allowed = resolveModelRoute("video_structure_vlm", {
      env: { GEMINI_API_KEY: "test-key" },
      allowCloud: true,
      allowSampleMediaExternal: true
    });
    expect(allowed.selectedProvider).toBe("gemini_vlm_current");
    expect(allowed.consumesSampleVideoExternally).toBe(true);
    expect(allowed.consumesSamplePixelsExternally).toBe(true);
    expect(allowed.consumesSampleAudioExternally).toBe(true);
    expect(allowed.effectScope).toBe("planning_affects_recipe");
    expect(allowed.mediaAccessPolicy.sampleVideoUploadAllowed).toBe(true);
    expect(allowed.generatedAssetProvenanceRequired).toBe(false);
  });

  it("gates quality judge sample-frame access separately from output-frame judging", () => {
    const outputOnly = resolveModelRoute("quality_judge", {
      requestedProvider: "gemini_vlm_judge",
      env: { GEMINI_API_KEY: "test-key" },
      allowCloud: true
    });
    expect(outputOnly.selectedProvider).toBe("gemini_vlm_judge");
    expect(outputOnly.mediaAccessPolicy.outputPixelsAllowed).toBe(true);
    expect(outputOnly.mediaAccessPolicy.samplePixelsAllowed).toBe(false);

    const withSample = resolveModelRoute("quality_judge", {
      requestedProvider: "gemini_vlm_judge",
      env: { GEMINI_API_KEY: "test-key" },
      allowCloud: true,
      allowQualityJudgeSampleFrames: true
    });
    expect(withSample.selectedProvider).toBe("gemini_vlm_judge");
    expect(withSample.mediaAccessPolicy.samplePixelsAllowed).toBe(true);
  });

  it("aliases deprecated mock_provider to deterministic_local_image_fill", () => {
    const decision = resolveModelRoute("image_fill", {
      requestedProvider: "mock_provider",
      env: {},
      allowCloud: false
    });
    expect(decision.selectedProvider).toBe("deterministic_local_image_fill");
    expect(decision.warnings?.[0]).toContain("mock_provider is deprecated");
  });

  it("serializes route artifacts and summary with all required fields", () => {
    const decisions = buildDefaultProviderDecisions({ env: {}, allowCloud: false });
    const roundTrip = JSON.parse(JSON.stringify(decisions));
    const summary = buildModelRouteSummary(decisions);

    expect(roundTrip).toHaveLength(MODEL_TASKS.length);
    expect(roundTrip[0]).toHaveProperty("task");
    expect(roundTrip[0]).toHaveProperty("selectedProvider");
    expect(roundTrip[0]).toHaveProperty("mediaAccessPolicy");
    expect(roundTrip[0]).toHaveProperty("effectScope");
    expect(roundTrip[0]).toHaveProperty("consumesSamplePixelsLocally");
    expect(summary.version).toBe("model-router-v4.2");
    expect(summary.totalTasks).toBe(MODEL_TASKS.length);
    expect(summary.summary.externalSampleMediaUploads).toBe(0);
  });
});
