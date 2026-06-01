#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = path.join(ROOT, "docs/artifacts/learned_samples_max");
const PROMPT_TOKENS = ["15 秒", "15秒", "高转化", "CTA", "prompt", "生成", "换成", "版本", "镜头", "素材", "文案：", "文案:", "要求：", "要求:"];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  if (!file || !existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"));
}

function firstExisting(paths) {
  return paths.find((p) => existsSync(p));
}

function artifactPaths() {
  const c = arg("--case");
  if (c) {
    const dir = path.join(DEFAULT_ROOT, c);
    return {
      caseName: c,
      analysis: firstExisting([path.join(dir, "analysis.json"), path.join(dir, "analysis/analysis.json")]),
      template: firstExisting([path.join(dir, "learned-template.json"), path.join(dir, "template/learned-template.json")]),
      timeline: firstExisting([path.join(dir, "timeline.json"), path.join(dir, "render/timeline.json")]),
      recipe: firstExisting([path.join(dir, "render-recipe.json"), path.join(dir, "render/render-recipe.json")]),
      generation: firstExisting([path.join(dir, "generation.json"), path.join(dir, "transfer/generation.json")]),
      routeSummary: firstExisting([path.join(dir, "model-route-summary.json")])
    };
  }
  return {
    caseName: arg("--name", "custom"),
    analysis: arg("--analysis"),
    template: arg("--template"),
    timeline: arg("--timeline"),
    recipe: arg("--recipe"),
    generation: arg("--generation"),
    routeSummary: arg("--route-summary")
  };
}

function countNumericLayers(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).filter((item) => typeof item === "number" && Number.isFinite(item)).length;
}

function objectKeys(value) {
  return value && typeof value === "object" ? Object.keys(value) : [];
}

function primitiveHistogram(clips) {
  return (clips ?? []).reduce((out, clip) => {
    const key = clip.selectedPrimitive ?? "<none>";
    out[key] = (out[key] ?? 0) + 1;
    return out;
  }, {});
}

function hasPromptLike(value) {
  const text = String(value ?? "");
  if (!text) return false;
  if (text.length > 64) return true;
  const lower = text.toLowerCase();
  return PROMPT_TOKENS.some((token) => lower.includes(token.toLowerCase()));
}

function bboxInLayer(layer) {
  return Boolean(
    layer?.layout?.bboxNorm ||
    layer?.style?.typography?.bboxNorm ||
    layer?.layout?.bboxTrackNorm ||
    layer?.style?.elementGeometry?.bbox
  );
}

function fontSizeInLayer(layer) {
  return Boolean(layer?.typography?.fontSizeRatio || layer?.style?.typography?.fontSizeRatio || layer?.text?.fontSizeRatio);
}

function recipeClips(recipe) {
  return recipe?.clips ?? [];
}

function recipeLayers(recipe) {
  return recipe?.layers ?? [];
}

function remotionCanRenderMediaForClip(clip, recipe) {
  if (!clip?.material?.assetIds?.length) return true;
  if ((recipe?.layers ?? []).some((layer) => layer.type === "media" && layer.clipId === (clip.clipId ?? clip.id) && layer.material?.assetIds?.length)) return true;
  return [
    "FanHeroSpin",
    "ProductHeroOrbit",
    "SourceClipBeatMontage",
    "FeatureCardStack",
    "CTAEndSlate",
    "TypographyLayoutSequence"
  ].includes(clip.selectedPrimitive);
}

function motionAtomCountFromAnalysis(analysis) {
  const ev = analysis?.evidenceTimeline;
  if (Array.isArray(ev?.motionAtoms)) return ev.motionAtoms.length;
  if (analysis?.motionGeometry?.ribbonMotion) return 1;
  return 0;
}

