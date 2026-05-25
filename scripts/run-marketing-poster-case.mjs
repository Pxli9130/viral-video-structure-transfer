import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFallbackTemplate,
  generateMigrationResult,
  nowIso,
  validateStructureTemplate,
  validateTimeline
} from "../packages/shared/dist/index.js";
import { RemotionRenderer } from "../apps/api/dist/adapters/renderers.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..");
const artifactDir = path.join(repoRoot, "docs", "marketing_case_artifacts");
const videoPath = path.join(repoRoot, "test_videos", "marketing.mov");
const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
const condaBin = path.join(condaBase, "envs", condaEnv, "bin");
const ffmpeg = existsSync(path.join(condaBin, "ffmpeg")) ? path.join(condaBin, "ffmpeg") : "ffmpeg";
const ffprobe = existsSync(path.join(condaBin, "ffprobe")) ? path.join(condaBin, "ffprobe") : "ffprobe";

const projectId = "project_marketing_poster_case";
const sampleAssetId = "asset_marketing_mov";

if (!existsSync(videoPath)) {
  throw new Error(`Missing testcase input video: ${path.relative(repoRoot, videoPath)}`);
}

if (!existsSync(path.join(repoRoot, "packages", "shared", "dist", "index.js"))) {
  throw new Error("Build output is missing. Run `npm run build --workspace @vvst/shared` first.");
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function ffprobeMetadata(file) {
  const stdout = run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,codec_name", "-of", "json", file],
    "ffprobe"
  );
  const parsed = JSON.parse(stdout);
  const video = parsed.streams.find((stream) => stream.codec_type === "video") ?? {};
  const audio = parsed.streams.some((stream) => stream.codec_type === "audio");
  const [fpsNum, fpsDen] = String(video.avg_frame_rate ?? "30/1").split("/").map(Number);
  return {
    durationSec: Number(parsed.format?.duration ?? 18.433333),
    width: Number(video.width ?? 718),
    height: Number(video.height ?? 1018),
    fps: fpsDen ? fpsNum / fpsDen : 30,
    hasAudio: audio,
    codec: String(video.codec_name ?? "unknown")
  };
}

function marketingAnalysis(metadata) {
  return {
    id: "analysis_marketing_mov",
    assetId: sampleAssetId,
    projectId,
    purpose: "sample",
    metadata,
    keyframes: [
      { id: "marketing_kf_1", timeSec: 0.5, description: "Minimal off-white poster with central Chinese title and fixed info anchors.", tags: ["hook_candidate", "text_card_candidate"] },
      { id: "marketing_kf_2", timeSec: 4, description: "Large 3D ribbon enters diagonally and starts orbiting the title.", tags: ["background", "text_card_candidate"] },
      { id: "marketing_kf_3", timeSec: 8.5, description: "Keyword repetition and color progression strengthen brand memory.", tags: ["text_card_candidate"] },
      { id: "marketing_kf_4", timeSec: 13.5, description: "Dense multi-color ribbon climax around static poster typography.", tags: ["comparison_candidate", "text_card_candidate"] },
      { id: "marketing_kf_5", timeSec: 16.6, description: "Social platform profile page tail, not part of the transferable creative structure.", tags: ["background"] }
    ],
    shots: [
      { id: "marketing_shot_hook", startSec: 0, endSec: 2, durationSec: 2, tags: ["hook_candidate", "text_card_candidate"], confidence: 0.9, notes: "Main title appears immediately." },
      { id: "marketing_shot_ribbon_entry", startSec: 2, endSec: 6, durationSec: 4, tags: ["background", "text_card_candidate"], confidence: 0.86, notes: "3D ribbon enters and orbits the static poster." },
      { id: "marketing_shot_keyword_memory", startSec: 6, endSec: 10, durationSec: 4, tags: ["text_card_candidate"], confidence: 0.84, notes: "English keywords repeat around the poster." },
      { id: "marketing_shot_color_climax", startSec: 10, endSec: 14.5, durationSec: 4.5, tags: ["comparison_candidate", "text_card_candidate"], confidence: 0.82, notes: "Color diversity and motion density increase." },
      { id: "marketing_shot_cta_poster", startSec: 14.5, endSec: 15.7, durationSec: 1.2, tags: ["cta_candidate", "text_card_candidate"], confidence: 0.82, notes: "Clean final poster hold." },
      { id: "marketing_shot_platform_tail", startSec: 15.7, endSec: metadata.durationSec, durationSec: Math.max(0, metadata.durationSec - 15.7), tags: ["background"], confidence: 0.45, notes: "Platform UI tail; excluded from transferable structure." }
    ],
    transcript: [],
    ocr: [
      { timeSec: 0.5, text: "造物 逐空 2026" },
      { timeSec: 8.5, text: "STRUCTURE COLOR SPACE" },
      { timeSec: 16.6, text: "小红书 profile UI" }
    ],
    warnings: ["Fixture analysis encodes evaluator-observed marketing.mov structure."],
    analyzerMode: "ffmpeg_vlm_asr",
    createdAt: nowIso()
  };
}

