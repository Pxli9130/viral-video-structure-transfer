import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

describe("PR3 report and evidence API wiring", () => {
  it("exposes judge-facing evidence, atom, gap, recipe and render report endpoints", () => {
    const source = readFileSync(path.resolve(moduleDir, "..", "src", "server.ts"), "utf8");
    expect(source).toContain("\"/api/projects/:projectId/evidence\"");
    expect(source).toContain("\"/api/projects/:projectId/technique-atoms\"");
    expect(source).toContain("\"/api/transfer-plans/:generationId/gap-report\"");
    expect(source).toContain("\"/api/transfer-plans/:generationId/render-recipe\"");
    expect(source).toContain("\"/api/render-jobs/:renderId/report\"");
    expect(source).toContain("extractTechniqueAtoms");
    expect(source).toContain("primitiveHistogram");
  });

  it("keeps PR3 variant labels aligned with spec v4.1", () => {
    const source = readFileSync(path.resolve(moduleDir, "..", "src", "server.ts"), "utf8");
    expect(source).toContain("label: \"high_click\"");
    expect(source).toContain("label: \"high_conversion\"");
    expect(source).toContain("label: \"high_quality\"");
    expect(source).not.toContain("label: \"high_ctr\"");
  });
});
