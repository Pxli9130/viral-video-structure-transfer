// pipeline-v5/runGen1TemplateReconstruction.ts
// Part 2 — Gen1 Remotion Template Reconstruction. Produces a reusable, props-driven RemotionTemplateCapsule
// from a NeutralReconstructionProgram + evidence. The emitted Remotion component BAKES the sample's
// structure/timing/motion/typography/transitions into code (a SECTIONS constant + inlined motion
// helpers) and takes ALL content from props (assets/copy/audio/palette). It contains NO sample paths,
// no sample text, no sample asset URLs — only reusable choreography. Self-contained (react + remotion
// only) so it can be dynamically bundled and re-rendered with new props per generation.
//
// The deterministic generator below is the guaranteed path (always compiles, always props-driven). An
// AI codegen path can replace codeBundle.files when it validates; otherwise this is the fallback.

import { v5 } from "@vvst/shared";

type Json = Record<string, unknown>;

function slotKindFor(kind: v5.PlaceholderKindV5): { slot: v5.TemplateSlotKind; propGroup: "assets" | "copy" | "audio"; propKey: string } {
  switch (kind) {
    case "hero":
    case "hero_product":
    case "hero_head":
      return { slot: "hero_image", propGroup: "assets", propKey: "heroImage" };
    case "product_closeup":
      return { slot: "product_image", propGroup: "assets", propKey: "productImage" };
    case "background":
      return { slot: "background_image", propGroup: "assets", propKey: "background" };
    case "logo":
      return { slot: "logo", propGroup: "assets", propKey: "logo" };
    case "main_title":
      return { slot: "headline", propGroup: "copy", propKey: "headline" };
    case "subtitle_text":
      return { slot: "subtitle", propGroup: "copy", propKey: "subtitle" };
    case "cta_card":
      return { slot: "cta_text", propGroup: "copy", propKey: "cta" };
    case "voiceover":
      return { slot: "voiceover", propGroup: "audio", propKey: "voiceover" };
    case "sfx":
    case "audio_pattern":
      return { slot: "sfx", propGroup: "audio", propKey: "sfx" };
    default:
      return { slot: "other", propGroup: "assets", propKey: "extra" };
  }
}

function replacementPolicyFor(slot: v5.TemplateSlotKind): v5.TemplateSlotReplacementPolicy {
  if (slot === "headline" || slot === "subtitle" || slot === "cta_text") return "text_generate";
  if (slot === "music" || slot === "sfx" || slot === "voiceover") return "procedural_generate";
  return "aigc_generate";
}

interface TemplateSection {
  id: string;
  role: v5.TemplateSectionRole;
  startSec: number;
  endSec: number;
  beats: number[];
  bgFrom: string;
  bgTo: string;
  /** Per-scene content-neutral visual recipe (grading mood / anchors / camera / transition). */
  recipe?: v5.SceneVisualRecipeV5;
  slots: Array<{ key: string; kind: v5.TemplateSlotKind; propGroup: string; propKey: string; treatment?: string }>;
}

/**
 * Emit the self-contained, props-driven Remotion template TSX (react + remotion only).
 * Each section is driven by its SceneVisualRecipeV5 so different SOURCES reconstruct visibly different
 * looks (grading mood, text anchor + animation, camera move, transition) — while COLOURS stay theme-
 * driven (so "same look as the source, new theme"). No backticks / ${} inside the emitted code.
 */
