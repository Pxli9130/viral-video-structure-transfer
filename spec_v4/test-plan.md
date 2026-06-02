# 10. Test Plan

## 1. Test Pyramid

```text
Unit tests:
  schema, parsing, mapping, sanitization, geometry, atom extraction
Integration tests:
  analysis -> template -> recipe, renderer consumption, fidelity script
E2E/demo tests:
  marketing/editing/motion_graph cases render outputs
```

## 2. Required Unit Tests

### U1: buildFallbackTemplate evidence carry-forward

Input mock analysis:

```text
visualElements=3, typography=2, audioLayers=2, motionAtoms=1
```

Assert fallback template preserves all.

### U2: parsePromptToBrief + sanitizeDisplayText

Input:

```text
AeroSpin 便携涡轮小风扇。15 秒高转化...CTA：现在入手...
```

Assert:

```text
productName = AeroSpin 便携涡轮小风扇
ctaText = 现在入手
display does not include raw prompt
```

### U3: RenderRecipe v4 schema compatibility

- old v1.3 recipe validates via legacy path。
- new v4 recipe validates with layers。

### U4: TextLayer bbox/fontSize style

Given two bboxes/fontSizeRatio values, Remotion style differs.

### U5: MotionAtomLayer parametric_ribbon_surface

Recipe with ribbon produces Remotion component and FFmpeg fallback plan.

### U6: TypographyLayoutSequence media rendering

Legacy clip with material.assetIds must render media.

### U7: elementGeometry no over-reuse

Multiple evidence elements + multiple image clips should not all use first hero bbox.

### U8: TechniqueAtom extraction

Evidence with ribbon -> ParametricRibbonSurface atom.
Evidence with text sweeps -> KineticTypographySweep atom.

### U9: primitive diversity

Four fixtures produce different primitive histograms.

### U10: audioPlan diversity

Different audioStructure inputs produce distinct audio layers/synth params.

### U11: safety invariant

Assert:

```text
sampleFrameCopyAllowed=false
sampleAudioCopyAllowed=false
sample evidence asset not in media material.assetIds
provenance preserved
```

## 3. Fidelity Gates

`inspect-learning-fidelity` fatal conditions:

Each fatal condition is emitted as a `droppedEvidence[]` entry with `severity: "fatal"`, which sets the report `status` to `fail` (the gates are keyed by `kind`, not G-numbers):

| Gate (kind) | Fatal Condition |
|---|---|
| visualElements | analysis visual > 0 and template visual = 0 |
| typography | analysis typography > 0 and recipe text bbox/fontSize = 0 |
| motionAtoms | analysis motionAtoms > 0 and recipe motionAtomLayers = 0 |
| audio | analysis audio > 0 and recipe audioLayers = 0 |
| mediaRender | image-bearing TypographyLayoutSequence has no media render path |
| displayText | display field contains raw prompt tokens |
| sampleCopy | sample path/id in renderable material |

## 4. Render Quality Gates

| Gate | Target |
|---|---|
| final exists | final.mp4 and/or final.remotion.mp4 |
| dimensions | 720x1280 or configured aspect |
| duration | 10-20 sec for challenge showcase |
| clip coverage | every clip has layerIds |
| evidence coverage | every layer evidenceRefs or fallbackReason |
| media coverage | media layers rendered |
| text coverage | text visible and positioned |
| motion coverage | motion atoms visible/fallback |
| audio coverage | audio layers present |
| safety | sample copy 0 |

## 5. Case Acceptance Matrix

| Case | Must Pass |
|---|---|
| marketing | visual/typography/audio/motion evidence preserved; ribbon visible; Remotion media visible; CTA safe |
| editing | typography + source montage + varied geometry; no small sticker bug |
| motion_graph_1 | motion/card/sweep atoms; primitive differs from editing |
| motion_graph_2 | motion/card/sweep atoms; primitive differs from motion_graph_1 |

## 6. Commands

Scripts should be discovered first. Suggested commands:

```bash
cat package.json
find apps packages scripts -maxdepth 3 -name package.json -print
npm run typecheck
npm test
npm run lint
node scripts/inspect-learning-fidelity.mjs --case marketing
node scripts/inspect-learning-fidelity.mjs --case editing
node scripts/inspect-learning-fidelity.mjs --case motion_graph_1
node scripts/inspect-learning-fidelity.mjs --case motion_graph_2
node scripts/render-case.mjs --case marketing
node scripts/evaluate-render-quality.mjs --case marketing --gates v3 --strict
```

If command does not exist, report actual alternatives; do not invent passing results.

## 7. Regression Tests for Known Bugs

| Bug | Regression Test |
|---|---|
| marketing template 0/0/0 | fallback template carry test |
| Remotion 0 pics | TypographyLayoutSequence media test |
| CTA prompt pollution | display denylist test |
| ribbon not rendered | MotionAtomLayer test |
| fixed centered text | bbox style test |
| hero bbox overuse | geometry diversity test |
| primitive collapse | primitive histogram test |
| audio sameness | synth params distance test |
