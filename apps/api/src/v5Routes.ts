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
  runSameTemplateGeneration,
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

  // ---- Assets (for the UI to pick sample/target assets) ----
  router.get("/assets", async (_req, res) => {
    const assets = await getAssets();
    return ok(res, {
      assets: assets.map((a) => ({ id: a.id, role: a.role, type: a.type, filename: a.filename, hasPath: Boolean(a.path), tags: a.tags ?? [] }))
    });
  });

  // ---- Learn ----
  router.post("/learn-samples", async (req: Request, res: Response) => {
    const sampleAssetIds: string[] = Array.isArray(req.body?.sampleAssetIds) ? req.body.sampleAssetIds : [];
    if (!sampleAssetIds.length) return fail(res, 400, "sampleAssetIds[] required");
    const wantAi = req.body?.options?.runGen1Ai === true;
    const modelFn = wantAi ? createGeminiModelFn() : undefined;
    // V5.1: real AI codegen of the capsule TSX (triple-gated, apply!=promote) is now the DEFAULT
    // (opt out with options.runCapsuleCodegen=false). Falls back to deterministic when no GEMINI key.
    const wantCapsuleCodegen = req.body?.options?.runCapsuleCodegen !== false;
    const capsuleCodegenModel = wantCapsuleCodegen ? createGeminiModelFn({ model: process.env.GEMINI_CODEGEN_MODEL, timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 120000) }) ?? null : null;
    // Real frame-0 render validation at learn time (T8) — defaults to follow capsule codegen.
    const validateRender = req.body?.options?.validateTemplateRender ?? wantCapsuleCodegen;
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
      const artifacts = await runLearnSampleV5(evidence, kb, { outDir, aiProgram, capsuleCodegenModel, validateRender, projectId: asset.projectId, storageRoot: path.dirname(deps.generatedDir) });
      learned.push({
        sampleId: assetId,
        evidenceTimelineId: evidence.id,
        reconstructionProgramId: artifacts.neutralProgram.id,
        gen1: usedAi ? "ai" : "deterministic",
        // V5.1: the reusable Remotion template capsule (the default generation object).
        templateCapsuleId: artifacts.templateCapsule.id,
        templateSlots: artifacts.templateCapsule.slotSchema.length,
        templateCompiles: artifacts.templateCapsule.quality.compilePassed,
        templateValidationPassed: artifacts.templateValidation.passed,
        // V5.1 Phase 2: did the capsule actually render a frame at learn time (T8)?
        templateRenders: artifacts.templateCapsule.quality.renderPreviewPassed,
        // V5.1 Phase 1: did real AI capsule codegen get promoted (vs deterministic fallback)?
        templateCode: artifacts.capsuleCodegen ? (artifacts.capsuleCodegen.usedAi ? "ai" : "deterministic_fallback") : "deterministic",
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

  // ---- Template capsules (V5.1 — the default generation object) ----
  router.get("/templates", (req, res) => {
    const list = kb.listTemplateCapsules({ sourceSampleId: req.query.sourceSampleId as string | undefined, projectId: req.query.projectId as string | undefined, tag: req.query.tag as string | undefined, q: req.query.q as string | undefined });
    // metadata only (omit code bundle for the list)
    return ok(res, {
      templates: list.map((c) => ({ id: c.id, sourceSampleId: c.sourceSampleId, projectId: c.projectId, name: c.name, description: c.description, tags: c.tags, slotSchema: c.slotSchema, timingSignature: c.timingSignature, motionSignature: c.motionSignature, quality: c.quality }))
    });
  });

  router.get("/templates/:id", (req, res) => {
    const c = kb.getTemplateCapsule(req.params.id);
    return c ? ok(res, c) : fail(res, 404, "template capsule not found");
  });

  // ---- Generation ----
  // Shared assembly for same_template + modify_template (revise): score, reconcile readiness, persist.
  const finishSameTemplate = async (
    res: Response,
    generationId: string,
    capsule: v5.RemotionTemplateCapsule,
    st: Awaited<ReturnType<typeof runSameTemplateGeneration>>,
    stOptions: v5.GenerationOptionsV5,
    outDirST: string,
    extra: Record<string, unknown> = {}
  ) => {
    // Feed REAL render facts + the real no-copy scan into the scorecard (so V5-G23/G27/G29/G30 are
    // earned, and the readiness ladder runs on same_template evidence — not stuck at artifact_valid).
    const sc = runScorecardV5({
      generationId,
      stageGates: [st.gates],
      render: st.finalMp4Exists
        ? { finalMp4Exists: true, durationSec: st.renderDurationSec, expectedDurationSec: capsule.timingSignature.durationSec, width: 1080, height: 1920, expectedWidth: 1080, expectedHeight: 1920, hasAudio: st.renderHasAudio, audioIntended: stOptions.aigcGapFill.audioFill !== "off" }
        : st.instance.slotBindings.length ? { finalMp4Exists: false } : undefined,
      noCopy: st.noCopy
    });
    sc.gates = [...sc.gates, ...st.gates.filter((g) => g.id.startsWith("T"))];
    // Reconcile: the scorecard is the single source of truth; align the instance readiness to it.
    const toInstanceReadiness = (lvl?: v5.ReadinessLevel): v5.TemplateInstance["readinessImpact"]["readinessLevel"] =>
      lvl === "shippable_demo" ? "shippable_candidate" : lvl === "review_demo" ? "review_demo" : "technical_demo";
    st.instance.readinessImpact.readinessLevel = toInstanceReadiness(sc.readinessLevel);
    if (st.instance.readinessImpact.warnings.length) sc.readinessReasons = [...(sc.readinessReasons ?? []), ...st.instance.readinessImpact.warnings];
    await fs.mkdir(outDirST, { recursive: true });
    const result = {
      generationId,
      generationMode: stOptions.generationMode,
      templateCapsuleId: capsule.id,
      usedTemplateCode: st.finalProgram.renderMode === "bespoke_codegen",
      usedFallbackRenderer: st.finalProgram.fallbackUsed === true,
      finalVideoUrl: st.finalVideoUrl,
      templateInstance: st.instance,
      finalProgram: st.finalProgram,
      generatedAssets: st.generatedAssets,
      gapReport: st.gapReport,
      noCopy: st.noCopy,
      scorecard: sc,
      warnings: st.warnings,
      ...extra
    };
    await Promise.all([
      fs.writeFile(path.join(outDirST, "template-instance.json"), JSON.stringify(st.instance, null, 2)),
      fs.writeFile(path.join(outDirST, "final-video-program.json"), JSON.stringify(st.finalProgram, null, 2)),
      fs.writeFile(path.join(outDirST, "gap-report.json"), JSON.stringify(st.gapReport, null, 2)),
      fs.writeFile(path.join(outDirST, "scorecard.json"), JSON.stringify(sc, null, 2)),
      fs.writeFile(path.join(outDirST, "generation-result.json"), JSON.stringify(result, null, 2))
    ]);
    return ok(res, result);
  };

  const buildGeneration = async (req: Request, res: Response, doRender: boolean) => {
    try {
      return await buildGenerationInner(req, res, doRender);
    } catch (err) {
      return fail(res, 500, `generation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const buildGenerationInner = async (req: Request, res: Response, doRender: boolean) => {
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

    // V5.1 DEFAULT: same_template mode — reuse a learned RemotionTemplateCapsule's code with new
    // theme + auto AIGC gap fill. (mix_elements is the advanced path below.)
    const generationMode: v5.GenerationMode = body.options?.generationMode ?? "same_template";
    if (generationMode === "same_template") {
      const outDirST = genDir(generationId);
      const reqOpts = body.options ?? {};
      const stOptions: v5.GenerationOptionsV5 = {
        ...v5.DEFAULT_GENERATION_OPTIONS_V5,
        ...reqOpts,
        generationMode: "same_template",
        aigcGapFill: { ...v5.DEFAULT_GENERATION_OPTIONS_V5.aigcGapFill, ...(reqOpts.aigcGapFill ?? {}) },
        fallbackPolicy: { ...v5.DEFAULT_GENERATION_OPTIONS_V5.fallbackPolicy, ...(reqOpts.fallbackPolicy ?? {}) }
      };
      const capsule = stOptions.templateCapsuleId ? kb.getTemplateCapsule(stOptions.templateCapsuleId) : kb.latestTemplateCapsule();
      if (!capsule) return fail(res, 400, "no template capsule available; run /learn-samples first (or pass options.templateCapsuleId)");
      const port = Number(process.env.APP_PORT ?? 3000);
      const sampleVideoPath = allAssets.find((a) => a.id === capsule.sourceSampleId)?.path;
      const st = await runSameTemplateGeneration({
        projectId,
        generationId,
        capsule,
        brief,
        targetAssets,
        options: stOptions,
        outDir: outDirST,
        publicPathPrefix: `/generated/${path.relative(deps.generatedDir, path.join(outDirST, "materials")).split(path.sep).join("/")}/`,
        serveBase: `http://127.0.0.1:${port}`,
        sampleVideoPath,
        env: process.env,
        doRender: doRender && (reqOpts.autoRender ?? true) !== false
      });
      return finishSameTemplate(res, generationId, capsule, st, stOptions, outDirST);
    }

    const allElements = kb.list();
    const selectedElements = selectedElementIds
      ? allElements.filter((e) => selectedElementIds.includes(e.id))
      : allElements;
    if (!selectedElements.length) return fail(res, 400, "no KB elements selected/available; run /learn-samples first");

    const outDir = genDir(generationId);
    const gen2Model = options.runGen2Ai === true ? createGeminiModelFn() ?? undefined : undefined;

    // Beat grid (for audio-cue alignment) from the first selected element's learned evidence.
    const sampleId = selectedElements[0]?.source.sourceSampleId;
    let beatGrid: { bpm?: number | null; beats?: number[]; strongBeats?: number[] } | undefined;
    if (sampleId) {
      const ev = await readJsonIf(path.join(learnDir(sampleId), "evidence-timeline-v5.json"));
      const ae = (ev as { audioEvidence?: { bpm?: number; beatGridSec?: number[]; onsetsSec?: number[] } } | undefined)?.audioEvidence;
      if (ae) beatGrid = { bpm: ae.bpm ?? null, beats: ae.beatGridSec ?? [], strongBeats: ae.onsetsSec ?? [] };
    }
    const materialsPublicPrefix = `/generated/${path.relative(deps.generatedDir, path.join(outDir, "materials")).split(path.sep).join("/")}/`;

    const create = await runCreateV5({
      projectId,
      generationId,
      brief,
      targetAssets,
      selectedElements,
      outDir,
      gen2Model,
      beatGrid,
      allowExternalProvider: options.materialFill === "aigc",
      publicPathPrefix: materialsPublicPrefix,
      materialFillMaxGenerated: typeof options.materialFillMax === "number" ? options.materialFillMax : 4,
      env: process.env
    });

    // Only assess render gates when a render was actually attempted (plan -> undefined -> warn,
    // not fail). POST /generations renders by default; /generations/plan never renders.
    let renderInfo: { finalMp4Exists: boolean; durationSec?: number; hasAudio?: boolean; audioIntended?: boolean } | undefined;
    let noCopy: NoCopyResult | undefined;
    let finalVideoUrl: string | undefined;
    const shouldRender = doRender && (options.autoRender ?? true) !== false;

    if (shouldRender) {
      const outPath = path.join(outDir, "final.mp4");
      // Generated images are served at /generated/... by this server; the headless renderer (same
      // machine) loads them over http (chrome blocks file:// "local resource" loads).
      const port = Number(process.env.APP_PORT ?? 3000);
      const assetMap: Record<string, { src: string }> = {};
      for (const a of create.finalProgram.renderRecipe.assets) {
        if (a.provenance?.source === "aigc_generated" && a.uri) {
          assetMap[a.id] = { src: a.uri.startsWith("http") ? a.uri : `http://127.0.0.1:${port}${a.uri.startsWith("/") ? "" : "/"}${a.uri}` };
        }
      }
      const render = await renderFinalVideoV5({ finalProgram: create.finalProgram, outPath, proceduralAudio: true, bpm: beatGrid?.bpm ?? null, assetMap });
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

  // ---- Revise (modify_template): patch-first re-theme/re-copy of a prior same_template generation ----
  router.post("/generations/:id/revise", async (req, res) => {
    try {
      const prior = (await readJsonIf(path.join(genDir(req.params.id), "generation-result.json"))) as { generationMode?: string; projectId?: string; templateInstance?: v5.TemplateInstance } | undefined;
      if (!prior?.templateInstance) return fail(res, 400, "no same_template instance for this generation id");
      const instance = prior.templateInstance;
      const capsule = kb.getTemplateCapsule(instance.templateCapsuleId);
      if (!capsule) return fail(res, 404, "the template capsule for this generation no longer exists");
      const patch: v5.TemplatePatchSet = req.body?.patch ?? {};
      if (patch.regenerateImages) return fail(res, 400, "regenerateImages: start a fresh POST /generations with the new brief — revise is patch-first (theme/copy/palette, reuses prior visuals).");
      const generationId = `${req.params.id}_rev_${Date.now().toString(36)}`;
      const outDirST = genDir(generationId);
      const brief: v5.CreativeBriefV5 = { ...instance.creativeBrief, ...(patch.theme ? { theme: patch.theme } : {}) };
      const stOptions: v5.GenerationOptionsV5 = { ...v5.DEFAULT_GENERATION_OPTIONS_V5, generationMode: "modify_template" };
      const sampleVideoPath = (await getAssets()).find((a) => a.id === capsule.sourceSampleId)?.path;
      const port = Number(process.env.APP_PORT ?? 3000);
      const st = await runSameTemplateGeneration({
        projectId: req.body?.projectId ?? "proj_v5_ui",
        generationId,
        capsule,
        brief,
        targetAssets: [],
        options: stOptions,
        outDir: outDirST,
        publicPathPrefix: `/generated/${path.relative(deps.generatedDir, path.join(outDirST, "materials")).split(path.sep).join("/")}/`,
        serveBase: `http://127.0.0.1:${port}`,
        sampleVideoPath,
        env: process.env,
        doRender: true,
        reviseFrom: { instance, patch }
      });
      return finishSameTemplate(res, generationId, capsule, st, stOptions, outDirST, { revisedFrom: req.params.id, patch });
    } catch (err) {
      return fail(res, 500, `revise failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

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
