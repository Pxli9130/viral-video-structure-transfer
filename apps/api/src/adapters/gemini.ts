import { promises as fs } from "node:fs";
import {
  GoogleGenAI,
  createUserContent,
  createPartFromUri
} from "@google/genai";
import type {
  Asset,
  VLMAdapter,
  VLMShotInsight,
  VLMVideoAnalysis
} from "@vvst/shared";

const INLINE_MAX_BYTES = 18 * 1024 * 1024; // Gemini inline budget ~20MB combined; leave headroom

const DEFAULT_MODEL = "gemini-2.5-flash";

const STRUCTURE_PROMPT = `You are a short-video structure analyst.

Analyze the supplied video and return STRICT minified JSON (no markdown fence, no commentary)
with this exact top-level shape:

{
  "video_summary": "<one paragraph>",
  "shots": [
    {
      "start": <seconds, number>,
      "end": <seconds, number>,
      "visual": "<what is on screen>",
      "camera_motion": "<static|push_in|pull_out|pan|tilt|handheld|whip|...>",
      "subtitle_text": "<on-screen text seen, if any>",
      "overlay_style": "<title bar, sticker, arrow, highlight box, none>",
      "transition": "<hard_cut|dissolve|wipe|slide|none>",
      "bgm_cue": "<beat drop / music swell / silence / etc>",
      "purpose": "<hook|setup|body|proof|transition|cta>"
    }
  ],
  "structure": {
    "hook": "<short description of opening hook>",
    "setup": "<context shown after hook, if any>",
    "selling_points": ["<benefit 1>", "<benefit 2>"],
    "climax": "<peak moment description>",
    "cta": "<closing call to action description>"
  },
  "rhythm": {
    "avg_shot_length": <seconds, number>,
    "fast_sections": ["<time range like '0.0-3.0s'>"],
    "slow_sections": ["<time range>"],
    "peak_moments": ["<time range>"]
  },
  "packaging": {
    "subtitle_density": "<low|medium|high>",
    "title_cards": ["<style description>"],
    "stickers": ["<sticker description>"],
    "color_style": "<dominant color / mood>",
    "cover_style": "<thumbnail/cover suggestion>"
  },
  "reusable_patterns": ["<short pattern label>"],
  "material_gaps_for_new_video": ["<missing slot type that a new source video would need>"],
  "recommended_timeline_for_remotion": {
    "duration_sec": <number>,
    "clips": [
      {
        "start": <number>,
        "duration": <number>,
        "role": "<hook|setup|body|proof|cta>",
        "instruction": "<short instruction for the renderer>"
      }
    ]
  }
}

Constraints:
- All time values are seconds, fractional ok.
- shots[].purpose MUST be one of hook|setup|body|proof|transition|cta.
- material_gaps_for_new_video entries MUST be drawn from: hook_visual, product_closeup, usage_scene, comparison, proof_visual, cta_visual, subtitle_text, title_card, transition, background.
- Output STRICT JSON only.`;

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const stripped = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    return stripped.trim();
  }
  return trimmed;
}

function safeNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalise(raw: string): VLMVideoAnalysis {
  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (error) {
    throw new Error(`Gemini returned non-JSON content: ${(error as Error).message}; body=${raw.slice(0, 200)}`);
  }
  const shots: VLMShotInsight[] = Array.isArray(parsed?.shots)
    ? parsed.shots.map((shot: any) => ({
        start: safeNumber(shot.start, 0),
        end: safeNumber(shot.end, 0),
        visual: String(shot.visual ?? ""),
        cameraMotion: shot.camera_motion ?? shot.cameraMotion ?? undefined,
        subtitleText: shot.subtitle_text ?? shot.subtitleText ?? undefined,
        overlayStyle: shot.overlay_style ?? shot.overlayStyle ?? undefined,
        transition: shot.transition ?? undefined,
        bgmCue: shot.bgm_cue ?? shot.bgmCue ?? undefined,
        purpose: shot.purpose ?? undefined
      }))
    : [];
  return {
    videoSummary: String(parsed?.video_summary ?? parsed?.videoSummary ?? ""),
    shots,
    structure: {
      hook: parsed?.structure?.hook,
      setup: parsed?.structure?.setup,
      sellingPoints: parsed?.structure?.selling_points ?? parsed?.structure?.sellingPoints,
      climax: parsed?.structure?.climax,
      cta: parsed?.structure?.cta
    },
    rhythm: {
      avgShotLength: parsed?.rhythm?.avg_shot_length ?? parsed?.rhythm?.avgShotLength,
      fastSections: parsed?.rhythm?.fast_sections ?? parsed?.rhythm?.fastSections,
      slowSections: parsed?.rhythm?.slow_sections ?? parsed?.rhythm?.slowSections,
      peakMoments: parsed?.rhythm?.peak_moments ?? parsed?.rhythm?.peakMoments
    },
    packaging: {
      subtitleDensity: parsed?.packaging?.subtitle_density ?? parsed?.packaging?.subtitleDensity,
      titleCards: parsed?.packaging?.title_cards ?? parsed?.packaging?.titleCards,
      stickers: parsed?.packaging?.stickers,
      colorStyle: parsed?.packaging?.color_style ?? parsed?.packaging?.colorStyle,
      coverStyle: parsed?.packaging?.cover_style ?? parsed?.packaging?.coverStyle
    },
    reusablePatterns: parsed?.reusable_patterns ?? parsed?.reusablePatterns,
    materialGapsForNewVideo: parsed?.material_gaps_for_new_video ?? parsed?.materialGapsForNewVideo,
    recommendedTimelineForRemotion: parsed?.recommended_timeline_for_remotion ?? parsed?.recommendedTimelineForRemotion,
    raw
  };
}

