import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  checkGeneratedMaterials,
  createFillPlan,
  createMaterialGenerationBriefs,
  generateGapReport,
  getAigcMaterialProvider,
  matchSlots,
  requiredSlotFromInducedSlot,
  validateAigcMaterialFillConfig,
  validateGeneratedAssetCandidate,
  validateGenerationRequest,
  validateMaterialGenerationBrief
} from "../index.js";
import type { Asset, GenerationRequest, InducedVisualSlot, TargetAssetInput } from "../index.js";
import type { GapReportItem } from "../index.js";

function request(allowAigcMaterialGeneration = false): GenerationRequest {
  return {
    projectId: "project_aigc_test",
    inputMode: "video_plus_prompt",
    sourceVideo: { assetId: "demo_source_video" },
    prompt: [
      "主题：AI 创作工具发布短视频",
      "目标用户：设计师、内容创作者、SaaS 增长团队",
      "卖点：多格式素材管理、功能列表清晰、动态图形包装、品牌 CTA",
      "CTA：上传素材并生成你的创意版本"
    ].join("\n"),
    target: {
      vertical: "b2b_marketing_mg",
      aspectRatio: "9:16",
      targetDurationSec: 15,
      outputMode: "mp4_render"
    },
    controls: {
      packagingStyle: "mg_motion",
      allowAigcPlaceholder: true,
      allowAigcMaterialGeneration
    },
    constraints: {
      noSampleVisualCopy: true,
      sampleAssetReuse: "disabled"
    },
    targetAssets: []
  };
}

const mediaCardsSlot: InducedVisualSlot = {
  id: "slot_media_cards",
  role: "hook",
  modality: "image_set",
  visualForm: "stacked_media_cards",
  visualFormFamily: "media_cards",
  motionPattern: "card_stack_cascade",
  layoutRelation: "foreground_stack",
  assetRequirement: { required: true, type: "image_set", minCount: 4 },
  sourceEvidence: { confidence: 0.9, frameIds: ["kf_media_cards"], framePaths: ["evidence_frames/card.jpg"] },
  rendererCandidates: ["card_stack_motion"],
  fallbackStrategies: ["proxy_placeholder"],
  replacementPolicy: { clickToReplace: true, acceptedAssetTypes: ["image", "video"] },
  confidence: 0.9,
  status: "required"
};

const brandCtaSlot: InducedVisualSlot = {
  id: "slot_brand_cta",
  role: "cta",
  modality: "logo",
  visualForm: "logo_hold",
  visualFormFamily: "brand_cta",
  motionPattern: "logo_hold",
  layoutRelation: "center_hold",
  assetRequirement: { required: true, type: "logo", minCount: 1 },
  sourceEvidence: { confidence: 0.88, frameIds: ["kf_brand_cta"], framePaths: ["evidence_frames/cta.jpg"] },
  rendererCandidates: ["logo_cta_hold"],
  fallbackStrategies: ["proxy_placeholder"],
  replacementPolicy: { clickToReplace: true, acceptedAssetTypes: ["logo", "image", "copy"] },
  confidence: 0.88,
  status: "required"
};

