#!/usr/bin/env node
/**
 * Learn-from-each-sample runner — FULL MAX variant (Spec v1.3).
 *
 * Superset of run-learn-samples.mjs. For EACH sample it:
 *   1. uploads + analyzes through the REAL API server (FFmpeg + evidence analyzer + Gemini VLM + ASR/OCR)
 *      → a learned StructureTemplate;
 *   2. in-process generates + polishes a timeline + RenderRecipe with the SAME AeroSpin fan target assets;
 *   3. renders it BOTH ways — FFmpeg (final.mp4) AND Remotion ViralRecipe composition (final.remotion.mp4);
 *   4. grades the FFmpeg render with the v3 render-quality gate (evaluate-render-quality.mjs --gates v3);
 *   5. writes full human-review artifacts.
 * Finally it computes cross-sample layout-NCC diversity matrices for both renderer outputs.
 *
 * Prompt + target material are held constant, so the only variable across outputs is the learned structure.
 * NOTE: --gates v3 is a beat_cut-fidelity gate; non-beat_cut samples (motion_graph/marketing) are EXPECTED
 * to flag beat_cut-specific gates. The per-sample universal gates (resolution/duration/recipe/primitiveReason/
 * target-material/sample-copy) are the authoritative pass/fail for this learn flow.
 *
 * Run with the toolchain on PATH (starts the API server itself if not already up):
 *   export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
 *   node scripts/run-learn-samples-max.mjs            # all four test_videos/*.mov
 */
import { existsSync, readFileSync, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const REMOTION_ENTRY = path.join(ROOT, "apps/api/remotion/index.tsx");
const REMOTION_COMPOSITION = "ViralRecipe";
const REMOTION_BROWSER_CANDIDATES = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  path.join(ROOT, "apps/api/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
  path.join(ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
  path.join(process.env.HOME ?? "/home/pxli", ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell")
].filter(Boolean);
const REMOTION_BROWSER = REMOTION_BROWSER_CANDIDATES.find((p) => existsSync(p));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const KEEP_SERVER = argv.includes("--keep-server");
const NO_REMOTION = argv.includes("--no-remotion");
const NO_GATE = argv.includes("--no-gate");
const OFFLINE = argv.includes("--offline");
const CASE = arg("--case", "");
const DEFAULT_SAMPLES = CASE
  ? `test_videos/${CASE}.mov`
  : "test_videos/editing.mov,test_videos/marketing.mov,test_videos/motion_graph_1.mov,test_videos/motion_graph_2.mov";
const SAMPLES = arg("--samples", DEFAULT_SAMPLES)
  .split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg("--out", "docs/artifacts/learned_samples_max"));
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
function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], { encoding: "utf8" });
  try { const j = JSON.parse(r.stdout || "{}"); return { duration: Number(j.format?.duration ?? 0), width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0 }; } catch { return { duration: 0, width: 0, height: 0 }; }
}
function sh(cmd, a) { return new Promise((res) => { const p = spawn(cmd, a, { stdio: ["ignore", "pipe", "pipe"] }); let e = ""; p.stderr.on("data", (d) => (e += d)); p.on("close", (code) => res({ code, err: e })); }); }
async function contactSheet(mp4, outPng) { await sh(FFMPEG, ["-y", "-i", mp4, "-vf", "fps=1/1.6,scale=200:-1,tile=3x4", "-frames:v", "1", outPng]); }
async function clipPreviewFrames(mp4, clips, outDir) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const t = Math.max(0, Number((clip.startSec + Math.max(0.05, clip.durationSec / 2)).toFixed(3)));
    await sh(FFMPEG, ["-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", path.join(outDir, `${clip.id}.png`)]);
    await sh(FFMPEG, ["-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", path.join(outDir, `clip_${index + 1}.png`)]);
  }
}

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

