import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nowIso, stableId } from "@vvst/shared";

export interface GoogleGeneratedAudioAsset {
  id: string;
  path: string;
  provider: "google_gemini_tts" | "google_lyria_music";
  materialRole: "aigc_voiceover" | "aigc_music";
  provenance: {
    source: "aigc_generated";
    sampleDerived: false;
    renderable: true;
    promptHash?: string;
    generatedAt: string;
  };
  metadata: Record<string, unknown>;
}

export interface GoogleAudioAdapterOptions {
  apiKey?: string;
  enabled?: boolean;
  baseUrl?: string;
  outputDir?: string;
  ttsModelId?: string;
  musicModelId?: string;
  voiceName?: string;
}

function envFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  return /^(1|true|yes|on)$/i.test(env[key]?.trim() ?? "");
}

export function googleAudioLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    envFlag(env, "ENABLE_GOOGLE_AUDIO_LIVE_TESTS") ||
    envFlag(env, "GOOGLE_AUDIO_ENABLE_CLOUD") ||
    envFlag(env, "ALLOW_CLOUD_PROVIDERS")
  );
}

function promptHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function rejectPromptPollution(text: string): void {
  if (/prompt|watermark|水印|学习样例|不要复制|不复制|sample\s+(audio|video|frame)|copy\s+the\s+sample/i.test(text)) {
    throw new Error("Google audio prompt/text rejected: raw prompt or sample-copy instruction is not renderable audio content.");
  }
}

function wavFromPcm16LE(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(pcm)]));
}

function extensionFromMime(mimeType: string | undefined, fallback: "mp3" | "wav"): "mp3" | "wav" {
  if (mimeType?.includes("mpeg") || mimeType?.includes("mp3")) return "mp3";
  if (mimeType?.includes("wav")) return "wav";
  return fallback;
}

function decodeInlineAudio(part: { inlineData?: { data?: string; mimeType?: string } } | undefined): {
  bytes: Uint8Array;
  mimeType?: string;
} {
  if (!part?.inlineData?.data) throw new Error("Google audio response did not include inline audio data.");
  return {
    bytes: new Uint8Array(Buffer.from(part.inlineData.data, "base64")),
    mimeType: part.inlineData.mimeType
  };
}

export class GoogleAudioAdapter {
  readonly name = "GoogleAudioAdapter";
  readonly available: boolean;
  private readonly apiKey?: string;
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly outputDir: string;
  private readonly ttsModelId: string;
  private readonly musicModelId: string;
  private readonly voiceName: string;

  constructor(opts: GoogleAudioAdapterOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
    this.enabled = opts.enabled ?? googleAudioLiveEnabled();
    this.baseUrl = (opts.baseUrl ?? process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    this.outputDir = opts.outputDir ?? path.resolve(process.cwd(), "storage/generated/google-audio");
    this.ttsModelId = opts.ttsModelId ?? process.env.GOOGLE_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
    this.musicModelId = opts.musicModelId ?? process.env.GOOGLE_MUSIC_MODEL ?? "lyria-3-clip-preview";
    this.voiceName = opts.voiceName ?? process.env.GOOGLE_TTS_VOICE ?? "Kore";
    this.available = Boolean(this.apiKey && this.enabled);
  }

  credentialSummary(): { configured: boolean; enabled: boolean; baseUrl: string } {
    return { configured: Boolean(this.apiKey), enabled: this.enabled, baseUrl: this.baseUrl };
  }

  private assertLive(): void {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured for Google audio.");
    if (!this.enabled) {
      throw new Error("Google audio live calls are disabled; set GOOGLE_AUDIO_ENABLE_CLOUD=1, ENABLE_GOOGLE_AUDIO_LIVE_TESTS=1, or ALLOW_CLOUD_PROVIDERS=1.");
    }
  }

  private async generateContent(model: string, body: Record<string, unknown>): Promise<{
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> } }>;
    promptFeedback?: { blockReason?: string };
  }> {
    this.assertLive();
    const res = await fetch(`${this.baseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey! },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Google audio ${model} failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> } }>;
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) throw new Error(`Google audio ${model} blocked: ${data.promptFeedback.blockReason}`);
    return data;
  }

  async generateVoiceover(input: {
    text: string;
    style?: string;
    durationTargetSec?: number;
    productTheme?: object;
  }): Promise<GoogleGeneratedAudioAsset> {
    const text = input.text.trim();
    rejectPromptPollution(text);
    const speakingPrompt = [
      input.style === "calm" ? "Read this line in a calm, polished product-ad narration voice." : "Read this line as polished product-ad narration.",
      text
    ].join("\n");
    const data = await this.generateContent(this.ttsModelId, {
      contents: [{ parts: [{ text: speakingPrompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: this.voiceName }
          }
        }
      }
    });
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const audio = decodeInlineAudio(parts.find((part) => part.inlineData?.data));
    const isRawPcm = !audio.mimeType || audio.mimeType.includes("pcm") || audio.mimeType.includes("L16");
    const bytes = isRawPcm ? wavFromPcm16LE(audio.bytes) : audio.bytes;
    const extension = isRawPcm ? "wav" : extensionFromMime(audio.mimeType, "wav");
    return this.writeGeneratedAudio("google_gemini_tts", "aigc_voiceover", bytes, extension, {
      modelId: this.ttsModelId,
      voiceName: this.voiceName,
      mimeType: audio.mimeType,
      promptHash: promptHash(text),
      durationTargetSec: input.durationTargetSec,
      productTheme: input.productTheme
    });
  }

  async generateMusic(input: { prompt: string; durationSec?: number }): Promise<GoogleGeneratedAudioAsset> {
    const prompt = input.prompt.trim();
    rejectPromptPollution(prompt);
    const duration = input.durationSec ? Math.min(30, Math.max(3, Math.round(input.durationSec))) : 15;
    const data = await this.generateContent(this.musicModelId, {
      contents: [
        {
          parts: [
            {
              text: `${prompt}\n\nGenerate an original instrumental music clip, about ${duration} seconds long, no vocals, no copyrighted melody.`
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["AUDIO"]
      }
    });
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const audio = decodeInlineAudio(parts.find((part) => part.inlineData?.data));
    const extension = extensionFromMime(audio.mimeType, "mp3");
    return this.writeGeneratedAudio("google_lyria_music", "aigc_music", audio.bytes, extension, {
      modelId: this.musicModelId,
      mimeType: audio.mimeType,
      promptHash: promptHash(prompt),
      requestedDurationSec: input.durationSec,
      generatedDurationSec: duration
    });
  }

  private async writeGeneratedAudio(
    provider: GoogleGeneratedAudioAsset["provider"],
    materialRole: GoogleGeneratedAudioAsset["materialRole"],
    bytes: Uint8Array,
    extension: "mp3" | "wav",
    metadata: Record<string, unknown>
  ): Promise<GoogleGeneratedAudioAsset> {
    await mkdir(this.outputDir, { recursive: true });
    const id = stableId("google_audio", provider, materialRole, nowIso(), metadata.promptHash ?? bytes.byteLength);
    const out = path.join(this.outputDir, `${id}.${extension}`);
    await writeFile(out, bytes);
    return {
      id,
      path: out,
      provider,
      materialRole,
      provenance: {
        source: "aigc_generated",
        sampleDerived: false,
        renderable: true,
        ...(typeof metadata.promptHash === "string" ? { promptHash: metadata.promptHash } : {}),
        generatedAt: nowIso()
      },
      metadata
    };
  }
}
