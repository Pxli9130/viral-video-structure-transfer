#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { artifactRoot, marketingArtifactDir, rel } from "./artifact-paths.mjs";

const demoDir = path.join(artifactRoot, "product_demo");
const htmlPath = path.join(demoDir, "index.html");
const manifestPath = path.join(demoDir, "ui-manifest.json");
const slotReplacementDemoPath = path.join(marketingArtifactDir, "slot-replacement-demo.json");
const editingCaseDir = path.join(artifactRoot, "editing_case");
const motionGraphCaseDir = path.join(artifactRoot, "motion_graph_case");

const failures = [];

function requireFile(filePath) {
  if (!existsSync(filePath)) {
    failures.push(`Missing file: ${rel(filePath)}`);
    return "";
  }
  return readFileSync(filePath, "utf8");
}

const html = requireFile(htmlPath);
const manifestText = requireFile(manifestPath);
const slotReplacementDemoText = requireFile(slotReplacementDemoPath);
let manifest = {};
let slotReplacementDemo = {};

if (manifestText) {
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    failures.push(`ui-manifest.json is not valid JSON: ${error.message}`);
  }
}

if (slotReplacementDemoText) {
  try {
    slotReplacementDemo = JSON.parse(slotReplacementDemoText);
  } catch (error) {
    failures.push(`slot-replacement-demo.json is not valid JSON: ${error.message}`);
  }
}

function firstNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function vlmScoreAvailable(vlmJson) {
  const scores = vlmJson?.scores && typeof vlmJson.scores === "object" ? vlmJson.scores : vlmJson;
  return firstNumber(
    scores?.overall,
    scores?.structure_transfer,
    scores?.motif_preserved,
    scores?.phases_visible,
    scores?.sample_style_fidelity,
    scores?.visual_quality,
    scores?.no_direct_copy
  ) !== null;
}

function vlmState(label) {
  const filePath = path.join(marketingArtifactDir, `vlm-judge.${label}.json`);
  if (!existsSync(filePath)) return { label, exists: false, hasScore: false, status: "missing" };
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const hasScore = vlmScoreAvailable(parsed);
    const rawStatus = String(parsed?.status ?? "").toLowerCase();
    const reason = String(parsed?.reason ?? "").toLowerCase();
    const status = hasScore
      ? "ok"
      : /skip|skipped/.test(rawStatus) || /skip|not run|not configured|not set|disabled/.test(reason)
        ? "skipped_infra"
        : "not_run";
    return { label, exists: true, hasScore, status };
  } catch (error) {
    return { label, exists: true, hasScore: false, status: "invalid_json", error: error.message };
  }
}

const requiredText = [
  "三分钟总览",
  "迁移流程",
  "样例理解",
  "迁移计划",
  "生成结果",
  "高保真",
  "自然语言编辑前后对比",
  "通过现有解析器和请求重生成路径",
  "不是对既有变体的简单改名",
  "工程证据",
  "结构时间轨道",
  "选择依据：",
  "外部服务说明",
  "主视觉缺口：",
  "交互式缺口补全",
  "素材槽位替换器",
  "代理占位 -> 用户素材替换",
  "interactive_gap_fill_proxy.mp4",
  "interactive_gap_fill_user_replacement.mp4",
  "editing_case/index.html",
  "motion_graph_case/index.html",
  "Motion Graph Target Adaptation",
  "Proxy Mode -> Target Assets",
  "Target Asset Pool",
  "Slot Asset Mapping Table",
  "before_after_contact_sheet.png"
];

for (const text of requiredText) {
  if (!html.includes(text)) {
    failures.push(`Page missing required text: ${text}`);
  }
}

const requiredSections = [
  "executive-summary",
  "pipeline-stepper",
  "sample-understanding",
  "transfer-plan",
  "generated-outputs",
  "structure-timeline-rail",
  "nl-before-after",
  "interactive-gap-fill",
  "motion-graph-target-adaptation",
  "artifact-gallery"
];

for (const section of requiredSections) {
  if (!html.includes(`data-section="${section}"`)) {
    failures.push(`Page missing required data-section: ${section}`);
  }
}

