import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HtmlPreviewRenderer } from "@vvst/renderer";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  nowIso,
  stableId,
  validateGenerationRequest,
  validateStructureTemplate,
  type AnalysisPurpose,
  type Asset,
  type AssetRole,
  type AssetType,
  type ExampleAnalysis,
  type GenerationRequest,
  type GenerationResult,
  type Job,
  type Project,
  type RenderOutput,
  type TemplateRecord,
  type Vertical,
  type VideoAnalysisResult
} from "@vvst/shared";

dotenv.config();

type Database = {
  projects: Project[];
  assets: Asset[];
  jobs: Job[];
  analyses: ExampleAnalysis[];
  templates: TemplateRecord[];
  generations: GenerationResult[];
  renders: RenderOutput[];
};

const emptyDatabase = (): Database => ({
  projects: [],
  assets: [],
  jobs: [],
  analyses: [],
  templates: [],
  generations: [],
  renders: []
});

const repoRoot =
  path.basename(process.cwd()) === "api" && path.basename(path.dirname(process.cwd())) === "apps"
    ? path.resolve(process.cwd(), "../..")
    : process.cwd();
const storageRoot = path.resolve(repoRoot, process.env.STORAGE_DIR ?? process.env.DATA_DIR ?? "storage");
const uploadDir = path.join(storageRoot, "uploads");
const generatedDir = path.join(storageRoot, "generated");
const dbDir = path.join(storageRoot, "db");
const dbPath = path.join(dbDir, "app.json");

async function ensureStorageDirs(): Promise<void> {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  await fs.mkdir(dbDir, { recursive: true });
  await fs.mkdir(path.join(storageRoot, "demo"), { recursive: true });
}

function normalizeProject(raw: any): Project {
  return {
    id: String(raw.id),
    name: String(raw.name ?? "Demo Structure Transfer Project"),
    vertical: (raw.vertical ?? "b2b_marketing_mg") as Vertical,
    aspectRatio: raw.aspectRatio === "16:9" || raw.aspectRatio === "1:1" || raw.aspectRatio === "4:5" ? raw.aspectRatio : "9:16",
    targetDurationSec: Number(raw.targetDurationSec ?? (raw.targetDurationMs ? raw.targetDurationMs / 1000 : 15)),
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso())
  };
}

function normalizeAsset(raw: any): Asset {
  return {
    id: String(raw.id),
    projectId: String(raw.projectId),
    role: (raw.role ?? "user_text") as AssetRole,
    type: (raw.type ?? "text") as AssetType,
    filename: String(raw.filename ?? raw.originalName ?? "asset"),
    originalName: String(raw.originalName ?? raw.filename ?? "asset"),
    path: raw.path,
    mimeType: raw.mimeType ?? raw.metadata?.mimetype,
    text: raw.text,
    metadata: raw.metadata,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    status: raw.status ?? "ready",
    createdAt: String(raw.createdAt ?? nowIso())
  };
}

class JsonStore {
  async read(): Promise<Database> {
    await ensureStorageDirs();
    try {
      const raw = JSON.parse(await fs.readFile(dbPath, "utf8")) as Partial<Database>;
      return {
        projects: (raw.projects ?? []).map(normalizeProject),
        assets: (raw.assets ?? []).map(normalizeAsset),
        jobs: raw.jobs ?? [],
        analyses: raw.analyses ?? [],
        templates: (raw.templates ?? []).filter((record) => record.template?.schemaVersion === "1.1"),
        generations: raw.generations ?? [],
        renders: raw.renders ?? []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const db = emptyDatabase();
        await this.write(db);
        return db;
      }
      throw error;
    }
  }

  async write(db: Database): Promise<void> {
    await ensureStorageDirs();
    await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  }

  async update<T>(updater: (db: Database) => T | Promise<T>): Promise<T> {
    const db = await this.read();
    const result = await updater(db);
    await this.write(db);
    return result;
  }
}

