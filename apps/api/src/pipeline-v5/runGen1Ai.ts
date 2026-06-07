// pipeline-v5/runGen1Ai.ts
// AI Gen1: model-driven neutral reconstruction. The model supplies the STRUCTURAL UNDERSTANDING
// (typedSpec + placeholders + timingMap + learned recipes) grounded in deterministic evidence; the
// renderable remotionProject + safety envelope are taken from the deterministic builder so the
// program is always schema-valid AND rendered by the FIXED V5 root (no AI-TSX compile risk — audit
// LEARN-01). Validate -> one repair -> deterministic fallback (routing-and-fallbacks.md §2).
//
// The model call is an INJECTED function so this is offline-testable; the real Gemini wrapper lives in
// gen1ModelFactory.ts and is only used when AI is explicitly enabled.

import { v5 } from "@vvst/shared";
import { runGen1NeutralTemplate } from "./runGen1NeutralTemplate.js";

export type Gen1ModelFn = (prompt: string) => Promise<string>;

export interface Gen1AiResult {
  program: v5.NeutralReconstructionProgram;
  usedAi: boolean;
  validation: v5.V5ValidationResult;
  warnings: string[];
  raw?: string;
}

interface Gen1Partial {
  typedSpec?: v5.RenderProgramSpecV5;
  placeholders?: v5.PlaceholderSlotV5[];
  timingMap?: v5.TimingSegmentV5[];
  learnedAssetRecipes?: v5.AssetRecipeV5[];
  learnedAudioRecipes?: v5.AudioRecipeV5[];
  evidenceRefs?: string[];
}

function evidenceSummary(ev: v5.EvidenceTimelineV5): string {
  const shots = ev.shots.map((s) => `${s.id}:${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s${s.summary ? ` (${s.summary})` : ""}`).join("; ");
  const beats = ev.audioEvidence?.beatGridSec?.slice(0, 8).map((b) => b.toFixed(2)).join(",");
  const text = (ev.textEvidence ?? []).slice(0, 6).map((t) => `${t.id}@${t.timeSec.toFixed(1)}s`).join(", ");
  return [
    `duration=${ev.video.durationSec}s ${ev.video.width}x${ev.video.height}@${ev.video.fps} aspect=${ev.video.aspectRatio} hasAudio=${ev.video.hasAudio}`,
    `bpm=${ev.audioEvidence?.bpm ?? "n/a"} beats=[${beats ?? ""}] cutDensity=${ev.motionEvidence?.cutDensity ?? "n/a"}`,
    `shots: ${shots}`,
    text ? `textEvidence: ${text}` : "textEvidence: none",
    `evidenceRefIds: ${[...ev.shots.map((s) => s.id), ...(ev.textEvidence ?? []).map((t) => t.id)].slice(0, 24).join(", ")}`
  ].join("\n");
}

