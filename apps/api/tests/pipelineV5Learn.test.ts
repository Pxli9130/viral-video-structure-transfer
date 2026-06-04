import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { runLearnSampleV5, toEvidenceTimelineV5 } from "../src/pipeline-v5/index.js";
import { KnowledgeBaseV5 } from "../src/services/knowledgeBaseV5.js";

function syntheticTimeline(): VisualEvidenceTimeline {
  return {
    schemaVersion: "visual-evidence-timeline-v2",
    sourceAssetId: "asset_sample_x",
    durationSec: 16,
    hasAudio: true,
    shots: [
      { shotId: "shot_001", startSec: 0, endSec: 2, durationSec: 2, keyframeIds: ["kf1"], visualTags: ["hero", "center"], styleTags: ["bold"], motionEnergy: 0.7, confidence: 0.9, ocrText: ["DEAL"] },
      { shotId: "shot_002", startSec: 2, endSec: 10, durationSec: 8, keyframeIds: ["kf2"], visualTags: ["product"], styleTags: ["clean"], motionEnergy: 0.3, confidence: 0.8, asrText: ["small and quiet"] },
      { shotId: "shot_003", startSec: 10, endSec: 16, durationSec: 6, keyframeIds: ["kf3"], visualTags: ["cta"], styleTags: ["card"], motionEnergy: 0.4, confidence: 0.85 }
    ],
    sceneCuts: [{ atSec: 2 } as never, { atSec: 10 } as never],
    beatGrid: { status: "ok", bpm: 128, beats: [0, 0.47, 0.94, 1.4], onsets: [0, 2, 10] },
    evidenceFrames: [{ id: "frame_001", timeSec: 0.5, url: "/generated/evidence/x/f1.jpg" } as never],
    stats: {} as never,
    ocrStatus: "ok",
    asrStatus: "ok",
    analyzerMode: "test",
    warnings: []
  };
}

function syntheticAsset(): Asset {
  return {
    id: "asset_sample_x",
    projectId: "proj_test",
    role: "example_video",
    type: "video",
    filename: "sample_x.mov",
    sourcePolicy: "user_authorized",
    status: "ready",
    createdAt: new Date(0).toISOString(),
    metadata: { width: 720, height: 1280, fps: 30 }
  };
}

describe("pipeline-v5 LEARN (deterministic, no external APIs)", () => {
  let storageDir: string;

  beforeAll(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "vvst-kb-"));
  });
  afterAll(() => {
    rmSync(storageDir, { recursive: true, force: true });
  });

  it("wraps V4 evidence into a schema-valid EvidenceTimelineV5", () => {
    const ev = toEvidenceTimelineV5(syntheticTimeline(), syntheticAsset());
    const result = v5.validateEvidenceTimelineV5(ev);
    expect(result.errors).toEqual([]);
    expect(ev.video.width).toBe(720);
    expect(ev.audioEvidence?.bpm).toBe(128);
    expect(ev.recommendedVideoInputPolicy?.globalPass.useWholeVideo).toBe(true);
  });

  it("runs the full LEARN loop and produces schema-valid artifacts + passing learn gates", async () => {
    const kb = new KnowledgeBaseV5(storageDir);
    const ev = toEvidenceTimelineV5(syntheticTimeline(), syntheticAsset());
    const out = await runLearnSampleV5(ev, kb);

    expect(v5.validateNeutralReconstructionProgram(out.neutralProgram).errors).toEqual([]);
    expect(out.neutralProgram.fallbackUsed).toBe(true);
    expect(out.neutralProgram.safety.samplePixelsRemoved).toBe(true);
    expect(out.candidates.length).toBeGreaterThanOrEqual(5);
    expect(out.elements.length).toBeGreaterThanOrEqual(5);

    // every candidate is schema-valid
    for (const c of out.candidates) expect(v5.validateCandidateElement(c).errors).toEqual([]);
    // every stored element is schema-valid
    for (const e of out.elements) expect(v5.validateKnowledgeElement(e).errors).toEqual([]);
    // every decision is schema-valid
    for (const d of out.decisions) expect(v5.validateKbCurationDecision(d).errors).toEqual([]);

    const failed = out.gates.filter((g) => g.status === "fail");
    expect(failed).toEqual([]);
  });

  it("re-learning the same sample MERGES instead of duplicating (no KB explosion)", async () => {
    const kb = new KnowledgeBaseV5(storageDir);
    const ev = toEvidenceTimelineV5(syntheticTimeline(), syntheticAsset());
    const first = await runLearnSampleV5(ev, kb);
    const countAfterFirst = kb.list().length;
    expect(countAfterFirst).toBeGreaterThan(0);

    const second = await runLearnSampleV5(ev, kb);
    const countAfterSecond = kb.list().length;
    expect(countAfterSecond).toBe(countAfterFirst);
    expect(second.decisions.every((d) => d.action === "merge_existing")).toBe(true);
    void first;
  });

  it("KB list/search retrieves stored elements by kind and query", async () => {
    const kb = new KnowledgeBaseV5(storageDir);
    const ev = toEvidenceTimelineV5(syntheticTimeline(), syntheticAsset());
    await runLearnSampleV5(ev, kb);
    expect(kb.list({ kind: "hook_pattern" }).length).toBeGreaterThanOrEqual(1);
    expect(kb.search("hook").length).toBeGreaterThanOrEqual(1);
  });
});
