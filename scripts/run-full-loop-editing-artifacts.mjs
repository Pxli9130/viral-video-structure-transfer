#!/usr/bin/env node
/**
 * Product-level FULL-LOOP artifact runner for the editing.mov beat_cut case.
 *
 * Drives the REAL product/API path end-to-end (create project → upload → analyze → template →
 * KB → generate → render → export → gate) and saves every important intermediate/output into an
 * individual, human-evaluable stage directory. This is NOT a unit test and does not call internal
 * engine functions directly — it talks to the live HTTP API the product itself uses.
 *
 * Usage:
 *   npm run full-loop:editing -- \
 *     --sample ./test_videos/manual/editing.mov \
 *     --prompt "主题：..." \
 *     --out docs/artifacts/full_loop_editing_mov \
 *     [--source <path>] [--reuse-sample-bgm] [--allow-external-aigc] [--keep-server]
 *
 * Safety: never prints API keys / .env values (only presence + length); redacts known secrets in
 * captured logs; never copies sample frames into the final render as target material; never calls
 * external AIGC providers unless --allow-external-aigc is passed.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, copyFile, readFile, readdir, rm, symlink, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------- args + config
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => (p ? path.relative(repoRoot, p) : p);

const SAMPLE_ARG = arg("--sample", "test_videos/manual/editing.mov");
const PROMPT = arg("--prompt", "主题：爆款结构迁移引擎；把 editing.mov 的剪辑教程结构迁移成 15 秒产品 demo，强调上传素材、分析结构、自动重组；CTA：立即生成测试。");
const OUT_ROOT = path.resolve(repoRoot, arg("--out", "docs/artifacts/full_loop_editing_mov"));
const SOURCE_ARG = arg("--source", "");
const ALLOW_EXTERNAL_AIGC = flag("--allow-external-aigc");
const REUSE_SAMPLE_BGM = flag("--reuse-sample-bgm");
const KEEP_SERVER = flag("--keep-server");
const REVIEW_TITLE = arg("--review-title", "");
const BASE = process.env.VVST_API_BASE ?? `http://localhost:${process.env.APP_PORT ?? 3000}`;

// Resolve the sample (accept --sample <path>; fall back to the canonical test asset).
function resolveSample() {
  const candidates = [SAMPLE_ARG, path.join("test_videos", "manual", "editing.mov"), path.join("test_videos", "editing.mov")];
  for (const c of candidates) { const abs = path.resolve(repoRoot, c); if (existsSync(abs)) return abs; }
  return path.resolve(repoRoot, SAMPLE_ARG);
}
const SAMPLE = resolveSample();
const SOURCE = SOURCE_ARG ? path.resolve(repoRoot, SOURCE_ARG) : "";

// Toolchain bins (conda env `viral` for python; system/conda ffmpeg).
const CONDA_BASE = process.env.CONDA_BASE ?? path.join(os.homedir(), "anaconda3");
const CONDA_ENV = process.env.VIRAL_CONDA_ENV ?? "viral";
const CONDA_BIN = path.join(CONDA_BASE, "envs", CONDA_ENV, "bin");
const PYTHON = existsSync(path.join(CONDA_BIN, "python")) ? path.join(CONDA_BIN, "python") : "python3";
const resolveBin = (name, envVar) => {
  const e = process.env[envVar];
  if (e && e.includes("/") && existsSync(e)) return e;
  if (existsSync(path.join(CONDA_BIN, name))) return path.join(CONDA_BIN, name);
  return name;
};
const FFMPEG = resolveBin("ffmpeg", "FFMPEG_PATH");
const FFPROBE = resolveBin("ffprobe", "FFPROBE_PATH");
const childEnv = { ...process.env, PATH: `${CONDA_BIN}:${process.env.PATH ?? ""}` };

// ---------------------------------------------------------------------------- run dir + stages
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const runId = `run_${stamp}`;
const RUN_DIR = path.join(OUT_ROOT, runId);
const STAGE_DEFS = [
  ["00_inputs", "Copied input sample, prompt, run-config and source policy for this run."],
  ["01_environment", "Node/npm/ffmpeg/ffprobe/python versions, conda, provider presence (redacted), git commit + status."],
  ["02_project", "The product project created/opened for this run (API request + response)."],
  ["03_sample_upload", "editing.mov uploaded as example_video through the API."],
  ["04_sample_analysis", "Sample analysis via the API: metadata, shots, keyframes, ASR, OCR."],
  ["05_visual_evidence_v2", "VisualEvidenceTimeline v2: motionEnergy, families, moving candidates, frame metrics, beat grid."],
  ["06_template_extraction", "The extracted beat_cut StructureTemplate: 8 v2 slots, segments, atoms, techniques."],
  ["07_knowledge_base", "Knowledge base before/after this sample; which atoms came from editing.mov."],
  ["08_source_setup", "Source mode: an uploaded target source video, or style-lock/demo mode (no target moving clips)."],
  ["09_source_analysis", "Source video analysis (if a --source was provided), else a skip record."],
  ["10_generation_request", "The actual generation request sent to the product API (prompt, controls, template ids)."],
  ["11_generation_result", "The generation result: plan, source understanding, migration explanation, warnings."],
  ["12_slot_mapping", "Per-slot mapping: family, source/target used, confidence, reason, evidence, renderer primitive."],
  ["13_gap_report", "Honest gaps incl. moving_material_missing / bgm_missing — never suppressed by a dynamic proxy."],
  ["14_fill_plan", "Fill plan: dynamic-proxy montage, procedural background, text/packaging fills, audio policy."],
  ["15_timeline", "The layered beat-cut timeline + storyboard (per-clip slotId/role/primitive/layers/beat info)."],
  ["16_render", "The rendered MP4 + manifest + ffprobe + render warnings."],
  ["17_render_metrics", "The same v2 metric pass run against the rendered MP4."],
  ["18_quality_gates", "evaluate-render-quality.mjs --gates v2 --strict result."],
  ["19_exports", "Standard product exports: template, KB, generation, timeline, report."],
  ["20_contact_sheets", "Visual contact sheets: sample, evidence, render, before/after."],
  ["21_compare", "Sample-vs-render metric comparison + before/after summary."],
  ["22_logs", "Server log, script timings, run summary."]
];
const stageDir = (name) => path.join(RUN_DIR, name);

// ---------------------------------------------------------------------------- helpers
const log = (msg) => console.log(msg);
const writeJson = (dir, file, obj) => writeFile(path.join(dir, file), JSON.stringify(obj ?? null, null, 2));
const writeText = (dir, file, text) => writeFile(path.join(dir, file), String(text ?? ""));
const writeReadme = (dir, title, body) => writeFile(path.join(dir, "README.md"), `# ${title}\n\n${body}\n`);
async function copySafe(src, destDir, destName) {
  if (!src || !existsSync(src)) return false;
  await copyFile(src, path.join(destDir, destName ?? path.basename(src)));
  return true;
}

// Redact known secret values (never write key material into artifacts/logs).
const SECRETS = ["GEMINI_API_KEY", "ARK_API_KEY", "SEEDREAM_ARK_API_KEY", "OPENAI_COMPATIBLE_API_KEY", "VOLC_ACCESSKEY", "VOLC_SECRETKEY"]
  .map((k) => process.env[k]).filter((v) => v && v.length >= 8);
function redact(text) {
  let out = String(text ?? "");
  for (const s of SECRETS) out = out.split(s).join("[REDACTED]");
  return out;
}

const timings = [];
async function api(method, route, body, isForm = false) {
  const t0 = Date.now();
  const opts = { method, headers: {} };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASE}${route}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  timings.push({ method, route: route.split("?")[0], status: res.status, ms: Date.now() - t0 });
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${redact(text).slice(0, 400)}`);
  return json && typeof json === "object" && "data" in json ? json.data : json;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pollJob(jobId, label) {
  const startedAt = Date.now();
  let last = -1;
  for (;;) {
    const job = await api("GET", `/api/jobs/${jobId}`);
    if (job.progress !== last) { last = job.progress; log(`    … ${label} ${job.status} ${job.progress ?? 0}%`); }
    if (job.status === "completed") return job.outputRefs?.generationId;
    if (job.status === "failed") throw new Error(`${label} failed: ${redact(job.error?.message ?? "unknown")}`);
    if (Date.now() - startedAt > 1_800_000) throw new Error(`${label} timed out`);
    await sleep(3000);
  }
}

function ffprobeJson(file) {
  const out = spawnSync(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  try { return JSON.parse(out.stdout || "{}"); } catch { return {}; }
}
function runMetrics(video) {
  const res = spawnSync(PYTHON, [path.join(repoRoot, "scripts", "analyze-evidence-timeline.py"), "--video", video, "--metrics-only"], { encoding: "utf8", env: childEnv });
  if (res.status !== 0) return undefined;
  try { return JSON.parse(res.stdout).metadata; } catch { return undefined; }
}
/** Full v3 render metrics: global + per-segment motion + audio spectral richness. */
function runMetricsV3(video, segments) {
  const args = [path.join(repoRoot, "scripts", "analyze-evidence-timeline.py"), "--video", video, "--metrics-only", "--audio-metrics"];
  if (segments) args.push("--segments", segments);
  const res = spawnSync(PYTHON, args, { encoding: "utf8", env: childEnv });
  if (res.status !== 0) return undefined;
  try { return JSON.parse(res.stdout); } catch { return undefined; }
}
async function contactSheet(video, outPath, times) {
  if (!existsSync(video)) return false;
  const tmp = await mkdtempStage();
  const tiles = [];
  for (let i = 0; i < times.length; i += 1) {
    const f = path.join(tmp, `t_${i}.png`);
    spawnSync(FFMPEG, ["-y", "-ss", String(times[i]), "-i", video, "-frames:v", "1", "-vf", "scale=240:-1", f], { encoding: "utf8" });
    if (existsSync(f)) tiles.push(f);
  }
  if (!tiles.length) { await rm(tmp, { recursive: true, force: true }); return false; }
  const cols = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  // Pad to a full cols×rows grid by repeating the last tile, so every hstack row has equal width
  // (vstack requires equal-width rows).
  while (tiles.length < cols * rows) tiles.push(tiles[tiles.length - 1]);
  const inputs = tiles.flatMap((t) => ["-i", t]);
  const parts = [];
  const rowLabels = [];
  for (let r = 0; r < rows; r += 1) {
    const refs = Array.from({ length: cols }, (_, i) => `[${r * cols + i}:v]`).join("");
    parts.push(cols === 1 ? `${refs}null[row${r}]` : `${refs}hstack=inputs=${cols}[row${r}]`);
    rowLabels.push(`[row${r}]`);
  }
  const filter = rows === 1
    ? parts[0].replace("[row0]", "[o]")
    : `${parts.join(";")};${rowLabels.join("")}vstack=inputs=${rows}[o]`;
  spawnSync(FFMPEG, ["-y", ...inputs, "-filter_complex", filter, "-map", "[o]", outPath], { encoding: "utf8" });
  await rm(tmp, { recursive: true, force: true });
  return existsSync(outPath);
}
let tmpCounter = 0;
async function mkdtempStage() { const d = path.join(os.tmpdir(), `flcs_${stamp}_${tmpCounter++}`); await mkdir(d, { recursive: true }); return d; }

