import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  nowIso,
  stableId,
  type ASRAdapter,
  type Asset,
  type TranscriptSegment
} from "@vvst/shared";

export type ElevenLabsAudioProvenance = "user_uploaded" | "source_video" | "sample_evidence" | "generated";

export interface GeneratedAudioAsset {
  id: string;
  path: string;
  provider: "elevenlabs_tts" | "elevenlabs_sound_effects" | "elevenlabs_music" | "elevenlabs_audio_isolation";
  materialRole: "aigc_voiceover" | "aigc_sound_effect" | "aigc_music" | "processed_user_audio";
  provenance: {
    source: "aigc_generated" | "processed_user_audio";
    sampleDerived: false;
    renderable: true;
    promptHash?: string;
    generatedAt: string;
  };
  metadata: Record<string, unknown>;
}

export interface ElevenLabsAdapterOptions {
  apiKey?: string;
  enabled?: boolean;
  baseUrl?: string;
  outputDir?: string;
  defaultVoiceId?: string;
  ttsModelId?: string;
  scribeModelId?: "scribe_v1" | "scribe_v2";
}

function envFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  return /^(1|true|yes|on)$/i.test(env[key]?.trim() ?? "");
}

export function elevenLabsLiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlag(env, "ENABLE_ELEVENLABS_LIVE_TESTS") || envFlag(env, "ELEVENLABS_ENABLE_CLOUD");
}

function promptHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function rejectPromptPollution(text: string): void {
  if (/prompt|watermark|水印|学习样例|不要复制|不复制|sample\s+(audio|video|frame)|copy\s+the\s+sample/i.test(text)) {
    throw new Error("ElevenLabs prompt/text rejected: raw prompt or sample-copy instruction is not renderable audio content.");
  }
}

function rejectSampleAudio(input: { audioPath?: string; assetProvenance?: ElevenLabsAudioProvenance }): void {
  const allowExternalSampleAnalysis =
    envFlag(process.env, "ALLOW_EXTERNAL_ASR_SAMPLE_ANALYSIS") || envFlag(process.env, "ALLOW_EXTERNAL_SAMPLE_MEDIA");
  if (input.assetProvenance === "sample_evidence" && !allowExternalSampleAnalysis) {
    throw new Error("ElevenLabs adapter refused sample_evidence audio; sample audio must remain local evidence only.");
  }
  const normalized = input.audioPath ? input.audioPath.split(path.sep).join("/") : "";
  if (!allowExternalSampleAnalysis && /\/test_videos\/|\/learned_samples|\/learned_samples_max|sample[_-]?evidence/i.test(normalized)) {
    throw new Error(`ElevenLabs adapter refused likely sample artifact path: ${input.audioPath}`);
  }
}

async function fileBlob(filePath: string): Promise<Blob> {
  const data = await readFile(filePath);
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Blob([bytes]);
}

function transcriptFromScribe(value: unknown): TranscriptSegment[] {
  const json = value as { text?: string; words?: Array<{ text?: string; start?: number; end?: number; type?: string }> };
  const wordSegments = (json.words ?? [])
    .filter((word) => word.type !== "spacing" && typeof word.text === "string" && typeof word.start === "number" && typeof word.end === "number")
    .map((word) => ({ startSec: word.start as number, endSec: word.end as number, text: String(word.text) }));
  if (wordSegments.length) return wordSegments;
  return json.text ? [{ startSec: 0, endSec: 0, text: json.text }] : [];
}

export class ElevenLabsAdapter implements ASRAdapter {
  readonly name = "ElevenLabsAdapter";
  readonly available: boolean;
  private readonly apiKey?: string;
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly outputDir: string;
  private readonly defaultVoiceId: string;
  private readonly ttsModelId: string;
  private readonly scribeModelId: "scribe_v1" | "scribe_v2";

