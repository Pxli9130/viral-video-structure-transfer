#!/usr/bin/env node
// Robust validator for a GeneratedEffectProposal directory. Static safety denylist + export +
// props + TS parse + fixture + (best-effort) Remotion preview. Writes validation-report.{json,md}.
// Core logic is exported (validateGeneratedEffect) for unit testing; never executes generated code.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

const REQUIRED_FILES = ["index.tsx", "schema.ts", "fixture.json", "README.md", "proposal-metadata.json"];

/** Actual exports of the installed react/remotion (used to catch removed/hallucinated named imports
 * like `Extrapolate`, which parses + passes the allowlist but is undefined at runtime → render crash). */
function installedExports(moduleName) {
  try {
    return new Set(Object.keys(require(moduleName) ?? {}));
  } catch {
    return null;
  }
}

/** Named (non-default, non-namespace) bindings imported from a given module specifier. */
function namedImportsFrom(source, moduleName) {
  const names = [];
  const re = new RegExp(`import\\s*(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`, "g");
  let m;
  while ((m = re.exec(source)) !== null) {
    for (const part of m[1].split(",")) {
      const raw = part.trim();
      if (!raw) continue;
      const name = raw.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      const isTypeOnly = /^type\s+/.test(raw);
      if (name && !isTypeOnly) names.push(name);
    }
  }
  return names;
}

// Quoted module specifiers that must never be imported by a sandbox-safe effect.
const FORBIDDEN_MODULE_RE = /['"](?:node:)?(?:fs|child_process|net|http|https|dns|tls|os|vm)['"]/;
// Literal dangerous tokens / sample leakage.
const FORBIDDEN_LITERALS = [
  "fetch(",
  "process.env",
  "eval(",
  "Function(",
  "require(",
  "import(",
  "marketing.mov",
  "editing.mov",
  "motion_graph_1.mov",
  "motion_graph_2.mov",
  "/mnt/data/",
  "test_videos/",
  "file://",
  "http://",
  "https://"
];
const FIXTURE_REQUIRED = ["durationSec", "width", "height", "fps", "assets", "texts", "colors", "beats", "proceduralFallback"];
const INDEX_ALLOWED_IMPORT = /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|remotion(?:\/.*)?|@remotion\/[\w.-]+|\.\.?\/.*)$/;
const SCHEMA_ALLOWED_IMPORT = /^(?:zod|\.\.?\/.*)$/;
const EXACT_ZOD_IMPORT_RE = /^\s*import\s*\{\s*z\s*\}\s*from\s*"zod";\s*$/m;
const FORBIDDEN_ZOD_TOKENS = [
  "z.function",
  "z.lazy",
  "z.promise",
  "z.preprocess",
  "z.custom",
  ".transform",
  ".refine",
  ".superRefine"
];
const ALLOWED_Z_CALLS = new Set(["object", "array", "string", "number", "boolean", "unknown", "record", "enum", "union", "literal", "infer"]);

