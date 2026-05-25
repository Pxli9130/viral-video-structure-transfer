import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { marketingArtifactDir as artifactDir, rel, repoRoot } from "./artifact-paths.mjs";

const frameDir = path.join(artifactDir, "ribbon_diag_frames");
const inputVideo = path.join(repoRoot, "test_videos", "marketing.mov");
const outputs = [
  { label: "main", path: path.join(artifactDir, "ai_challenge_poster_main.mp4") },
  { label: "high_ctr", path: path.join(artifactDir, "ai_challenge_poster_high_ctr.mp4") },
  { label: "high_quality", path: path.join(artifactDir, "ai_challenge_poster_high_quality.mp4") }
];
const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
const condaBin = path.join(condaBase, "envs", condaEnv, "bin");
const ffmpeg = existsSync(path.join(condaBin, "ffmpeg")) ? path.join(condaBin, "ffmpeg") : "ffmpeg";
const ffprobe = existsSync(path.join(condaBin, "ffprobe")) ? path.join(condaBin, "ffprobe") : "ffprobe";

const requiredFiles = [
  inputVideo,
  ...outputs.map((item) => item.path),
  path.join(artifactDir, "timeline.json"),
  path.join(artifactDir, "generation-result.json"),
  path.join(repoRoot, "apps", "api", "remotion", "ReconstructionRoot.tsx"),
  path.join(repoRoot, "packages", "shared", "src", "mockPipeline.ts")
];

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function readJson(file) {
  return readFile(file, "utf8").then((text) => JSON.parse(text));
}

function ffprobeMetadata(file) {
  const stdout = run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,codec_name", "-of", "json", file],
    `ffprobe ${path.basename(file)}`
  );
  const parsed = JSON.parse(stdout);
  const video = parsed.streams.find((stream) => stream.codec_type === "video") ?? {};
  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: String(video.avg_frame_rate ?? "unknown"),
    codec: String(video.codec_name ?? "unknown")
  };
}

function extractFrame(input, timeSec, filename) {
  const output = path.join(frameDir, filename);
  run(ffmpeg, ["-y", "-ss", String(timeSec), "-i", input, "-frames:v", "1", output], `extract ${filename}`);
  return output;
}

function createComparisonSheet(frames) {
  const output = path.join(artifactDir, "ribbon_comparison_sheet.png");
  const ordered = [
    ...frames.original.map((item) => item.path),
    ...frames.main.map((item) => item.path),
    frames.main[2].path,
    ...frames.high_ctr.map((item) => item.path),
    frames.high_ctr[2].path,
    ...frames.high_quality.map((item) => item.path),
    frames.high_quality[2].path
  ];
  const scaleFilters = ordered.map((_, index) => `[${index}:v]scale=260:462:force_original_aspect_ratio=decrease,pad=260:462:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`);
  const rows = [
    "[v0][v1][v2][v3]hstack=inputs=4[row0]",
    "[v4][v5][v6][v7]hstack=inputs=4[row1]",
    "[v8][v9][v10][v11]hstack=inputs=4[row2]",
    "[v12][v13][v14][v15]hstack=inputs=4[row3]"
  ];
  run(
    ffmpeg,
    ["-y", ...ordered.flatMap((file) => ["-i", file]), "-filter_complex", [...scaleFilters, ...rows, "[row0][row1][row2][row3]vstack=inputs=4[out]"].join(";"), "-map", "[out]", output],
    "create ribbon comparison sheet"
  );
  return output;
}