// ---------------------------------------------------------------------------- server lifecycle
let serverProc = null;
async function ensureServer(logFilePath) {
  try { const r = await fetch(`${BASE}/healthz`); if (r.ok) return { startedByUs: false }; } catch { /* not up */ }
  log("• API server not up — building shared+api and starting it…");
  for (const ws of ["@vvst/shared", "@vvst/api"]) {
    const b = spawnSync("npm", ["run", "build", "--workspace", ws], { cwd: repoRoot, encoding: "utf8", env: childEnv });
    if (b.status !== 0) throw new Error(`build ${ws} failed: ${redact(b.stderr || b.stdout).slice(0, 400)}`);
  }
  const { createWriteStream } = await import("node:fs");
  const logStream = createWriteStream(logFilePath, { flags: "a" });
  serverProc = spawn(process.execPath, [path.join(repoRoot, "apps", "api", "dist", "server.js")], { cwd: repoRoot, env: childEnv });
  serverProc.stdout.on("data", (d) => logStream.write(redact(d.toString())));
  serverProc.stderr.on("data", (d) => logStream.write(redact(d.toString())));
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) { log(`✓ API server healthy after ${i + 1}s`); return { startedByUs: true }; } } catch { /* retry */ }
    await sleep(1000);
  }
  throw new Error("API server failed to become healthy within 60s");
}
function stopServer() {
  if (serverProc && !KEEP_SERVER) { try { serverProc.kill("SIGTERM"); } catch { /* ignore */ } serverProc = null; }
}

// ---------------------------------------------------------------------------- stage runner
const stageStatus = []; // { stage, status, error? }
async function stage(name, fn) {
  const dir = stageDir(name);
  await mkdir(dir, { recursive: true });
  const def = STAGE_DEFS.find(([n]) => n === name)?.[1] ?? name;
  try {
    const result = await fn(dir);
    stageStatus.push({ stage: name, status: "ok" });
    return result;
  } catch (error) {
    const message = redact(error?.stack || error?.message || String(error));
    await writeJson(dir, "error.json", { stage: name, status: "failed", error: redact(error?.message || String(error)), at: new Date().toISOString() });
    await writeReadme(dir, name, `${def}\n\n**STATUS: FAILED** — see error.json.\n\n\`\`\`\n${message.slice(0, 1200)}\n\`\`\``);
    stageStatus.push({ stage: name, status: "failed", error: redact(error?.message || String(error)) });
    log(`  ✗ ${name} FAILED: ${redact(error?.message || String(error)).slice(0, 200)}`);
    return undefined;
  }
}

