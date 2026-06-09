import { createHash } from "node:crypto";
import { v5 } from "@vvst/shared";

export interface KnowledgeManifestSeed {
  version: "knowledge_manifest.seed.v1";
  sourceSampleId: string;
  reconstructionProgramId: string;
  templateCapsuleId: string;
  remotionCodeHash: string;
  videoType: string;
  durationSec: number;
  aspectRatio: v5.AspectRatioV5;
  structureHypothesis: {
    phases: Array<{
      id: string;
      role: string;
      startSec: number;
      endSec: number;
      durationSec: number;
      visualMethod?: string;
      intent?: string;
      beatCount: number;
    }>;
    motionMotifs: string[];
    transitions: string[];
    typographyAnimations: string[];
    beatSyncedCueCount: number;
  };
  assetSlots: Array<{
    id: string;
    kind: string;
    required: boolean;
    role: string;
    replacementPolicy: string;
    mediaKind?: string;
    promptAvailable: boolean;
    userAssetCandidate: boolean;
    evidenceRefs: string[];
  }>;
  audioRhythm: {
    recipeCount: number;
    bpm?: number;
    cues: Array<{ t: number; type: string; role?: string }>;
    moods: string[];
  };
  remotionModules: Array<{
    path: string;
    sha1: string;
    lineCount: number;
    sequenceCount: number;
    componentHints: string[];
  }>;
  reusableClaims: string[];
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

function slotPlaceholderKind(kind: v5.TemplateSlotKind): v5.PlaceholderKindV5 {
  if (kind === "hero_image") return "hero";
  if (kind === "product_image") return "product_closeup";
  if (kind === "background_image") return "background";
  if (kind === "logo") return "logo";
  if (kind === "headline") return "main_title";
  if (kind === "subtitle") return "subtitle_text";
  if (kind === "cta_text") return "cta_card";
  if (kind === "voiceover") return "voiceover";
  if (kind === "sfx") return "sfx";
  if (kind === "music") return "audio_pattern";
  return "hero_product";
}

function placeholderForSlot(slot: v5.TemplateSlot): v5.PlaceholderSlotV5 {
  return {
    id: `slot_${slot.id}`,
    kind: slotPlaceholderKind(slot.kind),
    required: slot.required,
    evidenceRefs: [`templateCapsule.slotSchema.${slot.id}`],
    replacementPolicy: slot.replacementPolicy === "user_asset" ? "target_asset" : slot.replacementPolicy === "optional" ? "optional" : "generate",
    safetyPolicy: slot.userAssetSlot ? "can_use_user_asset" : "must_replace_sample",
    sourcePolicy: "sample_evidence_only"
  };
}

function codeHash(capsule: v5.RemotionTemplateCapsule): string {
  return sha1(JSON.stringify(capsule.codeBundle.files.map((f) => ({ path: f.path, sha1: sha1(f.content) }))));
}

function moduleFacts(file: { path: string; content: string }): KnowledgeManifestSeed["remotionModules"][number] {
  const componentHints = Array.from(file.content.matchAll(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)/g))
    .map((m) => m[1])
    .filter(Boolean)
    .slice(0, 12);
  return {
    path: file.path,
    sha1: sha1(file.content),
    lineCount: file.content.split(/\r?\n/).length,
    sequenceCount: (file.content.match(/<Sequence\b/g) ?? []).length,
    componentHints
  };
}

