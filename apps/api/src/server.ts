import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  checkGeneratedMaterials,
  createMaterialGenerationBriefs,
  buildFallbackTemplate,
  generateMigrationResult,
  getAigcMaterialProvider,
  fileTimestamp,
  nowIso,
  parsePromptToBrief,
  sanitizeNameToken,
  stableId,
  validateAssetAnalysis,
  validateGenerationRequest,
  validateStructureTemplate,
  type AnalysisPurpose,
  type AnalyzerMode,
  type AspectRatio,
  type Asset,
  type AssetRole,
  type AssetType,
  type AigcMaterialProviderId,
  type ExampleAnalysis,
  type GeneratedAssetCandidate,
  type GeneratedAssetQualityResult,
  type GenerationRequest,
  type GenerationResult,
  type Job,
  type JobStep,
  type JobStatus,
  type JobType,
  type KnowledgeAtom,
  type MaterialGenerationBrief,
  type Project,
  type RenderOutput,
  type RendererTarget,
  type SlotReplacementBinding,
  type SourcePolicy,
  type StructureTemplate,
  type TargetAssetInput,
  type TargetAssetKind,
  type TemplateRecord,
  type Vertical,
  type VideoAnalysisResult,
  type VLMShotInsight,
  type VLMVideoAnalysis
} from "@vvst/shared";
import { buildAdapterSet, type AdapterSet } from "./adapters/index.js";
import { selectRenderer, type AssetPathResolver } from "./adapters/renderers.js";
import { analyzeEvidenceTimeline, bindAnalysisTextToEvidence } from "./adapters/evidenceTimeline.js";
import { buildDatabaseStore, type Database, emptyDatabase as makeEmptyDatabase } from "./storage/index.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const emptyDatabase = makeEmptyDatabase;

const VERTICALS: Vertical[] = ["b2b_marketing_mg", "vlog", "talking_head", "beat_cut", "short_drama", "ecommerce"];
const ASPECT_RATIOS: AspectRatio[] = ["9:16", "16:9", "1:1"];
const ASSET_ROLES: AssetRole[] = [
  "example_video",
  "source_video",
  "user_image",
  "user_text",
  "generated_card",
  "generated_background",
  "render_output"
];
const SOURCE_POLICIES: SourcePolicy[] = ["user_authorized", "open_download_or_user_uploaded", "demo_only", "unknown"];
const RENDERER_TARGETS: RendererTarget[] = ["html_preview", "ffmpeg", "remotion", "hyperframes"];
const AIGC_PROVIDER_IDS = new Set<AigcMaterialProviderId>([
  "mock_provider",
  "google_gemini_image",
  "local_folder_provider",
  "volcengine_seedream",
  "ark_seedance_provider_stub",
  "image_provider",
  "copy_provider",
  "none"
]);
const EXTERNAL_AIGC_PROVIDERS = new Set<AigcMaterialProviderId>(["google_gemini_image", "volcengine_seedream", "ark_seedance_provider_stub", "image_provider"]);

const repoRoot =
  path.basename(process.cwd()) === "api" && path.basename(path.dirname(process.cwd())) === "apps"
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
const storageRoot = path.resolve(repoRoot, process.env.STORAGE_DIR ?? "storage");
const uploadDir = path.join(storageRoot, "uploads");
const generatedDir = path.join(storageRoot, "generated");
const dbDir = path.join(storageRoot, "db");

async function ensureStorageDirs(): Promise<void> {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.mkdir(dbDir, { recursive: true });
  await fs.mkdir(path.join(storageRoot, "demo"), { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runSeedDemoIfNeeded(): Promise<void> {
  const backend = (process.env.STORAGE_BACKEND ?? "json").toLowerCase();
  const shouldSeed = backend === "json" && process.env.VVST_NO_LISTEN !== "true";
  if (!shouldSeed) return;
  const appJson = path.join(dbDir, "app.json");
  if (await fileExists(appJson)) return;
  await ensureStorageDirs();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "seed-demo.mjs")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STORAGE_DIR: path.relative(repoRoot, storageRoot),
        CONDA_BASE: process.env.CONDA_BASE ?? "/home/pxli/anaconda3",
        VIRAL_CONDA_ENV: process.env.VIRAL_CONDA_ENV ?? "viral"
      },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`seed-demo exited with code ${code}`));
    });
  });
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

await ensureStorageDirs();
await runSeedDemoIfNeeded();
const store = await buildDatabaseStore({ backend: process.env.STORAGE_BACKEND, storageRoot });
const adapters: AdapterSet = buildAdapterSet(process.env, generatedDir);

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const TEXT_EXTS = new Set([".txt", ".md", ".json"]);

const upload = multer({
  dest: path.join(uploadDir, "tmp"),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = file.mimetype || "";
    const acceptedByMime =
      mime.startsWith("video/") || mime.startsWith("image/") || mime.startsWith("audio/") || mime === "text/plain";
    const acceptedByExt = VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext) || AUDIO_EXTS.has(ext) || TEXT_EXTS.has(ext);
    if (acceptedByMime || acceptedByExt) {
      callback(null, true);
      return;
    }
    callback(new Error(`Unsupported file type (mime=${mime}, ext=${ext}). Upload video, image, audio or text assets.`));
  }
});

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ ok: true, data });
}

