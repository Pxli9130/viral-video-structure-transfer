import type { VLMVideoAnalysis } from "../adapters.js";
import type { StructureTemplate, VideoAnalysisResult, Vertical } from "../types.js";
import { buildFallbackTemplate } from "./planner.js";

export interface TemplateBuilderInput {
  analysis: VideoAnalysisResult;
  vertical?: Vertical;
  projectId?: string;
  vlm?: VLMVideoAnalysis;
}

export function buildStructureTemplate(input: TemplateBuilderInput): StructureTemplate {
  return buildFallbackTemplate(input.analysis, input.vertical, input.projectId, input.vlm);
}
