import type { FillAction, GenerationRequest, SlotMapping, SourceVideoUnderstanding, StructureTemplate } from "../types.js";
import { createFillPlan } from "./planner.js";

export function planGapFills(
  mappings: SlotMapping[],
  source: SourceVideoUnderstanding,
  request: GenerationRequest,
  template?: StructureTemplate
): FillAction[] {
  return createFillPlan(mappings, source, request, template);
}
