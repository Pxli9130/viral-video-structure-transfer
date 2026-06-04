# 00 — Executive Summary

## Goal

Build an AI creative system that can learn reusable short-video creation methods from many sample videos, store them as reusable knowledge elements, and let users combine those elements with new assets to generate new videos.

V5 is designed for three outcomes:

1. **Better learning**: use deterministic evidence plus VLM/codegen to understand sample videos in a grounded way.
2. **Better reuse**: store not only “structure atoms” but also reusable asset recipes, audio recipes, layout patterns, motion snippets, and Remotion snippets.
3. **Better generation**: let users select elements from many samples, then use a final Remotion code generator to synthesize a new video.

## Why V5 is different from V4

V4 is mostly:

```text
EvidenceBundle -> StructureTemplate -> TechniqueAtoms -> GapReport -> RenderRecipe -> final.mp4
```

V5 is:

```text
EvidenceTimeline
  -> NeutralReconstructionProgram
  -> CandidateElements
  -> KnowledgeBase
  -> CompositionProgram
  -> FinalVideoProgram
  -> final.mp4
```

The biggest change is that **program-as-IR** becomes the learning layer. The system does not only describe a sample; it creates a neutral, placeholder-based Remotion-like program that can be inspected, previewed, and decomposed.

## Two code generators

V5 has two different codegen stages:

### Gen1: Neutral Reconstruction Synthesizer

```text
sample video + deterministic evidence -> neutral reconstruction program
```

Gen1 learns the sample. It should capture rhythm, motion, layout, transitions, packaging, audio cues, and required asset slots. It must not copy sample pixels, sample text, sample logos, or sample audio.

### Gen2: Final Composition Codegen

```text
selected KB elements + target assets + composition plan -> final Remotion project
```

Gen2 creates a new video. It uses user-selected knowledge elements and target assets, not raw sample material.

## What Knowledge Base stores

KB stores reusable creative elements, not raw copied videos:

- structure patterns
- hook patterns
- rhythm patterns
- motion patterns
- transition patterns
- typography patterns
- layout patterns
- palette patterns
- visual asset generation recipes
- image prompt recipes
- music and SFX recipes
- voiceover style recipes
- CTA patterns
- reusable Remotion snippets

## Safety rule

```text
Sample material may be used as evidence.
Sample material must not become final reusable material.
```

Examples:

- sample hero head image -> evidence only
- hero head style, prompt, placement, motion -> reusable pattern
- sample music -> evidence only
- BPM, mood, cue points, music prompt -> reusable pattern

## Demo story

A strong V5 demo should show:

```text
1. Learn hook from sample A.
2. Learn subtitle rhythm from sample B.
3. Learn CTA card from sample C.
4. Learn music cue pattern from sample D.
5. User selects these elements from the KB.
6. Planner combines them into one coherent new video.
7. Gen2 writes new Remotion code.
8. Render produces final.mp4 with target/generated material only.
```
