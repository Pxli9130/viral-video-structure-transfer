#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = path.join(ROOT, "docs/artifacts/learned_samples_max");
const DEFAULT_OUT = path.join(ROOT, "docs/artifacts/submission_pack");
const CASES = ["marketing", "editing", "motion_graph_1", "motion_graph_2"];

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

function rel(file, from) {
  return path.relative(from, file).split(path.sep).join("/");
}

async function copyIfExists(src, dest) {
  if (!existsSync(src)) return false;
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  return true;
}

function directFidelity(caseName, src, analysis, template, timeline, recipe, generation) {
  const ev = analysis?.evidenceTimeline ?? analysis ?? {};
  const layers = recipe?.layers ?? [];
  const clips = recipe?.clips ?? [];
  const counts = {
    analysis: {
      visualElements: ev.visualElementGraph?.elements?.length ?? 0,
      typographyRuns: ev.typographyEvidence?.length ?? 0,
      audioLayers: Object.keys(ev.audioStructure?.estimatedLayers ?? {}).length,
      motionAtoms: Array.isArray(ev.motionAtoms) ? ev.motionAtoms.length : analysis?.motionGeometry?.ribbonMotion ? 1 : 0,
      heroDescriptors: ev.heroDescriptor ? 1 : 0
    },
    template: {
      visualElements: template?.visualElementGraph?.elements?.length ?? 0,
      typographyRuns: template?.typographyEvidence?.length ?? 0,
      audioLayers: Object.keys(template?.audioStructure?.estimatedLayers ?? {}).length,
      motionAtoms: template?.motionAtoms?.length ?? 0,
      heroDescriptors: template?.heroDescriptor ? 1 : 0
    },
    timeline: {
      clips: timeline?.clips?.length ?? 0,
      layers: (timeline?.clips ?? []).flatMap((clip) => clip.layers ?? []).length,
      bboxNorm: (timeline?.clips ?? []).flatMap((clip) => clip.layers ?? []).filter((layer) => layer.layout?.bboxNorm || layer.style?.typography?.bboxNorm).length,
      fontSizeRatio: (timeline?.clips ?? []).flatMap((clip) => clip.layers ?? []).filter((layer) => layer.typography?.fontSizeRatio || layer.style?.typography?.fontSizeRatio).length,
      motionAtoms: timeline?.renderPlan?.motionAtoms?.length ?? 0,
      audioLayers: Object.keys(timeline?.renderPlan?.audioPlan?.layers ?? {}).length
    },
    recipe: {
      clips: clips.length,
      mediaLayers: layers.filter((layer) => layer.type === "media").length,
      textLayers: layers.filter((layer) => layer.type === "text").length,
      motionAtomLayers: layers.filter((layer) => layer.type === "motion_atom").length + (recipe?.motionAtoms?.length ?? 0),
      audioLayers: layers.filter((layer) => layer.type === "audio").length || Object.keys(recipe?.global?.audioPlan?.layers ?? {}).length,
      primitiveHistogram: primitiveHistogram(recipe)
    }
  };
  const droppedEvidence = [];
  if (counts.analysis.visualElements > 0 && counts.template.visualElements === 0) droppedEvidence.push({ kind: "visualElements", firstLossLayer: "analysis->template", severity: "fatal" });
  if (counts.analysis.typographyRuns > 0 && counts.recipe.textLayers === 0) droppedEvidence.push({ kind: "typography", firstLossLayer: "template->recipe", severity: "fatal" });
  if ((counts.template.motionAtoms || counts.timeline.motionAtoms) > 0 && counts.recipe.motionAtomLayers === 0) droppedEvidence.push({ kind: "motionAtoms", firstLossLayer: "timeline->recipe", severity: "fatal" });
  if (counts.analysis.audioLayers > 0 && counts.recipe.audioLayers === 0) droppedEvidence.push({ kind: "audio", firstLossLayer: "template->recipe", severity: "fatal" });
  return {
    case: caseName,
    status: droppedEvidence.some((item) => item.severity === "fatal") ? "fail" : "pass",
    paths: {
      caseName,
      analysis: path.join(src, "analysis.json"),
      template: path.join(src, "learned-template.json"),
      timeline: path.join(src, "timeline.json"),
      recipe: path.join(src, "render-recipe.json"),
      generation: path.join(src, "generation.json"),
      routeSummary: path.join(src, "model-route-summary.json")
    },
    counts,
    droppedEvidence,
    artifactHints: {
      recipeVersion: recipe?.version ?? recipe?.schemaVersion ?? "missing",
      templateVideoType: template?.videoType,
      generationId: generation?.id,
      modelRouteSummary: recipe?.modelRouteSummary?.summary ?? generation?.modelRouteSummary?.summary,
      recipeLintStatus: recipe?.recipeLintReport?.status ?? generation?.recipeLintReport?.status,
      videoCriticScore: recipe?.videoCriticReport?.score ?? generation?.videoCriticReport?.score
    }
  };
}

