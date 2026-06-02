import { describe, expect, it } from "vitest";
import {
  buildDeterministicCreativeEffectSpecFromEvidence,
  mapEvidenceToMotifFamily,
  validateCreativeEffectSpec
} from "../index.js";

describe("CreativeEffectSpec deterministic motif mapping", () => {
  it("maps marketing-like (ribbon/poster/white/gallery) evidence to poster_ribbon_marketing", () => {
    expect(
      mapEvidenceToMotifFamily({
        techniqueKeywords: ["ribbon_sweep", "poster_layout", "gallery_cta"],
        palette: ["white", "cream", "gold"],
        videoType: "b2b_marketing_mg"
      })
    ).toBe("poster_ribbon_marketing");
  });

  it("maps card/orbit/scatter evidence to card_orbit_motion_graph", () => {
    expect(
      mapEvidenceToMotifFamily({
        techniqueKeywords: ["card_orbit", "stack_collapse", "scatter_burst"],
        palette: ["black", "red"],
        videoType: "motion_graph"
      })
    ).toBe("card_orbit_motion_graph");
  });

  it("maps blue UI/dashboard/spotlight/search evidence to blue_spotlight_ui_pitch", () => {
    expect(
      mapEvidenceToMotifFamily({
        techniqueKeywords: ["spotlight_sweep", "dashboard_panel", "search_bar"],
        palette: ["blue", "black"],
        visualForms: ["ui_panel"]
      })
    ).toBe("blue_spotlight_ui_pitch");
  });

  it("maps Chinese OCR + beat_cut + high BPM evidence to beat_cut_chinese_editing_tutorial", () => {
    expect(
      mapEvidenceToMotifFamily({
        ocrText: ["三档强风", "USB-C 快充"],
        techniqueKeywords: ["whip_pan", "glitch_cut"],
        videoType: "beat_cut",
        bpm: 129,
        palette: ["black", "red", "yellow", "white"]
      })
    ).toBe("beat_cut_chinese_editing_tutorial");
  });

  it("maps split-screen / before-after / 对比 evidence to split_screen_compare", () => {
    expect(
      mapEvidenceToMotifFamily({
        techniqueKeywords: ["split_screen", "side_by_side"],
        ocrText: ["对比", "BEFORE", "AFTER"],
        videoType: "comparison"
      })
    ).toBe("split_screen_compare");
    // builds a valid spec carrying the SplitScreenCompare built-in effect name
    const spec = buildDeterministicCreativeEffectSpecFromEvidence({
      caseId: "compare_case",
      techniqueKeywords: ["split_screen", "compare"],
      createdAt: "2026-06-02T00:00:00.000Z"
    });
    expect(spec.motifFamily).toBe("split_screen_compare");
    expect(spec.effectName).toBe("SplitScreenCompare");
    expect(validateCreativeEffectSpec(spec).valid).toBe(true);
  });

  it("does NOT use filenames to determine motif (no signals -> generic)", () => {
    // A misleading 'marketing' caseId with no motif signals must not yield poster_ribbon_marketing.
    expect(mapEvidenceToMotifFamily({ caseId: "marketing.mov" })).toBe("generic_motion_graph");
    // And signals win over a contradictory caseId.
    expect(
      mapEvidenceToMotifFamily({ caseId: "marketing.mov", techniqueKeywords: ["card_orbit"], palette: ["black", "red"] })
    ).toBe("card_orbit_motion_graph");
  });

  it("builds a valid deterministic spec with safety flags and no filename leakage", () => {
    const spec = buildDeterministicCreativeEffectSpecFromEvidence({
      caseId: "case_001",
      techniqueKeywords: ["card_orbit"],
      palette: ["black", "red"],
      evidenceRefs: ["evidence://sample/shot/0"],
      createdAt: "2026-06-02T00:00:00.000Z"
    });
    expect(spec.version).toBe("creative-effect-spec.v1");
    expect(spec.motifFamily).toBe("card_orbit_motion_graph");
    expect(spec.effectName).toBe("CardOrbitStack");
    expect(spec.source).toBe("deterministic");
    expect(spec.safety).toEqual({ noSamplePixelCopy: true, noSampleAudioCopy: true, propsDriven: true, noRuntimeNetwork: true });
    expect(validateCreativeEffectSpec(spec).valid).toBe(true);
  });

  it("rejects an invalid spec (missing safety / bad motif)", () => {
    const bad = validateCreativeEffectSpec({ version: "creative-effect-spec.v1", id: "x", motifFamily: "nope" });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});
