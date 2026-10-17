#!/usr/bin/env node
import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.resolve(process.env.DEMO_RECORD_OUT ?? path.join(ROOT, "artifacts", "demo-recordings", ts));
const VIDEO_DIR = path.join(OUT_DIR, "raw-video");
const URL = process.env.DEMO_URL ?? "http://127.0.0.1:5174/#v5";
const RUN_LEARN = process.env.RUN_LEARN === "1";
const RUN_GENERATE = process.env.RUN_GENERATE === "1";
const RUN_REVISE = process.env.RUN_REVISE === "1";
const SAFE_LOCAL_GENERATE = process.env.SAFE_LOCAL_GENERATE !== "0";
const EXERCISE_BUTTONS = process.env.EXERCISE_BUTTONS !== "0";
const DOWNLOAD_EXPORTS = process.env.DOWNLOAD_EXPORTS === "1";
const DEMO_SAMPLE_FILE = process.env.DEMO_SAMPLE_FILE ? path.resolve(ROOT, process.env.DEMO_SAMPLE_FILE) : "";
const DEMO_TARGET_FILES = (process.env.DEMO_TARGET_FILES ?? "")
  .split(",")
  .map((file) => file.trim())
  .filter(Boolean)
  .map((file) => path.resolve(ROOT, file));
const WIDTH = Number(process.env.DEMO_WIDTH ?? 1440);
const HEIGHT = Number(process.env.DEMO_HEIGHT ?? 900);
const VIEW_PAUSE_MS = Number(process.env.DEMO_VIEW_PAUSE_MS ?? 1150);
const SCROLL_STEP_PX = Number(process.env.DEMO_SCROLL_STEP_PX ?? 360);
const SCROLL_STEP_MS = Number(process.env.DEMO_SCROLL_STEP_MS ?? 220);
const SLOW_PASS_STEPS = Number(process.env.DEMO_SLOW_PASS_STEPS ?? 3);

mkdirSync(VIDEO_DIR, { recursive: true });

const events = [];
const skipped = [];
const done = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function findExistingChromium() {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const roots = [
    path.join(process.env.HOME ?? "", ".cache", "ms-playwright"),
    path.join(ROOT, "node_modules", ".cache", "ms-playwright")
  ];
  const names = ["chrome-headless-shell", "chrome"];
  const stack = roots.filter(Boolean).filter((dir) => existsSync(dir));
  const found = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && names.includes(entry.name)) {
        try {
          if (statSync(full).mode & 0o111) found.push(full);
        } catch {
          // ignore unreadable candidates
        }
      }
    }
  }
  return found.sort((a, b) => Number(b.includes("chrome-headless-shell")) - Number(a.includes("chrome-headless-shell")))[0];
}
const note = (type, message) => {
  const line = { type, message, at: new Date().toISOString() };
  events.push(line);
  console.log(`[${type}] ${message}`);
};
const mark = (message) => {
  done.push(message);
  note("done", message);
};
const skip = (message) => {
  skipped.push(message);
  note("skip", message);
};

