import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { v5 } from "../index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const examplesDir = path.join(repoRoot, "spec_v5", "examples");

function loadExample(base: string): unknown {
  return JSON.parse(readFileSync(path.join(examplesDir, `${base}.example.json`), "utf8"));
}

describe("contracts-v5: canonical example artifacts validate", () => {
  const cases: Array<[string, (v: unknown) => v5.V5ValidationResult]> = [
    ["neutral-reconstruction-program", v5.validateNeutralReconstructionProgram],
    ["composition-program", v5.validateCompositionProgram],
    ["final-video-program", v5.validateFinalVideoProgram],
    ["knowledge-element.hero-head", v5.validateKnowledgeElement],
    ["audio-pattern", v5.validateKnowledgeElement],
    ["scorecard", v5.validateScorecardV5]
  ];

  for (const [base, validate] of cases) {
    it(`${base}.example.json passes its canonical schema`, () => {
      const result = validate(loadExample(base));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});

describe("contracts-v5: gate registry is canonical 40-gate set", () => {
  it("has 42 gates with unique ids", () => {
    expect(v5.V5_GATES).toHaveLength(42);
    expect(new Set(v5.V5_GATE_IDS).size).toBe(42);
  });
  it("includes V5-G23 referenced by the scorecard example (resolves AG-1/XD-03)", () => {
    expect(v5.V5_GATE_IDS).toContain("V5-G23");
    expect(v5.getGateDef("V5-G23")?.name).toBe("Final video exists");
  });
  it("assigns P0/P1 priorities so the demo-ready rule has real priorities", () => {
    expect(v5.V5_P0_GATE_IDS.length).toBeGreaterThan(0);
    expect(v5.V5_P0_GATE_IDS.length).toBeLessThan(40);
  });
});

describe("contracts-v5: schemas reject drifted shapes", () => {
  it("rejects a NeutralReconstructionProgram missing evidenceTimelineId (audit SC-06)", () => {
    const bad = loadExample("neutral-reconstruction-program") as Record<string, unknown>;
    delete bad.evidenceTimelineId;
    const result = v5.validateNeutralReconstructionProgram(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects a CompositionProgram whose slotPlan is an object instead of an array (audit SC-02)", () => {
    const bad = loadExample("composition-program") as Record<string, unknown>;
    bad.slotPlan = { slots: [] };
    const result = v5.validateCompositionProgram(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects a selectedElement missing priority (audit PVS-05)", () => {
    const bad = loadExample("composition-program") as Record<string, unknown>;
    bad.selectedElements = [{ elementId: "x", appliedRole: "hook" }];
    const result = v5.validateCompositionProgram(bad);
    expect(result.valid).toBe(false);
  });
});
