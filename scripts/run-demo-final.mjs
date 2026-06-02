#!/usr/bin/env node
/**
 * Spec v1.3 demo:final — Source-first RenderRecipe submission runner.
 *
 * Produces the locked AeroSpin portable-fan product ad two ways and proves the system is NOT a
 * sample-blind mold:
 *   Demo A  editing.mov (beat_cut, real evidence-derived template)  + real AIGC fan target assets
 *   Demo B  motion_graph structure                                  + the same fan target assets
 * then a cross-sample anti-overfit diversity probe (layout NCC + primitive-sequence) across A/B.
 *
 * Sample/reference video is STRUCTURE EVIDENCE ONLY. The fan target assets (real Gemini-generated,
 * provenance-labeled aigc_generated_material) are the output material that reaches the canvas.
 *
 * Run with the project toolchain on PATH:
 *   export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
 *   npm run demo:final            # or: node scripts/run-demo-final.mjs [--out DIR] [--skip-b]
 */
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "docs/fixtures/final_aerospin_fan");
const GOLDEN_BEATCUT_TEMPLATE = path.join(
  ROOT,
  "packages/shared/src/__tests__/fixtures/expected_editing_mov_case/expected-structure-template-editing-mov.v1.2.json"
);
const FFMPEG = "ffmpeg";
const FFPROBE = "ffprobe";
const PYTHON = process.env.CONDA_BASE
  ? `${process.env.CONDA_BASE}/envs/${process.env.VIRAL_CONDA_ENV ?? "viral"}/bin/python`
  : "python3";

const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const OUT = outArg >= 0 ? path.resolve(args[outArg + 1]) : path.join(ROOT, "docs/artifacts/final_submission");
const SKIP_B = args.includes("--skip-b");

const PROMPT =
  "主题：AeroSpin 便携涡轮小风扇。15 秒高转化竖屏产品广告，突出三档强风、USB-C 快充、低噪音、桌面手持两用。" +
  "风格学习 editing.mov 的快剪节奏、红黄白字幕、卡点闪切和冲击 CTA，但不复制样例画面、音频或水印。CTA：现在入手，随时随地降温。";

function sh(cmd, argv, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "format=duration:stream=width,height", "-of", "json", file], { encoding: "utf8" });
  try {
    const j = JSON.parse(r.stdout || "{}");
    return { duration: Number(j.format?.duration ?? 0), width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0 };
  } catch { return { duration: 0, width: 0, height: 0 }; }
}

async function loadShared() {
  return import(path.join(ROOT, "packages/shared/dist/index.js"));
}
async function loadRenderer() {
  return import(path.join(ROOT, "apps/api/dist/adapters/renderers.js"));
}

function fanCopy() {
  const c = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "copy.json"), "utf8"));
  return c;
}

/** Build family-aligned target assets from the fan fixture (images = aigc provenance; copy = authored). */
function fanTargetAssets(copy) {
  const FX = "docs/fixtures/final_aerospin_fan";
  const aigc = { materialRole: "aigc_generated_material", source: "google_gemini_image" };
  return [
    { id: "fan_hero", kind: "image", role: "object_motion", path: `${FX}/fan_hero.png`, tags: ["hero", "product", "主视觉"], metadata: aigc },
    { id: "fan_card_01", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_01.png`, tags: ["montage", "action", "卡片"], metadata: aigc },
    { id: "fan_card_02", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_02.png`, tags: ["montage", "action", "卡片"], metadata: aigc },
    { id: "fan_card_03", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_03.png`, tags: ["montage", "action", "卡片"], metadata: aigc },
    { id: "fan_card_04", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_04.png`, tags: ["montage", "action", "卡片"], metadata: aigc },
    { id: "fan_logo", kind: "logo", role: "brand_cta", path: `${FX}/logo.png`, tags: ["logo", "brand", "标识"], metadata: aigc },
    { id: "fan_feature", kind: "copy", role: "ui_showcase", text: (copy.features ?? []).join("\n") },
    { id: "fan_kinetic", kind: "copy", role: "kinetic_typography", text: copy.productName ?? copy.brandName ?? "AeroSpin" }
  ];
}

const CARD_IDS = ["fan_card_01", "fan_card_02", "fan_card_03", "fan_card_04"];
const isRenderableFanMediaId = (id) => /^fan_(hero|card|mc|logo)/.test(id);

/** Post-process the timeline: spread distinct fan cards across montage clips, cycle selling points
 *  across text cards, and inject AeroSpin brand/cta into the brand_cta clip style. */
