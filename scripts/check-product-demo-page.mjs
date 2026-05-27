#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { artifactRoot, marketingArtifactDir, rel } from "./artifact-paths.mjs";

const demoDir = path.join(artifactRoot, "product_demo");
const htmlPath = path.join(demoDir, "index.html");
const manifestPath = path.join(demoDir, "ui-manifest.json");
const slotReplacementDemoPath = path.join(marketingArtifactDir, "slot-replacement-demo.json");

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

const requiredText = [
  "Executive Summary",
  "Pipeline Stepper",
  "Sample Understanding",
  "Transfer Plan",
  "Generated Outputs",
  "High Fidelity",
  "Natural Language Edit Before/After",
  "Generated through existing parser/request regeneration path",
  "not a relabeled pair of pre-existing variants",
  "Artifact Gallery",
  "Structure Timeline Rail",
  "Selection rationale:",
  "External-service disclosure",
  "Motif Gap:",
  "Interactive Gap Fill",
  "素材槽位替换器",
  "proxy placeholder -> user replacement"
];

for (const text of requiredText) {
  if (!html.includes(text)) {
    failures.push(`Page missing required text: ${text}`);
  }
}

const hasVlmArtifacts = ["main", "high_fidelity", "explainable_demo", "high_ctr", "high_quality"].some((label) =>
  existsSync(path.join(marketingArtifactDir, `vlm-judge.${label}.json`))
);

if (hasVlmArtifacts && !/VLM score/.test(html)) {
  failures.push("VLM artifacts exist but page does not contain a VLM score label.");
}

if (hasVlmArtifacts && /VLM judge is skipped/i.test(html)) {
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
  ["naturalLanguageEdit.parsedOperations", manifest.naturalLanguageEdit?.parsedOperations]
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

if (slotReplacementDemo?.after?.fillStrategy !== "user_asset_replace") {
  failures.push("slot-replacement-demo.json must show user_asset_replace after state.");
}

if (manifest.naturalLanguageEdit?.available !== true) {
  failures.push("Manifest does not mark Natural Language Edit as available.");
}

if (!Array.isArray(manifest.naturalLanguageEdit?.parsedOperations) || manifest.naturalLanguageEdit.parsedOperations.length === 0) {
  failures.push("Manifest naturalLanguageEdit.parsedOperations must be non-empty.");
}

if (hasVlmArtifacts && manifest.vlm?.available !== true) {
  failures.push("Manifest does not mark VLM as available while VLM artifacts exist.");
}

if (hasVlmArtifacts && !manifest.vlm?.byVariant?.high_fidelity?.overall) {
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
