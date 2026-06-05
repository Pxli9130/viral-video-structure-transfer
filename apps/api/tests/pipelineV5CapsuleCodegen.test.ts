import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import {
  runGen1TemplateReconstruction,
  runGen1NeutralTemplate,
  toEvidenceTimelineV5,
  runGen1CapsuleCodegen,
  buildCapsuleCodegenPrompt
} from "../src/pipeline-v5/index.js";
import { runLearnSampleV5 } from "../src/pipeline-v5/runLearnSampleV5.js";
import { KnowledgeBaseV5 } from "../src/services/knowledgeBaseV5.js";

const asset: Asset = {
  id: "smp_cg",
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

const goodTsx = (componentName: string) => `import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
const PALETTE = ["#0A0A0A", "#FFFFFF", "#F7C948"];
export const ${componentName} = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: palette[0] }}>
      <div style={{ color: palette[1], opacity: o }}>{copy.headline || ""}</div>
    </AbsoluteFill>
  );
};
export default ${componentName};
`;

function build() {
  const evidence = ev();
  const program = runGen1NeutralTemplate(evidence).program;
  const capsule = runGen1TemplateReconstruction(program, evidence);
  return { evidence, program, capsule };
}

describe("V5.1 Phase 1 — AI capsule codegen (triple-gate, apply!=promote)", () => {
  let storageDir: string;
  beforeAll(() => {
    storageDir = mkdtempSync(path.join(tmpdir(), "vvst-cg-"));
  });
  afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

  it("valid TSX + render gate ok -> promotes the AI bundle", async () => {
    const { evidence, program, capsule } = build();
    const name = capsule.codeBundle.componentName;
    const ai = goodTsx(name);
    const model = vi.fn(async () => JSON.stringify({ componentName: name, indexTsx: ai }));
    const probe = vi.fn(async () => ({ ok: true }));
    const out = await runGen1CapsuleCodegen({ capsule, program, evidence, model }, { renderProbe: probe });
    expect(out.usedAi).toBe(true);
    expect(out.codeBundle.files[0].content).toBe(ai);
    expect(out.validation.compilePassed && out.validation.renderPreviewPassed && out.validation.noCopyPassed).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("valid+safe TSX but render gate FAILS -> keeps deterministic bundle (apply!=promote)", async () => {
    const { evidence, program, capsule } = build();
    const name = capsule.codeBundle.componentName;
    const det = capsule.codeBundle.files[0].content;
    const model = vi.fn(async () => JSON.stringify({ componentName: name, indexTsx: goodTsx(name) }));
    const probe = vi.fn(async () => ({ ok: false, error: "bundle failed" }));
    const out = await runGen1CapsuleCodegen({ capsule, program, evidence, model }, { renderProbe: probe, maxAttempts: 1 });
    expect(out.usedAi).toBe(false);
    expect(out.codeBundle.files[0].content).toBe(det);
    expect(out.warnings.join(" ")).toMatch(/render gate/i);
  });

  it("unsafe TSX (fetch/sample path) -> static gate fails, render probe NEVER called", async () => {
    const { evidence, program, capsule } = build();
    const name = capsule.codeBundle.componentName;
    const unsafe = `import React from "react";\nexport const ${name} = (props) => { fetch("/samples/x.png"); return null; };`;
    const model = vi.fn(async () => JSON.stringify({ componentName: name, indexTsx: unsafe }));
    const probe = vi.fn(async () => ({ ok: true }));
    const out = await runGen1CapsuleCodegen({ capsule, program, evidence, model }, { renderProbe: probe, maxAttempts: 1 });
    expect(out.usedAi).toBe(false);
    expect(probe).not.toHaveBeenCalled(); // expensive render is short-circuited by the static gate
  });

  it("malformed JSON first, valid second -> repairs then promotes; repair prompt carries the error", async () => {
    const { evidence, program, capsule } = build();
    const name = capsule.codeBundle.componentName;
    const prompts: string[] = [];
    const model = vi.fn(async (p: string) => {
      prompts.push(p);
      return prompts.length === 1 ? "sorry, here is your component" : JSON.stringify({ componentName: name, indexTsx: goodTsx(name) });
    });
    const probe = vi.fn(async () => ({ ok: true }));
    const out = await runGen1CapsuleCodegen({ capsule, program, evidence, model }, { renderProbe: probe, maxAttempts: 2 });
    expect(out.usedAi).toBe(true);
    expect(model).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toMatch(/REJECTED/);
  });

  it("componentName drift is normalized back to the contract name", async () => {
    const { evidence, program, capsule } = build();
    const name = capsule.codeBundle.componentName;
    // model returns a different name in the JSON field, but the TSX exports the contract name.
    const model = vi.fn(async () => JSON.stringify({ componentName: "FancyThing", indexTsx: goodTsx(name) }));
    const probe = vi.fn(async () => ({ ok: true }));
    const out = await runGen1CapsuleCodegen({ capsule, program, evidence, model }, { renderProbe: probe });
    expect(out.usedAi).toBe(true);
    expect(out.codeBundle.componentName).toBe(name);
  });

  it("prompt feeds structure (slot propPaths, section roles, react-only) — drop-in contract", () => {
    const { evidence, program, capsule } = build();
    const prompt = buildCapsuleCodegenPrompt(capsule, program, evidence);
    expect(prompt).toContain(capsule.codeBundle.componentName);
    expect(prompt).toMatch(/only from "react"/i);
    for (const s of capsule.slotSchema.slice(0, 2)) if (s.propPath) expect(prompt).toContain(s.propPath);
  });

  it("learn wiring: no model -> deterministic capsule, no codegen attempted", async () => {
    const evidence = ev();
    const kb = new KnowledgeBaseV5(path.join(storageDir, "kb_null"));
    const det = runGen1TemplateReconstruction(runGen1NeutralTemplate(evidence).program, evidence).codeBundle.files[0].content;
    const out = await runLearnSampleV5(evidence, kb, { capsuleCodegenModel: null });
    expect(out.capsuleCodegen).toBeUndefined();
    expect(out.templateCapsule.codeBundle.files[0].content).toBe(det);
  });

  it("learn wiring: model returns junk -> static gate rejects, deterministic retained (offline-safe, no render)", async () => {
    const evidence = ev();
    const kb = new KnowledgeBaseV5(path.join(storageDir, "kb_junk"));
    const det = runGen1TemplateReconstruction(runGen1NeutralTemplate(evidence).program, evidence).codeBundle.files[0].content;
    const model = vi.fn(async () => "not json at all");
    const out = await runLearnSampleV5(evidence, kb, { capsuleCodegenModel: model });
    expect(out.capsuleCodegen?.usedAi).toBe(false);
    expect(out.templateCapsule.codeBundle.files[0].content).toBe(det);
  });
});