function parseTsx(name, source) {
  const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // @ts-ignore — parseDiagnostics is internal but stable for syntax errors.
  const diags = sf.parseDiagnostics ?? [];
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

function collectImports(source) {
  const imports = [];
  const importRe = /(?:import|export)[^"';]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(source)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) imports.push(spec);
  }
  return imports;
}

function zodContractViolations(schemaTs, componentName) {
  const violations = [];
  const imports = collectImports(schemaTs);
  const importsZod = imports.some((spec) => spec === "zod" || spec.startsWith("zod/"));
  if (!importsZod && !/\bz\./.test(schemaTs)) return violations;
  if (!EXACT_ZOD_IMPORT_RE.test(schemaTs)) violations.push("schema_zod_import_must_be_exact");
  for (const spec of imports) {
    if (spec !== "zod") violations.push(`schema_zod_forbidden_import:${spec}`);
  }
  for (const token of FORBIDDEN_ZOD_TOKENS) {
    if (schemaTs.includes(token)) violations.push(`schema_forbidden_zod_api:${token}`);
  }
  if (/\basync\b/.test(schemaTs)) violations.push("schema_zod_async_forbidden");
  for (const match of schemaTs.matchAll(/\bz\.(\w+)/g)) {
    const api = match[1];
    if (!ALLOWED_Z_CALLS.has(api)) violations.push(`schema_zod_api_not_allowed:z.${api}`);
  }
  if (componentName) {
    const schemaName = `${componentName}PropsSchema`;
    const typeName = `${componentName}Props`;
    if (!new RegExp(`export\\s+const\\s+${schemaName}\\s*=\\s*z\\.object\\s*\\(`).test(schemaTs)) {
      violations.push(`schema_zod_missing_named_schema:${schemaName}`);
    }
    if (!new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*z\\.infer\\s*<\\s*typeof\\s+${schemaName}\\s*>`).test(schemaTs)) {
      violations.push(`schema_zod_missing_named_props_type:${typeName}`);
    }
  }
  return violations;
}

/**
 * @param {string} proposalDir
 * @param {{ previewAttempt?: boolean }} [opts]
 */
export function validateGeneratedEffect(proposalDir, opts = {}) {
  const failedChecks = [];
  const warnings = [];
  const exactErrors = [];

  // 1. Required files
  const missing = REQUIRED_FILES.filter((f) => !existsSync(path.join(proposalDir, f)));
  if (missing.length) failedChecks.push(`missing_files:${missing.join(",")}`);

  const read = (f) => (existsSync(path.join(proposalDir, f)) ? readFileSync(path.join(proposalDir, f), "utf8") : "");
  const indexTsx = read("index.tsx");
  const schemaTs = read("schema.ts");
  const code = `${indexTsx}\n${schemaTs}`;
  // W3C XML/SVG namespace URIs (http://www.w3.org/...) are inert declarative identifiers (e.g. SVG
  // xmlns), never fetched — strip them before the remote-URL literal scan so they don't false-positive.
  const urlScan = code.replace(/https?:\/\/www\.w3\.org\/[^\s"')]*/g, "");

  // 2. Static denylist
  if (FORBIDDEN_MODULE_RE.test(code)) {
    failedChecks.push("forbidden_module_import");
    exactErrors.push(`forbidden module import matched ${FORBIDDEN_MODULE_RE}`);
  }
  for (const lit of FORBIDDEN_LITERALS) {
    const hay = lit === "http://" || lit === "https://" || lit === "file://" ? urlScan : code;
    if (hay.includes(lit)) {
      failedChecks.push(`forbidden_literal:${lit}`);
      exactErrors.push(`forbidden literal present: ${lit}`);
    }
  }
  // 2b. Import allowlist — React + Remotion + relative imports in index.tsx; zod only in schema.ts.
  const badImports = new Set();
  for (const spec of collectImports(indexTsx)) {
    if (spec === "zod" || spec.startsWith("zod/")) {
      failedChecks.push("zod_import_outside_schema");
      exactErrors.push("zod may only be imported by schema.ts");
    }
    if (!INDEX_ALLOWED_IMPORT.test(spec)) badImports.add(spec);
  }
  for (const spec of collectImports(schemaTs)) {
    if (!SCHEMA_ALLOWED_IMPORT.test(spec)) badImports.add(spec);
  }
  if (badImports.size) {
    failedChecks.push("forbidden_external_import");
    exactErrors.push(`only react/remotion/relative imports in index.tsx and zod/relative imports in schema.ts are allowed; found: ${[...badImports].join(", ")}`);
  }
  // 2c. Named imports must actually EXIST in the installed react/remotion (catches removed/hallucinated
  // APIs like `Extrapolate`, which parse + pass the allowlist but are undefined at runtime → render crash).
  for (const moduleName of ["remotion", "react"]) {
    const real = installedExports(moduleName);
    if (!real) continue; // package not requireable here — skip rather than false-fail
    const missing = namedImportsFrom(indexTsx, moduleName).filter((n) => !real.has(n));
    if (missing.length) {
      failedChecks.push(`nonexistent_import:${moduleName}`);
      exactErrors.push(`index.tsx imports non-existent ${moduleName} export(s): ${[...new Set(missing)].join(", ")} (removed/renamed in the installed version — e.g. use the string "clamp" instead of Extrapolate.clamp)`);
    }
  }

  // metadata + export
  let metadata = {};
  try {
    metadata = JSON.parse(read("proposal-metadata.json") || "{}");
  } catch (e) {
    failedChecks.push("metadata_parse");
    exactErrors.push(`proposal-metadata.json parse: ${e.message}`);
  }
  const componentName = metadata.componentName;
  // 3. Component export. Record the export STYLE so the static manifest generator imports it
  // correctly: a named export -> named import; a default-only export (allowed via defaultAllowed)
  // -> default import. Without this the manifest would emit a named import for a default-only
  // component and fail to compile.
  let exportStyle; // "named" | "default" | undefined
  if (componentName) {
    const namedExport = new RegExp(`export\\s+(const|function|class)\\s+${componentName}\\b`).test(indexTsx) ||
      new RegExp(`export\\s*\\{[^}]*\\b${componentName}\\b`).test(indexTsx);
    const defaultExport = /export\s+default\b/.test(indexTsx);
    if (namedExport) exportStyle = "named";
    else if (defaultExport && metadata.defaultAllowed === true) exportStyle = "default";
    if (!namedExport && !(defaultExport && metadata.defaultAllowed === true)) {
      failedChecks.push("component_export");
      exactErrors.push(`index.tsx must export named component "${componentName}" (or default with defaultAllowed=true)`);
    }
  } else {
    warnings.push("no componentName in metadata; skipped export check");
  }

  const zodViolations = zodContractViolations(schemaTs, componentName);
  for (const violation of zodViolations) {
    failedChecks.push(violation);
    exactErrors.push(`zod schema contract violation: ${violation}`);
  }

  // 4. Props-driven
  if (indexTsx && !/props|Props|React\.FC|: React\.FunctionComponent/.test(indexTsx)) {
    failedChecks.push("not_props_driven");
    exactErrors.push("component does not appear to use props");
  }

  // 5. TS parse
  if (indexTsx) {
    const d = parseTsx("index.tsx", indexTsx);
    if (d.length) {
      failedChecks.push("ts_parse_index");
      exactErrors.push(`index.tsx parse: ${d.slice(0, 3).join("; ")}`);
    }
  }
  if (schemaTs) {
    const d = parseTsx("schema.ts", schemaTs);
    if (d.length) {
      failedChecks.push("ts_parse_schema");
      exactErrors.push(`schema.ts parse: ${d.slice(0, 3).join("; ")}`);
    }
  }

  // 6. Fixture
  let fixture;
  try {
    fixture = JSON.parse(read("fixture.json") || "null");
  } catch (e) {
    failedChecks.push("fixture_parse");
    exactErrors.push(`fixture.json parse: ${e.message}`);
  }
  if (fixture && typeof fixture === "object") {
    const miss = FIXTURE_REQUIRED.filter((k) => !(k in fixture));
    if (miss.length) {
      failedChecks.push(`fixture_missing:${miss.join(",")}`);
      exactErrors.push(`fixture.json missing: ${miss.join(", ")}`);
    }
    const hasAssets = Array.isArray(fixture.assets) && fixture.assets.length > 0;
    if (fixture.proceduralFallback !== true) {
      failedChecks.push("fixture_missing_procedural_fallback_true");
      exactErrors.push("fixture.json must include proceduralFallback=true");
    }
    if (!Array.isArray(fixture.assets)) {
      failedChecks.push("fixture_missing_assets_empty_array");
      exactErrors.push("fixture.json must include assets: []");
    } else if (hasAssets) {
      failedChecks.push("fixture_assets_must_be_empty");
      exactErrors.push("fixture.json fixture assets must be [] so procedural fallback is proven");
    }
  } else if (!failedChecks.includes("fixture_parse")) {
    failedChecks.push("fixture_missing");
  }

  // 7. Preview (best-effort; not faked)
  let previewStatus = "blocked_environment";
  if (opts.previewAttempt) {
    previewStatus = "blocked_environment"; // a real Remotion preview harness is out of scope for the validator
    warnings.push("preview attempt requested but a Remotion preview harness is not wired into the validator; recorded as environment blocker (not faked)");
  } else {
    warnings.push("preview not attempted (static+TS validation only); use the proof run for a real render");
  }

  const staticPass =
    !failedChecks.some((c) => c.startsWith("forbidden")) &&
    missing.length === 0 &&
    !failedChecks.includes("component_export") &&
    !failedChecks.some((c) => c.startsWith("fixture")) &&
    !failedChecks.some((c) => c.startsWith("schema_zod")) &&
    !failedChecks.some((c) => c.startsWith("schema_forbidden_zod")) &&
    !failedChecks.some((c) => c.startsWith("zod_import")) &&
    !failedChecks.some((c) => c.startsWith("nonexistent_import")) &&
    !failedChecks.includes("ts_parse_index") &&
    !failedChecks.includes("ts_parse_schema") &&
    !failedChecks.includes("not_props_driven");

  const previewOk = previewStatus === "pass";
  const previewEnvBlockerOnly = previewStatus === "blocked_environment";
  const validationStatus = !staticPass ? "fail" : previewOk ? "pass" : "pass_with_preview_blocker";
  const safeToApply = staticPass && (previewOk || previewEnvBlockerOnly);

  return { validationStatus, failedChecks, warnings, previewStatus, exactErrors, safeToApply, exportStyle };
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

function main() {
  const proposalDir = arg("--proposal-dir");
  const asJson = process.argv.includes("--json");
  const fixtureSafe = process.argv.includes("--fixture-safe");
  if (!proposalDir && !fixtureSafe) {
    console.error("validate-generated-effect: --proposal-dir <dir> required (or --fixture-safe for a self-check)");
    process.exit(2);
  }
  if (fixtureSafe && !proposalDir) {
    console.log("[validate-generated-effect] --fixture-safe self-check OK (denylist + parser load)");
    return;
  }
  const result = validateGeneratedEffect(proposalDir, { previewAttempt: false });
  writeFileSync(path.join(proposalDir, "validation-report.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const md = [
    "# Generated Effect Validation Report",
    "",
    `- Proposal dir: ${proposalDir}`,
    `- **Status: ${result.validationStatus}**`,
    `- safeToApply: ${result.safeToApply}`,
    `- previewStatus: ${result.previewStatus}`,
    "",
    `## Failed checks`,
    result.failedChecks.length ? result.failedChecks.map((c) => `- ${c}`).join("\n") : "- (none)",
    "",
    `## Warnings`,
    result.warnings.map((w) => `- ${w}`).join("\n"),
    "",
    `## Exact errors`,
    result.exactErrors.length ? result.exactErrors.map((e) => `- ${e}`).join("\n") : "- (none)"
  ].join("\n");
  writeFileSync(path.join(proposalDir, "validation-report.md"), `${md}\n`, "utf8");
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else console.log(`[validate-generated-effect] ${result.validationStatus} safeToApply=${result.safeToApply} failed=[${result.failedChecks.join(",")}]`);
  if (result.validationStatus === "fail") process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("validate-generated-effect.mjs");
if (isMain) main();