const vlmStates = ["main", "high_fidelity", "explainable_demo", "high_ctr", "high_quality"].map(vlmState);
const hasVlmArtifacts = vlmStates.some((state) => state.exists);
const hasScoredVlmArtifacts = vlmStates.some((state) => state.hasScore);
const highFidelityVlmState = vlmStates.find((state) => state.label === "high_fidelity");

if (hasScoredVlmArtifacts && !/VLM\s*(分数|score)/i.test(html)) {
  failures.push("VLM artifacts exist but page does not contain a VLM score label.");
}

if (hasScoredVlmArtifacts && /VLM judge is skipped/i.test(html)) {
  failures.push("Page incorrectly says VLM judge is skipped while VLM artifacts exist.");
}

const combinedGeneratedText = `${html}\n${manifestText}\n${slotReplacementDemoText}`;
const forbiddenPatterns = [
  { label: "absolute local path", pattern: /\/home\/pxli/ },
  { label: "Gemini key name", pattern: /GEMINI_API_KEY/i },
  { label: "dot-env reference", pattern: /\.env/i },
  { label: "Google API key prefix", pattern: /AIza[0-9A-Za-z_-]+/ },
  { label: "Ark API key prefix", pattern: /ark-[0-9A-Za-z_-]+/i }
];

for (const { label, pattern } of forbiddenPatterns) {
  if (pattern.test(combinedGeneratedText)) {
    failures.push(`Generated demo exposes forbidden pattern: ${label}`);
  }
}

const bodyStart = html.indexOf("<body");
const detailsStart = html.indexOf("<details", bodyStart);
const firstVisibleChunk = html.slice(bodyStart, detailsStart > bodyStart ? detailsStart : bodyStart + 8000);
if (/"[A-Za-z0-9_\\-]+"\s*:/.test(firstVisibleChunk)) {
  failures.push("Raw JSON-like content appears before progressive disclosure.");
}

if (/\b3fps\b/.test(html) || /%-2%|85%-1%/.test(html)) {
  failures.push("Numeric formatting regression detected in fps or segment ratios.");
}

const requiredManifestFields = [
  ["generatedAt", manifest.generatedAt],
  ["artifactRoot", manifest.artifactRoot],
  ["artifactsConsumed", manifest.artifactsConsumed],
  ["missingArtifacts", manifest.missingArtifacts],
  ["videos.found", manifest.videos?.found],
  ["videos.missing", manifest.videos?.missing],
  ["bestVariant", manifest.bestVariant],
  ["bestVariantReason", manifest.bestVariantReason],
  ["evaluator.available", manifest.evaluator?.available],
  ["evaluator.byVariant", manifest.evaluator?.byVariant],
  ["vlm.available", manifest.vlm?.available],
  ["vlm.byVariant", manifest.vlm?.byVariant],
  ["interactiveGapFill.available", manifest.interactiveGapFill?.available],
  ["interactiveGapFill.demoArtifact", manifest.interactiveGapFill?.demoArtifact],
  ["naturalLanguageEdit.available", manifest.naturalLanguageEdit?.available],
  ["naturalLanguageEdit.demoArtifact", manifest.naturalLanguageEdit?.demoArtifact],
  ["naturalLanguageEdit.parsedOperations", manifest.naturalLanguageEdit?.parsedOperations],
  ["editingCase.available", manifest.editingCase?.available],
  ["editingCase.render", manifest.editingCase?.render],
  ["motionGraphCase.available", manifest.motionGraphCase?.available],
  ["motionGraphCase.index", manifest.motionGraphCase?.index],
  ["motionGraphCase.renderProxy", manifest.motionGraphCase?.renderProxy],
  ["motionGraphCase.renderWithAssets", manifest.motionGraphCase?.renderWithAssets],
  ["motionGraphCase.beforeAfterContactSheet", manifest.motionGraphCase?.beforeAfterContactSheet],
  ["motionGraphCase.assetEvidence", manifest.motionGraphCase?.assetEvidence],
  ["motionGraphCase.slotAssetMatches", manifest.motionGraphCase?.slotAssetMatches],
  ["motionGraphCase.evaluation", manifest.motionGraphCase?.evaluation]
];

for (const [field, value] of requiredManifestFields) {
  if (value === undefined || value === null) {
    failures.push(`Manifest missing ${field}.`);
  }
}

