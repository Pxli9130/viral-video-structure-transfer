# Project Overview

**Viral Video Structure Transfer Engine**  
Author: **Peixuan Li**  
Competition: **AI Full-Stack Challenge**  
Current workflow: **V5.1 — same-template reconstruction**

This English overview adapts the author's competition submission, “AI Full-Stack Challenge — Viral Video Structure Transfer Engine — Project Description,” and reconciles it with the repository implementation. The [README](../README.md) provides demo videos and a quick start; the [development guide](development.md) covers configuration and API usage.

## Problem and approach

Reusing a short video's creative structure requires understanding its opening hook, scene boundaries, pacing, subtitle density, transitions, product reveals, CTA placement, and audio cues. Reconstructing those decisions manually for each new topic is time-consuming and difficult to repeat consistently.

The engine makes that structure explicit. It learns from a reference, stores reusable code and knowledge, maps new materials to replaceable content slots, fills missing materials, and renders a new video. The intended reusable boundary includes timing, layout, motion curves, typography behavior, transition sequencing, and audio cue placement. Reference pixels, original audio, readable copy, branding, and identifiable subjects are replaced with target content.

Typical applications include product launches, animated marketing posters, fast-cut promotional edits, motion graphics, and tutorial or information videos.

## Implemented capabilities

| Capability | Implementation and evidence |
| --- | --- |
| Reference upload and analysis | Managed upload through `POST /api/projects/:projectId/assets`; local scene, keyframe, motion, and audio evidence through `runEvidenceV5.ts` and `analyze-evidence-timeline.py`. OCR/ASR coverage depends on the analysis path and optional adapters. |
| Reusable template learning | `runLearnSampleV5.ts` creates a neutral reconstruction and `RemotionTemplateCapsule`; optional Gemini visual code generation reconstructs the reference's composition and motion. |
| Two-level knowledge base | `knowledgeBaseV5.ts` persists complete capsules and reusable elements, with curation decisions, deduplication, and search. |
| Target-material understanding | `runTargetAssetAnalysis.ts` and `v2Reports.ts` produce material profiles, quality/duplicate decisions, crop suggestions, and candidate highlight segments. Gemini enrichment is optional. |
| Slot matching and gap detection | `runSameTemplateGeneration.ts` binds ordered compatible assets or explicit `slotAssignments`; unmatched slots become filling decisions or reported gaps. The advanced path also uses `runGapReportV5.ts`. |
| Media and audio completion | Provider adapters support Gemini Image, Seedream, Seedance, happyhorse, Google audio, and procedural alternatives. Actual cloud output requires credentials and the relevant request configuration. |
| Template-based rendering | `renderTemplateCapsule.ts` renders stored React/Remotion code with newly bound props; FFmpeg handles audio muxing and other media processing. |
| Variants and revisions | The dashboard creates variant generations; structured and natural-language revision endpoints apply `TemplatePatchSet` changes and re-render. |
| Multiple references | The same-template route can arbitrate among `referenceCapsuleIds`; advanced `mix_elements` composes selected knowledge elements. Arbitration reports record the selection. |
| Review and export | The dashboard's Review Evidence Center shows learning evidence, gap decisions, transfer mapping, packaging, scorecards, and downloadable JSON. |

These are implemented paths rather than a claim that every reference or provider produces the same visual quality. Inspect each run's gates, warnings, rendered asset coverage, and fallback records.

## Architecture

The application has five main layers:

1. **Web workbench:** React 19, Vite, and TypeScript provide upload, learning, template/knowledge browsing, material binding, generation, revisions, and evidence export.
2. **API orchestration:** Express routes in `server.ts` and `v5Routes.ts` connect the main application store, managed uploads, V5 pipelines, progress reporting, and artifact retrieval.
3. **Analysis and model adapters:** Python/FFmpeg tools extract local evidence. Configured text, vision, image, video, and audio adapters supply optional AI capabilities.
4. **Shared contracts:** TypeScript contracts and runtime validators under `packages/shared/src/contracts-v5/` define evidence, templates, knowledge, composition, gaps, render programs, and scorecards.
5. **Persistence and rendering:** Uploaded materials, the V5 knowledge base, and generated artifacts are stored locally. Remotion renders capsule code; FFmpeg processes media and audio. The main application store supports JSON or SQLite.

### Learning pipeline

```text
Reference upload
  -> local evidence timeline
  -> neutral reconstruction
  -> deterministic capsule / optional AI visual reconstruction
  -> compilation, preview, template validation, and repair results
  -> reusable capsule + knowledge manifest + curated elements
```

For multimodal Gen1, Gemini receives the reference clip or chunks together with evidence/keyframes when external sample analysis is enabled. Long-video reconstruction splits at scene boundaries, caps chunk length, rebases local timing, and combines chunk components into one multi-file capsule. The default chunking trigger is 34 seconds and the default chunk cap is 30 seconds; both are configurable.

The primary AI path promotes code based on compilation and a real preview render, while recording additional fidelity and validation findings. This makes the recorded findings important: a renderable capsule does not imply that every visual or safety check passed.

### Generation pipeline

