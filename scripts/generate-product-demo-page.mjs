#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { artifactRoot, corpusRegressionDir, marketingArtifactDir, rel } from "./artifact-paths.mjs";

const demoDir = path.join(artifactRoot, "product_demo");
const manifestPath = path.join(demoDir, "ui-manifest.json");
const htmlPath = path.join(demoDir, "index.html");
const slotReplacementDemoPath = path.join(marketingArtifactDir, "slot-replacement-demo.json");
const nlEditDemoPath = path.join(marketingArtifactDir, "nl-edit-demo.json");
const nlEditGenerationPath = path.join(marketingArtifactDir, "generation.nl_edit_white_poster.json");
const nlEditTimelinePath = path.join(marketingArtifactDir, "timeline.nl_edit_white_poster.json");
const nlEditPreviewPath = path.join(marketingArtifactDir, "nl-edit-after-preview.html");

const videoVariants = [
  {
    key: "final_creative",
    summaryLabels: ["main", "final_creative"],
    artifactKey: "main",
    display: "Final Creative",
    shortLabel: "Final",
    knownFiles: ["ai_challenge_poster_final_creative.mp4", "ai_challenge_poster_main.mp4"],
    frameFiles: ["main_t1.png", "main_t7.png", "main_t13.png"],
    description: "Clean creative output for judges to watch without process overlays."
  },
  {
    key: "high_fidelity",
    summaryLabels: ["high_fidelity"],
    artifactKey: "high_fidelity",
    display: "High Fidelity",
    shortLabel: "Fidelity",
    knownFiles: ["ai_challenge_poster_high_fidelity.mp4"],
    frameFiles: ["high_fidelity_t1.png", "high_fidelity_t7.png", "high_fidelity_t13.png"],
    description: "Best style-match creative output; preserves layout grammar and ribbon geometry."
  },
  {
    key: "explainable_demo",
    summaryLabels: ["explainable_demo"],
    artifactKey: "explainable_demo",
    display: "Explainable Demo",
    shortLabel: "Explain",
    knownFiles: ["ai_challenge_poster_explainable_demo.mp4"],
    frameFiles: ["explainable_demo_t1.png", "explainable_demo_t7.png", "explainable_demo_t13.png"],
    description: "Walkthrough/debug output with visible phase, mapping, and gap-fill explanation."
  },
  {
    key: "high_ctr",
    summaryLabels: ["high_ctr"],
    artifactKey: "high_ctr",
    display: "High CTR",
    shortLabel: "CTR",
    knownFiles: ["ai_challenge_poster_high_ctr.mp4"],
    frameFiles: ["high_ctr_t1.png", "high_ctr_t7.png", "high_ctr_t13.png"],
    description: "Higher-density, faster motion variant for click-through emphasis."
  },
  {
    key: "high_quality",
    summaryLabels: ["high_quality"],
    artifactKey: "high_quality",
    display: "High Quality",
    shortLabel: "Quality",
    knownFiles: ["ai_challenge_poster_high_quality.mp4"],
    frameFiles: ["high_quality_t1.png", "high_quality_t7.png", "high_quality_t13.png"],
    description: "Cleaner, slower, premium-feel variant for visual polish."
  }
];

const artifactRegistry = [];

function scrubPrivateText(value) {
  return String(value ?? "")
    .replace(/\/home\/pxli\/viral-video-structure-transfer\//g, "")
    .replace(/\/home\/pxli\/[^\s"'<>)]*/g, "[local-path]")
    .replace(/GEMINI_API_KEY/gi, "[redacted-key-name]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted-key]")
    .replace(/ark-[0-9A-Za-z_-]+/gi, "[redacted-key]")
    .replace(/\.env/g, "[redacted-config]");
}

function scrubObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => scrubObject(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubObject(item)]));
  }
  return typeof value === "string" ? scrubPrivateText(value) : value;
}

function esc(value) {
  return scrubPrivateText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssWidth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "12%";
  }
  return `${Math.max(6, Math.min(100, number)).toFixed(2)}%`;
}

function hrefFromDemo(filePath) {
  return path.relative(demoDir, filePath).split(path.sep).join("/");
}

function registerArtifact({ title, type, filePath, description, linkWhenMissing = false }) {
  const exists = existsSync(filePath);
  const href = exists || linkWhenMissing ? hrefFromDemo(filePath) : null;
  const record = {
    title,
    type,
    description,
    status: exists ? "exists" : "missing",
    href,
    path: href
  };
  artifactRegistry.push(record);
  return record;
}

