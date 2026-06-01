import { describe, expect, it } from "vitest";
import {
  buildRecipeVersions,
  naturalEditToRecipePatch,
  type RenderRecipe,
  type RenderRecipeAudioLayer,
  type RenderRecipeTextLayer
} from "../index.js";

function recipe(): RenderRecipe {
  return {
    schemaVersion: "render-recipe-v1",
    version: "render-recipe-v4.1",
    composition: { width: 720, height: 1280, fps: 30, durationSec: 12, aspectRatio: "9:16" },
    videoType: "product_mg",
    productTheme: {
      name: "AeroSpin",
      category: "portable_fan",
      sellingPoints: ["桌面手持两用", "USB-C 快充", "三档强风"],
      cta: "现在入手",
      ctaText: "现在入手"
    },
    sourcePolicy: {
      sampleUse: "structure_evidence_only",
      sourceVideoUse: "missing",
      targetAssetUse: "renderable_target_material",
      sampleFrameCopyAllowed: false,
      sampleAudioCopyAllowed: false
    },
    evidenceSummary: {
      sourceSampleIds: ["sample_marketing"],
      preservedEvidence: { visualElements: 3, typographyRuns: 4, motionAtoms: 1, audioLayers: 3 },
      droppedEvidence: []
    },
    global: {
      aspectRatio: "9:16",
      width: 720,
      height: 1280,
      fps: 30,
      durationSec: 12,
      palette: ["#05060a", "#ffffff", "#22d3ee", "#facc15"],
      cutPattern: { targetCutCount: 4, avgShotDurationSec: 2.4, fastZones: [[0, 3]] },
      audioPlan: { policy: "procedural_bgm", layers: { kick: 0.6, hats: 0.35, impact: 0.45, drone: 0.25 } }
    },
    clips: [
      {
        id: "clip_hook",
        clipId: "clip_hook",
        role: "hook",
        startSec: 0,
        endSec: 2,
        durationSec: 2,
        slotId: "slot_hero",
        visualFormFamily: "product_hero",
        selectedPrimitive: "ProductPosterHero",
        primitiveReason: "hero evidence",
        rendererTarget: "remotion_recipe",
        material: { kind: "target_image", assetIds: ["fan_hero"], policy: "renderable", provenance: "user_uploaded" },
        layout: { mediaBBoxNorm: { x: 0.18, y: 0.12, w: 0.64, h: 0.42 } },
        motion: { pattern: "orbit", beatAligned: true, beatTimestampsSec: [0.4, 0.9, 1.4] },
        text: { copy: "AeroSpin", colorRoles: ["white"], animationHint: "scale", fontSizeRatio: 0.08 }
      },
      {
        id: "clip_body",
        clipId: "clip_body",
        role: "body",
        startSec: 2,
        endSec: 8,
        durationSec: 6,
        slotId: "slot_body",
        visualFormFamily: "kinetic_typography",
        selectedPrimitive: "KineticTypographySweep",
        primitiveReason: "typography evidence",
        rendererTarget: "remotion_recipe",
        material: { kind: "target_image_set", assetIds: ["fan_card"], policy: "renderable", provenance: "user_uploaded" },
        layout: { typographyLayout: "lower_third" },
        motion: { pattern: "card_stack", beatAligned: true, beatTimestampsSec: [2.4, 3.2, 4.1] },
        text: { copy: "三档强风", colorRoles: ["yellow"], animationHint: "scale", fontSizeRatio: 0.09 }
      },
      {
        id: "clip_cta",
        clipId: "clip_cta",
        role: "cta",
        startSec: 8,
        endSec: 12,
        durationSec: 4,
        slotId: "slot_cta",
        visualFormFamily: "brand_cta",
        selectedPrimitive: "CTAEndSlate",
        primitiveReason: "cta evidence",
        rendererTarget: "remotion_recipe",
        material: { kind: "procedural", assetIds: [], policy: "renderable", provenance: "fixture" },
        layout: { typographyLayout: "center_title" },
        motion: { pattern: "zoom_pulse", beatAligned: true, beatTimestampsSec: [8.2, 9.1] },
        text: { copy: "现在入手", colorRoles: ["accent"], animationHint: "scale", fontSizeRatio: 0.1 }
      }
    ],
    layers: [
      {
        id: "media_hero",
        type: "media",
        clipId: "clip_hook",
        zIndex: 10,
        startSec: 0,
        durationSec: 2,
        evidenceRefs: ["hero_track"],
        material: { kind: "target_image", assetIds: ["fan_hero"], policy: "renderable", provenance: "user_uploaded" },
        layout: { bboxNorm: { x: 0.2, y: 0.14, w: 0.6, h: 0.38 }, fit: "heroFill", minAreaRatio: 0.18, safeArea: "body" },
        motion: { pattern: "orbit", beatAligned: true, beatTimestampsSec: [0.4, 0.9, 1.4] }
      },
      {
        id: "headline",
        type: "text",
        clipId: "clip_hook",
        zIndex: 20,
        startSec: 0.1,
        durationSec: 1.8,
        evidenceRefs: ["typo_headline"],
        text: { content: "强风快充", role: "headline" },
        layout: { bboxNorm: { x: 0.1, y: 0.08, w: 0.8, h: 0.12 }, align: "center", anchor: "center" },
        typography: { fontSizeRatio: 0.08, weight: 800, colorRole: "on_dark", color: "#ffffff" },
        animation: { enter: "scale", exit: "fade" }
      },
      {
        id: "subtitle_1",
        type: "text",
        clipId: "clip_body",
        zIndex: 20,
        startSec: 2.1,
        durationSec: 1.6,
        evidenceRefs: ["typo_sub_1"],
        text: { content: "三档强风", role: "subtitle" },
        layout: { bboxNorm: { x: 0.12, y: 0.62, w: 0.76, h: 0.08 }, align: "center", anchor: "bottom-center" },
        typography: { fontSizeRatio: 0.075, weight: 700, colorRole: "accent", color: "#facc15" },
        animation: { enter: "slide_left", exit: "fade" }
      },
      {
        id: "subtitle_2",
        type: "text",
        clipId: "clip_body",
        zIndex: 20,
        startSec: 4.1,
        durationSec: 1.5,
        evidenceRefs: ["typo_sub_2"],
        text: { content: "低噪音更舒适", role: "subtitle" },
        layout: { bboxNorm: { x: 0.12, y: 0.7, w: 0.76, h: 0.08 }, align: "center", anchor: "bottom-center" },
        typography: { fontSizeRatio: 0.07, weight: 700, colorRole: "on_dark", color: "#ffffff" },
        animation: { enter: "slide_right", exit: "fade" }
      },
      {
        id: "cta_text",
        type: "text",
        clipId: "clip_cta",
        zIndex: 30,
        startSec: 8.3,
        durationSec: 2.7,
        evidenceRefs: ["typo_cta"],
        text: { content: "现在入手", role: "cta" },
        layout: { bboxNorm: { x: 0.08, y: 0.78, w: 0.84, h: 0.12 }, align: "center", anchor: "bottom-center" },
        typography: { fontSizeRatio: 0.095, weight: 900, colorRole: "accent", color: "#facc15" },
        animation: { enter: "pop", exit: "fade" }
      },
      {
        id: "ribbon",
        type: "motion_atom",
        zIndex: 5,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["ribbon_motion"],
        atom: {
          kind: "parametric_ribbon_surface",
          direction: "right_to_left",
          path: "horizontal_wave",
          thicknessRatio: 0.08,
          twist: 0.5,
          opacity: 0.52,
          colorRoles: ["accent", "primary"]
        }
      },
      {
        id: "audio_kick",
        type: "audio",
        zIndex: 0,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["audio_structure"],
        audio: { kind: "kick", policy: "procedural", weight: 0.54, bpm: 128, accentPattern: [0, 2, 4] }
      },
      {
        id: "audio_hat",
        type: "audio",
        zIndex: 0,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["audio_structure"],
        audio: { kind: "hat", policy: "procedural", weight: 0.34, bpm: 128, accentPattern: [1, 3, 5] }
      },
      {
        id: "audio_impact",
        type: "audio",
        zIndex: 0,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["audio_structure"],
        audio: { kind: "impact", policy: "procedural", weight: 0.42, atSec: [0.4, 8.3] }
      },
      {
        id: "audio_music",
        type: "audio",
        zIndex: 0,
        startSec: 0,
        durationSec: 12,
        evidenceRefs: ["audio_structure"],
        audio: { kind: "music", policy: "procedural", weight: 0.3, bpm: 128 }
      }
    ],
    warnings: []
  };
}