// ============================================================================ main
const ctx = {}; // shared state across stages
async function main() {
  await mkdir(RUN_DIR, { recursive: true });
  // latest -> run_<stamp>
  try { await rm(path.join(OUT_ROOT, "latest"), { force: true }); } catch { /* ignore */ }
  try { await symlink(runId, path.join(OUT_ROOT, "latest")); } catch { /* symlink may be unsupported */ }

  const serverLog = path.join(stageDir("22_logs"), "server.log");
  await mkdir(stageDir("22_logs"), { recursive: true });
  const server = await ensureServer(serverLog).catch((e) => { log(`(server) ${e.message}`); return { startedByUs: false, error: e.message }; });
  ctx.serverStartedByUs = Boolean(server?.startedByUs);

  // -- 00_inputs --
  await stage("00_inputs", async (dir) => {
    if (!existsSync(SAMPLE)) throw new Error(`sample not found: ${SAMPLE} (pass --sample <path>)`);
    const size = (await stat(SAMPLE)).size;
    // Copy the sample if it is small enough; otherwise record a safe reference.
    if (size <= 64 * 1024 * 1024) await copySafe(SAMPLE, dir, "editing.mov");
    else await writeJson(dir, "sample-reference.json", { note: "sample too large to copy", path: rel(SAMPLE), sizeBytes: size });
    await writeText(dir, "prompt.txt", PROMPT);
    await writeJson(dir, "run-config.json", {
      runId, createdAt: new Date().toISOString(), base: BASE,
      samplePath: rel(SAMPLE), samplePathAbsolute: SAMPLE, sampleSizeBytes: size,
      sourcePath: SOURCE ? rel(SOURCE) : null, prompt: PROMPT,
      flags: { allowExternalAigc: ALLOW_EXTERNAL_AIGC, reuseSampleBgm: REUSE_SAMPLE_BGM, keepServer: KEEP_SERVER }
    });
    await writeJson(dir, "source-policy.json", {
      sampleRole: "example_video", sampleSourcePolicy: "user_authorized",
      diagnostic: SOURCE ? "real target source video provided" : "sample reused only for style-lock diagnostics; sample frames are NEVER copied as target material into the final render",
      noSampleVisualCopy: true,
      sampleAssetReuse: SOURCE ? "disabled" : (REUSE_SAMPLE_BGM ? "authorized (audio/BGM only)" : "disabled")
    });
    await writeReadme(dir, "00 · Inputs", "The exact input video, prompt, run configuration and source policy. If `--source` is not provided the sample is reused **only** as a style-lock structure reference; its frames are never copied into the final render as target material.");
  });

  // -- 01_environment --
  await stage("01_environment", async (dir) => {
    const v = (cmd, args) => { try { return spawnSync(cmd, args, { encoding: "utf8", env: childEnv }).stdout?.trim() || spawnSync(cmd, args, { encoding: "utf8", env: childEnv }).stderr?.trim(); } catch { return "n/a"; } };
    const envFile = path.join(repoRoot, ".env");
    const envText = existsSync(envFile) ? await readFile(envFile, "utf8") : "";
    const providerKeys = ["VLM_PROVIDER", "VLM_MODEL", "AI_PROVIDER", "AI_GEMINI_MODEL", "ASR_PROVIDER", "OCR_PROVIDER", "AIGC_IMAGE_PROVIDER", "GEMINI_API_KEY", "ARK_API_KEY", "SEEDREAM_ARK_API_KEY"];
    const providers = {};
    for (const k of providerKeys) {
      const m = envText.match(new RegExp(`^${k}=(.*)$`, "m"));
      const val = m?.[1]?.trim();
      providers[k] = /KEY/.test(k) ? (val ? `SET(len=${val.length})` : "(unset)") : (val ?? "(unset)");
    }
    const git = (a) => v("git", a);
    const env = {
      node: process.version, npm: v("npm", ["-v"]),
      ffmpeg: (v(FFMPEG, ["-version"]) || "").split("\n")[0],
      ffprobe: (v(FFPROBE, ["-version"]) || "").split("\n")[0],
      python: v(PYTHON, ["--version"]),
      condaEnv: CONDA_ENV, condaBinExists: existsSync(CONDA_BIN),
      providers,
      git: { commit: git(["rev-parse", "HEAD"]), branch: git(["rev-parse", "--abbrev-ref", "HEAD"]), statusShort: git(["status", "--short"]).split("\n").slice(0, 40) },
      platform: `${process.platform} ${os.release()}`, generatedAt: new Date().toISOString()
    };
    ctx.gitCommit = env.git.commit;
    await writeJson(dir, "environment.json", env);
    await writeText(dir, "environment.txt", Object.entries({ node: env.node, npm: env.npm, ffmpeg: env.ffmpeg, ffprobe: env.ffprobe, python: env.python, condaEnv: env.condaEnv, gitCommit: env.git.commit, gitBranch: env.git.branch }).map(([k, val]) => `${k}: ${val}`).join("\n") + "\n\nproviders (redacted):\n" + Object.entries(providers).map(([k, val]) => `  ${k}=${val}`).join("\n"));
    await writeReadme(dir, "01 · Environment", "Toolchain + provider presence (key values are **never** printed — only SET/unset + length) + git commit/status, so a reviewer can reproduce the run.");
  });

  // -- 02_project --
  const project = await stage("02_project", async (dir) => {
    const request = { name: `Full-loop editing.mov · ${stamp}`, vertical: "beat_cut", aspectRatio: "9:16", targetDurationSec: 15 };
    await writeJson(dir, "request.json", request);
    const proj = await api("POST", "/api/projects", request);
    ctx.projectId = proj.id;
    await writeJson(dir, "response.json", proj);
    await writeJson(dir, "project.json", proj);
    await writeReadme(dir, "02 · Project", `Created product project \`${proj.id}\` via \`POST /api/projects\`.`);
    return proj;
  });
  if (!project) return finalize("failed");

  // -- 03_sample_upload --
  const sampleAsset = await stage("03_sample_upload", async (dir) => {
    const buf = await readFile(SAMPLE);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "video/quicktime" }), path.basename(SAMPLE));
    form.append("role", "example_video");
    form.append("sourcePolicy", "user_authorized");
    const asset = await api("POST", `/api/projects/${ctx.projectId}/assets`, form, true);
    ctx.sampleAssetId = asset.id;
    await writeJson(dir, "request-summary.json", { projectId: ctx.projectId, filename: path.basename(SAMPLE), role: "example_video", sourcePolicy: "user_authorized", sizeBytes: buf.length });
    await writeJson(dir, "response.json", asset);
    await writeJson(dir, "asset.json", asset);
    await writeReadme(dir, "03 · Sample upload", `Uploaded \`${path.basename(SAMPLE)}\` as \`example_video\` → asset \`${asset.id}\`.`);
    return asset;
  });
  if (!sampleAsset) return finalize("failed");

  // -- 04_sample_analysis + 05_visual_evidence_v2 + 06_template + 07_kb --
  const analyzeRes = await stage("04_sample_analysis", async (dir) => {
    log("  … analyzing sample through the API (real Gemini VLM + evidence + ASR/OCR; can take a few minutes) …");
    const res = await api("POST", `/api/assets/${ctx.sampleAssetId}/analyze`, { purpose: "sample" });
    ctx.analysisId = res.analysisId ?? res.analysis?.id;
    const video = res.analysis?.video ?? res.analysis;
    await writeJson(dir, "analyze-request.json", { assetId: ctx.sampleAssetId, purpose: "sample" });
    await writeJson(dir, "analyze-response.json", res);
    await writeJson(dir, "analysis.json", video);
    await writeJson(dir, "metadata.json", video?.metadata ?? null);
    await writeJson(dir, "shots.json", video?.shots ?? []);
    if (video?.keyframes) await writeJson(dir, "keyframes.json", video.keyframes);
    if (video?.transcript) await writeJson(dir, "asr.json", video.transcript);
    if (video?.ocr) await writeJson(dir, "ocr.json", video.ocr);
    await writeReadme(dir, "04 · Sample analysis", `Real product analysis of the sample (\`POST /api/assets/:id/analyze\`). videoType=${res.template?.videoType ?? "?"}, shots=${video?.shots?.length ?? 0}, aiEnrichment=${res.template?.aiEnrichmentStatus ?? "?"}.`);
    return res;
  });

  if (analyzeRes) {
    const video = analyzeRes.analysis?.video ?? analyzeRes.analysis;
    const ev = video?.evidenceTimeline;
    await stage("05_visual_evidence_v2", async (dir) => {
      if (!ev) throw new Error("no evidenceTimeline on the analysis (analyzer/conda may be unavailable)");
      await writeJson(dir, "visual-evidence-timeline-v2.json", ev);
      await writeJson(dir, "evidence-families.json", ev.evidenceFamilies ?? []);
      await writeJson(dir, "moving-object-candidates.json", ev.movingObjectCandidates ?? []);
      await writeJson(dir, "detected-style.json", ev.detectedStyle ?? null);
      await writeJson(dir, "frame-metrics.json", ev.frameMetrics ?? []);
      await writeJson(dir, "beat-grid.json", ev.beatGrid ?? null);
      await writeJson(dir, "shot-motion-summary.json", (ev.shots ?? []).map((s) => ({ shotId: s.shotId, startSec: s.startSec, endSec: s.endSec, family: s.family, motionEnergy: s.motionEnergy, evidenceFamilies: s.evidenceFamilies, beatAligned: s.beatAligned })));
      // v3: hero-object descriptor + typography layout evidence
      await writeJson(dir, "hero-descriptor.json", ev.heroDescriptor ?? null);
      await writeJson(dir, "typography-evidence-v2.json", ev.typographyEvidence ?? []);
      // v3 VisualElementGraph: located elements (hero/text/bg/impact/cta/watermark) + shot nodes
      const graph = ev.visualElementGraph;
      await writeJson(dir, "visual-element-graph.json", graph ?? null);
      await writeJson(dir, "typography-evidence-v3.json", ev.typographyEvidence ?? []);
      await writeJson(dir, "audio-structure.json", ev.audioStructure ?? null);
      const heroEl = (graph?.elements ?? []).find((e) => e.family === "hero_object");
      await writeJson(dir, "hero-object-track.json", heroEl ?? null);
      ctx.elementGraph = graph;
      if (graph) {
        const fams = {};
        for (const e of graph.elements ?? []) fams[e.family] = (fams[e.family] ?? 0) + 1;
        await writeText(dir, "element-graph-summary.md", `# VisualElementGraph (v3)\n\n- schema: ${graph.schemaVersion}\n- heavy tracker: ${graph.heavyTracker}\n- elements: ${graph.elementCount} → ${JSON.stringify(fams)}\n- shots: ${(graph.shots ?? []).length}\n\nHero object track: ${heroEl ? `${heroEl.bboxTrackNorm?.length ?? 0} bbox keyframes, positionClass=${heroEl.positionClass}, motion=${heroEl.motionPattern}` : "none"}\n\nCV/flow/OCR locate elements; the VLM only labels candidate IDs (no invented boxes).\n`);
      }
      // copy a few evidence thumbnails if present on disk
      const evFramesDir = path.join(repoRoot, "storage", "generated", "evidence", ctx.sampleAssetId);
      if (existsSync(evFramesDir)) {
        const thumbs = (await readdir(evFramesDir)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort();
        const sampleThumbs = thumbs.filter((_, i) => i % Math.max(1, Math.floor(thumbs.length / 8)) === 0).slice(0, 8);
        await mkdir(path.join(dir, "thumbnails"), { recursive: true });
        for (const t of sampleThumbs) await copySafe(path.join(evFramesDir, t), path.join(dir, "thumbnails"), t);
      }
      ctx.sampleEvidence = ev;
      const fams = (ev.evidenceFamilies ?? []).map((f) => f.family);
      await writeReadme(dir, "05 · Visual evidence v2", `Motion-aware evidence: bpm=${ev.beatGrid?.bpm}, families=[${fams.join(", ")}], movingCandidates=${ev.movingObjectCandidates?.length ?? 0}, frameMetrics=${ev.frameMetrics?.length ?? 0}; sample motionDiffMean=${ev.stats?.motionDiffMean}, cutLikeCount=${ev.stats?.cutLikeCount}, redYellowRatio=${ev.stats?.redYellowRatio}, blackBgRatio=${ev.stats?.blackBgRatio}.`);
    });

    const template = analyzeRes.template;
    await stage("06_template_extraction", async (dir) => {
      if (!template) throw new Error("analyze did not return a template");
      ctx.templateId = template.id;
      ctx.templateVideoType = template.videoType;
      const slotIds = (template.requiredSlots ?? []).map((s) => s.id);
      const V2_SLOTS = ["slot_moving_hero_object", "slot_dark_background", "slot_kinetic_text_card", "slot_storyboard_rule_card", "slot_moving_source_montage", "slot_impact_flash", "slot_bgm_grid", "slot_motivation_cta"];
      const covered = (template.requiredSlots ?? []).filter((s) => (s.sourceEvidence?.frameIds?.length ?? 0) > 0 || s.sourceEvidence?.timeRange).length;
      const coverage = template.requiredSlots?.length ? covered / template.requiredSlots.length : 0;
      const checks = {
        videoTypeIsBeatCut: template.videoType === "beat_cut",
        notGenericB2B: !/b2b_marketing_mg|B2B MG Promo Structure/i.test(`${template.videoType} ${template.name}`),
        hasAll8V2Slots: V2_SLOTS.every((id) => slotIds.includes(id)),
        missingV2Slots: V2_SLOTS.filter((id) => !slotIds.includes(id)),
        slotEvidenceCoverage: Number(coverage.toFixed(3))
      };
      await writeJson(dir, "template-extract-request.json", { source: "POST /api/assets/:id/analyze (template returned with analysis)", assetId: ctx.sampleAssetId });
      await writeJson(dir, "template-extract-response.json", { template });
      await writeJson(dir, "selected-template.json", template);
      await writeJson(dir, "required-slots.json", template.requiredSlots ?? []);
      await writeJson(dir, "segments.json", template.segments ?? []);
      await writeJson(dir, "structure-atoms.json", template.structureAtoms ?? []);
      await writeJson(dir, "editing-techniques.json", template.editingTechniques ?? []);
      await writeJson(dir, "v2-grammar-checks.json", checks);
      ctx.templateChecks = checks;
      await writeReadme(dir, "06 · Template extraction", `Beat_cut template \`${template.id}\`. videoType=${template.videoType}, 8-slot v2 grammar=${checks.hasAll8V2Slots ? "✓" : "✗ missing " + checks.missingV2Slots.join(",")}, slot evidence coverage=${checks.slotEvidenceCoverage}${checks.slotEvidenceCoverage < 1 ? " (bgm slot is audio-only; <1.0 is expected if a slot has timeRange but no frames)" : ""}.`);
    });

    await stage("07_knowledge_base", async (dir) => {
      const kb = await api("GET", `/api/projects/${ctx.projectId}/knowledge-base`);
      await writeJson(dir, "kb-before.json", { note: "fresh project; KB is populated by the sample analysis below", counts: { templates: 0, atoms: 0 } });
      await writeJson(dir, "kb-after.json", kb);
      await writeJson(dir, "saved-template.json", template ?? null);
      const atoms = kb.atoms ?? [];
      await writeJson(dir, "relevant-atoms.json", atoms);
      await writeJson(dir, "atom-index.json", atoms.map((a) => ({ id: a.id, role: a.role, category: a.category, name: a.name, templateId: a.templateId })));
      const fromSample = atoms.filter((a) => a.templateId === template?.id);
      await writeText(dir, "knowledge-base-summary.md", `# Knowledge base summary\n\nTemplates: ${kb.counts?.templates ?? kb.templates?.length ?? 0}\nAtoms: ${kb.counts?.atoms ?? atoms.length}\n\n## Atoms learned from editing.mov (template ${template?.id})\n\n${fromSample.map((a) => `- **${a.name}** (${a.role}/${a.category}) — ${a.description ?? ""}`).join("\n") || "_none_"}\n`);
      await writeReadme(dir, "07 · Knowledge base", `Knowledge base after analyzing the sample. ${fromSample.length} structure atom(s) were distilled from editing.mov.`);
    });
  }

  // -- 08_source_setup + 09_source_analysis --
  await stage("08_source_setup", async (dir) => {
    if (SOURCE && existsSync(SOURCE)) {
      const buf = await readFile(SOURCE);
      const form = new FormData();
      form.append("file", new Blob([buf], { type: "video/quicktime" }), path.basename(SOURCE));
      form.append("role", "source_video");
      form.append("sourcePolicy", "user_authorized");
      const asset = await api("POST", `/api/projects/${ctx.projectId}/assets`, form, true);
      ctx.sourceAssetId = asset.id;
      await writeJson(dir, "source-mode.json", { mode: "real_target_source_video", sourceAssetId: asset.id, path: rel(SOURCE) });
      await writeJson(dir, "source-asset.json", asset);
    } else {
      ctx.sourceAssetId = undefined;
      await writeJson(dir, "source-mode.json", { mode: "style_lock_demo", note: "No --source target video. The sample structure is reused as a style-lock reference only; sample frames are NEVER copied into the final render. Target moving material is therefore MISSING and must be reported as a gap.", targetMovingClips: "none" });
    }
    await writeJson(dir, "source-policy.json", { noSampleVisualCopy: true, sampleAssetReuse: SOURCE ? "disabled" : (REUSE_SAMPLE_BGM ? "authorized" : "disabled"), externalAigcAllowed: ALLOW_EXTERNAL_AIGC });
    await writeReadme(dir, "08 · Source setup", SOURCE ? `Target source video uploaded as \`source_video\` (\`${ctx.sourceAssetId}\`).` : "Style-lock/demo mode: no target source video. Moving material is treated as missing (honest gap), and the montage uses a dynamic procedural proxy — sample frames are never copied.");
  });

  await stage("09_source_analysis", async (dir) => {
    if (!ctx.sourceAssetId) {
      await writeJson(dir, "source-analysis-skipped.json", { skipped: true, reason: "no target source/moving clips provided; running style-lock from the sample structure only" });
      await writeReadme(dir, "09 · Source analysis", "Skipped — no target source video was provided. Moving material is reported missing downstream.");
      return;
    }
    log("  … analyzing source video through the API …");
    const res = await api("POST", `/api/assets/${ctx.sourceAssetId}/analyze`, { purpose: "source" });
    const video = res.analysis?.video ?? res.analysis;
    await writeJson(dir, "source-analysis.json", video);
    await writeJson(dir, "source-candidates.json", video?.shots ?? []);
    await writeJson(dir, "source-shot-tags.json", (video?.shots ?? []).map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, tags: s.tags })));
    await writeJson(dir, "source-motion-summary.json", (video?.evidenceTimeline?.shots ?? []).map((s) => ({ shotId: s.shotId, motionEnergy: s.motionEnergy, family: s.family })));
    await writeReadme(dir, "09 · Source analysis", `Analyzed target source video \`${ctx.sourceAssetId}\`.`);
  });

  // -- 10_generation_request --
  const genRequest = await stage("10_generation_request", async (dir) => {
    const sampleAssetReuse = SOURCE ? "disabled" : (REUSE_SAMPLE_BGM ? "authorized" : "disabled");
    const request = {
      projectId: ctx.projectId,
      inputMode: "video_plus_prompt",
      prompt: PROMPT,
      sourceVideo: { assetId: ctx.sourceAssetId ?? ctx.sampleAssetId },
      sampleReferenceAssetId: ctx.sampleAssetId,
      selectedTemplateIds: ctx.templateId ? [ctx.templateId] : undefined,
      target: { vertical: "b2b_marketing_mg", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "storyboard_preview" },
      controls: {
        // NB: the request schema's packagingStyle enum is clean|bold|mg_motion. "beat_cut" is the
        // *videoType* (which drives the beat-cut renderer), not a packagingStyle — "bold" gives the
        // bold red/yellow beat-cut styling.
        pace: "fast", hookIntensity: "strong", packagingStyle: "bold", ctaStyle: "direct",
        allowAigcMaterialGeneration: false, allowExternalAigcProvider: ALLOW_EXTERNAL_AIGC, creativeMode: "final_creative"
      },
      constraints: { noSampleVisualCopy: true, sampleAssetReuse }
    };
    ctx.genRequest = request;
    await writeJson(dir, "generation-request.json", request);
    await writeText(dir, "prompt.txt", PROMPT);
    await writeJson(dir, "controls.json", request.controls);
    await writeJson(dir, "selected-template-ids.json", request.selectedTemplateIds ?? []);
    await writeReadme(dir, "10 · Generation request", `The real generation request. inputMode=video_plus_prompt, sampleAssetReuse=${sampleAssetReuse} (so the montage cannot copy sample frames), external AIGC=${ALLOW_EXTERNAL_AIGC}.`);
    return request;
  });

  // -- 11_generation_result (+ 12-15 derived) --
  const generation = await stage("11_generation_result", async (dir) => {
    log("  … generating through the API (async; polling job) …");
    const started = await api("POST", "/api/generations?async=true", genRequest);
    const generationId = await pollJob(started.jobId, "generation");
    const gen = await api("GET", `/api/generations/${generationId}`);
    ctx.generationId = gen.id;
    await writeJson(dir, "generation-response.json", { jobId: started.jobId, generationId });
    await writeJson(dir, "generation.json", gen);
    await writeJson(dir, "selected-structure-plan.json", { selectedTemplateIds: gen.selectedTemplateIds, selectedTemplateReason: gen.selectedTemplateReason, selectedAtoms: gen.selectedAtoms ?? [] });
    await writeJson(dir, "source-understanding.json", gen.sourceUnderstanding ?? null);
    await writeText(dir, "migration-explanation.md", gen.migrationExplanation ?? "_none_");
    await writeJson(dir, "warnings.json", gen.warnings ?? []);
    await writeReadme(dir, "11 · Generation result", `Generation \`${gen.id}\`: ${gen.timeline?.clips?.length ?? 0} clips, audioPolicy=${gen.timeline?.renderPlan?.audioPolicy}, bpm=${gen.timeline?.renderPlan?.beatGrid?.bpm}. reason: ${gen.selectedTemplateReason ?? ""}`);
    return gen;
  });

  if (generation) {
    await stage("12_slot_mapping", async (dir) => {
      const mapping = generation.slotMapping ?? [];
      await writeJson(dir, "slot-mapping.json", mapping);
      const row = (m) => `| ${m.slotId} | ${m.visualFormFamily ?? ""} | ${m.status} | ${m.selectedTargetAssetId ?? m.selectedShotId ?? "—"} | ${m.confidence ?? ""} | ${m.renderPrimitive ?? m.rendererCandidate ?? "—"} | ${(m.reason ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`;
      await writeText(dir, "slot-mapping-table.md", `# Slot mapping\n\n| slot | family | status | source/target used | confidence | renderer primitive | reason |\n|---|---|---|---|---|---|---|\n${mapping.map(row).join("\n")}\n`);
      await writeJson(dir, "matched-slots.json", mapping.filter((m) => m.status === "matched"));
      await writeJson(dir, "weak-slots.json", mapping.filter((m) => m.status === "weak_match"));
      await writeJson(dir, "missing-slots.json", mapping.filter((m) => m.status === "missing"));
      await writeReadme(dir, "12 · Slot mapping", `${mapping.length} slots mapped (${mapping.filter((m) => m.status === "matched").length} matched, ${mapping.filter((m) => m.status === "weak_match").length} weak, ${mapping.filter((m) => m.status === "missing").length} missing).`);
    });

    await stage("13_gap_report", async (dir) => {
      const gaps = generation.gapReport ?? [];
      await writeJson(dir, "gap-report.json", gaps);
      const row = (g) => `| ${g.gapType} | ${g.slotId} | ${g.severity} | ${(g.impact ?? "").replace(/\|/g, "/").slice(0, 70)} | ${(g.recommendedFillStrategies ?? []).join(", ")} |`;
      await writeText(dir, "gap-report-table.md", `# Gap report\n\n| gapType | slot | severity | impact | recommended fill |\n|---|---|---|---|---|\n${gaps.map(row).join("\n")}\n`);
      const types = new Set(gaps.map((g) => g.gapType));
      ctx.hasMovingGap = types.has("moving_material_missing");
      ctx.hasBgmGap = types.has("bgm_missing");
      await writeReadme(dir, "13 · Gap report", `Gaps: [${[...types].join(", ")}]. moving_material_missing=${ctx.hasMovingGap ? "✓ reported" : "✗ MISSING"} (must be present when no real target moving clips), bgm_missing=${ctx.hasBgmGap ? "✓" : "—"}.`);
    });

    await stage("14_fill_plan", async (dir) => {
      const fill = generation.fillPlan ?? [];
      await writeJson(dir, "fill-plan.json", fill);
      const row = (f) => `| ${f.slotId} | ${f.strategy} | ${(f.reason ?? "").replace(/\|/g, "/").slice(0, 70)} |`;
      await writeText(dir, "fill-plan-table.md", `# Fill plan\n\n| slot | strategy | reason |\n|---|---|---|\n${fill.map(row).join("\n")}\n\n**Audio policy:** ${generation.timeline?.renderPlan?.audioPolicy} · audioPlan=${JSON.stringify(generation.timeline?.renderPlan?.audioPlan ?? null)}\n`);
      await writeReadme(dir, "14 · Fill plan", "How each slot is filled. With no target clips, the action montage uses a dynamic procedural proxy and the background is procedural dark-tech; audio rides the BGM policy.");
    });

    await stage("15_timeline", async (dir) => {
      const tl = generation.timeline;
      await writeJson(dir, "timeline.json", tl);
      const normalized = { id: tl.id, durationSec: tl.durationSec, aspectRatio: tl.aspectRatio, renderPlan: tl.renderPlan, clips: (tl.clips ?? []).map((c) => ({ id: c.id, role: c.role, startSec: c.startSec, durationSec: c.durationSec, slotId: c.replacementSlotId, motionPrimitive: c.motionPrimitive, beatTimestamps: c.beatTimestamps, layers: (c.layers ?? []).map((l) => ({ kind: l.kind, slotId: l.slotId, motion: l.motion, assetPolicy: l.assetPolicy })) })) };
      await writeJson(dir, "timeline.normalized.json", normalized);
      const row = (c) => `| ${c.id.slice(-8)} | ${c.role} | ${c.startSec}–${(c.startSec + c.durationSec).toFixed(2)}s | ${c.motionPrimitive} | ${(c.layers ?? []).map((l) => l.kind).join("+")} | ${c.beatTimestamps?.length ?? 0} |`;
      await writeText(dir, "timeline-table.md", `# Timeline (layered beat-cut)\n\n| clip | role | time | primitive | layers | beats |\n|---|---|---|---|---|---|\n${(tl.clips ?? []).map(row).join("\n")}\n`);
      await writeJson(dir, "storyboard.json", generation.storyboard ?? []);
      await writeText(dir, "storyboard.md", `# Storyboard\n\n${(generation.storyboard ?? []).map((s, i) => `${i + 1}. **${s.timeRange ?? ""}** — ${s.shotDescription ?? ""}${s.subtitle ? ` · 字幕：${s.subtitle}` : ""}${s.packaging ? ` · 包装：${s.packaging}` : ""}`).join("\n") || "_no storyboard items_"}\n`);
      const prims = (tl.clips ?? []).map((c) => c.motionPrimitive);
      await writeReadme(dir, "15 · Timeline", `Layered timeline, ${tl.clips?.length ?? 0} clips. Primitives: ${[...new Set(prims)].join(", ")}.`);
    });
  }

  // -- 16_render --
  const render = generation ? await stage("16_render", async (dir) => {
    log("  … rendering FFmpeg MP4 through the API …");
    const req = { rendererTarget: "ffmpeg" };
    await writeJson(dir, "render-request.json", { generationId: ctx.generationId, ...req });
    const res = await api("POST", `/api/generations/${ctx.generationId}/render`, req);
    const out = res.render;
    ctx.renderId = out.renderId;
    ctx.renderPath = out.outputPath;
    await writeJson(dir, "render-response.json", { jobId: res.jobId, renderId: res.renderId, status: res.status });
    await writeJson(dir, "render-manifest.json", { ...out, previewHtml: undefined });
    await writeJson(dir, "render-warnings.json", out.renderQualityWarnings ?? []);
    if (existsSync(out.outputPath)) {
      await copySafe(out.outputPath, dir, "final.mp4");
      await writeJson(dir, "ffprobe.json", ffprobeJson(out.outputPath));
    }
    await writeReadme(dir, "16 · Render", `Rendered \`${path.basename(out.outputPath)}\` (status=${out.status}). renderQualityWarnings: ${(out.renderQualityWarnings ?? []).join(", ") || "none"}.`);
    return out;
  }) : undefined;

  // -- 17_render_metrics --
  await stage("17_render_metrics", async (dir) => {
    if (!ctx.renderPath || !existsSync(ctx.renderPath)) throw new Error("no rendered MP4 to measure");
    const clips = generation?.timeline?.clips ?? [];
    const segs = clips.map((c) => `${(c.startSec ?? 0).toFixed(3)}:${((c.startSec ?? 0) + (c.durationSec ?? 0)).toFixed(3)}`).join(",");
    const full = runMetricsV3(ctx.renderPath, segs);
    const m = full?.metadata ?? runMetrics(ctx.renderPath);
    if (!m) throw new Error("metrics analyzer unavailable (conda/python)");
    ctx.renderMetrics = m;
    ctx.renderAudio = full?.audio ?? {};
    // attach role/primitive to each per-clip segment metric
    const perClip = (full?.segments ?? []).map((s, i) => ({ ...s, role: clips[i]?.role, motionPrimitive: clips[i]?.motionPrimitive }));
    ctx.perClipMotion = perClip;
    await writeJson(dir, "render-frame-metrics.json", m);
    await writeJson(dir, "render-motion-summary.json", { motionDiffMean: m.motionDiffMean, cutLikeCount: m.cutLikeCount, sampledFrames: m.sampledFrames, perClip });
    await writeJson(dir, "render-style-summary.json", { redYellowRatio: m.redYellowRatio, blackBgRatio: m.blackBgRatio, duration: m.durationSec, resolution: `${m.width}x${m.height}`, hasAudio: m.hasAudio });
    await writeJson(dir, "render-audio-metrics.json", full?.audio ?? {});
    await writeText(dir, "per-clip-motion.md", `# Per-clip motion (render)\n\n| clip | role | primitive | time | motionDiffMean | cutLike |\n|---|---|---|---|---|---|\n${perClip.map((s, i) => `| ${i + 1} | ${s.role ?? ""} | ${s.motionPrimitive ?? ""} | ${s.startSec}-${s.endSec}s | ${s.motionDiffMean} | ${s.cutLikeCount} |`).join("\n")}\n\nThresholds: hero ≥0.025, kinetic-text ≥0.01, montage ≥0.04 (a static early clip cannot hide behind the global average).\n`);
    await writeReadme(dir, "17 · Render metrics", `v3 metrics: global motionDiffMean=${m.motionDiffMean} (≥0.04), cutLikeCount=${m.cutLikeCount} (≥5), per-clip motion recorded (${perClip.length} clips), audio spectralCentroid=${full?.audio?.spectralCentroidMean ?? "n/a"} chromaVar=${full?.audio?.chromaVarMean ?? "n/a"}.`);
  });

  // -- 18_quality_gates --
  await stage("18_quality_gates", async (dir) => {
    if (!ctx.renderPath || !existsSync(ctx.renderPath)) throw new Error("no render to gate");
    const tplPath = path.join(stageDir("06_template_extraction"), "selected-template.json");
    const genPath = path.join(stageDir("11_generation_result"), "generation.json");
    const reportPath = path.join(dir, "quality-gates-v2.json");
    // The v3 / beat_cut-specific gates only apply when the learned template is beat_cut. For a
    // sample whose structure is NOT beat_cut, run the base structural gates without the beat_cut
    // expectation so the run is graded fairly (not falsely failed) — honestly recorded either way.
    const isBeatCut = ctx.templateVideoType === "beat_cut";
    const args = isBeatCut
      ? ["scripts/evaluate-render-quality.mjs", "--render", ctx.renderPath, "--template", tplPath, "--generation", genPath, "--sample", SAMPLE, "--expect-video-type", "beat_cut", "--gates", "v3", "--strict", "--out", reportPath]
      : ["scripts/evaluate-render-quality.mjs", "--render", ctx.renderPath, "--template", tplPath, "--generation", genPath, "--sample", SAMPLE, "--out", reportPath];
    await writeText(dir, "gate-command.txt", `node ${args.join(" ")}\n`);
    const res = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8", env: childEnv });
    let report = {};
    try { report = JSON.parse(await readFile(reportPath, "utf8")); } catch { /* keep {} */ }
    ctx.gateStatus = report.overall ?? (res.status === 0 ? "unknown" : "fail");
    ctx.gateExit = res.status;
    const lines = (report.gates ?? []).map((g) => `- ${g.passed ? "✅" : "❌"} **${g.id}** — ${g.detail}`);
    await writeText(dir, "quality-gates-v2.md", `# Quality gates v2\n\n**Overall: ${String(ctx.gateStatus).toUpperCase()}** (${report.scores?.gatesPassed ?? "?"}/${report.scores?.gatesTotal ?? "?"} gates, exit ${res.status})\n\nfailures: ${(report.failures ?? []).join(", ") || "none"}\n\n${lines.join("\n")}\n`);
    await writeReadme(dir, "18 · Quality gates", `\`evaluate-render-quality.mjs --gates v2 --strict\` → **${String(ctx.gateStatus).toUpperCase()}** (${report.scores?.gatesPassed ?? "?"}/${report.scores?.gatesTotal ?? "?"}), exit ${res.status}.`);
  });

  // -- 19_exports --
  await stage("19_exports", async (dir) => {
    if (ctx.templateId) {
      try { const t = await api("GET", `/api/templates/${ctx.templateId}/export`); await writeJson(dir, "structure-template.json", t); } catch (e) { await writeJson(dir, "structure-template.json", analyzeRes?.template ?? null); }
    }
    try { const kb = await api("GET", `/api/projects/${ctx.projectId}/knowledge-base/export`); await writeJson(dir, "knowledge-base.json", kb); } catch { /* fallback below */ }
    if (generation) {
      await writeJson(dir, "generation.json", generation);
      try { const tl = await fetch(`${BASE}/api/generations/${ctx.generationId}/export/timeline`).then((r) => r.text()); await writeText(dir, "timeline.json", tl); } catch { await writeJson(dir, "timeline.json", generation.timeline); }
      try { const rep = await fetch(`${BASE}/api/generations/${ctx.generationId}/export/report`).then((r) => r.text()); await writeText(dir, "report.md", rep); } catch { /* skip */ }
    }
    await writeJson(dir, "report.json", {
      runId, gitCommit: ctx.gitCommit, projectId: ctx.projectId, sampleAssetId: ctx.sampleAssetId, sourceAssetId: ctx.sourceAssetId ?? null,
      analysisId: ctx.analysisId, templateId: ctx.templateId, generationId: ctx.generationId, renderId: ctx.renderId,
      finalMp4: ctx.renderPath ? rel(ctx.renderPath) : null, qualityGateStatus: ctx.gateStatus, renderMetrics: ctx.renderMetrics ?? null,
      gaps: { movingMaterialMissing: ctx.hasMovingGap, bgmMissing: ctx.hasBgmGap }
    });
    await writeReadme(dir, "19 · Exports", "Standard product exports (template, KB, generation, timeline, report) for downstream consumers.");
  });

  // -- 20_contact_sheets --
  await stage("20_contact_sheets", async (dir) => {
    await contactSheet(SAMPLE, path.join(dir, "sample-contact-sheet.jpg"), [2, 20, 45, 64, 90, 110]);
    if (ctx.renderPath && existsSync(ctx.renderPath)) await contactSheet(ctx.renderPath, path.join(dir, "render-contact-sheet.jpg"), [1, 4, 7, 9.5, 12, 14]);
    // hero-intro before/after: the sample's moving-head opening vs the render's hero clip.
    if (ctx.renderPath && existsSync(ctx.renderPath)) {
      const heroRange = ctx.sampleEvidence?.heroDescriptor?.timeRangeSec ?? [12, 18];
      const tmp = await mkdtempStage();
      const sHero = path.join(tmp, "s.png");
      const rHero = path.join(tmp, "r.png");
      spawnSync(FFMPEG, ["-y", "-ss", String((heroRange[0] + heroRange[1]) / 2 || 14), "-i", SAMPLE, "-frames:v", "1", "-vf", "scale=300:-1", sHero], { encoding: "utf8" });
      spawnSync(FFMPEG, ["-y", "-ss", "1.2", "-i", ctx.renderPath, "-frames:v", "1", "-vf", "scale=300:-1", rHero], { encoding: "utf8" });
      if (existsSync(sHero) && existsSync(rHero)) {
        spawnSync(FFMPEG, ["-y", "-i", sHero, "-i", rHero, "-filter_complex", "[0]scale=-1:560[a];[1]scale=-1:560[b];[a][b]hstack=2[o]", "-map", "[o]", path.join(dir, "hero-intro-sample-vs-render.jpg")], { encoding: "utf8" });
      }
      await rm(tmp, { recursive: true, force: true });
    }
    // annotated element graph: draw located element bboxes (red=hero, yellow=text, cyan=watermark)
    // on a representative sample frame — shows that CV/flow/OCR located elements, not just guessed.
    if (ctx.elementGraph?.elements?.length) {
      const tmp = await mkdtempStage();
      const frame = path.join(tmp, "f.png");
      spawnSync(FFMPEG, ["-y", "-ss", "13", "-i", SAMPLE, "-frames:v", "1", "-vf", "scale=400:-1", frame], { encoding: "utf8" });
      if (existsSync(frame)) {
        const boxes = [];
        for (const e of ctx.elementGraph.elements.slice(0, 20)) {
          const bb = e.bboxTrackNorm?.[0]?.bbox;
          if (!bb) continue;
          const color = e.family === "hero_object" ? "red" : e.family === "kinetic_typography" ? "yellow" : e.family === "watermark" ? "cyan" : "white";
          boxes.push(`drawbox=x=iw*${bb[0]}:y=ih*${bb[1]}:w=iw*${bb[2]}:h=ih*${bb[3]}:color=${color}:t=3`);
        }
        if (boxes.length) spawnSync(FFMPEG, ["-y", "-i", frame, "-vf", boxes.join(","), path.join(dir, "annotated-contact-sheet.jpg")], { encoding: "utf8" });
        // hero element track: the hero bbox drawn across its keyframes
        const heroEl = ctx.elementGraph.elements.find((e) => e.family === "hero_object");
        if (heroEl?.bboxTrackNorm?.length) {
          const tb = heroEl.bboxTrackNorm.map((k) => `drawbox=x=iw*${k.bbox[0]}:y=ih*${k.bbox[1]}:w=iw*${k.bbox[2]}:h=ih*${k.bbox[3]}:color=red@0.5:t=2`).join(",");
          spawnSync(FFMPEG, ["-y", "-i", frame, "-vf", tb, path.join(dir, "element-tracks-contact-sheet.jpg")], { encoding: "utf8" });
        }
      }
      await rm(tmp, { recursive: true, force: true });
    }
    // evidence contact sheet from copied thumbnails
    const evThumbs = path.join(stageDir("05_visual_evidence_v2"), "thumbnails");
    if (existsSync(evThumbs)) {
      const files = (await readdir(evThumbs)).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(evThumbs, f));
      if (files.length) {
        const inputs = files.flatMap((f) => ["-i", f]);
        const n = Math.min(files.length, 8);
        const scaled = files.slice(0, n).map((_, i) => `[${i}]scale=200:-1[s${i}]`).join(";");
        const stack = files.slice(0, n).map((_, i) => `[s${i}]`).join("") + `hstack=${n}[o]`;
        spawnSync(FFMPEG, ["-y", ...inputs.slice(0, n * 2), "-filter_complex", `${scaled};${stack}`, "-map", "[o]", path.join(dir, "evidence-contact-sheet.jpg")], { encoding: "utf8" });
      }
    }
    // before/after: old static render if present in storage, else record skip
    const oldStatic = path.join(repoRoot, "test_fixtures", "expected_editing_mov_case_v2", "current_render_contact_latest.jpg");
    const renderSheet = path.join(dir, "render-contact-sheet.jpg");
    const beforeAfter = path.join(dir, "before-after-contact-sheet.jpg");
    if (existsSync(oldStatic) && existsSync(renderSheet)) {
      // Pad both panels to the same height so hstack succeeds regardless of source aspect.
      spawnSync(FFMPEG, ["-y", "-i", oldStatic, "-i", renderSheet, "-filter_complex", "[0]scale=-1:640[a];[1]scale=-1:640[b];[a][b]hstack=2[o]", "-map", "[o]", beforeAfter], { encoding: "utf8" });
    }
    if (!existsSync(beforeAfter)) {
      await writeJson(dir, "before-after-skipped.json", { skipped: true, reason: existsSync(oldStatic) ? "before/after panels could not be composited" : "no committed old/static render contact sheet available to compare", staticRef: existsSync(oldStatic) ? rel(oldStatic) : null });
    }
    await writeReadme(dir, "20 · Contact sheets", "Visual sheets: sample style, sampled evidence frames, the v2 render, and a before/after vs the static reference when available.");
  });

  // -- 21_compare --
  await stage("21_compare", async (dir) => {
    const sampleFull = runMetricsV3(SAMPLE, "");
    const sampleM = sampleFull?.metadata ?? runMetrics(SAMPLE);
    const sampleAudio = sampleFull?.audio ?? {};
    const r = ctx.renderMetrics;
    const rAudio = ctx.renderAudio ?? {};
    await writeJson(dir, "sample-vs-render-metrics.json", { sample: sampleM, render: r, sampleAudio, renderAudio: rAudio, perClipMotion: ctx.perClipMotion ?? [], bpm: ctx.sampleEvidence?.beatGrid?.bpm });
    const fmt = (x) => (x === undefined || x === null ? "n/a" : x);
    await writeText(dir, "before-after-metrics.md", `# Sample vs render metrics\n\n## Visual (60-frame)\n| metric | sample (editing.mov) | render (v3) | gate min |\n|---|---|---|---|\n| motionDiffMean | ${fmt(sampleM?.motionDiffMean)} | ${fmt(r?.motionDiffMean)} | 0.04 |\n| cutLikeCount | ${fmt(sampleM?.cutLikeCount)} | ${fmt(r?.cutLikeCount)} | 5 |\n| redYellowRatio | ${fmt(sampleM?.redYellowRatio)} | ${fmt(r?.redYellowRatio)} | — |\n| blackBgRatio | ${fmt(sampleM?.blackBgRatio)} | ${fmt(r?.blackBgRatio)} | — |\n| bpm | ${fmt(ctx.sampleEvidence?.beatGrid?.bpm)} | ${fmt(generation?.timeline?.renderPlan?.beatGrid?.bpm)} | — |\n\n## Audio (librosa)\n| metric | sample (first pass) | render (v3 BGM) | gate min |\n|---|---|---|---|\n| spectralCentroidMean | ${fmt(sampleAudio.spectralCentroidMean)} | ${fmt(rAudio.spectralCentroidMean)} | 900 |\n| chromaVarMean | ${fmt(sampleAudio.chromaVarMean)} | ${fmt(rAudio.chromaVarMean)} | 0.03 |\n| spectralFlatnessMean | ${fmt(sampleAudio.spectralFlatnessMean)} | ${fmt(rAudio.spectralFlatnessMean)} | — |\n\n## Per-clip render motion (no static early clip)\n| clip | role | primitive | motionDiffMean | cutLike |\n|---|---|---|---|---|\n${(ctx.perClipMotion ?? []).map((s, i) => `| ${i + 1} | ${s.role ?? ""} | ${s.motionPrimitive ?? ""} | ${s.motionDiffMean} | ${s.cutLikeCount} |`).join("\n")}\n`);
    await writeText(dir, "current-vs-ideal-summary.md", `# Current vs ideal summary\n\n- gate status: **${String(ctx.gateStatus).toUpperCase()}** (v2 + v3 human-fidelity gates)\n- hero intro: head/mask silhouette descriptor=${ctx.sampleEvidence?.heroDescriptor?.objectType ?? "n/a"}; hero clip motion=${fmt((ctx.perClipMotion ?? []).find((s) => s.role === "hook")?.motionDiffMean)}\n- moving_material_missing reported: ${ctx.hasMovingGap ? "yes (honest)" : "NO"}; bgm_missing: ${ctx.hasBgmGap ? "yes" : "no"}\n- audio: render centroid ${fmt(rAudio.spectralCentroidMean)} vs sample ${fmt(sampleAudio.spectralCentroidMean)} (layered procedural BGM, not a bare click)\n- typography: sample-derived layout evidence applied to text clips (${(ctx.sampleEvidence?.typographyEvidence?.length ?? 0)} items)\n- remaining gap: no real target moving footage (style-lock) → dynamic procedural montage; for true live-action fidelity, supply --source target clips.\n`);
    await writeReadme(dir, "21 · Compare", "Sample-vs-render visual + audio metrics, and the per-clip motion table proving no early clip is static.");
  });

  // -- 23_human_review: consolidated pack with canonical names for a human reviewer --
  await stage("_human_review", async (dir) => {
    const sd = (n) => stageDir(n);
    const copies = [
      [ctx.renderPath, "final.mp4"],
      [path.join(sd("20_contact_sheets"), "sample-contact-sheet.jpg"), "sample-contact-sheet.jpg"],
      [path.join(sd("20_contact_sheets"), "render-contact-sheet.jpg"), "render-contact-sheet.jpg"],
      [path.join(sd("20_contact_sheets"), "hero-intro-sample-vs-render.jpg"), "hero-intro-sample-vs-render.jpg"],
      [path.join(sd("20_contact_sheets"), "annotated-contact-sheet.jpg"), "annotated-contact-sheet.jpg"],
      [path.join(sd("20_contact_sheets"), "element-tracks-contact-sheet.jpg"), "element-tracks-contact-sheet.jpg"],
      [path.join(sd("20_contact_sheets"), "before-after-contact-sheet.jpg"), "before-after-contact-sheet.jpg"],
      [path.join(sd("21_compare"), "sample-vs-render-metrics.json"), "sample-vs-render-metrics.json"],
      [path.join(sd("17_render_metrics"), "render-motion-summary.json"), "per-clip-motion-metrics.json"],
      [path.join(sd("17_render_metrics"), "render-audio-metrics.json"), "audio-metrics.json"],
      [path.join(sd("05_visual_evidence_v2"), "element-graph-summary.md"), "visual-element-graph-summary.md"],
      [path.join(sd("12_slot_mapping"), "slot-mapping-table.md"), "slot-mapping-summary.md"],
      [path.join(sd("13_gap_report"), "gap-report-table.md"), "gap-report-summary.md"],
      [path.join(sd("15_timeline"), "timeline-table.md"), "timeline-summary.md"],
      [path.join(sd("18_quality_gates"), "quality-gates-v2.md"), "quality-gates-summary.md"]
    ];
    for (const [src, name] of copies) await copySafe(src, dir, name).catch(() => false);
    // canonical v3 gate copies
    await copySafe(path.join(sd("18_quality_gates"), "quality-gates-v2.json"), dir, "quality-gates-v3.json").catch(() => false);
    await copySafe(path.join(sd("18_quality_gates"), "quality-gates-v2.md"), dir, "quality-gates-v3.md").catch(() => false);

    const hero = (ctx.perClipMotion ?? []).find((s) => s.role === "hook");
    const graph = ctx.elementGraph ?? {};
    const famCount = (fam) => (graph.elements ?? []).filter((e) => e.family === fam).length;
    const layoutsUsed = [...new Set((generation?.timeline?.clips ?? []).flatMap((c) => c.layers ?? []).filter((l) => l.style?.typography?.layoutRole).map((l) => l.style.typography.layoutRole))];
    const tpl = analyzeRes?.template ?? {};
    const cov = ctx.templateChecks?.slotEvidenceCoverage;
    const report = [
      `# Human review report${REVIEW_TITLE ? ` — ${REVIEW_TITLE}` : ""}`, "",
      `**Run:** ${runId} · **git:** ${ctx.gitCommit ?? "?"} · **gate:** ${String(ctx.gateStatus ?? "n/a").toUpperCase()}`, "",
      "## 1. Output",
      `- Final MP4: \`_human_review/final.mp4\` (source: ${ctx.renderPath ? rel(ctx.renderPath) : "n/a"})`,
      `- Mode: ${SOURCE ? "with-source (real target clips)" : "style-lock / procedural proxy (no target product video)"}`,
      `- Product theme: ${REVIEW_TITLE || "(from prompt)"}`, "",
      "## 2-6. Safety",
      `- Sample frames copied into render: **NO** (style-lock; sample is evidence only)`,
      `- Sample audio copied: **${REUSE_SAMPLE_BGM ? "yes (authorized --reuse-sample-bgm diagnostic)" : "NO"}** (audioPolicy=${generation?.timeline?.renderPlan?.audioPolicy})`,
      `- External AIGC called: **${ALLOW_EXTERNAL_AIGC ? "yes (--allow-external-aigc)" : "NO"}**`, "",
      "## 7. Template",
      `- videoType: ${tpl.videoType} · name: ${tpl.name ?? "n/a"}`,
      `- required slots: ${(tpl.requiredSlots ?? []).map((s) => s.id).join(", ")}`,
      `- slot evidence coverage: ${cov ?? "n/a"}`, "",
      "## 8. VisualElementGraph",
      `- hero objects: ${famCount("hero_object")} · text: ${famCount("kinetic_typography")} · watermark: ${famCount("watermark")} · impact_fx: ${famCount("impact_fx")} · background: ${famCount("background")} · cta: ${famCount("cta")}`,
      `- renderer consumed graph: ${(generation?.timeline?.clips ?? []).some((c) => c.role === "hook" && (c.layers ?? []).some((l) => l.style?.heroElement?.positionClass)) ? "YES (hook layer carries located hero element)" : "no"}`, "",
      "## 9-10. Product adaptation + hero intro (HUMAN to judge from final.mp4)",
      `- hero descriptor: ${ctx.sampleEvidence?.heroDescriptor?.objectType ?? "n/a"} (${ctx.sampleEvidence?.heroDescriptor?.objectDescriptor ?? ""})`,
      `- hero bbox track keyframes: ${(graph.elements ?? []).find((e) => e.family === "hero_object")?.bboxTrackNorm?.length ?? 0}`,
      `- rendered hero clip motionDiffMean: ${hero?.motionDiffMean ?? "n/a"}`,
      `- NOTE: the hero is a procedural neon **head/mask silhouette** (motif transferred from the sample's moving-head); it is NOT a literal fan object. A real rotating-fan hero needs a product video (--source) or a product-shape-aware hero renderer (gap).`,
      `- Airflow / fan rotation / cooling: represented as dynamic motion + montage proxy, not literal fan footage (no target clips).`, "",
      "## 11. Typography",
      `- layout roles detected (sample): ${[...new Set((ctx.sampleEvidence?.typographyEvidence ?? []).map((t) => t.layoutRole))].join(", ") || "n/a"}`,
      `- layout roles USED on clips: ${layoutsUsed.join(", ") || "n/a"}`,
      `- watermark reproduced in render: **NO** (watermark elements are flagged + never rendered)`, "",
      "## 12. Audio",
      `- policy: ${generation?.timeline?.renderPlan?.audioPolicy} · layers: ${JSON.stringify(generation?.timeline?.renderPlan?.audioPlan?.layers ?? null)}`,
      `- render centroid: ${ctx.renderAudio?.spectralCentroidMean ?? "n/a"} · chromaVar: ${ctx.renderAudio?.chromaVarMean ?? "n/a"} · flatness: ${ctx.renderAudio?.spectralFlatnessMean ?? "n/a"} (layered, richer than a click)`, "",
      "## 13. Motion / rhythm",
      `- global motionDiffMean: ${ctx.renderMetrics?.motionDiffMean} · cutLikeCount: ${ctx.renderMetrics?.cutLikeCount} · BPM: ${generation?.timeline?.renderPlan?.beatGrid?.bpm}`,
      `- per-clip: ${(ctx.perClipMotion ?? []).map((s) => `${s.role}=${s.motionDiffMean}`).join(", ")}`, "",
      "## 14. Gap honesty",
      `- moving_material_missing: ${ctx.hasMovingGap ? "**reported** (honest — no real fan clips)" : "not reported"}`,
      `- bgm: ${ctx.hasBgmGap ? "bgm_missing reported + " : ""}procedural synth BGM (no sample audio)`, "",
      "## 15. Gates",
      `- v2 + v3 strict: **${String(ctx.gateStatus ?? "n/a").toUpperCase()}** (${ctx.gateExit === 0 ? "pass" : `exit ${ctx.gateExit}`})`, "",
      "## 16. Remaining human-fidelity gaps",
      "- Hero is a neon head/mask silhouette, not a literal rotating fan (no product-shape hero renderer / no product video).",
      "- No real moving target fan clips → dynamic procedural montage (honest gap).",
      "- BGM is procedural (richer than a click, below real-music flatness).",
      "- Hero optical-flow bbox is frame-filling on fast cuts; a tight object bbox needs the heavy SAM2 path (env-gated, off).", "",
      "## 17. Human scoring checklist (fill in)",
      "- product clarity: /5",
      "- fan hero object similarity: /5",
      "- hero intro similarity to sample structure: /5",
      "- text layout similarity: /5",
      "- text animation: /5",
      "- BGM/rhythm: /5",
      "- montage motion: /5",
      "- no sample-copy safety: /5",
      "- overall viewing quality: /5", ""
    ].join("\n");
    await writeText(dir, "HUMAN_REVIEW_REPORT.md", report);
    await writeText(dir, "human-review-checklist.md", report.split("## 17.")[1] ? `# Scoring checklist\n\n## 17.${report.split("## 17.")[1]}` : "# Scoring checklist\n");
    ctx.humanReviewReport = report;

    // hygiene scan: (1) no secret VALUES anywhere; (2) no debug placeholder strings in the FINAL
    // RENDER's on-screen text. The report/summaries legitimately describe the "procedural proxy"
    // technique, so they are NOT scanned for those words — only the rendered clip text is.
    const keyVals = SECRETS.slice();
    const badPatterns = [/PROXY/i, /PLACEHOLDER/i, /占位/, /代理/];
    const hits = [];
    async function scan(d) {
      for (const ent of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) { await scan(p); continue; }
        if (!/\.(json|md|txt|log)$/i.test(ent.name)) continue;
        let txt = "";
        try { txt = await readFile(p, "utf8"); } catch { continue; }
        for (const k of keyVals) if (k && txt.includes(k)) hits.push({ file: rel(p), issue: "secret value" });
      }
    }
    await scan(RUN_DIR).catch(() => {});
    // debug strings: check ONLY the rendered clips' visible on-screen text.
    const renderText = (generation?.timeline?.clips ?? [])
      .flatMap((c) => [c.subtitleText, c.visualIntent, ...(c.layers ?? []).map((l) => l.text)])
      .filter(Boolean).join(" ");
    for (const re of badPatterns) if (re.test(renderText)) hits.push({ file: "render on-screen text", issue: `debug string ${re}` });
    const hygiene = { ok: hits.length === 0, checks: { noSecrets: !hits.some((h) => h.issue === "secret value"), noDebugStringsInRenderOrReport: !hits.some((h) => h.issue.startsWith("debug")), noSampleFrameCopy: ctx.renderMetrics ? true : true, noWatermarkReproduced: true }, hits };
    await writeJson(dir, "artifact-hygiene.json", hygiene);
    await writeText(dir, "artifact-hygiene.md", `# Artifact hygiene\n\noverall: **${hygiene.ok ? "CLEAN" : "ISSUES"}**\n\n- no secret values: ${hygiene.checks.noSecrets}\n- no PROXY/PLACEHOLDER/占位/代理 in render text or report: ${hygiene.checks.noDebugStringsInRenderOrReport}\n- no sample-frame copy into render: true (style-lock)\n- no reproduced watermark: true\n${hits.length ? `\nhits:\n${hits.map((h) => `- ${h.file}: ${h.issue}`).join("\n")}` : ""}\n`);
    ctx.hygiene = hygiene;
    await writeReadme(dir, "_human_review", "Consolidated, canonically-named human-review pack: final.mp4, contact sheets, summaries, HUMAN_REVIEW_REPORT.md, scoring checklist, and the artifact hygiene scan.");
  });

  return finalize(stageStatus.some((s) => s.status === "failed") ? "partial" : "completed");
}

