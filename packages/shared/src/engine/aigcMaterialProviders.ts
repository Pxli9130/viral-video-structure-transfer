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

function makePngFromRaw(width: number, height: number, raw: Buffer): Buffer {
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

function setPixel(raw: Buffer, width: number, height: number, x: number, y: number, color: [number, number, number]): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = y * (width * 3 + 1) + 1 + x * 3;
  raw[offset] = color[0];
  raw[offset + 1] = color[1];
  raw[offset + 2] = color[2];
}

function fillRect(raw: Buffer, width: number, height: number, x: number, y: number, w: number, h: number, color: [number, number, number]): void {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(width, Math.ceil(x + w));
  const bottom = Math.min(height, Math.ceil(y + h));
  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) setPixel(raw, width, height, px, py, color);
  }
}

function fillCircle(raw: Buffer, width: number, height: number, cx: number, cy: number, radius: number, color: [number, number, number]): void {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(raw, width, height, x, y, color);
    }
  }
}

function fillRoundedRect(raw: Buffer, width: number, height: number, x: number, y: number, w: number, h: number, r: number, color: [number, number, number]): void {
  fillRect(raw, width, height, x + r, y, w - 2 * r, h, color);
  fillRect(raw, width, height, x, y + r, w, h - 2 * r, color);
  fillCircle(raw, width, height, x + r, y + r, r, color);
  fillCircle(raw, width, height, x + w - r, y + r, r, color);
  fillCircle(raw, width, height, x + r, y + h - r, r, color);
  fillCircle(raw, width, height, x + w - r, y + h - r, r, color);
}

function strokeRect(raw: Buffer, width: number, height: number, x: number, y: number, w: number, h: number, thickness: number, color: [number, number, number]): void {
  fillRect(raw, width, height, x, y, w, thickness, color);
  fillRect(raw, width, height, x, y + h - thickness, w, thickness, color);
  fillRect(raw, width, height, x, y, thickness, h, color);
  fillRect(raw, width, height, x + w - thickness, y, thickness, h, color);
}

function initRawCanvas(width: number, height: number, seed: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const v = Math.floor(18 + (x / width) * 16 + (y / height) * 22 + (seed % 7));
      raw[offset] = Math.min(42, v);
      raw[offset + 1] = Math.min(55, v + 8);
      raw[offset + 2] = Math.min(76, v + 20);
    }
  }
  return raw;
}

function drawUiCard(raw: Buffer, width: number, height: number, x: number, y: number, w: number, h: number, seed: number): void {
  const card: [number, number, number] = [240, 247, 255];
  const cardShadow: [number, number, number] = [4, 12, 24];
  const accentA: [number, number, number] = seed % 2 ? [14, 165, 233] : [168, 85, 247];
  const accentB: [number, number, number] = seed % 2 ? [45, 212, 191] : [251, 113, 133];
  fillRoundedRect(raw, width, height, x + 12, y + 14, w, h, 28, cardShadow);
  fillRoundedRect(raw, width, height, x, y, w, h, 28, card);
  strokeRect(raw, width, height, x + 8, y + 8, w - 16, h - 16, 3, [148, 163, 184]);
  fillCircle(raw, width, height, x + 54, y + 52, 22, accentA);
  fillRect(raw, width, height, x + 92, y + 34, w * 0.38, 18, [71, 85, 105]);
  fillRect(raw, width, height, x + 92, y + 66, w * 0.28, 12, [148, 163, 184]);
  for (let i = 0; i < 4; i += 1) {
    const rowY = y + 128 + i * 44;
    fillRoundedRect(raw, width, height, x + 42, rowY, w - 84, 20, 10, i % 2 ? accentB : accentA);
    fillRoundedRect(raw, width, height, x + 42, rowY + 24, w - 130 - i * 12, 10, 5, [203, 213, 225]);
  }
  fillRoundedRect(raw, width, height, x + w - 128, y + h - 82, 76, 38, 16, accentA);
}

