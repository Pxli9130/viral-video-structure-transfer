#!/usr/bin/env node
/**
 * Render-quality gate for the evidence-first beat-cut pipeline.
 *
 * Verifies a generated MP4 actually transferred the sample's structure instead of
 * emitting placeholder cards / a silent B2B scaffold. Reuses the evidence analyzer
 * (PySceneDetect + librosa) to compare render visual stats against the sample.
 *
 * Usage:
 *   node scripts/evaluate-render-quality.mjs --render <mp4>
 *     [--template <structure-template.json>] [--generation <generation.json>]
 *     [--sample <sample.mp4> | --sample-evidence <evidence-timeline.json>]
 *     [--expect-video-type beat_cut] [--out <report.json>] [--strict]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { args[key] = next; i += 1; } else { args[key] = true; }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const FFPROBE = process.env.FFPROBE_PATH && process.env.FFPROBE_PATH.includes("/") ? process.env.FFPROBE_PATH : "ffprobe";
const condaBase = process.env.CONDA_BASE ?? path.join(process.env.HOME ?? "", "anaconda3");
const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
const PYTHON = path.join(condaBase, "envs", condaEnv, "bin", "python");
const scriptsDir = path.dirname(new URL(import.meta.url).pathname);

const PLACEHOLDER_PATTERNS = [/proxy/i, /placeholder/i, /插槽/, /占位/, /运动图插槽/, /Card stack proxy/i, /Beat montage proxy/i];
const GENERIC_B2B = [/b2b_marketing_mg/i, /B2B MG Promo Structure/i];

const FFMPEG = process.env.FFMPEG_PATH && process.env.FFMPEG_PATH.includes("/") ? process.env.FFMPEG_PATH : "ffmpeg";

function ffprobeStreams(file) {
  const out = spawnSync(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  try { return JSON.parse(out.stdout || "{}"); } catch { return {}; }
}

/** Mean loudness (dBFS) of the first audio stream via ffmpeg volumedetect, or null if unmeasurable. */
function meanVolumeDb(file) {
  const res = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0?", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const text = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(text);
  return m ? Number(m[1]) : null;
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

function runEvidence(video) {
  if (!existsSync(PYTHON)) return undefined;
  const framesDir = mkdtempSync(path.join(tmpdir(), "rq-frames-"));
  const outJson = path.join(framesDir, "ev.json");
  const res = spawnSync(PYTHON, [
    path.join(scriptsDir, "analyze-evidence-timeline.py"),
    "--video", video, "--out", outJson, "--frames-dir", framesDir
  ], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(condaBase, "envs", condaEnv, "bin")}:${process.env.PATH ?? ""}` } });
  if (res.status !== 0) return undefined;
  return readJson(outJson);
}

/** The render-side 60-frame metric pass — the SAME function the analyzer uses on the sample. */
function runMetrics(video) {
  if (!existsSync(PYTHON)) return undefined;
  const res = spawnSync(PYTHON, [
    path.join(scriptsDir, "analyze-evidence-timeline.py"),
    "--video", video, "--metrics-only"
  ], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(condaBase, "envs", condaEnv, "bin")}:${process.env.PATH ?? ""}` } });
  if (res.status !== 0) return undefined;
  try { return JSON.parse(res.stdout).metadata; } catch { return undefined; }
}