```text
Template + new creative brief + ordered target assets
  -> optional context rewrite
  -> target-material analysis and slot matching
  -> text / image / video / audio filling
  -> bound TemplateInstance
  -> Remotion render + FFmpeg audio/media processing
  -> quality checks + no-copy scan when available
  -> MP4 + mapping/timeline/packaging + scorecard
```

The default `same_template` mode preserves the learned component structure while adapting content. Revisions reuse existing visuals for theme/copy/palette changes; creative knobs can also trigger a code rewrite. Requests to regenerate images require a fresh generation. The advanced `mix_elements` path plans a composition from selected knowledge elements and optionally uses Gen2 code generation.

## Core contracts

| Object | Role |
| --- | --- |
| `EvidenceTimelineV5` | Timestamped video facts, shots, keyframes, text/audio/motion evidence, and source references. |
| `NeutralReconstructionProgram` | Content-neutral scenes, roles, placeholders, rhythm, and packaging derived from evidence. |
| `RemotionTemplateCapsule` | Reusable code bundle, props schema, slot schema, timing signature, scene/audio recipes, fixtures, and quality/safety metadata. |
| `KnowledgeElement` | Reusable creative unit with source evidence, payload, slots, compatibility, and reuse policy. |
| `TargetAssetProfile` | Analysis of a user's target material and its potential use. |
| `TemplateInstance` | New creative brief, bound props, slot bindings, missing-slot count, and readiness impact. |
| `GapReportV5` | Slot requirements and decisions for reuse, generation, fallback, or unresolved gaps. |
| `FinalVideoProgram` / `RenderRecipeV5` | Final code/recipe, content provenance, validation, and render information. |
| `TemplatePatchSet` | Constrained theme, copy, palette, rhythm, subtitle-density, motion, and CTA edits. |
| `ScorecardV5` | Gate results, rubric evidence, quality/safety details, warnings, and graded readiness. |

Canonical definitions live in [contracts-v5](../packages/shared/src/contracts-v5/). Documentation examples and older specification schemas may lag behind those definitions.

## Tool and model boundaries

Tools are integrated through typed adapters and pipeline modules. They are not exposed as an unrestricted model-controlled shell. Local analysis launches Python/FFmpeg processes with argument arrays. Upload handling applies size and type checks, and managed-material manifests resolve asset IDs through controlled storage paths.

V5 text tasks use `createTextModelFn`: a configured Ark/Doubao endpoint takes precedence over Gemini. Multimodal reference reconstruction uses Gemini separately. Missing keys or failed providers can lead to deterministic templates, generated stills, procedural visuals/audio, or readiness downgrades; the result should be assessed using the recorded path.

Generated-code validation includes TypeScript parsing and checks for unsafe runtime APIs, sample-media paths, remote URLs, and suspicious literal text. Real compilation and preview/render execution test whether the capsule runs. Static validation and rendering checks have different roles and do not constitute an isolation guarantee for arbitrary code.

External understanding and external generation are separate data paths. Gen1 can upload a reference to Gemini for analysis. Same-template AIGC briefs use new content prompts and explicitly exclude sample frames and target-material references; happyhorse receives a newly generated still. The shipped environment example enables cloud-oriented switches. The [development guide](development.md#local-configuration) explains how to use local behavior explicitly.

## Evaluation and review evidence

Review a result in this order:

1. Play the final video and inspect its scene coverage, material use, motion, typography, and audio.
2. Check material analysis, slot bindings, missing slots, and filling provenance.
3. Compare `timeline-v2.json` and `mapping-v2.json` with the source structure and intended brief.
4. Inspect the scorecard, render-quality findings, no-copy details, and any revision trace.

The scorecard distinguishes `artifact_valid`, `technical_demo`, `review_demo`, and `shippable_demo`. The template instance uses the related labels `technical_demo`, `review_demo`, and `shippable_candidate`; the API reconciles these with the scorecard.

Perceptual no-copy scanning uses frame hashes and audio similarity when invoked with its Python dependencies and source media available. The current same-template AI-capsule path skips that comparison by policy and reports structural provenance instead. Other paths can also report structural no-copy only when scanning fails or cannot run. That result is narrower than an executed perceptual comparison. Neither a successful schema check nor an MP4 alone establishes full creative fidelity.

The competition submission also references local review bundles, proof sheets, full-resolution outputs, and screen recordings. The README includes the full English project description, an English Mermaid architecture diagram, curated viewing copies, screenshot PDFs, and linked YouTube walkthroughs. Other generated bundles and original reference videos are generally excluded from Git.

## Current limitations

- Visual reconstruction and natural-language edits depend on the selected model, template, reference complexity, and available target assets.
- A deterministic/procedural fallback provides a runnable path with lower visual substance; it should remain visible in warnings and readiness.
- Local V5 evidence extraction currently checks for a configured Conda environment. Having `python3` on PATH alone does not satisfy that API precondition.
- Long-video learning, cloud footage generation, and Chromium rendering can take minutes and require memory/concurrency tuning.
- Optional OCR/ASR, cloud model access, browser availability, and original demo fixtures vary by environment.
- Historical specs and locally generated reports preserve earlier behavior. Use the current code and English guides for implementation details.
