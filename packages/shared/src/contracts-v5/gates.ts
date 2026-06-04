// contracts-v5/gates.ts
// Canonical V5 acceptance-gate registry. The spec shipped TWO incompatible gate sets — a 20-gate
// list in the single-file mirror (§4.16) and a 40-gate list in acceptance-gates.md (audit AG-1/XD-03).
// We canonicalize to the 40-gate set (it is the more complete, category-structured one), assign each
// a STABLE string id + category + priority so scorecards key on ids that always exist, and so the
// "All P0 gates pass" demo-ready rule (audit AG-3) has real priorities to read.

export type GateCategory = "learn" | "kb" | "create" | "render" | "safety" | "ui";
export type GatePriority = "P0" | "P1";

export interface GateDef {
  id: string; // canonical "V5-Gn"
  category: GateCategory;
  priority: GatePriority;
  name: string;
  pass: string; // pass condition (human-readable)
}

export const V5_GATES: readonly GateDef[] = [
  // Learn
  { id: "V5-G1", category: "learn", priority: "P0", name: "Evidence exists", pass: "EvidenceTimelineV5 written and schema-valid." },
  { id: "V5-G2", category: "learn", priority: "P1", name: "Evidence grounded", pass: "Shots/keyFrames/motion/text/audio populated or explicit empty reason." },
  { id: "V5-G3", category: "learn", priority: "P1", name: "Video input policy", pass: "Whole/chunk/fps policy recorded." },
  { id: "V5-G4", category: "learn", priority: "P0", name: "Gen1 output", pass: "NeutralReconstructionProgram exists or fallback exists." },
  { id: "V5-G5", category: "learn", priority: "P0", name: "Gen1 schema", pass: "NeutralReconstructionProgram schema passes." },
  { id: "V5-G6", category: "learn", priority: "P0", name: "Placeholder coverage", pass: "Sample-specific content is placeholders or evidence_only." },
  { id: "V5-G7", category: "learn", priority: "P1", name: "Evidence refs", pass: "Major scenes/patterns cite evidence refs." },
  { id: "V5-G8", category: "learn", priority: "P1", name: "Reconstruction preview", pass: "Preview rendered or explicit fallback reason recorded." },
  // KB
  { id: "V5-G9", category: "kb", priority: "P0", name: "Candidate elements", pass: "CandidateElement list exists." },
  { id: "V5-G10", category: "kb", priority: "P0", name: "Curation decisions", pass: "Each candidate has a store/merge/variant/reject/evidence_only decision." },
  { id: "V5-G11", category: "kb", priority: "P1", name: "Hard-rule dedupe", pass: "Exact duplicates not stored as new elements." },
  { id: "V5-G12", category: "kb", priority: "P1", name: "Unsafe sample material", pass: "Raw sample pixels/audio/text marked evidence_only." },
  { id: "V5-G13", category: "kb", priority: "P0", name: "KB write", pass: "Accepted elements stored with provenance + safety flags." },
  { id: "V5-G14", category: "kb", priority: "P0", name: "Searchable KB", pass: "Elements retrievable by kind/tag/source/query." },
  // Create
  { id: "V5-G15", category: "create", priority: "P0", name: "Selection set", pass: "User selection or auto recommendation recorded." },
  { id: "V5-G16", category: "create", priority: "P0", name: "Target asset analysis", pass: "TargetAssetProfile exists." },
  { id: "V5-G17", category: "create", priority: "P0", name: "CompositionProgram", pass: "CompositionProgram schema passes." },
  { id: "V5-G18", category: "create", priority: "P0", name: "Gap report", pass: "Required slots have matched/weak/missing status." },
  { id: "V5-G19", category: "create", priority: "P0", name: "Fill decision", pass: "Missing slots have a fill strategy or explicit skip reason." },
  { id: "V5-G20", category: "create", priority: "P0", name: "Gen2 output", pass: "FinalVideoProgram exists or compose fallback exists." },
  { id: "V5-G21", category: "create", priority: "P0", name: "Final schema", pass: "FinalVideoProgram + RenderRecipeV5 schema pass." },
  { id: "V5-G22", category: "create", priority: "P0", name: "Code compile", pass: "Remotion TypeScript compiles or fallback recipe used." },
  // Render
  { id: "V5-G23", category: "render", priority: "P0", name: "Final video exists", pass: "final.mp4 exists and is readable." },
  { id: "V5-G24", category: "render", priority: "P1", name: "Duration", pass: "Duration within configured tolerance." },
  { id: "V5-G25", category: "render", priority: "P1", name: "Resolution", pass: "Output matches target aspect/resolution." },
  { id: "V5-G26", category: "render", priority: "P0", name: "No long blank", pass: "No long black/blank visual segment." },
  { id: "V5-G27", category: "render", priority: "P0", name: "Audio validity", pass: "Audio stream exists unless intentionally disabled." },
  { id: "V5-G28", category: "render", priority: "P1", name: "Preview artifacts", pass: "Preview frames/contact sheet exist." },
  // Safety
  { id: "V5-G29", category: "safety", priority: "P0", name: "No sample pixels", pass: "Final program does not reference sample media paths." },
  { id: "V5-G30", category: "safety", priority: "P0", name: "No sample audio", pass: "Final output does not use sample audio." },
  { id: "V5-G31", category: "safety", priority: "P0", name: "No sample text copy", pass: "Exact source subtitle/text not reused unless user-provided." },
  { id: "V5-G32", category: "safety", priority: "P0", name: "Provenance", pass: "Generated/reused assets have provenance." },
  { id: "V5-G33", category: "safety", priority: "P1", name: "Provider policy", pass: "Provider decisions recorded." },
  // UI / demo
  { id: "V5-G34", category: "ui", priority: "P0", name: "Analysis visible", pass: "UI shows sample evidence." },
  { id: "V5-G35", category: "ui", priority: "P0", name: "Reconstruction visible", pass: "UI shows neutral reconstruction + placeholders." },
  { id: "V5-G36", category: "ui", priority: "P0", name: "KB visible", pass: "UI shows learned elements + KB decisions." },
  { id: "V5-G37", category: "ui", priority: "P0", name: "Mapping visible", pass: "UI shows selected elements mapped to final sections." },
  { id: "V5-G38", category: "ui", priority: "P1", name: "Gap visible", pass: "UI shows missing/filled slots." },
  { id: "V5-G39", category: "ui", priority: "P0", name: "Final visible", pass: "UI shows final video + comparison." },
  { id: "V5-G40", category: "ui", priority: "P0", name: "Scorecard visible", pass: "UI shows rubric coverage + warnings." },
  // Quality gates added after the GPT gap analysis (honest substance/readability checks).
  { id: "V5-G41", category: "render", priority: "P0", name: "Visual substance", pass: "Each required visual slot is bound to a real/generated image/video or a designed visual — not a blank placeholder card." },
  { id: "V5-G42", category: "render", priority: "P1", name: "Text density", pass: "<= ~6 text beats per 16s and no text beat on-screen < 1.2s (readable, not slogan-stacked)." }
];

export const V5_GATE_IDS: readonly string[] = V5_GATES.map((g) => g.id);
export const V5_P0_GATE_IDS: readonly string[] = V5_GATES.filter((g) => g.priority === "P0").map((g) => g.id);

export function getGateDef(id: string): GateDef | undefined {
  return V5_GATES.find((g) => g.id === id);
}
