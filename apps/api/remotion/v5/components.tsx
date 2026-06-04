// apps/api/remotion/v5/components.tsx
// Built-in V5 component library (renderer-spec.md §4). Pure Remotion primitives only — Gen2 and the
// deterministic compose fallback both drive these via RenderRecipeV5 layers. No network, no fs, no
// sample paths. Each component is content-neutral and prop-driven.

import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { num, str, type AssetMap, type RenderLayerV5 } from "./recipeTypes";

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

/** Fade+rise entrance wrapper. */
export const MotionWrapper: React.FC<{ children: React.ReactNode; kind?: string; durationInFrames: number }> = ({ children, kind, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = Math.min(durationInFrames, Math.round(fps * 0.4));
  const p = spring({ frame, fps, config: { damping: 200 }, durationInFrames: intro });
  const opacity = interpolate(frame, [0, intro], [0, 1], { extrapolateRight: "clamp" });
  const scale = kind === "impact_zoom" ? interpolate(p, [0, 1], [1.12, 1]) : interpolate(p, [0, 1], [0.96, 1]);
  const translateY = kind === "slide_up_pop" ? interpolate(p, [0, 1], [40, 0]) : 0;
  return <AbsoluteFill style={{ opacity, transform: `scale(${scale}) translateY(${translateY}px)` }}>{children}</AbsoluteFill>;
};

export const MediaLayer: React.FC<{ layer: RenderLayerV5; assetMap: AssetMap; palette: string[] }> = ({ layer, assetMap, palette }) => {
  const asset = layer.assetId ? assetMap[layer.assetId] : undefined;
  const fit = (str(layer.style?.fit, "cover") as React.CSSProperties["objectFit"]) ?? "cover";
  if (!asset) {
    // No bound asset → neutral shape card (never a sample path).
    return <ShapeLayer fill={palette[2] ?? "#F7C948"} shape="card" />;
  }
  const isVideo = asset.type === "video" || /\.(mp4|mov|webm)$/i.test(asset.src);
  return (
    <AbsoluteFill>
      {isVideo ? (
        <OffthreadVideo src={asset.src} style={{ width: "100%", height: "100%", objectFit: fit }} />
      ) : (
        <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: fit }} />
      )}
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
