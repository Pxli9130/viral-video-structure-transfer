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

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import type { VisionCodegenFn } from "./gen1ModelFactory.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";
import { renderCapsuleStill } from "./renderTemplateCapsule.js";

export interface CapsuleCodegenInput {
  /** Deterministic capsule — only its codeBundle may be replaced; everything else is authoritative. */
  capsule: v5.RemotionTemplateCapsule;
  program: v5.NeutralReconstructionProgram;
  evidence: v5.EvidenceTimelineV5;
  /** Injected text model fn; tests pass a stub, the real path uses createGeminiModelFn({ model: GEMINI_CODEGEN_MODEL }). */
  model: Gen1ModelFn;
  /** Source keyframes (base64) so a multimodal model can SEE the video it reconstructs (richer fidelity). */
  frames?: Array<{ base64: string; mimeType: string }>;
  /** Multimodal codegen fn (prompt + frames -> code). When present with frames, used instead of `model`. */
  visionModel?: VisionCodegenFn;
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
  repairErrors?: string[],
  multimodal?: boolean
): string {
  const name = capsule.codeBundle.componentName;
  const slots = capsule.slotSchema.map((s) => ({ id: s.id, kind: s.kind, required: s.required, propPath: s.propPath }));
  const timing = {
    durationSec: capsule.timingSignature.durationSec,
    fps: capsule.timingSignature.fps,
    sections: capsule.timingSignature.sections.map((s) => ({ role: s.role, startSec: s.startSec, endSec: s.endSec, internalBeats: (s.internalBeats ?? []).slice(0, 8) }))
  };
  const gs = (program.typedSpec?.globalStyle ?? {}) as unknown as Record<string, unknown>;
  const palette = (gs.palette as string[] | undefined) ?? (capsule.fixtures.neutralFixture as { palette?: string[] }).palette ?? [];
  const referenceTsx = capsule.codeBundle.files.find((f) => f.path === capsule.codeBundle.entryFile)?.content ?? capsule.codeBundle.files[0]?.content ?? "";
  const recipes = (capsule.sceneRecipes ?? []).map((r) => ({
    role: r.role,
    transitionIn: r.transitionIn,
    cameraMove: r.subject?.cameraMove,
    subjectAnchor: r.subject?.anchor,
    textAnchor: r.textAnchor,
    textAnim: r.textAnim,
    mood: r.grading.mood,
    composition: r.vlm?.composition,
    layoutZones: r.vlm?.layoutZones,
    graphicElements: r.vlm?.graphicElements,
    typography: r.vlm?.typography,
    treatment: r.vlm?.treatment
  }));
  const repair = repairErrors?.length
    ? `\n\nYOUR PREVIOUS OUTPUT WAS REJECTED. Fix exactly these problems and resend the full JSON:\n- ${repairErrors.slice(0, 6).join("\n- ")}`
    : "";

  const seeing = multimodal
    ? `The attached images are KEYFRAMES sampled from the ACTUAL source video (one per scene, in order).
Reconstruct the EXACT visual style you SEE: the layout, composition, any 3D / motion-graphics elements,
the colour treatment, the typography placement and the motion. Someone should recognise the rendered
template as the SAME design as the source — only the words and photos are new.`
    : `Reconstruct the source's structure from the SCENE_RECIPES and TIMING below (you cannot see the frames).`;

  return `You are reconstructing a short vertical (9:16) ad video as a REUSABLE, props-driven Remotion (v4)
template component in TypeScript (TSX). ${seeing}

Return ONLY a JSON object, no prose, no markdown fences:
{ "componentName": "${name}", "indexTsx": "<the full TSX source as a JSON string>" }

YOU MAY import from: "react", "remotion", "@remotion/three", "three", "@react-three/fiber".
You MAY build, to faithfully match what the source does: real 3D (e.g. <ThreeCanvas> from
"@remotion/three" with THREE geometry — TubeGeometry/Extrude/Text, useFrame from "@react-three/fiber"),
programmatic <canvas> textures (document.createElement("canvas") + CanvasTexture for kinetic text on a
ribbon/strip), inline SVG, CSS 3D transforms, masks, clip-paths, gradients, particles, shapes.

THE NO-COPY RULE (strict — STRUCTURE is reusable, CONTENT is not):
- STRUCTURE you SHOULD hardcode: layout, geometry, ribbons, shapes, 3D, motion curves, transitions,
  colour treatment, typography STYLE/position/animation, the whole design system.
- CONTENT you MUST NOT hardcode: any of the source's readable text, headlines, brand names, logos, or
  its photographic imagery. Every readable WORD on screen must come from the copy.* props; every PHOTO
  from the assets.* props. If the design has scrolling/kinetic text (e.g. on a 3D ribbon), feed that
  text from a copy prop (e.g. Object.values(copy).filter(Boolean).join("  ·  ")), NEVER the source's words.

HARD REQUIREMENTS (output auto-rejected otherwise):
- export const ${name} = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => ( ... )
  (named export, EXACTLY this name and this destructured props signature.)
- FORBIDDEN tokens anywhere: require( , process. , child_process , fs. , eval( , fetch( , XMLHttpRequest , dynamic import( .
- NO literal http(s) URL ANYWHERE — no unsplash / stock-image / CDN links, no remote textures. EVERY
  image comes ONLY from assets.* props (e.g. assets.heroImage?.src); if an asset prop is missing, draw a
  gradient/shape/3D placeholder — NEVER a stock URL, NEVER a literal label like "Hero Image".
- NO readable words hardcoded ANYWHERE — not in JSX text, not in canvas fillText/strokeText, not in 3D
  Text/textGeometry. ALL readable copy comes from copy.* props. For kinetic / 3D-ribbon / scrolling text,
  build it from props, e.g.: const ribbonText = Object.values(copy).filter(Boolean).join("  ·  ") || theme;
  then draw ribbonText — NEVER the source's words.
- Fallback defaults for a missing copy prop MUST be GENERIC placeholders ("Headline", "Subtitle",
  "Learn more"), NEVER the source's actual words/headlines (e.g. do NOT write copy.x || "GRADUATION
  EXHIBITION"). Prefer copy.x || "" or a generic single word.
- Full-bleed OPAQUE background; cover the FULL ${timing.durationSec}s across the sections with no gaps.
- Use frame-driven motion only (useCurrentFrame / interpolate / spring / useFrame). Per scene, compute
  local progress from the scene's OWN duration (frame relative to its <Sequence>), not the whole video.
- Graceful fallback when a prop is missing: a designed placeholder (NEVER the source's content, NEVER a
  literal label like "Hero Image").

STRUCTURE TO REPRODUCE (cover the full duration; section boundaries + beats drive timing):
TIMING = ${JSON.stringify(timing)}
DEFAULT_PALETTE = ${JSON.stringify(palette)}   // bake as the PALETTE const default; runtime palette still comes from props.
SCENE_RECIPES (per scene: grading mood / camera / transition / text placement${multimodal ? " + VLM composition, layoutZones, graphicElements, typography, treatment" : ""}):
${JSON.stringify(recipes)}

SLOTS — read each slot's content from its propPath; these keys are SECTION-SPECIFIC, so each scene gets
its OWN image/copy (do NOT reuse one image across scenes):
${JSON.stringify(slots, null, 0)}
${multimodal ? "" : `\nREFERENCE deterministic implementation (keep the signature + section structure; improve fidelity):\n\`\`\`tsx\n${referenceTsx.slice(0, 7000)}\n\`\`\``}${repair}`;
}

/** Default render gate: really bundle + render ONE FRAME of the candidate with the neutral fixture. */
async function defaultRenderProbe(
  input: CapsuleCodegenInput,
  candidate: v5.RemotionTemplateCapsule["codeBundle"]
): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  const probeCapsule: v5.RemotionTemplateCapsule = { ...input.capsule, codeBundle: candidate };
  const res = await renderCapsuleStill({
    capsule: probeCapsule,
    boundProps: input.capsule.fixtures.neutralFixture as Record<string, unknown>,
    aspectRatio: "9:16"
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
    const multimodal = Boolean(input.visionModel && input.frames?.length);
    try {
      const prompt = buildCapsuleCodegenPrompt(input.capsule, input.program, input.evidence, attempt > 0 ? lastErrors : undefined, multimodal);
      raw = multimodal ? await input.visionModel!(prompt, input.frames!) : await input.model(prompt);
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
    // T9 may WARN on generic ALL-CAPS fallbacks (only shown if a prop is missing) — that is acceptable
    // for promotion; only a T9 FAIL (rendered canvas/3D sample text) blocks. T5/T6/T10 must be pass.
    const noCopyPassed =
      status("T5") === "pass" && status("T6") === "pass" && status("T9") !== "fail" && status("T10") === "pass" && v.gates.every((x) => x.id !== "T6b");
    if (!compilePassed || !noCopyPassed) {
      lastErrors = v.gates.filter((x) => x.status === "fail" || (["T5", "T6", "T10", "T6b"].includes(x.id) && x.status === "warn")).map((x) => `${x.id} ${x.name}: ${x.message}`);
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
