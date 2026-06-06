// pipeline-v5/runGen1CapsuleGemini.ts
// Single best-Pro Gemini call (per the user's Gen1 spec): reads the ENTIRE source video + deterministic
// evidence and returns ONE JSON { capsule, sceneRecipes, knowledgeElements, selfReview } — a props-driven
// RemotionTemplateCapsule that reconstructs the source's structure/timing/layout/motion/transitions
// (react + remotion only, NO sample pixels/audio/text). We then compile + render-validate the returned
// code and repair-loop on failure; on success we adopt the Gemini capsule, else keep the deterministic one.

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import type { VisionCodegenFn } from "./gen1ModelFactory.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";

export interface Gen1CapsuleGeminiInput {
  deterministic: v5.RemotionTemplateCapsule; // guaranteed fallback + source of any field Gemini omits
  evidence: v5.EvidenceTimelineV5;
  videoPath?: string;
  frames?: Array<{ base64: string; mimeType: string }>;
  /** Best-Pro multimodal model (sees the video). Required for this path. */
  visionModel: VisionCodegenFn;
  /** Text model for the repair loop (cheaper; code-only). Falls back to visionModel if absent. */
  repairModel?: Gen1ModelFn;
  renderProbe: (codeBundle: v5.RemotionTemplateCapsule["codeBundle"], neutralFixture: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  maxAttempts?: number;
}

export interface Gen1CapsuleGeminiResult {
  usedAi: boolean;
  capsule?: v5.RemotionTemplateCapsule;
  sceneRecipes?: v5.SceneVisualRecipeV5[];
  knowledgeElements?: unknown[];
  selfReview?: unknown;
  validation: { compilePassed: boolean; renderPreviewPassed: boolean; noCopyPassed: boolean };
  warnings: string[];
  raw?: string;
}

/** Compact deterministic-evidence JSON fed to the model as ground truth. */
export function buildEvidenceJson(ev: v5.EvidenceTimelineV5): string {
  const me = (ev.motionEvidence ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    durationSec: ev.shots?.length ? ev.shots[ev.shots.length - 1].endSec : undefined,
    fps: 30,
    aspectRatio: "9:16",
    shots: (ev.shots ?? []).map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, summary: (s as { summary?: string }).summary })),
    keyFrames: (ev.keyFrames ?? []).map((k) => ({ timeSec: k.timeSec })),
    audio: { bpm: ev.audioEvidence?.bpm, beatGridSec: (ev.audioEvidence?.beatGridSec ?? []).slice(0, 32), onsetsSec: (ev.audioEvidence?.onsetsSec ?? []).slice(0, 32) },
    motion: { peakMomentsSec: (me.peakMomentsSec as number[] | undefined)?.slice(0, 16), cutDensity: me.cutDensity }
  });
}

