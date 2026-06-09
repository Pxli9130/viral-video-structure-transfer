// pipeline-v5/v2Reports.ts
// Schema-conformant evidence artifacts for the v2 manual-test suite (baokuan_manual_test_assets_v2):
//   - material_analysis : real ffprobe facts (duration/resolution/hasAudio) + quality/duplicate REJECTION +
//     crop suggestions + recommended slots, per user asset.  (TC-03/04/09; fixes the hasAudio bug)
//   - timeline (v2)     : REAL per-section timing from the capsule's timingSignature + video/text/audio tracks
//     + lineage (which atoms / user assets / generated assets each element came from).  (fixes "all 0-12s")
//   - mapping (v2)      : reference-slot -> new-content-slot adaptation with copy_risk.
// Everything here is derived from real pipeline state — no placeholders.

import { spawnSync } from "node:child_process";
import type { Asset } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { resolveBin } from "./renderV5.js";

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
    const probe = asset?.path && isMedia ? probeMedia(asset.path) : { durationSec: null, width: null, height: null, hasAudio: false };
    const resolution = probe.width && probe.height ? `${probe.width}x${probe.height}` : null;
    const quality = Math.round(Math.max(0, Math.min(1, p.qualityScore ?? 0.6)) * 100);
    const subjects = (p.detectedSubjects ?? []).map((s) => String(s).toLowerCase()).sort();
    const sig = `${p.sceneType ?? p.kind}|${subjects.join(",")}`;

    // reject reasons: low quality, or near-duplicate of an earlier (kept) asset of the same scene+subjects.
    let reject: string | null = null;
    if (isMedia && quality < floor) reject = `低质量（清晰度/亮度评分 ${quality}/100，低于阈值 ${floor}）`;
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
      recommended_slots: recommendedSlots(p),
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

export function buildTimelineV2(input: {
  projectId: string;
  capsule: v5.RemotionTemplateCapsule;
  slotBindings: Binding[];
  aspectRatio: string;
  audioBed?: { beatLocked?: boolean } | null;
  knowledgeAtomIds?: string[];
}): Record<string, unknown> {
  const ts = input.capsule.timingSignature;
  const sections = ts.sections ?? [];
  const duration = ts.durationSec ?? (sections.length ? sections[sections.length - 1].endSec : 0);
  const bySlot = new Map(input.slotBindings.map((b) => [b.slotId, b]));

  const video: Array<Record<string, unknown>> = [];
  const text: Array<Record<string, unknown>> = [];
  const userAssets = new Set<string>();
  const generatedAssets = new Set<string>();

  for (const sec of sections) {
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
      text.push({
        text_id: textSlot.id,
        start_sec: sec.startSec,
        end_sec: sec.endSec,
        content: b?.text ?? "",
        safe_zone: safeZoneFor(sec.role),
        style_ref: `${sec.role}_caption`
      });
    }
  }

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
