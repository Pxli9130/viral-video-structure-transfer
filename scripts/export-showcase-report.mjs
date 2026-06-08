#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCaseGates } from "./evaluate-final-gates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function h(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rel(file, from) {
  return path.relative(from, file).split(path.sep).join("/");
}

function layerCounts(recipe) {
  const layers = recipe?.layers ?? [];
  return {
    media: layers.filter((layer) => layer.type === "media").length,
    text: layers.filter((layer) => layer.type === "text").length,
    motion: layers.filter((layer) => layer.type === "motion_atom").length,
    audio: layers.filter((layer) => layer.type === "audio").length
  };
}

function evidenceCounts(template) {
  return {
    visual: template?.visualElementGraph?.elements?.length ?? 0,
    typography: template?.typographyEvidence?.length ?? 0,
    motion: template?.motionAtoms?.length ?? 0,
    audio: Object.keys(template?.audioStructure?.estimatedLayers ?? {}).length
  };
}

function primitiveHistogram(recipe) {
  const hist = {};
  for (const clip of recipe?.clips ?? []) hist[clip.selectedPrimitive] = (hist[clip.selectedPrimitive] ?? 0) + 1;
  return hist;
}

function caseRootFor(name, rootArg) {
  const roots = [
    rootArg ? path.resolve(rootArg, name) : undefined,
    path.join(ROOT, "docs/artifacts/final_submission", name),
    path.join(ROOT, "docs/artifacts/learned_samples", name),
    path.join(ROOT, "docs/artifacts/learned_samples_max", name)
  ].filter(Boolean);
  return roots.find((candidate) => existsSync(candidate)) ?? roots[0];
}

function loadCase(name, caseRoot) {
  const template = readJson(path.join(caseRoot, "learned-template.json"))?.template ?? readJson(path.join(caseRoot, "learned-template.json"));
  const generation = readJson(path.join(caseRoot, "generation.json"));
  const timeline = readJson(path.join(caseRoot, "timeline.json")) ?? generation?.timeline;
  const recipe = readJson(path.join(caseRoot, "render-recipe.v4.1.json")) ?? readJson(path.join(caseRoot, "render-recipe.json")) ?? timeline?.renderPlan?.renderRecipe;
  const gapReport = readJson(path.join(caseRoot, "gap-report.json")) ?? timeline?.gapReport ?? generation?.gapReport ?? [];
  const gates = evaluateCaseGates(caseRoot);
  const finalMp4 = ["final.mp4", "marketing.final.mp4"].map((file) => path.join(caseRoot, file)).find(existsSync);
  const remotionMp4 = ["final.remotion.mp4", "marketing.final.remotion.mp4"].map((file) => path.join(caseRoot, file)).find(existsSync);
  return {
    name,
    caseRoot,
    template,
    generation,
    timeline,
    recipe,
    gapReport,
    gates,
    evidenceCounts: evidenceCounts(template),
    layerCounts: layerCounts(recipe),
    primitiveHistogram: primitiveHistogram(recipe),
    finalMp4,
    remotionMp4
  };
}

function providerMatrix() {
  return [
    ["Seedance 2.0", "Optional video generation", "No", "SEEDANCE_API_KEY / SEEDANCE_ARK_API_KEY", "Local Remotion procedural motion", "aigc_generated_material", "Sample frames/audio never sent"],
    ["Seedream 4.0", "Optional image generation", "No", "SEEDREAM_ARK_API_KEY / AIGC_IMAGE_MODEL", "Local packaging/procedural visuals", "aigc_generated_material", "Text-only prompts; no sample frames"],
    ["Google Lyria", "Optional music bed", "No", "GEMINI_API_KEY", "Local FFmpeg procedural BGM/SFX", "aigc_generated_material", "No sample audio sent"],
    ["Gemini TTS", "Optional voiceover", "No", "GEMINI_API_KEY", "Subtitles + local procedural audio", "aigc_generated_material", "No sample audio sent"],
    ["faster-whisper + FFmpeg/librosa", "Local ASR/audio analysis", "Yes", "None", "No ASR with warning", "read_only_report", "Sample audio analyzed locally only"],
    ["Remotion + FFmpeg", "Core renderer", "Yes", "None", "N/A", "procedural/user_uploaded/source_video", "Runs locally without paid APIs"]
  ];
}

