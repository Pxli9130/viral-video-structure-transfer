// pipeline-v5/runGen2Ai.ts
// AI Gen2: refine the deterministic compose recipe with better creative — on-screen COPY per text
// layer and an optional harmonized palette — WITHOUT touching structure, timing, assets, or audio
// (those stay deterministic so the no-copy guarantee and renderability are preserved). The model
// returns a small patch; we merge, re-validate, and fall back to the deterministic recipe on failure.
// Injected model fn keeps this offline-testable; the real Gemini fn is createGeminiModelFn.

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";

export interface Gen2AiResult {
  finalProgram: v5.FinalVideoProgram;
  usedAi: boolean;
  warnings: string[];
  raw?: string;
}

interface Gen2Patch {
  layers?: Array<{ id: string; text?: string }>;
  palette?: string[];
}

function textLayers(recipe: v5.RenderRecipeV5): v5.RenderLayer[] {
  return recipe.layers.filter((l) => l.type === "text" || (l.type === "packaging" && typeof l.text === "string"));
}

export function buildGen2Prompt(comp: v5.CompositionProgram, recipe: v5.RenderRecipeV5, repairNote?: string): string {
  const brief = comp.creativeBrief;
  const layers = textLayers(recipe).map((l) => {
    const section = comp.sections.find((s) => s.id === l.sectionId);
    return { id: l.id, role: section?.role ?? "body", current: l.text ?? "" };
  });
  return `You are Gen2, a short-form video copywriter. Improve the on-screen TEXT for each layer so it
fits the brief and reads as punchy, high-retention ad copy. Keep each line short (<= 7 words for hooks,
<= 10 for body). Do NOT invent claims; stay consistent with the brief. Return ONLY JSON.

BRIEF: ${JSON.stringify({ theme: brief.theme, prompt: brief.prompt, variant: brief.variant, sellingPoints: brief.sellingPoints })}
STYLE: pacing=${comp.stylePlan.pacing} typography=${comp.stylePlan.typographySystem}
TEXT LAYERS (id, section role, current copy):
${layers.map((l) => `- ${l.id} [${l.role}]: ${JSON.stringify(l.current)}`).join("\n")}

Return:
{ "layers": [ { "id": "<layerId>", "text": "<improved copy>" } ${""}],
  "palette": ["#hex", "#hex", "#hex"]  // optional harmonized palette (3-5 colors), or omit
}
Only include layer ids from the list above. ${repairNote ?? ""}`;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;

function applyPatch(finalProgram: v5.FinalVideoProgram, patch: Gen2Patch): v5.FinalVideoProgram {
  const recipe = finalProgram.renderRecipe;
  const textById = new Map((patch.layers ?? []).filter((l) => l && l.id && typeof l.text === "string").map((l) => [l.id, l.text as string]));
  const allowed = new Set(textLayers(recipe).map((l) => l.id));
  const layers = recipe.layers.map((l) => {
    if (allowed.has(l.id) && textById.has(l.id)) {
      const next = textById.get(l.id) as string;
      return { ...l, text: next.slice(0, 120) };
    }
    return l;
  });
  const palette = Array.isArray(patch.palette) ? patch.palette.filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 5) : [];
  const composition = palette.length >= 2 ? { ...recipe.composition, background: palette[0] } : recipe.composition;
  const newRecipe: v5.RenderRecipeV5 = {
    ...recipe,
    composition,
    layers,
    explanations: [...(recipe.explanations ?? []), "AI Gen2 refined on-screen copy" + (palette.length ? " + palette" : "") + "."]
  };
  return {
    ...finalProgram,
    renderRecipe: newRecipe,
    explanation: { ...finalProgram.explanation, gapFillDecisions: [...finalProgram.explanation.gapFillDecisions, "Gen2 AI copy refinement applied."] },
    fallbackUsed: false,
    fallbackReason: undefined
  };
}

/** Refine a deterministic FinalVideoProgram with AI copy/palette; validate + fallback. */
export async function runGen2Ai(
  comp: v5.CompositionProgram,
  deterministic: v5.FinalVideoProgram,
  model: Gen1ModelFn
): Promise<Gen2AiResult> {
  const warnings: string[] = [];
  if (!textLayers(deterministic.renderRecipe).length) {
    return { finalProgram: deterministic, usedAi: false, warnings: ["no text layers to refine"] };
  }
  let raw: string;
  try {
    raw = await model(buildGen2Prompt(comp, deterministic.renderRecipe));
  } catch (err) {
    warnings.push(`Gen2 model call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { finalProgram: deterministic, usedAi: false, warnings };
  }
  let patch: Gen2Patch;
  try {
    patch = extractJson(raw) as Gen2Patch;
  } catch (err) {
    warnings.push(`Gen2 invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { finalProgram: deterministic, usedAi: false, warnings, raw };
  }
  const refined = applyPatch(deterministic, patch);
  const recipeCheck = v5.validateRenderRecipeV5(refined.renderRecipe);
  const progCheck = v5.validateFinalVideoProgram(refined);
  // no-copy invariant must still hold (structure/assets unchanged, but re-check the recipe string).
  const noSample = !/sample_assets|sample_video|sample\//i.test(JSON.stringify(refined.renderRecipe));
  if (recipeCheck.valid && progCheck.valid && noSample) {
    refined.validation = { ...refined.validation, schemaPassed: true, noCopyPassed: true };
    return { finalProgram: refined, usedAi: true, warnings, raw };
  }
  warnings.push(`Gen2 refinement invalid (recipe=${recipeCheck.valid} prog=${progCheck.valid} noSample=${noSample}); keeping deterministic.`);
  return { finalProgram: deterministic, usedAi: false, warnings, raw };
}
