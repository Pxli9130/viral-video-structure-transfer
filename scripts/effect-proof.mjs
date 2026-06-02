#!/usr/bin/env node
// PHASE 10 proof: produce a built-in creative-effect fixture case end-to-end.
//  - deterministic CreativeEffectSpec from card-orbit evidence -> card_orbit_motion_graph
//  - EffectRegistry selects CardOrbitStack
//  - attach to a real RenderRecipe (from generateMigrationResult)
//  - FFmpeg render (applies the motif fallback overlays) -> final.mp4
//  - write spec / recipe / selection / render-report; the coverage gate is run separately
// No faking: if FFmpeg render fails, the error is recorded in render-report.json and final.mp4 is omitted.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  attachCreativeEffectToRenderRecipe,
  buildDeterministicCreativeEffectSpecFromEvidence,
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  loadEffectKnowledgeBase,
  selectEffect
} from "@vvst/shared";

const ROOT = process.cwd();
const CASE_DIR = path.join(ROOT, "docs/artifacts/codegen-fixtures/built-in-proof");
mkdirSync(CASE_DIR, { recursive: true });

const request = {
  projectId: "proof",
  inputMode: "video_plus_prompt",
  selectedTemplateIds: ["proof_template"],
  sourceVideo: { assetId: "proof_source" },
  prompt: "把样例的卡点结构迁移成 15 秒竖屏产品广告。主题：AeroSpin 便携涡轮小风扇 卖点：三档强风、USB-C 快充 CTA：现在入手",
  target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "mp4_render" },
  controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct" },
  constraints: { noSampleVisualCopy: true }
};

const analysis = buildMockVideoAnalysis({ assetId: "proof_sample", projectId: "proof", purpose: "sample", durationSec: 15 });
const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "proof");
const generation = generateMigrationResult({ template, request });
const baseRecipe = generation.timeline?.renderPlan?.renderRecipe;
if (!baseRecipe) throw new Error("proof: no base render recipe produced");

const spec = buildDeterministicCreativeEffectSpecFromEvidence({
  caseId: "built-in-proof",
  techniqueKeywords: ["card_orbit", "stack_collapse", "scatter_burst"],
  palette: ["black", "red"],
  evidenceRefs: ["evidence://proof/shot/0"],
  createdAt: "2026-06-02T00:00:00.000Z"
});
const selection = selectEffect({ motifFamily: spec.motifFamily }, loadEffectKnowledgeBase());
const effectRecipe = attachCreativeEffectToRenderRecipe(baseRecipe, spec, selection, {});
generation.timeline.renderPlan.renderRecipe = effectRecipe;

writeFileSync(path.join(CASE_DIR, "creative-effect-spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
writeFileSync(path.join(CASE_DIR, "effect-selection.json"), `${JSON.stringify(selection, null, 2)}\n`);
writeFileSync(path.join(CASE_DIR, "render-recipe.json"), `${JSON.stringify(effectRecipe, null, 2)}\n`);

let renderReport = {
  rendererTarget: "ffmpeg",
  motifFamily: spec.motifFamily,
  effectProgramIds: selection.effectProgramIds,
  effectSelectionSource: selection.source
};

try {
  const { FFmpegRenderer } = await import(path.join(ROOT, "apps/api/dist/adapters/renderers.js"));
  const renderer = new FFmpegRenderer({ generatedDir: CASE_DIR, assetResolver: { resolve: () => undefined } });
  const out = await renderer.render(generation.timeline, generation.id);
  if (out.status === "completed" && out.outputPath && existsSync(out.outputPath)) {
    copyFileSync(out.outputPath, path.join(CASE_DIR, "final.mp4"));
    renderReport = {
      ...renderReport,
      status: "completed",
      effectProgramIds: out.effectProgramIds ?? selection.effectProgramIds,
      ffmpegEffectFallbackUsed: out.ffmpegEffectFallbackUsed ?? false,
      effectFallbackReason: out.effectFallbackReason,
      fallbackVisualLayersAdded: out.fallbackVisualLayersAdded ?? []
    };
    console.log(`[effect-proof] FFmpeg render OK -> final.mp4 (fallbackLayers=${JSON.stringify(renderReport.fallbackVisualLayersAdded)})`);
  } else {
    renderReport = { ...renderReport, status: "failed", error: out.error ?? "no output" };
    console.log(`[effect-proof] FFmpeg render did not complete: ${renderReport.error}`);
  }
} catch (error) {
  renderReport = { ...renderReport, status: "failed", error: String(error?.message ?? error) };
  console.log(`[effect-proof] FFmpeg render threw (recorded, not faked): ${renderReport.error}`);
}

writeFileSync(path.join(CASE_DIR, "render-report.json"), `${JSON.stringify(renderReport, null, 2)}\n`);
console.log(`[effect-proof] wrote fixture case -> ${CASE_DIR}`);