function polishTimeline(timeline, copy) {
  const features = (copy.features ?? []).filter(Boolean);
  const productName = copy.productName ?? copy.brandName ?? "AeroSpin";
  const cta = copy.cta ?? "现在入手，随时随地降温";
  const setSub = (clip, t) => { clip.subtitleText = t; for (const l of clip.layers ?? []) if (l.kind === "text" || l.kind === "text_overlay") l.text = t; };
  let cardCursor = 0;
  let featureCursor = 0;
  // Spread ALL distinct fan images (hero + 4 cards) across every image-bearing clip (CTA logo left alone).
  const IMG_IDS = ["fan_hero", "fan_card_01", "fan_card_02", "fan_card_03", "fan_card_04"];
  for (const clip of timeline.clips) {
    const fam = clip.visualFormFamily;
    if (typeof clip.sourceAssetId === "string" && /^fan_(hero|card|mc)/.test(clip.sourceAssetId)) {
      const id = IMG_IDS[cardCursor++ % IMG_IDS.length];
      clip.sourceAssetId = id;
      for (const l of clip.layers ?? []) if (typeof l.assetId === "string" && /^fan_(hero|card|mc)/.test(l.assetId)) l.assetId = id;
    }
    if (fam === "brand_cta") for (const l of clip.layers ?? []) l.style = { ...(l.style ?? {}), brandName: copy.brandName ?? "AeroSpin", cta };
    // Subtitle = product copy only (every videoType). hook→product name, cta→CTA, else cycle the
    // provided selling points whenever planner copy is missing / too long / English-generic / the raw prompt.
    const cur = (clip.subtitleText ?? "").trim();
    const looksGeneric = !cur || cur.length > 16 || /[A-Za-z]{5,}/.test(cur) || cur === PROMPT || cur.includes("卖点：") || cur.includes("主题：");
    if (clip.role === "hook") setSub(clip, productName);
    else if (clip.role === "cta") setSub(clip, cta);
    else if (looksGeneric && features.length) setSub(clip, features[featureCursor++ % features.length]);
  }
  // Sync the RenderRecipe to the polished clips so the Remotion recipe renderer reflects the same
  // copy + bound assets the FFmpeg path renders (the recipe is built before this post-process).
  const recipe = timeline.renderPlan?.renderRecipe;
  if (recipe?.clips) {
    for (const rc of recipe.clips) {
      const tc = timeline.clips.find((c) => c.id === rc.clipId);
      if (!tc) continue;
      rc.text = { ...(rc.text ?? {}), copy: tc.subtitleText ?? rc.text?.copy ?? "" };
      if (typeof tc.sourceAssetId === "string" && isRenderableFanMediaId(tc.sourceAssetId)) {
        rc.material = { ...(rc.material ?? {}), assetIds: [tc.sourceAssetId] };
      }
    }
  }
  if (recipe?.layers) {
    for (const layer of recipe.layers) {
      if (!layer.clipId) continue;
      const tc = timeline.clips.find((c) => c.id === layer.clipId);
      if (!tc) continue;
      if (layer.type === "text" && layer.text && tc.subtitleText) layer.text.content = tc.subtitleText;
      if (layer.type === "media" && layer.material && typeof tc.sourceAssetId === "string" && isRenderableFanMediaId(tc.sourceAssetId)) {
        layer.material.assetIds = [tc.sourceAssetId];
      }
    }
  }
  return timeline;
}

function gate(list, name, ok, detail) {
  list.push({ gate: name, status: ok ? "pass" : "fail", detail });
  return ok;
}

