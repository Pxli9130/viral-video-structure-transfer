#!/usr/bin/env node
/**
 * Minimal Seedance (Volcengine Ark doubao-seedance) text-to-video try-out.
 *
 * Submits a generation task to Ark, polls until the task finishes, prints the video URL.
 * Uses an Ark bearer key from SEEDANCE_ARK_API_KEY, SEEDREAM_ARK_API_KEY, or ARK_API_KEY
 * (loaded from repo .env).
 *
 *   export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:$PATH"
 *   node scripts/try-seedance.mjs                       # 16:9, 31s, 720p, audio on, no watermark
 *   node scripts/try-seedance.mjs --duration 12 --resolution 1080p
 *   node scripts/try-seedance.mjs --prompt-file path/to/prompt.txt --no-audio --watermark
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// --- tiny .env loader (does not override already-set env vars) ---
function loadDotenv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadDotenv(path.join(ROOT, ".env"));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const BASE = (process.env.SEEDREAM_ARK_BASE_URL || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
const KEY = process.env.SEEDANCE_ARK_API_KEY || process.env.SEEDANCE_API_KEY || process.env.SEEDREAM_ARK_API_KEY || process.env.ARK_API_KEY;
const MODEL = arg("--model", process.env.SEEDANCE_MODEL || process.env.AIGC_VIDEO_MODEL || "doubao-seedance-2-0-fast-260128");
const DURATION = Number(arg("--duration", "31"));
const RATIO = arg("--ratio", "16:9");
const RESOLUTION = arg("--resolution", "720p");
const PROMPT_FILE = path.resolve(arg("--prompt-file", path.join(HERE, "seedance-prompt.txt")));
const GENERATE_AUDIO = !argv.includes("--no-audio");
const WATERMARK = argv.includes("--watermark");
const POLL_MS = 6000;
const TIMEOUT_MS = 30 * 60 * 1000;

if (!KEY) { console.error("✗ Missing SEEDANCE_ARK_API_KEY, SEEDANCE_API_KEY, SEEDREAM_ARK_API_KEY, or ARK_API_KEY in env/.env"); process.exit(1); }
if (!existsSync(PROMPT_FILE)) { console.error(`✗ prompt file not found: ${PROMPT_FILE}`); process.exit(1); }
const redact = (s) => String(s ?? "").split(KEY).join("[ARK_KEY]");
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const prompt = readFileSync(PROMPT_FILE, "utf8").trim();

const body = {
  model: MODEL,
  content: [{ type: "text", text: prompt }],
  generate_audio: GENERATE_AUDIO,
  ratio: RATIO,
  duration: DURATION,
  resolution: RESOLUTION,
  watermark: WATERMARK
};

console.log(`▶ Seedance try: model=${MODEL}`);
console.log(`  base=${BASE} key=[ARK_KEY]`);
console.log(`  ratio=${RATIO} duration=${DURATION}s resolution=${RESOLUTION} audio=${GENERATE_AUDIO} watermark=${WATERMARK}`);
console.log(`  prompt: ${prompt.length} chars from ${path.relative(ROOT, PROMPT_FILE)}`);

const createRes = await fetch(`${BASE}/contents/generations/tasks`, { method: "POST", headers, body: JSON.stringify(body) });
const createText = await createRes.text();
let created; try { created = JSON.parse(createText); } catch { created = createText; }
if (!createRes.ok || !created?.id) {
  console.error(`✗ task create failed (HTTP ${createRes.status}):`);
  console.error(redact(typeof created === "string" ? created : JSON.stringify(created, null, 2)));
  process.exit(2);
}
const taskId = created.id;
console.log(`✓ task created: ${taskId} — polling every ${POLL_MS / 1000}s…`);

const t0 = Date.now();
let last = "";
for (;;) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  let res, txt;
  try { res = await fetch(`${BASE}/contents/generations/tasks/${taskId}`, { headers }); txt = await res.text(); }
  catch (e) { console.error(`  poll error: ${redact(String(e?.message ?? e))}`); continue; }
  let job; try { job = JSON.parse(txt); } catch { job = txt; }
  if (!res.ok) { console.error(`  poll HTTP ${res.status}: ${redact(txt).slice(0, 300)}`); continue; }
  const status = job.status;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  if (status !== last) { console.log(`  [${elapsed}s] status=${status}`); last = status; }
  if (status === "succeeded") {
    const url = job.content?.video_url || job.content?.[0]?.video_url || job.video_url;
    console.log("\n✅ SUCCEEDED");
    console.log("video_url:", url);
    console.log(redact(JSON.stringify({ id: job.id, model: job.model, usage: job.usage, content: job.content }, null, 2)));
    process.exit(0);
  }
  if (["failed", "canceled", "cancelled"].includes(status)) {
    console.error(`\n✗ task ${status}`);
    console.error(redact(JSON.stringify(job.error ?? job, null, 2)));
    process.exit(3);
  }
  if (Date.now() - t0 > TIMEOUT_MS) { console.error(`✗ timed out after 30m; task id=${taskId}`); process.exit(4); }
}