// ---------- fan target material + polish (shared with demo:final / run-learn-samples) ----------
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
  { id: "fan_mc_01", kind: "image", role: "media_card", path: `${FX}/fan_card_01.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_mc_02", kind: "image", role: "media_card", path: `${FX}/fan_card_02.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_mc_03", kind: "image", role: "media_card", path: `${FX}/fan_card_03.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_mc_04", kind: "image", role: "media_card", path: `${FX}/fan_card_04.png`, tags: ["card", "media", "卡片"], metadata: aigc },
  { id: "fan_feature", kind: "copy", role: "ui_showcase", text: (copy.features ?? []).join("\n") },
  { id: "fan_kinetic", kind: "copy", role: "kinetic_typography", text: copy.productName ?? copy.brandName ?? "AeroSpin" }
];
const isRenderableFanMediaId = (id) => /^fan_(hero|card|mc|logo)/.test(id);
function polish(timeline) {
  const features = (copy.features ?? []).filter(Boolean);
  let cc = 0, fc = 0;
  const productName = copy.productName ?? copy.brandName ?? "AeroSpin";
  const cta = copy.cta ?? "现在入手，随时随地降温";
  const setSub = (clip, t) => { clip.subtitleText = t; for (const l of clip.layers ?? []) if (l.kind === "text" || l.kind === "text_overlay") l.text = t; };
  const IMG_IDS = ["fan_hero", "fan_card_01", "fan_card_02", "fan_card_03", "fan_card_04"];
  for (const clip of timeline.clips) {
    const fam = clip.visualFormFamily;
    if (typeof clip.sourceAssetId === "string" && /^fan_(hero|card|mc)/.test(clip.sourceAssetId)) {
      const id = IMG_IDS[cc++ % IMG_IDS.length];
      clip.sourceAssetId = id;
      for (const l of clip.layers ?? []) if (typeof l.assetId === "string" && /^fan_(hero|card|mc)/.test(l.assetId)) l.assetId = id;
    }
    if (fam === "brand_cta") for (const l of clip.layers ?? []) l.style = { ...(l.style ?? {}), brandName: copy.brandName ?? "AeroSpin", cta };
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

const resolver = { resolve(id) { const a = FAN_TARGETS.find((t) => t.id === id); return a?.path ? path.resolve(ROOT, a.path) : undefined; } };

// One shared Remotion renderer instance → bundles ONCE, renders all samples.
let remotionRenderer = null;
function getRemotionRenderer(RemotionRenderer, sharedDir) {
  if (!remotionRenderer) {
    remotionRenderer = new RemotionRenderer({
      generatedDir: sharedDir, assetResolver: resolver,
      entryPoint: REMOTION_ENTRY, compositionId: REMOTION_COMPOSITION,
      browserExecutable: REMOTION_BROWSER
    });
  }
  return remotionRenderer;
}

function runV3Gate(dir, sampleAbs) {
  const out = path.join(dir, "render-quality-v3.json");
  const a = [
    path.join(ROOT, "scripts/evaluate-render-quality.mjs"),
    "--render", path.join(dir, "final.mp4"),
    "--template", path.join(dir, "learned-template.json"),
    "--generation", path.join(dir, "generation.json"),
    "--sample", sampleAbs,
    "--gates", "v3",
    "--out", out
  ];
  const r = spawnSync(process.execPath, a, { cwd: ROOT, encoding: "utf8", env: childEnv, maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(readFileSync(out, "utf8")); } catch { report = { overall: "error", scores: { gatesPassed: 0, gatesTotal: 0 }, failures: [redact(r.stderr || "gate did not produce a report").slice(-200)] }; }
  return report;
}

async function learnAndRender(samplePath, RemotionRenderer, sharedRemotionDir) {
  const name = path.basename(samplePath).replace(/\.[^.]+$/, "");
  const dir = path.join(OUT, name);
  await mkdir(dir, { recursive: true });
  console.log(`\n=== ${name}: ${OFFLINE ? "offline analysis replay" : "learn (server analyze)"} → generate → FFmpeg + Remotion render → v3 gate ===`);

  // 1) project + upload + analyze (REAL learning on the server)
  let project = { id: `offline_${name}` };
  let template;
  let videoTl;
  if (OFFLINE) {
    const existingAnalysisPath = [
      path.join(dir, "analysis.json"),
      path.join(ROOT, "docs/artifacts/learned_samples_max", name, "analysis.json"),
      path.join(ROOT, "docs/artifacts/learned_samples", name, "analysis.json")
    ].find((candidate) => existsSync(candidate));
    if (!existingAnalysisPath) throw new Error(`offline analysis not found for ${name}`);
    videoTl = JSON.parse(readFileSync(existingAnalysisPath, "utf8"));
    const { buildFallbackTemplate } = await loadShared();
    template = buildFallbackTemplate(videoTl, "b2b_marketing_mg", project.id);
    console.log(`  offline replay: ${path.relative(ROOT, existingAnalysisPath)} → rebuilt template evidence visual=${template.visualElementGraph?.elements?.length ?? 0}`);
  } else {
    project = await api("POST", "/api/projects", { name: `learn-max ${name}`, vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 });
    const buf = await readFile(path.join(ROOT, samplePath));
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "video/quicktime" }), path.basename(samplePath));
    form.append("role", "example_video");
    form.append("sourcePolicy", "user_authorized");
    const asset = await api("POST", `/api/projects/${project.id}/assets`, form, true);
    console.log(`  uploaded ${name} → ${asset.id}; analyzing (real Gemini VLM + evidence + ASR/OCR, can take minutes)…`);
    const res = await api("POST", `/api/assets/${asset.id}/analyze`, { purpose: "sample" });
    template = res.template;
    videoTl = res.analysis?.video ?? res.analysis;
  }
  if (!template) throw new Error("analyze did not return a learned template");
  await writeFile(path.join(dir, "learned-template.json"), JSON.stringify(template, null, 2));
  await writeFile(path.join(dir, "analysis.json"), JSON.stringify(videoTl ?? null, null, 2));
  console.log(`  learned: videoType=${template.videoType}, slots=${template.requiredSlots?.length ?? 0}, aiEnrichment=${template.aiEnrichmentStatus ?? "?"}`);

  // 2) in-process generate + polish (learned template + fan material, MAX controls)
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

  // 3a) FFmpeg render → final.mp4
  const tmp = path.join(dir, "_render");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const ff = new FFmpegRenderer({ generatedDir: tmp, assetResolver: resolver });
  const ffout = await ff.render(gen.timeline, gen.id);
  if (ffout.status !== "completed" || !ffout.outputPath) throw new Error(`FFmpeg render failed: ${ffout.error ?? "unknown"}`);
  const finalMp4 = path.join(dir, "final.mp4");
  await copyFile(ffout.outputPath, finalMp4);
  await rm(tmp, { recursive: true, force: true });
  await contactSheet(finalMp4, path.join(dir, "render-contact-sheet.png"));
  const meta = probe(finalMp4);
  await clipPreviewFrames(finalMp4, gen.timeline.clips, path.join(dir, "preview_frames"));

  // 3b) Remotion render → final.remotion.mp4 (best-effort; failure does not abort the sample)
  let remotion = { ok: false, error: NO_REMOTION ? "skipped (--no-remotion)" : undefined };
  if (!NO_REMOTION) {
    try {
      const r = getRemotionRenderer(RemotionRenderer, sharedRemotionDir);
      const rout = await r.render(gen.timeline, gen.id);
      if (rout.status === "completed" && rout.outputPath && existsSync(rout.outputPath)) {
        const remMp4 = path.join(dir, "final.remotion.mp4");
        await copyFile(rout.outputPath, remMp4);
        await rm(rout.outputPath, { force: true });
        await contactSheet(remMp4, path.join(dir, "render-contact-sheet.remotion.png"));
        remotion = { ok: true, meta: probe(remMp4), path: remMp4 };
        console.log(`  ✓ Remotion render: ${remotion.meta.width}x${remotion.meta.height} ${remotion.meta.duration.toFixed(2)}s`);
      } else {
        remotion = { ok: false, error: redact(rout.error ?? "remotion render returned no output").slice(0, 240) };
        console.log(`  ⚠ Remotion render failed: ${remotion.error}`);
      }
    } catch (e) { remotion = { ok: false, error: redact(String(e?.message ?? e)).slice(0, 240) }; console.log(`  ⚠ Remotion threw: ${remotion.error}`); }
  }

  // 4) persist artifacts (generation.json = full GenerationResult, consumed by the v3 gate)
  const recipe = gen.timeline.renderPlan?.renderRecipe;
  await writeFile(path.join(dir, "generation.json"), JSON.stringify(gen, null, 2));
  await writeFile(path.join(dir, "render-recipe.json"), JSON.stringify(recipe, null, 2));
  await writeFile(path.join(dir, "timeline.json"), JSON.stringify(gen.timeline, null, 2));
  await writeFile(path.join(dir, "slot-mapping.json"), JSON.stringify(gen.slotMapping ?? [], null, 2));
  await writeFile(path.join(dir, "gap-report.json"), JSON.stringify(gen.gapReport ?? gen.timeline.gapReport ?? [], null, 2));

  // universal (flow-authoritative) gates
  const realClips = gen.timeline.clips.filter((c) => typeof c.sourceAssetId === "string" && c.sourceAssetId.startsWith("fan_"));
  const sampleCopy = gen.timeline.clips.filter((c) => c.sourceAssetId && sampleIds.has(c.sourceAssetId));
  const primitiveSeq = recipe?.clips?.map((c) => c.selectedPrimitive) ?? [];
  const universal = {
    final_mp4_exists: existsSync(finalMp4),
    resolution_720x1280: meta.width === 720 && meta.height === 1280,
    duration_14_16s: meta.duration >= 14 && meta.duration <= 16,
    render_recipe_exists: Boolean(recipe),
    every_clip_has_primitiveReason: Boolean(recipe?.clips?.every((c) => c.primitiveReason?.length)),
    target_material_appears: realClips.length > 0,
    sample_copy_eq_0: sampleCopy.length === 0,
    remotion_render_exists: remotion.ok
  };
  const universalPass = Object.values(universal).every(Boolean);

  // 5) v3 render-quality gate (beat_cut-fidelity scorecard)
  let v3 = { overall: "skipped", scores: { gatesPassed: 0, gatesTotal: 0 }, failures: [] };
  if (!NO_GATE) {
    console.log(`  running v3 render-quality gate (re-analyzes render + sample, can take ~1m)…`);
    v3 = runV3Gate(dir, path.resolve(ROOT, samplePath));
    console.log(`  v3 gate: ${String(v3.overall).toUpperCase()} (${v3.scores?.gatesPassed}/${v3.scores?.gatesTotal} gates)`);
  }

  await writeFile(path.join(dir, "quality-gates.json"), JSON.stringify({
    universal: { overall: universalPass ? "pass" : "fail", gates: universal },
    v3_render_quality: { overall: v3.overall, gatesPassed: v3.scores?.gatesPassed, gatesTotal: v3.scores?.gatesTotal, failures: v3.failures ?? [] }
  }, null, 2));

  await writeFile(path.join(dir, "HUMAN_REVIEW_REPORT.md"), [
    `# Learned from \`${path.basename(samplePath)}\` → AeroSpin fan video (FULL MAX)`,
    "",
    `- Learned videoType: **${template.videoType}** (auto-detected by the analyzer)`,
    `- Template: ${template.name ?? "n/a"}; required slots: ${template.requiredSlots?.length ?? 0}; AI enrichment: ${template.aiEnrichmentStatus ?? "?"}`,
    `- FFmpeg output: \`final.mp4\` ${meta.width}x${meta.height} ${meta.duration.toFixed(2)}s`,
    `- Remotion output: ${remotion.ok ? `\`final.remotion.mp4\` ${remotion.meta.width}x${remotion.meta.height} ${remotion.meta.duration.toFixed(2)}s` : `❌ ${remotion.error}`}`,
    `- Real fan assets composited on ${realClips.length} clips: ${[...new Set(realClips.map((c) => c.sourceAssetId))].join(", ")}`,
    `- Primitive sequence: ${primitiveSeq.join(" → ")}`,
    `- Sample frames copied to canvas: ${sampleCopy.length} (must be 0)`,
    "",
    `## Universal gates (authoritative for this flow): ${universalPass ? "ALL PASS ✅" : "FAIL ❌"}`,
    ...Object.entries(universal).map(([k, v]) => `- ${v ? "✅" : "❌"} ${k}`),
    "",
    `## v3 render-quality gate (beat_cut-fidelity scorecard): ${String(v3.overall).toUpperCase()} — ${v3.scores?.gatesPassed}/${v3.scores?.gatesTotal} gates`,
    template.videoType === "beat_cut"
      ? "_This sample learned `beat_cut`, so the v3 gate is fully applicable._"
      : `_This sample learned \`${template.videoType}\` (not beat_cut); beat_cut-specific v3 gates are EXPECTED to flag. Treat the universal gates above as authoritative._`,
    v3.failures?.length ? `- Failing gates: ${v3.failures.join(", ")}` : "- No failing gates.",
    "",
    "The prompt + target material were identical across all samples; the only variable is the learned structure.",
    ""
  ].join("\n"));

  console.log(`  ✓ ${name}: ${template.videoType} → final.mp4 ${meta.duration.toFixed(2)}s | remotion=${remotion.ok ? "ok" : "FAIL"} | universal ${universalPass ? "PASS" : "FAIL"} | v3 ${v3.scores?.gatesPassed}/${v3.scores?.gatesTotal}`);
  return {
    name, sample: samplePath, videoType: template.videoType, finalMp4, meta, primitiveSeq,
    realClips: realClips.length, universalPass,
    remotionMp4: remotion.ok ? remotion.path : null, remotionError: remotion.ok ? null : remotion.error,
    v3: { overall: v3.overall, passed: v3.scores?.gatesPassed, total: v3.scores?.gatesTotal, failures: v3.failures ?? [] }
  };
}

