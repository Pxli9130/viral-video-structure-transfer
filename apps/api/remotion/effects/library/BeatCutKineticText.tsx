import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { paletteColor, type CreativeEffectRuntimeProps } from "../types";

const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ]/;
// Generic Chinese-style tutorial labels used when no Chinese text is present (never sample copy).
const FALLBACK_CN_LABELS = ["重点", "实测", "对比", "现在入手"];

// beat_cut_chinese_editing_tutorial — black/red/yellow/white, large Chinese kinetic text, beat-synced
// pop/flash/glitch/whip-cut approximations, slash/title bars. Props-only, no fs/env/fetch.
export const BeatCutKineticText: React.FC<CreativeEffectRuntimeProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const bg = paletteColor(props.colors, 0, "#05060a");
  const red = paletteColor(props.colors, 1, "#e11d2a");
  const yellow = paletteColor(props.colors, 2, "#f5c518");
  const white = paletteColor(props.colors, 3, "#f5f5f5");

  const supplied = (props.texts ?? []).map((x) => x.text).filter(Boolean);
  const chinese = supplied.filter((x) => CJK_RE.test(x));
  const labels = (chinese.length ? chinese : supplied.length ? supplied : FALLBACK_CN_LABELS).slice(0, 6);

  const beats = props.beats ?? [];
  const dur = props.durationSec || 1;
  const tMod = t % dur;
  const nearestBeatDist = beats.length ? Math.min(...beats.map((b) => Math.abs(b - tMod))) : (tMod % 0.5);
  const onBeat = nearestBeatDist < 0.08;
  const pop = interpolate(Math.min(nearestBeatDist, 0.2), [0, 0.2], [1.18, 1.0], { extrapolateRight: "clamp" });
  const whip = interpolate(Math.min(nearestBeatDist, 0.12), [0, 0.12], [width * 0.06, 0], { extrapolateRight: "clamp" });

  // which label is "active" advances on beats over time.
  const idx = beats.length
    ? beats.filter((b) => b <= tMod).length % labels.length
    : Math.floor(tMod * 2) % labels.length;
  const active = labels[idx] ?? labels[0];

  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden", fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
      {/* beat flash */}
      {onBeat ? <div style={{ position: "absolute", inset: 0, background: white, opacity: 0.22 }} /> : null}
      {/* slash / title bars */}
      <div style={{ position: "absolute", top: height * 0.3, left: 0, width, height: Math.round(height * 0.012), background: red, transform: "skewY(-3deg)" }} />
      <div style={{ position: "absolute", top: height * 0.66, left: 0, width, height: Math.round(height * 0.012), background: yellow, transform: "skewY(3deg)" }} />
      {/* large Chinese kinetic text — pop + whip offset */}
      <div
        style={{
          position: "absolute",
          top: height * 0.4,
          width,
          textAlign: "center",
          transform: `translateX(${whip}px) scale(${pop})`,
          color: idx % 2 ? yellow : white
        }}
      >
        <span
          style={{
            fontSize: Math.round(height * 0.13),
            fontWeight: 900,
            letterSpacing: 4,
            textShadow: `4px 4px 0 ${red}`,
            WebkitTextStroke: `2px ${red}`
          }}
        >
          {active}
        </span>
      </div>
      {/* corner tutorial tag */}
      <div style={{ position: "absolute", top: height * 0.08, left: width * 0.06, color: red, fontSize: Math.round(height * 0.03), fontWeight: 800, background: white, padding: "4px 14px", transform: "rotate(-2deg)" }}>
        {labels[(idx + 1) % labels.length]}
      </div>
    </AbsoluteFill>
  );
};

export default BeatCutKineticText;
