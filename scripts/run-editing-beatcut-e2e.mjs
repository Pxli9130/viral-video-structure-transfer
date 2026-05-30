#!/usr/bin/env node
/**
 * Real end-to-end proof for the evidence-first beat-cut pipeline, driven through the
 * actual HTTP API (no mock): create project -> upload editing.mov -> analyze (real
 * evidence analyzer + Gemini VLM + ASR/OCR) -> generate (self-reconstruction, authorized
 * sample reuse) -> render FFmpeg MP4 -> export -> run the render-quality gate.
 *
 * Requires the API server running (npm run start --workspace @vvst/api), default port 3000.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.VVST_API_BASE ?? `http://localhost:${process.env.APP_PORT ?? 3000}`;
const SAMPLE = path.resolve("test_videos/editing.mov");
const OUT_DIR = "/tmp/editing_e2e";

async function api(method, route, body, isForm = false) {
  const opts = { method, headers: {} };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${route}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 400)}`);
  return json && typeof json === "object" && "data" in json ? json.data : json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a generation job until completed; returns the generationId. Throws on failure/timeout. */
async function pollGenerationJob(jobId, { intervalMs = 3000, timeoutMs = 1_800_000 } = {}) {
  const startedAt = Date.now();
  let lastProgress = -1;
  for (;;) {
    const job = await api("GET", `/api/jobs/${jobId}`);
    if (job.progress !== lastProgress) {
      lastProgress = job.progress;
      console.log(`  … job ${jobId} ${job.status} ${job.progress ?? 0}%`);
    }
    if (job.status === "completed") {
      const generationId = job.outputRefs?.generationId;
      if (!generationId) throw new Error(`job ${jobId} completed without a generationId`);
      return generationId;
    }
    if (job.status === "failed") throw new Error(`generation job failed: ${job.error?.message ?? "unknown"}`);
    if (Date.now() - startedAt > timeoutMs) throw new Error(`generation job ${jobId} timed out after ${timeoutMs}ms`);
    await sleep(intervalMs);
  }
}

async function main() {
  await api("GET", "/healthz");
  console.log("✓ server healthy at", BASE);

  const project = await api("POST", "/api/projects", {
    name: "Editing.mov beat_cut self-reconstruction",
    vertical: "beat_cut", aspectRatio: "9:16", targetDurationSec: 15
  });
  console.log("✓ project", project.id);

  // upload editing.mov as the sample (example_video, authorized)
  const fileBuf = await readFile(SAMPLE);
  const form = new FormData();
  form.append("file", new Blob([fileBuf], { type: "video/quicktime" }), "editing.mov");
  form.append("role", "example_video");
  form.append("sourcePolicy", "user_authorized");
  const sampleAsset = await api("POST", `/api/projects/${project.id}/assets`, form, true);
  console.log("✓ uploaded sample asset", sampleAsset.id);

  // analyze the sample (real evidence analyzer + Gemini VLM + ASR/OCR)
  console.log("… analyzing sample (real providers; this can take a few minutes) …");
  const analyzeRes = await api("POST", `/api/assets/${sampleAsset.id}/analyze`, { purpose: "sample" });
  const template = analyzeRes.template;
  const ev = analyzeRes.analysis?.video?.evidenceTimeline;
  console.log(`✓ analyzed: videoType=${template?.videoType} aiEnrichment=${template?.aiEnrichmentStatus} `
    + `evidenceShots=${ev?.shots?.length} bpm=${ev?.beatGrid?.bpm} blackBgRatio=${ev?.stats?.blackBgRatio}`);

  // self-reconstruction generation, ASYNC: return a jobId immediately, then poll (the full
  // pipeline can exceed a client HTTP timeout when AIGC/Ark is enabled).
  console.log("… generating (async; polling job) …");
  const started = await api("POST", "/api/generations?async=true", {
    projectId: project.id,
    inputMode: "video_plus_prompt",
    prompt: "主题：爆款结构迁移引擎；把这个样例重构成 15 秒同风格短视频：黑底、红黄大字、卡点快剪、动作混剪、结尾行动号召。",
    sourceVideo: { assetId: sampleAsset.id },
    sampleReferenceAssetId: sampleAsset.id,
    selectedTemplateIds: template ? [template.id] : undefined,
    target: { vertical: "beat_cut", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "mp4_render" },
    controls: { pace: "fast", hookIntensity: "aggressive", packagingStyle: "bold", ctaStyle: "direct", creativeMode: "final_creative" },
    constraints: { noSampleVisualCopy: true, sampleAssetReuse: "authorized" }
  });
  const generationId = await pollGenerationJob(started.jobId);
  const gen = await api("GET", `/api/generations/${generationId}`);
  console.log(`✓ generated ${gen.id}: clips=${gen.timeline.clips.length} audioPolicy=${gen.timeline.renderPlan?.audioPolicy} `
    + `beatGrid=${gen.timeline.renderPlan?.beatGrid?.beats?.length} bpm=${gen.timeline.renderPlan?.beatGrid?.bpm}`);
  console.log("  selectedTemplateReason:", gen.selectedTemplateReason);
  const primitives = gen.timeline.clips.map((c) => c.motionPrimitive).filter(Boolean);
  console.log("  motionPrimitives:", primitives.join(", "));
  if (gen.warnings?.length) console.log("  warnings:", gen.warnings.join(" | "));

  // render FFmpeg MP4
  console.log("… rendering FFmpeg MP4 …");
  const render = await api("POST", `/api/generations/${gen.id}/render`, { rendererTarget: "ffmpeg" });
  console.log(`✓ render ${render.render.status}: ${render.render.outputPath}`);
  if (render.render.renderQualityWarnings?.length) console.log("  renderQualityWarnings:", render.render.renderQualityWarnings.join(", "));

  // persist template + generation for the gate
  await writeFile(`${OUT_DIR}.template.json`, JSON.stringify(template, null, 2)).catch(() => {});
  const fs = await import("node:fs/promises");
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "template.json"), JSON.stringify(template, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "generation.json"), JSON.stringify(gen, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "result.json"), JSON.stringify({
    projectId: project.id, sampleAssetId: sampleAsset.id, templateId: template?.id,
    generationId: gen.id, renderOutputPath: render.render.outputPath,
    renderQualityWarnings: render.render.renderQualityWarnings ?? []
  }, null, 2));

  console.log("\nNext: run the v2 moving-material gate:");
  console.log(`  node scripts/evaluate-render-quality.mjs --render "${render.render.outputPath}" \\`);
  console.log(`    --template ${OUT_DIR}/template.json --generation ${OUT_DIR}/generation.json \\`);
  console.log(`    --sample ${SAMPLE} --expect-video-type beat_cut --gates v2 --strict`);
}

main().catch((err) => { console.error("E2E FAILED:", err.message); process.exit(1); });
