import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  createFillPlan,
  generateGapReport,
  generateMigrationResult,
  matchSlots,
  parsePromptToBrief,
  understandSourceVideo,
  validateGenerationRequest,
  validateStructureTemplate,
  validateTimeline
} from "../index.js";
import type { Asset, GenerationRequest } from "../index.js";

const prompt = `请基于已学习的爆款营销视频结构，把这个素材重构成一个 15 秒竖屏短视频。
主题：便携式桌面加湿器
目标用户：办公室久坐人群、学生
卖点：小巧便携、静音、USB 供电、柔和夜灯、缓解干燥
风格：快节奏、字幕明显、带 MG 风格卖点卡片
CTA：点击了解更多`;

function request(sourceAssetId = "source_video"): GenerationRequest {
  return {
    schemaVersion: "1.1",
    projectId: "project_demo",
    inputMode: "video_plus_prompt",
    selectedTemplateIds: ["template_demo"],
    sourceVideo: { assetId: sourceAssetId, role: "source_video" },
    prompt,
    target: {
      vertical: "b2b_marketing_mg",
      targetDurationSec: 15,
      aspectRatio: "9:16",
      outputMode: "storyboard_preview"
    },
    controls: {
      pace: "fast",
      hookIntensity: "strong",
      packagingStyle: "mg_motion",
      ctaStyle: "direct",
      allowAigcPlaceholder: true,
      allowReorder: true
    },
    constraints: {
      doNotUseSampleVisuals: true,
      mustUseSourceVideo: true
    }
  };
}

function sourceAsset(): Asset {
  return {
    id: "source_video",
    projectId: "project_demo",
    role: "source_video",
    type: "video",
    filename: "humidifier-source.mp4",
    originalName: "humidifier-source.mp4",
    mimeType: "video/mp4",
    tags: ["product_like"],
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("v1.1 mock MVP pipeline", () => {
  it("builds a valid hook/body/proof/cta structure with atoms", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "sample_video", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_demo");
    const validation = validateStructureTemplate(template);

    expect(validation.valid).toBe(true);
    expect(template.schemaVersion).toBe("1.1");
    expect(template.segments.map((segment) => segment.role)).toEqual(["hook", "body", "proof", "cta"]);
    expect(template.structureAtoms.length).toBeGreaterThanOrEqual(4);
  });

  it("returns readable schema errors for invalid timelines", () => {
    const validation = validateTimeline({ schemaVersion: "1.1", clips: [] });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("must have required property");
  });

  it("validates video_plus_prompt generation requests", () => {
    const valid = validateGenerationRequest(request());
    const invalid = validateGenerationRequest({ schemaVersion: "1.1", projectId: "p", inputMode: "video_plus_prompt" });

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
  });

  it("parses prompt into a usable brief fallback", () => {
    const brief = parsePromptToBrief(request());

    expect(brief.productName).toContain("便携式桌面加湿器");
    expect(brief.sellingPoints.length).toBeGreaterThan(2);
    expect(brief.cta).toContain("点击");
  });

  it("matches at least one slot to source video candidates", () => {
    const template = buildFallbackTemplate(
      buildMockVideoAnalysis({ assetId: "sample_video", purpose: "sample", durationSec: 15 }),
      "b2b_marketing_mg",
      "project_demo"
    );
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", purpose: "source", durationSec: 30 });
    const source = understandSourceVideo(sourceAnalysis, sourceAsset(), request());
    const mappings = matchSlots(template, source, request());

    expect(mappings.some((mapping) => mapping.status === "matched")).toBe(true);
  });

  it("detects and fills gaps for sparse prompt-only style source", () => {
    const template = buildFallbackTemplate(
      buildMockVideoAnalysis({ assetId: "sample_video", purpose: "sample", durationSec: 15 }),
      "b2b_marketing_mg",
      "project_demo"
    );
    const sparseSource = understandSourceVideo(undefined, undefined, {
      ...request(),
      inputMode: "prompt_only",
      sourceVideo: undefined
    });
    const mappings = matchSlots(template, sparseSource, request());
    const gaps = generateGapReport(mappings, sparseSource, request());
    const fillPlan = createFillPlan(gaps, sparseSource, request());

    expect(gaps.length).toBeGreaterThan(0);
    expect(fillPlan).toHaveLength(gaps.length);
  });

  it("generates a valid v1.1 timeline with rendererTarget and no empty clips", () => {
    const template = buildFallbackTemplate(
      buildMockVideoAnalysis({ assetId: "sample_video", purpose: "sample", durationSec: 15 }),
      "b2b_marketing_mg",
      "project_demo"
    );
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", purpose: "source", durationSec: 30 });
    const result = generateMigrationResult(template, request(), sourceAsset(), sourceAnalysis);

    expect(validateTimeline(result.timeline).valid).toBe(true);
    expect(result.timeline.rendererTarget).toBe("html_preview");
    expect(result.timeline.clips.every((clip) => clip.layers.length > 0)).toBe(true);
    expect(result.selectedAtoms.length).toBeGreaterThan(0);
  });
});
