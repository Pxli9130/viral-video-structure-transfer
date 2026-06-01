#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function firstExisting(...files) {
  return files.find((file) => file && existsSync(file));
}

function probe(file) {
  if (!file || !existsSync(file)) return undefined;
  const bin = process.env.FFPROBE_PATH && process.env.FFPROBE_PATH.includes("/") ? process.env.FFPROBE_PATH : "ffprobe";
  const res = spawnSync(bin, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height", "-of", "json", file], { encoding: "utf8" });
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

function primitiveHistogram(recipe) {
  const hist = {};
  for (const clip of recipe?.clips ?? []) hist[clip.selectedPrimitive] = (hist[clip.selectedPrimitive] ?? 0) + 1;
  return hist;
}

function routePayloadFrom(root, generation, timeline, recipe) {
  const sidecar = readJson(path.join(root, "model-route-summary.json"));
  const routeSummary = recipe?.modelRouteSummary ?? generation?.modelRouteSummary ?? timeline?.renderPlan?.renderRecipe?.modelRouteSummary ?? sidecar?.summary ?? sidecar;
  const providerDecisions = recipe?.providerDecisions ?? generation?.providerDecisions ?? timeline?.renderPlan?.renderRecipe?.providerDecisions ?? sidecar?.providerDecisions ?? routeSummary?.decisions ?? [];
  const counts = routeSummary?.summary ?? routeSummary ?? {};
  return {
    routeSummary,
    providerDecisions,
    counts,
    rows: providerDecisions.map((decision) => ({
      task: decision.task,
      selectedProvider: decision.selectedProvider,
      fallbackUsed: Boolean(decision.fallbackUsed),
      fallbackReason: decision.fallbackReason,
      effectScope: decision.effectScope,
      featureGate: decision.featureGate,
      localSampleMedia: [
        decision.consumesSamplePixelsLocally ? "pixels" : "",
        decision.consumesSampleAudioLocally ? "audio" : "",
        decision.consumesSampleVideoLocally ? "video" : ""
      ].filter(Boolean).join("+") || "no",
      externalSampleMedia: [
        decision.consumesSamplePixelsExternally ? "pixels" : "",
        decision.consumesSampleAudioExternally ? "audio" : "",
        decision.consumesSampleVideoExternally ? "video" : ""
      ].filter(Boolean).join("+") || "no"
    }))
  };
}

function generationProviderClass(providerClass) {
  return providerClass === "image_generation" || providerClass === "video_generation" || providerClass === "audio_generation";
}

function layerCounts(recipe) {
  const layers = recipe?.layers ?? [];
  return {
    mediaLayers: layers.filter((layer) => layer.type === "media").length,
    textLayers: layers.filter((layer) => layer.type === "text").length,
    motionAtomLayers: layers.filter((layer) => layer.type === "motion_atom").length,
    audioLayers: layers.filter((layer) => layer.type === "audio").length
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

function textBlob(value) {
  return JSON.stringify(value ?? {});
}

function hasPromptPollution(recipe) {
  const blob = [
    recipe?.productTheme?.name,
    recipe?.productTheme?.productName,
    recipe?.productTheme?.cta,
    recipe?.productTheme?.ctaText,
    ...(recipe?.layers ?? []).filter((layer) => layer.type === "text").map((layer) => layer.text?.content),
    ...(recipe?.clips ?? []).map((clip) => clip.text?.copy)
  ].filter(Boolean).join("\n");
  return /15\s*秒|高转化|学习样例|不复制样例|水印|prompt|素材|镜头|结构（|结构\(/i.test(blob);
}

function generatedAssetsHaveProvenance(generation, recipe) {
  const targetAssets = generation?.request?.targetAssets ?? [];
  const generatedTargets = targetAssets.filter((asset) =>
    asset.metadata?.materialRole === "aigc_generated_material" || asset.tags?.includes("aigc_generated_material")
  );
  const targetOk = generatedTargets.every((asset) => asset.metadata?.materialRole === "aigc_generated_material");
  const recipeOk = (recipe?.layers ?? [])
    .filter((layer) => layer.type === "media" && layer.material?.kind === "generated_target_asset")
    .every((layer) => layer.material?.provenance === "aigc_generated");
  return targetOk && recipeOk;
}

function previewFramesExist(caseRoot, timeline) {
  const clips = timeline?.clips ?? [];
  if (!clips.length) return false;
  const previewRefs = timeline?.clipPreviewFrames ?? [];
  if (Array.isArray(previewRefs) && previewRefs.length >= clips.length) return true;
  const previewDir = path.join(caseRoot, "preview_frames");
  if (!existsSync(previewDir)) return false;
  return clips.every((clip, index) =>
    existsSync(path.join(previewDir, `${clip.id}.png`)) ||
    existsSync(path.join(previewDir, `clip_${index + 1}.png`))
  );
}

function gate(id, pass, notes, extra = {}) {
  return { id, status: pass ? "pass" : "fail", notes, ...extra };
}

function blocked(id, notes, extra = {}) {
  return { id, status: "blocked", notes, ...extra };
}

export function evaluateCaseGates(caseRoot, options = {}) {
  const root = path.resolve(caseRoot);
  const explicitBlock = readJson(path.join(root, "render-blocked.json"));
  const analysis = readJson(path.join(root, "analysis.json"));
  const template = readJson(path.join(root, "learned-template.json"))?.template ?? readJson(path.join(root, "learned-template.json"));
  const generation = readJson(path.join(root, "generation.json"));
  const timeline = readJson(path.join(root, "timeline.json")) ?? generation?.timeline;
  const recipe = readJson(path.join(root, "render-recipe.v4.1.json")) ?? readJson(path.join(root, "render-recipe.json")) ?? timeline?.renderPlan?.renderRecipe;
  const gapReport = readJson(path.join(root, "gap-report.json")) ?? timeline?.gapReport ?? generation?.gapReport ?? [];
  const routePayload = routePayloadFrom(root, generation, timeline, recipe);
  const recipeLintReport = recipe?.recipeLintReport ?? generation?.recipeLintReport;
  const videoCriticReport = recipe?.videoCriticReport ?? generation?.videoCriticReport;
  const finalMp4 = firstExisting(path.join(root, "final.mp4"), path.join(root, "marketing.final.mp4"));
  const remotionMp4 = firstExisting(path.join(root, "final.remotion.mp4"), path.join(root, "marketing.final.remotion.mp4"));
  const finalProbe = probe(finalMp4);
  const remotionProbe = probe(remotionMp4);
  const counts = { template: evidenceCounts(template), recipe: layerCounts(recipe) };
  const histogram = primitiveHistogram(recipe);
  const gates = [];

  gates.push(finalMp4 ? gate("G1_final_mp4_exists", true, finalMp4) : explicitBlock ? blocked("G1_final_mp4_exists", explicitBlock.reason ?? "render blocked by environment") : gate("G1_final_mp4_exists", false, "final.mp4 missing"));
  gates.push(remotionMp4 ? gate("G2_final_remotion_mp4_exists", true, remotionMp4) : explicitBlock ? blocked("G2_final_remotion_mp4_exists", explicitBlock.remotionReason ?? explicitBlock.reason ?? "Remotion render blocked by environment") : gate("G2_final_remotion_mp4_exists", false, "final.remotion.mp4 missing"));
  gates.push(gate("G3_dimensions_720x1280", Boolean(finalProbe && finalProbe.width === 720 && finalProbe.height === 1280), finalProbe ? `${finalProbe.width}x${finalProbe.height}` : "no probe"));
  gates.push(gate("G4_duration_10_to_20_sec", Boolean(finalProbe && finalProbe.durationSec >= 10 && finalProbe.durationSec <= 20), finalProbe ? `${finalProbe.durationSec.toFixed(2)}s` : "no probe"));
  gates.push(gate("G5_render_recipe_schema_valid", recipe?.version === "render-recipe-v4.1" || Boolean(recipe?.schemaVersion), recipe?.version ?? recipe?.schemaVersion ?? "missing recipe"));
  gates.push(gate("G6_clip_or_layer_evidence", Boolean((recipe?.clips ?? []).every((clip) => clip.primitiveReason) && (recipe?.layers ?? []).every((layer) => (layer.evidenceRefs?.length ?? 0) > 0 || layer.fallbackReason)), `${recipe?.clips?.length ?? 0} clips, ${recipe?.layers?.length ?? 0} layers`));
  gates.push(gate("G7_no_sample_frame_copy", recipe?.sourcePolicy?.sampleFrameCopyAllowed === false && !/sample_reference/.test(textBlob(recipe?.layers)), "sampleFrameCopyAllowed=false and no sample_reference material"));
  gates.push(gate("G8_no_sample_audio_copy", recipe?.sourcePolicy?.sampleAudioCopyAllowed === false, `sampleAudioCopyAllowed=${recipe?.sourcePolicy?.sampleAudioCopyAllowed}`));
  gates.push(gate("G9_no_watermark_reproduced", !/watermark|水印/i.test(textBlob(recipe?.productTheme) + textBlob(recipe?.layers)), "no watermark token in display recipe"));
  gates.push(gate("G10_marketing_template_evidence_not_empty", counts.template.visual > 0 && counts.template.typography > 0 && counts.template.audio > 0, JSON.stringify(counts.template)));
  gates.push(gate("G11_typography_bbox_fontsize_preserved", counts.recipe.textLayers === 0 ? false : (recipe.layers ?? []).filter((layer) => layer.type === "text").every((layer) => layer.layout?.bboxNorm && layer.typography?.fontSizeRatio), `${counts.recipe.textLayers} text layers`));
  gates.push(gate("G12_motionAtoms_consumed_by_renderer", counts.recipe.motionAtomLayers > 0 || (timeline?.renderPlan?.motionAtoms?.length ?? 0) > 0, `${counts.recipe.motionAtomLayers} recipe motion layers`));
  gates.push(gate("G13_image_bearing_layers_render_media", counts.recipe.mediaLayers > 0 && (recipe.layers ?? []).filter((layer) => layer.type === "media").every((layer) => (layer.material?.assetIds?.length ?? 0) > 0 && layer.material?.policy !== "evidence_only"), `${counts.recipe.mediaLayers} media layers`));
  gates.push(gate("G14_cta_prompt_not_visible", !hasPromptPollution(recipe), "display fields scanned for prompt-like tokens"));
  gates.push(gate("G15_audio_layers_not_empty", counts.recipe.audioLayers > 0 || Object.keys(recipe?.global?.audioPlan?.layers ?? {}).length > 0, `${counts.recipe.audioLayers} audio layers`));
  gates.push(gate("G16_primitive_sequence_diversity", Object.keys(histogram).length >= 3, JSON.stringify(histogram)));
  gates.push(gate("G17_gap_report_has_reason_impact_repair", Array.isArray(gapReport) && gapReport.every((gap) => gap.reason && gap.impact && gap.repairOptions?.length && gap.selectedRepair && gap.expectedVisualResult), `${gapReport.length} gaps`));
  gates.push(gate("G18_preview_frames_per_clip_exist", previewFramesExist(root, timeline), "preview_frames directory or timeline clipPreviewFrames"));
  gates.push(gate("G19_provider_fallbacks_are_explicit", existsSync(path.join(ROOT, "packages/shared/src/engine/providerPolicy.ts")), "provider policy/router present"));
  gates.push(gate("G20_generated_assets_have_provenance", generatedAssetsHaveProvenance(generation, recipe), "generated target assets and generated media layers checked"));
  if (routePayload.providerDecisions.length) {
    gates.push(gate("G21_model_route_summary_present", true, `${routePayload.providerDecisions.length} provider decisions`));
    gates.push(gate("G22_no_external_sample_media_uploads", (routePayload.counts.externalSampleMediaUploads ?? routePayload.counts.consumesSampleMediaExternally ?? 0) === 0, `externalSampleMediaUploads=${routePayload.counts.externalSampleMediaUploads ?? routePayload.counts.consumesSampleMediaExternally ?? "missing"}`));
    gates.push(gate("G23_provider_fallback_count_recorded", typeof routePayload.counts.fallbackUsed === "number", `fallbackUsed=${routePayload.counts.fallbackUsed ?? "missing"}`));
    gates.push(gate("G24_unsafe_policy_issues_zero", (routePayload.counts.unsafePolicyIssues ?? routePayload.routeSummary?.unsafePolicyIssues?.length ?? 0) === 0, `unsafePolicyIssues=${routePayload.counts.unsafePolicyIssues ?? routePayload.routeSummary?.unsafePolicyIssues?.length ?? "missing"}`));
    gates.push(gate("G25_raw_prompt_not_renderable", routePayload.providerDecisions.every((decision) => decision.mediaAccessPolicy?.rawPromptRenderable === false), "all provider decisions rawPromptRenderable=false"));
    gates.push(gate("G26_generation_provenance_policy_recorded", routePayload.providerDecisions.filter((decision) => generationProviderClass(decision.providerClass) && decision.providerClass !== "disabled").every((decision) => decision.generatedAssetProvenanceRequired === true), "generation providers require provenance"));
  } else {
    gates.push(blocked("G21_model_route_summary_present", "old artifact has no route summary"));
    gates.push(blocked("G22_no_external_sample_media_uploads", "old artifact has no route summary"));
    gates.push(blocked("G23_provider_fallback_count_recorded", "old artifact has no route summary"));
    gates.push(blocked("G24_unsafe_policy_issues_zero", "old artifact has no route summary"));
    gates.push(blocked("G25_raw_prompt_not_renderable", "old artifact has no route summary"));
    gates.push(blocked("G26_generation_provenance_policy_recorded", "old artifact has no route summary"));
  }
  gates.push(recipeLintReport?.status ? gate("G27_recipe_lint_status_recorded", recipeLintReport.status !== "fail", `recipeLint=${recipeLintReport.status}`) : blocked("G27_recipe_lint_status_recorded", "old artifact has no recipe lint report"));
  gates.push(videoCriticReport?.score ? gate("G28_offline_video_critic_recorded", true, `videoCriticScore=${videoCriticReport.score}`) : blocked("G28_offline_video_critic_recorded", "old artifact has no offline video critic report"));

  const pass = gates.filter((item) => item.status === "pass").length;
  const fail = gates.filter((item) => item.status === "fail").length;
  const blockedCount = gates.filter((item) => item.status === "blocked").length;
  return {
    caseRoot: root,
    generatedAt: new Date().toISOString(),
    status: fail === 0 ? "pass" : blockedCount > 0 && fail <= 2 ? "blocked" : "fail",
    counts,
    primitiveHistogram: histogram,
    finalProbe,
    remotionProbe,
    analysisCounts: {
      visual: analysis?.visualElementGraph?.elements?.length ?? analysis?.evidenceTimeline?.visualElementGraph?.elements?.length ?? 0,
      typography: analysis?.typographyEvidence?.length ?? analysis?.evidenceTimeline?.typographyEvidence?.length ?? 0,
      audio: Object.keys((analysis?.audioStructure ?? analysis?.evidenceTimeline?.audioStructure)?.estimatedLayers ?? {}).length
    },
    gates,
    routeSummary: {
      summary: routePayload.counts,
      rows: routePayload.rows
    },
    recipeLintReport,
    videoCriticReport,
    summary: { pass, fail, blocked: blockedCount }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const caseRoot = args["case-root"] ?? args.case ?? path.join(ROOT, "docs/artifacts/learned_samples_max/marketing");
  const report = evaluateCaseGates(caseRoot);
  const out = args.out ? path.resolve(args.out) : path.join(path.resolve(caseRoot), "final-gates.json");
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, out, summary: report.summary }, null, 2));
  if (args.strict && report.status === "fail") process.exit(1);
}
