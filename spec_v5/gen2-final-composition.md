# 07 — Gen2 Final Composition Codegen

## 1. Purpose

Gen2 creates the final Remotion project for a new video.

It uses:

- selected KnowledgeElements
- CompositionProgram
- target assets
- generated assets
- audio plan
- safety policy

It does not use raw sample videos or sample audio.

## 2. Gen2 is separate from planner

Composition Planner outputs JSON:

```text
CompositionProgram
```

Gen2 outputs code:

```text
FinalVideoProgram.remotionProject
```

This separation makes the system more stable and easier to debug.

## 3. Input

```ts
interface Gen2Input {
  compositionProgram: CompositionProgram;
  selectedElements: KnowledgeElement[];
  targetAssets: TargetAssetProfile[];
  generatedAssets: GeneratedAsset[];
  audioLayers: AudioLayer[];
  allowedComponentLibrary: string[];
  safetyPolicy: SafetyPolicy;
}
```

## 4. Output

```ts
FinalVideoProgram
```

Must include:

- Remotion project files
- props schema
- fixture
- RenderRecipeV5
- explanation of used elements
- gap fill decisions
- audio decisions
- validation result

## 5. Code rules

Gen2 may:

- generate scene components
- compose layer components
- use target/generated assets
- use KB Remotion snippets with placeholders
- create new motion/transition code
- adjust palette/typography/pacing for coherence

Gen2 may not:

- reference sample video path
- reference sample audio path
- include sample watermark/logo
- include original sample subtitle copy
- import unapproved npm packages
- create network calls in render code
- read arbitrary local files

## 6. Required render contract

Generated Remotion code must expose:

```ts
export const MainComposition = (props: FinalVideoProps) => JSX.Element;
export const schema = z.object(...);
export const defaultFixture = {...};
```

The project must be renderable by:

```text
Remotion CLI or programmatic renderer
```

## 7. RenderRecipeV5

Gen2 must also output a renderer-neutral recipe.

This is the fallback and inspection format.

```ts
RenderRecipeV5 = {
  composition,
  layers,
  audioLayers,
  assets,
  provenance,
  explanations
}
```

If Remotion code fails, renderer can use RenderRecipeV5 with built-in components.

## 8. Explanation requirements

Gen2 must explain:

- which KB elements were used
- where each element was applied
- why it fits the creative brief
- which gaps were filled
- which audio decisions were made
- which target/generated assets were used

Example:

```json
{
  "usedElements": [
    {
      "elementId": "hook_fast_reveal_001",
      "sourceSampleId": "sample_A",
      "appliedAtSec": 0.0,
      "reason": "Used as high-click opening hook with target product hero image."
    }
  ]
}
```

## 9. Fallback

If Gen2 fails:

```text
1. Repair code.
2. Repair schema/fixture.
3. Regenerate only failing component.
4. Use deterministic compose fallback.
```

Deterministic compose fallback:

- maps CompositionProgram sections to built-in Remotion scene templates
- maps KnowledgeElements to layer presets
- uses target/generated assets
- uses procedural audio fallback
- outputs final RenderRecipeV5

## 10. Coherence work

Gen2 should not simply concatenate selected elements. It must harmonize:

- palette
- typography
- section duration
- motion intensity
- audio density
- CTA style
- vertical-specific conventions

Gen2 should follow `CompositionProgram.stylePlan`.
