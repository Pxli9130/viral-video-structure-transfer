import { describe, expect, it } from "vitest";
import { v5 } from "@vvst/shared";
import { runScorecardV5 } from "../src/pipeline-v5/index.js";

function g(id: string, status: v5.GateStatus): v5.ScorecardGate {
  const def = v5.getGateDef(id);
  return { id, name: def?.name ?? id, status, priority: def?.priority };
}

describe("pipeline-v5 scorecard aggregation", () => {
  it("aggregates stage gates into a full schema-valid 40-gate ScorecardV5", () => {
    const card = runScorecardV5({
      generationId: "gen_x",
      stageGates: [
        [g("V5-G1", "pass"), g("V5-G4", "pass"), g("V5-G5", "pass"), g("V5-G9", "pass")],
        [g("V5-G17", "pass"), g("V5-G18", "pass"), g("V5-G19", "pass"), g("V5-G20", "pass"), g("V5-G21", "pass")]
      ],
      render: { finalMp4Exists: true, durationSec: 16, expectedDurationSec: 16, hasAudio: true, audioIntended: true },
      noCopy: { noCopyPassed: true, visualMinHamming: 28, audioMaxSimilarity: 0.21 }
    });

    expect(v5.validateScorecardV5(card).errors).toEqual([]);
    expect(card.gates).toHaveLength(40);
    expect(card.gates.find((x) => x.id === "V5-G23")?.status).toBe("pass"); // render derived
    expect(card.gates.find((x) => x.id === "V5-G27")?.status).toBe("pass"); // audio
    expect(card.gates.find((x) => x.id === "V5-G29")?.status).toBe("pass"); // no-copy
    expect(card.rubricCoverage.length).toBeGreaterThan(5);
    expect(card.demoReady).toBe(true);
  });

  it("flips demoReady=false when a safety gate fails (no-copy violation)", () => {
    const card = runScorecardV5({
      generationId: "gen_bad",
      stageGates: [[g("V5-G1", "pass")]],
      render: { finalMp4Exists: true, hasAudio: true },
      noCopy: { noCopyPassed: false, visualMinHamming: 4, details: "visual pHash too close" }
    });
    expect(card.gates.find((x) => x.id === "V5-G29")?.status).toBe("fail");
    expect(card.demoReady).toBe(false);
    expect(card.warnings.some((w) => w.includes("V5-G29"))).toBe(true);
    expect(v5.validateScorecardV5(card).errors).toEqual([]);
  });

  it("marks the No Sample Copy rubric item missing when a safety gate fails", () => {
    const card = runScorecardV5({
      generationId: "gen_nc",
      stageGates: [],
      noCopy: { noCopyPassed: false, audioMaxSimilarity: 0.97 }
    });
    const item = card.rubricCoverage.find((r) => r.rubricItem === "No Sample Copy");
    expect(item?.status).toBe("missing");
  });
});
