import React from "react";
import { Composition, registerRoot } from "remotion";
import { ReconstructionRoot, defaultTimeline, type ReconstructionProps } from "./ReconstructionRoot";
import { ViralRecipeRoot, defaultRecipeProps, type ViralRecipeProps } from "./ViralRecipeRoot";

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
  </>
);

registerRoot(RemotionRoot);
