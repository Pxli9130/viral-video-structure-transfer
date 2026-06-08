#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = [
  { name: "motion_graph_2", input: "test_videos/motion_graph_2.mov", expectation: "kinetic motion graph / card / sweep grammar" },
  { name: "motion_graph_1", input: "test_videos/motion_graph_1.mov", expectation: "kinetic motion graph / card / sweep grammar" },
  { name: "marketing", input: "test_videos/marketing.mov", expectation: "poster, ribbon, clean product packaging" },
  { name: "editing", input: "test_videos/editing.mov", expectation: "beat-cut rhythm and text emphasis" }
];

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

function redact(text, env = process.env) {
  let output = String(text ?? "");
  for (const key of Object.keys(env)) {
    if (!/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) continue;
    const value = env[key];
    if (value && value.length >= 8) output = output.split(value).join("[REDACTED]");
  }
  return output;
}

function probe(file) {
  if (!existsSync(file)) return undefined;
  const ffprobe = process.env.FFPROBE_PATH && process.env.FFPROBE_PATH.includes("/") ? process.env.FFPROBE_PATH : "ffprobe";
  const res = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], {
    cwd: ROOT,
    encoding: "utf8"
  });
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

function listPreviewFrames(dir) {
  const preview = path.join(dir, "preview_frames");
  if (!existsSync(preview)) return [];
  return readdirSync(preview).filter((file) => /\.(png|jpe?g|webp)$/i.test(file)).sort();
}

function runNode(args, options = {}) {
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: options.env ?? process.env
  });
  return { ...res, stdout: redact(res.stdout, options.env), stderr: redact(res.stderr, options.env) };
}

function runCommand(command, args, options = {}) {
  const res = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: options.env ?? process.env
  });
  return { ...res, stdout: redact(res.stdout, options.env), stderr: redact(res.stderr, options.env) };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function primitiveHistogram(recipe) {
  const hist = {};
  for (const clip of recipe?.clips ?? []) hist[clip.selectedPrimitive ?? "<none>"] = (hist[clip.selectedPrimitive ?? "<none>"] ?? 0) + 1;
  return hist;
}

function evidenceCounts(template, analysis, recipe) {
  const ev = analysis?.evidenceTimeline ?? analysis ?? {};
  const layers = recipe?.layers ?? [];
  return {
    templateVisual: template?.visualElementGraph?.elements?.length ?? 0,
    templateTypography: template?.typographyEvidence?.length ?? 0,
    templateAudio: Object.keys(template?.audioStructure?.estimatedLayers ?? {}).length,
    templateMotion: template?.motionAtoms?.length ?? 0,
    analysisVisual: ev.visualElementGraph?.elements?.length ?? 0,
    analysisTypography: ev.typographyEvidence?.length ?? 0,
    recipeMedia: layers.filter((layer) => layer.type === "media").length,
    recipeText: layers.filter((layer) => layer.type === "text").length,
    recipeMotion: layers.filter((layer) => layer.type === "motion_atom").length,
    recipeAudio: layers.filter((layer) => layer.type === "audio").length
  };
}

async function writeIfExists(src, dest) {
  if (existsSync(src)) await copyFile(src, dest);
}

function routeRows(providerDecisions) {
  return (providerDecisions ?? []).map((decision) => ({
    task: decision.task,
    selectedProvider: decision.selectedProvider,
    fallbackUsed: Boolean(decision.fallbackUsed),
    fallbackReason: decision.fallbackReason,
    externalSampleAnalysis: decision.consumesSamplePixelsExternally || decision.consumesSampleAudioExternally || decision.consumesSampleVideoExternally,
    aigcSampleReference: Boolean(
      /generation/.test(decision.providerClass ?? "") &&
      (decision.mediaAccessPolicy?.samplePixelsAllowed || decision.mediaAccessPolicy?.sampleAudioAllowed || decision.mediaAccessPolicy?.sampleVideoUploadAllowed)
    )
  }));
}

