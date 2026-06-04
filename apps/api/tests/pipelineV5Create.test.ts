import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { runCreateV5, runLearnSampleV5, toEvidenceTimelineV5 } from "../src/pipeline-v5/index.js";
import { KnowledgeBaseV5 } from "../src/services/knowledgeBaseV5.js";

function timeline(): VisualEvidenceTimeline {
  return {
    schemaVersion: "visual-evidence-timeline-v2",
    sourceAssetId: "asset_sample_create",
    durationSec: 16,
    hasAudio: true,
    shots: [
      { shotId: "shot_001", startSec: 0, endSec: 2, durationSec: 2, keyframeIds: [], visualTags: ["hero"], styleTags: ["bold"], motionEnergy: 0.7, confidence: 0.9 },
      { shotId: "shot_002", startSec: 2, endSec: 12, durationSec: 10, keyframeIds: [], visualTags: ["product"], styleTags: ["clean"], motionEnergy: 0.3, confidence: 0.8 },
      { shotId: "shot_003", startSec: 12, endSec: 16, durationSec: 4, keyframeIds: [], visualTags: ["cta"], styleTags: ["card"], motionEnergy: 0.4, confidence: 0.85 }
    ],
    sceneCuts: [],
    beatGrid: { status: "ok", bpm: 120, beats: [0, 0.5, 1.0], onsets: [0, 2, 12] },
    evidenceFrames: [],
    stats: {} as never,
    ocrStatus: "skipped",
    asrStatus: "skipped",
    analyzerMode: "test",
    warnings: []
  };
}

const sampleAsset: Asset = {
  id: "asset_sample_create",
  projectId: "proj_create",
  role: "example_video",
  type: "video",
  filename: "sample_create.mov",
  sourcePolicy: "user_authorized",
  status: "ready",
  createdAt: new Date(0).toISOString(),
  metadata: { width: 1080, height: 1920, fps: 30 }
};

const targetImage: Asset = {
  id: "asset_target_fan_hero",
  projectId: "proj_create",
  role: "user_image",
  type: "image",
  filename: "fan_hero.jpg",
  sourcePolicy: "user_authorized",
  status: "ready",
  createdAt: new Date(0).toISOString(),
  tags: ["hero", "fan"],
  metadata: { width: 1080, height: 1080 }
};

describe("pipeline-v5 CREATE (deterministic, no external APIs)", () => {
  let storageDir: string;
  let elements: v5.KnowledgeElement[];

  beforeAll(async () => {
    storageDir = mkdtempSync(path.join(tmpdir(), "vvst-create-"));
    const kb = new KnowledgeBaseV5(storageDir);
    const ev = toEvidenceTimelineV5(timeline(), sampleAsset);
    await runLearnSampleV5(ev, kb);
    elements = kb.list();
  });
  afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

  it("learned a reusable KB with hook + structure + cta elements", () => {
    const kinds = new Set(elements.map((e) => e.kind));
    expect(kinds.has("structure_pattern")).toBe(true);
    expect(kinds.has("hook_pattern")).toBe(true);
    expect(kinds.has("cta_pattern")).toBe(true);
  });

  it("composes a new video from selected elements + one target image; all artifacts schema-valid", async () => {
    const brief: v5.CreativeBriefV5 = {
      theme: "portable fan high-click ad",
      variant: "high_click",
      targetDurationSec: 16,
      aspectRatio: "9:16",
      sellingPoints: ["small", "quiet", "long battery"]
    };
    const out = await runCreateV5({
      projectId: "proj_create",
      generationId: "gen_001",
      brief,
      targetAssets: [targetImage],
      selectedElements: elements
    });

    expect(v5.validateCompositionProgram(out.composition).errors).toEqual([]);
    expect(v5.validateGapReportV5(out.gapReport).errors).toEqual([]);
    expect(v5.validateFinalVideoProgram(out.finalProgram).errors).toEqual([]);
    expect(v5.validateRenderRecipeV5(out.finalProgram.renderRecipe).errors).toEqual([]);
    expect(v5.validateSelectionSet(out.selectionSet).errors).toEqual([]);

    // sections cover the full duration
    const last = out.composition.sections[out.composition.sections.length - 1];
    expect(last.endSec).toBeCloseTo(16, 1);

    // the target image is bound somewhere (hero), and no gap is left unresolved
    const recipeStr = JSON.stringify(out.finalProgram.renderRecipe);
    expect(recipeStr).toContain("asset_target_fan_hero");
    expect(out.gapReport.gaps.some((g) => g.status === "missing" && !g.selectedRepair)).toBe(false);

    // no-copy: no sample paths anywhere in the final recipe
    expect(/sample_assets|sample_video|sample\//i.test(recipeStr)).toBe(false);
    expect(out.finalProgram.validation.noCopyPassed).toBe(true);
  });

  it("all CREATE + safety gates pass (no fail)", async () => {
    const out = await runCreateV5({
      projectId: "proj_create",
      generationId: "gen_002",
      brief: { theme: "fan", targetDurationSec: 16, aspectRatio: "9:16" },
      targetAssets: [targetImage],
      selectedElements: elements
    });
    expect(out.gates.filter((g) => g.status === "fail")).toEqual([]);
    expect(out.gates.find((g) => g.id === "V5-G29")?.status).toBe("pass");
  });

  it("degrades gracefully with ZERO target assets (procedural fills, still valid + no missing-unresolved)", async () => {
    const out = await runCreateV5({
      projectId: "proj_create",
      generationId: "gen_003",
      brief: { theme: "fan", targetDurationSec: 12, aspectRatio: "9:16" },
      targetAssets: [],
      selectedElements: elements
    });
    expect(v5.validateFinalVideoProgram(out.finalProgram).errors).toEqual([]);
    expect(out.gates.filter((g) => g.status === "fail")).toEqual([]);
  });
});
