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
