import React from "react";
import { Composition, registerRoot } from "remotion";
import { ReconstructionRoot, defaultTimeline, type ReconstructionProps } from "./ReconstructionRoot";

const RemotionRoot: React.FC = () => (
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
      const aspect = tl.aspectRatio;
      const width = aspect === "16:9" ? 1280 : aspect === "1:1" ? 720 : 720;
      const height = aspect === "16:9" ? 720 : aspect === "1:1" ? 720 : 1280;
      return { durationInFrames: duration, fps, width, height };
    }}
  />
);

registerRoot(RemotionRoot);
