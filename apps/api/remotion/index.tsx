import React from "react";
import { Composition, registerRoot } from "remotion";
import { ReconstructionRoot, defaultTimeline, type ReconstructionProps } from "./ReconstructionRoot";
import { ViralRecipeRoot, defaultRecipeProps, type ViralRecipeProps } from "./ViralRecipeRoot";
import { V5FinalRoot, defaultV5FinalProps, dimsForRecipe, type V5FinalProps } from "./v5/V5FinalRoot";
import { V5ReconstructionRoot, defaultReconstructionProps, reconstructionDims, type V5ReconstructionProps } from "./v5/V5ReconstructionRoot";

function dimsFor(aspect: string | undefined): { width: number; height: number } {
  if (aspect === "16:9") return { width: 1280, height: 720 };
  if (aspect === "1:1") return { width: 720, height: 720 };
  return { width: 720, height: 1280 };
}

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="ViralReconstruction"
      component={ReconstructionRoot}
      durationInFrames={450}
      fps={30}
      width={720}
      height={1280}
      defaultProps={{ timeline: defaultTimeline } satisfies ReconstructionProps}
      calculateMetadata={({ props }) => {
        const tl = (props as ReconstructionProps).timeline ?? defaultTimeline;
        const fps = tl.renderPlan?.fps ?? 30;
        const duration = Math.max(1, Math.round(tl.durationSec * fps));
        const { width, height } = dimsFor(tl.aspectRatio);
        return { durationInFrames: duration, fps, width, height };
      }}
    />
    {/* v1.3: recipe-driven composition. Consumes timeline.renderPlan.renderRecipe + assetMap. */}
    <Composition
      id="ViralRecipe"
      component={ViralRecipeRoot}
      durationInFrames={450}
      fps={30}
      width={720}
      height={1280}
      defaultProps={defaultRecipeProps satisfies ViralRecipeProps}
      calculateMetadata={({ props }) => {
        const tl = (props as ViralRecipeProps).timeline;
        const fps = tl?.renderPlan?.fps ?? 30;
        const duration = Math.max(1, Math.round((tl?.durationSec ?? 15) * fps));
        const { width, height } = dimsFor(tl?.aspectRatio);
        return { durationInFrames: duration, fps, width, height };
      }}
    />
    {/* v5: final video driven by RenderRecipeV5 + assetMap (Gen2 / deterministic compose). */}
    <Composition
      id="V5Final"
      component={V5FinalRoot}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultV5FinalProps satisfies V5FinalProps}
      calculateMetadata={({ props }) => {
        const { width, height, fps, durationInFrames } = dimsForRecipe((props as V5FinalProps).recipe);
        return { durationInFrames, fps, width, height };
      }}
    />
    {/* v5: Gen1 neutral reconstruction preview (structure-only, placeholder-driven). */}
    <Composition
      id="V5Reconstruction"
      component={V5ReconstructionRoot}
      durationInFrames={210}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultReconstructionProps satisfies V5ReconstructionProps}
      calculateMetadata={({ props }) => {
        const p = props as V5ReconstructionProps;
        const fps = 30;
        return { durationInFrames: reconstructionDims(p, fps), fps, width: 1080, height: 1920 };
      }}
    />
  </>
);

registerRoot(RemotionRoot);
