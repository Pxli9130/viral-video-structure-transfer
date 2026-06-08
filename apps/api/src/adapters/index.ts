import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  nowIso,
  stableId,
  type AIAdapter,
  type ASRAdapter,
  type AnalyzeVideoOptions,
  type Asset,
  type GenerationRequest,
  type OCRAdapter,
  type RendererTarget,
  type TranscriptSegment,
  type VLMAdapter,
  type VideoAnalysisResult,
  type VideoToolAdapter
} from "@vvst/shared";
import { runPython, hasCondaEnv } from "./condaPython.js";
import { GeminiVLMAdapter } from "./gemini.js";
import { GeminiAIAdapter } from "./geminiAi.js";
import { GoogleAudioAdapter } from "./googleAudio.js";
import { OpenAICompatibleAIAdapter } from "./openaiCompatible.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "../../../..");
const pythonScripts = path.join(repoRoot, "scripts", "python");

export class FFmpegVideoToolAdapter implements VideoToolAdapter {
  readonly name = "FFmpegVideoToolAdapter";
  private readonly generatedDir: string;

  constructor(generatedDir: string) {
    this.generatedDir = generatedDir;
  }

  async analyze(asset: Asset, projectId: string, purpose: "sample" | "source", options?: AnalyzeVideoOptions): Promise<VideoAnalysisResult> {
    if (!asset.path) {
      throw new Error(`FFmpegVideoToolAdapter requires asset.path for asset ${asset.id}`);
    }

    const warnings: string[] = [];
    let durationSec = options?.durationHintSec ?? 0;
    let width = options?.width;
    let height = options?.height;
    let fps = options?.fps;
    let hasAudio = true;
    let codec: string | undefined;

    try {
      const probe = await runPython(path.join(pythonScripts, "ffprobe_metadata.py"), [asset.path]);
      const metadata = JSON.parse(probe.stdout || "{}") as {
        durationSec?: number;
        width?: number | null;
        height?: number | null;
        fps?: number | null;
        hasAudio?: boolean;
        codec?: string | null;
      };
      durationSec = Number(metadata.durationSec ?? durationSec) || durationSec;
      width = metadata.width ?? width;
      height = metadata.height ?? height;
      fps = metadata.fps ?? fps;
      hasAudio = metadata.hasAudio ?? hasAudio;
      codec = metadata.codec ?? undefined;
    } catch (error) {
      warnings.push(`ffprobe failed: ${(error as Error).message}; falling back to mock metadata.`);
    }

    let keyframeOutputs: Array<{ id: string; timeSec: number; path: string }> = [];
    let shotCandidates: Array<{ id: string; startSec: number; endSec: number; durationSec: number; thumbnailPath: string; confidence: number; tags: string[] }> = [];
    try {
      const outDir = path.join(this.generatedDir, "keyframes", asset.id);
      const maxFrames = purpose === "source" ? 8 : 5;
      const result = await runPython(path.join(pythonScripts, "extract_keyframes.py"), [
        asset.path,
        outDir,
        "--max-frames",
        String(maxFrames),
        "--shot-seconds",
        purpose === "source" ? "5" : "3",
        "--purpose",
        purpose
      ]);
      const parsed = JSON.parse(result.stdout || "{}") as {
        keyframes?: Array<{ id: string; timeSec: number; path: string }>;
        shots?: Array<{ id: string; startSec: number; endSec: number; durationSec: number; thumbnailPath: string; confidence: number; tags: string[] }>;
        durationSec?: number;
      };
      keyframeOutputs = parsed.keyframes ?? [];
      shotCandidates = parsed.shots ?? [];
      durationSec = Number(parsed.durationSec ?? durationSec) || durationSec;
    } catch (error) {
      // No mock fallback: surface the real failure (mock removed).
      throw new Error(`FFmpeg keyframe/shot extraction failed for asset ${asset.id} (${asset.path ?? "no path"}): ${(error as Error).message}`);
    }

    if (shotCandidates.length === 0 || keyframeOutputs.length === 0) {
      throw new Error(`FFmpeg analyzer produced no shots/keyframes for asset ${asset.id} (${asset.path ?? "no path"}); a real video file is required (mock removed).`);
    }

    const shots = shotCandidates.map((shot, index) => ({
      id: shot.id ?? `${purpose}_shot_${index + 1}`,
      startSec: shot.startSec,
      endSec: shot.endSec,
      durationSec: shot.durationSec,
      thumbnailPath: shot.thumbnailPath,
      tags: shot.tags?.length ? shot.tags : purpose === "source" ? ["background"] : ["product_like"],
      confidence: shot.confidence ?? 0.6,
      notes: "Extracted by FFmpeg helper."
    }));

    const keyframes = keyframeOutputs.map((kf, index) => ({
      id: kf.id ?? `keyframe_${index + 1}`,
      timeSec: kf.timeSec,
      path: kf.path,
      description: `${asset.filename} ffmpeg keyframe ${index + 1}`,
      tags: shots[index]?.tags ?? []
    }));

    return {
      id: stableId("analysis", asset.id, purpose, durationSec, width ?? 0, height ?? 0),
      assetId: asset.id,
      projectId,
      purpose,
      metadata: {
        durationSec,
        width: width ?? undefined,
        height: height ?? undefined,
        fps: fps ?? undefined,
        hasAudio,
        codec
      },
      keyframes,
      shots,
      transcript: [],
      ocr: [],
      warnings,
      analyzerMode: "ffmpeg",
      createdAt: nowIso()
    };
  }
}


