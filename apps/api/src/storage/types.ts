import type {
  Asset,
  ExampleAnalysis,
  GenerationResult,
  Job,
  KnowledgeAtom,
  Project,
  RenderOutput,
  TemplateRecord
} from "@vvst/shared";

export interface Database {
  projects: Project[];
  assets: Asset[];
  jobs: Job[];
  analyses: ExampleAnalysis[];
  templates: TemplateRecord[];
  atoms: KnowledgeAtom[];
  generations: GenerationResult[];
  renders: RenderOutput[];
}

export const COLLECTIONS = [
  "projects",
  "assets",
  "jobs",
  "analyses",
  "templates",
  "atoms",
  "generations",
  "renders"
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

export const emptyDatabase = (): Database => ({
  projects: [],
  assets: [],
  jobs: [],
  analyses: [],
  templates: [],
  atoms: [],
  generations: [],
  renders: []
});
