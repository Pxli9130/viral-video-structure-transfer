// Validate spec_v5 example artifacts against the canonical v5 contracts (packages/shared contracts-v5).
// Run: node scripts/validate-v5-contracts.mjs   (after building @vvst/shared)
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v5 } from "@vvst/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = path.join(repoRoot, "spec_v5", "examples");

// example file basename (without .example.json) -> v5 validator
const MAP = {
  "neutral-reconstruction-program": v5.validateNeutralReconstructionProgram,
  "composition-program": v5.validateCompositionProgram,
  "final-video-program": v5.validateFinalVideoProgram,
  "knowledge-element.hero-head": v5.validateKnowledgeElement,
  "audio-pattern": v5.validateKnowledgeElement,
  "scorecard": v5.validateScorecardV5
};

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

let failed = 0;
let passed = 0;
for (const [base, validate] of Object.entries(MAP)) {
  const file = path.join(examplesDir, `${base}.example.json`);
  let data;
  try {
    data = await readJson(file);
  } catch (err) {
    console.error(`MISSING/BAD-JSON  ${base}.example.json -> ${err.message}`);
    failed++;
    continue;
  }
  const result = validate(data);
  if (result.valid) {
    console.log(`PASS  ${base}.example.json`);
    passed++;
  } else {
    console.error(`FAIL  ${base}.example.json`);
    for (const e of result.errors) console.error(`      ${e}`);
    failed++;
  }
}

// Sanity: canonical gate registry is the 40-gate set and the scorecard example references a real gate.
const gateIds = new Set(v5.V5_GATES.map((g) => g.id));
if (v5.V5_GATES.length !== 43) {
  console.error(`FAIL  gate registry has ${v5.V5_GATES.length} gates, expected 43`);
  failed++;
} else if (!gateIds.has("V5-G23")) {
  console.error("FAIL  V5-G23 (referenced by scorecard example) missing from gate registry");
  failed++;
} else {
  console.log(`PASS  gate registry (43 gates, V5-G23 present, P0=${v5.V5_P0_GATE_IDS.length})`);
  passed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