function readVisualQa(item) {
  return readJson(path.join(item.caseRoot, "visual-qa-report.json"));
}

function renderChineseMarkdown(cases) {
  const caseRows = cases.map((item) => {
    const visualQa = readVisualQa(item);
    return `| ${item.name} | ${item.template?.videoType ?? "n/a"} | ${item.evidenceCounts.visual}/${item.evidenceCounts.typography}/${item.evidenceCounts.audio}/${item.evidenceCounts.motion} | ${item.layerCounts.media}/${item.layerCounts.text}/${item.layerCounts.motion}/${item.layerCounts.audio} | \`${JSON.stringify(item.primitiveHistogram)}\` | ${item.gates.status} | ${visualQa?.risk ?? "not-run"} | [final.mp4](${path.relative(path.join(ROOT, "docs/artifacts"), item.finalMp4 ?? item.caseRoot).split(path.sep).join("/")}) |`;
  }).join("\n");
  const comparisons = cases.map((item) => {
    const expected =
      item.name === "marketing"
        ? "海报式产品包装、ribbon/sweep 动势、干净 CTA"
        : item.name === "editing"
          ? "卡点、快切、字幕强调、CTA 收束"
          : "运动图形节奏、kinetic typography、程序化动势";
    return `### ${item.name}

- 样例结构摘要：${expected}
- 生成结果摘要：${item.layerCounts.media} 个 media layer、${item.layerCounts.text} 个 text layer、${item.layerCounts.motion} 个 motion atom layer、${item.layerCounts.audio} 个 audio layer。
- 迁移了什么：节奏结构、primitive 序列、文字层级、运动/音频计划和 CTA 位置。
- 没有复制什么：不复制样例帧、不复制样例音频、不复刻水印；样例只作为结构证据。
- Gap/Fill：${Array.isArray(item.gapReport) ? item.gapReport.length : 0} 个 gap 条目，缺口通过本地程序化/目标素材策略补齐。
`;
  }).join("\n");
  return `# Spec v4.2 Showcase Report

## 1. 项目一句话

学结构，不抄内容。样例视频只作为结构证据，目标素材、用户授权素材、程序化素材或带 provenance 的生成素材才进入最终画面。

## 2. Pipeline

\`\`\`text
analysis -> template -> technique atoms -> slot matching -> gap report -> fill plan -> render recipe -> renderer -> gates
\`\`\`

这条链路的核心契约是 \`RenderRecipe v4.1\`：renderer 消费显式的 media/text/motion/audio layers，而不是从 prompt 里重新猜画面。

## 3. Four Sample Cases

| Case | Sample type | evidence v/t/a/m | layers media/text/motion/audio | primitive histogram | final gates | visual QA risk | video |
| --- | --- | --- | --- | --- | --- | --- | --- |
${caseRows}

## 4. Side-by-side Comparison

${comparisons}

## 5. Safety / Provider Policy

- 本地严格路由评估：cloud disabled，sample media external upload = 0。
- 不把样例帧/样例音频作为 AIGC 生成参考上传。
- \`rawPromptRenderable=false\`，prompt 只做规划元数据，不进入展示文案。
- 生成素材必须标记 provenance；缺素材时写 gap/fill，不用 mock 占位假装完成。

## 6. Known Limitations

- FFmpeg \`final.mp4\` 是当前 canonical 输出。
- Remotion fresh host render 在 sandbox 中仍可能被 \`uv_interface_addresses returned Unknown system error 1\` 阻断；见 \`docs/remotion-host-verification.md\`。
- 当前 visual QA 是本地启发式，不是外部 VLM 观感评审；提交前仍需人工打开四个 \`final.mp4\`。
- 本地 demo 未调用 Seedance/Seedream/Gemini/OpenAI/Qwen/Deepgram/Runway/Veo/Kling。

## 7. How to Reproduce

\`\`\`bash
npm install
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run build --workspace @vvst/shared
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm test
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/evaluate-model-routes.mjs --offline --json --strict-policy
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/run-learn-samples-max.mjs --offline --no-remotion --no-gate
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/evaluate-final-gates.mjs
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/visual-qa-report.mjs --all-cases
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-showcase-report.mjs
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-submission-artifacts.mjs
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/verify-remotion-host.mjs --case marketing
\`\`\`
`;
}

