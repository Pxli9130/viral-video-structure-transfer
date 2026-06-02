import { describe, expect, it } from "vitest";
import { ffmpegFallbackOverlayFilters, planFfmpegEffectFallback } from "../src/adapters/renderers.js";

const palette = {
  bg: "0x05060a",
  primary: "0xe11d2a",
  accent: "0xf5c518",
  secondary: "0xa855f7",
  cool: "0x22d3ee",
  text: "white",
  muted: "0x334155"
};

const MOTIFS = [
  "poster_ribbon_marketing",
  "card_orbit_motion_graph",
  "blue_spotlight_ui_pitch",
  "beat_cut_chinese_editing_tutorial"
] as const;

describe("FFmpeg effect fallback (P8)", () => {
  it("render plan includes the selected effect id and is not ignored", () => {
    const plan = planFfmpegEffectFallback({ effectProgramIds: ["RibbonPosterSweep"], motifFamily: "poster_ribbon_marketing" });
    expect(plan.effectProgramIds).toEqual(["RibbonPosterSweep"]);
    expect(plan.ffmpegEffectFallbackUsed).toBe(true);
    expect(plan.fallbackReason).toBeTruthy();
  });

  it("produces a non-empty fallback layer list AND overlay filters for each motif", () => {
    for (const motif of MOTIFS) {
      const plan = planFfmpegEffectFallback({ effectProgramIds: ["X"], motifFamily: motif });
      expect(plan.fallbackVisualLayersAdded.length, motif).toBeGreaterThan(0);
      const filters = ffmpegFallbackOverlayFilters(motif, 720, 1280, palette, "0.5000");
      expect(filters.length, motif).toBeGreaterThan(0);
      // overlay filters must be real drawbox/drawtext expressions
      expect(filters.join(";"), motif).toMatch(/drawbox|drawtext/);
    }
  });

  it("no effect selected => no fallback used, no overlays", () => {
    const plan = planFfmpegEffectFallback({});
    expect(plan.ffmpegEffectFallbackUsed).toBe(false);
    expect(plan.effectProgramIds).toEqual([]);
    expect(plan.fallbackVisualLayersAdded).toEqual([]);
    expect(ffmpegFallbackOverlayFilters("generic_motion_graph", 720, 1280, palette, "0.5")).toEqual([]);
  });

  it("beat-cut fallback includes Chinese pop text + flash + slash bars", () => {
    const filters = ffmpegFallbackOverlayFilters("beat_cut_chinese_editing_tutorial", 720, 1280, palette, "0.5");
    const joined = filters.join(";");
    expect(joined).toMatch(/drawtext/);
    expect(joined).toContain("重点");
    expect(joined).toContain("enable=");
  });
});
