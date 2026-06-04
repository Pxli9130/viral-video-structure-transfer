import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import {
  buildV5RenderInputProps,
  renderFinalVideoV5,
  runCreateV5,
  runLearnSampleV5,
  toEvidenceTimelineV5
} from "../src/pipeline-v5/index.js";
import { KnowledgeBaseV5 } from "../src/services/knowledgeBaseV5.js";

const sampleAsset: Asset = {
  id: "asset_render",
  projectId: "proj_render",
  role: "example_video",
  type: "video",
  filename: "s.mov",
  sourcePolicy: "user_authorized",
  status: "ready",
  createdAt: new Date(0).toISOString(),
  metadata: { width: 1080, height: 1920, fps: 30 }
};

function timeline(): VisualEvidenceTimeline {
  return {
    schemaVersion: "visual-evidence-timeline-v2",
    durationSec: 4,
    hasAudio: true,
    shots: [
      { shotId: "shot_001", startSec: 0, endSec: 1, durationSec: 1, keyframeIds: [], visualTags: ["hero"], styleTags: [], motionEnergy: 0.7, confidence: 0.9 },
      { shotId: "shot_002", startSec: 1, endSec: 3, durationSec: 2, keyframeIds: [], visualTags: ["product"], styleTags: [], motionEnergy: 0.3, confidence: 0.8 },
      { shotId: "shot_003", startSec: 3, endSec: 4, durationSec: 1, keyframeIds: [], visualTags: ["cta"], styleTags: [], motionEnergy: 0.4, confidence: 0.85 }
    ],
    sceneCuts: [],
    beatGrid: { status: "ok", bpm: 120, beats: [0, 0.5], onsets: [0, 3] },
    evidenceFrames: [],
    stats: {} as never,
    ocrStatus: "skipped",
    asrStatus: "skipped",
    analyzerMode: "test",
    warnings: []
  };
}

async function buildFinalProgram(storageDir: string): Promise<v5.FinalVideoProgram> {
  const kb = new KnowledgeBaseV5(storageDir);
  await runLearnSampleV5(toEvidenceTimelineV5(timeline(), sampleAsset), kb);
  const create = await runCreateV5({
    projectId: "proj_render",
    generationId: "g_render",
    brief: { theme: "demo fan", targetDurationSec: 4, aspectRatio: "9:16", sellingPoints: ["small", "quiet"] },
    targetAssets: [],
    selectedElements: kb.list()
  });
  return create.finalProgram;
}

describe("pipeline-v5 render: props mapping (pure, always runs)", () => {
  let storageDir: string;
  beforeAll(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "vvst-rprops-"));
  });
  afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

  it("maps a FinalVideoProgram to V5Final input props and defaults assetMap from recipe.assets", async () => {
    const finalProgram = await buildFinalProgram(storageDir);
    const props = buildV5RenderInputProps(finalProgram, {});
    expect(props.recipe.version).toBe("render-recipe-v5");
    expect(props.recipe.layers.length).toBeGreaterThan(0);
    for (const a of finalProgram.renderRecipe.assets) {
      expect(props.assetMap[a.id]?.src).toBe(a.uri);
    }
  });
});

// Heavy render (Remotion bundle + chrome). Gated like remotion-bundle.test to keep default CI light.
const RUN_RENDER = process.env.RUN_V5_RENDER === "true";

(RUN_RENDER ? describe : describe.skip)("pipeline-v5 render: full final.mp4 (gated by RUN_V5_RENDER)", () => {
  let storageDir: string;
  beforeAll(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "vvst-render-"));
  });
  afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

  it("renders a playable final.mp4 with an audio track", async () => {
    const finalProgram = await buildFinalProgram(storageDir);
    const outPath = path.join(storageDir, "final.mp4");
    const res = await renderFinalVideoV5({ finalProgram, outPath, proceduralAudio: true });
    expect(res.ok).toBe(true);
    const file = res.finalMp4 ?? outPath;
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(1000);
  }, 300_000);
});
