#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { artifactRoot, rel } from "./artifact-paths.mjs";

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

const allowVlmJudge = process.argv.includes("--vlm-judge");
const marketingArgs = ["scripts/run-marketing-poster-case.mjs"];
const marketingEnv = {};
if (!allowVlmJudge) {
  marketingArgs.push("--skip-vlm-judge");
  marketingEnv.VVST_SKIP_VLM_JUDGE = "1";
}

console.log(`Artifact root: ${rel(artifactRoot)}`);
console.log("Step 1/5: unit/e2e test suite");
run("npm", ["test"]);
console.log("Step 2/5: schema validation");
run("npm", ["run", "validate:schemas"]);
console.log("Step 3/5: corpus regression");
run("node", ["scripts/run-corpus-regression.mjs", "--strict"]);
console.log(`Step 4/5: marketing poster case${allowVlmJudge ? " with VLM judge" : " with VLM judge skipped"}`);
run("node", marketingArgs, { env: marketingEnv });
console.log("Step 5/5: product demo page");
run("node", ["scripts/generate-product-demo-page.mjs"]);

console.log(`Full local pipeline completed. Artifacts are under ${rel(artifactRoot)}/`);
