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

function ffprobeStreams(file) {
  const out = spawnSync(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  try { return JSON.parse(out.stdout || "{}"); } catch { return {}; }
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

const failures = gates.filter((g) => !g.passed).map((g) => g.id);
const overall = failures.length ? "fail" : warnings.length ? "warn" : "pass";
const report = { overall, render, scores: { gatesPassed: gates.filter((g) => g.passed).length, gatesTotal: gates.length }, gates, failures, warnings, evidence };

if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nrender-quality: ${overall.toUpperCase()} (${report.scores.gatesPassed}/${report.scores.gatesTotal} gates, ${failures.length} failures, ${warnings.length} warnings)`);
process.exit(overall === "fail" && args.strict ? 2 : 0);
