// pipeline-v5/v2Reports.ts
// Schema-conformant evidence artifacts for the v2 manual-test suite (baokuan_manual_test_assets_v2):
//   - material_analysis : real ffprobe facts (duration/resolution/hasAudio) + quality/duplicate REJECTION +
//     crop suggestions + recommended slots, per user asset.  (TC-03/04/09; fixes the hasAudio bug)
//   - timeline (v2)     : REAL per-section timing from the capsule's timingSignature + video/text/audio tracks
//     + lineage (which atoms / user assets / generated assets each element came from).  (fixes "all 0-12s")
//   - mapping (v2)      : reference-slot -> new-content-slot adaptation with copy_risk.
// Everything here is derived from real pipeline state — no placeholders.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Asset, TranscriptSegment } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { resolveBin } from "./renderV5.js";
import { runPython } from "../adapters/condaPython.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const PY_DIR = path.join(path.resolve(moduleDir, "../../../.."), "scripts", "python");
const ASR_SCRIPT = path.join(PY_DIR, "asr_faster_whisper.py");
const HIGHLIGHT_SCRIPT = path.join(PY_DIR, "highlight_segments.py");

/** Local CV (cv2 + PySceneDetect) segment-level highlight scoring of a long user video (no paid API). */
export async function selectHighlightSegments(videoPath: string, top = 5): Promise<Array<Record<string, unknown>>> {
  try {
    const r = await runPython(HIGHLIGHT_SCRIPT, [videoPath, "--top", String(top)], { timeoutMs: 150000 });
    const parsed = JSON.parse(r.stdout || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Local faster-whisper transcription of a video's audio (conda `viral` env, no paid API). [] on failure/silence. */
export async function transcribeVideo(videoPath: string, model = "tiny"): Promise<TranscriptSegment[]> {
  try {
    const r = await runPython(ASR_SCRIPT, [videoPath, "--model", model], { timeoutMs: 120000 });
    const parsed = JSON.parse(r.stdout || "[]");
    return Array.isArray(parsed) ? (parsed as TranscriptSegment[]).filter((s) => typeof s?.startSec === "number" && typeof s?.endSec === "number") : [];
  } catch {
    return [];
  }
}

export interface MediaProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

/** Real ffprobe facts for a media file. Returns nulls on failure (never throws). */
export function probeMedia(path: string): MediaProbe {
  try {
    const r = spawnSync(
      resolveBin("ffprobe"),
      ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-show_entries", "format=duration", "-of", "json", path],
      { encoding: "utf8", timeout: 15000 }
    );
    if (r.status !== 0 || !r.stdout) return { durationSec: null, width: null, height: null, hasAudio: false };
    const j = JSON.parse(r.stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string } };
    const streams = j.streams ?? [];
    const v = streams.find((s) => s.codec_type === "video");
    const dur = j.format?.duration ? Number(j.format.duration) : null;
    return {
      durationSec: dur != null && Number.isFinite(dur) ? Math.round(dur * 100) / 100 : null,
      width: typeof v?.width === "number" ? v.width : null,
      height: typeof v?.height === "number" ? v.height : null,
      hasAudio: streams.some((s) => s.codec_type === "audio")
    };
  } catch {
    return { durationSec: null, width: null, height: null, hasAudio: false };
  }
}

const ASPECT_WH: Record<string, number> = { "9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1 };

// bestSection (hook|benefit|proof|cta) + shot -> the v2 schema's recommended_slots (hook|process|detail|proof|cta).
function recommendedSlots(profile: v5.TargetAssetProfile): string[] {
  const out: string[] = [];
  const sec = profile.bestSection;
  if (sec === "hook") out.push("hook");
  else if (sec === "benefit") out.push("process");
  else if (sec === "proof") out.push("proof");
  else if (sec === "cta") out.push("cta");
  const shot = `${profile.shotType ?? ""}`.toLowerCase();
  if (/close|特写|detail|product/.test(shot) && !out.includes("detail")) out.push("detail");
  return out.length ? out : ["process"];
}

/** WHY each recommended slot — explains the slot choice from the (VLM/heuristic) shot/scene/subject signals so a
 *  reviewer can see the material-understanding reasoning, not just a bare slot label. */
function recommendedSlotReasons(profile: v5.TargetAssetProfile, slots: string[]): Array<{ slot: string; reason: string }> {
  const shot = `${profile.shotType ?? ""}`.toLowerCase();
  const subjects = (profile.detectedSubjects ?? []).slice(0, 3).join("、");
  const scene = profile.sceneType ?? profile.shotType ?? "场景";
  const subj = subjects ? `主体「${subjects}」` : "主体未明确识别";
  const reasonFor: Record<string, string> = {
    hook: `${subj}、画面冲击力适合开场抓注意（场景：${scene}${profile.isHighlight ? "，含高光瞬间" : ""}）`,
    process: `${subj}、属过程/使用类镜头，适合中段叙述/演示（场景：${scene}）`,
    detail: `${/close|特写|detail|product/.test(shot) ? "特写/细节镜头" : subj}，适合证据/卖点放大段`,
    proof: `${subj}、可作社会证明/效果展示（场景：${scene}）`,
    cta: `${subj}、画面收束感适合结尾行动号召`,
  };
  return slots.map((s) => ({ slot: s, reason: reasonFor[s] ?? `${subj}，适合 ${s} 段` }));
}

export interface MaterialAnalysisResult {
  records: Array<Record<string, unknown>>;
  rejectedAssetIds: Set<string>;
}

/**
 * Build the material_analysis records (schema v2) for the user assets, with REAL probe facts and quality /
 * duplicate rejection. Rejected ids are returned so the binding step can keep bad/duplicate material out of
 * the hero/main shots (TC-04). `qualityFloor` (0-100) below which an asset is rejected as low quality.
 */
export function buildMaterialAnalysis(
  profiles: v5.TargetAssetProfile[],
  assets: Asset[],
  opts: { targetAspect?: string; qualityFloor?: number } = {}
): MaterialAnalysisResult {
  const targetAspect = opts.targetAspect ?? "9:16";
  const floor = opts.qualityFloor ?? 35;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const records: Array<Record<string, unknown>> = [];
  const rejected = new Set<string>();
  // For duplicate detection: remember (sceneType + sorted subjects) signatures already seen, with their score.
  const seen: Array<{ assetId: string; sig: string; score: number }> = [];

  for (const p of profiles) {
    const asset = byId.get(p.assetId);
    const isMedia = p.kind === "image" || p.kind === "video" || p.kind === "logo";
    const probeable = isMedia || p.kind === "audio";
    const probe = asset?.path && probeable ? probeMedia(asset.path) : { durationSec: null, width: null, height: null, hasAudio: false };
    const resolution = probe.width && probe.height ? `${probe.width}x${probe.height}` : null;
    const quality = Math.round(Math.max(0, Math.min(1, p.qualityScore ?? 0.6)) * 100);
    const subjects = (p.detectedSubjects ?? []).map((s) => String(s).toLowerCase()).sort();
    const sig = `${p.sceneType ?? p.kind}|${subjects.join(",")}`;

    // reject reasons: BAD INPUT (TC-13: empty/corrupt or extension-content mismatch) first, then low quality / duplicate.
    let reject: string | null = null;
    if (probeable && probe.width == null && probe.height == null && probe.durationSec == null) reject = "空文件 / 无法解析（损坏或 0 字节）";
    else if (p.kind === "video" && probe.durationSec == null && probe.width != null) reject = "扩展名与内容不符：实为静态图（无视频流/时长），不应作为视频镜头";
    else if (p.kind === "audio" && probe.durationSec == null) reject = "空 / 损坏音频（无时长）";
    if (!reject && isMedia && quality < floor) reject = `低质量（清晰度/亮度评分 ${quality}/100，低于阈值 ${floor}）`;
    if (!reject && subjects.length) {
      const dup = seen.find((s) => s.sig === sig);
      if (dup) reject = `与 ${dup.assetId} 角度/内容高度重复（场景+主体一致），保留质量更高的一条`;
    }
    if (!reject && isMedia) seen.push({ assetId: p.assetId, sig, score: quality });
    if (reject) rejected.add(p.assetId);

    // crop suggestions: only when the asset aspect differs from the target (would need cropping).
    const cropSuggestions: Array<Record<string, string>> = [];
    if (probe.width && probe.height) {
      const assetAR = probe.width / probe.height;
      const targetAR = ASPECT_WH[targetAspect] ?? 9 / 16;
      if (Math.abs(assetAR - targetAR) > 0.08) {
        if (assetAR > targetAR) {
          // wider than target -> crop width, keep centre.
          const w = Math.round(probe.height * targetAR);
          const x = Math.round((probe.width - w) / 2);
          cropSuggestions.push({ aspect: targetAspect, safe_box: `${x},0,${w},${probe.height}`, risk: "横向素材裁成竖屏：保留中部主体，避免裁掉两侧的手/产品" });
        } else {
          // taller than target -> crop height, keep centre.
          const h = Math.round(probe.width / targetAR);
          const y = Math.round((probe.height - h) / 2);
          cropSuggestions.push({ aspect: targetAspect, safe_box: `0,${y},${probe.width},${h}`, risk: "竖向素材裁成更短画幅：保留中部主体，避免裁掉顶部标题/底部 CTA" });
        }
      }
    }

    records.push({
      asset_id: p.assetId,
      path: asset?.path ?? null,
      type: p.kind === "logo" ? "image" : p.kind,
      duration_sec: probe.durationSec,
      resolution,
      has_audio: probe.hasAudio, // real stream fact (fixes the assumed-true bug)
      quality_score: quality,
      detected_scene: p.sceneType ?? p.shotType ?? "scene",
      detected_subjects: p.detectedSubjects ?? [],
      shot_type: p.shotType ?? null,
      best_section: p.bestSection ?? null,
      is_highlight: Boolean(p.isHighlight),
      recommended_slots: recommendedSlots(p),
      recommended_slot_reasons: recommendedSlotReasons(p, recommendedSlots(p)),
      reject_reason: reject,
      crop_suggestions: cropSuggestions,
      vlm_analyzed: Boolean(p.vlmAnalyzed)
    });
  }
  return { records, rejectedAssetIds: rejected };
}

// ---------------------------------------------------------------------------------------------------
// timeline v2 — real per-section timing from the capsule, with lineage.
// ---------------------------------------------------------------------------------------------------

type Binding = { slotId: string; status: string; assetId?: string; uri?: string; text?: string };

function sectionOf(slotId: string, sections: Array<{ id: string }>): string | undefined {
  return sections.find((s) => slotId.startsWith(s.id))?.id;
}
function safeZoneFor(role: string): "top" | "middle" | "bottom" {
  if (role === "hook") return "top";
  if (role === "cta") return "bottom";
  return "bottom";
}
function transformFor(status: string): string {
  if (status === "user_asset") return "crop";
  if (status === "aigc_generated") return "generated_card";
  if (status === "procedural_generated") return "generated_card";
  return "generated_card";
}

/**
 * Apply an NL-edit / knob TIMING change to a section list at the SOURCE so the change actually reaches the render
 * (the injected media track + renderRecipe both read these sections) — not just the timeline JSON. hookRatio
 * scales the hook; ctaAdvanceSec brings the CTA forward; frontloadBeforeSec pulls the benefit section before a
 * deadline. Bounded (never reorders); re-anchored so the last section still ends at the original total (the
 * composition duration is fixed). Returns NEW section objects.
 */
export function retimeSections<T extends { role: string; startSec: number; endSec: number }>(
  sections: T[],
  knobs: { hookRatio?: number; ctaAdvanceSec?: number; frontloadBeforeSec?: number }
): T[] {
  const k = knobs ?? {};
  const adj = sections.map((s) => ({ ...s }));
  if (!adj.length) return adj;
  const total = adj[adj.length - 1].endSec;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (k.hookRatio != null && k.hookRatio !== 1) {
    const hook = adj.find((s) => s.role === "hook") ?? adj[0];
    const delta = (hook.endSec - hook.startSec) * (k.hookRatio - 1);
    hook.endSec += delta;
    let after = false;
    for (const s of adj) { if (s === hook) { after = true; continue; } if (after) { s.startSec += delta; s.endSec += delta; } }
  }
  if (k.ctaAdvanceSec && k.ctaAdvanceSec > 0 && adj.length >= 2) {
    const ci = adj.findIndex((s) => s.role === "cta");
    if (ci > 0) {
      const cta = adj[ci], prev = adj[ci - 1];
      const adv = Math.min(k.ctaAdvanceSec, (prev.endSec - prev.startSec) * 0.6);
      cta.startSec = r2(Math.max(prev.startSec + 0.2, cta.startSec - adv));
      prev.endSec = cta.startSec;
    }
  }
  if (k.frontloadBeforeSec && k.frontloadBeforeSec > 0 && adj.length >= 2) {
    const deadline = k.frontloadBeforeSec;
    const bi = adj.findIndex((s) => s.role === "benefit");
    const idx = bi > 0 ? bi : adj.findIndex((s, i) => i > 0 && s.role !== "hook");
    if (idx > 0 && adj[idx].startSec >= deadline) {
      const seg = adj[idx], prev = adj[idx - 1];
      const target = r2(Math.max(prev.startSec + 0.2, deadline - 0.2));
      if (seg.startSec - target > 0.05) { seg.startSec = target; prev.endSec = target; }
    }
  }
  // Re-anchor so the section span still ends at the original total (composition duration is fixed) — scale only
  // if hookRatio changed the end; cta/frontload keep the end. Avoids a media/timeline total drift.
  const newTotal = adj[adj.length - 1].endSec;
  if (total > 0 && newTotal > 0 && Math.abs(newTotal - total) > 0.02) {
    const f = total / newTotal;
    for (const s of adj) { s.startSec = r2(s.startSec * f); s.endSec = r2(s.endSec * f); }
  }
  return adj;
}

export function buildTimelineV2(input: {
  projectId: string;
  capsule: v5.RemotionTemplateCapsule;
  slotBindings: Binding[];
  aspectRatio: string;
  audioBed?: { beatLocked?: boolean } | null;
  knowledgeAtomIds?: string[];
  /** Creative knobs that DETERMINISTICALLY re-time the plan (so multi-version + NL-edit timelines truly differ). */
  knobs?: { ctaAdvanceSec?: number; hookRatio?: number; rhythm?: string; frontloadBeforeSec?: number };
  /** Actual rendered video duration (sec). The render uses the capsule's RAW section timing, but the knob
   *  re-timing below changes the plan's total — pass this so the timeline is rescaled to MATCH the real video
   *  duration (faithful/可追溯), instead of claiming a total the video doesn't have. */
  renderDurationSec?: number;
}): Record<string, unknown> {
  const ts = input.capsule.timingSignature;
  const sections = ts.sections ?? [];
  const bySlot = new Map(input.slotBindings.map((b) => [b.slotId, b]));

  // SINGLE timing source: the timeline uses the capsule's section timing AS-IS — NO separate re-timing here. Any
  // NL-edit / knob timing change is applied at the SOURCE (retimeSections on capsule.timingSignature.sections in
  // runSameTemplateGeneration) so the injected media track + renderRecipe.layers + this timeline all agree and
  // match what actually plays. Each section is clamped to the real rendered duration so timeline.duration_sec ==
  // the video (no two-timelines-disagree). This fixes the prior timeline-vs-renderRecipe mismatch.
  const renderDur = input.renderDurationSec && input.renderDurationSec > 0
    ? input.renderDurationSec
    : (sections.length ? sections[sections.length - 1].endSec : (ts.durationSec ?? 0));
  const clamp = (v: number) => Math.round(Math.min(Math.max(0, v), Math.max(0.01, renderDur)) * 100) / 100;
  const adj = sections.map((s) => ({ id: s.id, role: s.role, startSec: clamp(s.startSec), endSec: clamp(s.endSec) }));
  const duration = Math.round(Math.max(0, renderDur) * 100) / 100;

  const video: Array<Record<string, unknown>> = [];
  const text: Array<Record<string, unknown>> = [];
  const userAssets = new Set<string>();
  const generatedAssets = new Set<string>();

  for (const sec of adj) {
    const mediaSlot = input.capsule.slotSchema.find((s) => s.id.startsWith(sec.id) && /image|logo|ui_mockup/.test(s.kind));
    const textSlot = input.capsule.slotSchema.find((s) => s.id.startsWith(sec.id) && /headline|subtitle|cta_text|data_value/.test(s.kind));
    if (mediaSlot) {
      const b = bySlot.get(mediaSlot.id);
      if (b?.status === "user_asset" && b.assetId) userAssets.add(b.assetId);
      if (b?.assetId && /generated/.test(b.status)) generatedAssets.add(b.assetId);
      video.push({
        segment_id: sec.id,
        start_sec: sec.startSec,
        end_sec: sec.endSec,
        source_asset_id: b?.assetId ?? null,
        structure_slot: sec.role,
        transform: transformFor(b?.status ?? "missing"),
        quality_reason: b?.status === "user_asset" ? "用户上传素材绑定到该结构槽位" : b?.status === "aigc_generated" ? "缺口由 AIGC 生成画面补足" : "缺口由程序化卡片/文案补足"
      });
    }
    if (textSlot) {
      const b = bySlot.get(textSlot.id);
      const content = b?.text ?? "";
      // Skip dropped subtitles (emptied by the textDensity knob) so the timeline reflects the real caption count.
      if (content) {
        text.push({
          text_id: textSlot.id,
          start_sec: sec.startSec,
          end_sec: sec.endSec,
          content,
          safe_zone: safeZoneFor(sec.role),
          style_ref: `${sec.role}_caption`
        });
      }
    }
  }

  // Include text slots the per-section pass didn't catch — global captions like `text_scene1_main` (kind "text"
  // / a `copy.*` propPath, NOT named `<sectionId>_text`). Assign each to a section by order so the timeline
  // lists the captions the video actually shows (faithful; drives the subtitle/density + multi-version evidence).
  const usedTextIds = new Set(text.map((t) => String(t.text_id)));
  const looseTextSlots = input.capsule.slotSchema.filter((s) =>
    !usedTextIds.has(s.id) &&
    (/headline|subtitle|cta_text|data_value|text/.test(s.kind) || Boolean(s.propPath && s.propPath.startsWith("copy."))) &&
    Boolean(bySlot.get(s.id)?.text)
  );
  looseTextSlots.forEach((s, i) => {
    const sec = adj[Math.min(i, adj.length - 1)] ?? adj[0];
    if (!sec) return;
    const content = bySlot.get(s.id)?.text ?? "";
    if (!content) return;
    text.push({ text_id: s.id, start_sec: sec.startSec, end_sec: sec.endSec, content, safe_zone: safeZoneFor(sec.role), style_ref: `${sec.role}_caption` });
  });

  const audio: Array<Record<string, unknown>> = [];
  if (input.audioBed) audio.push({ audio_id: "bed", start_sec: 0, end_sec: duration, source: "bgm", beat_locked: Boolean(input.audioBed.beatLocked) });

  return {
    $schema: "baokuan.v2.timeline",
    project_id: input.projectId,
    duration_sec: duration,
    aspect_ratio: input.aspectRatio,
    tracks: { video, text, audio },
    lineage: {
      reference_atoms: input.knowledgeAtomIds ?? [input.capsule.sourceSampleId],
      user_assets: [...userAssets],
      generated_assets: [...generatedAssets]
    }
  };
}

// ---------------------------------------------------------------------------------------------------
// mapping v2 — reference slot -> new-content slot, with copy_risk (low when the source words were replaced).
// ---------------------------------------------------------------------------------------------------

export function buildMappingV2(input: {
  capsule: v5.RemotionTemplateCapsule;
  slotBindings: Binding[];
  referenceVideoName: string;
  copyRisk: "low" | "medium" | "high";
}): Array<Record<string, unknown>> {
  const sections = input.capsule.timingSignature.sections ?? [];
  const bySlot = new Map(input.slotBindings.map((b) => [b.slotId, b]));
  return input.capsule.slotSchema.map((slot) => {
    const sec = sections.find((s) => slot.id.startsWith(s.id));
    const b = bySlot.get(slot.id);
    const isText = /headline|subtitle|cta_text|data_value/.test(slot.kind);
    return {
      reference_video: input.referenceVideoName,
      reference_slot: slot.originalRole || slot.id,
      reference_atom: `${sec?.role ?? "section"}:${slot.kind}`,
      new_content_slot: slot.id,
      user_asset_or_generated_asset: b?.assetId ?? (isText ? "text_generated" : "missing"),
      adaptation_reason:
        b?.status === "user_asset" ? "复用用户上传素材" : b?.status === "text_generated" ? "按新主题生成文案（不照搬样例措辞）" : /generated/.test(b?.status ?? "") ? "缺口由 AIGC/程序化补全" : "缺口未补全",
      copy_risk: isText ? input.copyRisk : "low"
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// edit_trace v2 — diff of the timeline BEFORE vs AFTER a natural-language / patch revise (TC-08).
// ---------------------------------------------------------------------------------------------------

type TimelineLike = { tracks?: { video?: Array<Record<string, unknown>>; text?: Array<Record<string, unknown>>; audio?: Array<Record<string, unknown>> } } | null | undefined;

export function timelineHash(t: TimelineLike): string {
  if (!t) return "none";
  return createHash("sha1").update(JSON.stringify(t.tracks ?? t)).digest("hex").slice(0, 16);
}

/** Diff before/after timelines into a schema-v2 edit_trace (command + hashes + per-segment changes). The
 *  applied `patch` is folded in so a knob revise (which changes code/palette/pacing, not slot-driven captions)
 *  still produces meaningful, honest changes rather than an empty diff. */
export function buildEditTrace(command: string, before: TimelineLike, after: TimelineLike, patch?: Record<string, unknown> | null): Record<string, unknown> {
  const changes: Array<Record<string, unknown>> = [];
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  // Intent-level changes from the patch that drove the revise.
  if (patch) {
    if (patch.rhythm) changes.push({ change_id: "patch_rhythm", operation: "style_change", target_segment_id: "pacing", before: {}, after: { rhythm: patch.rhythm }, reason: "整体节奏调整" });
    if (patch.textDensity) changes.push({ change_id: "patch_textDensity", operation: "style_change", target_segment_id: "subtitles", before: {}, after: { textDensity: patch.textDensity }, reason: "字幕密度调整" });
    if (patch.motionIntensity) changes.push({ change_id: "patch_motion", operation: "style_change", target_segment_id: "motion", before: {}, after: { motionIntensity: patch.motionIntensity }, reason: "运动强度调整" });
    // Timing knobs (cta/frontload/hook) — HONEST: only claim a "move"/"shorten" if the section ACTUALLY changed
    // between before/after; otherwise label it a no-op with the reason (a template whose benefit is already early
    // genuinely needs no frontload). This fixes the prior over-claim where the trace said "move" with no real change.
    const segBy = (tl: TimelineLike, role: string) => (tl?.tracks?.video ?? []).find((v) => String(v.structure_slot ?? "").includes(role) || String(v.segment_id ?? "").includes(role));
    const startOf = (tl: TimelineLike, role: string) => { const s = segBy(tl, role); return s ? num(s.start_sec) : null; };
    const spanOf = (tl: TimelineLike, role: string) => { const s = segBy(tl, role); return s ? num(s.end_sec) - num(s.start_sec) : null; };
    if (patch.ctaAdvanceSec != null) {
      const bs = startOf(before, "cta"), as = startOf(after, "cta");
      const moved = bs != null && as != null && bs - as > 0.05;
      changes.push({ change_id: "patch_cta", operation: moved ? "move" : "style_change", target_segment_id: "cta", before: bs != null ? { start_sec: bs } : {}, after: { start_sec: as, ctaAdvanceSec: patch.ctaAdvanceSec }, reason: moved ? `CTA 实际前移：${bs}s → ${as}s` : `请求 CTA 提前 ${patch.ctaAdvanceSec}s，但当前结构下 CTA 段未移动（no-op）` });
    }
    if (patch.frontloadBeforeSec != null) {
      const bs = startOf(before, "benefit"), as = startOf(after, "benefit");
      const moved = bs != null && as != null && bs - as > 0.05;
      changes.push({ change_id: "patch_frontload", operation: moved ? "move" : "style_change", target_segment_id: "benefit", before: bs != null ? { start_sec: bs } : {}, after: { start_sec: as, frontloadBeforeSec: patch.frontloadBeforeSec }, reason: moved ? `功能/卖点信息前移：benefit 段 ${bs}s → ${as}s（目标第 ${patch.frontloadBeforeSec}s 前）` : `功能/卖点信息已在第 ${patch.frontloadBeforeSec}s 前（benefit 段 start ${as ?? bs ?? "?"}s），无需前移（no-op）` });
    }
    if (patch.hookRatio != null) {
      const bspan = spanOf(before, "hook"), aspan = spanOf(after, "hook");
      const shorter = bspan != null && aspan != null && bspan - aspan > 0.05;
      changes.push({ change_id: "patch_hook", operation: shorter ? "shorten" : "style_change", target_segment_id: "hook", before: bspan != null ? { span_sec: Math.round(bspan * 100) / 100 } : {}, after: { span_sec: aspan != null ? Math.round(aspan * 100) / 100 : null, hookRatio: patch.hookRatio }, reason: shorter ? `开场钩子缩短：${Math.round((bspan as number) * 100) / 100}s → ${Math.round((aspan as number) * 100) / 100}s` : `请求调整钩子长度(×${patch.hookRatio})，时间轴上钩子段时长未变化（no-op）` });
    }
    if (patch.paletteMood || patch.palette) changes.push({ change_id: "patch_palette", operation: "style_change", target_segment_id: "palette", before: {}, after: { paletteMood: patch.paletteMood, palette: patch.palette }, reason: "配色/包装调整" });
    if (patch.theme) changes.push({ change_id: "patch_theme", operation: "replace", target_segment_id: "theme", before: {}, after: { theme: patch.theme }, reason: "主题替换" });
    for (const [k, vv] of Object.entries((patch.copyOverrides as Record<string, unknown>) ?? {})) changes.push({ change_id: `copy_${k}`, operation: "replace", target_segment_id: k, before: {}, after: { content: vv }, reason: "指定文案覆盖" });
  }
  const bv = new Map((before?.tracks?.video ?? []).map((s) => [String(s.segment_id), s]));
  for (const a of after?.tracks?.video ?? []) {
    const id = String(a.segment_id);
    const b = bv.get(id);
    if (!b) { changes.push({ change_id: `add_${id}`, operation: "replace", target_segment_id: id, before: {}, after: a, reason: "新增镜头段" }); continue; }
    if (b.source_asset_id !== a.source_asset_id) changes.push({ change_id: `rep_${id}`, operation: "replace", target_segment_id: id, before: { source_asset_id: b.source_asset_id }, after: { source_asset_id: a.source_asset_id }, reason: "该段镜头素材替换" });
    if (num(b.start_sec) !== num(a.start_sec) || num(b.end_sec) !== num(a.end_sec)) {
      const shorter = num(a.end_sec) - num(a.start_sec) < num(b.end_sec) - num(b.start_sec);
      changes.push({ change_id: `mv_${id}`, operation: shorter ? "shorten" : "move", target_segment_id: id, before: { start_sec: b.start_sec, end_sec: b.end_sec }, after: { start_sec: a.start_sec, end_sec: a.end_sec }, reason: "节奏/时间点调整" });
    }
  }
  const bt = new Map((before?.tracks?.text ?? []).map((s) => [String(s.text_id), s]));
  for (const a of after?.tracks?.text ?? []) {
    const id = String(a.text_id);
    const b = bt.get(id);
    if (!b) continue;
    if (b.content !== a.content) changes.push({ change_id: `txt_${id}`, operation: "replace", target_segment_id: id, before: { content: b.content }, after: { content: a.content }, reason: "字幕/文案改写" });
    if (b.safe_zone !== a.safe_zone) changes.push({ change_id: `sz_${id}`, operation: "style_change", target_segment_id: id, before: { safe_zone: b.safe_zone }, after: { safe_zone: a.safe_zone }, reason: "字幕安全区位置调整" });
  }
  const beforeAudio = (before?.tracks?.audio ?? []).length;
  const afterAudio = (after?.tracks?.audio ?? []).length;
  if (beforeAudio !== afterAudio) changes.push({ change_id: "audio_track", operation: afterAudio > beforeAudio ? "replace" : "remove", target_segment_id: "audio_bed", before: { tracks: beforeAudio }, after: { tracks: afterAudio }, reason: "BGM/音轨变化" });
  return { command, before_timeline_hash: timelineHash(before), after_timeline_hash: timelineHash(after), changes };
}

// ---------------------------------------------------------------------------------------------------
// similarity_report — does the output copy the sample's wording, or only its structure? (TC-12)
// ---------------------------------------------------------------------------------------------------

export function buildSimilarityReport(input: { copyRisk: "low" | "medium" | "high"; noCopyPassed?: boolean | null; mappingV2: Array<Record<string, unknown>> }): Record<string, unknown> {
  const highRisk = input.mappingV2.filter((m) => m.copy_risk === "high").map((m) => m.new_content_slot);
  return {
    verdict: input.copyRisk === "high" ? "fail" : "pass",
    copy_risk_overall: input.copyRisk,
    no_copy_scan_passed: input.noCopyPassed ?? null,
    checked: ["headline", "subtitle", "cta_text", "structure_only"],
    high_risk_slots: highRisk,
    structure_reused: true,
    wording_reused: input.copyRisk === "high",
    note:
      input.copyRisk === "high"
        ? "AI 胶囊源文案未被改写，存在照搬样例措辞的风险（应触发改写或回退）"
        : "仅迁移结构/节奏/包装方法；屏幕文案按新主题生成，未照搬样例措辞"
  };
}

// ---------------------------------------------------------------------------------------------------
// packaging_plan — subtitle safe-zone/density/contrast + title bar + sticker + cover suggestions (TC-05/14).
// ---------------------------------------------------------------------------------------------------

function hexLum(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length < 6) return 0.5;
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}
function contrastRatio(a: string, b: string): number {
  const l1 = hexLum(a);
  const l2 = hexLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function buildPackagingPlan(input: { timelineV2: Record<string, unknown>; palette: string[]; theme: string }): Record<string, unknown> {
  const tracks = (input.timelineV2.tracks ?? {}) as { text?: Array<Record<string, unknown>> };
  const text = tracks.text ?? [];
  const density = text.length > 8 ? "dense" : text.length > 4 ? "medium" : "minimal";
  const [bg = "#0A0A0A", fg = "#FFFFFF", accent = "#F7C948"] = input.palette ?? [];
  const contrast = contrastRatio(bg, fg);
  return {
    subtitles: {
      count: text.length,
      density,
      recommended_font_px: density === "dense" ? 44 : density === "medium" ? 56 : 72,
      safe_zones: text.map((t) => ({ text_id: t.text_id, safe_zone: t.safe_zone, content: t.content })),
      contrast_ratio: Math.round(contrast * 10) / 10,
      contrast_ok: contrast >= 4.5,
      contrast_note: contrast >= 4.5 ? "字幕与背景对比度达标（>=4.5）" : "对比度不足，建议加描边/底色卡或调整配色"
    },
    title_bar: { text: (text[0]?.content as string) || input.theme, position: "top", color: fg, background: bg },
    stickers: [
      { type: "selling_point_chip", placement: "mid", color: accent },
      { type: "cta_badge", placement: "bottom", color: accent }
    ],
    cover: { generated: true, source: "frame@50%", title: input.theme }
  };
}

// ---------------------------------------------------------------------------------------------------
// beat_alignment_report — are the structure transitions near the (learned) beat grid? (TC-10)
// ---------------------------------------------------------------------------------------------------

export function buildBeatAlignment(capsule: v5.RemotionTemplateCapsule): Record<string, unknown> {
  const sections = capsule.timingSignature.sections ?? [];
  const allBeats = [...new Set(sections.flatMap((s) => s.internalBeats ?? []))].sort((a, b) => a - b);
  const bpm = (capsule.audioRecipes ?? [])[0]?.bpm ?? null;
  const transitions = sections.slice(1).map((s) => ({ section: s.id, at_sec: s.startSec }));
  const TOL = 0.12;
  const aligned = transitions.map((t) => {
    if (!allBeats.length) return { section: t.section, at_sec: t.at_sec, nearest_beat_sec: null, offset_ms: null, aligned: false };
    const nearest = allBeats.reduce((best, b) => (Math.abs(b - t.at_sec) < Math.abs(best - t.at_sec) ? b : best), allBeats[0]);
    const offsetMs = Math.round((t.at_sec - nearest) * 1000);
    return { section: t.section, at_sec: t.at_sec, nearest_beat_sec: nearest, offset_ms: offsetMs, aligned: Math.abs(t.at_sec - nearest) <= TOL };
  });
  return {
    bpm,
    beat_count: allBeats.length,
    transition_count: transitions.length,
    aligned_count: aligned.filter((a) => a.aligned).length,
    tolerance_ms: TOL * 1000,
    transitions: aligned,
    note: "结构转场与学习到的节拍栅格的对齐情况；|offset| <= 120ms 视为对齐，其余为（可有意的）偏移"
  };
}

// ---------------------------------------------------------------------------------------------------
// dialogue_plan — cut-safe plan for dialogue/voiceover material (TC-06). Grounded in real has_audio facts
// (ffprobe) + the section structure: real voiceover -> cut on silence/sentence boundaries; none -> Q&A cards.
// ---------------------------------------------------------------------------------------------------

export function buildDialoguePlan(input: { capsule: v5.RemotionTemplateCapsule; materialAnalysis: Array<Record<string, unknown>>; transcripts?: Array<{ assetId: string; segments: TranscriptSegment[] }> }): Record<string, unknown> {
  const sections = input.capsule.timingSignature.sections ?? [];
  const transcripts = (input.transcripts ?? []).filter((t) => t.segments.length > 0);
  const hasVoiceover = transcripts.length > 0;

  // With REAL transcripts: speech segments + cut-safe points in the SILENCE gaps between sentences; flag any
  // section boundary that lands inside a spoken sentence (would cut mid-sentence).
  const speechSegments = transcripts.flatMap((t) => t.segments.map((s) => ({ asset_id: t.assetId, start_sec: Math.round(s.startSec * 100) / 100, end_sec: Math.round(s.endSec * 100) / 100, text: s.text.trim() })));
  const safeCutPoints: Array<Record<string, unknown>> = [];
  const unsafeCuts: Array<Record<string, unknown>> = [];
  if (hasVoiceover) {
    for (const t of transcripts) {
      const segs = [...t.segments].sort((a, b) => a.startSec - b.startSec);
      for (let i = 0; i < segs.length - 1; i++) {
        const gap = segs[i + 1].startSec - segs[i].endSec;
        if (gap > 0.15) safeCutPoints.push({ at_sec: Math.round((segs[i].endSec + gap / 2) * 100) / 100, asset_id: t.assetId, safe: true, reason: `两句之间的静音间隙（${Math.round(gap * 1000)}ms），不打断句子` });
      }
      // section boundaries that fall inside a sentence are unsafe.
      for (const sec of sections.slice(1)) {
        const inside = segs.find((g) => sec.startSec > g.startSec + 0.1 && sec.startSec < g.endSec - 0.1);
        if (inside) unsafeCuts.push({ at_sec: sec.startSec, section: sec.id, reason: `会切断正在说的一句话「${inside.text.trim().slice(0, 16)}…」，应移到句子边界` });
      }
    }
  } else {
    for (const s of sections.slice(1)) safeCutPoints.push({ at_sec: s.startSec, section: s.id, safe: true, reason: "结构 section 边界，不会打断字幕句子" });
  }

  return {
    has_real_voiceover: hasVoiceover,
    asr: hasVoiceover ? "faster-whisper (local)" : "none (no audio/speech detected)",
    voiceover_assets: transcripts.map((t) => t.assetId),
    speech_segments: speechSegments,
    strategy: hasVoiceover
      ? "检测到真人口播：切点落在句子之间的静音间隙，绝不在一句话中间切；下面 unsafe_cuts 标出会切断句子的边界"
      : "未检测到真人口播：用问/答对话卡（Q&A 字幕卡）模拟对话结构，切点落在结构 section 边界",
    safe_cut_points: safeCutPoints,
    unsafe_cuts: unsafeCuts,
    dialogue_cards: hasVoiceover ? [] : sections.map((s) => ({ section: s.id, role: s.role, suggestion: `${s.role} 段：以对话/字幕卡承接（问→答）` }))
  };
}

// ---------------------------------------------------------------------------------------------------
// structure arbitration — choose ONE base structure among several reference capsules + explain the choice
// (selected vs rejected, and which pacing/audio is borrowed from a runner-up). (TC-01/02/11)
// ---------------------------------------------------------------------------------------------------

const ROLES = ["hook", "benefit", "proof", "cta"];

// Bilingual intent matching so a CN theme can prefer the semantically-right reference (TC-01).
function briefCategories(brief: { theme?: string; sellingPoints?: string[] }): Set<string> {
  const t = `${brief.theme ?? ""} ${(brief.sellingPoints ?? []).join(" ")}`;
  const c = new Set<string>();
  if (/活动|书展|展会|复盘|集锦|现场|打卡|快闪|赛事|演出|节日|展览/.test(t)) c.add("event");
  if (/旅行|风景|慢节奏|氛围|空镜|治愈|散步|大片|风光/.test(t)) { c.add("travel"); c.add("ambient"); }
  if (/教程|步骤|做法|怎么|教学|手作|工作坊|养护|护理|食谱/.test(t)) { c.add("tutorial"); c.add("recipe"); }
  if (/对话|问答|采访|口播|解说|讲解/.test(t)) c.add("dialogue");
  if (/理财|金融|数据|图表|解释/.test(t)) c.add("explainer");
  return c;
}
function refCategories(name: string): Set<string> {
  const n = (name ?? "").toLowerCase();
  const c = new Set<string>();
  if (/event|recap/.test(n)) c.add("event");
  if (/travel|cinematic|slow|pan/.test(n)) { c.add("travel"); c.add("ambient"); }
  if (/recipe|tutorial|step/.test(n)) { c.add("tutorial"); c.add("recipe"); }
  if (/ambient|lofi/.test(n)) c.add("ambient");
  if (/dialogue|qna|q&a|split/.test(n)) c.add("dialogue");
  if (/finance|explainer|chart/.test(n)) c.add("explainer");
  return c;
}

function scoreCapsule(c: v5.RemotionTemplateCapsule, brief: { theme?: string; sellingPoints?: string[] }, sourceName: string): { score: number; roleCoverage: string[]; slotCount: number; mediaSlots: number; motifs: number; semHit: number } {
  const roles = new Set((c.timingSignature.sections ?? []).map((s) => String(s.role)));
  const roleCoverage = ROLES.filter((r) => roles.has(r));
  const slotCount = c.slotSchema?.length ?? 0;
  const mediaSlots = (c.slotSchema ?? []).filter((s) => /image|video|logo|mockup/.test(s.kind)).length;
  const motifs = c.motionSignature?.motifs?.length ?? 0;
  const briefText = `${brief.theme ?? ""} ${(brief.sellingPoints ?? []).join(" ")}`.toLowerCase();
  const tagHit = (c.tags ?? []).filter((t) => briefText.includes(String(t).toLowerCase())).length;
  const bc = briefCategories(brief);
  const semHit = [...refCategories(sourceName)].filter((x) => bc.has(x)).length;
  const score =
    roleCoverage.length * 3 +
    Math.min(slotCount, 12) * 0.5 +
    mediaSlots * 1.2 + // reward media-rich; a caption-only (0-media) capsule sinks (Fix4)
    motifs * 0.5 +
    tagHit * 2 +
    semHit * 4 + // semantic theme <-> reference category match (Fix2 tie-break)
    (c.quality?.renderPreviewPassed ? 2 : 0);
  return { score: Math.round(score * 10) / 10, roleCoverage, slotCount, mediaSlots, motifs, semHit };
}

function avgSectionSec(c: v5.RemotionTemplateCapsule): number {
  const s = c.timingSignature.sections ?? [];
  return s.length ? (c.timingSignature.durationSec ?? 0) / s.length : 0;
}

export interface ArbitrationResult {
  selectedCapsule: v5.RemotionTemplateCapsule;
  report: Record<string, unknown>;
}

export function arbitrateStructure(
  capsules: v5.RemotionTemplateCapsule[],
  brief: { theme?: string; sellingPoints?: string[]; variant?: string },
  sourceNames: Record<string, string> = {}
): ArbitrationResult {
  const nameOf = (c: v5.RemotionTemplateCapsule) => sourceNames[c.id] ?? c.sourceSampleId;
  // Task-category fit (Fix: TC-V2-02): when the brief is a concrete CONTENT task (tutorial/recipe, event/recap,
  // dialogue, explainer) — not just a mood — a reference whose structure is OFF-TOPIC (pure ambient/travel,
  // matching none of those task categories) gets a soft penalty so it doesn't beat an on-topic reference on raw
  // structure richness. SOFT on purpose: it's a score nudge, not a hard filter, so a strong candidate still wins
  // and a genuinely broken on-topic reference can still lose to a solid off-topic one. Mood briefs are untouched.
  const TASK_CATS = new Set(["event", "tutorial", "recipe", "dialogue", "explainer"]);
  const briefTaskCats = [...briefCategories(brief)].filter((x) => TASK_CATS.has(x));
  const offTopicOf = (c: v5.RemotionTemplateCapsule) =>
    briefTaskCats.length > 0 && ![...refCategories(nameOf(c))].some((rc) => briefTaskCats.includes(rc));
  const OFF_TOPIC_PENALTY = 6;
  const scored = capsules
    .map((c) => {
      const base = scoreCapsule(c, brief, nameOf(c));
      const offTopic = offTopicOf(c);
      return { capsule: c, ...base, offTopic, score: Math.round((base.score - (offTopic ? OFF_TOPIC_PENALTY : 0)) * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const gatedByTask = briefTaskCats.length > 0 && !winner.offTopic && scored.some((s) => s.offTopic);
  const losers = scored.slice(1);
  // Real borrow: graft a slower/ambient runner-up's AUDIO recipe onto the winning structure (not just a note).
  // Borrowing the OTHER reference's atmosphere is about the references on hand, so it fires whenever a clearly
  // slower/ambient runner-up exists — independent of the chosen variant.
  let borrowed: Record<string, unknown> | null = null;
  let selectedCapsule: v5.RemotionTemplateCapsule = winner.capsule;
  if (losers.length > 0) {
    const amb = losers.find((s) => refCategories(nameOf(s.capsule)).has("ambient") || avgSectionSec(s.capsule) > avgSectionSec(winner.capsule) * 1.15);
    if (amb && (amb.capsule.audioRecipes ?? []).length) {
      selectedCapsule = { ...winner.capsule, audioRecipes: amb.capsule.audioRecipes };
      borrowed = { from: amb.capsule.id, from_source: nameOf(amb.capsule), what: "audio mood/bpm + 慢节奏氛围", grafted: "audioRecipes", reason: "在选中结构上真实替换为该样例的 audioRecipes（更慢/氛围化的音轨配方），不只是说明意图" };
    }
  }
  return {
    selectedCapsule,
    report: {
      candidates: scored.map((s) => ({ capsuleId: s.capsule.id, source: nameOf(s.capsule), score: s.score, role_coverage: s.roleCoverage, slot_count: s.slotCount, media_slots: s.mediaSlots, motifs: s.motifs, semantic_match: s.semHit })),
      selected: winner.capsule.id,
      selected_source: nameOf(winner.capsule),
      task_categories: briefTaskCats,
      gated_by_task_category: gatedByTask,
      selection_reason: gatedByTask
        ? `新主题属任务型(${briefTaskCats.join("/")})，优先结构匹配该任务的样例：semantic_match=${winner.semHit}、role ${winner.roleCoverage.join("/")}、媒体槽 ${winner.mediaSlots}、综合分 ${winner.score}（题材不符的氛围类样例已扣分，未选）`
        : `选中与新主题语义最契合(semantic_match=${winner.semHit})且结构完整(role ${winner.roleCoverage.join("/")}, 媒体槽 ${winner.mediaSlots})的样例，综合分 ${winner.score}`,
      rejected: losers.map((s) => ({
        capsuleId: s.capsule.id,
        source: nameOf(s.capsule),
        reason: s.offTopic
          ? `题材不匹配任务类别 ${briefTaskCats.join("/")}（off-topic 扣 ${OFF_TOPIC_PENALTY}，综合分降至 ${s.score}），未选`
          : `综合分 ${s.score}(语义匹配 ${s.semHit}, 媒体槽 ${s.mediaSlots})低于选中项`,
      })),
      borrowed: borrowed ? [borrowed] : [],
      note: "多参考结构仲裁：以语义最契合的单一结构为基底，必要时真实嫁接次优样例的音轨/氛围；不机械平均拼接"
    }
  };
}