export function buildGen1Prompt(ev: v5.EvidenceTimelineV5, repairErrors?: string[]): string {
  const sectionRoles = "hook | setup | proof | demo | benefit | transition | cta";
  const repair = repairErrors?.length
    ? `\nYOUR PREVIOUS OUTPUT FAILED VALIDATION:\n- ${repairErrors.slice(0, 6).join("\n- ")}\nReturn corrected JSON only.\n`
    : "";
  return `You are Gen1, a neutral reconstruction synthesizer for short-form video.
Given deterministic EVIDENCE about a sample video, output a CONTENT-NEUTRAL structural program.
You are NOT recreating the sample's content. Replace all sample-specific product/person/logo/text/audio
with PLACEHOLDERS. Cite evidenceRefIds from the evidence in every scene's evidenceRefs.

EVIDENCE:
${evidenceSummary(ev)}

Return ONLY a JSON object (no prose, no code fences) with these keys:
{
  "typedSpec": {
    "composition": { "width": number, "height": number, "fps": number, "durationSec": number, "aspectRatio": "9:16"|"16:9"|"1:1", "background": "#hex" },
    "scenes": [ { "id": string, "role": ${JSON.stringify(sectionRoles)}, "startSec": number, "endSec": number, "intent": string,
                 "layers": [ { "id": string, "type": "media"|"text"|"shape"|"background"|"cta", "placeholderId"?: string, "startSec"?: number, "endSec"?: number } ],
                 "motionGrammar": string[], "packagingGrammar": string[], "evidenceRefs": string[] } ],
    "globalStyle": { "palette": ["#hex"], "typographySystem": string, "motionIntensity": "low"|"medium"|"high", "textDensity": "low"|"medium"|"high", "pacing": "slow"|"medium"|"fast", "coherenceNotes": string[] },
    "audioCues": [ { "t": number, "type": "impact"|"hit"|"riser"|"duck"|"beat", "role": string } ]
  },
  "placeholders": [ { "id": string, "kind": "hero_product"|"product_closeup"|"hero_head"|"background"|"logo"|"main_title"|"subtitle_text"|"voiceover"|"sfx"|"cta_card", "required": boolean, "sectionId": string, "startSec": number, "endSec": number, "evidenceRefs": string[], "replacementPolicy": "target_asset"|"generate"|"text_fallback"|"optional", "safetyPolicy": "must_replace_sample"|"can_use_user_asset"|"procedural_only", "sourcePolicy": "sample_evidence_only" } ],
  "timingMap": [ { "id": string, "startSec": number, "endSec": number, "role": string, "evidenceRefs": string[] } ],
  "learnedAssetRecipes": [ { "id": string, "kind": "hero_product"|"hero_head"|"background"|"cover"|"product_card"|"sticker"|"logo_placeholder"|"comparison_card", "observedDescription": { "subject": string }, "generationPromptTemplate": string, "negativePrompt": string, "placementHint": { "sectionRole": "hook"|"setup"|"proof"|"cta" }, "reusablePolicy": "regenerate_only", "evidenceRefs": string[] } ],
  "learnedAudioRecipes": [ { "id": string, "kind": "music_bed"|"impact"|"whoosh"|"riser"|"voiceover_style"|"ducking_pattern", "mood": string[], "cuePoints": [ { "t": number, "type": "hit"|"riser"|"impact"|"duck", "role": string } ], "generationPromptTemplate": string, "negativePrompt": string, "reusablePolicy": "regenerate_only"|"procedural_recreate", "evidenceRefs": string[] } ]
}
Rules: scenes must cover the full duration with no gaps; every scene cites real evidenceRefIds; placeholders cover all sample-specific content; never copy sample text/pixels/audio.${repair}`;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

function assemble(ev: v5.EvidenceTimelineV5, partial: Gen1Partial, fallback: v5.NeutralReconstructionProgram): v5.NeutralReconstructionProgram {
  return {
    id: fallback.id,
    sourceSampleId: ev.assetId,
    evidenceTimelineId: ev.id,
    evidenceRefs: partial.evidenceRefs ?? fallback.evidenceRefs,
    typedSpec: partial.typedSpec ?? fallback.typedSpec,
    remotionProject: fallback.remotionProject, // fixed-root renderable; AI does not emit TSX
    placeholders: partial.placeholders?.length ? partial.placeholders : fallback.placeholders,
    timingMap: partial.timingMap?.length ? partial.timingMap : fallback.timingMap,
    learnedAssetRecipes: partial.learnedAssetRecipes ?? fallback.learnedAssetRecipes,
    learnedAudioRecipes: partial.learnedAudioRecipes ?? fallback.learnedAudioRecipes,
    reconstructionQuality: {
      structureCoverage: 0.85,
      timingCoverage: fallback.reconstructionQuality?.timingCoverage ?? 0.85,
      placeholderCoverage: 0.85,
      warnings: ["AI Gen1 reconstruction (typedSpec from model, renderable envelope deterministic)."]
    },
    safety: fallback.safety,
    fallbackUsed: false
  };
}

/** Run AI Gen1 with an injected model fn; validate + one repair; deterministic fallback on failure. */
export async function runGen1Ai(ev: v5.EvidenceTimelineV5, model: Gen1ModelFn): Promise<Gen1AiResult> {
  const warnings: string[] = [];
  const fallback = runGen1NeutralTemplate(ev).program;

  let lastRaw: string | undefined;
  let lastErrors: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildGen1Prompt(ev, attempt > 0 ? lastErrors : undefined);
    let raw: string;
    try {
      raw = await model(prompt);
      lastRaw = raw;
    } catch (err) {
      warnings.push(`Gen1 model call failed: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    let partial: Gen1Partial;
    try {
      partial = extractJson(raw) as Gen1Partial;
    } catch (err) {
      lastErrors = [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`];
      warnings.push(lastErrors[0]);
      continue;
    }
    const program = assemble(ev, partial, fallback);
    const validation = v5.validateNeutralReconstructionProgram(program);
    if (validation.valid) {
      return { program, usedAi: true, validation, warnings, raw };
    }
    lastErrors = validation.errors;
    warnings.push(`Gen1 attempt ${attempt + 1} invalid: ${validation.errors.slice(0, 3).join("; ")}`);
  }

  // fall back to deterministic template
  warnings.push("Gen1 AI failed; using deterministic neutral template.");
  return { program: fallback, usedAi: false, validation: v5.validateNeutralReconstructionProgram(fallback), warnings, raw: lastRaw };
}
