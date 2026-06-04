// contracts-v5/evidence.ts
// EvidenceTimelineV5 — deterministic, content-neutral facts extracted from a sample/target video
// BEFORE any VLM interpretation. Canonical shape = spec_v5/schemas/evidence-timeline-v5.schema.json
// + spec_v5/data-contracts.md (the two agree). The single-file mirror's alternate shape
// (meta/frameSheets/visualTracks/rhythm/...) is treated as non-canonical and aligned in the docs.
//
// The V4 perception stack (scripts/analyze-evidence-timeline.py -> visual-evidence-timeline-v2 with
// shots/sceneCuts/beatGrid/keyframes/typography/audioStructure) is mapped INTO this shape by the
// runEvidenceV5 wrapper (pipeline-v5), not replaced.

import type { AspectRatioV5, VideoInputPolicyV5 } from "./common.js";

export interface EvidenceVideoMeta {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  aspectRatio?: AspectRatioV5 | string;
  hasAudio: boolean;
}

export interface EvidenceShot {
  id: string;
  startSec: number;
  endSec: number;
  /** Detected scene-cut confidence 0..1 when available. */
  confidence?: number;
  /** Short neutral description of the shot's dominant visual form (no copied content). */
  summary?: string;
}

export interface EvidenceFrame {
  id: string;
  timeSec: number;
  /** Artifact ref to the extracted frame (evidence-only; never reusable). */
  frameRef?: string;
  /** Dominant colors sampled from the frame (hex), used for palette evidence. */
  dominantHexPalette?: string[];
}

export interface TextEvidence {
  id: string;
  timeSec: number;
  /** OCR'd text. Sanitized/summarized before any reuse; raw copy is evidence-only. */
  text: string;
  region?: { x: number; y: number; w: number; h: number };
  role?: "title" | "subtitle" | "caption" | "cta" | "watermark" | "logo" | "other";
}

export interface SpeechEvidence {
  hasSpeech: boolean;
  transcript?: string;
  segments?: Array<{ startSec: number; endSec: number; text: string }>;
  language?: string;
}

export interface AudioEvidence {
  hasAudio: boolean;
  bpm?: number;
  beatGridSec?: number[];
  onsetsSec?: number[];
  energyCurve?: Array<{ t: number; value: number }>;
  loudnessLufs?: number;
  /** Coarse mood tags inferred from audio (never the raw track). */
  mood?: string[];
}

export interface MotionEvidence {
  /** Optical-flow / frame-diff intensity over time, 0..1 normalized. */
  intensityCurve?: Array<{ t: number; value: number }>;
  peakMomentsSec?: number[];
  cutDensity?: "low" | "medium" | "high";
}

export interface EvidenceTimelineV5 {
  id: string;
  assetId: string;
  video: EvidenceVideoMeta;
  shots: EvidenceShot[];
  keyFrames: EvidenceFrame[];
  textEvidence?: TextEvidence[];
  speechEvidence?: SpeechEvidence;
  audioEvidence?: AudioEvidence;
  motionEvidence?: MotionEvidence;
  contactSheetRef?: string;
  recommendedVideoInputPolicy?: VideoInputPolicyV5;
  warnings: string[];
}