function sourceAsset(): Asset {
  return {
    id: "demo_source_video",
    projectId: "project_aigc_test",
    role: "source_video",
    type: "video",
    filename: "mock.mp4",
    sourcePolicy: "user_authorized",
    metadata: { mock: true },
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("optional AIGC material fill", () => {
  it("is disabled by default and validates config/request schema", () => {
    const disabled = createMaterialGenerationBriefs({
      gapReport: [{ slotId: "slot_media_cards", status: "missing", severity: "high", reason: "missing", impact: "missing", visualFormFamily: "media_cards", missingCount: 4 }],
      inducedSlots: [mediaCardsSlot],
      request: request(false)
    });
    expect(disabled).toHaveLength(0);
    expect(validateGenerationRequest(request(false)).valid).toBe(true);
    expect(validateAigcMaterialFillConfig({
      enabled: false,
      provider: "mock_provider",
      maxAssetsPerRun: 8,
      allowExternalUpload: false,
      allowSampleFramesToProvider: false,
      requireUserApprovalBeforeRender: true,
      cacheEnabled: true
    }).valid).toBe(true);
  });

  it("creates media-card briefs and does not fabricate brand logos", () => {
    const gaps: GapReportItem[] = [
      { slotId: "slot_media_cards", status: "missing", severity: "high", reason: "missing cards", impact: "missing", visualFormFamily: "media_cards", visualForm: "stacked_media_cards", missingCount: 4, rendererCandidates: ["card_stack_motion"], sourceEvidence: mediaCardsSlot.sourceEvidence },
      { slotId: "slot_brand_cta", status: "missing", severity: "high", reason: "missing logo", impact: "missing", visualFormFamily: "brand_cta", visualForm: "logo_hold", missingCount: 1, rendererCandidates: ["logo_cta_hold"], sourceEvidence: brandCtaSlot.sourceEvidence }
    ];
    const briefs = createMaterialGenerationBriefs({
      gapReport: gaps,
      inducedSlots: [mediaCardsSlot, brandCtaSlot],
      request: request(true),
      config: { enabled: true, provider: "mock_provider", maxAssetsPerRun: 8, allowExternalUpload: false, allowSampleFramesToProvider: false, requireUserApprovalBeforeRender: false, cacheEnabled: true }
    });
    expect(briefs.find((brief) => brief.visualFormFamily === "media_cards")?.assetType).toBe("image_set");
    expect(briefs.find((brief) => brief.visualFormFamily === "media_cards")?.count).toBe(4);
    expect(briefs.find((brief) => brief.visualFormFamily === "brand_cta")?.assetType).toBe("logo_placeholder");
    expect(briefs.every((brief) => brief.privacyPolicy.sampleFramesAllowedToProvider === false)).toBe(true);
    expect(briefs.every((brief) => validateMaterialGenerationBrief(brief).valid)).toBe(true);
  });

  it("mock provider generates deterministic candidates with provenance and quality checks", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "vvst-aigc-test-"));
    try {
      const [brief] = createMaterialGenerationBriefs({
        gapReport: [{ slotId: "slot_media_cards", status: "missing", severity: "high", reason: "missing", impact: "missing", visualFormFamily: "media_cards", visualForm: "stacked_media_cards", missingCount: 4, rendererCandidates: ["card_stack_motion"], sourceEvidence: mediaCardsSlot.sourceEvidence }],
        inducedSlots: [mediaCardsSlot],
        request: request(true),
        config: { enabled: true, provider: "mock_provider", maxAssetsPerRun: 8, allowExternalUpload: false, allowSampleFramesToProvider: false, requireUserApprovalBeforeRender: false, cacheEnabled: true }
      });
      const candidates = await getAigcMaterialProvider("mock_provider").generate(brief, {
        outputDir: temp,
        publicPathPrefix: temp,
        now: "2026-01-01T00:00:00.000Z"
      });
      expect(candidates).toHaveLength(4);
      expect(candidates.every((candidate) => existsSync(candidate.path))).toBe(true);
      expect(candidates.every((candidate) => candidate.provenance.externalProviderUsed === false)).toBe(true);
      expect(candidates.every((candidate) => candidate.provenance.sampleFramesSentExternally === false)).toBe(true);
      expect(candidates.every((candidate) => validateGeneratedAssetCandidate(candidate).valid)).toBe(true);
      const quality = await checkGeneratedMaterials({ briefs: [brief], candidates, rootDir: process.cwd(), vlmAvailable: false });
      expect(quality.every((result) => result.usable)).toBe(true);
      expect(quality.every((result) => result.vlmStatus === "skipped_infra")).toBe(true);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("generated target material can drive aigc_generated_asset fill actions", () => {
    const analysis = buildMockVideoAnalysis({ assetId: "sample", projectId: "project_aigc_test", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "project_aigc_test");
    template.requiredSlots = [requiredSlotFromInducedSlot(mediaCardsSlot), requiredSlotFromInducedSlot(brandCtaSlot)];
    template.segments = [
      { id: "seg_hook", role: "hook", startRatio: 0, endRatio: 0.5, intent: "cards", scriptPattern: "cards", slots: [mediaCardsSlot.id] },
      { id: "seg_cta", role: "cta", startRatio: 0.5, endRatio: 1, intent: "cta", scriptPattern: "cta", slots: [brandCtaSlot.id] }
    ];
    const generatedAssets: TargetAssetInput[] = [1, 2, 3, 4].map((index) => ({
      id: `generated_card_${index}`,
      kind: "image",
      role: "media_cards",
      path: `generated-assets/card_${index}.png`,
      tags: ["aigc_generated_material", "media_card", "card"],
      metadata: { materialRole: "aigc_generated_material" }
    }));
    const req = { ...request(true), targetAssets: generatedAssets };
    const source = {
      assetId: "demo_source_video",
      summary: "mock",
      candidates: [],
      warnings: [],
      materialRole: "mock" as const,
      renderable: false,
      reusableAsMaterial: false,
      materialBlockReason: "mock source cannot satisfy slots"
    };
    const mappings = matchSlots(template, source, req);
    const gaps = generateGapReport(mappings, { source, template, request: req });
    const fillPlan = createFillPlan(mappings, source, req, template);
    expect(gaps.find((gap) => gap.visualFormFamily === "media_cards")).toBeUndefined();
    expect(fillPlan.find((action) => action.visualFormFamily === "media_cards")?.strategy).toBe("aigc_generated_asset");
    expect(fillPlan.find((action) => action.visualFormFamily === "media_cards")?.fulfilledBy).toBe("aigc_generated_material");
  });
});
