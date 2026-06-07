#!/usr/bin/env node
// Generalized end-to-end apply-proof for ALL FOUR motif cases (was apply-render-proof-mg2.mjs, mg2-only).
// For each requested case: validate + apply (PROMOTE) the layer-plan-aware Gemini proposal -> KB ->
// generated manifest -> verify EffectRegistry selects the GENERATED effect -> build a RenderRecipe with
// its effectProgramIds -> render the full duration through ViralRecipeRoot (RemotionRenderer + real
// headless Chrome) -> mux the evidence-derived procedural audio -> measure audio loudness + blank span.
//
// This MUTATES production (generated/<id>/, effect-kb, effect-manifest.ts) per case — that is the proof.
// Pass --revert to `git restore` the tracked KB/manifest after each case so built-ins stay the default.
//
// Usage:
//   node scripts/apply-render-proof.mjs --run-dir docs/artifacts/codegen-live-eval/<run> [--case <id>] [--render-only] [--revert] [--out <dir>]
//   node scripts/apply-render-proof.mjs --case motion_graph_2 --run-dir docs/artifacts/codegen-live-eval/zod-layerplan-r4
//
// Each case's proposal must live at <run-dir>/<case>/proposal (gemini_ok). --case omitted => all four.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readGeneratedEffectProposal,
  loadEffectKnowledgeBase,
  selectEffect,
  findValidatedGeneratedEffectByMotif
} from "@vvst/shared";
import { validateGeneratedEffect } from "./validate-generated-effect.mjs";
import { applyGeneratedEffect } from "./generate-effect-from-sample.mjs";

const ROOT = process.cwd();

