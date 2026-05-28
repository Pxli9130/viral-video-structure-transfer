import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../..");
const tmpStorageRoot = path.resolve(moduleDir, "tmp-e2e-storage");

process.env.VVST_NO_LISTEN = "true";
process.env.STORAGE_DIR = path.relative(repoRoot, tmpStorageRoot);
process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND ?? "json";
process.env.VIDEO_TOOL = "mock";
process.env.AI_PROVIDER = "mock";
process.env.VLM_PROVIDER = "";
process.env.ASR_PROVIDER = "";
process.env.OCR_PROVIDER = "";

let server: typeof import("../src/server.js");
let api: ReturnType<typeof request>;
let projectId = "";
let templateId = "";
let sourceAssetId = "";
let generationId = "";

describe("E2E pipeline (mock adapters)", () => {
  beforeAll(async () => {
    await fs.rm(tmpStorageRoot, { recursive: true, force: true });
    await fs.mkdir(tmpStorageRoot, { recursive: true });
    // dynamic import so env overrides take effect first
    server = await import("../src/server.js");
    api = request(server.app);
  });

  afterAll(async () => {
    await server.store.close?.();
    await fs.rm(tmpStorageRoot, { recursive: true, force: true });
  });

  it("serves healthz and creates a project", async () => {
    const healthRes = await api.get("/healthz").expect(200);
    expect(healthRes.body.data.adapters.videoTool).toBe("MockVideoToolAdapter");

    const projectRes = await api
      .post("/api/projects")
      .send({ name: "E2E", vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 })
      .expect(201);
    projectId = projectRes.body.data.id as string;
    expect(projectId).toMatch(/^project_/);
  });

  it("analyzes a sample and exposes template/knowledge-base data", async () => {
    const sampleRes = await api
      .post("/api/samples/analyze")
      .send({ projectId, sampleName: "e2e-sample.mp4", description: "demo", durationSec: 15 })
      .expect(201);
    templateId = sampleRes.body.data.template.id as string;
    expect(templateId).toMatch(/^template_/);
    expect(sampleRes.body.data.analysis.shots.length).toBeGreaterThan(0);

    const kbExport = await api
      .get(`/api/projects/${projectId}/knowledge-base/export`)
      .expect(200);
    expect(kbExport.body.templates ?? JSON.parse(kbExport.text).templates).toBeDefined();
  });

  it("uploads/analyzes source material and generates a gap-aware timeline", async () => {
    const sourceUploadRes = await api
      .post(`/api/projects/${projectId}/assets`)
      .field("role", "source_video")
      .field("type", "video")
      .field("text", "mock source")
      .field("originalName", "source.mp4")
      .expect(201);
    sourceAssetId = sourceUploadRes.body.data.id as string;

    const sourceAnalyzeRes = await api
      .post(`/api/assets/${sourceAssetId}/analyze`)
      .send({ purpose: "source", mode: "mock", durationSec: 30 })
      .expect(201);
    expect(sourceAnalyzeRes.body.data.analysis.video.shots.length).toBeGreaterThan(0);

    const generateRes = await api
      .post("/api/generations")
      .send({
        projectId,
        inputMode: "video_plus_prompt",
        selectedTemplateIds: [templateId],
        sourceVideo: { assetId: sourceAssetId },
        prompt: "主题：便携式桌面加湿器\nCTA：点击了解更多",
        target: { vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "storyboard_preview" },
        controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion" }
      })
      .expect(201);
    generationId = generateRes.body.data.generationId as string;
    expect(generateRes.body.data.generation.timeline.clips.length).toBeGreaterThan(0);
    expect(generateRes.body.data.generation.gapReport.every((g: { reason: string }) => Boolean(g.reason))).toBe(true);
    expect(Array.isArray(generateRes.body.data.generation.replacementSlots)).toBe(true);
  });

  it("binds an uploaded replacement asset to a gap slot and regenerates", async () => {
    const replacementUploadRes = await api
      .post(`/api/projects/${projectId}/assets`)
      .send({
        role: "user_image",
        type: "image",
        originalName: "replacement-hero.png",
        tags: "slot_replacement,hero",
        sourcePolicy: "user_authorized"
      })
      .expect(201);
    const assetId = replacementUploadRes.body.data.id as string;

    const generationRes = await api.get(`/api/generations/${generationId}`).expect(200);
    const slotId = (generationRes.body.data.replacementSlots[0]?.slotId ?? generationRes.body.data.slotMapping[0].slotId) as string;
    const replacementRes = await api
      .post(`/api/generations/${generationId}/replacements`)
      .send({ slotId, assetId, applyMotionFromSlot: true })
      .expect(201);

    generationId = replacementRes.body.data.generationId as string;
    expect(replacementRes.body.data.previousGenerationId).not.toBe(generationId);
    expect(replacementRes.body.data.replacementSlot).toMatchObject({
      slotId,
      status: "user_replaced",
      boundAssetId: assetId
    });
    expect(
      replacementRes.body.data.generation.fillPlan.some(
        (action: { strategy: string; rendererInstructions?: { boundAssetId?: string } }) =>
          action.strategy === "user_asset_replace" && action.rendererInstructions?.boundAssetId === assetId
      )
    ).toBe(true);
  });

  it("rejects replacement assets from another project", async () => {
    const otherProjectRes = await api
      .post("/api/projects")
      .send({ name: "Other", vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 })
      .expect(201);
    const otherAssetRes = await api
      .post(`/api/projects/${otherProjectRes.body.data.id}/assets`)
      .send({
        role: "user_image",
        type: "image",
        originalName: "foreign.png",
        tags: "slot_replacement",
        sourcePolicy: "user_authorized"
      })
      .expect(201);
    const generationRes = await api.get(`/api/generations/${generationId}`).expect(200);
    const slotId = (generationRes.body.data.replacementSlots[0]?.slotId ?? generationRes.body.data.slotMapping[0].slotId) as string;

    await api
      .post(`/api/generations/${generationId}/replacements`)
      .send({ slotId, assetId: otherAssetRes.body.data.id, applyMotionFromSlot: true })
      .expect(403);
  });

  it("renders previews and exports timeline/report artifacts", async () => {
    const renderRes = await api
      .post(`/api/generations/${generationId}/render`)
      .send({ rendererTarget: "html_preview" })
      .expect(201);
    expect(renderRes.body.data.render.status).toBe("completed");

    // 7. render hyperframes (now should succeed as manifest stub)
    const hyperRes = await api
      .post(`/api/generations/${generationId}/render`)
      .send({ rendererTarget: "hyperframes" })
      .expect(201);
    expect(hyperRes.body.data.render.status).toBe("completed");
    expect(hyperRes.body.data.render.outputPath).toContain("hyperframes.json");

    const timelineExport = await api
      .get(`/api/generations/${generationId}/export/timeline`)
      .expect(200);
    expect(timelineExport.text).toContain("\"id\":");
    const reportExport = await api
      .get(`/api/generations/${generationId}/export/report?format=markdown`)
      .expect(200);
    expect(reportExport.text).toContain("# Generation Report");
  });

  it("applies revise and produces visibly different named variants", async () => {
    const reviseRes = await api
      .post(`/api/generations/${generationId}/revise`)
      .send({ instruction: "放慢节奏，减少字幕，CTA 更柔和" })
      .expect(200);
    expect(reviseRes.body.data.applied).toBe(true);
    expect(reviseRes.body.data.patchedControls.pace).toBe("slow");
    expect(reviseRes.body.data.generation.timeline.renderPlan.background).toBe("#f8fafc");
    expect(reviseRes.body.data.generation.id).not.toBe(generationId);
    expect(reviseRes.body.data.generation.timeline.clips.length).toBeLessThan(8);

    const variantsRes = await api
      .post(`/api/generations/${generationId}/variants`)
      .send({})
      .expect(201);
    expect(variantsRes.body.data.count).toBe(4);
    const labels = variantsRes.body.data.variants.map((v: { label: string }) => v.label);
    expect(labels).toEqual(expect.arrayContaining(["high_ctr", "high_conversion", "high_rhythm", "high_quality"]));
    const highCtr = variantsRes.body.data.variants.find((v: { label: string }) => v.label === "high_ctr");
    const highQuality = variantsRes.body.data.variants.find((v: { label: string }) => v.label === "high_quality");
    expect(highCtr.generation.timeline.id).not.toBe(highQuality.generation.timeline.id);
    expect(highCtr.generation.timeline.clips.length).toBeGreaterThan(highQuality.generation.timeline.clips.length);
    expect(highCtr.generation.timeline.renderPlan.background).not.toBe(highQuality.generation.timeline.renderPlan.background);
  });

  it("returns a heuristic scorecard for the generation", async () => {
    const scorecardRes = await api
      .post(`/api/generations/${generationId}/scorecard`)
      .send({ skipLlm: true })
      .expect(200);
    expect(scorecardRes.body.data.judge).toBe("heuristic");
    expect(scorecardRes.body.data.overall).toBeGreaterThanOrEqual(0);
    expect(scorecardRes.body.data.overall).toBeLessThanOrEqual(100);
    expect(scorecardRes.body.data.dimensions).toHaveLength(5);
    expect(scorecardRes.body.data.gates.some((gate: { id: string }) => gate.id === "replacement_asset_rendered")).toBe(true);
  });
});
