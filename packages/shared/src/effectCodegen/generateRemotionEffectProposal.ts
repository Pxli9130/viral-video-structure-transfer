// Generate a GeneratedEffectProposal for a CreativeEffectSpec. Calls Gemini ONLY when explicitly
// enabled (GEMINI_API_KEY + CREATIVE_EFFECT_GEMINI=1 + ALLOW_CLOUD_PROVIDERS=1); otherwise produces a
// safe local_fallback proposal. Provider failures are never hidden — they are recorded and a local
// fallback is returned so the dry-run can still validate. This module NEVER executes generated code.

import type { CreativeEffectSpec, MotifFamily } from "../engine/creativeEffectSpec.js";
import { MOTIF_DEFAULT_COLORS } from "../engine/creativeEffectSpec.js";
import type { GeneratedEffectProposal, GeneratedEffectProposalFiles } from "../engine/generatedEffectProposal.js";
import { validateGeneratedEffectProposalEnvelope } from "../engine/generatedEffectProposal.js";
import { buildGeminiEffectPrompt, type BuildEffectPromptInput } from "./buildGeminiEffectPrompt.js";

export type ProposalStatus = "gemini_ok" | "local_fallback" | "provider_error" | "invalid_response";

export interface GenerateProposalResult {
  proposal: GeneratedEffectProposal;
  status: ProposalStatus;
  provider: "gemini" | "local_fallback";
  model?: string;
  promptHash: string;
  prompt: string;
  rawResponse?: string;
  pureGeminiOutput?: PureGeminiEffectOutput;
  error?: string;
}

export interface PureGeminiEffectOutput {
  status:
    | "not_called"
    | "provider_error"
    | "parse_failed"
    | "raw_received"
    | "parsed_invalid_envelope"
    | "parsed_contract_failed"
    | "parsed_contract_pass";
  rawResponse?: string;
  parsedJson?: unknown;
  parsedProposal?: GeneratedEffectProposal;
  envelopeValidation?: ReturnType<typeof validateGeneratedEffectProposalEnvelope>;
  contractViolations?: string[];
  error?: string;
}

export interface GenerateProposalOptions {
  env?: NodeJS.ProcessEnv;
  createdAt?: string;
  /** Test seam: inject a Gemini caller so unit tests don't hit the network. */
  geminiCall?: (prompt: string, model: string) => Promise<string>;
}

function isoNow(input?: string): string {
  return input && typeof input === "string" ? input : new Date().toISOString();
}

function geminiEnabled(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.GEMINI_API_KEY && env.CREATIVE_EFFECT_GEMINI === "1" && env.ALLOW_CLOUD_PROVIDERS === "1");
}

/** Templated, sandbox-safe local fallback files (valid TSX, props-driven, no denylisted tokens). */
function localFallbackFiles(spec: CreativeEffectSpec): GeneratedEffectProposalFiles {
  const componentName = spec.effectName;
  const colors = MOTIF_DEFAULT_COLORS[spec.motifFamily] ?? MOTIF_DEFAULT_COLORS.generic_motion_graph;
  const indexTsx = `import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { ${componentName}Props } from "./schema";

// Local fallback effect for motif "${spec.motifFamily}" — procedural, props-driven, sandbox-safe.
export const ${componentName}: React.FC<${componentName}Props> = (props) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const colors = props.colors && props.colors.length ? props.colors : ${JSON.stringify(colors)};
  const bg = colors[0];
  const accent = colors[1 % colors.length];
  const ink = colors[colors.length - 1];
  const texts = props.texts ?? [];
  const headline = texts.length ? texts[0].text : "${componentName}";
  const bars = Array.from({ length: 8 }, (_, i) => {
    const x = ((i / 8) * width + t * 120) % width;
    return (
      <div key={i} style={{ position: "absolute", left: x, top: 0, width: 10, height, background: accent, opacity: 0.4 }} />
    );
  });
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden" }}>
      {bars}
      <div style={{ position: "absolute", top: height * 0.42, width, textAlign: "center", color: ink, fontSize: Math.round(height * 0.08), fontWeight: 800 }}>
        {headline}
      </div>
    </AbsoluteFill>
  );
};

export default ${componentName};
`;
  const schemaTs = `export interface ${componentName}Props {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  assets?: Array<{ id: string; src?: string; role?: string; type?: string }>;
  texts?: Array<{ id?: string; text: string; role?: string }>;
  colors?: string[];
  beats?: number[];
}
`;
  const fixtureJson = `${JSON.stringify(
    {
      durationSec: 15,
      width: 720,
      height: 1280,
      fps: 30,
      texts: [{ text: "Product", role: "product_name" }],
      colors,
      beats: [0, 0.5, 1, 1.5, 2],
      assets: [],
      proceduralFallback: true
    },
    null,
    2
  )}\n`;
  const readmeMd = `# ${componentName}

Local fallback Remotion effect for motif family \`${spec.motifFamily}\`.

## Props
- width, height, fps, durationSec
- assets?: optional media (renders procedural fallback when absent)
- texts?: product name / selling points / CTA
- colors?: palette (defaults to the motif palette)
- beats?: beat timestamps in seconds

## Motif
${spec.visualDescription}

Generated as a local fallback (no Gemini). Props-driven, no fs/network/env.
`;
  return { "index.tsx": indexTsx, "schema.ts": schemaTs, "fixture.json": fixtureJson, "README.md": readmeMd };
}

