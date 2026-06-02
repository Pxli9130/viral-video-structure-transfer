#!/usr/bin/env node
// 4.md proof: drive all four motif families through the SAME path —
//   evidence → CreativeEffectSpec → EffectRegistry → RenderRecipe.effectProgramIds → FFmpeg/Remotion
//   render → effect coverage gate. ≥1 case uses a generated effect (marketing). Not docs-only.
//
// Flags: --out <dir> --enable-creative-effects --prefer-generated-effects --strict-effect-coverage
//        --use-existing-artifacts --allow-fallback-fixtures

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  attachCreativeEffectToRenderRecipe,
  buildDeterministicCreativeEffectSpecFromEvidence,
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  generateRemotionEffectProposal,
  selectEffect,
  writeGeneratedEffectProposal
} from "@vvst/shared";
import { applyGeneratedEffect } from "./generate-effect-from-sample.mjs";
import { validateGeneratedEffect } from "./validate-generated-effect.mjs";
import { gateOneCase } from "./evaluate-effect-coverage.mjs";

const ROOT = process.cwd();
const arg = (f, d) => {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const OUT = path.resolve(ROOT, arg("--out", "docs/artifacts/codegen-proof/four-cases"));
const preferGenerated = process.argv.includes("--prefer-generated-effects");
const strict = process.argv.includes("--strict-effect-coverage");
const allowFallback = process.argv.includes("--allow-fallback-fixtures");
mkdirSync(OUT, { recursive: true });

// Each case supplies its motif's characteristic EVIDENCE (never filename logic) so the deterministic
// mapper yields the intended family.
const CASES = [
  { case: "marketing", evidence: { techniqueKeywords: ["ribbon_sweep", "poster_layout", "gallery_cta"], palette: ["white", "cream", "gold"] }, expect: "poster_ribbon_marketing" },
  { case: "motion_graph_1", evidence: { techniqueKeywords: ["card_orbit", "stack_collapse", "scatter_burst"], palette: ["black", "red"] }, expect: "card_orbit_motion_graph" },
  { case: "motion_graph_2", evidence: { techniqueKeywords: ["spotlight_sweep", "dashboard_panel", "search_bar"], visualForms: ["ui_panel"], palette: ["blue", "black"] }, expect: "blue_spotlight_ui_pitch" },
  { case: "editing", evidence: { ocrText: ["三档强风", "USB-C 快充"], techniqueKeywords: ["whip_pan", "glitch_cut"], videoType: "beat_cut", bpm: 150, palette: ["black", "red", "yellow", "white"] }, expect: "beat_cut_chinese_editing_tutorial" }
];

function ffmpeg(args) {
  return spawnSync("ffmpeg", args, { encoding: "utf8" }).status === 0;
}

// P3: ensure ≥1 generated effect exists (apply a local-fallback generated poster_ribbon effect).
function ensureGeneratedPosterEffect() {
  const spec = buildDeterministicCreativeEffectSpecFromEvidence({
    caseId: "marketing-poster-generated",
    techniqueKeywords: ["ribbon_sweep", "poster_layout", "gallery_cta"],
    palette: ["white", "cream"],
    createdAt: "2026-06-02T00:00:00.000Z"
  });
  return generateRemotionEffectProposal({ spec }, { env: {}, createdAt: "2026-06-02T00:00:00.000Z" }).then((res) => {
    const tmp = mkdtempSync(path.join(tmpdir(), "poster-gen-"));
    writeGeneratedEffectProposal(res.proposal, tmp);
    const v = validateGeneratedEffect(tmp, { previewAttempt: false });
    writeFileSync(path.join(tmp, "validation-report.json"), `${JSON.stringify(v, null, 2)}\n`);
    if (!v.safeToApply) return null;
    // This proof explicitly demonstrates a generated effect OVERRIDING the built-in, so it must be
    // promoted (force=false, promote=true). Default apply leaves a generated effect un-promoted and
    // the built-in keeps winning (see findValidatedGeneratedEffectByMotif / the promotion gate).
    return applyGeneratedEffect(ROOT, tmp, res.proposal, v, "marketing", false, true);
  });
}

async function main() {
  let appliedGenerated = null;
  if (preferGenerated && allowFallback) {
    appliedGenerated = await ensureGeneratedPosterEffect();
    if (appliedGenerated) console.log(`[four-cases] applied generated poster effect: ${appliedGenerated.effectId}`);
  }

  const { FFmpegRenderer } = await import(path.join(ROOT, "apps/api/dist/adapters/renderers.js"));
  const results = [];

  for (const c of CASES) {
    const caseDir = path.join(OUT, c.case);
    mkdirSync(caseDir, { recursive: true });
    const spec = buildDeterministicCreativeEffectSpecFromEvidence({ caseId: c.case, ...c.evidence, createdAt: "2026-06-02T00:00:00.000Z" });
    const selection = selectEffect({ motifFamily: spec.motifFamily, preferGenerated, strictEffectCoverage: strict });

    // Base recipe via the real planner, then attach the case's effect selection.
    const analysis = buildMockVideoAnalysis({ assetId: `s_${c.case}`, projectId: "four", purpose: "sample", durationSec: 15 });
    const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", "four");
    const request = {
      projectId: "four",
      inputMode: "video_plus_prompt",
      selectedTemplateIds: ["t"],
      sourceVideo: { assetId: "src" },
      prompt: "把样例迁移成 15 秒竖屏产品广告。主题：AeroSpin 小风扇 卖点：三档强风 CTA：现在入手",
      target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "mp4_render" },
      controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct" },
      constraints: { noSampleVisualCopy: true }
    };
    const generation = generateMigrationResult({ template, request });
    const baseRecipe = generation.timeline.renderPlan.renderRecipe;
    const effectRecipe = attachCreativeEffectToRenderRecipe(baseRecipe, spec, selection, {
      width: baseRecipe.global?.width,
      height: baseRecipe.global?.height,
      fps: baseRecipe.global?.fps,
      durationSec: baseRecipe.global?.durationSec
    });
    generation.timeline.renderPlan.renderRecipe = effectRecipe;

    writeFileSync(path.join(caseDir, "creative-effect-spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
    writeFileSync(path.join(caseDir, "effect-selection.json"), `${JSON.stringify(selection, null, 2)}\n`);
    writeFileSync(path.join(caseDir, "render-recipe.json"), `${JSON.stringify(effectRecipe, null, 2)}\n`);

    let renderReport = { rendererTarget: "ffmpeg", motifFamily: spec.motifFamily, effectProgramIds: effectRecipe.effectProgramIds ?? [], effectSelectionSource: selection.source };
    try {
      const renderer = new FFmpegRenderer({ generatedDir: caseDir, assetResolver: { resolve: () => undefined } });
      const out = await renderer.render(generation.timeline, generation.id);
      if (out.status === "completed" && out.outputPath && existsSync(out.outputPath)) {
        copyFileSync(out.outputPath, path.join(caseDir, "final.mp4"));
        renderReport = { ...renderReport, status: "completed", effectProgramIds: out.effectProgramIds ?? effectRecipe.effectProgramIds ?? [], ffmpegEffectFallbackUsed: out.ffmpegEffectFallbackUsed ?? false, fallbackVisualLayersAdded: out.fallbackVisualLayersAdded ?? [] };
        ffmpeg(["-y", "-i", path.join(caseDir, "final.mp4"), "-vf", "fps=1,scale=180:-1,tile=3x3", path.join(caseDir, "contact-sheet.png")]);
      } else {
        renderReport = { ...renderReport, status: "failed", error: out.error ?? "no output" };
        writeFileSync(path.join(caseDir, "render-blocker.json"), `${JSON.stringify({ blocker: renderReport.error }, null, 2)}\n`);
      }
    } catch (error) {
      renderReport = { ...renderReport, status: "failed", error: String(error?.message ?? error) };
      writeFileSync(path.join(caseDir, "render-blocker.json"), `${JSON.stringify({ blocker: renderReport.error }, null, 2)}\n`);
    }
    writeFileSync(path.join(caseDir, "render-report.json"), `${JSON.stringify(renderReport, null, 2)}\n`);

    const gate = gateOneCase(caseDir, strict);
    results.push({ case: c.case, motif: spec.motifFamily, expected: c.expect, source: selection.source, effectIds: effectRecipe.effectProgramIds, rendered: renderReport.status === "completed", fallbackLayers: renderReport.fallbackVisualLayersAdded ?? [], gatePass: gate.pass, failures: gate.failures });
    console.log(`[four-cases] ${c.case}: motif=${spec.motifFamily} source=${selection.source} effect=${JSON.stringify(effectRecipe.effectProgramIds)} rendered=${renderReport.status === "completed"} gate=${gate.pass ? "PASS" : "FAIL"}`);
  }

  const passed = results.filter((r) => r.gatePass).length;
  const summary = { strict, preferGenerated, appliedGeneratedEffectId: appliedGenerated?.effectId ?? null, total: results.length, passed, results };
  writeFileSync(path.join(OUT, "RUN_SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(
    path.join(OUT, "RUN_SUMMARY.md"),
    `# Four Motif Creative Effect Run\n\n- Strict: ${strict} · preferGenerated: ${preferGenerated}\n- Applied generated effect: ${appliedGenerated?.effectId ?? "(none)"}\n- Gate: ${passed}/${results.length} PASS\n\n| Case | Motif (expected) | Effect | Source | Rendered | FFmpeg fallback | Gate |\n|---|---|---|---|---|---|---|\n${results
      .map((r) => `| ${r.case} | ${r.motif} (${r.expected === r.motif ? "✓" : "✗ " + r.expected}) | ${JSON.stringify(r.effectIds)} | ${r.source} | ${r.rendered} | ${JSON.stringify(r.fallbackLayers)} | ${r.gatePass ? "PASS" : "FAIL " + r.failures.join(",")} |`)
      .join("\n")}\n`
  );
  console.log(`[four-cases] ${passed}/${results.length} cases PASS (strict=${strict}) -> ${OUT}`);
  if (passed !== results.length) process.exit(1);
}

main();