export function buildKnowledgeManifestSeed(input: {
  neutralProgram: v5.NeutralReconstructionProgram;
  templateCapsule: v5.RemotionTemplateCapsule;
}): KnowledgeManifestSeed {
  const { neutralProgram, templateCapsule } = input;
  const sceneById = new Map((templateCapsule.sceneRecipes ?? []).map((r) => [r.sectionId, r]));
  const durationSec = templateCapsule.timingSignature.durationSec || neutralProgram.typedSpec.composition.durationSec;
  const audioRecipes = templateCapsule.audioRecipes ?? [];
  const cues = audioRecipes.flatMap((r) => r.cuePoints ?? []).slice(0, 24);
  return {
    version: "knowledge_manifest.seed.v1",
    sourceSampleId: templateCapsule.sourceSampleId,
    reconstructionProgramId: neutralProgram.id,
    templateCapsuleId: templateCapsule.id,
    remotionCodeHash: codeHash(templateCapsule),
    videoType: "short_form_structure_transfer",
    durationSec,
    aspectRatio: neutralProgram.typedSpec.composition.aspectRatio,
    structureHypothesis: {
      phases: templateCapsule.timingSignature.sections.map((s) => {
        const scene = sceneById.get(s.id);
        return {
          id: s.id,
          role: s.role,
          startSec: s.startSec,
          endSec: s.endSec,
          durationSec: Math.max(0, s.endSec - s.startSec),
          visualMethod: scene ? [scene.transitionIn, scene.subject?.cameraMove, scene.textAnim].filter(Boolean).join(" + ") : undefined,
          intent: neutralProgram.typedSpec.scenes.find((x) => x.id === s.id)?.intent,
          beatCount: s.internalBeats.length
        };
      }),
      motionMotifs: templateCapsule.motionSignature.motifs,
      transitions: templateCapsule.motionSignature.transitionTypes,
      typographyAnimations: templateCapsule.motionSignature.typographyAnimationTypes,
      beatSyncedCueCount: templateCapsule.motionSignature.beatSyncedCueCount
    },
    assetSlots: templateCapsule.slotSchema.map((s) => ({
      id: s.id,
      kind: s.kind,
      required: s.required,
      role: s.originalRole,
      replacementPolicy: s.replacementPolicy,
      mediaKind: s.mediaKind,
      promptAvailable: Boolean(s.aigcPrompt),
      userAssetCandidate: Boolean(s.userAssetSlot),
      evidenceRefs: [`templateCapsule.slotSchema.${s.id}`]
    })),
    audioRhythm: {
      recipeCount: audioRecipes.length,
      bpm: audioRecipes.find((r) => typeof r.bpm === "number")?.bpm,
      cues: cues.map((c) => ({ t: c.t, type: c.type, role: c.role })),
      moods: Array.from(new Set(audioRecipes.flatMap((r) => r.mood ?? []))).slice(0, 12)
    },
    remotionModules: templateCapsule.codeBundle.files.map(moduleFacts),
    reusableClaims: [
      "Reuse timing, layout, motion, typography, transition and audio-cue structure.",
      "Replace or regenerate all sample-specific pixels, text, logos, people, products and audio.",
      "Use Remotion code as an executable middle layer; use this manifest as structured KB seed evidence."
    ]
  };
}

function candidateId(prefix: string, sourceSampleId: string, payload: unknown): string {
  return `cand_${prefix}_${safeId(sourceSampleId)}_${sha1(JSON.stringify(payload)).slice(0, 12)}`;
}