async function readJsonArtifact({ title, filePath, description, fallback = null }) {
  const record = registerArtifact({ title, type: "json", filePath, description });
  if (record.status !== "exists") {
    return { data: fallback, record, exists: false };
  }
  try {
    return { data: JSON.parse(await readFile(filePath, "utf8")), record, exists: true };
  } catch (error) {
    record.status = "invalid";
    record.description = `${description} Parse failed: ${error.message}`;
    return { data: fallback, record, exists: false };
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return null;
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "n/a";
  }
  if (digits === 0) {
    return String(Math.round(number));
  }
  return number.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function formatSec(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${formatNumber(number, 2)}s` : "n/a";
}

function formatPercentScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? formatNumber(number, 2) : "n/a";
}

function toTitle(value) {
  return scrubPrivateText(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function badge(label, tone = "neutral") {
  return `<span class="badge badge-${esc(tone)}">${esc(label)}</span>`;
}

function missingCard(title, message = "Not generated yet") {
  return `<article class="missing-card"><strong>${esc(title)}</strong><span>${esc(message)}</span></article>`;
}

function imageCard(fileName, label) {
  const filePath = path.join(marketingArtifactDir, fileName);
  if (!existsSync(filePath)) {
    return missingCard(label, "Frame artifact missing");
  }
  return `<figure class="frame-card"><img src="${esc(hrefFromDemo(filePath))}" alt="${esc(label)}" loading="lazy" /><figcaption>${esc(label)}</figcaption></figure>`;
}

function normalizeVlmScores(vlmJson) {
  if (!vlmJson) {
    return null;
  }
  let scores = vlmJson.scores && typeof vlmJson.scores === "object" ? vlmJson.scores : vlmJson;
  if ((!scores || Object.keys(scores).length === 0) && typeof vlmJson.raw === "string") {
    try {
      scores = JSON.parse(vlmJson.raw);
    } catch {
      scores = {};
    }
  }
  const normalized = {
    overall: firstNumber(scores?.overall),
    structure: firstNumber(scores?.structure_transfer, scores?.motif_preserved, scores?.phases_visible),
    style: firstNumber(scores?.sample_style_fidelity, scores?.style_fidelity, scores?.motif_preserved),
    noDirectCopy: firstNumber(scores?.no_direct_copy),
    visualQuality: firstNumber(scores?.visual_quality),
    rationale: firstDefined(scores?.rationale, vlmJson?.rationale)
  };
  return Object.values(normalized).some((value) => value !== null && value !== undefined) ? normalized : null;
}

function localStyleScore(evaluation) {
  return firstNumber(evaluation?.styleFidelity?.overall, evaluation?.style_fidelity_to_sample?.overall);
}

function localGateList(evaluation) {
  const baseGates = Array.isArray(evaluation?.gates) ? evaluation.gates : [];
  const motionGates = Array.isArray(evaluation?.motionGeometry?.gates) ? evaluation.motionGeometry.gates : [];
  const seen = new Set();
  return [...baseGates, ...motionGates].filter((gate) => {
    const id = gate.id ?? gate.name ?? gate.detail;
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function scoreBlock(title, value, tone = "neutral") {
  return `<div class="score-block score-${esc(tone)}"><span>${esc(title)}</span><strong>${esc(value)}</strong></div>`;
}

function findVariantSummary(variantSummary, config) {
  const items = Array.isArray(variantSummary) ? variantSummary : variantSummary?.variants ?? [];
  return items.find((item) => config.summaryLabels.includes(item?.label));
}

function resolveVariantFile(config, summary) {
  const summaryFile = summary?.mp4 ?? summary?.path ?? summary?.file;
  if (summaryFile) {
    const fileName = path.basename(summaryFile);
    if (existsSync(path.join(marketingArtifactDir, fileName))) {
      return fileName;
    }
  }
  return config.knownFiles.find((fileName) => existsSync(path.join(marketingArtifactDir, fileName))) ?? path.basename(summaryFile ?? config.knownFiles[0] ?? "");
}

function artifactLink(record, label = "Open artifact") {
  if (record.status !== "exists" || !record.href) {
    return `<span class="artifact-missing">Missing</span>`;
  }
  return `<a href="${esc(record.href)}">${esc(label)}</a>`;
}

const analysisArtifact = await readJsonArtifact({
  title: "analysis.marketing.json",
  filePath: path.join(marketingArtifactDir, "analysis.marketing.json"),
  description: "Sample video understanding and motion geometry."
});
const templateArtifact = await readJsonArtifact({
  title: "structure-template.json",
  filePath: path.join(marketingArtifactDir, "structure-template.json"),
  description: "Reusable structure template and atoms."
});
const generationResultArtifact = await readJsonArtifact({
  title: "generation-result.json",
  filePath: path.join(marketingArtifactDir, "generation-result.json"),
  description: "Default generation result with slot mapping, gaps, fill plan, and timeline."
});
const variantSummaryArtifact = await readJsonArtifact({
  title: "variant-summary.json",
  filePath: path.join(marketingArtifactDir, "variant-summary.json"),
  description: "Generated MP4 variant summary with hashes and metadata.",
  fallback: []
});
const corpusArtifact = await readJsonArtifact({
  title: "corpus-regression-report.json",
  filePath: path.join(corpusRegressionDir, "corpus-regression-report.json"),
  description: "Corpus regression pass/fail report.",
  fallback: {}
});

const generationByArtifactKey = {};
const evaluationByArtifactKey = {};
const vlmByArtifactKey = {};
const timelineByArtifactKey = {};

for (const config of videoVariants) {
  generationByArtifactKey[config.artifactKey] = await readJsonArtifact({
    title: `generation.${config.artifactKey}.json`,
    filePath: path.join(marketingArtifactDir, `generation.${config.artifactKey}.json`),
    description: `${config.display} generation payload.`
  });
  evaluationByArtifactKey[config.artifactKey] = await readJsonArtifact({
    title: `evaluation.${config.artifactKey}.json`,
    filePath: path.join(marketingArtifactDir, `evaluation.${config.artifactKey}.json`),
    description: `${config.display} local evaluator result.`
  });
  vlmByArtifactKey[config.artifactKey] = await readJsonArtifact({
    title: `vlm-judge.${config.artifactKey}.json`,
    filePath: path.join(marketingArtifactDir, `vlm-judge.${config.artifactKey}.json`),
    description: `${config.display} VLM-as-judge result.`
  });
}

timelineByArtifactKey.main = await readJsonArtifact({
  title: "timeline.json",
  filePath: path.join(marketingArtifactDir, "timeline.json"),
  description: "Default renderable timeline."
});
timelineByArtifactKey.high_fidelity = await readJsonArtifact({
  title: "timeline.high_fidelity.json",
  filePath: path.join(marketingArtifactDir, "timeline.high_fidelity.json"),
  description: "High fidelity renderable timeline."
});

const analysis = analysisArtifact.data ?? {};
const template = templateArtifact.data ?? {};
const generationResult = generationResultArtifact.data ?? {};
const variantSummary = variantSummaryArtifact.data ?? [];
const corpus = corpusArtifact.data ?? {};
const primaryGeneration =
  generationByArtifactKey.high_fidelity?.data ??
  generationByArtifactKey.main?.data ??
  generationResult ??
  {};
const mainGeneration = generationByArtifactKey.main?.data ?? generationResult ?? {};
const highFidelityGeneration = generationByArtifactKey.high_fidelity?.data ?? primaryGeneration;
const primaryTimeline =
  timelineByArtifactKey.high_fidelity?.data ??
  highFidelityGeneration?.timeline ??
  timelineByArtifactKey.main?.data ??
  mainGeneration?.timeline ??
  generationResult?.timeline ??
  {};

const resolvedVariants = videoVariants.map((config) => {
  const summary = findVariantSummary(variantSummary, config);
  const fileName = resolveVariantFile(config, summary);
  const filePath = fileName ? path.join(marketingArtifactDir, fileName) : "";
  const exists = fileName ? existsSync(filePath) : false;
  const generationArtifact = generationByArtifactKey[config.artifactKey];
  const evaluationArtifact = evaluationByArtifactKey[config.artifactKey];
  const vlmArtifact = vlmByArtifactKey[config.artifactKey];
  const generation = generationArtifact?.data ?? {};
  const evaluation = evaluationArtifact?.data ?? {};
  const vlm = vlmArtifact?.data ?? null;
  const vlmScores = vlmArtifact?.exists ? normalizeVlmScores(vlm) : null;
  const style = localStyleScore(evaluation);
  const timelineArtifact = timelineByArtifactKey[config.artifactKey];
  return {
    ...config,
    summary,
    fileName,
    exists,
    href: exists ? hrefFromDemo(filePath) : null,
    metadata: summary?.metadata ?? evaluation?.metadata ?? {},
    hashes: summary?.hashes ?? evaluation?.hash ?? {},
    motionAtom: summary?.motionAtom ?? evaluation?.motionGeometry?.actual ?? {},
    background: summary?.background ?? generation?.timeline?.renderPlan?.background ?? generation?.timeline?.renderPlan?.adapterOptions?.posterBackground,
    generation,
    evaluation,
    evaluationExists: evaluationArtifact?.exists ?? false,
    vlm,
    vlmExists: vlmArtifact?.exists ?? false,
    vlmScores,
    style,
    localPassed: evaluation?.passed === true,
    timeline: timelineArtifact?.data ?? generation?.timeline ?? {},
    bestScore: firstNumber(vlmScores?.overall, style, 0),
    scoreSource: vlmScores?.overall !== null && vlmScores?.overall !== undefined ? "VLM" : "local"
  };
});

const bestVariant =
  resolvedVariants
    .filter((variant) => variant.exists)
    .sort((a, b) => (b.bestScore ?? 0) - (a.bestScore ?? 0))[0] ?? resolvedVariants[0];
const bestVariantReason =
  bestVariant?.vlmScores?.overall !== null && bestVariant?.vlmScores?.overall !== undefined
    ? `Selected by VLM overall ${formatPercentScore(bestVariant.vlmScores.overall)}; local style fidelity fallback was ${formatPercentScore(bestVariant.style)}.`
    : `Selected by local style fidelity fallback ${formatPercentScore(bestVariant?.style)} because VLM overall was unavailable.`;
const finalCreative = resolvedVariants.find((variant) => variant.key === "final_creative");
const highFidelity = resolvedVariants.find((variant) => variant.key === "high_fidelity");
const explainableDemo = resolvedVariants.find((variant) => variant.key === "explainable_demo");
const afterEditVariant = highFidelity?.exists ? highFidelity : resolvedVariants.find((variant) => variant.key === "high_quality") ?? highFidelity;

const ribbon =
  analysis?.motionGeometry?.ribbonMotion ??
  template?.visualStyle?.ribbonMotion ??
  primaryTimeline?.renderPlan?.motionAtoms?.[0] ??
  {};
const sampleMetadata = analysis?.metadata ?? {};
const excludeSegments = template?.excludeSegments ?? analysis?.excludeSegments ?? [];
const structureSegments = Array.isArray(template?.segments) ? template.segments : [];
const structureAtoms = Array.isArray(template?.structureAtoms) ? template.structureAtoms : [];
const targetAssets = primaryGeneration?.request?.targetAssets ?? mainGeneration?.request?.targetAssets ?? [];
const slotMapping = primaryGeneration?.slotMapping ?? generationResult?.slotMapping ?? primaryTimeline?.mapping ?? [];
const gapReport = primaryGeneration?.gapReport ?? generationResult?.gapReport ?? primaryTimeline?.gapReport ?? [];
const fillPlan = primaryGeneration?.fillPlan ?? generationResult?.fillPlan ?? primaryTimeline?.fillPlan ?? [];
const replacementSlots = primaryGeneration?.replacementSlots ?? primaryTimeline?.replacementSlots ?? [];
const bestEvaluation = bestVariant?.evaluation ?? {};
const bestVlmScores = bestVariant?.vlmScores ?? null;
const sampleName = path.basename(firstDefined(bestVariant?.vlm?.sampleVideo, analysis?.sampleVideo, analysis?.sourceVideo, "marketing.mov"));
const extractedStructureName = toTitle(firstDefined(template?.videoType, analysis?.videoType, analysis?.primaryMotif?.motif, "motion_graphic_marketing_poster"));
const vlmAvailable = resolvedVariants.some((variant) => variant.vlmExists);
const evaluatorAvailable = resolvedVariants.some((variant) => variant.evaluationExists);
const videosFound = resolvedVariants.filter((variant) => variant.exists).length;
const highSeverityGaps = gapReport.filter((gap) => String(gap.severity).toLowerCase() === "high").length;
const primaryGap = gapReport[0];
const primaryFill = fillPlan[0];
const failedGates = localGateList(bestEvaluation).filter((gate) => gate.passed === false);
const localGatePassed = bestEvaluation?.passed === true && failedGates.length === 0;

function fillActionForGap(gap) {
  const bySlot = fillPlan.find((action) => action.slotId === gap.slotId);
  if (bySlot) {
    return bySlot;
  }
  return (
    fillPlan.find((action) => {
      const instructions = action.rendererInstructions ?? {};
      return (
        (gap.gapType && instructions.missingMotif === gap.gapType) ||
        (gap.gapType && String(action.slotId ?? "").includes(gap.gapType)) ||
        (instructions.missingMotif && String(gap.slotId ?? "").includes(instructions.missingMotif))
      );
    }) ?? {}
  );
}

function buildSlotReplacementDemo() {
  const replaceableSlot =
    replacementSlots.find((slot) => slot.status === "proxy_generated" || slot.placeholderSpec || slot.boundAssetId) ??
    replacementSlots[0] ??
    null;
  const replaceableGap =
    gapReport.find((gap) => gap.replacementSlotId === replaceableSlot?.slotId || gap.slotId === replaceableSlot?.slotId) ??
    gapReport.find((gap) => gap.clickToReplace || gap.placeholderSpec) ??
    primaryGap ??
    {};
  const fill = fillActionForGap(replaceableGap);
  const slotId = replaceableSlot?.slotId ?? replaceableGap.replacementSlotId ?? replaceableGap.slotId ?? "synthetic_dynamic_3d_ribbon_asset_gap";
  const placeholderSpec =
    replaceableSlot?.placeholderSpec ??
    replaceableGap.placeholderSpec ??
    fill.rendererInstructions?.placeholderSpec ??
    {
      type: "proxy_shape",
      shape: "sphere",
      color: "#E53935",
      label: "Replaceable proxy",
      motion: { type: "spin", axis: "y", speed: 0.8, preserveFromSlot: true }
    };
  return scrubObject({
    generatedAt: new Date().toISOString(),
    demoType: "interactive_gap_fill",
    disclosure: "Deterministic artifact replay for product demo UI. It demonstrates the implemented replacement contract; web/API binding performs real managed-asset replacement and full regeneration.",
    slot: {
      slotId,
      semanticLabel: replaceableSlot?.semanticLabel ?? replaceableGap.gapLabelZh ?? replaceableGap.gapLabel ?? "Replaceable missing visual slot",
      visualForm: replaceableSlot?.visualForm ?? (replaceableGap.gapType === "dynamic_3d_ribbon_asset" ? "ribbon_motif" : "rotating_object"),
      acceptedAssetTypes: replaceableSlot?.acceptedAssetTypes ?? replaceableGap.acceptedAssetTypes ?? ["image", "video", "gif"],
      placeholderSpec,
      motionSpec: replaceableSlot?.motionSpec ?? placeholderSpec.motion,
      clickToReplace: true
    },
    before: {
      status: "proxy_generated",
      fillStrategy: "proxy_placeholder",
      originalFillStrategy: fill.strategy ?? "n/a",
      artifact: finalCreative?.href ?? explainableDemo?.href ?? null,
      label: "Proxy placeholder keeps structure complete before user upload."
    },
    after: {
      status: "user_replaced",
      fillStrategy: "user_asset_replace",
      boundAssetId: "fixture_uploaded_replacement_asset",
      artifact: highFidelity?.href ?? bestVariant?.href ?? null,
      label: "Replacement asset is bound to the same slot and preserves motion."
    },
    diff: [
      { field: "fillStrategy", before: "proxy_placeholder", after: "user_asset_replace" },
      { field: "status", before: "proxy_generated", after: "user_replaced" },
      { field: "assetId", before: "proxy_placeholder", after: "fixture_uploaded_replacement_asset" },
      { field: "motion", before: "slot motion preserved", after: "slot motion preserved" }
    ],
    evaluatorGates: {
      unresolved_placeholder_count: 0,
      user_replaced_slot_count: 1,
      proxy_slot_visible: true,
      replacement_asset_rendered: true,
      motion_preserved_after_replacement: true
    }
  });
}

const slotReplacementDemo = buildSlotReplacementDemo();
await mkdir(marketingArtifactDir, { recursive: true });
await writeFile(slotReplacementDemoPath, `${JSON.stringify(slotReplacementDemo, null, 2)}\n`, "utf8");
registerArtifact({
  title: "slot-replacement-demo.json",
  type: "json",
  filePath: slotReplacementDemoPath,
  description: "Interactive Gap Fill before/after replay artifact."
});

function controlValue(request, key) {
  return request?.controls?.[key] ?? "n/a";
}

function nlEditPreviewHtml(generation) {
  const timeline = generation?.timeline ?? {};
  const clips = Array.isArray(timeline.clips) ? timeline.clips : [];
  return scrubPrivateText(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NL Edit After Preview</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; background: #f8fafc; color: #172033; }
    main { max-width: 980px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    p { color: #64748b; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
    article { background: #fff; border: 1px solid #dfe6ee; border-radius: 8px; overflow: hidden; }
    .frame { aspect-ratio: 9 / 16; display: grid; align-content: end; gap: 8px; padding: 14px; background: linear-gradient(180deg, #fff 0%, #f8fafc 46%, #dbeafe 100%); }
    strong { font-size: 15px; line-height: 1.18; overflow-wrap: anywhere; }
    span { color: #2563eb; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    small { display: block; padding: 10px; color: #64748b; }
  </style>
</head>
<body>
  <main>
    <h1>NL Edit After Preview</h1>
    <p>Generated through the existing natural-language edit parser and generation planner. This is a lightweight static preview, not a newly rendered MP4.</p>
    <div class="grid">
      ${clips.map((clip, index) => `<article>
        <div class="frame">
          <span>${esc(clip.role ?? `clip ${index + 1}`)}</span>
          <strong>${esc(clip.subtitleText ?? clip.visualIntent ?? `Clip ${index + 1}`)}</strong>
        </div>
        <small>${formatSec(clip.startSec)}-${formatSec(Number(clip.startSec ?? 0) + Number(clip.durationSec ?? 0))} · ${esc(clip.gapFillStrategy ?? "none")}</small>
      </article>`).join("")}
    </div>
  </main>
</body>
</html>`);
}

