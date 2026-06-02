# 08. Migration Plan: v3/v1.3 to v4.1

This plan is based on the confirmed root causes F1-F8.

## F1. marketing evidence lost at template

### Before

`buildBeatCutTemplate()` copies evidence, but `buildFallbackTemplate()` non-beat branch only keeps style/rhythm/segments/slots.

### After

Introduce:

```ts
function attachEvidenceToTemplate<T extends Partial<StructureTemplate>>(
  base: T,
  analysis: VideoAnalysisResult,
  options?: { sourceSampleId?: string }
): T & EvidenceAttachedFields
```

Carry forward:

- `heroDescriptor`
- `typographyEvidence`
- `visualElementGraph`
- `audioStructure`
- `renderPlan.motionAtoms`
- `sourceEvidence/evidenceRefs`

### Validation

`marketing/learned-template.json`:

```text
visualElements > 0
typographyEvidence.length > 0
audioStructure.estimatedLayers.length > 0
motionAtoms.length > 0
```

## F2. motionAtoms/ribbon not consumed

### Before

`timeline.renderPlan.motionAtoms` exists, renderers iterate only clips.

### After

- `RenderRecipe.motionAtoms` top-level for compatibility.
- `MotionAtomLayer` in `layers[]`.
- Remotion `ParametricRibbonSurface`.
- FFmpeg 2D sweep fallback.

### Validation

- recipe has `MotionAtomLayer`.
- remotion render log consumed motion atoms.
- marketing video visibly includes ribbon/sweep.

## F3. Remotion TypographyLayoutSequence ignores media

### Before

Typography branch only renders text.

### After

- `RenderMediaLayer` helper.
- Legacy `TypographyLayoutSequence` with `material.assetIds` renders media background/card first.
- text overlays.

### Validation

Remotion media count equals image-bearing clip/layer count or has warnings.

## F4. CTA prompt pollution

### Before

`parsePromptToBrief()` uses first line as productTheme.name; CtaSlate displays it as brand.

### After

- parse productName/brandName/brief/ctaText/generationPrompt.
- sanitizeDisplayText max length and denylist.
- CtaSlate never reads raw prompt.

### Validation

No CTA display contains:

```text
15 秒 / 高转化 / CTA： / prompt / 生成 / 换成 / 结构 / 镜头 / 要求：
```

## F5. typography fidelity loss

### Before

Timeline has bboxNorm/animationHint, recipe loses bbox/fontSizeRatio, Remotion fixed center/fontSize=84.

### After

- TextLayer carries bboxNorm/fontSizeRatio/animation。
- RenderRecipe compiler maps timeline typography to TextLayer。
- Remotion uses bbox and font size。
- FFmpeg drawtext uses same fields where possible。

### Validation

Different bbox inputs produce different rendered positions; font size is not fixed.

## F6. elementGeometry hero bbox over-reuse

### Before

`elementGeometryForClip()` uses first hero_object bbox for hook/proof/object/montage.

### After

Priority:

1. clip.evidenceRefs -> element track。
2. slotInstanceId/family -> matching element family。
3. role-specific fallback layout。
4. first hero bbox only as last fallback, with reason。

Add:

- elementTrackId。
- slotInstanceId。
- fit mode。
- minAreaRatio。

### Validation

Image-bearing clips do not all share same bbox/motion unless evidenceRefs point to same track.

## F7. primitive collapse

### Before

`detectVideoType()` often maps to beat_cut; `selectPrimitive()` maps to a small vocabulary.

### After

- Extract TechniqueAtoms。
- Choose primitives from evidence + atoms + material + renderer capability。
- Add visible variants:
  - `KineticTypographySweep`
  - `ParametricRibbonSurface`
  - `MediaCardCascade`
  - `ProductPosterHero`
  - `SplitScreenCompare`
  - `ObjectTrackReveal`
  - `PriceBadgePulse`
  - `LightLeakTransition`

### Validation

Primitive sequence/histogram differs across editing, marketing, motion_graph_1, motion_graph_2.

## F8. BGM sameness

### Before

Fixed procedural synth; layer weights nearly identical.

### After

- Preserve audioStructure.
- AudioLayer per layer.
- Synth uses style/bpm/weights/accent/density/riser/impact.

### Validation

Audio plan parameters differ meaningfully across cases.

## Migration Stages

### Stage 0: Read and test baseline

- Snapshot current learned sample artifacts.
- Add fidelity script first.

### Stage 1: P0 hard fixes

- F1 evidence carry-forward。
- F3 Remotion media rendering。
- F4 CTA safe。
- Basic layer schema。

### Stage 2: Renderer consumption

- TextLayer fidelity。
- MotionAtomLayer。
- AudioLayer。

### Stage 3: Diversity and quality

- TechniqueAtoms。
- primitive selection。
- geometry and audio diversity。

### Stage 4: UI and demo

- Structure/gap/layer/preview pages。
- multi-version。
- natural edit。