function fail(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json({ ok: false, error: { code, message, details } });
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function assertFound<T>(value: T | undefined, label: string): T {
  if (!value) throw new HttpError(404, "NOT_FOUND", `${label} not found`);
  return value;
}

/** Compact, timestamped server log. Set VVST_LOG=quiet to silence stage logs. */
function logStage(scope: string, message: string): void {
  if (process.env.VVST_LOG === "quiet") return;
  const t = new Date().toISOString().slice(11, 23);
  console.log(`[${t}] [${scope}] ${message}`);
}

function createJob(projectId: string | undefined, type: JobType, inputSummary: Record<string, unknown>, stepNames: string[]): Job {
  const timestamp = nowIso();
  logStage(`job:${type}`, `▶ start · steps=[${stepNames.join(", ")}] · ${JSON.stringify(inputSummary).slice(0, 160)}`);
  return {
    id: stableId("job", projectId ?? "global", type, JSON.stringify(inputSummary), timestamp),
    projectId,
    type,
    status: "queued",
    progress: 0,
    steps: stepNames.map((name) => ({ name, status: "queued" })),
    inputSummary,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function advanceJob(job: Job, stepName: string, status: JobStep["status"], message?: string): Job {
  const timestamp = nowIso();
  const steps = job.steps.map((step) =>
    step.name === stepName ? { ...step, status, message: message ?? step.message } : step
  );
  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const progress = Math.round((completedSteps / Math.max(steps.length, 1)) * 100);
  const overallStatus: JobStatus = steps.every((step) => step.status === "completed")
    ? "completed"
    : steps.some((step) => step.status === "failed")
      ? "failed"
      : "running";
  const icon = status === "completed" ? "✓" : status === "failed" ? "✗" : status === "skipped" ? "⤼" : "…";
  logStage(`job:${job.type}`, `${icon} ${stepName} → ${status}${message ? ` · ${message}` : ""} [${progress}%]`);
  return { ...job, steps, progress, status: overallStatus, updatedAt: timestamp };
}

function completeJob(job: Job, outputRefs: Record<string, unknown>): Job {
  logStage(`job:${job.type}`, `✓ completed · ${JSON.stringify(outputRefs).slice(0, 160)}`);
  const steps = job.steps.map((step) => (step.status === "queued" || step.status === "running" ? { ...step, status: "completed" as const } : step));
  return { ...job, steps, progress: 100, status: "completed", outputRefs, updatedAt: nowIso() };
}

function failJob(job: Job, error: unknown): Job {
  const timestamp = nowIso();
  const msg = error instanceof Error ? error.message : String(error);
  logStage(`job:${job.type}`, `✗ FAILED · ${msg}`);
  return {
    ...job,
    status: "failed",
    progress: Math.max(job.progress, 50),
    error: { message: msg },
    steps: job.steps.map((step) => (step.status === "queued" || step.status === "running" ? { ...step, status: "failed" as const, message: msg } : step)),
    updatedAt: timestamp
  };
}

const PURPOSE_TAG_MAP: Record<string, string[]> = {
  hook: ["hook_candidate"],
  setup: ["background"],
  body: ["product_like", "usage_scene"],
  proof: ["comparison_candidate"],
  transition: ["background"],
  cta: ["cta_candidate"]
};

function tagsForVlmShot(insight: VLMShotInsight): string[] {
  const tags = new Set<string>();
  if (insight.purpose) {
    for (const tag of PURPOSE_TAG_MAP[insight.purpose] ?? []) tags.add(tag);
  }
  const visual = (insight.visual ?? "").toLowerCase();
  if (/product|商品|close.?up|detail|物品|样品/.test(visual)) tags.add("product_like");
  if (/usage|use|using|scene|场景|how to|demo|手持/.test(visual)) tags.add("usage_scene");
  if (/compare|comparison|before|after|对比|对照|vs/.test(visual)) tags.add("comparison_candidate");
  if (/person|people|user|hand|手|人|model|presenter/.test(visual)) tags.add("person_scene");
  if (/text|title|subtitle|card|文字|字幕|标题/.test(visual)) tags.add("text_card_candidate");
  if (/cta|click|buy|learn|action|结尾|引导/.test(visual)) tags.add("cta_candidate");
  if (insight.overlayStyle && insight.overlayStyle !== "none") tags.add("text_card_candidate");
  return Array.from(tags);
}

function mergeVlmIntoAnalysis(analysis: VideoAnalysisResult, vlm: VLMVideoAnalysis): VideoAnalysisResult {
  const insights = vlm.shots ?? [];
  const shots = analysis.shots.map((shot) => {
    const overlap = insights.find((insight) => insight.end > shot.startSec && insight.start < shot.endSec);
    if (!overlap) return shot;
    const blendedTags = new Set<string>(shot.tags);
    for (const tag of tagsForVlmShot(overlap)) blendedTags.add(tag);
    const note = [shot.notes, overlap.visual ? `VLM: ${overlap.visual}` : null].filter(Boolean).join(" | ");
    return {
      ...shot,
      tags: Array.from(blendedTags),
      notes: note || shot.notes
    };
  });
  const keyframes = analysis.keyframes.map((frame) => {
    const overlap = insights.find((insight) => insight.end >= frame.timeSec && insight.start <= frame.timeSec);
    if (!overlap) return frame;
    const tags = new Set<string>(frame.tags ?? []);
    for (const tag of tagsForVlmShot(overlap)) tags.add(tag);
    return {
      ...frame,
      tags: Array.from(tags),
      description: overlap.visual || frame.description
    };
  });
  return {
    ...analysis,
    shots,
    keyframes,
    analyzerMode: analysis.analyzerMode === "mock" ? "mock" : "ffmpeg_vlm_asr",
    warnings: [...analysis.warnings, ...(vlm.shots.length === 0 ? ["VLM returned no shots"] : [])]
  };
}

function inferAssetType(file: Express.Multer.File | undefined, bodyType: unknown): AssetType {
  if (bodyType === "video" || bodyType === "image" || bodyType === "text" || bodyType === "audio") return bodyType;
  if (!file) return "text";
  const mime = file.mimetype || "";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "text";
}

async function createAssetFromRequest(req: Request, projectId: string, file?: Express.Multer.File): Promise<Asset> {
  const type = inferAssetType(file, req.body.type);
  const role = pickEnum<AssetRole>(
    req.body.role ?? (type === "video" ? "source_video" : type === "image" ? "user_image" : "user_text"),
    ASSET_ROLES,
    "user_text"
  );
  const filename = file?.originalname ?? String(req.body.originalName ?? req.body.filename ?? `${role}.${type === "video" ? "mp4" : "txt"}`);
  const id = stableId("asset", projectId, role, filename, req.body.text ?? nowIso());
  let savedPath: string | undefined;

  if (file) {
    const extension = path.extname(filename) || "";
    savedPath = path.join(uploadDir, projectId, `${id}${extension}`);
    await fs.mkdir(path.dirname(savedPath), { recursive: true });
    await fs.rename(file.path, savedPath);
  }

  return {
    id,
    projectId,
    role,
    type,
    filename,
    path: savedPath,
    mimeType: file?.mimetype ?? (type === "text" ? "text/plain" : undefined),
    sourcePolicy: pickEnum<SourcePolicy>(req.body.sourcePolicy ?? "user_authorized", SOURCE_POLICIES, "user_authorized"),
    text: typeof req.body.text === "string" ? req.body.text : undefined,
    metadata: file ? { size: file.size, mimetype: file.mimetype } : {},
    tags: parseTags(req.body.tags),
    status: "ready",
    createdAt: nowIso()
  };
}

function targetKindForReplacementAsset(asset: Asset): TargetAssetKind {
  const haystack = [asset.role, asset.filename, ...(asset.tags ?? [])].join(" ").toLowerCase();
  if (/logo|brand|标识|品牌/.test(haystack)) return "logo";
  if (/cta|action|引导|行动/.test(haystack)) return "cta_info";
  if (asset.type === "video") return "video";
  if (asset.type === "text") return "copy";
  return "image";
}

const MANAGED_ASSET_REF_PREFIX = "asset://managed/";
const TARGET_MATERIAL_MANIFEST_SCHEMA = "target-material-manifest-v1";
const TARGET_MATERIAL_FAMILIES = new Set(["media_cards", "ui_showcase", "kinetic_typography", "brand_cta", "live_action_montage", "object_motion"]);
const VISUAL_TARGET_KINDS = new Set<TargetAssetKind>(["image", "video", "logo", "background_image"]);

function targetFamilyForManifestRole(role: unknown, kind: unknown): string {
  const value = String(role ?? "").toLowerCase();
  if (/media[_\s-]?card|media_cards|card/.test(value)) return "media_cards";
  if (/brand[_\s-]?logo|brand_cta|logo/.test(value) || kind === "logo") return "brand_cta";
  if (/feature[_\s-]?copy|feature[_\s-]?list|ui_showcase|copy_list/.test(value)) return "ui_showcase";
  if (/kinetic[_\s-]?copy|kinetic_typography|headline/.test(value)) return "kinetic_typography";
  if (/montage|live_action/.test(value)) return "live_action_montage";
  if (/object|hero|product/.test(value)) return "object_motion";
  return value || "unknown";
}

function targetKindForManifestEntry(entry: Record<string, unknown>, asset?: Asset): TargetAssetKind {
  const kind = String(entry.kind ?? "").toLowerCase();
  if (kind === "image" || kind === "video" || kind === "logo" || kind === "copy" || kind === "cta_info" || kind === "background_image") {
    return kind as TargetAssetKind;
  }
  if (asset) return targetKindForReplacementAsset(asset);
  return entry.text ? "copy" : "image";
}

function tagsForManagedTargetAsset(family: string, entry: Record<string, unknown>, asset?: Asset): string[] {
  const rawTags = Array.isArray(entry.tags)
    ? entry.tags.map(String)
    : typeof entry.tags === "string"
      ? parseTags(entry.tags)
      : [];
  const tags = new Set(["target_material", "managed_upload", family, ...rawTags, ...(asset?.tags ?? [])]);
  if (family === "media_cards") {
    tags.add("card");
    tags.add("image_set");
  }
  if (family === "ui_showcase") {
    tags.add("feature_list");
    tags.add("copy_list");
  }
  if (family === "kinetic_typography") tags.add("copy");
  if (family === "brand_cta") {
    tags.add("brand");
    tags.add("logo");
  }
  return Array.from(tags);
}

async function managedAssetSize(asset: Asset): Promise<number> {
  if (!asset.path) return 0;
  try {
    const info = await fs.stat(asset.path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

type ImageDecodeResult =
  | { decodeStatus: "ok"; width: number; height: number; codec: string }
  | { decodeStatus: "failed"; reason: string };

function decodeJpegDimensions(buffer: Buffer): ImageDecodeResult {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return { decodeStatus: "failed", reason: "invalid_jpeg_segment_length" };
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        decodeStatus: "ok",
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        codec: "jpeg"
      };
    }
    offset += 2 + length;
  }
  return { decodeStatus: "failed", reason: "jpeg_dimensions_not_found" };
}

async function decodeImageAsset(asset: Asset): Promise<ImageDecodeResult> {
  if (!asset.path) return { decodeStatus: "failed", reason: "missing_path" };
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(asset.path);
  } catch {
    return { decodeStatus: "failed", reason: "file_not_readable" };
  }
  if (buffer.length < 10) return { decodeStatus: "failed", reason: "file_too_small" };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") {
      return { decodeStatus: "failed", reason: "invalid_png_header" };
    }
    return {
      decodeStatus: "ok",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      codec: "png"
    };
  }
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return {
      decodeStatus: "ok",
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
      codec: "gif"
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return decodeJpegDimensions(buffer);
  if (buffer.toString("ascii", 0, 2) === "BM" && buffer.length >= 26) {
    return {
      decodeStatus: "ok",
      width: Math.abs(buffer.readInt32LE(18)),
      height: Math.abs(buffer.readInt32LE(22)),
      codec: "bmp"
    };
  }
  return { decodeStatus: "failed", reason: "unsupported_or_invalid_image_header" };
}

async function normalizeManagedTargetAsset(params: {
  projectId: string;
  entry: Record<string, unknown>;
  asset?: Asset;
  brandName?: string;
  cta?: string;
  features?: string[];
}): Promise<{ targetAsset?: TargetAssetInput; evidence?: Record<string, unknown>; blocked?: Record<string, unknown> }> {
  const { projectId, entry, asset, brandName, cta, features } = params;
  const assetId = typeof entry.assetId === "string" ? entry.assetId : undefined;
  const family = targetFamilyForManifestRole(entry.role, entry.kind);
  const kind = targetKindForManifestEntry(entry, asset);
  const baseBlocked = {
    assetId: assetId ?? null,
    kind,
    role: entry.role ?? null,
    status: "blocked"
  };
  if (entry.path || entry.url) {
    return { blocked: { ...baseBlocked, reason: "external_path_not_allowed; upload material through /api/projects/:projectId/assets first" } };
  }
  if (!assetId || !asset) {
    return { blocked: { ...baseBlocked, reason: "asset_id_missing_or_not_found" } };
  }
  if (asset.projectId !== projectId) {
    return { blocked: { ...baseBlocked, reason: "asset_project_mismatch" } };
  }
  if (!TARGET_MATERIAL_FAMILIES.has(family)) {
    return { blocked: { ...baseBlocked, reason: `unsupported_or_wrong_role:${entry.role ?? "missing"}` } };
  }
  if (asset.status !== "ready") {
    return { blocked: { ...baseBlocked, reason: `asset_not_ready:${asset.status}` } };
  }
  if (VISUAL_TARGET_KINDS.has(kind)) {
    const expectedType = kind === "video" ? "video" : "image";
    if (asset.type !== expectedType) {
      return { blocked: { ...baseBlocked, reason: `asset_type_mismatch:${asset.type}` } };
    }
    const size = await managedAssetSize(asset);
    if (!asset.path || size <= 0) {
      return { blocked: { ...baseBlocked, reason: "visual_asset_not_renderable_or_empty" } };
    }
    if (expectedType === "image") {
      const decoded = await decodeImageAsset(asset);
      if (decoded.decodeStatus !== "ok" || decoded.width <= 0 || decoded.height <= 0) {
        return { blocked: { ...baseBlocked, reason: "image_decode_failed", decodeStatus: decoded } };
      }
    }
  } else if (kind === "copy" || kind === "cta_info") {
    const text = typeof entry.text === "string" ? entry.text : asset.text;
    if (!text?.trim() && asset.type !== "text") {
      return { blocked: { ...baseBlocked, reason: "copy_asset_has_no_text" } };
    }
  }

  const text = typeof entry.text === "string" ? entry.text : asset.text;
  const imageDecode = VISUAL_TARGET_KINDS.has(kind) && asset.type === "image" ? await decodeImageAsset(asset) : undefined;
  const dimensions = imageDecode?.decodeStatus === "ok"
    ? { width: imageDecode.width, height: imageDecode.height, codec: imageDecode.codec }
    : undefined;
  const targetAsset: TargetAssetInput = {
    id: asset.id,
    kind,
    role: family,
    path: VISUAL_TARGET_KINDS.has(kind) ? `${MANAGED_ASSET_REF_PREFIX}${asset.id}` : undefined,
    text: text?.trim() || undefined,
    filename: asset.filename,
    mimeType: asset.mimeType,
    tags: tagsForManagedTargetAsset(family, entry, asset),
    metadata: {
      materialRole: "target_material",
      source: "managed_upload",
      managedAssetRef: `${MANAGED_ASSET_REF_PREFIX}${asset.id}`,
      manifestRole: entry.role,
      brandName,
      cta,
      features: family === "ui_showcase" ? features : undefined,
      dimensions,
      decodeStatus: imageDecode?.decodeStatus
    }
  };
  return {
    targetAsset,
    evidence: {
      assetId: asset.id,
      type: kind,
      role: family,
      materialRole: "target_material",
      path: targetAsset.path,
      text: targetAsset.text,
      filename: asset.filename,
      mimeType: asset.mimeType,
      renderable: Boolean(targetAsset.path || targetAsset.text),
      dimensions,
      decodeStatus: imageDecode?.decodeStatus ?? (VISUAL_TARGET_KINDS.has(kind) ? "not_checked" : "not_required"),
      tags: targetAsset.tags,
      source: "managed_upload"
    }
  };
}

/** Compact, model-readable summary of the deterministic evidence timeline for VLM grounding. */
function summarizeEvidenceForPrompt(ev: import("@vvst/shared").VisualEvidenceTimeline): string {
  const fam = new Map<string, number>();
  for (const shot of ev.shots) fam.set(String(shot.family), (fam.get(String(shot.family)) ?? 0) + 1);
  const families = [...fam.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(", ");
  const fast = (ev.stats.fastZones ?? []).slice(0, 5).map(([a, b]) => `${a}-${b}s`).join(", ");
  const ocrSamples = ev.shots.flatMap((s) => s.ocrText ?? []).filter(Boolean).slice(0, 8);
  return [
    `- duration: ${ev.durationSec}s, hasAudio: ${ev.hasAudio}`,
    `- scene cuts: ${ev.sceneCuts.length} (cutDensity ${ev.stats.cutDensity ?? "n/a"}/s, avgShot ${ev.stats.avgShotDurationSec ?? "n/a"}s, medianShot ${ev.stats.medianShotDurationSec ?? "n/a"}s)`,
    `- audio beat grid: ${ev.beatGrid.status === "ok" ? `${ev.beatGrid.bpm} BPM, ${ev.beatGrid.beats.length} beats` : ev.beatGrid.status}`,
    `- black-background ratio: ${ev.stats.blackBgRatio ?? "n/a"}, text-card density: ${ev.stats.textCardDensity ?? "n/a"}`,
    `- dominant palette: ${(ev.stats.dominantPalette ?? []).join(", ")}`,
    `- shot families (deterministic): ${families}`,
    fast ? `- fast-cut zones: ${fast}` : "",
    ocrSamples.length ? `- on-screen text (OCR): ${ocrSamples.join(" | ")}` : "",
    `Hint: fast cuts + audio beats + dark background + montage strongly indicate video_type="beat_cut".`
  ].filter(Boolean).join("\n");
}

async function runAnalysisJob(asset: Asset, project: Project, purpose: AnalysisPurpose, mode: AnalyzerMode | "auto", body: Request["body"]): Promise<{ job: Job; analysis: VideoAnalysisResult; templateRecord?: TemplateRecord; vlm?: VLMVideoAnalysis }> {
  let job = createJob(project.id, "analysis", { assetId: asset.id, purpose, mode }, [
    "metadata_extraction",
    "keyframe_or_shot_split",
    "vlm_video_understanding",
    "asr_transcript",
    "ocr_keyframe_text",
    "structure_extraction"
  ]);

  job = { ...job, status: "running", progress: 5, updatedAt: nowIso() };
  const analyzer = adapters.videoTool.name;
  let analysis: VideoAnalysisResult;
  {
    // No mock fallback: a real analyzer failure must surface (mock adapters removed).
    analysis = await adapters.videoTool.analyze(asset, project.id, purpose, {
      durationHintSec: toNumber(body?.durationSec, project.targetDurationSec),
      width: toNumber(body?.width, undefined as unknown as number),
      height: toNumber(body?.height, undefined as unknown as number),
      fps: toNumber(body?.fps, undefined as unknown as number)
    });
  }
  // Thread the original uploaded filename so templates/KB/render names are human-readable.
  analysis = { ...analysis, sourceFilename: asset.filename };
  job = advanceJob(job, "metadata_extraction", "completed");
  job = advanceJob(job, "keyframe_or_shot_split", "completed");

  // Evidence-first analyzer runs BEFORE the VLM so the model is grounded in deterministic
  // signals (scene cuts + beat grid + dark-bg/family stats) rather than free-form guessing.
  let evidenceContext: string | undefined;
  if (analyzer !== "mock" && asset.path) {
    try {
      const evidence = await analyzeEvidenceTimeline(asset, { generatedDir });
      if (evidence) {
        analysis = { ...analysis, evidenceTimeline: evidence };
        evidenceContext = summarizeEvidenceForPrompt(evidence);
        job = advanceJob(job, "metadata_extraction", "completed", `evidence: ${evidence.shots.length} shots, ${evidence.beatGrid.beats.length} beats, bpm=${evidence.beatGrid.bpm ?? "n/a"}, blackBg=${evidence.stats.blackBgRatio ?? "n/a"}`);
      }
    } catch (error) {
      analysis = { ...analysis, warnings: [...analysis.warnings, `Evidence analyzer failure: ${(error as Error).message}`] };
    }
  }

  let vlmResult: VLMVideoAnalysis | undefined;
  if (adapters.vlmAdapter.available && adapters.vlmAdapter.describeVideo && asset.path) {
    try {
      vlmResult = await adapters.vlmAdapter.describeVideo(asset, { purpose, evidenceContext });
      analysis = mergeVlmIntoAnalysis(analysis, vlmResult);
      job = advanceJob(job, "vlm_video_understanding", "completed", `vlm=${adapters.vlmAdapter.name}`);
    } catch (error) {
      job = advanceJob(job, "vlm_video_understanding", "failed", (error as Error).message);
      analysis = {
        ...analysis,
        warnings: [...analysis.warnings, `VLM failure: ${(error as Error).message}`]
      };
    }
  } else {
    job = advanceJob(job, "vlm_video_understanding", "skipped", adapters.vlmAdapter.name);
  }

  // ASR: transcribe the source audio if an ASR adapter is wired and the file is available.
  if (adapters.asrAdapter.available && asset.path) {
    try {
      const transcript = await adapters.asrAdapter.transcribe(asset);
      if (transcript.length > 0) {
        analysis = { ...analysis, transcript };
        job = advanceJob(job, "asr_transcript", "completed", `${adapters.asrAdapter.name} ${transcript.length} segs`);
      } else {
        job = advanceJob(job, "asr_transcript", "skipped", `${adapters.asrAdapter.name} returned empty`);
      }
    } catch (error) {
      job = advanceJob(job, "asr_transcript", "failed", (error as Error).message);
      analysis = { ...analysis, warnings: [...analysis.warnings, `ASR failure: ${(error as Error).message}`] };
    }
  } else {
    job = advanceJob(job, "asr_transcript", "skipped", adapters.asrAdapter.name);
  }

  // OCR: run on keyframes when an OCR adapter is wired and we have local keyframe paths.
  if (adapters.ocrAdapter.available) {
    const frames = analysis.keyframes
      .filter((kf): kf is typeof kf & { path: string } => typeof kf.path === "string" && !kf.path.startsWith("mock://"))
      .map((kf) => ({ path: kf.path!, timeSec: kf.timeSec }));
    if (frames.length > 0) {
      try {
        const ocrRows = await adapters.ocrAdapter.recognizeFrames(asset, frames);
        if (ocrRows.length > 0) {
          analysis = { ...analysis, ocr: ocrRows };
          job = advanceJob(job, "ocr_keyframe_text", "completed", `${adapters.ocrAdapter.name} ${ocrRows.length} frames`);
        } else {
          job = advanceJob(job, "ocr_keyframe_text", "skipped", `${adapters.ocrAdapter.name} returned empty`);
        }
      } catch (error) {
        job = advanceJob(job, "ocr_keyframe_text", "failed", (error as Error).message);
        analysis = { ...analysis, warnings: [...analysis.warnings, `OCR failure: ${(error as Error).message}`] };
      }
    } else {
      job = advanceJob(job, "ocr_keyframe_text", "skipped", "no local keyframe paths");
    }
  } else {
    job = advanceJob(job, "ocr_keyframe_text", "skipped", adapters.ocrAdapter.name);
  }

  // Bind the freshly-produced ASR transcript + OCR rows into the evidence-timeline shots
  // by timestamp overlap, so each shot carries its spoken/printed text for induction.
  if (analysis.evidenceTimeline) {
    analysis = { ...analysis, evidenceTimeline: bindAnalysisTextToEvidence(analysis.evidenceTimeline, analysis) };
  }

  const analysisValidation = validateAssetAnalysis(analysis);
  if (!analysisValidation.valid) {
    throw new HttpError(500, "VALIDATION_ERROR", "VideoAnalysisResult failed schema validation", analysisValidation.errors);
  }

  let templateRecord: TemplateRecord | undefined;
  if (purpose === "sample") {
    const template = await adapters.aiAdapter.extractStructure({
      analysis,
      projectId: project.id,
      vertical: project.vertical,
      vlm: vlmResult
    });
    const templateValidation = validateStructureTemplate(template);
    if (!templateValidation.valid) {
      throw new HttpError(500, "VALIDATION_ERROR", "StructureTemplate failed schema validation", templateValidation.errors);
    }
    templateRecord = {
      id: template.id,
      projectId: project.id,
      sourceAssetId: asset.id,
      sourceAssetFilename: asset.filename,
      name: template.name,
      vertical: template.vertical,
      template,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    job = advanceJob(job, "structure_extraction", "completed");
  } else {
    job = advanceJob(job, "structure_extraction", "skipped");
  }

  job = completeJob(job, { analysisId: analysis.id, templateId: templateRecord?.id, vlm: Boolean(vlmResult) });
  return { job, analysis, templateRecord, vlm: vlmResult };
}

function templateMatchesSample(record: TemplateRecord, sampleAssetId: string | undefined): boolean {
  if (!sampleAssetId) return false;
  return record.sourceAssetId === sampleAssetId || record.template.sourceSampleIds.includes(sampleAssetId);
}

function isSeedTemplate(record: TemplateRecord): boolean {
  return record.sourceAssetId.startsWith("demo_") || /seed|fallback/i.test(record.name);
}

/** Fraction of a template's slots (required + induced) that carry frame/timestamp evidence. */
function templateEvidenceCoverage(record: TemplateRecord): number {
  const slots = [...record.template.requiredSlots, ...(record.template.inducedSlots ?? [])];
  if (slots.length === 0) return 0;
  const withEvidence = slots.filter((slot) => {
    const ev = slot.sourceEvidence;
    return Boolean((ev?.frameIds?.length ?? 0) > 0 || ev?.timeRange);
  });
  return withEvidence.length / slots.length;
}

function isGenericB2BFallback(record: TemplateRecord): boolean {
  return /B2B MG Promo Structure/i.test(record.template.name) || record.template.aiEnrichmentStatus === "failed";
}

/**
 * Score a candidate template for a generation. Same-source-asset match dominates; an
 * evidence-backed, non-fallback, AI-enriched, videoType-matching template beats a stale
 * generic B2B scaffold. Index is a recency tiebreak (later templates score slightly higher).
 */
function scoreTemplate(record: TemplateRecord, request: GenerationRequest, index: number): number {
  let score = 0;
  if (templateMatchesSample(record, request.sampleReferenceAssetId)) score += 100;
  if (record.vertical === request.target.vertical) score += 8;
  if (!isSeedTemplate(record)) score += 20;
  score += templateEvidenceCoverage(record) * 20;
  const coverage = templateEvidenceCoverage(record);
  score += coverage > 0 ? 10 : -10;
  if (record.template.aiEnrichmentStatus === "ok") score += 10;
  else if (record.template.aiEnrichmentStatus === "failed") score += -15;
  if (isGenericB2BFallback(record)) score -= 12;
  score += index / 1000;
  return score;
}

function selectTemplateForGeneration(
  db: Database,
  request: GenerationRequest
): { record: TemplateRecord; reason: string; warning?: string } {
  const projectTemplates = db.templates.filter((template) => template.projectId === request.projectId);
  const selectedId = request.selectedTemplateIds?.[0];
  if (selectedId) {
    const record = assertFound(projectTemplates.find((template) => template.id === selectedId), "Selected template");
    return {
      record,
      reason: `explicit selectedTemplateIds picked ${record.id}; videoType=${record.template.videoType ?? "n/a"}; sourceAssetId=${record.sourceAssetId}.`,
      warning: isGenericB2BFallback(record) ? `Selected template ${record.id} is a generic/evidence-poor fallback.` : undefined
    };
  }

  if (projectTemplates.length === 0) {
    throw new HttpError(404, "NOT_FOUND", "Template for project not found");
  }

  const ranked = projectTemplates
    .map((record, index) => ({ record, score: scoreTemplate(record, request, index) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const record = best.record;
  const coverage = Math.round(templateEvidenceCoverage(record) * 100);
  const sampleMatched = templateMatchesSample(record, request.sampleReferenceAssetId);
  const fallbackPicked = isGenericB2BFallback(record) || isSeedTemplate(record);

  const reason = `scored selection picked ${record.id} (score=${best.score.toFixed(2)}); videoType=${record.template.videoType ?? "n/a"}; sampleMatch=${sampleMatched}; evidenceCoverage=${coverage}%; aiEnrichment=${record.template.aiEnrichmentStatus ?? "n/a"}; sourceAssetId=${record.sourceAssetId}.`;

  let warning: string | undefined;
  if (fallbackPicked) {
    warning = `Picked an evidence-poor/fallback template (${record.id}); no stronger evidence-backed template was available for this sample.`;
  } else if (request.sampleReferenceAssetId && !sampleMatched) {
    warning = `No template learned from the active sample (${request.sampleReferenceAssetId}); using the best-scoring template ${record.id} instead.`;
  } else if (record.template.aiEnrichmentStatus === "failed") {
    warning = `Template ${record.id} was built with a failed AI enrichment (${record.template.aiEnrichmentError ?? "unknown"}).`;
  }
  return { record, reason, warning };
}

function pathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveTargetAssetPath(targetAsset: TargetAssetInput): string | undefined {
  if (!targetAsset.path || /^https?:\/\//i.test(targetAsset.path)) return undefined;
  const absolute = path.isAbsolute(targetAsset.path)
    ? path.resolve(targetAsset.path)
    : path.resolve(repoRoot, targetAsset.path);
  const allowedRoots = [storageRoot, path.join(repoRoot, "docs", "fixtures")];
  return allowedRoots.some((root) => pathWithin(root, absolute)) ? absolute : undefined;
}

function buildAssetResolver(db: Database, generation?: GenerationResult): AssetPathResolver {
  const targetAssetsById = new Map((generation?.request.targetAssets ?? []).map((asset) => [asset.id, asset]));
  return {
    resolve(assetId: string) {
      const targetAsset = targetAssetsById.get(assetId);
      if (targetAsset) return resolveTargetAssetPath(targetAsset);
      const managedAsset = db.assets.find((asset) => asset.id === assetId);
      if (!managedAsset?.path) return undefined;
      if (managedAsset.role === "example_video" && generation?.request.constraints?.sampleAssetReuse !== "authorized") {
        return undefined;
      }
      return managedAsset.path;
    }
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));
// Request logger: method/path on entry, status + duration on finish (skip static + healthz noise).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/generated") || req.path === "/healthz") return next();
  const startedAt = Date.now();
  logStage("http", `→ ${req.method} ${req.path}`);
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    const icon = res.statusCode >= 500 ? "✗" : res.statusCode >= 400 ? "⚠" : "←";
    logStage("http", `${icon} ${req.method} ${req.path} ${res.statusCode} (${ms}ms)`);
  });
  next();
});
app.use("/generated", express.static(generatedDir));

app.get("/healthz", (_req, res) => {
  ok(res, {
    service: "vvst-api",
    spec: "1.2",
    mode: process.env.AI_PROVIDER ?? "mock",
    adapters: {
      videoTool: adapters.videoTool.name,
      ai: adapters.aiAdapter.name,
      asr: adapters.asrAdapter.name,
      ocr: adapters.ocrAdapter.name,
      vlm: adapters.vlmAdapter.name
    }
  });
});

app.get(
  "/readyz",
  asyncRoute(async (_req, res) => {
    await ensureStorageDirs();
    ok(res, { storageRoot });
  })
);

app.post(
  "/api/projects",
  asyncRoute(async (req, res) => {
    const project: Project = {
      id: stableId("project", req.body.name ?? "Demo Structure Transfer Project", nowIso()),
      name: String(req.body.name ?? "Demo Structure Transfer Project"),
      vertical: pickEnum<Vertical>(req.body.vertical, VERTICALS, "b2b_marketing_mg"),
      aspectRatio: pickEnum<AspectRatio>(req.body.aspectRatio, ASPECT_RATIOS, "9:16"),
      targetDurationSec: toNumber(req.body.targetDurationSec, 15),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.update((db) => {
      db.projects.push(project);
    });
    ok(res, project, 201);
  })
);

app.get(
  "/api/projects",
  asyncRoute(async (_req, res) => {
    const db = await store.read();
    ok(res, db.projects);
  })
);

app.get(
  "/api/projects/:projectId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const project = assertFound(db.projects.find((item) => item.id === req.params.projectId), "Project");
    ok(res, {
      ...project,
      assets: db.assets.filter((asset) => asset.projectId === project.id),
      analyses: db.analyses.filter((analysis) => analysis.projectId === project.id),
      templates: db.templates.filter((template) => template.projectId === project.id),
      generations: db.generations.filter((generation) => generation.projectId === project.id),
      renders: db.renders.filter((render) => db.generations.some((generation) => generation.id === render.generationId && generation.projectId === project.id))
    });
  })
);

app.post(
  "/api/projects/:projectId/assets",
  upload.single("file"),
  asyncRoute(async (req, res) => {
    const projectId = String(req.params.projectId);
    const db = await store.read();
    assertFound(db.projects.find((project) => project.id === projectId), "Project");
    const asset = await createAssetFromRequest(req, projectId, req.file);
    await store.update((draft) => {
      draft.assets.push(asset);
    });
    ok(res, asset, 201);
  })
);

app.get(
  "/api/projects/:projectId/assets",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    ok(res, db.assets.filter((asset) => asset.projectId === req.params.projectId));
  })
);

