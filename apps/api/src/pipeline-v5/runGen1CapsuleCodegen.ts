// pipeline-v5/runGen1CapsuleCodegen.ts
// Phase 1 (V5.1) — REAL AI generation of a RemotionTemplateCapsule's Remotion TSX.
//
// The deterministic capsule from runGen1TemplateReconstruction is the GUARANTEED fallback. This module
// asks a model to regenerate ONLY codeBundle.files (richer motion/typography), keeping componentName /
// entryFile / propsSchema / slotSchema / timing / safety fixed so binding + render contracts can't drift.
//
// apply != promote: the AI bundle is "applied" (held in memory) regardless; it is only "promoted"
// (returned in place of the deterministic bundle) after THREE gates pass —
//   1. compile  (validateTemplateCapsule T2, syntax)
//   2. safety / no-copy  (validateTemplateCapsule T5/T6/T6b/T9/T10 — no sample paths/URLs/forbidden API/copied text)
//   3. real render  (renderTemplateCapsule actually bundles + renders a short clip with the neutral fixture)
// On any failure the deterministic bundle stays. No network / no chrome in tests (inject model + probe).

import path from "node:path";
import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";
import { renderTemplateCapsule } from "./renderTemplateCapsule.js";

export interface CapsuleCodegenInput {
  /** Deterministic capsule — only its codeBundle may be replaced; everything else is authoritative. */
  capsule: v5.RemotionTemplateCapsule;
  program: v5.NeutralReconstructionProgram;
  evidence: v5.EvidenceTimelineV5;
  /** Injected model fn; tests pass a stub, the real path uses createGeminiModelFn({ model: GEMINI_CODEGEN_MODEL }). */
  model: Gen1ModelFn;
}

export interface CapsuleCodegenOptions {
  /** Render gate. Defaults to a real 1-shot renderTemplateCapsule probe; tests inject a stub (no chrome). */
  renderProbe?: (codeBundle: v5.RemotionTemplateCapsule["codeBundle"]) => Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  /** Initial attempt + repairs. Default 2 (1 initial + 1 repair). */
  maxAttempts?: number;
}

export interface CapsuleCodegenResult {
  /** The codeBundle to USE: promoted AI bundle iff all gates passed, else the input deterministic bundle. */
  codeBundle: v5.RemotionTemplateCapsule["codeBundle"];
  usedAi: boolean;
  validation: {
    compilePassed: boolean;
    renderPreviewPassed: boolean;
    noCopyPassed: boolean;
    gates: v5.TemplateGateResult[];
  };
  warnings: string[];
  raw?: string;
}

/** Strip code fences and pull the first {...} JSON object (mirrors runGen1Ai.extractJson). */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json|tsx?|jsx?)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Build the codegen prompt. Feeds ONLY structural/numeric evidence (timings, beats, palette hexes,
 * slot kinds, section roles) + the deterministic TSX as a worked example — NEVER raw sample copy /
 * transcript text (prompt-injection + copyright guard; the output is then re-gated for sample text).
 */
