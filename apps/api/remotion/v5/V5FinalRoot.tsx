// apps/api/remotion/v5/V5FinalRoot.tsx
// renderer-spec.md §3: renders the Gen2 / deterministic-compose final video from a RenderRecipeV5 via
// the built-in component library. A FIXED root driven by recipe props (input props at render time) —
// this is the robust per-generation render path (audit CREATE-01) that avoids bundling arbitrary
// AI code per generation. The AI Gen2 multi-file project is an optional enhancement layered later.

import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { num, str, type AssetMap, type RenderRecipeV5 } from "./recipeTypes";
import { CTAButton, GradientBackground, MediaLayer, MotionWrapper, ShapeLayer, TextLayer } from "./components";

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

  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <GradientBackground from={bg} />
      {recipe.layers.map((layer) => {
        const from = Math.max(0, Math.round(layer.startSec * fps));
        const durationInFrames = Math.max(1, Math.round((layer.endSec - layer.startSec) * fps));
        let node: React.ReactNode = null;
        switch (layer.type) {
          case "media":
            node = <MediaLayer layer={layer} assetMap={assetMap} palette={palette} />;
            break;
          case "text":
            node = <TextLayer layer={layer} palette={palette} />;
            break;
          case "packaging":
            node = layer.text ? <CTAButton layer={layer} palette={palette} /> : <ShapeLayer fill={str(layer.style?.fill, palette[2])} shape="card" />;
            break;
          case "shape":
            node = <ShapeLayer fill={str(layer.style?.fill, palette[2])} shape={str(layer.style?.shape, "card")} />;
            break;
          case "transition":
          case "motion":
          case "audio":
          case "debug":
          default:
            node = null;
        }
        if (!node) return null;
        const motionKind = str(layer.motion?.kind);
        return (
          <Sequence key={layer.id} from={from} durationInFrames={durationInFrames} layout="none">
            <MotionWrapper kind={motionKind} durationInFrames={durationInFrames}>
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
