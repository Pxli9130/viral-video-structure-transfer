import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateGeneratedEffect } from "../../scripts/validate-generated-effect.mjs";

const require = createRequire(import.meta.url);
let dir;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "proposal-val-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SAFE_INDEX = `import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { SafeFxProps } from "./schema";
export const SafeFx: React.FC<SafeFxProps> = (props) => {
  const f = useCurrentFrame();
  const c = props.colors ?? ["#000"];
  return <AbsoluteFill style={{ background: c[0] }}>{props.texts?.[0]?.text ?? "x"}{f}</AbsoluteFill>;
};
export default SafeFx;
`;
const SAFE_SCHEMA = `export interface SafeFxProps { width: number; height: number; fps: number; durationSec: number; colors?: string[]; texts?: Array<{ text: string }>; beats?: number[]; }\n`;
const SAFE_FIXTURE = JSON.stringify({ durationSec: 15, width: 720, height: 1280, fps: 30, assets: [], texts: [], colors: ["#000"], beats: [0], proceduralFallback: true });

function writeProposal(overrides = {}) {
  const files = {
    "index.tsx": SAFE_INDEX,
    "schema.ts": SAFE_SCHEMA,
    "fixture.json": SAFE_FIXTURE,
    "README.md": "# SafeFx\n",
    "proposal-metadata.json": JSON.stringify({ componentName: "SafeFx", defaultAllowed: false }),
    ...overrides
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content, "utf8");
}

describe("validate-generated-effect (P4)", () => {
  it("resolves zod from the validator/test workspace context", () => {
    expect(require.resolve("zod")).toMatch(/zod/);
  });

  it("safe proposal passes (pass_with_preview_blocker, safeToApply, preview recorded not faked)", () => {
    writeProposal();
    const r = validateGeneratedEffect(dir);
    expect(r.validationStatus).toBe("pass_with_preview_blocker");
    expect(r.safeToApply).toBe(true);
    expect(r.previewStatus).toBe("blocked_environment");
  });

  it("unsafe module import fails", () => {
    writeProposal({ "index.tsx": `import fs from "fs";\nexport const SafeFx = () => null;\n` });
    const r = validateGeneratedEffect(dir);
    expect(r.validationStatus).toBe("fail");
    expect(r.failedChecks).toContain("forbidden_module_import");
    expect(r.safeToApply).toBe(false);
  });

  it("sample filename fails", () => {
    writeProposal({ "index.tsx": `${SAFE_INDEX}\n// uses marketing.mov\n` });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("forbidden_literal:marketing.mov");
    expect(r.validationStatus).toBe("fail");
  });

  it("/mnt/data path fails", () => {
    writeProposal({ "index.tsx": `${SAFE_INDEX}\n// path /mnt/data/x\n` });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("forbidden_literal:/mnt/data/");
  });

  it("invalid TS fails", () => {
    writeProposal({ "index.tsx": `export const SafeFx = (= > {{{ broken\n` });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("ts_parse_index");
    expect(r.validationStatus).toBe("fail");
  });

  it("missing fixture fields fail", () => {
    writeProposal({ "fixture.json": JSON.stringify({ durationSec: 15, fps: 30, assets: [], texts: [], colors: [], beats: [], proceduralFallback: true }) });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks.some((c) => c.startsWith("fixture_missing:"))).toBe(true);
  });

  it("fixture must explicitly prove no-asset procedural fallback", () => {
    writeProposal({ "fixture.json": JSON.stringify({ durationSec: 15, width: 720, height: 1280, fps: 30, texts: [], colors: ["#000"], beats: [0], proceduralFallback: true }) });
    let r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("fixture_missing_assets_empty_array");
    expect(r.validationStatus).toBe("fail");

    writeProposal({ "fixture.json": JSON.stringify({ durationSec: 15, width: 720, height: 1280, fps: 30, assets: [{ id: "x" }], texts: [], colors: ["#000"], beats: [0], proceduralFallback: true }) });
    r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("fixture_assets_must_be_empty");

    writeProposal({ "fixture.json": JSON.stringify({ durationSec: 15, width: 720, height: 1280, fps: 30, assets: [], texts: [], colors: ["#000"], beats: [0] }) });
    r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("fixture_missing_procedural_fallback_true");
  });

  it("external npm import (e.g. lodash) fails the allowlist", () => {
    writeProposal({ "index.tsx": `import React from "react";\nimport _ from "lodash";\nexport const SafeFx: React.FC<{ width: number }> = (props) => null;\nexport default SafeFx;\n` });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("forbidden_external_import");
    expect(r.validationStatus).toBe("fail");
    expect(r.safeToApply).toBe(false);
  });

  it("allows react/remotion/relative imports", () => {
    writeProposal();
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).not.toContain("forbidden_external_import");
  });

  it("allows safe zod only in schema.ts", () => {
    writeProposal({
      "index.tsx": `import React from "react";\nimport { AbsoluteFill } from "remotion";\nimport { schema, type SafeFxProps } from "./schema";\nexport const SafeFx: React.FC<SafeFxProps> = (props) => <AbsoluteFill>{props.colors?.[0]}</AbsoluteFill>;\nexport default SafeFx;\n`,
      "schema.ts": `import { z } from "zod";\nexport const CreativeEffectAssetSchema = z.object({ id: z.string(), src: z.string().optional(), role: z.string().optional(), type: z.string().optional() });\nexport const CreativeEffectTextSchema = z.object({ id: z.string().optional(), text: z.string(), role: z.string().optional() });\nexport const SafeFxPropsSchema = z.object({ width: z.number().optional().default(1080), height: z.number().optional().default(1920), fps: z.number().optional().default(30), durationSec: z.number().optional().default(8), assets: z.array(CreativeEffectAssetSchema).optional().default([]), texts: z.array(CreativeEffectTextSchema).optional().default([]), colors: z.array(z.string()).optional().default([]), beats: z.array(z.number()).optional().default([]), stylePack: z.unknown().optional(), productTheme: z.unknown().optional(), proceduralFallback: z.boolean().optional().default(true) });\nexport type SafeFxProps = z.infer<typeof SafeFxPropsSchema>;\n`
    });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).not.toContain("forbidden_external_import");
    expect(r.safeToApply).toBe(true);
  });

  it("rejects zod outside schema.ts and unsafe zod APIs", () => {
    writeProposal({
      "index.tsx": `import React from "react";\nimport { z } from "zod";\nexport const SafeFx: React.FC<{ width: number }> = () => null;\nexport default SafeFx;\n`
    });
    let r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("zod_import_outside_schema");
    expect(r.validationStatus).toBe("fail");

    writeProposal({
      "schema.ts": `import { z } from "zod";\nexport const SafeFxPropsSchema = z.object({ width: z.number().refine((v) => v > 0) });\nexport type SafeFxProps = z.infer<typeof SafeFxPropsSchema>;\n`
    });
    r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("schema_forbidden_zod_api:.refine");
    expect(r.safeToApply).toBe(false);
  });

  it("rejects a non-existent remotion export (Extrapolate, removed in v4) — catches the render-crash class", () => {
    writeProposal({
      "index.tsx": `import React from "react";\nimport { AbsoluteFill, interpolate, Extrapolate } from "remotion";\nimport type { SafeFxProps } from "./schema";\nexport const SafeFx: React.FC<SafeFxProps> = (props) => {\n  const v = interpolate(1, [0, 1], [0, 1], { extrapolateLeft: Extrapolate.clamp });\n  return <AbsoluteFill>{v}{props.colors?.[0]}</AbsoluteFill>;\n};\nexport default SafeFx;\n`
    });
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks).toContain("nonexistent_import:remotion");
    expect(r.validationStatus).toBe("fail");
    expect(r.safeToApply).toBe(false);
  });

  it("missing required file fails", () => {
    writeProposal();
    rmSync(path.join(dir, "README.md"));
    const r = validateGeneratedEffect(dir);
    expect(r.failedChecks.some((c) => c.startsWith("missing_files:"))).toBe(true);
    expect(r.validationStatus).toBe("fail");
  });
});
