# 17 — Task Breakdown

## P0 — Core V5 demo

### Contracts

- [ ] Add `EvidenceTimelineV5` contract and schema.
- [ ] Add `NeutralReconstructionProgram` contract and schema.
- [ ] Add `KnowledgeElement` contract and schema.
- [ ] Add `CompositionProgram` contract and schema.
- [ ] Add `FinalVideoProgram` contract and schema.
- [ ] Add `ScorecardV5` contract and schema.

### Learn pipeline

- [ ] Implement `runEvidenceV5` wrapper.
- [ ] Implement `runGen1NeutralReconstruction`.
- [ ] Implement `runGen1FallbackNeutralTemplate`.
- [ ] Implement `validateNeutralReconstructionProgram`.
- [ ] Implement `runExtractElements`.
- [ ] Implement `runKbCuratorHardRules`.
- [ ] Implement `knowledgeBase.store/search/list`.

### Create pipeline

- [ ] Implement `runTargetAssetAnalysis`.
- [ ] Implement `runCompositionPlanner`.
- [ ] Implement `runGapReportV5`.
- [ ] Implement `runGen2FinalCodegen`.
- [ ] Implement `runGen2ComposeFallback`.
- [ ] Implement `validateFinalVideoProgram`.

### Render and eval

- [ ] Add `V5ReconstructionRoot.tsx`.
- [ ] Add `V5FinalRoot.tsx`.
- [ ] Add RenderRecipeV5 adapter.
- [ ] Add no-copy scanner.
- [ ] Add scorecard generator.
- [ ] Add final render pipeline.

### UI

- [ ] Add Analyze tab.
- [ ] Add Reconstruct tab.
- [ ] Add Knowledge tab.
- [ ] Add Select tab.
- [ ] Add Plan tab.
- [ ] Add Render tab.
- [ ] Add Evaluate tab.

## P1 — Quality improvements

- [ ] ML KB curator judge.
- [ ] embedding-based KB search.
- [ ] material gap filler from AssetRecipe.
- [ ] procedural audio generator from AudioRecipe.
- [ ] coherence gate.
- [ ] multi-version generation.
- [ ] preview thumbnails for KB elements.

## P2 — Advanced experience

- [ ] natural language revise endpoint.
- [ ] drag-and-drop element timeline.
- [ ] auto recommendation engine.
- [ ] multi-video style blender.
- [ ] VLM/offline quality judge.
- [ ] A/B prediction score.

## Recommended implementation order

```text
1. contracts + schemas
2. learn pipeline P0
3. KB store/search UI
4. composition planner
5. Gen2 + render fallback
6. final render + scorecard
7. material/audio optional modules
```
