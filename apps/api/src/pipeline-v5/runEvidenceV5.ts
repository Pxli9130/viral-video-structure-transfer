// pipeline-v5/runEvidenceV5.ts
// Stage 2 wrapper: map the existing V4 deterministic perception output (VisualEvidenceTimeline from
// scripts/analyze-evidence-timeline.py) INTO the canonical EvidenceTimelineV5 contract. This does not
// re-run perception — it adapts what V4 already produces (audit LEARN-03: a wrapper is required, field
// mapping was unspecified; this is that mapping).

import type { Asset, VisualEvidenceTimeline } from "@vvst/shared";
import { v5 } from "@vvst/shared";

function numFromMeta(meta: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!meta) return undefined;
  for (const k of keys) {
    const val = meta[k];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return undefined;
}

function aspectRatioFrom(width: number, height: number): string {
  if (height === 0) return "9:16";
  const r = width / height;
  if (Math.abs(r - 9 / 16) < 0.06) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.1) return "16:9";
  if (Math.abs(r - 1) < 0.06) return "1:1";
  return `${width}:${height}`;
}

export interface EvidenceV5WrapOptions {
  /** Override width/height/fps when not present on the asset metadata. */
  width?: number;
  height?: number;
  fps?: number;
  evidenceTimelineId?: string;
}

/** Adapt a V4 VisualEvidenceTimeline + its Asset into the canonical EvidenceTimelineV5. */
export function toEvidenceTimelineV5(
  timeline: VisualEvidenceTimeline,
  asset: Asset,
  opts: EvidenceV5WrapOptions = {}
): v5.EvidenceTimelineV5 {
  const warnings: string[] = [...(timeline.warnings ?? [])];
  const meta = asset.metadata;
  const width = opts.width ?? numFromMeta(meta, "width", "videoWidth") ?? 1080;
  const height = opts.height ?? numFromMeta(meta, "height", "videoHeight") ?? 1920;
  const fps = opts.fps ?? numFromMeta(meta, "fps", "frameRate") ?? 30;
  if (numFromMeta(meta, "width") === undefined && opts.width === undefined) {
    warnings.push("evidence-v5: width/height/fps not on asset metadata; used defaults (1080x1920@30).");
  }

  const shots: v5.EvidenceShot[] = (timeline.shots ?? []).map((s) => ({
    id: s.shotId,
    startSec: s.startSec,
    endSec: s.endSec,
    confidence: s.confidence,
    summary: [s.family, ...(s.visualTags ?? []).slice(0, 3)].filter(Boolean).join(" · ") || undefined
  }));

  const keyFrames: v5.EvidenceFrame[] = (timeline.evidenceFrames ?? []).map((f, i) => {
    const rec = f as unknown as Record<string, unknown>;
    const timeSec = typeof rec.timeSec === "number" ? rec.timeSec : typeof rec.atSec === "number" ? (rec.atSec as number) : 0;
    const frameRef = typeof rec.url === "string" ? rec.url : typeof rec.path === "string" ? (rec.path as string) : undefined;
    const id = typeof rec.id === "string" ? rec.id : `frame_${i + 1}`;
    return { id, timeSec, frameRef };
  });

  const textEvidence: v5.TextEvidence[] = [];
  for (const s of timeline.shots ?? []) {
    for (const t of s.ocrText ?? []) {
      if (t && t.trim()) {
        textEvidence.push({ id: `ocr_${textEvidence.length + 1}`, timeSec: s.startSec, text: t, role: "other" });
      }
    }
  }

  const speechSegments = (timeline.shots ?? [])
    .flatMap((s) => (s.asrText ?? []).map((text) => ({ startSec: s.startSec, endSec: s.endSec, text })))
    .filter((seg) => seg.text && seg.text.trim());
  const speechEvidence: v5.SpeechEvidence = {
    hasSpeech: speechSegments.length > 0,
    segments: speechSegments.length ? speechSegments : undefined,
    transcript: speechSegments.length ? speechSegments.map((s) => s.text).join(" ") : undefined
  };

  const beat = timeline.beatGrid;
  const audioEvidence: v5.AudioEvidence = {
    hasAudio: Boolean(timeline.hasAudio),
    bpm: beat?.bpm,
    beatGridSec: beat?.beats?.length ? beat.beats : undefined,
    onsetsSec: beat?.onsets?.length ? beat.onsets : undefined
  };

  const intensityCurve = (timeline.shots ?? [])
    .filter((s) => typeof s.motionEnergy === "number")
    .map((s) => ({ t: s.startSec, value: Math.min(1, Math.max(0, s.motionEnergy as number)) }));
  const peakMomentsSec = (timeline.movingObjectCandidates ?? [])
    .filter((m) => m.confidence >= 0.5)
    .map((m) => m.startSec);
  const meanMotion = intensityCurve.length
    ? intensityCurve.reduce((a, b) => a + b.value, 0) / intensityCurve.length
    : 0;
  const cutsPerSec = (timeline.sceneCuts?.length ?? 0) / Math.max(1, timeline.durationSec || 1);
  const cutDensity: "low" | "medium" | "high" = cutsPerSec >= 0.6 ? "high" : cutsPerSec >= 0.25 ? "medium" : "low";
  const motionEvidence: v5.MotionEvidence = {
    intensityCurve: intensityCurve.length ? intensityCurve : undefined,
    peakMomentsSec: peakMomentsSec.length ? peakMomentsSec : undefined,
    cutDensity
  };

  // Recommended video input policy (Stage 3): short videos -> whole-video low fps; add a detail pass
  // when motion is high or cut density is high.
  const duration = timeline.durationSec || 0;
  const wantsDetail = meanMotion >= 0.35 || cutDensity === "high";
  const recommendedVideoInputPolicy: v5.VideoInputPolicyV5 = {
    mode: duration > 120 ? "long" : wantsDetail ? "global_detail" : "global",
    globalPass: { useWholeVideo: duration <= 120, fps: duration <= 60 ? 3 : 2 },
    detailPass: wantsDetail
      ? { enabled: true, chunkMode: cutDensity === "high" ? "beat_window" : "scene_aware", overlapSec: 0.4, fps: duration <= 60 ? 8 : 5 }
      : undefined
  };

  // Build with required fields; attach optionals ONLY when defined so we never emit
  // `key: undefined` (ajv rejects an undefined value against a typed optional property).
  const out: v5.EvidenceTimelineV5 = {
    id: opts.evidenceTimelineId ?? `evidence_${asset.id}`,
    assetId: asset.id,
    video: {
      durationSec: duration,
      width: Math.round(width),
      height: Math.round(height),
      fps,
      aspectRatio: aspectRatioFrom(width, height),
      hasAudio: Boolean(timeline.hasAudio)
    },
    shots,
    keyFrames,
    speechEvidence,
    audioEvidence,
    motionEvidence,
    recommendedVideoInputPolicy,
    warnings
  };
  if (textEvidence.length) out.textEvidence = textEvidence;
  if (typeof timeline.contactSheetPath === "string" && timeline.contactSheetPath) out.contactSheetRef = timeline.contactSheetPath;
  return out;
}
