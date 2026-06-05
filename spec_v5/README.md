# Spec V5 — Program-KB Dual Codegen Creative Engine

> **Canonical contracts live in code.** The authoritative V5 data contracts are
> `packages/shared/src/contracts-v5/` (exported from `@vvst/shared` as `v5`). Where any doc below
> disagrees with the code or with [`CONTRACTS-CANONICAL.md`](./CONTRACTS-CANONICAL.md), the code
> wins. Validate examples: `npm run validate:schemas:v5`.
>
> **V5.1 — Same Template Reconstruction Mode (NEW DEFAULT):** Gen1 now also builds a reusable,
> props-driven Remotion template (`RemotionTemplateCapsule`) per sample, and generation defaults to
> "use the same template code with a new theme + auto AIGC gap fill". See
> [`same-template-mode.md`](./same-template-mode.md). The original element-mixing path is kept as the
> advanced `mix_elements` mode.

V5 is a complete target architecture for the viral video structure transfer engine.
It replaces the V4 “evidence -> template/atoms -> recipe” mindset with a stronger two-stage system:

```text
Many sample videos
  -> deterministic evidence
  -> Gen1 neutral reconstruction program
  -> reusable knowledge elements
  -> Knowledge Base
  -> user selected elements + target assets + brief
  -> composition planner
  -> Gen2 final Remotion program
  -> render final.mp4
```

Core principle:

```text
Learn structure, not content.
Learn asset recipes, not raw sample pixels.
Learn music patterns, not raw sample audio.
```

## Package contents

- `00-executive-summary.md` — what V5 is and why it exists.
- `requirements.md` — functional, non-functional, and rubric requirements.
- `architecture.md` — system architecture and pipeline diagrams.
- `pipeline.md` — exact step-by-step pipeline behavior.
- `data-contracts.md` — TypeScript-style contracts.
- `knowledge-base.md` — KB element model, dedupe, curator, retrieval.
- `gen1-neutral-reconstruction.md` — sample-video-to-neutral-program spec.
- `gen2-final-composition.md` — selected-elements-to-final-code spec.
- `api.md` — HTTP API endpoints.
- `renderer-spec.md` — Remotion / FFmpeg render contracts.
- `ui-demo-spec.md` — demo UI and what to display for rubric.
- `acceptance-gates.md` — V5 quality/safety gates.
- `provider-policy.md` — model/provider policy and fallbacks.
- `model-stack.md` — recommended local/cloud model stack.
- `routing-and-fallbacks.md` — retry, fallback, and failure behavior.
- `security-and-safety.md` — no-copy, provenance, asset/audio policy.
- `implementation-delta.md` — how to migrate from V4 to V5.
- `tasks.md` — implementation task breakdown.
- `test-plan.md` — test cases and regression plan.
- `schemas/` — JSON Schema drafts for V5 objects.
- `examples/` — example artifacts.
- `prompts/` — prompt templates for Gen1, Gen2, curator, planner.
- `diagrams/v5_architecture.mmd` — Mermaid architecture diagram.
- `SPEC_V5_ALL.md` — all documents concatenated.

## V5 glossary

| Term | Meaning |
|---|---|
| EvidenceTimelineV5 | Deterministic timeline from FFmpeg/OpenCV/librosa/ASR/OCR. |
| Gen1 | AI synthesizer that converts a sample video + evidence into a neutral reconstruction program. |
| NeutralReconstructionProgram | Typed spec + Remotion preview code + placeholders + recipes + evidence refs. |
| KnowledgeElement | Reusable, content-neutral creative unit extracted from a sample. |
| KB Curator | Hard-rule + ML dedupe/store/merge/variant/reject pipeline. |
| CompositionProgram | JSON plan that combines selected KB elements into a new video structure. |
| Gen2 | AI code generator that creates final Remotion code from selected elements and composition plan. |
| FinalVideoProgram | Final Remotion project + RenderRecipe + explanation + validation result. |