export function buildGen1CapsulePrompt(evidenceJson: string): string {
  return `You are a senior Remotion v4 motion-design engineer and creative reconstruction agent.

You are given:
1. The full source video as video input.
2. Deterministic evidence extracted from the same video (duration, fps, aspect ratio, shot timeline,
   keyframes, beat grid / audio energy, motion intensity).

Your task: WATCH the entire video and write a complete Remotion v4 component that RE-CREATES this exact
video as faithfully as possible — same look, same layout, same composition, same camera movement, same
transitions, same kinetic typography, same colour grading, same motion over time, same beat timing. Be
ambitious and detailed. If the source uses 3D (twisting ribbon, extruded text, particles), build real 3D
with @remotion/three + three + @react-three/fiber. If it uses kinetic text, build it (programmatic
<canvas> + CanvasTexture is fine). It is OK to hardcode the text/colours/content you see for now — this
is the faithful reconstruction; a later step changes the text/theme.

This is NOT a generic ad template, NOT a summary, NOT a storyboard, NOT a static card renderer. It must
visibly look like THIS source video when rendered.

Allowed imports: react, remotion, @remotion/three, three, @react-three/fiber. Use Remotion v4 APIs
(AbsoluteFill, Sequence, Img, Audio, interpolate, spring, Easing, useCurrentFrame, useVideoConfig).
FORBIDDEN tokens (they break headless rendering): require( , process. , child_process , fs. , eval( ,
fetch( , XMLHttpRequest , dynamic import( . No remote http(s) image/texture URLs (headless can't fetch
them — draw them, or leave a prop). Everything else is allowed.

Return ONLY valid JSON (no markdown, no code fences, no prose) matching this top-level shape:
{ "capsule": { "id","sourceSampleId","name","description","tags":[],
    "codeBundle": { "files":[{"path":"index.tsx","content":"<complete TSX>"}], "entryFile":"index.tsx", "componentName":"TemplateFromSample" },
    "propsSchema": {}, "slotSchema": [], "timingSignature": {}, "motionSignature": {},
    "assetRecipes": [], "audioRecipes": [], "fixtures": { "neutralFixture": {}, "exampleThemeFixture": {} },
    "safety": {}, "quality": {} },
  "sceneRecipes": [], "knowledgeElements": [],
  "selfReview": { "fidelityRisks": [], "compileRisks": [], "safetyRisks": [], "missingEvidence": [] } }

The code in codeBundle.files[0].content must be complete and compile-ready, and MUST export this exact
signature (so our renderer can mount it — you MAY ignore the props and hardcode for the faithful draft):
  const PALETTE = ["#0A0A0A","#FFFFFF","#F7C948","#1A1A1A"];
  export const TemplateFromSample = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => { ... };

The code must: (1) cover the full duration with no gaps; (2) one Sequence per detected scene; (3) use
SECTION-LOCAL frame progress for animation; (4) always render an opaque full-bleed background; (5) include
real motion throughout each scene (not a 0.3s intro then static); (6) use SCENE-SPECIFIC transitions; (7)
scene-specific text anchor + animation matching the video; stable keys; no CSS transitions for frame-driven
motion; use optional chaining + fallbacks so it never crashes.

FIDELITY: do NOT collapse all scenes to one layout; do NOT default to a generic gradient+centered-card
unless the source truly looks that way. Each source scene should have distinct layout/motion/transition/
text behavior based on what you SEE in the video.

RECONSTRUCT EVERY VISUAL LAYER — do NOT reduce a footage/photo-heavy video to text only. If a scene has
a BACKGROUND VIDEO / live-action footage, reconstruct it as <OffthreadVideo src={assets.bgVideo?.src}/>
(or a placeholder full-bleed motion layer when no asset). If it has PHOTOS / product / b-roll that pan or
zoom, reconstruct them as <Img src={assets.clip1?.src}/> with the same camera move (ken burns / pan).
Layer text OVER the footage like the source does. Every distinct image/footage layer you see MUST become
its own asset slot in slotSchema (kind "image" or "video", propPath assets.<id>) so it can be filled —
e.g. assets.bgVideo, assets.clip1, assets.clip2, assets.heroImage, assets.logo. A montage of clips ->
multiple Sequences each with its own <Img>/<OffthreadVideo> layer, NOT a single text card.

DO NOT REPRODUCE PLATFORM CHROME / WATERMARKS. Skip entirely (do not draw, do not make a slot): any
platform watermark or badge (小红书 / Xiaohongshu / RED / 抖音 / Douyin / TikTok / Instagram / 微信 /
Bilibili logos), account handles / IDs (e.g. "小红书号: 4287481687", @username), follow / subscribe /
like-share end-cards, QR codes, and any "关注我" / "扫码" overlays. These are app UI, NOT the ad's content —
reconstruct only the actual ad. If the LAST scene is just such a follow/handle card, omit that scene.

Also extract (for a later content-modification step):
- sceneRecipes[]: { id,startSec,endSec,role, visualSummary, layout:{subjectAnchor,textAnchor,depthLayers[]},
  cameraMove:{type,intensity,curve}, transitionIn:{type,durationSec,direction}, transitionOut,
  textAnimation:{type,split,staggerFrames}, imageTreatment:{type,vignette,grain},
  grading:{mood,palette[],brightness,contrast,saturation}, audioCues:[{id,tSec,kind,intensity}] }.
- slotSchema[]: which on-screen TEXT / IMAGE / AUDIO pieces could be swapped later
  { id,kind,required,originalRole,propPath,replacementPolicy,description }.
- knowledgeElements[]: reusable atomic patterns { id,kind(hook_pattern|rhythm_pattern|typography_pattern|
  transition_pattern|visual_asset_pattern|audio_pattern|cta_pattern|remotion_snippet),name,description,
  sourceSceneIds[],params }.

Now analyze the entire attached video and evidence.
DETERMINISTIC_EVIDENCE_JSON:
${evidenceJson}

Return only valid JSON.`;
}

