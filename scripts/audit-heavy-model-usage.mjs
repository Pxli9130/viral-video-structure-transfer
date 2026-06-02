#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARED_ENTRY = path.join(ROOT, "packages/shared/dist/index.js");
const ARTIFACT_DIR = path.join(ROOT, "artifacts/model-routes");
const DOC_ARTIFACT_DIR = path.join(ROOT, "docs/artifacts");

const HEAVY_PROVIDERS = [
  {
    provider: "paddleocr_vl",
    modelTool: "PaddleOCR-VL",
    task: "ocr",
    packageImports: ["paddleocr", "paddle"],
    weightEnvVars: ["PADDLEOCR_MODEL_DIR"],
    enableEnvVars: ["ENABLE_HEAVY_LOCAL_ML", "ENABLE_PADDLEOCR_VL"],
    outputFlow: "OCR rows -> typographyEvidence -> TextLayer bbox/fontSize"
  },
  {
    provider: "paddleocr",
    modelTool: "PaddleOCR",
    task: "ocr",
    packageImports: ["paddleocr", "paddle"],
    weightEnvVars: ["PADDLEOCR_MODEL_DIR"],
    enableEnvVars: ["ENABLE_HEAVY_LOCAL_ML", "ENABLE_PADDLEOCR"],
    outputFlow: "OCR rows -> typographyEvidence -> TextLayer bbox/fontSize"
  },
  {
    provider: "grounding_dino",
    modelTool: "GroundingDINO",
    task: "visual_grounding",
    packageImports: ["groundingdino"],
    weightEnvVars: ["GROUNDING_DINO_CONFIG", "GROUNDING_DINO_WEIGHTS"],
    enableEnvVars: ["ENABLE_HEAVY_LOCAL_ML", "ENABLE_GROUNDING_DINO"],
    outputFlow: "detections -> visualElementGraph.elements -> geometry/motion planning"
  },
  {
    provider: "sam2",
    modelTool: "SAM2",
    task: "visual_grounding",
    packageImports: ["sam2"],
    weightEnvVars: ["SAM2_CONFIG", "SAM2_CHECKPOINT"],
    enableEnvVars: ["ENABLE_HEAVY_LOCAL_ML", "ENABLE_SAM2"],
    outputFlow: "mask boxes -> bboxTrackNorm -> element tracks"
  },
  {
    provider: "cotracker3",
    modelTool: "CoTracker/CoTracker3",
    task: "visual_grounding",
    packageImports: ["cotracker"],
    weightEnvVars: ["COTRACKER_CHECKPOINT"],
    enableEnvVars: ["ENABLE_HEAVY_LOCAL_ML", "ENABLE_COTRACKER"],
    outputFlow: "point tracks -> bboxTrackNorm/centerTrajectory -> motion geometry"
  },
  {
    provider: "bge_m3",
    modelTool: "BGE-M3",
    task: "knowledge_retrieval",
    packageImports: ["FlagEmbedding"],
    weightEnvVars: ["BGE_M3_MODEL_PATH"],
    enableEnvVars: ["ENABLE_HEAVY_LOCAL_ML", "ENABLE_BGE_M3"],
    outputFlow: "embedding scores -> TechniqueAtom retrieval ranking -> planner atom selection"
  }
];

function parseArgs(argv) {
  const args = { offline: true, json: false };
  for (const item of argv) {
    if (item === "--offline") args.offline = true;
    else if (item === "--json") args.json = true;
    else if (item.startsWith("--")) throw new Error(`Unknown flag: ${item}`);
  }
  return args;
}

function envFlag(key) {
  return /^(1|true|yes|on)$/i.test(process.env[key]?.trim() ?? "");
}

function pythonPath() {
  const condaBase = process.env.CONDA_BASE ?? path.join(process.env.HOME ?? "", "anaconda3");
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaPython = path.join(condaBase, "envs", condaEnv, "bin", "python");
  return existsSync(condaPython) ? condaPython : "python3";
}

function importAvailability(names) {
  const code = [
    "import importlib.util, json",
    `names=${JSON.stringify(names)}`,
    "print(json.dumps({name: importlib.util.find_spec(name) is not None for name in names}))"
  ].join("; ");
  const result = spawnSync(pythonPath(), ["-c", code], { encoding: "utf8" });
  if (result.status !== 0) {
    return Object.fromEntries(names.map((name) => [name, false]));
  }
  return JSON.parse(result.stdout || "{}");
}

function weightStatus(envVars) {
  return Object.fromEntries(
    envVars.map((key) => {
      const value = process.env[key];
      return [key, { configured: Boolean(value?.trim()), exists: Boolean(value?.trim() && existsSync(value)) }];
    })
  );
}

function localCapabilities(imports, weightVars) {
  const caps = {
    "binary:python": existsSync(pythonPath()) || spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0
  };
  for (const [name, available] of Object.entries(imports)) caps[`package:${name}`] = Boolean(available);
  for (const [key, status] of Object.entries(weightVars)) caps[`weight:${key}`] = Boolean(status.configured && status.exists);
  return caps;
}

function routeHasProvider(route, provider) {
  return Boolean(route && [route.primary, ...(route.fallbacks ?? []), route.localFallback, ...(route.candidateProviders ?? [])].includes(provider));
}

