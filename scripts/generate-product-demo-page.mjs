#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marketingArtifactDir, artifactRoot, rel } from "./artifact-paths.mjs";

const demoDir = path.join(artifactRoot, "product_demo");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreCell(evaluation) {
  const style = evaluation?.styleFidelity?.overall ?? evaluation?.style_fidelity_to_sample?.overall;
  const gates = evaluation?.gates ?? [];
  const failed = gates.filter((gate) => gate.passed === false);
  return `${evaluation?.passed ? "PASS" : "CHECK"}${style ? ` · style ${style}` : ""}${failed.length ? ` · ${failed.length} failed gates` : ""}`;
}

const analysis = await readJson(path.join(marketingArtifactDir, "analysis.marketing.json"), {});
const template = await readJson(path.join(marketingArtifactDir, "structure-template.json"), {});
const generation = await readJson(path.join(marketingArtifactDir, "generation-result.json"), {});
const variantSummaryRaw = await readJson(path.join(marketingArtifactDir, "variant-summary.json"), { variants: [] });
const variants = Array.isArray(variantSummaryRaw) ? variantSummaryRaw : variantSummaryRaw.variants ?? [];
const corpus = await readJson(path.join(artifactRoot, "corpus_regression", "corpus-regression-report.json"), {});
const evaluations = {};
for (const label of ["explainable_demo", "main", "high_ctr", "high_quality", "high_fidelity"]) {
  evaluations[label] = await readJson(path.join(marketingArtifactDir, `evaluation.${label}.json`), {});
}

const ribbon = analysis.motionGeometry?.ribbonMotion ?? template.visualStyle?.ribbonMotion ?? {};
const rows = (generation.slotMapping ?? [])
  .map(
    (mapping) =>
      `<tr><td>${esc(mapping.slotType)}</td><td>${esc(mapping.status)}</td><td>${esc(mapping.assetAvailability ?? "n/a")}</td><td>${esc(mapping.selectedTargetAssetId ?? mapping.selectedAssetId ?? mapping.selectedShotId ?? "-")}</td></tr>`
  )
  .join("");
const gapRows = (generation.gapReport ?? [])
  .map(
    (gap) =>
      `<tr><td>${esc(gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId)}</td><td>${esc(gap.severity)}</td><td>${esc(gap.fillSource ?? "-")}</td><td>${esc((gap.recommendedFillStrategies ?? []).join(", "))}</td></tr>`
  )
  .join("");
const fillRows = (generation.fillPlan ?? [])
  .map(
    (action) =>
      `<tr><td>${esc(action.slotId)}</td><td>${esc(action.strategy)}</td><td>${esc(action.rendererInstructions?.renderer ?? "-")}</td><td>${esc(action.rendererInstructions?.atom ?? action.rendererInstructions?.layout ?? "-")}</td></tr>`
  )
  .join("");
