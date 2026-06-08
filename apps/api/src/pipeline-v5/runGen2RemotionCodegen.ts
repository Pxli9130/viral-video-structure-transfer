// pipeline-v5/runGen2RemotionCodegen.ts
// Optional Gen2 language-to-language Remotion codegen for mix_elements.
// It generates a props-driven TSX code bundle from the already-safe CompositionProgram + RenderRecipeV5.
// The existing library_composition program remains the fallback and is untouched unless this stage validates.

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";

export interface Gen2RemotionCodegenResult {
  finalProgram: v5.FinalVideoProgram;
  usedAi: boolean;
  warnings: string[];
  raw?: string;
  capsule?: v5.RemotionTemplateCapsule;
}

interface Gen2CodegenJson {
  codeBundle?: {
    entryFile?: string;
    componentName?: string;
    files?: Array<{ path?: string; content?: string }>;
  };
  notes?: string[];
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

function asStrings(v: unknown, max = 8): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];
}

function compactElement(e: v5.KnowledgeElement): Record<string, unknown> {
  return {
    id: e.id,
    kind: e.kind,
    category: e.category,
    subcategory: e.subcategory,
    name: e.name,
    description: e.description,
    tags: e.tags,
    reusablePolicy: e.reusablePolicy,
    slots: e.slots.map((s) => ({ id: s.id, kind: s.kind, required: s.required, sectionId: s.sectionId })),
    style: e.style,
    payload: {
      motion: e.payload?.motion,
      motionMotifs: e.payload?.motionMotifs,
      transitions: e.payload?.transitions,
      layout: e.payload?.layout,
      typography: e.payload?.typography,
      category: e.payload?.category,
      subcategory: e.payload?.subcategory
    },
    retrievalText: e.signatures?.retrievalText
  };
}

function templateRole(role: string): v5.TemplateSectionRole {
  return ["hook", "setup", "benefit", "proof", "demo", "transition", "cta"].includes(role)
    ? role as v5.TemplateSectionRole
    : "other";
}

function slotKind(kind: string): v5.TemplateSlotKind {
  if (kind === "hero" || kind === "hero_head") return "hero_image";
  if (kind === "hero_product" || kind === "product_closeup") return "product_image";
  if (kind === "background") return "background_image";
  if (kind === "logo") return "logo";
  if (kind === "main_title") return "headline";
  if (kind === "subtitle_text") return "subtitle";
  if (kind === "cta_card") return "cta_text";
  if (kind === "voiceover") return "voiceover";
  if (kind === "sfx") return "sfx";
  if (kind === "audio_pattern") return "music";
  return "other";
}

function replacementPolicy(policy: string | undefined, kind: string): v5.TemplateSlotReplacementPolicy {
  if (policy === "target_asset") return "user_asset";
  if (policy === "text_fallback" || kind === "main_title" || kind === "subtitle_text" || kind === "cta_card") return "text_generate";
  if (policy === "generate") return "aigc_generate";
  if (policy === "optional") return "optional";
  return "procedural_generate";
}

function buildSlotSchema(comp: v5.CompositionProgram): v5.TemplateSlot[] {
  return comp.slotPlan.map((slot) => ({
    id: slot.id,
    kind: slotKind(String(slot.kind)),
    required: Boolean(slot.required),
    originalRole: `${slot.kind} in ${slot.sectionId ?? "composition"}`,
    replacementPolicy: replacementPolicy(slot.preferredFill, String(slot.kind)),
    propPath: `recipe.layers.${slot.id}_layer`,
    description: `Use the render recipe layer for slot ${slot.id}.`
  }));
}

function fixtureFromProgram(finalProgram: v5.FinalVideoProgram, comp: v5.CompositionProgram): Record<string, unknown> {
  const assetMap: Record<string, { src: string }> = {};
  for (const a of finalProgram.renderRecipe.assets) assetMap[a.id] = { src: a.uri };
  return {
    recipe: finalProgram.renderRecipe,
    assetMap,
    brief: comp.creativeBrief,
    sections: comp.sections,
    stylePlan: comp.stylePlan,
    audioPlan: comp.audioPlan
  };
}