const store = new JsonStore();
const renderer = new HtmlPreviewRenderer();
const upload = multer({
  dest: path.join(uploadDir, "tmp"),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "text/plain"
    ) {
      callback(null, true);
      return;
    }
    callback(new Error("Unsupported file type. Upload video, image, audio or text assets."));
  }
});

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
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

function inferAssetType(file: Express.Multer.File | undefined, bodyType: unknown): AssetType {
  if (bodyType === "video" || bodyType === "image" || bodyType === "text" || bodyType === "audio") return bodyType;
  if (!file) return "text";
  if (file.mimetype.startsWith("video/")) return "video";
  if (file.mimetype.startsWith("image/")) return "image";
  if (file.mimetype.startsWith("audio/")) return "audio";
  return "text";
}

function createJob(projectId: string, type: Job["type"], inputRef: string): Job {
  const timestamp = nowIso();
  return {
    id: stableId("job", projectId, type, inputRef, timestamp),
    projectId,
    type,
    status: "queued",
    progress: 0,
    inputRef,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function startJob(job: Job): Job {
  const timestamp = nowIso();
  return { ...job, status: "running", progress: 10, startedAt: timestamp, updatedAt: timestamp };
}

function completeJob(job: Job, outputRef: string): Job {
  const timestamp = nowIso();
  return { ...job, status: "succeeded", progress: 100, outputRef, finishedAt: timestamp, updatedAt: timestamp };
}

function failJob(job: Job, error: unknown): Job {
  const timestamp = nowIso();
  return {
    ...job,
    status: "failed",
    progress: 100,
    error: error instanceof Error ? error.message : String(error),
    finishedAt: timestamp,
    updatedAt: timestamp
  };
}

function assertFound<T>(value: T | undefined, label: string): T {
  if (!value) {
    const error = new Error(`${label} not found`);
    (error as Error & { status?: number }).status = 404;
    throw error;
  }
  return value;
}

async function createAssetFromRequest(req: Request, projectId: string, file?: Express.Multer.File): Promise<Asset> {
  const type = inferAssetType(file, req.body.type);
  const role = (req.body.role ?? (type === "video" ? "source_video" : type === "image" ? "user_image" : "user_text")) as AssetRole;
  const originalName = file?.originalname ?? String(req.body.originalName ?? `${role}.${type === "video" ? "mp4" : "txt"}`);
  const id = stableId("asset", projectId, role, originalName, req.body.text ?? nowIso());
  let savedPath: string | undefined;

  if (file) {
    const extension = path.extname(originalName) || "";
    savedPath = path.join(uploadDir, projectId, `${id}${extension}`);
    await fs.mkdir(path.dirname(savedPath), { recursive: true });
    await fs.rename(file.path, savedPath);
  }

  return {
    id,
    projectId,
    role,
    type,
    filename: originalName,
    originalName,
    path: savedPath,
    mimeType: file?.mimetype ?? (type === "text" ? "text/plain" : undefined),
    text: typeof req.body.text === "string" ? req.body.text : undefined,
    metadata: file ? { mimetype: file.mimetype, size: file.size, mock: true } : { mock: true },
    tags: parseTags(req.body.tags),
    status: "ready",
    createdAt: nowIso()
  };
}

async function runAnalysis(project: Project, asset: Asset, purpose: AnalysisPurpose, input: Request["body"] = {}) {
  const analysis = buildMockVideoAnalysis({
    assetId: asset.id,
    filename: asset.filename,
    purpose,
    durationSec: toNumber(input.durationSec, purpose === "source" ? 30 : project.targetDurationSec),
    width: toNumber(input.width, project.aspectRatio === "9:16" ? 720 : 1280),
    height: toNumber(input.height, project.aspectRatio === "9:16" ? 1280 : 720),
    fps: toNumber(input.fps, 30)
  });

  const exampleAnalysis: ExampleAnalysis = {
    id: analysis.id,
    projectId: project.id,
    assetId: asset.id,
    purpose,
    video: analysis,
    createdAt: nowIso()
  };

  let templateRecord: TemplateRecord | undefined;
  if (purpose === "sample") {
    const template = buildFallbackTemplate(analysis, project.vertical, project.id);
    const validation = validateStructureTemplate(template);
    if (!validation.valid) {
      throw new Error(`Structure template validation failed: ${validation.errors.join("; ")}`);
    }
    exampleAnalysis.template = template;
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
  }

  return { exampleAnalysis, templateRecord };
}

function selectTemplate(db: Database, request: GenerationRequest): TemplateRecord {
  const selectedId = request.selectedTemplateIds?.[0];
  const projectTemplates = db.templates.filter((template) => template.projectId === request.projectId);
  if (selectedId) return assertFound(projectTemplates.find((template) => template.id === selectedId), "Selected template");
  const vertical = request.knowledgeBaseScope?.vertical ?? request.target.vertical;
  return assertFound(
    [...projectTemplates].reverse().find((template) => template.vertical === vertical) ?? projectTemplates.at(-1),
    "Template for project knowledge base"
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "vvst-api", spec: "1.1", mode: process.env.AI_PROVIDER ?? "mock" });
});

