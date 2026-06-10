#!/usr/bin/env node
import { chromium } from "playwright";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const REQUESTED_URL = process.env.UI_URL;
const DEFAULT_UI_URLS = ["http://127.0.0.1:5174/#v5", "http://127.0.0.1:5173/#v5", "http://127.0.0.1:5175/#v5"];
const API_HEALTH_URL = process.env.API_HEALTH_URL ?? "http://127.0.0.1:3000/healthz";
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? path.join(ROOT, "artifacts", "tiny-mix-ui-generate"));
const USE_AI_CODEGEN = process.env.USE_AI_CODEGEN !== "0";
const TARGET_FILES = [
  path.join(ROOT, "demo_upload_assets/foldcharge/online/01_phone_on_wireless_charger_video.mp4"),
  path.join(ROOT, "demo_upload_assets/foldcharge/online/03_wireless_charger_product_hero.jpg"),
  path.join(ROOT, "demo_upload_assets/foldcharge/online/04_phone_charging_workspace.jpg")
];

mkdirSync(OUT_DIR, { recursive: true });

function findExistingChromium() {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  const roots = [
    path.join(process.env.HOME ?? "", ".cache", "ms-playwright"),
    path.join(ROOT, "node_modules", ".cache", "ms-playwright")
  ].filter(Boolean).filter((dir) => existsSync(dir));
  const stack = [...roots];
  const candidates = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && ["chrome-headless-shell", "chrome"].includes(entry.name)) {
        try {
          if (statSync(full).mode & 0o111) candidates.push(full);
        } catch {
          // ignore unreadable candidates
        }
      }
    }
  }
  return candidates.sort((a, b) => Number(b.includes("chrome-headless-shell")) - Number(a.includes("chrome-headless-shell")))[0];
}

