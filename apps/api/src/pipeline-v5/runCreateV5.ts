// pipeline-v5/runCreateV5.ts
// CREATE pipeline orchestrator (deterministic core): target asset analysis -> composition planner ->
// gap report -> Gen2 deterministic compose fallback. Returns all artifacts + create/safety gates.
// The AI planner and AI Gen2 layer on top later by replacing the deterministic outputs when valid.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Asset } from "@vvst/shared";
import { v5 } from "@vvst/shared";
import { runTargetAssetAnalysisMany } from "./runTargetAssetAnalysis.js";
import { runCompositionPlanner } from "./runCompositionPlanner.js";
import { runGapReportV5 } from "./runGapReportV5.js";
import { runGen2ComposeFallback } from "./runGen2ComposeFallback.js";
import { runGen2Ai } from "./runGen2Ai.js";
import { runGen2RemotionCodegen } from "./runGen2RemotionCodegen.js";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import { runMaterialFillV5 } from "./runMaterialFillV5.js";

const VISUAL_SLOT_KINDS = new Set<v5.PlaceholderKindV5>(["hero", "hero_head", "hero_product", "product_closeup", "background", "logo"]);

function gate(id: string, status: v5.GateStatus, message?: string): v5.ScorecardGate {
  const def = v5.getGateDef(id);
  return { id, name: def?.name ?? id, status, priority: def?.priority, message };
}

export interface CreateInput {
  projectId: string;
  generationId?: string;
  brief: v5.CreativeBriefV5;
  targetAssets: Asset[];
  selectedElements: v5.KnowledgeElement[];
  composition?: { width?: number; height?: number; fps?: number; aspectRatio?: v5.AspectRatioV5 };
  outDir?: string;
  resolveAssetUri?: (assetId: string) => string;
  /** Optional AI Gen2: refine on-screen copy/palette over the deterministic compose recipe. */
  gen2Model?: Gen1ModelFn;
  /** Optional independent Gen2 Remotion TSX codegen. Leaves the existing library recipe as fallback. */
  gen2RemotionModel?: Gen1ModelFn;
  /** Source evidence beat grid + energy curve for procedural audio fallback (threaded from learn). */
  beatGrid?: { bpm?: number | null; beats?: number[]; strongBeats?: number[]; energyCurve?: Array<{ t: number; value: number }> };
  /** Allow real external image generation (Gemini/Seedream) for visual slots. Default false. */
  allowExternalProvider?: boolean;
  materialFillMaxGenerated?: number;
  /** Public URL prefix under which generated material is served (e.g. /generated/v5/generations/<id>/materials/). */
  publicPathPrefix?: string;
  env?: Record<string, string | undefined>;
}

export interface CreateArtifacts {
  selectionSet: v5.SelectionSet;
  targetProfiles: v5.TargetAssetProfile[];
  composition: v5.CompositionProgram;
  gapReport: v5.GapReportV5;
  finalProgram: v5.FinalVideoProgram;
  gates: v5.ScorecardGate[];
  warnings: string[];
}

