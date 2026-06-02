# 07. Data Contracts and Artifact Conventions

## 1. Artifact Directory

The as-built layout is FLAT: each case directory holds its artifacts directly (no
`input/analysis/template/transfer/render/eval` sub-trees). The two real roots are:

- `docs/artifacts/learned_samples_max/<case>/` — `inspect-learning-fidelity.mjs` default root.
- `docs/artifacts/max_ability_runs/<timestamp>/<case>/` — `run-max-ability-four-samples.mjs` output.

```text
docs/artifacts/learned_samples_max/
  <case>/
    analysis.json
    learned-template.json
    slot-mapping.json
    gap-report.json
    timeline.json
    render-recipe.json
    final.mp4
    final.remotion.mp4
    preview_frames/
    render-contact-sheet.png
```

The deep `input/analysis/template/transfer/render/eval` tree above is a target/idealized
layout, not the current on-disk shape. Backward compatibility: scripts should auto-detect
both the flat (current) and deep (target) layouts.

## 2. ID Conventions

| Entity | Prefix |
|---|---|
| sample | `sample_` |
| shot | `shot_` |
| typography evidence | `typo_` |
| visual element | `ve_` |
| motion atom | `ma_` |
| technique atom | `atom_` |
| slot | `slot_` |
| asset | `asset_` |
| clip | `clip_` |
| layer | `layer_` |

## 3. EvidenceRefs

Evidence refs should use stable URI-like strings:

```text
evidence://sample_marketing/visual/ve_001
evidence://sample_marketing/typography/typo_003
evidence://sample_marketing/motion/ma_ribbon_001
evidence://sample_marketing/audio/layer_kick
```

Every TechniqueAtom and RenderRecipe layer should have at least one `evidenceRefs[]` or explicit `fallbackReason`.

## 4. Provenance

Renderable material provenance:

```ts
provenance.source:
  | "user_uploaded"
  | "source_video"
  | "aigc_generated"
  | "fixture"
```

Non-renderable evidence provenance:

```ts
provenance.source = "sample_evidence"
provenance.renderable = false
```

Rule:

```text
sample_evidence must never become MediaLayer.material.assetIds.
```

## 5. Product Theme Contract

Do not store raw prompt in display fields.

```ts
productTheme = {
  productName: "AeroSpin 便携涡轮小风扇",
  brandName: "AeroSpin",
  brief: "便携涡轮小风扇，高速降温",
  sellingPoints: ["小巧便携", "高转速", "长续航"],
  ctaText: "现在入手",
  generationPrompt: "raw prompt only for audit, never displayed"
}
```

Legacy compatibility:

```ts
productTheme.name = productTheme.productName
```

## 6. Fallback Reasons

The recipe-layer `fallbackReason` is a plain descriptive string — the render-recipe-v4.1
schema declares `baseLayer.fallbackReason` as `type: "string"` (e.g. `"full 3D unsupported;
using 2D sweep overlay"`). It is not a structured object on the layer itself.

The structured form below is a separate diagnostics surface (provider decisions), not the
layer field. Note the implemented severity vocabulary is `info | warning | fatal`
(`ProviderDecision.severity`, model-router/types.ts), not `warn`:

```json
{
  "kind": "motionAtom:parametric_ribbon_surface",
  "stage": "ffmpeg_renderer",
  "reason": "full 3D unsupported; using 2D sweep overlay",
  "severity": "warning"
}
```

## 7. Fidelity Counts

Counts should be computed in a uniform way:

- `visualElements`: `visualElementGraph.elements.length` or family counts.
- `typographyRuns`: `typographyEvidence.length` or TextLayer count with bbox.
- `audioLayers`: `audioStructure.estimatedLayers.length` or AudioLayer count.
- `motionAtoms`: `motionAtoms.length` or MotionAtomLayer count.

## 8. Schema Compatibility

During migration:

- v1.3 recipe accepted。
- v4 recipe preferred。
- old clip fields compile into layers with `fallbackReason: "legacy_clip_migration"`。
