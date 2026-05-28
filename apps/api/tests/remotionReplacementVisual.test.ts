import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const remotionRoot = path.resolve(moduleDir, "..", "remotion", "ReconstructionRoot.tsx");

describe("Remotion replacement visual support", () => {
  it("keeps proxy and managed asset rendering branches wired", () => {
    const source = readFileSync(remotionRoot, "utf8");

    expect(source).toContain("ReplacementVisualLayer");
    expect(source).toContain('clip.gapFillStrategy === "user_asset_replace"');
    expect(source).toContain('clip.gapFillStrategy !== "proxy_placeholder"');
    expect(source).toContain("<Img");
    expect(source).toContain("<Video");
    expect(source).toContain("USER REPLACED");
    expect(source).toContain("Missing slot");
  });

  it("passes managed image assets to Remotion without blocked file URLs", () => {
    const source = readFileSync(path.resolve(moduleDir, "..", "src", "adapters", "renderers.ts"), "utf8");

    expect(source).toContain("remotionAssetSrc");
    expect(source).toContain("data:${mime};base64");
    expect(source).toContain("image/svg+xml");
  });
});
