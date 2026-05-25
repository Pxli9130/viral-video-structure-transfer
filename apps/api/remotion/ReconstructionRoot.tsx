import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";

interface MotionAtomLike {
  type: "ribbon_orbit" | "3d_ribbon_orbit";
  fulfilledBy: "procedural_generation";
  keywords: string[];
  colorProgression: string[];
  style: "mg_motion" | "clean_premium";
  density: number;
  speed: number;
  opacity: number;
  startSec: number;
  endSec: number;
}

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
  renderPlan?: {
    fps?: number;
    background?: string;
    motionAtoms?: MotionAtomLike[];
    adapterOptions?: Record<string, unknown>;
  };
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

function hasRibbonAtom(timeline: TimelineLike): boolean {
  return (timeline.renderPlan?.motionAtoms ?? []).some((atom) => atom.type === "ribbon_orbit" || atom.type === "3d_ribbon_orbit");
}

function clipBackground(role: string, timeline: TimelineLike): string {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  if (packagingStyle === "clean") return "linear-gradient(180deg, #fbfdff 0%, #eef6ff 58%, #f8fafc 100%)";
  if (packagingStyle === "bold") return "linear-gradient(160deg, #7f1d1d 0%, #b91c1c 100%)";
  if (hasRibbonAtom(timeline)) return "radial-gradient(circle at 50% 36%, #263350 0%, #111827 48%, #050816 100%)";
  const pair = ROLE_BACKGROUNDS[role] ?? ROLE_BACKGROUNDS.body;
  return `linear-gradient(160deg, ${pair[0]} 0%, ${pair[1]} 100%)`;
}

function foregroundFor(timeline: TimelineLike): { text: string; muted: string; accent: string; box: string; shadow: string } {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  if (packagingStyle === "clean") {
    return { text: "#111827", muted: "#334155", accent: "#0f766e", box: "rgba(255, 255, 255, 0.78)", shadow: "0 6px 24px rgba(15,23,42,0.16)" };
  }
  if (packagingStyle === "bold") {
    return { text: "#fef2f2", muted: "#fee2e2", accent: "#facc15", box: "rgba(69, 10, 10, 0.62)", shadow: "0 8px 28px rgba(0,0,0,0.5)" };
  }
  return { text: "#f8fafc", muted: "#e2e8f0", accent: "#facc15", box: "rgba(15, 23, 42, 0.55)", shadow: "0 6px 24px rgba(0,0,0,0.45)" };
}

function ribbonAtomsFor(timeline: TimelineLike): MotionAtomLike[] {
  return (timeline.renderPlan?.motionAtoms ?? []).filter((atom) => atom.type === "ribbon_orbit" || atom.type === "3d_ribbon_orbit");
}