async function ensureCaseArtifacts(caseSpec, outRoot, shared) {
  const dir = path.join(outRoot, caseSpec.name);
  const inputAbs = path.join(ROOT, caseSpec.input);
  const analysis = readJson(path.join(dir, "analysis.json"));
  const template = readJson(path.join(dir, "learned-template.json"))?.template ?? readJson(path.join(dir, "learned-template.json"));
  const generation = readJson(path.join(dir, "generation.json"));
  const timeline = readJson(path.join(dir, "timeline.json")) ?? generation?.timeline;
  const recipe = readJson(path.join(dir, "render-recipe.json")) ?? timeline?.renderPlan?.renderRecipe;
  const finalMp4 = path.join(dir, "final.mp4");
  const finalRemotion = path.join(dir, "final.remotion.mp4");

  await writeFile(path.join(dir, "input-info.json"), JSON.stringify({
    case: caseSpec.name,
    inputVideo: caseSpec.input,
    exists: existsSync(inputAbs),
    probe: probe(inputAbs),
    notes: caseSpec.expectation
  }, null, 2) + "\n");

  if (recipe) {
    await writeFile(path.join(dir, "render-recipe.v4.1.json"), JSON.stringify(recipe, null, 2) + "\n");
  }

  const techniqueAtoms = template?.techniqueAtoms?.length
    ? template.techniqueAtoms
    : template
      ? shared.extractTechniqueAtoms(template)
      : [];
  await writeFile(path.join(dir, "technique-atoms.json"), JSON.stringify(techniqueAtoms, null, 2) + "\n");
  await writeFile(path.join(dir, "fill-plan.json"), JSON.stringify(generation?.fillPlan ?? timeline?.fillPlan ?? [], null, 2) + "\n");

  const generationDecisions = generation?.providerDecisions ?? recipe?.providerDecisions ?? [];
  const analysisDecisions = [
    ...(analysis?.providerDecisions ?? []),
    ...(template?.modelRouteSummary?.decisions ?? []),
    ...(analysis?.modelRouteSummary?.decisions ?? [])
  ];
  const byTask = new Map(generationDecisions.map((decision) => [decision.task, decision]));
  for (const decision of analysisDecisions) byTask.set(decision.task, decision);
  const providerDecisions = Array.from(byTask.values());
  await writeFile(path.join(dir, "provider-decisions.json"), JSON.stringify(providerDecisions, null, 2) + "\n");
  const modelRouteSummary = providerDecisions.length ? shared.buildModelRouteSummary(providerDecisions) : generation?.modelRouteSummary ?? recipe?.modelRouteSummary;
  if (modelRouteSummary) {
    await writeFile(path.join(dir, "model-route-summary.json"), JSON.stringify({
      mode: "max_ability_run",
      generatedAt: new Date().toISOString(),
      summary: modelRouteSummary,
      providerDecisions,
      safetyIssues: modelRouteSummary.unsafePolicyIssueMessages ?? modelRouteSummary.unsafePolicyIssues ?? []
    }, null, 2) + "\n");
    await writeFile(path.join(dir, "model-route-summary.md"), shared.providerDecisionsMarkdown(providerDecisions), "utf8");
  }

  await writeFile(path.join(dir, "recipe-lint-report.json"), JSON.stringify(generation?.recipeLintReport ?? recipe?.recipeLintReport ?? null, null, 2) + "\n");
  await writeFile(path.join(dir, "video-critic-report.json"), JSON.stringify(generation?.videoCriticReport ?? recipe?.videoCriticReport ?? null, null, 2) + "\n");
  const explanation = generation?.structureExplanation;
  await writeFile(path.join(dir, "structure-explanation.md"), [
    `# ${caseSpec.name} Structure Explanation`,
    "",
    explanation?.summaryZh ?? "No structure explanation was emitted by the generation pipeline.",
    "",
    ...(explanation?.providerSummary?.length ? ["## Provider Summary", "", ...explanation.providerSummary.map((item) => `- ${item}`), ""] : []),
    ...(explanation?.safetySummary?.length ? ["## Safety Summary", "", ...explanation.safetySummary.map((item) => `- ${item}`), ""] : [])
  ].join("\n"));

  const fidelity = runNode([
    path.join(ROOT, "scripts/inspect-learning-fidelity.mjs"),
    "--name", caseSpec.name,
    "--analysis", path.join(dir, "analysis.json"),
    "--template", path.join(dir, "learned-template.json"),
    "--timeline", path.join(dir, "timeline.json"),
    "--recipe", path.join(dir, "render-recipe.json"),
    "--generation", path.join(dir, "generation.json"),
    "--route-summary", path.join(dir, "model-route-summary.json")
  ]);
  let fidelityReport;
  try {
    fidelityReport = JSON.parse(fidelity.stdout);
  } catch {
    fidelityReport = { case: caseSpec.name, status: "error", stdout: fidelity.stdout, stderr: fidelity.stderr };
  }
  fidelityReport.commandStatus = fidelity.status ?? 1;
  await writeFile(path.join(dir, "fidelity-report.json"), JSON.stringify(fidelityReport, null, 2) + "\n");

  const gates = runNode([
    path.join(ROOT, "scripts/evaluate-final-gates.mjs"),
    "--case-root", dir,
    "--out", path.join(dir, "final-gates.json")
  ]);
  let finalGates = readJson(path.join(dir, "final-gates.json"));
  if (!finalGates) {
    finalGates = { status: "error", stdout: gates.stdout, stderr: gates.stderr, commandStatus: gates.status ?? 1 };
    await writeFile(path.join(dir, "final-gates.json"), JSON.stringify(finalGates, null, 2) + "\n");
  }

  if (!existsSync(finalRemotion)) {
    const review = existsSync(path.join(dir, "HUMAN_REVIEW_REPORT.md")) ? readFileSync(path.join(dir, "HUMAN_REVIEW_REPORT.md"), "utf8") : "";
    const match = review.match(/Remotion output:\s*(.+)/);
    await writeFile(path.join(dir, "remotion-render-error.txt"), `${match?.[1] ?? "final.remotion.mp4 was not produced."}\n`, "utf8");
  }

  return {
    case: caseSpec.name,
    input: caseSpec.input,
    inputProbe: probe(inputAbs),
    output: {
      finalMp4,
      finalMp4Info: fileInfo(finalMp4),
      finalProbe: probe(finalMp4),
      finalRemotion,
      finalRemotionInfo: fileInfo(finalRemotion),
      finalRemotionProbe: probe(finalRemotion),
      contactSheet: path.join(dir, "render-contact-sheet.png"),
      contactSheetInfo: fileInfo(path.join(dir, "render-contact-sheet.png")),
      previewFrames: listPreviewFrames(dir)
    },
    videoType: template?.videoType,
    aiEnrichmentStatus: template?.aiEnrichmentStatus,
    primitiveHistogram: primitiveHistogram(recipe),
    evidence: evidenceCounts(template, analysis, recipe),
    providerRows: routeRows(providerDecisions),
    generationMode: readJson(path.join(dir, "generation-mode.json"))?.generationMode,
    aigcMaterialFill: generation?.aigcMaterialFill
      ? {
          enabled: generation.aigcMaterialFill.enabled,
          provider: generation.aigcMaterialFill.provider,
          providers: generation.aigcMaterialFill.providers ?? [generation.aigcMaterialFill.provider].filter(Boolean),
          requestedProvider: generation.aigcMaterialFill.requestedProvider,
          externalProviderUsed: generation.aigcMaterialFill.externalProviderUsed,
          generatedTargetAssets: generation.aigcMaterialFill.generatedTargetAssets?.length ?? 0,
          sampleFramesSentExternally: generation.aigcMaterialFill.sampleFramesSentExternally
        }
      : null,
    fidelity: { status: fidelityReport.status, counts: fidelityReport.counts, droppedEvidence: fidelityReport.droppedEvidence ?? [] },
    finalGates: { status: finalGates.status, summary: finalGates.summary },
    recipeLintStatus: generation?.recipeLintReport?.status ?? recipe?.recipeLintReport?.status,
    videoCriticScore: generation?.videoCriticReport?.score ?? recipe?.videoCriticReport?.score,
    safety: {
      externalSampleMediaUploads: generation?.modelRouteSummary?.summary?.externalSampleMediaUploads ?? generation?.modelRouteSummary?.externalSampleMediaUploads,
      unsafePolicyIssues: generation?.modelRouteSummary?.summary?.unsafePolicyIssues ?? generation?.modelRouteSummary?.unsafePolicyIssues?.length,
      sampleFrameCopyAllowed: recipe?.sourcePolicy?.sampleFrameCopyAllowed,
      sampleAudioCopyAllowed: recipe?.sourcePolicy?.sampleAudioCopyAllowed,
      generatedProvenanceRequired: providerDecisions
        .filter((decision) => /generation/.test(decision.providerClass ?? "") && decision.providerClass !== "disabled")
        .every((decision) => decision.generatedAssetProvenanceRequired === true)
    }
  };
}

