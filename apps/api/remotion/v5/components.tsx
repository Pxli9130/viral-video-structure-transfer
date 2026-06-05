// apps/api/remotion/v5/components.tsx
// Built-in V5 component library (renderer-spec.md §4). Pure Remotion primitives only — Gen2 and the
// deterministic compose fallback both drive these via RenderRecipeV5 layers. No network, no fs, no
// sample paths. Each component is content-neutral and prop-driven.

import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { num, str, type AssetMap, type ImageTreatment, type KineticText, type LayerMotion, type RenderLayerV5 } from "./recipeTypes";

export const GradientBackground: React.FC<{ from: string; to?: string }> = ({ from, to }) => (
  <AbsoluteFill style={{ background: to ? `linear-gradient(160deg, ${from}, ${to})` : from }} />
);

export const ShapeLayer: React.FC<{ fill: string; shape?: string; radiusRatio?: number }> = ({ fill, shape, radiusRatio = 0.06 }) => {
  const { width } = useVideoConfig();
  const isCard = shape === "card";
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: isCard ? "78%" : "100%",
          height: isCard ? "44%" : "100%",
          backgroundColor: fill,
          borderRadius: isCard ? width * radiusRatio : 0
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Motion engine: applies a layer's intro + CONTINUOUS loop + beat-synced hits + outro (not just a
 * 0.4s intro then static). beatTriggers carry ABSOLUTE recipe times; layerStartSec maps them to the
 * sequence-local frame. This is what turns the recipe from a slideshow into motion graphics.
 */
