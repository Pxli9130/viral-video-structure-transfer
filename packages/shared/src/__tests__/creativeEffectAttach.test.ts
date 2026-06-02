import { describe, expect, it } from "vitest";
import {
  attachCreativeEffectToRenderRecipe,
  buildDeterministicCreativeEffectSpecFromEvidence,
  selectEffect,
  validateRenderRecipe,
  loadEffectKnowledgeBase,
  type RenderRecipe
} from "../index.js";

const KB = loadEffectKnowledgeBase("/nonexistent/effects.json");

// A minimal, schema-valid v1 RenderRecipe (no `version` → strict v1 schema path).
function baseRecipe(): RenderRecipe {
  return {
    schemaVersion: "render-recipe-v1",
    videoType: "motion_graph",
    productTheme: { name: "AeroSpin Fan", category: "portable_fan", sellingPoints: ["三档强风", "USB-C 快充"], cta: "现在入手" },
    sourcePolicy: {
      sampleUse: "structure_evidence_only",
      sourceVideoUse: "missing",
      targetAssetUse: "renderable_target_material",
      sampleFrameCopyAllowed: false,
      sampleAudioCopyAllowed: false
    },
    global: {
      aspectRatio: "9:16",
      width: 720,
      height: 1280,
      fps: 30,
      durationSec: 15,
      palette: ["#05060a", "#e11d2a", "#f5c518"],
      bpm: 120,
      beatGridSec: [0, 0.5, 1, 1.5],
      cutPattern: { targetCutCount: 5, avgShotDurationSec: 3, fastZones: [] },
      audioPlan: { policy: "procedural_bgm", layers: { kick: 0.5 } }
    },
    clips: [
      {
        clipId: "clip_1",
        role: "hook",
        startSec: 0,
        endSec: 3,
        slotId: "slot_hook",
        visualFormFamily: "product_hero",
        selectedPrimitive: "FanHeroSpin",
        primitiveReason: "hook → FanHeroSpin",
        rendererTarget: "remotion_recipe",
        material: { kind: "generated_target_asset", assetIds: ["generated_slot_hero_01"], policy: "renderable" },
        layout: {},
        motion: { pattern: "zoom_pulse", beatAligned: true, beatTimestampsSec: [] },
        text: { copy: "三档强风", colorRoles: ["white"], animationHint: "scale" }
      }
    ],
    warnings: []
  } as unknown as RenderRecipe;
}

describe("attachCreativeEffectToRenderRecipe (P4)", () => {
  it("old recipe (no effect fields) validates unchanged", () => {
    expect(validateRenderRecipe(baseRecipe()).valid).toBe(true);
  });

  it("recipe with effect fields validates and carries the optional fields", () => {
    const spec = buildDeterministicCreativeEffectSpecFromEvidence({
      caseId: "c1",
      techniqueKeywords: ["card_orbit"],
      palette: ["black", "red"],
      createdAt: "2026-06-02T00:00:00.000Z"
    });
    const selection = selectEffect({ motifFamily: spec.motifFamily }, KB);
    const recipe = attachCreativeEffectToRenderRecipe(baseRecipe(), spec, selection);
    expect(recipe.creativeEffectSpecId).toBe(spec.id);
    expect(recipe.motifFamily).toBe("card_orbit_motion_graph");
    expect(recipe.effectProgramIds).toEqual(["CardOrbitStack"]);
    expect(validateRenderRecipe(recipe).valid).toBe(true);
  });

  it("derives effect props with width/height/fps/durationSec/texts/colors/beats and NO sample paths", () => {
    const spec = buildDeterministicCreativeEffectSpecFromEvidence({ techniqueKeywords: ["card_orbit"], palette: ["black", "red"] });
    const selection = selectEffect({ motifFamily: spec.motifFamily }, KB);
    const recipe = attachCreativeEffectToRenderRecipe(baseRecipe(), spec, selection);
    const props = recipe.effectPropsById?.[selection.effectProgramIds[0]] as Record<string, unknown>;
    expect(props.width).toBe(720);
    expect(props.height).toBe(1280);
    expect(props.fps).toBe(30);
    expect(props.durationSec).toBe(15);
    expect(Array.isArray(props.colors)).toBe(true);
    expect((props.colors as string[]).length).toBeGreaterThan(0);
    expect(Array.isArray(props.beats)).toBe(true);
    expect((props.beats as number[]).length).toBeGreaterThan(0);
    expect((props.texts as Array<{ text: string }>).some((t) => t.text === "三档强风")).toBe(true);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toMatch(/test_videos\/|learned_samples|sample[_-]?evidence/);
  });

  it("attaches effectProgramIds when motifFamily exists; records fallback reason for generic", () => {
    const spec = buildDeterministicCreativeEffectSpecFromEvidence({});
    expect(spec.motifFamily).toBe("generic_motion_graph");
    const selection = selectEffect({ motifFamily: spec.motifFamily }, KB);
    const recipe = attachCreativeEffectToRenderRecipe(baseRecipe(), spec, selection);
    expect(recipe.effectProgramIds).toEqual([]);
    expect(recipe.effectFallbackReason).toBeTruthy();
    expect(validateRenderRecipe(recipe).valid).toBe(true);
  });
});