export async function runCreateV5(input: CreateInput): Promise<CreateArtifacts> {
  const warnings: string[] = [];
  const gates: v5.ScorecardGate[] = [];

  const selectionSet: v5.SelectionSet = {
    id: `sel_${input.generationId ?? input.projectId}`,
    projectId: input.projectId,
    mode: "manual",
    selected: input.selectedElements.map((e, i) => ({ elementId: e.id, priority: i + 1, reason: e.name })),
    userBrief: input.brief
  };
  gates.push(gate("V5-G15", input.selectedElements.length ? "pass" : "warn", `${input.selectedElements.length} selected`));

  const targetProfiles = runTargetAssetAnalysisMany(input.targetAssets);
  gates.push(gate("V5-G16", targetProfiles.length ? "pass" : "warn", `${targetProfiles.length} profiles`));

  const composition = runCompositionPlanner({
    brief: input.brief,
    selectedElements: input.selectedElements,
    targetProfiles,
    projectId: input.projectId,
    generationId: input.generationId,
    composition: input.composition,
    beatGrid: input.beatGrid
  });
  const compCheck = v5.validateCompositionProgram(composition);
  gates.push(gate("V5-G17", compCheck.valid ? "pass" : "fail", compCheck.valid ? undefined : compCheck.errors.join("; ")));

  const gapReport = runGapReportV5(composition, targetProfiles);
  const gapCheck = v5.validateGapReportV5(gapReport);
  gates.push(gate("V5-G18", gapCheck.valid && gapReport.gaps.length ? "pass" : "warn", `${gapReport.gaps.length} gaps`));

  // Stage 12 — EXECUTE the fills (audit GAP-1): real image (provider) or offline designed visual.
  const materialOut = await runMaterialFillV5({
    composition,
    gapReport,
    projectId: input.projectId,
    generationId: input.generationId ?? input.projectId,
    outDir: path.join(input.outDir ?? ".", "materials"),
    publicPathPrefix: input.publicPathPrefix ?? "",
    allowExternalProvider: input.allowExternalProvider,
    maxGenerated: input.materialFillMaxGenerated,
    env: input.env
  });
  warnings.push(...materialOut.warnings);
  composition.materialPlan = { fills: materialOut.materialFills };

  let finalProgram = runGen2ComposeFallback({
    composition,
    gapReport,
    selectedElements: input.selectedElements,
    resolveAssetUri: input.resolveAssetUri,
    slotFills: materialOut.fills
  });
  if (input.gen2Model) {
    const g2 = await runGen2Ai(composition, finalProgram, input.gen2Model);
    if (g2.usedAi) finalProgram = g2.finalProgram;
    else warnings.push(...g2.warnings);
  }
  if (input.gen2RemotionModel) {
    const g2Code = await runGen2RemotionCodegen({
      composition,
      deterministic: finalProgram,
      selectedElements: input.selectedElements,
      model: input.gen2RemotionModel
    });
    if (g2Code.usedAi) finalProgram = g2Code.finalProgram;
    warnings.push(...g2Code.warnings);
  }
  gates.push(gate("V5-G20", "pass", `${finalProgram.renderMode ?? "library_composition"}${input.gen2Model ? " + ai copy" : ""}${input.gen2RemotionModel ? " + remotion codegen" : ""}`));
  const finalCheck = v5.validateFinalVideoProgram(finalProgram);
  gates.push(gate("V5-G21", finalCheck.valid ? "pass" : "fail", finalCheck.valid ? undefined : finalCheck.errors.join("; ")));
  gates.push(gate("V5-G22", finalProgram.validation.tsCompilePassed ? "pass" : "warn", finalProgram.renderMode ?? "library_composition"));

  // V5-G19 (executed fill) + V5-G41 (visual substance) + V5-G42 (text density): computed from the FINAL recipe.
  const recipe = finalProgram.renderRecipe;
  const layerForSlot = (slotId: string) => recipe.layers.find((l) => l.id === `${slotId}_layer`);
  const isSubstantive = (l?: v5.RenderLayer) =>
    Boolean(l && (l.type === "generated_visual" || (l.type === "media" && l.assetId) || (l.type === "packaging" && l.text)));
  const requiredVisualSlots = composition.slotPlan.filter((s) => VISUAL_SLOT_KINDS.has(s.kind as v5.PlaceholderKindV5) || s.kind === "cta_card");
  const substantiated = requiredVisualSlots.filter((s) => isSubstantive(layerForSlot(s.id)));
  const visualOk = requiredVisualSlots.length > 0 && substantiated.length === requiredVisualSlots.length;
  gates.push(gate("V5-G41", visualOk ? "pass" : requiredVisualSlots.length === 0 ? "warn" : "fail", `${substantiated.length}/${requiredVisualSlots.length} visual slots substantiated`));

  const aigcGaps = gapReport.gaps.filter((g) => g.selectedRepair === "aigc_fill" || (g.status === "missing" && VISUAL_SLOT_KINDS.has((composition.slotPlan.find((s) => s.id === g.slotId)?.kind ?? "") as v5.PlaceholderKindV5)));
  const aigcExecuted = aigcGaps.every((g) => isSubstantive(layerForSlot(g.slotId)));
  gates.push(gate("V5-G19", aigcGaps.length === 0 ? "pass" : aigcExecuted ? "pass" : "fail", `${aigcGaps.filter((g) => isSubstantive(layerForSlot(g.slotId))).length}/${aigcGaps.length} fills executed`));

  const textLayers = recipe.layers.filter((l) => l.type === "text" || (l.type === "packaging" && l.text));
  const textCap = Math.max(4, Math.round((6 * composition.composition.durationSec) / 16));
  const shortText = textLayers.filter((l) => l.endSec - l.startSec < 1.2).length;
  const textDensityOk = textLayers.length <= textCap && shortText === 0;
  gates.push(gate("V5-G42", textDensityOk ? "pass" : "warn", `${textLayers.length} text beats (cap ${textCap}), ${shortText} too-short`));

  // V5-G43 motion coverage: fraction of VISIBLE layers that actually animate (beatTriggers/loop, or
  // a media/generated_visual layer with Ken Burns, or a transition) — not a static slideshow.
  const visible = recipe.layers.filter((l) => l.type !== "audio" && l.type !== "debug");
  const animates = (l: v5.RenderLayer): boolean => {
    const m = l.motion as { beatTriggers?: unknown[]; loop?: unknown } | undefined;
    if (m && ((Array.isArray(m.beatTriggers) && m.beatTriggers.length > 0) || m.loop)) return true;
    if (l.type === "media" || l.type === "generated_visual" || l.type === "transition") return true; // ken burns / float / flash
    if (l.type === "shape" && (l.style as { variant?: string } | undefined)?.variant === "gradient_bg") return true; // animated gradient
    return false;
  };
  const motionCoverage = visible.length ? visible.filter(animates).length / visible.length : 0;
  gates.push(gate("V5-G43", motionCoverage >= 0.6 ? "pass" : "warn", `${Math.round(motionCoverage * 100)}% of layers animate`));

  // Safety gates: no sample media paths / sample audio in the final recipe.
  const recipeStr = JSON.stringify(finalProgram.renderRecipe);
  const noSamplePixels = !/sample_assets|sample_video|sample\//i.test(recipeStr);
  gates.push(gate("V5-G29", noSamplePixels ? "pass" : "fail", noSamplePixels ? undefined : "sample media path in final recipe"));
  const noSampleAudio = !/sample_audio|sample_assets|sample\//i.test(JSON.stringify(finalProgram.renderRecipe.audioLayers));
  gates.push(gate("V5-G30", noSampleAudio ? "pass" : "fail"));
  gates.push(gate("V5-G32", finalProgram.renderRecipe.assets.every((a) => Boolean(a.provenance)) ? "pass" : "warn", "asset provenance"));

  if (!finalProgram.validation.noCopyPassed) warnings.push("Gen2 no-copy check did not pass.");

  const artifacts: CreateArtifacts = { selectionSet, targetProfiles, composition, gapReport, finalProgram, gates, warnings };

  if (input.outDir) {
    await fs.mkdir(input.outDir, { recursive: true });
    const write = (name: string, data: unknown) => fs.writeFile(path.join(input.outDir as string, name), JSON.stringify(data, null, 2));
    await Promise.all([
      write("selection-set.json", selectionSet),
      write("target-asset-profiles.json", targetProfiles),
      write("composition-program.json", composition),
      write("gap-report.json", gapReport),
      write("final-video-program.json", finalProgram),
      write("render-recipe.json", finalProgram.renderRecipe),
      write("create-gates.json", gates)
    ]);
  }

  return artifacts;
}
