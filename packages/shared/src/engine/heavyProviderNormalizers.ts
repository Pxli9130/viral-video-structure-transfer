import type {
  BBoxNormObject,
  TechniqueAtom,
  TypographyEvidenceItem,
  VisualElementGraph,
  VisualElementNode
} from "../types.js";
import type { TechniqueAtomRetrievalResult } from "./techniqueAtomRetrieval.js";

export type ImageSize = { width: number; height: number };
export type BBoxNormTuple = [number, number, number, number];

export type NormalizedOcrRow = {
  text: string;
  bboxNorm: BBoxNormTuple;
  confidence: number;
  frameId?: string;
  timeSec: number;
  providerSource: "paddleocr" | "paddleocr_vl" | "easyocr" | string;
};

export type GroundingDetectionInput = {
  id?: string;
  label?: string;
  phrase?: string;
  score?: number;
  confidence?: number;
  box?: unknown;
  bbox?: unknown;
  points?: unknown;
  timeSec?: number;
  frameId?: string;
};

export type Sam2MaskTrackInput = {
  id?: string;
  label?: string;
  confidence?: number;
  timeSec?: number;
  startSec?: number;
  endSec?: number;
  bbox?: unknown;
  box?: unknown;
  boxes?: Array<{ t?: number; timeSec?: number; bbox?: unknown; box?: unknown; confidence?: number }>;
  frameIds?: string[];
};

export type CoTrackerTrackInput = {
  id?: string;
  label?: string;
  confidence?: number;
  startSec?: number;
  endSec?: number;
  points?: Array<{ t?: number; timeSec?: number; x: number; y: number }>;
  frames?: Array<{ t?: number; timeSec?: number; points: Array<[number, number]> }>;
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPairArray(value: unknown): value is Array<[number, number]> {
  return Array.isArray(value) && value.every((item) =>
    Array.isArray(item) &&
    item.length >= 2 &&
    typeof item[0] === "number" &&
    typeof item[1] === "number"
  );
}

function bboxFromPoints(points: Array<[number, number]>): [number, number, number, number] | undefined {
  if (!points.length) return undefined;
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return [x0, y0, x1 - x0, y1 - y0];
}

function bboxObjectToTuple(value: Record<string, unknown>): [number, number, number, number] | undefined {
  const x = toFiniteNumber(value.x);
  const y = toFiniteNumber(value.y);
  const w = toFiniteNumber(value.w ?? value.width);
  const h = toFiniteNumber(value.h ?? value.height);
  if ([x, y, w, h].every((item) => item !== undefined)) return [x as number, y as number, w as number, h as number];
  const x0 = toFiniteNumber(value.x0 ?? value.left);
  const y0 = toFiniteNumber(value.y0 ?? value.top);
  const x1 = toFiniteNumber(value.x1 ?? value.right);
  const y1 = toFiniteNumber(value.y1 ?? value.bottom);
  if ([x0, y0, x1, y1].every((item) => item !== undefined)) {
    return [x0 as number, y0 as number, (x1 as number) - (x0 as number), (y1 as number) - (y0 as number)];
  }
  return undefined;
}

function rawBoxToTuple(value: unknown): [number, number, number, number] | undefined {
  if (!value) return undefined;
  if (isPairArray(value)) return bboxFromPoints(value);
  if (Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every((item) => typeof item === "number" && Number.isFinite(item))) {
    const [a, b, c, d] = value as [number, number, number, number];
    if (c > a && d > b) return [a, b, c - a, d - b];
    return [a, b, c, d];
  }
  if (typeof value === "object" && !Array.isArray(value)) return bboxObjectToTuple(value as Record<string, unknown>);
  return undefined;
}

export function normalizeBBox(value: unknown, imageSize?: ImageSize): BBoxNormTuple | undefined {
  const raw = rawBoxToTuple(value);
  if (!raw) return undefined;
  const absolute = imageSize && (raw[0] > 1 || raw[1] > 1 || raw[2] > 1 || raw[3] > 1);
  const denomW = absolute ? Math.max(1, imageSize.width) : 1;
  const denomH = absolute ? Math.max(1, imageSize.height) : 1;
  const x = clamp(raw[0] / denomW);
  const y = clamp(raw[1] / denomH);
  const w = clamp(raw[2] / denomW, 0.001, 1 - x);
  const h = clamp(raw[3] / denomH, 0.001, 1 - y);
  return [round3(x), round3(y), round3(w), round3(h)];
}

function bboxTupleToObject(bbox: BBoxNormTuple): BBoxNormObject {
  const [x, y, w, h] = bbox;
  return { x, y, w, h };
}

function layoutRoleForBbox(bbox: BBoxNormTuple): string {
  const [x, y, w, h] = bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (cy >= 0.66) return "lower_third";
  if (cy <= 0.3 && cx <= 0.4) return "top_left_tag";
  if (cy <= 0.3) return "top_tag";
  if (w < 0.42 && (cx < 0.34 || cx > 0.66)) return "keyword_scatter";
  return "center_title";
}

function familyForLabel(label: string): string {
  const text = label.toLowerCase();
  if (/ribbon|丝带|彩带|band/.test(text)) return "ribbon";
  if (/subtitle|caption|text|ocr|文字|字幕/.test(text)) return "text_panel";
  if (/card|panel|poster|screen|window|ui/.test(text)) return "media_card";
  if (/logo|brand/.test(text)) return "logo";
  if (/cta|button|call.?to.?action/.test(text)) return "cta";
  if (/background|backdrop|scene/.test(text)) return "background";
  if (/product|hero|object|person|fan|shoe|bottle|phone/.test(text)) return "hero_object";
  return "hero_object";
}

function centerForBbox(bbox: BBoxNormTuple): [number, number] {
  return [round3(bbox[0] + bbox[2] / 2), round3(bbox[1] + bbox[3] / 2)];
}

function confidence(value: unknown, fallback = 0.7): number {
  return clamp(toFiniteNumber(value) ?? fallback, 0, 1);
}

function textFromOcrEntry(entry: unknown): string {
  if (Array.isArray(entry)) return String(entry[1] ?? "").trim();
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    return String(record.text ?? record.rec_text ?? record.label ?? "").trim();
  }
  return "";
}