app.post(
  "/api/projects/:projectId/target-material-manifests",
  asyncRoute(async (req, res) => {
    const projectId = String(req.params.projectId);
    const db = await store.read();
    assertFound(db.projects.find((project) => project.id === projectId), "Project");
    const manifest = req.body ?? {};
    const entries = Array.isArray(manifest.assets) ? manifest.assets : [];
    const assetsById = new Map(db.assets.filter((asset) => asset.projectId === projectId).map((asset) => [asset.id, asset]));
    const brandName = typeof manifest.brandName === "string" ? manifest.brandName : undefined;
    const cta = typeof manifest.cta === "string" ? manifest.cta : undefined;
    const features = Array.isArray(manifest.features) ? manifest.features.map(String).filter(Boolean) : [];
    const targetAssets: TargetAssetInput[] = [];
    const assetEvidence: Record<string, unknown>[] = [];
    const blockedAssets: Record<string, unknown>[] = [];

    for (const rawEntry of entries) {
      const entry = rawEntry && typeof rawEntry === "object" ? rawEntry as Record<string, unknown> : {};
      const assetId = typeof entry.assetId === "string" ? entry.assetId : undefined;
      const normalized = await normalizeManagedTargetAsset({
        projectId,
        entry,
        asset: assetId ? assetsById.get(assetId) : undefined,
        brandName,
        cta,
        features
      });
      if (normalized.targetAsset) targetAssets.push(normalized.targetAsset);
      if (normalized.evidence) assetEvidence.push(normalized.evidence);
      if (normalized.blocked) blockedAssets.push(normalized.blocked);
    }

    if (!targetAssets.some((asset) => asset.role === "ui_showcase") && features.length) {
      targetAssets.push({
        id: stableId("target-feature-copy", projectId, features.join("|")),
        kind: "copy",
        role: "ui_showcase",
        text: features.join("\n"),
        filename: "manifest-feature-copy.txt",
        tags: ["target_material", "managed_manifest_copy", "ui_showcase", "feature_list", "copy_list"],
        metadata: { materialRole: "target_material", source: "manifest_copy", brandName, cta, features }
      });
    }
    if (!targetAssets.some((asset) => asset.role === "kinetic_typography") && brandName) {
      targetAssets.push({
        id: stableId("target-kinetic-copy", projectId, brandName),
        kind: "copy",
        role: "kinetic_typography",
        text: brandName,
        filename: "manifest-kinetic-copy.txt",
        tags: ["target_material", "managed_manifest_copy", "kinetic_typography", "copy"],
        metadata: { materialRole: "target_material", source: "manifest_copy", brandName, cta, features }
      });
    }

    ok(
      res,
      {
        schemaVersion: TARGET_MATERIAL_MANIFEST_SCHEMA,
        projectId,
        normalizedAt: nowIso(),
        brandName,
        cta,
        features,
        targetAssets,
        assetEvidence,
        blockedAssets,
        materialPolicy: {
          source: "managed_upload",
          externalPathsAllowed: false,
          sampleReferenceUse: "structure_evidence_only"
        }
      },
      201
    );
  })
);