export const MotionWrapper: React.FC<{ children: React.ReactNode; kind?: string; motion?: LayerMotion; layerStartSec?: number; durationInFrames: number }> = ({ children, kind, motion, layerStartSec = 0, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tAbs = layerStartSec + frame / fps;
  const m: LayerMotion = motion ?? {};

  // intro
  const introType = m.intro?.type ?? (kind === "slide_up_pop" ? "slide_up" : kind === "impact_zoom" ? "pop" : "pop");
  const introF = Math.max(1, Math.round((m.intro?.durationSec ?? 0.42) * fps));
  const ip = spring({ frame, fps, config: { damping: 200 }, durationInFrames: introF });
  let opacity = interpolate(frame, [0, introF * 0.8], [0, 1], { extrapolateRight: "clamp" });
  let scale = introType === "pop" || introType === "scale_rotate" ? interpolate(ip, [0, 1], [kind === "impact_zoom" ? 1.12 : 0.9, 1]) : 1;
  let tx = 0;
  let ty = introType === "slide_up" ? interpolate(ip, [0, 1], [60, 0]) : 0;
  let rot = introType === "scale_rotate" ? interpolate(ip, [0, 1], [-6, 0]) : 0;
  let blur = introType === "blur_in" ? interpolate(frame, [0, introF], [14, 0], { extrapolateRight: "clamp" }) : 0;
  if (introType === "slide_left") tx = interpolate(ip, [0, 1], [90, 0]);

  // continuous loop
  const loop = m.loop;
  if (loop) {
    const amp = loop.amplitude ?? 1;
    const ph = (frame / fps) * (loop.speed ?? 1);
    if (loop.type === "float") ty += Math.sin(ph * 2) * 7 * amp;
    else if (loop.type === "sway") rot += Math.sin(ph * 1.5) * 1.3 * amp;
    else if (loop.type === "pulse") scale *= 1 + 0.02 * amp * Math.sin(ph * 3);
    else if (loop.type === "drift") tx += Math.sin(ph) * 9 * amp;
    else if (loop.type === "parallax") ty += Math.sin(ph) * 5 * amp;
  }

  // beat-synced hits
  let flash = 0;
  for (const bt of m.beatTriggers ?? []) {
    const dist = Math.abs(tAbs - bt.t);
    if (dist >= 0.25) continue;
    const inten = bt.intensity ?? 1;
    const k = interpolate(dist, [0, 0.25], [1, 0], { extrapolateRight: "clamp" });
    const act = bt.action ?? "scale_hit";
    if (act === "scale_hit") scale *= 1 + 0.16 * inten * k;
    else if (act === "whip") tx += interpolate(Math.min(dist, 0.12), [0, 0.12], [34 * inten, 0], { extrapolateRight: "clamp" });
    else if (act === "shake") tx += Math.sin(frame * 1.4) * 7 * inten * k;
    else if (act === "flash" || act === "color_pulse") flash = Math.max(flash, 0.32 * inten * k);
  }

  // outro
  const outroF = Math.round((m.outro?.durationSec ?? 0) * fps);
  if (outroF > 0 && frame > durationInFrames - outroF) {
    const op = interpolate(frame, [durationInFrames - outroF, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const ot = m.outro?.type;
    if (ot === "zoom_out") scale *= interpolate(op, [0, 1], [1, 1.16]);
    else if (ot === "fade") opacity *= 1 - op;
    else if (ot === "whip") tx += interpolate(op, [0, 1], [0, -44]);
    else if (ot === "flash") flash = Math.max(flash, 0.4 * op);
  }

  return (
    <AbsoluteFill style={{ opacity, transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rot}deg)`, filter: blur ? `blur(${blur}px)` : undefined }}>
      {children}
      {flash > 0 && <AbsoluteFill style={{ background: "#FFFFFF", opacity: flash, mixBlendMode: "screen" }} />}
    </AbsoluteFill>
  );
};

export const MediaLayer: React.FC<{ layer: RenderLayerV5; assetMap: AssetMap; palette: string[] }> = ({ layer, assetMap, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const asset = layer.assetId ? assetMap[layer.assetId] : undefined;
  if (!asset) return <DesignedVisualLayer layer={layer} palette={palette} />;

  const treat: ImageTreatment = layer.style?.imageTreatment ?? { preset: "ken_burns" };
  const durFrames = Math.max(1, Math.round((layer.endSec - layer.startSec) * fps));
  const prog = interpolate(frame, [0, durFrames], [0, 1], { extrapolateRight: "clamp" });
  const kb = treat.preset === "ken_burns" || treat.preset === undefined || treat.preset === "spotlight";
  const scale = kb ? interpolate(prog, [0, 1], [1.04, treat.zoom ?? 1.16]) : 1;
  const panX = kb ? interpolate(prog, [0, 1], [0, treat.panX ?? 2.5]) : 0;
  const panY = kb ? interpolate(prog, [0, 1], [0, treat.panY ?? -2.5]) : 0;
  const clip =
    treat.mask === "circle" ? "circle(62% at 50% 45%)" : treat.mask === "diagonal" ? "polygon(0 0, 100% 0, 100% 82%, 0 100%)" : treat.mask === "rounded" ? "inset(6% round 6%)" : undefined;
  const isVideo = asset.type === "video" || /\.(mp4|mov|webm)$/i.test(asset.src);

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${scale}) translate(${panX}%, ${panY}%)`, clipPath: clip }}>
        {isVideo ? (
          <OffthreadVideo src={asset.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      {treat.preset === "spotlight" && (
        <AbsoluteFill style={{ background: `radial-gradient(45% 35% at ${30 + prog * 40}% 42%, transparent 0%, rgba(0,0,0,0.55) 75%)` }} />
      )}
      {treat.tint && <AbsoluteFill style={{ background: treat.tint, opacity: 0.2, mixBlendMode: "multiply" }} />}
      <AbsoluteFill style={{ boxShadow: "inset 0 0 200px rgba(0,0,0,0.5)" }} />
    </AbsoluteFill>
  );
};

/**
 * Kinetic typography — word-level stagger + beat-synced pop (ported from BeatCutKineticText). Replaces
 * a static centered <div> for hooks/titles so the copy moves with the beat instead of holding still.
 */
export const KineticTextLayer: React.FC<{ layer: RenderLayerV5; palette: string[] }> = ({ layer, palette }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const kt: KineticText = layer.style?.kineticText ?? {};
  const words = str(layer.text, "").split(/\s+/).filter(Boolean);
  const beatTimes = kt.beatTimes ?? [];
  const tAbs = layer.startSec + frame / fps;
  const nearest = beatTimes.length ? Math.min(...beatTimes.map((b) => Math.abs(b - tAbs))) : 1;
  const onBeat = nearest < 0.08;
  const pop = interpolate(Math.min(nearest, 0.2), [0, 0.2], [1.1, 1.0], { extrapolateRight: "clamp" });
  const weight = num(layer.style?.fontWeight, 800);
  const color = str(layer.style?.color, palette[1] ?? "#FFFFFF");
  const accent = str(layer.style?.accent, palette[2] ?? "#F7C948");
  const safeArea = str(layer.style?.safeArea, "center");
  const justify = safeArea === "top" ? "flex-start" : safeArea === "bottom" ? "flex-end" : "center";
  const fontSize = Math.round(width * (weight >= 800 ? 0.08 : 0.056));
  const emphasis = new Set((kt.emphasisWords ?? []).map((w) => w.toLowerCase()));

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: justify, padding: width * 0.07 }}>
      {onBeat && <AbsoluteFill style={{ background: "#FFFFFF", opacity: 0.1 }} />}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${width * 0.006}px ${width * 0.02}px`, transform: `scale(${pop})` }}>
        {words.map((w, i) => {
          const wd = spring({ frame: frame - i * 3, fps, config: { damping: 200 }, durationInFrames: Math.round(fps * 0.32) });
          const wy = interpolate(wd, [0, 1], [28, 0]);
          const wo = interpolate(wd, [0, 1], [0, 1]);
          const em = emphasis.has(w.toLowerCase().replace(/[^a-z0-9]/g, ""));
          return (
            <span
              key={i}
              style={{
                opacity: wo,
                transform: `translateY(${wy}px)`,
                color: em ? accent : color,
                fontWeight: weight,
                fontSize,
                lineHeight: 1.04,
                fontFamily: "Inter, Arial, sans-serif",
                textShadow: "0 2px 16px rgba(0,0,0,0.55)",
                WebkitTextStroke: em ? `2px ${color}` : undefined
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const TextLayer: React.FC<{ layer: RenderLayerV5; palette: string[] }> = ({ layer, palette }) => {
  const { width } = useVideoConfig();
  const weight = num(layer.style?.fontWeight, 700);
  const color = str(layer.style?.color, palette[1] ?? "#FFFFFF");
  const safeArea = str(layer.style?.safeArea, "center");
  const justify = safeArea === "top" ? "flex-start" : safeArea === "bottom" ? "flex-end" : "center";
  const fontSize = Math.round(width * (weight >= 800 ? 0.085 : 0.06));
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: justify, padding: width * 0.07 }}>
      <div
        style={{
          color,
          fontWeight: weight,
          fontSize,
          textAlign: "center",
          lineHeight: 1.05,
          textShadow: "0 2px 14px rgba(0,0,0,0.55)",
          fontFamily: "Inter, Arial, sans-serif"
        }}
      >
        {str(layer.text, "")}
      </div>
    </AbsoluteFill>
  );
};

export const CTAButton: React.FC<{ layer: RenderLayerV5; palette: string[] }> = ({ layer, palette }) => {
  const { width } = useVideoConfig();
  const accent = str(layer.style?.accent, palette[2] ?? "#F7C948");
  const label = str(layer.text, "Shop now");
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "78%", height: "44%", backgroundColor: palette[0] ?? "#0A0A0A", borderRadius: width * 0.06, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: width * 0.03 }}>
        <div style={{ color: palette[1] ?? "#FFFFFF", fontSize: Math.round(width * 0.06), fontWeight: 800, fontFamily: "Inter, Arial, sans-serif" }}>{label}</div>
        <div style={{ backgroundColor: accent, color: "#0A0A0A", padding: `${width * 0.018}px ${width * 0.06}px`, borderRadius: width * 0.5, fontSize: Math.round(width * 0.038), fontWeight: 800 }}>→</div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------
// Designed visual layer — the offline "generated material" (audit GAP-1/2). Renders a RICH composed
// visual (gradient + geometry + hero silhouette + typography) per family, deterministic by seed, so a
// slot with no real/generated photo still reads as a designed scene rather than a flat colour card.
// ---------------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DesignSpec {
  family: "hero_product" | "product_closeup" | "logo" | "background" | "scene" | "app_mockup" | "media_cards";
  palette: string[];
  gradient?: [string, string];
  headline?: string;
  seed?: number;
}

export const GradientMotionBg: React.FC<{ from: string; to?: string; accent?: string }> = ({ from, to, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = interpolate(frame % (fps * 8), [0, fps * 8], [0, 100]);
  const toColor = to ?? from;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(150deg, ${from} 0%, ${toColor} 100%)`, backgroundSize: "160% 160%", backgroundPosition: `${drift}% ${drift / 2}%` }}>
      {accent && (
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(60% 40% at 50% 28%, ${accent}22 0%, transparent 60%)` }} />
      )}
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 240px rgba(0,0,0,0.45)" }} />
    </AbsoluteFill>
  );
};

export const DesignedVisualLayer: React.FC<{ layer: RenderLayerV5; palette: string[] }> = ({ layer, palette }) => {
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const design = (layer.style?.design as DesignSpec | undefined) ?? { family: "media_cards", palette };
  const pal = design.palette?.length ? design.palette : palette;
  const bg = design.gradient?.[0] ?? pal[0] ?? "#0A0A0A";
  const bg2 = design.gradient?.[1] ?? pal[3] ?? pal[0] ?? "#1A1A1A";
  const accent = pal[2] ?? pal[1] ?? "#F7C948";
  const ink = pal[1] ?? "#FFFFFF";
  const rng = mulberry32((design.seed ?? 1) * 2654435761);
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * 2);

  const accents = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const x = rng() * 100;
      const y = rng() * 100;
      const s = 0.12 + rng() * 0.22;
      const round = rng() > 0.5 ? "50%" : `${width * 0.03}px`;
      return (
        <div key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: width * s, height: width * s, borderRadius: round, background: i % 2 ? `${accent}33` : `${ink}14`, transform: `translate(-50%,-50%)` }} />
      );
    });

  const headline = design.headline && (
    <div style={{ position: "absolute", left: 0, right: 0, top: "10%", textAlign: "center", color: ink, fontWeight: 800, fontSize: Math.round(width * 0.06), fontFamily: "Inter, Arial, sans-serif", textShadow: "0 2px 16px rgba(0,0,0,0.5)", padding: `0 ${width * 0.08}px` }}>
      {design.headline}
    </div>
  );

  let core: React.ReactNode = null;
  switch (design.family) {
    case "hero_product":
    case "product_closeup": {
      const d = width * (design.family === "hero_product" ? 0.56 : 0.46);
      core = (
        <div style={{ position: "absolute", left: "50%", top: "52%", transform: `translate(-50%,-50%) scale(${pulse})` }}>
          <div style={{ position: "absolute", left: "50%", top: "50%", width: d * 1.5, height: d * 1.5, transform: "translate(-50%,-50%)", borderRadius: "50%", background: `radial-gradient(circle, ${accent}55 0%, transparent 65%)` }} />
          <div style={{ width: d, height: d * 1.15, borderRadius: width * 0.06, background: `linear-gradient(145deg, ${ink}f0, ${accent}cc)`, boxShadow: `0 ${width * 0.03}px ${width * 0.08}px rgba(0,0,0,0.5), inset 0 ${width * 0.01}px ${width * 0.02}px rgba(255,255,255,0.35)` }} />
          <div style={{ position: "absolute", left: "18%", top: "10%", width: "24%", height: "55%", borderRadius: width * 0.04, background: "rgba(255,255,255,0.28)" }} />
        </div>
      );
      break;
    }
    case "logo": {
      const initials = (design.headline ?? "AD").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      core = (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: width * 0.4, height: width * 0.4, borderRadius: width * 0.08, background: `linear-gradient(140deg, ${accent}, ${bg2})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 ${width * 0.02}px ${width * 0.06}px rgba(0,0,0,0.5)` }}>
          <span style={{ color: bg, fontWeight: 900, fontSize: Math.round(width * 0.14), fontFamily: "Inter, Arial, sans-serif" }}>{initials}</span>
        </div>
      );
      break;
    }
    case "app_mockup": {
      core = (
        <div style={{ position: "absolute", left: "50%", top: "52%", transform: `translate(-50%,-50%) scale(${pulse})`, width: width * 0.5, height: width * 0.92, borderRadius: width * 0.07, background: "#0E0E12", border: `${width * 0.006}px solid ${ink}33`, padding: width * 0.03, boxShadow: `0 ${width * 0.03}px ${width * 0.09}px rgba(0,0,0,0.55)` }}>
          <div style={{ height: "14%", borderRadius: width * 0.03, background: `linear-gradient(90deg, ${accent}, ${bg2})`, marginBottom: width * 0.025 }} />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={{ height: "13%", borderRadius: width * 0.025, background: i === 1 ? `${accent}55` : `${ink}14`, marginBottom: width * 0.02 }} />
          ))}
        </div>
      );
      break;
    }
    case "media_cards": {
      core = (
        <div style={{ position: "absolute", inset: "18% 12%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: width * 0.03 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} style={{ borderRadius: width * 0.04, background: `linear-gradient(${120 + i * 40}deg, ${i % 2 ? accent : ink}33, ${bg2})`, border: `1px solid ${ink}22` }} />
          ))}
        </div>
      );
      break;
    }
    default: // background / scene
      core = (
        <div style={{ position: "absolute", inset: 0 }}>
          <div style={{ position: "absolute", left: "-10%", top: "30%", width: "120%", height: width * 0.04, background: `${accent}66`, transform: "rotate(-12deg)" }} />
          <div style={{ position: "absolute", left: "-10%", top: "55%", width: "120%", height: width * 0.02, background: `${ink}33`, transform: "rotate(-12deg)" }} />
        </div>
      );
  }

  return (
    <AbsoluteFill>
      <GradientMotionBg from={bg} to={bg2} accent={accent} />
      {accents(5)}
      {core}
      {headline}
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 220px rgba(0,0,0,0.4)" }} />
    </AbsoluteFill>
  );
};