function boxFromOcrEntry(entry: unknown): unknown {
  if (Array.isArray(entry)) return entry[0];
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    return record.bbox ?? record.box ?? record.points ?? record.polygon;
  }
  return undefined;
}

function scoreFromOcrEntry(entry: unknown): number {
  if (Array.isArray(entry)) return confidence(entry[2], 0.6);
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    return confidence(record.confidence ?? record.score ?? record.conf, 0.6);
  }
  return 0.6;
}

export function normalizePaddleOcrRows(
  rows: unknown[],
  options: { imageSize?: ImageSize; frameId?: string; timeSec?: number; providerSource?: "paddleocr" | "paddleocr_vl" | string } = {}
): NormalizedOcrRow[] {
  return rows
    .map((entry) => {
      const text = textFromOcrEntry(entry);
      const bboxNorm = normalizeBBox(boxFromOcrEntry(entry), options.imageSize);
      if (!text || !bboxNorm) return undefined;
      return {
        text,
        bboxNorm,
        confidence: scoreFromOcrEntry(entry),
        ...(options.frameId ? { frameId: options.frameId } : {}),
        timeSec: options.timeSec ?? 0,
        providerSource: options.providerSource ?? "paddleocr"
      } satisfies NormalizedOcrRow;
    })
    .filter((item): item is NormalizedOcrRow => Boolean(item));
}

export function ocrRowsToTypographyEvidence(rows: NormalizedOcrRow[], prefix = "ocr"): TypographyEvidenceItem[] {
  return rows.map((row, index) => {
    const layoutRole = layoutRoleForBbox(row.bboxNorm);
    const fontSizeRatio = clamp(row.bboxNorm[3], 0.025, 0.18);
    return {
      textLayerId: `${prefix}_${index.toString().padStart(3, "0")}`,
      timeSec: row.timeSec,
      ...(row.frameId ? { shotId: row.frameId } : {}),
      text: row.text,
      bboxNorm: row.bboxNorm,
      layoutRole,
      colorRole: "white",
      fontSizeRatio: round3(fontSizeRatio),
      animationHint: layoutRole === "keyword_scatter" ? "shake" : fontSizeRatio > 0.1 ? "per_char_reveal" : "scale",
      confidence: row.confidence,
      providerSource: row.providerSource
    };
  });
}

