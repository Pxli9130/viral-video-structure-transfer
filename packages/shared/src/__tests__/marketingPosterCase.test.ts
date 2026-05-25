import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  generateMigrationResult,
  validateStructureTemplate,
  validateTimeline,
  type GenerationRequest,
  type RibbonMotionGeometry,
  type VideoAnalysisResult,
  type VLMVideoAnalysis
} from "../index.js";

const projectId = "project_marketing_poster_case";
const sampleAssetId = "asset_marketing_mov";
const marketingRibbonMotion: RibbonMotionGeometry = {
  surfaceType: "wide_band",
  pathFamily: "vertical_helix",
  axis: "screen_y",
  depthBehavior: "front_back_crossing",
  layoutRelation: "around_title",
  textRelation: "text_on_ribbon",
  confidence: 0.78,
  evidenceFrames: [4.6, 9.2, 13.8],
  turns: 1.25,
  radiusX: 260,
  radiusZ: 160,
  pitchY: 960
};

const marketingAnalysis: VideoAnalysisResult = {
  id: "analysis_marketing_mov",
  assetId: sampleAssetId,
  projectId,
  purpose: "sample",
  metadata: {
    durationSec: 18.433333,
    width: 718,
    height: 1018,
    fps: 30,
    hasAudio: true,
    codec: "h264"
  },
  keyframes: [
    { id: "marketing_kf_1", timeSec: 0.5, description: "Minimal off-white poster with central Chinese title and fixed info anchors.", tags: ["hook_candidate", "text_card_candidate"] },
    { id: "marketing_kf_2", timeSec: 4, description: "Large ribbon surface enters and starts a vertical helix around the title.", tags: ["background", "text_card_candidate"] },
    { id: "marketing_kf_3", timeSec: 8.5, description: "Keyword repetition and color progression strengthen brand memory.", tags: ["text_card_candidate"] },
    { id: "marketing_kf_4", timeSec: 13.5, description: "Dense multi-color ribbon climax around static poster typography.", tags: ["comparison_candidate", "text_card_candidate"] },
    { id: "marketing_kf_5", timeSec: 16.6, description: "Social platform profile page tail, not part of the transferable creative structure.", tags: ["background"] }
  ],
  shots: [
    { id: "marketing_shot_hook", startSec: 0, endSec: 2, durationSec: 2, tags: ["hook_candidate", "text_card_candidate"], confidence: 0.9, notes: "Main title appears immediately." },
    { id: "marketing_shot_ribbon_entry", startSec: 2, endSec: 6, durationSec: 4, tags: ["background", "text_card_candidate"], confidence: 0.86, notes: "Ribbon surface enters as a vertical helix around the static poster." },
    { id: "marketing_shot_keyword_memory", startSec: 6, endSec: 10, durationSec: 4, tags: ["text_card_candidate"], confidence: 0.84, notes: "English keywords repeat around the poster." },
    { id: "marketing_shot_color_climax", startSec: 10, endSec: 14.5, durationSec: 4.5, tags: ["comparison_candidate", "text_card_candidate"], confidence: 0.82, notes: "Color diversity and motion density increase." },
    { id: "marketing_shot_cta_poster", startSec: 14.5, endSec: 15.7, durationSec: 1.2, tags: ["cta_candidate", "text_card_candidate"], confidence: 0.82, notes: "Clean final poster hold." },
    { id: "marketing_shot_platform_tail", startSec: 15.7, endSec: 18.433333, durationSec: 2.733333, tags: ["background"], confidence: 0.45, notes: "Platform UI tail; excluded from transferable structure." }
  ],
  transcript: [],
  ocr: [
    { timeSec: 0.5, text: "造物 逐空 2026" },
    { timeSec: 8.5, text: "STRUCTURE COLOR SPACE" },
    { timeSec: 16.6, text: "小红书 profile UI" }
  ],
  warnings: ["Fixture analysis encodes evaluator-observed marketing.mov structure."],
  analyzerMode: "ffmpeg_vlm_asr",
  createdAt: "2026-05-24T00:00:00.000Z"
};

