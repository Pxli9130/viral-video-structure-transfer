// contracts-v5/scorecard.ts
// ScorecardV5 — the eval/rubric report. Gate entries are keyed on canonical V5_GATE_IDS (gates.ts),
// so the example's reference to V5-G23 now resolves. Gate/rubric items carry a status ENUM so the
// scorecard schema can actually enforce structure (audit AG-4).

export type GateStatus = "pass" | "fail" | "warn";
export type RubricStatus = "done" | "partial" | "missing";

export interface ScorecardGate {
  id: string; // canonical V5-Gn
  name: string;
  status: GateStatus;
  priority?: "P0" | "P1";
  message?: string;
}

export interface ScorecardRubricItem {
  rubricItem: string;
  status: RubricStatus;
  evidenceArtifactRefs: string[];
}

export interface ScorecardV5 {
  id: string;
  generationId: string;
  gates: ScorecardGate[];
  rubricCoverage: ScorecardRubricItem[];
  renderQuality: Record<string, unknown>;
  safety: Record<string, unknown>;
  warnings: string[];
  /** Demo-ready when all P0 gates pass/warn and no safety gate fails (acceptance-gates §scoring). */
  demoReady?: boolean;
}