function emitTemplateTsx(componentName: string, sections: TemplateSection[], palette: string[]): string {
  const sectionsLiteral = JSON.stringify(sections, null, 2);
  const paletteLiteral = JSON.stringify(palette);
  return `import React from "react";
import { AbsoluteFill, Sequence, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// === BAKED TEMPLATE STRUCTURE (reconstructed from the learning sample) ============================
// timing + per-scene visual recipe + motion choreography are reused as code; ALL content from props.
const SECTIONS = ${sectionsLiteral};
const PALETTE = ${paletteLiteral};

function str(v, f) { return typeof v === "string" ? v : f; }
function anchorFlex(anchor) {
  var p = anchor === "center" ? ["center", "center"] : String(anchor || "center").split("_");
  var y = p[0], x = p[1] || "center";
  return { justifyContent: y === "top" ? "flex-start" : y === "bottom" ? "flex-end" : "center",
           alignItems: x === "left" ? "flex-start" : x === "right" ? "flex-end" : "center" };
}
function gradeFilter(mood) {
  switch (mood) {
    case "dark_moody": return { filter: "brightness(0.82) saturate(1.06)", vig: 0.62 };
    case "high_key": return { filter: "brightness(1.12) saturate(0.92)", vig: 0.16 };
    case "high_contrast": return { filter: "contrast(1.22) saturate(1.1)", vig: 0.46 };
    case "vibrant": return { filter: "saturate(1.35) brightness(1.03)", vig: 0.3 };
    case "desaturated": return { filter: "saturate(0.55) brightness(1.03)", vig: 0.34 };
    case "warm": return { filter: "sepia(0.12) saturate(1.12)", vig: 0.32 };
    case "cool": return { filter: "saturate(1.06) brightness(1.04)", vig: 0.32 };
    default: return { filter: "none", vig: 0.36 };
  }
}
function cameraTransform(move, p) {
  switch (move) {
    case "push_in": return "scale(" + (1.06 + 0.16 * p) + ")";
    case "pull_out": return "scale(" + (1.22 - 0.16 * p) + ")";
    case "pan_left": return "scale(1.14) translateX(" + (5 - 10 * p) + "%)";
    case "pan_right": return "scale(1.14) translateX(" + (-5 + 10 * p) + "%)";
    case "tilt_up": return "scale(1.14) translateY(" + (5 - 10 * p) + "%)";
    case "tilt_down": return "scale(1.14) translateY(" + (-5 + 10 * p) + "%)";
    default: return "scale(1.05)";
  }
}
function transitionStyle(kind, frame, fps) {
  var d = Math.max(1, Math.round(0.5 * fps));
  var t = Math.min(1, frame / d);
  var s = { opacity: 1, transform: "none", overlay: 0, flash: 0 };
  if (kind === "fade_from_black") s.overlay = 1 - t;
  else if (kind === "dissolve") s.opacity = t;
  else if (kind === "slide_left") s.transform = "translateX(" + ((1 - t) * 100) + "%)";
  else if (kind === "slide_right") s.transform = "translateX(" + (-(1 - t) * 100) + "%)";
  else if (kind === "whip_pan") { s.opacity = Math.min(1, t * 1.6); s.transform = "translateX(" + ((1 - t) * 45) + "%)"; }
  else if (kind === "zoom_in") { s.opacity = t; s.transform = "scale(" + (1 + (1 - t) * 0.2) + ")"; }
  else if (kind === "flash") s.flash = 1 - t;
  return s;
}

const SceneWrap = ({ kind, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = transitionStyle(kind, frame, fps);
  return <AbsoluteFill style={{ opacity: s.opacity, transform: s.transform }}>
    {children}
    {s.overlay > 0 ? <AbsoluteFill style={{ background: "#000", opacity: s.overlay }} /> : null}
    {s.flash > 0 ? <AbsoluteFill style={{ background: "#fff", opacity: s.flash, mixBlendMode: "screen" }} /> : null}
  </AbsoluteFill>;
};

const GradedFill = ({ pal, mood }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const g = gradeFilter(mood);
  const d = interpolate(f % (fps * 8), [0, fps * 8], [0, 100]);
  return <AbsoluteFill style={{ background: "linear-gradient(150deg, " + pal[0] + " 0%, " + (pal[3] || pal[0]) + " 100%)", backgroundSize: "170% 170%", backgroundPosition: d + "% " + (d / 2) + "%", filter: g.filter }}>
    <AbsoluteFill style={{ boxShadow: "inset 0 0 260px rgba(0,0,0," + g.vig + ")" }} />
  </AbsoluteFill>;
};

const Beat = ({ beats, layerStartSec, children, intro }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tAbs = layerStartSec + frame / fps;
  const introF = Math.max(1, Math.round(0.42 * fps));
  const ip = spring({ frame, fps, config: { damping: 200 }, durationInFrames: introF });
  let opacity = interpolate(frame, [0, introF * 0.8], [0, 1], { extrapolateRight: "clamp" });
  let scale = intro === "pop" ? interpolate(ip, [0, 1], [0.9, 1]) : 1;
  let ty = intro === "slide_up" ? interpolate(ip, [0, 1], [60, 0]) : 0;
  let flash = 0;
  for (const b of beats || []) {
    const dist = Math.abs(tAbs - b);
    if (dist < 0.25) { const k = interpolate(dist, [0, 0.25], [1, 0], { extrapolateRight: "clamp" }); scale *= 1 + 0.15 * k; flash = Math.max(flash, 0.28 * k); }
  }
  return <AbsoluteFill style={{ opacity, transform: "translateY(" + ty + "px) scale(" + scale + ")" }}>
    {children}
    {flash > 0 ? <AbsoluteFill style={{ background: "#fff", opacity: flash, mixBlendMode: "screen" }} /> : null}
  </AbsoluteFill>;
};

const CameraImg = ({ src, durFrames, move }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, durFrames], [0, 1], { extrapolateRight: "clamp" });
  if (!src) return null;
  return <AbsoluteFill>
    <div style={{ position: "absolute", inset: 0, transform: cameraTransform(move, p) }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
    <AbsoluteFill style={{ boxShadow: "inset 0 0 200px rgba(0,0,0,0.5)" }} />
  </AbsoluteFill>;
};

const PositionedText = ({ text, color, anchor, anim, big }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const words = str(text, "").split(/\\s+/).filter(Boolean);
  const flex = anchorFlex(anchor);
  const fs = Math.round(width * (big ? 0.085 : 0.05));
  return <AbsoluteFill style={{ display: "flex", flexDirection: "column", padding: width * 0.07, justifyContent: flex.justifyContent, alignItems: flex.alignItems }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: (width * 0.006) + "px " + (width * 0.02) + "px", maxWidth: "88%", justifyContent: flex.alignItems }}>
      {words.map((w, i) => {
        const wd = spring({ frame: frame - i * (anim === "word_stagger" ? 3 : 1), fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.3) });
        const wo = interpolate(wd, [0, 1], [0, 1]);
        const wy = anim === "slide_up" ? interpolate(wd, [0, 1], [34, 0]) : 0;
        const sc = (anim === "pop" || anim === "scale") ? interpolate(wd, [0, 1], [0.8, 1]) : 1;
        return <span key={i} style={{ opacity: wo, transform: "translateY(" + wy + "px) scale(" + sc + ")", color, fontWeight: big ? 800 : 700, fontSize: fs, lineHeight: 1.05, fontFamily: "Inter, Arial, sans-serif", textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}>{w}</span>;
      })}
    </div>
  </AbsoluteFill>;
};

const CtaCard = ({ text, palette }) => {
  const { width } = useVideoConfig();
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: "78%", height: "42%", backgroundColor: palette[0], borderRadius: width * 0.06, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: width * 0.03 }}>
      <div style={{ color: palette[1], fontSize: Math.round(width * 0.06), fontWeight: 800, fontFamily: "Inter, Arial, sans-serif" }}>{str(text, "Shop now")}</div>
      <div style={{ backgroundColor: palette[2], color: "#0A0A0A", padding: (width * 0.018) + "px " + (width * 0.06) + "px", borderRadius: width * 0.5, fontSize: Math.round(width * 0.038), fontWeight: 800 }}>→</div>
    </div>
  </AbsoluteFill>;
};

const DesignedCard = ({ palette }) => {
  const { width } = useVideoConfig();
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: "70%", height: "44%", borderRadius: width * 0.05, background: "linear-gradient(140deg, " + palette[2] + "55, " + (palette[3] || palette[0]) + ")", border: "1px solid " + palette[1] + "22" }} />
  </AbsoluteFill>;
};

export const ${componentName} = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => {
  const { fps } = useVideoConfig();
  const pal = (palette && palette.length ? palette : PALETTE);
  return (
    <AbsoluteFill style={{ backgroundColor: pal[0] }}>
      {SECTIONS.map((sec, si) => {
        const from = Math.max(0, Math.round(sec.startSec * fps));
        const dur = Math.max(1, Math.round((sec.endSec - sec.startSec) * fps));
        const r = sec.recipe || {};
        const grading = r.grading || {};
        const subj = r.subject || {};
        const cam = subj.cameraMove || "push_in";
        const tAnchor = r.textAnchor || (sec.role === "hook" ? "center" : "bottom_center");
        const tAnim = r.textAnim || "word_stagger";
        return (
          <Sequence key={sec.id} from={from} durationInFrames={dur} layout="none">
            <SceneWrap kind={r.transitionIn || "hard_cut"}>
              <GradedFill pal={pal} mood={grading.mood} />
              {sec.slots.map((slot) => {
                const a = (assets || {})[slot.propKey];
                const c = (copy || {})[slot.propKey];
                let node = null;
                if (slot.kind === "hero_image" || slot.kind === "product_image" || slot.kind === "background_image" || slot.kind === "logo") {
                  node = a && a.src ? <CameraImg src={a.src} durFrames={dur} move={cam} /> : <DesignedCard palette={pal} />;
                } else if (slot.kind === "headline") {
                  node = <PositionedText text={c} color={pal[1]} anchor={tAnchor} anim={tAnim} big={true} />;
                } else if (slot.kind === "subtitle") {
                  node = <PositionedText text={c} color={pal[1]} anchor={tAnchor === "center" ? "bottom_center" : tAnchor} anim={tAnim} big={false} />;
                } else if (slot.kind === "cta_text") {
                  node = <CtaCard text={c} palette={pal} />;
                }
                if (!node) return null;
                const intro = slot.kind === "headline" ? "slide_up" : "pop";
                return <Beat key={slot.key} beats={sec.beats} layerStartSec={sec.startSec} intro={intro}>{node}</Beat>;
              })}
            </SceneWrap>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export default ${componentName};
`;
}

