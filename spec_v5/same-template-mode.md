# V5.1 — Same Template Reconstruction Mode

> **New default product behavior.** Upload a video you like → the system turns it into an **editable,
> reusable Remotion template** (a `RemotionTemplateCapsule`) → enter a new theme → it auto-fills missing
> visuals/copy/audio and **renders the same motion template with new content**.
>
> Canonical contracts live in code: `packages/shared/src/contracts-v5/templateCapsule.ts`
> (exported from `@vvst/shared` as the `v5` namespace).

## Safety boundary (the whole point)

```
Reusable (template):  Remotion component code · timing · layout · animation curves ·
                      typography behavior · transition choreography · audio cue positions ·
                      props schema · slot schema
NOT reusable (sample content): original image pixels · video frames · audio · subtitles/text ·
                      logo/watermark/brand/person/product assets
```

The generated template component is **props-driven** — every piece of content comes from `props`
(`assets`/`copy`/`audio`/`theme`/`palette`); the code contains **no sample paths, no sample text, no
sample asset/audio/video URLs**. This is enforced by `validateTemplateCapsule` (gates T5/T6/T9/T10).

## Two knowledge levels in the KB

```
Knowledge Base
├── Template Capsules (Level 1, the DEFAULT generation object)  ← saveTemplateCapsule / listTemplateCapsules
│     └── full reusable Remotion template per learned sample
└── Atomic Elements (Level 2, advanced "mix" mode)              ← still extracted from every sample
      └── hook / rhythm / typography / transition / cta / asset-recipe / audio-recipe patterns
```

## Learn pipeline (per sample)

```
Sample video → deterministic evidence → Gen1 NeutralReconstructionProgram
  → Gen1 Remotion Template Reconstruction (runGen1TemplateReconstruction)  → RemotionTemplateCapsule
  → validateTemplateCapsule (compile + safety scan + T1–T10)
  → KB.saveTemplateCapsule  (+ runExtractElements → KB atomic elements)
```

Artifacts written per sample (`storage/generated/v5/learn/<assetId>/`):
`remotion-template-capsule.json`, `template-validation.json`, plus the existing
`evidence-timeline-v5.json` / `neutral-reconstruction-program.json` / `candidate-elements.json` /
`knowledge-elements.json`.

## Generation modes

```ts
type GenerationMode = "same_template" | "modify_template" | "mix_elements";
```

`DEFAULT_GENERATION_OPTIONS_V5`: `generationMode: "same_template"`, `aigcGapFill.mode: "auto_on"`
(`imageFill:"aigc"`, `audioFill:"procedural"`, `textFill:"llm"`). `mix_elements` is the advanced path
(the previous compose pipeline) and is **kept**.

### same_template flow (default)

```
load RemotionTemplateCapsule (options.templateCapsuleId or latest)
  → read slotSchema → analyze user target assets → match to slots → gap report
  → auto AIGC gap fill (default ON):
       image slot: user asset → AIGC image (AssetRecipe + theme) → procedural designed visual
       text slot : LLM/brief copy (never sample text)
       audio slot: procedural cue-aware bed (never sample audio)
  → bind resolved content into template props → TemplateInstance
  → render the STORED capsule CODE with the bound props (renderTemplateCapsule: dynamic bundle+renderMedia)
  → no-copy / scorecard
```

If `aigcGapFill.mode = "off"` and required slots remain missing → **readiness is downgraded to
`technical_demo`** with explicit warnings; the system does **not** silently fall back to text cards
while still claiming `review_demo`.

## T-gates (Part 10)

`T1` capsule exists · `T2` template code compiles · `T3` no sample asset paths in code · `T4` props
schema exists · `T5` slot schema exists · `T6` all required slots bound · `T7` AIGC fill executed for
missing required slots (when enabled) · `T8` no unresolved placeholder in final props · `T9` final
render uses template code (not the fixed fallback renderer) · `T10` no sample pixels/audio/text in
final · `T11` active motion coverage recorded · `T12` final mp4 exists.

Readiness rules: fixed-fallback render or missing required slots → max `technical_demo`; expected AIGC
fill that produced no asset → fail `review_demo`; sample asset path in template code → fail.

## API

```
POST /api/v5/learn-samples        → { learned: [{ templateCapsuleId, templateSlots, templateCompiles, … }] }
GET  /api/v5/templates[?sourceSampleId&tag&q]   → capsule metadata + slotSchema (no code)
GET  /api/v5/templates/:id        → full capsule
POST /api/v5/generations          → default generationMode=same_template; returns
   { generationMode, templateCapsuleId, usedTemplateCode, usedFallbackRenderer, finalVideoUrl,
     templateInstance, finalProgram, generatedAssets, scorecard }
```

`final-video-program.json` (same_template) states: `renderMode` (`bespoke_codegen` when the capsule
code rendered, else `fallback`), `fallbackUsed`, and the bound `remotionProject` (the capsule files +
fixture); the result records `usedTemplateCode` / `usedFallbackRenderer` / `slotBindings` /
`generatedAssets`.

## Pipeline modules

```
apps/api/src/pipeline-v5/runGen1TemplateReconstruction.ts   — Gen1 props-driven template codegen
apps/api/src/pipeline-v5/validateTemplateCapsule.ts         — compile + safety scan + T-gates
apps/api/src/pipeline-v5/renderTemplateCapsule.ts           — dynamic per-generation capsule render
apps/api/src/pipeline-v5/runSameTemplateGeneration.ts       — same_template orchestrator + binding
apps/api/src/services/knowledgeBaseV5.ts                    — Level-1 capsule storage
```
