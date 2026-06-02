import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Render the components without the real Remotion runtime (which assumes a <Composition> context and
// a single React instance). The primitives are mocked as plain host elements and the frame hooks are
// stubbed; interpolate is a faithful linear implementation. This still exercises all component logic
// (layout, text/color/beat mapping) — it just renders to plain divs.
vi.mock("remotion", async () => {
  const React = (await import("react")).default;
  const interpolate = (
    x: number,
    inRange: number[],
    outRange: number[],
    opts: { extrapolateLeft?: string; extrapolateRight?: string } = {}
  ): number => {
    let v = x;
    if (v < inRange[0] && opts.extrapolateLeft === "clamp") v = inRange[0];
    const last = inRange.length - 1;
    if (v > inRange[last] && opts.extrapolateRight === "clamp") v = inRange[last];
    for (let i = 0; i < inRange.length - 1; i += 1) {
      const x0 = inRange[i];
      const x1 = inRange[i + 1];
      if ((v >= x0 && v <= x1) || i === inRange.length - 2) {
        const tt = x1 === x0 ? 0 : (v - x0) / (x1 - x0);
        return outRange[i] + (outRange[i + 1] - outRange[i]) * tt;
      }
    }
    return outRange[0];
  };
  const host = (tag: string) => ({ children, ...rest }: Record<string, unknown>) =>
    React.createElement(tag, rest, children as React.ReactNode);
  return {
    AbsoluteFill: host("div"),
    Img: host("img"),
    OffthreadVideo: host("video"),
    Sequence: host("div"),
    interpolate,
    useCurrentFrame: () => 9,
    useVideoConfig: () => ({ fps: 30, width: 720, height: 1280, durationInFrames: 450, id: "test", defaultProps: {} })
  };
});

const { getRuntimeEffectComponent, getBuiltInFallbackForMotif } = await import("../remotion/effects/effectRuntimeRegistry");
const { RibbonPosterSweep, CardOrbitStack, BlueUiSpotlight, BeatCutKineticText } = await import(
  "../remotion/effects/effectRuntimeRegistry"
);

const fixtureProps = {
  width: 720,
  height: 1280,
  fps: 30,
  durationSec: 15,
  texts: [
    { text: "AeroSpin", role: "product_name" },
    { text: "三档强风", role: "selling_point" },
    { text: "现在入手", role: "cta" }
  ],
  colors: ["#05060a", "#e11d2a", "#f5c518", "#22d3ee"],
  beats: [0, 0.5, 1, 1.5, 2]
};

const COMPONENTS = [
  ["RibbonPosterSweep", RibbonPosterSweep],
  ["CardOrbitStack", CardOrbitStack],
  ["BlueUiSpotlight", BlueUiSpotlight],
  ["BeatCutKineticText", BeatCutKineticText]
] as const;

describe("built-in effect components (P5)", () => {
  it("each component renders a non-empty frame with fixture props", () => {
    for (const [name, Comp] of COMPONENTS) {
      const html = renderToStaticMarkup(React.createElement(Comp, fixtureProps));
      expect(html.length, name).toBeGreaterThan(50);
    }
  });

  it("each component renders with NO assets (procedural fallback)", () => {
    for (const [name, Comp] of COMPONENTS) {
      const html = renderToStaticMarkup(React.createElement(Comp, { ...fixtureProps, assets: [] }));
      expect(html.length, name).toBeGreaterThan(50);
    }
  });

  it("rendered output embeds no sample filenames/paths", () => {
    for (const [, Comp] of COMPONENTS) {
      const html = renderToStaticMarkup(React.createElement(Comp, fixtureProps));
      expect(html).not.toMatch(/test_videos\/|learned_samples|sample[_-]?evidence|\.mov|\.mp4/);
    }
  });
});

describe("effectRuntimeRegistry (P6)", () => {
  it("resolves a built-in component by program id", () => {
    expect(getRuntimeEffectComponent("RibbonPosterSweep")).toBe(RibbonPosterSweep);
    expect(getRuntimeEffectComponent("CardOrbitStack")).toBe(CardOrbitStack);
  });

  it("returns undefined for an unknown effect id", () => {
    expect(getRuntimeEffectComponent("NopeEffect")).toBeUndefined();
    expect(getRuntimeEffectComponent(undefined)).toBeUndefined();
  });

  it("resolves the motif fallback component", () => {
    expect(getBuiltInFallbackForMotif("blue_spotlight_ui_pitch")).toBe(BlueUiSpotlight);
    expect(getBuiltInFallbackForMotif("beat_cut_chinese_editing_tutorial")).toBe(BeatCutKineticText);
    // A truly-unknown motif has neither a built-in nor a generated effect.
    expect(getBuiltInFallbackForMotif("totally_unknown_motif")).toBeUndefined();
    // generic_motion_graph has no built-in; it may resolve a generated effect if one is applied
    // (the generated manifest is consulted first). Either undefined or a function is valid.
    const generic = getBuiltInFallbackForMotif("generic_motion_graph");
    expect(generic === undefined || typeof generic === "function").toBe(true);
  });
});