export function typographyEvidenceToTextLayerHints(items: TypographyEvidenceItem[]): Array<{
  text: string;
  bboxNorm: BBoxNormObject;
  fontSizeRatio: number;
  animationHint: string;
  providerSource?: string;
}> {
  return items.map((item) => ({
    text: item.text ?? "",
    bboxNorm: bboxTupleToObject(item.bboxNorm),
    fontSizeRatio: item.fontSizeRatio,
    animationHint: item.animationHint,
    ...(item.providerSource ? { providerSource: item.providerSource } : {})
  }));
}

export function groundingDinoDetectionsToVisualElementGraph(
  detections: GroundingDetectionInput[],
  options: { imageSize?: ImageSize; frameId?: string; timeSec?: number; durationSec?: number; providerSource?: string } = {}
): VisualElementGraph {
  const providerSource = options.providerSource ?? "grounding_dino";
  const elements = detections
    .map((detection, index): VisualElementNode | undefined => {
      const label = detection.label ?? detection.phrase ?? "object";
      const bbox = normalizeBBox(detection.bbox ?? detection.box ?? detection.points, options.imageSize);
      if (!bbox) return undefined;
      const t = detection.timeSec ?? options.timeSec ?? 0;
      const family = familyForLabel(label);
      return {
        id: detection.id ?? `${providerSource}_${index.toString().padStart(3, "0")}`,
        family,
        timeRangeSec: [round3(t), round3(Math.max(t + 0.1, options.durationSec ?? t + 0.5))],
        bboxTrackNorm: [{ t: round3(t), bbox }],
        centerTrajectory: [centerForBbox(bbox)],
        areaRatioCurve: [round3(bbox[2] * bbox[3])],
        positionClass: layoutRoleForBbox(bbox),
        sizeClass: bbox[2] * bbox[3] >= 0.18 ? "large" : "medium",
        appearance: { label },
        evidence: {
          frameIds: [detection.frameId ?? options.frameId].filter(Boolean),
          detector: providerSource,
          confidence: confidence(detection.confidence ?? detection.score)
        },
        providerSource
      };
    })
    .filter((item): item is VisualElementNode => Boolean(item));
  return {
    schemaVersion: "visual-element-graph-v1",
    elementCount: elements.length,
    heavyTracker: providerSource,
    elements
  };
}

export function sam2MaskTracksToVisualElementGraph(
  masks: Sam2MaskTrackInput[],
  options: { imageSize?: ImageSize; providerSource?: string } = {}
): VisualElementGraph {
  const providerSource = options.providerSource ?? "sam2";
  const elements = masks
    .map((mask, index): VisualElementNode | undefined => {
      const boxes = (mask.boxes?.length ? mask.boxes : [{ t: mask.timeSec ?? mask.startSec ?? 0, bbox: mask.bbox ?? mask.box }])
        .map((box) => {
          const bbox = normalizeBBox(box.bbox ?? box.box, options.imageSize);
          const t = box.t ?? box.timeSec ?? mask.timeSec ?? mask.startSec ?? 0;
          return bbox ? { t: round3(t), bbox } : undefined;
        })
        .filter((item): item is { t: number; bbox: BBoxNormTuple } => Boolean(item));
      if (!boxes.length) return undefined;
      const first = boxes[0].bbox;
      const centers = boxes.map((box) => centerForBbox(box.bbox));
      return {
        id: mask.id ?? `${providerSource}_${index.toString().padStart(3, "0")}`,
        family: familyForLabel(mask.label ?? "foreground object"),
        timeRangeSec: [round3(mask.startSec ?? boxes[0].t), round3(mask.endSec ?? boxes[boxes.length - 1].t + 0.1)],
        bboxTrackNorm: boxes,
        centerTrajectory: centers,
        areaRatioCurve: boxes.map((box) => round3(box.bbox[2] * box.bbox[3])),
        motionPattern: boxes.length > 1 ? "mask_track" : "segmented_static",
        positionClass: layoutRoleForBbox(first),
        appearance: { label: mask.label ?? "foreground object", maskSource: "geometry_only" },
        evidence: { frameIds: mask.frameIds, detector: providerSource, confidence: confidence(mask.confidence) },
        providerSource
      };
    })
    .filter((item): item is VisualElementNode => Boolean(item));
  return { schemaVersion: "visual-element-graph-v1", elementCount: elements.length, heavyTracker: providerSource, elements };
}