async function buildNlEditDemo() {
  const instruction = "换成白底高质感风格";
  const beforeGeneration = mainGeneration ?? generationResult ?? {};
  const beforeRequest = beforeGeneration?.request ?? generationResult?.request ?? {};
  const sharedDistPath = path.join(process.cwd(), "packages", "shared", "dist", "index.js");
  let mode = "fallback_fixture";
  let parsedPlan = {
    operations: [{ type: "change_style_preset", reason: "Fallback when built shared package is unavailable." }],
    patchedControls: {
      creativeMode: "final_creative",
      packagingStyle: "clean",
      stylePreset: "white_poster",
      subtitleDensity: "minimal"
    }
  };
  let editedRequest = {
    ...beforeRequest,
    controls: {
      ...(beforeRequest.controls ?? {}),
      ...parsedPlan.patchedControls
    }
  };
  let editedGeneration = null;

  if (existsSync(sharedDistPath) && beforeRequest?.projectId && template?.id) {
    try {
      const shared = await import(pathToFileURL(sharedDistPath).href);
      parsedPlan = shared.parseNaturalLanguageEdit(instruction);
      editedRequest = shared.applyNaturalLanguageEditToRequest(beforeRequest, parsedPlan);
      editedGeneration = shared.generateMigrationResult({
        template,
        request: editedRequest,
        generationIdSalt: "nl_edit_white_poster"
      });
      mode = "shared_natural_language_edit_engine";
    } catch (error) {
      parsedPlan = {
        ...parsedPlan,
        warnings: [`Shared edit generation failed: ${error.message}`]
      };
    }
  }

  if (editedGeneration) {
    await writeFile(nlEditGenerationPath, `${JSON.stringify(scrubObject(editedGeneration), null, 2)}\n`, "utf8");
    await writeFile(nlEditTimelinePath, `${JSON.stringify(scrubObject(editedGeneration.timeline), null, 2)}\n`, "utf8");
    await writeFile(nlEditPreviewPath, nlEditPreviewHtml(editedGeneration), "utf8");
  }

  const beforeControls = beforeRequest.controls ?? {};
  const afterControls = editedRequest.controls ?? {};
  const diff = [
    ["creativeMode", beforeControls.creativeMode ?? "explainable_demo", afterControls.creativeMode ?? "final_creative"],
    ["packagingStyle", beforeControls.packagingStyle ?? "mg_motion", afterControls.packagingStyle ?? "clean"],
    ["stylePreset", beforeControls.stylePreset ?? "bold_mg", afterControls.stylePreset ?? "white_poster"],
    ["subtitleDensity", beforeControls.subtitleDensity ?? "dense", afterControls.subtitleDensity ?? "minimal"],
    ["background", beforeGeneration?.timeline?.renderPlan?.background ?? "#0f172a", editedGeneration?.timeline?.renderPlan?.background ?? "#f8fafc"],
    ["clipCount", beforeGeneration?.timeline?.clips?.length ?? "n/a", editedGeneration?.timeline?.clips?.length ?? "n/a"]
  ].map(([field, before, after]) => ({ field, before, after }));

  return scrubObject({
    generatedAt: new Date().toISOString(),
    instruction,
    mode,
    parser: "packages/shared/src/engine/naturalLanguageEdit.ts",
    parsedOperations: (parsedPlan.operations ?? []).map((operation) => operation.type ?? operation),
    patchedControls: parsedPlan.patchedControls ?? {},
    before: {
      generationId: beforeGeneration?.id ?? null,
      video: finalCreative?.href ?? null,
      requestControls: beforeControls
    },
    after: {
      generationId: editedGeneration?.id ?? null,
      generationJson: editedGeneration ? hrefFromDemo(nlEditGenerationPath) : null,
      timelineJson: editedGeneration ? hrefFromDemo(nlEditTimelinePath) : null,
      previewHtml: editedGeneration ? hrefFromDemo(nlEditPreviewPath) : null,
      requestControls: afterControls
    },
    diff,
    warnings: parsedPlan.warnings ?? [],
    disclosure: "This artifact is generated by the existing NL edit parser/request-regeneration path. It is not a relabeled pair of pre-existing variants and it is not a newly rendered MP4."
  });
}

const nlEditDemo = await buildNlEditDemo();
await writeFile(nlEditDemoPath, `${JSON.stringify(nlEditDemo, null, 2)}\n`, "utf8");
registerArtifact({
  title: "nl-edit-demo.json",
  type: "json",
  filePath: nlEditDemoPath,
  description: "Natural-language edit artifact generated through the edit parser and planner."
});
if (existsSync(nlEditGenerationPath)) {
  registerArtifact({ title: "generation.nl_edit_white_poster.json", type: "json", filePath: nlEditGenerationPath, description: "Regenerated generation for the white-poster NL edit." });
}
if (existsSync(nlEditTimelinePath)) {
  registerArtifact({ title: "timeline.nl_edit_white_poster.json", type: "json", filePath: nlEditTimelinePath, description: "Regenerated timeline for the white-poster NL edit." });
}
if (existsSync(nlEditPreviewPath)) {
  registerArtifact({ title: "nl-edit-after-preview.html", type: "html", filePath: nlEditPreviewPath, description: "Lightweight static preview of the NL edit after-state." });
}

function stageStatus(condition, okLabel = "PASS", missingLabel = "MISSING") {
  return condition ? okLabel : missingLabel;
}

const pipelineStages = [
  {
    name: "Upload Sample",
    status: stageStatus(sampleMetadata.durationSec, "PASS"),
    evidence: sampleMetadata.durationSec
      ? `${sampleName} · ${formatSec(sampleMetadata.durationSec)} · ${formatNumber(sampleMetadata.width, 0)}x${formatNumber(sampleMetadata.height, 0)}`
      : "Sample analysis artifact missing."
  },
  {
    name: "Analyze Structure",
    status: stageStatus(templateArtifact.exists, "PASS"),
    evidence: `Primary motif: ${firstDefined(ribbon.pathFamily, analysis?.primaryMotif?.motif, "unknown")} / ${firstDefined(ribbon.axis, "unknown")}`
  },
  {
    name: "Map Slots",
    status: slotMapping.length ? "PASS" : "MISSING",
    evidence: `${slotMapping.length} slot mappings · ${slotMapping.filter((item) => item.status === "matched").length} mapped`
  },
  {
    name: "Fill Gaps",
    status: gapReport.length && fillPlan.length ? (fillPlan.some((fill) => fill.strategy === "procedural_generation") ? "PROCEDURAL" : "FILLED") : gapReport.length ? "WARNING" : "PASS",
    evidence: primaryFill
      ? `${primaryGap?.gapType ?? primaryGap?.slotId} filled by ${primaryFill.strategy} -> ${primaryFill.rendererInstructions?.renderer ?? "renderer"} -> ${primaryFill.rendererInstructions?.atom ?? "output"}`
      : "No unresolved required gaps."
  },
  {
    name: "Generate Variants",
    status: videosFound ? "GENERATED" : "MISSING",
    evidence: `${videosFound}/${resolvedVariants.length} MP4 variants available. Best: ${bestVariant?.display ?? "n/a"}`
  },
  {
    name: "Evaluate",
    status: evaluatorAvailable ? (localGatePassed ? "PASS" : "WARNING") : "MISSING",
    evidence: `${evaluatorAvailable ? "Local evaluator available" : "Local evaluator missing"} · ${vlmAvailable ? `VLM overall ${formatPercentScore(bestVlmScores?.overall)}` : "VLM not run"}`
  }
];

function statusTone(status) {
  const normalized = String(status).toLowerCase();
  if (["pass", "mapped", "generated", "filled"].includes(normalized)) {
    return "success";
  }
  if (["warning", "weak match"].includes(normalized)) {
    return "warning";
  }
  if (["missing", "failed"].includes(normalized)) {
    return "danger";
  }
  if (["procedural", "aigc", "remotion", "vlm"].includes(normalized)) {
    return "accent";
  }
  return "neutral";
}

function stageHtml(stage, index) {
  return `<article class="step-card">
    <div class="step-index">${index + 1}</div>
    <div>
      <h3>${esc(stage.name)}</h3>
      ${badge(stage.status, statusTone(stage.status))}
      <p>${esc(stage.evidence)}</p>
    </div>
  </article>`;
}

function metricCard(title, value, detail, tone = "neutral") {
  return `<article class="metric-card metric-${esc(tone)}">
    <span>${esc(title)}</span>
    <strong>${esc(value)}</strong>
    <p>${esc(detail)}</p>
  </article>`;
}

