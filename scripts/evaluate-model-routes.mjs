#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_ENTRY = path.join(ROOT, "packages/shared/dist/index.js");

function parseArgs(argv) {
  const args = {
    offline: true,
    json: false,
    allowCloud: false,
    allowSampleMediaExternal: false,
    allowQualityJudgeSampleFrames: false,
    case: undefined,
    allCases: false,
    attachToArtifacts: false,
    strictPolicy: false,
    out: path.join(ROOT, "artifacts/model-routes")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    switch (item) {
      case "--offline":
        args.offline = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--allow-cloud":
        args.allowCloud = true;
        break;
      case "--allow-sample-media-external":
        args.allowSampleMediaExternal = true;
        args.allowQualityJudgeSampleFrames = true;
        break;
      case "--allow-quality-judge-sample-frames":
        args.allowQualityJudgeSampleFrames = true;
        break;
      case "--case":
        args.case = argv[i + 1];
        i += 1;
        break;
      case "--all-cases":
        args.allCases = true;
        break;
      case "--attach-to-artifacts":
        args.attachToArtifacts = true;
        break;
      case "--strict-policy":
        args.strictPolicy = true;
        break;
      case "--out":
        args.out = path.resolve(argv[i + 1]);
        i += 1;
        break;
      default:
        if (item.startsWith("--")) throw new Error(`Unknown flag: ${item}`);
    }
  }
  return args;
}

function caseRootFor(caseName) {
  if (!caseName) return undefined;
  return path.join(ROOT, "docs/artifacts/learned_samples_max", caseName);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function localCapabilities() {
  // Offline, non-invasive capability hints only. False means "known missing"; absent means "not checked".
  const condaBase = process.env.CONDA_BASE ?? path.join(process.env.HOME ?? "", "anaconda3");
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaPython = path.join(condaBase, "envs", condaEnv, "bin", "python");
  const python = existsSync(condaPython) ? condaPython : "python3";
  const canImport = (pkg) => {
    const result = spawnSync(python, ["-c", `import ${pkg}`], { stdio: "ignore" });
    return result.status === 0;
  };
  return {
    "binary:python": existsSync(condaPython) || spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0,
    "package:faster_whisper": canImport("faster_whisper"),
    "package:easyocr": canImport("easyocr")
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(SHARED_ENTRY)) {
    fail(`Shared build not found at ${SHARED_ENTRY}. Run: npm run build --workspace @vvst/shared`);
  }
  const {
    buildDefaultProviderDecisions,
    buildModelRouteSummary,
    providerDecisionsMarkdown,
    validateProviderDecisionSafety
  } = await import(SHARED_ENTRY);

  const decisions = buildDefaultProviderDecisions({
    env: process.env,
    allowCloud: args.allowCloud,
    allowSampleMediaExternal: args.allowSampleMediaExternal,
    allowQualityJudgeSampleFrames: args.allowQualityJudgeSampleFrames,
    localCapabilities: localCapabilities()
  });
  const summary = buildModelRouteSummary(decisions);
  const safetyIssues = decisions.flatMap((decision) => validateProviderDecisionSafety(decision));
  const payload = {
    mode: args.offline ? "offline" : "online",
    generatedAt: new Date().toISOString(),
    case: args.case ?? null,
    allCases: args.allCases,
    allowCloud: args.allowCloud,
    allowSampleMediaExternal: args.allowSampleMediaExternal,
    allowQualityJudgeSampleFrames: args.allowQualityJudgeSampleFrames,
    strictPolicy: args.strictPolicy,
    summary,
    effectScopeSummary: summary.effectScopeSummary,
    featureGateSummary: summary.featureGateSummary,
    providerDecisions: decisions,
    safetyIssues
  };

  await mkdir(args.out, { recursive: true });
  const jsonPath = path.join(args.out, "provider-decisions.json");
  const mdPath = path.join(args.out, "model-route-summary.md");
  await writeFile(jsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(mdPath, providerDecisionsMarkdown(decisions), "utf8");
  if (args.attachToArtifacts) {
    const targets = [];
    if (args.case) {
      const root = caseRootFor(args.case);
      if (existsSync(root)) targets.push(root);
    }
    if (args.allCases) {
      const root = path.join(ROOT, "docs/artifacts/learned_samples_max");
      if (existsSync(root)) {
        const { readdirSync, statSync } = await import("node:fs");
        for (const entry of readdirSync(root)) {
          const dir = path.join(root, entry);
          if (statSync(dir).isDirectory()) targets.push(dir);
        }
      }
    }
    for (const target of targets) {
      await writeFile(path.join(target, "model-route-summary.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
      await writeFile(path.join(target, "model-route-summary.md"), providerDecisionsMarkdown(decisions), "utf8");
    }
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(providerDecisionsMarkdown(decisions));
    console.log(`wrote ${path.relative(ROOT, jsonPath)}`);
    console.log(`wrote ${path.relative(ROOT, mdPath)}`);
  }

  const fatalIssues = [
    ...safetyIssues,
    ...decisions
      .filter((decision) => decision.requiredForCoreDemo && decision.selectedProvider === "unavailable")
      .map((decision) => `${decision.task}: required core task has no provider or fallback`),
    ...decisions
      .filter((decision) => decision.consumesSampleVideoExternally && !args.allowSampleMediaExternal)
      .map((decision) => `${decision.task}: sample video external upload without explicit flag`)
  ];
  if (args.strictPolicy) {
    fatalIssues.push(
      ...decisions
        .filter((decision) => decision.mediaAccessPolicy.rawPromptRenderable)
        .map((decision) => `${decision.task}: raw prompt renderable under strict policy`),
      ...decisions
        .filter((decision) => decision.generatedAssetProvenanceRequired && decision.providerClass !== "disabled" && !decision.mediaAccessPolicy.generatedAssetProvenanceRequired)
        .map((decision) => `${decision.task}: generated provenance policy mismatch`),
      ...decisions
        .filter((decision) => decision.consumesSamplePixelsExternally || decision.consumesSampleAudioExternally || decision.consumesSampleVideoExternally)
        .filter(() => !args.allowSampleMediaExternal)
        .map((decision) => `${decision.task}: external sample media access under strict offline policy`)
    );
  }
  if (fatalIssues.length) {
    console.error(`model route evaluation failed:\n- ${fatalIssues.join("\n- ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
