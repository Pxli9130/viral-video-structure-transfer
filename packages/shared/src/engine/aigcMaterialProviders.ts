import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type {
  AigcMaterialProviderId,
  GeneratedAssetCandidate,
  MaterialGenerationBrief
} from "../types.js";

export interface AigcMaterialProviderContext {
  outputDir: string;
  publicPathPrefix: string;
  now?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  allowExternalProviderCall?: boolean;
}

export interface AigcMaterialProvider {
  id: AigcMaterialProviderId;
  kind: "image" | "video" | "copy" | "stub";
  generate(brief: MaterialGenerationBrief, context: AigcMaterialProviderContext): Promise<GeneratedAssetCandidate[]>;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(width: number, height: number, seed: number, label: string): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const labelBytes = Buffer.from(label, "utf8");
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const band = Math.floor((x / width) * 4) + Math.floor((y / height) * 4);
      const accent = (labelBytes[(x + y) % Math.max(1, labelBytes.length)] ?? 31) + seed + band * 19;
      raw[offset] = (seed * 31 + x + accent) % 256;
      raw[offset + 1] = (seed * 47 + y * 2 + accent) % 256;
      raw[offset + 2] = (seed * 67 + x + y + accent) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function candidatePath(prefix: string, filename: string): string {
  return `${prefix.replace(/\/$/, "")}/${filename}`.replace(/\\/g, "/");
}

function candidateTypeFor(brief: MaterialGenerationBrief): GeneratedAssetCandidate["type"] {
  return brief.assetType === "copy" ? "copy" : brief.assetType === "short_video" ? "video" : "image";
}

function maxCandidateCount(brief: MaterialGenerationBrief): number {
  if (brief.assetType === "image_set") return Math.max(1, brief.count);
  return 1;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function envValue(env: Record<string, string | undefined> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env?.[key] ?? process.env[key];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

export interface SeedreamProviderConfig {
  baseUrl: string;
  endpoint: string;
  apiKey: string;
  model: string;
  responseFormat: "url" | "b64_json";
  imageSize: string;
  sequentialImageGeneration: string;
  stream: boolean;
  watermark: boolean;
}

export function resolveSeedreamProviderConfig(env?: Record<string, string | undefined>): SeedreamProviderConfig {
  const apiKey = envValue(env, "SEEDREAM_ARK_API_KEY");
  if (!apiKey) throw new Error("SEEDREAM_ARK_API_KEY is required for volcengine_seedream.");
  const model = envValue(env, "SEEDREAM_ARK_MODEL", "AIGC_IMAGE_MODEL");
  if (!model) throw new Error("SEEDREAM_ARK_MODEL or AIGC_IMAGE_MODEL is required for volcengine_seedream.");
  return {
    baseUrl: envValue(env, "SEEDREAM_ARK_BASE_URL") ?? "https://ark.cn-beijing.volces.com/api/v3",
    endpoint: envValue(env, "SEEDREAM_IMAGE_ENDPOINT") ?? "/images/generations",
    apiKey,
    model,
    responseFormat: (envValue(env, "SEEDREAM_RESPONSE_FORMAT", "AIGC_IMAGE_RESPONSE_FORMAT") ?? "url") as "url" | "b64_json",
    imageSize: envValue(env, "SEEDREAM_IMAGE_SIZE", "AIGC_IMAGE_SIZE") ?? "2K",
    sequentialImageGeneration: envValue(env, "SEEDREAM_SEQUENTIAL_IMAGE_GENERATION") ?? "disabled",
    stream: parseBoolean(envValue(env, "SEEDREAM_STREAM"), false),
    watermark: parseBoolean(envValue(env, "SEEDREAM_WATERMARK", "AIGC_IMAGE_WATERMARK"), false)
  };
}

function imageGenerationUrl(config: SeedreamProviderConfig): string {
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  return new URL(config.endpoint.replace(/^\//, ""), base).toString();
}

function extensionForContentType(contentType: string | null, fallback = "png"): string {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("png")) return "png";
  return fallback;
}

function imageUrlFromResponse(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : [];
  const first = data[0] as Record<string, unknown> | undefined;
  return typeof first?.url === "string" ? first.url : undefined;
}

function b64ImageFromResponse(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : [];
  const first = data[0] as Record<string, unknown> | undefined;
  return typeof first?.b64_json === "string" ? first.b64_json : undefined;
}

function seedreamRequestBody(config: SeedreamProviderConfig, prompt: string): Record<string, unknown> {
  return {
    model: config.model,
    prompt,
    sequential_image_generation: config.sequentialImageGeneration,
    response_format: config.responseFormat,
    size: config.imageSize,
    stream: config.stream,
    watermark: config.watermark
  };
}

export const mockProvider: AigcMaterialProvider = {
  id: "mock_provider",
  kind: "image",
  async generate(brief, context) {
    await mkdir(context.outputDir, { recursive: true });
    const generatedAt = context.now ?? new Date().toISOString();
    const count = maxCandidateCount(brief);
    const candidates: GeneratedAssetCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const ext = brief.assetType === "copy" ? "txt" : "png";
      const filename = `${brief.slotId}_${brief.assetType}_${String(index + 1).padStart(2, "0")}.${ext}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const filePath = path.join(context.outputDir, filename);
      const prompt = brief.promptPack?.[index] ?? brief.promptPack?.[0] ?? `${brief.visualFormFamily} generated material`;
      if (brief.assetType === "copy") {
        await writeFile(filePath, `${prompt}\n`, "utf8");
      } else {
        await writeFile(filePath, makePng(720, 960, index + brief.id.length, `${brief.visualFormFamily} ${index + 1}`));
      }
      candidates.push({
        id: `generated_${brief.slotId}_${String(index + 1).padStart(2, "0")}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        briefId: brief.id,
        slotId: brief.slotId,
        provider: "mock_provider",
        model: "deterministic_mock_png_v1",
        type: candidateTypeFor(brief),
        materialRole: "aigc_generated_material",
        path: candidatePath(context.publicPathPrefix, filename),
        prompt,
        negativePrompt: brief.negativePrompts.join("; "),
        provenance: {
          generatedAt,
          userApproved: false,
          externalProviderUsed: false,
          sampleFramesSentExternally: false,
          targetAssetsSentExternally: false
        },
        quality: {
          usable: undefined,
          issues: []
        }
      });
    }
    return candidates;
  }
};

export const volcengineSeedreamProvider: AigcMaterialProvider = {
  id: "volcengine_seedream",
  kind: "image",
  async generate(brief, context) {
    if (brief.assetType === "copy" || brief.assetType === "short_video") {
      throw new Error(`volcengine_seedream only supports image generation; got ${brief.assetType}.`);
    }
    if (brief.privacyPolicy.sampleFramesAllowedToProvider) {
      throw new Error("volcengine_seedream refuses briefs that allow sample frames to be sent externally.");
    }
    if (context.allowExternalProviderCall !== true) {
      throw new Error("volcengine_seedream requires explicit external-provider opt-in.");
    }
    await mkdir(context.outputDir, { recursive: true });
    const config = resolveSeedreamProviderConfig(context.env);
    const fetchImpl = context.fetchImpl ?? fetch;
    const generatedAt = context.now ?? new Date().toISOString();
    const count = maxCandidateCount(brief);
    const candidates: GeneratedAssetCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const prompt = brief.promptPack?.[index] ?? brief.promptPack?.[0] ?? `${brief.visualFormFamily} generated material`;
      const response = await fetchImpl(imageGenerationUrl(config), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(seedreamRequestBody(config, prompt))
      });
      if (!response.ok) {
        throw new Error(`volcengine_seedream image generation failed with HTTP ${response.status}.`);
      }
      const payload = await response.json();
      let fileBuffer: Buffer;
      let extension = "png";
      if (config.responseFormat === "b64_json") {
        const encoded = b64ImageFromResponse(payload);
        if (!encoded) throw new Error("volcengine_seedream response did not include data[0].b64_json.");
        fileBuffer = Buffer.from(encoded, "base64");
      } else {
        const remoteUrl = imageUrlFromResponse(payload);
        if (!remoteUrl) throw new Error("volcengine_seedream response did not include data[0].url.");
        const imageResponse = await fetchImpl(remoteUrl);
        if (!imageResponse.ok) {
          throw new Error(`volcengine_seedream image download failed with HTTP ${imageResponse.status}.`);
        }
        extension = extensionForContentType(imageResponse.headers.get("content-type"));
        fileBuffer = Buffer.from(await imageResponse.arrayBuffer());
      }
      const filename = `${brief.slotId}_${brief.assetType}_${String(index + 1).padStart(2, "0")}_seedream.${extension}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const filePath = path.join(context.outputDir, filename);
      await writeFile(filePath, fileBuffer);
      candidates.push({
        id: `generated_${brief.slotId}_${String(index + 1).padStart(2, "0")}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        briefId: brief.id,
        slotId: brief.slotId,
        provider: "volcengine_seedream",
        model: config.model,
        type: "image",
        materialRole: "aigc_generated_material",
        path: candidatePath(context.publicPathPrefix, filename),
        prompt,
        negativePrompt: brief.negativePrompts.join("; "),
        provenance: {
          generatedAt,
          userApproved: false,
          externalProviderUsed: true,
          sampleFramesSentExternally: false,
          targetAssetsSentExternally: false
        },
        quality: {
          usable: undefined,
          issues: []
        }
      });
    }
    return candidates;
  }
};

function disabledProvider(id: AigcMaterialProviderId): AigcMaterialProvider {
  return {
    id,
    kind: "stub",
    async generate() {
      throw new Error(`${id} is disabled by default; enable it explicitly and handle privacy/cost policy before use.`);
    }
  };
}

export const AIGC_MATERIAL_PROVIDER_REGISTRY: Record<AigcMaterialProviderId, AigcMaterialProvider> = {
  mock_provider: mockProvider,
  local_folder_provider: disabledProvider("local_folder_provider"),
  volcengine_seedream: volcengineSeedreamProvider,
  ark_seedance_provider_stub: disabledProvider("ark_seedance_provider_stub"),
  image_provider: disabledProvider("image_provider"),
  copy_provider: disabledProvider("copy_provider"),
  none: disabledProvider("none")
};

export function getAigcMaterialProvider(id: AigcMaterialProviderId = "mock_provider"): AigcMaterialProvider {
  return AIGC_MATERIAL_PROVIDER_REGISTRY[id] ?? mockProvider;
}
