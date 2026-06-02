#!/usr/bin/env node
/**
 * Learn-from-each-sample runner (Spec v1.3).
 *
 * For EACH sample video it: (1) uploads + analyzes it through the REAL API server (FFmpeg + evidence
 * analyzer + Gemini VLM + ASR/OCR → a learned StructureTemplate), then (2) in-process generates +
 * polishes + renders a new video using that learned structure and the SAME AeroSpin fan target assets.
 *
 * Because the prompt + target material are held constant, the ONLY variable across outputs is the
 * structure learned from each sample — so different samples must yield structurally different videos.
 *
 * Run with the toolchain on PATH (starts the API server itself if not already up):
 *   export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
 *   npm run learn:samples            # all four test_videos/*.mov
 *   node scripts/run-learn-samples.mjs --samples test_videos/editing.mov,test_videos/marketing.mov
 */
import { existsSync, readFileSync, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "docs/fixtures/final_aerospin_fan");
const FFMPEG = "ffmpeg";
const FFPROBE = "ffprobe";
const PYTHON = process.env.CONDA_BASE
  ? `${process.env.CONDA_BASE}/envs/${process.env.VIRAL_CONDA_ENV ?? "viral"}/bin/python`
  : "python3";
const BASE = process.env.VVST_API_BASE ?? `http://localhost:${process.env.APP_PORT ?? 3000}`;
const childEnv = { ...process.env, CONDA_BASE: process.env.CONDA_BASE ?? "/home/pxli/anaconda3", VIRAL_CONDA_ENV: process.env.VIRAL_CONDA_ENV ?? "viral" };

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const KEEP_SERVER = argv.includes("--keep-server");
const SAMPLES = arg("--samples", "test_videos/editing.mov,test_videos/marketing.mov,test_videos/motion_graph_1.mov,test_videos/motion_graph_2.mov")
  .split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg("--out", "docs/artifacts/learned_samples"));
const PROMPT =
  "主题：AeroSpin 便携涡轮小风扇。15 秒高转化竖屏产品广告，突出三档强风、USB-C 快充、低噪音、桌面手持两用。" +
  "学习样例视频的结构（节奏/镜头/字幕/包装/转场），但不复制样例画面、音频或水印。CTA：现在入手，随时随地降温。";

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRETS = ["GEMINI_API_KEY", "ARK_API_KEY", "SEEDREAM_ARK_API_KEY"].map((k) => process.env[k]).filter((v) => v && v.length >= 8);
const redact = (t) => { let o = String(t ?? ""); for (const s of SECRETS) o = o.split(s).join("[REDACTED]"); return o; };

