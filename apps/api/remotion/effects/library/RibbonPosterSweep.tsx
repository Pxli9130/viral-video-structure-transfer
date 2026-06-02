import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { paletteColor, textsForRole, type CreativeEffectRuntimeProps } from "../types";

// poster_ribbon_marketing — light/white poster bg, colorful ribbon/silk sweep, clean poster
// typography, soft gallery CTA. Props-only, no fs/env/fetch/external pkgs, renders with no assets.
export const RibbonPosterSweep: React.FC<CreativeEffectRuntimeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const bg = paletteColor(props.colors, 0, "#f7f1e8");
  const ribbonA = paletteColor(props.colors, 1, "#e11d2a");
  const ribbonB = paletteColor(props.colors, 2, "#f5c518");
  const ink = paletteColor(props.colors, 3, "#1f2937");
  const headline = textsForRole(props.texts, "product_name")[0] ?? "Product";
  const cta = textsForRole(props.texts, "cta")[0] ?? "View the gallery";
  const sweepX = interpolate(t % 4, [0, 4], [-width * 0.3, width * 1.3]);
  const drift = interpolate(t % 6, [0, 6], [-12, 12]);

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: "Georgia, 'Times New Roman', serif", overflow: "hidden" }}>
      {/* colorful ribbon/silk sweep */}
      <div
        style={{
          position: "absolute",
          top: height * 0.18,
          left: sweepX,
          width: width * 0.55,
          height: height * 0.5,
          background: `linear-gradient(120deg, ${ribbonA}, ${ribbonB})`,
          transform: "rotate(-18deg)",
          borderRadius: 40,
          opacity: 0.85,
          filter: "blur(2px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          top: height * 0.3,
          left: width * 1.3 - sweepX,
          width: width * 0.4,
          height: height * 0.36,
          background: `linear-gradient(120deg, ${ribbonB}, ${ribbonA})`,
          transform: "rotate(14deg)",
          borderRadius: 40,
          opacity: 0.6
        }}
      />
      {/* clean poster typography */}
      <div style={{ position: "absolute", top: height * 0.1 + drift, width, textAlign: "center", color: ink }}>
        <div style={{ fontSize: Math.round(height * 0.06), fontWeight: 700, letterSpacing: 2 }}>{headline}</div>
        <div style={{ fontSize: Math.round(height * 0.022), letterSpacing: 6, marginTop: 12, textTransform: "uppercase", opacity: 0.7 }}>
          Collection
        </div>
      </div>
      {/* soft gallery CTA */}
      <div
        style={{
          position: "absolute",
          bottom: height * 0.1,
          width,
          textAlign: "center"
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "14px 38px",
            border: `2px solid ${ink}`,
            borderRadius: 999,
            color: ink,
            fontSize: Math.round(height * 0.026),
            letterSpacing: 2,
            background: "rgba(255,255,255,0.6)"
          }}
        >
          {cta}
        </span>
      </div>
    </AbsoluteFill>
  );
};

export default RibbonPosterSweep;