function inspect(paths) {
  const analysis = readJson(paths.analysis);
  const template = readJson(paths.template);
  const timeline = readJson(paths.timeline);
  const recipe = readJson(paths.recipe) ?? timeline?.renderPlan?.renderRecipe;
  const generation = readJson(paths.generation);
  const sidecarRoute = readJson(paths.routeSummary);
  const routeSummary = recipe?.modelRouteSummary ?? generation?.modelRouteSummary ?? sidecarRoute?.summary ?? sidecarRoute;
  const providerDecisions = recipe?.providerDecisions ?? generation?.providerDecisions ?? sidecarRoute?.providerDecisions ?? routeSummary?.decisions ?? [];
  const ev = analysis?.evidenceTimeline ?? {};
  const tlLayers = (timeline?.clips ?? []).flatMap((clip) => clip.layers ?? []);
  const rLayers = recipeLayers(recipe);
  const rClips = recipeClips(recipe);
  const templateMotionAtoms = template?.motionAtoms ?? [];
  const timelineMotionAtoms = timeline?.renderPlan?.motionAtoms ?? [];
  const recipeMotionAtoms = rLayers.filter((layer) => layer.type === "motion_atom").length + (recipe?.motionAtoms?.length ?? 0);
  const sampleIds = new Set(template?.sourceSampleIds ?? recipe?.evidenceSummary?.sourceSampleIds ?? []);

  const counts = {
    analysis: {
      visualElements: ev.visualElementGraph?.elements?.length ?? 0,
      typographyRuns: ev.typographyEvidence?.length ?? 0,
      audioLayers: countNumericLayers(ev.audioStructure?.estimatedLayers),
      motionAtoms: motionAtomCountFromAnalysis(analysis),
      heroDescriptors: ev.heroDescriptor ? 1 : 0
    },
    template: {
      visualElements: template?.visualElementGraph?.elements?.length ?? 0,
      typographyRuns: template?.typographyEvidence?.length ?? 0,
      audioLayers: countNumericLayers(template?.audioStructure?.estimatedLayers),
      motionAtoms: templateMotionAtoms.length,
      heroDescriptors: template?.heroDescriptor ? 1 : 0
    },
    timeline: {
      clips: timeline?.clips?.length ?? 0,
      layers: tlLayers.length,
      bboxNorm: tlLayers.filter(bboxInLayer).length,
      fontSizeRatio: tlLayers.filter(fontSizeInLayer).length,
      motionAtoms: timelineMotionAtoms.length,
      audioLayers: countNumericLayers(timeline?.renderPlan?.audioPlan?.layers)
    },
    recipe: {
      clips: rClips.length,
      mediaLayers: rLayers.filter((layer) => layer.type === "media").length,
      textLayers: rLayers.filter((layer) => layer.type === "text").length,
      motionAtomLayers: recipeMotionAtoms,
      audioLayers: rLayers.filter((layer) => layer.type === "audio").length || countNumericLayers(recipe?.global?.audioPlan?.layers),
      primitiveHistogram: primitiveHistogram(rClips)
    }
  };

  const droppedEvidence = [];
  const add = (kind, firstLossLayer, severity, message) => droppedEvidence.push({ kind, firstLossLayer, severity, message });

  if (counts.analysis.visualElements > 0 && counts.template.visualElements === 0) {
    add("visualElements", "analysis->template", "fatal", `analysis visual elements=${counts.analysis.visualElements} but template visual evidence is empty`);
  }
  const textLayersWithBBoxAndFont = rLayers.filter((layer) => layer.type === "text" && bboxInLayer(layer) && fontSizeInLayer(layer)).length;
  const legacyTextEquiv = rClips.filter((clip) => clip.layout?.bboxNorm && clip.text?.fontSizeRatio).length;
  if (counts.analysis.typographyRuns > 0 && textLayersWithBBoxAndFont + legacyTextEquiv === 0) {
    add("typography", "template/timeline->recipe", "fatal", "analysis typography exists but recipe has no TextLayer bboxNorm/fontSizeRatio equivalent");
  }
  const expectedMotionAtoms = counts.analysis.motionAtoms || counts.template.motionAtoms || counts.timeline.motionAtoms;
  if (expectedMotionAtoms > 0 && recipeMotionAtoms === 0) {
    add("motionAtoms", "timeline->recipe", "fatal", `motionAtoms=${expectedMotionAtoms} but recipe has no MotionAtomLayer/equivalent`);
  }
  if (counts.analysis.audioLayers > 0 && counts.recipe.audioLayers === 0) {
    add("audio", "template->recipe", "fatal", "analysis audio layers exist but recipe has no AudioLayer/audioPlan layers");
  }
  for (const clip of rClips) {
    if (clip.material?.assetIds?.length && !remotionCanRenderMediaForClip(clip, recipe)) {
      add("mediaRender", "recipe->remotion", "fatal", `image-bearing clip ${clip.clipId ?? clip.id} cannot render media in current Remotion path`);
    }
  }
  const displayFields = [
    recipe?.productTheme?.name,
    recipe?.productTheme?.productName,
    recipe?.productTheme?.brandName,
    recipe?.productTheme?.cta,
    recipe?.productTheme?.ctaText
  ];
  if (displayFields.some(hasPromptLike)) {
    add("displayText", "recipe->renderer", "fatal", "display productTheme field contains raw prompt-like content");
  }
  const renderableIds = [
    ...rClips.flatMap((clip) => clip.material?.policy === "renderable" ? (clip.material.assetIds ?? []) : []),
    ...rLayers.flatMap((layer) => layer.type === "media" && layer.material?.policy === "renderable" ? (layer.material.assetIds ?? []) : [])
  ];
  for (const id of renderableIds) {
    if (sampleIds.has(id) && recipe?.sourcePolicy?.sampleUse !== "authorized_reuse") {
      add("sampleCopy", "recipe", "fatal", `sample asset ${id} appears in renderable material.assetIds without authorization`);
    }
  }

  const fatalCount = droppedEvidence.filter((item) => item.severity === "fatal").length;
  return {
    case: paths.caseName,
    status: fatalCount ? "fail" : "pass",
    paths,
    counts,
    droppedEvidence,
    artifactHints: {
      recipeVersion: recipe?.version ?? recipe?.schemaVersion ?? "missing",
      templateVideoType: template?.videoType,
      generationId: generation?.id,
      modelRouteSummary: routeSummary
        ? {
            totalTasks: routeSummary.summary?.totalTasks ?? routeSummary.totalTasks,
            externalSampleMediaUploads: routeSummary.summary?.externalSampleMediaUploads ?? routeSummary.externalSampleMediaUploads ?? routeSummary.consumesSampleMediaExternally,
            fallbackUsed: routeSummary.summary?.fallbackUsed ?? routeSummary.fallbackUsed
          }
        : undefined,
      providerDecisions: providerDecisions.length,
      recipeLintStatus: recipe?.recipeLintReport?.status ?? generation?.recipeLintReport?.status,
      videoCriticScore: recipe?.videoCriticReport?.score ?? generation?.videoCriticReport?.score
    }
  };
}