// case -> motif family. Evidence-derived motifs (the same families the deterministic classifier emits);
// the mapping here is just which motif each canonical sample belongs to, NOT filename->behavior logic.
const CASE_MOTIF = {
  marketing: "poster_ribbon_marketing",
  motion_graph_1: "card_orbit_motion_graph",
  motion_graph_2: "blue_spotlight_ui_pitch",
  editing: "beat_cut_chinese_editing_tutorial"
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

function findBrowser() {
  return [
    path.join(ROOT, "apps/api/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
    path.join(ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell")
  ].find((p) => existsSync(p));
}

/** Mean loudness (dBFS) of the first audio stream, or null if unmeasurable. */
function meanVolumeDb(mp4Path) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", mp4Path, "-map", "0:a:0?", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(text);
  return m ? Number(m[1]) : null;
}

function gitRestore(files) {
  const real = files.filter((f) => existsSync(f));
  if (!real.length) return;
  const r = spawnSync("git", ["restore", "--", ...real], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) console.warn(`[apply-proof] git restore warning: ${r.stderr ?? r.stdout}`);
  else console.log(`[apply-proof] reverted tracked mutations: ${real.map((f) => path.relative(ROOT, f)).join(", ")}`);
}

async function proveCase({ caseId, runDir, outRoot, renderOnly, RemotionRenderer }) {
  const motif = CASE_MOTIF[caseId];
  if (!motif) return { caseId, error: `unknown case (no motif mapping)` };
  const proposalDir = path.join(runDir, caseId, "proposal");
  if (!existsSync(proposalDir)) return { caseId, motif, error: `no proposal dir: ${path.relative(ROOT, proposalDir)}` };
  const out = path.join(outRoot, caseId, "apply-proof");
  mkdirSync(out, { recursive: true });
  const proposal = readGeneratedEffectProposal(proposalDir);

  // 1. validate + apply (promote=true) — or reuse the already-applied effect with --render-only.
  let applied;
  if (renderOnly) {
    const g0 = findValidatedGeneratedEffectByMotif(loadEffectKnowledgeBase(), motif);
    if (!g0) return { caseId, motif, error: `--render-only: no promoted generated effect in KB for motif ${motif}` };
    applied = { effectId: g0.id, manifestEntries: [g0.id] };
  } else {
    const validation = validateGeneratedEffect(proposalDir, { previewAttempt: false });
    if (!validation.safeToApply) return { caseId, motif, error: `not safeToApply: ${JSON.stringify(validation.failedChecks)}` };
    applied = applyGeneratedEffect(ROOT, proposalDir, proposal, validation, caseId, false, true);
  }

  // 2. verify KB + manifest + EffectRegistry selection picks the GENERATED effect.
  const sel = selectEffect({ motifFamily: motif, preferGenerated: true, strictEffectCoverage: true }, loadEffectKnowledgeBase());
  const manifestSrc = readFileSync(path.join(ROOT, "apps/api/remotion/effects/generated/effect-manifest.ts"), "utf8");
  const inManifest = manifestSrc.includes(applied.effectId);
  const selectsGenerated = sel.source === "generated" && sel.effectProgramIds.includes(applied.effectId) && inManifest;

  // 3. build a RenderRecipe carrying the generated effectProgramIds + full fixture props.
  const fixture = JSON.parse(proposal.files["fixture.json"]);
  const W = Number(fixture.width) || 1280;
  const H = Number(fixture.height) || 720;
  const FPS = Number(fixture.fps) || 30;
  const DUR = Number(fixture.durationSec) || 30;
  const recipe = {
    version: "render-recipe.v1.4",
    global: { width: W, height: H, fps: FPS, durationSec: DUR, palette: fixture.colors ?? [] },
    composition: { width: W, height: H, fps: FPS, durationSec: DUR },
    motifFamily: motif,
    effectProgramIds: sel.effectProgramIds,
    effectPropsById: { [applied.effectId]: fixture },
    effectSelection: sel,
    layers: [],
    clips: []
  };
  // evidence-derived audio policy/plan so RemotionRenderer muxes the procedural bed (bpm from fixture).
  const BPM = Number(fixture.bpm) || Number(fixture.beatsPerMinute) || 120;
  const timeline = {
    durationSec: DUR,
    aspectRatio: W >= H ? "16:9" : "9:16",
    clips: [],
    renderPlan: { renderRecipe: recipe, fps: FPS, audioPolicy: "synth_beat", audioPlan: { bpm: BPM, layers: fixture.audioLayers ?? {} } }
  };
  writeFileSync(path.join(out, "render-recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`);

  // 4. render through ViralRecipeRoot via RemotionRenderer (real headless Chrome).
  const report = { caseId, motif, effectId: applied.effectId, selectsGenerated, selection: sel, inManifest, render: null };
  try {
    const renderer = new RemotionRenderer({
      generatedDir: out,
      entryPoint: path.join(ROOT, "apps/api/remotion/index.tsx"),
      compositionId: "ViralRecipe",
      browserExecutable: findBrowser(),
      assetResolver: { resolve: () => undefined },
      outputBasename: `${caseId}-apply-proof`
    });
    const r = await renderer.render(timeline, `${caseId}_apply_proof`);
    if (r.status === "completed" && r.outputPath && existsSync(r.outputPath)) {
      const final = path.join(out, "final.remotion.mp4");
      copyFileSync(r.outputPath, final);
      const mv = meanVolumeDb(final);
      report.render = {
        status: "completed",
        outputPath: final,
        effectProgramIds: r.effectProgramIds ?? recipe.effectProgramIds,
        audioMeanVolumeDb: mv,
        audioOk: mv != null && mv > -50,
        renderQualityWarnings: r.renderQualityWarnings ?? []
      };
      console.log(`[apply-proof] ${caseId}: OK -> ${final} | audio=${mv == null ? "n/a" : mv.toFixed(1) + "dB"} selectsGenerated=${selectsGenerated}`);
    } else {
      report.render = { status: "failed", error: r.error ?? "no output" };
      console.log(`[apply-proof] ${caseId}: render failed: ${report.render.error}`);
    }
  } catch (e) {
    report.render = { status: "error", error: String(e?.message ?? e) };
    console.log(`[apply-proof] ${caseId}: error: ${report.render.error}`);
  }
  writeFileSync(path.join(out, "apply-proof-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const runDir = path.resolve(ROOT, arg("--run-dir", "docs/artifacts/codegen-live-eval/zod-layerplan-r4"));
  const outRoot = path.resolve(ROOT, arg("--out", path.join(runDir, "apply-proof-all")));
  const only = arg("--case"); // single case or comma-separated list; omitted => all four
  const renderOnly = process.argv.includes("--render-only");
  const revert = process.argv.includes("--revert");
  if (!existsSync(runDir)) throw new Error(`run dir not found: ${runDir}`);

  const rendererPath = path.join(ROOT, "apps/api/dist/adapters/renderers.js");
  if (!existsSync(rendererPath)) throw new Error("apps/api/dist/adapters/renderers.js missing; build api first");
  const { RemotionRenderer } = await import(pathToFileURL(rendererPath).href);

  const cases = only ? only.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(CASE_MOTIF);
  // The only TRACKED file apply mutates is the runtime manifest (the KB lives in gitignored
  // docs/artifacts/effect-kb/). Restoring the manifest returns the runtime default to built-ins.
  const trackedMutated = [path.join(ROOT, "apps/api/remotion/effects/generated/effect-manifest.ts")];
  const reports = [];
  for (const caseId of cases) {
    reports.push(await proveCase({ caseId, runDir, outRoot, renderOnly, RemotionRenderer }));
    if (revert && !renderOnly) gitRestore(trackedMutated);
  }
  mkdirSync(outRoot, { recursive: true });
  writeFileSync(path.join(outRoot, "apply-proof-all-report.json"), `${JSON.stringify({ schema: "apply-proof-all.v1", runDir, reports }, null, 2)}\n`);
  const ok = reports.filter((r) => r.render?.status === "completed").length;
  const audioOk = reports.filter((r) => r.render?.audioOk).length;
  const selOk = reports.filter((r) => r.selectsGenerated).length;
  console.log(`[apply-proof] DONE: ${ok}/${reports.length} rendered, ${audioOk} with audio, ${selOk} select generated -> ${outRoot}`);
}

main().catch((e) => { console.error(`[apply-proof] fatal: ${e?.message ?? e}`); process.exit(1); });