export interface Gen1TemplateReconstructionOptions {
  capsuleId?: string;
  name?: string;
  /** Precomputed per-scene visual recipes (from deriveSceneRecipes). Falls back to role-varied defaults. */
  sceneRecipes?: v5.SceneVisualRecipeV5[];
}

/** Role/index-varied neutral recipe used when no frame-derived recipe is available (keeps scenes from being identical). */
function fallbackSceneRecipe(sec: { id: string; role: string }, idx: number): v5.SceneVisualRecipeV5 {
  const moods: v5.GradingMoodV5[] = ["neutral", "high_contrast", "vibrant", "cool", "warm"];
  const trans: v5.TransitionInV5[] = ["fade_from_black", "slide_left", "dissolve", "slide_right", "zoom_in"];
  const cams: v5.CameraMoveV5[] = ["push_in", "static", "pan_left", "push_in", "pan_right"];
  return {
    sectionId: sec.id,
    role: sec.role,
    transitionIn: idx === 0 ? "fade_from_black" : trans[idx % trans.length],
    subject: { anchor: "center", areaRatio: 0.45, cameraMove: cams[idx % cams.length], motionIntensity: 0.4 },
    textAnchor: sec.role === "hook" ? "center" : idx % 2 ? "top_center" : "bottom_center",
    textAnim: "word_stagger",
    grading: { mood: moods[idx % moods.length], brightness: 0.5, saturation: 0.4, palette: [] },
    source: "deterministic",
    confidence: 0.25
  };
}