app.get(
  "/api/assets/:assetId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    ok(res, assertFound(db.assets.find((asset) => asset.id === req.params.assetId), "Asset"));
  })
);

app.post(
  "/api/assets/:assetId/analyze",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const asset = assertFound(db.assets.find((item) => item.id === req.params.assetId), "Asset");
    const project = assertFound(db.projects.find((item) => item.id === asset.projectId), "Project");
    const purpose = req.body.purpose === "sample" || req.body.purpose === "source"
      ? (req.body.purpose as AnalysisPurpose)
      : asset.role === "example_video"
        ? "sample"
        : "source";
    const mode = (req.body.mode as AnalyzerMode | "auto" | undefined) ?? "auto";
    let { job, analysis, templateRecord, vlm } = await runAnalysisJob(asset, project, purpose, mode, req.body);

    const analysisRecord: ExampleAnalysis = {
      id: analysis.id,
      projectId: project.id,
      assetId: asset.id,
      purpose,
      video: analysis,
      template: templateRecord?.template,
      vlm,
      createdAt: nowIso()
    };

    await store.update((draft) => {
      draft.jobs.push(job);
      draft.analyses = draft.analyses.filter((item) => !(item.assetId === asset.id && item.purpose === purpose));
      draft.analyses.push(analysisRecord);
      if (templateRecord) {
        draft.templates = draft.templates.filter((item) => item.id !== templateRecord.id);
        draft.templates.push(templateRecord);
        draft.atoms = draft.atoms.filter((atom) => atom.templateId !== templateRecord!.id);
        draft.atoms.push(...templateRecord.template.structureAtoms);
      }
    });

    ok(res, { jobId: job.id, analysisId: analysis.id, status: job.status, analysis: analysisRecord, template: templateRecord?.template }, 201);
  })
);

app.post(
  "/api/samples/analyze",
  asyncRoute(async (_req, res) => {
    // This endpoint used to fabricate a text-only "mock" sample analysis (no real video).
    // Mock removed: a real video file is required. Upload it, then analyze it.
    fail(
      res,
      400,
      "MOCK_REMOVED",
      "Text-only sample analysis was removed (no mock). Upload a real video via POST /api/projects/:projectId/assets (field 'file', role 'example_video'), then POST /api/assets/:assetId/analyze."
    );
  })
);

app.get(
  "/api/assets/:assetId/analysis",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const purpose = req.query.purpose?.toString();
    const analysis = assertFound(
      [...db.analyses]
        .reverse()
        .find((item) => item.assetId === req.params.assetId && (!purpose || item.purpose === purpose)),
      "Analysis"
    );
    ok(res, analysis);
  })
);

app.post(
  "/api/templates/extract",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const projectId = String(req.body.projectId ?? "");
    const project = assertFound(db.projects.find((item) => item.id === projectId), "Project");
    const sampleAssetId = String(req.body.sampleAssetId ?? "");
    const sampleAsset = assertFound(db.assets.find((item) => item.id === sampleAssetId), "Sample asset");
    const analysisId = req.body.analysisId ? String(req.body.analysisId) : undefined;
    const analysisRecord = analysisId
      ? assertFound(db.analyses.find((item) => item.id === analysisId), "Analysis")
      : assertFound([...db.analyses].reverse().find((item) => item.assetId === sampleAsset.id && item.purpose === "sample"), "Sample analysis");

    const template = await adapters.aiAdapter.extractStructure({
      analysis: analysisRecord.video,
      projectId: project.id,
      vertical: project.vertical,
      vlm: analysisRecord.vlm
    });
    const validation = validateStructureTemplate(template);
    if (!validation.valid) {
      fail(res, 400, "VALIDATION_ERROR", "Generated StructureTemplate is invalid", validation.errors);
      return;
    }
    const record: TemplateRecord = {
      id: template.id,
      projectId: project.id,
      sourceAssetId: sampleAsset.id,
      name: template.name,
      vertical: template.vertical,
      template,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.update((draft) => {
      draft.templates = draft.templates.filter((item) => item.id !== record.id);
      draft.templates.push(record);
      draft.atoms = draft.atoms.filter((atom) => atom.templateId !== record.id);
      draft.atoms.push(...template.structureAtoms);
    });
    ok(res, record, 201);
  })
);