function nccPair(aMp4, bMp4, aName, bName) {
  const r = spawnSync(PYTHON, [path.join(ROOT, "scripts/diversity_ncc.py"), aMp4, bMp4, "--label-a", aName, "--label-b", bName], { encoding: "utf8" });
  try { const j = JSON.parse(r.stdout); return j.layout_ncc_mean ?? null; } catch { return null; }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const s of SAMPLES) if (!existsSync(path.join(ROOT, s))) throw new Error(`sample not found: ${s}`);
  if (!NO_REMOTION && !REMOTION_BROWSER) console.log("⚠ no chrome-headless-shell found in known paths; Remotion will rely on its own default and may fail.");
  else if (!NO_REMOTION) console.log(`• Remotion browser: ${REMOTION_BROWSER}`);

  const startedServer = OFFLINE ? false : await ensureServer();
  const { RemotionRenderer } = await loadRenderer();
  const sharedRemotionDir = path.join(OUT, "_remotion_tmp");
  await mkdir(sharedRemotionDir, { recursive: true });

  const results = [];
  try {
    for (const s of SAMPLES) {
      try { results.push(await learnAndRender(s, RemotionRenderer, sharedRemotionDir)); }
      catch (e) { console.error(`  ✗ ${s}: ${redact(e?.message ?? String(e))}`); results.push({ name: path.basename(s).replace(/\.[^.]+$/, ""), sample: s, error: redact(String(e?.message ?? e)) }); }
    }
  } finally {
    await rm(sharedRemotionDir, { recursive: true, force: true }).catch(() => {});
    if (serverProc && startedServer && !KEEP_SERVER) { try { serverProc.kill("SIGTERM"); } catch { /* ignore */ } }
  }

  // cross-sample diversity matrices (pairwise layout NCC) for BOTH renderers
  const ffOk = results.filter((r) => r.finalMp4 && existsSync(r.finalMp4));
  const ffMatrix = [];
  for (let i = 0; i < ffOk.length; i += 1) for (let j = i + 1; j < ffOk.length; j += 1)
    ffMatrix.push({ a: ffOk[i].name, b: ffOk[j].name, layout_ncc_mean: nccPair(ffOk[i].finalMp4, ffOk[j].finalMp4, ffOk[i].name, ffOk[j].name) });
  const remOk = results.filter((r) => r.remotionMp4 && existsSync(r.remotionMp4));
  const remMatrix = [];
  for (let i = 0; i < remOk.length; i += 1) for (let j = i + 1; j < remOk.length; j += 1)
    remMatrix.push({ a: remOk[i].name, b: remOk[j].name, layout_ncc_mean: nccPair(remOk[i].remotionMp4, remOk[j].remotionMp4, remOk[i].name, remOk[j].name) });
  await writeFile(path.join(OUT, "diversity_matrix.json"), JSON.stringify({ ffmpeg: ffMatrix, remotion: remMatrix }, null, 2));

  const lines = [
    "# Learn-from-each-sample — FULL MAX summary",
    "",
    "Each row: a sample video → learned structure → an AeroSpin fan video, dual-rendered (FFmpeg + Remotion), graded by the v3 render-quality gate. Same prompt + same fan target assets across all samples — the only variable is the learned structure.",
    "",
    "| sample | learned videoType | FFmpeg dur | Remotion | universal gates | v3 gate | primitives |",
    "|---|---|---|---|---|---|---|",
    ...results.map((r) => r.error
      ? `| ${r.name} | ERROR | — | — | — | — | ${r.error.slice(0, 50)} |`
      : `| ${r.name} | ${r.videoType} | ${r.meta.duration.toFixed(1)}s | ${r.remotionMp4 ? "✅" : "❌"} | ${r.universalPass ? "PASS" : "FAIL"} | ${r.v3.passed}/${r.v3.total} ${r.v3.overall} | ${r.primitiveSeq.join(" → ")} |`),
    "",
    "_v3 is a beat_cut-fidelity gate; non-beat_cut samples are expected to flag beat_cut-specific gates. Universal gates are authoritative for this flow._",
    "",
    "## Cross-sample diversity — FFmpeg (pairwise layout NCC; < 0.85 = not a mold)",
    "",
    "| A | B | layout_ncc_mean |", "|---|---|---:|",
    ...ffMatrix.map((m) => `| ${m.a} | ${m.b} | ${m.layout_ncc_mean} |`),
    "",
    "## Cross-sample diversity — Remotion",
    "",
    "| A | B | layout_ncc_mean |", "|---|---|---:|",
    ...remMatrix.map((m) => `| ${m.a} | ${m.b} | ${m.layout_ncc_mean} |`),
    ""
  ];
  await writeFile(path.join(OUT, "SUMMARY.md"), lines.join("\n"));
  console.log(`\n[done] ${ffOk.length}/${results.length} samples FFmpeg-rendered, ${remOk.length} Remotion-rendered → ${OUT}`);
  console.log("ffmpeg diversity:", ffMatrix.map((m) => `${m.a}×${m.b}=${m.layout_ncc_mean}`).join("  "));
  if (ffOk.length === 0) process.exit(1);
  process.exit(0);
}
main().catch((e) => { console.error("[FAIL]", redact(e?.stack ?? String(e))); if (serverProc && !KEEP_SERVER) { try { serverProc.kill("SIGTERM"); } catch { /* */ } } process.exit(1); });
