#!/usr/bin/env node
/**
 * Marking pipeline runner — drives the REAL API server through the FULL structure-transfer pipeline
 * once per sample (test_videos/*.mov), each with a DIFFERENT randomly-chosen real-product theme.
 * For each sample it: create project → upload sample → analyze (FFmpeg + evidence + Gemini VLM + ASR/OCR)
 * → generate (theme prompt; NO supplied product images, so gap-detect → AIGC/procedural fill produces the
 * product visuals = the gap-fill rubric) → render FFmpeg (final.mp4) + Remotion ViralRecipe
 * (final.remotion.mp4) → write the full per-case evidence chain + multi-version recipes + gates.
 * "Learn structure, not content": the sample only informs structure; final pixels are target/AIGC/procedural.
 *
 *   export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
 *   node scripts/run-marking-pipeline.mjs                  # all four samples
 *   node scripts/run-marking-pipeline.mjs --case editing   # one sample
 * Output: docs/artifacts/marking_run/<case>/  (staging; assembled into marking/ by build-marking-package.mjs)
 */
import { existsSync, readFileSync, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG = "ffmpeg";
const FFPROBE = "ffprobe";
const PYTHON = process.env.CONDA_BASE ? `${process.env.CONDA_BASE}/envs/${process.env.VIRAL_CONDA_ENV ?? "viral"}/bin/python` : "python3";
const BASE = process.env.VVST_API_BASE ?? `http://localhost:${process.env.APP_PORT ?? 3000}`;
const childEnv = { ...process.env, CONDA_BASE: process.env.CONDA_BASE ?? "/home/pxli/anaconda3", VIRAL_CONDA_ENV: process.env.VIRAL_CONDA_ENV ?? "viral" };
const REMOTION_BROWSER = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  path.join(ROOT, "apps/api/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
  path.join(ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell")
].filter(Boolean).find((p) => existsSync(p));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const KEEP_SERVER = argv.includes("--keep-server");
const NO_REMOTION = argv.includes("--no-remotion");
const ONE_CASE = arg("--case", "");
const OUT = path.resolve(arg("--out", "docs/artifacts/marking_run"));

// The 4 randomly-drawn real-product themes (one per sample). Recorded to OUT/themes.json so the run is
// auditable. The structure is LEARNED from the sample; the new video is about this product theme.
const THEMES = {
  marketing: { name: "野兽派香薰蜡烛", en: "scented soy candle", category: "家居香氛", cta: "点亮今晚的松弛感", features: ["天然大豆蜡", "60 小时持久留香", "无烟环保烛芯", "礼盒装送礼首选"] },
  editing: { name: "添可无线吸尘器", en: "cordless vacuum cleaner", category: "家用清洁电器", cta: "今天就告别灰尘", features: ["大吸力无线", "智能尘量识别", "一键自清洁", "全屋除螨"] },
  motion_graph_1: { name: "晨光按动中性笔", en: "retractable gel pen", category: "文具", cta: "下单解锁顺滑书写", features: ["0.5mm 速干墨水", "按动免拔帽", "防滑握手胶", "12 支量贩装"] },
  motion_graph_2: { name: "蓝山精品挂耳咖啡", en: "drip coffee bags", category: "食品饮料", cta: "明早从一杯好咖啡开始", features: ["新鲜烘焙豆", "独立锁鲜挂耳", "三秒冲泡", "微酸果香平衡"] }
};
const SAMPLE_ORDER = ["marketing", "editing", "motion_graph_1", "motion_graph_2"];

function themePrompt(t) {
  return `主题：${t.name}（${t.en}，${t.category}）。15 秒高转化竖屏产品广告，突出${t.features.join("、")}。` +
    `学习样例视频的结构（脚本节奏/镜头切换/字幕版式/画面包装/转场/卡点），但绝不复制样例的画面、音频、文字或水印。` +
    `最终画面只用目标/程序化/带 provenance 的 AIGC 生成素材。CTA：${t.cta}。`;
}

// Copy-only target material (real product text); product IMAGES are intentionally NOT supplied so the
// pipeline's gap detector + AIGC material fill generate them (exercising the gap-fill rubric).
function copyTargets(slug, t) {
  return [
    { id: `${slug}_feature`, kind: "copy", role: "ui_showcase", text: t.features.join("\n") },
    { id: `${slug}_kinetic`, kind: "copy", role: "kinetic_typography", text: t.name },
    { id: `${slug}_cta`, kind: "copy", role: "brand_cta", text: t.cta }
  ];
}

function buildRequest(projectId, template, sampleAssetId, slug, t, versionStrategy) {
  return {
    projectId,
    inputMode: "brief_assets",
    selectedTemplateIds: [template.id],
    sampleReferenceAssetId: sampleAssetId,
    prompt: themePrompt(t),
    targetAssets: copyTargets(slug, t),
    target: { vertical: "b2b_marketing_mg", targetDurationSec: 15, aspectRatio: "9:16", outputMode: "mp4_render" },
    ...(versionStrategy ? { versionStrategy } : {}),
    controls: {
      pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct",
      recipeEvidencePrimitives: true, recipeAdaptiveStructure: true,
      allowAigcMaterialGeneration: true, allowExternalAigcProvider: true,
      subtitleGenerationMode: "auto"
    },
    constraints: { noSampleVisualCopy: true, sampleAssetReuse: "disabled" }
  };
}

// ---------- generic helpers (same contract as run-learn-samples-max.mjs) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRETS = ["GEMINI_API_KEY", "ARK_API_KEY", "SEEDREAM_ARK_API_KEY", "SEEDANCE_ARK_API_KEY", "ELEVENLABS_API_KEY", "OPENAI_COMPATIBLE_API_KEY", "OPENAI_API_KEY"].map((k) => process.env[k]).filter((v) => v && v.length >= 8);
const redact = (t) => { let o = String(t ?? ""); for (const s of SECRETS) o = o.split(s).join("[REDACTED]"); return o; };

async function api(method, route, body, isForm = false, attempt = 1) {
  const opts = { method, headers: {} };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`${BASE}${route}`, opts);
  } catch (e) {
    // Transient localhost fetch drop (the server briefly stops accepting under heavy AIGC load). Retry
    // with backoff — only network THROWS are retried, not HTTP error responses (those are real).
    if (attempt <= 5 && !isForm) { await sleep(2500 * attempt); return api(method, route, body, isForm, attempt + 1); }
    throw new Error(`${method} ${route} -> network error after ${attempt} attempt(s): ${redact(String(e?.message ?? e))}`);
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${redact(text).slice(0, 300)}`);
  return json && typeof json === "object" && "data" in json ? json.data : json;
}
async function pollJob(jobId, label, timeoutMs = 25 * 60_000) {
  const startedAt = Date.now();
  let softErrors = 0;
  for (;;) {
    let job;
    try { job = await api("GET", `/api/jobs/${jobId}`); softErrors = 0; }
    catch (e) {
      // Tolerate transient job-status read errors (a torn-snapshot 500 or fetch drop) — the next poll
      // reads a clean snapshot. Give up only after several consecutive failures.
      softErrors += 1;
      if (softErrors > 8) throw new Error(`${label}: job-status polling failed ${softErrors}x: ${redact(String(e?.message ?? e))}`);
      await sleep(3000); continue;
    }
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(`${label} failed: ${job.error ?? (job.steps || []).map((s) => s.message).filter(Boolean).join("; ") ?? "unknown"}`);
    if (Date.now() - startedAt > timeoutMs) throw new Error(`${label} timed out`);
    await sleep(3000);
  }
}
function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], { encoding: "utf8" });
  try { const j = JSON.parse(r.stdout || "{}"); return { duration: Number(j.format?.duration ?? 0), width: j.streams?.[0]?.width ?? 0, height: j.streams?.[0]?.height ?? 0 }; } catch { return { duration: 0, width: 0, height: 0 }; }
}
function meanVolumeDb(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0?", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  return m ? Number(m[1]) : null;
}
function sh(cmd, a) { return new Promise((res) => { const p = spawn(cmd, a, { stdio: ["ignore", "pipe", "pipe"] }); let e = ""; p.stderr.on("data", (d) => (e += d)); p.on("close", (code) => res({ code, err: e })); }); }
async function contactSheet(mp4, outPng) { await sh(FFMPEG, ["-y", "-i", mp4, "-vf", "fps=1/1.6,scale=200:-1,tile=3x4", "-frames:v", "1", outPng]); }
async function clipPreviewFrames(mp4, clips, outDir) {
  await rm(outDir, { recursive: true, force: true }); await mkdir(outDir, { recursive: true });
  for (let i = 0; i < (clips || []).length; i += 1) {
    const c = clips[i]; const t = Math.max(0, Number((c.startSec + Math.max(0.05, c.durationSec / 2)).toFixed(3)));
    await sh(FFMPEG, ["-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", path.join(outDir, `clip_${i + 1}.png`)]);
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
  for (let i = 0; i < 120; i += 1) { try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { console.log(`✓ API healthy after ${i + 1}s`); return true; } } catch { /* retry */ } await sleep(1000); }
  throw new Error("API server failed to become healthy within 120s");
}

async function gate(scriptRel, args, outFile) {
  const r = spawnSync(process.execPath, [path.join(ROOT, scriptRel), ...args], { cwd: ROOT, encoding: "utf8", env: childEnv });
  try { return JSON.parse(readFileSync(outFile, "utf8")); } catch { return { error: redact(r.stderr || r.stdout || "gate produced no report").slice(-300) }; }
}

async function runSample(slug) {
  const t = THEMES[slug];
  const samplePath = path.join(ROOT, "test_videos", `${slug}.mov`);
  if (!existsSync(samplePath)) throw new Error(`sample not found: ${samplePath}`);
  const dir = path.join(OUT, slug);
  await mkdir(dir, { recursive: true });
  console.log(`\n=== ${slug}  ←  主题：${t.name} (${t.en}) ===`);
  await writeFile(path.join(dir, "theme.json"), JSON.stringify({ sample: slug, theme: t, prompt: themePrompt(t) }, null, 2));

  // 1) project + upload + analyze (REAL learning)
  const project = await api("POST", "/api/projects", { name: `marking ${slug}`, vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 });
  const buf = await readFile(samplePath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "video/quicktime" }), `${slug}.mov`);
  form.append("role", "example_video");
  form.append("sourcePolicy", "user_authorized");
  const asset = await api("POST", `/api/projects/${project.id}/assets`, form, true);
  console.log(`  uploaded → ${asset.id}; analyzing (Gemini VLM + evidence + ASR/OCR, can take minutes)…`);
  const res = await api("POST", `/api/assets/${asset.id}/analyze`, { purpose: "sample" });
  const template = res.template;
  const analysis = res.analysis?.video ?? res.analysis;
  if (!template) throw new Error("analyze returned no template");
  await writeFile(path.join(dir, "learned-template.json"), JSON.stringify(template, null, 2));
  await writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis ?? null, null, 2));
  console.log(`  learned: videoType=${template.videoType} slots=${template.requiredSlots?.length ?? 0} aiEnrichment=${template.aiEnrichmentStatus ?? "?"}`);

  // 2) generate (async; theme prompt; AIGC fills product visuals)
  const started = await api("POST", "/api/generations?async=true", buildRequest(project.id, template, asset.id, slug, t));
  const job = await pollJob(started.jobId, `${slug} generation`);
  const generationId = job.outputRefs?.generationId;
  if (!generationId) throw new Error(`generation completed without generationId: ${JSON.stringify(job.outputRefs ?? null)}`);
  const gen = await api("GET", `/api/generations/${generationId}`);
  const recipe = gen.timeline?.renderPlan?.renderRecipe;

  // 3) render FFmpeg + Remotion via API
  const finalMp4 = path.join(dir, "final.mp4");
  const ff = await api("POST", `/api/generations/${generationId}/render`, { rendererTarget: "ffmpeg" });
  if (ff.status !== "completed" || !ff.render?.outputPath) throw new Error(`ffmpeg render failed: ${ff.render?.error ?? ff.status}`);
  await copyFile(ff.render.outputPath, finalMp4);
  await contactSheet(finalMp4, path.join(dir, "render-contact-sheet.png"));
  await clipPreviewFrames(finalMp4, gen.timeline?.clips, path.join(dir, "preview_frames"));

  let remotion = { ok: false, error: NO_REMOTION ? "skipped" : undefined };
  if (!NO_REMOTION) {
    try {
      const remMp4 = path.join(dir, "final.remotion.mp4");
      const rr = await api("POST", `/api/generations/${generationId}/render`, { rendererTarget: "remotion_recipe" });
      if (rr.status === "completed" && rr.render?.outputPath) {
        await copyFile(rr.render.outputPath, remMp4);
        await contactSheet(remMp4, path.join(dir, "render-contact-sheet.remotion.png"));
        remotion = { ok: true, meta: probe(remMp4) };
      } else remotion = { ok: false, error: redact(rr.render?.error ?? rr.status ?? "no output").slice(0, 200) };
    } catch (e) { remotion = { ok: false, error: redact(String(e?.message ?? e)).slice(0, 200) }; }
    console.log(`  Remotion: ${remotion.ok ? "OK" : "⚠ " + remotion.error}`);
  }

  // 4) persist the full evidence chain
  await writeFile(path.join(dir, "generation.json"), JSON.stringify(gen, null, 2));
  await writeFile(path.join(dir, "render-recipe.json"), JSON.stringify(recipe ?? null, null, 2));
  await writeFile(path.join(dir, "timeline.json"), JSON.stringify(gen.timeline ?? null, null, 2));
  await writeFile(path.join(dir, "slot-mapping.json"), JSON.stringify(gen.slotMapping ?? [], null, 2));
  await writeFile(path.join(dir, "gap-report.json"), JSON.stringify(gen.gapReport ?? gen.timeline?.gapReport ?? [], null, 2));
  await writeFile(path.join(dir, "fill-plan.json"), JSON.stringify(gen.fillPlan ?? [], null, 2));
  await writeFile(path.join(dir, "technique-atoms.json"), JSON.stringify(template.techniqueAtoms ?? [], null, 2));
  await writeFile(path.join(dir, "aigc-material-fill.json"), JSON.stringify(gen.aigcMaterialFill ?? null, null, 2));
  const se = gen.structureExplanation;
  await writeFile(path.join(dir, "structure-explanation.md"), typeof se === "string" ? se : `# Structure explanation (${slug})\n\n\`\`\`json\n${JSON.stringify(se ?? {}, null, 2)}\n\`\`\`\n`);

  // 4b) multi-version recipes (rubric item 9) — alternate version strategies, recipe-only (no re-render)
  const { generateMigrationResult } = await import(path.join(ROOT, "packages/shared/dist/index.js"));
  const versions = {};
  for (const vs of ["high_click", "high_quality"]) {
    try {
      const vgen = generateMigrationResult({ template, request: buildRequest(project.id, template, asset.id, slug, t, vs) });
      const vrec = vgen.timeline?.renderPlan?.renderRecipe;
      await writeFile(path.join(dir, `render-recipe.${vs}.json`), JSON.stringify(vrec ?? null, null, 2));
      versions[vs] = { primitives: (vrec?.clips ?? []).map((c) => c.selectedPrimitive), layers: (vrec?.layers ?? []).length };
    } catch (e) { versions[vs] = { error: redact(String(e?.message ?? e)).slice(0, 160) }; }
  }
  await writeFile(path.join(dir, "render-recipe.base.json"), JSON.stringify(recipe ?? null, null, 2));
  await writeFile(path.join(dir, "version-diff.md"), [
    `# 多版本生成 (${slug} · ${t.name})`, "",
    "| 版本 | selectedPrimitives | layer 数 |", "|---|---|---|",
    `| base | ${(recipe?.clips ?? []).map((c) => c.selectedPrimitive).join(", ") || "(layer-based)"} | ${(recipe?.layers ?? []).length} |`,
    ...Object.entries(versions).map(([k, v]) => `| ${k} | ${v.primitives ? v.primitives.join(", ") : v.error} | ${v.layers ?? "-"} |`)
  ].join("\n"));

  // 5) gates: render-quality (universal incl. audio + blank) + final-gates (G1-G30)
  const ffMeta = probe(finalMp4);
  const ffVol = meanVolumeDb(finalMp4);
  const rq = await gate("scripts/evaluate-render-quality.mjs",
    ["--render", finalMp4, "--template", path.join(dir, "learned-template.json"), "--generation", path.join(dir, "generation.json"), "--sample", samplePath, "--out", path.join(dir, "render-quality.json")],
    path.join(dir, "render-quality.json"));
  const fg = await gate("scripts/evaluate-final-gates.mjs",
    ["--case-root", dir, "--out", path.join(dir, "final-gates.json")], path.join(dir, "final-gates.json"));

  const summary = {
    sample: slug, theme: t, videoType: template.videoType,
    final: { ...ffMeta, meanVolumeDb: ffVol }, remotion: remotion.ok ? remotion.meta : { ok: false, error: remotion.error },
    slots: template.requiredSlots?.length ?? 0, gaps: (gen.gapReport ?? []).length,
    aigcGenerated: (gen.aigcMaterialFill?.generatedTargetAssets ?? []).length,
    renderQuality: { passed: (rq.gates ?? []).filter((g) => g.passed).length, total: (rq.gates ?? []).length },
    finalGates: fg.summary ?? null
  };
  await writeFile(path.join(dir, "case-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`  ✓ ${slug}: ${ffMeta.width}x${ffMeta.height} ${ffMeta.duration.toFixed(1)}s audio=${ffVol}dB gaps=${summary.gaps} aigc=${summary.aigcGenerated} finalGates=${fg.summary ? fg.summary.pass + "/" + ((fg.gates ?? []).length) : "?"}`);
  return summary;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "themes.json"), JSON.stringify(THEMES, null, 2));
  const startedServer = await ensureServer();
  const samples = ONE_CASE ? ONE_CASE.split(",").map((s) => s.trim()).filter(Boolean) : SAMPLE_ORDER;
  const summaries = [];
  try {
    for (const slug of samples) {
      try { summaries.push(await runSample(slug)); }
      catch (e) { console.error(`✗ ${slug}: ${redact(String(e?.message ?? e))}`); summaries.push({ sample: slug, error: redact(String(e?.message ?? e)).slice(0, 300) }); }
    }
  } finally {
    if (startedServer && !KEEP_SERVER && serverProc) { serverProc.kill("SIGTERM"); }
  }

  // cross-sample diversity (layout NCC) over the FFmpeg finals
  const finals = summaries.filter((s) => !s.error).map((s) => path.join(OUT, s.sample, "final.mp4")).filter(existsSync);
  let diversity = null;
  if (finals.length >= 2) {
    const r = spawnSync(PYTHON, [path.join(ROOT, "scripts/diversity_ncc.py"), ...finals], { cwd: ROOT, encoding: "utf8", env: childEnv });
    try { diversity = JSON.parse(r.stdout); } catch { diversity = { error: redact(r.stderr || "diversity failed").slice(-200) }; }
    await writeFile(path.join(OUT, "diversity_matrix.json"), JSON.stringify(diversity, null, 2));
  }
  await writeFile(path.join(OUT, "RUN_SUMMARY.json"), JSON.stringify({ generatedAt: new Date().toISOString(), samples: summaries, diversity }, null, 2));
  const ok = summaries.filter((s) => !s.error).length;
  console.log(`\n=== marking pipeline DONE: ${ok}/${summaries.length} samples → ${OUT} ===`);
  for (const s of summaries) console.log(s.error ? `  ✗ ${s.sample}: ${s.error}` : `  ✓ ${s.sample} (${s.theme?.name}) ${s.final?.duration?.toFixed?.(1)}s audio=${s.final?.meanVolumeDb}dB`);
  // The spawned API server keeps stdio pipes on the event loop, which would otherwise prevent this
  // process from exiting (the earlier --keep-server "hang"). Exit explicitly now that work is done.
  process.exit(0);
}

main().catch((e) => { console.error(`[marking-pipeline] fatal: ${redact(String(e?.message ?? e))}`); if (serverProc) serverProc.kill("SIGTERM"); process.exit(1); });
