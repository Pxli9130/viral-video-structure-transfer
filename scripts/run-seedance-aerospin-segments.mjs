#!/usr/bin/env node
/**
 * Seedance 3-segment AeroSpin fan ad: generate 3 self-contained ~10s t2v segments in parallel,
 * download them, then ffmpeg-normalize + concat into one ~30s ad.
 *
 * doubao-seedance-2-0 t2v rejects duration=31, so the 31s storyboard is split into 3 acts.
 * Uses SEEDREAM_ARK_API_KEY (the key ending c6c07), loaded from repo .env. Key is redacted in logs.
 *
 *   export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"
 *   node scripts/run-seedance-aerospin-segments.mjs                 # 10s x3, 16:9, 720p, audio, no watermark
 *   node scripts/run-seedance-aerospin-segments.mjs --duration 12   # try longer segments if supported
 *   node scripts/run-seedance-aerospin-segments.mjs --no-concat     # generate + download only
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

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
const KEY = process.env.SEEDANCE_ARK_API_KEY || process.env.SEEDREAM_ARK_API_KEY;
const MODEL = arg("--model", process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-260128");
const DURATION = Number(arg("--duration", "10"));
const RATIO = arg("--ratio", "16:9");
const RESOLUTION = arg("--resolution", "720p");
const GENERATE_AUDIO = !argv.includes("--no-audio");
const WATERMARK = argv.includes("--watermark");
const DO_CONCAT = !argv.includes("--no-concat");
const OUT = path.resolve(arg("--out", "docs/artifacts/seedance_aerospin"));
const FFMPEG = process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.includes("/") ? process.env.FFMPEG_PATH : "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH && process.env.FFPROBE_PATH.includes("/") ? process.env.FFPROBE_PATH : "ffprobe";
const POLL_MS = 6000;
const TIMEOUT_MS = 30 * 60 * 1000;

if (!KEY) { console.error("✗ Missing SEEDREAM_ARK_API_KEY (the key ending c6c07)"); process.exit(1); }
const redact = (s) => String(s ?? "").split(KEY).join("[ARK_KEY]");
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STYLE = "全局视觉风格：背景以纯黑 #000000、深酒红 #4A0000、白色 #F7F7F2 为主，辅助色霓虹洋红 #FF2EA6。粗体几何无衬线字体（类似 Montserrat ExtraBold），主标题白色、字重 800-900、居中。画面干净极简、广告级、高对比度，轻微胶片颗粒和暗角。转场跟随 129 BPM 电子鼓点，使用快速缩放、旋转、motion blur、whoosh、impact。不要出现任何真实第三方品牌，不要出现乱码文字。无水印。";
const HEAD = (n) => `生成一个横屏 16:9 科技产品广告视频片段（第 ${n} 段，共 3 段），分辨率 1280x720，高级 motion graphics 风格。产品为 AeroSpin 便携涡轮小风扇，核心卖点：随身涡轮强风、三档可调、USB-C 快充、低噪音、桌面手持两用。`;

const SEGMENTS = [
  {
    name: "seg1_act1",
    prompt: [
      HEAD(1), STYLE,
      "BGM：129 BPM 现代电子广告音乐，深低频 bass、干净 kick，轻微 build-up。",
      "镜头时间线（本段 0-10 秒）：",
      "0.0-0.8 秒：纯黑背景，中心出现多张圆角图片卡片（内容为白色涡轮小风扇产品图、风扇吹发的人物、USB-C 充电特写、桌面与手持使用场景），圆角 18px、柔和阴影，上下堆叠成垂直 3D 浮动卡栈，从上下边缘滑入中心，带轻微透视和旋转。",
      "0.8-2.0 秒：黑色背景中央出现小号白色粗体短语「开启清凉」，字号约 34px，居中。上下两组卡片像磁吸一样对称靠拢，卡片间距 8-20px，做轻微 z 轴旋转和弹性 scale。",
      "2.0-4.5 秒：卡片从垂直堆叠展开为围绕中心的环形 collage，约 10-12 张圆角卡片形成不规则圆环，顺时针缓慢旋转，每张独立浮动和 3D tilt，前景卡片大、背景卡片小并带景深虚化。中心出现白色粗体文字「强风随行」，字号约 56px。",
      "4.5-6.8 秒：硬切到深酒红背景，中央大标题，第一行「随身强风」（约 54px），第二行更大「随时随地」（约 74px），白色居中；4.8 秒从 80% 放大到 100%，5.2 秒轻微冲击抖动；6 秒一小组小风扇卡片从文字中间纵向穿过向上漂浮。",
      "6.8-10.0 秒：仍为深酒红背景，中心和两侧漂浮多张小风扇卡片，中间依次出现白色小短语「三档强风」、「USB-C 快充」，字号 30-38px 居中偏上，卡片带 motion blur 绕行。",
      "要求：画面高级、干净、广告级、运动流畅，不卡顿，结尾停在深酒红画面以便与下一段衔接。"
    ].join("\n")
  },
  {
    name: "seg2_act2",
    prompt: [
      HEAD(2), STYLE,
      "BGM：129 BPM，能量推进，本段中段有一个大 impact。",
      "镜头时间线（本段 0-10 秒）：",
      "0.0-3.0 秒：黑色背景，画面左侧约 35% 宽区域出现一列大型灰色功能清单纵向滚动（内容：三档强风随心调、USB-C 快充续航久、低噪音不扰眠、桌面手持两用、强劲涡轮、轻巧便携），灰色文字透明度 30-50%，每行约 45px。中央高亮一项「三档强风随心调」，白色大字 48-54px，高亮项左侧有小号霓虹粉三角播放指示符；中间叠加一张半透明的小风扇主体图，带暗边。清单缓慢下滚，高亮项保持中心。",
      "3.0-6.5 秒：硬切回深酒红背景，出现霓虹洋红色发光线框路径（像设计软件贝塞尔曲线），3-5 条亮粉线段、线宽约 3px、带发光，占据中央 40-55%，有浅绿色控制点和小标签气泡，缓慢变形并旋转 5-10 度。中心白色粗体文字依次出现「低噪音」、「不扰眠」，字号 36-46px 居中。",
      "6.5-10.0 秒：硬切到梦幻云端，全屏超现实场景：白色涡轮小风扇产品在粉色、橙色、紫灰色云海中向上漂浮飞跃，顶部巨大白色半透明粗体大字「随身」、底部巨大白色粗体大字「降温」，顶部贴上边缘、底部贴下边缘，略带透视和阴影，镜头轻微推近。",
      "要求：广告级、干净、运动流畅，不卡顿，结尾停在云端画面以便衔接下一段。"
    ].join("\n")
  },
  {
    name: "seg3_act3",
    prompt: [
      HEAD(3), STYLE,
      "BGM：129 BPM，进入梦幻高潮后在末尾快速收束并淡出，最后 0.5 秒安静。",
      "镜头时间线（本段 0-10 秒）：",
      "0.0-4.5 秒：明亮蓝天与粉蓝云海，白色涡轮小风扇产品在巨大粉色云团上平稳滑行，画面梦幻、宽广、电影感；巨大白色粗体文字分层出现：上方超大「清凉」，随后底部超大「无处不在」，文字占画面宽度 45-70%，带轻微阴影；镜头平滑横移，云层缓慢流动。",
      "4.5-7.5 秒：硬切回深酒红抽象背景，背景有两条霓虹洋红色发光光带从画面顶部和底部向中心汇聚成镜像 V 形并模糊发光；中心依次出现白色粗体小字「此刻」、「降温」、「随行」，字号 32-42px，出现时轻微 scale pop，光带在每个鼓点呼吸式变亮。",
      "7.5-10.0 秒：硬切到极简浅灰背景 #F3F3F3，画面中央出现 AeroSpin 风扇 logo 图形（约 60px，居中），约 0.5 秒后右侧淡入品牌名「AeroSpin 便携涡轮小风扇」，深酒红或黑色文字、字号约 36px、字重 700，整体居中；底部出现 CTA 小字「现在入手，随时随地降温」。音乐在最后快速淡出。",
      "要求：广告级、干净、运动流畅、不卡顿，logo 与品牌名清晰。"
    ].join("\n")
  }
];

async function submit(seg) {
  const body = { model: MODEL, content: [{ type: "text", text: seg.prompt }], generate_audio: GENERATE_AUDIO, ratio: RATIO, duration: DURATION, resolution: RESOLUTION, watermark: WATERMARK };
  const res = await fetch(`${BASE}/contents/generations/tasks`, { method: "POST", headers, body: JSON.stringify(body) });
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (!res.ok || !j?.id) throw new Error(`[${seg.name}] create HTTP ${res.status}: ${redact(typeof j === "string" ? j : JSON.stringify(j))}`);
  console.log(`✓ ${seg.name}: task ${j.id}`);
  return { ...seg, id: j.id };
}

async function poll(task) {
  const t0 = Date.now();
  let last = "";
  for (;;) {
    await sleep(POLL_MS);
    let res, txt;
    try { res = await fetch(`${BASE}/contents/generations/tasks/${task.id}`, { headers }); txt = await res.text(); }
    catch (e) { console.error(`  ${task.name} poll error: ${redact(String(e?.message ?? e))}`); continue; }
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!res.ok) { console.error(`  ${task.name} poll HTTP ${res.status}`); continue; }
    const status = j.status, el = ((Date.now() - t0) / 1000).toFixed(0);
    if (status !== last) { console.log(`  [${el}s] ${task.name}: ${status}`); last = status; }
    if (status === "succeeded") return { ...task, url: j.content?.video_url || j.content?.[0]?.video_url || j.video_url, usage: j.usage };
    if (["failed", "canceled", "cancelled"].includes(status)) throw new Error(`[${task.name}] ${status}: ${redact(JSON.stringify(j.error ?? j))}`);
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error(`[${task.name}] timed out`);
  }
}

async function download(r) {
  const file = path.join(OUT, `${r.name}.mp4`);
  const res = await fetch(r.url);
  if (!res.ok) throw new Error(`[${r.name}] download HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  ⬇ ${r.name}.mp4 (${(existsSync(file) ? (readFileSync(file).length / 1e6).toFixed(2) : "?")} MB)`);
  return { ...r, file };
}

function hasAudio(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { encoding: "utf8" });
  return /audio/.test(r.stdout || "");
}
function normalize(file, outFile) {
  const vf = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p";
  const a = hasAudio(file)
    ? [FFMPEG, "-y", "-i", file, "-vf", vf, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-ar", "48000", "-ac", "2", outFile]
    : [FFMPEG, "-y", "-i", file, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-vf", vf, "-map", "0:v", "-map", "1:a", "-shortest", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", outFile];
  const r = spawnSync(a[0], a.slice(1), { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`normalize ${path.basename(file)} failed: ${(r.stderr || "").slice(-300)}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const s of SEGMENTS) await writeFile(path.join(OUT, `${s.name}.prompt.txt`), s.prompt);
  console.log(`▶ Seedance AeroSpin 3-seg: model=${MODEL} key=…${KEY.slice(-5)} ${RATIO} ${DURATION}s x${SEGMENTS.length} ${RESOLUTION} audio=${GENERATE_AUDIO}`);

  // submit all (parallel), then poll all (parallel)
  const tasks = await Promise.all(SEGMENTS.map(submit));
  console.log("• all submitted — polling…");
  const done = await Promise.all(tasks.map(poll));
  console.log("• all succeeded — downloading…");
  const files = await Promise.all(done.map(download));

  const manifest = { model: MODEL, ratio: RATIO, duration: DURATION, resolution: RESOLUTION, generateAudio: GENERATE_AUDIO, segments: files.map((f) => ({ name: f.name, taskId: f.id, url: f.url, file: path.relative(ROOT, f.file), usage: f.usage })) };
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (!DO_CONCAT) { console.log(`\n[done] 3 segments in ${path.relative(ROOT, OUT)} (concat skipped)`); return; }

  console.log("• normalizing + concatenating with ffmpeg…");
  const norm = [];
  for (const f of files) { const n = path.join(OUT, `_norm_${f.name}.mp4`); normalize(f.file, n); norm.push(n); }
  const listFile = path.join(OUT, "_concat.txt");
  writeFileSync(listFile, norm.map((n) => `file '${n}'`).join("\n"));
  const finalMp4 = path.join(OUT, "aerospin_ad.mp4");
  const cc = spawnSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", finalMp4], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error(`concat failed: ${(cc.stderr || "").slice(-300)}`);

  const pr = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", finalMp4], { encoding: "utf8" });
  console.log(`\n✅ [done] → ${path.relative(ROOT, finalMp4)} (${(pr.stdout || "?").trim()}s, 1280x720)`);
  console.log("segment URLs:");
  for (const f of files) console.log(`  ${f.name}: ${f.url}`);
}
main().catch((e) => { console.error("[FAIL]", redact(e?.message ?? String(e))); process.exit(1); });
