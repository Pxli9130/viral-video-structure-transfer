import type { KnowledgeAtom, StructureTemplate } from "../types.js";

export function extractKnowledgeAtoms(template: StructureTemplate): KnowledgeAtom[] {
  return template.structureAtoms;
}