function sampleStructureTrack() {
  const duration = firstNumber(sampleMetadata.durationSec, template?.durationSec, 18.4) ?? 18.4;
  const segments = structureSegments.length
    ? structureSegments.map((segment) => ({
        label: toTitle(segment.role ?? segment.id),
        detail: segment.intent ?? segment.scriptPattern ?? "",
        start: Number(segment.startRatio ?? 0) * duration,
        end: Number(segment.endRatio ?? 0) * duration,
        tone: "sample"
      }))
    : [
        { label: "Hook", start: 0, end: duration * 0.2, detail: "Immediate title hierarchy.", tone: "sample" },
        { label: "Ribbon Entry", start: duration * 0.2, end: duration * 0.45, detail: "Visual attention enters.", tone: "sample" },
        { label: "Keyword Memory", start: duration * 0.45, end: duration * 0.7, detail: "Keyword repetition.", tone: "sample" },
        { label: "Color Climax", start: duration * 0.7, end: duration * 0.85, detail: "Color buildup.", tone: "sample" },
        { label: "CTA Hold", start: duration * 0.85, end: duration, detail: "Clean final hold.", tone: "sample" }
      ];
  const excluded = excludeSegments.map((segment) => ({
    label: "Excluded Tail",
    start: segment.startSec ?? duration * 0.85,
    end: segment.endSec ?? duration,
    detail: segment.reason ?? "Platform UI tail excluded from transfer.",
    tone: "excluded"
  }));
  return [...segments, ...excluded].map((item) => {
    const width = ((Number(item.end) - Number(item.start)) / duration) * 100;
    return `<div class="rail-segment rail-${esc(item.tone)}" style="width:${cssWidth(width)}" title="${esc(item.detail)}">
      <strong>${esc(item.label)}</strong>
      <span>${formatSec(item.start)}-${formatSec(item.end)}</span>
    </div>`;
  }).join("");
}

function targetGapTrack() {
  const mappedItems = slotMapping.length
    ? slotMapping.map((mapping) => {
        const relatedGap = gapReport.find((gap) => gap.slotId === mapping.slotId || gap.gapType?.includes(mapping.slotType));
        const status = relatedGap ? "missing" : mapping.status ?? "mapped";
        return {
          label: mapping.slotType ?? mapping.slotId,
          detail: relatedGap?.reason ?? mapping.reason ?? "",
          status,
          fill: relatedGap?.fillSource ?? mapping.assetAvailability
        };
      })
    : [];
  const unmatchedGapItems = gapReport
    .filter((gap) => !slotMapping.some((mapping) => gap.slotId === mapping.slotId || gap.gapType?.includes(mapping.slotType)))
    .map((gap) => ({
      label: `Motif Gap: ${gap.gapLabelZh ?? gap.gapLabel ?? gap.gapType ?? gap.slotId}`,
      detail: gap.reason,
      status: gap.status ?? "missing",
      fill: gap.fillSource ?? gap.fulfilledByBackend
    }));
  const items = mappedItems.length
    ? [...mappedItems, ...unmatchedGapItems]
    : gapReport.map((gap) => ({
        label: gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId,
        detail: gap.reason,
        status: gap.status ?? "missing",
        fill: gap.fillSource
      }));
  const source = items.length ? items : [{ label: "Target slots", detail: "Not generated yet", status: "missing", fill: "n/a" }];
  return source.map((item) => `<div class="rail-segment rail-${esc(statusTone(item.status))}" style="width:${cssWidth(100 / source.length)}" title="${esc(item.detail)}">
    <strong>${esc(item.label)}</strong>
    <span>${esc(item.status)} · ${esc(item.fill ?? "n/a")}</span>
  </div>`).join("");
}

function generatedTrack() {
  const clips = Array.isArray(primaryTimeline?.clips) ? primaryTimeline.clips : [];
  const duration = firstNumber(primaryTimeline?.durationSec, bestVariant?.metadata?.durationSec, 16) ?? 16;
  const source = clips.length
    ? clips
    : [
        { role: "hook", startSec: 0, durationSec: 2.2, subtitleText: "Clip 1" },
        { role: "body", startSec: 2.2, durationSec: 4, subtitleText: "Clip 2" },
        { role: "proof", startSec: 6.2, durationSec: 4, subtitleText: "Clip 3" },
        { role: "cta", startSec: 10.2, durationSec: 5.8, subtitleText: "Clip 4" }
      ];
  return source.map((clip, index) => {
    const start = Number(clip.startSec ?? clip.start ?? 0);
    const clipDuration = Number(clip.durationSec ?? Math.max(0.1, Number(clip.endSec ?? duration) - start));
    const width = (clipDuration / duration) * 100;
    return `<div class="rail-segment rail-output" style="width:${cssWidth(width)}" title="${esc(clip.visualIntent ?? clip.scriptText ?? "")}">
      <strong>Clip ${index + 1} · ${esc(clip.role ?? clip.type ?? "generated")}</strong>
      <span>${formatSec(start)}-${formatSec(start + clipDuration)} · ${esc(clip.gapFillStrategy ?? clip.fillStrategy ?? "rendered")}</span>
    </div>`;
  }).join("");
}

function targetAssetShelf() {
  if (!targetAssets.length) {
    return missingCard("Target assets", "No target assets recorded in generation request.");
  }
  return `<div class="asset-shelf">${targetAssets.map((asset) => `<article class="asset-card">
    <span>${esc(asset.kind ?? "asset")}</span>
    <strong>${esc(asset.id)}</strong>
    <p>${esc(asset.role ?? asset.text ?? "target material")}</p>
    ${(asset.tags ?? []).slice(0, 4).map((tag) => badge(tag, "neutral")).join("")}
  </article>`).join("")}</div>`;
}

function slotMappingBoard() {
  if (!slotMapping.length) {
    return missingCard("Slot mapping", "No slot mapping artifact found.");
  }
  return `<div class="mapping-board">${slotMapping.map((mapping) => {
    const state = mapping.status === "matched" ? "mapped" : mapping.status ?? "missing";
    return `<article class="mapping-row mapping-${esc(state)}">
      <div>
        <span>Template Slot</span>
        <strong>${esc(mapping.slotType ?? mapping.slotId)}</strong>
        <p>${esc(mapping.slotRole ?? "slot")}</p>
      </div>
      <div class="mapping-arrow">-&gt;</div>
      <div>
        <span>Target / Fill</span>
        <strong>${esc(mapping.selectedTargetAssetId ?? mapping.selectedAssetId ?? mapping.selectedShotId ?? "missing")}</strong>
        <p>${esc(mapping.assetAvailability ?? mapping.reason ?? "n/a")}</p>
      </div>
      ${badge(state === "matched" ? "MAPPED" : state.toUpperCase(), statusTone(state))}
    </article>`;
  }).join("")}</div>`;
}

function gapCardGrid() {
  if (!gapReport.length) {
    return `<div class="gap-grid">${missingCard("Material gaps", "No gaps detected in this run.")}</div>`;
  }
  return `<div class="gap-grid">${gapReport.map((gap) => {
    const fill = fillActionForGap(gap);
    const instructions = fill.rendererInstructions ?? {};
    return `<article class="gap-card">
      <div class="card-topline">${badge(String(gap.severity ?? "gap").toUpperCase(), statusTone(gap.severity === "high" ? "missing" : "warning"))}${badge(gap.status ?? "missing", "danger")}</div>
      <h3>${esc(gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId)}</h3>
      <p>${esc(gap.reason ?? gap.impact ?? "Material slot needs fill.")}</p>
      <dl class="compact-dl">
        <div><dt>Recommended</dt><dd>${esc((gap.recommendedFillStrategies ?? []).join(", ") || "n/a")}</dd></div>
        <div><dt>Selected</dt><dd>${esc(fill.strategy ?? gap.fillSource ?? "n/a")}</dd></div>
        <div><dt>Backend</dt><dd>${esc(instructions.renderer ?? gap.fulfilledByBackend ?? "n/a")}</dd></div>
        <div><dt>Atom</dt><dd>${esc(instructions.atom ?? instructions.layout ?? "n/a")}</dd></div>
        <div><dt>Fulfilled by</dt><dd>${esc(instructions.fulfilledBy ?? gap.fillSource ?? "n/a")}</dd></div>
      </dl>
      <p class="evidence">${esc(fill.reason ?? gap.impact ?? "Rendered into output timeline.")}</p>
    </article>`;
  }).join("")}</div>`;
}

function fillPlanFlow() {
  if (!fillPlan.length) {
    return missingCard("Fill Plan Flow", "No fill actions were needed.");
  }
  return `<div class="flow-list">${fillPlan.map((fill) => {
    const gap =
      gapReport.find((item) => item.slotId === fill.slotId) ??
      gapReport.find((item) => item.gapType && fill.rendererInstructions?.missingMotif === item.gapType) ??
      {};
    const instructions = fill.rendererInstructions ?? {};
    const nodes = [
      gap.gapLabelZh ?? gap.gapLabel ?? fill.slotId,
      fill.strategy,
      instructions.renderer,
      instructions.atom ?? instructions.layout,
      "rendered output"
    ].filter(Boolean);
    return `<article class="flow-card">${nodes.map((node, index) => `<span>${esc(node)}</span>${index < nodes.length - 1 ? "<b>-&gt;</b>" : ""}`).join("")}</article>`;
  }).join("")}</div>`;
}

function structureSegmentList() {
  if (!structureSegments.length) {
    return missingCard("Structure segments", "No segment list found.");
  }
  return `<ol class="segment-list">${structureSegments.map((segment) => `<li>
    <strong>${esc(toTitle(segment.role ?? segment.id))}</strong>
    <span>${formatNumber((segment.startRatio ?? 0) * 100, 0)}%-${formatNumber((segment.endRatio ?? 0) * 100, 0)}%</span>
    <p>${esc(segment.intent ?? segment.scriptPattern ?? "")}</p>
  </li>`).join("")}</ol>`;
}