app.get(
  "/readyz",
  asyncRoute(async (_req, res) => {
    await ensureStorageDirs();
    res.json({ ok: true, storageRoot });
  })
);

app.post(
  "/api/projects",
  asyncRoute(async (req, res) => {
    const project: Project = {
      id: stableId("project", req.body.name ?? "Demo Structure Transfer Project", nowIso()),
      name: String(req.body.name ?? "Demo Structure Transfer Project"),
      vertical: (req.body.vertical ?? "b2b_marketing_mg") as Vertical,
      aspectRatio: req.body.aspectRatio === "16:9" || req.body.aspectRatio === "1:1" || req.body.aspectRatio === "4:5" ? req.body.aspectRatio : "9:16",
      targetDurationSec: toNumber(req.body.targetDurationSec, 15),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.update((db) => {
      db.projects.push(project);
    });
    res.status(201).json(project);
  })
);

app.get(
  "/api/projects",
  asyncRoute(async (_req, res) => {
    const db = await store.read();
    res.json(db.projects);
  })
);

app.get(
  "/api/projects/:projectId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const project = assertFound(db.projects.find((item) => item.id === req.params.projectId), "Project");
    res.json({
      ...project,
      assets: db.assets.filter((asset) => asset.projectId === project.id),
      analyses: db.analyses.filter((analysis) => analysis.projectId === project.id),
      templates: db.templates.filter((template) => template.projectId === project.id),
      generations: db.generations.filter((generation) => generation.projectId === project.id)
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
    res.status(201).json(asset);
  })
);

app.get(
  "/api/projects/:projectId/assets",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    res.json(db.assets.filter((asset) => asset.projectId === req.params.projectId));
  })
);

app.get(
  "/api/assets/:assetId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    res.json(assertFound(db.assets.find((asset) => asset.id === req.params.assetId), "Asset"));
  })
);

app.post(
  "/api/assets/:assetId/analyze",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const asset = assertFound(db.assets.find((item) => item.id === req.params.assetId), "Asset");
    const project = assertFound(db.projects.find((item) => item.id === asset.projectId), "Project");
    const purpose = req.body.purpose === "sample" ? "sample" : req.body.purpose === "source" ? "source" : asset.role === "example_video" ? "sample" : "source";
    let job = startJob(createJob(project.id, "analysis", asset.id));

    try {
      const { exampleAnalysis, templateRecord } = await runAnalysis(project, asset, purpose, req.body);
      job = completeJob(job, exampleAnalysis.id);
      await store.update((draft) => {
        draft.jobs.push(job);
        draft.analyses = draft.analyses.filter((item) => !(item.assetId === asset.id && item.purpose === purpose));
        draft.analyses.push(exampleAnalysis);
        if (templateRecord) {
          draft.templates = draft.templates.filter((item) => item.id !== templateRecord.id);
          draft.templates.push(templateRecord);
        }
      });
      res.status(201).json({ jobId: job.id, analysis: exampleAnalysis, template: templateRecord?.template });
    } catch (error) {
      job = failJob(job, error);
      await store.update((draft) => {
        draft.jobs.push(job);
      });
      throw error;
    }
  })
);

