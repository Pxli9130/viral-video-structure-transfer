// pipeline-v5/runLearnSampleV5.ts
// LEARN pipeline orchestrator (deterministic core). Given an EvidenceTimelineV5, runs:
//   Gen1 (deterministic neutral template) -> Element Extractor -> KB Curator
// and returns all artifacts + the learn-side gate results. The AI Gen1 path layers on top later by
// replacing runGen1NeutralTemplate's output when it validates; this orchestrator stays the safety net.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { v5 } from "@vvst/shared";
import type { KnowledgeBaseV5 } from "../services/knowledgeBaseV5.js";
import { runGen1NeutralTemplate } from "./runGen1NeutralTemplate.js";
import { runExtractElements } from "./runExtractElements.js";
import { runGen1TemplateReconstruction } from "./runGen1TemplateReconstruction.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";
import { runGen1CapsuleCodegen } from "./runGen1CapsuleCodegen.js";
import { renderCapsuleStill } from "./renderTemplateCapsule.js";
import { deriveSceneRecipes } from "./deriveSceneRecipes.js";
import { runSceneRecipeVlm } from "./runSceneRecipeVlm.js";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import type { VisionFn } from "./runSceneRecipeVlm.js";
import type { VisionCodegenFn } from "./gen1ModelFactory.js";

