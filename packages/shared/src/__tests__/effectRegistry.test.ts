import { describe, expect, it } from "vitest";
import {
  loadEffectKnowledgeBase,
  selectEffect,
  upsertEffectKnowledgeEntry,
  type EffectKnowledgeEntry,
  type MotifFamily
} from "../index.js";

const KB = loadEffectKnowledgeBase("/nonexistent/effects.json");

describe("EffectRegistry selection", () => {
  it("each motif selects its correct built-in effect", () => {
    const expected: Record<string, string> = {
      poster_ribbon_marketing: "RibbonPosterSweep",
      card_orbit_motion_graph: "CardOrbitStack",
      blue_spotlight_ui_pitch: "BlueUiSpotlight",
      beat_cut_chinese_editing_tutorial: "BeatCutKineticText"
    };
    for (const [motif, effect] of Object.entries(expected)) {
      const r = selectEffect({ motifFamily: motif as MotifFamily }, KB);
      expect(r.selected).toBe(true);
      expect(r.source).toBe("built_in");
      expect(r.effectProgramIds).toEqual([effect]);
      expect(r.requiredProps).toContain("width");
    }
  });

  it("preferGenerated selects a validated generated entry over built-in", () => {
    const gen: EffectKnowledgeEntry = {
      id: "GenRibbonV2",
      motifFamily: "poster_ribbon_marketing",
      effectName: "GeneratedRibbonV2",
      componentName: "GeneratedRibbonV2",
      componentPath: "apps/api/remotion/effects/generated/GeneratedRibbonV2.tsx",
      source: "generated",
      provider: "gemini",
      validationStatus: "pass",
      promoted: true,
      learnedFromSamples: [],
      applicableWhen: [],
      avoidWhen: [],
      requiredProps: ["width", "height", "fps", "durationSec"],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(KB, gen);
    const r = selectEffect({ motifFamily: "poster_ribbon_marketing", preferGenerated: true, componentExists: () => true }, kb);
    expect(r.source).toBe("generated");
    expect(r.effectProgramIds).toEqual(["GenRibbonV2"]);
  });

  it("does NOT select a validated but UN-promoted generated effect (built-in keeps winning)", () => {
    const unpromoted: EffectKnowledgeEntry = {
      id: "GenRibbonUnpromoted",
      motifFamily: "poster_ribbon_marketing",
      effectName: "GeneratedRibbonUnpromoted",
      componentName: "GeneratedRibbonUnpromoted",
      componentPath: "apps/api/remotion/effects/generated/GenRibbonUnpromoted/index.tsx",
      source: "generated",
      provider: "local",
      validationStatus: "pass_with_preview_blocker",
      promoted: false,
      learnedFromSamples: [],
      applicableWhen: [],
      avoidWhen: [],
      requiredProps: ["width", "height", "fps", "durationSec"],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(KB, unpromoted);
    const r = selectEffect({ motifFamily: "poster_ribbon_marketing", preferGenerated: true, componentExists: () => true }, kb);
    expect(r.source).toBe("built_in");
    expect(r.effectProgramIds).toEqual(["RibbonPosterSweep"]);
  });

  it("ignores a validated generated effect whose source file is missing (fallback reason)", () => {
    const gen: EffectKnowledgeEntry = {
      id: "GenMissing",
      motifFamily: "poster_ribbon_marketing",
      effectName: "GenMissing",
      componentName: "GenMissing",
      componentPath: "apps/api/remotion/effects/generated/GenMissing/index.tsx",
      source: "generated",
      provider: "gemini",
      validationStatus: "pass",
      promoted: true,
      learnedFromSamples: [],
      applicableWhen: [],
      avoidWhen: [],
      requiredProps: [],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(KB, gen);
    const r = selectEffect({ motifFamily: "poster_ribbon_marketing", preferGenerated: true, componentExists: () => false }, kb);
    expect(r.source).toBe("built_in");
    expect(r.effectProgramIds).toEqual(["RibbonPosterSweep"]);
    expect(r.fallbackReason).toMatch(/source file missing/);
  });

  it("ignores a failed generated entry and falls back to built-in", () => {
    const failed: EffectKnowledgeEntry = {
      id: "GenBad",
      motifFamily: "card_orbit_motion_graph",
      effectName: "GeneratedBad",
      componentName: "GeneratedBad",
      componentPath: "apps/api/remotion/effects/generated/GeneratedBad.tsx",
      source: "generated",
      provider: "gemini",
      validationStatus: "fail",
      learnedFromSamples: [],
      applicableWhen: [],
      avoidWhen: [],
      requiredProps: [],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(KB, failed);
    const r = selectEffect({ motifFamily: "card_orbit_motion_graph", preferGenerated: true }, kb);
    expect(r.source).toBe("built_in");
    expect(r.effectProgramIds).toEqual(["CardOrbitStack"]);
  });

  it("strict mode does not select an effect when none exists (generic)", () => {
    const r = selectEffect({ motifFamily: "generic_motion_graph", strictEffectCoverage: true }, KB);
    expect(r.selected).toBe(false);
    expect(r.source).toBe("none");
    expect(r.fallbackReason).toBeTruthy();
  });

  it("non-strict mode produces an explicit legacy fallback reason for generic", () => {
    const r = selectEffect({ motifFamily: "generic_motion_graph" }, KB);
    expect(r.source).toBe("legacy_fallback");
    expect(r.fallbackReason).toBeTruthy();
    expect(r.effectProgramIds).toEqual([]);
  });
});
