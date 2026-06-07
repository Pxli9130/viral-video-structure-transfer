import { describe, expect, it } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { runGen1Ai, toEvidenceTimelineV5, type Gen1ModelFn } from "../src/pipeline-v5/index.js";

const asset: Asset = {
  id: "asset_ai",
  projectId: "p",
  role: "example_video",
  type: "video",
  filename: "s.mov",
  sourcePolicy: "user_authorized",
  status: "ready",
  createdAt: new Date(0).toISOString(),
  metadata: { width: 1080, height: 1920, fps: 30 }
};

function ev(): v5.EvidenceTimelineV5 {
  const tl: VisualEvidenceTimeline = {
    schemaVersion: "visual-evidence-timeline-v2",
    durationSec: 12,
    hasAudio: true,
    shots: [
      { shotId: "shot_001", startSec: 0, endSec: 2, durationSec: 2, keyframeIds: [], visualTags: ["hero"], styleTags: [], motionEnergy: 0.7, confidence: 0.9 },
      { shotId: "shot_002", startSec: 2, endSec: 12, durationSec: 10, keyframeIds: [], visualTags: ["product"], styleTags: [], motionEnergy: 0.3, confidence: 0.8 }
    ],
    sceneCuts: [],
    beatGrid: { status: "ok", bpm: 120, beats: [0, 0.5], onsets: [0, 6] },
    evidenceFrames: [],
    stats: {} as never,
    ocrStatus: "skipped",
    asrStatus: "skipped",
    analyzerMode: "test",
    warnings: []
  };
  return toEvidenceTimelineV5(tl, asset);
}

const validPartial = {
  typedSpec: {
    composition: { width: 1080, height: 1920, fps: 30, durationSec: 12, aspectRatio: "9:16", background: "#0A0A0A" },
    scenes: [
      { id: "s_hook", role: "hook", startSec: 0, endSec: 2, intent: "grab", layers: [{ id: "l1", type: "media", placeholderId: "ph_hero" }], motionGrammar: ["impact_zoom"], packagingGrammar: ["title"], evidenceRefs: ["shot_001"] },
      { id: "s_benefit", role: "benefit", startSec: 2, endSec: 12, intent: "show", layers: [{ id: "l2", type: "text" }], motionGrammar: ["fade"], packagingGrammar: ["subs"], evidenceRefs: ["shot_002"] }
    ],
    globalStyle: { palette: ["#0A0A0A", "#FFFFFF", "#F7C948"], typographySystem: "bold", motionIntensity: "high", textDensity: "medium", pacing: "fast", coherenceNotes: ["one accent"] },
    audioCues: [{ t: 0, type: "impact", role: "hook_start" }]
  },
  placeholders: [
    { id: "ph_hero", kind: "hero_product", required: true, sectionId: "s_hook", startSec: 0, endSec: 2, evidenceRefs: ["shot_001"], replacementPolicy: "target_asset", safetyPolicy: "must_replace_sample", sourcePolicy: "sample_evidence_only" }
  ],
  timingMap: [{ id: "tm1", startSec: 0, endSec: 12, role: "hook", evidenceRefs: ["shot_001"] }],
  evidenceRefs: ["shot_001", "shot_002"]
};

describe("pipeline-v5 AI Gen1 (injected model fn, offline)", () => {
  it("uses the AI program when the model returns valid JSON", async () => {
    const model: Gen1ModelFn = async () => "```json\n" + JSON.stringify(validPartial) + "\n```";
    const out = await runGen1Ai(ev(), model);
    expect(out.usedAi).toBe(true);
    expect(out.validation.errors).toEqual([]);
    expect(out.program.fallbackUsed).toBe(false);
    expect(out.program.typedSpec.scenes[0].id).toBe("s_hook");
    // renderable envelope is still the deterministic one (no AI-emitted TSX)
    expect(out.program.remotionProject.files.length).toBeGreaterThan(0);
  });

  it("falls back to the deterministic template on garbage output", async () => {
    const model: Gen1ModelFn = async () => "sorry I can't do that";
    const out = await runGen1Ai(ev(), model);
    expect(out.usedAi).toBe(false);
    expect(out.program.fallbackUsed).toBe(true);
    expect(out.validation.errors).toEqual([]); // fallback is always valid
  });

  it("repairs once, then falls back when the model stays invalid", async () => {
    let calls = 0;
    const model: Gen1ModelFn = async () => {
      calls++;
      return JSON.stringify({ typedSpec: { composition: {}, scenes: [], globalStyle: {}, audioCues: [] } }); // missing required composition fields
    };
    const out = await runGen1Ai(ev(), model);
    expect(calls).toBe(2); // one attempt + one repair
    expect(out.usedAi).toBe(false);
    expect(out.program.fallbackUsed).toBe(true);
  });

  it("falls back when the model call throws", async () => {
    const model: Gen1ModelFn = async () => {
      throw new Error("network down");
    };
    const out = await runGen1Ai(ev(), model);
    expect(out.usedAi).toBe(false);
    expect(out.program.fallbackUsed).toBe(true);
    expect(out.warnings.some((w) => w.includes("network down"))).toBe(true);
  });
});