export function finalProgramToGen2RemotionCapsule(
  finalProgram: v5.FinalVideoProgram,
  comp: v5.CompositionProgram,
  selectedElements: v5.KnowledgeElement[] = []
): v5.RemotionTemplateCapsule {
  const recipe = finalProgram.renderRecipe;
  const motifs = Array.from(new Set([
    ...selectedElements.flatMap((e) => asStrings(e.payload?.motionMotifs ?? e.payload?.motion, 6)),
    ...recipe.layers.flatMap((l) => Object.keys((l.motion ?? {}) as Record<string, unknown>))
  ])).slice(0, 12);
  const transitionTypes = Array.from(new Set(recipe.layers.filter((l) => l.type === "transition").map((l) => String(l.style?.type ?? l.id)))).slice(0, 12);
  const typographyAnimationTypes = Array.from(new Set(recipe.layers.filter((l) => l.type === "text" || l.type === "packaging").map((l) => String((l.style as Record<string, unknown> | undefined)?.kineticText ? "kinetic" : "standard")))).slice(0, 8);
  const sourceSampleId = selectedElements[0]?.source.sourceSampleId ?? "mix_elements";
  const validationWarnings = finalProgram.validation.warnings ?? [];
  return {
    id: `tpl_gen2_${finalProgram.id.replace(/^fvp_/, "")}`,
    sourceSampleId,
    projectId: comp.projectId,
    name: `Gen2 Remotion ${comp.generationId ?? comp.id}`,
    description: "AI-generated props-driven Remotion code for a mixed KB-element composition.",
    tags: ["gen2", "mix_elements", "remotion_codegen"],
    codeBundle: {
      entryFile: finalProgram.remotionProject.entryFile,
      componentName: finalProgram.remotionProject.componentName,
      files: finalProgram.remotionProject.files
    },
    propsSchema: finalProgram.remotionProject.propsSchema as Record<string, unknown>,
    slotSchema: buildSlotSchema(comp),
    timingSignature: {
      durationSec: recipe.composition.durationSec,
      fps: recipe.composition.fps,
      sections: comp.sections.map((s) => ({
        id: s.id,
        role: templateRole(s.role),
        startSec: s.startSec,
        endSec: s.endSec,
        internalBeats: (comp.audioPlan.cues ?? []).filter((c) => c.t >= s.startSec && c.t <= s.endSec).map((c) => Number(c.t.toFixed(2)))
      }))
    },
    motionSignature: {
      motifs,
      transitionTypes,
      typographyAnimationTypes,
      beatSyncedCueCount: (comp.audioPlan.cues ?? []).length,
      activeMotionCoverage: recipe.layers.length ? recipe.layers.filter((l) => l.type !== "audio" && (l.motion || l.type === "media" || l.type === "generated_visual" || l.type === "transition")).length / recipe.layers.length : 0
    },
    assetRecipes: selectedElements.flatMap((e) => e.assetRecipe ? [e.assetRecipe] : []),
    audioRecipes: selectedElements.flatMap((e) => e.audioRecipe ? [e.audioRecipe] : []),
    fixtures: { neutralFixture: fixtureFromProgram(finalProgram, comp) },
    safety: {
      sampleVideoPassthroughAllowed: false,
      samplePixelsReusable: false,
      sampleAudioReusable: false,
      sampleTextReusable: false,
      onlyTemplateCodeReusable: true
    },
    quality: {
      compilePassed: finalProgram.validation.tsCompilePassed,
      renderPreviewPassed: false,
      noCopyTemplatePassed: finalProgram.validation.noCopyPassed,
      codeOrigin: "ai",
      recipeSource: "fallback",
      warnings: validationWarnings
    }
  };
}

export function buildGen2RemotionCodegenPrompt(
  comp: v5.CompositionProgram,
  deterministic: v5.FinalVideoProgram,
  selectedElements: v5.KnowledgeElement[]
): string {
  const recipe = deterministic.renderRecipe;
  const payload = {
    brief: comp.creativeBrief,
    composition: {
      id: comp.id,
      durationSec: comp.composition.durationSec,
      fps: comp.composition.fps,
      width: comp.composition.width,
      height: comp.composition.height,
      aspectRatio: comp.composition.aspectRatio
    },
    sections: comp.sections,
    stylePlan: comp.stylePlan,
    slotPlan: comp.slotPlan,
    audioPlan: comp.audioPlan,
    renderRecipe: recipe,
    selectedElements: selectedElements.map(compactElement)
  };
  return `You are Gen2 Remotion codegen. Generate a single props-driven Remotion TSX component from this safe composition plan.

Hard constraints:
- Return ONLY raw valid JSON, no markdown.
- Generate code for entryFile "index.tsx" and componentName "GeneratedComposition".
- The component must be exported as: export const GeneratedComposition = ...
- Imports may come only from "react" and "remotion".
- Do not use fetch, XMLHttpRequest, require, process, fs, eval, dynamic import, staticFile, literal http URLs, literal media URLs, or sample/original asset paths.
- Do not hardcode product claims or sample copy. Use props.recipe layers, props.brief, props.sections, props.stylePlan, and props.assetMap.
- For every media/generated_visual layer with assetId, read the source as props.assetMap[layer.assetId]?.src. If missing, render a procedural visual from the layer style; do not invent a URL.
- Respect recipe timing. Use Sequence, useCurrentFrame, useVideoConfig, interpolate, and CSS transforms/opacity for motion.
- Render text from recipe layer text or section plannedText only. Keep text inside frame safe areas.
- The code must not need external files or libraries beyond React and Remotion.

Expected JSON shape:
{
  "codeBundle": {
    "entryFile": "index.tsx",
    "componentName": "GeneratedComposition",
    "files": [{ "path": "index.tsx", "content": "<complete TSX source>" }]
  },
  "notes": ["short implementation notes"]
}

Input plan:
${JSON.stringify(payload)}`;
}

