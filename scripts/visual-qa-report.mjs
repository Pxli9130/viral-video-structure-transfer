#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = path.join(ROOT, "docs/artifacts/learned_samples_max");
const CASES = ["marketing", "editing", "motion_graph_1", "motion_graph_2"];
const PROMPT_RE = /15\s*秒|高转化|学习样例|不复制样例|watermark|水印|prompt|素材|镜头|结构（|结构\(/i;

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

function probe(file) {
  if (!file || !existsSync(file)) return undefined;
  const ffprobe = process.env.FFPROBE_PATH && process.env.FFPROBE_PATH.includes("/") ? process.env.FFPROBE_PATH : "ffprobe";
  const res = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], { encoding: "utf8" });
  try {
    const json = JSON.parse(res.stdout || "{}");
    return {
      width: json.streams?.[0]?.width ?? 0,
      height: json.streams?.[0]?.height ?? 0,
      durationSec: Number(json.format?.duration ?? 0)
    };
  } catch {
    return undefined;
  }
}

function fileInfo(file) {
  if (!existsSync(file)) return { exists: false, bytes: 0 };
  return { exists: true, bytes: statSync(file).size };
}

function previewFrames(root) {
  const dir = path.join(root, "preview_frames");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file)).sort();
}

function primitiveHistogram(recipe) {
  const hist = {};
  for (const clip of recipe?.clips ?? []) hist[clip.selectedPrimitive ?? "<none>"] = (hist[clip.selectedPrimitive ?? "<none>"] ?? 0) + 1;
  return hist;
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
    motionAtoms: template?.motionAtoms?.length ?? 0,
    audio: Object.keys(template?.audioStructure?.estimatedLayers ?? {}).length
  };
}

function bboxArea(box) {
  return box && typeof box.w === "number" && typeof box.h === "number" ? box.w * box.h : 0;
}

function bboxValid(box) {
  return Boolean(
    box &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h) &&
    box.w > 0 &&
    box.h > 0 &&
    box.x >= -0.02 &&
    box.y >= -0.02 &&
    box.x + box.w <= 1.02 &&
    box.y + box.h <= 1.02
  );
}

