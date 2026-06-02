import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { getBuiltInFallbackForMotif, getRuntimeEffectComponent } from "./effects/effectRuntimeRegistry";
import type { CreativeEffectRuntimeProps } from "./effects/types";

type AssetMap = Record<string, { src: string; ext?: string; type?: string }>;

type BBox = { x: number; y: number; w: number; h: number };
type RecipeLayer = {
  id: string;
  type: "media" | "text" | "motion_atom" | "audio" | "shape" | "transition";
  clipId?: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  material?: { assetIds?: string[]; kind?: string; policy?: string };
  layout?: { bboxNorm?: BBox; fit?: string; align?: "left" | "center" | "right"; minAreaRatio?: number; safeArea?: string };
  text?: { content?: string; role?: string };
  typography?: {
    fontSizeRatio?: number;
    color?: string;
    colorRole?: string;
    weight?: number;
    stroke?: { color?: string; widthRatio?: number };
    shadow?: { color?: string; blurRatio?: number; dxRatio?: number; dyRatio?: number };
    background?: { color?: string; radiusRatio?: number; paddingRatio?: number };
  };
  animation?: { enter?: string; exit?: string; beatReactive?: { amplitude?: number; beatRefs?: number[] } };
  atom?: { kind?: string; direction?: string; thicknessRatio?: number; opacity?: number; colorRoles?: string[]; path?: string; twist?: number; widthRatio?: number; softnessRatio?: number; intensity?: number; beatRefs?: number[] };
};
type RecipeClip = {
  clipId: string;
  id?: string;
  role: string;
  startSec: number;
  endSec: number;
  selectedPrimitive: string;
  visualFormFamily?: string;
  material?: { assetIds?: string[]; kind?: string };
  text?: { copy?: string; colorRoles?: string[]; animationHint?: string; fontSizeRatio?: number };
  motion?: { beatTimestampsSec?: number[]; pattern?: string };
  layout?: { bboxNorm?: BBox; typographyLayout?: string };
};
type Recipe = {
  global?: { palette?: string[]; fps?: number; durationSec?: number };
  composition?: { width?: number; height?: number; fps?: number; durationSec?: number };
  productTheme?: { name?: string; productName?: string; brandName?: string; cta?: string; ctaText?: string; generationPrompt?: string; rawPrompt?: string };
  clips?: RecipeClip[];
  layers?: RecipeLayer[];
  // v1.4 optional creative-effect selection (backward-compatible; old recipes omit these).
  creativeEffectSpecId?: string;
  motifFamily?: string;
  effectProgramIds?: string[];
  effectPropsById?: Record<string, CreativeEffectRuntimeProps>;
  effectFallbackReason?: string;
};
export type ViralRecipeProps = {
  timeline?: { durationSec?: number; aspectRatio?: string; renderPlan?: { renderRecipe?: Recipe; fps?: number } };
  assetMap?: AssetMap;
};

const RED = "#e11d2a";
const YELLOW = "#f5c518";
const WHITE = "#f5f5f5";
const TEAL = "#22d3ee";
const BG = "#05060a";
const PROMPT_TOKENS = ["15 秒", "15秒", "高转化", "CTA", "prompt", "生成", "换成", "版本", "镜头", "素材", "文案：", "要求："];

function colorFor(roles?: string[]): string {
  const r = (roles ?? []).join(" ").toLowerCase();
  if (r.includes("red") || r.includes("primary")) return RED;
  if (r.includes("yellow") || r.includes("accent")) return YELLOW;
  if (r.includes("teal") || r.includes("cyan")) return TEAL;
  return WHITE;
}

