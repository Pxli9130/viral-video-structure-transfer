#!/usr/bin/env node
// Task 6 — motion_graph_2 end-to-end apply proof.
// Apply (PROMOTE) the layer-plan-aware Gemini proposal -> KB -> generated manifest -> verify
// EffectRegistry selects the GENERATED effect -> build a RenderRecipe with its effectProgramIds ->
// render the full ~39s through ViralRecipeRoot (RemotionRenderer + real headless Chrome).
// This MUTATES production (generated/<id>/, effect-kb/effects.json, effect-manifest.ts) — that is the proof.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
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
const RUN = "docs/artifacts/codegen-live-eval/zod-layerplan-r4";
const CASE = "motion_graph_2";
const MOTIF = "blue_spotlight_ui_pitch";

function findBrowser() {
  const c = [
    path.join(ROOT, "apps/api/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
    path.join(ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell")
  ];
  return c.find((p) => existsSync(p));
}

async function main() {
  const proposalDir = path.join(ROOT, RUN, CASE, "proposal");
  const out = path.join(ROOT, RUN, CASE, "apply-proof");
  mkdirSync(out, { recursive: true });

  // 1. validate + apply (promote=true) — or reuse the already-applied effect with --render-only.
  const renderOnly = process.argv.includes("--render-only");
  const proposal = readGeneratedEffectProposal(proposalDir);
  let applied;
  if (renderOnly) {
    const g0 = findValidatedGeneratedEffectByMotif(loadEffectKnowledgeBase(), MOTIF);
    if (!g0) throw new Error(`--render-only: no promoted generated effect in KB for motif ${MOTIF}`);
    applied = { effectId: g0.id, manifestEntries: [g0.id] };
    console.log(`[render-only] reusing applied effectId=${applied.effectId}`);
  } else {
    const validation = validateGeneratedEffect(proposalDir, { previewAttempt: false });
    if (!validation.safeToApply) throw new Error(`not safeToApply: ${JSON.stringify(validation.failedChecks)}`);
    applied = applyGeneratedEffect(ROOT, proposalDir, proposal, validation, CASE, false, true);
    console.log(`[apply] effectId=${applied.effectId} promoted=true manifest=[${applied.manifestEntries.join(",")}]`);
  }

  // 2. verify KB + manifest + EffectRegistry selection
  const kb = loadEffectKnowledgeBase();
  const gen = findValidatedGeneratedEffectByMotif(kb, MOTIF);
  const sel = selectEffect({ motifFamily: MOTIF, preferGenerated: true, strictEffectCoverage: true }, kb);
  const manifestSrc = readFileSync(path.join(ROOT, "apps/api/remotion/effects/generated/effect-manifest.ts"), "utf8");
  const inManifest = manifestSrc.includes(applied.effectId);
  console.log(`[select] kbPromotedGenerated=${gen?.id ?? "(none)"} source=${sel.source} ids=${JSON.stringify(sel.effectProgramIds)} inManifest=${inManifest}`);
  const selectsGenerated = sel.source === "generated" && sel.effectProgramIds.includes(applied.effectId) && inManifest;

  // 3. build a RenderRecipe carrying the generated effectProgramIds + full fixture props
  const fixture = JSON.parse(proposal.files["fixture.json"]);
  const W = Number(fixture.width) || 1280;
  const H = Number(fixture.height) || 720;
  const FPS = Number(fixture.fps) || 30;
  const DUR = Number(fixture.durationSec) || 39;
  const recipe = {
    version: "render-recipe.v1.4",
    global: { width: W, height: H, fps: FPS, durationSec: DUR, palette: fixture.colors ?? [] },
    composition: { width: W, height: H, fps: FPS, durationSec: DUR },
    motifFamily: MOTIF,
    effectProgramIds: sel.effectProgramIds,
    effectPropsById: { [applied.effectId]: fixture },
    effectSelection: sel,
    layers: [],
    clips: []
  };
  // Carry an evidence-derived audio policy/plan so RemotionRenderer muxes the procedural bed (the
  // composition itself has no <Audio>). bpm comes from the fixture, not a hardcoded sample constant.
  const BPM = Number(fixture.bpm) || Number(fixture.beatsPerMinute) || 120;
  const audioPlan = { bpm: BPM, layers: fixture.audioLayers ?? {} };
  const timeline = {
    durationSec: DUR,
    aspectRatio: W >= H ? "16:9" : "9:16",
    clips: [],
    renderPlan: { renderRecipe: recipe, fps: FPS, audioPolicy: "synth_beat", audioPlan }
  };
  writeFileSync(path.join(out, "render-recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`);

  // 4. render through ViralRecipeRoot via RemotionRenderer (real headless Chrome)
  const report = { effectId: applied.effectId, selectsGenerated, selection: sel, inManifest, render: null };
  try {
    const rendererPath = path.join(ROOT, "apps/api/dist/adapters/renderers.js");
    if (!existsSync(rendererPath)) throw new Error("apps/api/dist/adapters/renderers.js missing; build api first");
    const { RemotionRenderer } = await import(pathToFileURL(rendererPath).href);
    const renderer = new RemotionRenderer({
      generatedDir: out,
      entryPoint: path.join(ROOT, "apps/api/remotion/index.tsx"),
      compositionId: "ViralRecipe",
      browserExecutable: findBrowser(),
      assetResolver: { resolve: () => undefined },
      outputBasename: "mg2-apply-proof"
    });
    const r = await renderer.render(timeline, "mg2_apply_proof");
    if (r.status === "completed" && r.outputPath && existsSync(r.outputPath)) {
      const final = path.join(out, "final.remotion.mp4");
      copyFileSync(r.outputPath, final);
      report.render = { status: "completed", outputPath: final, effectProgramIds: r.effectProgramIds ?? recipe.effectProgramIds };
      console.log(`[render] OK -> ${final}`);
    } else {
      report.render = { status: "failed", error: r.error ?? "no output" };
      console.log(`[render] failed: ${report.render.error}`);
    }
  } catch (e) {
    report.render = { status: "error", error: String(e?.message ?? e) };
    console.log(`[render] error: ${report.render.error}`);
  }
  writeFileSync(path.join(out, "apply-proof-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[apply-proof] selectsGenerated=${selectsGenerated} render=${report.render.status} -> ${out}`);
}

main().catch((e) => { console.error(`[apply-proof] fatal: ${e?.message ?? e}`); process.exit(1); });
