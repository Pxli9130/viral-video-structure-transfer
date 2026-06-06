#!/usr/bin/env node
/**
 * Assemble the marking/ grading package from a marking-pipeline run (docs/artifacts/marking_run/).
 * REPLACES the per-run outputs (case-evidence/, demo-videos/, reports/) and KEEPS the scoring scaffold
 * (RUBRIC.md, MARKING_INDEX.md, README.md, RUN_COMMANDS.md, project-docs/). Updates the run-outputs index.
 *
 *   node scripts/build-marking-package.mjs [--run docs/artifacts/marking_run] [--marking marking]
 */
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, rm, readdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const RUN = path.resolve(ROOT, arg("--run", "docs/artifacts/marking_run"));
const MARK = path.resolve(ROOT, arg("--marking", "marking"));

// Per-case artifacts to carry into marking/case-evidence/<case>/ (skipped if absent).
const CASE_FILES = [
  "theme.json", "analysis.json", "learned-template.json", "technique-atoms.json",
  "slot-mapping.json", "gap-report.json", "fill-plan.json", "aigc-material-fill.json",
  "timeline.json", "render-recipe.json", "render-recipe.base.json", "render-recipe.high_click.json",
  "render-recipe.high_quality.json", "structure-explanation.md", "version-diff.md",
  "render-quality.json", "final-gates.json", "case-summary.json",
  "render-contact-sheet.png", "render-contact-sheet.remotion.png"
];
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