function safeText(value?: string, fallback = ""): string {
  const raw = (value ?? "").replace(/^(?:主题|产品|商品|CTA)[:：]\s*/i, "").trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  const badIndex = PROMPT_TOKENS.map((token) => lower.indexOf(token.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const clipped = (badIndex !== undefined ? raw.slice(0, badIndex) : raw).split(/[。！？\n]/)[0].trim();
  return Array.from(clipped || fallback).slice(0, 24).join("");
}

function assetFor(assetMap: AssetMap, assetIds?: string[]): { src?: string; ext?: string } {
  const id = assetIds?.find((assetId) => assetMap[assetId]?.src);
  return id ? assetMap[id] : {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function boxWithMinArea(box: BBox | undefined, minAreaRatio?: number): BBox | undefined {
  if (!box || !minAreaRatio) return box;
  const area = box.w * box.h;
  if (area >= minAreaRatio || area <= 0) return box;
  const scale = Math.sqrt(minAreaRatio / area);
  const w = Math.min(0.92, box.w * scale);
  const h = Math.min(0.92, box.h * scale);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

function textUnits(text: string): number {
  return Array.from(text).reduce((sum, ch) => {
    if (/[\u4e00-\u9fff]/.test(ch)) return sum + 1;
    if (/\s/.test(ch)) return sum + 0.32;
    if (/[A-Z0-9]/.test(ch)) return sum + 0.68;
    return sum + 0.55;
  }, 0);
}

function fitFontToBox(copy: string, desired: number, box: BBox, width: number, height: number): number {
  const boxW = Math.max(24, box.w * width);
  const boxH = Math.max(24, box.h * height);
  const fitW = boxW / Math.max(1, textUnits(copy) * 0.72);
  const fitH = boxH * 0.68;
  return Math.max(14, Math.min(desired, fitW, fitH));
}

function layerBoxStyle(box: BBox | undefined): React.CSSProperties {
  if (!box) return { position: "absolute", inset: 0 };
  return {
    position: "absolute",
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`
  };
}

const MissingMedia: React.FC<{ label?: string }> = ({ label }) => (
  <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center" }}>
    <div style={{ color: YELLOW, fontSize: 34, fontWeight: 800, fontFamily: "sans-serif", textAlign: "center", padding: 24 }}>
      {label ?? "Media asset did not resolve"}
    </div>
  </AbsoluteFill>
);

const MediaSurface: React.FC<{ src?: string; ext?: string; fit?: string; style?: React.CSSProperties }> = ({ src, ext, fit, style }) => {
  const objectFit = fit === "contain" || fit === "cardInset" ? "contain" : "cover";
  if (!src) return <MissingMedia />;
  if (/\.(mp4|mov|webm|m4v)$/i.test(ext ?? src)) {
    // OffthreadVideo (not <Video>) so headless-Chrome rendering extracts frames via ffmpeg instead
    // of hanging on <Video> duration loading for local file:// sources (delayRender timeout).
    return <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit, ...style }} />;
  }
  return <Img src={src} style={{ width: "100%", height: "100%", objectFit, ...style }} />;
};

const BeatBars: React.FC<{ beats: number[]; clipStartSec: number }> = ({ beats, clipStartSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = clipStartSec + frame / fps;
  const nearBeat = beats.some((b) => Math.abs(b - frame / fps) < 0.08);
  return (
    <div style={{ position: "absolute", bottom: 36, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, opacity: 0.9 }}>
      {Array.from({ length: 13 }).map((_, i) => {
        const h = 20 + Math.abs(Math.sin(t * 6 + i)) * (nearBeat ? 80 : 46);
        return <div key={i} style={{ width: 10, height: h, background: i % 2 ? YELLOW : TEAL, borderRadius: 3 }} />;
      })}
    </div>
  );
};

const HeroSpin: React.FC<{ src?: string; ext?: string }> = ({ src, ext }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = 1 + Math.sin((frame / fps) * 3) * 0.04;
  const rot = (frame / fps) * 8;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, #0b3b3f 0%, ${BG} 60%)`, justifyContent: "center", alignItems: "center" }}>
      <MediaSurface src={src} ext={ext} fit="contain" style={{ width: "80%", maxHeight: "78%", transform: `scale(${scale}) rotate(${rot}deg)`, filter: "drop-shadow(0 0 40px rgba(34,211,238,0.5))" }} />
    </AbsoluteFill>
  );
};

const SourceMontage: React.FC<{ src?: string; ext?: string }> = ({ src, ext }) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 60], [1.0, 1.12], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: BG }}>
      <MediaSurface src={src} ext={ext} fit="cover" style={{ transform: `scale(${zoom})` }} />
      <div style={{ position: "absolute", top: "20%", left: 0, right: 0, height: 6, background: RED }} />
    </AbsoluteFill>
  );
};

