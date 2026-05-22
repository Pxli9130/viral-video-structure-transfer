import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { generationRequestSchema, structureTemplateSchema, timelineSchema } from "./schemas.js";
import type { ValidationResult } from "./types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});

const validators = new Map<string, ValidateFunction>();

function getValidator(name: "structure" | "generationRequest" | "timeline"): ValidateFunction {
  const existing = validators.get(name);
  if (existing) {
    return existing;
  }

  const schema =
    name === "structure" ? structureTemplateSchema : name === "timeline" ? timelineSchema : generationRequestSchema;
  const validator = ajv.compile(schema);
  validators.set(name, validator);
  return validator;
}

function formatErrors(validator: ValidateFunction): string[] {
  return (validator.errors ?? []).map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "is invalid"}`;
  });
}

export function validateStructureTemplate(value: unknown): ValidationResult {
  const validator = getValidator("structure");
  return validator(value) ? { valid: true, errors: [] } : { valid: false, errors: formatErrors(validator) };
}

export function validateGenerationRequest(value: unknown): ValidationResult {
  const validator = getValidator("generationRequest");
  return validator(value) ? { valid: true, errors: [] } : { valid: false, errors: formatErrors(validator) };
}

export function validateTimeline(value: unknown): ValidationResult {
  const validator = getValidator("timeline");
  return validator(value) ? { valid: true, errors: [] } : { valid: false, errors: formatErrors(validator) };
}
