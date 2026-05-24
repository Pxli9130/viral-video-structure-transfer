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

describe("E2E pipeline (mock adapters)", () => {
  beforeAll(async () => {
    await fs.rm(tmpStorageRoot, { recursive: true, force: true });
    await fs.mkdir(tmpStorageRoot, { recursive: true });
    // dynamic import so env overrides take effect first
    server = await import("../src/server.js");
  });

  afterAll(async () => {
    await server.store.close?.();
    await fs.rm(tmpStorageRoot, { recursive: true, force: true });
  });

  it("walks seed → sample analyze → source upload+analyze → generate → render → export → revise → variants → scorecard", async () => {
    const api = request(server.app);

    // 1. healthz
    const healthRes = await api.get("/healthz").expect(200);
    expect(healthRes.body.data.adapters.videoTool).toBe("MockVideoToolAdapter");

    // 2. create project
    const projectRes = await api
      .post("/api/projects")
      .send({ name: "E2E", vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 })
      .expect(201);
    const projectId = projectRes.body.data.id as string;
    expect(projectId).toMatch(/^project_/);

    // 3. sample analyze (mock, no file)
    const sampleRes = await api
      .post("/api/samples/analyze")
      .send({ projectId, sampleName: "e2e-sample.mp4", description: "demo", durationSec: 15 })
      .expect(201);
    const templateId = sampleRes.body.data.template.id as string;
    const sampleAssetId = sampleRes.body.data.asset.id as string;
    expect(templateId).toMatch(/^template_/);

    // 4. upload a text "source" asset and run analyze (mock will still produce a usable analysis)
    const sourceUploadRes = await api
      .post(`/api/projects/${projectId}/assets`)
      .field("role", "source_video")
      .field("type", "video")
      .field("text", "mock source")
      .field("originalName", "source.mp4")
      .expect(201);
    const sourceAssetId = sourceUploadRes.body.data.id as string;

    const sourceAnalyzeRes = await api
      .post(`/api/assets/${sourceAssetId}/analyze`)
      .send({ purpose: "source", mode: "mock", durationSec: 30 })
      .expect(201);
    expect(sourceAnalyzeRes.body.data.analysis.video.shots.length).toBeGreaterThan(0);

    // 5. generate
    const generateRes = await api
      .post("/api/generations")
      .send({
        projectId,
        inputMode: "video_plus_prompt",
        selectedTemplateIds: [templateId],
        sourceVideo: { assetId: sourceAssetId },
        prompt: "主题：便携式桌面加湿器\nCTA：点击了解更多",
        target: { vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "storyboard_preview" },
        controls: { pace: "fast", hookIntensity: "strong" }
      })
      .expect(201);
    const generationId = generateRes.body.data.generationId as string;
    expect(generateRes.body.data.generation.timeline.clips.length).toBeGreaterThan(0);
    expect(generateRes.body.data.generation.gapReport.every((g: { reason: string }) => Boolean(g.reason))).toBe(true);

    // 6. render html_preview
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

    // 8. exports
    const timelineExport = await api
      .get(`/api/generations/${generationId}/export/timeline`)
      .expect(200);
    expect(timelineExport.text).toContain("\"id\":");
    const reportExport = await api
      .get(`/api/generations/${generationId}/export/report?format=markdown`)
      .expect(200);
    expect(reportExport.text).toContain("# Generation Report");

    // 9. revise (heuristic mutation: pace fast)
    const reviseRes = await api
      .post(`/api/generations/${generationId}/revise`)
      .send({ instruction: "开头更抓人一些，节奏更快，CTA 更直接" })
      .expect(200);
    expect(reviseRes.body.data.applied).toBe(true);
    expect(reviseRes.body.data.patchedControls.pace).toBe("fast");
    expect(reviseRes.body.data.generation.id).not.toBe(generationId);

    // 10. variants (4 named versions)
    const variantsRes = await api
      .post(`/api/generations/${generationId}/variants`)
      .send({})
      .expect(201);
    expect(variantsRes.body.data.count).toBe(4);
    const labels = variantsRes.body.data.variants.map((v: { label: string }) => v.label);
    expect(labels).toEqual(expect.arrayContaining(["high_ctr", "high_conversion", "high_rhythm", "high_quality"]));

    // 11. scorecard
    const scorecardRes = await api
      .post(`/api/generations/${generationId}/scorecard`)
      .send({ skipLlm: true })
      .expect(200);
    expect(scorecardRes.body.data.judge).toBe("heuristic");
    expect(scorecardRes.body.data.overall).toBeGreaterThanOrEqual(0);
    expect(scorecardRes.body.data.overall).toBeLessThanOrEqual(100);
    expect(scorecardRes.body.data.dimensions).toHaveLength(5);

    // 12. KB export
    const kbExport = await api
      .get(`/api/projects/${projectId}/knowledge-base/export`)
      .expect(200);
    expect(kbExport.body.templates ?? JSON.parse(kbExport.text).templates).toBeDefined();
  });
});