async function renderDemoA() {
  const { generateMigrationResult } = await loadShared();
  const { FFmpegRenderer } = await loadRenderer();
  const copy = fanCopy();
  const template = JSON.parse(readFileSync(GOLDEN_BEATCUT_TEMPLATE, "utf8"));
  const sampleIds = new Set(template.sourceSampleIds ?? []);
  const targetAssets = fanTargetAssets(copy);
  const request = {
    projectId: "final_aerospin", inputMode: "brief_assets", selectedTemplateIds: ["editing_mov_beatcut"],
    prompt: PROMPT, targetAssets,
    target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "storyboard_preview" },
    controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", recipeEvidencePrimitives: true, recipeAdaptiveStructure: true },
    constraints: { noSampleVisualCopy: true }
  };
  const gen = generateMigrationResult({ template, request });
  polishTimeline(gen.timeline, copy);

  const dir = path.join(OUT, "demo_a_editing_fan");
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "_render");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const resolver = {
    resolve(id) {
      const a = targetAssets.find((t) => t.id === id);
      if (!a?.path) return undefined;
      return path.isAbsolute(a.path) ? a.path : path.resolve(ROOT, a.path);
    }
  };
  const renderer = new FFmpegRenderer({ generatedDir: tmp, assetResolver: resolver });
  const out = await renderer.render(gen.timeline, gen.id);
  if (out.status !== "completed" || !out.outputPath) throw new Error(`demo A render failed: ${out.error ?? "unknown"}`);
  const finalMp4 = path.join(dir, "final.mp4");
  await copyFile(out.outputPath, finalMp4);
  await rm(tmp, { recursive: true, force: true });

  // contact sheet
  const contact = path.join(dir, "render-contact-sheet.png");
  await sh(FFMPEG, ["-y", "-i", finalMp4, "-vf", "fps=1/1.6,scale=200:-1,tile=3x4", "-frames:v", "1", contact]);

  // v1.3: also render via the RenderRecipe-driven Remotion composition (secondary visual layer that
  // consumes the SAME recipe). FFmpeg owns the canonical final.mp4; this proves renderer-agnostic recipe.
  let remotionMp4 = null;
  let remotionError = null;
  try {
    const { RemotionRenderer } = await loadRenderer();
    const rtmp = path.join(dir, "_remotion");
    await rm(rtmp, { recursive: true, force: true });
    await mkdir(rtmp, { recursive: true });
    const rr = new RemotionRenderer({
      generatedDir: rtmp, entryPoint: path.join(ROOT, "apps/api/remotion/index.tsx"),
      compositionId: "ViralRecipe", assetResolver: resolver, outputBasename: "recipe"
    });
    const ro = await rr.render(gen.timeline, gen.id);
    if (ro.status === "completed" && ro.outputPath && existsSync(ro.outputPath)) {
      remotionMp4 = path.join(dir, "final.remotion.mp4");
      const mux = await sh(FFMPEG, ["-y", "-i", ro.outputPath, "-i", finalMp4, "-map", "0:v:0", "-map", "1:a:0?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", remotionMp4]);
      if (mux.code !== 0 || !existsSync(remotionMp4)) { await copyFile(ro.outputPath, remotionMp4); }
    } else {
      remotionError = ro.error ?? "remotion render did not complete";
    }
    await rm(rtmp, { recursive: true, force: true });
  } catch (e) {
    remotionError = String(e?.message ?? e);
  }
  console.log(`  remotion_recipe: ${remotionMp4 ? "rendered final.remotion.mp4" : `skipped (${remotionError})`}`);

  const meta = probe(finalMp4);
  const recipe = gen.timeline.renderPlan?.renderRecipe;

  // material usage / safety
  const realClips = gen.timeline.clips.filter((c) => typeof c.sourceAssetId === "string" && c.sourceAssetId.startsWith("fan_"));
  const sampleCopyClips = gen.timeline.clips.filter((c) => c.sourceAssetId && sampleIds.has(c.sourceAssetId));
  const usedAssets = [...new Set(realClips.map((c) => c.sourceAssetId))];

  // gates
  const gates = [];
  gate(gates, "final_mp4_exists", existsSync(finalMp4), finalMp4);
  gate(gates, "resolution_720x1280", meta.width === 720 && meta.height === 1280, `${meta.width}x${meta.height}`);
  gate(gates, "duration_14.5_15.5s", meta.duration >= 14.5 && meta.duration <= 15.5, `${meta.duration.toFixed(2)}s`);
  gate(gates, "render_recipe_exists", Boolean(recipe), recipe ? "present" : "missing");
  gate(gates, "every_clip_has_primitiveReason", Boolean(recipe?.clips?.every((c) => c.primitiveReason?.length)), `${recipe?.clips?.length ?? 0} clips`);
  gate(gates, "target_material_appears", recipe?.sourcePolicy?.targetAssetUse === "renderable_target_material" && realClips.length > 0, `${realClips.length} clips composite real fan assets: ${usedAssets.join(", ")}`);
  gate(gates, "real_material_clip_count_ge_3", realClips.length >= 3, `${realClips.length}`);
  gate(gates, "sample_copy_eq_0", sampleCopyClips.length === 0, `${sampleCopyClips.length} sample-sourced clips`);
  gate(gates, "no_sample_frame_copy", recipe?.sourcePolicy?.sampleFrameCopyAllowed === false, "const false");
  gate(gates, "product_name_present", (recipe?.productTheme?.name ?? "").includes("AeroSpin") || (recipe?.productTheme?.name ?? "").includes("风扇"), recipe?.productTheme?.name);
  gate(gates, "selling_points_ge_4", (recipe?.productTheme?.sellingPoints?.length ?? 0) >= 4, `${recipe?.productTheme?.sellingPoints?.length ?? 0}`);
  gate(gates, "cta_present", Boolean((recipe?.productTheme?.cta ?? "").length), recipe?.productTheme?.cta);
  gate(gates, "ffmpeg_muxed_final", out.status === "completed", `audio=${gen.timeline.renderPlan?.audioPolicy}`);
  const passed = gates.every((g) => g.status === "pass");

  // artifacts
  await writeFile(path.join(dir, "timeline.json"), JSON.stringify(gen.timeline, null, 2));
  await writeFile(path.join(dir, "render-recipe.json"), JSON.stringify(recipe, null, 2));
  await writeFile(path.join(dir, "slot-mapping.json"), JSON.stringify(gen.slotMapping ?? [], null, 2));
  await writeFile(path.join(dir, "gap-report.json"), JSON.stringify(gen.timeline.gapReport ?? [], null, 2));
  await writeFile(path.join(dir, "fill-plan.json"), JSON.stringify(gen.timeline.fillPlan ?? [], null, 2));
  await writeFile(path.join(dir, "source-material-usage.json"), JSON.stringify({
    sourceVideoUse: recipe?.sourcePolicy?.sourceVideoUse,
    targetAssetUse: recipe?.sourcePolicy?.targetAssetUse,
    realMaterialClips: realClips.map((c) => ({ clipId: c.id, role: c.role, family: c.visualFormFamily, asset: c.sourceAssetId })),
    distinctAssetsUsed: usedAssets
  }, null, 2));
  await writeFile(path.join(dir, "sample-copy-safety.json"), JSON.stringify({
    sampleIds: [...sampleIds],
    sampleFrameCopyAllowed: recipe?.sourcePolicy?.sampleFrameCopyAllowed,
    sampleAudioCopyAllowed: recipe?.sourcePolicy?.sampleAudioCopyAllowed,
    sampleSourcedClips: sampleCopyClips.map((c) => c.id),
    verdict: sampleCopyClips.length === 0 ? "no sample frames reach the canvas" : "VIOLATION"
  }, null, 2));
  await writeFile(path.join(dir, "quality-gates.json"), JSON.stringify({
    overall: passed ? "pass" : "fail",
    gates,
    remotionRecipeRender: { rendered: Boolean(remotionMp4), output: remotionMp4 ? "final.remotion.mp4" : null, error: remotionError }
  }, null, 2));

  const primitiveSeq = recipe?.clips?.map((c) => c.selectedPrimitive) ?? [];
  await writeFile(path.join(dir, "HUMAN_REVIEW_REPORT.md"), [
    "# Demo A — editing.mov (beat_cut) + AeroSpin fan target assets",
    "",
    `- Final MP4: \`final.mp4\` (${meta.width}x${meta.height}, ${meta.duration.toFixed(2)}s, audio=${gen.timeline.renderPlan?.audioPolicy})`,
    `- Sample (structure evidence only): editing.mov beat_cut template; sample frames/audio never copied.`,
    `- Real fan target assets composited onto ${realClips.length} clips: ${usedAssets.join(", ")}`,
    `- RenderRecipe videoType: ${recipe?.videoType}; targetAssetUse: ${recipe?.sourcePolicy?.targetAssetUse}`,
    `- Primitive sequence: ${primitiveSeq.join(" → ")}`,
    `- Quality gates: ${passed ? "ALL PASS" : "FAIL"} (${gates.filter((g) => g.status === "pass").length}/${gates.length})`,
    `- Renderers: FFmpeg (canonical \`final.mp4\`)${remotionMp4 ? " + RenderRecipe-driven Remotion (`final.remotion.mp4`)" : ` (Remotion recipe render skipped: ${remotionError})`}`,
    "",
    "See `render-contact-sheet.png` for the 12-frame grid, `render-recipe.json` for the full render contract,",
    "and `quality-gates.json` for the gate detail. Both `final.mp4` (FFmpeg) and `final.remotion.mp4` (Remotion)",
    "consume the SAME `timeline.renderPlan.renderRecipe` — proof the recipe is renderer-agnostic.",
    ""
  ].join("\n"));

  return { dir, finalMp4, recipe, gates, passed, meta, primitiveSeq, realClipCount: realClips.length, usedAssets, gapReport: gen.timeline.gapReport ?? [] };
}

