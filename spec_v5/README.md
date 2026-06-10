# Spec V5.1 — Same Template + Program-KB Creative Engine

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
The current implementation is V5.1: the default product path is **same-template reconstruction**,
while the original Program-KB element mixing path remains available as the advanced `mix_elements`
mode.

```text
Default V5.1 path:
sample video
  -> deterministic evidence + optional Gemini VLM/Gen1
  -> RemotionTemplateCapsule + slot schema + scene/audio recipes
  -> target brief + ordered target assets + optional per-slot assignments
  -> same_template binding + gap fill + context rewrite
  -> Remotion render + transfer trace + scorecard + final.mp4

Advanced path:
many sample videos
  -> reusable KnowledgeElements
  -> user-selected elements + target assets + brief
  -> composition planner + optional Gen2 Remotion codegen
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
- `rubric-alignment.md` — **每项评分 → 已实现功能/端点/代码位置的逐项对照**（答辩 + 说明文档用）。
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
| Gen1 | AI/deterministic learning stage that converts sample video + evidence into a neutral reconstruction and a reusable Remotion template capsule. |
| NeutralReconstructionProgram | Typed sample analysis with scenes, placeholders, packaging, rhythm and evidence refs. |
| RemotionTemplateCapsule | Level-1 reusable template: props-driven Remotion code, slot schema, timing, motion, scene/audio recipes and no-copy safety flags. This is the default generation object. |
| TemplateSlot | Replaceable content slot such as product image/video, background, logo, headline, subtitle, CTA, music, voiceover or data value. |
| TemplateInstance | A generated same-template instance: new brief, bound props, slot bindings, gap report and readiness impact. |
| GenerationOptionsV5 | Options for `same_template`, `modify_template` and `mix_elements`, including AIGC image/audio/text fill and fallback policy. |
| TransferTrace | One explainable view of sample structure, template, target assets, slot mapping, gap/fill actions, timeline/mapping/packaging, scorecard and result URLs. |
| JobProgress | Live progress payload used by the fixed UI status/progress bars (`GET /api/v5/jobs/:jobId/progress`). |
| KnowledgeElement | Level-2 reusable, content-neutral creative unit extracted from a sample. Used by the advanced `mix_elements` path. |
| KB Curator | Hard-rule + ML dedupe/store/merge/variant/reject pipeline. |
| CompositionProgram | JSON plan that combines selected KB elements into a new video structure for `mix_elements`. |
| Gen2 | Optional AI code generator that creates final Remotion code from selected elements and composition plan. |
| FinalVideoProgram | Final Remotion project/render recipe + explanation + validation result. |
| Review Evidence Center | V5 dashboard section with Showcase / Learn Analysis / Structure Protocol / Gap Decisions / Transfer Map / Packaging / Export. |
