# 09. Implementation Tasks

## P0 — Make It Work

### T0.1 Baseline artifact inventory

- Locate learned sample artifacts.
- Record counts for marketing/editing/motion_graph_1/motion_graph_2.
- Run git status.

Acceptance:

```text
baseline report saved under artifacts/.../eval/baseline-fidelity.json
```

### T0.2 Evidence carry-forward

Files likely touched:

- `packages/shared/src/engine/planner.ts`
- `packages/shared/src/types.ts`

Tasks:

- Add `attachEvidenceToTemplate()`.
- Call from `buildBeatCutTemplate()` and `buildFallbackTemplate()`.
- Add tests.

Acceptance:

```text
marketing template visual > 0
typography > 0
audio > 0
motionAtoms > 0
```

### T0.3 ProductTheme sanitize

Files:

- planner prompt parsing.
- Remotion CTA component.
- shared utils maybe.

Tasks:

- Split productName/brandName/brief/ctaText/generationPrompt.
- Add sanitizeDisplayText.
- Update CtaSlate.
- Add tests.

Acceptance:

```text
CTA does not display raw prompt
productTheme.name length <= safe max
```

### T0.4 Layer-based RenderRecipe

Files:

- types.
- schemas.
- buildRenderRecipe.
- renderers.

Tasks:

- Add layers[] optional.
- Add MediaLayer/TextLayer/MotionAtomLayer/AudioLayer.
- Compile old clips to layers.
- Preserve old clips.

Acceptance:

```text
old recipe validates
new recipe validates
marketing recipe has layers[]
```

### T0.5 Remotion layer interpreter

Files:

- `apps/api/remotion/ViralRecipeRoot.tsx`
- new components under `apps/api/remotion/components/`

Tasks:

- `RenderLayer` dispatcher.
- `RenderMediaLayer`.
- `RenderTextLayer`.
- `RenderMotionAtomLayer`.
- legacy fallback.

Acceptance:

```text
TypographyLayoutSequence with assetIds renders media
TextLayer uses bbox/fontSize
MotionAtomLayer visible
```

### T0.6 FFmpeg fallback consumption

Files:

- `apps/api/src/adapters/renderers.ts`

Tasks:

- Use bbox/fontSize.
- Add motion atom fallback plan/log.
- Use audio layers.

Acceptance:

```text
render-log.ffmpeg.json records consumed motionAtoms/audioLayers
```

### T0.7 Fidelity script

File:

- `scripts/inspect-learning-fidelity.mjs`

Tasks:

- Load artifacts by case or explicit paths.
- Count evidence across layers.
- Detect fatal losses.
- Exit 1 on fatal.

Acceptance:

```bash
node scripts/inspect-learning-fidelity.mjs --case marketing
```

## P1 — Stop Looking Like a Template

### T1.1 TechniqueAtom extraction

Tasks:

- Add `techniqueAtoms.ts`.
- Extract atoms from visual/typography/motion/audio evidence.
- Add renderer component mapping.

Acceptance:

```text
marketing has ParametricRibbonSurface atom
editing has KineticTypography/SourceMontage atoms
motion_graph has motion/card/sweep atoms
```

### T1.2 Evidence-based primitive selection

Tasks:

- Replace role/videoType-only mapping.
- Add evidence score.
- Add fallback reason.

Acceptance:

```text
four learned samples primitive histograms not identical
```

### T1.3 Geometry strategy

Tasks:

- Track elementTrackId/slotInstanceId.
- Change `elementGeometryForClip`.
- Add minAreaRatio / fit.

Acceptance:

```text
no all-image-clips-same-hero-bbox warning
```

### T1.4 Audio fidelity

Tasks:

- Carry audioStructure.
- Generate AudioLayers.
- Synth from layers.

Acceptance:

```text
audio plan differs across cases
```

## P2 — Demo and Product

### T2.1 UI panels

- EvidenceTimeline。
- TechniqueAtomLibrary。
- SlotMappingTable。
- GapReportPanel。
- LayerTimeline。
- RenderPreview。

### T2.2 Multi-version

- high_click。
- high_conversion。
- high_quality。

Each affects at least two of:

- hook duration。
- text density。
- CTA placement。
- motion intensity。
- audio density。

### T2.3 Natural edit

Support three commands:

- 开头更抓人一些。
- 减少字幕，增强节奏感。
- 把商品信息提前。

## Final Tasks

- Run learn samples.
- Render marketing and at least one other case with both renderers.
- Generate demo report.
- Update README and demo playbook.
