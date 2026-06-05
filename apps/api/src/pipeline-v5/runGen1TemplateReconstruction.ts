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
  slots: Array<{ key: string; kind: v5.TemplateSlotKind; propGroup: string; propKey: string; treatment?: string }>;
}

/** Emit the self-contained, props-driven Remotion template TSX (react + remotion only). */
function emitTemplateTsx(componentName: string, sections: TemplateSection[], palette: string[]): string {
  const sectionsLiteral = JSON.stringify(sections, null, 2);
  const paletteLiteral = JSON.stringify(palette);
  return `import React from "react";
import { AbsoluteFill, Sequence, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// === BAKED TEMPLATE STRUCTURE (reconstructed from the learning sample) ============================
// timing + layout + motion choreography are reused as code; ALL content comes from props.
const SECTIONS = ${sectionsLiteral};
const PALETTE = ${paletteLiteral};

function str(v, f) { return typeof v === "string" ? v : f; }

const GradientBg = ({ from, to }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const d = interpolate(f % (fps * 8), [0, fps * 8], [0, 100]);
  return <AbsoluteFill style={{ background: \`linear-gradient(150deg, \${from} 0%, \${to} 100%)\`, backgroundSize: "160% 160%", backgroundPosition: \`\${d}% \${d / 2}%\` }}>
    <AbsoluteFill style={{ boxShadow: "inset 0 0 240px rgba(0,0,0,0.45)" }} />
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
  return <AbsoluteFill style={{ opacity, transform: \`translateY(\${ty}px) scale(\${scale})\` }}>
    {children}
    {flash > 0 ? <AbsoluteFill style={{ background: "#fff", opacity: flash, mixBlendMode: "screen" }} /> : null}
  </AbsoluteFill>;
};

const KenBurnsImg = ({ src, durFrames }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, durFrames], [0, 1], { extrapolateRight: "clamp" });
  const scale = interpolate(p, [0, 1], [1.05, 1.18]);
  const px = interpolate(p, [0, 1], [0, 2.5]);
  if (!src) return null;
  return <AbsoluteFill>
    <div style={{ position: "absolute", inset: 0, transform: \`scale(\${scale}) translate(\${px}%, -2%)\` }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
    <AbsoluteFill style={{ boxShadow: "inset 0 0 200px rgba(0,0,0,0.5)" }} />
  </AbsoluteFill>;
};

const KineticTitle = ({ text, beats, layerStartSec, color, accent, safeArea }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const words = str(text, "").split(/\\s+/).filter(Boolean);
  const tAbs = layerStartSec + frame / fps;
  const nearest = (beats || []).length ? Math.min(...(beats).map((b) => Math.abs(b - tAbs))) : 1;
  const pop = interpolate(Math.min(nearest, 0.2), [0, 0.2], [1.1, 1.0], { extrapolateRight: "clamp" });
  const justify = safeArea === "top" ? "flex-start" : safeArea === "bottom" ? "flex-end" : "center";
  const fs = Math.round(width * 0.08);
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: justify, padding: width * 0.07 }}>
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: \`\${width * 0.006}px \${width * 0.02}px\`, transform: \`scale(\${pop})\` }}>
      {words.map((w, i) => {
        const wd = spring({ frame: frame - i * 3, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.32) });
        const wy = interpolate(wd, [0, 1], [28, 0]);
        const wo = interpolate(wd, [0, 1], [0, 1]);
        return <span key={i} style={{ opacity: wo, transform: \`translateY(\${wy}px)\`, color, fontWeight: 800, fontSize: fs, lineHeight: 1.04, fontFamily: "Inter, Arial, sans-serif", textShadow: "0 2px 16px rgba(0,0,0,0.55)" }}>{w}</span>;
      })}
    </div>
  </AbsoluteFill>;
};

const SubLine = ({ text, color }) => {
  const { width } = useVideoConfig();
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: width * 0.08 }}>
    <div style={{ color, fontWeight: 600, fontSize: Math.round(width * 0.05), textAlign: "center", fontFamily: "Inter, Arial, sans-serif", textShadow: "0 2px 14px rgba(0,0,0,0.6)" }}>{str(text, "")}</div>
  </AbsoluteFill>;
};

const CtaCard = ({ text, palette }) => {
  const { width } = useVideoConfig();
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: "78%", height: "42%", backgroundColor: palette[0], borderRadius: width * 0.06, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: width * 0.03 }}>
      <div style={{ color: palette[1], fontSize: Math.round(width * 0.06), fontWeight: 800, fontFamily: "Inter, Arial, sans-serif" }}>{str(text, "Shop now")}</div>
      <div style={{ backgroundColor: palette[2], color: "#0A0A0A", padding: \`\${width * 0.018}px \${width * 0.06}px\`, borderRadius: width * 0.5, fontSize: Math.round(width * 0.038), fontWeight: 800 }}>→</div>
    </div>
  </AbsoluteFill>;
};

const DesignedCard = ({ palette }) => {
  const { width } = useVideoConfig();
  return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: "70%", height: "44%", borderRadius: width * 0.05, background: \`linear-gradient(140deg, \${palette[2]}55, \${palette[3] || palette[0]})\`, border: \`1px solid \${palette[1]}22\` }} />
  </AbsoluteFill>;
};

export const ${componentName} = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => {
  const { fps } = useVideoConfig();
  const pal = (palette && palette.length ? palette : PALETTE);
  return (
    <AbsoluteFill style={{ backgroundColor: pal[0] }}>
      <GradientBg from={pal[0]} to={pal[3] || pal[0]} />
      {SECTIONS.map((sec, si) => {
        const from = Math.max(0, Math.round(sec.startSec * fps));
        const dur = Math.max(1, Math.round((sec.endSec - sec.startSec) * fps));
        return (
          <Sequence key={sec.id} from={from} durationInFrames={dur} layout="none">
            <GradientBg from={sec.bgFrom || pal[0]} to={sec.bgTo || pal[3] || pal[0]} />
            {si > 0 ? <AbsoluteFill style={{ background: pal[2], opacity: 0, mixBlendMode: "screen" }} /> : null}
            {sec.slots.map((slot) => {
              const a = (assets || {})[slot.propKey];
              const c = (copy || {})[slot.propKey];
              let node = null;
              if (slot.kind === "hero_image" || slot.kind === "product_image" || slot.kind === "background_image" || slot.kind === "logo") {
                node = a && a.src ? <KenBurnsImg src={a.src} durFrames={dur} /> : <DesignedCard palette={pal} />;
              } else if (slot.kind === "headline") {
                node = <KineticTitle text={c} beats={sec.beats} layerStartSec={sec.startSec} color={pal[1]} accent={pal[2]} safeArea="top" />;
              } else if (slot.kind === "subtitle") {
                node = <SubLine text={c} color={pal[1]} />;
              } else if (slot.kind === "cta_text") {
                node = <CtaCard text={c} palette={pal} />;
              } else {
                node = null;
              }
              if (!node) return null;
              const intro = slot.kind === "headline" ? "slide_up" : "pop";
              return <Beat key={slot.key} beats={sec.beats} layerStartSec={sec.startSec} intro={intro}>{node}</Beat>;
            })}
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