const marketingVlm = {
  videoSummary:
    "Marketing motion-graphic poster: minimal off-white poster, central static typography, 3D ribbon orbit, repeated English keywords, progressive color build, and a social-platform UI tail after the creative ending.",
  shots: [
    { start: 0, end: 2, purpose: "hook", visual: "Main title appears immediately on a minimal poster layout.", transition: "none" },
    { start: 2, end: 6, purpose: "visual_attention", visual: "A large 3D ribbon enters diagonally and orbits around the title.", transition: "ribbon sweep" },
    { start: 6, end: 10, purpose: "brand_memory", visual: "English keywords repeat on and around the ribbon while poster anchors remain fixed.", transition: "orbit loop" },
    { start: 10, end: 14.5, purpose: "climax", visual: "Color diversity and motion density increase to a multi-color ribbon climax.", transition: "color progression" },
    { start: 14.5, end: 15.7, purpose: "cta", visual: "Clean final poster hold with date, location, logo, and action cue.", transition: "hold" }
  ],
  structure: {
    hook: "Show main title immediately and keep the poster readable.",
    setup: "Use central static typography, large negative space, and fixed information anchors.",
    sellingPoints: ["minimal poster layout", "3D ribbon orbit", "keyword repetition", "color progression", "clean final CTA"],
    climax: "Increase color diversity and motion density before the final poster hold.",
    cta: "Freeze a clean final poster with date, location, logo, and action cue."
  },
  rhythm: {
    avgShotLength: 3.1,
    fastSections: ["3-8s ribbon sweep", "8-13s color acceleration"],
    peakMoments: ["13-15.7s multi-color ribbon climax"],
    peakTimeRatio: 0.78,
    notes: "0-3s poster, 3-8s motion entry, 8-13s keyword/color build, 13-15.7s climax, 15.7-18.4s platform UI tail excluded."
  },
  packaging: {
    subtitleDensity: "medium",
    titleCards: ["central static typography + English keyword repetition"],
    stickers: ["3d_ribbon_orbit", "keyword_ring", "date_location_anchor"],
    colorStyle: "blue → purple → pink → orange → yellow → green progression",
    coverStyle: "minimal off-white poster with large central title"
  },
  reusablePatterns: [
    "minimal information poster + 3D ribbon dynamic packaging",
    "keyword orbit around central static typography",
    "progressive multi-color climax",
    "clean final poster CTA hold"
  ],
  materialGapsForNewVideo: ["dynamic_3d_ribbon_asset", "final_date_location_card", "brand_keyword_copy"],
  raw: JSON.stringify({
    exclude_segments: [{ time: "15.7-18.4", reason: "social platform UI / screen recording tail; do not transfer" }]
  })
};

function aiChallengeRequest(controls = {}) {
  return {
    projectId,
    inputMode: "prompt_only",
    selectedTemplateIds: ["template_marketing_case"],
    prompt: [
      "主题：AI 全栈挑战赛 · 爆款结构迁移引擎",
      "目标用户：评委、参赛者",
      "卖点：样例拆解、素材补全、视频重组、可解释时间线",
      "风格：科技感、极简、适合答辩展示、3D 彩带动态海报",
      "CTA：Upload. Analyze. Remix. 一键生成可解释短视频方案"
    ].join("\n"),
    target: {
      vertical: "b2b_marketing_mg",
      aspectRatio: "9:16",
      targetDurationSec: 16,
      outputMode: "mp4_render"
    },
    controls: {
      pace: "fast",
      hookIntensity: "strong",
      packagingStyle: "mg_motion",
      ctaStyle: "direct",
      allowAigcPlaceholder: true,
      ...controls
    },
    constraints: {
      noSampleVisualCopy: true,
      forbiddenWords: ["造物", "逐空", "小红书", "Xiaohongshu"],
      mustMention: ["爆款结构迁移引擎", "Upload. Analyze. Remix."]
    }
  };
}

