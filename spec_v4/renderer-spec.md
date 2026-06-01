# 05. Renderer Spec

## 1. Renderer Contract

Both Remotion and FFmpeg consume RenderRecipe. Renderer must not re-infer structure from `clip.role` except as explicit fallback.

Every renderer output should write a `render-log.json`:

```json
{
  "renderer": "remotion",
  "recipeVersion": "render-recipe-v4",
  "consumed": {
    "mediaLayers": 8,
    "textLayers": 9,
    "motionAtomLayers": 1,
    "audioLayers": 4
  },
  "fallbacks": [],
  "warnings": []
}
```

## 2. Remotion Renderer

### 2.1 Root Design

```tsx
export function ViralRecipeRoot({ recipe }: { recipe: RenderRecipe }) {
  if (recipe.layers?.length) {
    return <LayerRecipeRoot recipe={recipe} />;
  }
  return <LegacyClipRecipeRoot recipe={recipe} />;
}

function LayerRecipeRoot({ recipe }: { recipe: RenderRecipe }) {
  return (
    <AbsoluteFill>
      {recipe.layers
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((layer) => (
          <Sequence
            key={layer.id}
            from={secToFrame(layer.startSec)}
            durationInFrames={secToFrame(layer.durationSec)}
          >
            <RenderLayer layer={layer} recipe={recipe} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
```

### 2.2 Required Components

| Component | Required for | Notes |
|---|---|---|
| `RenderMediaLayer` | image/video/procedural backgrounds | Uses asset resolver; failures logged |
| `RenderTextLayer` | all text | Uses bboxNorm/fontSizeRatio |
| `RenderMotionAtomLayer` | ribbon/sweep/flash | Dispatches by atom.kind |
| `ParametricRibbonSurface` | marketing ribbon | 2.5D SVG/CSS first; three.js optional later |
| `KineticTypographySweep` | text sweep / kinetic title | Should be visible, not just animationHint |
| `MediaCardCascade` | card stack / image orbit | Uses multiple assets |
| `ProductPosterHero` | product poster hero | image + title + badge |
| `CTAEndSlate` | final CTA | safe productName + ctaText only |

### 2.3 Fix: TypographyLayoutSequence with Media

If legacy clip has:

```json
{
  "selectedPrimitive": "TypographyLayoutSequence",
  "material": { "assetIds": ["..."] }
}
```

Then Remotion must render media first and overlay text. It cannot output 0 pics.

### 2.4 TextLayer Layout

`bboxNorm` to CSS:

```ts
const style = {
  position: "absolute",
  left: `${bbox.x * 100}%`,
  top: `${bbox.y * 100}%`,
  width: `${bbox.w * 100}%`,
  height: `${bbox.h * 100}%`,
  fontSize: clamp(height * fontSizeRatio, min, max),
};
```

Animation mapping:

| animation.enter | Remotion behavior |
|---|---|
| `pop` | scale spring from .85 to 1 |
| `scale` | scale interpolate on beat |
| `slide_left` | x from -bbox.w to 0 |
| `slide_right` | x from +bbox.w to 0 |
| `sweep` | clip-path / mask reveal |
| `typewriter` | substring reveal |

### 2.5 CTA Safety

`CTAEndSlate` allowed fields:

- `productTheme.brandName` if safe。
- else `productTheme.productName`。
- `productTheme.ctaText`。

Forbidden fields:

- `generationPrompt`。
- `rawPrompt`。
- long `productTheme.name` from legacy prompt。

### 2.6 MotionAtom Rendering

Minimum for `parametric_ribbon_surface`:

- animated SVG path。
- direction right-to-left / left-to-right。
- opacity。
- thickness。
- color gradient。
- zIndex order。

## 3. FFmpeg Renderer

FFmpeg renderer should be pragmatic, not pixel-perfect to Remotion.

### 3.1 Responsibilities

- source video cut/crop/concat。
- image overlay。
- drawtext fallback。
- 2D ribbon/sweep fallback。
- audio synth and mix。
- final mux and encode。

### 3.2 MotionAtom Fallback

`parametric_ribbon_surface` fallback acceptable options:

1. Generate transparent PNG/SVG frames and overlay.
2. Use FFmpeg drawbox/drawgrid/geq for moving translucent band.
3. Render Remotion overlay video with alpha, then mux.

Must not silently skip.

### 3.3 Typography Fallback

FFmpeg should read:

- `TextLayer.layout.bboxNorm`。
- `TextLayer.typography.fontSizeRatio`。
- `TextLayer.animation.enter` where supported。

If not supported, write fallback reason.

### 3.4 Audio Synth

Audio synth must use `AudioLayer`:

- style。
- bpm。
- weights。
- accentPattern。
- riser/impact positions。
- densityCurve。

It should not use one fixed formula with tiny weight differences.

## 4. Renderer Consumption Matrix

| Field | Remotion | FFmpeg |
|---|---|---|
| `layers[].type=media` | full | full/fallback |
| `TextLayer.bboxNorm` | full | drawtext layout |
| `TextLayer.fontSizeRatio` | full | drawtext size |
| `MotionAtomLayer.parametric_ribbon_surface` | full 2.5D | fallback |
| `AudioLayer` | optional visualization / pass-through | full procedural mix |
| `productTheme.generationPrompt` | never display | never display |
| `sourcePolicy.sampleFrameCopyAllowed=false` | enforced | enforced |
| `provenance` | logged | logged |

## 5. Renderer Gates

- image-bearing layers count equals rendered media count or has warning.
- text layers rendered with non-default bbox if provided.
- motionAtoms consumed or fatal.
- CTA safe.
- no sample material rendered.