export { OpenAICompatibleAIAdapter };

export class DisabledASRAdapter implements ASRAdapter {
  readonly name = "DisabledASRAdapter";
  readonly available = false;
  async transcribe(): Promise<TranscriptSegment[]> {
    return [];
  }
}

export class FasterWhisperASRAdapter implements ASRAdapter {
  readonly name = "FasterWhisperASRAdapter";
  readonly available: boolean;

  constructor(private readonly opts: { model?: string } = {}) {
    this.available = hasCondaEnv();
  }

  async transcribe(asset: Asset): Promise<TranscriptSegment[]> {
    if (!this.available || !asset.path) return [];
    try {
      const result = await runPython(path.join(pythonScripts, "asr_faster_whisper.py"), [asset.path, "--model", this.opts.model ?? "tiny"]);
      const parsed = JSON.parse(result.stdout || "[]") as TranscriptSegment[];
      return parsed;
    } catch (error) {
      return [];
    }
  }
}

export class DisabledOCRAdapter implements OCRAdapter {
  readonly name = "DisabledOCRAdapter";
  readonly available = false;
  async recognizeFrames() {
    return [];
  }
}

export class EasyOCRAdapter implements OCRAdapter {
  readonly name = "EasyOCRAdapter";
  readonly available: boolean;

  constructor() {
    this.available = hasCondaEnv();
  }

  async recognizeFrames(_asset: Asset, frames: Array<{ path: string; timeSec: number }>) {
    if (!this.available || frames.length === 0) return [];
    try {
      const args = frames.map((frame) => frame.path);
      const result = await runPython(path.join(pythonScripts, "ocr_easyocr.py"), args);
      const parsed = JSON.parse(result.stdout || "[]") as Array<{ path: string; text: string }>;
      return parsed.map((entry) => {
        const matched = frames.find((frame) => frame.path === entry.path);
        return { timeSec: matched?.timeSec ?? 0, text: entry.text };
      });
    } catch (error) {
      return [];
    }
  }
}

export class FallbackASRAdapter implements ASRAdapter {
  readonly name: string;
  readonly available: boolean;

  constructor(private readonly primary: ASRAdapter, private readonly fallback: ASRAdapter) {
    this.name = `${primary.name}+fallback:${fallback.name}`;
    this.available = primary.available || fallback.available;
  }

  async transcribe(asset: Asset): Promise<TranscriptSegment[]> {
    if (this.primary.available) {
      try {
        const transcript = await this.primary.transcribe(asset);
        if (transcript.length > 0) return transcript;
      } catch (error) {
        console.warn(`[ASR] ${this.primary.name} failed; trying ${this.fallback.name}: ${(error as Error).message}`);
      }
    }
    return this.fallback.available ? this.fallback.transcribe(asset) : [];
  }
}

