# 09 — Renderer Specification

## 1. Render outputs

Every successful generation should produce:

```text
final.remotion.mp4
final.mp4
preview_frames/
render-contact-sheet.png
render-log.json
```

`final.remotion.mp4` is the direct Remotion output.

`final.mp4` is the final muxed output after FFmpeg processing.

## 2. Render inputs

Renderer accepts:

```ts
FinalVideoProgram
RenderRecipeV5
AudioLayer[]
```

## 3. Remotion root

V5 should introduce:

```text
apps/api/remotion/V5FinalRoot.tsx
apps/api/remotion/V5ReconstructionRoot.tsx
```

### V5ReconstructionRoot

Renders Gen1 neutral reconstruction preview.

### V5FinalRoot

Renders Gen2 final video.

## 4. Built-in components

Provide a component library that Gen2 can safely use:

```text
SceneFrame
MediaLayer
TextLayer
TitleCard
SubtitleBlock
CTAButton
ProductCard
ComparisonCard
MotionWrapper
TransitionWrapper
ShapeLayer
GradientBackground
AudioDebugOverlay
```

## 5. Allowed imports

Generated code may import only:

```text
react
remotion
@remotion/* approved packages
local approved components
zod
```

No network calls.
No arbitrary filesystem access.
No unapproved npm imports.

## 6. RenderRecipeV5 layer types

```ts
type RenderLayer =
  | MediaLayer
  | TextLayer
  | ShapeLayer
  | MotionLayer
  | TransitionLayer
  | PackagingLayer
  | AudioLayer
  | DebugLayer;
```

## 7. Audio rendering

Audio rendering should support:

- target/user audio
- generated voiceover
- generated/procedural SFX
- generated/procedural music bed
- ducking under voiceover
- fade in/out
- hit alignment with beat/cue points

FFmpeg final mux should verify audio stream exists unless explicitly disabled.

## 8. FFmpeg fallback

FFmpeg can handle:

- resize/crop to target aspect ratio
- concatenate rendered clips
- mux final audio
- convert codec to H.264/AAC
- add silent AAC if needed and allowed
- generate waveform/contact sheet

## 9. Render quality checks

After render:

- video exists and readable
- duration within tolerance
- no long black/blank segments
- no unexpected silence
- no frame corruption
- resolution correct
- audio stream valid
- first frame and final frame non-empty
