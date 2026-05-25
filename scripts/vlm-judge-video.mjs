#!/usr/bin/env node
/**
 * Bounded-rubric VLM judge for the regression harness.
 *
 * Extracts evenly-spaced frames from an input (sample) video and an output
 * (generated) video, sends both to a Gemini-compatible VLM with a STRICT
 * JSON rubric, and writes a per-variant judge report. The judge does NOT
 * decide PASS/FAIL on its own — it produces soft scores 0.0-1.0 that the
 * caller can threshold against fixture expectations.
 *
 * Usage:
 *   node scripts/vlm-judge-video.mjs \
 *     --input test_videos/marketing.mov \
 *     --output docs/marketing_case_artifacts/ai_challenge_poster_main.mp4 \
 *     --expected-motif wide_surface_ribbon_2_5d \
 *     --variant-label main \
 *     --out docs/marketing_case_artifacts/vlm-judge.main.json
 *
 * Environment:
 *   GEMINI_API_KEY   required; if missing the script exits 0 with status=SKIPPED
 *   VLM_MODEL        default gemini-flash-latest
 *
 * Hard rules:
 *   - Never spend more than 6 frames per video (Gemini token budget).
 *   - On any error, write a JSON report with status=FAILED + reason; exit 0
 *     so a regression sweep can treat VLM judge as a best-effort signal.
 *   - The judge MUST output strict JSON; we use responseMimeType: application/json
 *     and re-parse defensively.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, createUserContent } from "@google/genai";
import dotenv from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..");

dotenv.config({ path: path.resolve(repoRoot, ".env") });

function parseArgs(argv) {
  const args = { sampleFrames: 5, outputFrames: 5 };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--input": args.input = next; i += 1; break;
      case "--output": args.output = next; i += 1; break;
      case "--expected-motif": args.expectedMotif = next; i += 1; break;
      case "--variant-label": args.variantLabel = next ?? "default"; i += 1; break;
      case "--out": args.out = next; i += 1; break;
      case "--frames-per-video": args.sampleFrames = args.outputFrames = Number(next); i += 1; break;
      case "--help":
      case "-h":
        console.log("Usage: node scripts/vlm-judge-video.mjs --input X --output Y --expected-motif M --out OUT");
        process.exit(0);
      default:
        if (flag.startsWith("--")) {
          console.warn(`Unknown flag: ${flag}`);
        }
    }
  }
  return args;
}

function ffprobeDuration(video) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nokey=1:noprint_wrappers=1", video],
    { encoding: "utf8" }
  );
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  return Number(result.stdout.trim()) || 0;
}

function extractFrame(video, timeSec, outPath) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-ss", String(timeSec.toFixed(2)),
      "-i", video,
      "-frames:v", "1",
      "-q:v", "5",
      "-vf", "scale=512:-2",
      outPath
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg frame extract failed at ${timeSec}s: ${result.stderr.slice(0, 200)}`);
  }
  return readFileSync(outPath).toString("base64");
}

function extractFrames(video, label, count) {
  const duration = ffprobeDuration(video);
  if (duration <= 0) throw new Error(`Could not read duration for ${video}`);
  const tmpDir = path.join(repoRoot, "storage", "tmp", "vlm-judge");
  mkdirSync(tmpDir, { recursive: true });
  const frames = [];
  for (let i = 0; i < count; i += 1) {
    // Evenly spaced; clamp inside [0.2s, duration - 0.2s] so we don't hit black frames.
    const ratio = count === 1 ? 0.5 : i / (count - 1);
    const target = Math.max(0.2, Math.min(duration - 0.2, ratio * duration));
    const outPath = path.join(tmpDir, `${label}_${i + 1}.jpg`);
    const base64 = extractFrame(video, target, outPath);
    frames.push({ timeSec: Number(target.toFixed(2)), path: outPath, base64 });
  }
  return { duration, frames };
}

const REQUIRED_PHASES = ["hook", "sample_analysis", "material_gap", "recomposition", "structure_mapping", "cta"];

function judgePromptFor({ expectedMotif }) {
  const motifLine = expectedMotif
    ? `The sample's identified primary motif is: ${expectedMotif}.`
    : "No expected primary motif was supplied; infer from the sample frames.";
  return `You are a strict short-video creative structure judge.

You will see, in this order:
  • N frames from the SAMPLE video the system learned from (labelled SAMPLE_*)
  • N frames from the OUTPUT video the system generated for a NEW topic

${motifLine}

The OUTPUT must NOT directly copy sample frames, text, people, music or branded assets.
It must transfer the structure: hook / sample-analysis nod / material gap call-out /
recomposition beat / structure mapping / CTA hold.

Score on 0.0–1.0 for each criterion, then return STRICT minified JSON:
{
  "motif_preserved":      <0–1>,   // does the OUTPUT visually echo the SAMPLE's primary motif without copying frames
  "phases_visible":       <0–1>,   // can you see at least 4 of: ${REQUIRED_PHASES.join(", ")} in OUTPUT
  "cta_hold_present":     <0–1>,   // is there a clean CTA frame near the end of OUTPUT
  "no_direct_copy":       <0–1>,   // 1.0 if NO sample text/people/branding is visibly reproduced; 0 if copied
  "visual_quality":       <0–1>,   // resolution/contrast/legibility of OUTPUT frames
  "overall":              <0–1>,   // your weighted aggregate, 0.4*motif + 0.2*phases + 0.15*cta + 0.15*no_direct_copy + 0.10*quality
  "rationale":            "<≤120 chars, English, what you saw>"
}

Hard rules:
  - Output STRICT JSON only, no markdown fence, no commentary.
  - Numbers must be in [0,1].
  - If you cannot see frames or anything is unclear, set the unclear field to 0.0 and explain in rationale.`;
}

function writeReport(outPath, payload) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`wrote ${outPath}`);
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return trimmed;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input || !args.output || !args.out) {
    console.error("Required: --input <video> --output <video> --out <json>");
    process.exit(2);
  }
  if (!existsSync(args.input)) {
    writeReport(args.out, { status: "FAILED", reason: `input video not found: ${args.input}` });
    process.exit(0);
  }
  if (!existsSync(args.output)) {
    writeReport(args.out, { status: "FAILED", reason: `output video not found: ${args.output}` });
    process.exit(0);
  }
  if (!process.env.GEMINI_API_KEY) {
    writeReport(args.out, {
      status: "SKIPPED",
      reason: "GEMINI_API_KEY not set; VLM judge skipped (this is the expected offline behaviour).",
      variant: args.variantLabel ?? null
    });
    process.exit(0);
  }

  let sampleFrames;
  let outputFrames;
  try {
    sampleFrames = extractFrames(args.input, "sample", args.sampleFrames);
    outputFrames = extractFrames(args.output, "output", args.outputFrames);
  } catch (error) {
    writeReport(args.out, { status: "FAILED", reason: `frame extraction failed: ${error.message}` });
    process.exit(0);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.VLM_MODEL ?? "gemini-flash-latest";

  // Build the multi-part user content: SAMPLE block, then OUTPUT block, then rubric prompt.
  const parts = [];
  parts.push("SAMPLE video frames (creative source being learned from):");
  for (const frame of sampleFrames.frames) {
    parts.push({ inlineData: { data: frame.base64, mimeType: "image/jpeg" } });
  }
  parts.push("OUTPUT video frames (system's new reconstruction for a different topic):");
  for (const frame of outputFrames.frames) {
    parts.push({ inlineData: { data: frame.base64, mimeType: "image/jpeg" } });
  }
  parts.push(judgePromptFor({ expectedMotif: args.expectedMotif }));

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: createUserContent(parts),
      config: { responseMimeType: "application/json" }
    });
  } catch (error) {
    writeReport(args.out, {
      status: "FAILED",
      reason: `Gemini call failed: ${error.message}`,
      model
    });
    process.exit(0);
  }

  const text = response.text ?? "";
  if (!text) {
    writeReport(args.out, { status: "FAILED", reason: "Gemini returned empty text", model });
    process.exit(0);
  }

  let scores;
  try {
    scores = JSON.parse(stripCodeFence(text));
  } catch (error) {
    writeReport(args.out, {
      status: "FAILED",
      reason: `Could not parse Gemini JSON: ${error.message}`,
      raw: text.slice(0, 400),
      model
    });
    process.exit(0);
  }

  // Clamp + coerce.
  const clamp = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(1, num));
  };
  const norm = {
    motif_preserved: clamp(scores.motif_preserved),
    phases_visible: clamp(scores.phases_visible),
    cta_hold_present: clamp(scores.cta_hold_present),
    no_direct_copy: clamp(scores.no_direct_copy),
    visual_quality: clamp(scores.visual_quality),
    overall: clamp(scores.overall),
    rationale: typeof scores.rationale === "string" ? scores.rationale : ""
  };
  if (norm.overall === 0) {
    norm.overall = clamp(
      0.4 * norm.motif_preserved +
        0.2 * norm.phases_visible +
        0.15 * norm.cta_hold_present +
        0.15 * norm.no_direct_copy +
        0.1 * norm.visual_quality
    );
  }

  writeReport(args.out, {
    status: "OK",
    model,
    variant: args.variantLabel ?? null,
    expectedMotif: args.expectedMotif ?? null,
    sampleVideo: args.input,
    outputVideo: args.output,
    sampleFrameTimes: sampleFrames.frames.map((f) => f.timeSec),
    outputFrameTimes: outputFrames.frames.map((f) => f.timeSec),
    scores: norm,
    raw: text
  });
  console.log(
    `judge ${args.variantLabel ?? ""}: overall=${norm.overall.toFixed(2)} motif=${norm.motif_preserved.toFixed(2)} phases=${norm.phases_visible.toFixed(2)} cta=${norm.cta_hold_present.toFixed(2)} no_copy=${norm.no_direct_copy.toFixed(2)} quality=${norm.visual_quality.toFixed(2)} | ${norm.rationale}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
