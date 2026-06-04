// apps/api/src/v5Routes.ts
// V5 HTTP surface, mounted under /api/v5 so it runs in parallel with the V4 routes in server.ts.
// Drives the deterministic pipeline-v5 orchestrators. Endpoints (api.md, namespaced):
//   POST /api/v5/learn-samples            { sampleAssetIds[] }      -> learn each into the KB
//   GET  /api/v5/samples/:assetId/evidence | /reconstruction       -> stored learn artifacts
//   GET  /api/v5/kb/elements?kind&tag&q   POST /api/v5/kb/search    GET /api/v5/kb/decisions
//   POST /api/v5/generations              { brief, targetAssetIds, selectedElementIds?, options }
//   GET  /api/v5/generations/:id          -> stored generation result (+ scorecard)

import { promises as fs } from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import type { Asset } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { analyzeEvidenceTimeline } from "./adapters/evidenceTimeline.js";
import { KnowledgeBaseV5 } from "./services/knowledgeBaseV5.js";
import {
  buildV5RenderInputProps,
  createGeminiModelFn,
  renderFinalVideoV5,
  runCreateV5,
  runGen1Ai,
  runLearnSampleV5,
  runNoCopyScan,
  runScorecardV5,
  toEvidenceTimelineV5,
  type NoCopyResult
} from "./pipeline-v5/index.js";

interface StoreLike {
  read<T>(collection: string): Promise<T[]>;
}

export interface V5RouterDeps {
  store: StoreLike;
  storageRoot: string;
  generatedDir: string;
}

const ok = (res: Response, body: unknown) => res.json(body);
const fail = (res: Response, code: number, message: string) => res.status(code).json({ error: message });

