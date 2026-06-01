import React from "react";
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * v1.3 RenderRecipe-driven Remotion composition. Consumes `timeline.renderPlan.renderRecipe` and the
 * resolved `assetMap` (assetId -> { src }) and renders each recipe clip by its `selectedPrimitive`.
 * Components read RenderRecipeClip props only — no re-inference. Sample frames never appear; only the
 * recipe's bound target/source assets (here, the real AIGC fan images via assetMap) reach the canvas.
 */

type AssetMap = Record<string, { src: string; ext?: string }>;
type RecipeClip = {
  clipId: string;
  role: string;
  startSec: number;
  endSec: number;
  selectedPrimitive: string;
  visualFormFamily?: string;
  material?: { assetIds?: string[]; kind?: string };
  text?: { copy?: string; colorRoles?: string[]; animationHint?: string };
  motion?: { beatTimestampsSec?: number[]; pattern?: string };
};
type Recipe = {
  global?: { palette?: string[]; fps?: number; durationSec?: number };
  productTheme?: { name?: string; cta?: string };
  clips?: RecipeClip[];
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

function colorFor(roles?: string[]): string {
  const r = (roles ?? []).join(" ").toLowerCase();
  if (r.includes("red")) return RED;
  if (r.includes("yellow")) return YELLOW;
  if (r.includes("teal") || r.includes("cyan")) return TEAL;
  return WHITE;
}

const BeatBars: React.FC<{ beats: number[]; clipStartSec: number }> = ({ beats, clipStartSec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = clipStartSec + frame / fps;
  const nearBeat = beats.some((b) => Math.abs(b - (frame / fps)) < 0.08);
  const bars = 13;
  return (
    <div style={{ position: "absolute", bottom: 36, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 6, opacity: 0.9 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h = 20 + Math.abs(Math.sin(t * 6 + i)) * (nearBeat ? 80 : 46);
        return <div key={i} style={{ width: 10, height: h, background: i % 2 ? YELLOW : TEAL, borderRadius: 3 }} />;
      })}
    </div>
  );
};

const HeroSpin: React.FC<{ src?: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = 1 + Math.sin((frame / fps) * 3) * 0.04;
  const rot = (frame / fps) * 8;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 42%, #0b3b3f 0%, ${BG} 60%)`, justifyContent: "center", alignItems: "center" }}>
      {src ? <Img src={src} style={{ width: "80%", maxHeight: "78%", objectFit: "contain", transform: `scale(${scale}) rotate(${rot}deg)`, filter: "drop-shadow(0 0 40px rgba(34,211,238,0.5))" }} /> : null}
    </AbsoluteFill>
  );
};

const SourceMontage: React.FC<{ src?: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 60], [1.0, 1.12], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: BG }}>
      {src ? <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }} /> : null}
      <div style={{ position: "absolute", top: "20%", left: 0, right: 0, height: 6, background: RED }} />
    </AbsoluteFill>
  );
};

const Typography: React.FC<{ copy?: string; color: string }> = ({ copy, color }) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [0, 10], [0.7, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: BG, justifyContent: "center", alignItems: "center", padding: 60 }}>
      <div style={{ position: "absolute", top: "30%", left: "12%", right: "12%", height: 6, background: RED }} />
      <div style={{ fontSize: 84, fontWeight: 900, color, textAlign: "center", transform: `scale(${s})`, textShadow: "0 4px 24px rgba(0,0,0,0.8)", fontFamily: "sans-serif" }}>{copy ?? ""}</div>
    </AbsoluteFill>
  );
};

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

const CtaSlate: React.FC<{ logo?: string; cta?: string; brand?: string }> = ({ logo, cta, brand }) => {
  const frame = useCurrentFrame();
  const s = interpolate(frame, [0, 14], [0.8, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, #111827 0%, ${BG} 70%)`, justifyContent: "center", alignItems: "center", gap: 36 }}>
      {logo ? <Img src={logo} style={{ width: "44%", maxHeight: "34%", objectFit: "contain", transform: `scale(${s})` }} /> : null}
      <div style={{ fontSize: 40, fontWeight: 800, color: WHITE, fontFamily: "sans-serif" }}>{brand ?? ""}</div>
      <div style={{ fontSize: 52, fontWeight: 900, color: YELLOW, background: "#7f1d1d", padding: "14px 30px", borderRadius: 14, fontFamily: "sans-serif" }}>{cta ?? ""}</div>
    </AbsoluteFill>
  );
};

const ClipView: React.FC<{ clip: RecipeClip; assetMap: AssetMap; recipe: Recipe }> = ({ clip, assetMap, recipe }) => {
  const assetId = clip.material?.assetIds?.[0];
  const src = assetId ? assetMap[assetId]?.src : undefined;
  const color = colorFor(clip.text?.colorRoles);
  const beats = clip.motion?.beatTimestampsSec ?? [];
  let body: React.ReactNode;
  switch (clip.selectedPrimitive) {
    case "FanHeroSpin":
    case "ProductHeroOrbit":
      body = <HeroSpin src={src} />;
      break;
    case "SourceClipBeatMontage":
    case "FeatureCardStack":
      body = <SourceMontage src={src} />;
      break;
    case "ImpactFlash":
      body = <ImpactFlash />;
      break;
    case "CTAEndSlate":
      body = <CtaSlate logo={src} cta={recipe.productTheme?.cta} brand={recipe.productTheme?.name} />;
      break;
    case "DynamicProxyMontage":
      body = <Typography copy={clip.text?.copy} color={TEAL} />;
      break;
    case "TypographyLayoutSequence":
    default:
      body = <Typography copy={clip.text?.copy} color={color} />;
  }
  return (
    <AbsoluteFill>
      {body}
      {beats.length ? <BeatBars beats={beats} clipStartSec={clip.startSec} /> : null}
    </AbsoluteFill>
  );
};

export const defaultRecipeProps: ViralRecipeProps = {
  timeline: { durationSec: 2, aspectRatio: "9:16", renderPlan: { fps: 30, renderRecipe: { clips: [] } } },
  assetMap: {}
};

export const ViralRecipeRoot: React.FC<ViralRecipeProps> = ({ timeline, assetMap }) => {
  const { fps } = useVideoConfig();
  const recipe = timeline?.renderPlan?.renderRecipe ?? { clips: [] };
  const clips = recipe.clips ?? [];
  return (
    <AbsoluteFill style={{ background: BG }}>
      {clips.map((clip, i) => {
        const from = Math.round((clip.startSec ?? 0) * fps);
        const dur = Math.max(1, Math.round(((clip.endSec ?? clip.startSec + 1) - (clip.startSec ?? 0)) * fps));
        return (
          <Sequence key={clip.clipId ?? i} from={from} durationInFrames={dur}>
            <ClipView clip={clip} assetMap={assetMap ?? {}} recipe={recipe} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
