#!/usr/bin/env node
// 3.md P7 render proof: build a recipe with creative effects enabled + prefer-generated so the
// planner selects the APPLIED generated effect, then FFmpeg-render it and write proof artifacts.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildFallbackTemplate, buildMockVideoAnalysis, generateMigrationResult } from "@vvst/shared";

const ROOT = process.cwd();
const CASE_DIR = path.join(ROOT, "docs/artifacts/codegen-proof/marketing-render");
mkdirSync(CASE_DIR, { recursive: true });

const request = {
  projectId: "proof_render",
  inputMode: "video_plus_prompt",
  selectedTemplateIds: ["proof_render_t"],
  sourceVideo: { assetId: "src" },
  prompt: "把样例迁移成 15 秒竖屏产品广告。主题：AeroSpin 小风扇 卖点：三档强风 CTA：现在入手",
  target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "mp4_render" },
  controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", enableCreativeEffects: true, preferGeneratedEffects: true },
  constraints: { noSampleVisualCopy: true }
};

const analysis = buildMockVideoAnalysis({ assetId: "s", projectId: "proof_render", purpose: "sample", durationSec: 15 });
const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "proof_render");
const generation = generateMigrationResult({ template, request });
const recipe = generation.timeline?.renderPlan?.renderRecipe;
if (!recipe) throw new Error("no recipe");

writeFileSync(path.join(CASE_DIR, "render-recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`);
writeFileSync(path.join(CASE_DIR, "effect-selection.json"), `${JSON.stringify(recipe.effectSelection ?? {}, null, 2)}\n`);
writeFileSync(path.join(CASE_DIR, "generation.json"), `${JSON.stringify(generation, null, 2)}\n`);
console.log(`[render-proof] motif=${recipe.motifFamily} effectProgramIds=${JSON.stringify(recipe.effectProgramIds)} source=${recipe.effectSelection?.source}`);

let renderReport = { rendererTarget: "ffmpeg", motifFamily: recipe.motifFamily, effectProgramIds: recipe.effectProgramIds ?? [], effectSelectionSource: recipe.effectSelection?.source };
try {
  const { FFmpegRenderer } = await import(path.join(ROOT, "apps/api/dist/adapters/renderers.js"));
  const renderer = new FFmpegRenderer({ generatedDir: CASE_DIR, assetResolver: { resolve: () => undefined } });
  const out = await renderer.render(generation.timeline, generation.id);
  if (out.status === "completed" && out.outputPath && existsSync(out.outputPath)) {
    copyFileSync(out.outputPath, path.join(CASE_DIR, "final.mp4"));
    renderReport = { ...renderReport, status: "completed", effectProgramIds: out.effectProgramIds ?? recipe.effectProgramIds ?? [], ffmpegEffectFallbackUsed: out.ffmpegEffectFallbackUsed ?? false, fallbackVisualLayersAdded: out.fallbackVisualLayersAdded ?? [] };
    console.log(`[render-proof] FFmpeg OK -> final.mp4 (effectIds=${JSON.stringify(renderReport.effectProgramIds)} fallback=${renderReport.ffmpegEffectFallbackUsed})`);
  } else {
    renderReport = { ...renderReport, status: "failed", error: out.error ?? "no output" };
  }
} catch (error) {
  renderReport = { ...renderReport, status: "failed", error: String(error?.message ?? error) };
  console.log(`[render-proof] FFmpeg threw (recorded): ${renderReport.error}`);
}
writeFileSync(path.join(CASE_DIR, "render-report.json"), `${JSON.stringify(renderReport, null, 2)}\n`);
console.log(`[render-proof] wrote -> ${CASE_DIR}`);
