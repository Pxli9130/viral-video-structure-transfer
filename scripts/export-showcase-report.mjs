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
    ["ElevenLabs Scribe", "Optional ASR", "No", "ELEVENLABS_API_KEY", "Local faster-whisper", "aigc_generated_material", "Only user-provided target audio if allowed"],
    ["ElevenLabs TTS", "Optional voice", "No", "ELEVENLABS_API_KEY", "Local FFmpeg/procedural audio", "aigc_generated_material", "No sample audio sent"],
    ["ElevenLabs SFX/Music/Isolation", "Optional audio generation/isolation", "No", "ELEVENLABS_API_KEY", "Local FFmpeg procedural SFX/BGM", "aigc_generated_material", "No sample audio sent"],
    ["Remotion + FFmpeg", "Core renderer", "Yes", "None", "N/A", "procedural/user_uploaded/source_video", "Runs locally without paid APIs"]
  ];
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
console.log(JSON.stringify({ outDir, html: path.join(outDir, "index.html"), json: path.join(outDir, "showcase-report.json") }, null, 2));