const marketingVlm: VLMVideoAnalysis = {
  videoSummary:
    "Marketing motion-graphic poster: minimal off-white poster, central static typography, wide parametric ribbon surface moving as a vertical helix around the screen Y axis, repeated English keywords, progressive color build, and a social-platform UI tail after the creative ending.",
  videoType: "motion_graphic_marketing_poster",
  visualStyle: {
    background: "minimal_off_white",
    layout: "central_static_typography",
    motionAsset: "parametric_ribbon_surface",
    ribbonMotion: marketingRibbonMotion,
    colorProgression: ["blue", "purple", "pink", "orange", "yellow", "green"],
    typography: "Chinese main title + English keyword repetition"
  },
  excludeSegments: [
    {
      startSec: 15.7,
      endSec: 18.4,
      reason: "social platform UI / screen recording tail; do not transfer"
    }
  ],
  shots: [
    { start: 0, end: 2, purpose: "hook", visual: "Main title appears immediately on a minimal poster layout.", transition: "none" },
    { start: 2, end: 6, purpose: "visual_attention", visual: "A large ribbon surface enters and starts a vertical helix around the title.", transition: "ribbon sweep" },
    { start: 6, end: 10, purpose: "brand_memory", visual: "English keywords repeat on and around the Y-axis ribbon while poster anchors remain fixed.", transition: "helix loop" },
    { start: 10, end: 14.5, purpose: "climax", visual: "Color diversity and motion density increase to a multi-color ribbon climax.", transition: "color progression" },
    { start: 14.5, end: 15.7, purpose: "cta", visual: "Clean final poster hold with date, location, logo, and action cue.", transition: "hold" }
  ],
  structure: {
    hook: "Show main title immediately and keep the poster readable.",
    setup: "Use central static typography, large negative space, and fixed information anchors.",
    sellingPoints: ["minimal poster layout", "parametric vertical helix ribbon", "keyword repetition", "color progression", "clean final CTA"],
    climax: "Increase color diversity and motion density before the final poster hold.",
    cta: "Freeze a clean final poster with date, location, logo, and action cue."
  },
  rhythm: {
    avgShotLength: 3.1,
    fastSections: ["3-8s vertical ribbon helix", "8-13s color acceleration"],
    peakMoments: ["13-15.7s multi-color ribbon climax"],
    peakTimeRatio: 0.78,
    notes: "0-3s establishes poster, 3-8s motion entry, 8-13s keyword/color build, 13-15.7s climax, 15.7-18.4s platform UI tail excluded."
  },
  packaging: {
    subtitleDensity: "medium",
    titleCards: ["central static typography + English keyword repetition"],
    stickers: ["parametric_ribbon_surface", "vertical_helix_y", "keyword_ring", "date_location_anchor"],
    colorStyle: "blue → purple → pink → orange → yellow → green progression",
    coverStyle: "minimal off-white poster with large central title"
  },
  reusablePatterns: [
    "minimal information poster + parametric ribbon dynamic packaging",
    "vertical helix ribbon around central static typography",
    "progressive multi-color climax",
    "clean final poster CTA hold"
  ],
  materialGapsForNewVideo: ["dynamic_3d_ribbon_asset", "final_date_location_card", "brand_keyword_copy"],
  raw: JSON.stringify({
    exclude_segments: [{ time: "15.7-18.4", reason: "social platform UI / screen recording tail; do not transfer" }]
  })
};

function aiChallengeRequest(controls: GenerationRequest["controls"] = {}): GenerationRequest {
  return {
    projectId,
    inputMode: "prompt_only",
    selectedTemplateIds: ["template_marketing_case"],
    prompt: [
      "主题：AI 全栈挑战赛 · 爆款结构迁移引擎",
      "目标用户：评委、参赛者",
      "卖点：样例拆解、素材补全、视频重组、可解释时间线",
      "风格：科技感、极简、适合答辩展示、3D 彩带动态海报",
      "CTA：Upload. Analyze. Remix. 一键生成可解释短视频方案"
    ].join("\n"),
    target: {
      vertical: "b2b_marketing_mg",
      aspectRatio: "9:16",
      targetDurationSec: 16,
      outputMode: "mp4_render"
    },
    controls: {
      pace: "fast",
      hookIntensity: "strong",
      packagingStyle: "mg_motion",
      ctaStyle: "direct",
      allowAigcPlaceholder: true,
      ...controls
    },
    constraints: {
      noSampleVisualCopy: true,
      forbiddenWords: ["造物", "逐空", "小红书", "Xiaohongshu"],
      mustMention: ["爆款结构迁移引擎", "Upload. Analyze. Remix."]
    }
  };
}

