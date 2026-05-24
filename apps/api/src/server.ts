import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildFallbackTemplate,
  generateMigrationResult,
  nowIso,
  parsePromptToBrief,
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
  type ExampleAnalysis,
  type GenerationRequest,
  type GenerationResult,
  type Job,
  type JobStep,
  type JobStatus,
  type JobType,
  type KnowledgeAtom,
  type Project,
  type RenderOutput,
  type RendererTarget,
  type SourcePolicy,
  type StructureTemplate,
  type TemplateRecord,
  type Vertical,
  type VideoAnalysisResult,
  type VLMShotInsight,
  type VLMVideoAnalysis
} from "@vvst/shared";
import { buildAdapterSet, type AdapterSet } from "./adapters/index.js";
import { selectRenderer, type AssetPathResolver } from "./adapters/renderers.js";
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
const RENDERER_TARGETS: RendererTarget[] = ["mock_preview", "html_preview", "ffmpeg", "remotion", "hyperframes"];

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

function createJob(projectId: string | undefined, type: JobType, inputSummary: Record<string, unknown>, stepNames: string[]): Job {
  const timestamp = nowIso();
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
  return { ...job, steps, progress, status: overallStatus, updatedAt: timestamp };
}

function completeJob(job: Job, outputRefs: Record<string, unknown>): Job {
  const steps = job.steps.map((step) => (step.status === "queued" || step.status === "running" ? { ...step, status: "completed" as const } : step));
  return { ...job, steps, progress: 100, status: "completed", outputRefs, updatedAt: nowIso() };
}