async function maybeClick(locator, label, timeout = 2200) {
  try {
    const target = locator.first();
    await target.waitFor({ state: "visible", timeout });
    await target.click({ timeout });
    mark(label);
    await wait(500);
    return true;
  } catch (error) {
    skip(`${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

async function maybeClickVisible(locator, label, timeout = 2500) {
  try {
    const target = locator.first();
    await target.waitFor({ state: "visible", timeout });
    await target.scrollIntoViewIfNeeded();
    await wait(Math.min(450, VIEW_PAUSE_MS));
    await target.click({ timeout }).catch(async () => {
      await target.evaluate((node) => {
        if (node instanceof HTMLElement) node.click();
      });
    });
    mark(label);
    await wait(VIEW_PAUSE_MS);
    return true;
  } catch (error) {
    skip(`${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

async function maybeClickExisting(locator, label, timeout = 1200) {
  const count = await locator.count().catch(() => 0);
  if (!count) {
    mark(`${label} 未出现，跳过`);
    return false;
  }
  return maybeClickVisible(locator, label, timeout);
}

async function clickAndShow(locator, label, timeout = 2500, pauseMs = VIEW_PAUSE_MS) {
  const clicked = await maybeClickVisible(locator, label, timeout);
  if (clicked) {
    await wait(pauseMs);
    mark(`展示 ${label} 后的关键信息`);
  }
  return clicked;
}

async function maybeFill(locator, value, label, timeout = 2200) {
  try {
    const target = locator.first();
    await target.waitFor({ state: "visible", timeout });
    await target.fill(value, { timeout });
    mark(label);
    await wait(Math.max(550, VIEW_PAUSE_MS * 0.55));
    return true;
  } catch (error) {
    skip(`${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

async function maybeSelect(locator, value, label, timeout = 2200) {
  try {
    const target = locator.first();
    await target.waitFor({ state: "visible", timeout });
    await target.selectOption(value, { timeout });
    mark(label);
    await wait(VIEW_PAUSE_MS);
    return true;
  } catch (error) {
    skip(`${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

async function waitForUiIdle(page, label, timeout = 180000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("上传中") &&
      !document.body.innerText.includes("生成中") &&
      !document.body.innerText.includes("学习中") &&
      !document.body.innerText.includes("改写中") &&
      !document.body.innerText.includes("解析并改写中"),
    undefined,
    { timeout }
  ).catch(() => undefined);
  mark(`${label} 后界面回到可操作状态`);
  await wait(VIEW_PAUSE_MS);
}

async function slowScrollToLocator(page, locator, label) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 2600 });
  const targetY = await target.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const doc = document.documentElement;
    const maxY = Math.max(0, doc.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(maxY, window.scrollY + rect.top - 180));
  });
  let currentY = await page.evaluate(() => window.scrollY);
  let remaining = targetY - currentY;
  const direction = remaining >= 0 ? 1 : -1;
  while (Math.abs(remaining) > SCROLL_STEP_PX) {
    await page.mouse.wheel(0, direction * SCROLL_STEP_PX);
    await wait(SCROLL_STEP_MS);
    currentY = await page.evaluate(() => window.scrollY);
    remaining = targetY - currentY;
    if (direction !== (remaining >= 0 ? 1 : -1)) break;
  }
  if (Math.abs(remaining) > 8) {
    await page.mouse.wheel(0, remaining);
    await wait(SCROLL_STEP_MS);
  }
  mark(`慢速滚动到 ${label}`);
  await wait(VIEW_PAUSE_MS);
}

async function scrollToText(page, text, label = text) {
  try {
    const target = page.getByText(text, { exact: false }).first();
    await slowScrollToLocator(page, target, label);
    return true;
  } catch (error) {
    skip(`滚动到 ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

async function slowPagePass(page, label, steps = SLOW_PASS_STEPS, delta = 420) {
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, delta);
    await wait(VIEW_PAUSE_MS);
  }
  mark(`慢速扫过 ${label}`);
}

async function slowElementPass(page, locator, label, steps = SLOW_PASS_STEPS) {
  try {
    const target = locator.first();
    await target.waitFor({ state: "visible", timeout: 2200 });
    await target.evaluate(async (node, args) => {
      const el = node instanceof HTMLElement ? node : node.parentElement;
      if (!el) return;
      const { steps, delay } = args;
      const distance = Math.max(160, Math.floor((el.scrollHeight - el.clientHeight) / Math.max(1, steps)));
      el.scrollTop = 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      for (let i = 0; i < steps; i += 1) {
        el.scrollTop += distance;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }, { steps, delay: VIEW_PAUSE_MS });
    mark(`慢速扫过 ${label}`);
  } catch (error) {
    skip(`慢速扫过 ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

async function exerciseUploadButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await scrollToText(page, "0 · Upload", "Upload 按钮区");
  const upload = page.locator("section").filter({ hasText: "0 · Upload" }).first();
  await slowPagePass(page, "Upload 文件选择与按钮", 1, 240);

  if (DEMO_SAMPLE_FILE && existsSync(DEMO_SAMPLE_FILE)) {
    await upload.locator("input[type=file]").nth(0).setInputFiles(DEMO_SAMPLE_FILE);
    mark(`Upload：选择样本视频 ${path.basename(DEMO_SAMPLE_FILE)}`);
    await wait(VIEW_PAUSE_MS);
    await clickAndShow(upload.getByRole("button", { name: "Upload" }).nth(0), "Upload：上传样本视频", 3000, VIEW_PAUSE_MS * 1.4);
    await waitForUiIdle(page, "上传样本视频");
  } else {
    skip("Upload：未提供 DEMO_SAMPLE_FILE，样本上传按钮由人工或单独脚本覆盖");
  }

  const targetFiles = DEMO_TARGET_FILES.filter((file) => existsSync(file));
  if (targetFiles.length) {
    await upload.locator("input[type=file]").nth(1).setInputFiles(targetFiles);
    mark(`Upload：选择 ${targetFiles.length} 个目标素材`);
    await wait(VIEW_PAUSE_MS);
    await clickAndShow(upload.getByRole("button", { name: "Upload" }).nth(1), "Upload：上传目标素材", 3000, VIEW_PAUSE_MS * 1.4);
    await waitForUiIdle(page, "上传目标素材");
  } else {
    skip("Upload：未提供 DEMO_TARGET_FILES；如需录制目标素材上传，请通过 DEMO_TARGET_FILES 传入本地素材路径。");
  }
}

async function showTopStatusBar(page) {
  // The fixed top status bar (流程进度 + 模型信息) — reviewMode hides the old toggle row, so just
  // present the live status strip slowly, then return to the very top.
  await scrollToText(page, "爆款结构迁移创作引擎", "顶部标题与状态栏");
  await slowPagePass(page, "顶部状态栏 / 流程进度 / 模型信息", 1, 160);
  await page.mouse.wheel(0, -600);
  await wait(VIEW_PAUSE_MS);
  mark("展示顶部状态栏与流程进度");
}

async function clickReviewTab(page, tab) {
  await scrollToText(page, "评审证据中心", "评审证据中心");
  await openIfCollapsed(page, "评审证据中心", "评审证据中心");
  const review = page.locator("section").filter({ hasText: "评审证据中心" }).first();
  const tabButton = review.locator("button").filter({ hasText: tab }).first();
  return maybeClickVisible(tabButton, `评审 tab：${tab}`, 3000);
}

async function exerciseReviewCenterButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await clickReviewTab(page, "Showcase");
  const review = page.locator("section").filter({ hasText: "评审证据中心" }).first();
  await clickAndShow(review.getByRole("button", { name: /刷新 Showcase/ }), "刷新 Showcase", 2500, VIEW_PAUSE_MS * 1.2);
  await slowPagePass(page, "Showcase 刷新结果", 2, 360);

  await clickReviewTab(page, "Learn Analysis");
  await clickAndShow(review.getByRole("button", { name: /读取已选样本分析/ }), "读取已选样本分析", 2500, VIEW_PAUSE_MS * 1.4);

  await clickReviewTab(page, "Structure Protocol");
  await clickAndShow(review.getByRole("button", { name: /刷新模板协议/ }), "刷新模板协议", 2500, VIEW_PAUSE_MS * 1.4);
}

async function openIfCollapsed(page, text, label = text) {
  const row = page.getByText(text, { exact: false }).first();
  try {
    await row.waitFor({ state: "visible", timeout: 2500 });
    const aria = await row.evaluate((node) => {
      const button = node.closest("[role='button']");
      return button?.getAttribute("aria-expanded");
    }).catch(() => null);
    if (aria === "false") {
      await row.click();
      mark(`展开 ${label}`);
      await wait(600);
    } else {
      mark(`${label} 已展开/可见`);
    }
    return true;
  } catch (error) {
    skip(`展开 ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    return false;
  }
}

async function playFirstVisibleVideo(page, label, ms = 3200) {
  try {
    // Pick the LARGEST video on the page, scroll it to centre, force-load it (so headless Chromium actually
    // has frames to render), then play muted and confirm currentTime advanced. Returns whether it really played.
    const res = await page.evaluate(async (durationMs) => {
      const vids = Array.from(document.querySelectorAll("video"));
      const scored = vids
        .map((v) => { const r = v.getBoundingClientRect(); const vis = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)); return { v, area: r.width * r.height, vis, w: r.width, h: r.height }; })
        .filter((x) => x.w > 80 && x.h > 80)
        .sort((a, b) => (b.vis - a.vis) || (b.area - a.area));
      const pick = scored[0];
      if (!pick) return { ok: false, reason: "no <video> on page" };
      const v = pick.v;
      v.scrollIntoView({ block: "center", inline: "center" });
      v.muted = true; v.setAttribute("playsinline", "");
      await new Promise((r) => setTimeout(r, 250));
      if (v.readyState < 2) { try { v.load(); } catch {} await new Promise((res) => { const to = setTimeout(res, 5000); v.addEventListener("loadeddata", () => { clearTimeout(to); res(); }, { once: true }); }); }
      try { v.currentTime = 0; } catch {}
      const t0 = v.currentTime;
      await v.play().catch(() => {});
      await new Promise((r) => setTimeout(r, durationMs));
      const ct = v.currentTime; v.pause();
      return { ok: true, advanced: ct > t0 + 0.25, ct, rs: v.readyState };
    }, ms);
    if (res.ok && res.advanced) mark(`播放可见视频：${label}（推进到 ${res.ct.toFixed(1)}s）`);
    else if (res.ok) skip(`播放可见视频：${label}（命中但未推进，readyState=${res.rs}）`);
    else skip(`播放可见视频：${label}，${res.reason}`);
  } catch (error) {
    skip(`播放视频 ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

async function horizontalScrollTimelines(page) {
  await page.evaluate(async () => {
    const scrollers = Array.from(document.querySelectorAll("div"))
      .filter((el) => el.scrollWidth > el.clientWidth + 120)
      .filter((el) => /时间线|槽位|素材缺口|Knowledge Base/.test(el.textContent ?? ""));
    for (const el of scrollers.slice(0, 4)) {
      el.scrollLeft = 0;
      await new Promise((resolve) => setTimeout(resolve, 700));
      const max = el.scrollWidth - el.clientWidth;
      const steps = 8;
      for (let i = 1; i <= steps; i += 1) {
        el.scrollLeft = Math.round((max * i) / steps);
        await new Promise((resolve) => setTimeout(resolve, 260));
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
      el.scrollLeft = 0;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
  mark("慢速横向滚动时间线/表格区域");
}

async function selectFirstLearnSample(page) {
  const learn = page.locator("section").filter({ hasText: "1 · Learn" }).first();
  await learn.scrollIntoViewIfNeeded().catch(() => undefined);
  const fileButtons = learn.locator("button").filter({ hasText: /\.(mov|mp4|webm|m4v)$/i });
  const count = await fileButtons.count().catch(() => 0);
  if (!count) {
    skip("Learn：没有可点击样本视频 chip");
    return false;
  }
  await fileButtons.nth(0).click();
  mark("选择第一个样本视频");
  await wait(400);
  if (RUN_LEARN) {
    await clickAndShow(learn.getByRole("button", { name: /Learn 1 个样本/ }), "Learn：学习 1 个样本", 3000, VIEW_PAUSE_MS * 1.6);
    await waitForUiIdle(page, "Learn 样本", 600000);
  } else {
    skip("未点击“Learn 1 个样本”：设置 RUN_LEARN=1 可录制真实结构学习");
  }
  await maybeClick(learn.getByRole("button", { name: /读取结构学习报告/ }), "读取结构学习报告", 1800);
  await wait(2500);
  return true;
}

async function exerciseLearningReportButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await scrollToText(page, "结构学习报告", "结构学习报告按钮区");
  await clickAndShow(page.getByRole("button", { name: /读取模板细节|读取 Remotion 模板细节/ }).first(), "结构学习报告：读取模板细节", 2400, VIEW_PAUSE_MS * 1.4);
  if (RUN_LEARN) {
    await clickAndShow(page.getByRole("button", { name: /重新 Learn 补读/ }).first(), "结构学习报告：重新 Learn 补读", 3000, VIEW_PAUSE_MS * 1.5);
    await waitForUiIdle(page, "重新 Learn 补读");
  } else {
    skip("未点击“重新 Learn 补读”：设置 RUN_LEARN=1 可录制真实补读");
  }
}

async function selectTargetAssets(page, max = 12) {
  await openIfCollapsed(page, "你的目标素材", "目标素材折叠块");
  const generate = page.locator("section").filter({ hasText: "2 · Generate" }).first();
  const buttons = generate.locator("button").filter({ hasText: /\.(mov|mp4|webm|m4v|png|jpe?g|webp|gif)$/i });
  const count = Math.min(max, await buttons.count().catch(() => 0));
  if (!count) {
    skip("Generate：没有可选目标素材 chip");
    return 0;
  }
  for (let i = 0; i < count; i += 1) {
    await buttons.nth(i).click().catch(() => undefined);
    await wait(120);
  }
  mark(`选择 ${count} 个目标素材`);
  return count;
}

async function exerciseTemplateLibraryButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await scrollToText(page, "模板库", "模板库");
  await openIfCollapsed(page, "模板库", "模板库");
  const templates = page.locator("section").filter({ hasText: "模板库" }).first();
  await clickAndShow(templates.getByRole("button", { name: /用此模板生成/ }).first(), "模板库：用此模板生成", 2500, VIEW_PAUSE_MS * 1.4);
  await scrollToText(page, "2 · Generate", "Generate：模板选择结果");
}

async function exerciseKnowledgeButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await scrollToText(page, "Knowledge Base", "Knowledge Base");
  await openIfCollapsed(page, "Knowledge Base", "Knowledge Base");
  const kbSection = page.locator("section").filter({ hasText: "Knowledge Base" }).first();
  for (const view of ["结构视图", "场景视图", "来源视图"]) {
    await clickAndShow(kbSection.getByRole("button", { name: new RegExp(view) }), `Knowledge Base：${view}`, 1800);
    await slowPagePass(page, `Knowledge Base ${view} 结果`, 1, 320);
  }
  const search = kbSection.getByPlaceholder(/hook|rhythm|slot|audio|remotion/).first();
  await maybeFill(search, "hook", "Knowledge Base：输入搜索 hook", 1800);
  await clickAndShow(kbSection.getByRole("button", { name: /^搜索$/ }), "Knowledge Base：搜索", 2200, VIEW_PAUSE_MS * 1.2);
  await maybeFill(search, "", "Knowledge Base：清空搜索", 1800);
  await clickAndShow(kbSection.getByRole("button", { name: /^搜索$/ }), "Knowledge Base：恢复全量结果", 2200, VIEW_PAUSE_MS);
}

async function exerciseTargetOrderControls(page) {
  if (!EXERCISE_BUTTONS) return;
  const generate = page.locator("#v5-generate").first();
  const orderPanel = generate.getByText("已选素材顺序", { exact: false }).first();
  if (!(await orderPanel.count().catch(() => 0))) {
    skip("目标素材顺序面板未出现");
    return;
  }
  await orderPanel.scrollIntoViewIfNeeded().catch(() => undefined);
  await wait(VIEW_PAUSE_MS);
  await clickAndShow(generate.getByRole("button", { name: "下移" }).first(), "目标素材顺序：下移", 1800);
  await clickAndShow(generate.getByRole("button", { name: "上移" }).first(), "目标素材顺序：上移", 1800);
  const remove = generate.getByRole("button", { name: "移除" }).first();
  if (await remove.count().catch(() => 0)) {
    await clickAndShow(remove, "目标素材顺序：移除一个素材", 1800);
    const chips = generate.locator("button").filter({ hasText: /\.(mov|mp4|webm|m4v|png|jpe?g|webp|gif)/i });
    const count = await chips.count().catch(() => 0);
    if (count) {
      await chips.nth(Math.max(0, count - 1)).click().catch(() => undefined);
      mark("目标素材顺序：重新加入被移除素材");
      await wait(VIEW_PAUSE_MS);
    }
  }
}

async function exerciseGenerateButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await scrollToText(page, "2 · Generate", "Generate 功能按钮区");
  await openIfCollapsed(page, "2 · Generate", "Generate");
  const generate = page.locator("#v5-generate").first();

  await clickAndShow(generate.getByRole("button", { name: /用同一个模板/ }), "Generate：用同一个模板模式", 2200);
  await clickAndShow(generate.getByText("你的目标素材", { exact: false }), "Generate：展开/收起目标素材", 2200);
  await clickAndShow(generate.getByText("你的目标素材", { exact: false }), "Generate：恢复目标素材展开", 2200);
  await exerciseTargetOrderControls(page);

  const aigcLabel = generate.locator("label").filter({ hasText: "用 AI 自动补全" }).first();
  if (await aigcLabel.count().catch(() => 0)) {
    const input = aigcLabel.locator("input[type=checkbox]").first();
    const initial = await input.isChecked().catch(() => null);
    await clickAndShow(aigcLabel, "Generate：切换 AI 自动补全", 2200);
    if (initial !== null && (await input.isChecked().catch(() => initial)) !== initial) {
      await clickAndShow(aigcLabel, "Generate：恢复 AI 自动补全状态", 2200);
    }
  }

  await clickAndShow(generate.getByText(/高级补全选项/), "Generate：高级补全选项", 2200);
  await maybeSelect(generate.locator("label").filter({ hasText: "画面" }).locator("select"), "procedural", "高级补全：画面改为程序化设计卡");
  await maybeSelect(generate.locator("label").filter({ hasText: "文案" }).locator("select"), "brief", "高级补全：文案改为 brief");
  await maybeSelect(generate.locator("label").filter({ hasText: "音频" }).locator("select"), "procedural", "高级补全：音频改为程序化节拍床");
  await maybeSelect(generate.locator("label").filter({ hasText: "画面" }).locator("select"), "aigc", "高级补全：恢复画面 AIGC");
  await maybeSelect(generate.locator("label").filter({ hasText: "文案" }).locator("select"), "llm", "高级补全：恢复文案 LLM");
  await maybeSelect(generate.locator("label").filter({ hasText: "音频" }).locator("select"), "aigc", "高级补全：恢复音频 AIGC");

  await clickAndShow(generate.getByRole("button", { name: /LLM 智能改写/ }), "Generate：LLM 智能改写按钮", 2200);
  await maybeFill(generate.getByPlaceholder(/开头三秒更抓人/), "开头三秒更抓人，字幕更少，CTA 提前，清理残留英文和旧商品文案。", "Generate：填写 LLM 自定义需求", 1800);
  for (const variant of ["高点击", "高转化", "高质感"]) {
    await clickAndShow(generate.getByRole("button", { name: new RegExp(variant) }).first(), `Generate：选择${variant}`, 1800);
  }
  await clickAndShow(generate.getByRole("button", { name: /预设模板/ }), "Generate：预设模板按钮", 2200);
  const variantsCheckbox = generate.locator("label").filter({ hasText: "一次生成三个预设版本" }).first();
  if (await variantsCheckbox.count().catch(() => 0)) {
    const input = variantsCheckbox.locator("input[type=checkbox]").first();
    const initial = await input.isChecked().catch(() => null);
    await clickAndShow(variantsCheckbox, "Generate：一次生成三个预设版本开关", 2200);
    if (initial !== null && (await input.isChecked().catch(() => initial)) !== initial) {
      await clickAndShow(variantsCheckbox, "Generate：恢复三版本开关", 2200);
    }
  }

  await clickAndShow(generate.getByRole("button", { name: /混合多视频元素/ }), "Generate：混合多视频元素模式", 2200);
  const codegen = generate.locator("label").filter({ hasText: "让 AI 现场编写动画代码" }).first();
  if (await codegen.count().catch(() => 0)) {
    const input = codegen.locator("input[type=checkbox]").first();
    const initial = await input.isChecked().catch(() => null);
    await clickAndShow(codegen, "Generate：让 AI 现场编写动画代码", 2200);
    if (initial !== null && (await input.isChecked().catch(() => initial)) !== initial) {
      await clickAndShow(codegen, "Generate：恢复 AI 现场编写动画代码状态", 2200);
    }
  }
  await clickAndShow(generate.getByText("Knowledge Base", { exact: false }).first(), "Generate：展开/收起合成知识库", 2200);
  await clickAndShow(generate.getByText("Knowledge Base", { exact: false }).first(), "Generate：恢复合成知识库展开", 2200);
  const kbCards = generate.locator("div").filter({ hasText: /reusable|parametric|structure|visual/i });
  if (await kbCards.count().catch(() => 0)) {
    await kbCards.nth(0).click().catch(() => undefined);
    mark("Generate：点选一个知识元素用于合成");
    await wait(VIEW_PAUSE_MS);
  }
  await clickAndShow(generate.getByRole("button", { name: /用同一个模板/ }), "Generate：回到同模板模式", 2200);
}

async function maybeDisableAigc(page) {
  if (!SAFE_LOCAL_GENERATE) return;
  try {
    const label = page.getByText("用 AI 自动补全缺失的画面", { exact: false }).first();
    await label.scrollIntoViewIfNeeded();
    const checked = await label.evaluate((node) => {
      const container = node.closest("label") ?? node.parentElement;
      return Boolean(container?.querySelector("input[type='checkbox']")?.checked);
    });
    if (checked) {
      await label.click();
      mark("关闭 AI 自动补全，使用本地/已有素材安全生成");
      await wait(400);
    }
  } catch (error) {
    skip(`关闭 AI 自动补全: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

async function exerciseResultButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  if (!(await scrollToText(page, "3 · Result", "Result 功能按钮区"))) return;
  await playFirstVisibleVideo(page, "Result final.mp4", 2800);
  await scrollToText(page, "生成后一致性检查", "生成后一致性检查");
  await horizontalScrollTimelines(page);
  const resultSection = page.locator("section").filter({ hasText: "3 · Result" }).first();

  await maybeFill(resultSection.getByPlaceholder("新主题（可选）"), "高端桌面效率装备", "改写：填写新主题", 1600);
  await maybeFill(resultSection.getByPlaceholder("新主标题文案（可选）"), "让桌面进入专注状态", "改写：填写主标题", 1600);
  await maybeSelect(resultSection.locator("select[title='节奏']"), "balanced", "改写：选择节奏");
  await maybeSelect(resultSection.locator("select[title='字幕密度']"), "minimal", "改写：选择字幕密度");
  await maybeSelect(resultSection.locator("select[title='配色风格']"), "premium", "改写：选择配色风格");
  if (RUN_REVISE) {
    await clickAndShow(resultSection.getByRole("button", { name: /改写并重渲染/ }), "Result：改写并重渲染", 2600, VIEW_PAUSE_MS * 2);
  } else {
    skip("未点击“改写并重渲染”：设置 RUN_REVISE=1 可录制真实改片");
  }

  for (const instruction of ["开头更抓人一些", "字幕更少，节奏更快", "CTA 更强，把购买理由提前"]) {
    await clickAndShow(resultSection.getByRole("button", { name: instruction }), `Result：预设改片指令 ${instruction}`, 1800);
  }
  await maybeFill(resultSection.getByPlaceholder(/开头更抓人一些/), "把商品信息提前，减少字幕密度，整体更高级。", "Result：填写自然语言改片指令", 1600);
  if (RUN_REVISE) {
    await clickAndShow(resultSection.getByRole("button", { name: /自然语言改片/ }), "Result：自然语言改片", 2600, VIEW_PAUSE_MS * 2);
  } else {
    skip("未点击“自然语言改片”：设置 RUN_REVISE=1 可录制真实自然语言改片");
  }
}

async function exerciseExportButtons(page) {
  if (!EXERCISE_BUTTONS) return;
  await scrollToText(page, "评审证据中心", "回到评审证据中心导出");
  await openIfCollapsed(page, "评审证据中心", "评审证据中心");
  await clickReviewTab(page, "Export");
  await wait(VIEW_PAUSE_MS);
  await horizontalScrollTimelines(page);
  const review = page.locator("section").filter({ hasText: "评审证据中心" }).first();
  const buttons = review.locator("button").filter({ hasText: /\.json$/i });
  const count = await buttons.count().catch(() => 0);
  if (!count) {
    skip("Export：没有可导出 JSON 按钮");
    return;
  }
  mark(`Export：发现 ${count} 个可导出 artifact`);
  if (!DOWNLOAD_EXPORTS) {
    skip("未点击导出下载按钮：设置 DOWNLOAD_EXPORTS=1 可真实下载 JSON");
    return;
  }
  for (let i = 0; i < Math.min(count, 3); i += 1) {
    await clickAndShow(buttons.nth(i), `Export：下载第 ${i + 1} 个 JSON`, 1800);
  }
}

// Generation #2: the advanced "混合多视频元素" mode with "让 AI 现场编写动画代码" (AI live codegen).
// Switches mode, enables codegen, picks a few KB elements + target assets, generates, and shows the result.
async function runMixGenerate(page) {
  await scrollToText(page, "2 · Generate", "Generate（混合多视频元素）");
  await openIfCollapsed(page, "2 · Generate", "Generate");
  const generate = page.locator("#v5-generate").first();
  await clickAndShow(generate.getByRole("button", { name: /混合多视频元素/ }), "Generate：切换到「混合多视频元素」模式", 2500, VIEW_PAUSE_MS * 1.4);

  const codegen = generate.locator("label").filter({ hasText: "让 AI 现场编写动画代码" }).first();
  if (await codegen.count().catch(() => 0)) {
    const input = codegen.locator("input[type=checkbox]").first();
    if ((await input.isChecked().catch(() => false)) !== true) {
      await clickAndShow(codegen, "Generate：开启「让 AI 现场编写动画代码」", 2200);
    } else {
      mark("Generate：「让 AI 现场编写动画代码」已开启");
    }
  } else {
    skip("Generate：未找到「让 AI 现场编写动画代码」开关");
  }

  // pick a few knowledge elements to synthesize from (falls back to all KB elements if none selected)
  const kbCards = generate.locator("div").filter({ hasText: /reusable|parametric|structure|visual|hook|rhythm|transition|cta/i });
  const kbCount = Math.min(3, await kbCards.count().catch(() => 0));
  for (let i = 0; i < kbCount; i += 1) { await kbCards.nth(i).click().catch(() => undefined); await wait(220); }
  if (kbCount) mark(`Generate：点选 ${kbCount} 个知识元素用于合成`); else skip("Generate：混合模式未发现可点选知识元素（将用全部 KB）");

  await selectTargetAssets(page);
  await slowPagePass(page, "混合模式：已选元素 + 目标素材", 2, 360);

  await scrollToText(page, "Mix & Generate video", "Mix 生成按钮");
  await maybeClick(generate.getByRole("button", { name: /Mix & Generate video/ }), "点击 Mix & Generate video（混合 + AI 现场写码）", 3000);
  await wait(4000);
  await page.screenshot({ path: path.join(OUT_DIR, "04-mix-generating.png"), fullPage: false });
  const result = page.getByText("3 · Result", { exact: false }).first();
  await result.waitFor({ state: "visible", timeout: Number(process.env.GENERATE_WAIT_MS ?? 180000) })
    .then(() => mark("「混合多视频元素」生成完成并出现 Result 区"))
    .catch((error) => skip(`混合生成未在时限内完成: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`));
  if (await scrollToText(page, "3 · Result", "Result（混合模式成片）")) {
    await slowPagePass(page, "混合模式 Result", 2, 380);
    await playFirstVisibleVideo(page, "混合模式 final.mp4", 3200);
    await page.screenshot({ path: path.join(OUT_DIR, "05-mix-result.png"), fullPage: false });
  }
}

async function record() {
  const executablePath = findExistingChromium();
  if (executablePath) note("browser", `using ${path.relative(ROOT, executablePath)}`);
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: VIDEO_DIR, size: { width: WIDTH, height: HEIGHT } },
    colorScheme: "dark"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => note("pageerror", error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) note(`console:${msg.type()}`, msg.text().slice(0, 300));
  });

  note("start", URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByText("爆款结构迁移创作引擎", { exact: false }).waitFor({ timeout: 15000 });
  await wait(1000);

  await page.screenshot({ path: path.join(OUT_DIR, "00-open.png"), fullPage: false });
  mark("打开 V5 Dashboard：首页、顶部状态栏");
  await showTopStatusBar(page);

  await maybeClickExisting(page.getByText("诊断详情", { exact: false }), "展开诊断详情");
  await wait(900);
  await maybeClickExisting(page.getByText("收起详情", { exact: false }), "收起诊断详情");

  await scrollToText(page, "0 · Upload", "Upload");
  await slowPagePass(page, "Upload", 1, 300);
  await exerciseUploadButtons(page);

  await scrollToText(page, "评审证据中心", "评审证据中心");
  await openIfCollapsed(page, "评审证据中心", "评审证据中心");
  await exerciseReviewCenterButtons(page);
  await clickReviewTab(page, "Showcase");
  await wait(VIEW_PAUSE_MS);
  await slowPagePass(page, "Showcase", 2, 360);
  await playFirstVisibleVideo(page, "Showcase", 2600);

  await scrollToText(page, "1 · Learn", "Learn");
  await openIfCollapsed(page, "1 · Learn", "Learn");
  await selectFirstLearnSample(page);
  await scrollToText(page, "结构学习报告", "结构学习报告");
  await slowPagePass(page, "结构学习报告概览", 3, 420);
  await horizontalScrollTimelines(page);
  await slowPagePass(page, "结构学习报告卡片", 4, 420);
  await exerciseLearningReportButtons(page);
  await page.screenshot({ path: path.join(OUT_DIR, "01-learning-report.png"), fullPage: false });

  for (const tab of ["Learn Analysis", "Structure Protocol"]) {
    await clickReviewTab(page, tab);
    await slowPagePass(page, `评审 ${tab}`, 3, 420);
    await horizontalScrollTimelines(page);
  }

  await scrollToText(page, "模板库", "模板库");
  await openIfCollapsed(page, "模板库", "模板库");
  await slowPagePass(page, "模板库", 3, 420);
  await exerciseTemplateLibraryButtons(page);

  await exerciseKnowledgeButtons(page);
  await wait(VIEW_PAUSE_MS);

  await scrollToText(page, "2 · Generate", "Generate");
  await openIfCollapsed(page, "2 · Generate", "Generate");
  // Use motion_graph_1 (tpl_asset_1fs9uam) as the same_template base, per the demo plan.
  await maybeSelect(page.locator("#v5-generate").locator("label").filter({ hasText: "模板胶囊" }).locator("select"), process.env.DEMO_TEMPLATE_ID ?? "tpl_asset_1fs9uam", "选择 motion_graph_1 模板", 2200);
  await maybeFill(page.getByLabel("新主题"), process.env.DEMO_THEME ?? "AI 健身追踪 App", "填写新主题", 1600);
  await maybeFill(page.getByLabel("卖点（逗号分隔）"), "自动记录运动, 心率与睡眠分析, AI 训练计划, 数据可视化", "填写卖点", 1600);
  await selectTargetAssets(page);
  await slowPagePass(page, "目标素材选择区", 3, 380);
  await scrollToText(page, "素材缺口雷达", "素材缺口雷达");
  await horizontalScrollTimelines(page);
  await slowPagePass(page, "素材缺口雷达", 2, 420);
  await scrollToText(page, "用 AI 自动补全", "AI 补全选项");
  await maybeClick(page.getByText("高级补全选项", { exact: false }), "展开高级补全选项", 1600);
  await maybeFill(page.getByPlaceholder("例如：开头三秒更抓人", { exact: false }), "开头三秒更抓人，字幕更少，CTA 提前，清理残留英文文案。", "填写自然语言自定义需求", 1800).catch(() => undefined);
  await maybeClick(page.getByRole("button", { name: /预设模板/ }), "切换到预设模板生成方式", 1800);
  await maybeClick(page.getByRole("button", { name: /高点击/ }), "选择高点击预设", 1600);
  await exerciseGenerateButtons(page);

  if (RUN_GENERATE) {
    // ---- Generation #1: 用同一个模板 (same_template) + AIGC（含 Google Lyria 配乐）----
    const gen1 = page.locator("#v5-generate").first();
    await maybeClick(gen1.getByRole("button", { name: /用同一个模板/ }), "Generate：确认「用同一个模板」模式", 2000);
    await maybeDisableAigc(page);
    await scrollToText(page, "用此模板生成", "同模板生成按钮");
    await maybeClick(page.getByRole("button", { name: /用此模板生成视频|按 LLM 改写生成|用此模板生成 3 个版本/ }), "点击生成（用同一个模板 · AIGC）", 2500);
    await wait(4000);
    await page.screenshot({ path: path.join(OUT_DIR, "02-same-template-generating.png"), fullPage: false });
    const result = page.getByText("3 · Result", { exact: false }).first();
    await result.waitFor({ state: "visible", timeout: Number(process.env.GENERATE_WAIT_MS ?? 180000) })
      .then(() => mark("「用同一个模板」生成完成并出现 Result 区"))
      .catch((error) => skip(`同模板生成未在时限内完成: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`));
  } else {
    skip("未执行真实生成：设置 RUN_GENERATE=1 可录制 Result 动态生成流程");
  }

  if (await scrollToText(page, "多版本对比", "多版本对比")) {
    await playFirstVisibleVideo(page, "多版本对比", 1600);
  }
  if (await scrollToText(page, "3 · Result", "Result")) {
    await exerciseResultButtons(page);
  }

  for (const tab of ["Gap Decisions", "Transfer Map", "Packaging"]) {
    await clickReviewTab(page, tab);
    await slowPagePass(page, `评审 ${tab}`, 3, 420);
    await horizontalScrollTimelines(page);
  }

  // ---- Generation #2: 混合多视频元素 (mix_elements) + 让 AI 现场编写动画代码 ----
  if (RUN_GENERATE) {
    await runMixGenerate(page);
  } else {
    skip("未执行混合多视频元素生成：设置 RUN_GENERATE=1 可录制 mix_elements + AI 现场写码流程");
  }

  await exerciseExportButtons(page);
  await wait(1200);
  await page.screenshot({ path: path.join(OUT_DIR, "03-export.png"), fullPage: false });

  await context.close();
  await browser.close();

  const videos = readdirSync(VIDEO_DIR).filter((name) => name.endsWith(".webm"));
  const rawVideo = videos.length ? path.join(VIDEO_DIR, videos[0]) : null;
  const webm = path.join(OUT_DIR, "v5-ui-demo.webm");
  if (rawVideo && existsSync(rawVideo)) {
    await copyFile(rawVideo, webm);
    mark(`保存 Playwright 录屏：${path.relative(ROOT, webm)}`);
    const ffmpeg = process.env.FFMPEG || "ffmpeg";
    const mp4 = path.join(OUT_DIR, "v5-ui-demo.mp4");
    const converted = spawnSync(ffmpeg, ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], { stdio: "pipe" });
    if (converted.status === 0) {
      mark(`转换 MP4：${path.relative(ROOT, mp4)}`);
    } else {
      skip(`MP4 转换失败：${converted.stderr?.toString().slice(0, 400) || "ffmpeg unavailable"}`);
    }
  } else {
    skip("Playwright 未输出 webm 录屏文件");
  }

  const report = {
    url: URL,
    outputDir: path.relative(ROOT, OUT_DIR),
    runLearn: RUN_LEARN,
    runGenerate: RUN_GENERATE,
    runRevise: RUN_REVISE,
    safeLocalGenerate: SAFE_LOCAL_GENERATE,
    exerciseButtons: EXERCISE_BUTTONS,
    downloadExports: DOWNLOAD_EXPORTS,
    demoSampleFile: DEMO_SAMPLE_FILE ? path.relative(ROOT, DEMO_SAMPLE_FILE) : null,
    demoTargetFiles: DEMO_TARGET_FILES.map((file) => path.relative(ROOT, file)),
    coveredByAutomation: done,
    needsHumanOrExternal: [
      "真人旁白 / 讲解音轨：Playwright 只能录浏览器画面，不能录你的麦克风讲解。",
      "最终剪辑节奏：等待渲染的空档、转场、字幕和配乐需要用剪辑软件处理。",
      "外部 AIGC/LLM 质量判断：如果要现场调用 Gemini/Seedance/Lyria，需要你确认成本、密钥和网络。",
      "提交平台上传和公开链接：我能生成本地文件，但最终上传到比赛/网盘需要你账号操作。",
      "评委视角口播措辞：我能给脚本，最终语气和取舍建议你人工确认。"
    ],
    skippedOrBlocked: skipped,
    events
  };
  writeFileSync(path.join(OUT_DIR, "recording-report.json"), JSON.stringify(report, null, 2));
  console.log(`\nReport: ${path.relative(ROOT, path.join(OUT_DIR, "recording-report.json"))}`);
}

record().catch((error) => {
  console.error(error);
  process.exit(1);
});
