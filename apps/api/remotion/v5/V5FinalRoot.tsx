// apps/api/remotion/v5/V5FinalRoot.tsx
// renderer-spec.md §3: renders the Gen2 / deterministic-compose final video from a RenderRecipeV5 via
// the built-in component library. A FIXED root driven by recipe props (input props at render time) —
// this is the robust per-generation render path (audit CREATE-01) that avoids bundling arbitrary
// AI code per generation. The AI Gen2 multi-file project is an optional enhancement layered later.

import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { num, str, type AssetMap, type RenderRecipeV5 } from "./recipeTypes";
import { CTAButton, DesignedVisualLayer, GradientMotionBg, KineticTextLayer, MediaLayer, MotionWrapper, ShapeLayer, TextLayer } from "./components";

/** Short section-boundary flash/sweep — gives a real cut between beats instead of a hard jump. */
const TransitionFlash: React.FC<{ color: string; durationInFrames: number }> = ({ color, durationInFrames }) => {
  const frame = useCurrentFrame();
  const o = Math.max(0, 0.55 * (1 - frame / Math.max(1, durationInFrames)));
  return <AbsoluteFill style={{ background: color, opacity: o, mixBlendMode: "screen" }} />;
};

export interface V5FinalProps {
  recipe: RenderRecipeV5;
  assetMap: AssetMap;
}

const FALLBACK_PALETTE = ["#0A0A0A", "#FFFFFF", "#F7C948"];

export const V5FinalRoot: React.FC<V5FinalProps> = ({ recipe, assetMap }) => {
  const { fps } = useVideoConfig();
  const bg = recipe.composition.background ?? FALLBACK_PALETTE[0];
  // Derive palette from any text/shape layer style accents, else fallback.
  const palette = FALLBACK_PALETTE.slice();
  for (const l of recipe.layers) {
    const accent = str(l.style?.accent) || str(l.style?.fill);
    if (accent && !palette.includes(accent)) palette.push(accent);
  }

  const palAccent = palette[3] ?? palette[2] ?? bg;
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <GradientMotionBg from={bg} to={palAccent} accent={palette[2]} />
      {recipe.layers.map((layer) => {
        const from = Math.max(0, Math.round(layer.startSec * fps));
        const durationInFrames = Math.max(1, Math.round((layer.endSec - layer.startSec) * fps));
        const hasAsset = Boolean(layer.assetId && assetMap[layer.assetId]);
        let node: React.ReactNode = null;
        switch (layer.type) {
          case "media":
            // Bound to a real/generated asset -> show it; otherwise a designed visual, never a flat card.
            node = hasAsset ? <MediaLayer layer={layer} assetMap={assetMap} palette={palette} /> : <DesignedVisualLayer layer={layer} palette={palette} />;
            break;
          case "generated_visual":
            node = <DesignedVisualLayer layer={layer} palette={palette} />;
            break;
          case "text":
            // Kinetic typography (word-level beat pops) when requested, else a clean static line.
            node = layer.style?.kineticText ? <KineticTextLayer layer={layer} palette={palette} /> : <TextLayer layer={layer} palette={palette} />;
            break;
          case "packaging":
            node = layer.text ? <CTAButton layer={layer} palette={palette} /> : <DesignedVisualLayer layer={layer} palette={palette} />;
            break;
          case "shape":
            // fullscreen / gradient_bg sections render an animated gradient, not a flat fill.
            node =
              str(layer.style?.variant) === "gradient_bg" || str(layer.style?.shape) === "fullscreen"
                ? <GradientMotionBg from={str(layer.style?.fill, bg)} to={str(layer.style?.gradientTo, palAccent)} accent={palette[2]} />
                : <ShapeLayer fill={str(layer.style?.fill, palette[2])} shape={str(layer.style?.shape, "card")} />;
            break;
          case "transition":
            node = <TransitionFlash color={str(layer.style?.fill, palette[2] ?? "#FFFFFF")} durationInFrames={durationInFrames} />;
            break;
          case "motion":
          case "audio":
          case "debug":
          default:
            node = null;
        }
        if (!node) return null;
        // Transitions own their own timing; everything else flows through the motion engine.
        if (layer.type === "transition") {
          return (
            <Sequence key={layer.id} from={from} durationInFrames={durationInFrames} layout="none">
              {node}
            </Sequence>
          );
        }
        return (
          <Sequence key={layer.id} from={from} durationInFrames={durationInFrames} layout="none">
            <MotionWrapper motion={layer.motion} layerStartSec={layer.startSec} durationInFrames={durationInFrames}>
              {node}
            </MotionWrapper>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const defaultRecipe: RenderRecipeV5 = {
  version: "render-recipe-v5",
  composition: { width: 1080, height: 1920, fps: 30, durationSec: 6, aspectRatio: "9:16", background: "#0A0A0A" },
  layers: [
    { id: "bg", type: "shape", startSec: 0, endSec: 6, style: { fill: "#0A0A0A", shape: "fullscreen" } },
    { id: "title", type: "text", startSec: 0.3, endSec: 3, text: "V5 Final", style: { color: "#FFFFFF", fontWeight: 800, safeArea: "top" } },
    { id: "cta", type: "packaging", startSec: 3, endSec: 6, text: "Shop now", style: { accent: "#F7C948" } }
  ],
  audioLayers: [],
  assets: []
};

export const defaultV5FinalProps: V5FinalProps = { recipe: defaultRecipe, assetMap: {} };

export function dimsForRecipe(recipe: RenderRecipeV5): { width: number; height: number; fps: number; durationInFrames: number } {
  const fps = num(recipe.composition.fps, 30);
  return {
    width: num(recipe.composition.width, 1080),
    height: num(recipe.composition.height, 1920),
    fps,
    durationInFrames: Math.max(1, Math.round(num(recipe.composition.durationSec, 6) * fps))
  };
}
