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
  /** Seconds this reconstruction MUST cover end-to-end (chunk span / source duration). If the returned code
   *  covers materially less, a repair is triggered to extend it — prevents "ends too soon" / black tails. */
  targetDurationSec?: number;
}

/** One "missing 素材" the Remotion code can't draw itself — AIGC fills it from this description. */
export interface AssetPlanEntry {
  key: string;
  mediaKind?: "image" | "video";
  description?: string;
  aigcPrompt?: string;
  motion?: string;
  /** Whether this block is a good candidate for a USER-SUPPLIED asset (hero/product/logo/main subject). */
  userAssetSlot?: boolean;
}

export interface Gen1CapsuleGeminiResult {
  usedAi: boolean;
  capsule?: v5.RemotionTemplateCapsule;
  sceneRecipes?: v5.SceneVisualRecipeV5[];
  knowledgeElements?: unknown[];
  selfReview?: unknown;
  /** Per-asset AIGC plan keyed to the code's actual asset variables (assets.<key>). */
  assetPlan?: AssetPlanEntry[];
  validation: { compilePassed: boolean; renderPreviewPassed: boolean; noCopyPassed: boolean };
  warnings: string[];
  raw?: string;
}

/** Turn the model's assetPlan into TemplateSlots keyed to the code's asset vars (optionally prefixed for
 *  per-chunk namespacing). kind is mapped into IMAGE_SLOTS so the existing fill path picks them up; the
 *  real image-vs-video intent is carried by mediaKind (Seedance fills mediaKind="video"). */
export function assetPlanToSlots(plan: AssetPlanEntry[], keyPrefix = ""): v5.TemplateSlot[] {
  const seen = new Set<string>();
  const slots: v5.TemplateSlot[] = [];
  for (const e of plan) {
    if (!e || typeof e.key !== "string" || !e.key.trim()) continue;
    const fullKey = keyPrefix + e.key.trim();
    if (seen.has(fullKey)) continue;
    seen.add(fullKey);
    const mediaKind: "image" | "video" = e.mediaKind === "video" ? "video" : "image";
    slots.push({
      id: fullKey,
      kind: mediaKind === "video" ? "background_image" : "product_image",
      required: true,
      originalRole: (e.description ?? "footage").slice(0, 60),
      replacementPolicy: "aigc_generate",
      propPath: `assets.${fullKey}`,
      description: e.description,
      mediaKind,
      aigcPrompt: e.aigcPrompt,
      motionHint: e.motion,
      userAssetSlot: e.userAssetSlot === true
    });
  }
  return slots;
}

