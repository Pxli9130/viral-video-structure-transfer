import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  type Asset,
  type GenerationRequest,
  type StructureTemplate
} from "../index.js";

const prompt = `把样例的爆款结构迁移成 15 秒竖屏产品广告。
主题：AeroSpin 便携涡轮小风扇
卖点：三档强风、USB-C 快充、低噪音、桌面手持两用
CTA：现在入手，随时随地降温`;

function baseRequest(sourceAssetId: string): GenerationRequest {
  return {
    projectId: "project_mp",
    inputMode: "video_plus_prompt",
    selectedTemplateIds: ["template_mp"],
    sourceVideo: { assetId: sourceAssetId },
    prompt,
    target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "storyboard_preview" },
    controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct" },
    constraints: { noSampleVisualCopy: true }
  };
}

function beatTemplate(): StructureTemplate {
  const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_vid", projectId: "project_mp", purpose: "sample", durationSec: 15 });
  const base = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_mp");
  // sourceSampleIds is the learned-from sample (sample_vid); a distinct source must NOT be in it.
  return { ...base, videoType: "beat_cut", rhythm: { ...base.rhythm, bpm: 152 } };
}

describe("v1.3 source-first material policy", () => {
  it("self-reconstruction (no distinct source) is evidence-only — sample never reaches the canvas", () => {
    const generation = generateMigrationResult({ template: beatTemplate(), request: baseRequest("sample_vid") });
    const recipe = generation.timeline.renderPlan?.renderRecipe;
    expect(recipe).toBeDefined();
    // No distinct authorized source → not renderable user material.
    expect(recipe!.sourcePolicy.sourceVideoUse).toBe("missing");
    // The learned-from sample must never be composited as source pixels.
    expect(generation.timeline.clips.every((c) => c.sourceAssetId !== "sample_vid")).toBe(true);
    expect(recipe!.clips.every((c) => c.material.kind !== "source_video")).toBe(true);
    expect(recipe!.sourcePolicy.sampleFrameCopyAllowed).toBe(false);
  });

  it("a distinct user_authorized non-sample source is recognized as renderable material", () => {
    const sourceAsset: Asset = {
      id: "real_source_vid",
      projectId: "project_mp",
      role: "source_video",
      type: "video",
      filename: "real-source.mp4",
      path: "test_videos/manual/bottle_closeup.mp4",
      mimeType: "video/mp4",
      sourcePolicy: "user_authorized",
      tags: ["product_like", "usage_scene", "hook_candidate"],
      status: "ready",
      createdAt: "2026-01-01T00:00:00.000Z"
    };
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "real_source_vid", projectId: "project_mp", purpose: "source", durationSec: 15 });
    const generation = generateMigrationResult({
      template: beatTemplate(),
      request: baseRequest("real_source_vid"),
      sourceAsset,
      sourceAnalysis
    });
    const recipe = generation.timeline.renderPlan?.renderRecipe;
    expect(recipe).toBeDefined();
    // The distinct authorized source is renderable user material (the source-first fix).
    expect(recipe!.sourcePolicy.sourceVideoUse).toBe("renderable_user_material");
    // It must never be confused with the evidence-only sample.
    expect(generation.timeline.clips.every((c) => c.sourceAssetId !== "sample_vid")).toBe(true);
  });
});