const Typography: React.FC<{
  copy?: string;
  color: string;
  bbox?: BBox;
  fontSizeRatio?: number;
  animation?: string;
  align?: "left" | "center" | "right";
  typography?: RecipeLayer["typography"];
}> = ({ copy, color, bbox, fontSizeRatio, animation, align = "center", typography }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const box = bbox ?? { x: 0.1, y: 0.4, w: 0.8, h: 0.16 };
  const rawCopy = copy ?? "";
  const desiredFont = Math.max(14, Math.min(96, height * (fontSizeRatio ?? Math.min(0.11, box.h * 0.7))));
  const baseFont = fitFontToBox(rawCopy, desiredFont, box, width, height);
  const s = animation === "none" || animation === "typewriter" ? 1 : interpolate(frame, [0, 10], [0.82, 1], { extrapolateRight: "clamp" });
  const xOffset = animation === "slide_left"
    ? interpolate(frame, [0, 12], [-width * box.w, 0], { extrapolateRight: "clamp" })
    : animation === "slide_right"
      ? interpolate(frame, [0, 12], [width * box.w, 0], { extrapolateRight: "clamp" })
      : animation === "sweep"
        ? Math.sin(frame / 8) * width * 0.015
        : 0;
  const opacity = animation === "fade" ? interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" }) : animation === "flash" ? 0.72 + Math.sin(frame * 0.8) * 0.28 : 1;
  const visibleCopy = animation === "typewriter"
    ? Array.from(rawCopy).slice(0, Math.max(1, Math.ceil((frame / 18) * Array.from(rawCopy).length))).join("")
    : rawCopy;
  const shadow = typography?.shadow;
  const stroke = typography?.stroke;
  const bg = typography?.background;
  return (
    <div
      style={{
        position: "absolute",
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        color,
        fontSize: baseFont,
        lineHeight: 1.08,
        fontWeight: typography?.weight ?? 900,
        textAlign: align,
        transform: `translateX(${xOffset}px) scale(${s})`,
        opacity,
        textShadow: shadow
          ? `${Math.round((shadow.dxRatio ?? 0.004) * width)}px ${Math.round((shadow.dyRatio ?? 0.004) * height)}px ${Math.round((shadow.blurRatio ?? 0.012) * height)}px ${shadow.color ?? "rgba(0,0,0,0.75)"}`
          : "0 4px 24px rgba(0,0,0,0.82)",
        WebkitTextStroke: stroke ? `${Math.max(1, Math.round((stroke.widthRatio ?? 0.002) * height))}px ${stroke.color ?? "rgba(0,0,0,0.65)"}` : undefined,
        fontFamily: "sans-serif",
        overflow: "hidden",
        whiteSpace: "normal",
        wordBreak: "break-word"
      }}
    >
      {bg ? <span style={{ background: bg.color ?? "rgba(0,0,0,0.45)", borderRadius: Math.round((bg.radiusRatio ?? 0.012) * height), padding: `${Math.round((bg.paddingRatio ?? 0.01) * height)}px` }}>{visibleCopy}</span> : visibleCopy}
    </div>
  );
};

const LegacyMediaText: React.FC<{ src?: string; ext?: string; copy?: string; color: string; bbox?: BBox; fontSizeRatio?: number }> = ({ src, ext, copy, color, bbox, fontSizeRatio }) => (
  <AbsoluteFill style={{ background: BG }}>
    <MediaSurface src={src} ext={ext} fit="cover" />
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,6,10,0.08), rgba(5,6,10,0.5))" }} />
    <Typography copy={copy} color={color} bbox={bbox} fontSizeRatio={fontSizeRatio} animation="scale" />
  </AbsoluteFill>
);

const ImpactFlash: React.FC = () => {
  const frame = useCurrentFrame();
  const flash = Math.max(0, 1 - (frame % 14) / 6);
  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: WHITE, opacity: flash * 0.8 }} />
      <div style={{ width: 240, height: 240, borderRadius: "50%", background: RED, opacity: 0.85, transform: `scale(${1 + flash})` }} />
    </AbsoluteFill>
  );
};

