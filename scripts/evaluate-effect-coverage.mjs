#!/usr/bin/env node
// Effect coverage gate. Verifies that a case's render actually carried a motif-selected creative
// effect through RenderRecipe and that it was rendered (Remotion) or had a recorded FFmpeg fallback.
//
// Usage:
//   node scripts/evaluate-effect-coverage.mjs --case-dir <dir> [--run-dir <dir>] [--strict]
//
// Core logic is exported as evaluateEffectCoverage() so it can be unit-tested with plain objects.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BUILT_IN_MOTIF_EFFECT, loadEffectKnowledgeBase } from "@vvst/shared";

const MOTIF_REQUIRED_EFFECT_PATTERN = {
  poster_ribbon_marketing: /ribbon|poster/i,
  card_orbit_motion_graph: /card|orbit|stack|scatter/i,
  blue_spotlight_ui_pitch: /ui|spotlight|blue/i,
  beat_cut_chinese_editing_tutorial: /beatcut|kinetic|chinese|beat_cut/i,
  split_screen_compare: /split|compare|side/i
};

/**
 * @param {{
 *   spec?: any, recipe?: any, selection?: any, renderReport?: any,
 *   hasFinalVideo?: boolean, hasContactSheet?: boolean, hasRenderPlan?: boolean,
 *   strict?: boolean, kb?: any
 * }} input
 */
export function evaluateEffectCoverage(input) {
  const { spec, recipe, selection, renderReport = {}, strict = false } = input;
  const kb = input.kb ?? loadEffectKnowledgeBase();
  const knownIds = new Set([
    ...kb.entries.map((e) => e.id),
    ...Object.values(BUILT_IN_MOTIF_EFFECT).filter(Boolean)
  ]);

  const motifFamily = recipe?.motifFamily ?? spec?.motifFamily ?? selection?.motifFamily;
  const effectProgramIds = recipe?.effectProgramIds ?? selection?.effectProgramIds ?? [];
  const effectNames = selection?.effectNames ?? effectProgramIds;
  const source = selection?.source ?? recipe?.effectSelection?.source;
  const renderedIds = renderReport?.effectProgramIds ?? [];
  const ffmpegFallback = Boolean(renderReport?.ffmpegEffectFallbackUsed);

  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

  add("spec_present", Boolean(spec) || Boolean(recipe?.creativeEffectSpecId), "creative-effect-spec.json or recipe.creativeEffectSpecId");
  add("motif_present", Boolean(motifFamily), `motifFamily=${motifFamily ?? "(none)"}`);
  add("effect_ids_present", Array.isArray(effectProgramIds) && effectProgramIds.length > 0, `effectProgramIds=${JSON.stringify(effectProgramIds)}`);
  const idsKnown = effectProgramIds.length > 0 && effectProgramIds.every((id) => knownIds.has(id));
  add("effect_ids_known", idsKnown, "every selected effect id exists in EffectRegistry/KB");
  const renderedOrFallback = effectProgramIds.length > 0 && (renderedIds.length > 0 || ffmpegFallback || source === "generated" || source === "built_in");
  add("rendered_or_fallback", renderedOrFallback, `renderedIds=${JSON.stringify(renderedIds)} ffmpegFallback=${ffmpegFallback} source=${source ?? "(none)"}`);

  if (strict) {
    add("not_generic_in_strict", motifFamily && motifFamily !== "generic_motion_graph" && source !== "legacy_fallback" && source !== "none",
      `strict: motif must be specific and not legacy_fallback (motif=${motifFamily}, source=${source})`);
  }

  // Motif-specific effect requirement.
  const pattern = motifFamily ? MOTIF_REQUIRED_EFFECT_PATTERN[motifFamily] : undefined;
  if (pattern) {
    const matches = [...effectProgramIds, ...effectNames].some((n) => typeof n === "string" && pattern.test(n));
    add(`motif_effect_match:${motifFamily}`, matches, `selected effect must match ${pattern} for motif ${motifFamily}`);
  } else if (motifFamily === "generic_motion_graph") {
    add("motif_effect_match:generic", !strict, "generic_motion_graph has no motif-specific effect (acceptable only in non-strict)");
  }

  add("artifact_present", Boolean(input.hasFinalVideo || input.hasContactSheet || input.hasRenderPlan), "final video / contact sheet / render plan exists");

  // 10. no sample path/filename in runtime props (sample safety).
  const SAMPLE_RE = /test_videos\/|learned_samples|sample[_-]?evidence|\/mnt\/data\/|\.mov\b/;
  const propsStr = JSON.stringify(recipe?.effectPropsById ?? {});
  add("no_sample_paths_in_props", !SAMPLE_RE.test(propsStr), "effectPropsById must not contain sample paths/filenames");

  // 11. a generated effect must carry a validation report (when the CLI could check it).
  if (source === "generated" && input.hasGeneratedValidationReport !== undefined) {
    add("generated_validation_report", Boolean(input.hasGeneratedValidationReport), "generated effect has validation-report.json");
  }

  const failures = checks.filter((c) => !c.ok).map((c) => c.id);
  const pass = failures.length === 0;
  return { pass, strict, motifFamily: motifFamily ?? null, effectProgramIds, source: source ?? null, checks, failures };
}