async function urlReachable(url, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveUiUrl() {
  if (REQUESTED_URL) {
    if (await urlReachable(REQUESTED_URL.replace(/#.*$/, ""))) return REQUESTED_URL;
    throw new Error(`UI_URL is not reachable: ${REQUESTED_URL}\nStart Web first: conda run --no-capture-output -n viral npm run dev:web`);
  }
  for (const candidate of DEFAULT_UI_URLS) {
    if (await urlReachable(candidate.replace(/#.*$/, ""))) return candidate;
  }
  throw new Error(`No Vite UI server found on ${DEFAULT_UI_URLS.map((u) => u.replace("/#v5", "")).join(", ")}\nStart Web first: conda run --no-capture-output -n viral npm run dev:web`);
}

async function waitForIdle(page, label, timeout = 180000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("上传中") && !document.body.innerText.includes("生成中") && !document.body.innerText.includes("学习中"),
    undefined,
    { timeout }
  ).catch(() => undefined);
  console.log(`[ui] idle after ${label}`);
}

async function clickVisible(locator, label, timeout = 10000) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout });
  await target.scrollIntoViewIfNeeded();
  await target.click({ timeout }).catch(async () => {
    await target.evaluate((node) => {
      if (node instanceof HTMLElement) node.click();
    });
  });
  console.log(`[ui] ${label}`);
}

async function main() {
  if (USE_AI_CODEGEN && process.env.ALLOW_EXTERNAL_AI_UI_RUN !== "1") {
    throw new Error(
      "This UI run enables '让 AI 现场编写动画代码' and may send uploaded media/workspace context to external AI adapters. " +
      "Run with ALLOW_EXTERNAL_AI_UI_RUN=1 only if you are doing it yourself and accept that external-service call."
    );
  }
  for (const file of TARGET_FILES) {
    if (!existsSync(file)) throw new Error(`missing target asset: ${file}`);
  }
  if (!(await urlReachable(API_HEALTH_URL))) {
    throw new Error(`API is not reachable: ${API_HEALTH_URL}\nStart API first: conda run --no-capture-output -n viral npm run dev:api`);
  }
  const url = await resolveUiUrl();
  const executablePath = findExistingChromium();
  if (!executablePath) throw new Error("Playwright Chromium executable was not found.");
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const logs = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message}`));

  try {
    console.log(`[ui] opening ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("爆款结构迁移创作引擎", { exact: false }).waitFor({ state: "visible", timeout: 30000 });
    await page.screenshot({ path: path.join(OUT_DIR, "01-open.png"), fullPage: true });

    const uploadSection = page.locator("section").filter({ hasText: "0 · Upload" }).first();
    await uploadSection.scrollIntoViewIfNeeded();
    await uploadSection.locator("input[type=file]").nth(1).setInputFiles(TARGET_FILES);
    await page.screenshot({ path: path.join(OUT_DIR, "02-target-files-selected.png"), fullPage: true });
    await clickVisible(uploadSection.getByRole("button", { name: "Upload" }).nth(1), "上传目标素材");
    await waitForIdle(page, "upload", 180000);

    const generateSection = page.locator("#v5-generate");
    await generateSection.scrollIntoViewIfNeeded();
    await clickVisible(generateSection.getByRole("button", { name: /混合多视频元素/ }), "切换到混合多视频元素");
    const codegenInput = generateSection.locator("label").filter({ hasText: "让 AI 现场编写动画代码" }).locator("input[type=checkbox]");
    if (USE_AI_CODEGEN) {
      await codegenInput.check({ force: true });
      console.log("[ui] 开启 AI 现场编写动画代码");
    } else {
      await codegenInput.uncheck({ force: true }).catch(() => undefined);
      console.log("[ui] 关闭 AI 现场编写动画代码（安全本地模式）");
    }

    await generateSection.locator("label").filter({ hasText: /^主题/ }).locator("input").fill("FoldCharge 磁吸折叠三合一旅行充电器");
    await generateSection.locator("label").filter({ hasText: /^卖点/ }).locator("input").fill("三合一无线充, 折叠便携, 桌面整洁, 出差随身");

    const targetToggle = generateSection.locator("[role=button][title='展开目标素材']").first();
    if (await targetToggle.count()) await clickVisible(targetToggle, "展开目标素材");
    for (const file of TARGET_FILES) {
      const name = path.basename(file);
      await clickVisible(generateSection.getByRole("button").filter({ hasText: name }), `选择目标素材 ${name}`);
    }
    await page.screenshot({ path: path.join(OUT_DIR, "03-mix-codegen-assets-selected.png"), fullPage: true });

    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/v5/generations") && response.request().method() === "POST",
      { timeout: 900000 }
    );
    await clickVisible(generateSection.getByRole("button", { name: /Mix & Generate video/ }), "点击 Mix & Generate video");
    const response = await responsePromise;
    const raw = await response.text();
    writeFileSync(path.join(OUT_DIR, "generation-response.raw.json"), raw);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { ok: false, raw };
    }
    const result = parsed?.data ?? parsed;
    writeFileSync(path.join(OUT_DIR, "generation-result.json"), JSON.stringify(result, null, 2));
    if (!response.ok()) throw new Error(`generation request failed: HTTP ${response.status()} ${raw.slice(0, 400)}`);

    await waitForIdle(page, "generate", 60000);
    await page.screenshot({ path: path.join(OUT_DIR, "04-generation-finished.png"), fullPage: true });

    if (result?.finalVideoUrl) {
      const rel = String(result.finalVideoUrl).replace(/^\/generated\//, "");
      const localFinal = path.join(ROOT, "storage", "generated", rel);
      if (existsSync(localFinal)) {
        copyFileSync(localFinal, path.join(OUT_DIR, "final.mp4"));
      }
    }

    writeFileSync(path.join(OUT_DIR, "browser-console.log"), logs.join("\n"));
    console.log(JSON.stringify({
      outDir: OUT_DIR,
      generationId: result?.generationId,
      finalVideoUrl: result?.finalVideoUrl,
      warnings: result?.warnings ?? []
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