export function buildKnowledgeManifestCandidates(input: {
  manifest: KnowledgeManifestSeed;
  neutralProgram: v5.NeutralReconstructionProgram;
  templateCapsule: v5.RemotionTemplateCapsule;
}): v5.CandidateElement[] {
  const { manifest, neutralProgram, templateCapsule } = input;
  const base = {
    sourceProgramId: neutralProgram.id,
    sourceSampleId: manifest.sourceSampleId
  };
  const out: v5.CandidateElement[] = [];

  const structurePayload = {
    category: "structure_pattern",
    phases: manifest.structureHypothesis.phases,
    motionMotifs: manifest.structureHypothesis.motionMotifs,
    transitions: manifest.structureHypothesis.transitions,
    capsuleId: manifest.templateCapsuleId,
    remotionCodeHash: manifest.remotionCodeHash,
    retrievalText: manifest.structureHypothesis.phases.map((p) => `${p.role}:${p.durationSec.toFixed(1)}s ${p.visualMethod ?? ""}`).join(" | ")
  };
  out.push({
    id: candidateId("manifest_structure", manifest.sourceSampleId, structurePayload),
    proposedName: `Template structure: ${manifest.structureHypothesis.phases.map((p) => p.role).join(" → ")}`,
    kind: "structure_pattern",
    ...base,
    evidenceRefs: ["knowledge_manifest.seed.structureHypothesis", "templateCapsule.timingSignature"],
    summary: "Full video phase structure, timing, motion motifs, transitions and typography animation cues from the promoted template capsule.",
    reusablePolicy: "parametric_reuse",
    slots: templateCapsule.slotSchema.filter((s) => s.required).slice(0, 12).map(placeholderForSlot),
    payload: structurePayload,
    qualityHints: ["manifest_seed", "template_capsule", "structure_transfer"]
  });

  const snippetPayload = {
    category: "remotion_module",
    capsuleId: manifest.templateCapsuleId,
    componentName: templateCapsule.codeBundle.componentName,
    entryFile: templateCapsule.codeBundle.entryFile,
    modules: manifest.remotionModules,
    remotionCodeHash: manifest.remotionCodeHash,
    retrievalText: `${templateCapsule.name} ${templateCapsule.description ?? ""} ${(templateCapsule.motionSignature?.motifs ?? []).join(" ")}`
  };
  out.push({
    id: candidateId("manifest_remotion", manifest.sourceSampleId, snippetPayload),
    proposedName: `Remotion capsule module: ${templateCapsule.name}`,
    kind: "remotion_snippet",
    ...base,
    evidenceRefs: ["templateCapsule.codeBundle", "knowledge_manifest.seed.remotionModules"],
    summary: "Reusable props-driven Remotion capsule code reference with module hashes and component metadata.",
    reusablePolicy: "parametric_reuse",
    slots: templateCapsule.slotSchema.map(placeholderForSlot).slice(0, 16),
    remotionSnippet: {
      snippetRef: `templateCapsule:${manifest.templateCapsuleId}`,
      componentName: templateCapsule.codeBundle.componentName,
      propsSchemaRef: `templateCapsule:${manifest.templateCapsuleId}:propsSchema`,
      fixtureRef: `templateCapsule:${manifest.templateCapsuleId}:neutralFixture`
    },
    payload: snippetPayload,
    qualityHints: ["remotion", "code_middle_layer", "props_driven"]
  });

  for (const phase of manifest.structureHypothesis.phases.slice(0, 12)) {
    const payload = {
      category: "visual_module",
      phase,
      capsuleId: manifest.templateCapsuleId,
      remotionCodeHash: manifest.remotionCodeHash,
      retrievalText: `${phase.role} ${phase.durationSec.toFixed(1)}s ${phase.visualMethod ?? ""} ${phase.intent ?? ""}`
    };
    out.push({
      id: candidateId("manifest_phase", manifest.sourceSampleId, payload),
      proposedName: `Scene module: ${phase.role} ${phase.startSec.toFixed(1)}-${phase.endSec.toFixed(1)}s`,
      kind: "segment_template",
      ...base,
      evidenceRefs: [`templateCapsule.timingSignature.sections.${phase.id}`, `sceneRecipes.${phase.id}`],
      summary: `Reusable ${phase.role} segment timing and visual method from the Remotion reconstruction layer.`,
      reusablePolicy: "parametric_reuse",
      slots: [],
      payload,
      qualityHints: ["visual_module", phase.role]
    });
  }

  for (const slot of templateCapsule.slotSchema.filter((s) => s.required || s.userAssetSlot).slice(0, 24)) {
    const payload = {
      category: "asset_slot",
      slotId: slot.id,
      kind: slot.kind,
      originalRole: slot.originalRole,
      replacementPolicy: slot.replacementPolicy,
      mediaKind: slot.mediaKind,
      userAssetCandidate: Boolean(slot.userAssetSlot),
      aigcPrompt: slot.aigcPrompt,
      motionHint: slot.motionHint,
      capsuleId: manifest.templateCapsuleId,
      retrievalText: `${slot.kind} ${slot.originalRole} ${slot.description ?? ""} ${slot.aigcPrompt ?? ""}`
    };
    out.push({
      id: candidateId("manifest_slot", manifest.sourceSampleId, payload),
      proposedName: `Asset slot: ${slot.kind} for ${slot.originalRole}`,
      kind: slot.aigcPrompt ? "image_prompt_recipe" : "visual_asset_pattern",
      ...base,
      evidenceRefs: [`templateCapsule.slotSchema.${slot.id}`],
      summary: `Reusable target asset requirement for the ${slot.originalRole} slot, including replacement policy and generation hints.`,
      reusablePolicy: slot.aigcPrompt ? "regenerate_only" : "parametric_reuse",
      slots: [placeholderForSlot(slot)],
      payload,
      qualityHints: ["asset_slot", slot.kind, slot.mediaKind ?? "image"]
    });
  }

  for (const recipe of templateCapsule.audioRecipes.slice(0, 8)) {
    const payload = {
      category: "audio_rhythm_recipe",
      recipe,
      capsuleId: manifest.templateCapsuleId,
      remotionCodeHash: manifest.remotionCodeHash,
      retrievalText: `${recipe.kind} bpm ${recipe.bpm ?? "n/a"} ${(recipe.mood ?? []).join(" ")} ${(recipe.cuePoints ?? []).map((c) => `${c.type}@${c.t}`).join(" ")} energy_points ${(recipe.energyCurve ?? []).length}`
    };
    out.push({
      id: candidateId("manifest_audio", manifest.sourceSampleId, payload),
      proposedName: `Audio rhythm: ${recipe.kind}${recipe.bpm ? ` ${Math.round(recipe.bpm)}bpm` : ""}`,
      kind: "audio_pattern",
      ...base,
      evidenceRefs: recipe.evidenceRefs.length ? recipe.evidenceRefs : ["templateCapsule.audioRecipes"],
      summary: "Reusable audio rhythm and cue pattern for regenerating a non-sample music bed aligned to the video structure.",
      reusablePolicy: recipe.reusablePolicy,
      slots: [],
      audioRecipe: recipe,
      payload,
      qualityHints: ["audio_rhythm_recipe", "cue_binding"]
    });
  }

  const gapPayload = {
    category: "gap_fill_strategy",
    slots: templateCapsule.slotSchema.map((s) => ({ id: s.id, kind: s.kind, required: s.required, policy: s.replacementPolicy, mediaKind: s.mediaKind })),
    capsuleId: manifest.templateCapsuleId,
    retrievalText: templateCapsule.slotSchema.map((s) => `${s.kind}:${s.replacementPolicy}:${s.mediaKind ?? "image"}`).join(" ")
  };
  out.push({
    id: candidateId("manifest_gapfill", manifest.sourceSampleId, gapPayload),
    proposedName: "Gap fill strategy from template slot schema",
    kind: "image_prompt_recipe",
    ...base,
    evidenceRefs: ["templateCapsule.slotSchema", "knowledge_manifest.seed.assetSlots"],
    summary: "Reusable strategy for deciding which missing target slots use user assets, AIGC visuals/video, text fill, procedural fill or optional omission.",
    reusablePolicy: "parametric_reuse",
    slots: templateCapsule.slotSchema.map(placeholderForSlot).slice(0, 20),
    payload: gapPayload,
    qualityHints: ["gap_fill_strategy", "slot_mapping"]
  });

  return out;
}