function textLayer(input: RenderRecipe, id: string): RenderRecipeTextLayer {
  const layer = input.layers?.find((item): item is RenderRecipeTextLayer => item.type === "text" && item.id === id);
  if (!layer) throw new Error(`Missing text layer ${id}`);
  return layer;
}

function audioLayer(input: RenderRecipe, id: string): RenderRecipeAudioLayer {
  const layer = input.layers?.find((item): item is RenderRecipeAudioLayer => item.type === "audio" && item.id === id);
  if (!layer) throw new Error(`Missing audio layer ${id}`);
  return layer;
}

describe("PR3 version strategies and natural-language recipe edits", () => {
  it("builds high_click, high_conversion and high_quality recipes with auditable diffs", () => {
    const versions = buildRecipeVersions(recipe());
    expect(versions.map((item) => item.strategy)).toEqual(["high_click", "high_conversion", "high_quality"]);
    expect(versions.every((item) => item.diff.changedDimensions.length >= 2)).toBe(true);

    const highClick = versions.find((item) => item.strategy === "high_click")!.recipe;
    const highConversion = versions.find((item) => item.strategy === "high_conversion")!.recipe;
    const highQuality = versions.find((item) => item.strategy === "high_quality")!.recipe;

    expect(highClick.clips[0].durationSec).toBeLessThan(recipe().clips[0].durationSec ?? 99);
    expect(textLayer(highClick, "headline").typography.fontSizeRatio).toBeGreaterThan(textLayer(recipe(), "headline").typography.fontSizeRatio);
    expect(audioLayer(highClick, "audio_impact").audio.weight).toBeGreaterThan(audioLayer(recipe(), "audio_impact").audio.weight);
    expect(textLayer(highClick, "cta_text").startSec).toBeLessThan(textLayer(recipe(), "cta_text").startSec);

    expect(highConversion.productTheme.sellingPoints[0]).not.toBe(recipe().productTheme.sellingPoints[0]);
    expect(textLayer(highConversion, "subtitle_1").startSec).toBeLessThan(textLayer(recipe(), "subtitle_1").startSec);
    expect(textLayer(highConversion, "cta_text").durationSec).toBeGreaterThan(textLayer(recipe(), "cta_text").durationSec);

    expect((highQuality.layers ?? []).filter((layer) => layer.type === "text").length).toBeLessThan((recipe().layers ?? []).filter((layer) => layer.type === "text").length);
    expect(audioLayer(highQuality, "audio_hat").audio.weight).toBeLessThan(audioLayer(recipe(), "audio_hat").audio.weight);
    expect(highQuality.global.palette[0]).toBe("#f8fafc");
  });

  it("turns the three required Chinese edit commands into concrete recipe patches", () => {
    const base = recipe();
    const strongerOpening = naturalEditToRecipePatch("开头更抓人一些", base);
    expect(strongerOpening.renderNeeded).toBe(true);
    expect(strongerOpening.operations.length).toBeGreaterThan(0);
    expect(strongerOpening.updatedRecipe.clips[0].durationSec).toBeGreaterThan(base.clips[0].durationSec ?? 0);
    expect(textLayer(strongerOpening.updatedRecipe, "headline").typography.fontSizeRatio).toBeGreaterThan(textLayer(base, "headline").typography.fontSizeRatio);

    const rhythmic = naturalEditToRecipePatch("减少字幕，增强节奏感", base);
    expect(rhythmic.renderNeeded).toBe(true);
    expect((rhythmic.updatedRecipe.layers ?? []).filter((layer) => layer.type === "text").length).toBeLessThan((base.layers ?? []).filter((layer) => layer.type === "text").length);
    expect(audioLayer(rhythmic.updatedRecipe, "audio_kick").audio.weight).toBeGreaterThan(audioLayer(base, "audio_kick").audio.weight);

    const productEarlier = naturalEditToRecipePatch("把商品信息提前", base);
    expect(productEarlier.renderNeeded).toBe(true);
    expect(textLayer(productEarlier.updatedRecipe, "subtitle_1").startSec).toBeLessThan(textLayer(base, "subtitle_1").startSec);
    expect(productEarlier.updatedRecipe.global.durationSec).toBe(base.global.durationSec);
  });
});