describe("marketing.mov dynamic poster structure-transfer testcase", () => {
  it("extracts a reusable MG poster template and excludes the platform UI tail from transferable structure", () => {
    const template = buildFallbackTemplate(marketingAnalysis, "b2b_marketing_mg", projectId, marketingVlm);

    expect(validateStructureTemplate(template).valid).toBe(true);
    expect(template.name).toContain("Learned MG Structure");
    expect(template.videoType).toBe("motion_graphic_marketing_poster");
    expect(template.visualStyle).toMatchObject({
      background: "minimal_off_white",
      layout: "central_static_typography",
      motionAsset: "parametric_ribbon_surface",
      ribbonMotion: marketingRibbonMotion,
      typography: "Chinese main title + English keyword repetition"
    });
    expect(template.visualStyle?.colorProgression).toEqual(["blue", "purple", "pink", "orange", "yellow", "green"]);
    expect(template.excludeSegments).toEqual([
      expect.objectContaining({
        startSec: 15.7,
        endSec: 18.4,
        reason: expect.stringContaining("social platform UI")
      })
    ]);
    expect(template.targetDurationSec).toBeCloseTo(15.7, 1);
    expect(template.packaging.titleCardStyle).toContain("central static typography");
    expect(template.packaging.overlayStyle).toContain("parametric_ribbon_surface");
    expect(template.packaging.coverStyle).toContain("minimal off-white poster");
    expect(template.qualityRationale).toContain("parametric ribbon");
    expect(marketingVlm.raw).toContain("15.7-18.4");
    expect(template.structureAtoms.some((atom) => atom.description.includes("vertical helix ribbon"))).toBe(true);
    expect(template.structureAtoms.map((atom) => atom.name)).toEqual(
      expect.arrayContaining(["Title-card hook", "Contrast proof beat", "Brand-reveal CTA", "Reusable motion motif"])
    );
    expect(template.structureAtoms.map((atom) => atom.name).join(" ")).not.toContain("造物");
    expect(template.structureAtoms.map((atom) => atom.name).join(" ")).not.toContain("小红书");
  });

  it("does not reuse sample shots that overlap template excludeSegments", () => {
    const template = buildFallbackTemplate(marketingAnalysis, "b2b_marketing_mg", projectId, marketingVlm);
    const result = generateMigrationResult({
      template,
      sourceAsset: {
        id: sampleAssetId,
        projectId,
        role: "source_video",
        type: "video",
        filename: "marketing.mov",
        sourcePolicy: "demo_only",
        tags: ["background", "cta_candidate"],
        status: "ready",
        createdAt: "2026-05-24T00:00:00.000Z"
      },
      sourceAnalysis: {
        ...marketingAnalysis,
        purpose: "source",
        shots: marketingAnalysis.shots.map((shot) =>
          shot.id === "marketing_shot_platform_tail" ? { ...shot, tags: ["hook_candidate", "product_like", "cta_candidate"] } : shot
        )
      },
      request: aiChallengeRequest()
    });

    const selectedShotIds = result.slotMapping.map((mapping) => mapping.selectedShotId).filter(Boolean);
    expect(selectedShotIds).not.toContain("marketing_shot_platform_tail");
  });

  it("migrates the poster structure to the AI challenge topic with visible gaps and no copied sample text", () => {
    const template = buildFallbackTemplate(marketingAnalysis, "b2b_marketing_mg", projectId, marketingVlm);
    const generation = generateMigrationResult({ template, request: aiChallengeRequest() });

    expect(generation.validation.timeline.valid).toBe(true);
    expect(validateTimeline(generation.timeline).valid).toBe(true);
    expect(generation.sourceUnderstanding.warnings.join(" ")).toContain("No source video");
    expect(generation.sourceUnderstanding.candidates).toHaveLength(0);
    expect(generation.gapReport.length).toBeGreaterThanOrEqual(6);
    expect(
      generation.gapReport.some(
        (gap) =>
          gap.gapType === "dynamic_3d_ribbon_asset" &&
          gap.severity === "high" &&
          (gap.recommendedFillStrategies ?? []).includes("procedural_generation")
      )
    ).toBe(true);
    expect(generation.fillPlan.map((action) => action.strategy)).toEqual(
      expect.arrayContaining(["aigc_placeholder", "text_card", "packaging_overlay", "procedural_generation"])
    );
    expect(
      generation.fillPlan.some(
        (action) =>
          action.strategy === "procedural_generation" &&
          action.rendererInstructions?.atom === "parametric_ribbon_surface" &&
          action.rendererInstructions?.fulfilledBy === "procedural_generation"
      )
    ).toBe(true);
    expect(generation.timeline.renderPlan?.adapterOptions?.packagingStyle).toBe("mg_motion");
    expect(generation.timeline.renderPlan?.motionAtoms?.[0]).toMatchObject({
      type: "parametric_ribbon_surface",
      fulfilledBy: "procedural_generation",
      style: "mg_motion",
      surfaceType: "wide_band",
      pathFamily: "vertical_helix",
      axis: "screen_y",
      textOnRibbon: true,
      depthLayering: true,
      specularHighlight: true,
      climaxBuild: true
    });
    expect(generation.timeline.renderPlan?.motionAtoms?.[0]?.bandWidth).toBeGreaterThanOrEqual(70);
    expect(generation.timeline.renderPlan?.motionAtoms?.[0]?.frontLayerCount).toBeGreaterThanOrEqual(2);
    expect(generation.timeline.renderPlan?.motionAtoms?.[0]?.backLayerCount).toBeGreaterThanOrEqual(2);
    expect(generation.timeline.renderPlan?.motionAtoms?.[0]?.gradientStops?.length).toBeGreaterThanOrEqual(6);
    expect(generation.timeline.renderPlan?.motionAtoms?.[0]?.keywords).toEqual(
      expect.arrayContaining(["STRUCTURE", "REMIX", "TIMELINE", "AIGC", "CREATION"])
    );

    const finalText = generation.storyboard.map((item) => item.subtitle).join(" ");
    expect(finalText).toContain("爆款结构迁移引擎");
    expect(finalText).toContain("Upload. Analyze. Remix.");
    expect(finalText).not.toContain("造物");
    expect(finalText).not.toContain("逐空");
    expect(finalText).not.toContain("小红书");
  });

  it("produces distinguishable high-CTR and high-quality variants for the migrated poster", () => {
    const template = buildFallbackTemplate(marketingAnalysis, "b2b_marketing_mg", projectId, marketingVlm);
    const main = generateMigrationResult({ template, request: aiChallengeRequest() });
    const highCtr = generateMigrationResult({
      template,
      request: aiChallengeRequest({ pace: "fast", hookIntensity: "aggressive", packagingStyle: "mg_motion", ctaStyle: "direct" }),
      generationIdSalt: "high_ctr"
    });
    const highQuality = generateMigrationResult({
      template,
      request: aiChallengeRequest({ pace: "slow", hookIntensity: "safe", packagingStyle: "clean", ctaStyle: "soft" }),
      generationIdSalt: "high_quality"
    });

    const mainAtom = main.timeline.renderPlan?.motionAtoms?.[0];
    const ctrAtom = highCtr.timeline.renderPlan?.motionAtoms?.[0];
    const qualityAtom = highQuality.timeline.renderPlan?.motionAtoms?.[0];

    expect(highCtr.id).not.toBe(highQuality.id);
    expect(highCtr.timeline.id).not.toBe(highQuality.timeline.id);
    expect(highCtr.timeline.renderPlan?.background).not.toBe(highQuality.timeline.renderPlan?.background);
    expect(highCtr.timeline.clips.length).toBeGreaterThan(highQuality.timeline.clips.length);
    expect(mainAtom).toMatchObject({ type: "parametric_ribbon_surface", fulfilledBy: "procedural_generation", style: "mg_motion", pathFamily: "vertical_helix", axis: "screen_y" });
    expect(ctrAtom).toMatchObject({ type: "parametric_ribbon_surface", fulfilledBy: "procedural_generation", style: "mg_motion", pathFamily: "vertical_helix", axis: "screen_y" });
    expect(qualityAtom).toMatchObject({ type: "parametric_ribbon_surface", fulfilledBy: "procedural_generation", style: "clean_premium", pathFamily: "vertical_helix", axis: "screen_y" });
    expect(ctrAtom?.density).toBeGreaterThan(mainAtom?.density ?? 0);
    expect(ctrAtom?.speed).toBeGreaterThan(mainAtom?.speed ?? 0);
    expect(ctrAtom?.bandWidth).toBeGreaterThan(mainAtom?.bandWidth ?? 0);
    expect(ctrAtom?.frontLayerCount).toBeGreaterThan(mainAtom?.frontLayerCount ?? 0);
    expect(qualityAtom?.density).toBeLessThan(mainAtom?.density ?? Number.POSITIVE_INFINITY);
    expect(qualityAtom?.speed).toBeLessThan(mainAtom?.speed ?? Number.POSITIVE_INFINITY);
    expect(qualityAtom?.bandWidth).toBeLessThan(mainAtom?.bandWidth ?? Number.POSITIVE_INFINITY);
    expect(qualityAtom?.textOnRibbon).toBe(true);
    expect(qualityAtom?.depthLayering).toBe(true);
    expect(qualityAtom?.opacity).toBeGreaterThan(0);
  });
});