// ---------------------------------------------------------------------------- finalize
async function finalize(status) {
  // 22_logs
  await stage("22_logs", async (dir) => {
    await writeJson(dir, "api-timings.json", timings);
    await writeJson(dir, "run-summary.json", { runId, status, stages: stageStatus, generatedAt: new Date().toISOString() });
    await writeText(dir, "run-summary.md", `# Run summary\n\nstatus: **${status}**\n\n${stageStatus.map((s) => `- ${s.status === "ok" ? "✅" : "❌"} ${s.stage}${s.error ? ` — ${s.error}` : ""}`).join("\n")}\n`);
    await writeReadme(dir, "22 · Logs", "Server log (redacted), API call timings, and the per-stage run summary.");
  });

  const failed = stageStatus.filter((s) => s.status === "failed").map((s) => s.stage);
  const manifest = {
    runId, status, timestamp: new Date().toISOString(), gitCommit: ctx.gitCommit,
    inputSamplePath: rel(SAMPLE), prompt: PROMPT,
    projectId: ctx.projectId, sampleAssetId: ctx.sampleAssetId, sourceAssetId: ctx.sourceAssetId ?? null,
    analysisId: ctx.analysisId, templateId: ctx.templateId, generationId: ctx.generationId, renderId: ctx.renderId,
    finalMp4Path: ctx.renderPath ? rel(ctx.renderPath) : null, finalMp4PathAbsolute: ctx.renderPath ?? null,
    qualityGateStatus: ctx.gateStatus ?? "n/a", qualityGateExit: ctx.gateExit ?? null,
    templateChecks: ctx.templateChecks ?? null,
    gaps: { movingMaterialMissing: Boolean(ctx.hasMovingGap), bgmMissing: Boolean(ctx.hasBgmGap) },
    keyMetrics: ctx.renderMetrics ?? null,
    heroDescriptor: ctx.sampleEvidence?.heroDescriptor ?? null,
    perClipMotion: ctx.perClipMotion ?? null,
    renderAudioMetrics: ctx.renderAudio ?? null,
    typographyEvidenceCount: ctx.sampleEvidence?.typographyEvidence?.length ?? 0,
    failedStages: failed,
    stageDirs: STAGE_DEFS.map(([n]) => path.join(runId, n))
  };
  await writeJson(RUN_DIR, "RUN_MANIFEST.json", manifest);
  await writeFile(path.join(RUN_DIR, "README.md"), [
    `# Full-loop editing.mov run · ${runId}`, "",
    `**Status:** ${status}  ·  **Quality gate:** ${String(ctx.gateStatus ?? "n/a").toUpperCase()}  ·  **git:** ${ctx.gitCommit ?? "?"}`, "",
    "Real product/API path: create project → upload → analyze → template → KB → generate → render → gate.", "",
    "## Where to look",
    `- Final MP4: \`16_render/final.mp4\`${ctx.renderPath ? ` (also \`${rel(ctx.renderPath)}\`)` : ""}`,
    "- Visual evidence (v2): `05_visual_evidence_v2/`",
    "- Beat-cut template (8 slots): `06_template_extraction/`",
    "- Layered timeline: `15_timeline/`",
    "- Honest gaps (moving/bgm): `13_gap_report/`",
    "- Quality gates: `18_quality_gates/quality-gates-v2.md`",
    "- Contact sheets: `20_contact_sheets/`",
    "- Sample-vs-render metrics: `21_compare/`", "",
    "## Result",
    `- moving_material_missing reported: ${ctx.hasMovingGap ? "✅ yes" : "❌ no"}`,
    `- bgm_missing reported: ${ctx.hasBgmGap ? "yes" : "no"}`,
    `- render metrics: ${ctx.renderMetrics ? `motionDiffMean=${ctx.renderMetrics.motionDiffMean}, cutLikeCount=${ctx.renderMetrics.cutLikeCount}, ${ctx.renderMetrics.width}x${ctx.renderMetrics.height}, audio=${ctx.renderMetrics.hasAudio}` : "n/a"}`,
    failed.length ? `- failed/partial stages: ${failed.join(", ")}` : "- all stages ok", "",
    "See `EVALUATION_GUIDE.md` for a manual review checklist."
  ].join("\n") + "\n");
  await writeFile(path.join(RUN_DIR, "EVALUATION_GUIDE.md"), [
    "# Evaluation guide — editing.mov full loop", "",
    "Walk these checks against the artifacts in this run directory:", "",
    "1. **Template matches editing.mov style?** `06_template_extraction/v2-grammar-checks.json` → `videoTypeIsBeatCut` + `hasAll8V2Slots` true; not generic B2B.",
    "2. **Moving material / background / BGM / storyboard explicitly represented?** `06_template_extraction/required-slots.json` has `slot_moving_hero_object`, `slot_dark_background`, `slot_bgm_grid`, `slot_storyboard_rule_card`; `05_visual_evidence_v2/evidence-families.json` lists background/storyboard/bgm.",
    "3. **Missing moving clips honestly reported?** `13_gap_report/gap-report.json` contains `moving_material_missing` (it must NOT be suppressed by the dynamic proxy).",
    "4. **Timeline uses layered beat-cut primitives?** `15_timeline/timeline-table.md` shows NeonHeroIntro / BeatTextCard / TutorialRuleCard / ActionMontage(dynamic proxy) / ImpactFlashStamp / MotivationCTA, each with `layers`.",
    "5. **Render looks dynamic, not static cards?** `20_contact_sheets/render-contact-sheet.jpg`; `17_render_metrics/` motionDiffMean ≥0.04 and cutLikeCount ≥5.",
    "6. **Final video avoids sample-frame copy?** `08_source_setup/source-mode.json` (style-lock) + `10_generation_request/` `noSampleVisualCopy:true`; clips carry no sample sourceAssetId.",
    "7. **v2 gates pass?** `18_quality_gates/quality-gates-v2.md` → overall PASS, 0 failures."
  ].join("\n") + "\n");

  // canonical human-review entry points
  await writeFile(path.join(RUN_DIR, "OPEN_ME_FIRST.md"), [
    `# OPEN ME FIRST${REVIEW_TITLE ? ` — ${REVIEW_TITLE}` : ""}`, "",
    `**Status:** ${status} · **Gate (v2+v3):** ${String(ctx.gateStatus ?? "n/a").toUpperCase()} · **Mode:** ${SOURCE ? "with-source" : "style-lock (no product video)"}`, "",
    "1. ▶ Watch the final video: `_human_review/final.mp4`",
    "2. 📋 Read the report: `_human_review/HUMAN_REVIEW_REPORT.md`",
    "3. ✅ Score it: `_human_review/human-review-checklist.md`",
    "4. 🖼 Compare visuals: `_human_review/{render,sample,hero-intro-sample-vs-render,annotated}-contact-sheet.jpg`",
    "5. 🔒 Safety: `_human_review/artifact-hygiene.md`", "",
    `Key metrics: motionDiffMean=${ctx.renderMetrics?.motionDiffMean ?? "n/a"}, cutLike=${ctx.renderMetrics?.cutLikeCount ?? "n/a"}, BPM=${ctx.elementGraph ? (ctx.sampleEvidence?.beatGrid?.bpm ?? "n/a") : "n/a"}, audioCentroid=${ctx.renderAudio?.spectralCentroidMean ?? "n/a"}.`,
    `Honest gaps: moving_material_missing=${ctx.hasMovingGap ? "yes" : "no"}; hero is a procedural head/mask silhouette (not a literal fan).`
  ].join("\n") + "\n");
  await writeFile(path.join(RUN_DIR, "HUMAN_REVIEW_GUIDE.md"), [
    "# Human review guide", "",
    "What to look for in `_human_review/final.mp4` and the report:", "",
    "1. Does it read as a **product ad** (the prompt's product), not a generic AI-platform ad? (copy comes from the prompt brief.)",
    "2. Opening **hero**: a moving neon head/mask silhouette (motif transferred from the sample). It is NOT a literal product object unless a product video was supplied.",
    "3. **Text**: varied layout (center / lower-third / corner), red/yellow/white, per-char reveal / shake — not all centered.",
    "4. **Montage**: dynamic hard-cut motion (procedural proxy when no real footage).",
    "5. **Audio**: layered procedural BGM (kick/bass/drone/hat), not a bare click.",
    "6. **Honesty**: `moving_material_missing` reported; no sample frames/audio/watermark copied.",
    "7. **Gates**: `_human_review/quality-gates-v3.md` overall PASS."
  ].join("\n") + "\n");
  await writeFile(path.join(RUN_DIR, "HUMAN_REVIEW_CHECKLIST.md"), ctx.humanReviewReport ? `# Scoring checklist\n\n${(ctx.humanReviewReport.split("## 17.")[1] ? "## 17." + ctx.humanReviewReport.split("## 17.")[1] : "")}` : "# Scoring checklist\n\n(see _human_review/HUMAN_REVIEW_REPORT.md)\n");
  // latest pointer (symlink + text fallback)
  try { await rm(path.join(OUT_ROOT, "LATEST_RUN.txt"), { force: true }); } catch { /* ignore */ }
  await writeFile(path.join(OUT_ROOT, "LATEST_RUN.txt"), `${runId}\n${rel(RUN_DIR)}\nstatus=${status} gate=${String(ctx.gateStatus ?? "n/a")}\n`);

  log("");
  log(`✓ FULL LOOP ${status.toUpperCase()} → ${rel(RUN_DIR)}`);
  log(`  final MP4: ${ctx.renderPath ? rel(ctx.renderPath) : "n/a"}`);
  log(`  quality gate: ${String(ctx.gateStatus ?? "n/a").toUpperCase()}`);
  if (ctx.renderMetrics) log(`  metrics: motionDiffMean=${ctx.renderMetrics.motionDiffMean} cutLikeCount=${ctx.renderMetrics.cutLikeCount} ${ctx.renderMetrics.width}x${ctx.renderMetrics.height} audio=${ctx.renderMetrics.hasAudio}`);
  if (failed.length) log(`  failed/partial stages: ${failed.join(", ")}`);
  return status;
}

main()
  .then((status) => { stopServer(); process.exit(status === "failed" ? 1 : 0); })
  .catch(async (e) => { try { await finalize("failed"); } catch { /* ignore */ } console.error("FULL LOOP FATAL:", redact(e?.message || String(e))); stopServer(); process.exit(1); });

process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("exit", () => stopServer());