export function createV5Router(deps: V5RouterDeps): Router {
  const router = Router();
  const kb = new KnowledgeBaseV5(deps.storageRoot);
  const v5Dir = path.join(deps.generatedDir, "v5");
  const learnDir = (assetId: string) => path.join(v5Dir, "learn", assetId);
  const genDir = (genId: string) => path.join(v5Dir, "generations", genId);

  const getAssets = () => deps.store.read<Asset>("assets");
  const findAsset = async (id: string) => (await getAssets()).find((a) => a.id === id);
  const readJsonIf = async (p: string) => {
    try {
      return JSON.parse(await fs.readFile(p, "utf8"));
    } catch {
      return undefined;
    }
  };

  // ---- Learn ----
  router.post("/learn-samples", async (req: Request, res: Response) => {
    const sampleAssetIds: string[] = Array.isArray(req.body?.sampleAssetIds) ? req.body.sampleAssetIds : [];
    if (!sampleAssetIds.length) return fail(res, 400, "sampleAssetIds[] required");
    const wantAi = req.body?.options?.runGen1Ai === true;
    const modelFn = wantAi ? createGeminiModelFn() : undefined;
    const learned: unknown[] = [];
    for (const assetId of sampleAssetIds) {
      const asset = await findAsset(assetId);
      if (!asset) {
        learned.push({ sampleId: assetId, error: "asset not found" });
        continue;
      }
      const outDir = learnDir(assetId);
      const v4Timeline = await analyzeEvidenceTimeline(asset, { generatedDir: deps.generatedDir });
      if (!v4Timeline) {
        learned.push({ sampleId: assetId, error: "evidence unavailable (conda env / sample path)" });
        continue;
      }
      const evidence = toEvidenceTimelineV5(v4Timeline, asset);
      let aiProgram: v5.NeutralReconstructionProgram | null = null;
      let usedAi = false;
      if (modelFn) {
        const g1 = await runGen1Ai(evidence, modelFn);
        aiProgram = g1.usedAi ? g1.program : null;
        usedAi = g1.usedAi;
      }
      const artifacts = await runLearnSampleV5(evidence, kb, { outDir, aiProgram });
      learned.push({
        sampleId: assetId,
        evidenceTimelineId: evidence.id,
        reconstructionProgramId: artifacts.neutralProgram.id,
        gen1: usedAi ? "ai" : "deterministic",
        candidateCount: artifacts.candidates.length,
        storedElements: artifacts.elements.length,
        gates: artifacts.gates,
        warnings: artifacts.warnings
      });
    }
    return ok(res, { learned, kbSize: kb.list().length });
  });

  router.get("/samples/:assetId/evidence", async (req, res) => {
    const data = await readJsonIf(path.join(learnDir(req.params.assetId), "evidence-timeline-v5.json"));
    return data ? ok(res, data) : fail(res, 404, "no evidence; run /learn-samples first");
  });

  router.get("/samples/:assetId/reconstruction", async (req, res) => {
    const data = await readJsonIf(path.join(learnDir(req.params.assetId), "neutral-reconstruction-program.json"));
    return data ? ok(res, data) : fail(res, 404, "no reconstruction; run /learn-samples first");
  });

  router.get("/samples/:assetId/elements", async (req, res) => {
    const candidates = await readJsonIf(path.join(learnDir(req.params.assetId), "candidate-elements.json"));
    const decisions = await readJsonIf(path.join(learnDir(req.params.assetId), "kb-decisions.json"));
    if (!candidates) return fail(res, 404, "no elements; run /learn-samples first");
    return ok(res, { candidates, decisions });
  });

  // ---- Knowledge Base ----
  router.get("/kb/elements", (req, res) => {
    const q = req.query;
    return ok(res, {
      elements: kb.list({
        kind: q.kind as v5.KnowledgeElementKindV5 | undefined,
        tag: q.tag as string | undefined,
        sourceSampleId: q.sourceSampleId as string | undefined,
        q: q.q as string | undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined
      })
    });
  });

  router.post("/kb/search", (req, res) => {
    const query = String(req.body?.query ?? "");
    const kinds = req.body?.filters?.kind as v5.KnowledgeElementKindV5[] | undefined;
    return ok(res, { elements: kb.search(query, { kind: kinds }) });
  });

  router.get("/kb/decisions", (_req, res) => ok(res, { decisions: kb.getDecisions() }));

  // ---- Generation ----
  const buildGeneration = async (req: Request, res: Response, doRender: boolean) => {
    const body = req.body ?? {};
    const brief: v5.CreativeBriefV5 = body.brief ?? {};
    const projectId: string = body.projectId ?? "proj_v5";
    const generationId: string = body.generationId ?? `gen_${Date.now().toString(36)}`;
    const targetAssetIds: string[] = Array.isArray(body.targetAssetIds) ? body.targetAssetIds : [];
    const selectedElementIds: string[] | undefined = Array.isArray(body.selectedElementIds) ? body.selectedElementIds : undefined;
    const options = body.options ?? {};

    const allAssets = await getAssets();
    const targetAssets = targetAssetIds
      .map((id) => allAssets.find((a) => a.id === id))
      .filter((a): a is Asset => Boolean(a));

    const allElements = kb.list();
    const selectedElements = selectedElementIds
      ? allElements.filter((e) => selectedElementIds.includes(e.id))
      : allElements;
    if (!selectedElements.length) return fail(res, 400, "no KB elements selected/available; run /learn-samples first");

    const outDir = genDir(generationId);
    const create = await runCreateV5({
      projectId,
      generationId,
      brief,
      targetAssets,
      selectedElements,
      outDir
    });

    // Only assess render gates when a render was actually attempted (plan -> undefined -> warn,
    // not fail). POST /generations renders by default; /generations/plan never renders.
    let renderInfo: { finalMp4Exists: boolean; durationSec?: number; hasAudio?: boolean; audioIntended?: boolean } | undefined;
    let noCopy: NoCopyResult | undefined;
    let finalVideoUrl: string | undefined;
    const shouldRender = doRender && (options.autoRender ?? true) !== false;

    if (shouldRender) {
      const outPath = path.join(outDir, "final.mp4");
      const render = await renderFinalVideoV5({ finalProgram: create.finalProgram, outPath, proceduralAudio: true });
      renderInfo = {
        finalMp4Exists: Boolean(render.ok && render.finalMp4),
        durationSec: render.durationSec,
        hasAudio: render.hasAudio,
        audioIntended: true
      };
      if (render.finalMp4) {
        finalVideoUrl = `/generated/${path.relative(deps.generatedDir, render.finalMp4).split(path.sep).join("/")}`;
        const sampleAssetId = selectedElements[0]?.source.sourceSampleId;
        const sampleAsset = sampleAssetId ? allAssets.find((a) => a.id === sampleAssetId) : undefined;
        noCopy = await runNoCopyScan({
          finalVideoPath: render.finalMp4,
          sampleVideoPath: sampleAsset?.path,
          outDir
        });
      }
    }

    const scorecard = runScorecardV5({
      generationId,
      stageGates: [create.gates],
      render: renderInfo,
      noCopy
    });
    await fs.writeFile(path.join(outDir, "scorecard.json"), JSON.stringify(scorecard, null, 2));

    const result = {
      generationId,
      compositionProgramId: create.composition.id,
      gapReportId: create.gapReport.id,
      finalVideoProgramId: create.finalProgram.id,
      finalVideoUrl,
      scorecard,
      composition: create.composition,
      gapReport: create.gapReport,
      finalProgram: create.finalProgram,
      renderProps: buildV5RenderInputProps(create.finalProgram)
    };
    await fs.writeFile(path.join(outDir, "generation-result.json"), JSON.stringify(result, null, 2));
    return ok(res, result);
  };

  router.post("/generations/plan", (req, res) => buildGeneration(req, res, false));
  router.post("/generations", (req, res) => buildGeneration(req, res, true));

  router.get("/generations/:id", async (req, res) => {
    const data = await readJsonIf(path.join(genDir(req.params.id), "generation-result.json"));
    return data ? ok(res, data) : fail(res, 404, "generation not found");
  });

  router.get("/generations/:id/scorecard", async (req, res) => {
    const data = await readJsonIf(path.join(genDir(req.params.id), "scorecard.json"));
    return data ? ok(res, data) : fail(res, 404, "scorecard not found");
  });

  return router;
}
