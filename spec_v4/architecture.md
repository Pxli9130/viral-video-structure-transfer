# 03. Architecture

## 1. End-to-End Pipeline

```text
Sample Video
  ↓
[1] Evidence Analyzer
    ffprobe / scene detection / optical flow / OCR / ASR / beat / frame sheets
  ↓
VideoEvidenceBundle
  ↓
[2] Structure + Atom Extractor
    StructureTemplate + TechniqueAtoms
  ↓
User Assets + Prompt
  ↓
[3] Asset Analyzer
    AssetProfile[]
  ↓
[4] Slot Matcher + Gap Analyzer
    GapReport + FillPlan
  ↓
[5] Transfer Planner
    selected atoms + narrative arc + version strategy
  ↓
[6] RenderRecipe Compiler
    layer-based RenderRecipe v4
  ↓
[7] Renderer
    Remotion visual layers + FFmpeg mux/fallback
  ↓
final.mp4 + final.remotion.mp4 + preview frames
  ↓
[8] Evaluation + UI
    fidelity gates + no-copy gates + diversity gates
```

## 2. Module Responsibilities

### 2.1 Evidence Analyzer

Responsible for accurate low-level facts:

- video metadata。
- shot boundaries。
- motion energy。
- beat grid。
- OCR/ASR text timing。
- visual element candidates。
- frame sheets。

### 2.2 Structure + Atom Extractor

Converts evidence into:

- script structure。
- rhythm structure。
- packaging structure。
- template slots。
- TechniqueAtoms。

### 2.3 Asset Analyzer

Analyzes user materials:

- image subject, saliency, colors。
- video shots and highlights。
- text selling points and CTA。
- provenance and renderability。

### 2.4 Gap Analyzer

Compares required slots/atoms with assets:

- matched / weak_match / missing。
- impact。
- repair options。
- selected fill plan。

### 2.5 Transfer Planner

Decides the new video:

- narrative arc。
- atoms used。
- material assignment。
- version strategy。
- fallback decisions。

### 2.6 RenderRecipe Compiler

Produces renderer-neutral contract:

- clips for time/role。
- layers for pixels/audio。
- evidenceSummary。
- sourcePolicy。
- warnings/droppedEvidence。

### 2.7 Renderer

Remotion:

- rich motion graphics。
- kinetic typography。
- ribbons。
- card stacks。
- CTA。

FFmpeg:

- source video slicing。
- image/video mux。
- final encode。
- fallback overlays。
- audio mix。

## 3. Recommended Repo Shape

Use current monorepo. As-built shape of the modules that implement this spec:

```text
apps/
  web/
    src/components/
      analysis/
      knowledge/
      transfer/
      timeline/
      preview/
  api/
    src/server.ts            # all HTTP routes registered here (no routes/ dir)
    src/adapters/renderers.ts
    remotion/
      ViralRecipeRoot.tsx    # layer interpretation inline: LayerView / ClipView /
                             # MediaSurface / MotionAtomFallback / ParametricRibbonSurface
                             # (no components/ subdir)
      ReconstructionRoot.tsx
      index.tsx

packages/
  shared/
    src/engine/
      planner.ts
      atomExtractor.ts
      slotInduction.ts
      slotMapper.ts
      fillPlanner.ts
      gapDetector.ts
      gapRepairRanker.ts
      templateBuilder.ts
      timelineBuilder.ts
      renderRecipeV41.ts
      variantPlanner.ts
    src/model-router/         # router.ts, modelRegistry.ts, providerPolicy.ts, types.ts
    src/schemas.ts            # all schema validation consts (no schemas/ dir)
    src/types.ts

scripts/
  analyze-evidence-timeline.py
  inspect-learning-fidelity.mjs
  render-case.mjs
  run-learn-samples.mjs
  evaluate-render-quality.mjs
  diversity_ncc.py

spec_v4/                     # spec docs live here (no docs/spec_v4/)
```

## 4. Optional Later Infrastructure

Do not block v4 on these:

```text
PostgreSQL
Redis
BullMQ
Prisma
MinIO
Kubernetes
```

They are valuable only after artifact pipeline works.

## 5. Main Runtime Flows

### Flow A: Learn sample

```text
POST /api/assets/:assetId/analyze
  → analysis.json
  → frame sheets
  → StructureTemplate
  → TechniqueAtoms
  → fidelity report
```

### Flow B: Generate from new content

```text
POST /api/generations   (alias: POST /api/generate)
  → analyze assets
  → match slots
  → gap report
  → transfer plan
  → render recipe
```

### Flow C: Render

```text
POST /api/generations/:generationId/render
  body: { "rendererTarget": "remotion" | "ffmpeg" | "remotion_recipe" | "hyperframes" | "html_preview" }
  (rendererTarget is a JSON body field, not a query param; default = generation.timeline.rendererTarget, else html_preview)
```

### Flow D: Edit

```text
POST /api/generations/:generationId/revise
  input: instruction + generation
  output: revised variant generation (with rerender)
```

## 6. Artifact Layout

```text
artifacts/
  learned_samples_max/
    marketing/
      analysis.json
      learned-template.json
      gap-report.json
      timeline.json
      render-recipe.json
      final.mp4
      final.remotion.mp4
      evidence-fidelity.json
      previews/
    editing/
    motion_graph_1/
    motion_graph_2/
```

## 7. Error Handling Principle

No silent empty.

Every empty/dropped/fallback path must produce one of:

```json
{
  "kind": "typographyEvidence",
  "stage": "template",
  "reason": "no OCR detected or OCR unavailable",
  "severity": "info"
}
```

or fatal if it indicates a bug.