function readableSubtitle(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function mainTitleFor(clip: TimelineClipLike): string {
  const text = readableSubtitle(clip.subtitleText ?? clip.visualIntent);
  if (/爆款结构迁移引擎/.test(text)) return "爆款结构迁移引擎";
  if (/Upload\. Analyze\. Remix\./i.test(text)) return "Upload. Analyze. Remix.";
  const topicTail = text.split(/[·|｜]/).map((part) => part.trim()).filter(Boolean).at(-1);
  return topicTail && topicTail.length <= 18 ? topicTail : text.slice(0, 22);
}

function supportingLineFor(clip: TimelineClipLike, hasRibbon: boolean): string {
  if (clip.role === "cta") return "一键生成可解释短视频方案";
  if (hasRibbon) return "Viral Structure Transfer Engine";
  return readableSubtitle(clip.visualIntent).slice(0, 48);
}

function bottomLineFor(clip: TimelineClipLike, hasRibbon: boolean): string {
  if (clip.role === "cta") return "From sample breakdown to video recomposition";
  if (hasRibbon) return "AI Full-Stack Challenge 2026";
  return readableSubtitle(clip.visualIntent);
}

function keywordLine(atom: MotionAtomLike | undefined): string {
  const keywords = atom?.keywords?.length ? atom.keywords : ["STRUCTURE", "REMIX", "TIMELINE", "AIGC"];
  return keywords.slice(0, 4).join(" / ");
}

const RibbonOrbitLayer: React.FC<{ atom: MotionAtomLike; clipStartSec: number }> = ({ atom, clipStartSec }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const globalSec = clipStartSec + frame / fps;
  if (globalSec < atom.startSec || globalSec > atom.endSec) return null;

  const clean = atom.style === "clean_premium";
  const colors = atom.colorProgression.length
    ? atom.colorProgression
    : ["#2563eb", "#7c3aed", "#ec4899", "#f97316", "#eab308", "#22c55e"];
  const density = Math.max(1, Math.min(6, Math.round(atom.density)));
  const cx = width / 2;
  const cy = height * (clean ? 0.43 : 0.45);
  const rx = width * (clean ? 0.42 : 0.54);
  const ry = height * (clean ? 0.14 : 0.2);
  const dashSpeed = 140 * atom.speed;
  const orbitSpeed = (clean ? 11 : 24) * atom.speed;
  const progress = globalSec * atom.speed;
  const baseOpacity = Math.max(0.12, Math.min(0.92, atom.opacity));
  const strokeWidth = clean ? Math.round(width * 0.024) : Math.round(width * 0.042);
  const pathA = `M ${cx - rx} ${cy} C ${cx - rx * 0.48} ${cy - ry * 1.6}, ${cx + rx * 0.58} ${cy - ry * 1.45}, ${cx + rx} ${cy} C ${cx + rx * 0.48} ${cy + ry * 1.5}, ${cx - rx * 0.55} ${cy + ry * 1.35}, ${cx - rx} ${cy}`;
  const pathB = `M ${cx - rx * 0.88} ${cy + ry * 0.56} C ${cx - rx * 0.25} ${cy - ry * 1.2}, ${cx + rx * 0.35} ${cy + ry * 1.45}, ${cx + rx * 0.92} ${cy - ry * 0.34}`;
  const keywordCount = clean ? Math.min(6, atom.keywords.length + 1) : Math.min(12, atom.keywords.length * 2);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`softGlow-${atom.style}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={clean ? 4 : 8} result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.55 0" />
            <feBlend in="SourceGraphic" />
          </filter>
        </defs>
        {Array.from({ length: density }).map((_, index) => {
          const color = colors[index % colors.length];
          const rotation = progress * orbitSpeed + index * (clean ? 18 : 31);
          const translateY = Math.sin(progress * 1.6 + index) * (clean ? 10 : 28);
          const scale = 1 - index * (clean ? 0.055 : 0.04);
          const dash = clean ? 520 : 360;
          const gap = clean ? 280 : 180;
          const path = index % 2 === 0 ? pathA : pathB;
          return (
            <g
              key={index}
              style={{
                transform: `translate(${cx}px, ${cy + translateY}px) rotate(${rotation}deg) scale(${scale}) translate(${-cx}px, ${-cy}px)`,
                transformOrigin: `${cx}px ${cy}px`
              }}
            >
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-globalSec * dashSpeed - index * 120}
                opacity={baseOpacity * (clean ? 0.54 : 0.72)}
                filter={`url(#softGlow-${atom.style})`}
              />
              <path
                d={path}
                fill="none"
                stroke="#ffffff"
                strokeWidth={Math.max(2, strokeWidth * 0.16)}
                strokeLinecap="round"
                strokeDasharray={`${dash * 0.42} ${gap * 1.45}`}
                strokeDashoffset={-globalSec * dashSpeed * 1.2 - index * 90}
                opacity={clean ? 0.2 : 0.32}
              />
            </g>
          );
        })}
      </svg>
      {Array.from({ length: keywordCount }).map((_, index) => {
        const keyword = atom.keywords[index % Math.max(1, atom.keywords.length)] ?? "STRUCTURE";
        const angle = progress * (clean ? 0.55 : 0.95) + index * ((Math.PI * 2) / keywordCount);
        const radiusX = rx * (clean ? 0.78 : 0.92);
        const radiusY = ry * (clean ? 0.86 : 1.08);
        const x = cx + Math.cos(angle) * radiusX;
        const y = cy + Math.sin(angle) * radiusY;
        return (
          <div
            key={`${keyword}-${index}`}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: `translate(-50%, -50%) rotate(${(angle * 180) / Math.PI + 8}deg)`,
              color: colors[(index + 1) % colors.length],
              fontSize: clean ? 18 : 24,
              fontWeight: 800,
              letterSpacing: 0,
              opacity: clean ? 0.46 : 0.72,
              textShadow: clean ? "0 1px 8px rgba(15,23,42,0.12)" : "0 0 18px rgba(56,189,248,0.45)",
              whiteSpace: "nowrap"
            }}
          >
            {keyword}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const HeadlineCard: React.FC<{ clip: TimelineClipLike; timeline: TimelineLike }> = ({ clip, timeline }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const colors = foregroundFor(timeline);
  const ribbonAtoms = ribbonAtomsFor(timeline);
  const hasRibbon = ribbonAtoms.length > 0;
  const primaryAtom = ribbonAtoms[0];
  const clean = primaryAtom?.style === "clean_premium";
  const enter = Math.min(1, frame / (fps * 0.4));
  const translateY = (1 - enter) * 80;
  const opacity = enter;
  const headlineSize = Math.round(Math.min(width, height) * (hasRibbon ? 0.076 : 0.07));
  const subSize = Math.round(Math.min(width, height) * (hasRibbon ? 0.032 : 0.04));
  const eyebrowSize = Math.round(Math.min(width, height) * 0.024);
  const mainTitle = hasRibbon ? (clip.role === "cta" ? "Upload. Analyze. Remix." : "爆款结构迁移引擎") : mainTitleFor(clip);
  const support = supportingLineFor(clip, hasRibbon);
  const bottom = bottomLineFor(clip, hasRibbon);
  return (
    <AbsoluteFill
      style={{
        background: clipBackground(clip.role, timeline),
        color: colors.text,
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
      }}
    >
      {ribbonAtoms.map((atom) => (
        <RibbonOrbitLayer key={`${atom.type}-${atom.style}`} atom={atom} clipStartSec={clip.startSec} />
      ))}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 64,
          fontSize: eyebrowSize,
          letterSpacing: 0,
          color: colors.accent,
          textTransform: "uppercase",
          opacity
        }}
      >
        {hasRibbon ? "AI FULL-STACK CHALLENGE 2026" : clip.role}
      </div>
      <div
        style={{
          position: "absolute",
          top: hasRibbon ? "30%" : "38%",
          left: hasRibbon ? 72 : 64,
          right: hasRibbon ? 72 : 64,
          fontSize: headlineSize,
          fontWeight: 800,
          lineHeight: 1.08,
          textAlign: hasRibbon ? "center" : "left",
          textShadow: hasRibbon && !clean ? "0 10px 34px rgba(0,0,0,0.72)" : colors.shadow,
          transform: `translateY(${translateY}px)`,
          opacity
        }}
      >
        {mainTitle}
      </div>
      <div
        style={{
          position: "absolute",
          top: hasRibbon ? "43%" : undefined,
          bottom: hasRibbon ? undefined : 80,
          left: 64,
          right: 64,
          fontSize: subSize,
          fontWeight: hasRibbon ? 700 : 500,
          padding: hasRibbon ? 0 : "12px 24px",
          background: hasRibbon ? "transparent" : colors.box,
          borderRadius: hasRibbon ? 0 : 18,
          color: colors.muted,
          opacity,
          textAlign: hasRibbon ? "center" : "left"
        }}
      >
        {support}
      </div>
      {hasRibbon ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 62,
              right: 62,
              top: "52%",
              color: clean ? "#2563eb" : "#93c5fd",
              fontSize: clean ? 22 : 26,
              fontWeight: 800,
              letterSpacing: 0,
              textAlign: "center",
              opacity
            }}
          >
            {keywordLine(primaryAtom)}
          </div>
          <div
            style={{
              position: "absolute",
              left: 76,
              right: 76,
              bottom: clean ? 110 : 92,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              color: clean ? "#334155" : "#dbeafe",
              fontSize: clean ? 22 : 24,
              fontWeight: 650,
              opacity
            }}
          >
            <span>{bottom}</span>
            <span>{clip.role.toUpperCase()}</span>
          </div>
        </>
      ) : null}
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
            <HeadlineCard clip={clip} timeline={safeTimeline} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