export function buildGen1RepairPrompt(errors: string[], codeBundleJson: string): string {
  return `Your RemotionTemplateCapsule did not COMPILE or RENDER. Return a corrected JSON response with the
SAME top-level schema. Only change what's needed to fix the errors — do NOT remove motion/3D complexity
and do NOT fall back to a generic template; keep the faithful reconstruction.

Requirements: code must compile + render headlessly with React + Remotion v4 (you may use @remotion/three
+ three + @react-three/fiber); keep the exact "export const TemplateFromSample = ({ assets, copy, audio,
theme, palette }) => ..." signature; no forbidden tokens (require/process/fs/eval/fetch/XMLHttpRequest/
dynamic import); no remote http(s) URLs (headless can't fetch). Return ONLY valid JSON.

VALIDATION ERRORS:
- ${errors.slice(0, 8).join("\n- ")}

CURRENT codeBundle:
${codeBundleJson.slice(0, 14000)}`;
}

function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) && v.length ? v : undefined;
}
function asObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function extractJson(raw: string): Record<string, unknown> | null {
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s < 0 || e <= s) return null;
    return JSON.parse(body.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Build a candidate capsule from Gemini's response. The RETURNED REMOTION CODE IS CANONICAL — we keep
 * it byte-for-byte (files + componentName + entryFile exactly as Gemini gave them) and only fill genuinely
 * MISSING metadata fields from the deterministic capsule so the object type-checks. We never rewrite the code.
 */
function mergeCapsule(det: v5.RemotionTemplateCapsule, g: Record<string, unknown>): { capsule: v5.RemotionTemplateCapsule; code: string } {
  const gc = asObject(g.capsule) ?? {};
  const cb = asObject(gc.codeBundle) ?? {};
  const files = (asArray(cb.files) as Array<{ path?: string; content?: string }> | undefined)?.filter((f) => f && typeof f.content === "string" && f.content.length);
  const code = String(files?.[0]?.content ?? "");
  const codeBundle: v5.RemotionTemplateCapsule["codeBundle"] = {
    files: files?.length ? files.map((f) => ({ path: String(f.path ?? "index.tsx"), content: String(f.content) })) : det.codeBundle.files,
    entryFile: typeof cb.entryFile === "string" ? cb.entryFile : files?.[0]?.path ? String(files[0].path) : "index.tsx",
    componentName: typeof cb.componentName === "string" && cb.componentName ? cb.componentName : "TemplateFromSample"
  };
  const slotSchema = asArray(gc.slotSchema) as v5.TemplateSlot[] | undefined;
  const validSlots = slotSchema?.every((s) => s && typeof s.id === "string" && typeof s.propPath === "string") ? slotSchema : undefined;
  const capsule: v5.RemotionTemplateCapsule = {
    ...det,
    codeBundle, // CANONICAL — Gemini's code, untouched
    slotSchema: validSlots ?? det.slotSchema,
    propsSchema: asObject(gc.propsSchema) ?? det.propsSchema,
    timingSignature: (asObject(gc.timingSignature) as unknown as v5.RemotionTemplateCapsule["timingSignature"]) ?? det.timingSignature,
    motionSignature: (asObject(gc.motionSignature) as unknown as v5.RemotionTemplateCapsule["motionSignature"]) ?? det.motionSignature,
    assetRecipes: (asArray(gc.assetRecipes) as v5.AssetRecipeV5[]) ?? det.assetRecipes,
    audioRecipes: (asArray(gc.audioRecipes) as v5.AudioRecipeV5[]) ?? det.audioRecipes,
    fixtures: (asObject(gc.fixtures) as unknown as v5.RemotionTemplateCapsule["fixtures"]) ?? det.fixtures,
    safety: det.safety, // metadata only; never rewrites code
    quality: { ...det.quality, codeOrigin: "ai", recipeSource: "vlm" }
  };
  if (!capsule.timingSignature?.sections?.length) capsule.timingSignature = det.timingSignature;
  if (!capsule.fixtures?.neutralFixture) capsule.fixtures = det.fixtures;
  return { capsule, code };
}

export async function runGen1CapsuleGemini(input: Gen1CapsuleGeminiInput): Promise<Gen1CapsuleGeminiResult> {
  const warnings: string[] = [];
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);
  const evidenceJson = buildEvidenceJson(input.evidence);
  const fail: Gen1CapsuleGeminiResult = { usedAi: false, validation: { compilePassed: false, renderPreviewPassed: false, noCopyPassed: false }, warnings };

  let lastErrors: string[] = [];
  let lastRaw: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let raw: string;
    try {
      if (attempt === 0) {
        raw = await input.visionModel(buildGen1CapsulePrompt(evidenceJson), input.frames ?? [], input.videoPath);
      } else {
        // Repair: code-only, prefer the cheaper text model.
        const repairPrompt = buildGen1RepairPrompt(lastErrors, lastRaw ?? "");
        raw = input.repairModel ? await input.repairModel(repairPrompt) : await input.visionModel(repairPrompt, [], undefined);
      }
    } catch (err) {
      warnings.push(`gen1 capsule model error: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`);
      break;
    }
    lastRaw = raw;
    const parsed = extractJson(raw);
    if (!parsed) {
      lastErrors = ["response was not valid JSON with the required top-level shape"];
      warnings.push("gen1 capsule: unparseable JSON");
      continue;
    }
    const { capsule, code } = mergeCapsule(input.deterministic, parsed);
    if (!code) {
      lastErrors = ["capsule.codeBundle.files[0].content was empty"];
      warnings.push("gen1 capsule: empty code");
      continue;
    }
    // The returned code is CANONICAL. We only STOP it if it can't run. No-copy/safety gates are recorded
    // (the prompt asks Gemini to honor them) but NEVER block — per "the code is bible unless it errors".
    const v = validateTemplateCapsule(capsule);
    const status = (id: string) => v.gates.find((x) => x.id === id)?.status;
    const compilePassed = status("T2") === "pass"; // syntax parse — a real "won't run" error
    const noCopyPassed = status("T5") === "pass" && status("T6") === "pass" && status("T9") !== "fail" && status("T10") === "pass";
    if (!compilePassed) {
      lastErrors = v.gates.filter((x) => x.id === "T2" && x.status === "fail").map((x) => `${x.id}: ${x.message}`);
      if (!lastErrors.length) lastErrors = ["did not compile (syntax error)"];
      warnings.push(`gen1 capsule attempt ${attempt + 1}: compile error -> repair`);
      continue;
    }
    // GATE — real render (the only other "won't run" failure).
    let probe: { ok: boolean; error?: string; warnings?: string[] };
    try {
      probe = await input.renderProbe(capsule.codeBundle, (capsule.fixtures?.neutralFixture ?? {}) as Record<string, unknown>);
    } catch (err) {
      probe = { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
    }
    if (probe.warnings?.length) warnings.push(...probe.warnings);
    if (!probe.ok) {
      lastErrors = [`render failed: ${probe.error ?? "unknown"}`];
      warnings.push(`gen1 capsule attempt ${attempt + 1}: render error -> repair`);
      continue;
    }
    // PROMOTE — it compiles and renders. Stored as-is.
    capsule.quality.renderPreviewPassed = true;
    if (!noCopyPassed) warnings.push("note: returned code may contain source-derived text (kept as-is; change at generation time)");
    return {
      usedAi: true,
      capsule,
      sceneRecipes: (asArray(parsed.sceneRecipes) as v5.SceneVisualRecipeV5[]) ?? undefined,
      knowledgeElements: asArray(parsed.knowledgeElements),
      selfReview: asObject(parsed.selfReview),
      validation: { compilePassed: true, renderPreviewPassed: true, noCopyPassed },
      warnings,
      raw
    };
  }
  return { ...fail, raw: lastRaw };
}