export class DisabledVLMAdapter implements VLMAdapter {
  readonly name = "DisabledVLMAdapter";
  readonly available = false;
  async describeFrames() {
    return [];
  }
}

export class KeyframeHeuristicVLMAdapter implements VLMAdapter {
  readonly name = "KeyframeHeuristicVLMAdapter";
  readonly available = true;

  async describeFrames(frames: Array<{ path: string; timeSec: number }>) {
    return frames.map((frame, index) => ({
      timeSec: frame.timeSec,
      tags: ["local_heuristic_fallback", index === 0 ? "opening_frame" : "evidence_frame"],
      description: `Local heuristic fallback for frame ${index + 1}; no semantic external VLM review was used.`
    }));
  }
}

export interface AdapterSet {
  videoTool: VideoToolAdapter;
  aiAdapter: AIAdapter;
  asrAdapter: ASRAdapter;
  ocrAdapter: OCRAdapter;
  vlmAdapter: VLMAdapter;
}

export function buildAdapterSet(env: NodeJS.ProcessEnv, generatedDir: string): AdapterSet {
  // Mock adapters removed: always use the real FFmpeg analyzer. A real failure surfaces as an error.
  const videoTool = new FFmpegVideoToolAdapter(generatedDir);
  const aiProvider = (env.AI_PROVIDER ?? "gemini").toLowerCase();
  let aiAdapter: AIAdapter;
  if (aiProvider === "gemini") {
    // Gemini-backed text LLM (structure enrichment / revise / scorecard). Separate request
    // from the Gemini VLM (video understanding); model defaults to AI_GEMINI_MODEL, then VLM_MODEL.
    aiAdapter = new GeminiAIAdapter({
      apiKey: env.GEMINI_API_KEY,
      model: env.AI_GEMINI_MODEL ?? env.VLM_MODEL
    });
  } else if (aiProvider === "openai_compatible") {
    aiAdapter = new OpenAICompatibleAIAdapter({
      baseUrl: env.OPENAI_COMPATIBLE_BASE_URL,
      apiKey: env.OPENAI_COMPATIBLE_API_KEY,
      model: env.OPENAI_COMPATIBLE_MODEL
    });
  } else if (aiProvider === "ark_doubao") {
    aiAdapter = new OpenAICompatibleAIAdapter({
      baseUrl: env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: env.ARK_API_KEY ?? env.OPENAI_COMPATIBLE_API_KEY,
      model: env.ARK_MODEL ?? env.OPENAI_COMPATIBLE_MODEL
    });
  } else {
    // No mock AI adapter: require a real provider. Fail loudly on misconfiguration.
    throw new Error(`AI_PROVIDER must be one of gemini|ark_doubao|openai_compatible (got "${aiProvider}"; mock removed)`);
  }
  const asrProvider = (env.ASR_PROVIDER ?? "faster_whisper").toLowerCase();
  const asrAdapter =
    asrProvider === "off" || asrProvider === "none" || asrProvider === "disabled"
      ? new DisabledASRAdapter()
      : new FasterWhisperASRAdapter({ model: env.ASR_MODEL ?? "tiny" });
  const ocrAdapter = env.OCR_PROVIDER === "easyocr" ? new EasyOCRAdapter() : new DisabledOCRAdapter();
  const vlmAdapter =
    env.VLM_PROVIDER === "gemini"
      ? new GeminiVLMAdapter({ apiKey: env.GEMINI_API_KEY, model: env.VLM_MODEL })
      : env.VLM_PROVIDER === "heuristic"
        ? new KeyframeHeuristicVLMAdapter()
        : new DisabledVLMAdapter();
  return { videoTool, aiAdapter, asrAdapter, ocrAdapter, vlmAdapter };
}

export { GeminiVLMAdapter };
export { GeminiAIAdapter };
export { GoogleAudioAdapter };

export const RENDERER_TARGETS_ENV: Record<string, RendererTarget> = {
  html_preview: "html_preview",
  ffmpeg: "ffmpeg",
  remotion: "remotion",
  hyperframes: "hyperframes"
};

export type { AnalyzeVideoOptions };
