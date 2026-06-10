#!/usr/bin/env node
// Focused recorder: ONE same_template AIGC generation (to verify the theme-sweep fix + produce a clean
// "fixed same_template result" clip for splicing into the full demo). Records at 1920x1200 to match.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL = process.env.UI_URL ?? "http://127.0.0.1:5173/#v5";
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? path.join(ROOT, "artifacts", "same-template-fixed-clip"));
const VIDEO_DIR = path.join(OUT_DIR, "raw-video");
const WIDTH = Number(process.env.DEMO_WIDTH ?? 1920);
const HEIGHT = Number(process.env.DEMO_HEIGHT ?? 1200);
const PAUSE = Number(process.env.DEMO_VIEW_PAUSE_MS ?? 1700);
const STEP_PX = Number(process.env.DEMO_SCROLL_STEP_PX ?? 220);
const STEP_MS = Number(process.env.DEMO_SCROLL_STEP_MS ?? 420);
const GEN_WAIT = Number(process.env.GENERATE_WAIT_MS ?? 780000);
const THEME = process.env.DEMO_THEME ?? "护眼桌面灯 / AI 创作平台 demo";
mkdirSync(VIDEO_DIR, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[clip] ${m}`);

function findChromium() {
  const roots = [path.join(process.env.HOME ?? "", ".cache", "ms-playwright"), path.join(ROOT, "node_modules", ".cache", "ms-playwright")].filter((d) => existsSync(d));
  const stack = [...roots], found = [];
  while (stack.length) { const dir = stack.pop(); for (const e of readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, e.name); if (e.isDirectory()) stack.push(full); else if (["chrome-headless-shell", "chrome"].includes(e.name)) { try { if (statSync(full).mode & 0o111) found.push(full); } catch {} } } }
  return found.sort((a, b) => Number(b.includes("chrome-headless-shell")) - Number(a.includes("chrome-headless-shell")))[0];
}
async function slowScrollTo(page, locator, label) {
  try {
    const t = locator.first(); await t.waitFor({ state: "visible", timeout: 6000 });
    const targetY = await t.evaluate((n) => { const r = n.getBoundingClientRect(); const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); return Math.max(0, Math.min(maxY, window.scrollY + r.top - 160)); });
    let y = await page.evaluate(() => window.scrollY); let rem = targetY - y; const dir = rem >= 0 ? 1 : -1;
    while (Math.abs(rem) > STEP_PX) { await page.mouse.wheel(0, dir * STEP_PX); await wait(STEP_MS); y = await page.evaluate(() => window.scrollY); const nr = targetY - y; if ((nr >= 0 ? 1 : -1) !== dir) break; rem = nr; }
    await page.mouse.wheel(0, rem); await wait(PAUSE); log(`scrolled to ${label}`);
  } catch (e) { log(`scroll ${label} skipped: ${String(e).split("\n")[0]}`); }
}
async function slowPass(page, steps, delta = 360) { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, delta); await wait(PAUSE); } }
async function playVisibleVideo(page, ms = 3200) {
  const ok = await page.evaluate(async (d) => { const v = Array.from(document.querySelectorAll("video")).find((x) => { const r = x.getBoundingClientRect(); return r.width > 80 && r.height > 80 && r.top < innerHeight && r.bottom > 0; }); if (!v) return false; v.muted = true; v.currentTime = 0; await v.play().catch(() => {}); await new Promise((r) => setTimeout(r, d)); v.pause(); return true; }, ms);
  log(ok ? "played result video" : "no visible video to play");
}

(async () => {
  const executablePath = findChromium();
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, recordVideo: { dir: VIDEO_DIR, size: { width: WIDTH, height: HEIGHT } }, colorScheme: "dark" });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  let generationId = null;
  page.on("response", (r) => { try { if (r.url().includes("/api/v5/generations") && r.request().method() === "POST") r.json().then((j) => { if (j?.generationId) { generationId = j.generationId; log(`generationId=${generationId}`); } }).catch(() => {}); } catch {} });

  log(`open ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByText("爆款结构迁移创作引擎", { exact: false }).waitFor({ timeout: 15000 });
  await wait(1200);

  await slowScrollTo(page, page.getByText("2 · Generate", { exact: false }), "2 · Generate");
  // same_template is the default mode; confirm it
  const gen = page.locator("#v5-generate").first();
  await gen.getByRole("button", { name: /用同一个模板/ }).first().click({ timeout: 4000 }).catch(() => {});
  await wait(PAUSE);
  // pick the requested template (motion_graph_1 = tpl_asset_1fs9uam) instead of the latest-learned default
  const TEMPLATE_ID = process.env.DEMO_TEMPLATE_ID ?? "tpl_asset_1fs9uam";
  await gen.locator("label", { hasText: "模板胶囊" }).locator("select").first().selectOption(TEMPLATE_ID)
    .then(() => log(`selected template ${TEMPLATE_ID}`))
    .catch(() => log(`template select ${TEMPLATE_ID} skipped`));
  await wait(PAUSE);
  await page.getByLabel("新主题").first().fill(THEME).catch(() => log("theme fill skipped"));
  await wait(700);
  await page.getByLabel("卖点（逗号分隔）").first().fill("低眩光, 专注学习, 高级桌面氛围, 一键生成短视频").catch(() => {});
  await wait(900);
  log("theme + selling points set; AIGC on by default");

  await slowScrollTo(page, gen.getByRole("button", { name: /用此模板生成视频|用此模板生成 3 个版本|按 LLM 改写生成/ }), "generate button");
  await gen.getByRole("button", { name: /用此模板生成视频|用此模板生成 3 个版本|按 LLM 改写生成/ }).first().click({ timeout: 5000 });
  log("clicked same_template generate (AIGC + Lyria) — waiting for Result…");
  await page.screenshot({ path: path.join(OUT_DIR, "01-generating.png") }).catch(() => {});

  const result = page.getByText("3 · Result", { exact: false }).first();
  await result.waitFor({ state: "visible", timeout: GEN_WAIT }).then(() => log("Result appeared")).catch((e) => log(`Result wait timed out: ${String(e).split("\n")[0]}`));
  await wait(2000);

  // showcase the fixed result: scroll through Result, play the video, before/after
  await slowScrollTo(page, page.getByText("3 · Result", { exact: false }), "3 · Result");
  await page.screenshot({ path: path.join(OUT_DIR, "02-result.png") }).catch(() => {});
  await slowPass(page, 3, 360);
  await playVisibleVideo(page, 4000);
  await slowScrollTo(page, page.getByText("样例原片", { exact: false }), "before/after").catch(() => {});
  await playVisibleVideo(page, 3000);
  await slowPass(page, 3, 360);
  await page.screenshot({ path: path.join(OUT_DIR, "03-result-tail.png") }).catch(() => {});

  await context.close();
  await browser.close();
  const vids = readdirSync(VIDEO_DIR).filter((n) => n.endsWith(".webm"));
  const webm = path.join(OUT_DIR, "same-template-fixed.webm");
  if (vids.length) { await copyFile(path.join(VIDEO_DIR, vids[0]), webm); log(`saved ${webm}`); }
  writeFileSync(path.join(OUT_DIR, "clip-info.json"), JSON.stringify({ generationId, theme: THEME, url: URL, width: WIDTH, height: HEIGHT }, null, 2));
  log(`generationId=${generationId}`);
})().catch((e) => { console.error(e); process.exit(1); });