function localFallbackProposal(spec: CreativeEffectSpec, promptHash: string, createdAt: string): GeneratedEffectProposal {
  return {
    version: "generated-effect-proposal.v1",
    effectId: `${spec.effectName}_local_${spec.motifFamily}`,
    motifFamily: spec.motifFamily as MotifFamily,
    effectName: spec.effectName,
    componentName: spec.effectName,
    files: localFallbackFiles(spec),
    provider: "local_fallback",
    promptHash,
    safetyNotes: ["local fallback (no Gemini)", "procedural, props-driven, no fs/network/env"],
    createdAt
  };
}

// Static safety/contract scan mirroring scripts/validate-generated-effect.mjs. Kept in sync so the in-process
// codegen module NEVER reports gemini_ok / repaired for code the apply-time validator would reject
// (failures are never hidden).
const FORBIDDEN_MODULE_RE = /['"](?:node:)?(?:fs|child_process|net|http|https|dns|tls|os|vm)['"]/;
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

function collectImports(source: string): string[] {
  const imports: string[] = [];
  const importRe = /(?:import|export)[^"';]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec) imports.push(spec);
  }
  return imports;
}

function fixtureContractViolations(fixtureJson: string): string[] {
  const violations: string[] = [];
  try {
    const fixture = JSON.parse(fixtureJson) as { proceduralFallback?: unknown; assets?: unknown };
    if (fixture.proceduralFallback !== true) violations.push("fixture_missing_procedural_fallback_true");
    if (!Array.isArray(fixture.assets)) violations.push("fixture_missing_assets_empty_array");
    else if (fixture.assets.length !== 0) violations.push("fixture_assets_must_be_empty");
  } catch {
    violations.push("fixture_parse");
  }
  return violations;
}

function zodContractViolations(schemaTs: string, componentName?: string): string[] {
  const violations: string[] = [];
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

/** Return static safety + contract violations, mirroring the apply-time validator. */
function scanProposalContractViolations(files: GeneratedEffectProposalFiles, componentName?: string): string[] {
  const violations: string[] = [];
  const code = `${files["index.tsx"]}\n${files["schema.ts"]}`;
  if (FORBIDDEN_MODULE_RE.test(code)) violations.push("forbidden_module_import");
  for (const lit of FORBIDDEN_LITERALS) {
    if (code.includes(lit)) violations.push(`forbidden_literal:${lit}`);
  }
  const indexImports = collectImports(files["index.tsx"]);
  const schemaImports = collectImports(files["schema.ts"]);
  const bad = new Set<string>();
  for (const spec of indexImports) {
    if (spec === "zod" || spec.startsWith("zod/")) violations.push("zod_import_outside_schema");
    if (!INDEX_ALLOWED_IMPORT.test(spec)) bad.add(spec);
  }
  for (const spec of schemaImports) {
    if (!SCHEMA_ALLOWED_IMPORT.test(spec)) bad.add(spec);
  }
  if (bad.size) violations.push(`forbidden_external_import:${[...bad].join(",")}`);
  violations.push(...zodContractViolations(files["schema.ts"], componentName));
  violations.push(...fixtureContractViolations(files["fixture.json"]));
  return violations;
}

/** Extract the first balanced JSON object from a possibly-noisy model response. */
function extractJson(text: string): unknown | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

async function defaultGeminiCall(prompt: string, model: string, env: NodeJS.ProcessEnv): Promise<string> {
  const baseUrl = (env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  // Heavy reasoning models (e.g. gemini-2.5-pro) generating a full component routinely exceed 60s;
  // default to 120s and let GEMINI_TIMEOUT_MS override for faster/slower models.
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS) > 0 ? Number(env.GEMINI_TIMEOUT_MS) : 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": String(env.GEMINI_API_KEY) },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Gemini codegen HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    };
    if (data.promptFeedback?.blockReason) throw new Error(`Gemini codegen blocked: ${data.promptFeedback.blockReason}`);
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      throw new Error(`Gemini codegen returned empty content${candidate?.finishReason ? ` (finishReason=${candidate.finishReason})` : ""}`);
    }
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Gemini codegen timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function proposalFromGeminiJson(spec: { motifFamily: MotifFamily; effectName: string }, parsed: unknown, model: string, promptHash: string, createdAt: string): GeneratedEffectProposal | undefined {
  const o = parsed as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") return undefined;
  const indexTsx = o.indexTsx;
  const schemaTs = o.schemaTs;
  const fixtureJson = o.fixtureJson;
  const readmeMd = o.readmeMd;
  if (typeof indexTsx !== "string" || typeof schemaTs !== "string" || typeof fixtureJson !== "string" || typeof readmeMd !== "string") {
    return undefined;
  }
  const componentName = typeof o.componentName === "string" && o.componentName ? o.componentName : spec.effectName;
  return {
    version: "generated-effect-proposal.v1",
    effectId: typeof o.effectId === "string" && o.effectId ? o.effectId : `${spec.effectName}_gemini_${spec.motifFamily}`,
    motifFamily: spec.motifFamily as MotifFamily,
    effectName: spec.effectName,
    componentName,
    files: { "index.tsx": indexTsx, "schema.ts": schemaTs, "fixture.json": fixtureJson, "README.md": readmeMd },
    provider: "gemini",
    model,
    promptHash,
    safetyNotes: Array.isArray(o.safetyNotes) ? (o.safetyNotes.filter((s) => typeof s === "string") as string[]) : [],
    createdAt
  };
}

export interface RepairProposalResult {
  proposal: GeneratedEffectProposal;
  status: "repaired" | "repair_failed" | "repair_skipped";
  model?: string;
  rawResponse?: string;
  error?: string;
}

/**
 * Ask Gemini to rewrite ONLY the failed files of a proposal, preserving componentName/effectId.
 * Requires a geminiCall (or enabled env). When Gemini is unavailable the original proposal is
 * returned with status "repair_skipped" — never faked as repaired.
 */
export async function repairGeneratedEffectProposal(
  proposal: GeneratedEffectProposal,
  validationErrors: string[],
  options: GenerateProposalOptions = {}
): Promise<RepairProposalResult> {
  const env = options.env ?? process.env;
  const model = env.GEMINI_CODEGEN_MODEL ?? env.AI_GEMINI_MODEL ?? "gemini-3.5-flash";
  if (!options.geminiCall && !geminiEnabled(env)) {
    return { proposal, status: "repair_skipped", error: "Gemini disabled; cannot repair (need GEMINI_API_KEY + CREATIVE_EFFECT_GEMINI=1 + ALLOW_CLOUD_PROVIDERS=1)" };
  }
  const repairPrompt = [
    "The following generated Remotion effect FAILED validation. Rewrite ONLY the files needed to fix",
    `these errors. Keep componentName="${proposal.componentName}" and effectId="${proposal.effectId}".`,
    "Obey the same safety rules (no fs/child_process/net/http/https/fetch/process.env/eval/Function/require/dynamic import/remote URLs/external packages/sample paths).",
    "Output STRICT JSON ONLY with keys: effectId, componentName, indexTsx, schemaTs, fixtureJson, readmeMd, safetyNotes.",
    "",
    "Validation errors:",
    ...validationErrors.map((e) => `- ${e}`),
    "",
    "Current index.tsx:",
    proposal.files["index.tsx"],
    "",
    "Current schema.ts:",
    proposal.files["schema.ts"],
    "",
    "Current fixture.json:",
    proposal.files["fixture.json"]
  ].join("\n");

  let rawResponse = "";
  try {
    const caller = options.geminiCall ?? ((p, m) => defaultGeminiCall(p, m, env));
    rawResponse = await caller(repairPrompt, model);
    let parsed = extractJson(rawResponse) ?? extractJson(rawResponse.replace(/```(json)?/gi, ""));
    const fileObj = parsed;
    const repaired = fileObj !== undefined
      ? proposalFromGeminiJson(
          { motifFamily: proposal.motifFamily, effectName: proposal.effectName },
          fileObj,
          model,
          proposal.promptHash,
          isoNow(options.createdAt)
        )
      : undefined;
    if (repaired && validateGeneratedEffectProposalEnvelope(repaired).valid) {
      // preserve identity
      repaired.componentName = proposal.componentName;
      repaired.effectId = proposal.effectId;
      // A repair is only "repaired" if it also passes the static safety scan — otherwise we'd claim
      // success for code the apply-time validator would reject (failures are never hidden).
      const violations = scanProposalContractViolations(repaired.files, repaired.componentName);
      if (violations.length) {
        return { proposal, status: "repair_failed", model, rawResponse, error: `repair still violates safety rules: ${violations.join("; ")}` };
      }
      return { proposal: repaired, status: "repaired", model, rawResponse };
    }
    return { proposal, status: "repair_failed", model, rawResponse, error: "repair response was not a valid proposal envelope" };
  } catch (error) {
    return { proposal, status: "repair_failed", model, rawResponse: rawResponse || undefined, error: `repair failed: ${(error as Error).message}` };
  }
}

export async function generateRemotionEffectProposal(
  input: BuildEffectPromptInput,
  options: GenerateProposalOptions = {}
): Promise<GenerateProposalResult> {
  const env = options.env ?? process.env;
  const createdAt = isoNow(options.createdAt);
  const { prompt, promptHash } = buildGeminiEffectPrompt(input);
  const model = env.GEMINI_CODEGEN_MODEL ?? env.AI_GEMINI_MODEL ?? "gemini-3.5-flash";

  if (!geminiEnabled(env) && !options.geminiCall) {
    return {
      proposal: localFallbackProposal(input.spec, promptHash, createdAt),
      status: "local_fallback",
      provider: "local_fallback",
      promptHash,
      prompt,
      pureGeminiOutput: { status: "not_called" },
      error: "Gemini disabled (need GEMINI_API_KEY + CREATIVE_EFFECT_GEMINI=1 + ALLOW_CLOUD_PROVIDERS=1)"
    };
  }

  let rawResponse = "";
  let pureGeminiOutput: PureGeminiEffectOutput | undefined;
  try {
    const caller = options.geminiCall ?? ((p, m) => defaultGeminiCall(p, m, env));
    rawResponse = await caller(prompt, model);
    let parsed = extractJson(rawResponse);
    if (parsed === undefined) {
      // one repair attempt: strip code fences then re-extract
      parsed = extractJson(rawResponse.replace(/```(json)?/gi, ""));
    }
    pureGeminiOutput = { status: parsed === undefined ? "parse_failed" : "raw_received" as PureGeminiEffectOutput["status"], rawResponse, parsedJson: parsed };
    const proposal = parsed !== undefined ? proposalFromGeminiJson(input.spec, parsed, model, promptHash, createdAt) : undefined;
    if (proposal) {
      const envelopeValidation = validateGeneratedEffectProposalEnvelope(proposal);
      const contractViolations = envelopeValidation.valid ? scanProposalContractViolations(proposal.files, proposal.componentName) : [];
      pureGeminiOutput = {
        status: !envelopeValidation.valid
          ? "parsed_invalid_envelope"
          : contractViolations.length
            ? "parsed_contract_failed"
            : "parsed_contract_pass",
        rawResponse,
        parsedJson: parsed,
        parsedProposal: proposal,
        envelopeValidation,
        contractViolations
      };
    }
    if (proposal && pureGeminiOutput?.envelopeValidation?.valid) {
      // gemini_ok requires the static safety scan to be clean too — never report success for code
      // the apply-time validator would reject. On a violation, fall back to the safe local proposal.
      const violations = pureGeminiOutput.contractViolations ?? [];
      if (violations.length === 0) {
        return { proposal, status: "gemini_ok", provider: "gemini", model, promptHash, prompt, rawResponse, pureGeminiOutput };
      }
      return {
        proposal: localFallbackProposal(input.spec, promptHash, createdAt),
        status: "invalid_response",
        provider: "local_fallback",
        model,
        promptHash,
        prompt,
        rawResponse,
        pureGeminiOutput,
        error: `Gemini response failed the static safety scan (${violations.join("; ")}); fell back to local proposal.`
      };
    }
    return {
      proposal: localFallbackProposal(input.spec, promptHash, createdAt),
      status: "invalid_response",
      provider: "local_fallback",
      model,
      promptHash,
      prompt,
      rawResponse,
      pureGeminiOutput,
      error: "Gemini response was not a valid proposal envelope after repair; fell back to local proposal."
    };
  } catch (error) {
    pureGeminiOutput = { status: "provider_error", rawResponse: rawResponse || undefined, error: (error as Error).message };
    return {
      proposal: localFallbackProposal(input.spec, promptHash, createdAt),
      status: "provider_error",
      provider: "local_fallback",
      model,
      promptHash,
      prompt,
      rawResponse: rawResponse || undefined,
      pureGeminiOutput,
      error: `Gemini codegen failed: ${(error as Error).message}`
    };
  }
}