function drawLogoPlaceholder(raw: Buffer, width: number, height: number): void {
  fillRoundedRect(raw, width, height, 96, 112, width - 192, height - 224, 44, [226, 232, 240]);
  strokeRect(raw, width, height, 120, 136, width - 240, height - 272, 5, [14, 165, 233]);
  fillCircle(raw, width, height, width / 2, 316, 92, [15, 23, 42]);
  fillCircle(raw, width, height, width / 2, 316, 56, [45, 212, 191]);
  fillRoundedRect(raw, width, height, 186, 492, width - 372, 62, 28, [14, 165, 233]);
  fillRoundedRect(raw, width, height, 218, 592, width - 436, 28, 14, [100, 116, 139]);
  fillRoundedRect(raw, width, height, 252, 642, width - 504, 24, 12, [148, 163, 184]);
}

function drawObjectMaterial(raw: Buffer, width: number, height: number): void {
  fillCircle(raw, width, height, width / 2, 410, 146, [14, 165, 233]);
  fillCircle(raw, width, height, width / 2 + 36, 370, 86, [45, 212, 191]);
  fillRoundedRect(raw, width, height, 170, 610, 380, 88, 36, [226, 232, 240]);
  fillRoundedRect(raw, width, height, 218, 642, 284, 24, 12, [71, 85, 105]);
}

function makeMockMaterialPng(width: number, height: number, seed: number, family: string): Buffer {
  const raw = initRawCanvas(width, height, seed);
  if (family === "media_cards" || family === "live_action_montage" || family === "unknown") {
    drawUiCard(raw, width, height, 116 + (seed % 3) * 10, 120, 448, 300, seed);
    drawUiCard(raw, width, height, 84, 376, 514, 318, seed + 2);
    drawUiCard(raw, width, height, 148, 650, 420, 220, seed + 4);
  } else if (family === "brand_cta") {
    drawLogoPlaceholder(raw, width, height);
  } else if (family === "object_motion" || family === "poster_layout") {
    drawObjectMaterial(raw, width, height);
  } else {
    drawUiCard(raw, width, height, 96, 160, 528, 520, seed);
    fillRoundedRect(raw, width, height, 160, 740, 400, 58, 24, [14, 165, 233]);
  }
  return makePngFromRaw(width, height, raw);
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

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
  maxRetries: number;
  retryDelayMs: number;
}

export interface SeedanceProviderConfig {
  baseUrl: string;
  endpoint: string;
  apiKey: string;
  model: string;
  ratio: string;
  resolution?: string;
  durationSec: number;
  generateAudio: boolean;
  watermark: boolean;
  maxPolls: number;
  pollIntervalMs: number;
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
    watermark: parseBoolean(envValue(env, "SEEDREAM_WATERMARK", "AIGC_IMAGE_WATERMARK"), false),
    maxRetries: parseInteger(envValue(env, "SEEDREAM_MAX_RETRIES", "AIGC_IMAGE_MAX_RETRIES"), 2),
    retryDelayMs: parseInteger(envValue(env, "SEEDREAM_RETRY_DELAY_MS", "AIGC_IMAGE_RETRY_DELAY_MS"), 1500)
  };
}