async function api(method, route, body, isForm = false) {
  const opts = { method, headers: {} };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${route}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${redact(text).slice(0, 300)}`);
  return json && typeof json === "object" && "data" in json ? json.data : json;
}
async function pollJob(jobId, label) {
  const t0 = Date.now();
  for (;;) {
    const job = await api("GET", `/api/jobs/${jobId}`);
    if (job.status === "completed") return job.outputRefs?.generationId;
    if (job.status === "failed") throw new Error(`${label} failed: ${redact(job.error?.message ?? "unknown")}`);
    if (Date.now() - t0 > 1_800_000) throw new Error(`${label} timed out`);
    await sleep(2500);
  }
}
function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], { encoding: "utf8" });
  try { const j = JSON.parse(r.stdout || "{}"); return { duration: Number(j.format?.duration ?? 0), width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0 }; } catch { return { duration: 0, width: 0, height: 0 }; }
}
function sh(cmd, a) { return new Promise((res) => { const p = spawn(cmd, a, { stdio: ["ignore", "pipe", "pipe"] }); let e = ""; p.stderr.on("data", (d) => (e += d)); p.on("close", (code) => res({ code, err: e })); }); }

let serverProc = null;
async function ensureServer() {
  try { const r = await fetch(`${BASE}/healthz`); if (r.ok) return false; } catch { /* not up */ }
  console.log("• API server not up — building shared+api and starting it…");
  for (const ws of ["@vvst/shared", "@vvst/api"]) {
    const b = spawnSync("npm", ["run", "build", "--workspace", ws], { cwd: ROOT, encoding: "utf8", env: childEnv });
    if (b.status !== 0) throw new Error(`build ${ws} failed: ${redact(b.stderr || b.stdout).slice(-400)}`);
  }
  await mkdir(OUT, { recursive: true });
  const logStream = createWriteStream(path.join(OUT, "server.log"), { flags: "a" });
  serverProc = spawn(process.execPath, [path.join(ROOT, "apps/api/dist/server.js")], { cwd: ROOT, env: childEnv });
  serverProc.stdout.on("data", (d) => logStream.write(redact(d.toString())));
  serverProc.stderr.on("data", (d) => logStream.write(redact(d.toString())));
  for (let i = 0; i < 90; i += 1) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { console.log(`✓ API server healthy after ${i + 1}s`); return true; } } catch { /* retry */ }
    await sleep(1000);
  }
  throw new Error("API server failed to become healthy within 90s");
}

// ---------- fan target material + polish (shared with demo:final) ----------
const copy = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "copy.json"), "utf8"));
const FX = "docs/fixtures/final_aerospin_fan";
const aigc = { materialRole: "aigc_generated_material", source: "google_gemini_image" };
const FAN_TARGETS = [
  { id: "fan_hero", kind: "image", role: "object_motion", path: `${FX}/fan_hero.png`, tags: ["hero", "product", "主视觉"], metadata: aigc },
  { id: "fan_card_01", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_01.png`, tags: ["montage", "卡片"], metadata: aigc },
  { id: "fan_card_02", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_02.png`, tags: ["montage", "卡片"], metadata: aigc },
  { id: "fan_card_03", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_03.png`, tags: ["montage", "卡片"], metadata: aigc },
  { id: "fan_card_04", kind: "image", role: "live_action_montage", path: `${FX}/fan_card_04.png`, tags: ["montage", "卡片"], metadata: aigc },
  { id: "fan_logo", kind: "logo", role: "brand_cta", path: `${FX}/logo.png`, tags: ["logo", "brand"], metadata: aigc },
  // also offer the cards/hero as media_cards + the copies so non-beat-cut (motion_graph/marketing) templates bind them too
  { id: "fan_mc_01", kind: "image", role: "media_card", path: `${FX}/fan_card_01.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_mc_02", kind: "image", role: "media_card", path: `${FX}/fan_card_02.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_mc_03", kind: "image", role: "media_card", path: `${FX}/fan_card_03.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_mc_04", kind: "image", role: "media_card", path: `${FX}/fan_card_04.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_feature", kind: "copy", role: "ui_showcase", text: (copy.features ?? []).join("\n") },
  { id: "fan_kinetic", kind: "copy", role: "kinetic_typography", text: copy.productName ?? copy.brandName ?? "AeroSpin" }
];
const isRenderableFanMediaId = (id) => /^fan_(hero|card|mc|logo)/.test(id);
const CARD_IDS = ["fan_card_01", "fan_card_02", "fan_card_03", "fan_card_04"];
function polish(timeline) {
  const features = (copy.features ?? []).filter(Boolean);
  let cc = 0, fc = 0;
  const productName = copy.productName ?? copy.brandName ?? "AeroSpin";
  const cta = copy.cta ?? "现在入手，随时随地降温";
  const setSub = (clip, t) => { clip.subtitleText = t; for (const l of clip.layers ?? []) if (l.kind === "text" || l.kind === "text_overlay") l.text = t; };
  // Spread ALL distinct fan images (hero + 4 cards) across EVERY image-bearing clip so the same
  // picture is not reused; the CTA logo is left alone. cc cycles through the 5 product images.
  const IMG_IDS = ["fan_hero", "fan_card_01", "fan_card_02", "fan_card_03", "fan_card_04"];
  for (const clip of timeline.clips) {
    const fam = clip.visualFormFamily;
    if (typeof clip.sourceAssetId === "string" && /^fan_(hero|card|mc)/.test(clip.sourceAssetId)) {
      const id = IMG_IDS[cc++ % IMG_IDS.length];
      clip.sourceAssetId = id;
      for (const l of clip.layers ?? []) if (typeof l.assetId === "string" && /^fan_(hero|card|mc)/.test(l.assetId)) l.assetId = id;
    }
    if (fam === "brand_cta") for (const l of clip.layers ?? []) l.style = { ...(l.style ?? {}), brandName: copy.brandName ?? "AeroSpin", cta };
    // Subtitle = product copy only (every videoType). hook→product name, cta→CTA, else cycle the
    // provided selling points whenever the planner copy is missing / too long / English-generic /
    // the raw prompt. Guarantees no placeholder or prompt leakage on any sample's output.
    const cur = (clip.subtitleText ?? "").trim();
    const looksGeneric = !cur || cur.length > 16 || /[A-Za-z]{5,}/.test(cur) || cur === PROMPT || cur.includes("卖点：") || cur.includes("主题：");
    if (clip.role === "hook") setSub(clip, productName);
    else if (clip.role === "cta") setSub(clip, cta);
    else if (looksGeneric && features.length) setSub(clip, features[fc++ % features.length]);
  }
  const recipe = timeline.renderPlan?.renderRecipe;
  if (recipe?.clips) for (const rc of recipe.clips) {
    const tc = timeline.clips.find((c) => c.id === rc.clipId);
    if (!tc) continue;
    rc.text = { ...(rc.text ?? {}), copy: tc.subtitleText ?? rc.text?.copy ?? "" };
    if (typeof tc.sourceAssetId === "string" && isRenderableFanMediaId(tc.sourceAssetId)) rc.material = { ...(rc.material ?? {}), assetIds: [tc.sourceAssetId] };
  }
  if (recipe?.layers) for (const layer of recipe.layers) {
    if (!layer.clipId) continue;
    const tc = timeline.clips.find((c) => c.id === layer.clipId);
    if (!tc) continue;
    if (layer.type === "text" && layer.text && tc.subtitleText) layer.text.content = tc.subtitleText;
    if (layer.type === "media" && layer.material && typeof tc.sourceAssetId === "string" && isRenderableFanMediaId(tc.sourceAssetId)) {
      layer.material.assetIds = [tc.sourceAssetId];
    }
  }
  return timeline;
}

async function loadShared() { return import(path.join(ROOT, "packages/shared/dist/index.js")); }
async function loadRenderer() { return import(path.join(ROOT, "apps/api/dist/adapters/renderers.js")); }

async function learnAndRender(samplePath) {
  const name = path.basename(samplePath).replace(/\.[^.]+$/, "");
  const dir = path.join(OUT, name);
  await mkdir(dir, { recursive: true });
  console.log(`\n=== ${name}: learn (server analyze) → generate+render (fan material) ===`);

  // 1) project + upload + analyze (REAL learning on the server)
  const project = await api("POST", "/api/projects", { name: `learn ${name}`, vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 });
  const buf = await readFile(path.join(ROOT, samplePath));
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/quicktime" }), path.basename(samplePath));
  form.append("role", "example_video");
  form.append("sourcePolicy", "user_authorized");
  const asset = await api("POST", `/api/projects/${project.id}/assets`, form, true);
  console.log(`  uploaded ${name} → ${asset.id}; analyzing (real Gemini VLM + evidence + ASR/OCR, can take minutes)…`);
  const res = await api("POST", `/api/assets/${asset.id}/analyze`, { purpose: "sample" });
  const template = res.template;
  if (!template) throw new Error("analyze did not return a learned template");
  await writeFile(path.join(dir, "learned-template.json"), JSON.stringify(template, null, 2));
  const videoTl = res.analysis?.video ?? res.analysis;
  await writeFile(path.join(dir, "analysis.json"), JSON.stringify(videoTl ?? null, null, 2));
  console.log(`  learned: videoType=${template.videoType}, slots=${template.requiredSlots?.length ?? 0}, aiEnrichment=${template.aiEnrichmentStatus ?? "?"}`);

  // 2) in-process generate + polish + render with the learned template + fan material
  const { generateMigrationResult } = await loadShared();
  const { FFmpegRenderer } = await loadRenderer();
  const request = {
    projectId: project.id, inputMode: "brief_assets", selectedTemplateIds: [template.id],
    prompt: PROMPT, targetAssets: FAN_TARGETS,
    target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "storyboard_preview" },
    controls: { pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct", recipeEvidencePrimitives: true, recipeAdaptiveStructure: true },
    constraints: { noSampleVisualCopy: true }
  };
  const gen = generateMigrationResult({ template, request });
  polish(gen.timeline);

  const sampleIds = new Set(template.sourceSampleIds ?? []);
  const resolver = { resolve(id) { const a = FAN_TARGETS.find((t) => t.id === id); return a?.path ? path.resolve(ROOT, a.path) : undefined; } };
  const tmp = path.join(dir, "_render");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const renderer = new FFmpegRenderer({ generatedDir: tmp, assetResolver: resolver });
  const out = await renderer.render(gen.timeline, gen.id);
  if (out.status !== "completed" || !out.outputPath) throw new Error(`render failed: ${out.error ?? "unknown"}`);
  const finalMp4 = path.join(dir, "final.mp4");
  await copyFile(out.outputPath, finalMp4);
  await rm(tmp, { recursive: true, force: true });
  await sh(FFMPEG, ["-y", "-i", finalMp4, "-vf", "fps=1/1.6,scale=200:-1,tile=3x4", "-frames:v", "1", path.join(dir, "render-contact-sheet.png")]);

  const meta = probe(finalMp4);
  const recipe = gen.timeline.renderPlan?.renderRecipe;
  const realClips = gen.timeline.clips.filter((c) => typeof c.sourceAssetId === "string" && c.sourceAssetId.startsWith("fan_"));
  const sampleCopy = gen.timeline.clips.filter((c) => c.sourceAssetId && sampleIds.has(c.sourceAssetId));
  const primitiveSeq = recipe?.clips?.map((c) => c.selectedPrimitive) ?? [];
  const gates = {
    final_mp4_exists: existsSync(finalMp4),
    resolution_720x1280: meta.width === 720 && meta.height === 1280,
    duration_14_16s: meta.duration >= 14 && meta.duration <= 16,
    render_recipe_exists: Boolean(recipe),
    every_clip_has_primitiveReason: Boolean(recipe?.clips?.every((c) => c.primitiveReason?.length)),
    target_material_appears: realClips.length > 0,
    sample_copy_eq_0: sampleCopy.length === 0
  };
  const passed = Object.values(gates).every(Boolean);
  await writeFile(path.join(dir, "render-recipe.json"), JSON.stringify(recipe, null, 2));
  await writeFile(path.join(dir, "timeline.json"), JSON.stringify(gen.timeline, null, 2));
  await writeFile(path.join(dir, "slot-mapping.json"), JSON.stringify(gen.slotMapping ?? [], null, 2));
  await writeFile(path.join(dir, "gap-report.json"), JSON.stringify(gen.timeline.gapReport ?? [], null, 2));
  await writeFile(path.join(dir, "quality-gates.json"), JSON.stringify({ overall: passed ? "pass" : "fail", gates }, null, 2));
  await writeFile(path.join(dir, "learned-structure-summary.md"), [
    `# Learned from \`${path.basename(samplePath)}\` → AeroSpin fan video`,
    "",
    `- Learned videoType: **${template.videoType}** (auto-detected by the analyzer)`,
    `- Template: ${template.name ?? "n/a"}; required slots: ${template.requiredSlots?.length ?? 0}; AI enrichment: ${template.aiEnrichmentStatus ?? "?"}`,
    `- Output: \`final.mp4\` ${meta.width}x${meta.height} ${meta.duration.toFixed(2)}s`,
    `- Real fan assets composited on ${realClips.length} clips: ${[...new Set(realClips.map((c) => c.sourceAssetId))].join(", ")}`,
    `- Primitive sequence: ${primitiveSeq.join(" → ")}`,
    `- Sample frames copied to canvas: ${sampleCopy.length} (must be 0)`,
    `- Quality gates: ${passed ? "ALL PASS" : "FAIL"}`,
    "",
    "The prompt + target material were identical across all samples; the only variable is the learned structure.",
    ""
  ].join("\n"));
  console.log(`  ✓ ${name}: ${template.videoType} → final.mp4 ${meta.duration.toFixed(2)}s | real clips=${realClips.length} | gates ${passed ? "PASS" : "FAIL"}`);
  return { name, sample: samplePath, videoType: template.videoType, finalMp4, meta, primitiveSeq, realClips: realClips.length, passed };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const s of SAMPLES) if (!existsSync(path.join(ROOT, s))) throw new Error(`sample not found: ${s}`);
  const startedServer = await ensureServer();
  const results = [];
  try {
    for (const s of SAMPLES) {
      try { results.push(await learnAndRender(s)); }
      catch (e) { console.error(`  ✗ ${s}: ${e?.message ?? e}`); results.push({ name: path.basename(s), sample: s, error: String(e?.message ?? e) }); }
    }
  } finally {
    if (serverProc && startedServer && !KEEP_SERVER) { try { serverProc.kill("SIGTERM"); } catch { /* ignore */ } }
  }

  // cross-sample diversity matrix (pairwise layout NCC over the rendered videos)
  const ok = results.filter((r) => r.finalMp4 && existsSync(r.finalMp4));
  const matrix = [];
  for (let i = 0; i < ok.length; i += 1) for (let j = i + 1; j < ok.length; j += 1) {
    const r2 = spawnSync(PYTHON, [path.join(ROOT, "scripts/diversity_ncc.py"), ok[i].finalMp4, ok[j].finalMp4, "--label-a", ok[i].name, "--label-b", ok[j].name], { encoding: "utf8" });
    let ncc; try { ncc = JSON.parse(r2.stdout); } catch { ncc = { error: "ncc parse failed" }; }
    matrix.push({ a: ok[i].name, b: ok[j].name, layout_ncc_mean: ncc.layout_ncc_mean ?? null, color_hist_corr_mean: ncc.color_hist_corr_mean ?? null });
  }
  await writeFile(path.join(OUT, "diversity_matrix.json"), JSON.stringify(matrix, null, 2));

  const lines = [
    "# Learn-from-each-sample — summary",
    "",
    "Each row: a sample video → its learned structure → an AeroSpin fan video (same prompt + same fan target assets).",
    "",
    "| sample | learned videoType | duration | real-asset clips | gates | primitives |",
    "|---|---|---|---:|---|---|",
    ...results.map((r) => r.error
      ? `| ${r.name} | ERROR | — | — | — | ${r.error.slice(0, 60)} |`
      : `| ${r.name} | ${r.videoType} | ${r.meta.duration.toFixed(1)}s | ${r.realClips} | ${r.passed ? "PASS" : "FAIL"} | ${r.primitiveSeq.join(" → ")} |`),
    "",
    "## Cross-sample diversity (pairwise layout NCC; < 0.85 = not a mold)",
    "",
    "| A | B | layout_ncc_mean |",
    "|---|---|---:|",
    ...matrix.map((m) => `| ${m.a} | ${m.b} | ${m.layout_ncc_mean} |`),
    ""
  ];
  await writeFile(path.join(OUT, "SUMMARY.md"), lines.join("\n"));
  console.log(`\n[done] ${ok.length}/${results.length} samples rendered → ${OUT}`);
  console.log("diversity:", matrix.map((m) => `${m.a}×${m.b}=${m.layout_ncc_mean}`).join("  "));
  if (ok.length === 0) process.exit(1);
}
main().catch((e) => { console.error("[FAIL]", e?.stack ?? e); if (serverProc && !KEEP_SERVER) { try { serverProc.kill("SIGTERM"); } catch { /* */ } } process.exit(1); });
