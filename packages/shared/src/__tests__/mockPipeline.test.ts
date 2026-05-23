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
  validateAssetAnalysis,
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
    projectId: "project_demo",
    inputMode: "video_plus_prompt",
    selectedTemplateIds: ["template_demo"],
    sourceVideo: { assetId: sourceAssetId },
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
      allowAigcPlaceholder: true
    },
    constraints: {
      mustMention: ["桌面加湿器"],
      noSampleVisualCopy: true
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
    mimeType: "video/mp4",
    sourcePolicy: "user_authorized",
    tags: ["product_like"],
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("v1.2 mock pipeline", () => {
  it("builds a valid hook/body/proof/cta StructureTemplate with required slots and atoms", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_demo");
    const templateValidation = validateStructureTemplate(template);

    expect(templateValidation.valid).toBe(true);
    expect(template.segments.map((segment) => segment.role)).toEqual(["hook", "body", "proof", "cta"]);
    expect(template.requiredSlots.length).toBeGreaterThanOrEqual(4);
    expect(template.structureAtoms.length).toBeGreaterThanOrEqual(4);
    expect(template.structureAtoms.every((atom) => atom.templateId === template.id)).toBe(true);
  });

  it("validates the analysis schema for both sample and source purposes", () => {
    const sample = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const source = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });

    expect(validateAssetAnalysis(sample).valid).toBe(true);
    expect(validateAssetAnalysis(source).valid).toBe(true);
  });

  it("returns readable schema errors for invalid timelines", () => {
    const validation = validateTimeline({ id: "bad", clips: [] });

    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("must have required property");
  });

  it("validates video_plus_prompt generation requests and fails without sourceVideo", () => {
    expect(validateGenerationRequest(request()).valid).toBe(true);
    const invalid = validateGenerationRequest({
      projectId: "p",
      inputMode: "video_plus_prompt",
      prompt: "x",
      target: { vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "storyboard_preview" }
    });
    expect(invalid.valid).toBe(false);
  });

  it("parses prompt into usable brief fallback", () => {
    const brief = parsePromptToBrief(request());

    expect(brief.productName).toContain("便携式桌面加湿器");
    expect(brief.sellingPoints.length).toBeGreaterThan(2);
    expect(brief.cta).toContain("点击");
  });

  it("matches at least one slot to source video candidates", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const source = understandSourceVideo(sourceAnalysis, sourceAsset(), request());
    const mappings = matchSlots(template, source, request());

    expect(mappings.some((mapping) => mapping.status === "matched")).toBe(true);
  });

  it("detects and fills gaps when source video is missing", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sparseSource = understandSourceVideo(undefined, undefined, {
      ...request(),
      inputMode: "prompt_only",
      sourceVideo: undefined
    });
    const mappings = matchSlots(template, sparseSource, request());
    const gaps = generateGapReport(mappings);
    const fillPlan = createFillPlan(mappings, sparseSource, request());

    expect(gaps.length).toBeGreaterThan(0);
    expect(fillPlan).toHaveLength(gaps.length);
    expect(fillPlan.every((action) => Boolean(action.targetClipId))).toBe(true);
  });

  it("weaves VLM video_summary, structure and reusable_patterns into StructureTemplate", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const baseline = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_demo");
    const enriched = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_demo", {
      videoSummary: "Promo for ProductX: minimalist 3D ribbon transitions into bold cover.",
      shots: [{ start: 0, end: 3, visual: "Product hero shot", transition: "slide", purpose: "hook" }],
      structure: {
        hook: "Minimalist white ribbon over slate background",
        setup: "Brand identity tone introduction",
        sellingPoints: ["Dynamic 3D typography", "Vibrant color palette"],
        climax: "Multi-color ribbon climax",
        cta: "Brand handle reveal"
      },
      rhythm: { avgShotLength: 2.4, peakTimeRatio: 0.72, fastSections: ["0-3s"], peakMoments: ["12-13s"] },
      packaging: { subtitleDensity: "medium", titleCards: ["Bold serif top-bar"], stickers: ["icon_badge"], colorStyle: "neon", coverStyle: "centered title" },
      reusablePatterns: ["3D ribbon loop", "color cycling", "minimal cover lock"],
      materialGapsForNewVideo: ["product_closeup", "usage_scene"]
    });

    expect(enriched.name).not.toBe(baseline.name);
    expect(enriched.name).toContain("Learned MG Structure");
    expect(enriched.segments.find((s) => s.role === "hook")?.intent).toContain("Minimalist white ribbon");
    expect(enriched.segments.find((s) => s.role === "body")?.intent).toContain("Dynamic 3D typography");
    expect(enriched.qualityRationale).toContain("Promo for ProductX");
    expect(enriched.qualityRationale).toContain("Reusable patterns");
    expect(enriched.qualityRationale).toContain("product_closeup");
    expect(enriched.rhythm.averageShotDurationSec).toBe(2.4);
    expect(enriched.rhythm.pace).toBe("medium");
    expect(enriched.packaging.coverStyle).toBe("centered title");
    expect(enriched.structureAtoms.length).toBeGreaterThan(baseline.structureAtoms.length);
    expect(enriched.structureAtoms.some((atom) => atom.name.includes("3D ribbon loop"))).toBe(true);
    for (const atom of enriched.structureAtoms) {
      expect(new Set(atom.applicableVerticals).size).toBe(atom.applicableVerticals.length);
    }
    expect(validateStructureTemplate(enriched).valid).toBe(true);
  });

  it("picks reorder_structure when a body slot has an unmatched sibling but the segment already has a match", () => {
    const matchedSibling = {
      slotId: "slot_product_closeup",
      slotRole: "body" as const,
      slotType: "product_closeup" as const,
      status: "matched" as const,
      candidateShotIds: ["src_shot_1"],
      selectedShotId: "src_shot_1",
      confidence: 0.9,
      reason: "matched",
      risks: []
    };
    const unmatchedSubtitle = {
      slotId: "slot_subtitle_text",
      slotRole: "body" as const,
      slotType: "subtitle_text" as const,
      status: "missing" as const,
      candidateShotIds: [],
      confidence: 0,
      reason: "no source shot",
      risks: []
    };
    const fillPlan = createFillPlan(
      [matchedSibling, unmatchedSubtitle],
      { summary: "", candidates: [{ id: "src_shot_1", startSec: 0, endSec: 3, durationSec: 3, tags: ["product_like"], confidence: 0.9 }], warnings: [] },
      request()
    );
    expect(fillPlan.find((action) => action.slotId === "slot_subtitle_text")?.strategy).toBe("reorder_structure");
  });

  it("generates a valid v1.2 timeline with rendererTarget and no empty layers", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const result = generateMigrationResult({
      template,
      request: request(),
      sourceAsset: sourceAsset(),
      sourceAnalysis
    });

    expect(validateTimeline(result.timeline).valid).toBe(true);
    expect(result.timeline.rendererTarget).toBe("html_preview");
    expect(result.timeline.clips.every((clip) => clip.layers.length > 0)).toBe(true);
    expect(result.selectedAtoms.length).toBeGreaterThan(0);
    expect(result.timeline.mapping.length).toBe(template.segments.length);
    expect(result.timeline.gapReport.every((gap) => gap.status !== "matched")).toBe(true);
  });
});
