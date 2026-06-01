import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  findRenderRecipeSafetyIssues,
  generateMigrationResult,
  migrateRenderRecipeToV4_1,
  parsePromptToBrief,
  validateRenderRecipe,
  type GenerationRequest,
  type RenderRecipe,
  type StructureTemplate,
  type VideoAnalysisResult
} from "../index.js";

const prompt = "AeroSpin 便携涡轮小风扇。15 秒高转化竖屏产品广告，突出三档强风、USB-C 快充、低噪音、桌面手持两用。学习样例视频的结构（节奏/镜头/字幕/包装/转场），但不复制样例画面、音频或水印。CTA：现在入手，随时随地降温。";

function request(): GenerationRequest {
  return {
    projectId: "project_v41",
    inputMode: "brief_assets",
    selectedTemplateIds: ["template_v41"],
    prompt,
    targetAssets: [
      { id: "fan_hero", kind: "image", role: "object_motion", path: "docs/fixtures/final_aerospin_fan/fan_hero.png" },
      { id: "fan_card_01", kind: "image", role: "live_action_montage", path: "docs/fixtures/final_aerospin_fan/fan_card_01.png" }
    ],
    target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "storyboard_preview" },
    controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", recipeEvidencePrimitives: true },
    constraints: { noSampleVisualCopy: true }
  };
}

function evidenceAnalysis(): VideoAnalysisResult {
  const analysis = buildMockVideoAnalysis({ assetId: "sample_marketing", projectId: "project_v41", purpose: "sample", durationSec: 15 });
  return {
    ...analysis,
    motionGeometry: {
      ribbonMotion: {
        surfaceType: "wide_band",
        pathFamily: "vertical_helix",
        axis: "screen_y",
        depthBehavior: "front_back_crossing",
        layoutRelation: "around_title",
        textRelation: "text_on_ribbon",
        confidence: 0.9,
        evidenceFrames: [2.4]
      }
    },
    evidenceTimeline: {
      schemaVersion: "visual-evidence-timeline-v2",
      sourceAssetId: "sample_marketing",
      durationSec: 15,
      hasAudio: true,
      shots: [],
      sceneCuts: [],
      beatGrid: { status: "skipped", beats: [] },
      evidenceFrames: [{ id: "ev_001", timeSec: 2.4, family: "geometric_mg" }],
      stats: { blackBgRatio: 0.05, medianShotDurationSec: 4, cutDensity: 0.05 },
      heroDescriptor: {
        objectType: "ribbon",
        objectDescriptor: "parametric ribbon around centered poster title",
        motionPattern: "vertical_helix",
        confidence: 0.9
      },
      typographyEvidence: [
        {
          textLayerId: "typo_001",
          timeSec: 1,
          shotId: "shot_001",
          text: "AeroSpin",
          bboxNorm: [0.12, 0.18, 0.76, 0.12],
          layoutRole: "top_tag",
          colorRole: "white",
          fontSizeRatio: 0.075,
          animationHint: "pop",
          confidence: 0.95
        },
        {
          textLayerId: "typo_002",
          timeSec: 6,
          shotId: "shot_002",
          text: "强风",
          bboxNorm: [0.16, 0.52, 0.68, 0.16],
          layoutRole: "center_title",
          colorRole: "yellow",
          fontSizeRatio: 0.11,
          animationHint: "scale",
          confidence: 0.92
        }
      ],
      visualElementGraph: {
        schemaVersion: "visual-element-graph-v1",
        elements: [
          { id: "ve_001", family: "hero_object", timeRangeSec: [0, 15], bboxTrackNorm: [{ t: 1, bbox: [0.18, 0.1, 0.64, 0.72] }], motionPattern: "vertical_helix" },
          { id: "ve_002", family: "kinetic_typography", timeRangeSec: [0, 8], bboxTrackNorm: [{ t: 1, bbox: [0.12, 0.18, 0.76, 0.12] }] }
        ],
        globalStyle: { palette: ["white", "purple", "yellow"] }
      },
      audioStructure: {
        estimatedLayers: { bass_kick: 0.7, music_harmonic: 0.2, hats_air: 0.1 },
        bpm: 118,
        strongBeats: [0.5, 1.0]
      },
      ocrStatus: "ok",
      asrStatus: "skipped",
      analyzerMode: "test",
      warnings: []
    }
  };
}