function structureExplanation(caseName, template, recipe, generation, gapReport, fidelity, visualQa) {
  const expected =
    caseName === "marketing"
      ? "poster / ribbon / clean product packaging"
      : caseName === "editing"
        ? "beat-cut / kinetic text / CTA emphasis"
        : "motion-graphic kinetic grammar";
  return `# Structure Explanation: ${caseName}

## Sample Category

Expected structure family: ${expected}

## What Was Learned

- Template type: ${template?.videoType ?? "n/a"}
- Evidence counts: visual ${fidelity?.counts?.template?.visualElements ?? 0}, typography ${fidelity?.counts?.template?.typographyRuns ?? 0}, audio ${fidelity?.counts?.template?.audioLayers ?? 0}, motion ${fidelity?.counts?.template?.motionAtoms ?? 0}
- Primitive histogram: \`${JSON.stringify(primitiveHistogram(recipe))}\`

## What Was Mapped To New Content

- Target product/theme: ${recipe?.productTheme?.productName ?? recipe?.productTheme?.name ?? "AeroSpin"}
- Renderable media layers: ${layerCounts(recipe).media}
- Text layers: ${layerCounts(recipe).text}
- Motion atom layers: ${layerCounts(recipe).motion}
- Audio layers: ${layerCounts(recipe).audio}

## Gap / Fill Summary

${Array.isArray(gapReport) && gapReport.length ? gapReport.slice(0, 8).map((gap) => `- ${gap.slotId ?? "slot"}: ${gap.status ?? "n/a"}; ${gap.reason ?? ""}; repair=${gap.selectedRepair?.strategy ?? gap.recommendedFillStrategies?.[0] ?? "n/a"}`).join("\n") : "- No explicit gap entries recorded."}

## What Was Not Copied

- Sample frames are evidence-only.
- Sample audio is evidence-only.
- Watermarks and prompt instructions are not renderable display text.
- Generated/user target assets must carry provenance.

## Visual QA

- Risk: ${visualQa?.risk ?? "not generated"}
- Top suggestions: ${(visualQa?.topSuggestions ?? ["run scripts/visual-qa-report.mjs --all-cases"]).join("; ")}
`;
}

function writeVersionSmoke(caseRoot) {
  const recipe = readJson(path.join(caseRoot, "render-recipe.json"));
  if (!recipe) return { status: "skipped", reason: "missing render-recipe.json" };
  return import(path.join(ROOT, "packages/shared/dist/index.js")).then(({ buildRecipeVersions, planNaturalEditPatch, lintRenderRecipe }) => {
    const versions = buildRecipeVersions(recipe, ["high_click", "high_quality"]);
    const diffLines = ["# Version Diff Smoke", ""];
    writeFileSync(path.join(caseRoot, "render-recipe.base.json"), JSON.stringify(recipe, null, 2));
    for (const version of versions) {
      writeFileSync(path.join(caseRoot, `render-recipe.${version.strategy}.json`), JSON.stringify(version.recipe, null, 2));
      const lint = lintRenderRecipe(version.recipe);
      diffLines.push(`## ${version.strategy}`, "", `- lint: ${lint.status}`, `- changed dimensions: ${version.diff.changedDimensions.map((item) => item.dimension).join(", ") || "none"}`, "");
      for (const item of version.diff.changedDimensions) {
        diffLines.push(`- ${item.dimension}: ${JSON.stringify(item.before)} -> ${JSON.stringify(item.after)}; ${item.reason}`);
      }
      diffLines.push("");
    }
    writeFileSync(path.join(caseRoot, "version-diff.md"), diffLines.join("\n"));

    const commands = ["开头更抓人一些", "减少字幕，增强节奏感", "把商品信息提前"];
    const patches = commands.map((command) => {
      const patch = planNaturalEditPatch(command, recipe);
      const lint = lintRenderRecipe(patch.updatedRecipe ?? recipe);
      const outFile = `render-recipe.natural-edit.${patch.intent}.json`;
      if (patch.updatedRecipe) writeFileSync(path.join(caseRoot, outFile), JSON.stringify(patch.updatedRecipe, null, 2));
      return {
        command,
        intent: patch.intent,
        renderNeeded: patch.renderNeeded,
        safetyChecked: patch.safetyChecked,
        lintStatus: lint.status,
        operationCount: patch.patches.length,
        output: outFile,
        explanationZh: patch.explanationZh,
        patches: patch.patches
      };
    });
    writeFileSync(path.join(caseRoot, "natural-edit-patches.json"), JSON.stringify({ generatedAt: new Date().toISOString(), patches }, null, 2));
    writeFileSync(path.join(caseRoot, "natural-edit-demo.md"), `# Natural Edit Smoke

${patches.map((patch) => `## ${patch.command}

- intent: ${patch.intent}
- renderNeeded: ${patch.renderNeeded}
- safetyChecked: ${patch.safetyChecked}
- recipe lint: ${patch.lintStatus}
- operations: ${patch.operationCount}
- output: ${patch.output}
- explanation: ${patch.explanationZh}
`).join("\n")}
`);
    return { status: "pass", versions: versions.map((v) => v.strategy), naturalEdits: patches.map((p) => p.intent) };
  });
}

