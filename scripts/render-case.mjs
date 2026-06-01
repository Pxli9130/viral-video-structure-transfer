#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const caseName = String(args.case ?? "marketing");
const out = path.resolve(args.out ?? "docs/artifacts/final_submission");

let command;
let argv;
if (caseName === "marketing" || caseName === "editing") {
  command = process.execPath;
  argv = [path.join(ROOT, "scripts/run-demo-final.mjs"), "--out", out, ...(caseName === "editing" ? ["--skip-b"] : [])];
} else if (caseName === "motion_graph_1" || caseName === "motion_graph_2") {
  command = process.execPath;
  argv = [path.join(ROOT, "scripts/run-learn-samples.mjs"), "--samples", `test_videos/${caseName}.mov`, "--out", out];
} else {
  console.error(`Unknown case ${caseName}. Use marketing, editing, motion_graph_1, or motion_graph_2.`);
  process.exit(2);
}

const res = spawnSync(command, argv, {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    CONDA_BASE: process.env.CONDA_BASE ?? "/home/pxli/anaconda3",
    VIRAL_CONDA_ENV: process.env.VIRAL_CONDA_ENV ?? "viral"
  }
});
process.exit(res.status ?? 1);

