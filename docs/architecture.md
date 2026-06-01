# Architecture

This repo is a source-first video structure-transfer system. It learns reusable structure from a sample video, maps that structure onto user-authorized target material, then renders through a `RenderRecipe` contract instead of letting renderers invent pixels from a prompt.

## Main Flow

1. Analyze sample video into evidence: shots, typography, visual elements, motion geometry and audio structure.
2. Build a `StructureTemplate` from that evidence.
3. Extract `TechniqueAtom` records for reusable techniques such as ribbon motion, kinetic text, product hero framing and CTA packaging.
4. Generate a target `Timeline` and v4.1 `RenderRecipe`.
5. Render locally with Remotion and/or FFmpeg.
6. Export a static showcase report and G1-G20 final gates.

## Core Packages

- `packages/shared`: schemas, types, planner, evidence extraction, recipe migration, provider policy, version strategy and natural-language edit logic.
- `apps/api`: HTTP API, storage, generation orchestration, report endpoints and renderer adapters.
- `apps/web`: operator UI.
- `scripts`: demo, learning, evaluation and submission-report scripts.

## Render Boundary

Renderers consume `RenderRecipe` as the pixel contract. The renderer must not re-select primitives from role names alone. A layer is renderable only when its material policy allows it:

- sample video: structure evidence only unless explicitly authorized;
- user target material: renderable;
- generated target material: renderable only with provenance;
- missing material: reported as a gap or local procedural fallback.

## PR3 Demo Surfaces

PR3 adds judge-facing surfaces:

- API reports: evidence, TechniqueAtoms, GapReport, RenderRecipe and render-job report.
- Static report: `docs/artifacts/showcase_report/index.html`.
- Final gates: `final-gates.json` per case.
- Multi-version recipes: `high_click`, `high_conversion`, `high_quality`.
- Natural-language recipe patches for the required Chinese edits.