function providerUsageTable(rows) {
  const seen = new Map();
  for (const item of rows.flatMap((row) => row.providerRows.map((provider) => ({ case: row.case, ...provider })))) {
    const key = `${item.task}:${item.selectedProvider}:${item.fallbackUsed}:${item.externalSampleAnalysis}:${item.aigcSampleReference}`;
    const existing = seen.get(key) ?? { ...item, cases: [] };
    existing.cases.push(item.case);
    seen.set(key, existing);
  }
  return Array.from(seen.values()).map((item) => ({
    cases: item.cases.join(", "),
    task: item.task,
    selectedProvider: item.selectedProvider,
    fallbackUsed: item.fallbackUsed,
    fallbackReason: item.fallbackReason,
    externalSampleAnalysis: item.externalSampleAnalysis,
    aigcSampleReference: item.aigcSampleReference
  }));
}

async function writeAllContactSheet(rows, outRoot) {
  const inputs = rows.map((row) => path.join(outRoot, row.case, "render-contact-sheet.png")).filter((file) => existsSync(file));
  if (inputs.length < 4) return undefined;
  const args = ["-y", ...inputs.flatMap((file) => ["-i", file]), "-filter_complex",
    "[0:v]scale=360:-1[a];[1:v]scale=360:-1[b];[2:v]scale=360:-1[c];[3:v]scale=360:-1[d];[a][b]hstack=inputs=2[top];[c][d]hstack=inputs=2[bottom];[top][bottom]vstack=inputs=2[out]",
    "-map", "[out]", path.join(outRoot, "contact-sheet-all-cases.png")];
  const res = runCommand("ffmpeg", args);
  return { path: path.join(outRoot, "contact-sheet-all-cases.png"), status: res.status, stderr: res.stderr.slice(-1000) };
}

