import React from "react";
import { AbsoluteFill, Img, Sequence, Video, useCurrentFrame, useVideoConfig } from "remotion";

interface MotionAtomLike {
  type:
    | "ribbon_orbit"
    | "3d_ribbon_orbit"
    | "wide_3d_ribbon_surface"
    | "ribbon_surface_3d"
    | "true_3d_ribbon_mesh"
    | "ribbon_mesh_3d"
    | "parametric_ribbon_surface";
  fulfilledBy: "procedural_generation";
  keywords: string[];
  colorProgression: string[];
  style: "mg_motion" | "clean_premium";
  density: number;
  speed: number;
  opacity: number;
  bandWidth?: number;
  edgeWidth?: number;
  gradientStops?: string[];
  frontLayerCount?: number;
  backLayerCount?: number;
  textOnRibbon?: boolean;
  depthLayering?: boolean;
  twistIntensity?: number;
  perspectiveStrength?: number;
  specularHighlight?: boolean;
  shadowOpacity?: number;
  climaxBuild?: boolean;
  surfaceType?: "thin_line" | "wide_band" | "textured_band" | "particle_trail";
  pathFamily?: "vertical_helix" | "planar_orbit" | "diagonal_sweep" | "horizontal_wave" | "spiral_in" | "wave_loop" | "unknown";
  axis?: "screen_y" | "screen_z" | "screen_x" | "diagonal" | "unknown";
  depthBehavior?: "flat" | "perspective_only" | "front_back_crossing" | "occlusion_with_title";
  layoutRelation?: "around_title" | "background_only" | "foreground_sweep" | "border_frame";
  textRelation?: "text_on_ribbon" | "near_ribbon" | "none";
  confidence?: number;
  evidenceFrames?: number[];
  turns?: number;
  radiusX?: number;
  radiusZ?: number;
  pitchY?: number;
  startSec: number;
  endSec: number;
}

interface PlaceholderSpecLike {
  type?: string;
  shape?: string;
  color?: string;
  label?: string;
  motion?: Record<string, unknown>;
}

interface TimelineClipLike {
  id: string;
  role: string;
  startSec: number;
  durationSec: number;
  type: string;
  sourceAssetId?: string;
  subtitleText?: string;
  visualIntent?: string;
  gapFillStrategy?: string;
  replacementSlotId?: string;
  placeholderSpec?: PlaceholderSpecLike;
  layers?: Array<{ kind: string; text?: string; assetId?: string; style?: Record<string, unknown>; timing?: Record<string, unknown> }>;
  phaseLabel?: string;
  phaseSubtitle?: string;
  mappingPairs?: Array<{ sample: string; arrow?: string; target: string }>;
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
  assetMap?: Record<string, { src: string; ext?: string; type?: string }>;
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
  return (timeline.renderPlan?.motionAtoms ?? []).some((atom) => isRibbonAtom(atom));
}

function clipBackground(role: string, timeline: TimelineLike): string {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  const creativeMode = String(timeline.renderPlan?.adapterOptions?.creativeMode ?? "explainable_demo");
  if (creativeMode === "high_fidelity_style") return "#f4efe4";
  if (creativeMode === "final_creative" && packagingStyle === "mg_motion") return "#f7f1e8";
  if (packagingStyle === "clean") return "linear-gradient(180deg, #fbfdff 0%, #eef6ff 58%, #f8fafc 100%)";
  if (packagingStyle === "bold") return "linear-gradient(160deg, #7f1d1d 0%, #b91c1c 100%)";
  if (hasRibbonAtom(timeline)) return "radial-gradient(circle at 50% 36%, #263350 0%, #111827 48%, #050816 100%)";
  const pair = ROLE_BACKGROUNDS[role] ?? ROLE_BACKGROUNDS.body;
  return `linear-gradient(160deg, ${pair[0]} 0%, ${pair[1]} 100%)`;
}

