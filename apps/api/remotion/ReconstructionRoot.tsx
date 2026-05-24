import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";

interface TimelineClipLike {
  id: string;
  role: string;
  startSec: number;
  durationSec: number;
  type: string;
  subtitleText?: string;
  visualIntent?: string;
  layers?: Array<{ kind: string; text?: string }>;
}

interface TimelineLike {
  id: string;
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  rendererTarget: string;
  clips: TimelineClipLike[];
  renderPlan?: { fps?: number; background?: string };
}

export interface ReconstructionProps {
  timeline: TimelineLike;
}

export const defaultTimeline: TimelineLike = {
  id: "preview",
  durationSec: 15,
  aspectRatio: "9:16",
  rendererTarget: "remotion",
  clips: [
    {
      id: "preview_hook",
      role: "hook",
      startSec: 0,
      durationSec: 3,
      type: "text_card",
      subtitleText: "Hook line",
      visualIntent: "Open with the strongest benefit"
    },
    {
      id: "preview_body",
      role: "body",
      startSec: 3,
      durationSec: 8,
      type: "text_card",
      subtitleText: "Selling point",
      visualIntent: "Demonstrate value"
    },
    {
      id: "preview_cta",
      role: "cta",
      startSec: 11,
      durationSec: 4,
      type: "text_card",
      subtitleText: "Click to learn more",
      visualIntent: "Direct CTA"
    }
  ],
  renderPlan: { fps: 30, background: "#0f172a" }
};

const ROLE_BACKGROUNDS: Record<string, [string, string]> = {
  hook: ["#0f172a", "#1e293b"],
  setup: ["#111827", "#1f2937"],
  body: ["#111827", "#0f172a"],
  proof: ["#0f766e", "#134e4a"],
  transition: ["#1f2937", "#111827"],
  cta: ["#b91c1c", "#7f1d1d"]
};

function clipBackground(role: string): string {
  const pair = ROLE_BACKGROUNDS[role] ?? ROLE_BACKGROUNDS.body;
  return `linear-gradient(160deg, ${pair[0]} 0%, ${pair[1]} 100%)`;
}

const HeadlineCard: React.FC<{ clip: TimelineClipLike }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const enter = Math.min(1, frame / (fps * 0.4));
  const translateY = (1 - enter) * 80;
  const opacity = enter;
  const headlineSize = Math.round(Math.min(width, height) * 0.07);
  const subSize = Math.round(Math.min(width, height) * 0.04);
  return (
    <AbsoluteFill
      style={{
        background: clipBackground(clip.role),
        color: "#f8fafc",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 64,
          fontSize: subSize,
          letterSpacing: 4,
          color: "#facc15",
          textTransform: "uppercase",
          opacity
        }}
      >
        {clip.role}
      </div>
      <div
        style={{
          position: "absolute",
          top: "38%",
          left: 64,
          right: 64,
          fontSize: headlineSize,
          fontWeight: 800,
          lineHeight: 1.1,
          textShadow: "0 6px 24px rgba(0,0,0,0.45)",
          transform: `translateY(${translateY}px)`,
          opacity
        }}
      >
        {clip.subtitleText ?? clip.visualIntent ?? ""}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 64,
          right: 64,
          fontSize: subSize,
          fontWeight: 500,
          padding: "12px 24px",
          background: "rgba(15, 23, 42, 0.55)",
          borderRadius: 18,
          color: "#e2e8f0",
          opacity
        }}
      >
        {clip.visualIntent ?? "Reusable structure"}
      </div>
    </AbsoluteFill>
  );
};

export const ReconstructionRoot: React.FC<ReconstructionProps> = ({ timeline }) => {
  const config = useVideoConfig();
  const fps = config.fps;
  const safeTimeline = timeline ?? defaultTimeline;
  return (
    <AbsoluteFill style={{ background: safeTimeline.renderPlan?.background ?? "#0f172a" }}>
      {safeTimeline.clips.map((clip) => {
        const from = Math.round(clip.startSec * fps);
        const durationInFrames = Math.max(1, Math.round(clip.durationSec * fps));
        return (
          <Sequence key={clip.id} from={from} durationInFrames={durationInFrames}>
            <HeadlineCard clip={clip} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
