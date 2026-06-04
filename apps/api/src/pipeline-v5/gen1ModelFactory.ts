// pipeline-v5/gen1ModelFactory.ts
// Real (gated) Gemini model fn for AI Gen1/Gen2. Returns undefined when no key is configured so
// callers transparently fall back to the deterministic path. Kept separate from runGen1Ai.ts so the
// core logic stays offline-testable with an injected fn.

import { GoogleGenAI } from "@google/genai";
import type { Gen1ModelFn } from "./runGen1Ai.js";

export interface GeminiModelFnOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
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