/** Build a RemotionTemplateCapsule (deterministic, props-driven) from a neutral program + evidence. */
export function runGen1TemplateReconstruction(
  program: v5.NeutralReconstructionProgram,
  evidence: v5.EvidenceTimelineV5,
  opts: Gen1TemplateReconstructionOptions = {}
): v5.RemotionTemplateCapsule {
  const spec = program.typedSpec;
  const palette = spec.globalStyle.palette.length ? spec.globalStyle.palette : ["#0A0A0A", "#FFFFFF", "#F7C948", "#1A1A1A"];
  const beatTimes = (evidence.audioEvidence?.onsetsSec ?? evidence.audioEvidence?.beatGridSec ?? []).slice(0, 32);

  // Per-scene visual recipes: frame-derived when provided, else role/index-varied fallback.
  const sceneRecipes: v5.SceneVisualRecipeV5[] =
    opts.sceneRecipes && opts.sceneRecipes.length
      ? opts.sceneRecipes
      : spec.scenes.map((s, i) => fallbackSceneRecipe({ id: s.id, role: s.role }, i));
  const recipeById = new Map(sceneRecipes.map((r) => [r.sectionId, r]));

  const slotSchema: v5.TemplateSlot[] = [];
  const sections: TemplateSection[] = spec.scenes.map((scene, si) => {
    const sectionBeats = beatTimes.filter((t) => t >= scene.startSec && t <= scene.endSec).map((t) => Number(t.toFixed(2)));
    const slots: TemplateSection["slots"] = [];
    for (const ph of program.placeholders.filter((p) => p.sectionId === scene.id)) {
      const map = slotKindFor(ph.kind);
      slots.push({ key: ph.id, kind: map.slot, propGroup: map.propGroup, propKey: map.propKey });
      slotSchema.push({
        id: ph.id,
        kind: map.slot,
        required: ph.required,
        originalRole: `${scene.role} ${ph.kind}`,
        replacementPolicy: replacementPolicyFor(map.slot),
        propPath: `${map.propGroup}.${map.propKey}`
      });
    }
    return {
      id: scene.id,
      role: (scene.role as v5.TemplateSectionRole) ?? "other",
      startSec: scene.startSec,
      endSec: scene.endSec,
      beats: sectionBeats,
      bgFrom: palette[0],
      bgTo: palette[3] ?? palette[Math.min(si + 1, palette.length - 1)] ?? palette[0],
      recipe: recipeById.get(scene.id),
      slots
    };
  });

  const componentName = "TemplateFromSample";
  const content = emitTemplateTsx(componentName, sections, palette);

  const propsSchema: Json = {
    type: "object",
    properties: {
      assets: { type: "object", description: "slot key -> { src } (image/video). Generated/target only." },
      copy: { type: "object", description: "slot key -> string (headline/subtitle/cta)." },
      audio: { type: "object", description: "slot key -> { src } | cue config." },
      theme: { type: "string" },
      palette: { type: "array", items: { type: "string" } }
    }
  };

  const neutralFixture: Json = {
    theme: "neutral preview",
    palette,
    assets: {},
    copy: Object.fromEntries(
      slotSchema.filter((s) => s.kind === "headline" || s.kind === "subtitle" || s.kind === "cta_text").map((s) => [s.propPath?.split(".")[1] ?? s.id, s.kind === "cta_text" ? "Get started" : s.kind === "headline" ? "Your headline here" : "Supporting detail"])
    ),
    audio: {}
  };

  const motifs = Array.from(new Set(spec.scenes.flatMap((s) => s.motionGrammar ?? [])));
  const capsule: v5.RemotionTemplateCapsule = {
    id: opts.capsuleId ?? `tpl_${program.sourceSampleId}`,
    sourceSampleId: program.sourceSampleId,
    sceneRecipes,
    name: opts.name ?? `Template from ${program.sourceSampleId}`,
    description: `Reconstructed ${sections.length}-section template (${spec.composition.durationSec}s) — reusable structure/timing/motion; content via props.`,
    tags: Array.from(new Set([spec.globalStyle.pacing, ...motifs])).slice(0, 10),
    codeBundle: { files: [{ path: "index.tsx", content }], entryFile: "index.tsx", componentName },
    propsSchema,
    slotSchema,
    timingSignature: {
      durationSec: spec.composition.durationSec,
      fps: spec.composition.fps,
      sections: sections.map((s) => ({ id: s.id, role: s.role, startSec: s.startSec, endSec: s.endSec, internalBeats: s.beats }))
    },
    motionSignature: {
      motifs,
      transitionTypes: sections.length > 1 ? ["flash_cut", "gradient_shift"] : [],
      typographyAnimationTypes: ["word_stagger", "beat_pop"],
      beatSyncedCueCount: spec.audioCues.length,
      activeMotionCoverage: 0.8
    },
    assetRecipes: program.learnedAssetRecipes ?? [],
    audioRecipes: program.learnedAudioRecipes ?? [],
    fixtures: { neutralFixture },
    safety: {
      sampleVideoPassthroughAllowed: false,
      samplePixelsReusable: false,
      sampleAudioReusable: false,
      sampleTextReusable: false,
      onlyTemplateCodeReusable: true
    },
    quality: {
      compilePassed: false, // set by validateTemplateCapsule
      renderPreviewPassed: false,
      noCopyTemplatePassed: false,
      warnings: ["deterministic template reconstruction (AI codegen not applied)"]
    }
  };
  return capsule;
}
