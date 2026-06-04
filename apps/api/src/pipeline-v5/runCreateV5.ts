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
import type { Gen1ModelFn } from "./runGen1Ai.js";

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
    composition: input.composition
  });
  const compCheck = v5.validateCompositionProgram(composition);
  gates.push(gate("V5-G17", compCheck.valid ? "pass" : "fail", compCheck.valid ? undefined : compCheck.errors.join("; ")));

  const gapReport = runGapReportV5(composition, targetProfiles);
  const gapCheck = v5.validateGapReportV5(gapReport);
  gates.push(gate("V5-G18", gapCheck.valid && gapReport.gaps.length ? "pass" : "warn", `${gapReport.gaps.length} gaps`));
  const unresolved = gapReport.gaps.filter((g) => g.status === "missing" && !g.selectedRepair);
  gates.push(gate("V5-G19", unresolved.length === 0 ? "pass" : "warn", `${unresolved.length} slots with no fill strategy`));

  let finalProgram = runGen2ComposeFallback({
    composition,
    gapReport,
    selectedElements: input.selectedElements,
    resolveAssetUri: input.resolveAssetUri
  });
  if (input.gen2Model) {
    const g2 = await runGen2Ai(composition, finalProgram, input.gen2Model);
    if (g2.usedAi) finalProgram = g2.finalProgram;
    else warnings.push(...g2.warnings);
  }
  gates.push(gate("V5-G20", "pass", finalProgram.fallbackUsed ? "deterministic compose fallback" : "ai gen2"));
  const finalCheck = v5.validateFinalVideoProgram(finalProgram);
  gates.push(gate("V5-G21", finalCheck.valid ? "pass" : "fail", finalCheck.valid ? undefined : finalCheck.errors.join("; ")));
  gates.push(gate("V5-G22", finalProgram.validation.tsCompilePassed ? "pass" : "warn", "compose fallback recipe"));

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
