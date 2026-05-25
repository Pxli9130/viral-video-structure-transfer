import { promises as fs } from "node:fs";
import path from "node:path";
import {
  validateAssetAnalysis,
  validateGenerationRequest,
  validateJob,
  validateKnowledgeAtom,
  validateProject,
  validateStructureTemplate,
  validateTimeline
} from "@vvst/shared";

const repoRoot = process.cwd();
const storageRoot = path.resolve(repoRoot, process.env.STORAGE_DIR || "storage");
const demoDir = path.join(storageRoot, "demo");
const dbPath = path.join(storageRoot, "db", "app.json");

const validators = {
  project: validateProject,
  asset_analysis: validateAssetAnalysis,
  knowledge_atom: validateKnowledgeAtom,
  structure_template: validateStructureTemplate,
  generation_request: validateGenerationRequest,
  timeline: validateTimeline,
  job: validateJob
};

function report(label, result) {
  if (result.valid) {
    console.log(`PASS  ${label}`);
    return true;
  }
  console.error(`FAIL  ${label}`);
  for (const err of result.errors) console.error(`      ${err}`);
  return false;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

let okCount = 0;
let failCount = 0;

function note(passed) {
  if (passed) okCount += 1;
  else failCount += 1;
}

const demoFixtures = [
  { file: "structure-template.v1.2.json", schema: "structure_template" },
  { file: "generation-request.v1.2.json", schema: "generation_request" },
  { file: "timeline.v1.2.json", schema: "timeline" }
];

for (const fixture of demoFixtures) {
  const value = await readJson(path.join(demoDir, fixture.file));
  if (!value) {
    console.warn(`SKIP  ${fixture.file} (missing — run npm run demo:seed first)`);
    continue;
  }
  note(report(`${fixture.file} :: ${fixture.schema}`, validators[fixture.schema](value)));
}

const db = await readJson(dbPath);
if (db) {
  for (const project of db.projects ?? []) note(report(`db.projects[${project.id}]`, validators.project(project)));
  for (const analysis of db.analyses ?? []) note(report(`db.analyses[${analysis.id}]`, validators.asset_analysis(analysis.video)));
  for (const template of db.templates ?? []) note(report(`db.templates[${template.id}]`, validators.structure_template(template.template)));
  for (const generation of db.generations ?? []) note(report(`db.generations[${generation.id}].timeline`, validators.timeline(generation.timeline)));
  for (const atom of db.atoms ?? []) note(report(`db.atoms[${atom.id}]`, validators.knowledge_atom(atom)));
  for (const job of db.jobs ?? []) note(report(`db.jobs[${job.id}]`, validators.job(job)));
} else {
  console.warn(`SKIP  storage/db/app.json missing — run npm run demo:seed first`);
}

console.log(`\n${okCount} passed, ${failCount} failed.`);
if (failCount > 0) process.exit(1);
