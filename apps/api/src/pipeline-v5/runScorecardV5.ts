// pipeline-v5/runScorecardV5.ts
// Stage 17: aggregate gate results from every stage (learn/create/render/safety) into one ScorecardV5
// keyed on the canonical 40-gate registry, plus rubric coverage and a demo-ready verdict
// (acceptance-gates.md scoring: all P0 gates pass/warn AND no safety gate fails).

import { v5 } from "@vvst/shared";

export interface NoCopyResult {
  noCopyPassed: boolean;
  visualMinHamming?: number;
  audioMaxSimilarity?: number;
  details?: string;
}

export interface RenderInfo {
  finalMp4Exists: boolean;
  durationSec?: number;
  expectedDurationSec?: number;
  width?: number;
  height?: number;
  expectedWidth?: number;
  expectedHeight?: number;
  hasAudio?: boolean;
  audioIntended?: boolean;
}

export interface ScorecardInput {
  generationId: string;
  stageGates: v5.ScorecardGate[][]; // learn gates, create gates, etc.
  render?: RenderInfo;
  noCopy?: NoCopyResult;
  artifactRefs?: Record<string, string[]>;
  /** UI gates assessed elsewhere (default: warn "pending UI"). */
  uiGates?: v5.ScorecardGate[];
}

function mk(id: string, status: v5.GateStatus, message?: string): v5.ScorecardGate {
  const def = v5.getGateDef(id);
  return { id, name: def?.name ?? id, status, priority: def?.priority, message };
}

const RUBRIC: Array<{ item: string; gates: string[] }> = [
  { item: "P0 Sample Parse", gates: ["V5-G1", "V5-G2"] },
  { item: "P0 Structure Extract", gates: ["V5-G4", "V5-G5", "V5-G9"] },
  { item: "P0 Transfer Generation", gates: ["V5-G17", "V5-G20", "V5-G21"] },
  { item: "P0 Gap Detection", gates: ["V5-G18"] },
  { item: "P0 Gap Fill", gates: ["V5-G19"] },
  { item: "P0 Visualization", gates: ["V5-G34", "V5-G35", "V5-G36", "V5-G37"] },
  { item: "P0 Final Demo", gates: ["V5-G23", "V5-G39"] },
  { item: "P1 Packaging", gates: ["V5-G6", "V5-G13"] },
  { item: "P1 Real Asset Fit", gates: ["V5-G16"] },
  { item: "Audio Structure", gates: ["V5-G27"] },
  { item: "No Sample Copy", gates: ["V5-G29", "V5-G30", "V5-G31"] }
];