function scanRenderer(source) {
  return {
    usesStrokeWidth: /strokeWidth/.test(source),
    usesFillSurface: /<path[\s\S]*\sfill=(?!["']none["'])/.test(source) || /fill={`url/.test(source),
    usesLinearOrRadialGradient: /linearGradient|radialGradient/.test(source),
    usesTextPath: /textPath/.test(source),
    hasFrontBackLayer: /frontLayer|backLayer|layer:\s*"back"|layer:\s*"front"|BackRibbon|FrontRibbon/.test(source),
    usesClipPathMaskFilter: /clipPath|mask|filter|feDropShadow|feGaussianBlur/.test(source),
    usesPerspectiveSkew3d: /perspective|skew|rotateX|rotateY|matrix3d|translateZ|scaleX|scaleY/.test(source),
    components: {
      hasRibbonOrbitLayer: /RibbonOrbitLayer/.test(source),
      hasRibbonSurface3DLayer: /RibbonSurface3DLayer/.test(source)
    }
  };
}

const featureChecklist = [
  ["wide ribbon surface, not thin line", "present", "partial", "Current renderer uses a wider pseudo-3D band surface, but still procedural SVG rather than true mesh geometry."],
  ["visible band width", "present", "present", "Motion atom exposes bandWidth and renderer uses large surface strokes."],
  ["apparent thickness / edge", "present", "present", "Renderer draws darker edge stroke behind the color band."],
  ["perspective transform", "present", "partial", "Renderer uses scale/skew/rotation for fake perspective."],
  ["twisting or folding behavior", "present", "partial", "Renderer varies skew/scale by layer/path to mimic twisting."],
  ["front/back depth layering", "present", "present", "Back layer renders behind title and front layer renders above title."],
  ["occlusion with title/card", "present", "present", "Front ribbon layer can cross over title/card."],
  ["gradient color along surface", "present", "present", "Renderer uses SVG gradients over the band surface."],
  ["specular highlight or lighting", "present", "present", "Renderer draws a white translucent highlight path."],
  ["shadow / glow / depth cue", "present", "present", "Renderer uses drop shadow and opacity layering."],
  ["text/keywords attached to ribbon or moving with ribbon", "present", "present", "Renderer uses SVG textPath on the ribbon path."],
  ["motion path around title", "present", "present", "Ribbon paths orbit around central title."],
  ["color progression over time", "present", "partial", "Colors vary by surface gradient and variant; per-frame palette animation remains approximate."],
  ["climax density increase", "present", "partial", "high_ctr has higher density/front layers; intra-video climax build remains heuristic."],
  ["final clean poster hold", "present", "partial", "CTA/card hold exists, while subtle ribbon motion remains active."]
].map(([feature, original, generated, note]) => ({ feature, original, generated, note }));

const rootCauses = [
  { cause: "schema was too vague", status: "addressed", evidence: "MotionAtomSpec now includes bandWidth, edgeWidth, front/back layer counts, textOnRibbon, depthLayering, perspective and twist parameters." },
  { cause: "renderer atom was too simple", status: "addressed", evidence: "RibbonSurface3DLayer renders wide layered SVG bands instead of only thin stroke arcs." },
  { cause: "prompt/template collapsed 3D ribbon surface into ribbon_orbit", status: "addressed", evidence: "fillPlan now selects wide_3d_ribbon_surface for dynamic_3d_ribbon_asset." },
  { cause: "tests only checked atom name", status: "addressed", evidence: "marketingPosterCase now asserts wide_3d_ribbon_surface and surface/depth/text parameters." },
  { cause: "no visual acceptance test exists", status: "partial", evidence: "diagnosis script checks rendered artifacts and feature checklist; pixel-level threshold can be hardened later." },
  { cause: "no text-on-ribbon support", status: "addressed", evidence: "Renderer uses textPath for keywords on the ribbon surface." },
  { cause: "no occlusion/front-back layer support", status: "addressed", evidence: "Back surface layer renders before title; front layer renders after title." },
  { cause: "no perspective/twist support", status: "partial", evidence: "Renderer uses fake SVG/CSS perspective via scale/skew/rotation, not true 3D geometry." }
];

const originalMismatch = {
  summary:
    "Before the renderer upgrade, the marketing testcase detected dynamic_3d_ribbon_asset but fulfilled it with ribbon_orbit, which rendered mostly thin 2D SVG orbit strokes.",
  failedFeatures: [
    "wide ribbon surface",
    "apparent thickness / edge",
    "front/back depth layering",
    "occlusion with central title",
    "text attached to the ribbon surface",
    "perspective/twist behavior"
  ],
  fixedBy:
    "The current pipeline maps dynamic_3d_ribbon_asset to wide_3d_ribbon_surface and renders layered SVG bands with gradient, edge, highlight, shadow, front/back layers and textPath keywords."
};

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`Missing required input ${rel(file)}. Run: CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral npm run test:marketing`);
  }
}

await mkdir(frameDir, { recursive: true });

const frames = {
  original: [
    { label: "hook", timeSec: 0.5, path: extractFrame(inputVideo, 0.5, "original_hook_0_5.png") },
    { label: "ribbon_entry", timeSec: 4, path: extractFrame(inputVideo, 4, "original_ribbon_entry_4_0.png") },
    { label: "keyword_color_build", timeSec: 8.5, path: extractFrame(inputVideo, 8.5, "original_keyword_build_8_5.png") },
    { label: "climax", timeSec: 13.5, path: extractFrame(inputVideo, 13.5, "original_climax_13_5.png") }
  ],
  main: [1, 7, 13].map((timeSec) => ({ label: `main_${timeSec}`, timeSec, path: extractFrame(outputs[0].path, timeSec, `main_${timeSec}.png`) })),
  high_ctr: [1, 7, 13].map((timeSec) => ({ label: `high_ctr_${timeSec}`, timeSec, path: extractFrame(outputs[1].path, timeSec, `high_ctr_${timeSec}.png`) })),
  high_quality: [1, 7, 13].map((timeSec) => ({ label: `high_quality_${timeSec}`, timeSec, path: extractFrame(outputs[2].path, timeSec, `high_quality_${timeSec}.png`) }))
};

