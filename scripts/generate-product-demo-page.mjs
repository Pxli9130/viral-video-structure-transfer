#!/usr/bin/env node
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { artifactRoot, corpusRegressionDir, marketingArtifactDir, rel } from "./artifact-paths.mjs";

const demoDir = path.join(artifactRoot, "product_demo");
const editingCaseDir = path.join(artifactRoot, "editing_case");
const motionGraphCaseDir = path.join(artifactRoot, "motion_graph_case");
const manifestPath = path.join(demoDir, "ui-manifest.json");
const htmlPath = path.join(demoDir, "index.html");
const slotReplacementDemoPath = path.join(marketingArtifactDir, "slot-replacement-demo.json");
const slotReplacementProxyVideoPath = path.join(marketingArtifactDir, "interactive_gap_fill_proxy.mp4");
const slotReplacementUserVideoPath = path.join(marketingArtifactDir, "interactive_gap_fill_user_replacement.mp4");
const slotReplacementProxyTimelinePath = path.join(marketingArtifactDir, "timeline.interactive_gap_fill_proxy.json");
const slotReplacementUserTimelinePath = path.join(marketingArtifactDir, "timeline.interactive_gap_fill_user_replacement.json");
const slotReplacementUserGenerationPath = path.join(marketingArtifactDir, "generation.interactive_gap_fill_user_replacement.json");
const slotReplacementAssetPath = path.join(marketingArtifactDir, "fixture_uploaded_replacement_asset.svg");
const nlEditDemoPath = path.join(marketingArtifactDir, "nl-edit-demo.json");
const nlEditGenerationPath = path.join(marketingArtifactDir, "generation.nl_edit_white_poster.json");
const nlEditTimelinePath = path.join(marketingArtifactDir, "timeline.nl_edit_white_poster.json");
const nlEditPreviewPath = path.join(marketingArtifactDir, "nl-edit-after-preview.html");