/** Read one source keyframe (base64) per section (nearest the section midpoint), capped, for multimodal codegen. */
async function readSectionFrames(
  evidence: v5.EvidenceTimelineV5,
  sections: Array<{ id: string; startSec: number; endSec: number }>,
  storageRoot: string,
  cap = 6
): Promise<Array<{ base64: string; mimeType: string }>> {
  const kfs = (evidence.keyFrames ?? []).map((k) => ({ timeSec: k.timeSec, frameRef: (k as { frameRef?: string }).frameRef })).filter((k) => k.frameRef);
  const out: Array<{ base64: string; mimeType: string }> = [];
  for (const sec of sections.slice(0, cap)) {
    const mid = (sec.startSec + sec.endSec) / 2;
    const kf = kfs.filter((k) => k.timeSec >= sec.startSec && k.timeSec < sec.endSec).sort((a, b) => Math.abs(a.timeSec - mid) - Math.abs(b.timeSec - mid))[0]
      ?? kfs.sort((a, b) => Math.abs(a.timeSec - mid) - Math.abs(b.timeSec - mid))[0];
    if (!kf?.frameRef) continue;
    const fp = path.join(storageRoot, String(kf.frameRef).replace(/^\//, ""));
    if (!existsSync(fp)) continue;
    try {
      out.push({ base64: (await fs.readFile(fp)).toString("base64"), mimeType: "image/png" });
    } catch {
      /* skip unreadable frame */
    }
  }
  return out;
}


export interface LearnArtifacts {
  evidence: v5.EvidenceTimelineV5;
  neutralProgram: v5.NeutralReconstructionProgram;
  candidates: v5.CandidateElement[];
  decisions: v5.KbCurationDecision[];
  elements: v5.KnowledgeElement[];
  /** Level-1 reusable Remotion template (the default generation object). */
  templateCapsule: v5.RemotionTemplateCapsule;
  templateValidation: v5.TemplateValidationResult;
  /** Present when AI capsule codegen was attempted; usedAi=true means the AI TSX was promoted. */
  capsuleCodegen?: { usedAi: boolean; compilePassed: boolean; renderPreviewPassed: boolean; noCopyPassed: boolean };
  gates: v5.ScorecardGate[];
  warnings: string[];
}

function gate(id: string, status: v5.GateStatus, message?: string): v5.ScorecardGate {
  const def = v5.getGateDef(id);
  return { id, name: def?.name ?? id, status, priority: def?.priority, message };
}

export interface LearnOptions {
  /** When set, write each artifact as JSON under this directory. */
  outDir?: string;
  /** Override the AI Gen1 program (when an AI path produced a valid one). */
  aiProgram?: v5.NeutralReconstructionProgram | null;
  /** Optional model fn for AI capsule TSX codegen (triple-gated). Absent -> deterministic code (guaranteed). */
  capsuleCodegenModel?: Gen1ModelFn | null;
  /** Optional multimodal codegen fn — when set, the codegen SEES the source keyframes (richer fidelity). */
  capsuleCodegenVision?: VisionCodegenFn | null;
  /** Optional VLM fn for per-scene structural enrichment (composition/layout/typography). */
  sceneVlm?: VisionFn | null;
  /** When true, run a real frame-0 render of the final capsule at learn time so T8/renderPreviewPassed
   *  is earned (not deferred). Needs headless chrome; a failed render is recorded, never fatal. */
  validateRender?: boolean;
  /** Project that owns this learn run — stamped on the capsule for per-project KB scoping. */
  projectId?: string;
  /** Dir that contains "generated" (so keyframe frameRefs resolve) — enables scene-recipe derivation. */
  storageRoot?: string;
  /** Path to the source video — sent to the multimodal codegen so it sees the actual motion/style. */
  sampleVideoPath?: string;
}

/** Run the deterministic LEARN loop for one already-wrapped EvidenceTimelineV5. */
export async function runLearnSampleV5(
  evidence: v5.EvidenceTimelineV5,
  kb: KnowledgeBaseV5,
  opts: LearnOptions = {}
): Promise<LearnArtifacts> {
  const warnings: string[] = [];
  const gates: v5.ScorecardGate[] = [];

  // Stage 1 gate: evidence exists + schema valid.
  const evResult = v5.validateEvidenceTimelineV5(evidence);
  gates.push(gate("V5-G1", evResult.valid ? "pass" : "fail", evResult.valid ? undefined : evResult.errors.join("; ")));

  // Stage 4 Gen1: prefer a valid AI program, else deterministic template.
  let neutralProgram = opts.aiProgram ?? null;
  let usedFallback = false;
  if (neutralProgram) {
    const aiCheck = v5.validateNeutralReconstructionProgram(neutralProgram);
    if (!aiCheck.valid) {
      warnings.push(`Gen1 AI output invalid (${aiCheck.errors.slice(0, 2).join("; ")}); using deterministic template.`);
      neutralProgram = null;
    }
  }
  if (!neutralProgram) {
    const t = runGen1NeutralTemplate(evidence);
    neutralProgram = t.program;
    usedFallback = true;
    if (!t.validation.valid) warnings.push(`Neutral template invalid: ${t.validation.errors.join("; ")}`);
  }

  const g1Check = v5.validateNeutralReconstructionProgram(neutralProgram);
  gates.push(gate("V5-G4", neutralProgram ? "pass" : "fail", usedFallback ? "deterministic fallback" : "ai gen1"));
  gates.push(gate("V5-G5", g1Check.valid ? "pass" : "fail", g1Check.valid ? undefined : g1Check.errors.join("; ")));

  // Placeholder coverage gate.
  const hasPlaceholders = neutralProgram.placeholders.length > 0;
  gates.push(gate("V5-G6", hasPlaceholders ? "pass" : "warn", `${neutralProgram.placeholders.length} placeholders`));

  // Stage 5 Element extraction.
  const candidates = runExtractElements(neutralProgram);
  gates.push(gate("V5-G9", candidates.length ? "pass" : "fail", `${candidates.length} candidates`));

  // Stage 6/7 Curation + KB write.
  const { decisions, elements } = kb.curateMany(candidates);
  const allDecided = decisions.length === candidates.length;
  gates.push(gate("V5-G10", allDecided ? "pass" : "warn", `${decisions.length}/${candidates.length} decided`));
  gates.push(gate("V5-G13", elements.length ? "pass" : "warn", `${elements.length} stored/merged`));

  // Stage 4a2 — derive content-neutral per-scene visual recipes from the sample's keyframes so the
  // capsule reconstructs ITS source's look (grading/anchors/camera/transition). Empty -> role-varied fallback.
  const sectionMeta = neutralProgram.typedSpec.scenes.map((s) => ({ id: s.id, role: String(s.role ?? "other"), startSec: s.startSec, endSec: s.endSec }));
  let sceneRecipes = await deriveSceneRecipes(evidence, sectionMeta, { storageRoot: opts.storageRoot });

  // Stage 4a3 — OPTIONAL VLM enrichment: a vision model adds rich content-neutral per-scene detail
  // (composition / layout zones / graphic elements / typography / treatment) for higher-fidelity codegen.
  if (opts.sceneVlm && sceneRecipes.length && opts.storageRoot) {
    try {
      sceneRecipes = await runSceneRecipeVlm({ evidence, sections: sectionMeta, base: sceneRecipes, storageRoot: opts.storageRoot, vision: opts.sceneVlm });
    } catch (err) {
      warnings.push(`VLM scene enrichment skipped: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
    }
  }

  // Stage 4b — Remotion Template Reconstruction: build + validate + store the reusable capsule (V5.1).
  const templateCapsule = runGen1TemplateReconstruction(neutralProgram, evidence, { sceneRecipes });
  let templateValidation = validateTemplateCapsule(templateCapsule);

  // Stage 4c — OPTIONAL real AI capsule codegen (apply != promote). The deterministic code above is the
  // guaranteed fallback; the AI TSX only replaces it after compile + safety + real-render all pass.
  let capsuleCodegen: LearnArtifacts["capsuleCodegen"];
  if (opts.capsuleCodegenModel) {
    // Multimodal: the vision codegen WATCHES the full source video (Files API, any size) + keyframes.
    const frames = opts.capsuleCodegenVision && opts.storageRoot ? await readSectionFrames(evidence, sectionMeta, opts.storageRoot, 6) : undefined;
    const cg = await runGen1CapsuleCodegen(
      {
        capsule: templateCapsule,
        program: neutralProgram,
        evidence,
        model: opts.capsuleCodegenModel,
        frames: frames?.length ? frames : undefined,
        videoPath: opts.capsuleCodegenVision ? opts.sampleVideoPath : undefined,
        visionModel: opts.capsuleCodegenVision ?? undefined
      },
      { maxAttempts: 3 }
    );
    capsuleCodegen = { usedAi: cg.usedAi, compilePassed: cg.validation.compilePassed, renderPreviewPassed: cg.validation.renderPreviewPassed, noCopyPassed: cg.validation.noCopyPassed };
    if (cg.usedAi) {
      templateCapsule.codeBundle = cg.codeBundle; // PROMOTE
      templateCapsule.quality.renderPreviewPassed = true; // render gate passed at apply time
      templateCapsule.quality.codeOrigin = "ai"; // honest provenance (no stale "deterministic" warning)
      templateValidation = validateTemplateCapsule(templateCapsule); // re-validate the promoted bundle
    }
    warnings.push(cg.usedAi ? "AI capsule codegen promoted (compile+render+no-copy passed)." : `AI capsule codegen rejected; deterministic code retained. ${cg.warnings.slice(0, 2).join("; ")}`);
  }

  // Stage 4d — OPTIONAL real render gate at learn time: prove the (promoted) capsule actually renders
  // a frame, so T8/renderPreviewPassed reflects reality instead of being deferred. (AI promotion already
  // verified this; this covers the deterministic path when requested.)
  if (opts.validateRender && !templateCapsule.quality.renderPreviewPassed) {
    const still = await renderCapsuleStill({ capsule: templateCapsule, boundProps: templateCapsule.fixtures.neutralFixture as Record<string, unknown> });
    templateCapsule.quality.renderPreviewPassed = still.ok;
    if (!still.ok) warnings.push(`capsule render validation failed (T8): ${still.error}`);
    templateValidation = validateTemplateCapsule(templateCapsule); // T8 now reflects the real render
  }

  templateCapsule.quality.compilePassed = templateValidation.gates.find((t) => t.id === "T2")?.status === "pass";
  templateCapsule.quality.noCopyTemplatePassed = templateValidation.gates.find((t) => t.id === "T10")?.status === "pass";
  templateCapsule.quality.warnings = [...templateCapsule.quality.warnings, ...templateValidation.warnings];
  if (opts.projectId) templateCapsule.projectId = opts.projectId;
  kb.saveTemplateCapsule(templateCapsule);
  for (const t of templateValidation.gates.slice(0, 6)) gates.push(gate(t.id, t.status === "pass" ? "pass" : t.status === "warn" ? "warn" : "fail", t.message));

  const artifacts: LearnArtifacts = { evidence, neutralProgram, candidates, decisions, elements, templateCapsule, templateValidation, capsuleCodegen, gates, warnings };

  if (opts.outDir) {
    await fs.mkdir(opts.outDir, { recursive: true });
    const write = (name: string, data: unknown) => fs.writeFile(path.join(opts.outDir as string, name), JSON.stringify(data, null, 2));
    await Promise.all([
      write("evidence-timeline-v5.json", evidence),
      write("neutral-reconstruction-program.json", neutralProgram),
      write("candidate-elements.json", candidates),
      write("kb-decisions.json", decisions),
      write("knowledge-elements.json", elements),
      write("remotion-template-capsule.json", templateCapsule),
      write("template-validation.json", templateValidation),
      write("learn-gates.json", gates),
      ...(capsuleCodegen ? [write("capsule-codegen.json", capsuleCodegen)] : [])
    ]);
  }

  return artifacts;
}