app.post(
  "/api/samples/analyze",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const project =
      typeof req.body.projectId === "string"
        ? assertFound(db.projects.find((item) => item.id === req.body.projectId), "Project")
        : {
            id: stableId("project", "demo", nowIso()),
            name: "Demo Structure Transfer Project",
            vertical: "b2b_marketing_mg" as Vertical,
            aspectRatio: "9:16" as const,
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
      originalName: String(req.body.sampleName ?? "sample-description.mp4"),
      text: String(req.body.description ?? "Mock sample video description"),
      mimeType: "video/mp4",
      metadata: { mock: true },
      tags: ["example"],
      status: "ready",
      createdAt: nowIso()
    };
    let job = startJob(createJob(project.id, "analysis", asset.id));

    try {
      const { exampleAnalysis, templateRecord } = await runAnalysis(project, asset, "sample", req.body);
      job = completeJob(job, exampleAnalysis.id);
      await store.update((draft) => {
        if (!draft.projects.some((item) => item.id === project.id)) draft.projects.push(project);
        if (!draft.assets.some((item) => item.id === asset.id)) draft.assets.push(asset);
        draft.jobs.push(job);
        draft.analyses = draft.analyses.filter((item) => !(item.assetId === asset.id && item.purpose === "sample"));
        draft.analyses.push(exampleAnalysis);
        if (templateRecord) {
          draft.templates = draft.templates.filter((item) => item.id !== templateRecord.id);
          draft.templates.push(templateRecord);
        }
      });
      res.status(201).json({ project, asset, jobId: job.id, analysis: exampleAnalysis, template: templateRecord?.template });
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
    res.json(analysis);
  })
);

app.post(
  "/api/templates",
  asyncRoute(async (req, res) => {
    const validation = validateStructureTemplate(req.body.template);
    if (!validation.valid) {
      res.status(400).json({ error: "Invalid structure template", details: validation.errors });
      return;
    }
    const record: TemplateRecord = {
      id: req.body.template.id,
      projectId: String(req.body.projectId ?? req.body.template.projectId),
      sourceAssetId: String(req.body.sourceAssetId ?? req.body.template.sourceExample.assetId),
      name: req.body.template.name,
      vertical: req.body.template.vertical,
      template: req.body.template,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await store.update((db) => {
      db.templates = db.templates.filter((template) => template.id !== record.id);
      db.templates.push(record);
    });
    res.status(201).json(record);
  })
);

app.get(
  "/api/templates",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const projectId = req.query.projectId?.toString();
    res.json(projectId ? db.templates.filter((template) => template.projectId === projectId) : db.templates);
  })
);

app.get(
  "/api/templates/:templateId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    res.json(assertFound(db.templates.find((template) => template.id === req.params.templateId), "Template"));
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
    res.json({
      projectId: req.params.projectId,
      templates,
      atoms: templates.flatMap((template) =>
        template.template.structureAtoms.map((atom) => ({
          ...atom,
          sourceTemplateId: template.id,
          sourceTemplateName: template.name,
          vertical: template.vertical
        }))
      ),
      editingTechniques: templates.flatMap((template) =>
        template.template.editingTechniques.map((technique) => ({
          ...technique,
          sourceTemplateId: template.id,
          vertical: template.vertical
        }))
      )
    });
  })
);