function normalizeCodeBundle(raw: unknown): v5.RemotionTemplateCapsule["codeBundle"] {
  const obj = raw as Gen2CodegenJson;
  const cb = obj.codeBundle;
  const entryFile = cb?.entryFile === "index.tsx" ? cb.entryFile : "index.tsx";
  const componentName = cb?.componentName === "GeneratedComposition" ? cb.componentName : "GeneratedComposition";
  const files = (cb?.files ?? [])
    .filter((f): f is { path: string; content: string } => typeof f?.path === "string" && typeof f?.content === "string")
    .map((f) => ({ path: f.path, content: f.content }));
  if (!files.length) throw new Error("missing codeBundle.files");
  const entry = files.find((f) => f.path === entryFile);
  if (!entry) throw new Error("missing entry file index.tsx");
  if (!/\bexport\s+(?:const|function)\s+GeneratedComposition\b/.test(entry.content)) {
    throw new Error("entry file does not export GeneratedComposition as a named component");
  }
  return { entryFile, componentName, files };
}

function buildFinalWithCode(
  deterministic: v5.FinalVideoProgram,
  comp: v5.CompositionProgram,
  codeBundle: v5.RemotionTemplateCapsule["codeBundle"],
  notes: string[]
): v5.FinalVideoProgram {
  const fixture = fixtureFromProgram(deterministic, comp);
  return {
    ...deterministic,
    remotionProject: {
      entryFile: codeBundle.entryFile,
      componentName: codeBundle.componentName,
      files: codeBundle.files,
      propsSchema: {
        type: "object",
        required: ["recipe", "assetMap"],
        properties: {
          recipe: { type: "object" },
          assetMap: { type: "object" },
          brief: { type: "object" },
          sections: { type: "array" },
          stylePlan: { type: "object" },
          audioPlan: { type: "object" }
        }
      },
      fixture,
      allowedImports: ["react", "remotion"]
    },
    explanation: {
      ...deterministic.explanation,
      gapFillDecisions: [...deterministic.explanation.gapFillDecisions, "Gen2 Remotion codegen produced a props-driven bespoke component."]
    },
    validation: {
      ...deterministic.validation,
      warnings: [...(deterministic.validation.warnings ?? []), ...notes]
    },
    renderMode: "bespoke_codegen",
    fallbackUsed: false,
    fallbackReason: undefined
  };
}

export async function runGen2RemotionCodegen(input: {
  composition: v5.CompositionProgram;
  deterministic: v5.FinalVideoProgram;
  selectedElements: v5.KnowledgeElement[];
  model: Gen1ModelFn;
}): Promise<Gen2RemotionCodegenResult> {
  const warnings: string[] = [];
  let raw: string;
  try {
    raw = await input.model(buildGen2RemotionCodegenPrompt(input.composition, input.deterministic, input.selectedElements));
  } catch (err) {
    warnings.push(`Gen2 Remotion codegen model call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { finalProgram: input.deterministic, usedAi: false, warnings };
  }

  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    warnings.push(`Gen2 Remotion codegen invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return { finalProgram: input.deterministic, usedAi: false, warnings, raw };
  }

  let codeBundle: v5.RemotionTemplateCapsule["codeBundle"];
  try {
    codeBundle = normalizeCodeBundle(parsed);
  } catch (err) {
    warnings.push(`Gen2 Remotion codegen malformed codeBundle: ${err instanceof Error ? err.message : String(err)}`);
    return { finalProgram: input.deterministic, usedAi: false, warnings, raw };
  }

  const notes = asStrings((parsed as Gen2CodegenJson).notes, 12);
  const finalProgram = buildFinalWithCode(input.deterministic, input.composition, codeBundle, notes);
  let capsule = finalProgramToGen2RemotionCapsule(finalProgram, input.composition, input.selectedElements);
  const capsuleValidation = validateTemplateCapsule(capsule);
  capsule = {
    ...capsule,
    quality: {
      ...capsule.quality,
      compilePassed: capsuleValidation.passed,
      noCopyTemplatePassed: capsuleValidation.passed,
      warnings: [...capsule.quality.warnings, ...capsuleValidation.warnings]
    }
  };
  const checkedFinal: v5.FinalVideoProgram = {
    ...finalProgram,
    validation: {
      ...finalProgram.validation,
      schemaPassed: true,
      tsCompilePassed: capsuleValidation.passed,
      noCopyPassed: capsuleValidation.passed,
      warnings: [...finalProgram.validation.warnings, ...capsuleValidation.warnings]
    }
  };
  const finalCheck = v5.validateFinalVideoProgram(checkedFinal);
  const recipeNoSample = !/sample_assets|sample_video|sample\//i.test(JSON.stringify(checkedFinal.renderRecipe));
  if (!capsuleValidation.passed || !finalCheck.valid || !recipeNoSample) {
    warnings.push(`Gen2 Remotion codegen validation failed (capsule=${capsuleValidation.passed} final=${finalCheck.valid} noSample=${recipeNoSample}); keeping library composition.`);
    warnings.push(...capsuleValidation.errors, ...finalCheck.errors);
    return { finalProgram: input.deterministic, usedAi: false, warnings, raw, capsule };
  }

  return {
    finalProgram: checkedFinal,
    usedAi: true,
    warnings: [...warnings, ...capsuleValidation.warnings],
    raw,
    capsule
  };
}