if (!Array.isArray(manifest.artifactsConsumed) || !manifest.artifactsConsumed.length) {
  failures.push("Manifest artifactsConsumed must be a non-empty array.");
}

if (!Array.isArray(manifest.videos?.found) || !Array.isArray(manifest.videos?.missing)) {
  failures.push("Manifest videos.found and videos.missing must be arrays.");
}

if (manifest.interactiveGapFill?.available !== true) {
  failures.push("Manifest does not mark Interactive Gap Fill as available.");
}

if (existsSync(path.join(editingCaseDir, "index.html")) && !html.includes("editing_case/index.html")) {
  failures.push("Editing case artifact exists but product demo gallery does not link it.");
}

if (existsSync(path.join(editingCaseDir, "index.html")) && manifest.editingCase?.available !== true) {
  failures.push("Manifest does not mark editing_case as available while editing_case artifacts exist.");
}

if (existsSync(path.join(motionGraphCaseDir, "index.html")) && !html.includes("motion_graph_case/index.html")) {
  failures.push("Motion graph case artifact exists but product demo gallery does not link it.");
}

if (existsSync(path.join(motionGraphCaseDir, "index.html")) && manifest.motionGraphCase?.available !== true) {
  failures.push("Manifest does not mark motion_graph_case as available while motion_graph_case artifacts exist.");
}

if (existsSync(path.join(motionGraphCaseDir, "before_after_contact_sheet.png")) && !html.includes("motion_graph_case/before_after_contact_sheet.png")) {
  failures.push("Motion graph before_after_contact_sheet exists but product demo does not link it.");
}

if (existsSync(path.join(motionGraphCaseDir, "slot-asset-matches.json")) && !/data-motion-graph-slot-mapping="slot-asset-mapping"/.test(html)) {
  failures.push("Product demo missing first-class motion graph slot mapping table.");
}

if (existsSync(path.join(motionGraphCaseDir, "blocked-material-report.malformed.json")) && !/data-motion-graph-managed-material-intake="managed-material-intake"/.test(html)) {
  failures.push("Product demo missing first-class managed material intake section.");
}

if (existsSync(path.join(motionGraphCaseDir, "blocked-material-report.malformed.json")) && !/data-motion-graph-blocked-material="blocked-material"/.test(html)) {
  failures.push("Product demo missing blocked malformed material table.");
}

if (existsSync(path.join(motionGraphCaseDir, "render-asset-check.json")) && !html.includes("Pixel Asset Check")) {
  failures.push("Product demo missing motion graph pixel asset check summary.");
}

if (existsSync(path.join(motionGraphCaseDir, "render_with_assets.mp4")) && !html.includes("motion_graph_case/render_with_assets.mp4")) {
  failures.push("Motion graph with-assets render exists but product demo does not link it.");
}

if (existsSync(path.join(motionGraphCaseDir, "render_malformed_assets.mp4")) && !html.includes("motion_graph_case/render_malformed_assets.mp4")) {
  failures.push("Motion graph malformed-assets render exists but product demo does not link it.");
}

if (existsSync(path.join(motionGraphCaseDir, "render_aigc_materials.mp4")) && !html.includes("motion_graph_case/render_aigc_materials.mp4")) {
  failures.push("Motion graph AIGC-materials render exists but product demo does not link it.");
}

if (existsSync(path.join(motionGraphCaseDir, "aigc-material-briefs.json")) && !/data-motion-graph-aigc-material-fill="optional-aigc-material-fill"/.test(html)) {
  failures.push("Product demo missing Optional AIGC Material Fill section.");
}

if (existsSync(path.join(motionGraphCaseDir, "generated-asset-quality.json")) && !/data-motion-graph-aigc-table="quality"/.test(html)) {
  failures.push("Product demo missing AIGC generated-material quality table.");
}

if (slotReplacementDemo?.after?.fillStrategy !== "user_asset_replace") {
  failures.push("slot-replacement-demo.json must show user_asset_replace after state.");
}

if (slotReplacementDemo?.rendered !== true) {
  failures.push("slot-replacement-demo.json must mark the replacement fixture pair as rendered.");
}

