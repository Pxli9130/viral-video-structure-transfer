// contracts-v5/validation.ts
// ajv-2020 validators for the v5 artifact contracts. Mirrors the V4 seam (schemas.ts -> validation.ts)
// so scripts/validate-v5-contracts.mjs and the runtime can validate artifacts the same way V4 does.

import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import {
  candidateElementSchema,
  compositionProgramSchema,
  evidenceTimelineV5Schema,
  finalVideoProgramSchema,
  gapReportV5Schema,
  generationRequestV5Schema,
  kbCurationDecisionSchema,
  knowledgeElementSchema,
  neutralReconstructionProgramSchema,
  renderRecipeV5Schema,
  scorecardV5Schema,
  selectionSetSchema,
  targetAssetProfileSchema
} from "./schemas.js";

export interface V5ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });

const schemaMap = {
  evidence_timeline_v5: evidenceTimelineV5Schema,
  neutral_reconstruction_program: neutralReconstructionProgramSchema,
  candidate_element: candidateElementSchema,
  knowledge_element: knowledgeElementSchema,
  kb_curation_decision: kbCurationDecisionSchema,
  target_asset_profile: targetAssetProfileSchema,
  composition_program: compositionProgramSchema,
  gap_report_v5: gapReportV5Schema,
  render_recipe_v5: renderRecipeV5Schema,
  final_video_program: finalVideoProgramSchema,
  scorecard_v5: scorecardV5Schema,
  selection_set: selectionSetSchema,
  generation_request_v5: generationRequestV5Schema
} as const;

export type V5SchemaName = keyof typeof schemaMap;

const validators = new Map<V5SchemaName, ValidateFunction>();

function getValidator(name: V5SchemaName): ValidateFunction {
  const existing = validators.get(name);
  if (existing) return existing;
  const validator = ajv.compile(schemaMap[name] as object);
  validators.set(name, validator);
  return validator;
}

function formatErrors(validator: ValidateFunction): string[] {
  return (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}

export function validateV5(name: V5SchemaName, value: unknown): V5ValidationResult {
  const validator = getValidator(name);
  return validator(value) ? { valid: true, errors: [] } : { valid: false, errors: formatErrors(validator) };
}

export const validateEvidenceTimelineV5 = (v: unknown) => validateV5("evidence_timeline_v5", v);
export const validateNeutralReconstructionProgram = (v: unknown) => validateV5("neutral_reconstruction_program", v);
export const validateCandidateElement = (v: unknown) => validateV5("candidate_element", v);
export const validateKnowledgeElement = (v: unknown) => validateV5("knowledge_element", v);
export const validateKbCurationDecision = (v: unknown) => validateV5("kb_curation_decision", v);
export const validateTargetAssetProfile = (v: unknown) => validateV5("target_asset_profile", v);
export const validateCompositionProgram = (v: unknown) => validateV5("composition_program", v);
export const validateGapReportV5 = (v: unknown) => validateV5("gap_report_v5", v);
export const validateRenderRecipeV5 = (v: unknown) => validateV5("render_recipe_v5", v);
export const validateFinalVideoProgram = (v: unknown) => validateV5("final_video_program", v);
export const validateScorecardV5 = (v: unknown) => validateV5("scorecard_v5", v);
export const validateSelectionSet = (v: unknown) => validateV5("selection_set", v);
export const validateGenerationRequestV5 = (v: unknown) => validateV5("generation_request_v5", v);