/** Static asset keys the code actually reads: assets.<key> / assets['<key>'] / assets[`<key>`]. */
export function extractAssetKeys(code: string): string[] {
  const keys = new Set<string>();
  for (const m of code.matchAll(/assets\s*\.\s*([a-zA-Z_$][\w$]*)/g)) keys.add(m[1]);
  for (const m of code.matchAll(/assets\s*\[\s*[`'"]([a-zA-Z_$][\w$]*)[`'"]\s*\]/g)) keys.add(m[1]);
  for (const k of ["src", "length", "map", "filter", "forEach", "keys", "values", "entries", "mediaKind", "hasOwnProperty"]) keys.delete(k);
  return [...keys];
}

/** Ensure EVERY asset key the code reads has a slot, so AIGC actually fills it. The model often
 *  under-declares its assetPlan (e.g. code reads assets.card1..card8 but only 4 entries) -> the extra
 *  <Img>/<OffthreadVideo> render EMPTY. This adds a generic IMAGE slot for any read-but-unplanned key. */
export function ensureSlotsCoverCode(slots: v5.TemplateSlot[], code: string, keyPrefix = ""): v5.TemplateSlot[] {
  const have = new Set(slots.map((s) => s.id));
  const out = [...slots];
  for (const key of extractAssetKeys(code)) {
    const fullKey = keyPrefix + key;
    if (have.has(fullKey)) continue;
    have.add(fullKey);
    out.push({
      id: fullKey,
      kind: "product_image",
      required: true,
      originalRole: "footage",
      replacementPolicy: "aigc_generate",
      propPath: `assets.${fullKey}`,
      description: `auto-detected footage block (${key})`,
      mediaKind: "image",
      aigcPrompt: "a clean, on-brand photographic visual for the ad scene, 9:16 vertical, no on-image text, no watermark",
      userAssetSlot: false
    });
  }
  return out;
}

/** Compact deterministic-evidence JSON fed to the model as ground truth. */
export function buildEvidenceJson(ev: v5.EvidenceTimelineV5): string {
  const me = (ev.motionEvidence ?? {}) as Record<string, unknown>;
  const sample = <T>(items: T[] | undefined, limit: number): T[] | undefined => {
    if (!items?.length) return undefined;
    if (items.length <= limit) return items;
    if (limit <= 1) return [items[0]];
    const out: T[] = [];
    for (let i = 0; i < limit; i++) {
      out.push(items[Math.round((i * (items.length - 1)) / (limit - 1))]);
    }
    return out;
  };
  const bboxCenter = (bbox: [number, number, number, number]): [number, number] => [
    +(bbox[0] + bbox[2] / 2).toFixed(3),
    +(bbox[1] + bbox[3] / 2).toFixed(3)
  ];
  const visualElements = sample(ev.visualElementGraph?.elements, 24)?.map((el) => ({
    id: el.id,
    family: el.family,
    timeRangeSec: el.timeRangeSec,
    motionPattern: el.motionPattern,
    positionClass: el.positionClass,
    sizeClass: el.sizeClass,
    bboxTrackNorm: sample(el.bboxTrackNorm, 8),
    pointTracks: sample(el.pointTracks, 5),
    centerTrajectory: sample(el.centerTrajectory, 8),
    providerSource: el.providerSource ?? el.evidence?.detector,
    confidence: el.evidence?.confidence
  }));
  const movingTextTracks = (ev.visualElementGraph?.elements ?? [])
    .filter((el) => /text|typography|subtitle|caption|ocr/i.test(el.family) && (el.bboxTrackNorm?.length ?? 0) >= 2)
    .map((el) => {
      const track = sample(el.bboxTrackNorm, 8) ?? [];
      const first = track[0]?.bbox;
      const last = track[track.length - 1]?.bbox;
      const firstCenter = first ? bboxCenter(first) : undefined;
      const lastCenter = last ? bboxCenter(last) : undefined;
      return {
        id: el.id,
        timeRangeSec: el.timeRangeSec,
        bboxTrackNorm: track,
        firstCenter,
        lastCenter,
        deltaNorm: firstCenter && lastCenter ? [+(lastCenter[0] - firstCenter[0]).toFixed(3), +(lastCenter[1] - firstCenter[1]).toFixed(3)] : undefined
      };
    })
    .filter((track) => !track.deltaNorm || Math.abs(track.deltaNorm[0]) >= 0.015 || Math.abs(track.deltaNorm[1]) >= 0.015)
    .slice(0, 12);
  return JSON.stringify({
    durationSec: ev.video?.durationSec ?? (ev.shots?.length ? ev.shots[ev.shots.length - 1].endSec : undefined),
    fps: ev.video?.fps ?? 30,
    aspectRatio: ev.video?.aspectRatio ?? "9:16",
    videoInputPolicy: ev.recommendedVideoInputPolicy,
    shots: (ev.shots ?? []).map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, summary: (s as { summary?: string }).summary })),
    keyFrames: (ev.keyFrames ?? []).map((k) => ({ timeSec: k.timeSec })),
    textEvidence: sample(ev.textEvidence, 32)?.map((t) => ({ id: t.id, timeSec: t.timeSec, role: t.role, region: t.region, text: t.text })),
    typographyEvidence: sample(ev.typographyEvidence, 24)?.map((t) => ({
      id: t.textLayerId,
      timeSec: t.timeSec,
      text: t.text,
      bboxNorm: t.bboxNorm,
      layoutRole: t.layoutRole,
      fontSizeRatio: t.fontSizeRatio,
      animationHint: t.animationHint,
      confidence: t.confidence
    })),
    audio: { bpm: ev.audioEvidence?.bpm, beatGridSec: (ev.audioEvidence?.beatGridSec ?? []).slice(0, 32), onsetsSec: (ev.audioEvidence?.onsetsSec ?? []).slice(0, 32) },
    motion: {
      intensityCurve: sample(me.intensityCurve as Array<{ t: number; value: number }> | undefined, 32),
      peakMomentsSec: (me.peakMomentsSec as number[] | undefined)?.slice(0, 16),
      cutDensity: me.cutDensity,
      movingObjectCandidates: sample(ev.movingObjectCandidates ?? (me.movingObjectCandidates as v5.MovingObjectCandidateEvidence[] | undefined), 16),
      movingTextTracks,
      motionAtoms: sample(ev.motionAtoms, 12)
    },
    visualElementGraph: visualElements?.length
      ? {
          fpsSampled: ev.visualElementGraph?.fpsSampled,
          elementCount: ev.visualElementGraph?.elementCount,
          elements: visualElements
        }
      : undefined,
    detectedStyle: ev.detectedStyle,
    audioStructure: ev.audioStructure
  });
}

export function buildGen1CapsulePrompt(evidenceJson: string): string {
  return `You are a senior Remotion v4 motion-design engineer and creative reconstruction agent.

You are given:
1. The attached video input. For short sources this may be the whole source video; for long sources this is
   one source chunk capped by CHUNK_MAX_SEC (default 30s). Reconstruct only the attached clip/span.
2. Deterministic evidence extracted from the same video (duration, fps, aspect ratio, shot timeline,
   keyframes, beat grid / audio energy, motion intensity, OCR/text regions, visual element tracks,
   moving-object regions, and motion atoms when available).

Your task: WATCH the attached video and write a complete Remotion v4 component that RE-CREATES this exact
clip as faithfully as possible — same look, same layout, same composition, same camera movement, same
transitions, same kinetic typography, same colour grading, same motion over time, same beat timing. Be
ambitious and detailed. If the source uses 3D (twisting ribbon, extruded text, particles), build real 3D
with @remotion/three + three + @react-three/fiber. If it uses kinetic text, build it (programmatic
<canvas> + CanvasTexture is fine). It is OK to hardcode the text/colours/content you see for now — this
is the faithful reconstruction; a later step changes the text/theme.

This is NOT a generic ad template, NOT a summary, NOT a storyboard, NOT a static card renderer. It must
visibly look like THIS attached clip when rendered.

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
  "assetPlan": [],
  "sceneRecipes": [], "knowledgeElements": [],
  "selfReview": { "fidelityRisks": [], "compileRisks": [], "safetyRisks": [], "missingEvidence": [] } }

The code in codeBundle.files[0].content must be complete and compile-ready, and MUST export this exact
signature (so our renderer can mount it — you MAY ignore the props and hardcode for the faithful draft):
  const PALETTE = ["#0A0A0A","#FFFFFF","#F7C948","#1A1A1A"];
  export const TemplateFromSample = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => { ... };

The code must: (1) cover the full duration with no gaps; (2) one Sequence per detected scene; (3) use
SECTION-LOCAL frame progress for animation; (4) always render an opaque full-bleed background WHOSE
LIGHTNESS MATCHES THE SOURCE — if the source background is light / white / high-key, bake a LIGHT
background + LIGHT PALETTE (e.g. white/off-white) and do NOT default to a dark background; if the source
is dark, keep it dark. Get the overall light-vs-dark right per scene; (5) include
real motion throughout each scene (not a 0.3s intro then static); (6) use SCENE-SPECIFIC transitions; (7)
scene-specific text anchor + animation matching the video; stable keys; no CSS transitions for frame-driven
motion; use optional chaining + fallbacks so it never crashes.

FIDELITY: do NOT collapse all scenes to one layout; do NOT default to a generic gradient+centered-card
unless the source truly looks that way. Each source scene should have distinct layout/motion/transition/
text behavior based on what you SEE in the video.

MOTION FIDELITY — reproduce each element's EXACT motion with FRAME-DRIVEN animation (useCurrentFrame),
NEVER a static snapshot. If a scene's textAnimation is continuous_scroll/marquee/ticker, the code MUST
actually animate that text — a static label is WRONG. For EVERY moving element, reproduce:
- EVIDENCE TRACKS: deterministic evidence may include textEvidence.region, typographyEvidence.bboxNorm,
  motion.movingTextTracks, motion.movingObjectCandidates, visualElementGraph.elements[].bboxTrackNorm /
  pointTracks / centerTrajectory, and motion.motionAtoms. Treat those as motion measurements from the
  attached clip. If a bbox/point track changes x/y over time, implement that movement with frame-driven
  interpolate() or equivalent math. Do not turn a moving tracked element into a fixed div.
- TEXT MARQUEE / SCROLL: if a line of text scrolls horizontally and wraps (exits one edge, re-appears from
  the opposite edge), implement a CONTINUOUS, CONSTANT-SPEED loop driven by frame — e.g. a translateX that
  moves right-to-left and WRAPS modulo the total width so the text exits the left and re-enters from the
  right, forever. Do NOT use a static label, a one-shot slide, a centered translateX(-50%), or a fade. Match
  the on-screen direction and speed.
- ROTATION: a twisting ribbon / extruded text / spinning object rotates about ONE dominant axis (vertical =
  rotation.y for an upright ribbon; horizontal = rotation.x). Build REAL 3D (@remotion/three) and rotate
  ONLY about that single axis — do NOT tumble on two axes at once (no simultaneous rotation.y + rotation.z),
  and never fake depth rotation with 2D skew/scaleX. A DNA/helix twist = a helical form rotating about the
  single vertical axis.
- ENTER/EXIT direction, easing, looping, per-element timing offsets exactly as seen.

SIZE / COVERAGE FIDELITY — match each element's on-screen SIZE to the source. Estimate the fraction of the
frame each element occupies (width & height as a % of the composition) and reproduce that fraction. If a
card / graphic / subject covers most of the frame width in the source (only small side margins), it MUST do
so in your render — size with %/vw/vh or px derived from useVideoConfig().width, NOT tiny fixed pixels. Do
not shrink prominent elements into small centered boxes.

Infer all of this from THIS attached clip — do not assume defaults, and do not hardcode any specific axis /
direction / size unless the source actually shows it.

RECONSTRUCT EVERY VISUAL LAYER — do NOT reduce a footage/photo-heavy video to text only.
DRAW IN CODE BY DEFAULT (it is FREE): all on-screen text, shapes, gradients, masks, kinetic typography,
abstract motion graphics, particles, UI/data-viz, and any 3D you can build with @remotion/three — render
these IN CODE. Do NOT create an asset / assetPlan entry for anything code can plausibly draw.
CONSISTENCY (enforced): every assetPlan key MUST be rendered by a real <Img src={assets.<key>?.src}/> or
<OffthreadVideo src={assets.<key>?.src}/> layer in the code, and every such layer MUST have an assetPlan entry —
they must match 1:1. NEVER declare an asset key you don't render (it leaves the user's uploaded photo invisible).
If the source is pure text / motion-graphics with no real photos or footage, return an EMPTY "assetPlan": [].
Only the real PIXEL CONTENT you canNOT draw — live-action footage, movie clips, photos, b-roll, real
product shots — are "MISSING 素材" (assets to fill later). For EACH of those, render an asset-backed layer
with a STABLE asset key, and MINIMISE generated VIDEO (it is the most expensive step):
  - DEFAULT to mediaKind "image": a STATIC photo / product still + a code-driven camera move (ken-burns /
    pan / zoom / parallax) -> <Img src={assets.<key>?.src}/>. Use this whenever a still can carry the shot.
  - mediaKind "video" ONLY when the real IN-FRAME MOTION is essential and un-drawable (live-action human/
    object movement, a real moving camera over a real scene) -> <OffthreadVideo src={assets.<key>?.src}/>.
    Never request a video for something a still + code motion, or pure code, could convey.
Layer text OVER the footage like the source does. A montage of clips -> multiple Sequences, each with its
own <OffthreadVideo>/<Img> layer keyed to a DISTINCT asset (assets.clip1, assets.clip2, …), NOT one text card.
TEXT LINE BREAKS: never put a literal "\n" inside on-screen text (JSX renders it verbatim as the characters
backslash-n). For a multi-line label use separate elements (<div>line1</div><div>line2</div>) or <br/>.
TEXT CONTRAST (mandatory, readability): every text layer MUST have STRONG luminance contrast with whatever
is directly behind it — near-WHITE text over dark areas, near-BLACK text over light areas. NEVER low-contrast
(grey-on-grey, dark-grey on black, light-grey on white, mid-tone text on a mid-tone card). If text sits over
footage / a photo / a coloured or mid-tone card, put a solid contrasting plate, a scrim, or a strong
text-shadow behind it so it stays legible. When you drive text colour from palette[], pick the index that
contrasts with that element's actual background — do not just use palette[1] everywhere.
TEXT NO-OVERLAP: lay out distinct text blocks so they do NOT overlap each other — give each its own region
(corners / thirds / safe margins) OR reveal them at DIFFERENT times via <Sequence>. Never stack two separate
text blocks at the same coordinates so they render on top of each other.

ASSET KEY RULES (critical — these keys are how we fill the footage with AIGC later):
- Read each asset as assets.<key>?.src  OR assets['<key>'].  Use simple, unique, descriptive keys.
- MEDIA TAG BY EXTENSION (use this exact convention for EVERY asset-backed layer so it works whether the
  filled asset turns out to be a video or an image): choose the tag from the src extension at runtime —
  if assets.<key>?.src ends with .mp4/.webm/.mov render <OffthreadVideo src=... muted/>, otherwise render
  <Img src=.../>. ALWAYS full-bleed (style width:'100%',height:'100%',objectFit:'cover'). Do NOT invent a
  custom asset.mediaKind flag check, and do NOT hardcode one tag — branch on the extension every time.
- DO NOT invent a getAsset()/dummy helper and DO NOT fall back to any remote URL (no dummyimage.com, no
  http/https) — headless rendering CANNOT fetch remote URLs. If an asset is absent, fall back to a SOLID
  colour from palette (e.g. style={{ backgroundColor: palette[0] }}) — never a remote image.
- For EVERY asset key you read in the code, you MUST add a matching entry to the top-level "assetPlan"
  (below) describing what footage goes there, so we can generate it.

DO NOT REPRODUCE PLATFORM CHROME / WATERMARKS. Skip entirely (do not draw, do not make a slot): any
platform watermark or badge (小红书 / Xiaohongshu / RED / 抖音 / Douyin / TikTok / Instagram / 微信 /
Bilibili logos), account handles / IDs (e.g. "小红书号: 4287481687", @username), follow / subscribe /
like-share end-cards, QR codes, and any "关注我" / "扫码" overlays. These are app UI, NOT the ad's content —
reconstruct only the actual ad. If the LAST scene is just such a follow/handle card, omit that scene.

Also extract (for a later content-modification step):
- assetPlan[]: ONE entry for EVERY asset key your code reads (the "missing 素材" — REAL footage/photos the
  code can't draw; NOT things you drew in code). Each: { "key":"<EXACT key as read in code, e.g. clip1>",
  "mediaKind":"video"|"image" (prefer "image" — only use "video" when in-frame motion is essential and
  un-drawable, see above), "description":"<what this footage shows in the source — subject, action, setting>",
  "aigcPrompt":"<a ready-to-use text-to-VIDEO (for video) or text-to-IMAGE (for image) prompt that RECREATES
    this kind of footage in a fresh, copyright-safe, theme-neutral way — describe subject/action/camera/
    lighting/style, 9:16 vertical, no on-image text, no watermark>", "motion":"<camera move e.g. slow push-in>",
  "userAssetSlot": true|false (TRUE if this block is a natural place for the END USER to drop their OWN
    asset later — the hero product shot, brand logo, main subject/spokesperson; FALSE for incidental b-roll/
    texture/background that only needs to look right) }.
  The "key" MUST exactly match what the code reads (assets.<key>). Every <OffthreadVideo>/<Img> asset key -> one entry.
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

/** Compare the model's OWN declared motion (sceneRecipes / visualSummary) against its emitted code; return
 *  human-readable gaps that drive a single fidelity-repair. General — no per-video assumptions. */
function motionFidelityGaps(code: string, sceneRecipes: Array<Record<string, unknown>>): string[] {
  const gaps: string[] = [];
  const recipeText = sceneRecipes.map((r) => `${String(r?.visualSummary ?? "")} ${JSON.stringify(r?.layout ?? "")}`).join(" ");
  const wantsScroll = sceneRecipes.some((r) => {
    const ta = (r?.textAnimation ?? r?.textAnim) as { type?: string } | undefined;
    return /scroll|marquee|ticker|slide/i.test(String(ta?.type ?? ""));
  });
  if (wantsScroll) {
    // A real marquee = a frame-driven translateX whose value changes — NOT the static translateX(-50%)/(-100%)
    // centering transforms. Count dynamic translateX (anything that isn't a bare `translateX(<n>%)`).
    const totalTx = (code.match(/translateX\(/g) || []).length;
    const staticTx = (code.match(/translateX\(\s*-?\d+(?:\.\d+)?%\s*\)/g) || []).length;
    const hasFrame = /interpolate\s*\(\s*frame|frame\s*[*%/]/.test(code);
    const hasMarquee = totalTx > staticTx && hasFrame;
    if (!hasMarquee) {
      gaps.push("Your sceneRecipes mark text as continuous_scroll/marquee but the code does not animate it (only static translateX(-50%) centering). Implement a constant-speed marquee on that text: a frame-driven translateX (value computed from useCurrentFrame) that moves right-to-left and WRAPS modulo the total width so the text exits the left edge and re-enters from the right, forever — not a static label, centered transform, or one-shot slide.");
    }
  }
  const has3D = /@remotion\/three|@react-three|from\s+['"]three|THREE\.|<mesh\b|TubeGeometry|BufferGeometry/.test(code);
  const axes = (["x", "y", "z"] as const).filter((a) => new RegExp(`rotation\\.${a}\\s*[=:]`).test(code));
  const wantsTwist = /ribbon|helix|twist|dna|3d|extrud|spin/i.test(recipeText);
  if (wantsTwist && !has3D) {
    // Described as a 3D ribbon/twist but reconstructed flat (e.g. a 2D canvas) — build real 3D.
    gaps.push("Your sceneRecipes describe a 3D ribbon/twisting/extruded element, but the code has NO real 3D (no @remotion/three / three / mesh). Build it as REAL 3D with @remotion/three and rotate it about a SINGLE vertical axis (rotation.y) so it twists like a DNA/helix — do not fake it with a flat 2D canvas.");
  } else if (wantsTwist && axes.length >= 2) {
    // 3D but tumbling on multiple axes — a twisting ribbon should rotate about one axis.
    gaps.push(`Your 3D object rotates on multiple axes (rotation.${axes.join(" + rotation.")}). A twisting ribbon/helix should rotate about ONE dominant axis (vertical = rotation.y for an upright ribbon). Remove the secondary-axis rotation so it twists cleanly about a single axis.`);
  }
  return gaps;
}

/** Repair prompt for code that COMPILES + RENDERS but misses motion the model itself described. */
export function buildGen1FidelityRepairPrompt(gaps: string[], codeBundleJson: string): string {
  return `Your RemotionTemplateCapsule COMPILES and RENDERS, but it does NOT faithfully reproduce some motion
you yourself described in the source. Fix ONLY these motion issues; keep everything else (structure, layout,
3D geometry, timing, text content, colours) IDENTICAL. Return the SAME top-level JSON schema.

MOTION ISSUES TO FIX:
- ${gaps.slice(0, 6).join("\n- ")}

Requirements: frame-driven animation via useCurrentFrame (NOT static); keep the exact
"export const TemplateFromSample = ({ assets, copy, audio, theme, palette }) => ..." signature; no forbidden
tokens (require/process/fs/eval/fetch/XMLHttpRequest/dynamic import); no remote http(s) URLs. Return ONLY valid JSON.

CURRENT codeBundle:
${codeBundleJson.slice(0, 14000)}`;
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
/** Largest (from + durationInFrames) across the code's <Sequence>s, in seconds — a last-resort duration
 *  when neither Gemini nor the deterministic capsule supplies one. 0 if no literal Sequence bounds found.
 *  Also reused per-chunk in the chunked path to reconcile each chunk's reserved slot to its real coverage. */
export function maxSequenceCoverageSec(code: string, fps: number): number {
  let max = 0;
  for (const m of code.matchAll(/<Sequence\b([^>]*)>/g)) {
    const f = /from=\{?(\d+)/.exec(m[1]);
    const d = /durationInFrames=\{?(\d+)/.exec(m[1]);
    const end = (f ? Number(f[1]) : 0) + (d ? Number(d[1]) : 0);
    if (end > max) max = end;
  }
  return max > 0 ? +(max / (fps || 30)).toFixed(3) : 0;
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
  // Prefer the assetPlan keyed to the code's REAL asset vars (assets.<key>) — this is what lets AIGC fill
  // the footage the code references. Falls back to Gemini's slotSchema, then deterministic.
  const assetPlan = asArray(g.assetPlan) as AssetPlanEntry[] | undefined;
  const assetSlots = assetPlan?.length ? assetPlanToSlots(assetPlan) : undefined;
  // MERGE timingSignature — Gemini often returns a PARTIAL one (e.g. {bpm, sections} with NO durationSec/fps).
  // Wholesale-adopting it leaves durationSec undefined, and the renderer then defaults to 16s -> the video
  // "ends too soon". Always fall back to the deterministic duration/fps (and code coverage as a last resort).
  const gts = asObject(gc.timingSignature) as Partial<v5.RemotionTemplateCapsule["timingSignature"]> | undefined;
  const fps = (typeof gts?.fps === "number" && gts.fps > 0 ? gts.fps : undefined) ?? det.timingSignature.fps ?? 30;
  const coverSec = maxSequenceCoverageSec(code, fps);
  const durationSec = (typeof gts?.durationSec === "number" && gts.durationSec > 0 ? gts.durationSec : undefined)
    ?? (det.timingSignature.durationSec && det.timingSignature.durationSec > 0 ? det.timingSignature.durationSec : undefined)
    ?? (coverSec > 0 ? coverSec : undefined)
    ?? 16;
  const timingSignature: v5.RemotionTemplateCapsule["timingSignature"] = {
    ...det.timingSignature,
    ...(gts ?? {}),
    fps,
    durationSec,
    sections: gts?.sections?.length ? gts.sections : det.timingSignature.sections
  };
  const capsule: v5.RemotionTemplateCapsule = {
    ...det,
    codeBundle, // CANONICAL — Gemini's code, untouched
    slotSchema: ensureSlotsCoverCode(assetSlots ?? validSlots ?? det.slotSchema ?? [], code),
    propsSchema: asObject(gc.propsSchema) ?? det.propsSchema,
    timingSignature,
    // Merge the AI motionSignature onto the deterministic one field-by-field: Gemini sometimes returns a
    // PARTIAL object (e.g. missing `motifs`), and a blind cast then leaves required arrays undefined ->
    // downstream `.motifs.join(...)` crashes the whole learn. Coerce each field, falling back to det.
    motionSignature: ((): v5.RemotionTemplateCapsule["motionSignature"] => {
      const ai = asObject(gc.motionSignature) as Partial<v5.RemotionTemplateCapsule["motionSignature"]> | undefined;
      const d = det.motionSignature;
      if (!ai) return d;
      return {
        motifs: Array.isArray(ai.motifs) ? ai.motifs : d.motifs,
        transitionTypes: Array.isArray(ai.transitionTypes) ? ai.transitionTypes : d.transitionTypes,
        typographyAnimationTypes: Array.isArray(ai.typographyAnimationTypes) ? ai.typographyAnimationTypes : d.typographyAnimationTypes,
        beatSyncedCueCount: typeof ai.beatSyncedCueCount === "number" ? ai.beatSyncedCueCount : d.beatSyncedCueCount,
        activeMotionCoverage: typeof ai.activeMotionCoverage === "number" ? ai.activeMotionCoverage : d.activeMotionCoverage
      };
    })(),
    assetRecipes: (asArray(gc.assetRecipes) as v5.AssetRecipeV5[]) ?? det.assetRecipes,
    audioRecipes: (asArray(gc.audioRecipes) as v5.AudioRecipeV5[]) ?? det.audioRecipes,
    fixtures: (asObject(gc.fixtures) as unknown as v5.RemotionTemplateCapsule["fixtures"]) ?? det.fixtures,
    safety: det.safety, // metadata only; never rewrites code
    quality: { ...det.quality, codeOrigin: "ai", recipeSource: "vlm" }
  };
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
  let lastErrorKind: "build" | "fidelity" = "build";
  let fidelityRepairDone = false;
  let best: Gen1CapsuleGeminiResult | undefined; // last compile+render-passing AI capsule (never lose it to deterministic)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let raw: string;
    try {
      if (attempt === 0) {
        raw = await input.visionModel(buildGen1CapsulePrompt(evidenceJson), input.frames ?? [], input.videoPath);
      } else {
        // Repair: code-only, prefer the cheaper text model. Fidelity repairs use a motion-specific prompt.
        const repairPrompt = lastErrorKind === "fidelity" ? buildGen1FidelityRepairPrompt(lastErrors, lastRaw ?? "") : buildGen1RepairPrompt(lastErrors, lastRaw ?? "");
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
      lastErrorKind = "build";
      warnings.push(`gen1 capsule attempt ${attempt + 1}: render error -> repair`);
      continue;
    }
    // Render passed — a VALID AI capsule. Save it as `best` FIRST: we must never discard a compile+render-
    // passing AI reconstruction for the deterministic fallback just because a fidelity/coverage gap remains
    // ("code is bible"). The fidelity repair below is a best-effort improvement, not a gate.
    capsule.quality.renderPreviewPassed = true;
    if (!noCopyPassed) warnings.push("note: returned code may contain source-derived text (kept as-is; change at generation time)");
    const result: Gen1CapsuleGeminiResult = {
      usedAi: true,
      capsule,
      sceneRecipes: (asArray(parsed.sceneRecipes) as v5.SceneVisualRecipeV5[]) ?? undefined,
      knowledgeElements: asArray(parsed.knowledgeElements),
      selfReview: asObject(parsed.selfReview),
      assetPlan: (asArray(parsed.assetPlan) as AssetPlanEntry[]) ?? undefined,
      validation: { compilePassed: true, renderPreviewPassed: true, noCopyPassed },
      warnings,
      raw
    };
    best = result;
    // MOTION-FIDELITY + coverage: drive ONE repair if the code contradicts the model's OWN declared motion
    // (text static vs scroll, 2-axis tumble, missing 3D) or under-covers the duration. `best` is already
    // saved, so a failed/unconverged repair degrades to this render-passing AI — never to deterministic.
    const gaps = motionFidelityGaps(code, (asArray(parsed.sceneRecipes) as Array<Record<string, unknown>>) ?? []);
    if (input.targetDurationSec && input.targetDurationSec > 1) {
      const coverSec = maxSequenceCoverageSec(code, capsule.timingSignature.fps || 30);
      if (coverSec > 0.5 && coverSec < input.targetDurationSec * 0.85) {
        gaps.push(`Your code only covers ${coverSec.toFixed(1)}s but this scene is ${input.targetDurationSec.toFixed(1)}s long. EXTEND it to cover the FULL ${input.targetDurationSec.toFixed(1)}s with content that matches the source through to the end (add the remaining scenes; continue the motion). Do NOT leave the end empty, black, frozen, or cut short.`);
      }
    }
    if (gaps.length && !fidelityRepairDone && attempt < maxAttempts - 1) {
      fidelityRepairDone = true;
      lastErrors = gaps;
      lastErrorKind = "fidelity";
      lastRaw = JSON.stringify({ capsule: { codeBundle: capsule.codeBundle } });
      warnings.push(`gen1 motion-fidelity gap -> repair: ${gaps[0].slice(0, 90)}`);
      continue;
    }
    if (gaps.length) warnings.push(`gen1 motion-fidelity (kept after repair): ${gaps.join(" | ").slice(0, 160)}`);
    return result;
  }
  // Attempts exhausted: if ANY attempt produced a render-passing AI capsule, promote it (don't fall back to
  // deterministic over a mere fidelity gap). Only truly-unrenderable output falls through to deterministic.
  if (best) { best.warnings = warnings; return best; }
  return { ...fail, raw: lastRaw };
}
