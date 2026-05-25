import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  assetAnalysisSchema,
  generationRequestSchema,
  jobSchema,
  knowledgeAtomSchema,
  projectSchema,
  structureTemplateSchema,
  timelineSchema
} from "./schemas.js";
import type { ValidationResult } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});

const schemaMap = {
  project: projectSchema,
  asset_analysis: assetAnalysisSchema,
  knowledge_atom: knowledgeAtomSchema,
  structure: structureTemplateSchema,
  generation_request: generationRequestSchema,
  timeline: timelineSchema,
  job: jobSchema
} as const;

type SchemaName = keyof typeof schemaMap;

const validators = new Map<SchemaName, ValidateFunction>();

function getValidator(name: SchemaName): ValidateFunction {
  const existing = validators.get(name);
  if (existing) return existing;
  const validator = ajv.compile(schemaMap[name]);
  validators.set(name, validator);
  return validator;
}

function formatErrors(validator: ValidateFunction): string[] {
  return (validator.errors ?? []).map((error) => {
    const pointer = error.instancePath || "/";
    return `${pointer} ${error.message ?? "is invalid"}`;
  });
}

function runValidator(name: SchemaName, value: unknown): ValidationResult {
  const validator = getValidator(name);
  return validator(value) ? { valid: true, errors: [] } : { valid: false, errors: formatErrors(validator) };
}

export function validateProject(value: unknown): ValidationResult {
  return runValidator("project", value);
}

export function validateAssetAnalysis(value: unknown): ValidationResult {
  return runValidator("asset_analysis", value);
}

export function validateKnowledgeAtom(value: unknown): ValidationResult {
  return runValidator("knowledge_atom", value);
}

export function validateStructureTemplate(value: unknown): ValidationResult {
  return runValidator("structure", value);
}

export function validateGenerationRequest(value: unknown): ValidationResult {
  return runValidator("generation_request", value);
}

export function validateTimeline(value: unknown): ValidationResult {
  return runValidator("timeline", value);
}

export function validateJob(value: unknown): ValidationResult {
  return runValidator("job", value);
}