export function resolveSeedanceProviderConfig(
  env?: Record<string, string | undefined>,
  brief?: MaterialGenerationBrief
): SeedanceProviderConfig {
  const apiKey = envValue(env, "SEEDANCE_ARK_API_KEY", "SEEDANCE_API_KEY", "SEEDREAM_ARK_API_KEY", "ARK_API_KEY");
  if (!apiKey) throw new Error("SEEDANCE_ARK_API_KEY, SEEDANCE_API_KEY, SEEDREAM_ARK_API_KEY, or ARK_API_KEY is required for seedance_2_0.");
  const requestedDuration = parseInteger(
    envValue(env, "SEEDANCE_DURATION_SEC", "AIGC_VIDEO_DURATION_SEC"),
    Math.round(brief?.structureConstraints.durationSec ?? 6)
  );
  return {
    baseUrl: envValue(env, "SEEDANCE_ARK_BASE_URL", "SEEDREAM_ARK_BASE_URL", "ARK_BASE_URL") ?? "https://ark.cn-beijing.volces.com/api/v3",
    endpoint: envValue(env, "SEEDANCE_TASK_ENDPOINT", "AIGC_VIDEO_TASK_ENDPOINT") ?? "/contents/generations/tasks",
    apiKey,
    model: envValue(env, "SEEDANCE_MODEL", "AIGC_VIDEO_MODEL") ?? "doubao-seedance-2-0-fast-260128",
    ratio: envValue(env, "SEEDANCE_RATIO", "AIGC_VIDEO_RATIO") ?? String(brief?.styleConstraints.aspectRatio ?? "9:16"),
    resolution: envValue(env, "SEEDANCE_RESOLUTION", "AIGC_VIDEO_RESOLUTION"),
    durationSec: Math.max(1, Math.min(parseInteger(envValue(env, "SEEDANCE_MAX_DURATION_SEC"), requestedDuration), requestedDuration)),
    generateAudio: parseBoolean(envValue(env, "SEEDANCE_GENERATE_AUDIO", "AIGC_VIDEO_GENERATE_AUDIO"), true),
    watermark: parseBoolean(envValue(env, "SEEDANCE_WATERMARK", "AIGC_VIDEO_WATERMARK"), false),
    maxPolls: Math.max(1, parseInteger(envValue(env, "SEEDANCE_MAX_POLLS", "AIGC_VIDEO_MAX_POLLS"), 120)),
    pollIntervalMs: parseInteger(envValue(env, "SEEDANCE_POLL_INTERVAL_MS", "AIGC_VIDEO_POLL_INTERVAL_MS"), 5000)
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableSeedreamStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sanitizeSeedreamErrorText(text: string): string {
  return text
    .replace(/account\s+\[[^\]]+\]/gi, "account [redacted]")
    .replace(/Request id:\s*[0-9A-Za-z_-]+/gi, "Request id: redacted")
    .replace(/ark-[0-9A-Za-z_-]+/g, "ark-***")
    .replace(/AIza[0-9A-Za-z_-]+/g, "AIza***")
    .slice(0, 700);
}

function seedreamErrorMessage(status: number | string, text: string): string {
  const sanitized = sanitizeSeedreamErrorText(text);
  try {
    const payload = JSON.parse(sanitized) as { error?: { code?: string; message?: string; type?: string } };
    const code = payload.error?.code ? `${payload.error.code}: ` : "";
    const message = payload.error?.message ?? sanitized;
    return `volcengine_seedream image generation failed with HTTP ${status} (${code}${message}).`;
  } catch {
    return `volcengine_seedream image generation failed with HTTP ${status}${sanitized ? ` (${sanitized})` : ""}.`;
  }
}

function providerErrorMessage(provider: string, operation: string, status: number | string, text: string): string {
  const sanitized = sanitizeSeedreamErrorText(text);
  try {
    const payload = JSON.parse(sanitized) as { error?: { code?: string; message?: string; type?: string } };
    const code = payload.error?.code ? `${payload.error.code}: ` : "";
    const message = payload.error?.message ?? sanitized;
    return `${provider} ${operation} failed with HTTP ${status} (${code}${message}).`;
  } catch {
    return `${provider} ${operation} failed with HTTP ${status}${sanitized ? ` (${sanitized})` : ""}.`;
  }
}

function imageGenerationUrl(config: SeedreamProviderConfig): string {
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  return new URL(config.endpoint.replace(/^\//, ""), base).toString();
}

function seedanceTaskUrl(config: SeedanceProviderConfig, taskId?: string): string {
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const endpoint = config.endpoint.replace(/^\//, "");
  return new URL(taskId ? `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(taskId)}` : endpoint, base).toString();
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

function seedancePrompt(brief: MaterialGenerationBrief, prompt: string): string {
  return [
    prompt,
    `Target theme: ${brief.targetTheme}.`,
    `Motion structure: ${brief.structureConstraints.motionPattern}; renderer intent: ${brief.structureConstraints.intendedRendererCapability}.`,
    `Role: ${brief.structureConstraints.slotRole}; visual form: ${brief.visualForm}.`,
    "Create original target-product video material only. Do not copy any sample frame, sample audio, watermark, platform UI, or person likeness.",
    brief.negativePrompts.length ? `Avoid: ${brief.negativePrompts.join("; ")}.` : ""
  ].filter(Boolean).join("\n");
}

function seedanceRequestBody(config: SeedanceProviderConfig, prompt: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    content: [{ type: "text", text: prompt }],
    generate_audio: config.generateAudio,
    ratio: config.ratio,
    duration: config.durationSec,
    watermark: config.watermark
  };
  if (config.resolution) body.resolution = config.resolution;
  return body;
}

function seedanceTaskId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
  const output = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  const candidates = [record.id, record.task_id, record.taskId, data?.id, data?.task_id, data?.taskId, output?.id, output?.task_id, output?.taskId];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function seedanceStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
  const output = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  const raw = [record.status, record.task_status, record.taskStatus, data?.status, data?.task_status, data?.taskStatus, output?.status, output?.task_status, output?.taskStatus]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const normalized = raw?.trim().toLowerCase().replace(/\s+/g, "_");
  if (!normalized) return undefined;
  if (["succeeded", "success", "completed", "complete", "done"].includes(normalized)) return "succeeded";
  if (["failed", "fail", "error", "expired"].includes(normalized)) return "failed";
  if (["cancelled", "canceled", "cancel"].includes(normalized)) return "cancelled";
  return normalized;
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;
}

function videoUrlFromField(value: unknown): string | undefined {
  const direct = httpUrl(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return httpUrl(record.url) ?? httpUrl(record.uri);
}

function scanVideoUrl(value: unknown, depth = 0): string | undefined {
  if (!value || depth > 8) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scanVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (/^(video_url|videoUrl|video|url)$/i.test(key)) {
      const direct = videoUrlFromField(item);
      if (direct) return direct;
      const nested = scanVideoUrl(item, depth + 1);
      if (nested) return nested;
    }
  }
  for (const key of ["output", "result", "data", "content"]) {
    const nested = scanVideoUrl(record[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

function seedanceVideoUrl(payload: unknown): string | undefined {
  return scanVideoUrl(payload);
}

export const mockProvider: AigcMaterialProvider = {
  id: "deterministic_local_image_fill",
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
        await writeFile(filePath, makeMockMaterialPng(720, 960, index + brief.id.length, brief.visualFormFamily));
      }
      candidates.push({
        id: `generated_${brief.slotId}_${String(index + 1).padStart(2, "0")}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        briefId: brief.id,
        slotId: brief.slotId,
        provider: "deterministic_local_image_fill",
        model: "deterministic_local_png_v1",
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
      let response: Response | undefined;
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        response = await fetchImpl(imageGenerationUrl(config), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(seedreamRequestBody(config, prompt))
        });
        if (response.ok || !retryableSeedreamStatus(response.status) || attempt >= config.maxRetries) break;
        await sleep(config.retryDelayMs * Math.max(1, attempt + 1));
      }
      if (!response?.ok) {
        const responseText = response ? await response.text().catch(() => "") : "";
        throw new Error(seedreamErrorMessage(response?.status ?? "unknown", responseText));
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

export const seedanceVideoProvider: AigcMaterialProvider = {
  id: "seedance_2_0",
  kind: "video",
  async generate(brief, context) {
    if (brief.assetType !== "short_video") {
      throw new Error(`seedance_2_0 only supports short_video generation; got ${brief.assetType}.`);
    }
    if (brief.privacyPolicy.sampleFramesAllowedToProvider) {
      throw new Error("seedance_2_0 refuses briefs that allow sample frames to be sent externally.");
    }
    if (context.allowExternalProviderCall !== true) {
      throw new Error("seedance_2_0 requires explicit external-provider opt-in.");
    }
    await mkdir(context.outputDir, { recursive: true });
    const config = resolveSeedanceProviderConfig(context.env, brief);
    const fetchImpl = context.fetchImpl ?? fetch;
    const generatedAt = context.now ?? new Date().toISOString();
    const count = maxCandidateCount(brief);
    const candidates: GeneratedAssetCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const prompt = seedancePrompt(brief, brief.promptPack?.[index] ?? brief.promptPack?.[0] ?? `${brief.visualFormFamily} generated video material`);
      const createResponse = await fetchImpl(seedanceTaskUrl(config), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(seedanceRequestBody(config, prompt))
      });
      if (!createResponse.ok) {
        const responseText = await createResponse.text().catch(() => "");
        throw new Error(providerErrorMessage("seedance_2_0", "video task creation", createResponse.status, responseText));
      }
      const created = await createResponse.json();
      const taskId = seedanceTaskId(created);
      if (!taskId) throw new Error("seedance_2_0 create task response did not include id.");

      let task: unknown = created;
      for (let poll = 0; poll < config.maxPolls; poll += 1) {
        const status = seedanceStatus(task);
        if (status === "succeeded") break;
        if (status === "failed" || status === "cancelled" || status === "canceled") {
          throw new Error(`seedance_2_0 task ${taskId} failed: ${sanitizeSeedreamErrorText(JSON.stringify(task)).slice(0, 500)}`);
        }
        await sleep(config.pollIntervalMs);
        const getResponse = await fetchImpl(seedanceTaskUrl(config, taskId), {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          }
        });
        if (!getResponse.ok) {
          const responseText = await getResponse.text().catch(() => "");
          throw new Error(providerErrorMessage("seedance_2_0", "task polling", getResponse.status, responseText));
        }
        task = await getResponse.json();
      }
      if (seedanceStatus(task) !== "succeeded") {
        throw new Error(`seedance_2_0 task ${taskId} did not succeed after ${config.maxPolls} polls.`);
      }
      const remoteUrl = seedanceVideoUrl(task);
      if (!remoteUrl) throw new Error(`seedance_2_0 task ${taskId} succeeded but did not include an output video_url.`);
      const videoResponse = await fetchImpl(remoteUrl);
      if (!videoResponse.ok) throw new Error(`seedance_2_0 video download failed with HTTP ${videoResponse.status}.`);
      const fileBuffer = Buffer.from(await videoResponse.arrayBuffer());
      const filename = `${brief.slotId}_${brief.assetType}_${String(index + 1).padStart(2, "0")}_seedance.mp4`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const filePath = path.join(context.outputDir, filename);
      await writeFile(filePath, fileBuffer);
      candidates.push({
        id: `generated_${brief.slotId}_${String(index + 1).padStart(2, "0")}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        briefId: brief.id,
        slotId: brief.slotId,
        provider: "seedance_2_0",
        model: config.model,
        type: "video",
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

interface GeminiImageConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxRetries: number;
  retryDelayMs: number;
}

/** Redact any leaked Google API key (AIza…) from a provider error string. */
function redactGoogleKey(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_-]{10,}/g, "AIza***");
}

export function resolveGeminiImageConfig(env?: Record<string, string | undefined>): GeminiImageConfig {
  const e = env ?? process.env;
  const apiKey = e.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for google_gemini_image.");
  const model = e.GEMINI_IMAGE_MODEL ?? e.AIGC_IMAGE_MODEL ?? "gemini-3.1-flash-image";
  const baseUrl = (e.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  return { apiKey, model, baseUrl, maxRetries: 2, retryDelayMs: 1200 };
}

/**
 * Google Gemini native image generation (Nano Banana, default gemini-2.5-flash-image) via the
 * AI Studio Gemini API. Primary AIGC image provider; uses the same GEMINI_API_KEY as the VLM but
 * is a SEPARATE request (text-only prompt → inlineData image). Sample frames are never sent.
 */
export const googleGeminiImageProvider: AigcMaterialProvider = {
  id: "google_gemini_image",
  kind: "image",
  async generate(brief, context) {
    if (brief.assetType === "copy" || brief.assetType === "short_video") {
      throw new Error(`google_gemini_image only supports image generation; got ${brief.assetType}.`);
    }
    if (brief.privacyPolicy.sampleFramesAllowedToProvider) {
      throw new Error("google_gemini_image refuses briefs that allow sample frames to be sent externally.");
    }
    if (context.allowExternalProviderCall !== true) {
      throw new Error("google_gemini_image requires explicit external-provider opt-in.");
    }
    await mkdir(context.outputDir, { recursive: true });
    const config = resolveGeminiImageConfig(context.env);
    const fetchImpl = context.fetchImpl ?? fetch;
    const generatedAt = context.now ?? new Date().toISOString();
    const count = maxCandidateCount(brief);
    const url = `${config.baseUrl}/models/${config.model}:generateContent`;
    const candidates: GeneratedAssetCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const prompt = brief.promptPack?.[index] ?? brief.promptPack?.[0] ?? `${brief.visualFormFamily} generated material`;
      const negative = brief.negativePrompts.join("; ");
      const fullPrompt = negative ? `${prompt}\n\nDo NOT include: ${negative}` : prompt;
      let response: Response | undefined;
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
          })
        });
        if (response.ok || ![429, 500, 503].includes(response.status) || attempt >= config.maxRetries) break;
        await sleep(config.retryDelayMs * Math.max(1, attempt + 1));
      }
      if (!response?.ok) {
        const text = response ? await response.text().catch(() => "") : "";
        throw new Error(`google_gemini_image generation failed with HTTP ${response?.status ?? "unknown"}: ${redactGoogleKey(text).slice(0, 200)}`);
      }
      const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p) => p.inlineData?.data);
      if (!imgPart?.inlineData?.data) throw new Error("google_gemini_image response did not include an inlineData image part.");
      const mime = imgPart.inlineData.mimeType ?? "image/png";
      const extension = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
      const fileBuffer = Buffer.from(imgPart.inlineData.data, "base64");
      const filename = `${brief.slotId}_${brief.assetType}_${String(index + 1).padStart(2, "0")}_gemini.${extension}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const filePath = path.join(context.outputDir, filename);
      await writeFile(filePath, fileBuffer);
      candidates.push({
        id: `generated_${brief.slotId}_${String(index + 1).padStart(2, "0")}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        briefId: brief.id,
        slotId: brief.slotId,
        provider: "google_gemini_image",
        model: config.model,
        type: "image",
        materialRole: "aigc_generated_material",
        path: candidatePath(context.publicPathPrefix, filename),
        prompt,
        negativePrompt: negative,
        provenance: {
          generatedAt,
          userApproved: false,
          externalProviderUsed: true,
          sampleFramesSentExternally: false,
          targetAssetsSentExternally: false
        },
        quality: { usable: undefined, issues: [] }
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
  deterministic_local_image_fill: mockProvider,
  mock_provider: mockProvider,
  google_gemini_image: googleGeminiImageProvider,
  local_folder_provider: disabledProvider("local_folder_provider"),
  volcengine_seedream: volcengineSeedreamProvider,
  seedance_2_0: seedanceVideoProvider,
  ark_seedance_provider_stub: seedanceVideoProvider,
  image_provider: disabledProvider("image_provider"),
  copy_provider: disabledProvider("copy_provider"),
  none: disabledProvider("none")
};

export function normalizeAigcMaterialProviderId(id: AigcMaterialProviderId = "deterministic_local_image_fill"): {
  id: AigcMaterialProviderId;
  warning?: string;
} {
  if (id === "mock_provider") {
    return {
      id: "deterministic_local_image_fill",
      warning: "mock_provider is deprecated; use deterministic_local_image_fill. It is deterministic local generation, not fake output."
    };
  }
  if (id === "ark_seedance_provider_stub") {
    return {
      id: "seedance_2_0",
      warning: "ark_seedance_provider_stub is deprecated; use seedance_2_0 for the real Ark Seedance task API."
    };
  }
  return { id };
}

export function getAigcMaterialProvider(id: AigcMaterialProviderId = "deterministic_local_image_fill"): AigcMaterialProvider {
  return AIGC_MATERIAL_PROVIDER_REGISTRY[id] ?? mockProvider;
}