function renderChineseHtml(cases) {
  const rows = cases.map((item) => {
    const visualQa = readVisualQa(item);
    const video = item.finalMp4 ? path.relative(path.join(ROOT, "docs/artifacts"), item.finalMp4).split(path.sep).join("/") : "";
    const contact = path.relative(path.join(ROOT, "docs/artifacts"), path.join(item.caseRoot, "render-contact-sheet.png")).split(path.sep).join("/");
    return `<section>
      <h2>${h(item.name)}</h2>
      ${video ? `<video controls src="${h(video)}"></video>` : `<p class="fail">final.mp4 missing</p>`}
      <img src="${h(contact)}" alt="${h(item.name)} contact sheet" />
      <p>证据 visual/typography/audio/motion：${item.evidenceCounts.visual}/${item.evidenceCounts.typography}/${item.evidenceCounts.audio}/${item.evidenceCounts.motion}</p>
      <p>层 media/text/motion/audio：${item.layerCounts.media}/${item.layerCounts.text}/${item.layerCounts.motion}/${item.layerCounts.audio}</p>
      <p>Primitive：<code>${h(JSON.stringify(item.primitiveHistogram))}</code></p>
      <p>Final gates：${h(item.gates.status)}；Visual QA risk：${h(visualQa?.risk ?? "not-run")}</p>
      <p><a href="${h(path.relative(path.join(ROOT, "docs/artifacts"), path.join(item.caseRoot, "visual-qa-report.md")).split(path.sep).join("/"))}">visual QA</a></p>
    </section>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spec v4.2 Showcase Report</title><style>body{font-family:Inter,system-ui,sans-serif;background:#f6f7f9;color:#172033;margin:0}main{max-width:1280px;margin:auto;padding:24px}section{background:white;border:1px solid #d8dee8;border-radius:8px;padding:16px;margin:16px 0}video,img{display:block;max-width:420px;width:100%;margin:10px 0;background:#05060a}code{white-space:pre-wrap}.fail{color:#be123c}</style></head><body><main><h1>Spec v4.2 Showcase Report</h1><p>学结构，不抄内容。样例只作为结构证据，目标/用户/生成素材进入最终画面。</p>${rows}<h2>Safety / Provider Policy</h2><p>本地 strict route 关闭 cloud，禁止外部样例媒体上传；FFmpeg final.mp4 是当前 canonical 输出；Remotion host 验证见 docs/remotion-host-verification.md。</p></main></body></html>`;
}

function renderAtomCards(item) {
  const atoms = item.template?.techniqueAtoms ?? [];
  if (!atoms.length) return `<p class="muted">No TechniqueAtom array persisted in this artifact. Re-run learn/generate after PR2 to populate it.</p>`;
  return `<div class="cards">${atoms.map((atom) => `
    <article class="card">
      <h4>${h(atom.name)}</h4>
      <p><b>Category:</b> ${h(atom.category)} · <b>Confidence:</b> ${h(atom.confidence)}</p>
      <p><b>Evidence:</b> ${h((atom.sourceEvidenceRefs ?? []).slice(0, 3).join(", ") || atom.fallbackReason)}</p>
      <p><b>Required:</b> ${h((atom.requiredAssets ?? []).join(", "))}</p>
      <p><b>Renderer:</b> ${h(atom.renderer?.preferred)} / ${h(atom.renderer?.component)}</p>
      <p><b>Fallback:</b> ${h(atom.fallbackComponent ?? "none")}</p>
    </article>
  `).join("")}</div>`;
}

function renderGapRows(item) {
  const gaps = item.gapReport ?? [];
  if (!gaps.length) return `<tr><td colspan="6">No gaps recorded.</td></tr>`;
  return gaps.map((gap) => `
    <tr>
      <td>${h(gap.slotId)}</td>
      <td>${h(gap.status)}</td>
      <td>${h(gap.reason)}</td>
      <td>${h(gap.impact)}</td>
      <td>${h(gap.selectedRepair?.strategy ?? gap.recommendedFillStrategies?.[0] ?? "n/a")}</td>
      <td>${h(gap.expectedVisualResult ?? "")}</td>
    </tr>
  `).join("");
}

function renderLayerRows(item) {
  const layers = item.recipe?.layers ?? [];
  if (!layers.length) return `<tr><td colspan="7">No v4.1 layers in this artifact.</td></tr>`;
  return layers.slice(0, 80).map((layer) => `
    <tr>
      <td>${h(layer.id)}</td>
      <td>${h(layer.type)}</td>
      <td>${h(layer.clipId ?? "")}</td>
      <td>${h(layer.startSec)}</td>
      <td>${h(layer.durationSec)}</td>
      <td>${h(layer.zIndex)}</td>
      <td>${h((layer.evidenceRefs ?? []).slice(0, 2).join(", ") || layer.fallbackReason)}</td>
    </tr>
  `).join("");
}

function renderCaseSection(item, outDir) {
  const gateSummary = item.gates.summary;
  return `
    <section class="case" id="case-${h(item.name)}">
      <h2>${h(item.name)}</h2>
      <div class="grid">
        <div>
          <h3>Evidence / Structure</h3>
          <dl>
            <dt>Video type</dt><dd>${h(item.template?.videoType ?? "n/a")}</dd>
            <dt>Rhythm</dt><dd>${h(item.template?.rhythm?.pace)} · ${h(item.template?.rhythm?.bpm ?? "no bpm")} bpm</dd>
            <dt>Counts</dt><dd>visual ${item.evidenceCounts.visual}, typography ${item.evidenceCounts.typography}, motion ${item.evidenceCounts.motion}, audio ${item.evidenceCounts.audio}</dd>
          </dl>
        </div>
        <div>
          <h3>Render Preview</h3>
          ${item.finalMp4 ? `<video controls src="${h(rel(item.finalMp4, outDir))}"></video>` : `<p class="blocked">No final.mp4. See gates for the explicit failure/block reason.</p>`}
          ${item.remotionMp4 ? `<p><a href="${h(rel(item.remotionMp4, outDir))}">Open Remotion MP4</a></p>` : `<p class="muted">No Remotion MP4 in artifact.</p>`}
        </div>
        <div>
          <h3>Recipe Summary</h3>
          <p>Version: ${h(item.recipe?.version ?? item.recipe?.schemaVersion ?? "missing")}</p>
          <p>Layers: media ${item.layerCounts.media}, text ${item.layerCounts.text}, motion ${item.layerCounts.motion}, audio ${item.layerCounts.audio}</p>
          <p>Primitive histogram: <code>${h(JSON.stringify(item.primitiveHistogram))}</code></p>
        </div>
        <div>
          <h3>Gates</h3>
          <p class="${gateSummary.fail ? "fail" : "pass"}">pass ${gateSummary.pass} · fail ${gateSummary.fail} · blocked ${gateSummary.blocked}</p>
          <p><a href="${h(rel(path.join(item.caseRoot, "final-gates.json"), outDir))}">final-gates.json</a></p>
        </div>
      </div>
      <h3>TechniqueAtom Library</h3>
      ${renderAtomCards(item)}
      <h3>Asset Mapping + GapReport</h3>
      <table><thead><tr><th>Slot</th><th>Status</th><th>Reason</th><th>Impact</th><th>Selected repair</th><th>Expected result</th></tr></thead><tbody>${renderGapRows(item)}</tbody></table>
      <h3>Layer Timeline</h3>
      <table><thead><tr><th>Layer</th><th>Type</th><th>Clip</th><th>Start</th><th>Dur</th><th>z</th><th>Evidence/Fallback</th></tr></thead><tbody>${renderLayerRows(item)}</tbody></table>
    </section>`;
}

function buildHtml(cases, outDir) {
  const providerRows = providerMatrix().map((row) => `<tr>${row.map((cell) => `<td>${h(cell)}</td>`).join("")}</tr>`).join("");
  const artifactRows = cases.map((item) => `
    <tr>
      <td>${h(item.name)}</td>
      <td>${item.evidenceCounts.visual}</td>
      <td>${item.evidenceCounts.typography}</td>
      <td>${item.evidenceCounts.audio}</td>
      <td>${item.layerCounts.media}</td>
      <td>${item.layerCounts.text}</td>
      <td>${item.layerCounts.motion}</td>
      <td>${item.layerCounts.audio}</td>
      <td><code>${h(JSON.stringify(item.primitiveHistogram))}</code></td>
      <td>${item.gates.gates.find((gate) => gate.id === "G14_cta_prompt_not_visible")?.status ?? "n/a"}</td>
      <td>${item.gates.status}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Spec v4.1 Showcase Report</title>
  <style>
    body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f5f7f9;color:#172033}
    main{max-width:1480px;margin:0 auto;padding:24px}
    h1{font-size:34px;margin:0 0 8px} h2{margin-top:32px;border-top:1px solid #d9e1e7;padding-top:22px}
    .muted{color:#64748b}.blocked{color:#92400e}.pass{color:#0f766e;font-weight:800}.fail{color:#be123c;font-weight:800}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.grid>div,.card{background:#fff;border:1px solid #d9e1e7;border-radius:8px;padding:14px}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
    table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e1e7;margin:12px 0 24px}
    th,td{border-bottom:1px solid #e5ebef;padding:9px;text-align:left;vertical-align:top;font-size:13px}
    th{background:#eef3f6} code{font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap}
    video{width:100%;max-height:420px;background:#05060a}
    @media(max-width:1000px){.grid{grid-template-columns:1fr 1fr}} @media(max-width:640px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <h1>Spec v4.1 Demo + Submission Showcase</h1>
  <p class="muted">Generated ${h(new Date().toISOString())}. This report is deterministic/local and does not require paid cloud APIs.</p>
  <h2>Artifact Summary</h2>
  <table><thead><tr><th>Case</th><th>template visual</th><th>template typography</th><th>template audio</th><th>recipe media</th><th>text</th><th>motionAtom</th><th>audio</th><th>primitive histogram</th><th>CTA safe?</th><th>safety pass?</th></tr></thead><tbody>${artifactRows}</tbody></table>
  <h2>Provider Matrix</h2>
  <table><thead><tr><th>Provider</th><th>Purpose</th><th>Required?</th><th>Env vars</th><th>Fallback</th><th>Provenance policy</th><th>Safety notes</th></tr></thead><tbody>${providerRows}</tbody></table>
  ${cases.map((item) => renderCaseSection(item, outDir)).join("\n")}
</main></body></html>`;
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out ?? path.join(ROOT, "docs/artifacts/showcase_report"));
const artifactRoot = args.artifacts ? path.resolve(args.artifacts) : undefined;
const casesArg = String(args.cases ?? "marketing,editing,motion_graph_1,motion_graph_2");
const caseNames = casesArg.split(",").map((item) => item.trim()).filter(Boolean);
mkdirSync(outDir, { recursive: true });

const cases = caseNames.map((name) => {
  const item = loadCase(name, caseRootFor(name, artifactRoot));
  mkdirSync(item.caseRoot, { recursive: true });
  writeFileSync(path.join(item.caseRoot, "final-gates.json"), JSON.stringify(item.gates, null, 2));
  return item;
});

const reportJson = {
  generatedAt: new Date().toISOString(),
  cases: cases.map((item) => ({
    name: item.name,
    caseRoot: item.caseRoot,
    evidenceCounts: item.evidenceCounts,
    layerCounts: item.layerCounts,
    primitiveHistogram: item.primitiveHistogram,
    gates: item.gates
  })),
  providerMatrix: providerMatrix()
};
writeFileSync(path.join(outDir, "showcase-report.json"), JSON.stringify(reportJson, null, 2));
writeFileSync(path.join(outDir, "index.html"), buildHtml(cases, outDir));
const topMd = path.join(ROOT, "docs/artifacts/showcase-report.md");
const topHtml = path.join(ROOT, "docs/artifacts/showcase-report.html");
writeFileSync(topMd, renderChineseMarkdown(cases));
writeFileSync(topHtml, renderChineseHtml(cases));
console.log(JSON.stringify({ outDir, html: path.join(outDir, "index.html"), json: path.join(outDir, "showcase-report.json"), markdown: topMd, chineseHtml: topHtml }, null, 2));
