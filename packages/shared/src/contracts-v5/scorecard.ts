// contracts-v5/scorecard.ts
// ScorecardV5 — the eval/rubric report. Gate entries are keyed on canonical V5_GATE_IDS (gates.ts),
// so the example's reference to V5-G23 now resolves. Gate/rubric items carry a status ENUM so the
// scorecard schema can actually enforce structure (audit AG-4).

export type GateStatus = "pass" | "fail" | "warn";
export type RubricStatus = "done" | "partial" | "missing";

/**
 * Graded readiness instead of a single boolean. Each level is strictly stronger:
 *  - artifact_valid : schemas pass (the JSON is well-formed) — nothing about quality.
 *  - technical_demo : a final.mp4 renders, no safety gate fails — but visual substance may be thin.
 *  - review_demo    : visual substance present (real/generated media per required slot), executed
 *                     gap fills, all assessed core-P0 gates pass, no P0 rubric item missing.
 *  - shippable_demo : review_demo + audio quality + no warnings on P0 — close to a real ad.
 */
export type ReadinessLevel = "artifact_valid" | "technical_demo" | "review_demo" | "shippable_demo";

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
  /** Graded readiness — the honest signal (see ReadinessLevel). */
  readinessLevel?: ReadinessLevel;
  readinessReasons?: string[];
  /** Back-compat boolean alias: true iff readinessLevel >= review_demo (NOT just "an mp4 exists"). */
  demoReady?: boolean;
}
