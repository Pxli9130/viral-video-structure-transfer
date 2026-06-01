import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

describe("v4.1 renderer consumption wiring", () => {
  it("ViralRecipeRoot interprets layers for media, text and motion atoms before legacy clips", () => {
    const source = readFileSync(path.resolve(moduleDir, "..", "remotion", "ViralRecipeRoot.tsx"), "utf8");
    expect(source).toContain("recipe.layers ?? []");
    expect(source).toContain("sort((a, b) => a.zIndex - b.zIndex)");
    expect(source).toContain("layer.type === \"media\"");
    expect(source).toContain("boxWithMinArea");
    expect(source).toContain("layer.type === \"text\"");
    expect(source).toContain("WebkitTextStroke");
    expect(source).toContain("ParametricRibbonSurface");
    expect(source).toContain("MotionAtomFallback");
  });

  it("FFmpeg renderer reads v4.1 text/media/audio/motion layers for fallback rendering", () => {
    const source = readFileSync(path.resolve(moduleDir, "..", "src", "adapters", "renderers.ts"), "utf8");
    expect(source).toContain("recipeTextLayerForClip");
    expect(source).toContain("recipeMediaLayerForClip");
    expect(source).toContain("recipeDrawTextFilter");
    expect(source).toContain("motionAtomFiltersFromRecipe");
    expect(source).toContain("motionAtomLayers=");
    expect(source).toContain("recipeAudioLayers");
  });
});