app.post(
  "/api/templates",
  asyncRoute(async (req, res) => {
    const body = req.body?.template ?? req.body;
    const validation = validateStructureTemplate(body);
    if (!validation.valid) {
      fail(res, 400, "VALIDATION_ERROR", "Invalid structure template", validation.errors);
      return;
    }
    const template = body as StructureTemplate;
    const record: TemplateRecord = {
      id: template.id,
      projectId: template.projectId,
      sourceAssetId: String(req.body.sourceAssetId ?? template.sourceSampleIds[0] ?? template.projectId),
      name: template.name,
      vertical: template.vertical,
      template,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.update((draft) => {
      draft.templates = draft.templates.filter((item) => item.id !== record.id);
      draft.templates.push(record);
      draft.atoms = draft.atoms.filter((atom) => atom.templateId !== record.id);
      draft.atoms.push(...template.structureAtoms);
    });
    ok(res, record, 201);
  })
);

app.get(
  "/api/templates",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const projectId = req.query.projectId?.toString();
    ok(res, projectId ? db.templates.filter((template) => template.projectId === projectId) : db.templates);
  })
);

app.get(
  "/api/templates/:templateId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    ok(res, assertFound(db.templates.find((item) => item.id === req.params.templateId), "Template"));
  })
);

app.get(
  "/api/templates/:templateId/export",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const record = assertFound(db.templates.find((item) => item.id === req.params.templateId), "Template");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${record.id}.json"`);
    res.send(JSON.stringify(record.template, null, 2));
  })
);

app.get(
  "/api/projects/:projectId/knowledge-base",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const vertical = req.query.vertical?.toString();
    const templates = db.templates.filter(
      (template) => template.projectId === req.params.projectId && (!vertical || template.vertical === vertical)
    );
    const atoms = db.atoms.filter((atom) => atom.projectId === req.params.projectId && (!vertical || templates.some((template) => template.id === atom.templateId)));
    const techniques = templates.flatMap((template) =>
      template.template.editingTechniques.map((technique) => ({
        ...technique,
        sourceTemplateId: template.id,
        vertical: template.vertical
      }))
    );
    ok(res, {
      projectId: req.params.projectId,
      templates,
      atoms,
      editingTechniques: techniques,
      counts: { templates: templates.length, atoms: atoms.length, techniques: techniques.length }
    });
  })
);

function filterAtoms(db: Database, projectId: string, role?: string, category?: string, vertical?: string) {
  return db.atoms.filter((atom) => {
    if (atom.projectId !== projectId) return false;
    if (role && atom.role !== role) return false;
    if (category && atom.category !== category) return false;
    if (vertical && !atom.applicableVerticals.includes(vertical)) return false;
    return true;
  });
}

app.get(
  "/api/projects/:projectId/knowledge-base/atoms",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const role = req.query.role?.toString();
    const category = req.query.category?.toString();
    const vertical = req.query.vertical?.toString();
    ok(res, filterAtoms(db, String(req.params.projectId), role, category, vertical));
  })
);

app.get(
  "/api/projects/:projectId/knowledge-base/atoms/export",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const projectId = String(req.params.projectId);
    const role = req.query.role?.toString();
    const category = req.query.category?.toString();
    const vertical = req.query.vertical?.toString();
    const atoms = filterAtoms(db, projectId, role, category, vertical);
    const filename = `atoms-${projectId}${role ? `-${role}` : ""}${category ? `-${category}` : ""}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify({ projectId, count: atoms.length, atoms }, null, 2));
  })
);

app.get(
  "/api/projects/:projectId/knowledge-base/export",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const projectId = String(req.params.projectId);
    const templates = db.templates.filter((t) => t.projectId === projectId).map((t) => t.template);
    const atoms = db.atoms.filter((a) => a.projectId === projectId);
    const techniques = templates.flatMap((t) =>
      t.editingTechniques.map((technique) => ({ ...technique, sourceTemplateId: t.id }))
    );
    const filename = `knowledge-base-${projectId}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify({ projectId, templates, atoms, editingTechniques: techniques }, null, 2));
  })
);

interface RunGenerationOutcome {
  generation: GenerationResult;
  job: Job;
  analysisRecord?: ExampleAnalysis;
  templateId: string;
}

function aigcProviderForRequest(request: GenerationRequest): AigcMaterialProviderId {
  if (request.controls?.allowExternalAigcProvider !== true) return "mock_provider";
  const requested = process.env.AIGC_IMAGE_PROVIDER as AigcMaterialProviderId | undefined;
  return requested && AIGC_PROVIDER_IDS.has(requested) ? requested : "mock_provider";
}

function sanitizeAigcProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/ark-[A-Za-z0-9-]+/g, "ark-***")
    .replace(/AIza[0-9A-Za-z_-]+/g, "AIza***")
    .replace(/account\s+\[[^\]]+\]/gi, "account [redacted]")
    .replace(/Request id:\s*[0-9A-Za-z_-]+/gi, "Request id: redacted")
    .replace(/GEMINI_API_KEY=[^\s]+/g, "GEMINI_API_KEY=***")
    .replace(/SEEDREAM_ARK_API_KEY=[^\s]+/g, "SEEDREAM_ARK_API_KEY=***")
    .slice(0, 500);
}

function targetAssetFromGeneratedCandidate(input: {
  candidate: GeneratedAssetCandidate;
  brief: MaterialGenerationBrief | undefined;
  quality: GeneratedAssetQualityResult | undefined;
}): TargetAssetInput {
  const family = input.brief?.visualFormFamily ?? "unknown";
  const assetType = input.brief?.assetType ?? input.candidate.type;
  return {
    id: input.candidate.id,
    kind: input.candidate.type === "video" ? "video" : input.candidate.type === "copy" ? "copy" : "image",
    role: family,
    path: input.candidate.type === "copy" ? undefined : input.candidate.path,
    text: input.candidate.type === "copy" ? input.candidate.prompt : undefined,
    filename: path.basename(input.candidate.path),
    tags: [
      "target_material",
      "aigc_generated_material",
      family,
      assetType,
      ...(family === "media_cards" ? ["media_card", "card"] : []),
      ...(family === "brand_cta" ? ["logo_placeholder", "cta"] : [])
    ],
    metadata: {
      materialRole: "aigc_generated_material",
      provider: input.candidate.provider,
      model: input.candidate.model,
      briefId: input.candidate.briefId,
      slotId: input.candidate.slotId,
      generatedAssetType: assetType,
      quality: input.quality,
      provenance: input.candidate.provenance
    }
  };
}

async function reviewGeneratedMaterialWithVlm(input: {
  brief: MaterialGenerationBrief;
  candidate: GeneratedAssetCandidate;
  filePath: string;
}): Promise<{ usable: boolean; slotFitScore: number; targetThemeFitScore: number; noSampleCopyScore: number; textArtifactRisk: number; issues: string[] }> {
  if (!adapters.vlmAdapter.available) {
    throw new Error("VLM adapter is not configured");
  }
  const review = await adapters.vlmAdapter.describeFrames([{ path: input.filePath, timeSec: 0 }]);
  const description = review[0]?.description ?? "";
  const tags = review[0]?.tags ?? [];
  const hasWatermarkRisk = /watermark|logo|platform|douyin|tiktok|抖音|水印/i.test(description);
  return {
    usable: review.length > 0 && !hasWatermarkRisk,
    slotFitScore: tags.length ? 0.86 : 0.78,
    targetThemeFitScore: 0.8,
    noSampleCopyScore: input.candidate.provenance.sampleFramesSentExternally ? 0 : 0.96,
    textArtifactRisk: /text|caption|文字|字幕/i.test(description) ? 0.22 : 0.08,
    issues: hasWatermarkRisk ? ["VLM review found possible watermark/platform mark"] : []
  };
}

async function applyAigcMaterialFill(input: {
  template: StructureTemplate;
  request: GenerationRequest;
  sourceAsset?: Asset;
  sourceAnalysis?: VideoAnalysisResult;
  sourceVlm?: VLMVideoAnalysis;
  selectedTemplateReason?: string;
  baseGeneration: GenerationResult;
  generationIdSalt?: string;
}): Promise<GenerationResult> {
  if (input.request.controls?.allowAigcMaterialGeneration !== true) return input.baseGeneration;

  const providerId = aigcProviderForRequest(input.request);
  const externalProvider = EXTERNAL_AIGC_PROVIDERS.has(providerId);
  const provider = getAigcMaterialProvider(providerId);
  // Backup external provider (e.g. Ark/Seedream in China) — used ONLY if the primary external
  // provider fails. No mock fallback: if both fail, the error surfaces.
  const backupProviderId = process.env.AIGC_IMAGE_BACKUP_PROVIDER as AigcMaterialProviderId | undefined;
  const useBackup = Boolean(
    externalProvider &&
      backupProviderId &&
      backupProviderId !== providerId &&
      EXTERNAL_AIGC_PROVIDERS.has(backupProviderId) &&
      AIGC_PROVIDER_IDS.has(backupProviderId)
  );
  const backupProvider = useBackup && backupProviderId ? getAigcMaterialProvider(backupProviderId) : undefined;
  let usedProviderId: AigcMaterialProviderId = providerId;
  const briefs = createMaterialGenerationBriefs({
    gapReport: input.baseGeneration.gapReport,
    fillPlan: input.baseGeneration.fillPlan,
    request: input.request,
    targetAssets: input.request.targetAssets,
    config: {
      enabled: true,
      provider: providerId,
      maxAssetsPerRun: 8,
      allowExternalUpload: externalProvider && input.request.controls?.allowExternalAigcProvider === true,
      allowSampleFramesToProvider: false,
      requireUserApprovalBeforeRender: false,
      cacheEnabled: true
    }
  });

  const candidates: GeneratedAssetCandidate[] = [];
  const providerErrors: string[] = [];
  let providerFallbackReason: string | undefined;
  const outputDir = path.join(generatedDir, "aigc-materials", input.baseGeneration.id);
  const publicPathPrefix = path.relative(repoRoot, outputDir).replace(/\\/g, "/");
  await fs.mkdir(outputDir, { recursive: true });
  for (const brief of briefs) {
    try {
      const generated = await provider.generate(brief, {
        outputDir,
        publicPathPrefix,
        env: process.env,
        allowExternalProviderCall: externalProvider && input.request.controls?.allowExternalAigcProvider === true
      });
      candidates.push(...generated);
    } catch (error) {
      const reason = sanitizeAigcProviderError(error);
      providerErrors.push(`${providerId}: ${reason}`);
      // No mock fallback: surface the failure unless a real backup provider is configured.
      if (!backupProvider || !backupProviderId) throw error;
      try {
        const generated = await backupProvider.generate(brief, {
          outputDir,
          publicPathPrefix,
          env: process.env,
          allowExternalProviderCall: true
        });
        usedProviderId = backupProviderId;
        providerFallbackReason = `Primary AIGC provider ${providerId} failed (${reason}); used backup ${backupProviderId}.`;
        candidates.push(...generated);
      } catch (backupError) {
        const backupReason = sanitizeAigcProviderError(backupError);
        providerErrors.push(`${backupProviderId}: ${backupReason}`);
        throw new Error(`AIGC image generation failed on primary ${providerId} (${reason}) and backup ${backupProviderId} (${backupReason}).`);
      }
    }
  }

  const quality = await checkGeneratedMaterials({
    briefs,
    candidates,
    rootDir: repoRoot,
    vlmAvailable: adapters.vlmAdapter.available,
    vlmReview: adapters.vlmAdapter.available ? reviewGeneratedMaterialWithVlm : undefined
  });
  const briefById = new Map(briefs.map((brief) => [brief.id, brief]));
  const qualityById = new Map(quality.map((item) => [item.candidateId, item]));
  const reviewedCandidates = candidates.map((candidate) => {
    const result = qualityById.get(candidate.id);
    return {
      ...candidate,
      quality: {
        ...candidate.quality,
        usable: result?.usable ?? false,
        slotFitScore: result?.slotFitScore,
        noSampleCopyScore: result?.noSampleCopyScore,
        issues: result?.issues ?? []
      }
    };
  });
  const generatedTargetAssets = reviewedCandidates
    .filter((candidate) => qualityById.get(candidate.id)?.usable)
    .map((candidate) => targetAssetFromGeneratedCandidate({
      candidate,
      brief: briefById.get(candidate.briefId),
      quality: qualityById.get(candidate.id)
    }));

  const augmentedRequest: GenerationRequest = {
    ...input.request,
    targetAssets: [...(input.request.targetAssets ?? []), ...generatedTargetAssets]
  };
  const generation = generatedTargetAssets.length
    ? generateMigrationResult({
        template: input.template,
        request: augmentedRequest,
        sourceAsset: input.sourceAsset,
        sourceAnalysis: input.sourceAnalysis,
        sourceVlm: input.sourceVlm,
        generationIdSalt: input.generationIdSalt ? `${input.generationIdSalt}_aigc` : "aigc_material_fill",
        selectedTemplateReason: input.selectedTemplateReason
      })
    : input.baseGeneration;

  return {
    ...generation,
    request: augmentedRequest,
    warnings: [
      ...generation.warnings,
      ...(providerFallbackReason ? [providerFallbackReason] : []),
      briefs.length
        ? `AIGC material fill used ${usedProviderId}${providerFallbackReason ? " (backup)" : ""}; generated ${generatedTargetAssets.length}/${candidates.length} usable assets.`
        : "AIGC material fill was enabled, but no eligible missing visual slots produced generation briefs."
    ],
    aigcMaterialFill: {
      enabled: true,
      provider: usedProviderId,
      requestedProvider: providerId,
      providerFallbackReason,
      providerErrors,
      externalProviderUsed: reviewedCandidates.some((candidate) => candidate.provenance.externalProviderUsed),
      sampleFramesSentExternally: reviewedCandidates.some((candidate) => candidate.provenance.sampleFramesSentExternally),
      briefs,
      candidates: reviewedCandidates,
      quality,
      generatedTargetAssets
    }
  };
}

