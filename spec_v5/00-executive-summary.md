# 00 — Executive Summary

## Goal

Build an AI creative system that can learn reusable short-video creation methods from sample videos, convert them into inspectable Remotion template capsules and knowledge elements, then bind new ordered user assets or generated assets to create new videos.

V5 is designed for three outcomes:

1. **Better learning**: use deterministic evidence plus VLM/codegen to understand sample videos in a grounded way.
2. **Better reuse**: store Level-1 Remotion template capsules and Level-2 reusable structure atoms, asset recipes, audio recipes, layout patterns, motion snippets, and Remotion snippets.
3. **Better generation**: default to same-template migration for stable output, and support advanced multi-sample element mixing when the user wants a new structure.

## Why V5 is different from V4

V4 is mostly:

```text
EvidenceBundle -> StructureTemplate -> TechniqueAtoms -> GapReport -> RenderRecipe -> final.mp4
```

V5.1 default path is:

```text
EvidenceTimeline
  -> NeutralReconstructionProgram
  -> RemotionTemplateCapsule
  -> TemplateSlot schema
  -> ordered target assets / slot assignments
  -> TemplateInstance
  -> final.mp4
  -> TransferTrace + Scorecard
```

V5.1 advanced path keeps the original Program-KB idea:

```text
EvidenceTimeline
  -> NeutralReconstructionProgram
  -> CandidateElements
  -> KnowledgeBase
  -> CompositionProgram
  -> FinalVideoProgram
  -> final.mp4
```

The biggest change is that **program-as-IR** becomes the learning layer. The system does not only describe a sample; it creates a neutral, placeholder-based Remotion-like program and a reusable Remotion template capsule that can be inspected, previewed, decomposed, and reused with new assets.

## Two reusable generation layers

V5 has two generation layers:

### Gen1: Neutral Reconstruction Synthesizer

```text
sample video + deterministic evidence -> neutral reconstruction program + Remotion template capsule
```

Gen1 learns the sample. It should capture rhythm, motion, layout, transitions, packaging, audio cues, required asset slots, and a renderable capsule contract. It must not copy sample pixels, sample text, sample logos, or sample audio as reusable final material.

### Same-template migration: stable default generation

```text
RemotionTemplateCapsule + brief + ordered target assets + slot assignments -> TemplateInstance -> final.mp4
```

This is the main demo path. It preserves the learned motion grammar and structure while replacing sample-specific content with user assets, generated assets, rewritten copy, and safe audio.

### Gen2: advanced final composition codegen

```text
selected KB elements + target assets + composition plan -> final Remotion project
```

Gen2 creates a new structure from multiple learned elements. It uses user-selected knowledge elements and target assets, not raw sample material.

## What Knowledge Base stores

KB stores reusable creative elements, not raw copied videos:

- Remotion template capsules
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
1. Upload/select one sample video and learn its structure.
2. Show the structure report, keyframes, multi-track timeline, slot strategy, and safety boundary.
3. Upload target assets and order them so first selected appears first.
4. Bind target assets to required slots, or let AIGC fill missing slots.
5. Generate with same-template mode for a stable full loop.
6. Review Transfer Map, Packaging, scorecard, and export evidence.
7. Optionally switch to mixed-elements mode to combine methods learned from different videos.
8. Optionally use natural-language revise to patch timing, text, color, CTA, or asset placement.
```
