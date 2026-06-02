import { describe, expect, it } from "vitest";
import {
  BUILT_IN_EFFECT_ENTRIES,
  findEffectsByMotif,
  findValidatedGeneratedEffectByMotif,
  loadEffectKnowledgeBase,
  upsertEffectKnowledgeEntry,
  type EffectKnowledgeEntry
} from "../index.js";

describe("EffectKnowledgeBase", () => {
  it("guarantees the four built-in entries even with no manifest file", () => {
    const kb = loadEffectKnowledgeBase("/nonexistent/effects.json");
    expect(kb.entries.length).toBeGreaterThanOrEqual(4);
    for (const builtin of BUILT_IN_EFFECT_ENTRIES) {
      expect(kb.entries.some((e) => e.id === builtin.id && e.source === "built_in")).toBe(true);
    }
  });

  it("looks up by motifFamily", () => {
    const kb = loadEffectKnowledgeBase("/nonexistent/effects.json");
    const poster = findEffectsByMotif(kb, "poster_ribbon_marketing");
    expect(poster.some((e) => e.effectName === "RibbonPosterSweep")).toBe(true);
    expect(findEffectsByMotif(kb, "card_orbit_motion_graph").some((e) => e.effectName === "CardOrbitStack")).toBe(true);
  });

  it("prefers a validated generated effect over built-in when present", () => {
    const generated: EffectKnowledgeEntry = {
      id: "GenRibbonV2",
      motifFamily: "poster_ribbon_marketing",
      effectName: "GeneratedRibbonV2",
      componentName: "GeneratedRibbonV2",
      componentPath: "apps/api/remotion/effects/generated/GeneratedRibbonV2.tsx",
      source: "generated",
      provider: "gemini",
      validationStatus: "pass",
      promoted: true,
      learnedFromSamples: ["marketing"],
      applicableWhen: ["poster"],
      avoidWhen: [],
      requiredProps: ["width", "height", "fps", "durationSec"],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(loadEffectKnowledgeBase("/nonexistent/effects.json"), generated);
    const found = findValidatedGeneratedEffectByMotif(kb, "poster_ribbon_marketing");
    expect(found?.id).toBe("GenRibbonV2");
  });

  it("does NOT return a validated but UN-promoted generated effect (no built-in shadowing)", () => {
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
      requiredProps: [],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(loadEffectKnowledgeBase("/nonexistent/effects.json"), unpromoted);
    expect(findValidatedGeneratedEffectByMotif(kb, "poster_ribbon_marketing")).toBeUndefined();
  });

  it("does NOT return a failed generated effect as usable", () => {
    const failed: EffectKnowledgeEntry = {
      id: "GenBadCard",
      motifFamily: "card_orbit_motion_graph",
      effectName: "GeneratedBadCard",
      componentName: "GeneratedBadCard",
      componentPath: "apps/api/remotion/effects/generated/GeneratedBadCard.tsx",
      source: "generated",
      provider: "gemini",
      validationStatus: "fail",
      learnedFromSamples: [],
      applicableWhen: [],
      avoidWhen: [],
      requiredProps: [],
      createdAt: "2026-06-02T00:00:00.000Z"
    };
    const kb = upsertEffectKnowledgeEntry(loadEffectKnowledgeBase("/nonexistent/effects.json"), failed);
    expect(findValidatedGeneratedEffectByMotif(kb, "card_orbit_motion_graph")).toBeUndefined();
  });
});
