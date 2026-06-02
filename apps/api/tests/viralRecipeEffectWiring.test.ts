import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock remotion primitives as host elements (same approach as effectRuntime.test) so we can render
// the resolved effect component without a Remotion <Composition> context / dual-React issues.
vi.mock("remotion", async () => {
  const ReactMod = (await import("react")).default;
  const host = (tag: string) => ({ children, ...rest }: Record<string, unknown>) =>
    ReactMod.createElement(tag, rest, children as React.ReactNode);
  return {
    AbsoluteFill: host("div"),
    Img: host("img"),
    OffthreadVideo: host("video"),
    Sequence: host("div"),
    interpolate: (x: number, _i: number[], o: number[]) => o[0],
    useCurrentFrame: () => 9,
    useVideoConfig: () => ({ fps: 30, width: 720, height: 1280, durationInFrames: 450, id: "t", defaultProps: {} })
  };
});

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(moduleDir, "..", rel), "utf8");

const { getRuntimeEffectComponent, getBuiltInFallbackForMotif } = await import("../remotion/effects/effectRuntimeRegistry");

describe("ViralRecipeRoot effect wiring (P7)", () => {
  it("imports the runtime registry and renders effects when effectProgramIds exist", () => {
    const src = read("remotion/ViralRecipeRoot.tsx");
    expect(src).toContain("effectRuntimeRegistry");
    expect(src).toContain("getRuntimeEffectComponent");
    expect(src).toContain("getBuiltInFallbackForMotif");
    expect(src).toContain("EffectLayer");
    expect(src).toContain("effectProgramIds");
    expect(src).toContain("DEBUG_EFFECT_LABEL");
  });

  it("old recipe path is preserved (layers/clips render fallthrough still present)", () => {
    const src = read("remotion/ViralRecipeRoot.tsx");
    // The effect branch is guarded by effectIds.length, then the legacy layer/clip paths follow.
    expect(src).toContain("if (effectIds.length)");
    expect(src).toContain("const layers = recipe.layers ?? []");
    expect(src).toContain("const clips = recipe.clips ?? []");
  });

  it("a missing generated effect id falls back to the built-in motif component and renders", () => {
    // Simulate ViralRecipeRoot's resolution: getRuntimeEffectComponent(unknown) ?? motif fallback.
    const Component = getRuntimeEffectComponent("GeneratedRibbonV2") ?? getBuiltInFallbackForMotif("poster_ribbon_marketing");
    expect(Component).toBeTruthy();
    const html = renderToStaticMarkup(
      React.createElement(Component as React.FC<Record<string, unknown>>, {
        width: 720,
        height: 1280,
        fps: 30,
        durationSec: 15,
        colors: ["#f7f1e8", "#e11d2a"],
        texts: [{ text: "AeroSpin", role: "product_name" }],
        beats: [0, 1]
      })
    );
    expect(html.length).toBeGreaterThan(50);
  });

  it("renderer records effect ids / fallback reason and forwards DEBUG_EFFECT_LABEL", () => {
    const src = read("src/adapters/renderers.ts");
    expect(src).toContain("effectProgramIds");
    expect(src).toContain("effectFallbackReason");
    expect(src).toContain("DEBUG_EFFECT_LABEL");
    expect(src).toContain("envVariables");
  });
});