const ParametricRibbonSurface: React.FC<{ layer: RecipeLayer }> = ({ layer }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t = frame / 30;
  const colors = layer.atom?.colorRoles?.length ? layer.atom.colorRoles : ["#2563eb", "#7c3aed", "#ec4899", "#eab308", "#22c55e"];
  const thickness = Math.max(18, Math.round(width * (layer.atom?.thicknessRatio ?? 0.11)));
  const dir = layer.atom?.direction === "left_to_right" ? 1 : -1;
  const x = width * 0.5 + dir * Math.sin(t * 0.8) * width * 0.36;
  const y = height * 0.44 + Math.cos(t * 1.1) * height * 0.12;
  const path = layer.atom?.path ?? "diagonal_sweep";
  const primaryPath = path === "s_curve_orbit"
    ? `M ${x - width * 0.08} ${-height * 0.12} C ${x + width * 0.28} ${height * 0.18}, ${x - width * 0.28} ${height * 0.48}, ${x + width * 0.08} ${height * 1.12}`
    : path === "horizontal_wave"
      ? `M ${x - width * 0.7} ${y + height * 0.08} C ${x - width * 0.2} ${y - height * 0.28}, ${x + width * 0.2} ${y + height * 0.28}, ${x + width * 0.72} ${y - height * 0.08}`
      : `M ${x - width * 0.62} ${height * 0.2} C ${x - width * 0.08} ${height * 0.42}, ${x + width * 0.12} ${height * 0.58}, ${x + width * 0.62} ${height * 0.82}`;
  const highlightPath = path === "s_curve_orbit"
    ? `M ${x + width * 0.02} ${-height * 0.08} C ${x + width * 0.18} ${height * 0.22}, ${x - width * 0.2} ${height * 0.52}, ${x + width * 0.16} ${height * 1.05}`
    : path === "horizontal_wave"
      ? `M ${x - width * 0.6} ${y - height * 0.02} C ${x - width * 0.18} ${y + height * 0.2}, ${x + width * 0.18} ${y - height * 0.2}, ${x + width * 0.62} ${y + height * 0.02}`
      : `M ${x - width * 0.5} ${height * 0.25} C ${x - width * 0.05} ${height * 0.45}, ${x + width * 0.14} ${height * 0.58}, ${x + width * 0.5} ${height * 0.76}`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: layer.atom?.opacity ?? 0.62 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id={`grad_${layer.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            {colors.map((c, i) => <stop key={c + i} offset={`${(i / Math.max(1, colors.length - 1)) * 100}%`} stopColor={c} />)}
          </linearGradient>
        </defs>
        <path
          d={primaryPath}
          fill="none"
          stroke={`url(#grad_${layer.id})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 24px 28px rgba(0,0,0,0.28))" }}
        />
        <path
          d={highlightPath}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={Math.max(4, thickness * 0.16)}
          strokeLinecap="round"
        />
      </svg>
    </AbsoluteFill>
  );
};

const MotionAtomFallback: React.FC<{ layer: RecipeLayer }> = ({ layer }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (layer.atom?.kind === "impact_flash") {
    const intensity = layer.atom.intensity ?? 0.55;
    const opacity = Math.max(0, intensity * (1 - (frame % 16) / 12));
    return <AbsoluteFill style={{ pointerEvents: "none", background: WHITE, opacity }} />;
  }
  if (layer.atom?.kind === "light_sweep" || layer.atom?.kind === "text_sweep_mask") {
    const sweepX = interpolate(frame % 90, [0, 90], [-width * 0.35, width * 1.15]);
    return (
      <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: sweepX,
            width: width * (layer.atom.widthRatio ?? 0.22),
            transform: "skewX(-18deg)",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.62), transparent)",
            opacity: layer.atom.opacity ?? 0.45
          }}
        />
      </AbsoluteFill>
    );
  }
  return <div style={{ position: "absolute", top: height * 0.48, left: width * 0.1, right: width * 0.1, height: 8, background: TEAL, opacity: 0.35 }} />;
};

const CtaSlate: React.FC<{ logo?: string; ext?: string; cta?: string; brand?: string }> = ({ logo, ext, cta, brand }) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [0, 14], [0.8, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, #111827 0%, ${BG} 70%)`, justifyContent: "center", alignItems: "center", gap: 36 }}>
      {logo ? <div style={{ width: "44%", maxHeight: "34%", transform: `scale(${s})` }}><MediaSurface src={logo} ext={ext} fit="contain" /></div> : null}
      <div style={{ fontSize: 40, fontWeight: 800, color: WHITE, fontFamily: "sans-serif", textAlign: "center", maxWidth: "86%" }}>{safeText(brand)}</div>
      <div style={{ fontSize: 52, fontWeight: 900, color: YELLOW, background: "#7f1d1d", padding: "14px 30px", borderRadius: 14, fontFamily: "sans-serif", maxWidth: "88%", textAlign: "center" }}>{safeText(cta)}</div>
    </AbsoluteFill>
  );
};