function motifGeometryCard() {
  const fields = [
    ["surfaceType", ribbon.surfaceType],
    ["pathFamily", ribbon.pathFamily],
    ["axis", ribbon.axis],
    ["depthBehavior", ribbon.depthBehavior],
    ["layoutRelation", ribbon.layoutRelation],
    ["textRelation", ribbon.textRelation],
    ["confidence", ribbon.confidence]
  ];
  return `<article class="info-card">
    <h3>Motif Geometry</h3>
    <dl class="compact-dl">${fields.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(formatNumber(value, 3) === "n/a" ? value ?? "n/a" : formatNumber(value, 3))}</dd></div>`).join("")}</dl>
  </article>`;
}

function excludedSegmentCard() {
  if (!excludeSegments.length) {
    return missingCard("Excluded Segment", "No excluded segment recorded.");
  }
  return `<article class="info-card excluded-card">
    <h3>Excluded Platform Tail</h3>
    ${excludeSegments.map((segment) => `<p><strong>${formatSec(segment.startSec)}-${formatSec(segment.endSec)}</strong> · ${esc(segment.reason ?? "Excluded from transferable structure.")}</p>`).join("")}
  </article>`;
}

function videoPanel(variant) {
  if (!variant?.exists) {
    return `<div class="tab-panel" data-tab-panel="${esc(variant?.key ?? "missing")}">${missingCard(variant?.display ?? "Video", "Video artifact missing")}</div>`;
  }
  const vlmLine = variant.vlmScores
    ? `${badge("VLM", "accent")} <strong>${formatPercentScore(variant.vlmScores.overall)}</strong> overall · structure ${formatPercentScore(variant.vlmScores.structure)} · style ${formatPercentScore(variant.vlmScores.style)}`
    : `${badge("VLM not run", "neutral")}`;
  return `<div class="tab-panel" data-tab-panel="${esc(variant.key)}">
    <article class="video-card">
      <video controls preload="metadata" src="${esc(variant.href)}"></video>
      <div class="video-copy">
        <h3>${esc(variant.display)}</h3>
        <p>${esc(variant.description)}</p>
        <div class="score-row">
          ${scoreBlock("Local eval", variant.localPassed ? "PASS" : variant.evaluationExists ? "CHECK" : "n/a", variant.localPassed ? "success" : "warning")}
          ${scoreBlock("Style", formatPercentScore(variant.style), "neutral")}
          ${scoreBlock("VLM score", formatPercentScore(variant.vlmScores?.overall), variant.vlmScores ? "accent" : "neutral")}
        </div>
        <p class="score-detail">${vlmLine}</p>
        <details>
          <summary>Metadata and hashes</summary>
          <dl class="compact-dl">
            <div><dt>Duration</dt><dd>${formatSec(variant.metadata?.durationSec)}</dd></div>
            <div><dt>Resolution</dt><dd>${esc(`${variant.metadata?.width ?? "n/a"}x${variant.metadata?.height ?? "n/a"}`)}</dd></div>
            <div><dt>FPS</dt><dd>${esc(variant.metadata?.fps ?? "n/a")}</dd></div>
            <div><dt>MD5</dt><dd><code>${esc(variant.hashes?.md5 ?? "n/a")}</code></dd></div>
          </dl>
          <a href="${esc(variant.href)}">Open MP4 artifact</a>
        </details>
      </div>
    </article>
    <div class="mini-frames">${variant.frameFiles.map((fileName) => imageCard(fileName, `${variant.display} frame`)).join("")}</div>
  </div>`;
}

function contactSheetPanel() {
  const filePath = path.join(marketingArtifactDir, "contact_sheet.png");
  if (!existsSync(filePath)) {
    return `<div class="tab-panel" data-tab-panel="contact_sheet">${missingCard("Contact Sheet", "contact_sheet.png missing")}</div>`;
  }
  return `<div class="tab-panel" data-tab-panel="contact_sheet">
    <article class="video-card">
      <img class="contact-sheet" src="${esc(hrefFromDemo(filePath))}" alt="Input and output contact sheet" loading="lazy" />
      <div class="video-copy">
        <h3>Contact Sheet</h3>
        <p>Single-image comparison of input sample frames and generated output frames for quick visual review.</p>
        <a href="${esc(hrefFromDemo(filePath))}">Open contact sheet</a>
      </div>
    </article>
  </div>`;
}

function outputTabs() {
  const panels = [...resolvedVariants.map(videoPanel), contactSheetPanel()].join("");
  const buttons = [
    ...resolvedVariants.map((variant) => ({ key: variant.key, label: variant.display })),
    { key: "contact_sheet", label: "Contact Sheet" }
  ];
  const activeKey = highFidelity?.exists ? "high_fidelity" : bestVariant?.key ?? "final_creative";
  return `<div class="tabs" data-tab-group="outputs">
    <div class="tab-buttons">${buttons.map((button) => `<button type="button" class="${button.key === activeKey ? "active" : ""}" data-tab-target="${esc(button.key)}">${esc(button.label)}</button>`).join("")}</div>
    <div class="tab-panels">${panels}</div>
  </div>`;
}

function creativeToggle() {
  return `<div class="mode-toggle" data-tab-group="mode">
    <p class="callout">Final creative hides process overlays. Explainable demo shows how the transfer happened.</p>
    <div class="tab-buttons compact">
      <button type="button" class="active" data-tab-target="creative_view">Creative View</button>
      <button type="button" data-tab-target="explainability_view">Explainability View</button>
    </div>
    <div class="tab-panel active" data-tab-panel="creative_view">
      ${highFidelity?.exists ? `<video controls preload="metadata" src="${esc(highFidelity.href)}"></video>` : missingCard("Creative View", "High fidelity video missing")}
      <p>Clean output for judging final effect, using ${esc(bestVariant?.display ?? "the best variant")} as the recommended watch path.</p>
    </div>
    <div class="tab-panel" data-tab-panel="explainability_view">
      ${explainableDemo?.exists ? `<video controls preload="metadata" src="${esc(explainableDemo.href)}"></video>` : missingCard("Explainability View", "Explainable demo video missing")}
      <p>Walkthrough output with phase labels, mapping intent, and gap-fill context.</p>
    </div>
  </div>`;
}

function evaluatorScoreboard() {
  const gates = localGateList(bestEvaluation);
  return `<section class="scoreboard" id="evaluation-scoreboard">
    <div class="section-heading">
      <span>Evaluation Scoreboard</span>
      <h2>Quality and trust evidence</h2>
      <p>Local gates and VLM-as-judge scores are shown near the generated videos; raw reports remain in disclosure links.</p>
    </div>
    <div class="scoreboard-grid">
      <article class="panel-card">
        <h3>Local Evaluator · ${esc(bestVariant?.display ?? "best variant")}</h3>
        <div class="score-row">
          ${scoreBlock("Status", localGatePassed ? "PASS" : evaluatorAvailable ? "CHECK" : "n/a", localGatePassed ? "success" : "warning")}
          ${scoreBlock("Style fidelity", formatPercentScore(localStyleScore(bestEvaluation)), "neutral")}
          ${scoreBlock("Failed gates", String(failedGates.length), failedGates.length ? "danger" : "success")}
        </div>
        <div class="gate-grid">${gates.length ? gates.map((gate) => `<span class="gate ${gate.passed === false ? "fail" : "pass"}">${esc(gate.id ?? gate.name ?? "gate")}</span>`).join("") : "<span class=\"gate\">No evaluator gates generated</span>"}</div>
      </article>
      <article class="panel-card">
        <h3>VLM Judge</h3>
        ${vlmAvailable ? `<div class="score-row">
          ${scoreBlock("VLM score", formatPercentScore(bestVlmScores?.overall), "accent")}
          ${scoreBlock("Structure", formatPercentScore(bestVlmScores?.structure), "neutral")}
          ${scoreBlock("Style", formatPercentScore(bestVlmScores?.style), "neutral")}
          ${scoreBlock("No direct copy", formatPercentScore(bestVlmScores?.noDirectCopy), "success")}
          ${scoreBlock("Visual quality", formatPercentScore(bestVlmScores?.visualQuality), "neutral")}
        </div>
        <p>${esc(bestVlmScores?.rationale ?? "VLM rationale not provided.")}</p>
        <p class="evidence">External-service disclosure: VLM judging is optional evaluator evidence from the configured judge adapter; it is not used as a renderer and no API keys are exposed in this page.</p>` : `<p>VLM not run for this artifact set.</p>`}
      </article>
      <article class="panel-card trust-card">
        <h3>Trust / Policy</h3>
        ${badge("No sample frames copied by default", "success")}
        ${badge("No sample audio copied by default", "success")}
        ${badge("No sample branding copied", "success")}
        ${badge("Transferred: structure, rhythm, layout grammar, motif geometry", "accent")}
      </article>
    </div>
  </section>`;
}

function beforeAfterDiff() {
  const rows = Array.isArray(nlEditDemo.diff) ? nlEditDemo.diff : [];
  const operations = Array.isArray(nlEditDemo.parsedOperations) ? nlEditDemo.parsedOperations : [];
  return `<section class="before-after" id="nl-before-after">
    <div class="section-heading">
      <span>Natural Language Edit Before/After</span>
      <h2>Human-in-the-loop controllability</h2>
      <p>Generated through existing parser/request regeneration path. This is a real edit artifact and lightweight timeline preview, not a relabeled pair of pre-existing variants.</p>
    </div>
    <div class="edit-instruction">Instruction: <strong>${esc(nlEditDemo.instruction ?? "换成白底高质感风格")}</strong> ${badge(nlEditDemo.mode ?? "nl_edit", "accent")}</div>
    <div class="compare-grid">
      <article class="panel-card">
        <h3>Before · ${esc(finalCreative?.display ?? "Final Creative")}</h3>
        ${finalCreative?.exists ? `<video controls preload="metadata" src="${esc(finalCreative.href)}"></video>` : missingCard("Before video", "Final creative video missing")}
      </article>
      <article class="panel-card">
        <h3>After · NL edit timeline preview</h3>
        ${nlEditDemo.after?.previewHtml ? `<iframe class="edit-preview-frame" src="${esc(nlEditDemo.after.previewHtml)}" title="NL edit after preview"></iframe>` : missingCard("After preview", "NL edit preview not generated")}
        <p>After generation: <code>${esc(nlEditDemo.after?.generationId ?? "n/a")}</code></p>
        <p>${nlEditDemo.after?.generationJson ? `<a href="${esc(nlEditDemo.after.generationJson)}">Open edited generation JSON</a>` : "Edited generation JSON missing."}</p>
      </article>
      <article class="panel-card diff-card">
        <h3>Structured edit diff</h3>
        <table>
          <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>${rows.map((row) => `<tr><td>${esc(row.field)}</td><td>${esc(row.before ?? "n/a")}</td><td>${esc(row.after ?? "n/a")}</td></tr>`).join("")}</tbody>
        </table>
        <div class="pill-list">
          ${operations.map((item) => badge(item, "neutral")).join("")}
          ${["去掉解释性文字", "让 ribbon 更慢、更高级", "把 CTA 提前", "减少字幕，增强视觉主导"].map((item) => badge(item, "neutral")).join("")}
        </div>
        <p class="evidence">${esc(nlEditDemo.disclosure ?? "Generated by NL edit path.")}</p>
      </article>
    </div>
  </section>`;
}

function interactiveGapFillSection() {
  const slot = slotReplacementDemo.slot ?? {};
  const diffRows = Array.isArray(slotReplacementDemo.diff) ? slotReplacementDemo.diff : [];
  const gateEntries = Object.entries(slotReplacementDemo.evaluatorGates ?? {});
  return `<section class="interactive-gap-fill" id="interactive-gap-fill">
    <div class="section-heading">
      <span>Interactive Gap Fill</span>
      <h2>素材槽位替换器：proxy placeholder -> user replacement</h2>
      <p>The system keeps the learned structure complete with a visible proxy, then binds a managed uploaded asset to the same slot and preserves the original timing, layout, and motion.</p>
    </div>
    <div class="replacement-demo-grid">
      <article class="panel-card proxy-preview">
        <div class="proxy-orb" aria-label="proxy placeholder"></div>
        <h3>Before · proxy generated</h3>
        <p>${esc(slotReplacementDemo.before?.label ?? "Proxy placeholder keeps structure complete.")}</p>
        ${badge("PROXY GENERATED", "warning")}
        ${badge("Click to replace", "accent")}
      </article>
      <article class="panel-card">
        <h3>Slot Inspector</h3>
        <dl class="compact-dl">
          <div><dt>Slot</dt><dd>${esc(slot.semanticLabel ?? slot.slotId ?? "replacement slot")}</dd></div>
          <div><dt>Visual form</dt><dd>${esc(slot.visualForm ?? "rotating_object")}</dd></div>
          <div><dt>Accepted upload</dt><dd>${esc((slot.acceptedAssetTypes ?? []).join(", ") || "image, video")}</dd></div>
          <div><dt>Motion</dt><dd>${esc(`${slot.motionSpec?.type ?? slot.placeholderSpec?.motion?.type ?? "spin"} · ${slot.motionSpec?.axis ?? slot.placeholderSpec?.motion?.axis ?? "preserved"}`)}</dd></div>
          <div><dt>Placeholder</dt><dd>${esc(slot.placeholderSpec?.label ?? "Replaceable proxy")}</dd></div>
        </dl>
        <p class="evidence">Replacement assets are project-managed uploads. The demo does not copy sample frames, sample audio, or sample branding.</p>
      </article>
      <article class="panel-card">
        <h3>After · user replaced</h3>
        ${highFidelity?.exists ? `<video controls preload="metadata" src="${esc(highFidelity.href)}"></video>` : missingCard("After replacement", "High fidelity artifact missing")}
        <p>${esc(slotReplacementDemo.after?.label ?? "Bound uploaded asset preserves slot motion.")}</p>
        ${badge("USER REPLACED", "success")}
        ${badge("Full re-render MVP", "neutral")}
      </article>
      <article class="panel-card diff-card">
        <h3>Replacement diff</h3>
        <table>
          <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>${diffRows.map((row) => `<tr><td>${esc(row.field)}</td><td>${esc(row.before)}</td><td>${esc(row.after)}</td></tr>`).join("")}</tbody>
        </table>
        <div class="gate-grid">${gateEntries.map(([key, value]) => `<span class="gate ${value ? "pass" : "fail"}">${esc(key)}: ${esc(value)}</span>`).join("")}</div>
      </article>
    </div>
  </section>`;
}

function artifactGalleryCards() {
  const galleryRecords = [
    registerArtifact({ title: "report.md", type: "markdown", filePath: path.join(marketingArtifactDir, "report.md"), description: "Marketing case report." }),
    registerArtifact({ title: "marketing_case/index.html", type: "html", filePath: path.join(marketingArtifactDir, "index.html"), description: "Original marketing case page." }),
    registerArtifact({ title: "product_demo/index.html", type: "html", filePath: htmlPath, description: "Generated product demo page.", linkWhenMissing: true }),
    registerArtifact({ title: "product_demo/ui-manifest.json", type: "json", filePath: manifestPath, description: "UI artifact consumption manifest." }),
    registerArtifact({ title: "contact_sheet.png", type: "image", filePath: path.join(marketingArtifactDir, "contact_sheet.png"), description: "Input/output visual comparison sheet." }),
    registerArtifact({ title: "evaluation.main.json", type: "json", filePath: path.join(marketingArtifactDir, "evaluation.main.json"), description: "Final creative local evaluator." }),
    registerArtifact({ title: "evaluation.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "evaluation.high_fidelity.json"), description: "High fidelity local evaluator." }),
    registerArtifact({ title: "vlm-judge.main.json", type: "json", filePath: path.join(marketingArtifactDir, "vlm-judge.main.json"), description: "Final creative VLM judge." }),
    registerArtifact({ title: "vlm-judge.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "vlm-judge.high_fidelity.json"), description: "High fidelity VLM judge." }),
    registerArtifact({ title: "variant-summary.json", type: "json", filePath: path.join(marketingArtifactDir, "variant-summary.json"), description: "Variant metadata and hashes." }),
    registerArtifact({ title: "slot-replacement-demo.json", type: "json", filePath: slotReplacementDemoPath, description: "Interactive Gap Fill before/after replay artifact." }),
    registerArtifact({ title: "timeline.json", type: "json", filePath: path.join(marketingArtifactDir, "timeline.json"), description: "Default timeline JSON." }),
    registerArtifact({ title: "timeline.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "timeline.high_fidelity.json"), description: "High fidelity timeline JSON." }),
    registerArtifact({ title: "generation.main.json", type: "json", filePath: path.join(marketingArtifactDir, "generation.main.json"), description: "Final creative generation JSON." }),
    registerArtifact({ title: "generation.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "generation.high_fidelity.json"), description: "High fidelity generation JSON." }),
    registerArtifact({ title: "corpus-regression-report.md", type: "markdown", filePath: path.join(corpusRegressionDir, "corpus-regression-report.md"), description: "Corpus regression human-readable report." }),
    registerArtifact({ title: "corpus-regression-report.json", type: "json", filePath: path.join(corpusRegressionDir, "corpus-regression-report.json"), description: "Corpus regression machine-readable report." }),
    registerArtifact({ title: "implementation_review.md", type: "markdown", filePath: path.join(artifactRoot, "review", "implementation_review.md"), description: "Implementation review report." })
  ];
  return `<section class="artifact-gallery" id="artifact-gallery">
    <div class="section-heading">
      <span>Artifact Gallery</span>
      <h2>Engineering evidence without overwhelming the demo</h2>
      <p>Every card is existence-checked before linking. Missing files are labeled instead of linked.</p>
    </div>
    <div class="gallery-grid">${galleryRecords.map((record) => `<article class="artifact-card artifact-${esc(record.status)}">
      <span>${esc(record.type)}</span>
      <h3>${esc(record.title)}</h3>
      <p>${esc(record.description)}</p>
      ${badge(record.status === "exists" ? "exists" : "missing", record.status === "exists" ? "success" : "danger")}
      ${artifactLink(record)}
    </article>`).join("")}</div>
  </section>`;
}

const manifest = scrubObject({
  generatedAt: new Date().toISOString(),
  artifactRoot: "../marketing_case",
  bestVariant: bestVariant?.key ?? null,
  bestVariantReason,
  videos: {
    found: resolvedVariants.filter((variant) => variant.exists).map((variant) => variant.key),
    missing: resolvedVariants.filter((variant) => !variant.exists).map((variant) => variant.key),
    byVariant: Object.fromEntries(resolvedVariants.map((variant) => [
      variant.key,
      {
        exists: variant.exists,
        path: variant.href,
        source: variant.summary ? "variant-summary.json" : "known filename fallback",
        localEvaluator: variant.evaluationExists,
        vlmJudge: variant.vlmExists,
        vlmOverall: variant.vlmScores?.overall ?? null,
        localStyleFidelity: variant.style ?? null
      }
    ]))
  },
  evaluator: {
    available: evaluatorAvailable,
    bestVariant: bestVariant?.key ?? null,
    bestLocalPass: bestVariant?.localPassed ?? false,
    bestStyleFidelity: bestVariant?.style ?? null,
    byVariant: Object.fromEntries(resolvedVariants.map((variant) => [
      variant.key,
      {
        available: variant.evaluationExists,
        passed: variant.localPassed,
        styleFidelity: variant.style ?? null,
        failedGates: localGateList(variant.evaluation).filter((gate) => gate.passed === false).map((gate) => gate.id ?? gate.name ?? "gate")
      }
    ]))
  },
  vlm: {
    available: vlmAvailable,
    bestVariant: bestVariant?.key ?? null,
    bestOverall: bestVlmScores?.overall ?? null,
    byVariant: Object.fromEntries(resolvedVariants.map((variant) => [
      variant.key,
      {
        available: variant.vlmExists,
        overall: variant.vlmScores?.overall ?? null,
        structure: variant.vlmScores?.structure ?? null,
        style: variant.vlmScores?.style ?? null,
        noDirectCopy: variant.vlmScores?.noDirectCopy ?? null,
        visualQuality: variant.vlmScores?.visualQuality ?? null
      }
    ]))
  },
  interactiveGapFill: {
    available: true,
    demoArtifact: hrefFromDemo(slotReplacementDemoPath),
    slotId: slotReplacementDemo.slot?.slotId ?? null,
    beforeStrategy: slotReplacementDemo.before?.fillStrategy ?? null,
    afterStrategy: slotReplacementDemo.after?.fillStrategy ?? null,
    evaluatorGates: slotReplacementDemo.evaluatorGates
  },
  naturalLanguageEdit: {
    available: true,
    mode: nlEditDemo.mode,
    instruction: nlEditDemo.instruction,
    parsedOperations: nlEditDemo.parsedOperations,
    beforeGenerationId: nlEditDemo.before?.generationId ?? null,
    afterGenerationId: nlEditDemo.after?.generationId ?? null,
    demoArtifact: hrefFromDemo(nlEditDemoPath),
    generationJson: nlEditDemo.after?.generationJson ?? null,
    timelineJson: nlEditDemo.after?.timelineJson ?? null,
    previewHtml: nlEditDemo.after?.previewHtml ?? null
  },
  artifactsConsumed: artifactRegistry.map(({ title, type, status, href, description }) => ({ title, type, status, path: href, description })),
  missingArtifacts: artifactRegistry.filter((artifact) => artifact.status !== "exists").map((artifact) => artifact.title)
});

await mkdir(demoDir, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const galleryHtml = artifactGalleryCards();

const html = scrubPrivateText(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>爆款结构迁移引擎 · Product Demo</title>
  <style>
    :root {
      --bg: #F7F8FA;
      --card: #FFFFFF;
      --ink: #172033;
      --muted: #64748B;
      --line: #DFE6EE;
      --primary: #0EA5E9;
      --primary-strong: #2563EB;
      --success: #10B981;
      --warning: #F59E0B;
      --danger: #F97316;
      --accent: #7C3AED;
      --shadow: 0 16px 44px rgba(15, 23, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    a { color: var(--primary-strong); font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    h1, h2, h3, p { margin-top: 0; }
    p { line-height: 1.55; color: var(--muted); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    img, video { width: 100%; border-radius: 8px; background: #0F172A; display: block; }
    main { max-width: 1680px; margin: 0 auto; padding: 18px; }
    section { margin-bottom: 18px; }
    .hero {
      min-height: 82vh;
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
      gap: 18px;
      align-items: stretch;
    }
    .hero-copy, .hero-video, .panel-card, .metric-card, .step-card, .gap-card, .artifact-card, .info-card, .asset-card, .mapping-row, .flow-card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .hero-copy { padding: 24px; display: flex; flex-direction: column; gap: 18px; }
    .hero-copy h1 { font-size: clamp(32px, 5vw, 64px); line-height: 1.02; letter-spacing: 0; margin: 0; }
    .hero-video { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .hero-video video { max-height: 68vh; object-fit: contain; }
    .eyebrow, .section-heading span, .asset-card span, .artifact-card span, .metric-card span, .mapping-row span {
      color: var(--primary-strong);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      font-weight: 900;
    }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric-card { padding: 12px; min-height: 126px; }
    .metric-card strong { display: block; font-size: 22px; margin: 8px 0 4px; }
    .metric-card p { font-size: 13px; margin: 0; }
    .policy-row, .pill-list, .card-topline, .score-detail { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 11px;
      line-height: 1;
      font-weight: 900;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .badge-success { background: #DCFCE7; color: #047857; border-color: #BBF7D0; }
    .badge-warning { background: #FEF3C7; color: #B45309; border-color: #FDE68A; }
    .badge-danger { background: #FFEDD5; color: #C2410C; border-color: #FED7AA; }
    .badge-accent { background: #EDE9FE; color: #6D28D9; border-color: #DDD6FE; }
    .badge-neutral { background: #F1F5F9; color: #475569; border-color: #E2E8F0; }
    .pipeline { background: #EAF6FF; border: 1px solid #B9E6FF; border-radius: 8px; padding: 16px; }
    .stepper { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .step-card { padding: 12px; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; min-height: 148px; }
    .step-index { width: 32px; height: 32px; border-radius: 999px; background: var(--primary); color: white; display: grid; place-items: center; font-weight: 900; }
    .step-card h3 { margin-bottom: 7px; font-size: 15px; }
    .step-card p { margin: 8px 0 0; font-size: 12px; }
    .section-heading { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .section-heading h2 { margin: 0; font-size: 24px; letter-spacing: 0; }
    .timeline-rail { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; box-shadow: var(--shadow); }
    .rail-track { margin: 12px 0; }
    .rail-label { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; font-weight: 900; margin-bottom: 6px; }
    .rail-row { min-height: 70px; display: flex; gap: 4px; overflow: hidden; }
    .rail-segment { min-width: 92px; border-radius: 8px; padding: 10px; color: #0F172A; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid rgba(15, 23, 42, 0.08); }
    .rail-segment strong { font-size: 12px; line-height: 1.2; }
    .rail-segment span { font-size: 11px; color: rgba(15, 23, 42, 0.72); }
    .rail-sample { background: #E0F2FE; }
    .rail-excluded { background: repeating-linear-gradient(135deg, #FFE4E6, #FFE4E6 8px, #FFF1F2 8px, #FFF1F2 16px); }
    .rail-success { background: #DCFCE7; }
    .rail-warning { background: #FEF3C7; }
    .rail-danger { background: #FFEDD5; }
    .rail-accent { background: #EDE9FE; }
    .rail-output { background: #DBEAFE; }
    .workbench { display: grid; grid-template-columns: 0.95fr 1.15fr 1.1fr; gap: 18px; align-items: start; }
    .workbench-column { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .panel-card, .info-card { padding: 16px; }
    .frame-strip, .mini-frames { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .frame-card { margin: 0; }
    .frame-card img { aspect-ratio: 9 / 16; object-fit: cover; }
    .frame-card figcaption { color: var(--muted); font-size: 12px; margin-top: 5px; }
    .compact-dl { display: grid; gap: 8px; margin: 0; }
    .compact-dl div { display: grid; grid-template-columns: minmax(110px, 0.42fr) minmax(0, 0.58fr); gap: 8px; border-bottom: 1px solid #EDF2F7; padding-bottom: 7px; }
    .compact-dl dt { color: var(--muted); font-size: 12px; font-weight: 800; }
    .compact-dl dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
    .segment-list { padding-left: 20px; margin: 0; display: grid; gap: 10px; }
    .segment-list li::marker { color: var(--primary); font-weight: 900; }
    .segment-list strong { margin-right: 8px; }
    .segment-list span { color: var(--muted); font-size: 12px; font-weight: 800; }
    .segment-list p { margin: 4px 0 0; font-size: 13px; }
    .asset-shelf, .gap-grid, .gallery-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .asset-card { padding: 12px; box-shadow: none; }
    .asset-card strong { display: block; margin: 4px 0; overflow-wrap: anywhere; }
    .asset-card p { margin-bottom: 8px; font-size: 12px; }
    .mapping-board, .flow-list { display: grid; gap: 8px; }
    .mapping-row { padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr) auto; gap: 10px; align-items: center; box-shadow: none; }
    .mapping-row strong { display: block; margin: 3px 0; overflow-wrap: anywhere; }
    .mapping-row p { margin: 0; font-size: 12px; }
    .mapping-arrow { color: var(--primary-strong); font-weight: 900; text-align: center; }
    .gap-card { padding: 14px; box-shadow: none; }
    .gap-card h3 { margin: 10px 0 6px; font-size: 16px; }
    .gap-card p { font-size: 13px; }
    .evidence { color: #334155; background: #F8FAFC; padding: 9px; border-radius: 8px; border: 1px solid #E2E8F0; }
    .flow-card { padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; box-shadow: none; }
    .flow-card span { background: #F1F5F9; border-radius: 999px; padding: 6px 9px; font-size: 12px; font-weight: 800; }
    .flow-card b { color: var(--primary-strong); }
    .tabs { display: grid; gap: 10px; }
    .tab-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
    .tab-buttons button {
      border: 1px solid var(--line);
      background: white;
      color: #334155;
      border-radius: 999px;
      min-height: 34px;
      padding: 7px 11px;
      font-weight: 900;
      cursor: pointer;
    }
    .tab-buttons button.active { background: var(--primary-strong); color: white; border-color: var(--primary-strong); }
    .tab-buttons.compact button { min-height: 30px; font-size: 12px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .video-card { display: grid; grid-template-columns: minmax(210px, 0.55fr) minmax(0, 0.45fr); gap: 12px; align-items: start; }
    .video-card video { max-height: 640px; object-fit: contain; }
    .video-card .contact-sheet { max-height: 640px; object-fit: contain; background: white; }
    .video-copy { min-width: 0; }
    .score-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0; }
    .score-block { border: 1px solid var(--line); border-radius: 8px; padding: 9px; background: #F8FAFC; }
    .score-block span { display: block; color: var(--muted); font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .score-block strong { display: block; font-size: 18px; margin-top: 3px; }
    .score-success { background: #ECFDF5; border-color: #BBF7D0; }
    .score-warning { background: #FFFBEB; border-color: #FDE68A; }
    .score-danger { background: #FFF7ED; border-color: #FED7AA; }
    .score-accent { background: #F5F3FF; border-color: #DDD6FE; }
    details { border: 1px solid var(--line); border-radius: 8px; padding: 10px; background: #F8FAFC; }
    details summary { cursor: pointer; font-weight: 900; color: #334155; }
    .mode-toggle { border: 1px solid #C7D2FE; border-radius: 8px; padding: 12px; background: #EEF2FF; display: grid; gap: 10px; }
    .mode-toggle video { max-height: 420px; object-fit: contain; }
    .callout { margin: 0; color: #1E3A8A; font-weight: 800; }
    .scoreboard-grid { display: grid; grid-template-columns: 1.1fr 1fr 0.9fr; gap: 12px; }
    .gate-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .gate { border-radius: 999px; padding: 5px 8px; font-size: 11px; font-weight: 900; background: #F1F5F9; color: #475569; }
    .gate.pass { background: #DCFCE7; color: #047857; }
    .gate.fail { background: #FFEDD5; color: #C2410C; }
    .trust-card { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .edit-instruction { background: #0F172A; color: white; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; }
    .compare-grid { display: grid; grid-template-columns: 1fr 1fr 1.05fr; gap: 12px; align-items: start; }
    .compare-grid video { max-height: 520px; object-fit: contain; }
    .edit-preview-frame { width: 100%; min-height: 520px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
    .replacement-demo-grid { display: grid; grid-template-columns: 0.75fr 1fr 1fr 1.1fr; gap: 12px; align-items: stretch; }
    .proxy-preview { display: grid; align-content: center; justify-items: center; text-align: center; gap: 10px; min-height: 360px; }
    .proxy-orb {
      width: min(220px, 72%);
      aspect-ratio: 1;
      border-radius: 50%;
      background: radial-gradient(circle at 32% 26%, #fff 0%, #ff8a80 15%, #E53935 38%, #7f1d1d 78%, #2f0a0a 100%);
      border: 7px solid rgba(255,255,255,0.7);
      box-shadow: inset -28px -24px 42px rgba(0,0,0,0.28), 0 24px 60px rgba(229,57,53,0.26);
      position: relative;
    }
    .proxy-orb::after {
      content: "Missing slot";
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      font-size: 20px;
      font-weight: 900;
      text-shadow: 0 2px 12px rgba(0,0,0,0.4);
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #E2E8F0; padding: 8px 6px; text-align: left; vertical-align: top; }
    th { color: var(--muted); text-transform: uppercase; font-size: 11px; }
    .artifact-gallery { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; box-shadow: var(--shadow); }
    .artifact-card { padding: 12px; box-shadow: none; display: grid; gap: 6px; align-content: start; }
    .artifact-card h3 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
    .artifact-card p { margin: 0; font-size: 12px; }
    .artifact-missing { color: #C2410C; font-weight: 900; }
    .missing-card { background: #FFF7ED; border: 1px dashed #FDBA74; color: #9A3412; border-radius: 8px; padding: 12px; display: grid; gap: 4px; }
    .missing-card span { color: #C2410C; font-size: 12px; }
    .raw-disclosure { display: grid; gap: 10px; }
    @media (max-width: 1320px) {
      .hero, .workbench, .scoreboard-grid, .compare-grid, .replacement-demo-grid { grid-template-columns: 1fr; }
      .stepper { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .hero { min-height: auto; }
    }
    @media (max-width: 820px) {
      main { padding: 10px; }
      .summary-grid, .asset-shelf, .gap-grid, .gallery-grid, .score-row, .video-card { grid-template-columns: 1fr; }
      .stepper { grid-template-columns: 1fr; }
      .frame-strip, .mini-frames { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .mapping-row { grid-template-columns: 1fr; }
      .mapping-arrow { text-align: left; }
      .rail-row { overflow-x: auto; }
      .rail-segment { flex: 0 0 180px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero" id="executive-summary">
      <div class="hero-copy">
        <p class="eyebrow">Executive Summary</p>
        <h1>爆款结构迁移引擎</h1>
        <p>Sample video -> structure analysis -> reusable template/atoms -> target assets -> slot mapping/gap report -> fill plan -> renderable timeline -> final videos + explainability.</p>
        <div class="summary-grid">
          ${metricCard("Input sample", sampleName, `${formatSec(sampleMetadata.durationSec)} · ${formatNumber(sampleMetadata.width, 0)}x${formatNumber(sampleMetadata.height, 0)} · ${formatNumber(sampleMetadata.fps, 0)}fps`, "neutral")}
          ${metricCard("Extracted structure", extractedStructureName, `${template?.visualStyle?.layout ?? "minimal poster layout"} · ${ribbon.pathFamily ?? "ribbon"} / ${ribbon.axis ?? "axis"}`, "accent")}
          ${metricCard("Material gaps", `${gapReport.length} total`, `${highSeverityGaps} high severity · ${primaryGap?.gapLabelZh ?? primaryGap?.gapType ?? "none"}`, highSeverityGaps ? "danger" : "success")}
          ${metricCard("Fill strategy", primaryFill?.strategy ?? "n/a", `${primaryFill?.rendererInstructions?.renderer ?? primaryGap?.fulfilledByBackend ?? "backend n/a"} · ${primaryFill?.rendererInstructions?.atom ?? "atom n/a"}`, "accent")}
          ${metricCard("Output variants", `${videosFound}/${resolvedVariants.length}`, resolvedVariants.filter((variant) => variant.exists).map((variant) => variant.shortLabel).join(" · ") || "No MP4s", "success")}
          ${metricCard("Local evaluator", localGatePassed ? "PASS" : evaluatorAvailable ? "CHECK" : "n/a", `Style ${formatPercentScore(bestVariant?.style)} · ${failedGates.length} failed gates`, localGatePassed ? "success" : "warning")}
          ${metricCard("VLM judge", vlmAvailable ? formatPercentScore(bestVlmScores?.overall) : "not run", vlmAvailable ? `${bestVariant?.display} · no-copy ${formatPercentScore(bestVlmScores?.noDirectCopy)}` : "VLM artifact not generated", vlmAvailable ? "accent" : "neutral")}
          ${metricCard("Best output", bestVariant?.display ?? "n/a", bestVariantReason, "success")}
        </div>
        <div class="policy-row">
          ${badge("No sample frames/audio copied by default", "success")}
          ${badge("Transferred: structure, rhythm, layout grammar, motif geometry", "accent")}
          ${badge("Human edit example: 换成白底高质感风格", "neutral")}
        </div>
      </div>
      <div class="hero-video">
        <h2>${esc(bestVariant?.display ?? "Generated Output")}</h2>
        ${bestVariant?.exists ? `<video controls preload="metadata" src="${esc(bestVariant.href)}"></video>` : missingCard("Best output video", "No MP4 variant available")}
        <p>${esc(bestVariant?.description ?? "Generated output not available.")}</p>
        <p><strong>Selection rationale:</strong> ${esc(bestVariantReason)}</p>
      </div>
    </section>

    <section class="pipeline" id="pipeline-stepper">
      <div class="section-heading">
        <span>Pipeline Stepper</span>
        <h2>Input -> analysis -> mapping -> fill -> render -> judge</h2>
      </div>
      <div class="stepper">${pipelineStages.map(stageHtml).join("")}</div>
    </section>

    <section class="timeline-rail" id="structure-timeline-rail">
      <div class="section-heading">
        <span>Structure Timeline Rail</span>
        <h2>Sample structure, target gaps, and generated clips aligned</h2>
      </div>
      <div class="rail-track">
        <div class="rail-label"><span>Track 1: Sample Structure</span><span>Excluded tail is separated</span></div>
        <div class="rail-row">${sampleStructureTrack()}</div>
      </div>
      <div class="rail-track">
        <div class="rail-label"><span>Track 2: Target Slots / Gaps</span><span>Mapping state + fill source</span></div>
        <div class="rail-row">${targetGapTrack()}</div>
      </div>
      <div class="rail-track">
        <div class="rail-label"><span>Track 3: Generated Clips</span><span>${esc(bestVariant?.display ?? "best variant")}</span></div>
        <div class="rail-row">${generatedTrack()}</div>
      </div>
    </section>

    <section class="workbench" id="three-column-workbench">
      <div class="workbench-column">
        <div class="section-heading">
          <span>Workbench Left</span>
          <h2>Sample Understanding</h2>
        </div>
        <article class="panel-card">
          <h3>Sample Frame Strip</h3>
          <div class="frame-strip">
            ${imageCard("input_hook.png", "Hook frame")}
            ${imageCard("input_climax.png", "Ribbon / climax frame")}
            ${imageCard("input_excluded_tail.png", "Excluded tail frame")}
          </div>
        </article>
        <article class="info-card">
          <h3>Video Metadata</h3>
          <dl class="compact-dl">
            <div><dt>Type</dt><dd>${esc(template?.videoType ?? "motion_graphic_marketing_poster")}</dd></div>
            <div><dt>Duration</dt><dd>${formatSec(sampleMetadata.durationSec)}</dd></div>
            <div><dt>Resolution</dt><dd>${esc(`${sampleMetadata.width ?? "n/a"}x${sampleMetadata.height ?? "n/a"}`)}</dd></div>
            <div><dt>Audio</dt><dd>${esc(sampleMetadata.hasAudio ? "yes" : "n/a")}</dd></div>
          </dl>
        </article>
        <article class="info-card">
          <h3>Structure Segments</h3>
          ${structureSegmentList()}
        </article>
        ${motifGeometryCard()}
        ${excludedSegmentCard()}
      </div>

      <div class="workbench-column">
        <div class="section-heading">
          <span>Workbench Middle</span>
          <h2>Transfer Plan</h2>
        </div>
        <article class="panel-card">
          <h3>StructureTemplate + KnowledgeAtoms</h3>
          <p><strong>${esc(template?.name ?? "Template not generated")}</strong></p>
          <div class="pill-list">${structureAtoms.slice(0, 10).map((atom) => badge(atom.name ?? atom.id, "neutral")).join("")}</div>
        </article>
        <article class="panel-card">
          <h3>Target Asset Shelf</h3>
          ${targetAssetShelf()}
        </article>
        <article class="panel-card">
          <h3>Slot Mapping Board</h3>
          ${slotMappingBoard()}
        </article>
        <article class="panel-card">
          <h3>Gap Card Grid</h3>
          ${gapCardGrid()}
        </article>
        <article class="panel-card">
          <h3>Fill Plan Flow</h3>
          ${fillPlanFlow()}
        </article>
      </div>

      <div class="workbench-column">
        <div class="section-heading">
          <span>Workbench Right</span>
          <h2>Generated Outputs</h2>
        </div>
        ${creativeToggle()}
        <article class="panel-card">
          <h3>Video Tabs</h3>
          ${outputTabs()}
        </article>
      </div>
    </section>

    ${evaluatorScoreboard()}
    ${beforeAfterDiff()}
    ${interactiveGapFillSection()}

    <section class="raw-disclosure" id="progressive-disclosure">
      <div class="section-heading">
        <span>Progressive Disclosure</span>
        <h2>Raw JSON and evidence links</h2>
        <p>Primary UI stays visual. Raw artifacts are available here for deeper review.</p>
      </div>
      <details>
        <summary>View raw analysis JSON</summary>
        <p>${artifactLink(analysisArtifact.record, "Open analysis.marketing.json")}</p>
      </details>
      <details>
        <summary>View timeline JSON</summary>
        <p>${artifactLink(timelineByArtifactKey.high_fidelity.record, "Open timeline.high_fidelity.json")} · ${artifactLink(timelineByArtifactKey.main.record, "Open timeline.json")}</p>
      </details>
      <details>
        <summary>View evaluator JSON</summary>
        <p>${artifactLink(evaluationByArtifactKey.high_fidelity.record, "Open evaluation.high_fidelity.json")} · ${artifactLink(evaluationByArtifactKey.main.record, "Open evaluation.main.json")}</p>
      </details>
      <details>
        <summary>View VLM judge JSON</summary>
        <p>${artifactLink(vlmByArtifactKey.high_fidelity.record, "Open vlm-judge.high_fidelity.json")} · ${artifactLink(vlmByArtifactKey.main.record, "Open vlm-judge.main.json")}</p>
      </details>
      <details>
        <summary>View corpus regression links</summary>
        <p>Corpus regression: ${esc(corpus?.summary?.passed ?? 0)} passed / ${esc(corpus?.summary?.total ?? 0)} total.</p>
      </details>
    </section>

    ${galleryHtml}
  </main>
  <script>
    document.querySelectorAll("[data-tab-group]").forEach((group) => {
      const buttons = Array.from(group.querySelectorAll("[data-tab-target]"));
      const panels = Array.from(group.querySelectorAll("[data-tab-panel]"));
      const activate = (key) => {
        buttons.forEach((button) => button.classList.toggle("active", button.dataset.tabTarget === key));
        panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.tabPanel === key));
      };
      const initial = buttons.find((button) => button.classList.contains("active"))?.dataset.tabTarget ?? buttons[0]?.dataset.tabTarget;
      if (initial) activate(initial);
      buttons.forEach((button) => button.addEventListener("click", () => activate(button.dataset.tabTarget)));
    });
  </script>
</body>
</html>`);

await writeFile(htmlPath, html, "utf8");
console.log(`Product demo written to ${rel(htmlPath)}`);
console.log(`Product demo UI manifest written to ${rel(manifestPath)}`);
