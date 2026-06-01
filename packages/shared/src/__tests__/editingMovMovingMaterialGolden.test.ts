import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildBeatCutTemplate,
  generateMigrationResult,
  validateStructureTemplate,
  validateTimeline,
  type GenerationRequest,
  type TimelineClip,
  type VideoAnalysisResult,
  type VisualEvidenceTimeline
} from "../index.js";

/**
 * v2 "moving-material-aware" golden for editing.mov. Deterministic + offline: it drives the engine
 * from a committed real evidence-timeline-v2 fixture (produced by the real analyzer on editing.mov)
 * and asserts the 8-slot moving-material beat_cut grammar, the layered timeline, honest gaps, and a
 * 152-BPM audio plan. It also proves the v2 render-quality thresholds have teeth: the committed
 * ideal render clears them while the committed (pre-fix) static render fails the motion bar.
 *
 * The live render + the metric gate on a freshly rendered MP4 are exercised by
 * scripts/run-editing-beatcut-e2e.mjs + scripts/evaluate-render-quality.mjs --gates v2 (real ffmpeg).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureDir = path.join(repoRoot, "packages", "shared", "src", "__tests__", "fixtures", "expected_editing_mov_case_v2");

function readFixture<T>(entry: string): T {
  const filePath = path.join(fixtureDir, entry);
  if (!existsSync(filePath)) throw new Error(`Missing editing.mov v2 golden fixture: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

const evidence = readFixture<VisualEvidenceTimeline>("real-evidence-timeline-editing-mov.v2.json");
const v2Gates = readFixture<{
  mustPass: Record<string, boolean>;
  metricThresholds: {
    durationSec: [number, number];
    resolution: string;
    minMovingMaterialFamilies: number;
    minMotionDiffMean: number;
    minCutLikeCount: number;
    minSlotEvidenceCoverage: number;
    minLayeredClips: number;
  };
}>("ideal-render-quality-gates-editing-mov.v2.json");
const metrics = readFixture<Record<string, { motionDiffMean: number; cutLikeCount: number; hasAudio: boolean; streams: Array<{ width: number; height: number }> }>>(
  "ffprobe-and-visual-metrics.json"
);

const REQUIRED_SLOT_IDS = [
  "slot_moving_hero_object",
  "slot_dark_background",
  "slot_kinetic_text_card",
  "slot_storyboard_rule_card",
  "slot_moving_source_montage",
  "slot_impact_flash",
  "slot_bgm_grid",
  "slot_motivation_cta"
];
const REQUIRED_PRIMITIVES = ["neon_hero_intro", "beat_text_card", "tutorial_rule_card", "action_montage", "impact_flash_stamp", "motivation_cta"];

function analysisFromEvidence(ev: VisualEvidenceTimeline): VideoAnalysisResult {
  return {
    id: "analysis_editing_mov_v2_golden",
    assetId: ev.sourceAssetId ?? "asset_editing_mov",
    projectId: "v2_editing_mov_project",
    purpose: "sample",
    sourceFilename: ev.sourceAssetFilename ?? "editing.mov",
    metadata: { durationSec: ev.durationSec, hasAudio: ev.hasAudio, width: 1280, height: 720, fps: 24 },
    keyframes: ev.evidenceFrames.map((frame) => ({
      id: frame.id,
      timeSec: frame.timeSec,
      path: frame.path,
      description: `${frame.family ?? "unknown"} evidence: ${frame.reason ?? ""}`.trim(),
      tags: [`${frame.family ?? "unknown"}_candidate`, ...(frame.evidenceKinds ?? [])]
    })),
    shots: ev.shots.map((shot) => ({
      id: shot.shotId,
      startSec: shot.startSec,
      endSec: shot.endSec,
      durationSec: shot.durationSec,
      tags: [...shot.visualTags, ...shot.styleTags, `${shot.family ?? "unknown"}_candidate`],
      confidence: shot.confidence,
      notes: `family=${shot.family ?? "unknown"} motionEnergy=${shot.motionEnergy ?? 0}`
    })),
    transcript: [],
    ocr: [],
    evidenceTimeline: ev,
    warnings: [],
    analyzerMode: "ffmpeg_vlm_asr",
    createdAt: "2026-05-30T03:44:00.000Z"
  };
}

function buildRequest(templateId: string): GenerationRequest {
  return {
    projectId: "v2_editing_mov_project",
    inputMode: "video_plus_prompt",
    sourceVideo: { assetId: evidence.sourceAssetId ?? "asset_editing_mov" },
    sampleReferenceAssetId: evidence.sourceAssetId ?? "asset_editing_mov",
    selectedTemplateIds: [templateId],
    prompt: "主题：爆款结构迁移引擎；把 editing.mov 的剪辑教程结构迁移成 15 秒同风格短视频。",
    target: { vertical: "beat_cut", aspectRatio: "9:16", targetDurationSec: 15, outputMode: "mp4_render" },
    controls: { pace: "fast", hookIntensity: "aggressive", packagingStyle: "bold", ctaStyle: "direct", creativeMode: "final_creative" },
    constraints: { noSampleVisualCopy: true, sampleAssetReuse: "disabled" }
  };
}

function allVisibleText(clips: TimelineClip[]): string {
  return clips
    .flatMap((clip) => [clip.subtitleText, clip.visualIntent, clip.motionPrimitive, ...(clip.styleTokens ?? []), ...clip.layers.flatMap((l) => [l.text, JSON.stringify(l.style ?? {})])])
    .filter(Boolean)
    .join(" ");
}

describe("editing.mov moving-material v2 golden", () => {
  it("committed evidence is motion-aware (v2 schema: families, motionEnergy, frame metrics, moving candidates)", () => {
    expect.soft(evidence.schemaVersion).toBe("visual-evidence-timeline-v2");
    expect.soft(evidence.detectedStyle?.videoType).toBe("beat_cut");
    expect.soft(evidence.beatGrid.bpm ?? 0).toBeGreaterThan(120);
    const families = new Set((evidence.evidenceFamilies ?? []).map((f) => f.family));
    for (const fam of ["object_motion", "background", "bgm", "live_action_montage", "kinetic_typography", "storyboard"]) {
      expect.soft(families.has(fam), `missing evidence family ${fam}`).toBe(true);
    }
    expect.soft(evidence.shots.every((s) => typeof s.motionEnergy === "number")).toBe(true);
    expect.soft((evidence.frameMetrics?.length ?? 0)).toBeGreaterThanOrEqual(40);
    expect.soft((evidence.movingObjectCandidates?.length ?? 0)).toBeGreaterThan(0);
  });

  it("builds the 8-slot moving-material beat_cut template with tight, non-whole-video evidence", () => {
    const template = buildBeatCutTemplate(analysisFromEvidence(evidence), "beat_cut", "v2_editing_mov_project");
    const validation = validateStructureTemplate(template);
    expect.soft(validation.valid, validation.errors.join("; ")).toBe(true);
    expect.soft(template.videoType).toBe("beat_cut");
    expect.soft(template.name).toContain("editing.mov");
    expect.soft(template.name).not.toMatch(/B2B MG Promo Structure/);

    const ids = new Set(template.requiredSlots.map((s) => s.id));
    for (const id of REQUIRED_SLOT_IDS) expect.soft(ids.has(id), `missing slot ${id}`).toBe(true);
    expect.soft(template.rhythm.bpm).toBe(evidence.beatGrid.bpm);

    // slot evidence coverage >= the v2 threshold (0.8)
    const covered = template.requiredSlots.filter((s) => (s.sourceEvidence?.frameIds?.length ?? 0) > 0 || Boolean(s.sourceEvidence?.timeRange)).length;
    expect.soft(covered / template.requiredSlots.length).toBeGreaterThanOrEqual(v2Gates.metricThresholds.minSlotEvidenceCoverage);

    // non-global evidence must be tight (the old bug bound slot_impact_flash to [0, 118])
    const impact = template.requiredSlots.find((s) => s.id === "slot_impact_flash");
    expect.soft(impact?.sourceEvidence?.timeRange?.[0] ?? 0).toBeGreaterThan(60);
    expect.soft((impact?.sourceEvidence?.timeRange?.[1] ?? evidence.durationSec)).toBeLessThan(evidence.durationSec);

    // the moving montage slot carries a real motion requirement + fallback ladder
    const montage = template.requiredSlots.find((s) => s.id === "slot_moving_source_montage");
    expect.soft(montage?.assetRequirement?.type).toBe("moving_visual");
    expect.soft(montage?.assetRequirement?.minCount ?? 0).toBeGreaterThanOrEqual(3);
    expect.soft(montage?.fallbackStrategies).toContain("procedural_dynamic_proxy");

    // background + BGM are global
    expect.soft(template.requiredSlots.find((s) => s.id === "slot_dark_background")?.role).toBe("global");
    expect.soft(template.requiredSlots.find((s) => s.id === "slot_bgm_grid")?.role).toBe("global");

    // moving-material families present (>= threshold)
    const slotFamilies = new Set(template.requiredSlots.map((s) => s.visualFormFamily));
    expect.soft(slotFamilies.size).toBeGreaterThanOrEqual(v2Gates.metricThresholds.minMovingMaterialFamilies);
  });

  it("generates a layered beat_cut timeline + honest gaps + audio plan, with no sample copy or placeholder text", () => {
    const analysis = analysisFromEvidence(evidence);
    const template = buildBeatCutTemplate(analysis, "beat_cut", "v2_editing_mov_project");
    const generation = generateMigrationResult({ template, request: buildRequest(template.id), sourceAnalysis: analysis });
    const tl = generation.timeline;
    const validation = validateTimeline(tl);
    expect.soft(validation.valid, validation.errors.join("; ")).toBe(true);

    // duration + resolution
    expect.soft(tl.durationSec).toBeGreaterThanOrEqual(v2Gates.metricThresholds.durationSec[0]);
    expect.soft(tl.durationSec).toBeLessThanOrEqual(v2Gates.metricThresholds.durationSec[1]);
    expect.soft(tl.renderPlan?.width).toBe(720);
    expect.soft(tl.renderPlan?.height).toBe(1280);

    // real beat grid + audio plan
    expect.soft(tl.renderPlan?.beatGrid?.bpm).toBe(evidence.beatGrid.bpm);
    expect.soft(tl.renderPlan?.audioPlan?.required).toBe(true);
    expect.soft((tl.renderPlan?.audioPlan?.beatGridSec?.length ?? 0)).toBeGreaterThan(20);

    // >= minLayeredClips layered clips, each carrying typed v2 layers
    expect.soft(tl.clips.filter((c) => c.layers.length >= 2).length).toBeGreaterThanOrEqual(v2Gates.metricThresholds.minLayeredClips);
    const layerKinds = new Set(tl.clips.flatMap((c) => c.layers.map((l) => String(l.kind))));
    for (const kind of ["background", "moving_material", "moving_video", "beat_bars", "ticker"]) {
      expect.soft(layerKinds.has(kind), `missing v2 layer kind ${kind}`).toBe(true);
    }

    // all six beat-cut primitives present
    const primitives = new Set(tl.clips.map((c) => c.motionPrimitive));
    for (const prim of REQUIRED_PRIMITIVES) expect.soft(primitives.has(prim), `missing primitive ${prim}`).toBe(true);

    // honest gaps: moving material + BGM
    const gapTypes = new Set((generation.gapReport ?? []).map((g) => g.gapType));
    expect.soft(gapTypes.has("moving_material_missing")).toBe(true);
    expect.soft(gapTypes.has("bgm_missing")).toBe(true);

    // never copies sample visuals
    expect.soft(tl.clips.every((c) => !c.sourceAssetId)).toBe(true);
    expect.soft(tl.clips.every((c) => c.beatTimestamps && c.beatTimestamps.length > 0)).toBe(true);

    // no placeholder / debug strings anywhere visible
    const visible = allVisibleText(tl.clips);
    for (const re of [/proxy/i, /placeholder/i, /占位/, /插槽/, /B2B MG Promo/i]) {
      expect.soft(visible, `placeholder string matched ${re}`).not.toMatch(re);
    }
  });

  it("v3 human-fidelity: learns a hero-object (head/mask) descriptor + typography layout, threaded onto clips", () => {
    expect.soft(evidence.heroDescriptor?.objectType, "hero descriptor objectType").toBeTruthy();
    expect.soft(evidence.heroDescriptor?.objectType).not.toBe("unknown");
    expect.soft((evidence.typographyEvidence?.length ?? 0), "typography evidence items").toBeGreaterThanOrEqual(3);
    const layoutRoles = new Set((evidence.typographyEvidence ?? []).map((t) => t.layoutRole));
    expect.soft(layoutRoles.size, "varied typography layout roles").toBeGreaterThanOrEqual(2);

    const analysis = analysisFromEvidence(evidence);
    const template = buildBeatCutTemplate(analysis, "beat_cut", "v2_editing_mov_project");
    expect.soft(template.heroDescriptor?.objectType).toBe(evidence.heroDescriptor?.objectType);
    const generation = generateMigrationResult({ template, request: buildRequest(template.id), sourceAnalysis: analysis });
    const tl = generation.timeline;

    // hero clip carries the hero descriptor on its moving_material layer
    const hook = tl.clips.find((c) => c.role === "hook");
    const heroLayer = (hook?.layers ?? []).find((l) => l.kind === "moving_material");
    expect.soft((heroLayer?.style as Record<string, unknown> | undefined)?.heroDescriptor, "hook moving_material heroDescriptor").toBeTruthy();
    // text clips carry typography layout hints (text isn't always centered)
    const typoTextLayers = tl.clips.flatMap((c) => c.layers).filter((l) => (l.kind === "text" || l.kind === "text_overlay") && (l.style as Record<string, unknown> | undefined)?.typography);
    expect.soft(typoTextLayers.length, "text layers with typography").toBeGreaterThanOrEqual(2);

    // honest gaps are deduped and the BGM is procedural (not an AIGC image stub)
    const bgmGaps = (generation.gapReport ?? []).filter((g) => g.gapType === "bgm_missing");
    expect.soft(bgmGaps.length, "bgm_missing gap is deduped").toBeLessThanOrEqual(1);
    const bgmFill = (generation.fillPlan ?? []).find((f) => f.slotId === "slot_bgm_grid");
    expect.soft(bgmFill?.strategy, "slot_bgm_grid uses procedural fill").not.toMatch(/aigc/i);

    // VisualElementGraph located elements are threaded onto the template + consumed by clip layers
    const graph = (evidence as unknown as { visualElementGraph?: { elements?: Array<{ family: string; bboxTrackNorm?: unknown[] }> } }).visualElementGraph;
    expect.soft((graph?.elements?.length ?? 0), "located graph elements").toBeGreaterThanOrEqual(5);
    const heroGraphEl = (graph?.elements ?? []).find((e) => e.family === "hero_object");
    expect.soft((heroGraphEl?.bboxTrackNorm?.length ?? 0), "hero bbox track").toBeGreaterThanOrEqual(2);
    expect.soft((template.visualElementGraph?.elements?.length ?? 0), "graph threaded onto template").toBeGreaterThanOrEqual(5);
    const heroElOnLayer = (heroLayer?.style as Record<string, unknown> | undefined)?.heroElement;
    expect.soft(heroElOnLayer, "hook layer carries located hero element (renderer consumes it)").toBeTruthy();
    // BGM mixed by learned audio-structure layers (not just BPM)
    expect.soft(tl.renderPlan?.audioPlan?.layers, "audioPlan layers from audio structure").toBeTruthy();
  });

  it("the v2 metric thresholds have teeth: the ideal render passes, the pre-fix static render fails", () => {
    const th = v2Gates.metricThresholds;
    const ideal = metrics.ideal_render_v2;
    expect.soft(ideal.motionDiffMean).toBeGreaterThanOrEqual(th.minMotionDiffMean);
    expect.soft(ideal.cutLikeCount).toBeGreaterThanOrEqual(th.minCutLikeCount);
    expect.soft(ideal.hasAudio).toBe(true);
    expect.soft(`${ideal.streams[0].width}x${ideal.streams[0].height}`).toBe(th.resolution);

    // the static "black-bg PPT cards" render that motivated v2 must FAIL the motion bar.
    const current = metrics.current_render;
    expect.soft(current.motionDiffMean).toBeLessThan(th.minMotionDiffMean);
    expect.soft(current.cutLikeCount).toBeLessThan(th.minCutLikeCount);
  });
});