const LayerView: React.FC<{ layer: RecipeLayer; assetMap: AssetMap }> = ({ layer, assetMap }) => {
  if (layer.type === "media") {
    const asset = assetFor(assetMap, layer.material?.assetIds);
    const bbox = boxWithMinArea(layer.layout?.bboxNorm, layer.layout?.minAreaRatio);
    return (
      <div style={layerBoxStyle(bbox)}>
        <MediaSurface src={asset.src} ext={asset.ext} fit={layer.layout?.fit} />
      </div>
    );
  }
  if (layer.type === "text") {
    return (
      <Typography
        copy={layer.text?.content}
        color={layer.typography?.color ?? colorFor([layer.typography?.colorRole ?? ""])}
        bbox={layer.layout?.bboxNorm}
        fontSizeRatio={layer.typography?.fontSizeRatio}
        animation={layer.animation?.enter}
        align={layer.layout?.align}
        typography={layer.typography}
      />
    );
  }
  if (layer.type === "motion_atom" && layer.atom?.kind === "parametric_ribbon_surface") return <ParametricRibbonSurface layer={layer} />;
  if (layer.type === "motion_atom") return <MotionAtomFallback layer={layer} />;
  return null;
};

const ClipView: React.FC<{ clip: RecipeClip; assetMap: AssetMap; recipe: Recipe }> = ({ clip, assetMap, recipe }) => {
  const asset = assetFor(assetMap, clip.material?.assetIds);
  const color = colorFor(clip.text?.colorRoles);
  const beats = clip.motion?.beatTimestampsSec ?? [];
  let body: React.ReactNode;
  switch (clip.selectedPrimitive) {
    case "FanHeroSpin":
    case "ProductHeroOrbit":
    case "ProductPosterHero":
    case "ObjectTrackReveal":
      body = <HeroSpin src={asset.src} ext={asset.ext} />;
      break;
    case "SourceClipBeatMontage":
    case "FeatureCardStack":
    case "MediaCardCascade":
    case "SplitScreenCompare":
      body = <SourceMontage src={asset.src} ext={asset.ext} />;
      break;
    case "ImpactFlash":
    case "LightLeakTransition":
      body = <ImpactFlash />;
      break;
    case "CTAEndSlate":
      body = (
        <CtaSlate
          logo={asset.src}
          ext={asset.ext}
          cta={recipe.productTheme?.ctaText ?? recipe.productTheme?.cta}
          brand={recipe.productTheme?.brandName ?? recipe.productTheme?.productName ?? recipe.productTheme?.name}
        />
      );
      break;
    case "TypographyLayoutSequence":
    case "KineticTypographySweep":
    case "PriceBadgePulse":
      body = asset.src
        ? <LegacyMediaText src={asset.src} ext={asset.ext} copy={clip.text?.copy} color={color} bbox={clip.layout?.bboxNorm} fontSizeRatio={clip.text?.fontSizeRatio} />
        : <AbsoluteFill style={{ background: BG }}><Typography copy={clip.text?.copy} color={color} bbox={clip.layout?.bboxNorm} fontSizeRatio={clip.text?.fontSizeRatio} animation={clip.text?.animationHint} /></AbsoluteFill>;
      break;
    case "ParametricRibbonSurface":
      body = (
        <AbsoluteFill style={{ background: BG }}>
          <ParametricRibbonSurface layer={{ id: `legacy_${clip.clipId}_ribbon`, type: "motion_atom", zIndex: 20, startSec: clip.startSec, durationSec: clip.endSec - clip.startSec, atom: { kind: "parametric_ribbon_surface", direction: "right_to_left", thicknessRatio: 0.11, opacity: 0.68, colorRoles: recipe.global?.palette ?? [TEAL, YELLOW], path: "s_curve_orbit", twist: 0.5 } }} />
          <Typography copy={clip.text?.copy} color={color} bbox={clip.layout?.bboxNorm} fontSizeRatio={clip.text?.fontSizeRatio} animation={clip.text?.animationHint} />
        </AbsoluteFill>
      );
      break;
    case "DynamicProxyMontage":
      body = <AbsoluteFill style={{ background: BG }}><Typography copy={clip.text?.copy} color={TEAL} bbox={clip.layout?.bboxNorm} fontSizeRatio={clip.text?.fontSizeRatio} /></AbsoluteFill>;
      break;
    default:
      body = <AbsoluteFill style={{ background: BG }}><Typography copy={clip.text?.copy} color={color} bbox={clip.layout?.bboxNorm} fontSizeRatio={clip.text?.fontSizeRatio} /></AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      {body}
      {beats.length ? <BeatBars beats={beats} clipStartSec={clip.startSec} /> : null}
    </AbsoluteFill>
  );
};