function legacyRecipe(): RenderRecipe {
  return {
    schemaVersion: "render-recipe-v1",
    videoType: "product_mg",
    productTheme: { name: "AeroSpin 便携涡轮小风扇", category: "portable_fan", sellingPoints: ["三档强风"], cta: "现在入手" },
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
      palette: ["#05060a", "#e11d2a"],
      cutPattern: { targetCutCount: 1, avgShotDurationSec: 15, fastZones: [] },
      audioPlan: { policy: "procedural_bgm", layers: { kick: 0.8, drone: 0.2 } }
    },
    clips: [
      {
        clipId: "clip_1",
        role: "hook",
        startSec: 0,
        endSec: 4,
        slotId: "slot_hero",
        visualFormFamily: "kinetic_typography",
        selectedPrimitive: "TypographyLayoutSequence",
        primitiveReason: "test evidence -> TypographyLayoutSequence",
        rendererTarget: "remotion_recipe",
        material: { kind: "target_image", assetIds: ["fan_hero"], policy: "renderable" },
        layout: { typographyLayout: "center_title", bboxNorm: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 } },
        motion: { pattern: "zoom_pulse", beatAligned: false, beatTimestampsSec: [] },
        text: { copy: "AeroSpin", colorRoles: ["white"], animationHint: "scale", fontSizeRatio: 0.08 }
      }
    ],
    warnings: []
  };
}

describe("RenderRecipe v4.1 migration and evidence fidelity", () => {
  it("preserves non-beat analysis evidence in buildFallbackTemplate", () => {
    const template = buildFallbackTemplate(evidenceAnalysis(), "b2b_marketing_mg", "project_v41");
    expect(template.videoType).not.toBe("beat_cut");
    expect(template.visualElementGraph?.elements).toHaveLength(2);
    expect(template.typographyEvidence).toHaveLength(2);
    expect(Object.keys(template.audioStructure?.estimatedLayers as Record<string, unknown>)).toHaveLength(3);
    expect(template.heroDescriptor?.objectDescriptor).toContain("ribbon");
    expect(template.motionAtoms?.[0]?.type).toBe("parametric_ribbon_surface");
  });

  it("parses display-safe Chinese product and CTA fields", () => {
    const brief = parsePromptToBrief(request());
    expect(brief.productName).toBe("AeroSpin 便携涡轮小风扇");
    expect(brief.cta).toBe("现在入手");
    expect(brief.productName).not.toContain("15 秒");
    expect(brief.productName).not.toContain("CTA");
  });

  it("migrates old recipes to v4.1 layers and validates the schema", () => {
    const migrated = migrateRenderRecipeToV4_1(legacyRecipe(), {
      motionAtoms: [{ type: "parametric_ribbon_surface", fulfilledBy: "procedural_generation", keywords: ["A"], colorProgression: ["#fff"], style: "mg_motion", density: 1, speed: 1, opacity: 0.5, startSec: 0, endSec: 15 }]
    });
    expect(migrated.version).toBe("render-recipe-v4.1");
    expect(validateRenderRecipe(migrated).valid).toBe(true);
    expect(migrated.layers?.some((layer) => layer.type === "media")).toBe(true);
    expect(migrated.layers?.some((layer) => layer.type === "text")).toBe(true);
    expect(migrated.layers?.some((layer) => layer.type === "motion_atom")).toBe(true);
    expect(migrated.layers?.some((layer) => layer.type === "audio")).toBe(true);
    expect(migrated.layers?.every((layer) => layer.evidenceRefs.length > 0 || Boolean(layer.fallbackReason))).toBe(true);
  });

  it("buildRenderRecipe carries bbox/fontSize, motion atoms, audio layers and safe CTA fields", () => {
    const template: StructureTemplate = buildFallbackTemplate(evidenceAnalysis(), "b2b_marketing_mg", "project_v41");
    const generation = generateMigrationResult({ template, request: request() });
    const recipe = generation.timeline.renderPlan?.renderRecipe;
    expect(recipe).toBeDefined();
    expect(recipe!.version).toBe("render-recipe-v4.1");
    expect(validateRenderRecipe(recipe).valid).toBe(true);
    expect(recipe!.productTheme.name.length).toBeLessThan(32);
    expect(recipe!.productTheme.name).not.toContain("15 秒");
    expect(recipe!.productTheme.ctaText).toBe("现在入手");
    expect(recipe!.layers?.filter((layer) => layer.type === "text").some((layer) => Boolean(layer.layout.bboxNorm) && layer.typography.fontSizeRatio > 0)).toBe(true);
    expect(recipe!.layers?.some((layer) => layer.type === "motion_atom")).toBe(true);
    expect(recipe!.layers?.some((layer) => layer.type === "audio")).toBe(true);
    expect(findRenderRecipeSafetyIssues(recipe!)).toEqual([]);
  });
});
