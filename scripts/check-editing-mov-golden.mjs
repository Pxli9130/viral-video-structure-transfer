import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFallbackTemplate, generateMigrationResult } from "../packages/shared/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "packages", "shared", "src", "__tests__", "fixtures", "expected_editing_mov_case");
const editingMov = path.join(repoRoot, "test_videos", "editing.mov");
const analyzer = path.join(repoRoot, "scripts", "analyze-evidence-timeline.py");

function readFixtureJson(name) {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));
}

function failIf(condition, message, failures) {
  if (condition) failures.push(message);
}

function runRealAnalyzer() {
  const workDir = mkdtempSync(path.join(tmpdir(), "vvst-editing-mov-golden-"));
  const out = path.join(workDir, "real-evidence-timeline-editing-mov.json");
  const framesDir = path.join(workDir, "frames");
  try {
    execFileSync("python", [
      analyzer,
      "--video",
      editingMov,
      "--out",
      out,
      "--frames-dir",
      framesDir,
      "--source-asset-id",
      "asset_editing_mov_sample",
      "--max-shots",
      "40"
    ], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      cleanup: () => rmSync(workDir, { recursive: true, force: true }),
      evidence: JSON.parse(readFileSync(out, "utf8"))
    };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

function analysisFromEvidence(evidence) {
  return {
    id: "analysis_editing_mov_real_e2e_check",
    assetId: evidence.sourceAssetId ?? "asset_editing_mov_sample",
    projectId: "expected_editing_mov_project",
    purpose: "sample",
    metadata: {
      durationSec: evidence.durationSec,
      hasAudio: evidence.hasAudio
    },
    keyframes: evidence.evidenceFrames.map((frame) => ({
      id: frame.id,
      timeSec: frame.timeSec,
      path: frame.path,
      description: `${frame.family ?? "unknown"} real analyzer evidence ${frame.reason ?? ""}`.trim(),
      tags: [`${frame.family ?? "unknown"}_candidate`, ...(frame.evidenceKinds ?? [])]
    })),
    shots: evidence.shots.map((shot) => ({
      id: shot.shotId,
      startSec: shot.startSec,
      endSec: shot.endSec,
      durationSec: shot.durationSec,
      tags: [...shot.visualTags, ...shot.styleTags, `${shot.family ?? "unknown"}_candidate`],
      confidence: shot.confidence,
      notes: [
        `real analyzer family=${shot.family ?? "unknown"}`,
        `visual=${shot.visualTags.join(",")}`,
        `style=${shot.styleTags.join(",")}`,
        `frames=${shot.keyframeIds.join(",")}`
      ].join(" | ")
    })),
    transcript: [],
    ocr: evidence.shots.flatMap((shot) => (shot.ocrText ?? []).map((text) => ({ timeSec: shot.startSec, text }))),
    evidenceTimeline: evidence,
    primaryMotif: {
      motif: "real_analyzer_editing_mov",
      confidence: 0.8,
      evidence: {
        analyzerMode: evidence.analyzerMode,
        blackBgRatio: evidence.stats?.blackBgRatio,
        cutDensity: evidence.stats?.cutDensity,
        families: Array.from(new Set(evidence.shots.map((shot) => shot.family)))
      }
    },
    motifCandidates: Array.from(new Set(evidence.shots.map((shot) => shot.family))).map((family) => ({
      motif: String(family ?? "unknown"),
      confidence: Math.max(...evidence.shots.filter((shot) => shot.family === family).map((shot) => shot.confidence))
    })),
    warnings: ["Generated live by scripts/check-editing-mov-golden.mjs from test_videos/editing.mov."],
    analyzerMode: "ffmpeg_vlm_asr",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
}

function generationRequest(expectedTemplate, gates) {
  return {
    projectId: "expected_editing_mov_project",
    inputMode: "prompt_only",
    selectedTemplateIds: [expectedTemplate.id],
    prompt: "主题：爆款结构迁移引擎；把 editing.mov 的剪辑教程结构迁移成 15 秒产品 demo，强调上传素材、分析结构、自动重组；CTA：立即生成测试。",
    target: {
      vertical: "b2b_marketing_mg",
      aspectRatio: "9:16",
      targetDurationSec: 15,
      outputMode: "storyboard_preview"
    },
    controls: {
      pace: "fast",
      hookIntensity: "strong",
      packagingStyle: "mg_motion",
      ctaStyle: "direct",
      allowAigcMaterialGeneration: false,
      allowExternalAigcProvider: false,
      subtitleGenerationMode: "prompt_only"
    },
    constraints: {
      noSampleVisualCopy: true,
      sampleAssetReuse: "disabled",
      forbiddenWords: gates.renderAssertions.forbiddenVisibleStrings
    }
  };
}

function visibleTimelineText(clips) {
  return clips
    .flatMap((clip) => [
      clip.id,
      clip.visualIntent,
      clip.scriptText,
      clip.subtitleText,
      clip.motionPrimitive,
      ...(clip.styleTokens ?? []),
      ...clip.layers.flatMap((layer) => [layer.text, JSON.stringify(layer.style ?? {})])
    ])
    .filter(Boolean)
    .join(" ");
}

function primitiveNames(clips) {
  const map = {
    neon_hero_intro: "NeonHeroIntro",
    beat_text_card: "BeatTextCard",
    tutorial_rule_card: "TutorialRuleCard",
    action_montage: "ActionMontage",
    impact_flash_stamp: "ImpactFlashStamp",
    motivation_cta: "MotivationCTA"
  };
  return Array.from(new Set(clips.map((clip) => map[clip.motionPrimitive] ?? clip.motionPrimitive).filter(Boolean)));
}

if (!existsSync(editingMov)) {
  console.error(`Missing sample video: ${path.relative(repoRoot, editingMov)}`);
  process.exit(2);
}

const expectedTemplate = readFixtureJson("expected-structure-template-editing-mov.v1.2.json");
const expectedTimeline = readFixtureJson("expected-timeline-editing-mov.v1.2.json");
const gates = readFixtureJson("expected-render-quality-gates-editing-mov.json");
const failures = [];
const run = runRealAnalyzer();

try {
  const evidence = run.evidence;
  failIf(evidence.analyzerMode !== "evidence_timeline_v1", `real analyzer mode mismatch: ${evidence.analyzerMode}`, failures);
  failIf(evidence.durationSec < 100, `editing.mov duration too short in analyzer output: ${evidence.durationSec}`, failures);
  failIf(!evidence.hasAudio, "real analyzer did not detect audio", failures);
  failIf((evidence.shots ?? []).length < 10, `real analyzer emitted too few shots: ${evidence.shots?.length ?? 0}`, failures);
  failIf((evidence.evidenceFrames ?? []).length < 10, `real analyzer emitted too few evidence frames: ${evidence.evidenceFrames?.length ?? 0}`, failures);

  const template = buildFallbackTemplate(analysisFromEvidence(evidence), "beat_cut", "expected_editing_mov_project");
  failIf(template.videoType !== gates.templateAssertions.videoType, `template videoType=${template.videoType}`, failures);
  for (const required of gates.templateAssertions.selectedTemplateNameMustContain) {
    failIf(!template.name.includes(required), `template name missing ${required}: ${template.name}`, failures);
  }
  for (const forbidden of gates.templateAssertions.forbiddenTemplateNameSubstrings) {
    failIf(template.name.includes(forbidden), `template name contains forbidden ${forbidden}`, failures);
  }
  for (const forbidden of gates.templateAssertions.qualityRationaleForbiddenSubstrings) {
    failIf(template.qualityRationale.includes(forbidden), `qualityRationale contains forbidden ${forbidden}`, failures);
  }
  const slotIds = new Set(template.requiredSlots.map((slot) => slot.id));
  for (const slot of expectedTemplate.requiredSlots) {
    failIf(!slotIds.has(slot.id), `missing expected slot ${slot.id}`, failures);
  }
  const rendererCandidates = new Set(template.requiredSlots.flatMap((slot) => slot.rendererCandidates ?? []));
  for (const candidate of gates.templateAssertions.mustHaveRendererCandidates) {
    failIf(!rendererCandidates.has(candidate), `missing renderer candidate ${candidate}`, failures);
  }

  const generation = generateMigrationResult({
    template,
    request: generationRequest(expectedTemplate, gates),
    selectedTemplateReason: "selected editing.mov beat_cut template from live analyzer evidence"
  });
  const timeline = generation.timeline;
  failIf(timeline.durationSec < gates.renderAssertions.durationSec.min || timeline.durationSec > gates.renderAssertions.durationSec.max, `timeline duration=${timeline.durationSec}`, failures);
  failIf(timeline.renderPlan?.width !== gates.renderAssertions.resolution.width, `timeline width=${timeline.renderPlan?.width}`, failures);
  failIf(timeline.renderPlan?.height !== gates.renderAssertions.resolution.height, `timeline height=${timeline.renderPlan?.height}`, failures);
  failIf(timeline.renderPlan?.audioPolicy !== "synth_beat", `audioPolicy=${timeline.renderPlan?.audioPolicy}`, failures);
  failIf(timeline.renderPlan?.adapterOptions?.sampleAssetReuse !== "disabled", "sample reuse is not disabled", failures);
  for (const primitive of expectedTimeline.styleLock.requiredRendererComponents) {
    failIf(!primitiveNames(timeline.clips).includes(primitive), `missing beat-cut primitive ${primitive}`, failures);
  }
  const visibleText = visibleTimelineText(timeline.clips);
  for (const forbidden of [...expectedTimeline.styleLock.forbiddenVisibleStrings, ...gates.renderAssertions.forbiddenVisibleStrings]) {
    failIf(new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(visibleText), `visible text contains forbidden ${forbidden}`, failures);
  }
  for (const styleToken of gates.renderAssertions.styleTokensRequired) {
    failIf(!visibleText.includes(styleToken), `missing style token ${styleToken}`, failures);
  }
} finally {
  run.cleanup();
}

if (failures.length) {
  console.error("editing.mov real golden check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("editing.mov real golden check passed.");