async function packageCase(caseName, sourceRoot, outRoot) {
  const src = path.join(sourceRoot, caseName);
  const dest = path.join(outRoot, caseName);
  if (!existsSync(src)) throw new Error(`Missing case artifact root: ${src}`);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  const generation = readJson(path.join(src, "generation.json"));
  const timeline = readJson(path.join(src, "timeline.json")) ?? generation?.timeline;
  const recipe = readJson(path.join(src, "render-recipe.v4.1.json")) ?? readJson(path.join(src, "render-recipe.json")) ?? timeline?.renderPlan?.renderRecipe;
  const template = readJson(path.join(src, "learned-template.json"))?.template ?? readJson(path.join(src, "learned-template.json"));
  const gapReport = readJson(path.join(src, "gap-report.json")) ?? timeline?.gapReport ?? generation?.gapReport ?? [];
  const visualQa = readJson(path.join(src, "visual-qa-report.json"));
  const fidelity = directFidelity(caseName, src, readJson(path.join(src, "analysis.json")), template, timeline, recipe, generation);

  writeFileSync(path.join(src, "fidelity-report.json"), JSON.stringify(fidelity, null, 2));
  writeFileSync(path.join(src, "structure-explanation.md"), structureExplanation(caseName, template, recipe, generation, gapReport, fidelity, visualQa));

  if (caseName === "marketing") await writeVersionSmoke(src);

  const files = [
    "final.mp4",
    "render-recipe.json",
    "render-recipe.v4.1.json",
    "render-recipe.base.json",
    "render-recipe.high_click.json",
    "render-recipe.high_quality.json",
    "version-diff.md",
    "natural-edit-patches.json",
    "natural-edit-demo.md",
    "learned-template.json",
    "analysis.json",
    "timeline.json",
    "generation.json",
    "gap-report.json",
    "model-route-summary.json",
    "model-route-summary.md",
    "provider-decisions.json",
    "render-contact-sheet.png",
    "final-gates.json",
    "visual-qa-report.json",
    "visual-qa-report.md",
    "fidelity-report.json",
    "structure-explanation.md"
  ];
  const copied = [];
  for (const file of files) {
    if (await copyIfExists(path.join(src, file), path.join(dest, file))) copied.push(file);
  }
  await copyIfExists(path.join(src, "preview_frames"), path.join(dest, "preview_frames"));

  return {
    case: caseName,
    sourceRoot: src,
    outputRoot: dest,
    copied,
    evidenceCounts: evidenceCounts(template),
    layerCounts: layerCounts(recipe),
    primitiveHistogram: primitiveHistogram(recipe),
    fidelityStatus: fidelity.status,
    finalGatesStatus: readJson(path.join(src, "final-gates.json"))?.status,
    visualQaRisk: visualQa?.risk ?? "missing",
    links: {
      finalMp4: existsSync(path.join(dest, "final.mp4")) ? "final.mp4" : undefined,
      contactSheet: existsSync(path.join(dest, "render-contact-sheet.png")) ? "render-contact-sheet.png" : undefined,
      visualQa: existsSync(path.join(dest, "visual-qa-report.md")) ? "visual-qa-report.md" : undefined
    }
  };
}

