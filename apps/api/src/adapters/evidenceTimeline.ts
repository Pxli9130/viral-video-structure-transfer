import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Asset, VideoAnalysisResult, VisualEvidenceTimeline } from "@vvst/shared";
import { runPython, hasCondaEnv } from "./condaPython.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");
const EVIDENCE_SCRIPT = path.join(repoRoot, "scripts", "analyze-evidence-timeline.py");

export interface EvidenceTimelineOptions {
  generatedDir: string;
  /** Run OCR/ASR inside the Python script. In the API path these are bound from existing adapters instead. */
  runOcr?: boolean;
  runAsr?: boolean;
  asrModel?: string;
  timeoutMs?: number;
}

/**
 * Run the deterministic evidence-first analyzer (PySceneDetect scene cuts + librosa
 * beat grid + per-shot keyframes + visual/style tags). Frames are written under the
 * served generated dir so evidenceFrames carry safe `/generated/...` paths, never
 * absolute local paths. Returns undefined when conda/python or the asset path is missing.
 */
export async function analyzeEvidenceTimeline(
  asset: Asset,
  opts: EvidenceTimelineOptions
): Promise<VisualEvidenceTimeline | undefined> {
  if (!hasCondaEnv() || !asset.path) return undefined;
  const framesDir = path.join(opts.generatedDir, "evidence", asset.id);
  await fs.mkdir(framesDir, { recursive: true });
  const outPath = path.join(framesDir, "evidence-timeline.json");
  const args = [
    "--video", asset.path,
    "--out", outPath,
    "--frames-dir", framesDir,
    "--frames-url-prefix", `/generated/evidence/${asset.id}/`,
    "--source-asset-id", asset.id
  ];
  if (opts.runOcr) args.push("--ocr");
  if (opts.runAsr) args.push("--asr", "--asr-model", opts.asrModel ?? "tiny");
  await runPython(EVIDENCE_SCRIPT, args, { timeoutMs: opts.timeoutMs ?? 240000 });
  const raw = await fs.readFile(outPath, "utf8");
  return JSON.parse(raw) as VisualEvidenceTimeline;
}

/**
 * Bind ASR transcript and OCR rows (already produced by the API's adapters) into the
 * evidence-timeline shots by timestamp overlap, so each shot carries its spoken/printed
 * text without re-running OCR/ASR in Python.
 */
export function bindAnalysisTextToEvidence(
  timeline: VisualEvidenceTimeline,
  analysis: VideoAnalysisResult
): VisualEvidenceTimeline {
  const transcript = analysis.transcript ?? [];
  const ocrRows = analysis.ocr ?? [];
  const ocrPoints = ocrRows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const timeSec = typeof r.timeSec === "number" ? r.timeSec : typeof r.time === "number" ? (r.time as number) : undefined;
      const text =
        typeof r.text === "string"
          ? r.text
          : Array.isArray(r.texts)
            ? (r.texts as unknown[]).filter((t): t is string => typeof t === "string").join(" ")
            : typeof r.value === "string"
              ? (r.value as string)
              : undefined;
      return timeSec !== undefined && text ? { timeSec, text } : undefined;
    })
    .filter((p): p is { timeSec: number; text: string } => Boolean(p));

  const shots = timeline.shots.map((shot) => {
    const asrText = shot.asrText?.length
      ? shot.asrText
      : transcript
          .filter((seg) => seg.endSec > shot.startSec && seg.startSec < shot.endSec && seg.text)
          .map((seg) => seg.text);
    const ocrText = shot.ocrText?.length
      ? shot.ocrText
      : ocrPoints.filter((p) => p.timeSec >= shot.startSec && p.timeSec <= shot.endSec).map((p) => p.text);
    return { ...shot, asrText, ocrText };
  });
  const anyOcr = shots.some((s) => (s.ocrText?.length ?? 0) > 0);
  const anyAsr = shots.some((s) => (s.asrText?.length ?? 0) > 0);
  return {
    ...timeline,
    shots,
    ocrStatus: anyOcr ? "ok" : timeline.ocrStatus,
    asrStatus: anyAsr ? "ok" : timeline.asrStatus
  };
}