const videoVariants = [
  {
    key: "final_creative",
    summaryLabels: ["main", "final_creative"],
    artifactKey: "main",
    display: "最终创意",
    shortLabel: "最终",
    knownFiles: ["ai_challenge_poster_final_creative.mp4", "ai_challenge_poster_main.mp4"],
    frameFiles: ["main_t1.png", "main_t7.png", "main_t13.png"],
    description: "隐藏过程覆盖层的干净创意输出，适合评审直接观看最终效果。"
  },
  {
    key: "high_fidelity",
    summaryLabels: ["high_fidelity"],
    artifactKey: "high_fidelity",
    display: "高保真",
    shortLabel: "保真",
    knownFiles: ["ai_challenge_poster_high_fidelity.mp4"],
    frameFiles: ["high_fidelity_t1.png", "high_fidelity_t7.png", "high_fidelity_t13.png"],
    description: "风格匹配最强的创意输出，保留版式语法与彩带几何。"
  },
  {
    key: "explainable_demo",
    summaryLabels: ["explainable_demo"],
    artifactKey: "explainable_demo",
    display: "可解释演示",
    shortLabel: "解释",
    knownFiles: ["ai_challenge_poster_explainable_demo.mp4"],
    frameFiles: ["explainable_demo_t1.png", "explainable_demo_t7.png", "explainable_demo_t13.png"],
    description: "带阶段、映射和缺口补全说明的走查/调试输出。"
  },
  {
    key: "high_ctr",
    summaryLabels: ["high_ctr"],
    artifactKey: "high_ctr",
    display: "高点击",
    shortLabel: "CTR",
    knownFiles: ["ai_challenge_poster_high_ctr.mp4"],
    frameFiles: ["high_ctr_t1.png", "high_ctr_t7.png", "high_ctr_t13.png"],
    description: "信息密度更高、运动更快的点击导向版本。"
  },
  {
    key: "high_quality",
    summaryLabels: ["high_quality"],
    artifactKey: "high_quality",
    display: "高质感",
    shortLabel: "质感",
    knownFiles: ["ai_challenge_poster_high_quality.mp4"],
    frameFiles: ["high_quality_t1.png", "high_quality_t7.png", "high_quality_t13.png"],
    description: "更干净、更慢、更高级的视觉打磨版本。"
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

const statusDisplay = {
  PASS: "通过",
  CHECK: "待检查",
  WARNING: "警告",
  MISSING: "缺失",
  GENERATED: "已生成",
  FILLED: "已补全",
  PROCEDURAL: "程序化",
  MAPPED: "已映射",
  "WEAK MATCH": "弱匹配",
  SKIPPED: "已跳过",
  pass: "通过",
  matched: "已匹配",
  mapped: "已映射",
  missing: "缺失",
  weak_match: "弱匹配",
  proxy_generated: "代理占位",
  user_replaced: "用户已替换",
  rendered: "已渲染",
  source_video_mapped: "目标素材已匹配",
  target_asset_mapped: "目标素材已匹配",
  target_asset_weak_match: "目标素材弱匹配",
  no_user_asset_available: "缺少用户素材",
  high: "高",
  medium: "中",
  low: "低",
  none: "无"
};

const strategyDisplay = {
  proxy_placeholder: "代理占位",
  user_asset_replace: "用户素材替换",
  procedural_generation: "程序化生成",
  text_card: "文字卡片",
  packaging_overlay: "包装补全",
  aigc_placeholder: "AIGC 占位",
  reuse_with_crop_zoom: "裁切缩放复用",
  remotion_mg: "Remotion MG",
  ffmpeg_compose: "FFmpeg 合成",
  image_card: "图片卡片",
  rendered: "已渲染"
};

const roleDisplay = {
  hook: "钩子",
  body: "主体",
  proof: "证明",
  cta: "行动召唤"
};

function displayLabel(map, value, fallback = "n/a") {
  const key = String(value ?? "");
  if (!key) return fallback;
  return map[key] ?? key.replace(/_/g, " ");
}

function statusLabel(value) {
  return displayLabel(statusDisplay, value);
}

function strategyLabel(value) {
  return displayLabel(strategyDisplay, value);
}

function roleLabel(value) {
  return displayLabel(roleDisplay, value);
}

function statusBadge(status) {
  const raw = String(status ?? "n/a");
  const translated = statusLabel(raw);
  return translated === raw ? raw : `${translated} · ${raw}`;
}

function missingCard(title, message = "尚未生成") {
  return `<article class="missing-card"><strong>${esc(title)}</strong><span>${esc(message)}</span></article>`;
}

function imageCard(fileName, label) {
  const filePath = path.join(marketingArtifactDir, fileName);
  if (!existsSync(filePath)) {
    return missingCard(label, "缺少帧 artifact");
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

function hasNumericVlmScore(vlmScores) {
  return Boolean(
    vlmScores &&
    [vlmScores.overall, vlmScores.structure, vlmScores.style, vlmScores.noDirectCopy, vlmScores.visualQuality]
      .some((value) => typeof value === "number" && Number.isFinite(value))
  );
}

function vlmRunStatus(vlmArtifact, vlmScores) {
  if (!vlmArtifact?.exists) return "missing";
  if (hasNumericVlmScore(vlmScores)) return "ok";
  const status = String(vlmArtifact.data?.status ?? "").toLowerCase();
  const reason = String(vlmArtifact.data?.reason ?? "").toLowerCase();
  if (/skip|skipped/.test(status) || /skip|not set|not run|disabled|not configured/.test(reason)) return "skipped_infra";
  return "not_run";
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

function artifactLink(record, label = "打开 artifact") {
  if (record.status !== "exists" || !record.href) {
    return `<span class="artifact-missing">缺失</span>`;
  }
  return `<a href="${esc(record.href)}">${esc(label)}</a>`;
}

const analysisArtifact = await readJsonArtifact({
  title: "analysis.marketing.json",
  filePath: path.join(marketingArtifactDir, "analysis.marketing.json"),
  description: "样例视频理解与运动几何。"
});
const templateArtifact = await readJsonArtifact({
  title: "structure-template.json",
  filePath: path.join(marketingArtifactDir, "structure-template.json"),
  description: "可复用结构模板与结构原子。"
});
const generationResultArtifact = await readJsonArtifact({
  title: "generation-result.json",
  filePath: path.join(marketingArtifactDir, "generation-result.json"),
  description: "默认生成结果，包含槽位映射、缺口、补全计划与时间线。"
});
const variantSummaryArtifact = await readJsonArtifact({
  title: "variant-summary.json",
  filePath: path.join(marketingArtifactDir, "variant-summary.json"),
  description: "生成 MP4 多版本摘要、哈希与元数据。",
  fallback: []
});
const corpusArtifact = await readJsonArtifact({
  title: "corpus-regression-report.json",
  filePath: path.join(corpusRegressionDir, "corpus-regression-report.json"),
  description: "语料回归通过/失败报告。",
  fallback: {}
});
const editingCaseArtifact = await readJsonArtifact({
  title: "editing_case/generation-result.json",
  filePath: path.join(editingCaseDir, "generation-result.json"),
  description: "editing.mov 参考视频与目标素材分离案例，包含代理缺口补全证据。",
  fallback: {}
});
const motionGraphCaseArtifact = await readJsonArtifact({
  title: "motion_graph_case/generation-result.json",
  filePath: path.join(motionGraphCaseDir, "generation-result.json"),
  description: "motion_graph_1.mov 开放世界槽位归纳案例，包含 family-specific proxy 证据。",
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
    description: `${config.display} 生成载荷。`
  });
  evaluationByArtifactKey[config.artifactKey] = await readJsonArtifact({
    title: `evaluation.${config.artifactKey}.json`,
    filePath: path.join(marketingArtifactDir, `evaluation.${config.artifactKey}.json`),
    description: `${config.display} 本地评估结果。`
  });
  vlmByArtifactKey[config.artifactKey] = await readJsonArtifact({
    title: `vlm-judge.${config.artifactKey}.json`,
    filePath: path.join(marketingArtifactDir, `vlm-judge.${config.artifactKey}.json`),
    description: `${config.display} VLM 评审结果。`
  });
}

timelineByArtifactKey.main = await readJsonArtifact({
  title: "timeline.json",
  filePath: path.join(marketingArtifactDir, "timeline.json"),
  description: "默认可渲染时间线。"
});
timelineByArtifactKey.high_fidelity = await readJsonArtifact({
  title: "timeline.high_fidelity.json",
  filePath: path.join(marketingArtifactDir, "timeline.high_fidelity.json"),
  description: "高保真可渲染时间线。"
});

const analysis = analysisArtifact.data ?? {};
const template = templateArtifact.data ?? {};
const generationResult = generationResultArtifact.data ?? {};
const variantSummary = variantSummaryArtifact.data ?? [];
const corpus = corpusArtifact.data ?? {};
const editingCase = editingCaseArtifact.data ?? {};
const motionGraphCase = motionGraphCaseArtifact.data ?? {};
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
  const vlmStatus = vlmRunStatus(vlmArtifact, vlmScores);
  const vlmScoreAvailable = hasNumericVlmScore(vlmScores);
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
    vlmStatus,
    vlmAvailable: vlmScoreAvailable,
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
    ? `按 VLM overall ${formatPercentScore(bestVariant.vlmScores.overall)} 选择；本地风格保真兜底分为 ${formatPercentScore(bestVariant.style)}。`
    : `VLM overall 不可用，因此按本地风格保真兜底分 ${formatPercentScore(bestVariant?.style)} 选择。`;
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
const vlmAvailable = resolvedVariants.some((variant) => variant.vlmAvailable);
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

function slotReplacementEvaluatorGates(generation, options = {}) {
  const slots = Array.isArray(generation?.replacementSlots) ? generation.replacementSlots : [];
  const clips = Array.isArray(generation?.timeline?.clips) ? generation.timeline.clips : [];
  const proxyClips = Array.isArray(options.proxyTimeline?.clips) ? options.proxyTimeline.clips : [];
  const allClips = [...clips, ...proxyClips];
  const unresolved = slots.filter((slot) => slot.status === "missing" || slot.status === "proxy_generated").length;
  const userReplaced = slots.filter((slot) => slot.status === "user_replaced" || slot.status === "rendered").length;
  const proxyVisible = allClips.some(
    (clip) =>
      clip.gapFillStrategy === "proxy_placeholder" ||
      (clip.layers ?? []).some((layer) => layer.style?.fillStrategy === "proxy_placeholder")
  );
  const replacementAssetIds = new Set(slots.map((slot) => slot.boundAssetId).filter(Boolean));
  const replacementRendered = clips.some((clip) =>
    (clip.layers ?? []).some((layer) => layer.assetId && replacementAssetIds.has(layer.assetId))
  );
  const motionPreserved = slots
    .filter((slot) => slot.boundAssetId)
    .every((slot) => slot.applyMotionFromSlot !== false && Boolean(slot.motionSpec));

  return [
    {
      id: "unresolved_placeholder_count",
      value: unresolved,
      passed: unresolved === 0,
      comment: unresolved === 0 ? "No unresolved proxy remains after replacement." : `${unresolved} proxy slot(s) still unresolved.`
    },
    {
      id: "user_replaced_slot_count",
      value: userReplaced,
      passed: userReplaced > 0,
      comment: `${userReplaced} 个槽位已绑定托管用户替换素材。`
    },
    {
      id: "proxy_slot_visible",
      value: proxyVisible,
      passed: proxyVisible || userReplaced > 0 || slots.length === 0,
      comment: proxyVisible ? "替换前夹具展示可见代理占位。" : "夹具对中未找到代理占位层。"
    },
    {
      id: "replacement_asset_rendered",
      value: replacementRendered,
      passed: replacementRendered,
      comment: replacementRendered ? "Replacement asset is referenced by a rendered timeline layer." : "No replacement asset layer found."
    },
    {
      id: "motion_preserved_after_replacement",
      value: motionPreserved,
      passed: motionPreserved,
      comment: motionPreserved ? "Replacement keeps slot timing/layout/motion metadata." : "Replacement binding did not preserve slot motion."
    }
  ];
}

function slotReplacementFixtureTimelines({ slotId, placeholderSpec, semanticLabel, visualForm, acceptedAssetTypes }) {
  const generatedAt = new Date().toISOString();
  const motionSpec = placeholderSpec.motion ?? { type: "spin", axis: "y", speed: 0.8, durationSec: 4, preserveFromSlot: true };
  const baseSlot = {
    slotId,
    semanticLabel,
    visualForm,
    placeholderSpec,
    acceptedAssetTypes,
    motionSpec,
    applyMotionFromSlot: true,
    gapType: "dynamic_3d_ribbon_asset",
    rendererBackend: "remotion_mg",
    targetClipId: "igf_demo_clip"
  };
  const baseTimeline = {
    id: "timeline_interactive_gap_fill_fixture",
    projectId: "marketing_case_demo",
    generationId: "generation_interactive_gap_fill_fixture",
    durationSec: 4,
    aspectRatio: "9:16",
    rendererTarget: "remotion",
    mapping: [],
    gapReport: [
      {
        slotId,
        replacementSlotId: slotId,
        gapType: "dynamic_3d_ribbon_asset",
      gapLabel: "缺少可替换主视觉/动机素材",
        gapLabelZh: "缺少可替换主视觉/动效素材",
        severity: "high",
        reason: "No managed target asset was available for this required visual slot.",
        recommendedStrategies: ["proxy_placeholder", "user_asset_replace"],
        placeholderSpec,
        acceptedAssetTypes,
        clickToReplace: true
      }
    ],
    renderPlan: {
      width: 720,
      height: 1280,
      fps: 30,
      background: "#f8fafc",
      rendererBackend: "remotion_mg",
      adapterOptions: {
        creativeMode: "final_creative",
        packagingStyle: "clean",
        subtitleDensity: "minimal",
        debugLabelsInVideo: false,
        noSampleVisualCopy: true
      },
      motionAtoms: []
    },
    warnings: [],
    createdAt: generatedAt
  };
  const proxyClip = {
    id: "igf_demo_proxy_clip",
    role: "body",
    startSec: 0,
    durationSec: 4,
    type: "placeholder",
    visualIntent: "可见代理占位在用户上传替换素材前保留缺失槽位运动。",
    scriptText: "交互式缺口补全代理夹具",
    subtitleText: "Proxy keeps structure complete",
    transitionIn: "none",
    transitionOut: "hard_cut",
    replacementSlotId: slotId,
    placeholderSpec,
    gapFillStrategy: "proxy_placeholder",
    layers: [
      {
        id: "layer_igf_proxy",
        kind: "sticker",
        style: {
          fillStrategy: "proxy_placeholder",
          replacementSlotId: slotId,
          placeholderSpec
        },
        timing: { motionSpec }
      }
    ]
  };
  const replacementClip = {
    ...proxyClip,
    id: "igf_demo_user_replacement_clip",
    type: "image",
    visualIntent: "Managed uploaded replacement asset is rendered in the same slot with preserved motion.",
    scriptText: "交互式缺口补全用户替换夹具",
    subtitleText: "User asset replaces proxy",
    gapFillStrategy: "user_asset_replace",
    layers: [
      {
        id: "layer_igf_replacement_asset",
        kind: "base_visual",
        assetId: "fixture_uploaded_replacement_asset",
        style: {
          fillStrategy: "user_asset_replace",
          replacementSlotId: slotId,
          placeholderSpec
        },
        timing: { motionSpec }
      }
    ]
  };
  const proxyTimeline = {
    ...baseTimeline,
    id: "timeline_interactive_gap_fill_proxy",
    generationId: "generation_interactive_gap_fill_proxy",
    clips: [proxyClip],
    fillPlan: [
      {
        slotId,
        strategy: "proxy_placeholder",
        rationale: "No user asset bound yet, so a visible proxy preserves structure and motion.",
        rendererInstructions: {
          renderer: "remotion_mg",
          atom: "proxy_shape",
          strategy: "proxy_placeholder",
          fulfilledBy: "proxy_placeholder",
          placeholderSpec,
          motionSpec
        }
      }
    ],
    replacementSlots: [{ ...baseSlot, status: "proxy_generated" }]
  };
  const replacementTimeline = {
    ...baseTimeline,
    id: "timeline_interactive_gap_fill_user_replacement",
    generationId: "generation_interactive_gap_fill_user_replacement",
    clips: [replacementClip],
    fillPlan: [
      {
        slotId,
        strategy: "user_asset_replace",
        rationale: "A managed replacement asset is bound to the slot and rendered with preserved slot motion.",
        rendererInstructions: {
          renderer: "remotion_mg",
          atom: "managed_asset_layer",
          strategy: "user_asset_replace",
          fulfilledBy: "user_asset_replace",
          boundAssetId: "fixture_uploaded_replacement_asset",
          applyMotionFromSlot: true,
          motionSpec
        }
      }
    ],
    replacementSlots: [{ ...baseSlot, status: "user_replaced", boundAssetId: "fixture_uploaded_replacement_asset" }]
  };

  const replacementGeneration = {
    id: "generation_interactive_gap_fill_user_replacement",
    projectId: "marketing_case_demo",
    request: {
      projectId: "marketing_case_demo",
      templateId: template?.id ?? "marketing_case_template",
      brief: "交互式缺口补全已渲染替换夹具。",
      replacementBindings: [{ slotId, assetId: "fixture_uploaded_replacement_asset", applyMotionFromSlot: true }]
    },
    timeline: replacementTimeline,
    slotMapping: [],
    gapReport: replacementTimeline.gapReport,
    fillPlan: replacementTimeline.fillPlan,
    replacementSlots: replacementTimeline.replacementSlots,
    createdAt: generatedAt
  };

  return { proxyTimeline, replacementTimeline, replacementGeneration };
}

async function ensureFixtureReplacementAsset() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="0.52" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="22" flood-color="#0f172a" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect width="720" height="720" rx="72" fill="#f8fafc"/>
  <g filter="url(#shadow)">
    <rect x="118" y="116" width="484" height="488" rx="56" fill="url(#g)"/>
    <circle cx="360" cy="292" r="118" fill="#ffffff" opacity="0.9"/>
    <path d="M272 420c52 42 124 42 176 0 18-14 44-2 44 20v36c0 31-25 56-56 56H284c-31 0-56-25-56-56v-36c0-22 26-34 44-20z" fill="#ffffff" opacity="0.88"/>
  </g>
  <text x="360" y="646" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="800" fill="#172033">Managed Upload Fixture</text>
</svg>`;
  await writeFile(slotReplacementAssetPath, svg, "utf8");
}

async function renderSlotReplacementFixture(timeline, stableOutputPath, renderId) {
  if (process.env.VVST_REUSE_IGF_FIXTURE === "1" && existsSync(stableOutputPath)) {
    return { rendered: true, path: stableOutputPath, reused: true };
  }
  const rendererDistPath = path.join(process.cwd(), "apps", "api", "dist", "adapters", "renderers.js");
  if (!existsSync(rendererDistPath)) {
    return { rendered: false, path: stableOutputPath, error: "apps/api/dist/adapters/renderers.js missing; run npm run build before demo generation." };
  }
  try {
    const { RemotionRenderer } = await import(pathToFileURL(rendererDistPath).href);
    const renderer = new RemotionRenderer({
      generatedDir: marketingArtifactDir,
      entryPoint: path.join(process.cwd(), "apps", "api", "remotion", "index.tsx"),
      compositionId: "ViralReconstruction",
      assetResolver: {
        resolve(assetId) {
          return assetId === "fixture_uploaded_replacement_asset" ? slotReplacementAssetPath : undefined;
        }
      }
    });
    const output = await renderer.render(timeline, renderId);
    if (output.status !== "completed" || !output.outputPath || !existsSync(output.outputPath)) {
      if (existsSync(stableOutputPath)) {
        return { rendered: true, path: stableOutputPath, reused: true, warning: output.error ?? "Remotion did not refresh existing fixture." };
      }
      return { rendered: false, path: stableOutputPath, error: output.error ?? "Remotion renderer did not produce an output path." };
    }
    await copyFile(output.outputPath, stableOutputPath);
    return { rendered: true, path: stableOutputPath, renderId: output.renderId };
  } catch (error) {
    if (existsSync(stableOutputPath)) {
      return { rendered: true, path: stableOutputPath, reused: true, warning: error.message };
    }
    return { rendered: false, path: stableOutputPath, error: error.message };
  }
}

async function buildSlotReplacementDemo() {
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
  const semanticLabel = replaceableSlot?.semanticLabel ?? replaceableGap.gapLabelZh ?? replaceableGap.gapLabel ?? "可替换缺失视觉槽位";
  const visualForm = replaceableSlot?.visualForm ?? (replaceableGap.gapType === "dynamic_3d_ribbon_asset" ? "ribbon_motif" : "rotating_object");
  const acceptedAssetTypes = replaceableSlot?.acceptedAssetTypes ?? replaceableGap.acceptedAssetTypes ?? ["image", "video", "gif"];
  const { proxyTimeline, replacementTimeline, replacementGeneration } = slotReplacementFixtureTimelines({
    slotId,
    placeholderSpec,
    semanticLabel,
    visualForm,
    acceptedAssetTypes
  });
  await ensureFixtureReplacementAsset();
  await writeFile(slotReplacementProxyTimelinePath, `${JSON.stringify(scrubObject(proxyTimeline), null, 2)}\n`, "utf8");
  await writeFile(slotReplacementUserTimelinePath, `${JSON.stringify(scrubObject(replacementTimeline), null, 2)}\n`, "utf8");
  await writeFile(slotReplacementUserGenerationPath, `${JSON.stringify(scrubObject(replacementGeneration), null, 2)}\n`, "utf8");
  const proxyRender = await renderSlotReplacementFixture(proxyTimeline, slotReplacementProxyVideoPath, "interactive_gap_fill_proxy");
  const replacementRender = await renderSlotReplacementFixture(replacementTimeline, slotReplacementUserVideoPath, "interactive_gap_fill_user_replacement");
  const rendered = proxyRender.rendered === true && replacementRender.rendered === true;
  const evaluatorGates = slotReplacementEvaluatorGates(replacementGeneration, { proxyTimeline });

  return scrubObject({
    generatedAt: new Date().toISOString(),
    demoType: "interactive_gap_fill",
    disclosure: rendered
      ? "Rendered fixture pair generated through the existing Remotion path. It demonstrates proxy_placeholder -> user_asset_replace without copying sample frames/audio/branding."
      : "Replacement fixture metadata was generated, but MP4 rendering did not complete. Run npm run build and demo generation in an environment where Remotion can launch Chromium.",
    rendered,
    renderStatus: {
      proxy: { rendered: proxyRender.rendered, error: proxyRender.error ?? null },
      replacement: { rendered: replacementRender.rendered, error: replacementRender.error ?? null }
    },
    slot: {
      slotId,
      semanticLabel,
      visualForm,
      acceptedAssetTypes,
      placeholderSpec,
      motionSpec: replaceableSlot?.motionSpec ?? placeholderSpec.motion,
      clickToReplace: true
    },
    before: {
      status: "proxy_generated",
      fillStrategy: "proxy_placeholder",
      originalFillStrategy: fill.strategy ?? "n/a",
      artifact: proxyRender.rendered ? hrefFromDemo(slotReplacementProxyVideoPath) : null,
      timelineJson: hrefFromDemo(slotReplacementProxyTimelinePath),
      rendered: proxyRender.rendered,
      label: "已渲染代理占位，在用户上传前保持结构完整。"
    },
    after: {
      status: "user_replaced",
      fillStrategy: "user_asset_replace",
      boundAssetId: "fixture_uploaded_replacement_asset",
      artifact: replacementRender.rendered ? hrefFromDemo(slotReplacementUserVideoPath) : null,
      timelineJson: hrefFromDemo(slotReplacementUserTimelinePath),
      generationJson: hrefFromDemo(slotReplacementUserGenerationPath),
      rendered: replacementRender.rendered,
      label: "已渲染托管替换素材绑定到同一槽位，并保留运动。"
    },
    diff: [
      { field: "fillStrategy", before: "proxy_placeholder", after: "user_asset_replace" },
      { field: "status", before: "proxy_generated", after: "user_replaced" },
      { field: "assetId", before: "proxy_placeholder", after: "fixture_uploaded_replacement_asset" },
      { field: "motion", before: "保留槽位运动", after: "保留槽位运动" }
    ],
    evaluatorGates,
    fixtureAsset: hrefFromDemo(slotReplacementAssetPath),
    artifactDiscrepancyNote:
      "五个旗舰营销 generation.*.json 文件可能早于该已渲染夹具。当前 proxy_placeholder/user_asset_replace 证据存放在 interactive_gap_fill 时间线与生成 artifact 中。"
  });
}

await mkdir(marketingArtifactDir, { recursive: true });
const slotReplacementDemo = await buildSlotReplacementDemo();
await writeFile(slotReplacementDemoPath, `${JSON.stringify(slotReplacementDemo, null, 2)}\n`, "utf8");
registerArtifact({
  title: "slot-replacement-demo.json",
  type: "json",
  filePath: slotReplacementDemoPath,
  description: "交互式缺口补全前后对比 artifact。"
});
registerArtifact({
  title: "interactive_gap_fill_proxy.mp4",
  type: "video",
  filePath: slotReplacementProxyVideoPath,
  description: "已渲染代理占位夹具。"
});
registerArtifact({
  title: "interactive_gap_fill_user_replacement.mp4",
  type: "video",
  filePath: slotReplacementUserVideoPath,
  description: "已渲染托管替换素材夹具。"
});
registerArtifact({
  title: "generation.interactive_gap_fill_user_replacement.json",
  type: "json",
  filePath: slotReplacementUserGenerationPath,
  description: "已渲染替换夹具的生成 JSON。"
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
  <title>NL 编辑后预览</title>
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
    <h1>NL 编辑后预览</h1>
    <p>通过现有自然语言编辑解析器和生成规划器生成。这是轻量静态预览，不是新渲染的 MP4。</p>
    <div class="grid">
      ${clips.map((clip, index) => `<article>
        <div class="frame">
          <span>${esc(roleLabel(clip.role ?? `clip ${index + 1}`))}</span>
          <strong>${esc(clip.subtitleText ?? clip.visualIntent ?? `片段 ${index + 1}`)}</strong>
        </div>
        <small>${formatSec(clip.startSec)}-${formatSec(Number(clip.startSec ?? 0) + Number(clip.durationSec ?? 0))} · ${esc(strategyLabel(clip.gapFillStrategy ?? "none"))}</small>
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
    operations: [{ type: "change_style_preset", reason: "共享包不可用时使用兜底计划。" }],
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
    disclosure: "该 artifact 通过现有自然语言编辑解析器和请求重生成路径生成。它不是对既有变体的简单改名，也不是本轮新渲染的 MP4。"
  });
}

const nlEditDemo = await buildNlEditDemo();
await writeFile(nlEditDemoPath, `${JSON.stringify(nlEditDemo, null, 2)}\n`, "utf8");
registerArtifact({
  title: "nl-edit-demo.json",
  type: "json",
  filePath: nlEditDemoPath,
  description: "通过编辑解析器与规划器生成的自然语言编辑 artifact。"
});
if (existsSync(nlEditGenerationPath)) {
  registerArtifact({ title: "generation.nl_edit_white_poster.json", type: "json", filePath: nlEditGenerationPath, description: "白底高质感自然语言编辑的重生成结果。" });
}
if (existsSync(nlEditTimelinePath)) {
  registerArtifact({ title: "timeline.nl_edit_white_poster.json", type: "json", filePath: nlEditTimelinePath, description: "白底高质感自然语言编辑的重生成时间线。" });
}
if (existsSync(nlEditPreviewPath)) {
  registerArtifact({ title: "nl-edit-after-preview.html", type: "html", filePath: nlEditPreviewPath, description: "自然语言编辑后状态的轻量静态预览。" });
}

function stageStatus(condition, okLabel = "PASS", missingLabel = "MISSING") {
  return condition ? okLabel : missingLabel;
}

const pipelineStages = [
  {
    name: "上传样例",
    status: stageStatus(sampleMetadata.durationSec, "PASS"),
    evidence: sampleMetadata.durationSec
      ? `${sampleName} · ${formatSec(sampleMetadata.durationSec)} · ${formatNumber(sampleMetadata.width, 0)}x${formatNumber(sampleMetadata.height, 0)}`
      : "缺少样例分析 artifact。"
  },
  {
    name: "分析结构",
    status: stageStatus(templateArtifact.exists, "PASS"),
    evidence: `主视觉动机：${firstDefined(ribbon.pathFamily, analysis?.primaryMotif?.motif, "unknown")} / ${firstDefined(ribbon.axis, "unknown")}`
  },
  {
    name: "映射槽位",
    status: slotMapping.length ? "PASS" : "MISSING",
    evidence: `${slotMapping.length} 个槽位映射 · ${slotMapping.filter((item) => item.status === "matched").length} 个已映射`
  },
  {
    name: "补全缺口",
    status: gapReport.length && fillPlan.length ? (fillPlan.some((fill) => fill.strategy === "procedural_generation") ? "PROCEDURAL" : "FILLED") : gapReport.length ? "WARNING" : "PASS",
    evidence: primaryFill
      ? `${primaryGap?.gapType ?? primaryGap?.slotId} 由 ${strategyLabel(primaryFill.strategy)} -> ${primaryFill.rendererInstructions?.renderer ?? "renderer"} -> ${primaryFill.rendererInstructions?.atom ?? "output"} 补全`
      : "没有未解决的必需缺口。"
  },
  {
    name: "生成多版本",
    status: videosFound ? "GENERATED" : "MISSING",
    evidence: `${videosFound}/${resolvedVariants.length} 个 MP4 版本可用。推荐：${bestVariant?.display ?? "n/a"}`
  },
  {
    name: "评估",
    status: evaluatorAvailable ? (localGatePassed ? "PASS" : "WARNING") : "MISSING",
    evidence: `${evaluatorAvailable ? "本地评估可用" : "缺少本地评估"} · ${vlmAvailable ? `VLM overall ${formatPercentScore(bestVlmScores?.overall)}` : "VLM 未运行"}`
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
      ${badge(statusBadge(stage.status), statusTone(stage.status))}
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
        { label: "钩子", start: 0, end: duration * 0.2, detail: "即时标题层级。", tone: "sample" },
        { label: "彩带进入", start: duration * 0.2, end: duration * 0.45, detail: "视觉注意力进入。", tone: "sample" },
        { label: "关键词记忆", start: duration * 0.45, end: duration * 0.7, detail: "关键词重复。", tone: "sample" },
        { label: "色彩高潮", start: duration * 0.7, end: duration * 0.85, detail: "色彩递进。", tone: "sample" },
        { label: "CTA 停留", start: duration * 0.85, end: duration, detail: "干净的结尾停留。", tone: "sample" }
      ];
  const excluded = excludeSegments.map((segment) => ({
    label: "排除尾段",
    start: segment.startSec ?? duration * 0.85,
    end: segment.endSec ?? duration,
    detail: segment.reason ?? "平台 UI 尾段已从迁移结构中排除。",
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
      label: `主视觉缺口：${gap.gapLabelZh ?? gap.gapLabel ?? gap.gapType ?? gap.slotId}`,
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
  const source = items.length ? items : [{ label: "目标槽位", detail: "尚未生成", status: "missing", fill: "n/a" }];
  return source.map((item) => `<div class="rail-segment rail-${esc(statusTone(item.status))}" style="width:${cssWidth(100 / source.length)}" title="${esc(item.detail)}">
    <strong>${esc(item.label)}</strong>
    <span>${esc(statusLabel(item.status))} · ${esc(strategyLabel(item.fill ?? "n/a"))}</span>
  </div>`).join("");
}

function generatedTrack() {
  const clips = Array.isArray(primaryTimeline?.clips) ? primaryTimeline.clips : [];
  const duration = firstNumber(primaryTimeline?.durationSec, bestVariant?.metadata?.durationSec, 16) ?? 16;
  const source = clips.length
    ? clips
    : [
        { role: "hook", startSec: 0, durationSec: 2.2, subtitleText: "片段 1" },
        { role: "body", startSec: 2.2, durationSec: 4, subtitleText: "片段 2" },
        { role: "proof", startSec: 6.2, durationSec: 4, subtitleText: "片段 3" },
        { role: "cta", startSec: 10.2, durationSec: 5.8, subtitleText: "片段 4" }
      ];
  return source.map((clip, index) => {
    const start = Number(clip.startSec ?? clip.start ?? 0);
    const clipDuration = Number(clip.durationSec ?? Math.max(0.1, Number(clip.endSec ?? duration) - start));
    const width = (clipDuration / duration) * 100;
    return `<div class="rail-segment rail-output" style="width:${cssWidth(width)}" title="${esc(clip.visualIntent ?? clip.scriptText ?? "")}">
      <strong>片段 ${index + 1} · ${esc(roleLabel(clip.role ?? clip.type ?? "generated"))}</strong>
      <span>${formatSec(start)}-${formatSec(start + clipDuration)} · ${esc(strategyLabel(clip.gapFillStrategy ?? clip.fillStrategy ?? "rendered"))}</span>
    </div>`;
  }).join("");
}

function targetAssetShelf() {
  if (!targetAssets.length) {
    return missingCard("目标素材", "生成请求中没有记录目标素材。");
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
    return missingCard("槽位映射", "没有找到槽位映射 artifact。");
  }
  return `<div class="mapping-board">${slotMapping.map((mapping) => {
    const state = mapping.status === "matched" ? "mapped" : mapping.status ?? "missing";
    return `<article class="mapping-row mapping-${esc(state)}">
      <div>
        <span>模板槽位</span>
        <strong>${esc(mapping.slotType ?? mapping.slotId)}</strong>
        <p>${esc(roleLabel(mapping.slotRole ?? "slot"))}</p>
      </div>
      <div class="mapping-arrow">-&gt;</div>
      <div>
        <span>目标 / 补全</span>
        <strong>${esc(mapping.selectedTargetAssetId ?? mapping.selectedAssetId ?? mapping.selectedShotId ?? "missing")}</strong>
        <p>${esc(statusLabel(mapping.assetAvailability ?? mapping.reason ?? "n/a"))}</p>
      </div>
      ${badge(statusBadge(state === "matched" ? "MAPPED" : state.toUpperCase()), statusTone(state))}
    </article>`;
  }).join("")}</div>`;
}

function gapCardGrid() {
  if (!gapReport.length) {
    return `<div class="gap-grid">${missingCard("素材缺口", "本次运行未检测到缺口。")}</div>`;
  }
  return `<div class="gap-grid">${gapReport.map((gap) => {
    const fill = fillActionForGap(gap);
    const instructions = fill.rendererInstructions ?? {};
    return `<article class="gap-card">
      <div class="card-topline">${badge(statusLabel(gap.severity ?? "gap"), statusTone(gap.severity === "high" ? "missing" : "warning"))}${badge(statusLabel(gap.status ?? "missing"), "danger")}</div>
      <h3>${esc(gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId)}</h3>
      <p>${esc(gap.reason ?? gap.impact ?? "素材槽位需要补全。")}</p>
      <dl class="compact-dl">
        <div><dt>推荐策略</dt><dd>${esc((gap.recommendedFillStrategies ?? []).map(strategyLabel).join(", ") || "n/a")}</dd></div>
        <div><dt>选中策略</dt><dd>${esc(strategyLabel(fill.strategy ?? gap.fillSource ?? "n/a"))}</dd></div>
        <div><dt>后端</dt><dd>${esc(strategyLabel(instructions.renderer ?? gap.fulfilledByBackend ?? "n/a"))}</dd></div>
        <div><dt>原子</dt><dd>${esc(instructions.atom ?? instructions.layout ?? "n/a")}</dd></div>
        <div><dt>完成方式</dt><dd>${esc(strategyLabel(instructions.fulfilledBy ?? gap.fillSource ?? "n/a"))}</dd></div>
      </dl>
      <p class="evidence">${esc(fill.reason ?? gap.impact ?? "已进入输出时间线。")}</p>
    </article>`;
  }).join("")}</div>`;
}

function fillPlanFlow() {
  if (!fillPlan.length) {
    return missingCard("补全流程", "本次不需要补全动作。");
  }
  return `<div class="flow-list">${fillPlan.map((fill) => {
    const gap =
      gapReport.find((item) => item.slotId === fill.slotId) ??
      gapReport.find((item) => item.gapType && fill.rendererInstructions?.missingMotif === item.gapType) ??
      {};
    const instructions = fill.rendererInstructions ?? {};
    const nodes = [
      gap.gapLabelZh ?? gap.gapLabel ?? fill.slotId,
      strategyLabel(fill.strategy),
      strategyLabel(instructions.renderer),
      instructions.atom ?? instructions.layout,
      "渲染输出"
    ].filter(Boolean);
    return `<article class="flow-card">${nodes.map((node, index) => `<span>${esc(node)}</span>${index < nodes.length - 1 ? "<b>-&gt;</b>" : ""}`).join("")}</article>`;
  }).join("")}</div>`;
}

function structureSegmentList() {
  if (!structureSegments.length) {
    return missingCard("结构段落", "没有找到段落列表。");
  }
  return `<ol class="segment-list">${structureSegments.map((segment) => `<li>
    <strong>${esc(roleLabel(segment.role ?? segment.id))}</strong>
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
    <h3>主视觉几何</h3>
    <dl class="compact-dl">${fields.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(formatNumber(value, 3) === "n/a" ? value ?? "n/a" : formatNumber(value, 3))}</dd></div>`).join("")}</dl>
  </article>`;
}

function excludedSegmentCard() {
  if (!excludeSegments.length) {
    return missingCard("排除片段", "没有记录排除片段。");
  }
  return `<article class="info-card excluded-card">
    <h3>排除平台尾段</h3>
    ${excludeSegments.map((segment) => `<p><strong>${formatSec(segment.startSec)}-${formatSec(segment.endSec)}</strong> · ${esc(segment.reason ?? "已从可迁移结构中排除。")}</p>`).join("")}
  </article>`;
}

function videoPanel(variant) {
  if (!variant?.exists) {
    return `<div class="tab-panel" data-tab-panel="${esc(variant?.key ?? "missing")}">${missingCard(variant?.display ?? "视频", "缺少视频 artifact")}</div>`;
  }
  const vlmLine = variant.vlmScores
    ? `${badge("VLM", "accent")} <strong>${formatPercentScore(variant.vlmScores.overall)}</strong> overall · 结构 ${formatPercentScore(variant.vlmScores.structure)} · 风格 ${formatPercentScore(variant.vlmScores.style)}`
    : `${badge("VLM 未运行", "neutral")}`;
  return `<div class="tab-panel" data-tab-panel="${esc(variant.key)}">
    <article class="video-card">
      <video controls preload="metadata" src="${esc(variant.href)}"></video>
      <div class="video-copy">
        <h3>${esc(variant.display)}</h3>
        <p>${esc(variant.description)}</p>
        <div class="score-row">
          ${scoreBlock("本地评估", statusBadge(variant.localPassed ? "PASS" : variant.evaluationExists ? "CHECK" : "n/a"), variant.localPassed ? "success" : "warning")}
          ${scoreBlock("风格分", formatPercentScore(variant.style), "neutral")}
          ${scoreBlock("VLM 分数", formatPercentScore(variant.vlmScores?.overall), variant.vlmScores ? "accent" : "neutral")}
        </div>
        <p class="score-detail">${vlmLine}</p>
        <details>
          <summary>元数据与哈希</summary>
          <dl class="compact-dl">
            <div><dt>时长</dt><dd>${formatSec(variant.metadata?.durationSec)}</dd></div>
            <div><dt>分辨率</dt><dd>${esc(`${variant.metadata?.width ?? "n/a"}x${variant.metadata?.height ?? "n/a"}`)}</dd></div>
            <div><dt>FPS</dt><dd>${esc(variant.metadata?.fps ?? "n/a")}</dd></div>
            <div><dt>MD5</dt><dd><code>${esc(variant.hashes?.md5 ?? "n/a")}</code></dd></div>
          </dl>
          <a href="${esc(variant.href)}">打开 MP4 artifact</a>
        </details>
      </div>
    </article>
    <div class="mini-frames">${variant.frameFiles.map((fileName) => imageCard(fileName, `${variant.display} frame`)).join("")}</div>
  </div>`;
}

function contactSheetPanel() {
  const filePath = path.join(marketingArtifactDir, "contact_sheet.png");
  if (!existsSync(filePath)) {
    return `<div class="tab-panel" data-tab-panel="contact_sheet">${missingCard("联系表", "缺少 contact_sheet.png")}</div>`;
  }
  return `<div class="tab-panel" data-tab-panel="contact_sheet">
    <article class="video-card">
      <img class="contact-sheet" src="${esc(hrefFromDemo(filePath))}" alt="Input and output contact sheet" loading="lazy" />
      <div class="video-copy">
        <h3>联系表</h3>
        <p>用一张图快速对比输入样例帧与生成输出帧，便于视觉复核。</p>
        <a href="${esc(hrefFromDemo(filePath))}">打开联系表</a>
      </div>
    </article>
  </div>`;
}

function outputTabs() {
  const panels = [...resolvedVariants.map(videoPanel), contactSheetPanel()].join("");
  const buttons = [
    ...resolvedVariants.map((variant) => ({ key: variant.key, label: variant.display })),
    { key: "contact_sheet", label: "联系表" }
  ];
  const activeKey = highFidelity?.exists ? "high_fidelity" : bestVariant?.key ?? "final_creative";
  return `<div class="tabs" data-tab-group="outputs">
    <div class="tab-buttons">${buttons.map((button) => `<button type="button" class="${button.key === activeKey ? "active" : ""}" data-tab-target="${esc(button.key)}">${esc(button.label)}</button>`).join("")}</div>
    <div class="tab-panels">${panels}</div>
  </div>`;
}

function creativeToggle() {
  return `<div class="mode-toggle" data-tab-group="mode">
    <p class="callout">最终创意隐藏过程覆盖层；可解释演示展示结构迁移是如何发生的。</p>
    <div class="tab-buttons compact">
      <button type="button" class="active" data-tab-target="creative_view">创意视图</button>
      <button type="button" data-tab-target="explainability_view">解释视图</button>
    </div>
    <div class="tab-panel active" data-tab-panel="creative_view">
      ${highFidelity?.exists ? `<video controls preload="metadata" src="${esc(highFidelity.href)}"></video>` : missingCard("创意视图", "缺少高保真视频")}
      <p>用于判断最终效果的干净输出，推荐观看路径为 ${esc(bestVariant?.display ?? "最佳版本")}。</p>
    </div>
    <div class="tab-panel" data-tab-panel="explainability_view">
      ${explainableDemo?.exists ? `<video controls preload="metadata" src="${esc(explainableDemo.href)}"></video>` : missingCard("解释视图", "缺少可解释演示视频")}
      <p>带阶段标签、映射意图和缺口补全上下文的走查输出。</p>
    </div>
  </div>`;
}

function evaluatorScoreboard() {
  const gates = localGateList(bestEvaluation);
  return `<section class="scoreboard" id="evaluation-scoreboard" data-section="evaluation-scoreboard">
    <div class="section-heading">
      <span>评估看板</span>
      <h2>质量与可信证据</h2>
      <p>本地 gates 与 VLM-as-judge 分数展示在视频附近；原始报告仍放在折叠证据链接中。</p>
    </div>
    <div class="scoreboard-grid">
      <article class="panel-card">
        <h3>本地评估器 · ${esc(bestVariant?.display ?? "最佳版本")}</h3>
        <div class="score-row">
          ${scoreBlock("状态", statusBadge(localGatePassed ? "PASS" : evaluatorAvailable ? "CHECK" : "n/a"), localGatePassed ? "success" : "warning")}
          ${scoreBlock("风格保真", formatPercentScore(localStyleScore(bestEvaluation)), "neutral")}
          ${scoreBlock("失败 gates", String(failedGates.length), failedGates.length ? "danger" : "success")}
        </div>
        <div class="gate-grid">${gates.length ? gates.map((gate) => `<span class="gate ${gate.passed === false ? "fail" : "pass"}">${esc(gate.id ?? gate.name ?? "gate")}</span>`).join("") : "<span class=\"gate\">未生成评估 gates</span>"}</div>
      </article>
      <article class="panel-card">
        <h3>VLM 评审</h3>
        ${vlmAvailable ? `<div class="score-row">
          ${scoreBlock("VLM 分数", formatPercentScore(bestVlmScores?.overall), "accent")}
          ${scoreBlock("结构迁移", formatPercentScore(bestVlmScores?.structure), "neutral")}
          ${scoreBlock("风格保真", formatPercentScore(bestVlmScores?.style), "neutral")}
          ${scoreBlock("无直接复制", formatPercentScore(bestVlmScores?.noDirectCopy), "success")}
          ${scoreBlock("视觉质量", formatPercentScore(bestVlmScores?.visualQuality), "neutral")}
        </div>
        <p>${esc(bestVlmScores?.rationale ?? "VLM 没有提供 rationale。")}</p>
        <p class="evidence">外部服务说明：VLM 评审是来自已配置 judge adapter 的可选评估证据；它不作为渲染器使用，本页面不会暴露 API key。</p>` : `<p>该 artifact 集未运行 VLM。</p><p class="evidence">外部服务说明：VLM 评审是可选评估证据；未运行时记录为 skipped_infra/not_run，不计作通过或失败。</p>`}
      </article>
      <article class="panel-card trust-card">
        <h3>可信策略</h3>
        ${badge("默认不复制样例画面", "success")}
        ${badge("默认不复制样例音频", "success")}
        ${badge("不复制样例品牌元素", "success")}
        ${badge("迁移：结构、节奏、版式语法、动机几何", "accent")}
      </article>
    </div>
  </section>`;
}

function beforeAfterDiff() {
  const rows = Array.isArray(nlEditDemo.diff) ? nlEditDemo.diff : [];
  const operations = Array.isArray(nlEditDemo.parsedOperations) ? nlEditDemo.parsedOperations : [];
  return `<section class="before-after" id="nl-before-after" data-section="nl-before-after">
    <div class="section-heading">
      <span>自然语言编辑前后对比</span>
      <h2>人机协同可控性</h2>
      <p>通过现有解析器和请求重生成路径生成。这是真实编辑 artifact 与轻量时间线预览，不是对既有变体的简单改名。</p>
    </div>
    <div class="edit-instruction">指令：<strong>${esc(nlEditDemo.instruction ?? "换成白底高质感风格")}</strong> ${badge(nlEditDemo.mode ?? "nl_edit", "accent")}</div>
    <div class="compare-grid">
      <article class="panel-card">
        <h3>修改前 · ${esc(finalCreative?.display ?? "最终创意")}</h3>
        ${finalCreative?.exists ? `<video controls preload="metadata" src="${esc(finalCreative.href)}"></video>` : missingCard("修改前视频", "缺少最终创意视频")}
      </article>
      <article class="panel-card">
        <h3>修改后 · NL 编辑时间线预览</h3>
        ${nlEditDemo.after?.previewHtml ? `<iframe class="edit-preview-frame" src="${esc(nlEditDemo.after.previewHtml)}" title="NL 编辑后预览"></iframe>` : missingCard("修改后预览", "未生成 NL 编辑预览")}
        <p>修改后生成：<code>${esc(nlEditDemo.after?.generationId ?? "n/a")}</code></p>
        <p>${nlEditDemo.after?.generationJson ? `<a href="${esc(nlEditDemo.after.generationJson)}">打开编辑后生成 JSON</a>` : "缺少编辑后生成 JSON。"}</p>
      </article>
      <article class="panel-card diff-card">
        <h3>结构化编辑差异</h3>
        <table>
          <thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead>
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
  const gateEntries = Array.isArray(slotReplacementDemo.evaluatorGates) ? slotReplacementDemo.evaluatorGates : [];
  const renderBadge = slotReplacementDemo.rendered ? badge("已渲染夹具", "success") : badge("等待渲染", "warning");
  return `<section class="interactive-gap-fill" id="interactive-gap-fill" data-section="interactive-gap-fill">
    <div class="section-heading">
      <span>交互式缺口补全</span>
      <h2>素材槽位替换器：代理占位 -> 用户素材替换</h2>
      <p>系统先用可见代理占位保持已学习结构完整，再把托管上传素材绑定到同一槽位，并保留原时序、布局和运动。</p>
    </div>
    <div class="replacement-demo-grid">
      <article class="panel-card">
        ${slotReplacementDemo.before?.artifact ? `<video controls preload="metadata" src="${esc(slotReplacementDemo.before.artifact)}"></video>` : missingCard("代理占位夹具", "缺少已渲染代理 MP4")}
        <h3>替换前 · 代理已生成</h3>
        <p>${esc(slotReplacementDemo.before?.label ?? "代理占位保持结构完整。")}</p>
        ${badge("代理占位 · PROXY GENERATED", "warning")}
        ${badge("PROXY MP4", "neutral")}
        ${badge("点击替换", "accent")}
      </article>
      <article class="panel-card">
        <h3>槽位检查器</h3>
        <dl class="compact-dl">
          <div><dt>槽位</dt><dd>${esc(slot.semanticLabel ?? slot.slotId ?? "替换槽位")}</dd></div>
          <div><dt>视觉形态</dt><dd>${esc(slot.visualForm ?? "rotating_object")}</dd></div>
          <div><dt>可上传类型</dt><dd>${esc((slot.acceptedAssetTypes ?? []).join(", ") || "image, video")}</dd></div>
          <div><dt>运动</dt><dd>${esc(`${slot.motionSpec?.type ?? slot.placeholderSpec?.motion?.type ?? "spin"} · ${slot.motionSpec?.axis ?? slot.placeholderSpec?.motion?.axis ?? "preserved"}`)}</dd></div>
          <div><dt>占位</dt><dd>${esc(slot.placeholderSpec?.label ?? "可替换代理占位")}</dd></div>
        </dl>
        <p class="evidence">替换素材是项目托管上传。该演示不会复制样例画面、样例音频或样例品牌。</p>
      </article>
      <article class="panel-card">
        <h3>替换后 · 用户素材已绑定</h3>
        ${slotReplacementDemo.after?.artifact ? `<video controls preload="metadata" src="${esc(slotReplacementDemo.after.artifact)}"></video>` : missingCard("替换后视频", "缺少已渲染替换 MP4")}
        <p>${esc(slotReplacementDemo.after?.label ?? "绑定上传素材并保留槽位运动。")}</p>
        ${badge("用户已替换 · USER REPLACED", "success")}
        ${badge("USER ASSET MP4", "neutral")}
        ${badge("全量重渲染 MVP", "neutral")}
      </article>
      <article class="panel-card diff-card">
        <h3>替换差异</h3>
        <table>
          <thead><tr><th>字段</th><th>替换前</th><th>替换后</th></tr></thead>
          <tbody>${diffRows.map((row) => `<tr><td>${esc(row.field)}</td><td>${esc(row.before)}</td><td>${esc(row.after)}</td></tr>`).join("")}</tbody>
        </table>
        <div class="gate-grid">${gateEntries.map((gate) => `<span class="gate ${gate.passed ? "pass" : "fail"}" title="${esc(gate.comment ?? "")}">${esc(gate.id)}: ${esc(gate.value)}</span>`).join("")}</div>
        <p class="evidence">${renderBadge} ${esc(slotReplacementDemo.disclosure ?? "Rendered replacement evidence.")}</p>
      </article>
    </div>
  </section>`;
}

function artifactGalleryCards() {
  const galleryRecords = [
    registerArtifact({ title: "report.md", type: "markdown", filePath: path.join(marketingArtifactDir, "report.md"), description: "营销案例报告。" }),
    registerArtifact({ title: "marketing_case/index.html", type: "html", filePath: path.join(marketingArtifactDir, "index.html"), description: "原营销案例页面。" }),
    registerArtifact({ title: "product_demo/index.html", type: "html", filePath: htmlPath, description: "生成的产品演示页。", linkWhenMissing: true }),
    registerArtifact({ title: "product_demo/ui-manifest.json", type: "json", filePath: manifestPath, description: "UI 消费 artifact 清单。" }),
    registerArtifact({ title: "contact_sheet.png", type: "image", filePath: path.join(marketingArtifactDir, "contact_sheet.png"), description: "输入/输出视觉对比联系表。" }),
    registerArtifact({ title: "evaluation.main.json", type: "json", filePath: path.join(marketingArtifactDir, "evaluation.main.json"), description: "最终创意本地评估。" }),
    registerArtifact({ title: "evaluation.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "evaluation.high_fidelity.json"), description: "高保真本地评估。" }),
    registerArtifact({ title: "vlm-judge.main.json", type: "json", filePath: path.join(marketingArtifactDir, "vlm-judge.main.json"), description: "最终创意 VLM 评审。" }),
    registerArtifact({ title: "vlm-judge.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "vlm-judge.high_fidelity.json"), description: "高保真 VLM 评审。" }),
    registerArtifact({ title: "variant-summary.json", type: "json", filePath: path.join(marketingArtifactDir, "variant-summary.json"), description: "多版本元数据与哈希。" }),
    registerArtifact({ title: "slot-replacement-demo.json", type: "json", filePath: slotReplacementDemoPath, description: "交互式缺口补全前后对比 artifact。" }),
    registerArtifact({ title: "interactive_gap_fill_proxy.mp4", type: "video", filePath: slotReplacementProxyVideoPath, description: "已渲染代理占位夹具。" }),
    registerArtifact({ title: "interactive_gap_fill_user_replacement.mp4", type: "video", filePath: slotReplacementUserVideoPath, description: "已渲染托管用户替换素材夹具。" }),
    registerArtifact({ title: "generation.interactive_gap_fill_user_replacement.json", type: "json", filePath: slotReplacementUserGenerationPath, description: "已渲染替换夹具的生成 JSON。" }),
    registerArtifact({ title: "editing_case/index.html", type: "html", filePath: path.join(editingCaseDir, "index.html"), description: "editing.mov 参考/目标素材分离案例，包含可见代理输出。" }),
    registerArtifact({ title: "editing_case/render.mp4", type: "video", filePath: path.join(editingCaseDir, "render.mp4"), description: "剪辑案例代理占位渲染输出。" }),
    registerArtifact({ title: "editing_case/contact_sheet.png", type: "image", filePath: path.join(editingCaseDir, "contact_sheet.png"), description: "剪辑案例代理联系表。" }),
    registerArtifact({ title: "editing_case/replacement-slots.json", type: "json", filePath: path.join(editingCaseDir, "replacement-slots.json"), description: "剪辑案例交互式缺口补全槽位。" }),
    registerArtifact({ title: "motion_graph_case/index.html", type: "html", filePath: path.join(motionGraphCaseDir, "index.html"), description: "开放世界槽位归纳案例，展示动态图形样例的通用槽位 family。" }),
    registerArtifact({ title: "motion_graph_case/render.mp4", type: "video", filePath: path.join(motionGraphCaseDir, "render.mp4"), description: "动态图形案例 family-specific proxy 渲染输出。" }),
    registerArtifact({ title: "motion_graph_case/contact_sheet.png", type: "image", filePath: path.join(motionGraphCaseDir, "contact_sheet.png"), description: "动态图形案例联系表。" }),
    registerArtifact({ title: "motion_graph_case/induced-slots.json", type: "json", filePath: path.join(motionGraphCaseDir, "induced-slots.json"), description: "开放世界归纳槽位清单。" }),
    registerArtifact({ title: "timeline.json", type: "json", filePath: path.join(marketingArtifactDir, "timeline.json"), description: "默认时间线 JSON。" }),
    registerArtifact({ title: "timeline.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "timeline.high_fidelity.json"), description: "高保真时间线 JSON。" }),
    registerArtifact({ title: "generation.main.json", type: "json", filePath: path.join(marketingArtifactDir, "generation.main.json"), description: "最终创意生成 JSON。" }),
    registerArtifact({ title: "generation.high_fidelity.json", type: "json", filePath: path.join(marketingArtifactDir, "generation.high_fidelity.json"), description: "高保真生成 JSON。" }),
    registerArtifact({ title: "corpus-regression-report.md", type: "markdown", filePath: path.join(corpusRegressionDir, "corpus-regression-report.md"), description: "语料回归可读报告。" }),
    registerArtifact({ title: "corpus-regression-report.json", type: "json", filePath: path.join(corpusRegressionDir, "corpus-regression-report.json"), description: "语料回归机器可读报告。" }),
    registerArtifact({ title: "implementation_review.md", type: "markdown", filePath: path.join(artifactRoot, "review", "implementation_review.md"), description: "实现评审报告。" })
  ];
  return `<section class="artifact-gallery" id="artifact-gallery" data-section="artifact-gallery">
    <div class="section-heading">
      <span>工程证据</span>
      <h2>不打断主线的工程证据</h2>
      <p>每张卡片都会先检查文件是否存在；缺失文件只标记“缺失”，不生成死链接。</p>
    </div>
    <div class="gallery-grid">${galleryRecords.map((record) => `<article class="artifact-card artifact-${esc(record.status)}">
      <span>${esc(record.type)}</span>
      <h3>${esc(record.title)}</h3>
      <p>${esc(record.description)}</p>
      ${badge(record.status === "exists" ? "存在" : "缺失", record.status === "exists" ? "success" : "danger")}
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
        vlmJudge: variant.vlmAvailable,
        vlmStatus: variant.vlmStatus,
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
        available: variant.vlmAvailable,
        status: variant.vlmStatus,
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
    rendered: slotReplacementDemo.rendered === true,
    slotId: slotReplacementDemo.slot?.slotId ?? null,
    beforeStrategy: slotReplacementDemo.before?.fillStrategy ?? null,
    beforeArtifact: slotReplacementDemo.before?.artifact ?? null,
    afterStrategy: slotReplacementDemo.after?.fillStrategy ?? null,
    afterArtifact: slotReplacementDemo.after?.artifact ?? null,
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
  editingCase: {
    available: editingCaseArtifact.exists,
    index: hrefFromDemo(path.join(editingCaseDir, "index.html")),
    render: hrefFromDemo(path.join(editingCaseDir, "render.mp4")),
    contactSheet: hrefFromDemo(path.join(editingCaseDir, "contact_sheet.png")),
    replacementSlots: Array.isArray(editingCase.replacementSlots) ? editingCase.replacementSlots.map((slot) => slot.slotId) : [],
    evaluatorGates: editingCase.editingCaseGates ?? []
  },
  motionGraphCase: {
    available: motionGraphCaseArtifact.exists,
    index: hrefFromDemo(path.join(motionGraphCaseDir, "index.html")),
    render: hrefFromDemo(path.join(motionGraphCaseDir, "render.mp4")),
    contactSheet: hrefFromDemo(path.join(motionGraphCaseDir, "contact_sheet.png")),
    inducedSlots: Array.isArray(motionGraphCase.inducedSlots) ? motionGraphCase.inducedSlots.map((slot) => ({ id: slot.id, family: slot.visualFormFamily, status: slot.status })) : [],
    selectedTemplateReason: motionGraphCase.selectedTemplateReason ?? null,
    evaluatorGates: motionGraphCase.motionGraphCaseGates ?? []
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
  <title>爆款结构迁移引擎 · 产品演示</title>
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
      content: "缺失槽位";
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
    <section class="hero" id="executive-summary" data-section="executive-summary">
      <div class="hero-copy">
        <p class="eyebrow">三分钟总览</p>
        <h1>爆款结构迁移引擎</h1>
        <p>样例视频 -> 结构分析 -> 可复用模板/原子 -> 目标素材 -> 槽位映射/缺口报告 -> 补全计划 -> 可渲染时间线 -> 最终视频 + 可解释证据。</p>
        <div class="summary-grid">
          ${metricCard("输入样例", sampleName, `${formatSec(sampleMetadata.durationSec)} · ${formatNumber(sampleMetadata.width, 0)}x${formatNumber(sampleMetadata.height, 0)} · ${formatNumber(sampleMetadata.fps, 0)}fps`, "neutral")}
          ${metricCard("抽取结构", extractedStructureName, `${template?.visualStyle?.layout ?? "极简海报布局"} · ${ribbon.pathFamily ?? "ribbon"} / ${ribbon.axis ?? "axis"}`, "accent")}
          ${metricCard("素材缺口", `${gapReport.length} 个`, `${highSeverityGaps} 个高严重度 · ${primaryGap?.gapLabelZh ?? primaryGap?.gapType ?? "无"}`, highSeverityGaps ? "danger" : "success")}
          ${metricCard("补全策略", strategyLabel(primaryFill?.strategy ?? "n/a"), `${strategyLabel(primaryFill?.rendererInstructions?.renderer ?? primaryGap?.fulfilledByBackend ?? "backend n/a")} · ${primaryFill?.rendererInstructions?.atom ?? "atom n/a"}`, "accent")}
          ${metricCard("输出版本", `${videosFound}/${resolvedVariants.length}`, resolvedVariants.filter((variant) => variant.exists).map((variant) => variant.shortLabel).join(" · ") || "没有 MP4", "success")}
          ${metricCard("本地评估", statusBadge(localGatePassed ? "PASS" : evaluatorAvailable ? "CHECK" : "n/a"), `风格 ${formatPercentScore(bestVariant?.style)} · ${failedGates.length} 个失败 gates`, localGatePassed ? "success" : "warning")}
          ${metricCard("VLM 评审", vlmAvailable ? formatPercentScore(bestVlmScores?.overall) : "未运行", vlmAvailable ? `${bestVariant?.display} · 无复制 ${formatPercentScore(bestVlmScores?.noDirectCopy)}` : "未生成 VLM artifact", vlmAvailable ? "accent" : "neutral")}
          ${metricCard("最佳输出", bestVariant?.display ?? "n/a", bestVariantReason, "success")}
        </div>
        <div class="policy-row">
          ${badge("默认不复制样例画面/音频", "success")}
          ${badge("迁移：结构、节奏、版式语法、动机几何", "accent")}
          ${badge("人类编辑示例：换成白底高质感风格", "neutral")}
        </div>
      </div>
      <div class="hero-video">
        <h2>${esc(bestVariant?.display ?? "生成输出")}</h2>
        ${bestVariant?.exists ? `<video controls preload="metadata" src="${esc(bestVariant.href)}"></video>` : missingCard("最佳输出视频", "没有可用 MP4 版本")}
        <p>${esc(bestVariant?.description ?? "生成输出不可用。")}</p>
        <p><strong>选择依据：</strong> ${esc(bestVariantReason)}</p>
      </div>
    </section>

    <section class="pipeline" id="pipeline-stepper" data-section="pipeline-stepper">
      <div class="section-heading">
        <span>迁移流程</span>
        <h2>输入 -> 分析 -> 映射 -> 补全 -> 渲染 -> 评估</h2>
      </div>
      <div class="stepper">${pipelineStages.map(stageHtml).join("")}</div>
    </section>

    <section class="timeline-rail" id="structure-timeline-rail" data-section="structure-timeline-rail">
      <div class="section-heading">
        <span>结构时间轨道</span>
        <h2>样例结构、目标缺口与生成片段对齐展示</h2>
      </div>
      <div class="rail-track">
        <div class="rail-label"><span>轨道 1：样例结构</span><span>排除尾段单独标记</span></div>
        <div class="rail-row">${sampleStructureTrack()}</div>
      </div>
      <div class="rail-track">
        <div class="rail-label"><span>轨道 2：目标槽位 / 缺口</span><span>映射状态 + 补全来源</span></div>
        <div class="rail-row">${targetGapTrack()}</div>
      </div>
      <div class="rail-track">
        <div class="rail-label"><span>轨道 3：生成片段</span><span>${esc(bestVariant?.display ?? "最佳版本")}</span></div>
        <div class="rail-row">${generatedTrack()}</div>
      </div>
    </section>

    <section class="workbench" id="three-column-workbench" data-section="three-column-workbench">
      <div class="workbench-column">
        <div class="section-heading" data-section="sample-understanding">
          <span>工作台左侧</span>
          <h2>样例理解</h2>
        </div>
        <article class="panel-card">
          <h3>样例帧条</h3>
          <div class="frame-strip">
            ${imageCard("input_hook.png", "钩子帧")}
            ${imageCard("input_climax.png", "彩带 / 高潮帧")}
            ${imageCard("input_excluded_tail.png", "排除尾段帧")}
          </div>
        </article>
        <article class="info-card">
          <h3>视频元数据</h3>
          <dl class="compact-dl">
            <div><dt>类型</dt><dd>${esc(template?.videoType ?? "motion_graphic_marketing_poster")}</dd></div>
            <div><dt>时长</dt><dd>${formatSec(sampleMetadata.durationSec)}</dd></div>
            <div><dt>分辨率</dt><dd>${esc(`${sampleMetadata.width ?? "n/a"}x${sampleMetadata.height ?? "n/a"}`)}</dd></div>
            <div><dt>音频</dt><dd>${esc(sampleMetadata.hasAudio ? "有" : "n/a")}</dd></div>
          </dl>
        </article>
        <article class="info-card">
          <h3>结构段落</h3>
          ${structureSegmentList()}
        </article>
        ${motifGeometryCard()}
        ${excludedSegmentCard()}
      </div>

      <div class="workbench-column">
        <div class="section-heading" data-section="transfer-plan">
          <span>工作台中间</span>
          <h2>迁移计划</h2>
        </div>
        <article class="panel-card">
          <h3>StructureTemplate + KnowledgeAtoms</h3>
          <p><strong>${esc(template?.name ?? "模板尚未生成")}</strong></p>
          <div class="pill-list">${structureAtoms.slice(0, 10).map((atom) => badge(atom.name ?? atom.id, "neutral")).join("")}</div>
        </article>
        <article class="panel-card">
          <h3>目标素材架</h3>
          ${targetAssetShelf()}
        </article>
        <article class="panel-card">
          <h3>槽位映射板</h3>
          ${slotMappingBoard()}
        </article>
        <article class="panel-card">
          <h3>缺口卡片</h3>
          ${gapCardGrid()}
        </article>
        <article class="panel-card">
          <h3>补全流程</h3>
          ${fillPlanFlow()}
        </article>
      </div>

      <div class="workbench-column">
        <div class="section-heading" data-section="generated-outputs">
          <span>工作台右侧</span>
          <h2>生成结果</h2>
        </div>
        ${creativeToggle()}
        <article class="panel-card">
          <h3>视频标签页</h3>
          ${outputTabs()}
        </article>
      </div>
    </section>

    ${evaluatorScoreboard()}
    ${beforeAfterDiff()}
    ${interactiveGapFillSection()}

    <section class="raw-disclosure" id="progressive-disclosure" data-section="progressive-disclosure">
      <div class="section-heading">
        <span>渐进披露</span>
        <h2>原始 JSON 与证据链接</h2>
        <p>主界面保持视觉化；更深入的原始 artifact 放在这里供复核。</p>
      </div>
      <details>
        <summary>查看原始分析 JSON</summary>
        <p>${artifactLink(analysisArtifact.record, "打开 analysis.marketing.json")}</p>
      </details>
      <details>
        <summary>查看时间线 JSON</summary>
        <p>${artifactLink(timelineByArtifactKey.high_fidelity.record, "打开 timeline.high_fidelity.json")} · ${artifactLink(timelineByArtifactKey.main.record, "打开 timeline.json")}</p>
      </details>
      <details>
        <summary>查看评估 JSON</summary>
        <p>${artifactLink(evaluationByArtifactKey.high_fidelity.record, "打开 evaluation.high_fidelity.json")} · ${artifactLink(evaluationByArtifactKey.main.record, "打开 evaluation.main.json")}</p>
      </details>
      <details>
        <summary>查看 VLM 评审 JSON</summary>
        <p>${artifactLink(vlmByArtifactKey.high_fidelity.record, "打开 vlm-judge.high_fidelity.json")} · ${artifactLink(vlmByArtifactKey.main.record, "打开 vlm-judge.main.json")}</p>
      </details>
      <details>
        <summary>查看语料回归链接</summary>
        <p>语料回归：${esc(corpus?.summary?.passed ?? 0)} 通过 / ${esc(corpus?.summary?.total ?? 0)} 总数。</p>
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
