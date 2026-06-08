import { describe, expect, it } from "vitest";
import {
  buildProviderCallRecord,
  generateGapReport,
  resolveProviderRoute,
  type SlotMapping
} from "../index.js";

function missingMapping(slotId: string, slotType: SlotMapping["slotType"], visualFormFamily?: SlotMapping["visualFormFamily"]): SlotMapping {
  return {
    slotId,
    slotRole: slotType === "cta_visual" ? "cta" : "hook",
    slotType,
    status: "missing",
    candidateShotIds: [],
    reason: `${slotId} missing`,
    confidence: 0.1,
    risks: ["missing"],
    visualFormFamily
  };
}

describe("Gap repair options and provider policy", () => {
  it("adds impact, repairOptions, selectedRepair and expected result to missing gaps", () => {
    const gaps = generateGapReport([
      missingMapping("slot_opening_hook", "hook_visual", "object_motion"),
      missingMapping("slot_use_case", "usage_scene", "live_action_montage"),
      missingMapping("slot_cta", "cta_visual", "brand_cta"),
      missingMapping("slot_audio", "audio", "audio")
    ]);

    expect(gaps.length).toBeGreaterThanOrEqual(4);
    for (const gap of gaps) {
      expect(gap.impact.length).toBeGreaterThan(0);
      expect(gap.repairOptions?.length).toBeGreaterThan(0);
      expect(gap.selectedRepair).toBeDefined();
      expect(gap.expectedVisualResult?.length).toBeGreaterThan(0);
    }
    expect(gaps.find((gap) => gap.slotId === "slot_use_case")?.repairOptions?.map((option) => option.strategy)).toContain("asset_reuse");
    expect(gaps.find((gap) => gap.slotId === "slot_cta")?.selectedRepair?.strategy).toBe("packaging_fill");
  });

  it("keeps optional cloud providers env-gated and routes to local fallbacks", () => {
    const env = {};
    const seedance = resolveProviderRoute("video_generation", { env }, "seedance_2_0");
    const seedream = resolveProviderRoute("image_generation", { env }, "seedream_4_0");
    const scribe = resolveProviderRoute("speech_to_text", { env });
    const music = resolveProviderRoute("music_generation", { env }, "google_lyria_music");
    const sfx = resolveProviderRoute("sound_effects", { env });

    expect(seedance.selectedProviderId).toBe("local_remotion_procedural");
    expect(seedream.selectedProviderId).toBe("local_remotion_procedural");
    expect(scribe.selectedProviderId).toBe("local_faster_whisper");
    expect(music.selectedProviderId).toBe("local_ffmpeg_procedural");
    expect(sfx.selectedProviderId).toBe("local_ffmpeg_procedural");
    for (const route of [seedance, seedream, music]) {
      expect(route.fallbackUsed).toBe(true);
      const record = buildProviderCallRecord(route);
      expect(record.sampleFramesSentExternally).toBe(false);
      expect(record.sampleAudioSentExternally).toBe(false);
      expect(["procedural", "aigc_generated_material"]).toContain(record.provenance);
    }
    for (const route of [scribe, sfx]) {
      expect(route.fallbackUsed).toBe(false);
      const record = buildProviderCallRecord(route);
      expect(record.sampleFramesSentExternally).toBe(false);
      expect(record.sampleAudioSentExternally).toBe(false);
      expect(record.provenance).toBe("procedural");
    }
  });

  it("ignores obsolete ElevenLabs env in the legacy provider router", () => {
    const env = { ELEVENLABS_API_KEY: "test-key", ENABLE_ELEVENLABS_LIVE_TESTS: "1" };
    const music = resolveProviderRoute("music_generation", { env });
    const sfx = resolveProviderRoute("sound_effects", { env });
    const scribe = resolveProviderRoute("speech_to_text", { env });

    expect(music.selectedProviderId).toBe("local_ffmpeg_procedural");
    expect(sfx.selectedProviderId).toBe("local_ffmpeg_procedural");
    expect(scribe.selectedProviderId).toBe("local_faster_whisper");
    for (const route of [music, sfx, scribe]) {
      expect(buildProviderCallRecord(route).sampleAudioSentExternally).toBe(false);
    }
  });

  it("routes Google audio directly to local unless Google audio is enabled", () => {
    const disabled = resolveProviderRoute("music_generation", { env: { GEMINI_API_KEY: "test-key" } }, "google_lyria_music");
    const google = resolveProviderRoute(
      "music_generation",
      { env: { GEMINI_API_KEY: "test-key", GOOGLE_AUDIO_ENABLE_CLOUD: "1" } },
      "google_lyria_music"
    );

    expect(disabled.selectedProviderId).toBe("local_ffmpeg_procedural");
    expect(google.selectedProviderId).toBe("google_lyria_music");
    for (const route of [disabled, google]) {
      expect(buildProviderCallRecord(route).sampleAudioSentExternally).toBe(false);
    }
  });

  it("selects Seedance in the legacy provider router when the shared Ark key is present", () => {
    const route = resolveProviderRoute("video_generation", { env: { SEEDREAM_ARK_API_KEY: "test-key" } }, "seedance_2_0");
    expect(route.selectedProviderId).toBe("seedance_2_0");
    expect(route.fallbackUsed).toBe(false);
    const record = buildProviderCallRecord(route);
    expect(record.provenance).toBe("aigc_generated_material");
    expect(record.sampleFramesSentExternally).toBe(false);
    expect(record.sampleAudioSentExternally).toBe(false);
  });
});