const DEBUG_EFFECT_LABEL =
  typeof process !== "undefined" && Boolean(process.env) && process.env.DEBUG_EFFECT_LABEL === "1";

function effectPropsForId(recipe: Recipe, id: string): CreativeEffectRuntimeProps {
  const existing = recipe.effectPropsById?.[id];
  if (existing && typeof existing === "object") return existing;
  // Defensive default if props were not attached (keeps the component renderable).
  const g = recipe.global ?? {};
  const c = recipe.composition ?? {};
  return {
    width: c.width ?? 720,
    height: c.height ?? 1280,
    fps: g.fps ?? c.fps ?? 30,
    durationSec: g.durationSec ?? c.durationSec ?? 15,
    colors: g.palette ?? [],
    texts: [],
    beats: []
  };
}

/**
 * Render the selected creative-effect program(s). Resolves each effectProgramId to a built-in
 * component; if an id is not found (e.g. a generated effect not yet in the runtime registry), falls
 * back to the built-in component for the recipe's motif family. The effects carry product text/CTA
 * via their props, so product messaging is not hidden.
 */
const EffectLayer: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const ids = recipe.effectProgramIds ?? [];
  if (!ids.length) return null;
  return (
    <>
      {ids.map((id, i) => {
        const Component = getRuntimeEffectComponent(id) ?? getBuiltInFallbackForMotif(recipe.motifFamily);
        if (!Component) return null;
        return (
          <AbsoluteFill key={`effect_${id}_${i}`}>
            <Component {...effectPropsForId(recipe, id)} />
          </AbsoluteFill>
        );
      })}
    </>
  );
};

const EffectDebugLabel: React.FC<{ name: string }> = ({ name }) => (
  <div
    style={{
      position: "absolute",
      top: 8,
      left: 8,
      zIndex: 9999,
      background: "rgba(0,0,0,0.7)",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: 18,
      padding: "4px 10px",
      borderRadius: 6
    }}
  >
    effect: {name}
  </div>
);

export const defaultRecipeProps: ViralRecipeProps = {
  timeline: { durationSec: 2, aspectRatio: "9:16", renderPlan: { fps: 30, renderRecipe: { clips: [] } } },
  assetMap: {}
};

export const ViralRecipeRoot: React.FC<ViralRecipeProps> = ({ timeline, assetMap }) => {
  const { fps } = useVideoConfig();
  const recipe = timeline?.renderPlan?.renderRecipe ?? { clips: [] };

  // v1.4: when a creative effect is selected, render its program(s). The effect components carry
  // product text/CTA via their props, so messaging is preserved. Old recipes (no effectProgramIds)
  // fall through to the existing layer/clip render path below — fully backward-compatible.
  const effectIds = recipe.effectProgramIds ?? [];
  if (effectIds.length) {
    return (
      <AbsoluteFill style={{ background: BG }}>
        <EffectLayer recipe={recipe} />
        {DEBUG_EFFECT_LABEL ? <EffectDebugLabel name={effectIds[0]} /> : null}
      </AbsoluteFill>
    );
  }

  const layers = recipe.layers ?? [];
  if (layers.length) {
    return (
      <AbsoluteFill style={{ background: BG }}>
        {layers
          .slice()
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((layer) => {
            const from = Math.round((layer.startSec ?? 0) * fps);
            const dur = Math.max(1, Math.round((layer.durationSec ?? 1) * fps));
            return (
              <Sequence key={layer.id} from={from} durationInFrames={dur}>
                <LayerView layer={layer} assetMap={assetMap ?? {}} />
              </Sequence>
            );
          })}
      </AbsoluteFill>
    );
  }

  const clips = recipe.clips ?? [];
  return (
    <AbsoluteFill style={{ background: BG }}>
      {clips.map((clip, i) => {
        const from = Math.round((clip.startSec ?? 0) * fps);
        const dur = Math.max(1, Math.round(((clip.endSec ?? clip.startSec + 1) - (clip.startSec ?? 0)) * fps));
        return (
          <Sequence key={clip.clipId ?? clip.id ?? i} from={from} durationInFrames={dur}>
            <ClipView clip={clip} assetMap={assetMap ?? {}} recipe={recipe} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
