// scripts/run-v5-golden.ts — spec_v5 golden-case end-to-end runner.
// Real sample video -> deterministic evidence (conda) -> LEARN (Gen1 template + extract + KB) ->
// CREATE (plan + gap + Gen2 compose) -> render final.mp4 -> no-copy scan -> ScorecardV5.
// Writes every artifact under --out. Run with tsx:
//   node node_modules/.bin/tsx scripts/run-v5-golden.ts --sample test_videos/marketing.mov --out artifacts/v5-golden
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Asset } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { analyzeEvidenceTimeline } from "../apps/api/src/adapters/evidenceTimeline.js";
import { KnowledgeBaseV5 } from "../apps/api/src/services/knowledgeBaseV5.js";
import {
  runLearnSampleV5,
  toEvidenceTimelineV5,
  runCreateV5,
  renderFinalVideoV5,
  runNoCopyScan,
  runScorecardV5,
  runGen1Ai,
  createGeminiModelFn
} from "../apps/api/src/pipeline-v5/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const sampleRel = arg("sample", "test_videos/marketing.mov")!;
  const samplePath = path.resolve(repoRoot, sampleRel);
  const outDir = path.resolve(repoRoot, arg("out", "artifacts/v5-golden")!);
  const targetImageRel = arg("target");
  const render = arg("render", "true") !== "false";
  await fs.mkdir(outDir, { recursive: true });
  const generatedDir = path.join(outDir, "generated");

  const sampleAsset: Asset = {
    id: "sample_golden",
    projectId: "proj_golden",
    role: "example_video",
    type: "video",
    filename: path.basename(samplePath),
    path: samplePath,
    sourcePolicy: "user_authorized",
    status: "ready",
    createdAt: new Date(0).toISOString()
  };

  console.log(`[golden] 1/6 evidence: ${samplePath}`);
  const v4Timeline = await analyzeEvidenceTimeline(sampleAsset, { generatedDir, runOcr: false, runAsr: false });
  if (!v4Timeline) throw new Error("evidence analyzer returned undefined (conda env / sample path missing)");
  const evidence = toEvidenceTimelineV5(v4Timeline, sampleAsset, {
    width: v4Timeline.shots.length ? undefined : 1080
  });
  console.log(`[golden]   shots=${evidence.shots.length} dur=${evidence.video.durationSec}s bpm=${evidence.audioEvidence?.bpm ?? "n/a"} evidenceV5Valid=${v5.validateEvidenceTimelineV5(evidence).valid}`);

  // Optional AI Gen1: model-driven reconstruction, validated, with deterministic fallback.
  let aiProgram: v5.NeutralReconstructionProgram | null = null;
  if (arg("ai", "false") === "true") {
    const modelFn = createGeminiModelFn();
    if (!modelFn) {
      console.log(`[golden]   --ai requested but GEMINI_API_KEY missing; using deterministic Gen1.`);
    } else {
      console.log(`[golden]   AI Gen1 (Gemini)…`);
      const g1 = await runGen1Ai(evidence, modelFn);
      aiProgram = g1.usedAi ? g1.program : null;
      console.log(`[golden]   AI Gen1 usedAi=${g1.usedAi} scenes=${g1.program.typedSpec.scenes.length} ${g1.warnings.slice(0, 1).join("") || ""}`);
    }
  }

  console.log(`[golden] 2/6 LEARN`);
  const kb = new KnowledgeBaseV5(outDir);
  const learn = await runLearnSampleV5(evidence, kb, { outDir: path.join(outDir, "learn"), aiProgram });
  console.log(`[golden]   candidates=${learn.candidates.length} elements=${learn.elements.length} learnGatesFail=${learn.gates.filter((g) => g.status === "fail").length}`);

  console.log(`[golden] 3/6 CREATE`);
  const targetAssets: Asset[] = [];
  if (targetImageRel) {
    targetAssets.push({
      id: "target_hero",
      projectId: "proj_golden",
      role: "user_image",
      type: "image",
      filename: path.basename(targetImageRel),
      path: path.resolve(repoRoot, targetImageRel),
      sourcePolicy: "user_authorized",
      status: "ready",
      tags: ["hero"],
      createdAt: new Date(0).toISOString()
    });
  }
  const create = await runCreateV5({
    projectId: "proj_golden",
    generationId: "gen_golden",
    brief: { theme: "golden demo ad", variant: "high_click", targetDurationSec: Math.min(16, Math.round(evidence.video.durationSec || 12)), aspectRatio: "9:16", sellingPoints: ["fast", "clean", "reliable"] },
    targetAssets,
    selectedElements: kb.list(),
    outDir: path.join(outDir, "create")
  });
  console.log(`[golden]   sections=${create.composition.sections.length} gaps=${create.gapReport.gaps.length} createGatesFail=${create.gates.filter((g) => g.status === "fail").length}`);

  // Only assess render gates when a render actually ran (skip -> warn, not fail).
  let renderInfo: { finalMp4Exists: boolean; durationSec?: number; hasAudio?: boolean; audioIntended?: boolean } | undefined;
  let noCopy: Awaited<ReturnType<typeof runNoCopyScan>> | undefined;
  let finalMp4Path: string | undefined;

  if (render) {
    console.log(`[golden] 4/6 RENDER`);
    const outPath = path.join(outDir, "final.mp4");
    const res = await renderFinalVideoV5({ finalProgram: create.finalProgram, outPath, proceduralAudio: true });
    finalMp4Path = res.finalMp4;
    renderInfo = { finalMp4Exists: Boolean(res.ok && res.finalMp4), durationSec: res.durationSec, hasAudio: res.hasAudio, audioIntended: true };
    console.log(`[golden]   render ok=${res.ok} final=${res.finalMp4 ?? "n/a"} hasAudio=${res.hasAudio} (muxed=${res.audioMuxed}) ${res.error ?? ""} ${res.warnings.join("; ")}`);

    if (finalMp4Path) {
      console.log(`[golden] 5/6 NO-COPY scan (final vs sample)`);
      noCopy = await runNoCopyScan({ finalVideoPath: finalMp4Path, sampleVideoPath: samplePath, outDir });
      console.log(`[golden]   noCopyPassed=${noCopy.noCopyPassed} minHamming=${noCopy.visualMinHamming ?? "n/a"} audioSim=${noCopy.audioMaxSimilarity ?? "n/a"}`);
    }
  }

  console.log(`[golden] 6/6 SCORECARD`);
  const scorecard = runScorecardV5({
    generationId: "gen_golden",
    stageGates: [learn.gates, create.gates],
    render: renderInfo,
    noCopy
  });
  await fs.writeFile(path.join(outDir, "scorecard.json"), JSON.stringify(scorecard, null, 2));

  const passed = scorecard.gates.filter((g) => g.status === "pass").length;
  const failed = scorecard.gates.filter((g) => g.status === "fail").length;
  const warned = scorecard.gates.filter((g) => g.status === "warn").length;
  console.log(`\n[golden] DONE -> ${outDir}`);
  console.log(`[golden] gates: ${passed} pass / ${warned} warn / ${failed} fail | demoReady=${scorecard.demoReady}`);
  console.log(`[golden] rubric: ${scorecard.rubricCoverage.map((r) => `${r.rubricItem}=${r.status}`).join(", ")}`);
  if (failed > 0) {
    console.log(`[golden] FAILED GATES: ${scorecard.warnings.join(" | ")}`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("[golden] ERROR:", e);
  process.exit(1);
});
