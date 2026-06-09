// apps/api/src/v5Routes.ts
// V5 HTTP surface, mounted under /api/v5 so it runs in parallel with the V4 routes in server.ts.
// Drives the deterministic pipeline-v5 orchestrators. Endpoints (api.md, namespaced):
//   POST /api/v5/learn-samples            { sampleAssetIds[] }      -> learn each into the KB
//   GET  /api/v5/samples/:assetId/evidence | /reconstruction       -> stored learn artifacts
//   GET  /api/v5/kb/elements?kind&tag&q   POST /api/v5/kb/search    GET /api/v5/kb/decisions
//   POST /api/v5/generations              { brief, targetAssetIds, selectedElementIds?, options }
//   GET  /api/v5/generations/:id          -> stored generation result (+ scorecard)

import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import type { Asset } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { analyzeEvidenceTimeline } from "./adapters/evidenceTimeline.js";
import { KnowledgeBaseV5 } from "./services/knowledgeBaseV5.js";
import {
  buildV5RenderInputProps,
  buildEditTrace,
  createDoubaoModelFn,
  createGeminiModelFn,
  createGeminiVisionCodegenFn,
  createGeminiVisionFn,
  createTextModelFn,
  finalProgramToGen2RemotionCapsule,
  renderFinalVideoV5,
  renderTemplateCapsule,
  runCreateV5,
  runGen1Ai,
  runLearnSampleV5,
  runNoCopyScan,
  runTargetAssetAnalysisMany,
  enrichProfilesWithVlm,
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
  // VLM (vision) over USER-uploaded assets — opt-in (ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=1) + needs a
  // GEMINI key. Null => heuristic-only profiles (graceful). Doubao is text-only so can't do this.
  const userAssetVisionFn = String(process.env.ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS ?? "") === "1"
    ? createGeminiVisionFn({ model: process.env.VLM_MODEL }) ?? null
    : null;
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
  const generatedUrl = (ref: unknown) => {
    if (typeof ref !== "string") return undefined;
    return ref.startsWith("/generated/") ? ref : undefined;
  };

  // ---- Assets (for the UI to pick sample/target assets) ----
  router.get("/assets", async (_req, res) => {
    const assets = await getAssets();
    return ok(res, {
      assets: assets.map((a) => ({ id: a.id, role: a.role, type: a.type, filename: a.filename, hasPath: Boolean(a.path), tags: a.tags ?? [] }))
    });
  });

  router.get("/assets/:assetId/media", async (req, res) => {
    const asset = await findAsset(req.params.assetId);
    if (!asset?.path) return fail(res, 404, "asset media not found");
    return res.sendFile(path.resolve(asset.path));
  });

  // ---- Learn ----
  router.post("/learn-samples", async (req: Request, res: Response) => {
    const sampleAssetIds: string[] = Array.isArray(req.body?.sampleAssetIds) ? req.body.sampleAssetIds : [];
    if (!sampleAssetIds.length) return fail(res, 400, "sampleAssetIds[] required");
    const wantAi = req.body?.options?.runGen1Ai === true;
    const modelFn = wantAi ? createTextModelFn() : undefined;
    // V5.1: real AI codegen of the capsule TSX (triple-gated, apply!=promote) is now the DEFAULT
    // (opt out with options.runCapsuleCodegen=false). Falls back to deterministic when no GEMINI key.
    const wantCapsuleCodegen = req.body?.options?.runCapsuleCodegen !== false;
    const capsuleCodegenModel = wantCapsuleCodegen ? createTextModelFn({ geminiModel: process.env.GEMINI_CODEGEN_MODEL, timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 120000) }) ?? null : null;
    // Multimodal codegen + VLM scene enrichment send sample FRAMES to the provider for STRUCTURE
    // analysis — gated by ALLOW_EXTERNAL_VLM_SAMPLE_ANALYSIS (opt out with options.useVision=false).
    const allowVlm = String(process.env.ALLOW_EXTERNAL_VLM_SAMPLE_ANALYSIS ?? "") === "1" && req.body?.options?.useVision !== false;
    // Gen1 capsule reconstruction is MULTIMODAL (reads the attached short video or <=30s long-video chunk)
    // -> stays on Gemini. HYBRID model (chosen per-asset below): long/complex sources (>= GEMINI_GEN1_PRO_MIN_SEC,
    // i.e. videos that get chunked) use the stronger Pro model so they reliably reconstruct footage/video slots;
    // short sources use the cheaper flash. Override with options.gen1Model / gen1ModelLong or env.
    const gen1ModelShort = (req.body?.options?.gen1Model as string | undefined) ?? process.env.GEMINI_GEN1_MODEL ?? "gemini-3-flash-preview";
    const gen1ModelLong = (req.body?.options?.gen1ModelLong as string | undefined) ?? process.env.GEMINI_GEN1_MODEL_LONG ?? "gemini-3.1-pro-preview";
    const gen1ProMinSec = Number(process.env.GEMINI_GEN1_PRO_MIN_SEC ?? process.env.CHUNK_TRIGGER_SEC ?? 34);
    const sceneVlm = allowVlm ? createGeminiVisionFn({ model: process.env.VLM_MODEL }) ?? null : null;
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
      // HYBRID Gen1 model: long/complex (chunked) sources -> Pro (reliable footage reconstruction); short -> flash.
      // Source duration lives at evidence.video.durationSec (top-level evidence.durationSec is undefined).
      const srcDurationSec = evidence.video?.durationSec ?? (evidence.shots?.length ? evidence.shots[evidence.shots.length - 1].endSec : 0) ?? 0;
      const gen1Model = srcDurationSec >= gen1ProMinSec ? gen1ModelLong : gen1ModelShort;
      const capsuleCodegenVision = wantCapsuleCodegen && allowVlm ? createGeminiVisionCodegenFn({ model: gen1Model }) ?? null : null;
      let aiProgram: v5.NeutralReconstructionProgram | null = null;
      let usedAi = false;
      if (modelFn) {
        const g1 = await runGen1Ai(evidence, modelFn);
        aiProgram = g1.usedAi ? g1.program : null;
        usedAi = g1.usedAi;
      }
      const artifacts = await runLearnSampleV5(evidence, kb, { outDir, aiProgram, capsuleCodegenModel, capsuleCodegenVision, sceneVlm, validateRender, projectId: asset.projectId, storageRoot: path.dirname(deps.generatedDir), sampleVideoPath: asset.path });
      learned.push({
        sampleId: assetId,
        evidenceTimelineId: evidence.id,
        reconstructionProgramId: artifacts.neutralProgram.id,
        gen1: usedAi ? "ai" : "deterministic",
        gen1Model,
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

  // ---- Transfer trace: one explainable view of learn -> KB -> slot mapping -> gap fill -> render ----
  const buildTransferTrace = async (generationId: string) => {
    const generation = await readJsonIf(path.join(genDir(generationId), "generation-result.json")) as Record<string, unknown> | undefined;
    if (!generation) return undefined;
    const templateCapsuleId =
      typeof generation.templateCapsuleId === "string"
        ? generation.templateCapsuleId
        : (generation.templateInstance as { templateCapsuleId?: string } | undefined)?.templateCapsuleId
          ?? (generation.finalProgram as { sameTemplate?: { templateCapsuleId?: string } } | undefined)?.sameTemplate?.templateCapsuleId;
    const capsule = templateCapsuleId ? kb.getTemplateCapsule(templateCapsuleId) : undefined;
    const sampleId = capsule?.sourceSampleId
      ?? ((generation.finalProgram as { explanation?: { usedElements?: Array<{ sourceSampleId?: string }> } } | undefined)?.explanation?.usedElements?.[0]?.sourceSampleId);
    const sampleAsset = sampleId ? await findAsset(sampleId) : undefined;
    const learnPath = sampleId ? learnDir(sampleId) : undefined;
    const evidence = learnPath ? await readJsonIf(path.join(learnPath, "evidence-timeline-v5.json")) : undefined;
    const reconstruction = learnPath ? await readJsonIf(path.join(learnPath, "neutral-reconstruction-program.json")) : undefined;
    const knowledgeManifest = learnPath ? await readJsonIf(path.join(learnPath, "knowledge_manifest.seed.json")) : undefined;
    const learnKbDecisions = learnPath ? await readJsonIf(path.join(learnPath, "kb-decisions.json")) : undefined;
    const sideKbDecisions = learnPath ? await readJsonIf(path.join(learnPath, "kb-decisions-sidefiles.json")) : undefined;
    const keyFrames = Array.isArray((evidence as { keyFrames?: unknown[] } | undefined)?.keyFrames) ? (evidence as { keyFrames: Array<{ frameRef?: string }> }).keyFrames : [];
    const slotBindings = (generation.templateInstance as { slotBindings?: v5.TemplateSlotBinding[] } | undefined)?.slotBindings
      ?? (generation.finalProgram as { sameTemplate?: { slotBindings?: v5.TemplateSlotBinding[] } } | undefined)?.sameTemplate?.slotBindings
      ?? [];
    const targetAssetIds = Array.from(new Set(slotBindings.map((b) => b.assetId).filter((id): id is string => Boolean(id))));
    const targetAssets = (await getAssets()).filter((a) => targetAssetIds.includes(a.id));
    const targetProfiles = await enrichProfilesWithVlm(runTargetAssetAnalysisMany(targetAssets), targetAssets, userAssetVisionFn);
    const slotById = new Map((capsule?.slotSchema ?? []).map((s) => [s.id, s]));
    const gapReport = generation.gapReport ?? await readJsonIf(path.join(genDir(generationId), "gap-report.json"));
    const scorecard = generation.scorecard ?? await readJsonIf(path.join(genDir(generationId), "scorecard.json"));
    const kbElements = sampleId ? kb.list({ sourceSampleId: sampleId, limit: 80 }) : [];
    const slotMapping = slotBindings.map((binding) => {
      const slot = slotById.get(binding.slotId);
      const profile = binding.assetId ? targetProfiles.find((p) => p.assetId === binding.assetId) : undefined;
      return {
        slotId: binding.slotId,
        slotKind: slot?.kind,
        originalRole: slot?.originalRole,
        required: slot?.required,
        status: binding.status,
        assetId: binding.assetId,
        assetProfile: profile,
        uri: binding.uri,
        text: binding.text,
        fillReason:
          binding.status === "user_asset" ? `Matched user asset to ${slot?.originalRole ?? binding.slotId}.`
          : binding.status === "aigc_generated" ? `Filled missing ${slot?.kind ?? "slot"} with AIGC material.`
          : binding.status === "text_generated" ? "Generated replacement copy from the target brief."
          : binding.status === "procedural_generated" ? "Used procedural Remotion fallback because no user/AIGC asset was bound."
          : "Slot remains missing."
      };
    });
    const fillActions = slotMapping.map((m) => ({
      slotId: m.slotId,
      status: m.status,
      strategy:
        m.status === "user_asset" ? "asset_reuse"
        : m.status === "aigc_generated" ? "aigc_fill"
        : m.status === "text_generated" ? "text_fill"
        : m.status === "procedural_generated" ? "procedural_fill"
        : "missing",
      reason: m.fillReason
    }));
    return {
      id: `trace_${generationId}`,
      generationId,
      sample: {
        assetId: sampleId,
        filename: sampleAsset?.filename,
        videoUrl: sampleAsset?.path ? `/api/v5/assets/${sampleId}/media` : undefined,
        duration: (evidence as { video?: { durationSec?: number } } | undefined)?.video?.durationSec,
        thumbnail: generatedUrl(keyFrames[0]?.frameRef),
        evidence,
        reconstruction,
        sceneRecipes: capsule?.sceneRecipes ?? [],
        audioRecipes: capsule?.audioRecipes ?? []
      },
      template: {
        capsuleId: capsule?.id ?? templateCapsuleId,
        name: capsule?.name,
        slotSchema: capsule?.slotSchema ?? [],
        remotionCodeHash: (knowledgeManifest as { remotionCodeHash?: string } | undefined)?.remotionCodeHash,
        validation: await (learnPath ? readJsonIf(path.join(learnPath, "template-validation.json")) : Promise.resolve(undefined)),
        knowledgeManifest
      },
      transfer: {
        targetBrief: (generation.templateInstance as { creativeBrief?: unknown } | undefined)?.creativeBrief,
        targetAssetProfiles: targetProfiles,
        assetPlan: capsule?.assetRecipes ?? [],
        slotMapping,
        gapReport,
        fillActions,
        kbDecisions: [...(Array.isArray(learnKbDecisions) ? learnKbDecisions : []), ...(Array.isArray(sideKbDecisions) ? sideKbDecisions : [])],
        usedKnowledgeElements: kbElements.map((e) => ({ id: e.id, kind: e.kind, name: e.name, tags: e.tags, evidenceRefs: e.source.evidenceRefs })),
        // v2 schema-conformant evidence (material_analysis / timeline / mapping / similarity / packaging / edit_trace).
        materialAnalysis: generation.materialAnalysis ?? (await readJsonIf(path.join(genDir(generationId), "material-analysis.json"))) ?? [],
        timeline: generation.timelineV2 ?? (await readJsonIf(path.join(genDir(generationId), "timeline-v2.json"))),
        mapping: generation.mappingV2 ?? (await readJsonIf(path.join(genDir(generationId), "mapping-v2.json"))) ?? [],
        similarityReport: generation.similarityReport ?? (await readJsonIf(path.join(genDir(generationId), "similarity-report.json"))),
        packagingPlan: generation.packagingPlan ?? (await readJsonIf(path.join(genDir(generationId), "packaging-plan.json"))),
        editTrace: generation.editTrace ?? (await readJsonIf(path.join(genDir(generationId), "edit-trace.json")))
      },
      result: {
        outputVideoUrl: generation.finalVideoUrl,
        coverUrl: (generation as { coverUrl?: string }).coverUrl,
        scorecard,
        renderParams: (generation as { renderProps?: unknown }).renderProps ?? (generation.finalProgram as { renderRecipe?: unknown } | undefined)?.renderRecipe,
        previewFrames: (generation as { coverUrl?: string }).coverUrl ? [{ label: "cover", url: (generation as { coverUrl?: string }).coverUrl }] : []
      },
      warnings: (generation as { warnings?: string[] }).warnings ?? []
    };
  };

  router.get("/jobs/:jobId/transfer-trace", async (req, res) => {
    const trace = await buildTransferTrace(req.params.jobId);
    return trace ? ok(res, trace) : fail(res, 404, "generation trace not found");
  });

  router.get("/generations/:id/transfer-trace", async (req, res) => {
    const trace = await buildTransferTrace(req.params.id);
    return trace ? ok(res, trace) : fail(res, 404, "generation trace not found");
  });

  // ---- Template capsules (V5.1 — the default generation object) ----
  router.get("/templates", (req, res) => {
    const list = kb.listTemplateCapsules({ sourceSampleId: req.query.sourceSampleId as string | undefined, projectId: req.query.projectId as string | undefined, tag: req.query.tag as string | undefined, q: req.query.q as string | undefined });
    // metadata only (omit code bundle for the list). createdAt = mtime of the learned capsule file on disk
    // (works for old + new capsules without a stored timestamp), so the UI can label by source video + time.
    const capsuleMtime = (sourceSampleId: string): string | undefined => {
      try {
        return statSync(path.join(learnDir(sourceSampleId), "remotion-template-capsule.json")).mtime.toISOString();
      } catch {
        return undefined;
      }
    };
    return ok(res, {
      templates: list.map((c) => ({ id: c.id, sourceSampleId: c.sourceSampleId, projectId: c.projectId, name: c.name, description: c.description, tags: c.tags, slotSchema: c.slotSchema, timingSignature: c.timingSignature, motionSignature: c.motionSignature, quality: c.quality, createdAt: capsuleMtime(c.sourceSampleId) }))
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
    // edit_trace (TC-08): when this generation is a revise of a prior one, diff the prior timeline against the
    // new one so the change is explainable (which segments/captions moved/replaced, before/after hashes).
    let editTrace: Record<string, unknown> | undefined;
    if (typeof extra.revisedFrom === "string") {
      const baseTimeline = await readJsonIf(path.join(genDir(extra.revisedFrom), "timeline-v2.json"));
      const command = typeof extra.naturalLanguageInstruction === "string" ? extra.naturalLanguageInstruction : JSON.stringify(extra.patch ?? {});
      editTrace = buildEditTrace(command, baseTimeline as Parameters<typeof buildEditTrace>[1], st.timelineV2 as Parameters<typeof buildEditTrace>[2], (extra.generatedPatch ?? extra.patch) as Record<string, unknown> | null);
    }
    const result = {
      generationId,
      generationMode: stOptions.generationMode,
      templateCapsuleId: capsule.id,
      usedTemplateCode: st.finalProgram.renderMode === "bespoke_codegen",
      usedFallbackRenderer: st.finalProgram.fallbackUsed === true,
      finalVideoUrl: st.finalVideoUrl,
      coverUrl: st.coverUrl,
      templateInstance: st.instance,
      finalProgram: st.finalProgram,
      generatedAssets: st.generatedAssets,
      gapReport: st.gapReport,
      noCopy: st.noCopy,
      scorecard: sc,
      // v2 schema-conformant evidence artifacts.
      materialAnalysis: st.materialAnalysis,
      timelineV2: st.timelineV2,
      mappingV2: st.mappingV2,
      similarityReport: st.similarityReport,
      packagingPlan: st.packagingPlan,
      ...(editTrace ? { editTrace } : {}),
      warnings: st.warnings,
      ...extra
    };
    await Promise.all([
      fs.writeFile(path.join(outDirST, "template-instance.json"), JSON.stringify(st.instance, null, 2)),
      fs.writeFile(path.join(outDirST, "final-video-program.json"), JSON.stringify(st.finalProgram, null, 2)),
      fs.writeFile(path.join(outDirST, "gap-report.json"), JSON.stringify(st.gapReport, null, 2)),
      fs.writeFile(path.join(outDirST, "scorecard.json"), JSON.stringify(sc, null, 2)),
      fs.writeFile(path.join(outDirST, "material-analysis.json"), JSON.stringify(st.materialAnalysis, null, 2)),
      fs.writeFile(path.join(outDirST, "timeline-v2.json"), JSON.stringify(st.timelineV2, null, 2)),
      fs.writeFile(path.join(outDirST, "mapping-v2.json"), JSON.stringify(st.mappingV2, null, 2)),
      fs.writeFile(path.join(outDirST, "similarity-report.json"), JSON.stringify(st.similarityReport, null, 2)),
      fs.writeFile(path.join(outDirST, "packaging-plan.json"), JSON.stringify(st.packagingPlan, null, 2)),
      ...(editTrace ? [fs.writeFile(path.join(outDirST, "edit-trace.json"), JSON.stringify(editTrace, null, 2))] : []),
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
    // Explicit per-slot asset binding from the gap radar (slotId -> assetId).
    const slotAssignments: Record<string, string> | undefined =
      body.slotAssignments && typeof body.slotAssignments === "object" && !Array.isArray(body.slotAssignments)
        ? (Object.fromEntries(Object.entries(body.slotAssignments as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>)
        : undefined;
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
      // Context-modification is a TEXT-TO-TEXT task -> Doubao (Volcengine Ark) when configured, else
      // Gemini. Opt out with options.rewriteContext=false.
      const rewriteModel = reqOpts.rewriteContext === false ? null : createTextModelFn({ geminiModel: process.env.GEMINI_GEN1_MODEL ?? "gemini-3-flash-preview", timeoutMs: Number(process.env.GEMINI_GEN1_TIMEOUT_MS ?? 600000), responseFormat: "text" }) ?? null;
      // When Doubao is the primary text model, add a Gemini fallback for the rewrite — a lite model is flaky at
      // faithfully re-theming a whole single-file capsule, and a failed rewrite would otherwise ship SOURCE copy.
      const rewriteFallbackModel = rewriteModel && createDoubaoModelFn({ responseFormat: "text" }) ? createGeminiModelFn({ model: process.env.GEMINI_GEN1_MODEL ?? "gemini-3.1-pro-preview", timeoutMs: Number(process.env.GEMINI_GEN1_TIMEOUT_MS ?? 600000), responseFormat: "text" }) ?? null : null;
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
        doRender: doRender && (reqOpts.autoRender ?? true) !== false,
        rewriteModel,
        rewriteFallbackModel,
        assetVisionFn: userAssetVisionFn,
        slotAssignments
      });
      return finishSameTemplate(res, generationId, capsule, st, stOptions, outDirST);
    }

    const allElements = kb.list();
    const selectedElements = selectedElementIds
      ? allElements.filter((e) => selectedElementIds.includes(e.id))
      : allElements;
    if (!selectedElements.length) return fail(res, 400, "no KB elements selected/available; run /learn-samples first");

    const outDir = genDir(generationId);
    const gen2Model = options.runGen2Ai === true ? createTextModelFn() ?? undefined : undefined;
    const requestedGen2RemotionCodegen = options.runGen2RemotionCodegen === true;
    const gen2RemotionModel = requestedGen2RemotionCodegen
      ? createDoubaoModelFn({
          timeoutMs: Number(process.env.GEN2_REMOTION_TIMEOUT_MS ?? process.env.DOUBAO_TIMEOUT_MS ?? 180000),
          temperature: 0.2
        }) ?? undefined
      : undefined;

    // Beat grid + audio power curve (for procedural fallback rhythm) from the first selected element's learned evidence.
    const sampleId = selectedElements[0]?.source.sourceSampleId;
    let beatGrid: { bpm?: number | null; beats?: number[]; strongBeats?: number[]; energyCurve?: Array<{ t: number; value: number }> } | undefined;
    if (sampleId) {
      const ev = await readJsonIf(path.join(learnDir(sampleId), "evidence-timeline-v5.json"));
      const ae = (ev as { audioEvidence?: { bpm?: number; beatGridSec?: number[]; onsetsSec?: number[]; energyCurve?: Array<{ t: number; value: number }> } } | undefined)?.audioEvidence;
      if (ae) beatGrid = { bpm: ae.bpm ?? null, beats: ae.beatGridSec ?? [], strongBeats: ae.onsetsSec ?? [], energyCurve: ae.energyCurve ?? [] };
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
      gen2RemotionModel,
      beatGrid,
      allowExternalProvider: options.materialFill === "aigc",
      resolveAssetUri: (assetId) => `/api/v5/assets/${assetId}/media`,
      publicPathPrefix: materialsPublicPrefix,
      materialFillMaxGenerated: typeof options.materialFillMax === "number" ? options.materialFillMax : 4,
      env: process.env
    });
    if (requestedGen2RemotionCodegen && !gen2RemotionModel) {
      create.warnings.push("Gen2 Remotion codegen requested but Doubao/Ark text model is not configured.");
    }

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
      const serveSrc = (uri: string) => uri.startsWith("http") ? uri : uri.startsWith("/") ? `http://127.0.0.1:${port}${uri}` : uri;
      for (const a of create.finalProgram.renderRecipe.assets) {
        if (a.uri) assetMap[a.id] = { src: serveSrc(a.uri) };
      }
      let render:
        | Awaited<ReturnType<typeof renderFinalVideoV5>>
        | Awaited<ReturnType<typeof renderTemplateCapsule>>;
      if (create.finalProgram.renderMode === "bespoke_codegen") {
        const capsule = finalProgramToGen2RemotionCapsule(create.finalProgram, create.composition, selectedElements);
        const fixture = create.finalProgram.remotionProject.fixture && typeof create.finalProgram.remotionProject.fixture === "object"
          ? create.finalProgram.remotionProject.fixture as Record<string, unknown>
          : {};
        render = await renderTemplateCapsule({
          capsule,
          boundProps: {
            ...fixture,
            recipe: create.finalProgram.renderRecipe,
            assetMap,
            brief,
            sections: create.composition.sections,
            stylePlan: create.composition.stylePlan,
            audioPlan: create.composition.audioPlan
          },
          outPath,
          aspectRatio: brief.aspectRatio ?? "9:16",
          proceduralAudio: true,
          bpm: beatGrid?.bpm ?? null,
          beatGridSec: beatGrid?.beats,
          strongBeatsSec: beatGrid?.strongBeats,
          energyCurve: beatGrid?.energyCurve,
          hitTimes: create.finalProgram.renderRecipe.audioLayers.flatMap((a) => a.kind === "sfx" && a.id !== "sfx_riser" ? a.cueAlignSec ?? [] : []),
          riserTime: create.finalProgram.renderRecipe.audioLayers.find((a) => a.id === "sfx_riser")?.cueAlignSec?.[0]
        });
        if (!render.ok) {
          create.warnings.push(`Gen2 Remotion render failed; rendered library recipe fallback instead: ${render.error ?? "unknown error"}`);
          render = await renderFinalVideoV5({
            finalProgram: create.finalProgram,
            outPath,
            proceduralAudio: true,
            bpm: beatGrid?.bpm ?? null,
            beatGridSec: beatGrid?.beats,
            strongBeatsSec: beatGrid?.strongBeats,
            energyCurve: beatGrid?.energyCurve,
            assetMap
          });
        }
      } else {
        render = await renderFinalVideoV5({
          finalProgram: create.finalProgram,
          outPath,
          proceduralAudio: true,
          bpm: beatGrid?.bpm ?? null,
          beatGridSec: beatGrid?.beats,
          strongBeatsSec: beatGrid?.strongBeats,
          energyCurve: beatGrid?.energyCurve,
          assetMap
        });
      }
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
      renderProps: buildV5RenderInputProps(create.finalProgram),
      warnings: create.warnings
    };
    await fs.writeFile(path.join(outDir, "generation-result.json"), JSON.stringify(result, null, 2));
    return ok(res, result);
  };

  router.post("/generations/plan", (req, res) => buildGeneration(req, res, false));
  router.post("/generations", (req, res) => buildGeneration(req, res, true));

  // ---- Revise (modify_template): patch-first re-theme/re-copy of a prior same_template generation ----
  const runTemplateRevise = async (
    res: Response,
    baseGenerationId: string,
    patch: v5.TemplatePatchSet,
    extra: Record<string, unknown> = {}
  ) => {
    const prior = (await readJsonIf(path.join(genDir(baseGenerationId), "generation-result.json"))) as { generationMode?: string; projectId?: string; templateInstance?: v5.TemplateInstance } | undefined;
    if (!prior?.templateInstance) return fail(res, 400, "no same_template instance for this generation id");
    const instance = prior.templateInstance;
    const capsule = kb.getTemplateCapsule(instance.templateCapsuleId);
    if (!capsule) return fail(res, 404, "the template capsule for this generation no longer exists");
    if (patch.regenerateImages) return fail(res, 400, "regenerateImages: start a fresh POST /generations with the new brief — revise is patch-first (theme/copy/palette, reuses prior visuals).");
    const generationId = `${baseGenerationId}_rev_${Date.now().toString(36)}`;
    const outDirST = genDir(generationId);
    const brief: v5.CreativeBriefV5 = { ...instance.creativeBrief, ...(patch.theme ? { theme: patch.theme } : {}) };
    const stOptions: v5.GenerationOptionsV5 = { ...v5.DEFAULT_GENERATION_OPTIONS_V5, generationMode: "modify_template" };
    const sampleVideoPath = (await getAssets()).find((a) => a.id === capsule.sourceSampleId)?.path;
    const port = Number(process.env.APP_PORT ?? 3000);
    // Re-rewrite the capsule code (Doubao) only when the patch carries creative knobs (rhythm/text/packaging)
    // — a pure theme/copy/palette revise stays fast (prop-only reuse of prior visuals).
    const patchHasKnobs = Boolean(patch.rhythm || patch.textDensity || patch.motionIntensity || patch.paletteMood || patch.hookRatio != null || patch.ctaAdvanceSec != null);
    const reviseRewriteModel = patchHasKnobs ? createTextModelFn({ geminiModel: process.env.GEMINI_GEN1_MODEL ?? "gemini-3-flash-preview", timeoutMs: Number(process.env.GEMINI_GEN1_TIMEOUT_MS ?? 600000), responseFormat: "text" }) ?? null : null;
    const reviseFallbackModel = reviseRewriteModel && createDoubaoModelFn({ responseFormat: "text" }) ? createGeminiModelFn({ model: process.env.GEMINI_GEN1_MODEL ?? "gemini-3.1-pro-preview", timeoutMs: Number(process.env.GEMINI_GEN1_TIMEOUT_MS ?? 600000), responseFormat: "text" }) ?? null : null;
    const st = await runSameTemplateGeneration({
      projectId: String(extra.projectId ?? "proj_v5_ui"),
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
      reviseFrom: { instance, patch },
      rewriteModel: reviseRewriteModel,
      rewriteFallbackModel: reviseFallbackModel
    });
    return finishSameTemplate(res, generationId, capsule, st, stOptions, outDirST, { revisedFrom: baseGenerationId, patch, ...extra });
  };

  const patchFromInstruction = async (instruction: string, instance: v5.TemplateInstance): Promise<{ patch: v5.TemplatePatchSet; patchNotes: string[]; modelUsed: boolean; warnings: string[] }> => {
    const warnings: string[] = [];
    const copy = (instance.boundProps as { copy?: Record<string, string> } | undefined)?.copy ?? {};
    const headlineKey = Object.keys(copy).find((k) => /headline|hook|title/i.test(k)) ?? Object.keys(copy)[0] ?? "headline";
    const instructionText = instruction.trim();
    const model = createTextModelFn({ geminiModel: process.env.GEMINI_GEN1_MODEL ?? "gemini-3-flash-preview", timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 120000) }) ?? null;
    if (model) {
      try {
        const raw = await model(
          `Convert this natural-language video revision into a safe TemplatePatchSet. Do not edit code. ` +
          `Allowed JSON keys: theme?: string, palette?: string[], copyOverrides?: object, ` +
          `rhythm?: "aggressive"|"balanced"|"slow", textDensity?: "dense"|"medium"|"minimal", ` +
          `motionIntensity?: "high"|"medium"|"low", hookRatio?: number(0.5-1.2), ctaAdvanceSec?: number(0-2), ` +
          `paletteMood?: "bold"|"premium"|"clean"|"energetic". ` +
          `Map intent: "更抓人/开头更冲/hook"->{rhythm:"aggressive",hookRatio:0.6}; "减少字幕/精简"->{textDensity:"minimal"}; ` +
          `"更高级/更质感/premium"->{paletteMood:"premium",motionIntensity:"low",rhythm:"slow"}; "节奏更快/更燃"->{rhythm:"aggressive",motionIntensity:"high"}; "CTA提前/把购买信息提前"->{ctaAdvanceSec:1}. ` +
          `Existing theme: ${JSON.stringify(instance.creativeBrief.theme ?? instance.creativeBrief.prompt ?? "")}. ` +
          `Existing copy keys: ${JSON.stringify(Object.keys(copy))}. ` +
          `Instruction: ${instructionText}. ` +
          `Return ONLY JSON: {"patch":{...},"patchNotes":["..."]}`
        );
        const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
        if (s >= 0 && e > s) {
          const parsed = JSON.parse(raw.slice(s, e + 1)) as { patch?: v5.TemplatePatchSet; patchNotes?: string[] };
          const pp = parsed.patch ?? {};
          const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
          const patch: v5.TemplatePatchSet = {
            ...(typeof pp.theme === "string" ? { theme: pp.theme } : {}),
            ...(Array.isArray(pp.palette) ? { palette: pp.palette.map(String).slice(0, 6) } : {}),
            ...(pp.copyOverrides && typeof pp.copyOverrides === "object" ? { copyOverrides: pp.copyOverrides } : {}),
            ...(oneOf(pp.rhythm, ["aggressive", "balanced", "slow"] as const) ? { rhythm: pp.rhythm } : {}),
            ...(oneOf(pp.textDensity, ["dense", "medium", "minimal"] as const) ? { textDensity: pp.textDensity } : {}),
            ...(oneOf(pp.motionIntensity, ["high", "medium", "low"] as const) ? { motionIntensity: pp.motionIntensity } : {}),
            ...(oneOf(pp.paletteMood, ["bold", "premium", "clean", "energetic"] as const) ? { paletteMood: pp.paletteMood } : {}),
            ...(typeof pp.hookRatio === "number" ? { hookRatio: Math.max(0.5, Math.min(1.2, pp.hookRatio)) } : {}),
            ...(typeof pp.ctaAdvanceSec === "number" ? { ctaAdvanceSec: Math.max(0, Math.min(2, pp.ctaAdvanceSec)) } : {})
          };
          if (Object.keys(patch).length) return { patch, patchNotes: Array.isArray(parsed.patchNotes) ? parsed.patchNotes.map(String).slice(0, 8) : ["structured TemplatePatchSet generated"], modelUsed: true, warnings };
        }
      } catch (err) {
        warnings.push(`natural-language model parse failed: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
      }
    }

    const lower = instructionText.toLowerCase();
    const patch: v5.TemplatePatchSet = {};
    const patchNotes: string[] = [];
    if (/主题|theme|换成|改成/.test(instructionText)) {
      const themeMatch = instructionText.match(/(?:主题|theme|换成|改成)[:：]?\s*([^，,。.\n]+)/i);
      if (themeMatch?.[1]?.trim()) {
        patch.theme = themeMatch[1].trim().slice(0, 80);
        patchNotes.push(`theme -> ${patch.theme}`);
      }
    }
    if (/hook|开头|抓人|吸引|更强|冲击|scroll/.test(lower)) {
      const theme = patch.theme ?? instance.creativeBrief.theme ?? instance.creativeBrief.prompt ?? "this offer";
      patch.copyOverrides = { ...(patch.copyOverrides ?? {}), [headlineKey]: `Stop scrolling: ${theme}`.slice(0, 72) };
      patchNotes.push(`hook copy strengthened on ${headlineKey}`);
    }
    if (/cta|结尾|行动|购买|转化|conversion/.test(lower)) {
      const ctaKey = Object.keys(copy).find((k) => /cta|button|action/i.test(k)) ?? "cta";
      patch.copyOverrides = { ...(patch.copyOverrides ?? {}), [ctaKey]: "Try it today" };
      patchNotes.push(`CTA copy strengthened on ${ctaKey}`);
    }
    if (/高级|质感|克制|premium|quality|minimal/.test(lower)) {
      patch.palette = ["#F8FAFC", "#111827", "#2563EB", "#14B8A6"];
      patchNotes.push("palette shifted to cleaner high-quality style");
    }
    if (!patch.theme && !patch.palette && !patch.copyOverrides) {
      patch.copyOverrides = { [headlineKey]: instructionText.slice(0, 72) };
      patchNotes.push(`used instruction as replacement copy on ${headlineKey}`);
    }
    return { patch, patchNotes, modelUsed: false, warnings };
  };

  router.post("/generations/:id/revise", async (req, res) => {
    try {
      const patch: v5.TemplatePatchSet = req.body?.patch ?? {};
      return runTemplateRevise(res, req.params.id, patch, { projectId: req.body?.projectId ?? "proj_v5_ui" });
    } catch (err) {
      return fail(res, 500, `revise failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  router.post("/generations/:id/revise-natural-language", async (req, res) => {
    try {
      const instruction = String(req.body?.instruction ?? "").trim();
      if (!instruction) return fail(res, 400, "instruction required");
      const prior = (await readJsonIf(path.join(genDir(req.params.id), "generation-result.json"))) as { templateInstance?: v5.TemplateInstance } | undefined;
      if (!prior?.templateInstance) return fail(res, 400, "no same_template instance for this generation id");
      const patchPlan = await patchFromInstruction(instruction, prior.templateInstance);
      return runTemplateRevise(res, req.params.id, patchPlan.patch, {
        projectId: req.body?.projectId ?? "proj_v5_ui",
        naturalLanguageInstruction: instruction,
        generatedPatch: patchPlan.patch,
        patchNotes: patchPlan.patchNotes,
        patchModelUsed: patchPlan.modelUsed,
        patchWarnings: patchPlan.warnings
      });
    } catch (err) {
      return fail(res, 500, `natural-language revise failed: ${err instanceof Error ? err.message : String(err)}`);
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
