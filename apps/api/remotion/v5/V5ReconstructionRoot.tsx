// apps/api/remotion/v5/V5ReconstructionRoot.tsx
// renderer-spec.md §3: renders the Gen1 NeutralReconstructionProgram preview — placeholder-driven,
// content-neutral. Shows the learned STRUCTURE (scene roles + placeholder boxes + timing) without any
// sample pixels/text/audio. Driven by a flattened scene list via props.

import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { num } from "./recipeTypes";
import { MotionWrapper } from "./components";

export interface NeutralScenePreview {
  id: string;
  role: string;
  startSec: number;
  endSec: number;
  placeholderKinds?: string[];
}

export interface V5ReconstructionProps {
  scenes: NeutralScenePreview[];
  palette?: string[];
  durationSec?: number;
}

const FALLBACK_PALETTE = ["#0A0A0A", "#FFFFFF", "#F7C948"];

export const V5ReconstructionRoot: React.FC<V5ReconstructionProps> = ({ scenes, palette }) => {
  const { fps, width } = useVideoConfig();
  const pal = palette && palette.length ? palette : FALLBACK_PALETTE;
  return (
    <AbsoluteFill style={{ backgroundColor: pal[0] }}>
      {scenes.map((s) => {
        const from = Math.max(0, Math.round(s.startSec * fps));
        const durationInFrames = Math.max(1, Math.round((s.endSec - s.startSec) * fps));
        return (
          <Sequence key={s.id} from={from} durationInFrames={durationInFrames} layout="none">
            <MotionWrapper kind="slide_up_pop" durationInFrames={durationInFrames}>
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: width * 0.04 }}>
                <div style={{ color: pal[1] ?? "#FFFFFF", opacity: 0.25, fontSize: Math.round(width * 0.085), fontWeight: 800, textTransform: "uppercase", fontFamily: "Inter, Arial, sans-serif" }}>
                  {s.role}
                </div>
                <div style={{ display: "flex", gap: width * 0.02, flexWrap: "wrap", justifyContent: "center", maxWidth: "80%" }}>
                  {(s.placeholderKinds ?? []).map((k, i) => (
                    <div key={i} style={{ border: `2px dashed ${pal[2] ?? "#F7C948"}`, color: pal[2] ?? "#F7C948", borderRadius: width * 0.02, padding: `${width * 0.012}px ${width * 0.03}px`, fontSize: Math.round(width * 0.028), fontFamily: "Inter, Arial, sans-serif" }}>
                      {k}
                    </div>
                  ))}
                </div>
              </AbsoluteFill>
            </MotionWrapper>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const defaultReconstructionProps: V5ReconstructionProps = {
  scenes: [
    { id: "s1", role: "hook", startSec: 0, endSec: 2, placeholderKinds: ["hero_product", "main_title"] },
    { id: "s2", role: "benefit", startSec: 2, endSec: 5, placeholderKinds: ["product_closeup", "subtitle_text"] },
    { id: "s3", role: "cta", startSec: 5, endSec: 7, placeholderKinds: ["cta_card"] }
  ],
  palette: FALLBACK_PALETTE,
  durationSec: 7
};

export function reconstructionDims(props: V5ReconstructionProps, fps = 30): number {
  const dur = props.durationSec ?? Math.max(...props.scenes.map((s) => s.endSec), 1);
  return Math.max(1, Math.round(num(dur, 7) * fps));
}