function readJsonIfExists(p) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
  } catch {
    return undefined;
  }
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Gate a single case dir: load artifacts, evaluate, write report.{json,md}, return the result. */
export function gateOneCase(caseDir, strict) {
  const spec = readJsonIfExists(path.join(caseDir, "creative-effect-spec.json"));
  const selection = readJsonIfExists(path.join(caseDir, "effect-selection.json"));
  let recipe = readJsonIfExists(path.join(caseDir, "render-recipe.json"));
  if (!recipe) recipe = readJsonIfExists(path.join(caseDir, "generation.json"))?.timeline?.renderPlan?.renderRecipe;
  const renderReport = readJsonIfExists(path.join(caseDir, "render-report.json")) ?? {};
  const hasFinalVideo = ["final.mp4", "final.remotion.mp4"].some((f) => existsSync(path.join(caseDir, f)));
  const hasContactSheet = ["render-contact-sheet.png", "contact-sheet.png", "render-contact-sheet.remotion.png"].some((f) => existsSync(path.join(caseDir, f)));
  const hasRenderPlan = existsSync(path.join(caseDir, "render-recipe.json")) || existsSync(path.join(caseDir, "render-blocker.json"));
  // generated effect: does its source dir carry a validation-report.json?
  let hasGeneratedValidationReport;
  const genId = (recipe?.effectProgramIds ?? [])[0];
  if ((selection?.source ?? recipe?.effectSelection?.source) === "generated" && genId) {
    hasGeneratedValidationReport = existsSync(path.join(process.cwd(), "apps/api/remotion/effects/generated", genId, "validation-report.json"));
  }
  const result = evaluateEffectCoverage({ spec, recipe, selection, renderReport, hasFinalVideo, hasContactSheet, hasRenderPlan, hasGeneratedValidationReport, strict });
  writeFileSync(path.join(caseDir, "effect-coverage-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const md = [
    `# Effect Coverage Report`,
    ``,
    `- Case dir: ${caseDir}`,
    `- Strict: ${strict}`,
    `- Motif: ${result.motifFamily ?? "(none)"}`,
    `- Effect program ids: ${JSON.stringify(result.effectProgramIds)}`,
    `- Source: ${result.source ?? "(none)"}`,
    `- **Result: ${result.pass ? "PASS" : "FAIL"}**`,
    ``,
    `| Check | OK | Detail |`,
    `|---|---|---|`,
    ...result.checks.map((c) => `| ${c.id} | ${c.ok ? "✅" : "❌"} | ${String(c.detail).replace(/\|/g, "\\|")} |`)
  ].join("\n");
  writeFileSync(path.join(caseDir, "effect-coverage-report.md"), `${md}\n`, "utf8");
  return result;
}

function main() {
  const caseDir = arg("--case-dir");
  const runDir = arg("--run-dir");
  const strict = process.argv.includes("--strict");

  if (runDir && !caseDir) {
    // Aggregate over each subdirectory of the run dir that has a render-recipe/generation.
    const cases = readdirSync(runDir)
      .map((name) => path.join(runDir, name))
      .filter((p) => statSync(p).isDirectory())
      .filter((p) => existsSync(path.join(p, "render-recipe.json")) || existsSync(path.join(p, "generation.json")));
    const results = cases.map((c) => ({ case: path.basename(c), ...gateOneCase(c, strict) }));
    const passed = results.filter((r) => r.pass).length;
    const summary = { runDir, strict, total: results.length, passed, failed: results.length - passed, cases: results.map((r) => ({ case: r.case, pass: r.pass, motif: r.motifFamily, source: r.source, failures: r.failures })) };
    writeFileSync(path.join(runDir, "effect-coverage-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    writeFileSync(
      path.join(runDir, "effect-coverage-summary.md"),
      `# Effect Coverage Summary\n\n- Strict: ${strict}\n- Passed: ${passed}/${results.length}\n\n| Case | Motif | Source | Result | Failures |\n|---|---|---|---|---|\n${results.map((r) => `| ${r.case} | ${r.motifFamily} | ${r.source} | ${r.pass ? "PASS" : "FAIL"} | ${r.failures.join(", ") || "—"} |`).join("\n")}\n`,
      "utf8"
    );
    console.log(`[effect-coverage] run-dir: ${passed}/${results.length} cases PASS (strict=${strict})`);
    for (const r of results) console.log(`  - ${r.case}: ${r.pass ? "PASS" : "FAIL"} motif=${r.motifFamily} ${r.failures.length ? "failures=[" + r.failures.join(",") + "]" : ""}`);
    if (passed !== results.length) process.exit(1);
    return;
  }

  if (!caseDir) {
    console.error("evaluate-effect-coverage: --case-dir <dir> or --run-dir <dir> required");
    process.exit(2);
  }
  const result = gateOneCase(caseDir, strict);
  console.log(`[effect-coverage] ${result.pass ? "PASS" : "FAIL"} (strict=${strict}) motif=${result.motifFamily} failures=[${result.failures.join(",")}]`);
  if (!result.pass) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("evaluate-effect-coverage.mjs");
if (isMain) main();