export function buildCapsuleCodegenPrompt(
  capsule: v5.RemotionTemplateCapsule,
  program: v5.NeutralReconstructionProgram,
  evidence: v5.EvidenceTimelineV5,
  repairErrors?: string[]
): string {
  const slots = capsule.slotSchema.map((s) => ({ id: s.id, kind: s.kind, required: s.required, propPath: s.propPath }));
  const timing = {
    durationSec: capsule.timingSignature.durationSec,
    fps: capsule.timingSignature.fps,
    sections: capsule.timingSignature.sections.map((s) => ({ role: s.role, startSec: s.startSec, endSec: s.endSec, internalBeats: (s.internalBeats ?? []).slice(0, 8) }))
  };
  const motion = capsule.motionSignature;
  const gs = (program.typedSpec?.globalStyle ?? {}) as unknown as Record<string, unknown>;
  const palette = (gs.palette as string[] | undefined) ?? (capsule.fixtures.neutralFixture as { palette?: string[] }).palette ?? [];
  const referenceTsx = capsule.codeBundle.files.find((f) => f.path === capsule.codeBundle.entryFile)?.content ?? capsule.codeBundle.files[0]?.content ?? "";
  const repair = repairErrors?.length
    ? `\n\nYOUR PREVIOUS OUTPUT WAS REJECTED. Fix exactly these problems and resend the full JSON:\n- ${repairErrors.slice(0, 6).join("\n- ")}`
    : "";

  return `You generate a single self-contained Remotion (v4) React template component in TypeScript (TSX).
This template reconstructs the MOTION/STRUCTURE of a sample ad video. ALL on-screen CONTENT must come
from props — you must NOT embed any sample imagery, audio, text, brand or asset path.

Return ONLY a JSON object, no prose, no markdown fences:
{ "componentName": "${capsule.codeBundle.componentName}", "indexTsx": "<the full TSX source as a JSON string>" }

HARD REQUIREMENTS (your output is automatically rejected if any are violated):
- The component MUST be: export const ${capsule.codeBundle.componentName} = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => ( ... )
  (named export, EXACTLY this name and this destructured props signature.)
- Import ONLY from "react" and "remotion" / "@remotion/*". No other imports.
- FORBIDDEN anywhere in the code: require( , process. , child_process , fs. , eval( , fetch( , XMLHttpRequest , import( .
- NO literal asset paths, NO literal media URLs, NO <Audio|Video|OffthreadVideo src="literal"> — every image/media src must read from props (e.g. assets.heroImage?.src).
- NO literal on-screen text node longer than 60 characters; all copy comes from the copy.* props.
- Render a full-bleed OPAQUE <AbsoluteFill> with a solid/gradient background in every section (no transparent frames).
- Graceful degradation: if an asset prop is missing, render a designed gradient/card fallback; if a copy prop is missing, render "".
- You MAY define inline helper components for backgrounds, beat pulses, Ken Burns image, kinetic title, subtitle, CTA card, designed card.

REPRODUCE THIS STRUCTURE EXACTLY (section boundaries + beats drive the motion; cover the full duration with no gaps):
TIMING = ${JSON.stringify(timing)}
MOTION_SIGNATURE = ${JSON.stringify(motion)}
GLOBAL_STYLE = ${JSON.stringify({ motionIntensity: gs.motionIntensity, pacing: gs.pacing, typographySystem: gs.typographySystem })}
DEFAULT_PALETTE = ${JSON.stringify(palette)}   // bake as the PALETTE const default; runtime palette still comes from props.

SLOTS — read each slot's content from its propPath (these keys MUST line up with the bound props):
${JSON.stringify(slots, null, 0)}

REFERENCE IMPLEMENTATION (a known-good deterministic version — KEEP its component signature, the same
section structure and props-driven content; you may IMPROVE the motion, layout fidelity and typography):
\`\`\`tsx
${referenceTsx.slice(0, 9000)}
\`\`\`
Evidence summary (structural only): ${JSON.stringify({ shots: evidence.shots?.length ?? 0, bpm: evidence.audioEvidence?.bpm, beats: (evidence.audioEvidence?.beatGridSec ?? []).length })}.${repair}`;
}

/** Default render gate: really bundle + render a SHORT clip of the candidate with the neutral fixture. */
async function defaultRenderProbe(
  input: CapsuleCodegenInput,
  candidate: v5.RemotionTemplateCapsule["codeBundle"]
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  // Probe-only clone: candidate code + shortened duration (bundling dominates; keep render cheap).
  const probeCapsule: v5.RemotionTemplateCapsule = {
    ...input.capsule,
    codeBundle: candidate,
    timingSignature: { ...input.capsule.timingSignature, durationSec: Math.min(input.capsule.timingSignature.durationSec || 16, 2) }
  };
  const outPath = path.join(process.cwd(), "storage", "generated", "v5", "_capsule_codegen_probe", `${input.capsule.id}_${Date.now()}.mp4`);
  const res = await renderTemplateCapsule({
    capsule: probeCapsule,
    boundProps: input.capsule.fixtures.neutralFixture as Record<string, unknown>,
    outPath,
    aspectRatio: "9:16",
    proceduralAudio: false // test the TSX, not the audio mux
  });
  return { ok: res.ok, error: res.error, warnings: res.warnings };
}

