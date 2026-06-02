import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { paletteColor, textsForRole, type CreativeEffectRuntimeProps } from "../types";

// blue_spotlight_ui_pitch — blue/black palette, spotlight/orb sweep, floating UI/dashboard/search
// panels, sequential pitch text reveal. Props-only, no fs/env/fetch, renders with no assets.
export const BlueUiSpotlight: React.FC<CreativeEffectRuntimeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const bg = paletteColor(props.colors, 0, "#020617");
  const blue = paletteColor(props.colors, 1, "#2563eb");
  const cyan = paletteColor(props.colors, 2, "#38bdf8");
  const ink = paletteColor(props.colors, 3, "#e2e8f0");

  const orbX = interpolate(Math.sin(t * 0.8), [-1, 1], [width * 0.2, width * 0.8]);
  const orbY = interpolate(Math.cos(t * 0.6), [-1, 1], [height * 0.25, height * 0.6]);

  const pitchTexts = textsForRole(props.texts, "selling_point");
  const panels = Array.from({ length: 3 }, (_, i) => {
    const reveal = interpolate(t - i * 0.6, [0, 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const label = pitchTexts[i] ?? `Insight ${i + 1}`;
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: width * (0.12 + i * 0.04),
          top: height * (0.34 + i * 0.14),
          width: width * 0.64,
          height: height * 0.1,
          background: "rgba(37,99,235,0.16)",
          border: `1px solid ${cyan}`,
          borderRadius: 12,
          opacity: reveal,
          transform: `translateY(${(1 - reveal) * 24}px)`,
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          color: ink,
          fontSize: Math.round(height * 0.026),
          fontFamily: "'Segoe UI', Arial, sans-serif",
          boxShadow: `0 0 22px rgba(56,189,248,0.25)`
        }}
      >
        <div style={{ width: 14, height: 14, borderRadius: 4, background: cyan, marginRight: 14 }} />
        {label}
      </div>
    );
  });

  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {/* spotlight / orb sweep */}
      <div
        style={{
          position: "absolute",
          left: orbX - width * 0.35,
          top: orbY - width * 0.35,
          width: width * 0.7,
          height: width * 0.7,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${blue}55 0%, transparent 70%)`
        }}
      />
      {/* search bar */}
      <div
        style={{
          position: "absolute",
          top: height * 0.16,
          left: width * 0.16,
          width: width * 0.68,
          height: height * 0.06,
          border: `1px solid ${cyan}`,
          borderRadius: 999,
          color: ink,
          opacity: 0.85,
          display: "flex",
          alignItems: "center",
          padding: "0 22px",
          fontSize: Math.round(height * 0.024),
          fontFamily: "'Segoe UI', Arial, sans-serif"
        }}
      >
        {textsForRole(props.texts, "product_name")[0] ?? "Search"}
      </div>
      {panels}
    </AbsoluteFill>
  );
};

export default BlueUiSpotlight;