export class GeminiVLMAdapter implements VLMAdapter {
  readonly name = "GeminiVLMAdapter";
  readonly available: boolean;
  private readonly client?: GoogleGenAI;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string }) {
    this.model = opts.model ?? DEFAULT_MODEL;
    if (opts.apiKey) {
      this.client = new GoogleGenAI({ apiKey: opts.apiKey });
      this.available = true;
    } else {
      this.available = false;
    }
  }

  async describeFrames(frames: Array<{ path: string; timeSec: number }>) {
    if (!this.available || frames.length === 0) return [];
    // Gemini's strength is full-video understanding; for individual frames we keep a heuristic stub.
    return frames.map((frame, index) => ({
      timeSec: frame.timeSec,
      tags: index === 0 ? ["hook_candidate"] : index % 2 === 0 ? ["product_like"] : ["background"],
      description: `Gemini frame placeholder for ${frame.path}`
    }));
  }

  async describeVideo(asset: Asset, opts: { mimeType?: string; purpose?: "sample" | "source" } = {}): Promise<VLMVideoAnalysis> {
    if (!this.available || !this.client) throw new Error("Gemini VLM is not configured");
    if (!asset.path) throw new Error(`GeminiVLMAdapter requires asset.path for asset ${asset.id}`);
    const fromExt = guessMimeType(asset.filename);
    const hinted = opts.mimeType ?? asset.mimeType;
    const mimeType = !hinted || hinted === "application/octet-stream" ? fromExt : hinted;

    const stats = await fs.stat(asset.path);
    const useInline = stats.size <= INLINE_MAX_BYTES;
    console.log(`[Gemini] analyzing ${asset.path} size=${stats.size} mime=${mimeType} mode=${useInline ? "inline" : "files-api"}`);

    let videoPart: ReturnType<typeof createPartFromUri> | { inlineData: { data: string; mimeType: string } };
    if (useInline) {
      const data = await fs.readFile(asset.path);
      videoPart = { inlineData: { data: data.toString("base64"), mimeType } };
    } else {
      let uploaded = await this.client.files.upload({
        file: asset.path,
        config: { mimeType }
      });
      if (!uploaded.uri || !uploaded.mimeType || !uploaded.name) {
        throw new Error("Gemini file upload returned no uri/mimeType/name");
      }
      const startedAt = Date.now();
      const timeoutMs = 240_000;
      console.log(`[Gemini] uploaded ${uploaded.name} state=${uploaded.state}`);
      while (uploaded.state && String(uploaded.state) !== "ACTIVE") {
        const state = String(uploaded.state);
        if (state === "FAILED") {
          throw new Error(`Gemini file processing failed for ${uploaded.name} (error=${JSON.stringify((uploaded as any).error ?? null)})`);
        }
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(`Gemini file ${uploaded.name} did not become ACTIVE within ${timeoutMs}ms (state=${state})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        uploaded = await this.client.files.get({ name: uploaded.name! });
        console.log(`[Gemini] poll ${uploaded.name} state=${uploaded.state}`);
      }
      videoPart = createPartFromUri(uploaded.uri!, uploaded.mimeType!);
    }

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: createUserContent([videoPart as any, STRUCTURE_PROMPT]),
      config: { responseMimeType: "application/json" }
    });
    const text = response.text ?? "";
    if (!text) throw new Error("Gemini returned empty text");
    return normalise(text);
  }
}

function guessMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    case "webm":
      return "video/webm";
    case "mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}
