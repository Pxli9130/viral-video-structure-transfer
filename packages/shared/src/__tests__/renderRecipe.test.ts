import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  validateRenderRecipe,
  validateTimeline,
  type GenerationRequest,
  type RenderRecipePrimitive,
  type StructureTemplate
} from "../index.js";

const prompt = `把样例的爆款结构迁移成 15 秒竖屏产品广告。
主题：AeroSpin 便携涡轮小风扇
卖点：三档强风、USB-C 快充、低噪音、桌面手持两用
风格：快节奏、红黄白大字、卡点闪切
CTA：现在入手，随时随地降温`;

function request(): GenerationRequest {
  return {
    projectId: "project_recipe",
    inputMode: "video_plus_prompt",
    selectedTemplateIds: ["template_recipe"],
    sourceVideo: { assetId: "source_video" },
    prompt,
    target: {
      vertical: "b2b_marketing_mg",
      targetDurationSec: 15,
      aspectRatio: "9:16",
      outputMode: "storyboard_preview"
    },
    controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct" },
    constraints: { noSampleVisualCopy: true }
  };
}

const ALL_PRIMITIVES: RenderRecipePrimitive[] = [
  "SourceClipBeatMontage",
  "ProductHeroOrbit",
  "FanHeroSpin",
  "FeatureCardStack",
  "TypographyLayoutSequence",
  "ImpactFlash",
  "CTAEndSlate",
  "DynamicProxyMontage"
];

/** Expected recipe component(s) for an internal beat-cut motionPrimitive. */
function expectedComponents(motionPrimitive: string): RenderRecipePrimitive[] {
  switch (motionPrimitive) {
    case "neon_hero_intro":
      return ["FanHeroSpin", "ProductHeroOrbit"];
    case "action_montage":
      return ["SourceClipBeatMontage", "DynamicProxyMontage"];
    case "impact_flash_stamp":
      return ["ImpactFlash"];
    case "motivation_cta":
      return ["CTAEndSlate"];
    case "beat_text_card":
    case "tutorial_rule_card":
      return ["TypographyLayoutSequence"];
    default:
      return ["TypographyLayoutSequence"];
  }
}

describe("v1.3 RenderRecipe builder", () => {
  it("emits a renderRecipe on the non-beat-cut path that joins 1:1 with the timeline clips", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_recipe", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_recipe");
    const generation = generateMigrationResult({ template, request: request() });
    const timeline = generation.timeline;
    expect(validateTimeline(timeline).valid).toBe(true);

    const recipe = timeline.renderPlan?.renderRecipe;
    expect(recipe).toBeDefined();
    expect(validateRenderRecipe(recipe).valid).toBe(true);
    expect(recipe!.schemaVersion).toBe("render-recipe-v1");
    // Hard safety invariants from the schema (const:false).
    expect(recipe!.sourcePolicy.sampleFrameCopyAllowed).toBe(false);
    expect(recipe!.sourcePolicy.sampleAudioCopyAllowed).toBe(false);
    // 1:1 join with the rendered clips — no drift.
    expect(recipe!.clips.length).toBe(timeline.clips.length);
    recipe!.clips.forEach((rc, i) => {
      expect(rc.clipId).toBe(timeline.clips[i].id);
      expect(rc.primitiveReason.length).toBeGreaterThan(0);
      expect(ALL_PRIMITIVES).toContain(rc.selectedPrimitive);
      expect(rc.role).not.toBe("global");
    });
    // 9:16 product canvas.
    expect(recipe!.global.width).toBe(720);
    expect(recipe!.global.height).toBe(1280);
    expect(recipe!.global.audioPlan.policy).toBe("procedural_bgm");
  });

  it("emits a beat_cut_product recipe with bpm/beatGrid and component-mapped primitives", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_recipe", purpose: "sample", durationSec: 15 });
    const base = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_recipe");
    const bboxNorm: [number, number, number, number] = [0.12, 0.24, 0.44, 0.09];
    const beatTemplate: StructureTemplate = {
      ...base,
      videoType: "beat_cut",
      rhythm: { ...base.rhythm, bpm: 152 },
      visualStyle: { ...base.visualStyle, colorProgression: ["green", "purple"] },
      typographyEvidence: [
        {
          textLayerId: "typo_1",
          timeSec: 0.5,
          text: "三档强风",
          bboxNorm,
          layoutRole: "top_tag",
          colorRole: "green",
          fontSizeRatio: 0.08,
          animationHint: "shake",
          confidence: 0.9
        }
      ]
    };
    const generation = generateMigrationResult({ template: beatTemplate, request: request() });
    const timeline = generation.timeline;
    expect(validateTimeline(timeline).valid).toBe(true);

    const recipe = timeline.renderPlan?.renderRecipe;
    expect(recipe).toBeDefined();
    expect(validateRenderRecipe(recipe).valid).toBe(true);
    expect(recipe!.videoType).toBe("beat_cut_product");
    expect(typeof recipe!.global.bpm).toBe("number");
    expect((recipe!.global.beatGridSec ?? []).length).toBeGreaterThan(0);
    expect(recipe!.global.palette).toEqual(expect.arrayContaining(["#22c55e", "#a855f7"]));
    // The fan prompt must drive the fan-specific hero component, not a generic mold.
    expect(recipe!.productTheme.category).toBe("portable_fan");
    expect(recipe!.global.audioPlan.policy).toBe("procedural_bgm");
    const attachedBboxes = timeline.clips
      .flatMap((clip) => clip.layers)
      .map((layer) => (layer.style as { typography?: { bboxNorm?: [number, number, number, number] } } | undefined)?.typography?.bboxNorm)
      .filter(Boolean);
    expect(attachedBboxes).toContainEqual(bboxNorm);

    // Every recipe primitive must be the deterministic mapping of the clip's internal motionPrimitive.
    timeline.clips.forEach((clip, i) => {
      const rc = recipe!.clips[i];
      expect(rc.clipId).toBe(clip.id);
      expect(rc.primitiveReason).toContain("→");
      if (clip.motionPrimitive) {
        expect(expectedComponents(clip.motionPrimitive)).toContain(rc.selectedPrimitive);
      }
    });

    const invalid = JSON.parse(JSON.stringify(recipe));
    invalid.sourcePolicy.sampleFrameCopyAllowed = true;
    expect(validateRenderRecipe(invalid).valid).toBe(false);
  });
});