/** Full metrics-only output (incl. per-frame frameMetrics) for the universal visual-density gate. */
function runFrameMetrics(video) {
  if (!existsSync(PYTHON)) return undefined;
  const res = spawnSync(PYTHON, [
    path.join(scriptsDir, "analyze-evidence-timeline.py"),
    "--video", video, "--metrics-only"
  ], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(condaBase, "envs", condaEnv, "bin")}:${process.env.PATH ?? ""}` } });
  if (res.status !== 0) return undefined;
  try { return JSON.parse(res.stdout); } catch { return undefined; }
}

/**
 * Longest run (seconds) of consecutive near-blank sampled frames — a frame whose spatial luma stdev
 * (contentStd) is below `stdThreshold` is essentially uniform (a flat color: black, white, or any solid
 * fill) with no foreground content. Keys off content PRESENCE, not darkness, so a legitimately dark
 * motif with visible text/panels (high stdev) is NOT penalized; only genuinely empty stretches are.
 * Returns null when < 8 frames (or no contentStd) are available. Motif-agnostic.
 */
function longestBlankSectionSec(frameMetrics, stdThreshold) {
  if (!Array.isArray(frameMetrics) || frameMetrics.length < 8) return null;
  if (!frameMetrics.some((f) => typeof f.contentStd === "number")) return null;
  const interval = (Number(frameMetrics[frameMetrics.length - 1].timeSec) - Number(frameMetrics[0].timeSec)) / (frameMetrics.length - 1);
  let longest = 0;
  let runStart = null;
  for (const f of frameMetrics) {
    const t = Number(f.timeSec ?? 0);
    if ((f.contentStd ?? 1) < stdThreshold) {
      if (runStart == null) runStart = t;
      longest = Math.max(longest, t - runStart);
    } else {
      runStart = null;
    }
  }
  // Add one sample interval so a trailing near-blank frame's coverage isn't undercounted.
  return longest > 0 ? longest + (Number.isFinite(interval) ? interval : 0) : 0;
}

const gates = [];
const warnings = [];
const evidence = {};
function gate(id, passed, detail, value) { gates.push({ id, passed: Boolean(passed), detail, value }); }

// --- structural checks from JSON ---
const render = args.render;
if (!render || !existsSync(render)) {
  console.error(`render mp4 not found: ${render}`);
  process.exit(2);
}
const templateRaw = args.template ? readJson(args.template) : undefined;
const template = templateRaw?.template ?? templateRaw; // accept TemplateRecord or StructureTemplate
const generation = args.generation ? readJson(args.generation) : undefined;
const timeline = generation?.timeline;

// 1. output is portrait 9:16-ish
const probe = ffprobeStreams(render);
const vstream = (probe.streams ?? []).find((s) => s.codec_type === "video");
const astream = (probe.streams ?? []).find((s) => s.codec_type === "audio");
const width = vstream?.width ?? 0, height = vstream?.height ?? 0;
const duration = Number(probe.format?.duration ?? 0);
evidence.render = { width, height, duration, hasAudio: Boolean(astream), audioCodec: astream?.codec_name };
gate("output_portrait_9_16", height > width, `${width}x${height}`, { width, height });

// 2. audio present unless explicitly silent
const audioPolicy = timeline?.renderPlan?.audioPolicy ?? "unknown";
gate("audio_present_or_silent_ok", Boolean(astream) || audioPolicy === "silent", `hasAudio=${Boolean(astream)} audioPolicy=${audioPolicy}`, { audioPolicy });
// Universal loudness silence guard (runs for ALL flows, not just beat_cut): a render that carries an
// audio stream and is not silent-by-design must have real signal (> -50 dBFS), not an empty -91 dB
// track. Physics threshold, motif-agnostic. Skipped (warn) when ffmpeg can't measure.
if (astream && audioPolicy !== "silent") {
  const SILENCE_DB = Number(process.env.AUDIO_SILENCE_DB ?? -50);
  const mv = meanVolumeDb(render);
  if (mv == null) warnings.push("audio_not_silent: could not measure mean_volume (ffmpeg unavailable); skipped");
  else gate("audio_not_silent", mv > SILENCE_DB, `mean_volume=${mv.toFixed(1)}dB (> ${SILENCE_DB}dB required)`, { meanVolumeDb: mv });
}

// Universal visual-density guard (ALL flows, not just beat_cut): a render must not dwell on a near-blank
// frame for a long stretch (the codegen blank-media bug). Allowance is proportional — max(2s, 20% of
// duration) — so it is fair to both short and long videos and is not tuned to any one sample.
{
  const BLANK_STD = Number(process.env.BLANK_CONTENT_STD ?? 0.04);
  const full = runFrameMetrics(render);
  const blankSpan = longestBlankSectionSec(full?.frameMetrics, BLANK_STD);
  if (blankSpan == null) {
    warnings.push("no_long_blank_section: frame metrics unavailable (conda python?); skipped");
  } else {
    const allowance = Math.max(2, 0.2 * duration);
    gate("no_long_blank_section", blankSpan <= allowance, `longestNearBlank=${blankSpan.toFixed(1)}s (<= ${allowance.toFixed(1)}s allowed; frame contentStd<${BLANK_STD})`, { blankSpan, allowance });
  }
}

// 3. videoType not generic B2B (and matches expectation if given)
if (template) {
  const vt = template.videoType ?? "";
  const isGeneric = GENERIC_B2B.some((re) => re.test(vt) || re.test(template.name ?? ""));
  if (args["expect-video-type"]) {
    gate("video_type_matches_expected", vt === args["expect-video-type"], `videoType=${vt} expected=${args["expect-video-type"]}`, { videoType: vt });
  } else {
    gate("video_type_not_generic_b2b", !isGeneric, `videoType=${vt}`, { videoType: vt });
  }
  // 4. AI enrichment not a hidden failed fallback
  gate("ai_enrichment_not_failed", template.aiEnrichmentStatus !== "failed", `aiEnrichmentStatus=${template.aiEnrichmentStatus ?? "n/a"}`, { status: template.aiEnrichmentStatus });
  if (template.aiEnrichmentStatus === "skipped") warnings.push("AI enrichment was skipped (deterministic-only template).");

  // 5. slot evidence coverage >= 70%
  const slots = [...(template.requiredSlots ?? []), ...(template.inducedSlots ?? [])];
  const withEv = slots.filter((s) => (s.sourceEvidence?.frameIds?.length ?? 0) > 0 || s.sourceEvidence?.timeRange);
  const coverage = slots.length ? withEv.length / slots.length : 0;
  evidence.slotEvidenceCoverage = Number(coverage.toFixed(2));
  gate("slot_evidence_coverage_ge_70", coverage >= 0.7, `${Math.round(coverage * 100)}% of ${slots.length} slots have frame/timestamp evidence`, { coverage });
} else {
  warnings.push("No --template provided; skipped template gates.");
}

// 6. no placeholder strings in timeline (hard fail)
if (timeline) {
  const texts = [];
  for (const clip of timeline.clips ?? []) {
    texts.push(clip.subtitleText, clip.visualIntent, clip.placeholderSpec?.label);
    for (const layer of clip.layers ?? []) texts.push(layer.text, layer.style?.placeholderSpec?.label);
  }
  const hits = texts.filter(Boolean).filter((t) => PLACEHOLDER_PATTERNS.some((re) => re.test(String(t))));
  evidence.placeholderHits = hits.slice(0, 8);
  gate("no_placeholder_text", hits.length === 0, hits.length ? `placeholder strings: ${hits.slice(0, 3).join(" | ")}` : "no placeholder strings", { count: hits.length });

  // 7. beat/hard-cut instructions present
  const hasBeat = Boolean(timeline.renderPlan?.beatGrid?.beats?.length);
  const hardCuts = (timeline.clips ?? []).filter((c) => c.transitionOut === "hard_cut" || c.motionPrimitive).length;
  gate("beat_or_hard_cut_present", hasBeat || hardCuts >= Math.ceil((timeline.clips ?? []).length * 0.5), `beatGrid=${hasBeat} hardCutClips=${hardCuts}`, { hasBeat, hardCuts });
} else {
  warnings.push("No --generation provided; skipped timeline gates.");
}

// --- visual stats from the render (and optional sample comparison) ---
const renderEvidence = runEvidence(render);
if (renderEvidence) {
  const blackBg = renderEvidence.stats?.blackBgRatio ?? 0;
  const cutDensity = renderEvidence.stats?.cutDensity ?? 0;
  evidence.renderStats = { blackBgRatio: blackBg, cutDensity, shots: renderEvidence.shots?.length };
  if (args["expect-video-type"] === "beat_cut") {
    gate("render_dark_bg", blackBg >= 0.35, `blackBgRatio=${blackBg}`, { blackBg });
  }
  gate("render_has_cuts", cutDensity > 0.03, `cutDensity=${cutDensity}`, { cutDensity });

  const sampleEvidence = args["sample-evidence"]
    ? readJson(args["sample-evidence"])
    : args.sample ? runEvidence(args.sample) : undefined;
  if (sampleEvidence) {
    const sBlack = sampleEvidence.stats?.blackBgRatio ?? 0;
    evidence.sampleStats = { blackBgRatio: sBlack, cutDensity: sampleEvidence.stats?.cutDensity, bpm: sampleEvidence.beatGrid?.bpm };
    gate("style_match_dark_bg", Math.abs(blackBg - sBlack) <= 0.35, `render ${blackBg} vs sample ${sBlack}`, { render: blackBg, sample: sBlack });
  }
} else {
  warnings.push("Evidence analyzer unavailable; skipped visual-stats gates.");
}

// --- v2 moving-material gate set (render-quality-gates-v2): 12 mustPass booleans + metric
// thresholds. Enforces that the output is a moving-material-aware beat_cut, not static cards. ---
if (args.gates === "v2" || args.gates === "v3") {
  const TH = { durMin: 14.8, durMax: 15.2, w: 720, h: 1280, minMotionDiffMean: 0.04, minCutLikeCount: 5, minMovingMaterialFamilies: 3, minSlotEvidenceCoverage: 0.8, minLayeredClips: 5 };
  const clips = timeline?.clips ?? [];
  const slotIds = new Set((template?.requiredSlots ?? []).map((s) => s.id));
  const slotFamilies = new Set((template?.requiredSlots ?? []).map((s) => s.visualFormFamily).filter(Boolean));
  const gapTypes = new Set((generation?.gapReport ?? []).map((g) => g.gapType));
  const primitives = new Set(clips.map((c) => c.motionPrimitive).filter(Boolean));
  const hasLayerKind = (k) => clips.some((c) => (c.layers ?? []).some((l) => l.kind === k));
  const beatClips = clips.filter((c) => (c.beatTimestamps?.length ?? 0) > 0).length;
  const authorized = (generation?.request ?? generation)?.constraints?.sampleAssetReuse === "authorized";

  gate("v2_videoTypeIsBeatCut", template?.videoType === "beat_cut", `videoType=${template?.videoType}`);
  gate("v2_noGenericB2BTemplate", !GENERIC_B2B.some((re) => re.test(template?.videoType ?? "") || re.test(template?.name ?? "")), `name=${template?.name ?? "n/a"}`);
  gate("v2_hasMovingHeroMaterial", slotIds.has("slot_moving_hero_object") || primitives.has("neon_hero_intro") || hasLayerKind("moving_material"), `heroSlot=${slotIds.has("slot_moving_hero_object")} movingLayer=${hasLayerKind("moving_material")}`);
  gate("v2_hasBackgroundLayerOrGeneratedBgImage", slotIds.has("slot_dark_background") || hasLayerKind("background"), `bgSlot=${slotIds.has("slot_dark_background")} bgLayer=${hasLayerKind("background")}`);
  gate("v2_hasStoryboardSegmentation", slotIds.has("slot_storyboard_rule_card") || (template?.segments?.length ?? 0) >= 5, `storyboardSlot=${slotIds.has("slot_storyboard_rule_card")} segments=${template?.segments?.length ?? 0}`);
  gate("v2_hasBgmOrExplicitAudioPolicy", Boolean(astream) || ["sample_bgm", "synth_beat"].includes(audioPolicy) || Boolean(timeline?.renderPlan?.audioPlan), `audio=${Boolean(astream)} policy=${audioPolicy}`);
  gate("v2_hasBeatAlignedCuts", Boolean(timeline?.renderPlan?.beatGrid?.beats?.length) && beatClips >= Math.ceil(clips.length * 0.6), `beatGrid=${Boolean(timeline?.renderPlan?.beatGrid?.beats?.length)} clipsWithBeats=${beatClips}/${clips.length}`);
  gate("v2_hasMovingMontageOrHonestGap", primitives.has("action_montage") || gapTypes.has("moving_material_missing"), `montagePrimitive=${primitives.has("action_montage")} movingGap=${gapTypes.has("moving_material_missing")}`);
  gate("v2_noSampleFrameCopyUnlessAuthorized", clips.every((c) => !c.sourceAssetId) || authorized, `clipsWithSource=${clips.filter((c) => c.sourceAssetId).length} authorized=${authorized}`);
  gate("v2_exposesSlotEvidenceInKB", (evidence.slotEvidenceCoverage ?? 0) >= TH.minSlotEvidenceCoverage, `coverage=${evidence.slotEvidenceCoverage}`);
  gate("v2_reportsMissingMovingMaterialAsGap", gapTypes.has("moving_material_missing"), `gapTypes=[${[...gapTypes].join(",")}]`);

  // metric thresholds (render measured by the same 60-frame pass as the sample)
  const m = runMetrics(render);
  if (m) {
    evidence.renderMetrics = m;
    gate("v2_durationSec", duration >= TH.durMin && duration <= TH.durMax, `duration=${duration.toFixed(3)}`);
    gate("v2_resolution_720x1280", width === TH.w && height === TH.h, `${width}x${height}`);
    gate("v2_audioStreamRequired", Boolean(astream), `hasAudio=${Boolean(astream)}`);
    gate("v2_minMotionDiffMean", (m.motionDiffMean ?? 0) >= TH.minMotionDiffMean, `motionDiffMean=${m.motionDiffMean} (>=${TH.minMotionDiffMean})`, { motionDiffMean: m.motionDiffMean });
    gate("v2_minCutLikeCount", (m.cutLikeCount ?? 0) >= TH.minCutLikeCount, `cutLikeCount=${m.cutLikeCount} (>=${TH.minCutLikeCount})`, { cutLikeCount: m.cutLikeCount });
    gate("v2_minLayeredClips", clips.filter((c) => (c.layers?.length ?? 0) >= 2).length >= TH.minLayeredClips, `layeredClips=${clips.filter((c) => (c.layers?.length ?? 0) >= 2).length} (>=${TH.minLayeredClips})`);
    gate("v2_minMovingMaterialFamilies", slotFamilies.size >= TH.minMovingMaterialFamilies, `families=${slotFamilies.size} [${[...slotFamilies].join(",")}]`);
  } else {
    warnings.push("metrics-only analyzer unavailable; skipped v2 metric-threshold gates.");
  }
}

// --- v3 human-fidelity gates: per-clip motion (no static early clip), a real hero-object
// descriptor + proxy, typography layout evidence, audio richness, and artifact consistency. ---
if (args.gates === "v3") {
  const clips = timeline?.clips ?? [];
  const segs = clips.map((c) => `${(c.startSec ?? 0).toFixed(3)}:${((c.startSec ?? 0) + (c.durationSec ?? 0)).toFixed(3)}`).join(",");
  let perClip = [];
  let audio = {};
  if (existsSync(PYTHON) && segs) {
    const res = spawnSync(PYTHON, [path.join(scriptsDir, "analyze-evidence-timeline.py"), "--video", render, "--metrics-only", "--segments", segs, "--audio-metrics"], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(condaBase, "envs", condaEnv, "bin")}:${process.env.PATH ?? ""}` } });
    try { const j = JSON.parse(res.stdout); perClip = j.segments ?? []; audio = j.audio ?? {}; } catch { /* keep empty */ }
  }
  // attach role + primitive to each per-clip metric
  const clipMetrics = perClip.map((m, i) => ({ ...m, role: clips[i]?.role, primitive: clips[i]?.motionPrimitive }));
  evidence.perClipMotion = clipMetrics;
  evidence.audioMetrics = audio;
  const byRole = (role) => clipMetrics.filter((m) => m.role === role);
  const hero = byRole("hook")[0];
  const textClips = clipMetrics.filter((m) => m.role === "setup" || m.role === "body");
  const montage = byRole("proof")[0];
  const template3 = template ?? {};
  const heroDescriptor = template3.heroDescriptor;
  const heroLayerHasDescriptor = clips.some((c) => c.role === "hook" && (c.layers ?? []).some((l) => l.kind === "moving_material" && (l.style?.heroDescriptor?.objectType)));
  const textTypoLayers = clips.flatMap((c) => c.layers ?? []).filter((l) => (l.kind === "text" || l.kind === "text_overlay") && l.style?.typography);
  const bgmGaps = (generation?.gapReport ?? []).filter((g) => g.gapType === "bgm_missing");
  const bgmFill = (generation?.fillPlan ?? []).find((f) => f.slotId === "slot_bgm_grid");

  gate("v3_per_clip_motion_metrics_recorded", clipMetrics.length >= 5 && clipMetrics.every((m) => typeof m.motionDiffMean === "number"), `${clipMetrics.length} per-clip motion metrics`);
  gate("v3_hero_intro_motion_min", (hero?.motionDiffMean ?? 0) >= 0.025, `hook motionDiffMean=${hero?.motionDiffMean}`, { hero: hero?.motionDiffMean });
  gate("v3_hero_intro_not_static", (hero?.motionDiffMean ?? 0) > 0.01, `hook motionDiffMean=${hero?.motionDiffMean}`);
  gate("v3_hero_object_descriptor_exists", Boolean(heroDescriptor?.objectType) && heroDescriptor.objectType !== "unknown", `objectType=${heroDescriptor?.objectType ?? "none"}`);
  gate("v3_hero_proxy_uses_object_descriptor", heroLayerHasDescriptor, `hook moving_material carries heroDescriptor=${heroLayerHasDescriptor}`);
  gate("v3_kinetic_text_clip_motion_min", textClips.length > 0 && textClips.every((m) => (m.motionDiffMean ?? 0) >= 0.01), `text-clip motion=[${textClips.map((m) => m.motionDiffMean).join(",")}]`);
  gate("v3_montage_clip_motion_min", (montage?.motionDiffMean ?? 0) >= 0.04, `proof motionDiffMean=${montage?.motionDiffMean}`);
  gate("v3_typography_layout_evidence_present", (template3.typographyEvidence?.length ?? 0) >= 3 || textTypoLayers.length >= 2, `typoEvidence=${template3.typographyEvidence?.length ?? 0} textTypoLayers=${textTypoLayers.length}`);
  gate("v3_audio_richness_min", audio.hasAudio === true && (audio.spectralCentroidMean ?? 0) >= 900 && (audio.chromaVarMean ?? 0) >= 0.03, `centroid=${audio.spectralCentroidMean} chromaVar=${audio.chromaVarMean}`, audio);
  gate("v3_storyboard_nonempty", Array.isArray(generation?.storyboard) && generation.storyboard.length > 0 && generation.storyboard.some((s) => (s.shotDescription || s.subtitle || s.timeRange)), `storyboard items=${generation?.storyboard?.length ?? 0}`);
  gate("v3_bgm_gap_deduped", bgmGaps.length <= 1, `bgm_missing count=${bgmGaps.length}`);
  gate("v3_fill_plan_audio_policy_consistent", (!bgmFill || (bgmFill.strategy !== "aigc_placeholder" && bgmFill.strategy !== "aigc_generated_asset")) && ["synth_beat", "sample_bgm"].includes(audioPolicy), `bgmFill=${bgmFill?.strategy} audioPolicy=${audioPolicy}`);

  // --- VisualElementGraph: located elements must be CONSUMED by the renderer, not just exist. ---
  const graph = template3.visualElementGraph;
  const graphElements = graph?.elements ?? [];
  const heroGraphEl = graphElements.find((e) => e.family === "hero_object");
  const textGraphEls = graphElements.filter((e) => e.family === "kinetic_typography");
  const heroLayerHasElement = clips.some((c) => c.role === "hook" && (c.layers ?? []).some((l) => l.kind === "moving_material" && l.style?.heroElement?.positionClass));
  const textLayoutRolesUsed = new Set(clips.flatMap((c) => c.layers ?? []).filter((l) => l.style?.typography?.layoutRole).map((l) => l.style.typography.layoutRole));
  const textAnimUsed = clips.flatMap((c) => c.layers ?? []).some((l) => l.style?.typography?.animationHint);

  gate("v3_visual_element_graph_exists", graphElements.length >= 5, `${graphElements.length} located elements`);
  gate("v3_hero_object_bbox_track_exists", (heroGraphEl?.bboxTrackNorm?.length ?? 0) >= 2 && (heroGraphEl?.centerTrajectory?.length ?? 0) >= 2, `heroTrack=${heroGraphEl?.bboxTrackNorm?.length ?? 0}`);
  gate("v3_text_bbox_track_count_min", textGraphEls.length >= 3, `text elements=${textGraphEls.length}`);
  // ACTUAL CONSUMPTION: the hook clip's moving_material layer carries the located element AND the
  // rendered opening clip moves (so the silhouette was positioned + animated from the graph).
  gate("v3_element_graph_renderer_consumed", heroLayerHasElement && (hero?.motionDiffMean ?? 0) >= 0.025, `heroElementOnLayer=${heroLayerHasElement} renderedHeroMotion=${hero?.motionDiffMean}`);
  gate("v3_typography_layout_used", textLayoutRolesUsed.size >= 2, `distinct layout roles on clips=[${[...textLayoutRolesUsed].join(",")}]`);
  gate("v3_kinetic_text_animation_present", textAnimUsed, `text animation on clips=${textAnimUsed}`);
  gate("v3_audio_structure_used", Boolean(timeline?.renderPlan?.audioPlan?.layers), `audioPlan.layers=${JSON.stringify(timeline?.renderPlan?.audioPlan?.layers ?? null)}`);
}

const failures = gates.filter((g) => !g.passed).map((g) => g.id);
const overall = failures.length ? "fail" : warnings.length ? "warn" : "pass";
const report = { overall, render, scores: { gatesPassed: gates.filter((g) => g.passed).length, gatesTotal: gates.length }, gates, failures, warnings, evidence };

if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nrender-quality: ${overall.toUpperCase()} (${report.scores.gatesPassed}/${report.scores.gatesTotal} gates, ${failures.length} failures, ${warnings.length} warnings)`);
process.exit(overall === "fail" && args.strict ? 2 : 0);