const variantCards = variants
  .map((variant) => {
    const file = path.basename(variant.mp4 ?? variant.path ?? "");
    const evalKey = variant.label === "high_fidelity" ? "high_fidelity" : variant.label;
    return `<article class="output-card">
      <h3>${esc(variant.label)}</h3>
      <video controls src="../marketing_case/${esc(file)}"></video>
      <p>${esc(variant.metadata?.durationSec ?? variant.durationSec)}s · ${esc(variant.metadata?.width ?? 720)}x${esc(variant.metadata?.height ?? 1280)} · ${esc(variant.hashes?.md5 ?? variant.md5 ?? "")}</p>
      <p>${esc(scoreCell(evaluations[evalKey]))}</p>
    </article>`;
  })
  .join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>爆款结构迁移引擎 · Product Demo</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif; background: #f6f6f2; color: #161616; }
    header { padding: 24px 28px 14px; border-bottom: 1px solid #d8d6cc; }
    h1 { margin: 0 0 8px; font-size: clamp(28px, 4vw, 46px); letter-spacing: 0; }
    p { line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding: 18px; }
    section { min-width: 0; background: #fffefa; border: 1px solid #dedbd0; border-radius: 8px; padding: 16px; }
    h2 { margin: 0 0 12px; font-size: 20px; }
    h3 { margin: 0 0 8px; font-size: 15px; }
    img, video { width: 100%; border-radius: 6px; background: #111; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #ece8dc; padding: 7px 6px; text-align: left; vertical-align: top; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .pill { display: inline-block; border: 1px solid #c7c2b5; border-radius: 999px; padding: 3px 8px; margin: 0 4px 4px 0; font-size: 12px; }
    .output-card { border: 1px solid #e3dfd3; border-radius: 8px; padding: 10px; margin-bottom: 12px; background: #fff; }
    @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>可解释短视频结构迁移工作台</h1>
    <p>Sample video → structure template → slot mapping/gap report → fill plan → renderer-backed timeline → creative MP4s. 默认不复制样例帧、音频或品牌资产。</p>
  </header>
  <main class="grid">
    <section>
      <h2>Left · Sample Understanding</h2>
      <img src="../marketing_case/input_t7.png" alt="sample frame" />
      <p><span class="pill">${esc(analysis.primaryMotif?.motif)}</span><span class="pill">${esc(template.videoType)}</span><span class="pill">tail excluded ${(template.excludeSegments ?? []).length}</span></p>
      <table>
        <tr><th>Duration</th><td>${esc(analysis.metadata?.durationSec)}s</td></tr>
        <tr><th>Geometry</th><td><code>${esc(ribbon.surfaceType)} / ${esc(ribbon.pathFamily)} / ${esc(ribbon.axis)} / ${esc(ribbon.depthBehavior)}</code></td></tr>
        <tr><th>Relation</th><td><code>${esc(ribbon.layoutRelation)} / ${esc(ribbon.textRelation)}</code></td></tr>
        <tr><th>Excluded</th><td>${esc((template.excludeSegments ?? []).map((s) => `${s.startSec}-${s.endSec}s ${s.reason}`).join("; ") || "none")}</td></tr>
      </table>
    </section>
    <section>
      <h2>Middle · Transfer Plan</h2>
      <p><strong>${esc(template.name)}</strong></p>
      <p>${(template.structureAtoms ?? []).slice(0, 8).map((atom) => `<span class="pill">${esc(atom.name)}</span>`).join("")}</p>
      <h3>Slot Mapping</h3>
      <table><thead><tr><th>Slot</th><th>Status</th><th>Asset state</th><th>Selected</th></tr></thead><tbody>${rows}</tbody></table>
      <h3>Gap Report</h3>
      <table><thead><tr><th>Gap</th><th>Severity</th><th>Fill source</th><th>Strategies</th></tr></thead><tbody>${gapRows}</tbody></table>
      <h3>Fill Plan / Renderer Backends</h3>
      <table><thead><tr><th>Slot</th><th>Strategy</th><th>Backend</th><th>Atom/Layout</th></tr></thead><tbody>${fillRows}</tbody></table>
      <h3>Natural-language Edits</h3>
      <p><span class="pill">去掉解释性文字</span><span class="pill">换成白底高质感风格</span><span class="pill">让 ribbon 更慢、更高级</span><span class="pill">把 CTA 提前</span></p>
    </section>
    <section>
      <h2>Right · Outputs</h2>
      ${variantCards}
      <h3>Contact Sheet</h3>
      <img src="../marketing_case/contact_sheet.png" alt="input explainable high fidelity contact sheet" />
      <p>Corpus regression: ${esc(corpus.summary?.passed ?? 0)} passed / ${esc(corpus.summary?.total ?? 0)} total. VLM judge is skipped by default unless frame upload is explicitly allowed.</p>
    </section>
  </main>
</body>
</html>`;

await mkdir(demoDir, { recursive: true });
await writeFile(path.join(demoDir, "index.html"), html, "utf8");
console.log(`Product demo written to ${rel(path.join(demoDir, "index.html"))}`);
