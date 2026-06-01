import { describe, expect, it } from "vitest";
import {
  buildRenderRecipe,
  extractTechniqueAtoms,
  parsePromptToBrief,
  validateRenderRecipe,
  type GenerationRequest,
  type SourceVideoUnderstanding,
  type StructureTemplate,
  type TimelineClip
} from "../index.js";

function request(): GenerationRequest {
  return {
    projectId: "project_pr2_recipe",
    inputMode: "brief_assets",
    prompt: "AeroSpin 便携涡轮小风扇。突出强风、快充、低噪音。CTA：现在入手。",
    targetAssets: [
      { id: "fan_hero", kind: "image", role: "object_motion" },
      { id: "fan_card", kind: "image", role: "feature_card" }
    ],
    target: { vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 12, outputMode: "storyboard_preview" },
    controls: { recipeEvidencePrimitives: true, packagingStyle: "mg_motion" },
    constraints: { noSampleVisualCopy: true }
  };
}

function template(): StructureTemplate {
  const base = {
    id: "template_recipe_pr2",
    projectId: "project_pr2_recipe",
    name: "Technique template",
    vertical: "b2b_marketing_mg",
    sourceSampleIds: ["sample_recipe_pr2"],
    segments: [
      { id: "seg_hook", role: "hook", startRatio: 0, endRatio: 0.25, intent: "hero", slots: ["slot_hero"] },
      { id: "seg_body", role: "body", startRatio: 0.25, endRatio: 0.75, intent: "proof", slots: ["slot_body"] },
      { id: "seg_cta", role: "cta", startRatio: 0.75, endRatio: 1, intent: "cta", slots: ["slot_cta"] }
    ],
    requiredSlots: [],
    rhythm: { pace: "fast", averageShotDurationSec: 1.1, bpm: 132 },
    packaging: { subtitleStyle: "bold_bbox", titleCardStyle: "ribbon_title" },
    structureAtoms: [],
    editingTechniques: [],
    replacementPolicy: { doNotCopySampleVisuals: true },
    qualityRationale: "fixture",
    sourcePolicy: { sampleSource: "demo_only", commercialUse: false },
    visualElementGraph: {
      schemaVersion: "visual-element-graph-v1",
      elements: [
        { id: "hero_track", family: "hero_object", timeRangeSec: [0, 4], bboxTrackNorm: [{ t: 1, bbox: [0.2, 0.12, 0.6, 0.46] }], motionPattern: "orbit", evidence: { frameIds: ["hero_frame"], confidence: 0.9 } },
        { id: "card_track", family: "media_cards", timeRangeSec: [4, 8], bboxTrackNorm: [{ t: 5, bbox: [0.08, 0.2, 0.38, 0.28] }] }
      ]
    },
    typographyEvidence: [
      { textLayerId: "title_text", timeSec: 1, bboxNorm: [0.1, 0.08, 0.8, 0.14], layoutRole: "top_tag", colorRole: "white", fontSizeRatio: 0.075, animationHint: "slide_left" },
      { textLayerId: "body_text", timeSec: 5, bboxNorm: [0.12, 0.58, 0.76, 0.15], layoutRole: "lower_third", colorRole: "yellow", fontSizeRatio: 0.095, animationHint: "scale" }
    ],
    motionAtoms: [{ type: "parametric_ribbon_surface", fulfilledBy: "procedural_generation", keywords: ["A"], colorProgression: ["#22d3ee", "#f5c518"], style: "mg_motion", density: 3, speed: 1, opacity: 0.7, startSec: 0, endSec: 12, evidenceFrames: [2.4] }],
    audioStructure: {
      estimatedLayers: { bass_kick: 0.65, music_harmonic: 0.28, hats_air: 0.52 },
      bpm: 132,
      strongBeats: [0.25, 0.72, 1.2, 1.66],
      spectralCentroidMean: 3400,
      spectralFlatnessMean: 0.42
    },
    createdAt: "2026-01-01T00:00:00.000Z"
  } as StructureTemplate;
  return { ...base, techniqueAtoms: extractTechniqueAtoms(base) };
}

function clip(partial: Partial<TimelineClip>): TimelineClip {
  return {
    id: "clip",
    role: "body",
    startSec: 0,
    durationSec: 3,
    type: "generated_card",
    layers: [],
    subtitleText: "强风快充",
    ...partial
  } as TimelineClip;
}

const source: SourceVideoUnderstanding = { summary: "", candidates: [], warnings: [], materialRole: "mock", reusableAsMaterial: false };

describe("PR2 render recipe diversity", () => {
  it("uses TechniqueAtoms for mixed primitives, geometry and audio layers", () => {
    const tpl = template();
    const recipe = buildRenderRecipe({
      styledClips: [
        clip({ id: "clip_hook", role: "hook", sourceAssetId: "fan_hero", visualFormFamily: "object_motion", layers: [{ id: "layer_hero", kind: "base_visual", assetId: "fan_hero", style: { elementGeometry: { bbox: [0.2, 0.12, 0.6, 0.46], motionPattern: "orbit" } } }] }),
        clip({ id: "clip_cards", role: "body", sourceAssetId: "fan_card", visualFormFamily: "media_cards", startSec: 3, layers: [{ id: "layer_card", kind: "base_visual", assetId: "fan_card", style: { elementGeometry: { bbox: [0.08, 0.2, 0.38, 0.28], motionPattern: "cascade" } } }] }),
        clip({ id: "clip_text", role: "proof", visualFormFamily: "kinetic_typography", startSec: 6, layers: [{ id: "layer_text", kind: "text", style: { typography: { bboxNorm: [0.12, 0.58, 0.76, 0.15], layoutRole: "lower_third", colorRole: "yellow", fontSizeRatio: 0.095, animationHint: "scale" } } }] }),
        clip({ id: "clip_cta", role: "cta", startSec: 9, subtitleText: "现在入手", layers: [] })
      ],
      isBeatCut: false,
      videoType: "motion_graph",
      aspectRatio: "9:16",
      width: 720,
      height: 1280,
      durationSec: 12,
      synthBeat: { bpm: 120, beats: [0, 0.5, 1] },
      audioPolicy: "synth_beat",
      background: "#05060a",
      brief: parsePromptToBrief(request()),
      template: tpl,
      source,
      request: request(),
      warnings: [],
      motionAtoms: tpl.motionAtoms
    });

    expect(validateRenderRecipe(recipe).valid).toBe(true);
    expect(new Set(recipe.clips.map((item) => item.selectedPrimitive)).size).toBeGreaterThan(2);
    expect(recipe.clips.map((item) => item.selectedPrimitive)).toEqual(expect.arrayContaining([
      "ProductPosterHero",
      "MediaCardCascade",
      "KineticTypographySweep",
      "CTAEndSlate"
    ]));
    expect(recipe.layers?.some((layer) => layer.type === "motion_atom")).toBe(true);
    expect(recipe.layers?.filter((layer) => layer.type === "media").map((layer) => layer.layout.bboxNorm)).toEqual(expect.arrayContaining([
      { x: 0.2, y: 0.12, w: 0.6, h: 0.46 },
      { x: 0.08, y: 0.2, w: 0.38, h: 0.28 }
    ]));
    const audio = recipe.layers?.filter((layer) => layer.type === "audio").map((layer) => layer.audio);
    expect(audio?.length).toBeGreaterThanOrEqual(3);
    expect(audio?.some((layer) => layer.kind === "impact" && (layer.weight ?? 0) > 0)).toBe(true);
    expect(audio?.some((layer) => (layer.densityCurve?.length ?? 0) > 0)).toBe(true);
  });
});