export function cotrackerPointTracksToVisualElementGraph(
  tracks: CoTrackerTrackInput[],
  options: { providerSource?: string; paddingRatio?: number } = {}
): VisualElementGraph {
  const providerSource = options.providerSource ?? "cotracker3";
  const padding = options.paddingRatio ?? 0.035;
  const elements = tracks
    .map((track, index): VisualElementNode | undefined => {
      const frames: Array<{ t: number; points: Array<[number, number]> }> = track.frames?.length
        ? track.frames.map((frame) => ({ t: frame.t ?? frame.timeSec ?? 0, points: frame.points }))
        : (track.points ?? []).map((point) => ({ t: point.t ?? point.timeSec ?? 0, points: [[point.x, point.y] as [number, number]] }));
      const pointTracks = frames.map((frame) => ({
        t: round3(frame.t),
        points: frame.points.map((point) => [round3(clamp(point[0])), round3(clamp(point[1]))] as [number, number])
      }));
      const bboxTrackNorm = pointTracks
        .map((frame) => {
          const bbox = bboxFromPoints(frame.points);
          if (!bbox) return undefined;
          const padded: BBoxNormTuple = [
            round3(clamp(bbox[0] - padding)),
            round3(clamp(bbox[1] - padding)),
            round3(clamp(bbox[2] + padding * 2, 0.001, 1)),
            round3(clamp(bbox[3] + padding * 2, 0.001, 1))
          ];
          return { t: frame.t, bbox: padded };
        })
        .filter((item): item is { t: number; bbox: BBoxNormTuple } => Boolean(item));
      if (!bboxTrackNorm.length) return undefined;
      return {
        id: track.id ?? `${providerSource}_${index.toString().padStart(3, "0")}`,
        family: familyForLabel(track.label ?? "tracked object"),
        timeRangeSec: [round3(track.startSec ?? bboxTrackNorm[0].t), round3(track.endSec ?? bboxTrackNorm[bboxTrackNorm.length - 1].t + 0.1)],
        bboxTrackNorm,
        pointTracks,
        centerTrajectory: bboxTrackNorm.map((frame) => centerForBbox(frame.bbox)),
        areaRatioCurve: bboxTrackNorm.map((frame) => round3(frame.bbox[2] * frame.bbox[3])),
        motionPattern: "point_track",
        positionClass: layoutRoleForBbox(bboxTrackNorm[0].bbox),
        evidence: { detector: providerSource, confidence: confidence(track.confidence) },
        providerSource
      };
    })
    .filter((item): item is VisualElementNode => Boolean(item));
  return { schemaVersion: "visual-element-graph-v1", elementCount: elements.length, heavyTracker: providerSource, elements };
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

function norm(a: number[]): number {
  return Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
}

function cosine(a: number[], b: number[]): number {
  const denom = norm(a) * norm(b);
  return denom ? dot(a, b) / denom : 0;
}

export function scoreTechniqueAtomsWithEmbeddingSimilarities(
  atoms: TechniqueAtom[],
  queryEmbedding: number[],
  atomEmbeddings: Record<string, number[]>,
  limit = 5,
  providerSource = "bge_m3"
): TechniqueAtomRetrievalResult[] {
  return atoms
    .map((atom) => {
      const embedding = atomEmbeddings[atom.id];
      const score = embedding ? Math.max(0, cosine(queryEmbedding, embedding)) : 0;
      return {
        atomId: atom.id,
        score: Math.round(score * 1000) / 1000,
        reason: embedding
          ? `Ranked by ${providerSource} embedding similarity.`
          : `No ${providerSource} embedding found for atom; low-score fallback.`,
        matchedFields: embedding ? ["embedding"] : []
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
