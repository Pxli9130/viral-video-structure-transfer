#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = path.join(ROOT, "docs/artifacts/learned_samples_max");

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

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function npmVersion() {
  const res = spawnSync("npm", ["--version"], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : `unavailable: ${res.stderr.trim()}`;
}

function browserCandidates() {
  const home = process.env.HOME ?? os.homedir();
  return [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    path.join(ROOT, "apps/api/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
    path.join(ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"),
    path.join(home, ".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell")
  ].filter(Boolean);
}

function diagnostics() {
  let networkInterfaces = {};
  try {
    networkInterfaces = os.networkInterfaces();
  } catch (error) {
    networkInterfaces = { error: String(error?.message ?? error) };
  }
  const candidates = browserCandidates();
  return {
    generatedAt: new Date().toISOString(),
    node: process.version,
    npm: npmVersion(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cwd: ROOT,
    env: {
      REMOTION_BROWSER_EXECUTABLE: process.env.REMOTION_BROWSER_EXECUTABLE,
      REMOTION_ENTRY: process.env.REMOTION_ENTRY,
      REMOTION_COMPOSITION: process.env.REMOTION_COMPOSITION,
      NO_SANDBOX: process.env.NO_SANDBOX,
      CONDA_BASE: process.env.CONDA_BASE,
      VIRAL_CONDA_ENV: process.env.VIRAL_CONDA_ENV
    },
    browserCandidates: candidates.map((candidate) => ({ path: candidate, exists: existsSync(candidate) })),
    selectedBrowser: candidates.find((candidate) => existsSync(candidate)),
    networkInterfaces
  };
}

function assetResolverFromGeneration(generation) {
  const assets = generation?.request?.targetAssets ?? [];
  return {
    resolve(assetId) {
      const asset = assets.find((item) => item.id === assetId);
      if (!asset?.path) return undefined;
      return path.isAbsolute(asset.path) ? asset.path : path.resolve(ROOT, asset.path);
    }
  };
}

async function tryRender(caseName, artifactRoot, report) {
  const caseRoot = path.join(artifactRoot, caseName);
  const generation = readJson(path.join(caseRoot, "generation.json"));
  const timeline = readJson(path.join(caseRoot, "timeline.json")) ?? generation?.timeline;
  if (!timeline) throw new Error(`Missing timeline for ${caseName}`);
  const rendererPath = path.join(ROOT, "apps/api/dist/adapters/renderers.js");
  if (!existsSync(rendererPath)) throw new Error("apps/api/dist/adapters/renderers.js missing; run npm run build first.");
  const { RemotionRenderer } = await import(pathToFileURL(rendererPath).href);
  const tmp = path.join(caseRoot, "_remotion_host_verify");
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const renderer = new RemotionRenderer({
    generatedDir: tmp,
    entryPoint: path.join(ROOT, "apps/api/remotion/index.tsx"),
    compositionId: "ViralRecipe",
    browserExecutable: report.diagnostics.selectedBrowser,
    assetResolver: assetResolverFromGeneration(generation),
    outputBasename: "host-remotion"
  });
  const output = await renderer.render(timeline, generation?.id ?? `host_verify_${caseName}`);
  report.renderOutput = output;
  if (output.status === "completed" && output.outputPath && existsSync(output.outputPath)) {
    const finalPath = path.join(caseRoot, "final.remotion.mp4");
    await copyFile(output.outputPath, finalPath);
    report.status = "pass";
    report.finalRemotionMp4 = finalPath;
    report.verifiedOutputWritten = true;
  } else {
    report.status = "blocked";
    report.blocker = output.error ?? "Remotion render did not complete.";
    report.verifiedOutputWritten = false;
  }
  await rm(tmp, { recursive: true, force: true });
}

function docsFor(report) {
  return `# Remotion Host Verification

Generated: ${report.generatedAt}

## Status

- Status: ${report.status}
- Verified output written: ${report.verifiedOutputWritten ? "yes" : "no"}
- Output: ${report.finalRemotionMp4 ?? "none"}
- Blocker: ${report.blocker ?? "none"}

## Environment

- Node: ${report.diagnostics.node}
- npm: ${report.diagnostics.npm}
- Platform: ${report.diagnostics.platform}
- Selected browser: ${report.diagnostics.selectedBrowser ?? "not found"}

## How To Verify On Host

\`\`\`bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run build --workspace @vvst/shared
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run build --workspace @vvst/renderer
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm run build --workspace @vvst/api
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/verify-remotion-host.mjs --case marketing
\`\`\`

If the sandbox reports \`uv_interface_addresses returned Unknown system error 1\`, run the command in a normal host terminal. Keep FFmpeg \`final.mp4\` as canonical until this script reports \`status=pass\` and rewrites \`final.remotion.mp4\`.

Optional environment checks:

- Set \`REMOTION_BROWSER_EXECUTABLE\` to a known Chrome/Chromium executable.
- Try Remotion/Chromium no-sandbox flags if your host policy requires them.
- Do not create or copy a fake \`final.remotion.mp4\`; this script only writes it after a completed Remotion render.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const caseName = String(args.case ?? "marketing");
  const artifactRoot = path.resolve(args.root ?? DEFAULT_ROOT);
  const caseRoot = path.join(artifactRoot, caseName);
  await mkdir(caseRoot, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    case: caseName,
    status: args["diagnostics-only"] ? "diagnostics_only" : "started",
    verifiedOutputWritten: false,
    existingFinalRemotionBeforeRun: existsSync(path.join(caseRoot, "final.remotion.mp4")),
    diagnostics: diagnostics()
  };
  if (!args["diagnostics-only"]) {
    try {
      await tryRender(caseName, artifactRoot, report);
    } catch (error) {
      report.status = "blocked";
      report.blocker = String(error?.message ?? error);
      report.verifiedOutputWritten = false;
    }
  }
  const outJson = path.join(caseRoot, "remotion-smoke-report.json");
  writeFileSync(outJson, JSON.stringify(report, null, 2));
  writeFileSync(path.join(ROOT, "docs/remotion-host-verification.md"), docsFor(report));
  console.log(JSON.stringify({ status: report.status, out: outJson, blocker: report.blocker, verifiedOutputWritten: report.verifiedOutputWritten }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
