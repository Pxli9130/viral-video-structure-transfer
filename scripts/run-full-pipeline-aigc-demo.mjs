#!/usr/bin/env node
/**
 * Full real pipeline with AIGC gap-fill (pics via Google Gemini Nano Banana + subtitles via
 * Gemini), driven through the live HTTP API (async + poll). Assembles every artifact —
 * template, knowledge base, generation, AIGC candidate images, subtitles, rendered MP4 —
 * into a fresh dir. No mock: real providers or a real error.
 *
 * Requires the API server running (npm run dev:api / node apps/api/dist/server.js).
 * Usage: node scripts/run-full-pipeline-aigc-demo.mjs [--sample test_videos/motion_graph_1.mov] [--theme "..."]
 */
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.VVST_API_BASE ?? `http://localhost:${process.env.APP_PORT ?? 3000}`;
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SAMPLE = path.resolve(arg("--sample", "test_videos/motion_graph_1.mov"));
const THEME = arg("--theme", "AI 短视频结构迁移引擎");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const storageGenerated = path.join(repoRoot, "storage", "generated");

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const sampleStem = path.basename(SAMPLE).replace(/\.[^.]+$/, "");
const OUT_DIR = path.join(repoRoot, "docs", "artifacts", `full_pipeline_aigc_${sampleStem}_${stamp}`);