function normalizeKind(raw: unknown): v5.KnowledgeElementKindV5 | undefined {
  const value = String(raw ?? "").trim();
  if ((v5.KNOWLEDGE_ELEMENT_KINDS_V5 as readonly string[]).includes(value)) return value as v5.KnowledgeElementKindV5;
  const aliases: Record<string, v5.KnowledgeElementKindV5> = {
    visual_module: "segment_template",
    remotion_module: "remotion_snippet",
    asset_slot: "visual_asset_pattern",
    gap_fill_strategy: "image_prompt_recipe",
    audio_rhythm_recipe: "audio_pattern",
    audio_recipe: "audio_pattern",
    rhythm_recipe: "rhythm_pattern",
    layout_recipe: "layout_pattern",
    motion_recipe: "motion_pattern",
    visual_pattern: "visual_asset_pattern"
  };
  return aliases[value];
}

export function normalizeGeminiKnowledgeCandidates(input: {
  rawElements?: unknown[];
  neutralProgram: v5.NeutralReconstructionProgram;
  templateCapsule: v5.RemotionTemplateCapsule;
  remotionCodeHash: string;
}): v5.CandidateElement[] {
  const raw = Array.isArray(input.rawElements) ? input.rawElements : [];
  const out: v5.CandidateElement[] = [];
  raw.slice(0, 32).forEach((item, index) => {
    const obj = asRecord(item);
    const kind = normalizeKind(obj.kind);
    if (!kind) return;
    const name = String(obj.name ?? obj.title ?? obj.id ?? `Gemini ${kind}`);
    const description = String(obj.description ?? obj.summary ?? obj.retrievalText ?? name);
    const refs = stringList(obj.evidenceRefs).length ? stringList(obj.evidenceRefs) : [`gemini.knowledgeElements[${index}]`];
    const payload = {
      category: "gemini_structured_knowledge",
      capsuleId: input.templateCapsule.id,
      remotionCodeHash: input.remotionCodeHash,
      retrievalText: String(obj.retrievalText ?? `${name} ${description}`),
      params: asRecord(obj.params ?? obj.payload),
      sourceKind: obj.kind
    };
    out.push({
      id: candidateId("gemini_knowledge", input.templateCapsule.sourceSampleId, { index, kind, name, payload }),
      proposedName: name.slice(0, 120),
      kind,
      sourceProgramId: input.neutralProgram.id,
      sourceSampleId: input.templateCapsule.sourceSampleId,
      evidenceRefs: refs,
      summary: description.slice(0, 600),
      reusablePolicy: kind === "audio_pattern" || kind === "image_prompt_recipe" || kind === "visual_asset_pattern" ? "regenerate_only" : "parametric_reuse",
      slots: [],
      payload,
      qualityHints: ["gemini_knowledge", "structured_summarizer"]
    });
  });
  return out;
}