async function writeSummaries(rows, providerRows, outRoot, commandResults, allContactSheet) {
  const hardSuccess = rows.filter((row) => row.output.finalMp4Info.exists).length >= 4;
  const summary = {
    generatedAt: new Date().toISOString(),
    outRoot,
    hardSuccess,
    cases: rows,
    providerUsage: providerRows,
    commands: commandResults,
    allContactSheet
  };
  await writeFile(path.join(outRoot, "RUN_SUMMARY.json"), JSON.stringify(summary, null, 2) + "\n");

  const md = [
    "# Max Ability Four-Sample Pipeline Run Report",
    "",
    "## 1. Executive Summary",
    "",
    hardSuccess
      ? `Generated ${rows.filter((row) => row.output.finalMp4Info.exists).length}/4 canonical FFmpeg videos under \`${path.relative(ROOT, outRoot)}\`.`
      : `Only generated ${rows.filter((row) => row.output.finalMp4Info.exists).length}/4 canonical FFmpeg videos under \`${path.relative(ROOT, outRoot)}\`.`,
    "",
    "## 2. Inputs",
    "",
    "| Case | Input video | Exists? | Duration | Notes |",
    "|---|---|---:|---:|---|",
    ...rows.map((row) => `| ${row.case} | ${row.input} | ${existsSync(path.join(ROOT, row.input)) ? "yes" : "no"} | ${row.inputProbe?.durationSec?.toFixed(2) ?? "n/a"}s | ${CASES.find((item) => item.name === row.case)?.expectation ?? ""} |`),
    "",
    "## 3. Provider Usage",
    "",
    "| Cases | Provider/task | Used? | Selected provider | Fallback? | Reason | External sample analysis? | AIGC sample reference? |",
    "|---|---|---:|---|---:|---|---:|---:|",
    ...providerRows.map((row) => `| ${row.cases} | ${row.task} | yes | ${row.selectedProvider} | ${row.fallbackUsed ? "yes" : "no"} | ${(row.fallbackReason ?? "").replaceAll("|", "/")} | ${row.externalSampleAnalysis ? "yes" : "no"} | ${row.aigcSampleReference ? "yes" : "no"} |`),
    "",
    "## 4. Output Artifacts",
    "",
    "| Case | final.mp4 | final.remotion.mp4 | recipe | fidelity | final gates | contact sheet | preview frames |",
    "|---|---|---|---|---|---|---|---:|",
    ...rows.map((row) => `| ${row.case} | ${row.output.finalMp4Info.exists ? path.relative(ROOT, row.output.finalMp4) : "missing"} | ${row.output.finalRemotionInfo.exists ? path.relative(ROOT, row.output.finalRemotion) : "missing"} | ${path.relative(ROOT, path.join(outRoot, row.case, "render-recipe.v4.1.json"))} | ${row.fidelity.status} | ${row.finalGates.status} | ${row.output.contactSheetInfo.exists ? path.relative(ROOT, row.output.contactSheet) : "missing"} | ${row.output.previewFrames.length} |`),
    "",
    "## 5. Evidence Fidelity",
    "",
    "| Case | template visual | typography | audio | motion | recipe media | text layers | motionAtom | audio layers | status |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...rows.map((row) => `| ${row.case} | ${row.evidence.templateVisual} | ${row.evidence.templateTypography} | ${row.evidence.templateAudio} | ${row.evidence.templateMotion} | ${row.evidence.recipeMedia} | ${row.evidence.recipeText} | ${row.evidence.recipeMotion} | ${row.evidence.recipeAudio} | ${row.fidelity.status} |`),
    "",
    "## 6. Visual / Creative Summary",
    "",
    ...rows.flatMap((row) => [
      `### ${row.case}`,
      `- Learned structure: ${row.videoType ?? "unknown"}; AI enrichment: ${row.aiEnrichmentStatus ?? "unknown"}; generation mode: ${row.generationMode ?? "unknown"}.`,
      `- Transferred primitives: ${Object.entries(row.primitiveHistogram).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}.`,
      row.aigcMaterialFill?.enabled
        ? `- AIGC material fill: provider=${row.aigcMaterialFill.provider}, providers=${(row.aigcMaterialFill.providers ?? [row.aigcMaterialFill.provider]).join(",")}, requested=${row.aigcMaterialFill.requestedProvider}, external=${row.aigcMaterialFill.externalProviderUsed ? "yes" : "no"}, generatedTargetAssets=${row.aigcMaterialFill.generatedTargetAssets}, sampleFramesSentExternally=${row.aigcMaterialFill.sampleFramesSentExternally ? "yes" : "no"}.`
        : `- AIGC material fill did not run for this case; treat repeated fixtures/procedural media as fallback, not max ability.`,
      `- Output: ${row.output.finalProbe ? `${row.output.finalProbe.width}x${row.output.finalProbe.height}, ${row.output.finalProbe.durationSec.toFixed(2)}s` : "missing"}.`,
      ""
    ]),
    "## 7. Safety",
    "",
    "- Sample media was used as structure evidence only.",
    "- AIGC sample media references stayed disabled by env and route policy.",
    "- Generated AeroSpin target assets retain provenance metadata.",
    "- Raw prompt render risk is checked by recipe lint/final gates.",
    "- External VLM sample analysis is recorded in provider decisions when the router selects it.",
    "",
    "## 8. Commands Run",
    "",
    "| Command | Result | Notes |",
    "|---|---:|---|",
    ...commandResults.map((item) => `| \`${item.command}\` | ${item.status === 0 ? "pass" : "fail"} | ${item.notes ?? ""} |`),
    "",
    "## 9. Failures / Blockers",
    "",
    ...rows.flatMap((row) => {
      const issues = [];
      if (!row.output.finalMp4Info.exists) issues.push(`- ${row.case}: final.mp4 missing.`);
      if (!row.output.finalRemotionInfo.exists) issues.push(`- ${row.case}: final.remotion.mp4 missing; see remotion-render-error.txt.`);
      if (row.fidelity.status !== "pass") issues.push(`- ${row.case}: fidelity=${row.fidelity.status}.`);
      if (row.finalGates.status !== "pass") issues.push(`- ${row.case}: final gates=${row.finalGates.status}.`);
      return issues;
    }),
    rows.every((row) => row.output.finalMp4Info.exists && row.fidelity.status === "pass" && row.finalGates.status === "pass") ? "- None for canonical FFmpeg outputs." : "",
    "",
    "## 10. Next Best Improvement",
    "",
    "The highest-impact next step is visual QA on the four videos, then tune the renderer only where preview frames show repeated composition, text clipping, or weak case-specific motion grammar.",
    ""
  ];
  await writeFile(path.join(outRoot, "RUN_SUMMARY.md"), md.join("\n"));

  const cards = rows.map((row) => `
    <article>
      <h2>${row.case}</h2>
      <video controls src="${row.case}/final.mp4"></video>
      <p>${row.videoType ?? "unknown"} · fidelity=${row.fidelity.status} · gates=${row.finalGates.status}</p>
      <img src="${row.case}/render-contact-sheet.png" />
    </article>`).join("\n");
  await writeFile(path.join(outRoot, "index.html"), `<!doctype html>
<meta charset="utf-8">
<title>Max Ability Four-Sample Run</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;background:#111;color:#eee}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}
article{border:1px solid #333;padding:12px;background:#181818}
video,img{width:100%;max-height:520px;object-fit:contain;background:#000}
</style>
<h1>Max Ability Four-Sample Run</h1>
<main>${cards}</main>
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const outRoot = path.resolve(args.out ?? path.join(ROOT, "docs/artifacts/max_ability_runs", timestamp));
  const cloudDisabled = Boolean(args["no-cloud"] || args["offline-providers"]);
  const allowCloud = !cloudDisabled;
  const allowExternalVlm = allowCloud && !Boolean(args["no-external-vlm-sample-analysis"]);
  const noAigcSampleMedia = !Boolean(args["allow-aigc-sample-media"]);
  const postprocessOnly = Boolean(args["postprocess-only"]);

  await mkdir(outRoot, { recursive: true });
  for (const item of CASES) {
    if (!existsSync(path.join(ROOT, item.input))) throw new Error(`Missing input video: ${item.input}`);
  }

  const runnerArgs = [
    path.join(ROOT, "scripts/run-learn-samples-max.mjs"),
    "--samples", CASES.map((item) => item.input).join(","),
    "--out", outRoot
  ];
  let runner = { status: 0, stdout: "", stderr: "" };
  if (!postprocessOnly) {
    const port = Number(args.port ?? await freePort());
    const seedanceKey = process.env.SEEDANCE_ARK_API_KEY ?? process.env.SEEDANCE_API_KEY ?? process.env.SEEDREAM_ARK_API_KEY ?? process.env.ARK_API_KEY ?? "";
    const env = {
      ...process.env,
      CONDA_BASE: process.env.CONDA_BASE ?? "/home/pxli/anaconda3",
      VIRAL_CONDA_ENV: process.env.VIRAL_CONDA_ENV ?? "viral",
      APP_PORT: String(port),
      VVST_API_BASE: `http://localhost:${port}`,
      ALLOW_CLOUD_PROVIDERS: allowCloud ? "1" : "0",
      ALLOW_EXTERNAL_VLM_SAMPLE_ANALYSIS: allowExternalVlm ? "1" : "0",
      ALLOW_EXTERNAL_SAMPLE_MEDIA: allowExternalVlm ? "1" : "0",
      ALLOW_EXTERNAL_ASR_SAMPLE_ANALYSIS: allowExternalVlm ? "1" : "0",
      VLM_PROVIDER: allowExternalVlm ? (process.env.VLM_PROVIDER ?? "gemini") : "heuristic",
      AI_PROVIDER: process.env.AI_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : process.env.ARK_API_KEY ? "ark_doubao" : "gemini"),
      ASR_PROVIDER: process.env.ASR_PROVIDER ?? "faster_whisper",
      OCR_PROVIDER: process.env.OCR_PROVIDER ?? "easyocr",
      AIGC_IMAGE_PROVIDER: process.env.AIGC_IMAGE_PROVIDER ?? (process.env.GEMINI_API_KEY ? "google_gemini_image" : process.env.SEEDREAM_ARK_API_KEY ? "volcengine_seedream" : "deterministic_local_image_fill"),
      AIGC_IMAGE_BACKUP_PROVIDER: process.env.AIGC_IMAGE_BACKUP_PROVIDER ?? (process.env.SEEDREAM_ARK_API_KEY ? "volcengine_seedream" : ""),
      AIGC_VIDEO_PROVIDER: process.env.AIGC_VIDEO_PROVIDER ?? (allowCloud && seedanceKey ? "seedance_2_0" : "none"),
      AIGC_VIDEO_MODEL: process.env.AIGC_VIDEO_MODEL ?? "doubao-seedance-2-0-fast-260128",
      AIGC_VIDEO_MAX_ASSETS_PER_RUN: process.env.AIGC_VIDEO_MAX_ASSETS_PER_RUN ?? "1",
      SEEDANCE_ARK_API_KEY: process.env.SEEDANCE_ARK_API_KEY ?? seedanceKey,
      SEEDANCE_MODEL: process.env.SEEDANCE_MODEL ?? process.env.AIGC_VIDEO_MODEL ?? "doubao-seedance-2-0-fast-260128",
      SEEDANCE_GENERATE_AUDIO: process.env.SEEDANCE_GENERATE_AUDIO ?? process.env.AIGC_VIDEO_GENERATE_AUDIO ?? "true",
      SEEDANCE_WATERMARK: process.env.SEEDANCE_WATERMARK ?? process.env.AIGC_VIDEO_WATERMARK ?? "false",
      AIGC_ALLOW_EXTERNAL_UPLOAD: allowCloud ? "true" : "false",
      AIGC_ALLOW_SAMPLE_MEDIA: noAigcSampleMedia ? "false" : (process.env.AIGC_ALLOW_SAMPLE_MEDIA ?? "false"),
      AIGC_ALLOW_SAMPLE_FRAMES_TO_PROVIDER: "false",
      AIGC_ALLOW_SAMPLE_AUDIO_TO_PROVIDER: "false",
      AIGC_ALLOW_SAMPLE_VIDEO_TO_PROVIDER: "false",
      AIGC_ALLOW_TARGET_ASSETS_TO_PROVIDER: allowCloud ? "true" : "false"
    };
    if (args["use-all-providers"]) {
      env.ENABLE_HEAVY_LOCAL_ML = env.ENABLE_HEAVY_LOCAL_ML ?? "1";
      env.ENABLE_PADDLEOCR_VL = env.ENABLE_PADDLEOCR_VL ?? "1";
      env.ENABLE_PADDLEOCR = env.ENABLE_PADDLEOCR ?? "1";
      env.ENABLE_GROUNDING_DINO = env.ENABLE_GROUNDING_DINO ?? "1";
      env.ENABLE_SAM2 = env.ENABLE_SAM2 ?? "1";
      env.ENABLE_COTRACKER = env.ENABLE_COTRACKER ?? "1";
      env.ENABLE_BGE_M3 = env.ENABLE_BGE_M3 ?? "1";
    }
    runner = runNode(runnerArgs, { env });
    await writeFile(path.join(outRoot, "runner.stdout.log"), runner.stdout);
    await writeFile(path.join(outRoot, "runner.stderr.log"), runner.stderr);
    if (runner.status !== 0) {
      throw new Error(`run-learn-samples-max failed with status ${runner.status}; see ${path.relative(ROOT, path.join(outRoot, "runner.stderr.log"))}`);
    }
  }

  const shared = await import(path.join(ROOT, "packages/shared/dist/index.js"));
  const rows = [];
  for (const item of CASES) rows.push(await ensureCaseArtifacts(item, outRoot, shared));

  const providerRows = providerUsageTable(rows);
  const allContactSheet = await writeAllContactSheet(rows, outRoot);
  const commandResults = [
    { command: `node scripts/run-learn-samples-max.mjs --samples ${CASES.map((item) => item.input).join(",")} --out ${path.relative(ROOT, outRoot)}`, status: runner.status ?? 1, notes: `logs in ${path.relative(ROOT, outRoot)}` },
    ...rows.flatMap((row) => [
      { command: `node scripts/inspect-learning-fidelity.mjs --name ${row.case} ...`, status: row.fidelity.status === "pass" ? 0 : 1, notes: path.relative(ROOT, path.join(outRoot, row.case, "fidelity-report.json")) },
      { command: `node scripts/evaluate-final-gates.mjs --case-root ${path.relative(ROOT, path.join(outRoot, row.case))}`, status: row.finalGates.status === "pass" ? 0 : 1, notes: path.relative(ROOT, path.join(outRoot, row.case, "final-gates.json")) }
    ])
  ];
  await writeSummaries(rows, providerRows, outRoot, commandResults, allContactSheet);

  const finals = rows.filter((row) => row.output.finalMp4Info.exists);
  if (finals.length < 4) {
    throw new Error(`Expected at least 4 final.mp4 files, found ${finals.length}. See ${path.relative(ROOT, path.join(outRoot, "RUN_SUMMARY.md"))}`);
  }
  console.log(JSON.stringify({ status: "pass", outRoot, finalMp4: finals.length, remotionMp4: rows.filter((row) => row.output.finalRemotionInfo.exists).length }, null, 2));
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
