import type { GenerationRequest, SlotMapping, SourceVideoUnderstanding, StructureTemplate } from "../types.js";
import { matchSlots } from "./planner.js";

export function mapSlotsToAssets(
  template: StructureTemplate,
  source: SourceVideoUnderstanding,
  request: GenerationRequest
): SlotMapping[] {
  return matchSlots(template, source, request);
}