async function main() {
  if (!existsSync(RUN)) throw new Error(`run dir not found: ${RUN} (run scripts/run-marking-pipeline.mjs first)`);
  const runSummary = readJson(path.join(RUN, "RUN_SUMMARY.json")) ?? { samples: [] };
  const themes = readJson(path.join(RUN, "themes.json")) ?? {};
  const cases = (await readdir(RUN, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

  // 1) Replace ONLY per-run output dirs; keep scaffold + project-docs.
  for (const sub of ["case-evidence", "demo-videos", "reports"]) {
    await rm(path.join(MARK, sub), { recursive: true, force: true });
    await mkdir(path.join(MARK, sub), { recursive: true });
  }
  await mkdir(path.join(MARK, "demo-videos"), { recursive: true });

  // 2) Per case: copy evidence chain + videos + preview frames.
  const rows = [];
  for (const c of cases) {
    const src = path.join(RUN, c);
    const dstCase = path.join(MARK, "case-evidence", c);
    await mkdir(dstCase, { recursive: true });
    for (const f of CASE_FILES) { const s = path.join(src, f); if (existsSync(s)) await copyFile(s, path.join(dstCase, f)); }
    if (existsSync(path.join(src, "preview_frames"))) await cp(path.join(src, "preview_frames"), path.join(dstCase, "preview_frames"), { recursive: true });
    for (const v of ["final.mp4", "final.remotion.mp4", "render-contact-sheet.png", "render-contact-sheet.remotion.png"]) {
      const s = path.join(src, v); if (existsSync(s)) await copyFile(s, path.join(MARK, "demo-videos", `${c}.${v.replace("render-contact-sheet", "contact")}`));
    }
    const sum = readJson(path.join(src, "case-summary.json")) ?? {};
    const t = themes[c] ?? sum.theme ?? {};
    rows.push({ c, t, sum });
  }

  // 3) reports/: run summary + showcase + diversity.
  if (existsSync(path.join(RUN, "diversity_matrix.json"))) await copyFile(path.join(RUN, "diversity_matrix.json"), path.join(MARK, "reports", "diversity_matrix.json"));
  const tbl = (r) => `| ${r.c} | ${r.t?.name ?? "?"} (${r.t?.en ?? ""}) | ${r.sum?.videoType ?? "?"} | ${r.sum?.final?.duration?.toFixed?.(1) ?? "?"}s ${r.sum?.final?.width ?? "?"}x${r.sum?.final?.height ?? "?"} | ${r.sum?.final?.meanVolumeDb ?? "?"}dB | ${r.sum?.gaps ?? "?"} | ${r.sum?.aigcGenerated ?? "?"} | ${r.sum?.finalGates ? r.sum.finalGates.pass + "P/" + r.sum.finalGates.fail + "F/" + (r.sum.finalGates.blocked ?? 0) + "B" : "?"} |`;
  const summaryMd = [
    "# Marking run summary（结构迁移全链路 · 每条样例随机真实产品主题）", "",
    `生成时间：${runSummary.generatedAt ?? "n/a"}。每条 = 一个样例视频 → 学结构 → 迁移到一个随机真实产品主题 → 重组新视频（FFmpeg + Remotion 双渲染）。素材：copy 来自主题、产品图由 gap-fill→AIGC（Gemini）生成、其余程序化。`, "",
    "| 样例 | 随机产品主题 | 学到的 videoType | 成片 | 音频 | 缺口数 | AIGC生成素材 | final-gates |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(tbl), "",
    "## 跨样例多样性 (layout NCC)",
    "见 `reports/diversity_matrix.json`（同一引擎、不同样例 → 结构各异，证明非固定模具）。", "",
    "## 每条样例的完整证据链",
    "见 `case-evidence/<case>/`：theme · analysis · learned-template · technique-atoms · slot-mapping · gap-report · fill-plan · aigc-material-fill · timeline · render-recipe(+base/high_click/high_quality) · structure-explanation · version-diff · render-quality · final-gates · case-summary · 成片 + contact sheet + 逐片预览帧。"
  ].join("\n");
  await writeFile(path.join(MARK, "reports", "RUN_SUMMARY.md"), summaryMd);
  await writeFile(path.join(MARK, "reports", "showcase-report.md"), summaryMd);

  // 4) top-level run index + themes.
  await copyFile(path.join(RUN, "themes.json"), path.join(MARK, "themes.json"));
  await writeFile(path.join(MARK, "RUN_OUTPUTS.md"), [
    "# 本轮产出索引（rubric 映射）", "",
    "本轮按课题要求重跑完整链路：4 条样例各取一条 `test_videos/*.mov` 作为输入，各随机分配一个真实产品主题，重组出新视频。", "",
    "| rubric 项 | 证据位置 |", "|---|---|",
    "| 1 样例输入与基础解析 | `case-evidence/<case>/analysis.json` |",
    "| 2 结构拆解（脚本/节奏/包装） | `case-evidence/<case>/learned-template.json` · `technique-atoms.json` · `structure-explanation.md` |",
    "| 3 结构迁移生成（分镜/时间线/成片） | `slot-mapping.json` · `timeline.json` · `render-recipe.json` · `demo-videos/<case>.final.mp4` |",
    "| 4 素材缺口识别 | `gap-report.json` |",
    "| 5 素材缺口补全（AIGC/程序化） | `fill-plan.json` · `aigc-material-fill.json` |",
    "| 6 迁移过程可视化 | `structure-explanation.md` · `demo-videos/<case>.contact.png` · `preview_frames/` |",
    "| 7 最终效果展示 | `demo-videos/<case>.final.mp4` + `.final.remotion.mp4` |",
    "| 8 画面包装 | `render-recipe.json` (layers: text/media/motion_atom/transition) |",
    "| 9 多版本生成 | `render-recipe.{base,high_click,high_quality}.json` · `version-diff.md` |",
    "| 10 真实素材适配 | `aigc-material-fill.json`（生成素材带 provenance） |",
    "| 可验证性/gate | `render-quality.json`（含 audio_not_silent + no_long_blank_section） · `final-gates.json`（G1–G30） · `reports/RUN_SUMMARY.md` |", "",
    `主题分配：${Object.entries(themes).map(([k, v]) => `${k}→${v.name}`).join(" · ")}`
  ].join("\n"));

  const ok = rows.filter((r) => !r.sum?.error).length;
  console.log(`[build-marking] assembled ${rows.length} cases (${ok} with summary) → ${MARK}`);
  console.log(`  kept scaffold: RUBRIC.md, MARKING_INDEX.md, README.md, RUN_COMMANDS.md, project-docs/`);
  for (const r of rows) console.log(`  ${r.c}: ${r.t?.name ?? "?"} → ${r.sum?.final?.duration?.toFixed?.(1) ?? "?"}s`);
}

main().catch((e) => { console.error(`[build-marking] fatal: ${e?.message ?? e}`); process.exit(1); });
