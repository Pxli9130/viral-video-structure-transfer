import { describe, expect, it } from "vitest";
import { v5 } from "@vvst/shared";
import {
  runCompositionPlanner,
  runGapReportV5,
  runGen2ComposeFallback,
  runGen2Ai,
  type Gen1ModelFn
} from "../src/pipeline-v5/index.js";

function buildDeterministic(): { comp: v5.CompositionProgram; finalProgram: v5.FinalVideoProgram } {
  // a structure element so the planner produces real text layers
  const structure: v5.KnowledgeElement = {
    id: "ke_structure",
    kind: "structure_pattern",
    name: "hook-benefit-cta",
    description: "s",
    tags: [],
    source: { sourceSampleId: "smp", reconstructionProgramId: "nrp", evidenceRefs: [] },
    reusablePolicy: "parametric_reuse",
    slots: [],
    payload: { sections: [{ role: "hook", startSec: 0, endSec: 2 }, { role: "cta", startSec: 2, endSec: 6 }] },
    compatibility: { aspectRatios: ["9:16"], verticals: ["marketing"], canCombineWith: [], conflictsWith: [] },
    safety: { noCopyChecked: true, samplePixelsRemoved: true, sampleAudioRemoved: true, sampleTextRemoved: true, renderable: true },
    quality: { confidence: 0.6, usefulness: 0.7 }
  };
  const comp = runCompositionPlanner({
    brief: { theme: "portable fan", variant: "high_click", targetDurationSec: 6, aspectRatio: "9:16", sellingPoints: ["quiet"] },
    selectedElements: [structure],
    targetProfiles: [],
    projectId: "p",
    generationId: "g"
  });
  const gap = runGapReportV5(comp, []);
  const finalProgram = runGen2ComposeFallback({ composition: comp, gapReport: gap, selectedElements: [structure] });
  return { comp, finalProgram };
}

describe("pipeline-v5 AI Gen2 (injected model fn, offline)", () => {
  it("applies AI copy + palette and keeps the recipe valid", async () => {
    const { comp, finalProgram } = buildDeterministic();
    const textLayerId = finalProgram.renderRecipe.layers.find((l) => l.type === "text")?.id;
    expect(textLayerId).toBeTruthy();
    const model: Gen1ModelFn = async () =>
      JSON.stringify({ layers: [{ id: textLayerId, text: "Silence that cools" }], palette: ["#101820", "#FFFFFF", "#00C2FF"] });
    const out = await runGen2Ai(comp, finalProgram, model);
    expect(out.usedAi).toBe(true);
    expect(v5.validateFinalVideoProgram(out.finalProgram).errors).toEqual([]);
    const refined = out.finalProgram.renderRecipe.layers.find((l) => l.id === textLayerId);
    expect(refined?.text).toBe("Silence that cools");
    expect(out.finalProgram.renderRecipe.composition.background).toBe("#101820");
  });

  it("ignores layer ids that are not text layers (no injection of new layers)", async () => {
    const { comp, finalProgram } = buildDeterministic();
    const before = finalProgram.renderRecipe.layers.length;
    const model: Gen1ModelFn = async () => JSON.stringify({ layers: [{ id: "not_a_real_layer", text: "x" }] });
    const out = await runGen2Ai(comp, finalProgram, model);
    expect(out.finalProgram.renderRecipe.layers.length).toBe(before);
  });

  it("falls back to deterministic on garbage / thrown error", async () => {
    const { comp, finalProgram } = buildDeterministic();
    const garbage: Gen1ModelFn = async () => "no json here";
    const thrown: Gen1ModelFn = async () => {
      throw new Error("boom");
    };
    expect((await runGen2Ai(comp, finalProgram, garbage)).usedAi).toBe(false);
    const t = await runGen2Ai(comp, finalProgram, thrown);
    expect(t.usedAi).toBe(false);
    expect(t.warnings.some((w) => w.includes("boom"))).toBe(true);
  });
});
