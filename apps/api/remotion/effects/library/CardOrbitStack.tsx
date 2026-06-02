import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { paletteColor, type CreativeEffectRuntimeProps } from "../types";

// card_orbit_motion_graph — black/red palette, 8-12 cards orbit/stack/scatter, neon frame pulse.
// Renders procedural card placeholders when no assets are supplied. Props-only, no fs/env/fetch.
export const CardOrbitStack: React.FC<CreativeEffectRuntimeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const bg = paletteColor(props.colors, 0, "#05060a");
  const neon = paletteColor(props.colors, 1, "#e11d2a");
  const card = paletteColor(props.colors, 2, "#f5f5f5");
  const accent = paletteColor(props.colors, 3, "#22d3ee");

  const assets = (props.assets ?? []).filter((a) => a.src);
  const cardCount = Math.min(12, Math.max(8, assets.length || 10));
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;
  // beat-driven pulse: stronger near the closest beat.
  const beats = props.beats ?? [];
  const nearestBeatDist = beats.length ? Math.min(...beats.map((b) => Math.abs(b - (t % (props.durationSec || 1))))) : 0.5;
  const pulse = interpolate(Math.min(nearestBeatDist, 0.25), [0, 0.25], [1, 0.35], { extrapolateRight: "clamp" });

  const cards = Array.from({ length: cardCount }, (_, i) => {
    const ang = (i / cardCount) * Math.PI * 2 + t * 0.6;
    const scatter = interpolate(t % 8, [0, 4, 8], [0.4, 1, 0.4]); // stack -> scatter -> stack
    const x = cx + Math.cos(ang) * radius * scatter - width * 0.07;
    const y = cy + Math.sin(ang) * radius * 0.7 * scatter - height * 0.05;
    const a = assets[i];
    return (
      <div
        key={i}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: width * 0.14,
          height: height * 0.1,
          borderRadius: 10,
          border: `2px solid ${accent}`,
          background: a?.src ? "transparent" : card,
          boxShadow: `0 0 ${18 * pulse}px ${neon}`,
          transform: `rotate(${Math.sin(ang) * 10}deg)`,
          overflow: "hidden"
        }}
      >
        {a?.src ? <Img src={a.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      </div>
    );
  });

  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden", fontFamily: "Arial, sans-serif" }}>
      {/* neon frame pulse */}
      <div
        style={{
          position: "absolute",
          inset: Math.round(width * 0.03),
          border: `${Math.max(2, Math.round(4 * pulse))}px solid ${neon}`,
          borderRadius: 18,
          boxShadow: `0 0 ${30 * pulse}px ${neon}`,
          opacity: 0.8
        }}
      />
      {cards}
    </AbsoluteFill>
  );
};

export default CardOrbitStack;
