# Structure Protocol

The system transfers structure, not source pixels. A sample video can teach timing, geometry, typography, motion, rhythm and packaging, but cannot satisfy visual slots in the target render by default.

## Evidence Objects

- `VideoAnalysisResult`: raw analysis output.
- `StructureTemplate`: reusable timeline/slot grammar.
- `TechniqueAtom`: reusable, auditable technique extracted from evidence.
- `GapReport`: what could not be fulfilled from target material.
- `FillPlan`: selected fill strategies and local/cloud backend choice.
- `RenderRecipe`: final renderer contract.

## v4.1 Recipe Rules

Every meaningful render element should be represented as a layer:

- `media`: user, source or generated target visuals with provenance.
- `text`: visible copy with bbox, font size and animation evidence.
- `motion_atom`: procedural motion such as ribbons, sweeps or impact flashes.
- `audio`: procedural/user/licensed audio instructions.

Each clip keeps an auditable primitive reason. Each layer keeps `evidenceRefs` or a `fallbackReason`.

## Version Strategies

PR3 versions are real recipe mutations:

- `high_click`: shorter hook, larger opening text, stronger motion/audio accents and earlier CTA.
- `high_conversion`: product and proof earlier, CTA longer, selling points ordered by concrete benefits.
- `high_quality`: fewer subtitle layers, softer motion/audio and cleaner palette.

The diff is stored in `recipe.versionDiff.changedDimensions`.

## Natural-Language Edits

The required commands patch recipe structure directly:

- `开头更抓人一些`: expands hook emphasis, text size and motion intensity.
- `减少字幕，增强节奏感`: removes or shortens subtitle layers and raises rhythmic audio weights.
- `把商品信息提前`: moves media/selling-point/CTA timing earlier.

If an edit cannot be recognized, the patch reports `renderNeeded: false` instead of pretending a render change exists.