function main() {
  const paths = artifactPaths();
  for (const [name, file] of Object.entries(paths)) {
    if (name === "caseName" || name === "generation") continue;
    if (!file) throw new Error(`Missing required ${name} artifact for ${paths.caseName}`);
  }
  const report = inspect(paths);
  console.log(JSON.stringify(report, null, 2));
  console.error(`[inspect-learning-fidelity] ${report.case}: ${report.status.toUpperCase()}`);
  console.error(`  analysis visual=${report.counts.analysis.visualElements} typography=${report.counts.analysis.typographyRuns} audio=${report.counts.analysis.audioLayers} motion=${report.counts.analysis.motionAtoms}`);
  console.error(`  template visual=${report.counts.template.visualElements} typography=${report.counts.template.typographyRuns} audio=${report.counts.template.audioLayers} motion=${report.counts.template.motionAtoms}`);
  console.error(`  recipe media=${report.counts.recipe.mediaLayers} text=${report.counts.recipe.textLayers} motion=${report.counts.recipe.motionAtomLayers} audio=${report.counts.recipe.audioLayers}`);
  if (report.droppedEvidence.length) {
    for (const item of report.droppedEvidence) console.error(`  ${item.severity}: ${item.kind} @ ${item.firstLossLayer} - ${item.message}`);
  }
  if (report.status !== "pass") process.exit(1);
}

main();