for (const [label, record] of [
  ["before", slotReplacementDemo?.before],
  ["after", slotReplacementDemo?.after]
]) {
  if (record?.rendered !== true) {
    failures.push(`slot-replacement-demo.json ${label} state must be rendered.`);
  }
  if (!record?.artifact || !record.artifact.endsWith(".mp4")) {
    failures.push(`slot-replacement-demo.json ${label} artifact must point to an MP4.`);
  } else {
    const artifactPath = path.resolve(demoDir, record.artifact);
    if (!artifactPath.startsWith(artifactRoot) || !existsSync(artifactPath)) {
      failures.push(`slot-replacement-demo.json ${label} MP4 does not exist: ${record.artifact}`);
    }
  }
}

const evaluatorGates = slotReplacementDemo?.evaluatorGates;
if (!Array.isArray(evaluatorGates) || evaluatorGates.length === 0) {
  failures.push("slot-replacement-demo.json evaluatorGates must be a non-empty array.");
} else {
  for (const gate of evaluatorGates) {
    if (typeof gate.id !== "string" || typeof gate.passed !== "boolean") {
      failures.push("slot-replacement-demo.json evaluator gates must include id and boolean passed.");
      break;
    }
  }
  const unresolvedGate = evaluatorGates.find((gate) => gate.id === "unresolved_placeholder_count");
  if (!unresolvedGate || unresolvedGate.value !== 0 || unresolvedGate.passed !== true) {
    failures.push("unresolved_placeholder_count gate must have value 0 and passed true.");
  }
}

if (!/unresolved_placeholder_count:\s*0/.test(html) || !/gate pass[^>]*>unresolved_placeholder_count:\s*0/.test(html)) {
  failures.push("HTML must render unresolved_placeholder_count: 0 as a passing gate.");
}

if (manifest.naturalLanguageEdit?.available !== true) {
  failures.push("Manifest does not mark Natural Language Edit as available.");
}

if (!Array.isArray(manifest.naturalLanguageEdit?.parsedOperations) || manifest.naturalLanguageEdit.parsedOperations.length === 0) {
  failures.push("Manifest naturalLanguageEdit.parsedOperations must be non-empty.");
}

if (hasScoredVlmArtifacts && manifest.vlm?.available !== true) {
  failures.push("Manifest does not mark VLM as available while scored VLM artifacts exist.");
}

if (!hasScoredVlmArtifacts && hasVlmArtifacts && manifest.vlm?.available === true) {
  failures.push("Manifest marks VLM as available even though all VLM artifacts are skipped/not_run.");
}

if (hasVlmArtifacts) {
  for (const state of vlmStates.filter((item) => item.exists && !item.hasScore)) {
    const manifestKey = state.label === "main" ? "final_creative" : state.label;
    const manifestState = manifest.vlm?.byVariant?.[manifestKey];
    if (!["skipped_infra", "not_run", "missing"].includes(String(manifestState?.status ?? ""))) {
      failures.push(`Manifest must mark ${state.label} VLM as skipped_infra/not_run when score is absent.`);
    }
  }
}

if (highFidelityVlmState?.hasScore && !manifest.vlm?.byVariant?.high_fidelity?.overall) {
  failures.push("Manifest missing high_fidelity VLM score in vlm.byVariant.");
}

for (const [, src] of html.matchAll(/<video[^>]+src="([^"]+)"/g)) {
  if (src.startsWith("/") || /^https?:\/\//i.test(src)) {
    failures.push(`Video src is not relative: ${src}`);
  }
}

if (failures.length) {
  console.error("Product demo smoke check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Product demo smoke check passed.");
console.log(`- ${rel(htmlPath)}`);
console.log(`- ${rel(manifestPath)}`);
console.log(`- bestVariant: ${manifest.bestVariant}`);
console.log(`- vlmAvailable: ${manifest.vlm?.available === true}`);
console.log(`- product_demo_allows_missing_vlm_when_not_run: ${!hasScoredVlmArtifacts && hasVlmArtifacts ? "pass" : "not_applicable"}`);
console.log(`- product_demo_displays_vlm_when_json_exists: ${hasScoredVlmArtifacts ? "pass" : "not_applicable"}`);
