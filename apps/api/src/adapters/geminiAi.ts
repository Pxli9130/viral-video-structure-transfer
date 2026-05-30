import { GoogleGenAI } from "@google/genai";
import { OpenAICompatibleAIAdapter, type ChatMessage } from "./openaiCompatible.js";

const DEFAULT_AI_MODEL = "gemini-flash-latest";

export interface GeminiAIConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Gemini-backed AI (LLM) adapter — the selectable replacement for the Ark/Doubao text LLM
 * (`AI_PROVIDER=gemini`). It reuses ALL of OpenAICompatibleAIAdapter's prompt-building,
 * JSON parsing and template-merge logic, and only swaps the transport to a **text-only**
 * Gemini `generateContent` request.
 *
 * IMPORTANT — content separation: this is intentionally a DIFFERENT request from the Gemini
 * VLM (`GeminiVLMAdapter.describeVideo`). The VLM sends the video as a multimodal part to
 * understand the sample; this adapter sends only text (structure/revise/scorecard prompts)
 * and never includes a video part. They are separate calls, can use separate models
 * (`VLM_MODEL` vs `AI_GEMINI_MODEL`), and must not be merged.
 */
export class GeminiAIAdapter extends OpenAICompatibleAIAdapter {
  private readonly gemini: GoogleGenAI | undefined;
  private readonly geminiModel: string;
  private readonly geminiTimeoutMs: number;

  constructor(config: GeminiAIConfig) {
    // Base ctor with empty OpenAI config (its transport is unused — we override chat()).
    super({});
    this.name = "GeminiAIAdapter";
    this.geminiModel = config.model?.trim() || DEFAULT_AI_MODEL;
    this.geminiTimeoutMs = config.timeoutMs ?? 30_000;
    this.gemini = config.apiKey ? new GoogleGenAI({ apiKey: config.apiKey }) : undefined;
    this.available = Boolean(config.apiKey);
  }

  protected async chat(messages: ChatMessage[], json: boolean): Promise<string> {
    if (!this.gemini) throw new Error("Gemini AI adapter is not configured (missing GEMINI_API_KEY)");
    // Flatten chat messages into a single text prompt. Text-only — no video part — so this
    // request stays separate from the VLM's video-understanding request.
    const system = messages.filter((m) => m.role === "system").map((m) => m.content);
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`);
    const prompt = [...system, ...conversation].join("\n\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.geminiTimeoutMs);
    try {
      const response = await this.gemini.models.generateContent({
        model: this.geminiModel,
        contents: prompt,
        config: {
          temperature: 0.4,
          abortSignal: controller.signal,
          ...(json ? { responseMimeType: "application/json" } : {})
        }
      });
      const text = response.text ?? "";
      if (!text) throw new Error("Gemini AI returned empty content");
      return text;
    } catch (error) {
      // Normalize to the same error shape the base adapter surfaces, so aiEnrichmentError is consistent.
      const message = (error as Error).message ?? String(error);
      throw new Error(`Gemini AI request failed: ${message.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