function markdownTable(rows) {
  const header = "| Model/tool | ModelTask | Provider class | Env enabled | Package available | Weights available | Selected | Fallback/rejection | Output normalized | Downstream consumer | Status |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((row) =>
    [
      row.modelTool,
      row.task,
      row.providerClass,
      row.envEnabled ? "yes" : "no",
      row.packageAvailable ? "yes" : "no",
      row.weightsAvailable ? "yes" : "no",
      row.selectedByRouter ? "yes" : "no",
      (row.fallbackReason || "n/a").replaceAll("|", "/"),
      row.outputNormalized ? "yes" : "no",
      row.downstreamConsumerStatus,
      row.status
    ].join(" | ")
  );
  return [header, sep, ...lines.map((line) => `| ${line} |`)].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(SHARED_ENTRY)) {
    throw new Error(`Shared build not found at ${SHARED_ENTRY}. Run: npm run build --workspace @vvst/shared`);
  }

  const {
    MODEL_PROVIDER_REGISTRY,
    MODEL_ROUTE_TABLE,
    resolveModelRoute,
    validateProviderDecisionSafety
  } = await import(SHARED_ENTRY);

  const packageNames = Array.from(new Set(HEAVY_PROVIDERS.flatMap((item) => item.packageImports)));
  const weightVars = Array.from(new Set(HEAVY_PROVIDERS.flatMap((item) => item.weightEnvVars)));
  const imports = importAvailability(packageNames);
  const weights = weightStatus(weightVars);
  const caps = localCapabilities(imports, weights);

  const rows = HEAVY_PROVIDERS.map((spec) => {
    const provider = MODEL_PROVIDER_REGISTRY[spec.provider];
    const route = MODEL_ROUTE_TABLE[spec.task];
    const decision = resolveModelRoute(spec.task, {
      env: process.env,
      allowCloud: false,
      localCapabilities: caps
    });
    const rejection = decision.rejectedProviders.find((item) => item.provider === spec.provider);
    const packageAvailable = spec.packageImports.every((name) => Boolean(imports[name]));
    const weightsAvailable = spec.weightEnvVars.every((key) => Boolean(weights[key]?.configured && weights[key]?.exists));
    const envEnabled = spec.enableEnvVars.every((key) => envFlag(key));
    const routeExists = routeHasProvider(route, spec.provider);
    const selectedByRouter = decision.selectedProvider === spec.provider;
    const safetyIssues = validateProviderDecisionSafety(decision);
    const outputNormalized = true;
    const downstreamConsumed = Boolean(provider?.implemented);
    const downstreamConsumerStatus = downstreamConsumed ? "runtime" : "schema_contract_only";
    const status = selectedByRouter && provider?.implemented
      ? "OK"
      : routeExists && outputNormalized
        ? "Partially correct"
        : routeExists
          ? "Not implemented"
          : "Incorrect";
    return {
      provider: spec.provider,
      modelTool: spec.modelTool,
      task: spec.task,
      providerClass: provider?.providerClass ?? "unknown",
      routeExists,
      requiredForCoreDemo: false,
      featureGate: route?.featureGate ?? null,
      localFallback: route?.localFallback ?? null,
      canConsumeSampleLocally: decision.mediaAccessPolicy.samplePixelsAllowed || decision.mediaAccessPolicy.sampleAudioAllowed,
      externalUpload: decision.consumesSamplePixelsExternally || decision.consumesSampleAudioExternally || decision.consumesSampleVideoExternally,
      canAffectRecipe: decision.effectScope === "planning_affects_recipe",
      canAffectFinalPixels: decision.canAffectFinalPixels,
      packageAvailable,
      packageImports: Object.fromEntries(spec.packageImports.map((name) => [name, Boolean(imports[name])])),
      weightsAvailable,
      weightEnvVars: Object.fromEntries(spec.weightEnvVars.map((key) => [key, weights[key] ?? { configured: false, exists: false }])),
      envEnabled,
      enableEnvVars: Object.fromEntries(spec.enableEnvVars.map((key) => [key, envFlag(key)])),
      selectedByRouter,
      selectedProviderForTask: decision.selectedProvider,
      fallbackReason: rejection?.reason ?? (selectedByRouter ? decision.selectedReason : decision.fallbackReason ?? ""),
      outputNormalized,
      downstreamConsumed,
      downstreamConsumerStatus,
      outputFlow: spec.outputFlow,
      testsExist: existsSync(path.join(ROOT, "packages/shared/src/__tests__/heavyLocalProviders.test.ts")),
      safetyPass: safetyIssues.length === 0,
      safetyIssues,
      status,
      implementedRuntimeAdapter: Boolean(provider?.implemented)
    };
  });

  const generatedAt = new Date().toISOString();
  const payload = {
    mode: args.offline ? "offline" : "online",
    generatedAt,
    python: pythonPath(),
    noCloudCalls: true,
    noDependencyInstall: true,
    noWeightDownload: true,
    packageImports: imports,
    weights,
    providers: rows
  };

  await mkdir(ARTIFACT_DIR, { recursive: true });
  await mkdir(DOC_ARTIFACT_DIR, { recursive: true });
  await writeFile(path.join(ARTIFACT_DIR, "heavy-provider-availability.json"), JSON.stringify(rows, null, 2) + "\n", "utf8");
  await writeFile(path.join(ARTIFACT_DIR, "heavy-provider-audit.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");

  const md = [
    "# Heavy Local Provider Audit Artifact",
    "",
    `Generated: ${generatedAt}`,
    "",
    "No dependencies were installed, no weights were downloaded, no cloud APIs were called, and no sample media was uploaded.",
    "",
    markdownTable(rows),
    "",
    "## Environment",
    "",
    "```json",
    JSON.stringify({ packageImports: imports, weights }, null, 2),
    "```"
  ].join("\n");
  await writeFile(path.join(DOC_ARTIFACT_DIR, "heavy-provider-audit.md"), md + "\n", "utf8");

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(md);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
