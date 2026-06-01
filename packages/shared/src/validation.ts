import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  assetAnalysisSchema,
  aigcMaterialFillConfigSchema,
  generatedAssetCandidateSchema,
  generationRequestSchema,
  jobSchema,
  knowledgeAtomSchema,
  materialGenerationBriefSchema,
  projectSchema,
  renderRecipeSchema,
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
  aigc_material_fill_config: aigcMaterialFillConfigSchema,
  material_generation_brief: materialGenerationBriefSchema,
  generated_asset_candidate: generatedAssetCandidateSchema,
  render_recipe: renderRecipeSchema,
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

export function validateAigcMaterialFillConfig(value: unknown): ValidationResult {
  return runValidator("aigc_material_fill_config", value);
}

export function validateMaterialGenerationBrief(value: unknown): ValidationResult {
  return runValidator("material_generation_brief", value);
}

export function validateGeneratedAssetCandidate(value: unknown): ValidationResult {
  return runValidator("generated_asset_candidate", value);
}

export function validateRenderRecipe(value: unknown): ValidationResult {
  return runValidator("render_recipe", value);
}

export function validateTimeline(value: unknown): ValidationResult {
  return runValidator("timeline", value);
}

export function validateJob(value: unknown): ValidationResult {
  return runValidator("job", value);
}