function indexMarkdown(outRoot, rows) {
  const table = rows.map((row) => `| ${row.case} | [video](${row.case}/final.mp4) | [contact](${row.case}/render-contact-sheet.png) | ${row.evidenceCounts.visual}/${row.evidenceCounts.typography}/${row.evidenceCounts.audio}/${row.evidenceCounts.motionAtoms} | ${row.layerCounts.media}/${row.layerCounts.text}/${row.layerCounts.motion}/${row.layerCounts.audio} | \`${JSON.stringify(row.primitiveHistogram)}\` | ${row.fidelityStatus} | ${row.finalGatesStatus} | ${row.visualQaRisk} |`).join("\n");
  return `# Spec v4.2 Submission Pack

This pack is generated from local artifacts only. It does not contain fabricated videos or placeholder replacements.

| Case | final.mp4 | contact sheet | evidence v/t/a/m | layers media/text/motion/audio | primitive histogram | fidelity | final gates | visual QA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${table}

## Safety / Route Summary

- Sample video pixels/audio are used as local structure evidence only.
- Provider strict policy was evaluated with cloud disabled.
- External sample media upload count is expected to remain 0.
- Generated target assets must carry provenance.

## Known Limitations

- FFmpeg final.mp4 is the canonical local output for this pack.
- Remotion fresh host render is pending unless \`scripts/verify-remotion-host.mjs\` succeeds outside the sandbox.
- Visual QA is deterministic and heuristic; human review of final.mp4 and contact sheets is still required.

## Reproduce

\`\`\`bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm test
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/evaluate-model-routes.mjs --offline --json --strict-policy
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/visual-qa-report.mjs --all-cases
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-showcase-report.mjs
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-submission-artifacts.mjs
\`\`\`
`;
}

function indexHtml(rows) {
  const cards = rows.map((row) => `<section>
  <h2>${row.case}</h2>
  <video controls src="${row.case}/final.mp4"></video>
  <img src="${row.case}/render-contact-sheet.png" alt="${row.case} contact sheet" />
  <p>Evidence visual/typography/audio/motion: ${row.evidenceCounts.visual}/${row.evidenceCounts.typography}/${row.evidenceCounts.audio}/${row.evidenceCounts.motionAtoms}</p>
  <p>Layers media/text/motion/audio: ${row.layerCounts.media}/${row.layerCounts.text}/${row.layerCounts.motion}/${row.layerCounts.audio}</p>
  <p>Primitive histogram: <code>${JSON.stringify(row.primitiveHistogram)}</code></p>
  <p>Fidelity: ${row.fidelityStatus}; final gates: ${row.finalGatesStatus}; visual QA risk: ${row.visualQaRisk}</p>
  <p><a href="${row.case}/structure-explanation.md">structure explanation</a> · <a href="${row.case}/visual-qa-report.md">visual QA</a></p>
</section>`).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Spec v4.2 Submission Pack</title><style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f6f7f9;color:#172033}main{max-width:1280px;margin:auto;padding:24px}section{background:white;border:1px solid #d8dee8;border-radius:8px;padding:16px;margin:16px 0}video,img{max-width:420px;width:100%;display:block;margin:8px 0;background:#05060a}code{white-space:pre-wrap}</style></head><body><main><h1>Spec v4.2 Submission Pack</h1><p>学结构，不抄内容。以下视频和报告均来自本地 artifacts。</p>${cards}</main></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(args.root ?? DEFAULT_ROOT);
  const outRoot = path.resolve(args.out ?? DEFAULT_OUT);
  const cases = String(args.cases ?? CASES.join(",")).split(",").map((item) => item.trim()).filter(Boolean);
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  const rows = [];
  for (const caseName of cases) rows.push(await packageCase(caseName, sourceRoot, outRoot));
  await writeFile(path.join(outRoot, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), cases: rows }, null, 2));
  await writeFile(path.join(outRoot, "index.md"), indexMarkdown(outRoot, rows));
  await writeFile(path.join(outRoot, "index.html"), indexHtml(rows));
  console.log(JSON.stringify({ status: "pass", outRoot, cases: rows.map((row) => ({ case: row.case, visualQaRisk: row.visualQaRisk })) }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