function iou(a, b) {
  if (!bboxValid(a) || !bboxValid(b)) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = bboxArea(a) + bboxArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

function textContent(recipe) {
  return [
    recipe?.productTheme?.name,
    recipe?.productTheme?.productName,
    recipe?.productTheme?.brandName,
    recipe?.productTheme?.cta,
    recipe?.productTheme?.ctaText,
    ...(recipe?.layers ?? []).flatMap((layer) => layer.type === "text" ? [layer.text?.content] : []),
    ...(recipe?.clips ?? []).flatMap((clip) => [clip.text?.copy])
  ].filter(Boolean).join("\n");
}

function audioSignature(recipe, timeline) {
  const recipeLayers = (recipe?.layers ?? [])
    .filter((layer) => layer.type === "audio")
    .map((layer) => `${layer.audio?.kind ?? "audio"}:${Number(layer.audio?.weight ?? 0).toFixed(2)}`);
  const planLayers = Object.entries(timeline?.renderPlan?.audioPlan?.layers ?? {})
    .map(([key, value]) => `${key}:${Number(value ?? 0).toFixed(2)}`);
  return (recipeLayers.length ? recipeLayers : planLayers).sort().join("|") || "none";
}

function loadCase(name, artifactRoot) {
  const root = path.join(artifactRoot, name);
  const generation = readJson(path.join(root, "generation.json"));
  const timeline = readJson(path.join(root, "timeline.json")) ?? generation?.timeline;
  const recipe = readJson(path.join(root, "render-recipe.v4.1.json")) ?? readJson(path.join(root, "render-recipe.json")) ?? timeline?.renderPlan?.renderRecipe;
  const template = readJson(path.join(root, "learned-template.json"))?.template ?? readJson(path.join(root, "learned-template.json"));
  const finalGates = readJson(path.join(root, "final-gates.json"));
  return {
    name,
    root,
    generation,
    timeline,
    recipe,
    template,
    gapReport: readJson(path.join(root, "gap-report.json")) ?? timeline?.gapReport ?? generation?.gapReport ?? [],
    finalGates,
    finalMp4: path.join(root, "final.mp4"),
    contactSheet: path.join(root, "render-contact-sheet.png"),
    previewFrames: previewFrames(root)
  };
}

function caseExpectation(name) {
  if (name === "marketing") return { label: "poster/ribbon/clean product packaging", primitiveHints: ["ProductPosterHero", "KineticTypographySweep", "CTAEndSlate"] };
  if (name === "editing") return { label: "beat/cut/text emphasis", primitiveHints: ["KineticTypographySweep", "CTAEndSlate"] };
  return { label: "kinetic/motion-graphic behavior", primitiveHints: ["KineticTypographySweep", "ProductPosterHero", "CTAEndSlate"] };
}

function passGate(finalGates, id) {
  const gate = finalGates?.gates?.find((item) => item.id === id);
  return gate?.status === "pass";
}

function summarizeCase(item) {
  const recipe = item.recipe;
  const timeline = item.timeline;
  const layers = recipe?.layers ?? [];
  const textLayers = layers.filter((layer) => layer.type === "text");
  const mediaLayers = layers.filter((layer) => layer.type === "media");
  const motionLayers = layers.filter((layer) => layer.type === "motion_atom");
  const audioLayers = layers.filter((layer) => layer.type === "audio");
  const hist = primitiveHistogram(recipe);
  const expected = caseExpectation(item.name);
  const finalInfo = fileInfo(item.finalMp4);
  const contactInfo = fileInfo(item.contactSheet);
  const finalProbe = probe(item.finalMp4);
  const mediaBboxes = mediaLayers.map((layer) => layer.layout?.bboxNorm).filter(Boolean);
  const textIssues = textLayers.flatMap((layer) => {
    const issues = [];
    const box = layer.layout?.bboxNorm;
    const fs = layer.typography?.fontSizeRatio;
    if (!bboxValid(box)) issues.push(`${layer.id}: bbox invalid/offscreen`);
    if (typeof fs !== "number" || fs < 0.028) issues.push(`${layer.id}: font too small/missing`);
    if (typeof fs === "number" && fs > 0.22) issues.push(`${layer.id}: font unusually large`);
    if (mediaBboxes.some((mediaBox) => iou(box, mediaBox) > 0.42)) issues.push(`${layer.id}: likely overlaps main media`);
    return issues;
  });
  const promptPolluted = PROMPT_RE.test(textContent(recipe));
  const ctaLayers = textLayers.filter((layer) => /cta|行动|现在|入手|购买/i.test(`${layer.text?.role ?? ""} ${layer.text?.content ?? ""}`));
  const ctaReadable = ctaLayers.length > 0 && ctaLayers.some((layer) => bboxValid(layer.layout?.bboxNorm) && (layer.typography?.fontSizeRatio ?? 0) >= 0.04);
  const placeholderLike = mediaLayers.some((layer) => /placeholder|mock|fake|sample_reference/i.test(JSON.stringify(layer.material ?? {})));
  const mediaVisible = finalInfo.exists && finalInfo.bytes > 100000 && mediaLayers.length > 0 && item.previewFrames.length >= Math.max(1, timeline?.clips?.length ?? 1);
  const motionRepresented = motionLayers.length > 0 || (timeline?.renderPlan?.motionAtoms?.length ?? 0) > 0;
  const marketingRibbon = item.name !== "marketing" || motionLayers.some((layer) => /ribbon|sweep/i.test(JSON.stringify(layer.atom ?? {}))) || Boolean(hist.KineticTypographySweep);
  const motionGraphGrammar = !item.name.startsWith("motion_graph") || Object.keys(hist).length >= 3;
  const audioExists = audioLayers.length > 0 || Object.keys(timeline?.renderPlan?.audioPlan?.layers ?? {}).length > 0;
  const structureMatches = expected.primitiveHints.some((key) => hist[key] > 0);
  const safetyPass =
    passGate(item.finalGates, "G7_no_sample_frame_copy") &&
    passGate(item.finalGates, "G8_no_sample_audio_copy") &&
    passGate(item.finalGates, "G20_generated_assets_have_provenance") &&
    passGate(item.finalGates, "G22_no_external_sample_media_uploads");
  const hardFailures = [
    finalInfo.exists ? "" : "final.mp4 missing",
    mediaVisible ? "" : "weak media visibility evidence",
    promptPolluted ? "prompt-like visible text risk" : "",
    safetyPass ? "" : "safety gate risk"
  ].filter(Boolean);
  const softFailures = [
    contactInfo.exists ? "" : "contact sheet missing",
    ctaReadable ? "" : "CTA readability heuristic weak",
    textIssues.length ? "text layout heuristic warnings" : "",
    motionRepresented && marketingRibbon && motionGraphGrammar ? "" : "motion grammar weak",
    audioExists ? "" : "audio missing",
    structureMatches ? "" : "primitive histogram does not match expected category"
  ].filter(Boolean);
  const risk = hardFailures.length ? "red" : softFailures.length ? "yellow" : "green";
  const suggestions = [
    !mediaVisible ? "人工打开 final.mp4 检查产品/目标素材是否足够大、是否仍有小图漂移。" : "",
    textIssues.length || !ctaReadable ? "人工检查字幕和 CTA 的 bbox、字号、遮挡，必要时调低字幕密度或移动 CTA。" : "",
    !motionRepresented || !marketingRibbon || !motionGraphGrammar ? "补充 renderer 对 motionAtom 的更细粒度消费，例如 ribbon depth、sweep path 和 kinetic typography timing。" : "",
    item.name === "marketing" && risk !== "green" ? "优先看 marketing，它是最能暴露 ribbon/sweep 学习不足的样例。" : ""
  ].filter(Boolean).slice(0, 3);
  return {
    case: item.name,
    generatedAt: new Date().toISOString(),
    paths: {
      root: item.root,
      finalMp4: finalInfo.exists ? item.finalMp4 : undefined,
      contactSheet: contactInfo.exists ? item.contactSheet : undefined,
      previewFramesDir: path.join(item.root, "preview_frames")
    },
    evidenceCounts: evidenceCounts(item.template),
    layerCounts: layerCounts(recipe),
    primitiveHistogram: hist,
    finalProbe,
    audioSignature: audioSignature(recipe, timeline),
    media: {
      status: mediaVisible ? "pass" : "warn",
      meaningfulVisualLikely: mediaVisible,
      finalMp4: finalInfo,
      mediaLayers: mediaLayers.length,
      imageBearingLayersVisibleByMetadata: mediaLayers.filter((layer) => bboxArea(layer.layout?.bboxNorm) >= (layer.layout?.minAreaRatio ?? 0.1) * 0.9).length,
      placeholderLike
    },
    text: {
      status: !promptPolluted && textIssues.length === 0 && ctaReadable ? "pass" : "warn",
      promptPolluted,
      ctaReadable,
      warnings: textIssues
    },
    motion: {
      status: motionRepresented && marketingRibbon && motionGraphGrammar ? "pass" : "warn",
      motionAtomsRepresented: motionRepresented,
      marketingRibbonLike: marketingRibbon,
      motionGraphGrammarBeyondCuts: motionGraphGrammar,
      motionAtomLayers: motionLayers.length
    },
    audio: {
      status: audioExists ? "pass" : "warn",
      exists: audioExists,
      audioLayers: audioLayers.length,
      signature: audioSignature(recipe, timeline)
    },
    structureTransfer: {
      status: structureMatches ? "pass" : "warn",
      expected: expected.label,
      primitiveHintsMatched: expected.primitiveHints.filter((key) => hist[key] > 0),
      distinctPrimitiveCount: Object.keys(hist).length
    },
    safety: {
      status: safetyPass ? "pass" : "warn",
      noSampleFrameCopy: passGate(item.finalGates, "G7_no_sample_frame_copy"),
      noSampleAudioCopy: passGate(item.finalGates, "G8_no_sample_audio_copy"),
      generatedProvenance: passGate(item.finalGates, "G20_generated_assets_have_provenance"),
      noExternalSampleUpload: passGate(item.finalGates, "G22_no_external_sample_media_uploads")
    },
    artifactPresence: {
      finalMp4: finalInfo.exists,
      contactSheet: contactInfo.exists,
      previewFrames: item.previewFrames.length,
      renderRecipe: existsSync(path.join(item.root, "render-recipe.json")),
      learnedTemplate: existsSync(path.join(item.root, "learned-template.json")),
      analysis: existsSync(path.join(item.root, "analysis.json")),
      finalGates: existsSync(path.join(item.root, "final-gates.json"))
    },
    risk,
    topSuggestions: suggestions.length ? suggestions : ["人工抽看 final.mp4 和 contact sheet，确认启发式 green 与真实观感一致。"]
  };
}

function mdBool(value) {
  return value ? "yes" : "no";
}

function writeCaseReport(report, root) {
  const md = `# Visual QA Report: ${report.case}

Generated: ${report.generatedAt}

## Summary

- Overall risk: **${report.risk}**
- Media: ${report.media.status}; meaningful visual likely: ${mdBool(report.media.meaningfulVisualLikely)}
- Text: ${report.text.status}; CTA readable: ${mdBool(report.text.ctaReadable)}; prompt pollution: ${mdBool(report.text.promptPolluted)}
- Motion: ${report.motion.status}; motion atoms represented: ${mdBool(report.motion.motionAtomsRepresented)}
- Audio: ${report.audio.status}; signature: \`${report.audio.signature}\`
- Structure transfer: ${report.structureTransfer.status}; expected: ${report.structureTransfer.expected}
- Safety: ${report.safety.status}

## Counts

- Evidence: visual ${report.evidenceCounts.visual}, typography ${report.evidenceCounts.typography}, motionAtoms ${report.evidenceCounts.motionAtoms}, audio ${report.evidenceCounts.audio}
- Layers: media ${report.layerCounts.media}, text ${report.layerCounts.text}, motion ${report.layerCounts.motion}, audio ${report.layerCounts.audio}
- Primitive histogram: \`${JSON.stringify(report.primitiveHistogram)}\`

## Artifact Presence

- final.mp4: ${mdBool(report.artifactPresence.finalMp4)}
- contact sheet: ${mdBool(report.artifactPresence.contactSheet)}
- preview frames: ${report.artifactPresence.previewFrames}
- render recipe: ${mdBool(report.artifactPresence.renderRecipe)}
- learned template: ${mdBool(report.artifactPresence.learnedTemplate)}
- analysis: ${mdBool(report.artifactPresence.analysis)}
- final gates: ${mdBool(report.artifactPresence.finalGates)}

## Text Warnings

${report.text.warnings.length ? report.text.warnings.map((item) => `- ${item}`).join("\n") : "- none"}

## Top Improvement Suggestions

${report.topSuggestions.map((item) => `- ${item}`).join("\n")}
`;
  writeFileSync(path.join(root, "visual-qa-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(root, "visual-qa-report.md"), md);
}

function summaryMarkdown(reports) {
  const rows = reports.map((r) => `| ${r.case} | ${r.media.status} | ${r.text.status} | ${r.motion.status} | ${r.audio.status} | ${r.structureTransfer.status} | ${r.safety.status} | ${r.risk} |`).join("\n");
  return `# Visual QA Summary

| Case | Media | Text | Motion | Audio | Structure Transfer | Safety | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

This report is deterministic and metadata-based. It does not use an external VLM judge, so manual review of each final.mp4 remains required before submission.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactRoot = path.resolve(args.root ?? DEFAULT_ROOT);
  const names = args["all-cases"]
    ? CASES
    : String(args.case ?? args.cases ?? "marketing").split(",").map((item) => item.trim()).filter(Boolean);
  const reports = [];
  for (const name of names) {
    const item = loadCase(name, artifactRoot);
    if (!existsSync(item.root)) throw new Error(`Missing artifact root for ${name}: ${item.root}`);
    const report = summarizeCase(item);
    await mkdir(item.root, { recursive: true });
    writeCaseReport(report, item.root);
    reports.push(report);
  }
  if (args["all-cases"] || names.length > 1) {
    writeFileSync(path.join(artifactRoot, "visual-qa-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));
    writeFileSync(path.join(artifactRoot, "visual-qa-summary.md"), summaryMarkdown(reports));
  }
  console.log(JSON.stringify({ status: "pass", cases: reports.map((r) => ({ case: r.case, risk: r.risk })) }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
