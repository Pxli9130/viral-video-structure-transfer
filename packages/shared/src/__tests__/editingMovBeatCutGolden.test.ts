import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildFallbackTemplate,
  generateMigrationResult,
  validateStructureTemplate,
  validateTimeline,
  type GenerationRequest,
  type RequiredSlot,
  type StructureTemplate,
  type TimelineClip,
  type VideoAnalysisResult,
  type VisualEvidenceTimeline
} from "../index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureDir = path.join(repoRoot, "packages", "shared", "src", "__tests__", "fixtures", "expected_editing_mov_case");
const editingMov = path.join(repoRoot, "test_videos", "editing.mov");

function readFixtureJson<T>(entry: string): T {
  const filePath = path.join(fixtureDir, entry);
  if (!existsSync(filePath)) {
    throw new Error(`Missing editing.mov golden fixture file: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

type RenderGateFixture = {
  templateAssertions: {
    videoType: string;
    selectedTemplateNameMustContain: string[];
    forbiddenTemplateNameSubstrings: string[];
    qualityRationaleForbiddenSubstrings: string[];
    minRequiredSlots: number;
    minSlotsWithFrameEvidence: number;
    minStructureAtoms: number;
    mustHaveRendererCandidates: string[];
  };
  renderAssertions: {
    durationSec: { min: number; max: number };
    resolution: { width: number; height: number };
    audioExpected: boolean;
    forbiddenVisibleStrings: string[];
    fps: { min: number; max: number };
    audioPolicy: string;
    styleTokensRequired: string[];
  };
};

type ExpectedTimelineFixture = {
  styleLock: {
    requiredRendererComponents: string[];
    forbiddenVisibleStrings: string[];
  };
};

const expectedTemplate = readFixtureJson<StructureTemplate>("expected-structure-template-editing-mov.v1.2.json");
const expectedTimeline = readFixtureJson<ExpectedTimelineFixture>("expected-timeline-editing-mov.v1.2.json");
const gates = readFixtureJson<RenderGateFixture>("expected-render-quality-gates-editing-mov.json");
const realEvidenceTimeline = readFixtureJson<VisualEvidenceTimeline>("real-evidence-timeline-editing-mov.json");

const expectedPrompt =
  "主题：爆款结构迁移引擎；把 editing.mov 的剪辑教程结构迁移成 15 秒产品 demo，强调上传素材、分析结构、自动重组；CTA：立即生成测试。";

function editingMovAnalysisFromRealEvidence(evidence: VisualEvidenceTimeline): VideoAnalysisResult {
  return {
    id: "analysis_editing_mov_real_evidence_regression",
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
      description: `${frame.family ?? "unknown"} evidence from real editing.mov analyzer: ${frame.reason ?? ""}`.trim(),
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
        blackBgRatio: evidence.stats.blackBgRatio,
        cutDensity: evidence.stats.cutDensity,
        families: Array.from(new Set(evidence.shots.map((shot) => shot.family)))
      }
    },
    motifCandidates: Array.from(new Set(evidence.shots.map((shot) => shot.family))).map((family) => ({
      motif: String(family ?? "unknown"),
      confidence: Math.max(...evidence.shots.filter((shot) => shot.family === family).map((shot) => shot.confidence))
    })),
    warnings: [
      "Golden regression fixture generated from real test_videos/editing.mov by scripts/analyze-evidence-timeline.py.",
      ...evidence.warnings
    ],
    analyzerMode: "ffmpeg_vlm_asr",
    createdAt: "2026-05-29T00:00:00.000Z"
  };
}

function expectedGenerationRequest(): GenerationRequest {
  return {
    projectId: "expected_editing_mov_project",
    inputMode: "prompt_only",
    selectedTemplateIds: [expectedTemplate.id],
    prompt: expectedPrompt,
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

function hasEvidence(slot: RequiredSlot): boolean {
  const evidence = slot.sourceEvidence as (RequiredSlot["sourceEvidence"] & { timestampRangeSec?: [number, number] }) | undefined;
  const timeRange = evidence?.timestampRangeSec ?? evidence?.timeRange;
  return Boolean(timeRange?.length === 2 && (evidence?.frameIds?.length ?? 0) > 0 && evidence?.summary);
}

function allVisibleTimelineText(clips: TimelineClip[]): string {
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

function primitiveNames(clips: TimelineClip[]): string[] {
  const map: Record<string, string> = {
    neon_hero_intro: "NeonHeroIntro",
    beat_text_card: "BeatTextCard",
    tutorial_rule_card: "TutorialRuleCard",
    action_montage: "ActionMontage",
    impact_flash_stamp: "ImpactFlashStamp",
    motivation_cta: "MotivationCTA"
  };
  return Array.from(new Set(clips.map((clip) => map[clip.motionPrimitive ?? ""] ?? clip.motionPrimitive).filter(Boolean) as string[]));
}

describe("editing.mov beat-cut golden regression", () => {
  it("locks selected template to evidence-backed beat_cut instead of generic B2B fallback", () => {
    expect(existsSync(editingMov), `Missing sample video: ${editingMov}`).toBe(true);
    expect(statSync(editingMov).size).toBeGreaterThan(100_000);
    expect.soft(realEvidenceTimeline.analyzerMode).toBe("evidence_timeline_v1");
    expect.soft(realEvidenceTimeline.shots.length).toBeGreaterThanOrEqual(10);
    expect.soft(realEvidenceTimeline.durationSec).toBeGreaterThan(100);
    expect.soft(realEvidenceTimeline.hasAudio).toBe(true);
    expect.soft(realEvidenceTimeline.evidenceFrames.every((frame) => frame.path && existsSync(path.join(repoRoot, frame.path)))).toBe(true);

    const template = buildFallbackTemplate(editingMovAnalysisFromRealEvidence(realEvidenceTimeline), "beat_cut", "expected_editing_mov_project");
    const templateValidation = validateStructureTemplate(template);

    expect.soft(templateValidation.valid, templateValidation.errors.join("; ")).toBe(true);
    expect.soft(template.videoType).toBe(gates.templateAssertions.videoType);
    for (const required of gates.templateAssertions.selectedTemplateNameMustContain) {
      expect.soft(template.name).toContain(required);
    }
    for (const forbidden of gates.templateAssertions.forbiddenTemplateNameSubstrings) {
      expect.soft(template.name).not.toContain(forbidden);
    }
    for (const forbidden of gates.templateAssertions.qualityRationaleForbiddenSubstrings) {
      expect.soft(template.qualityRationale).not.toContain(forbidden);
    }

    const requiredSlotIds = new Set(template.requiredSlots.map((slot) => slot.id));
    for (const expectedSlotId of expectedTemplate.requiredSlots.map((slot) => slot.id)) {
      expect.soft(requiredSlotIds.has(expectedSlotId), `missing expected editing.mov slot ${expectedSlotId}`).toBe(true);
    }
    expect.soft(template.requiredSlots.length).toBeGreaterThanOrEqual(gates.templateAssertions.minRequiredSlots);
    expect.soft(template.structureAtoms.length).toBeGreaterThanOrEqual(gates.templateAssertions.minStructureAtoms);
    expect.soft(template.requiredSlots.filter(hasEvidence).length).toBeGreaterThanOrEqual(gates.templateAssertions.minSlotsWithFrameEvidence);

    const rendererCandidates = new Set(template.requiredSlots.flatMap((slot) => slot.rendererCandidates ?? []));
    for (const expectedCandidate of gates.templateAssertions.mustHaveRendererCandidates) {
      expect.soft(rendererCandidates.has(expectedCandidate), `missing renderer candidate ${expectedCandidate}`).toBe(true);
    }
  });

  it("generates a beat-cut timeline with locked style primitives, audio policy, and no placeholder strings", () => {
    const template = buildFallbackTemplate(editingMovAnalysisFromRealEvidence(realEvidenceTimeline), "beat_cut", "expected_editing_mov_project");
    const generation = generateMigrationResult({
      template,
      request: expectedGenerationRequest(),
      selectedTemplateReason: "selected editing.mov beat_cut golden template from timestamp/frame evidence"
    });
    const timeline = generation.timeline;
    const timelineValidation = validateTimeline(timeline);

    expect.soft(generation.selectedTemplateIds).toContain(expectedTemplate.id);
    expect.soft(generation.selectedTemplateReason).not.toMatch(/B2B MG Promo Structure|Hook Body Proof CTA|deterministic fallback|LLM failed/i);
    expect.soft(timelineValidation.valid, timelineValidation.errors.join("; ")).toBe(true);
    expect.soft(timeline.durationSec).toBeGreaterThanOrEqual(gates.renderAssertions.durationSec.min);
    expect.soft(timeline.durationSec).toBeLessThanOrEqual(gates.renderAssertions.durationSec.max);
    expect.soft(timeline.renderPlan?.width).toBe(gates.renderAssertions.resolution.width);
    expect.soft(timeline.renderPlan?.height).toBe(gates.renderAssertions.resolution.height);
    expect.soft(timeline.renderPlan?.fps).toBeGreaterThanOrEqual(gates.renderAssertions.fps.min);
    expect.soft(timeline.renderPlan?.fps).toBeLessThanOrEqual(gates.renderAssertions.fps.max);
    expect.soft(timeline.renderPlan?.audioPolicy).toBe("synth_beat");
    expect.soft(timeline.renderPlan?.adapterOptions?.noSampleVisualCopy).toBe(true);
    expect.soft(timeline.renderPlan?.adapterOptions?.sampleAssetReuse).toBe("disabled");

    const primitives = primitiveNames(timeline.clips);
    for (const primitive of expectedTimeline.styleLock.requiredRendererComponents) {
      expect.soft(primitives, `missing beat-cut primitive ${primitive}`).toContain(primitive);
    }

    const visibleText = allVisibleTimelineText(timeline.clips);
    for (const forbidden of [...expectedTimeline.styleLock.forbiddenVisibleStrings, ...gates.renderAssertions.forbiddenVisibleStrings]) {
      expect.soft(visibleText).not.toMatch(new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }
    for (const styleToken of gates.renderAssertions.styleTokensRequired) {
      expect.soft(visibleText, `missing style token ${styleToken}`).toContain(styleToken);
    }
    expect.soft(timeline.clips.some((clip) => (clip.beatTimestamps?.length ?? 0) > 0)).toBe(true);
    expect.soft(timeline.clips.every((clip) => clip.sourceAssetId !== "asset_editing_mov_sample")).toBe(true);
  });
});
