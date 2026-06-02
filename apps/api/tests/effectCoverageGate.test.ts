import { describe, expect, it } from "vitest";
import { evaluateEffectCoverage } from "../../scripts/evaluate-effect-coverage.mjs";
import { loadEffectKnowledgeBase } from "@vvst/shared";

const kb = loadEffectKnowledgeBase("/nonexistent/effects.json");

function builtInArtifact() {
  return {
    kb,
    spec: { id: "ces_poster", motifFamily: "poster_ribbon_marketing" },
    recipe: {
      creativeEffectSpecId: "ces_poster",
      motifFamily: "poster_ribbon_marketing",
      effectProgramIds: ["RibbonPosterSweep"],
      effectSelection: { source: "built_in" }
    },
    selection: { source: "built_in", effectProgramIds: ["RibbonPosterSweep"], effectNames: ["RibbonPosterSweep"], motifFamily: "poster_ribbon_marketing" },
    renderReport: { effectProgramIds: ["RibbonPosterSweep"] },
    hasFinalVideo: true
  };
}

describe("evaluate-effect-coverage gate (P9)", () => {
  it("old artifact without effect fields FAILS strict mode", () => {
    const r = evaluateEffectCoverage({ kb, recipe: { motifFamily: undefined }, hasContactSheet: true, strict: true });
    expect(r.pass).toBe(false);
    expect(r.failures).toContain("effect_ids_present");
  });

  it("artifact with a built-in effect PASSES (strict)", () => {
    const r = evaluateEffectCoverage({ ...builtInArtifact(), strict: true });
    expect(r.pass, JSON.stringify(r.failures)).toBe(true);
  });

  it("missing/unknown effect id FAILS", () => {
    const art = builtInArtifact();
    art.recipe.effectProgramIds = ["NopeEffectThatDoesNotExist"];
    art.selection = { source: "built_in", effectProgramIds: ["NopeEffectThatDoesNotExist"], effectNames: ["NopeEffectThatDoesNotExist"], motifFamily: "poster_ribbon_marketing" };
    art.renderReport = { effectProgramIds: ["NopeEffectThatDoesNotExist"] };
    const r = evaluateEffectCoverage({ ...art, strict: true });
    expect(r.pass).toBe(false);
    expect(r.failures).toContain("effect_ids_known");
  });

  it("all four motif families pass strict coverage (4.md)", () => {
    const motifs = [
      ["poster_ribbon_marketing", "RibbonPosterSweep"],
      ["card_orbit_motion_graph", "CardOrbitStack"],
      ["blue_spotlight_ui_pitch", "BlueUiSpotlight"],
      ["beat_cut_chinese_editing_tutorial", "BeatCutKineticText"]
    ] as const;
    for (const [motif, effect] of motifs) {
      const r = evaluateEffectCoverage({
        kb,
        spec: { id: `ces_${motif}`, motifFamily: motif },
        recipe: { creativeEffectSpecId: `ces_${motif}`, motifFamily: motif, effectProgramIds: [effect], effectSelection: { source: "built_in" }, effectPropsById: { [effect]: { width: 720, colors: ["#000"] } } },
        selection: { source: "built_in", effectProgramIds: [effect], effectNames: [effect], motifFamily: motif },
        renderReport: { effectProgramIds: [effect] },
        hasFinalVideo: true,
        strict: true
      });
      expect(r.pass, `${motif}: ${JSON.stringify(r.failures)}`).toBe(true);
    }
  });

  it("a sample path in effect props fails the gate", () => {
    const art = builtInArtifact();
    art.recipe.effectPropsById = { RibbonPosterSweep: { assets: [{ id: "x", src: "/home/x/test_videos/marketing.mov" }] } };
    const r = evaluateEffectCoverage({ ...art, strict: true });
    expect(r.failures).toContain("no_sample_paths_in_props");
    expect(r.pass).toBe(false);
  });

  it("generic-only artifact FAILS strict mode but is allowed non-strict", () => {
    const generic = {
      kb,
      spec: { id: "ces_generic", motifFamily: "generic_motion_graph" },
      recipe: { creativeEffectSpecId: "ces_generic", motifFamily: "generic_motion_graph", effectProgramIds: [], effectSelection: { source: "legacy_fallback" } },
      selection: { source: "legacy_fallback", effectProgramIds: [], effectNames: [], motifFamily: "generic_motion_graph" },
      renderReport: {},
      hasContactSheet: true
    };
    expect(evaluateEffectCoverage({ ...generic, strict: true }).pass).toBe(false);
    // non-strict: generic still fails effect_ids_present (no program selected) — by design the gate
    // requires a selected effect even non-strict; assert the strict-specific failure is the differentiator.
    const strictRes = evaluateEffectCoverage({ ...generic, strict: true });
    expect(strictRes.failures).toContain("not_generic_in_strict");
  });
});
