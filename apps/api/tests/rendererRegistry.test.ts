import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RendererRegistry, selectRendererBackend } from "../src/adapters/renderers.js";

const opts = {
  generatedDir: mkdtempSync(path.join(tmpdir(), "vvst-renderers-")),
  assetResolver: { resolve: () => undefined }
};

describe("RendererRegistry", () => {
  it("exposes extensible backends without replacing Remotion as MG default", () => {
    expect(Object.keys(RendererRegistry)).toEqual(
      expect.arrayContaining(["remotion_mg", "ffmpeg_compose", "image_card", "aigc_video_fill_stub"])
    );
    expect(RendererRegistry.remotion_mg.target).toBe("remotion");
    expect(selectRendererBackend("remotion_mg", opts).target).toBe("remotion");
    expect(selectRendererBackend("image_card", opts).target).toBe("html_preview");
    expect(selectRendererBackend("aigc_video_fill_stub", opts).target).toBe("hyperframes");
  });
});