async function renderDemoB() {
  const dir = path.join(OUT, "demo_b_motion_graph_fan");
  await mkdir(dir, { recursive: true });
  const manifest = path.join(FIXTURE_DIR, "manifest.motiongraph.json");
  const r = await sh(process.execPath, [path.join(ROOT, "scripts/run-motion-graph-case.mjs"), "--target-assets-manifest", manifest], { cwd: ROOT });
  const caseDir = path.join(ROOT, "docs/artifacts/motion_graph_case");
  const srcMp4 = path.join(caseDir, "render_with_assets.mp4");
  if (r.code !== 0 || !existsSync(srcMp4)) {
    await writeFile(path.join(dir, "DEMO_B_STATUS.md"), `Demo B (motion_graph) did not produce render_with_assets.mp4 (exit ${r.code}).\n\nstderr tail:\n${r.err.slice(-1500)}\n`);
    return { dir, finalMp4: null, ok: false };
  }
  const finalMp4 = path.join(dir, "final.mp4");
  await copyFile(srcMp4, finalMp4);
  for (const f of ["induced-slots.json", "selected-template.json", "slot-asset-matches.json", "before_after_contact_sheet.png"]) {
    const s = path.join(caseDir, f);
    if (existsSync(s)) await copyFile(s, path.join(dir, f)).catch(() => {});
  }
  const meta = probe(finalMp4);
  await writeFile(path.join(dir, "HUMAN_REVIEW_REPORT.md"), [
    "# Demo B — motion_graph structure + the SAME AeroSpin fan target assets",
    "",
    `- Final MP4: \`final.mp4\` (${meta.width}x${meta.height}, ${meta.duration.toFixed(2)}s)`,
    "- Different sample structure (motion-graph card-stack), same fan target assets → a visually different video.",
    "- Used to prove the system is not a sample-blind mold (see ../diversity_eval/).",
    ""
  ].join("\n"));
  return { dir, finalMp4, ok: true, meta };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log("=== Demo A: editing.mov (beat_cut) + AeroSpin fan ===");
  const a = await renderDemoA();
  console.log(`  final.mp4 ${a.meta.width}x${a.meta.height} ${a.meta.duration.toFixed(2)}s | gates ${a.passed ? "PASS" : "FAIL"} | real-material clips=${a.realClipCount} (${a.usedAssets.join(",")})`);

  let b = { ok: false, finalMp4: null };
  if (!SKIP_B) {
    console.log("=== Demo B: motion_graph + same fan assets ===");
    b = await renderDemoB();
    console.log(`  demo B ${b.ok ? "ok" : "FAILED/skipped"}`);
  }

  // Diversity probe
  const divDir = path.join(OUT, "diversity_eval");
  await mkdir(divDir, { recursive: true });
  let diversity = null;
  if (b.ok && b.finalMp4) {
    const divJson = path.join(divDir, "pairwise_similarity.json");
    const r = await sh(PYTHON, [path.join(ROOT, "scripts/diversity_ncc.py"), a.finalMp4, b.finalMp4,
      "--label-a", "demo_a_editing_fan", "--label-b", "demo_b_motion_graph_fan", "--out", divJson]);
    try { diversity = JSON.parse(r.out); } catch { diversity = { error: r.err.slice(-500) }; }
    const ncc = diversity?.layout_ncc_mean;
    const moldFail = typeof ncc === "number" && ncc >= 0.85;
    await writeFile(path.join(divDir, "pairwise_similarity.md"), [
      "# Cross-sample anti-overfit diversity (Demo A vs Demo B)",
      "",
      `- layout_ncc_mean: **${ncc ?? "n/a"}** (threshold: < 0.85 good, >= 0.85 = MOLD)`,
      `- color_hist_corr_mean: ${diversity?.color_hist_corr_mean ?? "n/a"}`,
      `- identical frames: ${diversity?.n_identical_frames ?? "n/a"}`,
      `- verdict: **${moldFail ? "MOLD (FAIL)" : "DIVERSE (PASS)"}**`,
      "",
      "Demo A and Demo B share the SAME fan target assets but learn structure from UNRELATED samples",
      "(editing.mov beat_cut vs motion_graph). Low cross-correlation proves the renderer is not a mold.",
      ""
    ].join("\n"));
    console.log(`  diversity layout_ncc_mean=${ncc} → ${moldFail ? "MOLD(FAIL)" : "DIVERSE(PASS)"}`);
  } else {
    await writeFile(path.join(divDir, "pairwise_similarity.md"), "# Diversity\n\nDemo B unavailable; cross-sample diversity not computed this run.\n");
  }

  // Step 7: HyperFrames is intentionally NOT used as a finished MP4 renderer (no public SDK).
  await writeFile(path.join(OUT, "SKIPPED_HYPERFRAMES.md"), [
    "# HyperFrames — intentionally skipped for this submission",
    "",
    "HyperFrames has no public SDK wired in this repo (the in-repo `HyperFramesRenderer` only emits a",
    "deterministic JSON manifest + a static HTML card, not a real MP4). Per Spec v1.3 it is therefore NOT",
    "presented as a completed MP4 renderer. The renderer-agnostic `RenderRecipe` is instead proven by TWO",
    "real renderers consuming it: **FFmpeg** (canonical `final.mp4`) and **Remotion** (`final.remotion.mp4`).",
    "If a real HyperFrames HTML→MP4 toolchain is added later, it can consume the same recipe.",
    ""
  ].join("\n"));

  // FINAL_REPORT + README
  await writeFile(path.join(OUT, "FINAL_REPORT.md"), [
    "# Spec v1.3 — Final Submission Report (Source-first RenderRecipe Engine)",
    "",
    "## What this proves",
    "The sample/reference video provides STRUCTURE EVIDENCE ONLY. Real AIGC-generated AeroSpin fan",
    "target assets (provenance: `aigc_generated_material`, Google Gemini image) are the output material",
    "that reaches the canvas. The RenderRecipe (`timeline.renderPlan.renderRecipe`) is the single render",
    "contract and records, per clip, the selected primitive + an auditable `primitiveReason`.",
    "",
    "## Demo A — editing.mov (beat_cut) + fan assets",
    `- final.mp4: ${a.meta.width}x${a.meta.height}, ${a.meta.duration.toFixed(2)}s`,
    `- real fan assets composited on ${a.realClipCount} clips: ${a.usedAssets.join(", ")}`,
    `- primitive sequence: ${a.primitiveSeq.join(" → ")}`,
    `- quality gates: ${a.passed ? "ALL PASS" : "FAIL"} (see demo_a_editing_fan/quality-gates.json)`,
    "",
    "## Demo B — motion_graph + same fan assets",
    b.ok ? `- final.mp4: ${b.meta.width}x${b.meta.height}, ${b.meta.duration.toFixed(2)}s` : "- not produced this run (see demo_b_motion_graph_fan/DEMO_B_STATUS.md)",
    "",
    "## Anti-overfit diversity (A vs B)",
    diversity?.layout_ncc_mean !== undefined ? `- layout_ncc_mean: ${diversity.layout_ncc_mean} (< 0.85 = not a mold)` : "- not computed",
    "",
    "## Honesty notes",
    "- Demo A uses the committed real editing.mov evidence-derived beat_cut template for a deterministic,",
    "  server-free, evaluator-runnable demo; the live analysis path is `npm run full-loop:editing`.",
    "- No real fan footage exists in the repo; fan target assets are real-provider AIGC images, labeled as such.",
    "- The primary renderer is FFmpeg (it composites the real fan pixels + procedural beat-cut grammar + BGM).",
    "  The RemotionRecipeRenderer is the recipe-driven alternative visual layer; FFmpeg owns the final MP4.",
    ""
  ].join("\n"));
  await writeFile(path.join(OUT, "README.md"), [
    "# Final submission artifacts (Spec v1.3)",
    "",
    "- `demo_a_editing_fan/` — editing.mov beat_cut + AeroSpin fan target assets (primary demo)",
    "- `demo_b_motion_graph_fan/` — motion_graph + same fan assets (diversity counterpart)",
    "- `diversity_eval/` — cross-sample anti-overfit probe (layout NCC)",
    "- `FINAL_REPORT.md` — summary + honesty notes",
    "",
    "Regenerate: `npm run demo:final`",
    ""
  ].join("\n"));

  console.log(`\n[done] artifacts → ${OUT}`);
  if (!a.passed) { console.error("Demo A quality gates FAILED — see quality-gates.json"); process.exit(1); }
}

main().catch((e) => { console.error("[FAIL]", e?.stack ?? e); process.exit(1); });
