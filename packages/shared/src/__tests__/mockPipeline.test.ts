import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildTimeline,
  buildMockVideoAnalysis,
  createFillPlan,
  generateGapReport,
  generateMigrationResult,
  matchSlots,
  parseNaturalLanguageEdit,
  parsePromptToBrief,
  applyNaturalLanguageEditToRequest,
  applyNaturalLanguageEditToTimeline,
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
    path: "fixtures/humidifier-source.mp4",
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

  it("parses English product and semicolon selling points", () => {
    const brief = parsePromptToBrief({
      ...request(),
      prompt: [
        "Product: HydroPulse Smart Bottle",
        "Audience: university students",
        "Selling points: hydration reminder every 45 min; silent LED reminder; 24h cold insulation",
        "CTA: Stay hydrated all day"
      ].join("\n")
    });

    expect(brief.productName).toBe("HydroPulse Smart Bottle");
    expect(brief.targetAudience).toBe("university students");
    expect(brief.sellingPoints).toContain("silent LED reminder");
    expect(brief.cta).toBe("Stay hydrated all day");
  });

  it("matches at least one slot to source video candidates", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const source = understandSourceVideo(sourceAnalysis, sourceAsset(), request());
    const mappings = matchSlots(template, source, request());

    expect(mappings.some((mapping) => mapping.status === "matched")).toBe(true);
  });

  it("blocks sample/reference shots from satisfying visual slots unless sample reuse is authorized", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const sampleReferenceAsset: Asset = {
      ...sourceAsset(),
      id: "sample_video",
      role: "example_video",
      filename: "editing.mov",
      path: "fixtures/editing.mov",
      sourcePolicy: "demo_only"
    };

    const disabledSource = understandSourceVideo(sourceAnalysis, sampleReferenceAsset, request("sample_video"));
    const disabledMappings = matchSlots(template, disabledSource, request("sample_video"));
    expect(disabledSource.reusableAsMaterial).toBe(false);
    expect(disabledMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped")).toHaveLength(0);
    expect(disabledMappings.find((mapping) => mapping.slotType === "hook_visual")?.status).toBe("missing");

    const authorizedRequest: GenerationRequest = {
      ...request("sample_video"),
      constraints: { ...request("sample_video").constraints, sampleAssetReuse: "authorized" }
    };
    const authorizedSource = understandSourceVideo(sourceAnalysis, sampleReferenceAsset, authorizedRequest);
    const authorizedMappings = matchSlots(template, authorizedSource, authorizedRequest);
    expect(authorizedSource.reusableAsMaterial).toBe(true);
    expect(authorizedMappings.some((mapping) => mapping.assetAvailability === "source_video_mapped")).toBe(true);
  });

  it("does not let mock or pathless assets satisfy required visual slots", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "demo_source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const mockAsset: Asset = {
      ...sourceAsset(),
      id: "demo_source_video",
      path: undefined,
      metadata: { mock: true }
    };
    const mockSource = understandSourceVideo(sourceAnalysis, mockAsset, request("demo_source_video"));
    const mockMappings = matchSlots(template, mockSource, request("demo_source_video"));
    expect(mockSource.materialRole).toBe("mock");
    expect(mockMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped")).toHaveLength(0);

    const pathlessAsset: Asset = { ...sourceAsset(), id: "pathless_video", path: undefined };
    const pathlessAnalysis = { ...sourceAnalysis, assetId: "pathless_video" };
    const pathlessSource = understandSourceVideo(pathlessAnalysis, pathlessAsset, request("pathless_video"));
    const pathlessMappings = matchSlots(template, pathlessSource, request("pathless_video"));
    expect(pathlessSource.renderable).toBe(false);
    expect(pathlessMappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped")).toHaveLength(0);
  });

  it("does not match an unrelated source shot when a required preferred tag is absent", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const noUsageSource = {
      ...sourceAnalysis,
      transcript: [],
      ocr: [],
      shots: sourceAnalysis.shots.map((shot, index) => ({
        ...shot,
        tags: index === 0 ? ["product_like"] : ["background"]
      }))
    };
    const plainRequest: GenerationRequest = {
      ...request(),
      prompt: "Product: HydroPulse Smart Bottle\nSelling points: cold insulation\nCTA: Learn more"
    };
    const source = understandSourceVideo(noUsageSource, { ...sourceAsset(), tags: [] }, plainRequest);
    const mappings = matchSlots(template, source, plainRequest);

    expect(mappings.find((mapping) => mapping.slotType === "product_closeup")?.status).toBe("matched");
    const usage = mappings.find((mapping) => mapping.slotType === "usage_scene");
    expect(usage?.status).toBe("missing");
    expect(usage?.selectedShotId).toBeUndefined();
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

  it("maps target assets to slots before falling back to prompt-only cards", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sparseSource = understandSourceVideo(undefined, undefined, {
      ...request(),
      inputMode: "brief_assets",
      sourceVideo: undefined
    });
    const targetRequest: GenerationRequest = {
      ...request(),
      inputMode: "brief_assets",
      sourceVideo: undefined,
      targetAssets: [
        { id: "hero_image", kind: "image", role: "hook product visual", path: "fixtures/hero.png", tags: ["hook", "product"] },
        { id: "brand_logo", kind: "logo", role: "logo cta brand", path: "fixtures/logo.png", tags: ["logo", "cta"] },
        { id: "poster_copy", kind: "copy", role: "title copy", text: "爆款结构迁移引擎" }
      ]
    };
    const mappings = matchSlots(template, sparseSource, targetRequest);
    expect(mappings.find((mapping) => mapping.slotType === "hook_visual")).toMatchObject({
      status: "matched",
      selectedTargetAssetId: "hero_image",
      assetAvailability: "target_asset_mapped"
    });
    expect(mappings.some((mapping) => mapping.targetAssetCandidateIds?.length)).toBe(true);
    const gaps = generateGapReport(mappings, { source: sparseSource, template });
    expect(gaps.every((gap) => gap.assetAvailability)).toBe(true);
  });

  it("parses and applies natural-language edit operations", () => {
    const plan = parseNaturalLanguageEdit("去掉解释性文字，换成白底高质感风格，让 ribbon 更慢、更高级，把 CTA 提前，减少字幕，增强视觉主导");
    expect(plan.operations.map((operation) => operation.type)).toEqual(
      expect.arrayContaining(["remove_debug_labels", "change_style_preset", "adjust_ribbon", "adjust_cta_timing", "reduce_subtitle_density"])
    );
    expect(plan.patchedControls).toMatchObject({
      creativeMode: "final_creative",
      packagingStyle: "clean",
      stylePreset: "white_poster",
      ctaTiming: "early",
      subtitleDensity: "minimal"
    });

    const edited = applyNaturalLanguageEditToRequest(request(), plan);
    expect(edited.controls?.ribbon?.speedMultiplier).toBeLessThan(1);
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const generation = generateMigrationResult({ template, request: edited });
    const adjusted = applyNaturalLanguageEditToTimeline(generation.timeline, plan);
    expect(adjusted.renderPlan?.adapterOptions?.editOperations).toContain("adjust_ribbon");
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
    expect(enriched.structureAtoms.some((atom) => atom.description.includes("3D ribbon loop"))).toBe(true);
    const atomNames = enriched.structureAtoms.map((atom) => atom.name).join(" | ");
    expect(atomNames).not.toContain("Minimalist white ribbon");
    expect(atomNames).not.toContain("Multi-color ribbon climax");
    expect(atomNames).not.toContain("Brand handle reveal");
    expect(atomNames).not.toContain("3D ribbon loop");
    expect(enriched.structureAtoms.map((atom) => atom.name)).toEqual(
      expect.arrayContaining(["Attention-first hook", "Climax proof beat", "Brand-reveal CTA", "Reusable motion motif"])
    );
    for (const atom of enriched.structureAtoms) {
      expect(new Set(atom.applicableVerticals).size).toBe(atom.applicableVerticals.length);
    }
    expect(validateStructureTemplate(enriched).valid).toBe(true);
  });

  it("extracts editing-style motif slots and creates proxy IGF gaps with no target assets", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "editing_sample", projectId: "project_demo", purpose: "sample", durationSec: 118 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_demo", {
      videoSummary: "High-energy editing tutorial with opening rotating helmet/logo object, kinetic text cards, beat-sync cinematic action montage and match cuts.",
      shots: [
        { start: 0, end: 1.5, visual: "Rotating 3D helmet/logo intro", purpose: "hook" },
        { start: 1.5, end: 8, visual: "Black kinetic text cards", purpose: "setup" },
        { start: 8, end: 15, visual: "Beat-sync action montage", purpose: "proof", transition: "match_cut" }
      ],
      structure: {
        hook: "Visual logo intro with rotating 3D head/helmet object",
        setup: "Dynamic kinetic text explains the edit sequence",
        sellingPoints: ["beat-sync montage", "seamless cinematic match cuts"],
        climax: "High-speed action clips match punches and gunshots",
        cta: "Practice to master the edit"
      },
      rhythm: { avgShotLength: 1.2, peakTimeRatio: 0.72, fastSections: ["0-8s"], peakMoments: ["8-15s"] },
      packaging: { subtitleDensity: "high", titleCards: ["Black kinetic typography"], coverStyle: "bold black title card" },
      reusablePatterns: ["rotating_3d_object_intro", "text_card_beat_sync_sequence", "cinematic_match_cut_montage"],
      materialGapsForNewVideo: ["rotating hero object", "action montage clips", "proof/action sequence"]
    });
    const motifSlotIds = template.requiredSlots.map((slot) => slot.id);
    expect(motifSlotIds).toEqual(expect.arrayContaining(["slot_rotating_hero_object_intro", "slot_beat_sync_action_montage"]));

    const mockSourceAsset: Asset = {
      ...sourceAsset(),
      id: "demo_source_video",
      path: undefined,
      metadata: { mock: true }
    };
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "demo_source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const source = understandSourceVideo(sourceAnalysis, mockSourceAsset, request("demo_source_video"));
    const mappings = matchSlots(template, source, request("demo_source_video"));
    const gaps = generateGapReport(mappings, { source, template, request: request("demo_source_video") });
    const fillPlan = createFillPlan(mappings, source, request("demo_source_video"), template);
    const rotatingGap = gaps.find((gap) => gap.gapType === "rotating_hero_object_missing");
    const rotatingFill = fillPlan.find((action) => action.slotId === "slot_rotating_hero_object_intro");

    expect(mappings.filter((mapping) => mapping.assetAvailability === "source_video_mapped")).toHaveLength(0);
    expect(rotatingGap).toMatchObject({
      clickToReplace: true,
      replacementSlotId: "slot_rotating_hero_object_intro"
    });
    expect(rotatingGap?.acceptedAssetTypes).toEqual(expect.arrayContaining(["image", "video", "glb", "lottie"]));
    expect(rotatingFill?.strategy).toBe("proxy_placeholder");

    const { timeline } = buildTimeline({
      template,
      request: request("demo_source_video"),
      source,
      mappings,
      fillPlan,
      generationId: "generation_editing_igf"
    });
    const proxyClip = timeline.clips.find((clip) => clip.replacementSlotId === "slot_rotating_hero_object_intro");
    expect(proxyClip?.gapFillStrategy).toBe("proxy_placeholder");
    expect(proxyClip?.layers.some((layer) => layer.style?.fillStrategy === "proxy_placeholder")).toBe(true);
    expect(timeline.replacementSlots?.some((slot) => slot.slotId === "slot_rotating_hero_object_intro" && slot.status === "proxy_generated")).toBe(true);
  });

  it("tags slot-missing gaps with Chinese label + recommended fill strategies (FR-008)", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sparseSource = understandSourceVideo(undefined, undefined, {
      ...request(),
      inputMode: "prompt_only",
      sourceVideo: undefined
    });
    const mappings = matchSlots(template, sparseSource, request());
    const gaps = generateGapReport(mappings, { source: sparseSource, template });
    const ctaGap = gaps.find((g) => g.slotType === "cta_visual");
    const hookGap = gaps.find((g) => g.slotType === "hook_visual");
    expect(ctaGap?.gapType).toBe("cta_visual_missing");
    expect(ctaGap?.gapLabelZh).toContain("CTA");
    expect(hookGap?.recommendedFillStrategies?.length).toBeGreaterThan(0);
  });

  it("adds synthetic voiceover/script gap when source video has shots but no transcript or OCR (FR-008)", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = {
      ...buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 }),
      transcript: [],
      ocr: []
    };
    const source = understandSourceVideo(sourceAnalysis, sourceAsset(), {
      ...request(),
      prompt: "请重构这个视频"
    });
    const mappings = matchSlots(template, source, request());
    const gaps = generateGapReport(mappings, { source, template });
    const subtitleSlotMissing = mappings.some((m) => m.slotType === "subtitle_text" && m.status !== "matched");
    if (subtitleSlotMissing) {
      expect(gaps.some((g) => g.gapType === "voiceover_or_script_missing")).toBe(true);
    }
  });

  it("treats noisy transcript as missing script and OCR text as a usable subtitle signal (FR-008)", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const base = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const noTextCards = base.shots.map((shot) => ({ ...shot, tags: ["product_like"] }));
    const noisySource = understandSourceVideo(
      { ...base, shots: noTextCards, transcript: [{ startSec: 0, endSec: 10, text: "um" }], ocr: [] },
      sourceAsset(),
      { ...request(), prompt: "请重构这个视频" }
    );
    const noisyGaps = generateGapReport(matchSlots(template, noisySource, request()), { source: noisySource, template });
    expect(noisyGaps.some((gap) => gap.gapType === "voiceover_or_script_missing")).toBe(true);

    const ocrSource = understandSourceVideo(
      { ...base, shots: noTextCards, transcript: [{ startSec: 0, endSec: 10, text: "um" }], ocr: [{ text: "核心卖点字幕" }] },
      sourceAsset(),
      { ...request(), prompt: "请重构这个视频" }
    );
    const ocrGaps = generateGapReport(matchSlots(template, ocrSource, request()), { source: ocrSource, template });
    expect(ocrGaps.some((gap) => gap.gapType === "voiceover_or_script_missing")).toBe(false);
  });

  it("flags low transcript subtitle density even when a short ASR cue exists (FR-008)", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = {
      ...buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 }),
      transcript: [{ startSec: 0, endSec: 1, text: "Hydration reminder now" }],
      ocr: []
    };
    const source = understandSourceVideo(sourceAnalysis, sourceAsset(), request());
    const gaps = generateGapReport(matchSlots(template, source, request()), { source, template });

    expect(gaps.some((gap) => gap.gapType === "subtitle_density_low")).toBe(true);
  });

  it("changes timeline rhythm and ids when pace or variant salt changes", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const sourceAnalysis = buildMockVideoAnalysis({ assetId: "source_video", projectId: "project_demo", purpose: "source", durationSec: 30 });
    const fast = generateMigrationResult({ template, request: request(), sourceAsset: sourceAsset(), sourceAnalysis });
    const slowRequest = { ...request(), controls: { ...request().controls, pace: "slow" as const, packagingStyle: "clean" as const } };
    const slow = generateMigrationResult({ template, request: slowRequest, sourceAsset: sourceAsset(), sourceAnalysis });
    const salted = generateMigrationResult({ template, request: slowRequest, sourceAsset: sourceAsset(), sourceAnalysis, generationIdSalt: "high_quality" });
    const avg = (durations: number[]) => durations.reduce((sum, value) => sum + value, 0) / durations.length;

    expect(slow.timeline.clips.length).toBeLessThan(fast.timeline.clips.length);
    expect(avg(slow.timeline.clips.map((clip) => clip.durationSec))).toBeGreaterThan(avg(fast.timeline.clips.map((clip) => clip.durationSec)));
    expect(slow.timeline.renderPlan?.background).toBe("#f8fafc");
    expect(salted.id).not.toBe(slow.id);
    expect(salted.timeline.id).not.toBe(slow.timeline.id);
  });

  it("keeps runtime schema semantically equivalent while spec structureAtoms uses $ref", () => {
    const schemaPath = path.resolve(process.cwd(), "../../spec_v2/schemas/structure-template.schema.json");
    const specSchema = JSON.parse(readFileSync(schemaPath, "utf8"));
    expect(specSchema.properties.structureAtoms.items.$ref).toBe("knowledge-atom.schema.json");

    const analysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_demo");
    expect(validateStructureTemplate(template).valid).toBe(true);
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

  it("creates proxy replacement slots for missing visual material", () => {
    const missingHero = {
      slotId: "slot_missing_hero",
      slotRole: "hook" as const,
      slotType: "hook_visual" as const,
      status: "missing" as const,
      candidateShotIds: [],
      assetAvailability: "no_user_asset_available" as const,
      confidence: 0,
      reason: "hero object missing",
      risks: []
    };
    const source = { summary: "", candidates: [], warnings: [] };
    const fillPlan = createFillPlan([missingHero], source, request());
    const gaps = generateGapReport([missingHero], { source });
    const proxyAction = fillPlan.find((action) => action.slotId === "slot_missing_hero");
    const proxyGap = gaps.find((gap) => gap.slotId === "slot_missing_hero");

    expect(proxyAction?.strategy).toBe("proxy_placeholder");
    expect(proxyAction?.rendererInstructions).toMatchObject({
      fulfilledBy: "proxy_placeholder",
      replacementSlotId: "slot_missing_hero",
      clickToReplace: true
    });
    expect(proxyGap?.placeholderSpec?.type).toBe("proxy_shape");
    expect(proxyGap?.acceptedAssetTypes).toEqual(expect.arrayContaining(["image", "video"]));
  });

  it("binds uploaded replacements and preserves slot motion in the timeline", () => {
    const sampleAnalysis = buildMockVideoAnalysis({ assetId: "sample_video", projectId: "project_demo", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(sampleAnalysis, "b2b_marketing_mg", "project_demo");
    const source = understandSourceVideo(undefined, undefined, {
      ...request(),
      inputMode: "prompt_only",
      sourceVideo: undefined
    });
    const baseRequest: GenerationRequest = {
      ...request(),
      inputMode: "prompt_only",
      sourceVideo: undefined,
      targetAssets: [{ id: "uploaded_hero_asset", kind: "image", role: "replacement hero object", tags: ["slot_replacement"] }],
      replacementBindings: [{ slotId: "slot_hook_visual", assetId: "uploaded_hero_asset", applyMotionFromSlot: true }]
    };
    const mappings = matchSlots(template, source, baseRequest);
    const fillPlan = createFillPlan(mappings, source, baseRequest, template);
    const replacementAction = fillPlan.find((action) => action.slotId === "slot_hook_visual");
    const { timeline } = buildTimeline({
      template,
      request: baseRequest,
      source,
      mappings,
      fillPlan,
      generationId: "generation_replacement"
    });
    const replacementClip = timeline.clips.find((clip) => clip.replacementSlotId === "slot_hook_visual");
    const replacementLayer = replacementClip?.layers.find((layer) => layer.assetId === "uploaded_hero_asset");

    expect(replacementAction?.strategy).toBe("user_asset_replace");
    expect(replacementAction?.rendererInstructions).toMatchObject({
      boundAssetId: "uploaded_hero_asset",
      applyMotionFromSlot: true
    });
    expect(replacementClip?.gapFillStrategy).toBe("user_asset_replace");
    expect(replacementLayer?.timing?.motionSpec).toMatchObject({ preserveFromSlot: true });
    expect(validateTimeline(timeline).valid).toBe(true);
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
