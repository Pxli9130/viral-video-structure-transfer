# 16 — Implementation Delta from V4

## 1. Keep from V4

Keep these ideas/modules:

- deterministic evidence extraction
- model router and provider policy
- gap report and fill plan concepts
- RenderRecipe layer model
- Remotion and FFmpeg renderer
- no-copy gates
- UI explanation panels
- evaluation gates

## 2. Replace or upgrade

| V4 concept | V5 replacement |
|---|---|
| StructureTemplate as primary IR | NeutralReconstructionProgram typed spec |
| TechniqueAtoms only | KnowledgeElements with asset/audio recipes and snippets |
| Optional codegen near end | Gen1 core reconstruction + Gen2 final composition |
| One-template migration | KB multi-video element selection and recomposition |
| Planner directly to RenderRecipe | CompositionProgram then Gen2/RenderRecipe |
| Static audioStructure only | AudioRecipe + AudioPlan + AudioLayer |

## 3. New modules to add

```text
pipeline-v5/runGen1NeutralReconstruction.ts
pipeline-v5/runExtractElements.ts
pipeline-v5/runKbCurator.ts
pipeline-v5/runKnowledgeRecommend.ts
pipeline-v5/runCompositionPlanner.ts
pipeline-v5/runGen2FinalCodegen.ts
contracts-v5/neutralProgram.ts
contracts-v5/knowledgeElement.ts
contracts-v5/compositionProgram.ts
contracts-v5/finalVideoProgram.ts
services/knowledgeBase.ts
services/codegenSandbox.ts
services/noCopyScanner.ts
```

## 4. Migration phases

### Phase 1 — Contracts and artifact store

- Add V5 contracts.
- Add schemas.
- Add artifact lineage for V5 objects.
- Keep V4 running.

### Phase 2 — Learn pipeline

- Implement EvidenceTimelineV5 wrapper over existing evidence.
- Implement Gen1 prompt and schema.
- Implement neutral fallback.
- Implement element extraction.
- Store KB elements.

### Phase 3 — KB UI

- Display elements.
- Add search/filter.
- Add selection set.
- Add curation decisions.

### Phase 4 — Create pipeline

- Implement target asset analyzer wrapper.
- Implement CompositionProgram.
- Implement gap report V5.
- Implement Gen2 codegen.
- Add deterministic compose fallback.

### Phase 5 — Render and eval

- Add V5 Remotion roots.
- Add RenderRecipeV5 compatibility.
- Add no-copy scanner.
- Add scorecard.

### Phase 6 — Enhancements

- material recipe generator
- audio recipe generator
- recommendation engine
- natural language revise
- multi-version variants

## 5. Compatibility strategy

V5 can consume V4 artifacts by mapping:

```text
StructureTemplate -> KnowledgeElement kind=structure_pattern
TechniqueAtom -> KnowledgeElement kind=motion/transition/typography pattern
RenderRecipe v4.1 -> fallback RenderRecipeV5
GapReport v4 -> GapReportV5
```

## 6. Risk and mitigation

| Risk | Mitigation |
|---|---|
| Gen1 code invalid | typed spec required, neutral fallback |
| Gen2 code invalid | compile repair, deterministic compose fallback |
| KB becomes noisy | hard rules + ML curator + quality scores |
| Multi-element output incoherent | CompositionProgram stylePlan and coherence gate |
| Sample copy risk | no-copy gates and evidence-only policy |
| Audio providers fail | FFmpeg procedural fallback |