function foregroundFor(timeline: TimelineLike): { text: string; muted: string; accent: string; box: string; shadow: string } {
  const packagingStyle = String(timeline.renderPlan?.adapterOptions?.packagingStyle ?? "");
  const creativeMode = String(timeline.renderPlan?.adapterOptions?.creativeMode ?? "explainable_demo");
  if (creativeMode === "high_fidelity_style" || (creativeMode === "final_creative" && packagingStyle === "mg_motion")) {
    return { text: "#121212", muted: "#2f3440", accent: "#1e40af", box: "rgba(244,239,228,0.74)", shadow: "0 12px 30px rgba(34, 28, 18, 0.18)" };
  }
  if (packagingStyle === "clean") {
    return { text: "#111827", muted: "#334155", accent: "#0f766e", box: "rgba(255, 255, 255, 0.78)", shadow: "0 6px 24px rgba(15,23,42,0.16)" };
  }
  if (packagingStyle === "bold") {
    return { text: "#fef2f2", muted: "#fee2e2", accent: "#facc15", box: "rgba(69, 10, 10, 0.62)", shadow: "0 8px 28px rgba(0,0,0,0.5)" };
  }
  return { text: "#f8fafc", muted: "#e2e8f0", accent: "#facc15", box: "rgba(15, 23, 42, 0.55)", shadow: "0 6px 24px rgba(0,0,0,0.45)" };
}

function ribbonAtomsFor(timeline: TimelineLike): MotionAtomLike[] {
  return (timeline.renderPlan?.motionAtoms ?? []).filter((atom) => isRibbonAtom(atom));
}

function isRibbonAtom(atom: MotionAtomLike): boolean {
  return (
    atom.type === "ribbon_orbit" ||
    atom.type === "3d_ribbon_orbit" ||
    atom.type === "wide_3d_ribbon_surface" ||
    atom.type === "ribbon_surface_3d" ||
    atom.type === "true_3d_ribbon_mesh" ||
    atom.type === "ribbon_mesh_3d" ||
    atom.type === "parametric_ribbon_surface"
  );
}

function isSurfaceRibbonAtom(atom: MotionAtomLike): boolean {
  return (
    atom.type === "wide_3d_ribbon_surface" ||
    atom.type === "ribbon_surface_3d" ||
    atom.type === "true_3d_ribbon_mesh" ||
    atom.type === "ribbon_mesh_3d" ||
    atom.type === "parametric_ribbon_surface"
  );
}

