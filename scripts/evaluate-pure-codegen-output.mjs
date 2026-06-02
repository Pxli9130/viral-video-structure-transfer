#!/usr/bin/env node
// Report-only evaluator for pure Gemini codegen outputs.
//
// It reads a live-codegen run directory. If pure-codegen-output.json files already exist, it scores
// them. If they do not exist, it backfills them from the recorded raw Gemini artifacts:
// - gemini-layer-plan.raw.json
// - actual-codegen-layers.json
// - proposal/gemini-raw-response.txt
// - proposal-summary.json
//
// This never changes final gates. It only writes pure-codegen-output.{json,md} per case and the
// run-level PURE_CODEGEN_OUTPUT_EVAL_REPORT.{json,md}.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CASES = ["marketing", "motion_graph_1", "motion_graph_2", "editing"];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function defaultRunDir() {
  const latest = path.join(ROOT, "docs/artifacts/codegen-live-eval/latest-run.txt");
  if (existsSync(latest)) {
    const text = readFileSync(latest, "utf8").trim();
    if (text) return path.resolve(text);
  }
  return path.join(ROOT, "docs/artifacts/codegen-live-eval/live-eval-20260602-r3");
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function collectImports(source) {
  const imports = [];
  const importRe = /(?:import|export)[^"';]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(source ?? "")) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) imports.push(spec);
  }
  return imports;
}

const INDEX_ALLOWED_IMPORT = /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|remotion(?:\/.*)?|@remotion\/[\w.-]+|\.\.?\/.*)$/;
const SCHEMA_ALLOWED_IMPORT = /^(?:zod|\.\.?\/.*)$/;
const EXACT_ZOD_IMPORT_RE = /^\s*import\s*\{\s*z\s*\}\s*from\s*"zod";\s*$/m;
const FORBIDDEN_ZOD_TOKENS = ["z.function", "z.lazy", "z.promise", "z.preprocess", "z.custom", ".transform", ".refine", ".superRefine"];
const ALLOWED_Z_CALLS = new Set(["object", "array", "string", "number", "boolean", "unknown", "record", "enum", "union", "literal", "infer"]);
const FORBIDDEN_SAMPLE_RE = /\/mnt\/data\/|test_videos\/|marketing\.mov|motion_graph_1\.mov|motion_graph_2\.mov|editing\.mov|fen?da|douyin|xiaohongshu|小红书|抖音/i;

function proposalFromParsed(parsed, summary, caseId) {
  if (!parsed || typeof parsed !== "object") return undefined;
  const required = ["indexTsx", "schemaTs", "fixtureJson", "readmeMd"];
  if (!required.every((key) => typeof parsed[key] === "string" && parsed[key])) return undefined;
  return {
    version: "generated-effect-proposal.v1",
    effectId: typeof parsed.effectId === "string" && parsed.effectId ? parsed.effectId : `${caseId}_gemini_effect`,
    componentName: typeof parsed.componentName === "string" && parsed.componentName ? parsed.componentName : "GeneratedEffect",
    files: {
      "index.tsx": parsed.indexTsx,
      "schema.ts": parsed.schemaTs,
      "fixture.json": parsed.fixtureJson,
      "README.md": parsed.readmeMd
    },
    provider: "gemini",
    statusFromDownstream: summary?.status ?? null
  };
}