type SubtitleCue = {
  clipId: string;
  text: string;
  language: "zh" | "en";
  placement: "lower_third" | "center" | "none";
};

type SubtitleCapableAiAdapter = AdapterSet["aiAdapter"] & {
  generateSubtitles?: (input: { generation: GenerationResult; language: "zh" | "en" }) => Promise<SubtitleCue[]>;
};

function subtitleLanguageForPrompt(prompt: string): "zh" | "en" {
  const cjk = (prompt.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (prompt.match(/[A-Za-z]/g) ?? []).length;
  return cjk > 0 && cjk >= latin * 0.2 ? "zh" : "en";
}

function promptAllowsBilingual(prompt: string): boolean {
  return /bilingual|中英|双语|英文.*中文|中文.*英文/i.test(prompt);
}

function normalizeSubtitleText(text: string, language: "zh" | "en", allowBilingual: boolean): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact || allowBilingual) return compact;
  if (language === "zh") {
    return compact
      .replace(/\b[A-Za-z][A-Za-z\s-]{1,}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return compact.replace(/[\u3400-\u9fff]+/g, "").replace(/\s{2,}/g, " ").trim();
}

async function applySubtitleGeneration(generation: GenerationResult): Promise<GenerationResult> {
  const mode = generation.request.controls?.subtitleGenerationMode ?? "prompt_only";
  const language = subtitleLanguageForPrompt(generation.request.prompt);
  const allowBilingual = promptAllowsBilingual(generation.request.prompt);
  let cues: SubtitleCue[] = [];
  if (mode === "ark_doubao") {
    const ai = adapters.aiAdapter as SubtitleCapableAiAdapter;
    if (ai.available && ai.generateSubtitles) {
      try {
        cues = await ai.generateSubtitles({ generation, language });
      } catch (error) {
        generation = {
          ...generation,
          warnings: [...generation.warnings, `Ark Doubao subtitle generation failed: ${sanitizeAigcProviderError(error)}`]
        };
      }
    }
  }
  const cueByClipId = new Map(cues.map((cue) => [cue.clipId, cue]));
  const subtitleByClipId = new Map<string, string>();
  const clips = generation.timeline.clips.map((clip) => {
    const cue = cueByClipId.get(clip.id);
    const rawText = mode === "off" ? "" : (cue?.text ?? clip.subtitleText ?? "");
    const text = normalizeSubtitleText(rawText, language, allowBilingual);
    const baseLayers = clip.layers.filter((layer) => layer.kind !== "subtitle");
    const duplicateBaseText = baseLayers.some((layer) =>
      layer.kind === "base_visual" &&
      typeof layer.text === "string" &&
      normalizeSubtitleText(layer.text, language, allowBilingual) === text
    );
    const visualFormFamily = clip.visualFormFamily ?? String(baseLayers.find((layer) => layer.style?.visualFormFamily)?.style?.visualFormFamily ?? "");
    const placement = visualFormFamily === "kinetic_typography" ? "center" : "lower_third";
    const learnedSubtitleStyle = generation.timeline.renderPlan?.adapterOptions?.subtitleStyle;
    const learnedSubtitleSource = generation.timeline.renderPlan?.adapterOptions?.subtitleStyleSource;
    const subtitleLayer = mode !== "off" && text && !duplicateBaseText
      ? [{
          id: stableId("layer_subtitle", clip.id, text),
          kind: "subtitle" as const,
          text,
          style: {
            position: placement,
            density: generation.request.controls?.subtitleDensity ?? generation.timeline.renderPlan?.adapterOptions?.subtitleDensity ?? "medium",
            generatedBy: mode,
            learnedSubtitleStyle,
            learnedSubtitleSource,
            sampleTextCopied: false
          }
        }]
      : [];
    subtitleByClipId.set(clip.id, text);
    return {
      ...clip,
      subtitleText: text,
      layers: [...baseLayers, ...subtitleLayer]
    };
  });
  return {
    ...generation,
    timeline: {
      ...generation.timeline,
      clips
    },
    storyboard: generation.storyboard.map((item) => ({
      ...item,
      subtitle: subtitleByClipId.get(item.clipId) ?? item.subtitle
    }))
  };
}

async function runGeneration(
  db: Database,
  request: GenerationRequest,
  options: { variantLabel?: string; analyzerMode?: AnalyzerMode | "auto" } = {}
): Promise<RunGenerationOutcome> {
  assertFound(db.projects.find((project) => project.id === request.projectId), "Project");
  const templateSelection = selectTemplateForGeneration(db, request);
  const templateRecord = templateSelection.record;
  const sourceAsset = request.sourceVideo
    ? assertFound(db.assets.find((asset) => asset.id === request.sourceVideo?.assetId), "Source video")
    : undefined;
  let job = createJob(
    request.projectId,
    "generation",
    {
      inputMode: request.inputMode,
      templateId: templateRecord.id,
      prompt: request.prompt.slice(0, 120),
      variant: options.variantLabel
    },
    ["source_analysis", "slot_matching", "gap_fill", "timeline_generation", "schema_validation"]
  );
  job = { ...job, status: "running", progress: 5, updatedAt: nowIso() };

  let sourceAnalysis: VideoAnalysisResult | undefined;
  let sourceVlm: VLMVideoAnalysis | undefined;
  let analysisRecord: ExampleAnalysis | undefined;

  try {
    if (sourceAsset) {
      const existing = [...db.analyses]
        .reverse()
        .find((analysis) => analysis.assetId === sourceAsset.id && analysis.purpose === "source");
      if (existing) {
        sourceAnalysis = existing.video;
        sourceVlm = existing.vlm;
      } else {
        const purposeMode: AnalyzerMode | "auto" = options.analyzerMode ?? "auto";
        const project = db.projects.find((item) => item.id === request.projectId)!;
        const { analysis, vlm } = await runAnalysisJob(sourceAsset, project, "source", purposeMode, {});
        sourceAnalysis = analysis;
        sourceVlm = vlm;
        analysisRecord = {
          id: analysis.id,
          projectId: request.projectId,
          assetId: sourceAsset.id,
          purpose: "source",
          video: analysis,
          vlm,
          createdAt: nowIso()
        };
      }
    }
    job = advanceJob(job, "source_analysis", "completed");

    let generation = generateMigrationResult({
      template: templateRecord.template,
      request,
      sourceAsset,
      sourceAnalysis,
      sourceVlm,
      generationIdSalt: options.variantLabel,
      selectedTemplateReason: templateSelection.reason
    });
    generation = await applyAigcMaterialFill({
      template: templateRecord.template,
      request,
      sourceAsset,
      sourceAnalysis,
      sourceVlm,
      selectedTemplateReason: templateSelection.reason,
      baseGeneration: generation,
      generationIdSalt: options.variantLabel
    });
    generation = await applySubtitleGeneration(generation);
    if (templateSelection.warning) {
      generation = { ...generation, warnings: [`template_selection: ${templateSelection.warning}`, ...generation.warnings] };
    }
    if (options.variantLabel) {
      generation = {
        ...generation,
        migrationExplanation: `[${options.variantLabel}] ${generation.migrationExplanation}`,
        warnings: [`variant=${options.variantLabel}`, ...generation.warnings]
      };
    }
    job = advanceJob(job, "slot_matching", "completed");
    job = advanceJob(job, "gap_fill", "completed");
    job = advanceJob(job, "timeline_generation", "completed");
    job = advanceJob(job, "schema_validation", "completed");
    job = completeJob(job, { generationId: generation.id, timelineId: generation.timeline.id });
    return { generation, job, analysisRecord, templateId: templateRecord.id };
  } catch (error) {
    job = failJob(job, error);
    await store.update((draft) => {
      draft.jobs.push(job);
    });
    throw error;
  }
}

async function persistGenerationOutcome(outcome: RunGenerationOutcome): Promise<void> {
  await store.update((draft) => {
    if (outcome.analysisRecord) {
      draft.analyses = draft.analyses.filter(
        (item) => !(item.assetId === outcome.analysisRecord!.assetId && item.purpose === "source")
      );
      draft.analyses.push(outcome.analysisRecord);
    }
    draft.jobs.push(outcome.job);
    draft.generations = draft.generations.filter((item) => item.id !== outcome.generation.id);
    draft.generations.push(outcome.generation);
  });
}

async function handleGeneration(req: Request, res: Response): Promise<void> {
  const requestValidation = validateGenerationRequest(req.body);
  if (!requestValidation.valid) {
    fail(res, 400, "VALIDATION_ERROR", "Invalid generation request", requestValidation.errors);
    return;
  }
  const request = req.body as GenerationRequest;
  const db = await store.read();
  const outcome = await runGeneration(db, request, {
    analyzerMode: req.body.analyzerMode as AnalyzerMode | "auto" | undefined
  });
  await persistGenerationOutcome(outcome);
  ok(
    res,
    {
      generationId: outcome.generation.id,
      jobId: outcome.job.id,
      status: outcome.job.status,
      generation: outcome.generation
    },
    201
  );
}

app.post("/api/generations", asyncRoute(handleGeneration));
app.post("/api/generate", asyncRoute(handleGeneration));

app.get(
  "/api/generations/:generationId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    ok(res, assertFound(db.generations.find((generation) => generation.id === req.params.generationId), "Generation"));
  })
);

