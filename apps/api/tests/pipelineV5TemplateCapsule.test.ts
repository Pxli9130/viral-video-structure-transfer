import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import {
  runGen1TemplateReconstruction,
  runGen1NeutralTemplate,
  toEvidenceTimelineV5,
  validateTemplateCapsule,
  runSameTemplateGeneration
} from "../src/pipeline-v5/index.js";
import { KnowledgeBaseV5 } from "../src/services/knowledgeBaseV5.js";

const asset: Asset = {
  id: "smp_t",
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
    durationSec: 8,
    hasAudio: true,
    shots: [
      { shotId: "s1", startSec: 0, endSec: 2, durationSec: 2, keyframeIds: [], visualTags: ["hero"], styleTags: [], motionEnergy: 0.7, confidence: 0.9 },
      { shotId: "s2", startSec: 2, endSec: 8, durationSec: 6, keyframeIds: [], visualTags: ["p"], styleTags: [], motionEnergy: 0.3, confidence: 0.8 }
    ],
    sceneCuts: [],
    beatGrid: { status: "ok", bpm: 120, beats: [0, 0.5, 1, 2, 4, 6], onsets: [0, 2, 4, 6] },
    evidenceFrames: [],
    stats: {} as never,
    ocrStatus: "skipped",
    asrStatus: "skipped",
    analyzerMode: "t",
    warnings: []
  };
  return toEvidenceTimelineV5(tl, asset);
}

describe("V5.1 RemotionTemplateCapsule (Gen1 reconstruction + validation + KB + same_template binding)", () => {
  let storageDir: string;

  beforeAll(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "vvst-cap-"));
  });
  afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

  it("Gen1 produces a props-driven capsule that validates (no sample paths, compiles, slots listed)", () => {
    const evidence = ev();
    const program = runGen1NeutralTemplate(evidence).program;
    const capsule = runGen1TemplateReconstruction(program, evidence);

    expect(capsule.codeBundle.files.length).toBeGreaterThan(0);
    expect(capsule.slotSchema.length).toBeGreaterThan(0);
    expect(capsule.timingSignature.sections.length).toBe(program.typedSpec.scenes.length);
    expect(capsule.safety.onlyTemplateCodeReusable).toBe(true);

    const code = capsule.codeBundle.files.map((f) => f.content).join("\n");
    // safety: code must be props-driven, no sample/asset paths
    expect(/\/sample|sample_assets|original_/i.test(code)).toBe(false);
    expect(code.includes("props") || code.includes("assets")).toBe(true);

    const val = validateTemplateCapsule(capsule);
    expect(val.passed).toBe(true);
    expect(val.gates.find((g) => g.id === "T2")?.status).toBe("pass"); // compiles
    expect(val.gates.find((g) => g.id === "T5")?.status).toBe("pass"); // no sample path
    expect(val.gates.find((g) => g.id === "T10")?.status).toBe("pass"); // safe for reuse
  });

  it("learn stores BOTH the capsule and atomic elements; capsule is retrievable", async () => {
    const { runLearnSampleV5 } = await import("../src/pipeline-v5/index.js");
    const kb = new KnowledgeBaseV5(storageDir);
    const learn = await runLearnSampleV5(ev(), kb);
    expect(learn.templateCapsule.id).toBeTruthy();
    expect(learn.templateValidation.passed).toBe(true);
    expect(kb.listTemplateCapsules().length).toBe(1);
    expect(kb.list().length).toBeGreaterThanOrEqual(5); // atomic elements too
    expect(kb.getTemplateCapsule(learn.templateCapsule.id)?.slotSchema.length).toBeGreaterThan(0);
    expect(kb.latestTemplateCapsule()?.id).toBe(learn.templateCapsule.id);
  });

  it("same_template binding fills text slots + designed-visual fallback (no render); honest gates", async () => {
    const evidence = ev();
    const program = runGen1NeutralTemplate(evidence).program;
    const capsule = runGen1TemplateReconstruction(program, evidence);
    const out = await runSameTemplateGeneration({
      projectId: "p",
      generationId: "g_plan",
      capsule,
      brief: { theme: "portable fan ad", targetDurationSec: 8, aspectRatio: "9:16", sellingPoints: ["small", "quiet"] },
      targetAssets: [],
      options: { ...v5.DEFAULT_GENERATION_OPTIONS_V5, aigcGapFill: { ...v5.DEFAULT_GENERATION_OPTIONS_V5.aigcGapFill, imageFill: "procedural" } },
      outDir: path.join(storageDir, "g_plan"),
      publicPathPrefix: "/x/",
      serveBase: "http://127.0.0.1:3000",
      doRender: false
    });
    expect(out.finalProgram.compositionProgramId).toBe(capsule.id);
    expect(out.instance.boundProps).toBeTruthy();
    // headline/cta copy bound from the new brief (not sample text)
    const copy = (out.instance.boundProps as { copy?: Record<string, string> }).copy ?? {};
    expect(Object.values(copy).join(" ")).toContain("portable fan ad");
    expect(out.gates.find((g) => g.id === "T1")?.status).toBe("pass");
    expect(out.gates.find((g) => g.id === "T10")?.status).toBe("pass");
    // default options are same_template + auto AIGC
    expect(v5.DEFAULT_GENERATION_OPTIONS_V5.generationMode).toBe("same_template");
    expect(v5.DEFAULT_GENERATION_OPTIONS_V5.aigcGapFill.mode).toBe("auto_on");
  });

  it("AIGC OFF + missing required slots -> readiness downgraded (no silent review_demo)", async () => {
    const evidence = ev();
    const program = runGen1NeutralTemplate(evidence).program;
    const capsule = runGen1TemplateReconstruction(program, evidence);
    const out = await runSameTemplateGeneration({
      projectId: "p",
      generationId: "g_off",
      capsule,
      brief: { theme: "fan", targetDurationSec: 8, aspectRatio: "9:16" },
      targetAssets: [],
      options: {
        ...v5.DEFAULT_GENERATION_OPTIONS_V5,
        aigcGapFill: { mode: "off", imageFill: "off", audioFill: "off", textFill: "llm" },
        fallbackPolicy: { allowTextCardFallback: false, allowProceduralVisualFallback: false, downgradeIfMissingRequiredSlots: true }
      },
      outDir: path.join(storageDir, "g_off"),
      publicPathPrefix: "/x/",
      serveBase: "http://127.0.0.1:3000",
      doRender: false
    });
    expect(out.instance.readinessImpact.missingRequiredSlotCount).toBeGreaterThan(0);
    expect(out.instance.readinessImpact.readinessLevel).toBe("technical_demo");
    expect(out.gates.find((g) => g.id === "T6")?.status).toBe("fail"); // not all required slots bound
  });
});
