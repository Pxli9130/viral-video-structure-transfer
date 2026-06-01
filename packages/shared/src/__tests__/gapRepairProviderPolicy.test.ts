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
    const scribe = resolveProviderRoute("speech_to_text", { env }, "elevenlabs_scribe");
    const music = resolveProviderRoute("music_generation", { env }, "elevenlabs_music");

    expect(seedance.selectedProviderId).toBe("local_remotion_procedural");
    expect(seedream.selectedProviderId).toBe("local_remotion_procedural");
    expect(scribe.selectedProviderId).toBe("local_faster_whisper");
    expect(music.selectedProviderId).toBe("local_ffmpeg_procedural");
    for (const route of [seedance, seedream, scribe, music]) {
      expect(route.fallbackUsed).toBe(true);
      const record = buildProviderCallRecord(route);
      expect(record.sampleFramesSentExternally).toBe(false);
      expect(record.sampleAudioSentExternally).toBe(false);
      expect(["procedural", "aigc_generated_material"]).toContain(record.provenance);
    }
  });
});