function envelopeValidation(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== "object") errors.push("proposal is not an object");
  else {
    for (const key of ["effectId", "componentName", "indexTsx", "schemaTs", "fixtureJson", "readmeMd"]) {
      if (typeof parsed[key] !== "string" || !parsed[key]) errors.push(`${key} missing`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function fixtureContract(parsedProposal) {
  if (!parsedProposal?.files?.["fixture.json"]) return { ok: false, detail: "missing fixtureJson" };
  try {
    const fixture = JSON.parse(parsedProposal.files["fixture.json"]);
    const assetsOk = Array.isArray(fixture.assets) && fixture.assets.length === 0;
    const fallbackOk = fixture.proceduralFallback === true;
    return { ok: assetsOk && fallbackOk, detail: `assets=${Array.isArray(fixture.assets) ? fixture.assets.length : "missing"}, proceduralFallback=${fixture.proceduralFallback}` };
  } catch (error) {
    return { ok: false, detail: `fixture parse failed: ${error.message}` };
  }
}

function zodContractViolations(schemaTs, componentName) {
  const violations = [];
  const imports = collectImports(schemaTs);
  const importsZod = imports.some((spec) => spec === "zod" || spec.startsWith("zod/"));
  if (!importsZod && !/\bz\./.test(schemaTs ?? "")) return violations;
  if (!EXACT_ZOD_IMPORT_RE.test(schemaTs)) violations.push("schema_zod_import_must_be_exact");
  for (const spec of imports) {
    if (spec !== "zod") violations.push(`schema_zod_forbidden_import:${spec}`);
  }
  for (const token of FORBIDDEN_ZOD_TOKENS) {
    if ((schemaTs ?? "").includes(token)) violations.push(`schema_forbidden_zod_api:${token}`);
  }
  if (/\basync\b/.test(schemaTs ?? "")) violations.push("schema_zod_async_forbidden");
  for (const match of (schemaTs ?? "").matchAll(/\bz\.(\w+)/g)) {
    if (!ALLOWED_Z_CALLS.has(match[1])) violations.push(`schema_zod_api_not_allowed:z.${match[1]}`);
  }
  if (componentName) {
    const schemaName = `${componentName}PropsSchema`;
    const typeName = `${componentName}Props`;
    if (!new RegExp(`export\\s+const\\s+${schemaName}\\s*=\\s*z\\.object\\s*\\(`).test(schemaTs ?? "")) violations.push(`schema_zod_missing_named_schema:${schemaName}`);
    if (!new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*z\\.infer\\s*<\\s*typeof\\s+${schemaName}\\s*>`).test(schemaTs ?? "")) violations.push(`schema_zod_missing_named_props_type:${typeName}`);
  }
  return violations;
}

function contractViolations(parsedProposal) {
  if (!parsedProposal) return ["proposal_parse_or_envelope_failed"];
  const violations = [];
  const indexTsx = parsedProposal.files["index.tsx"];
  const schemaTs = parsedProposal.files["schema.ts"];
  for (const spec of collectImports(indexTsx)) {
    if (spec === "zod" || spec.startsWith("zod/")) violations.push("zod_import_outside_schema");
    if (!INDEX_ALLOWED_IMPORT.test(spec)) violations.push(`forbidden_external_import:${spec}`);
  }
  for (const spec of collectImports(schemaTs)) {
    if (!SCHEMA_ALLOWED_IMPORT.test(spec)) violations.push(`forbidden_external_import:${spec}`);
  }
  violations.push(...zodContractViolations(schemaTs, parsedProposal.componentName));
  const fixture = fixtureContract(parsedProposal);
  if (!fixture.ok) violations.push(`fixture_contract:${fixture.detail}`);
  return violations;
}

function add(checks, id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail });
}

function evaluatePure(output) {
  const checks = [];
  const pure = output.remotionProposal?.pureGeminiOutput;
  const fixture = fixtureContract(pure?.parsedProposal);
  const rawOrParsed = JSON.stringify({ layerPlan: output.layerPlan?.parsedJson, remotionProposalRaw: pure?.rawResponse, parsedProposal: pure?.parsedProposal });
  const forbiddenSampleMatch = rawOrParsed.match(FORBIDDEN_SAMPLE_RE);
  add(checks, "layer_plan_raw_recorded", Boolean(output.layerPlan?.rawResponse), "Gemini layer-plan raw API response recorded");
  add(checks, "layer_plan_parsed_object", Boolean(output.layerPlan?.parsedJson && typeof output.layerPlan.parsedJson === "object"), "Gemini layer-plan parsed JSON recorded");
  add(checks, "remotion_raw_recorded", Boolean(pure?.rawResponse), pure?.rawResponse ? "Gemini Remotion raw text recorded" : `no raw Remotion response; status=${pure?.status ?? "missing"}`);
  add(checks, "remotion_envelope_valid", pure?.envelopeValidation?.valid === true, pure?.envelopeValidation ? `valid=${pure.envelopeValidation.valid}; errors=${pure.envelopeValidation.errors.join(";") || "none"}` : "no envelope validation");
  add(checks, "remotion_contract_safe", Array.isArray(pure?.contractViolations) && pure.contractViolations.length === 0, `contractViolations=${JSON.stringify(pure?.contractViolations ?? null)}`);
  add(checks, "remotion_fixture_fallback_safe", fixture.ok, fixture.detail);
  add(checks, "pure_output_no_sample_literals", !forbiddenSampleMatch, forbiddenSampleMatch ? `matched forbidden literal "${forbiddenSampleMatch[0]}"` : "pure Gemini output does not contain sample paths/platform/source literals");
  add(checks, "pre_gate_only_not_final_success", true, `downstream proposal status remains ${output.remotionProposal?.downstreamStatus ?? "unknown"}`);
  const failures = checks.filter((check) => !check.ok);
  return { schema: "pure-codegen-output-eval.v1", reportOnly: true, pass: failures.length === 0, failures: failures.map((f) => f.id), checks };
}

function buildOutputFromExisting(caseDir, caseId, model) {
  const existing = path.join(caseDir, "pure-codegen-output.json");
  if (existsSync(existing)) return readJson(existing);

  const layerRawPath = path.join(caseDir, "gemini-layer-plan.raw.json");
  const layerParsedPath = path.join(caseDir, "actual-codegen-layers.json");
  const proposalRawPath = path.join(caseDir, "proposal/gemini-raw-response.txt");
  const proposalSummaryPath = path.join(caseDir, "proposal-summary.json");
  const rawResponse = existsSync(proposalRawPath) ? readFileSync(proposalRawPath, "utf8") : "";
  const parsed = rawResponse ? extractJson(rawResponse) : undefined;
  const summary = existsSync(proposalSummaryPath) ? readJson(proposalSummaryPath) : null;
  const parsedProposal = proposalFromParsed(parsed, summary, caseId);
  const envelope = envelopeValidation(parsed);
  const violations = envelope.valid ? contractViolations(parsedProposal) : ["proposal_parse_or_envelope_failed"];
  const status = !rawResponse
    ? "not_called"
    : !parsed
      ? "parse_failed"
      : !envelope.valid
        ? "parsed_invalid_envelope"
        : violations.length
          ? "parsed_contract_failed"
          : "parsed_contract_pass";
  const output = {
    schema: "pure-codegen-output.v1",
    caseId,
    model,
    layerPlan: {
      rawResponse: existsSync(layerRawPath) ? readFileSync(layerRawPath, "utf8") : "",
      parsedJson: existsSync(layerParsedPath) ? readJson(layerParsedPath) : null
    },
    remotionProposal: {
      downstreamStatus: summary?.status ?? null,
      downstreamProvider: summary?.provider ?? null,
      model: summary?.model ?? model,
      promptHash: summary?.promptHash ?? null,
      pureGeminiOutput: {
        status,
        rawResponse: rawResponse || undefined,
        parsedJson: parsed,
        parsedProposal,
        envelopeValidation: envelope,
        contractViolations: violations
      }
    }
  };
  output.reportOnlyEval = evaluatePure(output);
  return output;
}

function mdTable(rows) {
  return rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
}

function renderMarkdown(report) {
  const rows = report.cases.map((c) => [
    c.caseId,
    c.eval.pass ? "PASS" : `REPORT_FAIL: ${c.eval.failures.join(", ")}`,
    c.remotionProposal?.pureGeminiOutput?.status ?? "missing",
    c.remotionProposal?.downstreamStatus ?? "unknown",
    c.eval.checks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.detail}`).join("; ") || "none"
  ]);
  return [
    "# Pure Codegen Output Eval Report",
    "",
    `- Run dir: \`${report.runDir}\``,
    `- Gemini model: \`${report.model}\``,
    "- Scope: report-only eval of pure Gemini outputs before downstream gates transform, repair, fallback, promote, or reject them.",
    "- This report does not decide final success and does not disable motif/effect/strict gates.",
    "",
    mdTable([
      ["Case", "Report-only result", "Pure Remotion status", "Downstream proposal status", "Pure-output gaps"],
      ["---", "---", "---", "---", "---"],
      ...rows
    ]),
    "",
    "## Details",
    "",
    report.cases.map((c) => [`### ${c.caseId}`, "", ...c.eval.checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`)].join("\n")).join("\n\n"),
    ""
  ].join("\n");
}

const runDir = path.resolve(arg("--run-dir", defaultRunDir()));
const liveReportPath = path.join(runDir, "CODEGEN_LIVE_EVAL_REPORT.json");
const liveReport = existsSync(liveReportPath) ? readJson(liveReportPath) : {};
const model = liveReport.model ?? "unknown";
const cases = CASES.filter((caseId) => existsSync(path.join(runDir, caseId))).map((caseId) => {
  const caseDir = path.join(runDir, caseId);
  const output = buildOutputFromExisting(caseDir, caseId, model);
  const withEval = { ...output, eval: evaluatePure(output) };
  writeFileSync(path.join(caseDir, "pure-codegen-output.json"), `${JSON.stringify({ ...output, reportOnlyEval: withEval.eval }, null, 2)}\n`);
  writeFileSync(path.join(caseDir, "pure-codegen-output.md"), renderMarkdown({ runDir, model, cases: [withEval] }));
  return withEval;
});

const report = {
  schema: "pure-codegen-output-eval-report.v1",
  reportOnly: true,
  runDir,
  model,
  total: cases.length,
  passed: cases.filter((c) => c.eval.pass).length,
  failed: cases.filter((c) => !c.eval.pass).length,
  cases
};

writeFileSync(path.join(runDir, "PURE_CODEGEN_OUTPUT_EVAL_REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(runDir, "PURE_CODEGEN_OUTPUT_EVAL_REPORT.md"), renderMarkdown(report));
console.log(`Wrote ${path.join(runDir, "PURE_CODEGEN_OUTPUT_EVAL_REPORT.md")}`);