function isMeshRibbonAtom(atom: MotionAtomLike): boolean {
  return (
    atom.type === "true_3d_ribbon_mesh" ||
    atom.type === "ribbon_mesh_3d" ||
    (atom.type === "parametric_ribbon_surface" &&
      (atom.depthBehavior === "front_back_crossing" || atom.depthBehavior === "occlusion_with_title"))
  );
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

function legacyPathFamily(atom: MotionAtomLike): NonNullable<MotionAtomLike["pathFamily"]> {
  if (atom.pathFamily && atom.pathFamily !== "unknown") return atom.pathFamily;
  if (atom.type === "ribbon_orbit" || atom.type === "3d_ribbon_orbit" || atom.type === "wide_3d_ribbon_surface" || atom.type === "ribbon_surface_3d") {
    return "planar_orbit";
  }
  return "diagonal_sweep";
}

function pointsToPath(points: Array<[number, number]>): string {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

function verticalHelixPath(cx: number, top: number, bottom: number, radius: number, turns: number, phase: number, lean: number): string {
  const points: Array<[number, number]> = [];
  const steps = 88;
  for (let step = 0; step <= steps; step += 1) {
    const p = step / steps;
    const theta = p * turns * Math.PI * 2 + phase;
    const y = top + (bottom - top) * p;
    const depthScale = 0.82 + Math.cos(theta) * 0.13;
    const x = cx + Math.sin(theta) * radius * depthScale + (p - 0.5) * lean;
    points.push([x, y]);
  }
  return pointsToPath(points);
}

function horizontalWavePath(left: number, right: number, cy: number, amplitude: number, waves: number, phase: number): string {
  const points: Array<[number, number]> = [];
  const steps = 72;
  for (let step = 0; step <= steps; step += 1) {
    const p = step / steps;
    const x = left + (right - left) * p;
    const y = cy + Math.sin(p * waves * Math.PI * 2 + phase) * amplitude;
    points.push([x, y]);
  }
  return pointsToPath(points);
}

function spiralInPath(cx: number, cy: number, maxRadius: number, phase: number): string {
  const points: Array<[number, number]> = [];
  const steps = 84;
  for (let step = 0; step <= steps; step += 1) {
    const p = step / steps;
    const theta = p * Math.PI * 5.2 + phase;
    const radius = maxRadius * (1 - p * 0.72);
    points.push([cx + Math.cos(theta) * radius, cy + Math.sin(theta) * radius * 1.35]);
  }
  return pointsToPath(points);
}

function parametricRibbonPaths(input: {
  atom: MotionAtomLike;
  width: number;
  height: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  progress: number;
  layer: "back" | "front";
}): string[] {
  const { atom, width, height, cx, cy, rx, ry, progress, layer } = input;
  const pathFamily = legacyPathFamily(atom);
  if (pathFamily === "vertical_helix") {
    const turns = atom.turns ?? 1.25;
    const radius = atom.radiusX ?? width * 0.31;
    const top = height * 0.13;
    const bottom = height * 0.84;
    const phase = progress * 0.9 + (layer === "front" ? 0 : Math.PI);
    return [
      verticalHelixPath(cx, top, bottom, radius, turns, phase, width * 0.08),
      verticalHelixPath(cx, top + height * 0.018, bottom - height * 0.012, radius * 0.9, turns, phase + Math.PI, -width * 0.05),
      verticalHelixPath(cx, top + height * 0.045, bottom - height * 0.04, radius * 0.58, turns * 0.86, phase + Math.PI * 0.5, 0)
    ];
  }
  if (pathFamily === "horizontal_wave" || pathFamily === "wave_loop") {
    const waves = pathFamily === "wave_loop" ? 2.4 : 1.55;
    return [
      horizontalWavePath(width * -0.06, width * 1.06, cy, ry * 0.86, waves, progress * 1.25),
      horizontalWavePath(width * -0.08, width * 1.08, cy + ry * 0.46, ry * 0.58, waves + 0.45, progress * 1.05 + Math.PI),
      horizontalWavePath(width * -0.04, width * 1.04, cy - ry * 0.52, ry * 0.48, waves + 0.25, progress * 0.9 + Math.PI * 0.35)
    ];
  }
  if (pathFamily === "spiral_in") {
    return [
      spiralInPath(cx, cy, Math.min(width, height) * 0.45, progress * 1.2),
      spiralInPath(cx, cy, Math.min(width, height) * 0.34, progress * 1.2 + Math.PI),
      spiralInPath(cx, cy, Math.min(width, height) * 0.24, progress * 1.2 + Math.PI * 0.45)
    ];
  }
  if (pathFamily === "diagonal_sweep") {
    return [
      `M ${cx - rx * 0.88} ${cy + ry * 1.02} C ${cx - rx * 0.36} ${cy - ry * 1.66}, ${cx + rx * 0.24} ${cy - ry * 1.14}, ${cx + rx * 0.92} ${cy + ry * 0.88}`,
      `M ${cx - rx * 0.98} ${cy - ry * 0.48} C ${cx - rx * 0.24} ${cy + ry * 1.7}, ${cx + rx * 0.36} ${cy + ry * 1.15}, ${cx + rx * 1.02} ${cy - ry * 0.78}`,
      `M ${cx - rx * 0.82} ${cy + ry * 0.2} C ${cx - rx * 0.12} ${cy - ry * 0.85}, ${cx + rx * 0.42} ${cy + ry * 0.86}, ${cx + rx * 0.88} ${cy - ry * 0.16}`
    ];
  }
  return [
    `M ${cx - rx} ${cy - ry * 0.1} C ${cx - rx * 0.58} ${cy - ry * 1.55}, ${cx + rx * 0.55} ${cy - ry * 1.38}, ${cx + rx} ${cy + ry * 0.02} C ${cx + rx * 0.5} ${cy + ry * 1.42}, ${cx - rx * 0.5} ${cy + ry * 1.45}, ${cx - rx} ${cy - ry * 0.1}`,
    `M ${cx - rx * 0.92} ${cy + ry * 0.52} C ${cx - rx * 0.18} ${cy - ry * 1.12}, ${cx + rx * 0.22} ${cy + ry * 1.35}, ${cx + rx * 0.98} ${cy - ry * 0.42}`,
    `M ${cx - rx * 1.05} ${cy - ry * 0.44} C ${cx - rx * 0.38} ${cy + ry * 1.24}, ${cx + rx * 0.46} ${cy - ry * 1.18}, ${cx + rx * 1.04} ${cy + ry * 0.52}`
  ];
}

const RibbonSurface3DLayer: React.FC<{ atom: MotionAtomLike; clipStartSec: number; layer: "back" | "front" }> = ({ atom, clipStartSec, layer }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const globalSec = clipStartSec + frame / fps;
  if (globalSec < atom.startSec || globalSec > atom.endSec) return null;

  const pathFamily = legacyPathFamily(atom);
  const mesh = isMeshRibbonAtom(atom);
  const thin = atom.surfaceType === "thin_line";
  const verticalHelix = pathFamily === "vertical_helix";
  const clean = atom.style === "clean_premium";
  const colors = atom.gradientStops?.length
    ? atom.gradientStops
    : atom.colorProgression.length
      ? atom.colorProgression
      : ["#2563eb", "#7c3aed", "#ec4899", "#f97316", "#eab308", "#22c55e"];
  const cx = width / 2;
  const cy = height * (verticalHelix ? 0.48 : mesh ? 0.43 : clean ? 0.44 : 0.46);
  const rx = atom.radiusX ?? width * (verticalHelix ? 0.32 : mesh ? 0.76 : clean ? 0.52 : 0.62);
  const ry = height * (verticalHelix ? 0.34 : mesh ? 0.22 : clean ? 0.16 : 0.23);
  const bandWidth = atom.bandWidth ?? (thin ? 8 : mesh ? 122 : clean ? 54 : 86);
  const edgeWidth = atom.edgeWidth ?? (thin ? 2 : Math.max(8, bandWidth * 0.16));
  const count = Math.max(1, Math.min(5, Math.round(layer === "front" ? atom.frontLayerCount ?? 2 : atom.backLayerCount ?? 2)));
  const speed = atom.speed * (layer === "front" ? 1.05 : 0.85);
  const baseOpacity = Math.max(0.12, Math.min(0.95, atom.opacity * (layer === "front" ? 0.86 : 0.7)));
  const twist = atom.twistIntensity ?? (clean ? 0.28 : 0.58);
  const perspective = atom.perspectiveStrength ?? (clean ? 0.22 : 0.48);
  const shadowOpacity = atom.shadowOpacity ?? (clean ? 0.18 : 0.42);
  const holdStartSec = Math.max(atom.startSec, atom.endSec - 1.35);
  const motionSec = mesh && globalSec > holdStartSec ? holdStartSec + (globalSec - holdStartSec) * 0.12 : globalSec;
  const progress = motionSec * speed;
  const progressRatio = Math.min(1, Math.max(0, (globalSec - atom.startSec) / Math.max(1, atom.endSec - atom.startSec)));
  const climax = atom.climaxBuild ? (mesh ? 0.22 + progressRatio * 0.78 : Math.min(1, Math.max(0.72, globalSec / Math.max(1, atom.endSec - atom.startSec)))) : 1;
  const paths = parametricRibbonPaths({ atom, width, height, cx, cy, rx, ry, progress, layer });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          {Array.from({ length: count }).map((_, index) => (
            <linearGradient key={`grad-${index}`} id={`surfaceGrad-${atom.style}-${layer}-${index}`} x1="8%" y1="22%" x2="92%" y2="78%">
              {colors.map((color, colorIndex) => (
                <stop
                  key={`${color}-${colorIndex}`}
                  offset={`${Math.round((colorIndex / Math.max(1, colors.length - 1)) * 100)}%`}
                  stopColor={color}
                />
              ))}
            </linearGradient>
          ))}
          <filter id={`surfaceShadow-${atom.style}-${layer}`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx={layer === "front" ? 0 : 8} dy={layer === "front" ? 10 : 18} stdDeviation={clean ? 7 : 12} floodColor="#020617" floodOpacity={shadowOpacity} />
          </filter>
        </defs>
        {Array.from({ length: count }).map((_, index) => {
          const path = paths[index % paths.length];
          const pathId = `surfacePath-${atom.style}-${layer}-${index}`;
          const rotation = verticalHelix
            ? Math.sin(progress * 0.7 + index) * 2.4 + (layer === "front" ? -1.2 : 1.2)
            : pathFamily === "planar_orbit"
              ? progress * (layer === "front" ? 14 : -9) + index * 24 + (layer === "front" ? 6 : -8)
              : mesh
                ? progress * (layer === "front" ? 5.4 : -4.2) + index * 8 + (layer === "front" ? -7 : 4)
                : progress * (layer === "front" ? 16 : -10) + index * 27 + (layer === "front" ? 8 : -11);
          const translateY = verticalHelix ? Math.sin(progress * 0.9 + index) * 6 : Math.sin(progress * 1.5 + index * 0.7) * (mesh ? 20 : clean ? 12 : 34);
          const scaleX = 1 + Math.sin(progress * 1.1 + index) * perspective * (verticalHelix ? 0.045 : mesh ? 0.12 : 0.16);
          const scaleY = (verticalHelix ? 1 : mesh ? 0.98 : 0.9) + Math.cos(progress * 1.25 + index) * perspective * (verticalHelix ? 0.035 : mesh ? 0.1 : 0.14);
          const skew = Math.sin(progress * 1.7 + index) * twist * (verticalHelix ? 2.2 : mesh ? (layer === "front" ? 5 : 3) : layer === "front" ? 8 : 5);
          const dash = verticalHelix ? 1450 : mesh ? 980 : clean ? 720 : 620;
          const gap = verticalHelix ? 70 : mesh ? 130 : clean ? 260 : 190;
          const dashOffset = -motionSec * (verticalHelix ? 42 : mesh ? 68 : clean ? 82 : 128) * speed - index * (verticalHelix ? 62 : mesh ? 80 : 190);
          const surfaceOpacity = baseOpacity * climax * (1 - index * 0.08);
          return (
            <g
              key={`${layer}-${index}`}
              style={{
                transform: `translate(${cx}px, ${cy + translateY}px) rotate(${rotation}deg) skewX(${skew}deg) scale(${scaleX}, ${scaleY}) translate(${-cx}px, ${-cy}px)`,
                transformOrigin: `${cx}px ${cy}px`
              }}
            >
              <path id={pathId} d={path} fill="none" stroke="transparent" strokeWidth={1} />
              <path
                d={path}
                fill="none"
                stroke="#111827"
                strokeWidth={bandWidth + edgeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={dashOffset}
                opacity={surfaceOpacity * 0.7}
                filter={`url(#surfaceShadow-${atom.style}-${layer})`}
              />
              <path
                d={path}
                fill="none"
                stroke={`url(#surfaceGrad-${atom.style}-${layer}-${index})`}
                strokeWidth={bandWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={dashOffset}
                opacity={surfaceOpacity}
              />
              {atom.specularHighlight ? (
                <path
                  d={path}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={Math.max(4, bandWidth * 0.18)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={`${dash * 0.34} ${gap * 2.2}`}
                  strokeDashoffset={dashOffset - 80}
                  opacity={clean ? 0.22 : 0.34}
                />
              ) : null}
              {atom.textOnRibbon && atom.textRelation !== "none" && layer === "front" ? (
                <text
                  fill="#f8fafc"
                  fontSize={clean ? 15 : 18}
                  fontWeight={800}
                  letterSpacing={0}
                  opacity={clean ? 0.7 : 0.9}
                  style={{ textShadow: "0 2px 8px rgba(0,0,0,0.45)" }}
                >
                  <textPath href={`#${pathId}`} startOffset={`${(globalSec * 18 * speed + index * 28) % 100}%`}>
                    {`${atom.keywords.join("   ")}   ${atom.keywords.join("   ")}`}
                  </textPath>
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

function layerPlaceholderSpec(layer: NonNullable<TimelineClipLike["layers"]>[number] | undefined, clip: TimelineClipLike): PlaceholderSpecLike | undefined {
  const fromLayer = layer?.style?.placeholderSpec;
  if (fromLayer && typeof fromLayer === "object") return fromLayer as PlaceholderSpecLike;
  return clip.placeholderSpec;
}

const ReplacementVisualLayer: React.FC<{
  clip: TimelineClipLike;
  assetMap?: ReconstructionProps["assetMap"];
}> = ({ clip, assetMap }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const replacementLayer = clip.layers?.find(
    (layer) =>
      layer.style?.fillStrategy === "user_asset_replace" ||
      layer.style?.fillStrategy === "proxy_placeholder" ||
      layer.style?.replacementSlotId === clip.replacementSlotId
  );
  const placeholder = layerPlaceholderSpec(replacementLayer, clip);
  const assetId = replacementLayer?.assetId ?? clip.sourceAssetId;
  const asset = assetId ? assetMap?.[assetId] : undefined;
  const motionSpec = (replacementLayer?.timing?.motionSpec ?? placeholder?.motion ?? {}) as Record<string, unknown>;
  const speed = Number(motionSpec.speed ?? 0.8);
  const rotate = Number.isFinite(speed) ? (frame / fps) * speed * 92 : 0;
  const bob = Math.sin((frame / fps) * 2.4) * 14;
  const isVideo = asset?.ext ? [".mp4", ".mov", ".webm", ".m4v"].includes(asset.ext) : clip.type === "video";
  const visualWidth = Math.min(width * 0.48, 360);
  const visualHeight = Math.min(height * 0.26, 330);
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "47%",
    width: visualWidth,
    height: visualHeight,
    transform: `translate(-50%, -50%) translateY(${bob}px) rotateY(${rotate}deg) scale(${1 + Math.sin(frame / 18) * 0.025})`,
    transformStyle: "preserve-3d",
    objectFit: "contain",
    filter: "drop-shadow(0 18px 30px rgba(15,23,42,0.28))",
    zIndex: 5
  };

  if (asset?.src && clip.gapFillStrategy === "user_asset_replace") {
    return (
      <>
        {isVideo ? (
          <Video muted loop src={asset.src} style={baseStyle} />
        ) : (
          <Img src={asset.src} style={baseStyle} />
        )}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "64%",
            transform: "translateX(-50%)",
            background: "rgba(16,185,129,0.9)",
            color: "white",
            borderRadius: 999,
            padding: "8px 14px",
            fontSize: 18,
            fontWeight: 900,
            zIndex: 6
          }}
        >
          USER REPLACED · motion preserved
        </div>
      </>
    );
  }

  if (clip.gapFillStrategy !== "proxy_placeholder") return null;
  const color = placeholder?.color ?? "#E53935";
  const label = placeholder?.label ?? "Replaceable proxy";
  const shape = placeholder?.shape ?? "sphere";
  const sphere = shape === "sphere" || shape === "circle";
  return (
    <>
      <div
        style={{
          ...baseStyle,
          width: sphere ? Math.min(width * 0.38, 280) : visualWidth,
          height: sphere ? Math.min(width * 0.38, 280) : visualHeight,
          borderRadius: sphere ? "50%" : 28,
          background: sphere
            ? `radial-gradient(circle at 34% 28%, #fff 0%, ${color} 24%, #7f1d1d 76%, #320b0b 100%)`
            : `linear-gradient(135deg, ${color}, #64748b)`,
          border: "6px solid rgba(255,255,255,0.55)",
          boxShadow: "inset -34px -26px 48px rgba(0,0,0,0.25), 0 22px 48px rgba(0,0,0,0.28)",
          display: "grid",
          placeItems: "center",
          color: "white",
          textAlign: "center",
          padding: 26,
          fontWeight: 900,
          fontSize: 22,
          lineHeight: 1.1,
          zIndex: 5
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "64%",
          transform: "translateX(-50%)",
          background: "rgba(249,115,22,0.94)",
          color: "white",
          borderRadius: 999,
          padding: "8px 14px",
          fontSize: 18,
          fontWeight: 900,
          zIndex: 6
        }}
      >
        Missing slot · click to replace
      </div>
    </>
  );
};

const HeadlineCard: React.FC<{ clip: TimelineClipLike; timeline: TimelineLike; assetMap?: ReconstructionProps["assetMap"] }> = ({ clip, timeline, assetMap }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const creativeMode = String(timeline.renderPlan?.adapterOptions?.creativeMode ?? "explainable_demo");
  const showDebug = creativeMode === "explainable_demo";
  const highFidelity = creativeMode === "high_fidelity_style";
  const colors = foregroundFor(timeline);
  const ribbonAtoms = ribbonAtomsFor(timeline);
  const surfaceRibbonAtoms = ribbonAtoms.filter(isSurfaceRibbonAtom);
  const orbitRibbonAtoms = ribbonAtoms.filter((atom) => !isSurfaceRibbonAtom(atom));
  const hasRibbon = ribbonAtoms.length > 0;
  const primaryAtom = ribbonAtoms[0];
  const clean = primaryAtom?.style === "clean_premium";
  const enter = Math.min(1, frame / (fps * 0.4));
  const translateY = (1 - enter) * 80;
  const opacity = enter;
  const headlineSize = Math.round(Math.min(width, height) * (highFidelity ? 0.112 : hasRibbon ? 0.076 : 0.07));
  const subSize = Math.round(Math.min(width, height) * (hasRibbon ? 0.032 : 0.04));
  const eyebrowSize = Math.round(Math.min(width, height) * 0.024);
  const mainTitle = highFidelity ? "爆款结构迁移引擎" : hasRibbon ? (clip.role === "cta" ? "Upload. Analyze. Remix." : "爆款结构迁移引擎") : mainTitleFor(clip);
  const support = supportingLineFor(clip, hasRibbon);
  const bottom = bottomLineFor(clip, hasRibbon);
  const posterKeywordStack = ["VIRAL", "STRUCTURE", "TRANSFER", "ENGINE"];
  const posterPhases = ["Sample Analysis", "Material Gap", "Video Recomposition"];
  return (
    <AbsoluteFill
      style={{
        background: clipBackground(clip.role, timeline),
        color: colors.text,
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif'
      }}
    >
      {surfaceRibbonAtoms.map((atom) => (
        <RibbonSurface3DLayer key={`${atom.type}-${atom.style}-back`} atom={atom} clipStartSec={clip.startSec} layer="back" />
      ))}
      {orbitRibbonAtoms.map((atom) => (
        <RibbonOrbitLayer key={`${atom.type}-${atom.style}`} atom={atom} clipStartSec={clip.startSec} />
      ))}
      <ReplacementVisualLayer clip={clip} assetMap={assetMap} />
      <div
        style={{
          position: "absolute",
          top: highFidelity ? 76 : 80,
          left: highFidelity ? 54 : 64,
          fontSize: eyebrowSize,
          letterSpacing: 0,
          color: colors.accent,
          textTransform: "uppercase",
          opacity
        }}
      >
        {showDebug && clip.phaseLabel ? clip.phaseLabel : hasRibbon ? "AI FULL-STACK CHALLENGE 2026" : clip.role}
      </div>
      {showDebug && clip.phaseSubtitle ? (
        <div
          style={{
            position: "absolute",
            top: 112,
            left: 64,
            right: 64,
            fontSize: eyebrowSize + 4,
            fontWeight: 600,
            color: colors.muted,
            letterSpacing: 0,
            opacity
          }}
        >
          {clip.phaseSubtitle}
        </div>
      ) : null}
      {showDebug && clip.mappingPairs && clip.mappingPairs.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 60,
            right: 60,
            bottom: 200,
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            rowGap: 10,
            columnGap: 12,
            alignItems: "center",
            color: colors.muted,
            fontSize: Math.round(Math.min(width, height) * 0.025),
            fontWeight: 600,
            background: clean ? "rgba(255,255,255,0.78)" : "rgba(15,23,42,0.55)",
            padding: "16px 18px",
            borderRadius: 16,
            opacity
          }}
        >
          <div style={{ textAlign: "right", fontWeight: 700, color: colors.accent }}>Sample 样例</div>
          <div />
          <div style={{ fontWeight: 700, color: colors.accent }}>New 重构</div>
          {clip.mappingPairs.slice(0, 4).map((pair, idx) => (
            <React.Fragment key={idx}>
              <div style={{ textAlign: "right" }}>{pair.sample}</div>
              <div style={{ textAlign: "center", opacity: 0.7 }}>{pair.arrow ?? "→"}</div>
              <div>{pair.target}</div>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      {highFidelity ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 136,
              left: 54,
              width: 148,
              color: "#111827",
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.04,
              textTransform: "uppercase",
              opacity: 0.86
            }}
          >
            {posterKeywordStack.map((word) => (
              <div key={word}>{word}</div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              top: 74,
              right: 56,
              textAlign: "right",
              color: "#111827",
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1.3,
              opacity: 0.74
            }}
          >
            <div>05.25</div>
            <div>STRUCTURE LAB</div>
          </div>
          <div
            style={{
              position: "absolute",
              left: 56,
              bottom: 70,
              color: "#111827",
              fontSize: 18,
              fontWeight: 700,
              lineHeight: 1.55,
              opacity: 0.72
            }}
          >
            <div>2026</div>
            {posterPhases.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
          <div
            style={{
              position: "absolute",
              right: 56,
              bottom: 72,
              color: "#111827",
              fontSize: 18,
              fontWeight: 800,
              textAlign: "right",
              opacity: 0.8
            }}
          >
            Upload. Analyze. Remix.
          </div>
        </>
      ) : null}
      <div
        style={{
          position: "absolute",
          top: highFidelity ? "34%" : hasRibbon ? "30%" : "38%",
          left: highFidelity ? 86 : hasRibbon ? 72 : 64,
          right: highFidelity ? 86 : hasRibbon ? 72 : 64,
          fontSize: headlineSize,
          fontWeight: highFidelity ? 900 : 800,
          lineHeight: highFidelity ? 0.96 : 1.08,
          textAlign: hasRibbon ? "center" : "left",
          color: highFidelity ? "#101113" : colors.text,
          textShadow: highFidelity ? "0 7px 20px rgba(91, 66, 34, 0.12)" : hasRibbon && !clean ? "0 10px 34px rgba(0,0,0,0.72)" : colors.shadow,
          transform: `translateY(${translateY}px)`,
          opacity
        }}
      >
        {mainTitle}
      </div>
      <div
        style={{
          position: "absolute",
          top: highFidelity ? "50%" : hasRibbon ? "43%" : undefined,
          bottom: hasRibbon ? undefined : 80,
          left: 64,
          right: 64,
          fontSize: highFidelity ? 28 : subSize,
          fontWeight: hasRibbon ? 700 : 500,
          padding: hasRibbon ? 0 : "12px 24px",
          background: hasRibbon ? "transparent" : colors.box,
          borderRadius: hasRibbon ? 0 : 18,
          color: highFidelity ? "#171717" : colors.muted,
          opacity,
          textAlign: hasRibbon ? "center" : "left"
        }}
      >
        {support}
      </div>
      {hasRibbon && !highFidelity ? (
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
      {surfaceRibbonAtoms.map((atom) => (
        <RibbonSurface3DLayer key={`${atom.type}-${atom.style}-front`} atom={atom} clipStartSec={clip.startSec} layer="front" />
      ))}
    </AbsoluteFill>
  );
};

export const ReconstructionRoot: React.FC<ReconstructionProps> = ({ timeline, assetMap }) => {
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
            <HeadlineCard clip={clip} timeline={safeTimeline} assetMap={assetMap} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