app.post(
  "/api/generations/:generationId/replacements",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(
      db.generations.find((item) => item.id === req.params.generationId),
      "Generation"
    );
    const slotId = String(req.body.slotId ?? "");
    const assetId = String(req.body.assetId ?? "");
    if (!slotId || !assetId) {
      fail(res, 400, "VALIDATION_ERROR", "slotId and assetId are required");
      return;
    }
    const slotExists =
      generation.replacementSlots?.some((slot) => slot.slotId === slotId) ||
      generation.slotMapping.some((mapping) => mapping.slotId === slotId) ||
      generation.gapReport.some((gap) => gap.slotId === slotId || gap.replacementSlotId === slotId || gap.gapType === slotId);
    if (!slotExists) {
      fail(res, 400, "VALIDATION_ERROR", `Slot ${slotId} does not exist on generation ${generation.id}`);
      return;
    }
    const asset = assertFound(db.assets.find((item) => item.id === assetId), "Replacement asset");
    if (asset.projectId !== generation.projectId) {
      fail(res, 403, "PROJECT_MISMATCH", "Replacement asset must belong to the same project as the generation");
      return;
    }
    if (!["image", "video", "text"].includes(asset.type)) {
      fail(res, 400, "VALIDATION_ERROR", "Replacement asset must be an image, video, GIF/image, logo/image, or text/copy asset");
      return;
    }

    const binding: SlotReplacementBinding = {
      slotId,
      assetId,
      applyMotionFromSlot: req.body.applyMotionFromSlot !== false,
      createdAt: nowIso()
    };
    const nextBindings = [
      ...(generation.request.replacementBindings ?? []).filter((item) => item.slotId !== slotId),
      binding
    ];
    const replacementTargetAsset = {
      id: asset.id,
      kind: targetKindForReplacementAsset(asset),
      role: `replacement:${slotId}`,
      filename: asset.filename,
      mimeType: asset.mimeType,
      text: asset.text,
      tags: Array.from(new Set([...(asset.tags ?? []), "slot_replacement", slotId])),
      metadata: {
        replacementSlotId: slotId,
        sourcePolicy: asset.sourcePolicy
      }
    };
    const nextTargetAssets = [
      ...(generation.request.targetAssets ?? []).filter((item) => item.id !== asset.id),
      replacementTargetAsset
    ];
    const nextRequest: GenerationRequest = {
      ...generation.request,
      targetAssets: nextTargetAssets,
      replacementBindings: nextBindings
    };
    const variantLabel = `replacement_${Date.now().toString(36)}`;
    const outcome = await runGeneration(db, nextRequest, { variantLabel });
    await persistGenerationOutcome(outcome);
    ok(
      res,
      {
        previousGenerationId: generation.id,
        generationId: outcome.generation.id,
        replacementSlot: outcome.generation.replacementSlots?.find((slot) => slot.slotId === slotId) ?? null,
        binding,
        generation: outcome.generation
      },
      201
    );
  })
);

app.post(
  "/api/generations/:generationId/revise",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(
      db.generations.find((item) => item.id === req.params.generationId),
      "Generation"
    );
    const instruction = String(req.body.instruction ?? "");
    if (!instruction) {
      fail(res, 400, "VALIDATION_ERROR", "instruction is required");
      return;
    }
    const dryRun = req.body.dryRun === true || req.query.dryRun === "true";
    const llmResult = adapters.aiAdapter.reviseInstruction
      ? await adapters.aiAdapter.reviseInstruction({ generationId: generation.id, instruction })
      : { summary: `(mock) revision noted: ${instruction}`, patchedControls: undefined, promptAddendum: undefined };

    if (dryRun || (!llmResult.patchedControls && !llmResult.promptAddendum)) {
      ok(res, {
        generationId: generation.id,
        instruction,
        summary: llmResult.summary,
        patchedControls: llmResult.patchedControls ?? {},
        promptAddendum: llmResult.promptAddendum ?? null,
        applied: false
      });
      return;
    }

    const baseRequest = generation.request;
    const nextRequest: GenerationRequest = {
      ...baseRequest,
      controls: {
        ...(baseRequest.controls ?? {}),
        ...(llmResult.patchedControls ?? {})
      },
      prompt: llmResult.promptAddendum
        ? `${baseRequest.prompt}\n[revise]: ${llmResult.promptAddendum}`
        : baseRequest.prompt
    };
    const variantLabel = `revise_${Date.now().toString(36)}`;
    const outcome = await runGeneration(db, nextRequest, { variantLabel });
    await persistGenerationOutcome(outcome);
    ok(res, {
      generationId: outcome.generation.id,
      previousGenerationId: generation.id,
      instruction,
      summary: llmResult.summary,
      patchedControls: llmResult.patchedControls ?? {},
      promptAddendum: llmResult.promptAddendum ?? null,
      applied: true,
      generation: outcome.generation
    });
  })
);

interface VariantSpec {
  label: string;
  displayName: string;
  strategy: string;
  controls: Partial<GenerationRequest["controls"]>;
  promptAddendum?: string;
}

const VARIANT_PRESETS: VariantSpec[] = [
  {
    label: "high_ctr",
    displayName: "高点击版",
    strategy: "更激进的 hook + 快节奏 + 强 CTA，前 3 秒抓注意力",
    controls: { hookIntensity: "aggressive", pace: "fast", ctaStyle: "direct", packagingStyle: "mg_motion" },
    promptAddendum: "请把最具吸引力的画面/卖点放在前 3 秒，并在结尾给出强 CTA。"
  },
  {
    label: "high_conversion",
    displayName: "高转化版",
    strategy: "商品特写多 + 利益点重复 + 直接 CTA",
    controls: { hookIntensity: "strong", pace: "medium", ctaStyle: "direct", packagingStyle: "bold" },
    promptAddendum: "请优先展示商品的核心卖点和使用场景，结尾重复利益点和 CTA。"
  },
  {
    label: "high_rhythm",
    displayName: "高节奏版",
    strategy: "短镜头 + 硬切转场 + 高密度字幕 + 紧凑结构",
    controls: { hookIntensity: "strong", pace: "fast", packagingStyle: "mg_motion", ctaStyle: "direct" },
    promptAddendum: "请保持高节奏：每个镜头 1.5 秒内，硬切转场，字幕密度高。"
  },
  {
    label: "high_quality",
    displayName: "高质感版",
    strategy: "节奏更慢 + 包装克制 + 留白构图 + 柔和 CTA",
    controls: { hookIntensity: "safe", pace: "slow", packagingStyle: "clean", ctaStyle: "soft" },
    promptAddendum: "请保留留白和呼吸感：节奏放慢、字幕减少、CTA 柔和但清晰。"
  }
];

function mutateRequestForVariant(base: GenerationRequest, variant: VariantSpec): GenerationRequest {
  return {
    ...base,
    controls: { ...(base.controls ?? {}), ...variant.controls },
    prompt: variant.promptAddendum ? `${base.prompt}\n[variant=${variant.label}]: ${variant.promptAddendum}` : base.prompt
  };
}

app.post(
  "/api/generations/:generationId/variants",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(
      db.generations.find((item) => item.id === req.params.generationId),
      "Generation"
    );
    const labels = req.body?.labels;
    const filter = Array.isArray(labels) ? new Set(labels.map(String)) : null;
    const presets = filter ? VARIANT_PRESETS.filter((v) => filter.has(v.label)) : VARIANT_PRESETS;
    if (presets.length === 0) {
      fail(res, 400, "VALIDATION_ERROR", "No matching variant labels");
      return;
    }
    const variants: Array<{
      label: string;
      displayName: string;
      strategy: string;
      generationId: string;
      generation: GenerationResult;
    }> = [];
    for (const preset of presets) {
      const nextRequest = mutateRequestForVariant(generation.request, preset);
      const outcome = await runGeneration(db, nextRequest, { variantLabel: preset.label });
      await persistGenerationOutcome(outcome);
      variants.push({
        label: preset.label,
        displayName: preset.displayName,
        strategy: preset.strategy,
        generationId: outcome.generation.id,
        generation: outcome.generation
      });
    }
    ok(res, { baseGenerationId: generation.id, count: variants.length, variants }, 201);
  })
);

interface ScorecardDimensionOut {
  name: string;
  score: number;
  comment: string;
}

interface EvaluatorGateOut {
  id: string;
  passed: boolean;
  value: number | boolean | string;
  comment: string;
}

interface ScorecardOut {
  generationId: string;
  overall: number;
  dimensions: ScorecardDimensionOut[];
  rationale: string;
  judge: "heuristic" | "llm" | "llm+heuristic";
  gates?: EvaluatorGateOut[];
  warnings?: string[];
}

