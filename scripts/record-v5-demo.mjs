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
const RUN_GENERATE = process.env.RUN_GENERATE === "1";
const SAFE_LOCAL_GENERATE = process.env.SAFE_LOCAL_GENERATE !== "0";
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

async function clickReviewTab(page, tab) {
  await scrollToText(page, "评审证据中心", "评审证据中心");
  await openIfCollapsed(page, "评审证据中心", "评审证据中心");
  const review = page.locator("section").filter({ hasText: "评审证据中心" }).first();
  const tabButton = review.locator("button").filter({ hasText: tab }).first();
  return maybeClickVisible(tabButton, `评审 tab：${tab}`, 3000);
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

async function playFirstVisibleVideo(page, label, ms = 2500) {
  try {
    const played = await page.evaluate(async (durationMs) => {
      const videos = Array.from(document.querySelectorAll("video"));
      const video = videos.find((v) => {
        const r = v.getBoundingClientRect();
        return r.width > 80 && r.height > 80 && r.bottom > 0 && r.top < window.innerHeight;
      });
      if (!video) return false;
      video.muted = true;
      video.currentTime = 0;
      await video.play().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      video.pause();
      return true;
    }, ms);
    played ? mark(`播放可见视频：${label}`) : skip(`播放可见视频：${label}，未找到视频`);
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
  await maybeClick(learn.getByRole("button", { name: /读取结构学习报告/ }), "读取结构学习报告", 1800);
  await wait(2500);
  return true;
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

  await maybeClickExisting(page.getByText("诊断详情", { exact: false }), "展开诊断详情");
  await wait(900);
  await maybeClickExisting(page.getByText("收起详情", { exact: false }), "收起诊断详情");

  await scrollToText(page, "0 · Upload", "Upload");
  await slowPagePass(page, "Upload", 1, 300);

  await scrollToText(page, "评审证据中心", "评审证据中心");
  await openIfCollapsed(page, "评审证据中心", "评审证据中心");
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
  await page.screenshot({ path: path.join(OUT_DIR, "01-learning-report.png"), fullPage: false });

  for (const tab of ["Learn Analysis", "Structure Protocol"]) {
    await clickReviewTab(page, tab);
    await slowPagePass(page, `评审 ${tab}`, 3, 420);
    await horizontalScrollTimelines(page);
  }

  await scrollToText(page, "模板库", "模板库");
  await openIfCollapsed(page, "模板库", "模板库");
  await slowPagePass(page, "模板库", 3, 420);

  await scrollToText(page, "Knowledge Base", "Knowledge Base");
  await openIfCollapsed(page, "Knowledge Base", "Knowledge Base");
  for (const view of ["结构视图", "场景视图", "来源视图"]) {
    await maybeClick(page.getByRole("button", { name: new RegExp(view) }), `Knowledge Base：${view}`, 1600);
    await slowPagePass(page, `Knowledge Base ${view}`, 2, 360);
  }
  await wait(VIEW_PAUSE_MS);

  await scrollToText(page, "2 · Generate", "Generate");
  await openIfCollapsed(page, "2 · Generate", "Generate");
  await maybeFill(page.getByLabel("新主题"), "护眼桌面灯 / AI 创作平台 demo", "填写新主题", 1600);
  await maybeFill(page.getByLabel("卖点（逗号分隔）"), "低眩光, 专注学习, 高级桌面氛围, 一键生成短视频", "填写卖点", 1600);
  await selectTargetAssets(page);
  await slowPagePass(page, "目标素材选择区", 3, 380);
  await scrollToText(page, "素材缺口雷达", "素材缺口雷达");
  await horizontalScrollTimelines(page);
  await slowPagePass(page, "素材缺口雷达", 2, 420);
  await scrollToText(page, "用 AI 自动补全", "AI 补全选项");
  await maybeClick(page.getByText("高级补全选项", { exact: false }), "展开高级补全选项", 1600);
  await maybeFill(page.getByPlaceholder("例如：开头三秒更抓人", { exact: false }), "开头三秒更抓人，字幕更少，CTA 提前，清理残留英文和运动鞋文案。", "填写自然语言自定义需求", 1800).catch(() => undefined);
  await maybeClick(page.getByRole("button", { name: /预设模板/ }), "切换到预设模板生成方式", 1800);
  await maybeClick(page.getByRole("button", { name: /高点击/ }), "选择高点击预设", 1600);

  if (RUN_GENERATE) {
    await maybeDisableAigc(page);
    await scrollToText(page, "用此模板生成", "生成按钮");
    await maybeClick(page.getByRole("button", { name: /用此模板生成视频|按 LLM 改写生成|用此模板生成 3 个版本/ }), "点击生成", 2500);
    await wait(4000);
    await page.screenshot({ path: path.join(OUT_DIR, "02-generating.png"), fullPage: false });
    const result = page.getByText("3 · Result", { exact: false }).first();
    await result.waitFor({ state: "visible", timeout: Number(process.env.GENERATE_WAIT_MS ?? 180000) })
      .then(() => mark("生成完成并出现 Result 区"))
      .catch((error) => skip(`生成未在时限内完成: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`));
  } else {
    skip("未执行真实生成：设置 RUN_GENERATE=1 可录制 Result 动态生成流程");
  }

  if (await scrollToText(page, "多版本对比", "多版本对比")) {
    await playFirstVisibleVideo(page, "多版本对比", 1600);
  }
  if (await scrollToText(page, "3 · Result", "Result")) {
    await playFirstVisibleVideo(page, "Result final.mp4", 2800);
    await scrollToText(page, "生成后一致性检查", "生成后一致性检查");
    await horizontalScrollTimelines(page);
    await scrollToText(page, "自然语言改片", "自然语言改片");
    await maybeFill(page.getByPlaceholder("例如：开头更抓人一些", { exact: false }), "把商品信息提前，减少字幕密度，整体更高级。", "填写自然语言改片指令", 1500);
  }

  for (const tab of ["Gap Decisions", "Transfer Map", "Packaging"]) {
    await clickReviewTab(page, tab);
    await slowPagePass(page, `评审 ${tab}`, 3, 420);
    await horizontalScrollTimelines(page);
  }

  await scrollToText(page, "评审证据中心", "回到评审证据中心导出");
  await openIfCollapsed(page, "评审证据中心", "评审证据中心");
  await clickReviewTab(page, "Export");
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
    runGenerate: RUN_GENERATE,
    safeLocalGenerate: SAFE_LOCAL_GENERATE,
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