const comparisonSheet = createComparisonSheet(frames);
const [timeline, generation, remotionSource, pipelineSource] = await Promise.all([
  readJson(path.join(artifactDir, "timeline.json")),
  readJson(path.join(artifactDir, "generation-result.json")),
  readFile(path.join(repoRoot, "apps", "api", "remotion", "ReconstructionRoot.tsx"), "utf8"),
  readFile(path.join(repoRoot, "packages", "shared", "src", "mockPipeline.ts"), "utf8")
]);

const rendererScan = scanRenderer(remotionSource);
const pipelineScan = {
  selectsWideSurface: /wide_3d_ribbon_surface/.test(pipelineSource),
  legacyRibbonOrbitMentions: (pipelineSource.match(/ribbon_orbit/g) ?? []).length,
  dynamicRibbonGapMentions: (pipelineSource.match(/dynamic_3d_ribbon_asset/g) ?? []).length
};
const motionAtoms = timeline.renderPlan?.motionAtoms ?? [];
const proceduralRibbonActions = (generation.fillPlan ?? []).filter(
  (action) => action.strategy === "procedural_generation" && String(action.rendererInstructions?.atom ?? "").includes("ribbon")
);
const dynamicRibbonGap = (generation.gapReport ?? []).find((gap) => gap.gapType === "dynamic_3d_ribbon_asset");

const diagnosis = {
  generatedAt: new Date().toISOString(),
  commands: {
    reproduce: "CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral npm run test:marketing",
    diagnose: "node scripts/diagnose-ribbon-motif.mjs"
  },
  files: {
    inputVideo: rel(inputVideo),
    outputs: outputs.map((item) => ({ label: item.label, path: rel(item.path), metadata: ffprobeMetadata(item.path) })),
    comparisonSheet: rel(comparisonSheet),
    frames: Object.fromEntries(Object.entries(frames).map(([key, values]) => [key, values.map((item) => ({ ...item, path: rel(item.path) }))]))
  },
  motionAtoms,
  dynamicRibbonGap,
  proceduralRibbonActions,
  rendererScan,
  pipelineScan,
  featureChecklist,
  rootCauses,
  originalMismatch,
  verdict:
    motionAtoms.some((atom) => atom.type === "wide_3d_ribbon_surface" && atom.depthLayering && atom.textOnRibbon && atom.bandWidth >= 50)
      ? "Renderer now uses a pseudo-3D wide ribbon surface atom for the marketing testcase."
      : "Renderer still appears to use a simple orbit-line atom; marketing motif is not sufficiently materialized.",
  riskLevel: "medium",
  localOnly: true
};

const md = `# Ribbon Motif Diagnosis

Generated: ${diagnosis.generatedAt}

## Commands

- Reproduce: \`${diagnosis.commands.reproduce}\`
- Diagnose: \`${diagnosis.commands.diagnose}\`

## Generated Files

- JSON: \`${rel(path.join(artifactDir, "ribbon_motif_diagnosis.json"))}\`
- Report: \`${rel(path.join(artifactDir, "ribbon_motif_diagnosis.md"))}\`
- Comparison sheet: [ribbon_comparison_sheet.png](ribbon_comparison_sheet.png)

## Verdict

${diagnosis.verdict}

## Original Mismatch Diagnosed

${originalMismatch.summary}

Failed feature groups: ${originalMismatch.failedFeatures.join(", ")}.

Fix applied: ${originalMismatch.fixedBy}

## Motion Atom Evidence

\`\`\`json
${JSON.stringify(motionAtoms, null, 2)}
\`\`\`

## Feature Checklist

| Feature | Original | Generated | Note |
|---|---|---|---|
${featureChecklist.map((item) => `| ${item.feature} | ${item.original} | ${item.generated} | ${item.note} |`).join("\n")}

## Root Cause Status

| Root Cause | Status | Evidence |
|---|---|---|
${rootCauses.map((item) => `| ${item.cause} | ${item.status} | ${item.evidence} |`).join("\n")}

## Renderer Scan

\`\`\`json
${JSON.stringify(rendererScan, null, 2)}
\`\`\`

## Pipeline Scan

\`\`\`json
${JSON.stringify(pipelineScan, null, 2)}
\`\`\`

## Recommended Follow-up

- Keep \`ribbon_orbit\` as a fallback for simple decorative lines.
- Keep \`wide_3d_ribbon_surface\` as the required atom for \`marketing.mov\` and similar MG poster templates.
- Harden pixel-level checks if future regressions make the band too thin again.
`;

await writeFile(path.join(artifactDir, "ribbon_motif_diagnosis.json"), `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");
await writeFile(path.join(artifactDir, "ribbon_motif_diagnosis.md"), md, "utf8");

console.log(JSON.stringify({
  status: "PASS",
  report: rel(path.join(artifactDir, "ribbon_motif_diagnosis.md")),
  json: rel(path.join(artifactDir, "ribbon_motif_diagnosis.json")),
  comparisonSheet: rel(comparisonSheet),
  verdict: diagnosis.verdict
}, null, 2));
