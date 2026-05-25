import type { GapReportItem, SlotMapping } from "../types.js";
import { generateGapReport, type GapReportContext } from "./planner.js";

export function detectMaterialGaps(
  mappings: SlotMapping[],
  context: GapReportContext = {}
): GapReportItem[] {
  return generateGapReport(mappings, context);
}
