// pipeline-v5/gen1ModelFactory.ts
// Real (gated) Gemini model fn for AI Gen1/Gen2. Returns undefined when no key is configured so
// callers transparently fall back to the deterministic path. Kept separate from runGen1Ai.ts so the
// core logic stays offline-testable with an injected fn.

import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import type { Gen1ModelFn } from "./runGen1Ai.js";

export interface GeminiModelFnOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
}

/**
 * Multimodal codegen fn: prompt + source keyframes + (optionally) the FULL source video -> code.
 * Lets the model WATCH the video it reconstructs. The video goes via the Gemini Files API (any size).
 */
export type VisionCodegenFn = (prompt: string, images: Array<{ base64: string; mimeType: string }>, videoPath?: string) => Promise<string>;

function videoMime(p: string): string {
  const ext = p.toLowerCase().slice(p.lastIndexOf("."));
  return ext === ".mp4" ? "video/mp4" : ext === ".webm" ? "video/webm" : ext === ".mkv" ? "video/x-matroska" : "video/quicktime";
}

export function createGeminiVisionCodegenFn(opts: GeminiModelFnOptions = {}): VisionCodegenFn | undefined {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  const client = new GoogleGenAI({ apiKey });
  const model = opts.model ?? process.env.GEMINI_CODEGEN_MODEL ?? process.env.AI_GEMINI_MODEL ?? "gemini-flash-latest";
  // A best-Pro model watching a full video + emitting a large capsule JSON can take minutes — allow it.
  const timeoutMs = opts.timeoutMs ?? Number(process.env.GEMINI_GEN1_TIMEOUT_MS ?? 600_000);
  return async (prompt, images, videoPath) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const parts: unknown[] = [];
      // Upload the full source video via the Files API (no inline size cap) and wait until ACTIVE.
      if (videoPath) {
        try {
          let up = await client.files.upload({ file: videoPath, config: { mimeType: videoMime(videoPath) } });
          const startedAt = Date.now();
          while (up.name && up.state && String(up.state) !== "ACTIVE") {
            if (String(up.state) === "FAILED" || Date.now() - startedAt > 240_000) break;
            await new Promise((r) => setTimeout(r, 3_000));
            up = await client.files.get({ name: up.name });
          }
          if (up.uri && up.mimeType && String(up.state) === "ACTIVE") parts.push(createPartFromUri(up.uri, up.mimeType));
        } catch {
          /* upload failed — fall back to keyframes only */
        }
      }
      for (const im of images) parts.push({ inlineData: { data: im.base64, mimeType: im.mimeType } });
      parts.push(prompt);
      const response = await client.models.generateContent({
        model,
        contents: createUserContent(parts as never),
        config: { temperature: opts.temperature ?? 0.4, responseMimeType: "application/json", abortSignal: controller.signal, maxOutputTokens: Number(process.env.GEMINI_CODEGEN_MAX_TOKENS ?? 65536) }
      });
      return response.text ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Build a JSON-mode Gemini text model fn, or undefined if no API key is available. */
export function createGeminiModelFn(opts: GeminiModelFnOptions = {}): Gen1ModelFn | undefined {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  const client = new GoogleGenAI({ apiKey });
  const model = opts.model ?? process.env.AI_GEMINI_MODEL ?? process.env.VLM_MODEL ?? "gemini-flash-latest";
  const timeoutMs = opts.timeoutMs ?? 45_000;
  return async (prompt: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: { temperature: opts.temperature ?? 0.3, responseMimeType: "application/json", abortSignal: controller.signal }
      });
      return response.text ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}