async function api(method, route, body, isForm = false) {
  const opts = { method, headers: {} };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${route}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 500)}`);
  return json && typeof json === "object" && "data" in json ? json.data : json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollJob(jobId, label) {
  const startedAt = Date.now();
  let last = -1;
  for (;;) {
    const job = await api("GET", `/api/jobs/${jobId}`);
    if (job.progress !== last) { last = job.progress; console.log(`  … ${label} ${job.status} ${job.progress ?? 0}%`); }
    if (job.status === "completed") return job.outputRefs?.generationId;
    if (job.status === "failed") throw new Error(`${label} failed: ${job.error?.message ?? "unknown"}`);
    if (Date.now() - startedAt > 1_800_000) throw new Error(`${label} timed out`);
    await sleep(3000);
  }
}

async function main() {
  if (!existsSync(SAMPLE)) throw new Error(`sample not found: ${SAMPLE}`);
  await api("GET", "/healthz");
  console.log(`✓ server ${BASE} · sample=${path.basename(SAMPLE)} · theme="${THEME}"`);

  const project = await api("POST", "/api/projects", { name: `Full AIGC demo · ${THEME}`, vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15 });
  console.log("✓ project", project.id);

  const fileBuf = await readFile(SAMPLE);
  const form = new FormData();
  form.append("file", new Blob([fileBuf], { type: "video/quicktime" }), path.basename(SAMPLE));
  form.append("role", "example_video");
  form.append("sourcePolicy", "user_authorized");
  const sampleAsset = await api("POST", `/api/projects/${project.id}/assets`, form, true);
  console.log("✓ uploaded", sampleAsset.id);

  console.log("… analyzing (real Gemini VLM + evidence + ASR/OCR) …");
  const analyzeRes = await api("POST", `/api/assets/${sampleAsset.id}/analyze`, { purpose: "sample" });
  const template = analyzeRes.template;
  console.log(`✓ analyzed: template=${template?.id} videoType=${template?.videoType} aiEnrichment=${template?.aiEnrichmentStatus}`);

  console.log("… generating WITH AIGC gap-fill (pics: Gemini Nano Banana, subtitles: Gemini) — async …");
  const started = await api("POST", "/api/generations?async=true", {
    projectId: project.id,
    inputMode: "prompt_only",
    prompt: `主题：${THEME}；把样例的结构迁移成 15 秒竖屏短视频：强钩子、产品价值卡、证明卡、行动号召。缺失素材用 AIGC 补全。`,
    sampleReferenceAssetId: sampleAsset.id,
    selectedTemplateIds: template ? [template.id] : undefined,
    target: { vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "mp4_render" },
    controls: {
      pace: "fast", hookIntensity: "strong", packagingStyle: "mg_motion", ctaStyle: "direct",
      allowAigcPlaceholder: true, allowAigcMaterialGeneration: true, allowExternalAigcProvider: true,
      subtitleGenerationMode: "ark_doubao", subtitleDensity: "dense", creativeMode: "final_creative"
    },
    constraints: { noSampleVisualCopy: true }
  });
  const generationId = await pollJob(started.jobId, "generation");
  const gen = await api("GET", `/api/generations/${generationId}`);
  const aigc = gen.aigcMaterialFill;
  console.log(`✓ generated ${gen.id}: clips=${gen.timeline.clips.length}`);
  console.log(`  AIGC: enabled=${aigc?.enabled} provider=${aigc?.provider} externalUsed=${aigc?.externalProviderUsed} `
    + `candidates=${aigc?.candidates?.length ?? 0} usableAssets=${aigc?.generatedTargetAssets?.length ?? 0} sampleFramesSent=${aigc?.sampleFramesSentExternally}`);
  if (aigc?.providerErrors?.length) console.log("  AIGC providerErrors:", aigc.providerErrors.join(" | "));
  const subClips = gen.timeline.clips.filter((c) => c.layers?.some((l) => l.kind === "subtitle" && l.text));
  console.log(`  subtitles: ${subClips.length} clip(s) have subtitle layers`);

  console.log("… rendering FFmpeg MP4 …");
  const render = await api("POST", `/api/generations/${gen.id}/render`, { rendererTarget: "ffmpeg" });
  console.log(`✓ render ${render.render.status}: ${path.basename(render.render.outputPath)}`);

  const kb = await api("GET", `/api/projects/${project.id}/knowledge-base`);

  // ---- assemble deliverable dir ----
  await mkdir(path.join(OUT_DIR, "aigc_images"), { recursive: true });
  await writeFile(path.join(OUT_DIR, "structure-template.json"), JSON.stringify(template, null, 2));
  await writeFile(path.join(OUT_DIR, "knowledge-base.json"), JSON.stringify(kb, null, 2));
  await writeFile(path.join(OUT_DIR, "generation.json"), JSON.stringify(gen, null, 2));
  await writeFile(path.join(OUT_DIR, "aigc-material-fill.json"), JSON.stringify(aigc ?? {}, null, 2));

  // copy the rendered MP4
  const renderName = path.basename(render.render.outputPath);
  if (existsSync(render.render.outputPath)) await copyFile(render.render.outputPath, path.join(OUT_DIR, renderName));

  // copy AIGC candidate images by their real candidate paths (stored under the base generation id).
  let copiedImages = 0;
  const seen = new Set();
  for (const cand of aigc?.candidates ?? []) {
    if (!cand.path) continue;
    const abs = path.isAbsolute(cand.path) ? cand.path : path.resolve(repoRoot, cand.path.replace(/^\/+/, ""));
    const fname = path.basename(abs);
    if (seen.has(fname) || !existsSync(abs)) continue;
    seen.add(fname);
    await copyFile(abs, path.join(OUT_DIR, "aigc_images", fname));
    copiedImages += 1;
  }

  const summary = {
    theme: THEME, sample: path.basename(SAMPLE), projectId: project.id, templateId: template?.id,
    generationId: gen.id, videoType: template?.videoType, renderFile: renderName,
    aigc: { provider: aigc?.provider, externalUsed: aigc?.externalProviderUsed, candidates: aigc?.candidates?.length ?? 0,
      usableAssets: aigc?.generatedTargetAssets?.length ?? 0, sampleFramesSentExternally: aigc?.sampleFramesSentExternally,
      providerErrors: aigc?.providerErrors ?? [] },
    subtitleClips: subClips.length, copiedAigcImages: copiedImages, generatedAt: new Date().toISOString()
  };
  await writeFile(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\n✓ DELIVERABLE → ${path.relative(repoRoot, OUT_DIR)}`);
  console.log(`  files: structure-template.json, knowledge-base.json, generation.json, aigc-material-fill.json, ${renderName}, aigc_images/ (${copiedImages})`);
  console.log("  summary:", JSON.stringify(summary.aigc));
}
main().catch((e) => { console.error("FULL PIPELINE FAILED:", e.message); process.exit(1); });
