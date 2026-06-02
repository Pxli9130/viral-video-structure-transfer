import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { paletteColor, textsForRole, type CreativeEffectRuntimeProps } from "../types";

// split_screen_compare — side-by-side split screen with an animated divider, before/after panels
// (one side tinted vs the other) and comparison labels. Props-only, no fs/env/fetch/external pkgs,
// renders with no assets (procedural panels).
export const SplitScreenCompare: React.FC<CreativeEffectRuntimeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const bg = paletteColor(props.colors, 0, "#0f172a");
  const beforeTint = paletteColor(props.colors, 1, "#ef4444");
  const afterTint = paletteColor(props.colors, 2, "#22c55e");
  const ink = paletteColor(props.colors, 3, "#f8fafc");

  const beforeLabel = textsForRole(props.texts, "before")[0] ?? "BEFORE";
  const afterLabel = textsForRole(props.texts, "after")[0] ?? "AFTER";
  const headline = textsForRole(props.texts, "product_name")[0] ?? textsForRole(props.texts, "title")[0] ?? "Compare";

  // Divider sweeps gently around the centre; panels push in from their outer edges at the start.
  const dividerX = width * 0.5 + interpolate(Math.sin((t % 4) * (Math.PI / 2)), [-1, 1], [-width * 0.04, width * 0.04]);
  const pushIn = interpolate(t % 6, [0, 1.2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const labelPop = interpolate(t % 6, [0, 0.5, 1], [0, 1.1, 1], { extrapolateRight: "clamp" });

  const panelBase: React.CSSProperties = {
    position: "absolute",
    top: 0,
    height,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  };

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: "Inter, Helvetica, Arial, sans-serif", overflow: "hidden" }}>
      {/* before panel (left) */}
      <div
        style={{
          ...panelBase,
          left: 0,
          width: dividerX,
          background: `linear-gradient(160deg, ${beforeTint}33, ${beforeTint}14)`,
          transform: `translateX(${-pushIn * width * 0.3}px)`
        }}
      >
        <span style={{ color: ink, fontSize: Math.round(height * 0.05), fontWeight: 800, opacity: 0.85, letterSpacing: 2, transform: `scale(${labelPop})` }}>
          {beforeLabel}
        </span>
      </div>

      {/* after panel (right) */}
      <div
        style={{
          ...panelBase,
          left: dividerX,
          width: width - dividerX,
          background: `linear-gradient(200deg, ${afterTint}33, ${afterTint}14)`,
          transform: `translateX(${pushIn * width * 0.3}px)`
        }}
      >
        <span style={{ color: ink, fontSize: Math.round(height * 0.05), fontWeight: 800, opacity: 0.85, letterSpacing: 2, transform: `scale(${labelPop})` }}>
          {afterLabel}
        </span>
      </div>

      {/* animated centre divider */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: dividerX - width * 0.006,
          width: width * 0.012,
          height,
          background: ink,
          boxShadow: `0 0 ${Math.round(width * 0.03)}px ${ink}`
        }}
      />

      {/* headline */}
      <div style={{ position: "absolute", top: height * 0.08, width, textAlign: "center", color: ink }}>
        <div style={{ fontSize: Math.round(height * 0.045), fontWeight: 700, letterSpacing: 1, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{headline}</div>
      </div>
    </AbsoluteFill>
  );
};

export default SplitScreenCompare;
