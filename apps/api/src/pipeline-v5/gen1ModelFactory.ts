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
  /**
   * Output contract. "json" (default) forces/expects raw JSON — the right shape for codegen + NL→patch.
   * "text" asks for a raw assistant reply (no JSON mode), which is what the context-rewrite stage wants so
   * the model can return the rewritten module as a plain fenced ```tsx block instead of having to escape a
   * large TSX into a JSON string (a lite model frequently botches that escaping — the main rewrite failure).
   */
  responseFormat?: "json" | "text";
}

/**
 * Multimodal codegen fn: prompt + source keyframes + (optionally) the attached source video/chunk -> code.
 * Lets the model WATCH the clip it reconstructs. The video goes via the Gemini Files API.
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
      // Upload the caller-provided source clip/chunk via the Files API and wait until ACTIVE.
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
  // In "text" mode we must NOT force JSON output — otherwise a prompt asking for a fenced ```tsx block
  // conflicts with the JSON response mode and the reply becomes an unusable JSON-wrapped string.
  const jsonMode = (opts.responseFormat ?? "json") === "json";
  return async (prompt: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: { temperature: opts.temperature ?? 0.3, ...(jsonMode ? { responseMimeType: "application/json" } : {}), abortSignal: controller.signal }
      });
      return response.text ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface DoubaoModelFnOptions {
  apiKey?: string;
  /** An Ark inference-endpoint id (ep-...) or model name. */
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  temperature?: number;
  /** See GeminiModelFnOptions.responseFormat. "text" drops the JSON-priming system message so a fenced code-block reply isn't discouraged. */
  responseFormat?: "json" | "text";
}

/**
 * Doubao (Volcengine Ark) TEXT-TO-TEXT model fn — OpenAI-compatible /chat/completions. This is the
 * preferred backend for text-to-text tasks (capsule code-modification / context-rewrite). Returns the
 * raw assistant message (callers extract JSON). undefined when no Ark key + endpoint is configured.
 */
export function createDoubaoModelFn(opts: DoubaoModelFnOptions = {}): Gen1ModelFn | undefined {
  // ARK_API_KEY / ARK_MODEL in .env ARE the Doubao Seed 2.0 lite text endpoint creds — use them as the
  // canonical fallback so no separate config is needed (DOUBAO_* still override if set).
  const apiKey = opts.apiKey ?? process.env.DOUBAO_ARK_API_KEY ?? process.env.DOUBAO_API_KEY ?? process.env.ARK_API_KEY;
  const model = opts.model ?? process.env.DOUBAO_ARK_MODEL ?? process.env.DOUBAO_MODEL ?? process.env.ARK_MODEL;
  if (!apiKey || !model) return undefined;
  const baseUrl = (opts.baseUrl ?? process.env.DOUBAO_ARK_BASE_URL ?? process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DOUBAO_TIMEOUT_MS ?? 120_000);
  const systemContent =
    (opts.responseFormat ?? "json") === "text"
      ? "You are a precise senior front-end engineer. Follow the user's instructions exactly, including the EXACT output format they request."
      : "You are a precise senior front-end engineer. Follow the user's instructions exactly. When asked to return JSON, output raw valid JSON only — no markdown code fences, no commentary.";
  return async (prompt: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt }
          ],
          temperature: opts.temperature ?? 0.3
        }),
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`doubao ark ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
      const j = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return j.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Canonical TEXT-TO-TEXT model fn for code-modification / context-rewrite. Prefers Doubao (Volcengine
 * Ark) when DOUBAO_ARK_API_KEY + DOUBAO_ARK_MODEL are set, else falls back to Gemini. Multimodal video
 * codegen stays on Gemini (createGeminiVisionCodegenFn) — only text-to-text routes through here.
 */
export function createTextModelFn(opts: { geminiModel?: string; timeoutMs?: number; temperature?: number; responseFormat?: "json" | "text" } = {}): Gen1ModelFn | undefined {
  return (
    createDoubaoModelFn({ timeoutMs: opts.timeoutMs, temperature: opts.temperature, responseFormat: opts.responseFormat }) ??
    createGeminiModelFn({ model: opts.geminiModel, timeoutMs: opts.timeoutMs, temperature: opts.temperature, responseFormat: opts.responseFormat })
  );
}