function failJob(job: Job, error: unknown): Job {
  const timestamp = nowIso();
  return {
    ...job,
    status: "failed",
    progress: Math.max(job.progress, 50),
    error: { message: error instanceof Error ? error.message : String(error) },
    steps: job.steps.map((step) => (step.status === "queued" || step.status === "running" ? { ...step, status: "failed" as const, message: error instanceof Error ? error.message : String(error) } : step)),
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
  const analyzer = mode === "mock" || (mode === "auto" && process.env.VIDEO_TOOL === "mock") ? "mock" : adapters.videoTool.name;
  let analysis: VideoAnalysisResult;
  if (analyzer === "mock") {
    analysis = await new (await import("./adapters/index.js")).MockVideoToolAdapter().analyze(asset, project.id, purpose, {
      durationHintSec: toNumber(body?.durationSec, project.targetDurationSec),
      width: toNumber(body?.width, project.aspectRatio === "9:16" ? 720 : 1280),
      height: toNumber(body?.height, project.aspectRatio === "9:16" ? 1280 : 720),
      fps: toNumber(body?.fps, 30)
    });
  } else {
    try {
      analysis = await adapters.videoTool.analyze(asset, project.id, purpose, {
        durationHintSec: toNumber(body?.durationSec, project.targetDurationSec),
        width: toNumber(body?.width, undefined as unknown as number),
        height: toNumber(body?.height, undefined as unknown as number),
        fps: toNumber(body?.fps, undefined as unknown as number)
      });
    } catch (error) {
      // Auto-fallback to mock if real analyzer fails.
      job = advanceJob(job, "metadata_extraction", "completed", `analyzer fallback: ${(error as Error).message}`);
      const fallback = new (await import("./adapters/index.js")).MockVideoToolAdapter();
      analysis = await fallback.analyze(asset, project.id, purpose, {
        durationHintSec: toNumber(body?.durationSec, project.targetDurationSec)
      });
    }
  }
  job = advanceJob(job, "metadata_extraction", "completed");
  job = advanceJob(job, "keyframe_or_shot_split", "completed");

  let vlmResult: VLMVideoAnalysis | undefined;
  if (adapters.vlmAdapter.available && adapters.vlmAdapter.describeVideo && asset.path) {
    try {
      vlmResult = await adapters.vlmAdapter.describeVideo(asset, { purpose });
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

function selectTemplateForGeneration(db: Database, request: GenerationRequest): TemplateRecord {
  const projectTemplates = db.templates.filter((template) => template.projectId === request.projectId);
  const selectedId = request.selectedTemplateIds?.[0];
  if (selectedId) {
    return assertFound(projectTemplates.find((template) => template.id === selectedId), "Selected template");
  }
  const verticalCandidate = [...projectTemplates].reverse().find((template) => template.vertical === request.target.vertical);
  return assertFound(verticalCandidate ?? projectTemplates.at(-1), "Template for project");
}

function buildAssetResolver(db: Database): AssetPathResolver {
  return {
    resolve(assetId: string) {
      return db.assets.find((asset) => asset.id === assetId)?.path;
    }
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

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
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const project = typeof req.body.projectId === "string"
      ? assertFound(db.projects.find((item) => item.id === req.body.projectId), "Project")
      : {
          id: stableId("project", "demo", nowIso()),
          name: "Demo Structure Transfer Project",
          vertical: "b2b_marketing_mg" as Vertical,
          aspectRatio: "9:16" as AspectRatio,
          targetDurationSec: toNumber(req.body.durationSec, 15),
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
    const asset: Asset = {
      id: stableId("asset", project.id, "example", req.body.sampleName ?? "sample"),
      projectId: project.id,
      role: "example_video",
      type: "video",
      filename: String(req.body.sampleName ?? "sample-description.mp4"),
      text: String(req.body.description ?? "Mock sample video description"),
      mimeType: "video/mp4",
      sourcePolicy: "demo_only",
      metadata: { mock: true },
      tags: ["example"],
      status: "ready",
      createdAt: nowIso()
    };
    const { job, analysis, templateRecord, vlm } = await runAnalysisJob(asset, project, "sample", "mock", req.body);
    await store.update((draft) => {
      if (!draft.projects.some((item) => item.id === project.id)) draft.projects.push(project);
      if (!draft.assets.some((item) => item.id === asset.id)) draft.assets.push(asset);
      draft.jobs.push(job);
      draft.analyses = draft.analyses.filter((item) => !(item.assetId === asset.id && item.purpose === "sample"));
      draft.analyses.push({
        id: analysis.id,
        projectId: project.id,
        assetId: asset.id,
        purpose: "sample",
        video: analysis,
        template: templateRecord?.template,
        vlm,
        createdAt: nowIso()
      });
      if (templateRecord) {
        draft.templates = draft.templates.filter((item) => item.id !== templateRecord.id);
        draft.templates.push(templateRecord);
        draft.atoms = draft.atoms.filter((atom) => atom.templateId !== templateRecord.id);
        draft.atoms.push(...templateRecord.template.structureAtoms);
      }
    });
    ok(res, { project, asset, jobId: job.id, analysisId: analysis.id, status: job.status, analysis, template: templateRecord?.template }, 201);
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

async function runGeneration(
  db: Database,
  request: GenerationRequest,
  options: { variantLabel?: string; analyzerMode?: AnalyzerMode | "auto" } = {}
): Promise<RunGenerationOutcome> {
  assertFound(db.projects.find((project) => project.id === request.projectId), "Project");
  const templateRecord = selectTemplateForGeneration(db, request);
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
      sourceVlm
    });
    if (options.variantLabel) {
      const variantId = stableId("generation", request.projectId, request.prompt, options.variantLabel);
      generation = {
        ...generation,
        id: variantId,
        timeline: { ...generation.timeline, generationId: variantId },
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
    const reviser = adapters.aiAdapter.reviseInstruction;
    const llmResult = reviser
      ? await reviser({ generationId: generation.id, instruction })
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

interface ScorecardOut {
  generationId: string;
  overall: number;
  dimensions: ScorecardDimensionOut[];
  rationale: string;
  judge: "heuristic" | "llm" | "llm+heuristic";
  warnings?: string[];
}

function clamp01(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
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
    judge: "heuristic"
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
    judge: "llm+heuristic"
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
      const renderer = selectRenderer(target, {
        generatedDir,
        assetResolver: buildAssetResolver(db),
        remotionEntryPoint,
        remotionCompositionId
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
