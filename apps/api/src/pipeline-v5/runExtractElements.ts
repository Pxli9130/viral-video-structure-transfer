// pipeline-v5/runExtractElements.ts
// Stage 5 Element Extractor — deterministic parser over the NeutralReconstructionProgram (typedSpec +
// timingMap + placeholders + recipes). Input is already structured JSON, so no heavy VLM is needed
// (pipeline.md §Stage 6: "deterministic parser first, then a lighter text model"). The optional AI
// namer/classifier layers on top later.

import { v5 } from "@vvst/shared";

function slotsForPlaceholders(program: v5.NeutralReconstructionProgram, sectionIds: string[]): v5.PlaceholderSlotV5[] {
  return program.placeholders.filter((p) => p.sectionId && sectionIds.includes(p.sectionId));
}

export function runExtractElements(program: v5.NeutralReconstructionProgram): v5.CandidateElement[] {
  const out: v5.CandidateElement[] = [];
  const spec = program.typedSpec;
  const base = {
    sourceProgramId: program.id,
    sourceSampleId: program.sourceSampleId
  };
  const push = (c: Omit<v5.CandidateElement, keyof typeof base>) => out.push({ ...base, ...c } as v5.CandidateElement);

  // 1. Structure pattern — the whole role sequence.
  const roleSeq = spec.scenes.map((s) => s.role);
  push({
    id: `cand_${program.id}_structure`,
    proposedName: `${roleSeq.join("→")} structure`,
    kind: "structure_pattern",
    evidenceRefs: Array.from(new Set(spec.scenes.flatMap((s) => s.evidenceRefs))).slice(0, 12),
    summary: `${spec.scenes.length}-section structure: ${roleSeq.join(", ")} over ${spec.composition.durationSec}s.`,
    reusablePolicy: "parametric_reuse",
    slots: program.placeholders,
    payload: {
      sections: spec.scenes.map((s) => ({ role: s.role, startSec: s.startSec, endSec: s.endSec })),
      durationSec: spec.composition.durationSec,
      aspectRatio: spec.composition.aspectRatio
    },
    qualityHints: ["reusable section skeleton"]
  });

  // 2. Hook pattern — first scene if it is a hook.
  const hook = spec.scenes.find((s) => s.role === "hook");
  if (hook) {
    push({
      id: `cand_${program.id}_hook`,
      proposedName: "opening hook pattern",
      kind: "hook_pattern",
      evidenceRefs: hook.evidenceRefs,
      summary: `Hook ${hook.startSec}-${hook.endSec}s: ${(hook.motionGrammar ?? []).join("/")}.`,
      reusablePolicy: "parametric_reuse",
      slots: slotsForPlaceholders(program, [hook.id]),
      payload: {
        durationSec: Number((hook.endSec - hook.startSec).toFixed(2)),
        motion: hook.motionGrammar ?? [],
        packaging: hook.packagingGrammar ?? [],
        requiredSlots: slotsForPlaceholders(program, [hook.id]).map((s) => s.kind)
      },
      qualityHints: ["high-impact opening"]
    });
  }

  // 3. Rhythm pattern — from rhythm + audio cues.
  if (spec.rhythm || spec.audioCues.length) {
    push({
      id: `cand_${program.id}_rhythm`,
      proposedName: `${spec.globalStyle.pacing} rhythm`,
      kind: "rhythm_pattern",
      evidenceRefs: ["audio_beat_grid"],
      summary: `Cut density ${spec.rhythm?.cutDensity ?? "n/a"}, ${spec.audioCues.length} audio cues.`,
      reusablePolicy: "direct_reuse",
      slots: [],
      payload: { rhythm: spec.rhythm ?? {}, audioCues: spec.audioCues, pacing: spec.globalStyle.pacing },
      qualityHints: ["pacing template"]
    });
  }

  // 4. Typography pattern — from global style.
  push({
    id: `cand_${program.id}_typography`,
    proposedName: "typography + palette system",
    kind: "typography_pattern",
    evidenceRefs: [],
    summary: spec.globalStyle.typographySystem,
    reusablePolicy: "direct_reuse",
    slots: [],
    payload: {
      typographySystem: spec.globalStyle.typographySystem,
      palette: spec.globalStyle.palette,
      textDensity: spec.globalStyle.textDensity
    },
    qualityHints: ["reusable look"]
  });

  // 5. Transition pattern — when there are multiple scenes.
  if (spec.scenes.length >= 2) {
    push({
      id: `cand_${program.id}_transition`,
      proposedName: "scene transition grammar",
      kind: "transition_pattern",
      evidenceRefs: [],
      summary: `${spec.scenes.length - 1} transitions between ${roleSeq.join("→")}.`,
      reusablePolicy: "direct_reuse",
      slots: [],
      payload: { boundaries: spec.scenes.slice(1).map((s) => s.startSec) },
      qualityHints: []
    });
  }

  // 6. CTA pattern.
  const cta = spec.scenes.find((s) => s.role === "cta");
  if (cta) {
    push({
      id: `cand_${program.id}_cta`,
      proposedName: "CTA card pattern",
      kind: "cta_pattern",
      evidenceRefs: cta.evidenceRefs,
      summary: `CTA ${cta.startSec}-${cta.endSec}s.`,
      reusablePolicy: "parametric_reuse",
      slots: slotsForPlaceholders(program, [cta.id]),
      payload: { durationSec: Number((cta.endSec - cta.startSec).toFixed(2)), packaging: cta.packagingGrammar ?? [] },
      qualityHints: ["conversion card"]
    });
  }

  // 7. Visual asset patterns — one per learned asset recipe.
  for (const recipe of program.learnedAssetRecipes ?? []) {
    push({
      id: `cand_${program.id}_asset_${recipe.id}`,
      proposedName: `${recipe.kind} recipe`,
      kind: "visual_asset_pattern",
      evidenceRefs: recipe.evidenceRefs,
      summary: recipe.observedDescription.subject,
      reusablePolicy: "regenerate_only",
      slots: [],
      assetRecipe: recipe,
      payload: { observedDescription: recipe.observedDescription },
      qualityHints: ["regenerate, never copy"]
    });
  }

  // 8. Audio patterns — one per learned audio recipe.
  for (const recipe of program.learnedAudioRecipes ?? []) {
    push({
      id: `cand_${program.id}_audio_${recipe.id}`,
      proposedName: `${recipe.kind} audio pattern`,
      kind: "audio_pattern",
      evidenceRefs: recipe.evidenceRefs,
      summary: `${recipe.bpm ?? "n/a"} BPM, ${recipe.cuePoints.length} cues.`,
      reusablePolicy: recipe.reusablePolicy,
      slots: [],
      audioRecipe: recipe,
      payload: { bpm: recipe.bpm, mood: recipe.mood, cuePoints: recipe.cuePoints },
      qualityHints: ["cue pattern only"]
    });
  }

  return out;
}