function clamp01(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function replacementEvaluatorGates(generation: GenerationResult): EvaluatorGateOut[] {
  const slots = generation.replacementSlots ?? [];
  const unresolved = slots.filter((slot) => slot.status === "missing" || slot.status === "proxy_generated").length;
  const userReplaced = slots.filter((slot) => slot.status === "user_replaced" || slot.status === "rendered").length;
  const targetAssetCount = generation.request.targetAssets?.length ?? 0;
  const visualGaps = generation.gapReport.filter((gap) => gap.slotType && gap.slotType !== "subtitle_text" && gap.slotType !== "title_card");
  const sourceMapped = generation.slotMapping.filter((mapping) => mapping.assetAvailability === "source_video_mapped").length;
  const sampleReuseAuthorized = generation.request.constraints?.sampleAssetReuse === "authorized";
  const sourceIsMock = generation.sourceUnderstanding.materialRole === "mock";
  const proxyVisible = generation.timeline.clips.some(
    (clip) =>
      clip.gapFillStrategy === "proxy_placeholder" ||
      clip.layers.some((layer) => layer.style?.fillStrategy === "proxy_placeholder")
  );
  const replacementAssetIds = new Set(slots.map((slot) => slot.boundAssetId).filter(Boolean));
  const replacementRendered = generation.timeline.clips.some((clip) =>
    clip.layers.some((layer) => Boolean(layer.assetId && replacementAssetIds.has(layer.assetId)))
  );
  const motionPreserved = slots
    .filter((slot) => slot.boundAssetId)
    .every((slot) => slot.applyMotionFromSlot !== false && Boolean(slot.motionSpec));
  return [
    {
      id: "gap_detected_when_no_target_assets",
      passed: targetAssetCount > 0 || visualGaps.length > 0,
      value: visualGaps.length,
      comment: "When no target material is supplied, required visual slots should surface gaps instead of false matches."
    },
    {
      id: "sample_visual_not_reused_without_authorization",
      passed: sampleReuseAuthorized || sourceMapped === 0 || generation.sourceUnderstanding.reusableAsMaterial === true,
      value: sourceMapped,
      comment: "Reference/sample footage should not satisfy target visual slots unless reuse is explicitly authorized."
    },
    {
      id: "mock_asset_not_counted_as_match",
      passed: !sourceIsMock || sourceMapped === 0,
      value: sourceMapped,
      comment: "Mock assets and assets without renderable paths are evidence only."
    },
    {
      id: "interactive_gap_fill_non_empty",
      passed: visualGaps.length === 0 || slots.length > 0,
      value: slots.length,
      comment: "Visual/material gaps should produce click-to-replace replacement slots."
    },
    {
      id: "unresolved_placeholder_count",
      passed: unresolved === 0 || userReplaced === 0,
      value: unresolved,
      comment: userReplaced > 0 ? "All replaced showcase slots should avoid unresolved proxies." : "No user replacement was supplied; unresolved proxies are allowed but visible."
    },
    {
      id: "user_replaced_slot_count",
      passed: userReplaced > 0 || slots.length === 0,
      value: userReplaced,
      comment: "Counts slots bound through the replacement workflow."
    },
    {
      id: "proxy_slot_visible",
      passed: proxyVisible || slots.length === 0 || userReplaced > 0,
      value: proxyVisible,
      comment: "Proxy placeholders should be visible before a user supplies an asset."
    },
    {
      id: "replacement_asset_rendered",
      passed: replacementRendered || userReplaced === 0,
      value: replacementRendered,
      comment: "A bound replacement asset should appear in the generated timeline."
    },
    {
      id: "motion_preserved_after_replacement",
      passed: motionPreserved,
      value: motionPreserved,
      comment: "Replacement bindings preserve the original slot motion spec."
    }
  ];
}

function computeHeuristicScorecard(generation: GenerationResult): ScorecardOut {
  const mapping = generation.slotMapping;
  const matched = mapping.filter((m) => m.status === "matched").length;
  const weak = mapping.filter((m) => m.status === "weak_match").length;
  const missing = mapping.filter((m) => m.status === "missing").length;
  const total = Math.max(mapping.length, 1);

  const sourceClips = generation.timeline.clips.filter((clip) => clip.type === "video").length;
  const totalClips = Math.max(generation.timeline.clips.length, 1);
  const subtitledClips = generation.timeline.clips.filter((clip) => (clip.subtitleText ?? "").trim().length > 0).length;
  const rhythm = generation.timeline.durationSec / Math.max(totalClips, 1);
  const targetAvgShot = generation.request.controls?.pace === "slow" ? 3.2 : generation.request.controls?.pace === "medium" ? 2.4 : 1.8;
  const rhythmDelta = Math.abs(rhythm - targetAvgShot);

  const packagingSpec = generation.timeline.renderPlan?.background ? 1 : 0;
  const layerKinds = new Set(
    generation.timeline.clips.flatMap((clip) => clip.layers.map((layer) => layer.kind))
  );
  const packagingSignals = ["subtitle", "title_bar", "highlight"].filter((kind) => layerKinds.has(kind as any)).length;

  const hookScore = clamp01(
    50 +
      (mapping.find((m) => m.slotRole === "hook")?.status === "matched" ? 30 : 0) +
      (generation.request.controls?.hookIntensity === "aggressive" ? 15 : 5)
  );
  const clarityScore = clamp01(40 + (matched / total) * 50 + (subtitledClips / totalClips) * 10);
  const packagingScore = clamp01(40 + packagingSignals * 15 + packagingSpec * 10);
  const rhythmScore = clamp01(100 - rhythmDelta * 25);
  const ctaScore = clamp01(
    40 +
      (mapping.find((m) => m.slotRole === "cta")?.status === "matched" ? 35 : 0) +
      (generation.request.controls?.ctaStyle === "direct" ? 15 : 5) +
      (generation.gapReport.some((g) => g.slotId.includes("cta")) ? -20 : 5)
  );
  const dimensions: ScorecardDimensionOut[] = [
    { name: "hook", score: hookScore, comment: `hook slot ${mapping.find((m) => m.slotRole === "hook")?.status ?? "n/a"}` },
    { name: "clarity", score: clarityScore, comment: `${matched}/${total} slots matched, ${weak} weak, ${missing} missing` },
    { name: "packaging", score: packagingScore, comment: `${packagingSignals} packaging signals; background=${generation.timeline.renderPlan?.background}` },
    { name: "rhythm", score: rhythmScore, comment: `avg shot ${rhythm.toFixed(2)}s vs target ${targetAvgShot}s` },
    { name: "cta", score: ctaScore, comment: `cta style ${generation.request.controls?.ctaStyle ?? "n/a"}, ${sourceClips}/${totalClips} source-backed` }
  ];
  const overall = clamp01(
    dimensions.reduce((sum, dim) => sum + dim.score, 0) / dimensions.length
  );
  return {
    generationId: generation.id,
    overall,
    dimensions,
    rationale: `Heuristic scorecard: slot fill ${Math.round((matched / total) * 100)}%, source-backed clips ${sourceClips}/${totalClips}, avg shot ${rhythm.toFixed(2)}s.`,
    judge: "heuristic",
    gates: replacementEvaluatorGates(generation)
  };
}

function mergeScorecards(heuristic: ScorecardOut, llm: NonNullable<Awaited<ReturnType<NonNullable<typeof adapters.aiAdapter.judgeGeneration>>>>): ScorecardOut {
  const byName = new Map(llm.dimensions.map((d) => [d.name, d] as const));
  const dimensions = heuristic.dimensions.map((dim) => {
    const judge = byName.get(dim.name);
    if (!judge) return dim;
    return {
      name: dim.name,
      score: clamp01((dim.score + judge.score) / 2),
      comment: `H: ${dim.comment} | LLM: ${judge.comment}`
    };
  });
  const overall = clamp01((heuristic.overall + llm.overall) / 2);
  return {
    generationId: heuristic.generationId,
    overall,
    dimensions,
    rationale: `${heuristic.rationale} | LLM: ${llm.rationale}`,
    judge: "llm+heuristic",
    gates: heuristic.gates
  };
}

app.post(
  "/api/generations/:generationId/scorecard",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(
      db.generations.find((item) => item.id === req.params.generationId),
      "Generation"
    );
    const heuristic = computeHeuristicScorecard(generation);
    const skipLlm = req.body.skipLlm === true || req.query.skipLlm === "true";
    if (!skipLlm && adapters.aiAdapter.judgeGeneration) {
      try {
        const llm = await adapters.aiAdapter.judgeGeneration(generation);
        if (llm) {
          ok(res, mergeScorecards(heuristic, llm));
          return;
        }
      } catch (error) {
        ok(res, { ...heuristic, warnings: [`LLM judge failed: ${(error as Error).message}`] });
        return;
      }
    }
    ok(res, heuristic);
  })
);

app.get(
  "/api/generations/:generationId/export/timeline",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(db.generations.find((item) => item.id === req.params.generationId), "Generation");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${generation.timeline.id}.json"`);
    res.send(JSON.stringify(generation.timeline, null, 2));
  })
);

app.get(
  "/api/generations/:generationId/export/report",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(db.generations.find((item) => item.id === req.params.generationId), "Generation");
    const format = req.query.format?.toString() ?? "json";
    if (format === "markdown") {
      const brief = parsePromptToBrief(generation.request);
      const lines = [
        `# Generation Report ${generation.id}`,
        "",
        `- Vertical: ${generation.request.target.vertical}`,
        `- Aspect: ${generation.request.target.aspectRatio}`,
        `- Target duration: ${generation.request.target.targetDurationSec}s`,
        `- Selected atoms: ${generation.selectedAtoms.map((atom) => atom.name).join(", ")}`,
        "",
        "## Prompt brief",
        `- Product: ${brief.productName}`,
        `- Audience: ${brief.targetAudience}`,
        `- Selling points: ${brief.sellingPoints.join("; ")}`,
        `- CTA: ${brief.cta}`,
        "",
        "## Storyboard",
        ...generation.storyboard.map((shot) => `- [${shot.timeRange}] ${shot.subtitle} — ${shot.shotDescription} (${shot.assetUsage})`),
        "",
        `## Migration explanation`,
        generation.migrationExplanation
      ];
      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="${generation.id}.md"`);
      res.send(lines.join("\n"));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${generation.id}.json"`);
    res.send(JSON.stringify(generation, null, 2));
  })
);

app.post(
  "/api/generations/:generationId/render",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(db.generations.find((item) => item.id === req.params.generationId), "Generation");
    const target = pickEnum<RendererTarget>(req.body.rendererTarget ?? generation.timeline.rendererTarget, RENDERER_TARGETS, "html_preview");
    let job = createJob(generation.projectId, "render", { generationId: generation.id, target }, ["render"]);
    job = { ...job, status: "running", progress: 30, updatedAt: nowIso() };

    try {
      const remotionEntryPoint = process.env.REMOTION_ENTRY?.trim()
        ? process.env.REMOTION_ENTRY.trim()
        : path.resolve(repoRoot, "apps", "api", "remotion", "index.tsx");
      const remotionCompositionId = process.env.REMOTION_COMPOSITION_ID?.trim()
        ? process.env.REMOTION_COMPOSITION_ID.trim()
        : "ViralReconstruction";
      // User-facing output filename: theme_sampleName_timestamp (no random hash).
      const renderBrief = parsePromptToBrief(generation.request);
      const sampleAsset = generation.request.sampleReferenceAssetId
        ? db.assets.find((a) => a.id === generation.request.sampleReferenceAssetId)
        : undefined;
      const sampleName =
        sampleAsset?.filename ??
        db.templates.find((t) => generation.selectedTemplateIds.includes(t.id))?.sourceAssetFilename ??
        "sample";
      // Use just the first clause of the theme (split on common CN/EN separators) for a tidy filename.
      const themeRaw = (renderBrief.topic || generation.request.prompt).split(/[；;，,。:：\n]/).map((s) => s.trim()).find(Boolean) ?? "video";
      const themeToken = sanitizeNameToken(themeRaw, 24);
      const sampleToken = sanitizeNameToken(sampleName, 24);
      const outputBasename = `${themeToken}_${sampleToken}_${fileTimestamp(nowIso())}`;
      const renderer = selectRenderer(target, {
        generatedDir,
        assetResolver: buildAssetResolver(db, generation),
        remotionEntryPoint,
        remotionCompositionId,
        outputBasename
      });
      let output = await renderer.render({ ...generation.timeline, rendererTarget: target }, generation.id);
      if (target === "html_preview") {
        const renderPath = path.join(generatedDir, `${output.renderId}.html`);
        await fs.writeFile(renderPath, output.previewHtml ?? "", "utf8");
        output = { ...output, outputPath: renderPath };
      }
      job = advanceJob(job, "render", "completed");
      job = completeJob(job, { renderId: output.renderId, outputPath: output.outputPath });
      await store.update((draft) => {
        draft.jobs.push(job);
        draft.renders = draft.renders.filter((item) => item.renderId !== output.renderId);
        draft.renders.push(output);
      });
      ok(res, { jobId: job.id, renderId: output.renderId, status: output.status, render: output }, 201);
    } catch (error) {
      job = failJob(job, error);
      await store.update((draft) => {
        draft.jobs.push(job);
      });
      throw error;
    }
  })
);

app.get(
  "/api/renders/:renderId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    ok(res, assertFound(db.renders.find((render) => render.renderId === req.params.renderId), "Render"));
  })
);

app.get(
  "/api/jobs/:jobId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    ok(res, assertFound(db.jobs.find((job) => job.id === req.params.jobId), "Job"));
  })
);

app.use((error: Error & { status?: number; code?: string; details?: unknown }, _req: Request, res: Response, _next: NextFunction) => {
  const status = (error as HttpError).status ?? error.status ?? 500;
  const code = (error as HttpError).code ?? error.code ?? "INTERNAL_ERROR";
  fail(res, status, code, error.message, (error as HttpError).details ?? error.details);
});

export { app, store, adapters };

if (process.env.VVST_NO_LISTEN !== "true") {
  const port = Number(process.env.APP_PORT ?? 3000);
  await ensureStorageDirs();
  app.listen(port, () => {
    console.log(`VVST API v1.2 listening on http://localhost:${port}`);
    console.log(`Storage directory: ${storageRoot}`);
    console.log(
      `Adapters → video:${adapters.videoTool.name}, ai:${adapters.aiAdapter.name}, asr:${adapters.asrAdapter.name}, ocr:${adapters.ocrAdapter.name}, vlm:${adapters.vlmAdapter.name}, storage:${store.backendName}`
    );
  });
}
