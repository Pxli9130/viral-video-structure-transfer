import { describe, expect, it } from "vitest";
import { extractTechniqueAtoms, type StructureTemplate } from "../index.js";

function baseTemplate(partial: Partial<StructureTemplate> = {}): StructureTemplate {
  return {
    id: "template_pr2",
    projectId: "project_pr2",
    name: "PR2 fixture",
    vertical: "b2b_marketing_mg",
    sourceSampleIds: ["sample_pr2"],
    segments: [
      { id: "seg_hook", role: "hook", startRatio: 0, endRatio: 0.25, intent: "hook", slots: ["slot_hook"] },
      { id: "seg_body", role: "body", startRatio: 0.25, endRatio: 0.7, intent: "body", slots: ["slot_body"] },
      { id: "seg_cta", role: "cta", startRatio: 0.7, endRatio: 1, intent: "cta", slots: ["slot_cta"] }
    ],
    requiredSlots: [],
    rhythm: { pace: "fast", averageShotDurationSec: 1.2, bpm: 124 },
    packaging: {},
    structureAtoms: [],
    editingTechniques: [],
    replacementPolicy: { doNotCopySampleVisuals: true },
    qualityRationale: "fixture",
    sourcePolicy: { sampleSource: "demo_only", commercialUse: false },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial
  } as StructureTemplate;
}

describe("TechniqueAtom extraction", () => {
  it("extracts ribbon, typography, hero and CTA atoms from marketing evidence", () => {
    const atoms = extractTechniqueAtoms(baseTemplate({
      motionAtoms: [{ type: "parametric_ribbon_surface", fulfilledBy: "procedural_generation", keywords: ["A"], colorProgression: ["#fff"], style: "mg_motion", density: 2, speed: 1, opacity: 0.7, pathFamily: "vertical_helix", surfaceType: "wide_band", startSec: 0, endSec: 15, evidenceFrames: [2.4] }],
      typographyEvidence: [
        { textLayerId: "typo_1", timeSec: 1, text: "AeroSpin", bboxNorm: [0.12, 0.18, 0.76, 0.12], layoutRole: "top_tag", colorRole: "white", fontSizeRatio: 0.07, animationHint: "sweep", confidence: 0.92 }
      ],
      visualElementGraph: {
        schemaVersion: "visual-element-graph-v1",
        elements: [
          { id: "ve_hero", family: "hero_object", timeRangeSec: [0, 4], bboxTrackNorm: [{ t: 1, bbox: [0.2, 0.18, 0.6, 0.5] }], motionPattern: "orbit", evidence: { frameIds: ["f001"], confidence: 0.88 } },
          { id: "ve_cta", family: "brand_cta", timeRangeSec: [12, 15], bboxTrackNorm: [{ t: 13, bbox: [0.08, 0.72, 0.84, 0.12] }] }
        ]
      }
    }));

    expect(atoms.map((atom) => atom.name)).toEqual(expect.arrayContaining([
      "ParametricRibbonSurface",
      "KineticTypographySweep",
      "ProductPosterHero",
      "ObjectTrackReveal",
      "CTAEndSlate"
    ]));
    expect(atoms.every((atom) => atom.sourceEvidenceRefs.length > 0 || Boolean(atom.fallbackReason))).toBe(true);
  });

  it("extracts text-heavy and montage techniques from direct evidence rather than videoType", () => {
    const textHeavy = extractTechniqueAtoms(baseTemplate({
      videoType: "fallback_cards",
      typographyEvidence: [
        { textLayerId: "typo_big", timeSec: 1, bboxNorm: [0.08, 0.3, 0.84, 0.2], layoutRole: "center_title", colorRole: "yellow", fontSizeRatio: 0.12, animationHint: "scale" },
        { textLayerId: "typo_list", timeSec: 3, bboxNorm: [0.12, 0.55, 0.76, 0.18], layoutRole: "rule_list", colorRole: "white", fontSizeRatio: 0.07, animationHint: "slide_left" }
      ]
    }));
    const montage = extractTechniqueAtoms(baseTemplate({
      videoType: "fallback_cards",
      visualElementGraph: {
        schemaVersion: "visual-element-graph-v1",
        elements: [
          { id: "ve_montage", family: "live_action_montage", timeRangeSec: [1, 6], bboxTrackNorm: [{ t: 2, bbox: [0.05, 0.08, 0.9, 0.72] }], motionPattern: "fast_pan" }
        ]
      }
    }));

    expect(textHeavy.some((atom) => atom.name === "KineticTypographySweep")).toBe(true);
    expect(montage.some((atom) => atom.name === "SourceClipBeatMontage")).toBe(true);
    expect(montage.find((atom) => atom.name === "SourceClipBeatMontage")?.sourceEvidenceRefs[0]).toContain("ve_montage");
  });
});