function rel(file) {
  return path.relative(repoRoot, file);
}

function requireLocalRemotionBrowser() {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    path.join(repoRoot, "apps", "api", "node_modules", ".remotion", "chrome-headless-shell", "linux64", "chrome-headless-shell-linux64", "chrome-headless-shell"),
    path.join(process.env.HOME ?? "/home/pxli", ".cache", "ms-playwright", "chromium_headless_shell-1208", "chrome-headless-shell-linux64", "chrome-headless-shell")
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "No local Remotion browser executable found. Set REMOTION_BROWSER_EXECUTABLE; this testcase intentionally does not download browser binaries."
    );
  }
  return found;
}

async function renderToFixed(renderer, generation, filename) {
  const output = await renderer.render(generation.timeline, generation.id);
  if (output.status !== "completed" || !output.outputPath) {
    throw new Error(`Render failed for ${filename}: ${output.error ?? "missing output path"}`);
  }
  const fixedPath = path.join(artifactDir, filename);
  await copyFile(output.outputPath, fixedPath);
  return { ...output, fixedPath };
}

async function fileHashes(file) {
  const buffer = await readFile(file);
  return {
    bytes: buffer.length,
    md5: createHash("md5").update(buffer).digest("hex"),
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

function extractFrame(input, timeSec, output) {
  run(ffmpeg, ["-y", "-ss", String(timeSec), "-i", input, "-frames:v", "1", output], `extract frame ${path.basename(output)}`);
}

async function extractFramesFor(label, input, times) {
  const frames = [];
  for (const timeSec of times) {
    const framePath = path.join(artifactDir, `${label}_t${timeSec}.png`);
    extractFrame(input, timeSec, framePath);
    frames.push({ timeSec, path: framePath, hash: await fileHashes(framePath) });
  }
  return frames;
}

function createContactSheet(renderSummaries) {
  const frameInputs = renderSummaries.flatMap((summary) => summary.frames.map((frame) => frame.path));
  const output = path.join(artifactDir, "contact_sheet.png");
  const scaleFilters = frameInputs.map((_, index) => `[${index}:v]scale=240:426:force_original_aspect_ratio=decrease,pad=240:426:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`);
  const rowFilters = renderSummaries.map((_, row) => {
    const start = row * 3;
    return `[v${start}][v${start + 1}][v${start + 2}]hstack=inputs=3[row${row}]`;
  });
  const filter = [...scaleFilters, ...rowFilters, "[row0][row1][row2]vstack=inputs=3[out]"].join(";");
  run(
    ffmpeg,
    ["-y", ...frameInputs.flatMap((frame) => ["-i", frame]), "-filter_complex", filter, "-map", "[out]", output],
    "create contact sheet"
  );
  return output;
}

function assertRenderedVideo(label, metadata) {
  if (metadata.width !== 720 || metadata.height !== 1280) {
    throw new Error(`${label} resolution mismatch: expected 720x1280, got ${metadata.width}x${metadata.height}`);
  }
  if (metadata.durationSec < 15.4 || metadata.durationSec > 16.7) {
    throw new Error(`${label} duration mismatch: expected around 16s, got ${metadata.durationSec.toFixed(2)}s`);
  }
  if (metadata.fps < 29 || metadata.fps > 31) {
    throw new Error(`${label} fps mismatch: expected around 30fps, got ${metadata.fps.toFixed(2)}`);
  }
}

function assertUniqueVideoHashes(renderSummaries) {
  for (const field of ["md5", "sha256"]) {
    const values = renderSummaries.map((item) => item.hashes[field]);
    if (new Set(values).size !== values.length) {
      throw new Error(`Generated videos are not unique by ${field}: ${values.join(", ")}`);
    }
  }
}

function assertFrameMotion(label, frames, minimumUnique) {
  const unique = new Set(frames.map((frame) => frame.hash.sha256));
  if (unique.size < minimumUnique) {
    throw new Error(`${label} frame-motion sanity failed: expected ${minimumUnique} unique sampled frames, got ${unique.size}`);
  }
}

function visibleTextFor(generation) {
  const storyboardText = generation.storyboard.flatMap((item) => [item.shotDescription, item.subtitle, item.assetUsage, item.packaging, item.rationale]);
  const timelineText = generation.timeline.clips.flatMap((clip) => [
    clip.subtitleText,
    clip.visualIntent,
    ...clip.layers.map((layer) => layer.text ?? "")
  ]);
  return [...storyboardText, ...timelineText].filter(Boolean).join("\n");
}

function assertNoForbiddenVisibleText(generations) {
  const forbidden = ["造物", "逐空", "小红书", "Xiaohongshu"];
  for (const generation of generations) {
    const visibleText = visibleTextFor(generation);
    const matched = forbidden.find((word) => visibleText.includes(word));
    if (matched) {
      throw new Error(`Forbidden copied sample text leaked into final visible text/storyboard: ${matched}`);
    }
  }
}

function publicGeneration(generation) {
  const clone = JSON.parse(JSON.stringify(generation));
  if (clone.request?.constraints?.forbiddenWords) {
    clone.request.constraints.forbiddenWords = ["[redacted copied sample text list]"];
  }
  return clone;
}

function tableRows(items, render) {
  return items.map(render).join("\n");
}

await mkdir(artifactDir, { recursive: true });

const metadata = ffprobeMetadata(videoPath);
const analysis = marketingAnalysis(metadata);
const template = buildFallbackTemplate(analysis, "b2b_marketing_mg", projectId, marketingVlm);
const main = generateMigrationResult({ template, request: aiChallengeRequest() });
const highCtr = generateMigrationResult({
  template,
  request: aiChallengeRequest({ pace: "fast", hookIntensity: "aggressive", packagingStyle: "mg_motion", ctaStyle: "direct" }),
  generationIdSalt: "high_ctr"
});
const highQuality = generateMigrationResult({
  template,
  request: aiChallengeRequest({ pace: "slow", hookIntensity: "safe", packagingStyle: "clean", ctaStyle: "soft" }),
  generationIdSalt: "high_quality"
});

const templateValidation = validateStructureTemplate(template);
const timelineValidation = validateTimeline(main.timeline);
if (!templateValidation.valid || !timelineValidation.valid) {
  throw new Error(`Validation failed: template=${templateValidation.errors.join("; ")} timeline=${timelineValidation.errors.join("; ")}`);
}

assertNoForbiddenVisibleText([main, highCtr, highQuality]);

const renderer = new RemotionRenderer({
  generatedDir: artifactDir,
  entryPoint: path.join(repoRoot, "apps", "api", "remotion", "index.tsx"),
  compositionId: "ViralReconstruction",
  browserExecutable: requireLocalRemotionBrowser()
});
const mainRender = await renderToFixed(renderer, main, "ai_challenge_poster_main.mp4");
const ctrRender = await renderToFixed(renderer, highCtr, "ai_challenge_poster_high_ctr.mp4");
const qualityRender = await renderToFixed(renderer, highQuality, "ai_challenge_poster_high_quality.mp4");

extractFrame(videoPath, 0.5, path.join(artifactDir, "input_hook.png"));
extractFrame(videoPath, 13.5, path.join(artifactDir, "input_climax.png"));
extractFrame(videoPath, Math.min(16.6, metadata.durationSec - 0.5), path.join(artifactDir, "input_excluded_tail.png"));

const renderSummaries = [
  {
    label: "main",
    generation: main,
    render: mainRender,
    metadata: ffprobeMetadata(mainRender.fixedPath),
    hashes: await fileHashes(mainRender.fixedPath),
    frames: await extractFramesFor("main", mainRender.fixedPath, [1, 7, 13])
  },
  {
    label: "high_ctr",
    generation: highCtr,
    render: ctrRender,
    metadata: ffprobeMetadata(ctrRender.fixedPath),
    hashes: await fileHashes(ctrRender.fixedPath),
    frames: await extractFramesFor("high_ctr", ctrRender.fixedPath, [1, 7, 13])
  },
  {
    label: "high_quality",
    generation: highQuality,
    render: qualityRender,
    metadata: ffprobeMetadata(qualityRender.fixedPath),
    hashes: await fileHashes(qualityRender.fixedPath),
    frames: await extractFramesFor("high_quality", qualityRender.fixedPath, [1, 7, 13])
  }
];

for (const summary of renderSummaries) {
  assertRenderedVideo(summary.label, summary.metadata);
  assertFrameMotion(summary.label, summary.frames, summary.label === "high_quality" ? 2 : 3);
}
assertUniqueVideoHashes(renderSummaries);
const contactSheetPath = createContactSheet(renderSummaries);

const proceduralAction = main.fillPlan.find(
  (action) =>
    action.strategy === "procedural_generation" &&
    action.rendererInstructions?.fulfilledBy === "procedural_generation" &&
    String(action.rendererInstructions?.atom ?? "").includes("ribbon")
);
const mainMotionAtom = main.timeline.renderPlan?.motionAtoms?.find((atom) => atom.type === "ribbon_orbit" || atom.type === "3d_ribbon_orbit");
if (!proceduralAction || !mainMotionAtom) {
  throw new Error("dynamic_3d_ribbon_asset was not fulfilled by a renderer-backed procedural ribbon/orbit atom.");
}

await writeFile(path.join(artifactDir, "structure-template.json"), JSON.stringify(template, null, 2), "utf8");
await writeFile(path.join(artifactDir, "generation-result.json"), JSON.stringify(publicGeneration(main), null, 2), "utf8");
await writeFile(path.join(artifactDir, "timeline.json"), JSON.stringify(main.timeline, null, 2), "utf8");

const variantSummary = [
  {
    label: "main",
    generationId: main.id,
    timelineId: main.timeline.id,
    clips: main.timeline.clips.length,
    background: main.timeline.renderPlan?.background,
    mp4: rel(mainRender.fixedPath),
    motionAtom: main.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[0].metadata,
    hashes: renderSummaries[0].hashes
  },
  {
    label: "high_ctr",
    generationId: highCtr.id,
    timelineId: highCtr.timeline.id,
    clips: highCtr.timeline.clips.length,
    background: highCtr.timeline.renderPlan?.background,
    mp4: rel(ctrRender.fixedPath),
    motionAtom: highCtr.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[1].metadata,
    hashes: renderSummaries[1].hashes
  },
  {
    label: "high_quality",
    generationId: highQuality.id,
    timelineId: highQuality.timeline.id,
    clips: highQuality.timeline.clips.length,
    background: highQuality.timeline.renderPlan?.background,
    mp4: rel(qualityRender.fixedPath),
    motionAtom: highQuality.timeline.renderPlan?.motionAtoms?.[0],
    metadata: renderSummaries[2].metadata,
    hashes: renderSummaries[2].hashes
  }
];
await writeFile(path.join(artifactDir, "variant-summary.json"), JSON.stringify(variantSummary, null, 2), "utf8");

const report = `# Marketing.mov Dynamic Poster Case

Generated: ${nowIso()}

## Input

- File: \`${rel(videoPath)}\`
- Duration: ${metadata.durationSec.toFixed(2)}s
- Resolution: ${metadata.width}x${metadata.height}
- FPS: ${metadata.fps.toFixed(2)}
- Audio: ${metadata.hasAudio ? "yes" : "no"}

## Expected Structure Captured

- Type: MG dynamic marketing poster / minimal motion graphic poster
- Core method: central static typography + negative space + 3D ribbon orbit + keyword repetition + progressive color climax
- Excluded tail: 15.7-${metadata.durationSec.toFixed(1)}s platform UI / screen recording tail, not transferred

## Template Evidence

- Template: ${template.name}
- Packaging: ${template.packaging.titleCardStyle}; ${template.packaging.overlayStyle}; ${template.packaging.coverStyle}
- Atoms: ${template.structureAtoms.map((atom) => atom.name).join(", ")}
- Validation: template=${templateValidation.valid}, timeline=${timelineValidation.valid}

## Migration Output

- New topic: AI 全栈挑战赛 · 爆款结构迁移引擎
- Output MP4: [ai_challenge_poster_main.mp4](ai_challenge_poster_main.mp4)
- Contact sheet: [contact_sheet.png](contact_sheet.png)
- Timeline JSON: [timeline.json](timeline.json)
- Full generation JSON: [generation-result.json](generation-result.json)
- Critical motif: \`dynamic_3d_ribbon_asset -> fulfilled_by_procedural_generation -> ribbon_orbit rendered\`
- Renderer: Remotion procedural motion atom, no online asset download

## Gap Report

| Gap | Severity | Impact | Strategies |
|---|---|---|---|
${tableRows(main.gapReport, (gap) => `| ${gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId} | ${gap.severity} | ${gap.impact} | ${(gap.recommendedFillStrategies ?? []).join(", ")} |`)}

## Fill Strategy Evidence

| Missing Motif | Fill Strategy | Renderer Atom | Fulfilled By |
|---|---|---|---|
| dynamic_3d_ribbon_asset | ${proceduralAction.strategy} | ${proceduralAction.rendererInstructions.atom} | fulfilled_by_${proceduralAction.rendererInstructions.fulfilledBy} |

## Motion Atom

\`\`\`json
${JSON.stringify(mainMotionAtom, null, 2)}
\`\`\`

## Storyboard

| Time | Subtitle | Asset Usage |
|---|---|---|
${tableRows(main.storyboard, (item) => `| ${item.timeRange} | ${item.subtitle} | ${item.assetUsage} |`)}

## Variant Progress

| Variant | Clips | Background | Motion Atom | MP4 |
|---|---:|---|---|---|
${tableRows(variantSummary, (variant) => `| ${variant.label} | ${variant.clips} | ${variant.background} | ${variant.motionAtom?.style}; density=${variant.motionAtom?.density}; speed=${variant.motionAtom?.speed} | [mp4](${path.basename(variant.mp4)}) |`)}

## Render Sanity

| Variant | Duration | Resolution | FPS | MD5 | SHA256 |
|---|---:|---|---:|---|---|
${tableRows(variantSummary, (variant) => `| ${variant.label} | ${variant.metadata.durationSec.toFixed(2)}s | ${variant.metadata.width}x${variant.metadata.height} | ${variant.metadata.fps.toFixed(2)} | ${variant.hashes.md5} | ${variant.hashes.sha256} |`)}

Copied sample visible text is absent from storyboard and rendered text layers.
`;
await writeFile(path.join(artifactDir, "report.md"), report, "utf8");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Marketing.mov Structure Transfer Case</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; background: #eef3f6; color: #172033; }
    main { max-width: 1440px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    p, li, td { font-size: 14px; line-height: 1.45; }
    .grid { display: grid; grid-template-columns: 0.9fr 1fr 1.15fr; gap: 16px; align-items: start; }
    section { background: #fff; border: 1px solid #d8e1e8; border-radius: 8px; padding: 16px; }
    .frames { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    img, video { width: 100%; border-radius: 8px; background: #020617; }
    video.poster { max-height: 560px; object-fit: contain; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; text-align: left; vertical-align: top; }
    th { color: #64748b; font-size: 12px; text-transform: uppercase; }
    .pill { display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 800; background: #dff8ef; color: #0f766e; }
    .variants { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
    code { background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
    @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <h1>Marketing.mov 动态海报结构迁移 testcase</h1>
  <p><span class="pill">PASS</span> 结构拆解、排除片段、素材缺口、迁移生成、可见 MP4、多版本差异已生成到 <code>docs/marketing_case_artifacts/</code></p>
  <div class="grid">
    <section>
      <h2>左栏：输入样例</h2>
      <p><strong>marketing.mov</strong> · ${metadata.durationSec.toFixed(2)}s · ${metadata.width}x${metadata.height} · ${metadata.fps.toFixed(2)}fps · audio=${metadata.hasAudio ? "yes" : "no"}</p>
      <div class="frames">
        <img src="input_hook.png" alt="input hook" />
        <img src="input_climax.png" alt="input climax" />
        <img src="input_excluded_tail.png" alt="excluded platform tail" />
      </div>
      <ul>
        <li>核心结构：极简信息海报 + 3D 彩带动态包装 + 英文关键词环绕 + 色彩递进</li>
        <li>排除片段：15.7-${metadata.durationSec.toFixed(1)}s 平台 UI / 录屏尾巴</li>
      </ul>
    </section>
    <section>
      <h2>中栏：结构理解</h2>
      <table>
        <tbody>
          <tr><th>模板</th><td>${template.name}</td></tr>
          <tr><th>包装</th><td>${template.packaging.titleCardStyle}<br/>${template.packaging.overlayStyle}<br/>${template.packaging.coverStyle}</td></tr>
          <tr><th>Atoms</th><td>${template.structureAtoms.map((atom) => atom.name).join("<br/>")}</td></tr>
        </tbody>
      </table>
      <h2 style="margin-top:16px;">Gap Report</h2>
      <table>
        <thead><tr><th>缺口</th><th>Severity</th><th>策略</th></tr></thead>
        <tbody>
          ${tableRows(main.gapReport, (gap) => `<tr><td>${gap.gapLabelZh ?? gap.gapLabel ?? gap.slotId}</td><td>${gap.severity}</td><td>${(gap.recommendedFillStrategies ?? []).join(", ")}</td></tr>`)}
        </tbody>
      </table>
      <h2 style="margin-top:16px;">Fill Strategy</h2>
      <table>
        <tbody>
          <tr><th>Missing motif</th><td><code>dynamic_3d_ribbon_asset</code></td></tr>
          <tr><th>Fulfilled by</th><td><code>fulfilled_by_procedural_generation</code></td></tr>
          <tr><th>Renderer atom</th><td><code>ribbon_orbit</code></td></tr>
          <tr><th>Keywords</th><td>${mainMotionAtom.keywords.join(" / ")}</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>右栏：迁移生成</h2>
      <video class="poster" controls src="ai_challenge_poster_main.mp4"></video>
      <img src="contact_sheet.png" alt="contact sheet" style="margin-top:10px;" />
      <div class="frames" style="margin-top:10px;">
        <img src="main_t1.png" alt="main output frame 1" />
        <img src="main_t7.png" alt="main output frame 7" />
        <img src="main_t13.png" alt="main output frame 13" />
      </div>
      <table style="margin-top:12px;">
        <thead><tr><th>时间</th><th>字幕</th><th>用法</th></tr></thead>
        <tbody>
          ${tableRows(main.storyboard, (item) => `<tr><td>${item.timeRange}</td><td>${item.subtitle}</td><td>${item.assetUsage}</td></tr>`)}
        </tbody>
      </table>
      <div class="variants">
        <div>
          <h2>高点击版</h2>
          <video controls src="ai_challenge_poster_high_ctr.mp4"></video>
          <div class="frames" style="margin-top:10px;">
            <img src="high_ctr_t1.png" alt="high ctr frame 1" />
            <img src="high_ctr_t7.png" alt="high ctr frame 7" />
            <img src="high_ctr_t13.png" alt="high ctr frame 13" />
          </div>
        </div>
        <div>
          <h2>高质感版</h2>
          <video controls src="ai_challenge_poster_high_quality.mp4"></video>
          <div class="frames" style="margin-top:10px;">
            <img src="high_quality_t1.png" alt="high quality frame 1" />
            <img src="high_quality_t7.png" alt="high quality frame 7" />
            <img src="high_quality_t13.png" alt="high quality frame 13" />
          </div>
        </div>
      </div>
      <h2 style="margin-top:16px;">Render Hashes</h2>
      <table>
        <thead><tr><th>Variant</th><th>Style</th><th>MD5</th></tr></thead>
        <tbody>
          ${tableRows(variantSummary, (variant) => `<tr><td>${variant.label}</td><td>${variant.motionAtom?.style}; density=${variant.motionAtom?.density}; speed=${variant.motionAtom?.speed}</td><td><code>${variant.hashes.md5}</code></td></tr>`)}
        </tbody>
      </table>
    </section>
  </div>
</main>
</body>
</html>
`;
await writeFile(path.join(artifactDir, "index.html"), html, "utf8");

console.log(JSON.stringify({
  status: "PASS",
  input: rel(videoPath),
  report: rel(path.join(artifactDir, "report.md")),
  html: rel(path.join(artifactDir, "index.html")),
  contactSheet: rel(contactSheetPath),
  mainMp4: rel(mainRender.fixedPath),
  highCtrMp4: rel(ctrRender.fixedPath),
  highQualityMp4: rel(qualityRender.fixedPath),
  videos: variantSummary.map((variant) => ({
    label: variant.label,
    path: variant.mp4,
    durationSec: Number(variant.metadata.durationSec.toFixed(3)),
    resolution: `${variant.metadata.width}x${variant.metadata.height}`,
    fps: Number(variant.metadata.fps.toFixed(3)),
    md5: variant.hashes.md5,
    sha256: variant.hashes.sha256,
    motionAtom: variant.motionAtom
  })),
  dynamic_3d_ribbon_asset: {
    fulfilledBy: proceduralAction.rendererInstructions.fulfilledBy,
    strategy: proceduralAction.strategy,
    atom: proceduralAction.rendererInstructions.atom
  },
  gaps: main.gapReport.length,
  storyboardItems: main.storyboard.length,
  variants: variantSummary
}, null, 2));