export function runScorecardV5(input: ScorecardInput): v5.ScorecardV5 {
  const byId = new Map<string, v5.ScorecardGate>();
  const set = (g: v5.ScorecardGate) => byId.set(g.id, g);

  // 1. merge stage-provided gates (later stages win on conflict).
  for (const arr of input.stageGates) for (const g of arr) set(g);

  // 2. render-derived gates.
  if (input.render) {
    const r = input.render;
    set(mk("V5-G23", r.finalMp4Exists ? "pass" : "fail", r.finalMp4Exists ? undefined : "final.mp4 missing"));
    if (typeof r.durationSec === "number" && typeof r.expectedDurationSec === "number") {
      const ok = Math.abs(r.durationSec - r.expectedDurationSec) <= Math.max(0.75, r.expectedDurationSec * 0.15);
      set(mk("V5-G24", ok ? "pass" : "warn", `${r.durationSec}s vs ${r.expectedDurationSec}s`));
    }
    if (r.width && r.height && r.expectedWidth && r.expectedHeight) {
      const ok = r.width === r.expectedWidth && r.height === r.expectedHeight;
      set(mk("V5-G25", ok ? "pass" : "warn", `${r.width}x${r.height}`));
    }
    const audioOk = r.audioIntended === false ? true : Boolean(r.hasAudio);
    set(mk("V5-G27", audioOk ? "pass" : "fail", r.hasAudio ? "audio present" : "no audio track"));
  }

  // 3. no-copy safety gates (real scan evidence when available).
  if (input.noCopy) {
    const nc = input.noCopy;
    const status: v5.GateStatus = nc.noCopyPassed ? "pass" : "fail";
    const msg = [
      nc.visualMinHamming !== undefined ? `minHamming=${nc.visualMinHamming}` : undefined,
      nc.audioMaxSimilarity !== undefined ? `audioSim=${nc.audioMaxSimilarity}` : undefined,
      nc.details
    ]
      .filter(Boolean)
      .join(" ");
    set(mk("V5-G29", status, msg || undefined));
    set(mk("V5-G30", nc.noCopyPassed ? "pass" : "fail", nc.audioMaxSimilarity !== undefined ? `audioSim=${nc.audioMaxSimilarity}` : undefined));
  }

  // 4. UI gates (default warn until the UI reports them).
  for (const g of input.uiGates ?? []) set(g);

  // 5. fill any unassessed gate from the registry.
  for (const def of v5.V5_GATES) {
    if (!byId.has(def.id)) {
      const isUi = def.category === "ui";
      set(mk(def.id, isUi ? "warn" : "warn", isUi ? "pending UI" : "not assessed"));
    }
  }

  const gates = v5.V5_GATES.map((def) => byId.get(def.id) as v5.ScorecardGate);

  // rubric coverage.
  const statusOf = (id: string) => byId.get(id)?.status ?? "warn";
  const rubricCoverage: v5.ScorecardRubricItem[] = RUBRIC.map(({ item, gates: gs }) => {
    const statuses = gs.map(statusOf);
    const anyFail = statuses.includes("fail");
    const allPass = statuses.every((s) => s === "pass");
    const status: v5.RubricStatus = anyFail ? "missing" : allPass ? "done" : "partial";
    const refs = gs.flatMap((g) => input.artifactRefs?.[g] ?? []);
    return { rubricItem: item, status, evidenceArtifactRefs: refs };
  });

  // Graded readiness (honest): an mp4 existing is NOT "ready". review_demo requires real visual
  // substance + executed fills + assessed core-P0 gates passing + no P0 rubric item missing.
  const st = (id: string) => byId.get(id)?.status;
  const safety = gates.filter((g) => v5.getGateDef(g.id)?.category === "safety");
  const anySafetyFail = safety.some((g) => g.status === "fail");
  const CORE_P0 = ["V5-G17", "V5-G20", "V5-G21", "V5-G41", "V5-G19"]; // schema, gen2, final schema, visual substance, executed fill
  const corePass = (id: string) => st(id) === "pass";
  const p0RubricMissing = rubricCoverage.some((r) => r.rubricItem.startsWith("P0") && r.status === "missing");

  const reasons: string[] = [];
  let level: v5.ReadinessLevel = "artifact_valid";
  if (corePass("V5-G17") && corePass("V5-G21")) {
    level = "artifact_valid";
    if (st("V5-G23") === "pass" && !anySafetyFail) {
      level = "technical_demo";
      const coreOk = CORE_P0.every(corePass);
      const visualOk = st("V5-G41") === "pass";
      if (coreOk && visualOk && !p0RubricMissing) {
        level = "review_demo";
        if (st("V5-G27") === "pass" && st("V5-G42") !== "fail" && gates.filter((g) => g.priority === "P0").every((g) => g.status === "pass")) {
          level = "shippable_demo";
        }
      } else {
        if (!visualOk) reasons.push("visual substance gate (V5-G41) not passing — slots are placeholder cards.");
        if (st("V5-G19") !== "pass") reasons.push("gap fills not executed (V5-G19).");
        if (p0RubricMissing) reasons.push("a P0 rubric item is missing.");
      }
    } else {
      reasons.push(anySafetyFail ? "a safety gate failed." : "no final video (V5-G23).");
    }
  } else {
    reasons.push("core schema gates (V5-G17/G21) not passing.");
  }
  const demoReady = level === "review_demo" || level === "shippable_demo";

  const warnings = gates.filter((g) => g.status === "fail").map((g) => `${g.id} ${g.name}: ${g.message ?? "failed"}`);

  return {
    id: `score_${input.generationId}`,
    generationId: input.generationId,
    gates,
    rubricCoverage,
    renderQuality: input.render ? { ...input.render } : {},
    safety: input.noCopy ? { ...input.noCopy } : {},
    warnings,
    readinessLevel: level,
    readinessReasons: reasons,
    demoReady
  };
}