  constructor(opts: ElevenLabsAdapterOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY;
    this.enabled = opts.enabled ?? elevenLabsLiveEnabled();
    this.baseUrl = (opts.baseUrl ?? process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io/v1").replace(/\/+$/, "");
    this.outputDir = opts.outputDir ?? path.resolve(process.cwd(), "storage/generated/elevenlabs");
    this.defaultVoiceId = opts.defaultVoiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    this.ttsModelId = opts.ttsModelId ?? process.env.ELEVENLABS_TTS_MODEL ?? "eleven_multilingual_v2";
    this.scribeModelId = opts.scribeModelId ?? (process.env.ELEVENLABS_SCRIBE_MODEL as "scribe_v1" | "scribe_v2" | undefined) ?? "scribe_v2";
    this.available = Boolean(this.apiKey && this.enabled);
  }

  credentialSummary(): { configured: boolean; enabled: boolean; baseUrl: string } {
    return { configured: Boolean(this.apiKey), enabled: this.enabled, baseUrl: this.baseUrl };
  }

  private assertLive(): void {
    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");
    if (!this.enabled) throw new Error("ElevenLabs live calls are disabled; set ENABLE_ELEVENLABS_LIVE_TESTS=1 or ELEVENLABS_ENABLE_CLOUD=1.");
  }

  private async requestJson<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    this.assertLive();
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        "xi-api-key": this.apiKey!,
        ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });
    if (!res.ok) throw new Error(`ElevenLabs ${endpoint} failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return (await res.json()) as T;
  }

  private async requestBinary(endpoint: string, init: RequestInit = {}): Promise<Uint8Array> {
    this.assertLive();
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        "xi-api-key": this.apiKey!,
        ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...(init.headers ?? {})
      }
    });
    if (!res.ok) throw new Error(`ElevenLabs ${endpoint} failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async listModels(): Promise<unknown[]> {
    return this.requestJson<unknown[]>("/models", { method: "GET" });
  }

  async listVoices(): Promise<unknown> {
    return this.requestJson<unknown>("/voices", { method: "GET" });
  }

  async transcribe(asset: Asset): Promise<TranscriptSegment[]> {
    if (!asset.path) return [];
    const assetProvenance: ElevenLabsAudioProvenance =
      asset.role === "example_video" ? "sample_evidence" : asset.role === "source_video" ? "source_video" : "user_uploaded";
    const result = await this.transcribeAudio({ audioPath: asset.path, assetProvenance });
    return result.segments;
  }

  async transcribeAudio(input: {
    audioPath: string;
    assetProvenance: ElevenLabsAudioProvenance;
    language?: string;
    enableWordTimestamps?: boolean;
  }): Promise<{ provider: "elevenlabs_scribe"; segments: TranscriptSegment[]; raw: unknown }> {
    rejectSampleAudio(input);
    const form = new FormData();
    form.append("model_id", this.scribeModelId);
    form.append("file", await fileBlob(input.audioPath), path.basename(input.audioPath));
    if (input.language) form.append("language_code", input.language);
    form.append("timestamps_granularity", input.enableWordTimestamps === false ? "none" : "word");
    const raw = await this.requestJson<unknown>("/speech-to-text", { method: "POST", body: form });
    return { provider: "elevenlabs_scribe", segments: transcriptFromScribe(raw), raw };
  }

  async generateVoiceover(input: {
    text: string;
    voiceId?: string;
    style?: string;
    durationTargetSec?: number;
    productTheme?: object;
  }): Promise<GeneratedAudioAsset> {
    const text = input.text.trim();
    rejectPromptPollution(text);
    const voiceId = input.voiceId ?? this.defaultVoiceId;
    const bytes = await this.requestBinary(`/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      body: JSON.stringify({
        text,
        model_id: this.ttsModelId,
        voice_settings: input.style === "calm" ? { stability: 0.72, similarity_boost: 0.72 } : undefined
      })
    });
    return this.writeGeneratedAudio("elevenlabs_tts", "aigc_voiceover", bytes, "mp3", {
      voiceId,
      modelId: this.ttsModelId,
      promptHash: promptHash(text),
      durationTargetSec: input.durationTargetSec,
      productTheme: input.productTheme
    });
  }

  async generateSoundEffect(input: { prompt: string; durationSec?: number; loop?: boolean }): Promise<GeneratedAudioAsset> {
    const prompt = input.prompt.trim();
    rejectPromptPollution(prompt);
    const bytes = await this.requestBinary("/sound-generation?output_format=mp3_44100_128", {
      method: "POST",
      body: JSON.stringify({
        text: prompt,
        duration_seconds: input.durationSec,
        loop: input.loop ?? false,
        model_id: process.env.ELEVENLABS_SFX_MODEL ?? "eleven_text_to_sound_v2"
      })
    });
    return this.writeGeneratedAudio("elevenlabs_sound_effects", "aigc_sound_effect", bytes, "mp3", { promptHash: promptHash(prompt) });
  }

  async generateMusic(input: { prompt: string; durationSec?: number }): Promise<GeneratedAudioAsset> {
    const prompt = input.prompt.trim();
    rejectPromptPollution(prompt);
    const bytes = await this.requestBinary("/music", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        // ElevenLabs Music accepts music_length_ms in [3000, 600000]; clamp so an out-of-range
        // duration degrades gracefully instead of returning a 422.
        music_length_ms: input.durationSec
          ? Math.min(600000, Math.max(3000, Math.round(input.durationSec * 1000)))
          : undefined
      })
    });
    return this.writeGeneratedAudio("elevenlabs_music", "aigc_music", bytes, "mp3", { promptHash: promptHash(prompt) });
  }

  async isolateAudio(input: { audioPath: string; assetProvenance: ElevenLabsAudioProvenance }): Promise<GeneratedAudioAsset> {
    rejectSampleAudio(input);
    const form = new FormData();
    form.append("audio", await fileBlob(input.audioPath), path.basename(input.audioPath));
    const bytes = await this.requestBinary("/audio-isolation", { method: "POST", body: form });
    return this.writeGeneratedAudio("elevenlabs_audio_isolation", "processed_user_audio", bytes, "mp3", {
      sourcePathHash: promptHash(path.resolve(input.audioPath))
    });
  }

  async forcedAlign(input: { audioPath: string; text: string; assetProvenance: ElevenLabsAudioProvenance }): Promise<unknown> {
    rejectSampleAudio(input);
    const text = input.text.trim();
    rejectPromptPollution(text);
    const form = new FormData();
    form.append("file", await fileBlob(input.audioPath), path.basename(input.audioPath));
    form.append("text", text);
    return this.requestJson<unknown>("/forced-alignment", { method: "POST", body: form });
  }

  private async writeGeneratedAudio(
    provider: GeneratedAudioAsset["provider"],
    materialRole: GeneratedAudioAsset["materialRole"],
    bytes: Uint8Array,
    extension: "mp3",
    metadata: Record<string, unknown>
  ): Promise<GeneratedAudioAsset> {
    await mkdir(this.outputDir, { recursive: true });
    const id = stableId("elevenlabs_audio", provider, materialRole, nowIso(), metadata.promptHash ?? metadata.sourcePathHash ?? bytes.byteLength);
    const out = path.join(this.outputDir, `${id}.${extension}`);
    await writeFile(out, bytes);
    return {
      id,
      path: out,
      provider,
      materialRole,
      provenance: {
        source: materialRole === "processed_user_audio" ? "processed_user_audio" : "aigc_generated",
        sampleDerived: false,
        renderable: true,
        ...(typeof metadata.promptHash === "string" ? { promptHash: metadata.promptHash } : {}),
        generatedAt: nowIso()
      },
      metadata
    };
  }
}
