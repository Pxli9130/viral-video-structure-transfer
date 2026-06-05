import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { createV5Router } from "../src/v5Routes.js";
import { KnowledgeBaseV5 } from "../src/services/knowledgeBaseV5.js";
import { runLearnSampleV5, toEvidenceTimelineV5 } from "../src/pipeline-v5/index.js";

const sampleAsset: Asset = {
  id: "asset_sample_http",
  projectId: "proj_http",
  role: "example_video",
  type: "video",
  filename: "s.mov",
  sourcePolicy: "user_authorized",
  status: "ready",
  createdAt: new Date(0).toISOString(),
  metadata: { width: 1080, height: 1920, fps: 30 }
};

const targetImage: Asset = {
  id: "asset_target_http",
  projectId: "proj_http",
  role: "user_image",
  type: "image",
  filename: "hero.jpg",
  path: "/tmp/hero.jpg",
  sourcePolicy: "user_authorized",
  status: "ready",
  tags: ["hero"],
  createdAt: new Date(0).toISOString(),
  metadata: { width: 1080, height: 1080 }
};

function timeline(): VisualEvidenceTimeline {
  return {
    schemaVersion: "visual-evidence-timeline-v2",
    durationSec: 16,
    hasAudio: true,
    shots: [
      { shotId: "shot_001", startSec: 0, endSec: 2, durationSec: 2, keyframeIds: [], visualTags: ["hero"], styleTags: [], motionEnergy: 0.7, confidence: 0.9 },
      { shotId: "shot_002", startSec: 2, endSec: 12, durationSec: 10, keyframeIds: [], visualTags: ["product"], styleTags: [], motionEnergy: 0.3, confidence: 0.8 },
      { shotId: "shot_003", startSec: 12, endSec: 16, durationSec: 4, keyframeIds: [], visualTags: ["cta"], styleTags: [], motionEnergy: 0.4, confidence: 0.85 }
    ],
    sceneCuts: [],
    beatGrid: { status: "ok", bpm: 120, beats: [0, 0.5], onsets: [0, 12] },
    evidenceFrames: [],
    stats: {} as never,
    ocrStatus: "skipped",
    asrStatus: "skipped",
    analyzerMode: "test",
    warnings: []
  };
}

describe("v5 HTTP routes (/api/v5)", () => {
  let storageRoot: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    storageRoot = mkdtempSync(path.join(tmpdir(), "vvst-http-"));
    // seed the KB file the router will load
    const kb = new KnowledgeBaseV5(storageRoot);
    await runLearnSampleV5(toEvidenceTimelineV5(timeline(), sampleAsset), kb);

    const store = {
      read: async <T>(collection: string): Promise<T[]> =>
        (collection === "assets" ? ([sampleAsset, targetImage] as unknown as T[]) : ([] as T[]))
    };
    const app = express();
    app.use(express.json());
    app.use("/api/v5", createV5Router({ store, storageRoot, generatedDir: path.join(storageRoot, "generated") }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.close();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("GET /kb/elements returns the seeded knowledge elements", async () => {
    const r = await fetch(`${base}/api/v5/kb/elements`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.elements)).toBe(true);
    expect(body.elements.length).toBeGreaterThanOrEqual(5);
  });

  it("GET /kb/elements?kind=hook_pattern filters by kind", async () => {
    const r = await fetch(`${base}/api/v5/kb/elements?kind=hook_pattern`);
    const body = await r.json();
    expect(body.elements.every((e: { kind: string }) => e.kind === "hook_pattern")).toBe(true);
    expect(body.elements.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /kb/search ranks by query", async () => {
    const r = await fetch(`${base}/api/v5/kb/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "hook opening" })
    });
    const body = await r.json();
    expect(body.elements.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /generations/plan composes a schema-valid plan (no render)", async () => {
    const r = await fetch(`${base}/api/v5/generations/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_http",
        generationId: "gen_http_1",
        brief: { theme: "fan ad", targetDurationSec: 16, aspectRatio: "9:16", sellingPoints: ["small", "quiet"] },
        targetAssetIds: ["asset_target_http"],
        options: {}
      })
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.compositionProgramId).toBeTruthy();
    expect(body.finalProgram).toBeTruthy();
    expect(body.scorecard.gates.length).toBe(43);
    expect(body.finalVideoUrl).toBeUndefined(); // plan does not render
    expect(body.scorecard.gates.filter((g: { status: string }) => g.status === "fail")).toEqual([]);
  });

  it("GET /generations/:id returns the stored result", async () => {
    const r = await fetch(`${base}/api/v5/generations/gen_http_1`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.generationId).toBe("gen_http_1");
  });

  it("POST /generations with no KB selection still works (uses all elements); 400 only when KB empty", async () => {
    const r = await fetch(`${base}/api/v5/generations/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p", brief: { targetDurationSec: 12, aspectRatio: "9:16" }, targetAssetIds: [], options: {} })
    });
    expect(r.status).toBe(200);
  });
});