async function handleGeneration(req: Request, res: Response): Promise<void> {
  const validation = validateGenerationRequest(req.body);
  if (!validation.valid) {
    res.status(400).json({ error: "Invalid generation request", details: validation.errors });
    return;
  }

  const request = req.body as GenerationRequest;
  const db = await store.read();
  assertFound(db.projects.find((project) => project.id === request.projectId), "Project");
  const templateRecord = selectTemplate(db, request);
  const sourceAsset = request.sourceVideo
    ? assertFound(db.assets.find((asset) => asset.id === request.sourceVideo?.assetId), "Source video")
    : undefined;
  let sourceAnalysis = sourceAsset
    ? [...db.analyses].reverse().find((analysis) => analysis.assetId === sourceAsset.id && analysis.purpose === "source")?.video
    : undefined;
  let job = startJob(createJob(request.projectId, "generation", request.requestId ?? request.prompt));

  try {
    if (sourceAsset && !sourceAnalysis) {
      sourceAnalysis = buildMockVideoAnalysis({
        assetId: sourceAsset.id,
        filename: sourceAsset.filename,
        purpose: "source",
        durationSec: 30
      });
      const analysisRecord: ExampleAnalysis = {
        id: sourceAnalysis.id,
        projectId: request.projectId,
        assetId: sourceAsset.id,
        purpose: "source",
        video: sourceAnalysis,
        createdAt: nowIso()
      };
      db.analyses.push(analysisRecord);
    }
    const generation = generateMigrationResult(templateRecord.template, request, sourceAsset, sourceAnalysis);
    job = completeJob(job, generation.id);
    await store.update((draft) => {
      if (sourceAnalysis && sourceAsset && !draft.analyses.some((item) => item.id === sourceAnalysis?.id)) {
        draft.analyses.push({
          id: sourceAnalysis.id,
          projectId: request.projectId,
          assetId: sourceAsset.id,
          purpose: "source",
          video: sourceAnalysis,
          createdAt: nowIso()
        });
      }
      draft.jobs.push(job);
      draft.generations = draft.generations.filter((item) => item.id !== generation.id);
      draft.generations.push(generation);
    });
    res.status(201).json({ jobId: job.id, generation });
  } catch (error) {
    job = failJob(job, error);
    await store.update((draft) => {
      draft.jobs.push(job);
    });
    throw error;
  }
}

app.post("/api/generations", asyncRoute(handleGeneration));
app.post("/api/generate", asyncRoute(handleGeneration));

app.get(
  "/api/generations/:generationId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    res.json(assertFound(db.generations.find((generation) => generation.id === req.params.generationId), "Generation"));
  })
);

app.post(
  "/api/generations/:generationId/render",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    const generation = assertFound(db.generations.find((item) => item.id === req.params.generationId), "Generation");
    let job = startJob(createJob(generation.projectId, "render", generation.id));

    try {
      const output = await renderer.render(generation.timeline, generation.id);
      const renderPath = path.join(generatedDir, `${output.renderId}.html`);
      await fs.writeFile(renderPath, output.previewHtml ?? "", "utf8");
      const completedOutput: RenderOutput = { ...output, outputPath: renderPath };
      job = completeJob(job, output.renderId);
      await store.update((draft) => {
        draft.jobs.push(job);
        draft.renders = draft.renders.filter((item) => item.renderId !== output.renderId);
        draft.renders.push(completedOutput);
      });
      res.status(201).json({ jobId: job.id, render: completedOutput });
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
    res.json(assertFound(db.renders.find((render) => render.renderId === req.params.renderId), "Render"));
  })
);

app.get(
  "/api/jobs/:jobId",
  asyncRoute(async (req, res) => {
    const db = await store.read();
    res.json(assertFound(db.jobs.find((job) => job.id === req.params.jobId), "Job"));
  })
);

app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.status ?? 500).json({ error: error.message, status: error.status ?? 500 });
});

const port = Number(process.env.APP_PORT ?? 3000);
await ensureStorageDirs();
app.listen(port, () => {
  console.log(`VVST API v1.1 listening on http://localhost:${port}`);
  console.log(`Storage directory: ${storageRoot}`);
});
