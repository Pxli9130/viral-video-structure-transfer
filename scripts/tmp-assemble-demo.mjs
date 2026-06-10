#!/usr/bin/env node
// Post-production: build the final demo by (optionally) cropping the walkthrough's AIGC generation waits and
// inserting "✂ 已跳过 AIGC 生成加载等待" cards, then appending a 成片展示 montage of the 5 result videos WITH
// audio (3 showcase + 2 generated), each preceded by a title card. Cards are rendered via headless Chromium
// (so CJK + colour emoji render exactly like the UI). All clips are normalized to 1920x1200/30fps/h264/aac
// stereo so a plain concat is seamless.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = 1920, H = 1200, FPS = 30;
const OUT = path.resolve(process.env.OUT_DIR ?? path.join(ROOT, "artifacts", "final-demo"));
const TMP = path.join(OUT, "_work");
mkdirSync(TMP, { recursive: true });
const FF = process.env.FFMPEG || "ffmpeg";
const ff = (args) => { const r = spawnSync(FF, args, { stdio: ["ignore", "ignore", "pipe"] }); if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ").slice(0, 120)}\n${(r.stderr || "").toString().slice(-500)}`); };
const log = (m) => console.log(`[assemble] ${m}`);

function findChromium() {
  const roots = [path.join(process.env.HOME ?? "", ".cache", "ms-playwright")].filter((d) => existsSync(d));
  const st = [...roots], f = [];
  while (st.length) { const d = st.pop(); for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) st.push(p); else if (["chrome-headless-shell", "chrome"].includes(e.name)) { try { if (statSync(p).mode & 0o111) f.push(p); } catch {} } } }
  return f.sort((a, b) => Number(b.includes("chrome-headless-shell")) - Number(a.includes("chrome-headless-shell")))[0];
}

// ---- card rendering (Chromium screenshot → PNG) ----
let _ctx;
async function cardPng(html, file) {
  const pg = await _ctx.newPage();
  await pg.setViewportSize({ width: W, height: H });
  await pg.setContent(`<body style="margin:0;width:${W}px;height:${H}px;background:radial-gradient(1200px 700px at 50% 40%, #16233b 0%, #0a0f1a 70%);color:#e6edf6;font-family:'Noto Sans CJK SC','Droid Sans Fallback',sans-serif;display:flex;align-items:center;justify-content:center;text-align:center">${html}</body>`);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: file });
  await pg.close();
}
const editCardHtml = `<div><div style="font-size:84px;font-weight:800;letter-spacing:2px">✂ 已跳过 AIGC 生成加载等待</div></div>`;
const titleCardHtml = (zh, sub) => `<div><div style="font-size:96px;font-weight:800">${zh}</div>${sub ? `<div style="margin-top:22px;font-size:40px;color:#9fb3d1;font-weight:500">${sub}</div>` : ""}</div>`;

// ---- clip normalization ----
function cardClip(png, seconds, outMp4) {
  ff(["-y", "-loop", "1", "-t", String(seconds), "-i", png, "-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf", `scale=${W}:${H},fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-shortest", outMp4]);
}
function videoClip(srcMp4, outMp4) {
  // scale to fit inside 1920x1200 (portrait → pillarboxed), keep/normalize audio (add silence if missing)
  const hasAudio = (() => { const r = spawnSync(process.env.FFPROBE || "ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", srcMp4], { encoding: "utf8" }); return /audio/.test(r.stdout || ""); })();
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${FPS},format=yuv420p`;
  if (hasAudio) ff(["-y", "-i", srcMp4, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", outMp4]);
  else ff(["-y", "-i", srcMp4, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", outMp4]);
}
function segmentClip(srcMp4, startSec, endSec, outMp4) {
  const args = ["-y", "-ss", String(startSec), ...(endSec != null ? ["-to", String(endSec)] : []), "-i", srcMp4,
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS},format=yuv420p`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-shortest", outMp4];
  ff(args);
}
function concat(clips, outMp4) {
  const listFile = path.join(TMP, "concat.txt");
  writeFileSync(listFile, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n"));
  ff(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outMp4]);
}

// ---- the 5 result videos (override via env JSON if needed) ----
const VIDEOS = JSON.parse(process.env.DEMO_VIDEOS_JSON ?? JSON.stringify([
  { zh: "成片展示 · 1/5", sub: "烟酰胺美白精华 · 学自 marketing.mov", file: "storage/showcase-runs/run2-marketing/final.mp4" },
  { zh: "成片展示 · 2/5", sub: "AI 智能记账 App · 学自 motion_graph_1.mov", file: "storage/showcase-runs/run3-motiongraph1/final.mp4" },
  { zh: "成片展示 · 3/5", sub: "头戴超级降噪耳机 · 学自 2.mov", file: "storage/showcase-runs/run4-motiongraph2/final.mp4" },
  { zh: "生成 · 用同一个模板", sub: "AI 健身追踪 App · motion_graph_1 模板 + AIGC + Lyria", file: "storage/generated/v5/generations/gen_mq7pwl1d/final.mp4" }
]));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  _ctx = await browser.newContext({ colorScheme: "dark" });
  const clips = [];

  // intro title
  const introPng = path.join(TMP, "intro.png");
  await cardPng(titleCardHtml("成片展示", "3 个 Showcase + 生成成片 · 带音频"), introPng);
  const introClip = path.join(TMP, "00-intro.mp4"); cardClip(introPng, 2.5, introClip); clips.push(introClip);

  let i = 1;
  for (const v of VIDEOS) {
    const src = path.resolve(ROOT, v.file);
    if (!existsSync(src)) { log(`SKIP missing ${v.file}`); continue; }
    const tp = path.join(TMP, `t${i}.png`); await cardPng(titleCardHtml(v.zh, v.sub), tp);
    const tc = path.join(TMP, `t${i}.mp4`); cardClip(tp, 2.2, tc); clips.push(tc);
    const vc = path.join(TMP, `v${i}.mp4`); videoClip(src, vc); clips.push(vc);
    log(`added ${v.zh} (${v.file})`);
    i++;
  }
  await browser.close();

  const montage = path.join(OUT, "montage.mp4");
  concat(clips, montage);
  log(`montage written: ${montage}`);
  // probe
  const r = spawnSync(process.env.FFPROBE || "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "default=nw=1", montage], { encoding: "utf8" });
  log(`montage info: ${(r.stdout || "").replace(/\n/g, " ")}`);
  writeFileSync(path.join(OUT, "assemble-info.json"), JSON.stringify({ clips: clips.length, videos: VIDEOS, montage }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