export async function runGen1CapsuleCodegen(input: CapsuleCodegenInput, opts: CapsuleCodegenOptions = {}): Promise<CapsuleCodegenResult> {
  const fallbackBundle = input.capsule.codeBundle;
  const warnings: string[] = [];
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const renderProbe = opts.renderProbe ?? ((cb) => defaultRenderProbe(input, cb));

  let lastErrors: string[] = [];
  let lastRaw: string | undefined;
  let lastGates: v5.TemplateGateResult[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await input.model(buildCapsuleCodegenPrompt(input.capsule, input.program, input.evidence, attempt > 0 ? lastErrors : undefined));
    } catch (err) {
      warnings.push(`capsule codegen model error: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      break; // model unreachable — keep deterministic
    }
    lastRaw = raw;

    // Parse + normalize the candidate bundle (force the component name back to the contract).
    let candidate: v5.RemotionTemplateCapsule["codeBundle"];
    try {
      const obj = extractJson(raw) as { componentName?: string; indexTsx?: string };
      if (!obj.indexTsx || typeof obj.indexTsx !== "string") throw new Error("missing indexTsx");
      candidate = { files: [{ path: "index.tsx", content: obj.indexTsx }], entryFile: "index.tsx", componentName: input.capsule.codeBundle.componentName };
    } catch (err) {
      lastErrors = [`output is not valid JSON {componentName, indexTsx}: ${err instanceof Error ? err.message : String(err)}`];
      warnings.push(lastErrors[0]);
      continue;
    }

    // GATE 1+2 — compile + safety/no-copy (static, fast, no chrome).
    const v = validateTemplateCapsule({ ...input.capsule, codeBundle: candidate });
    lastGates = v.gates;
    const status = (id: string) => v.gates.find((x) => x.id === id)?.status;
    const compilePassed = status("T2") === "pass";
    const noCopyPassed =
      status("T5") === "pass" && status("T6") === "pass" && status("T9") === "pass" && status("T10") === "pass" && v.gates.every((x) => x.id !== "T6b");
    if (!compilePassed || !noCopyPassed) {
      lastErrors = v.gates.filter((x) => x.status === "fail" || (["T5", "T6", "T9", "T10", "T6b"].includes(x.id) && x.status === "warn")).map((x) => `${x.id} ${x.name}: ${x.message}`);
      if (!lastErrors.length) lastErrors = [compilePassed ? "no-copy/safety gate not green" : "did not compile"];
      warnings.push(`AI capsule attempt ${attempt + 1} rejected at static gate: ${lastErrors.slice(0, 2).join("; ")}`);
      continue;
    }

    // GATE 3 — real render (dynamic). apply -> promote only when this also passes.
    let probe: { ok: boolean; error?: string; warnings?: string[] };
    try {
      probe = await renderProbe(candidate);
    } catch (err) {
      probe = { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
    }
    if (probe.warnings?.length) warnings.push(...probe.warnings);
    if (!probe.ok) {
      lastErrors = [`render gate failed: ${probe.error ?? "unknown"}`];
      warnings.push(`AI capsule attempt ${attempt + 1} rejected at render gate: ${probe.error ?? "unknown"}`);
      continue;
    }

    // ALL GREEN — promote.
    return {
      codeBundle: candidate,
      usedAi: true,
      validation: { compilePassed: true, renderPreviewPassed: true, noCopyPassed: true, gates: v.gates },
      warnings,
      raw
    };
  }

  // Fell through — keep the deterministic bundle (guaranteed path).
  return {
    codeBundle: fallbackBundle,
    usedAi: false,
    validation: { compilePassed: false, renderPreviewPassed: false, noCopyPassed: false, gates: lastGates },
    warnings,
    raw: lastRaw
  };
}
