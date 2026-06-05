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
  → Gen1 Remotion Template Reconstruction (runGen1TemplateReconstruction)  → RemotionTemplateCapsule (deterministic codeBundle)
  → [opt-in] Gen1 AI capsule codegen (runGen1CapsuleCodegen) — apply≠promote, triple-gated
  → validateTemplateCapsule (compile + safety scan + T1–T10)
  → [opt-in] real frame render (renderCapsuleStill) → quality.renderPreviewPassed (T8 earned)
  → KB.saveTemplateCapsule  (+ runExtractElements → KB atomic elements)
```

**AI capsule codegen (opt-in `runCapsuleCodegen`).** The deterministic capsule is the guaranteed
fallback. When enabled, `runGen1CapsuleCodegen` asks Gemini (`GEMINI_CODEGEN_MODEL`) to regenerate
**only** `codeBundle.files` (keeping `componentName`/`entryFile`/`propsSchema`/`slotSchema`/timing/safety
fixed). The AI bundle is *applied* (held in memory) but only *promoted* (replaces the deterministic
code) after **three gates** pass: (1) compile (T2), (2) safety/no-copy (T5/T6/T6b/T9/T10 — no sample
paths/URLs/forbidden API/copied text), (3) a **real render** (`renderCapsuleStill` → renderStill frame 0).
On any failure the deterministic code stays. The prompt is fed only structural/numeric evidence +
the deterministic TSX as a worked example — never raw sample copy. Learn response reports
`templateCode = ai | deterministic_fallback | deterministic`.

**Render validation (opt-in `validateTemplateRender`, default on with codegen).** A real frame-0 render
of the final capsule sets `quality.renderPreviewPassed` so **T8 is earned, not deferred**. Learn
response reports `templateRenders`.

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
POST /api/v5/learn-samples        → { learned: [{ templateCapsuleId, templateSlots, templateCompiles,
                                       templateRenders, templateCode, … }] }
   options: { runGen1Ai?, runCapsuleCodegen?, validateTemplateRender? }
GET  /api/v5/templates[?sourceSampleId&tag&q]   → capsule metadata + slotSchema (no code)
GET  /api/v5/templates/:id        → full capsule
POST /api/v5/generations          → default generationMode=same_template; returns
   { generationMode, templateCapsuleId, usedTemplateCode, usedFallbackRenderer, finalVideoUrl,
     templateInstance, finalProgram, generatedAssets, gapReport, noCopy, scorecard }
POST /api/v5/generations/:id/revise  → modify_template: patch-first re-theme/re-copy of a prior
   same_template generation. body { patch: { theme?, palette?, copyOverrides? } } → a new
   modify_template generation (reuses the prior visuals; re-renders the same template code).
```

**Scorecard honesty (same_template).** The scorecard is fed the real render facts + a real cv2/librosa
**no-copy scan** (`runNoCopyScan` → `no-copy-scan.json`), and emits same_template-mapped canonical gates
(V5-G17/G19/G20/G21) so the readiness ladder runs on real evidence. The instance readiness is reconciled
to the scorecard so the two artifacts can never contradict. Procedural-only visuals / render failure /
missing required slots / a flagged no-copy scan each cap readiness at `technical_demo`.

`final-video-program.json` (same_template) states: `renderMode` (`bespoke_codegen` when the capsule
code rendered, else `fallback`), `fallbackUsed`, and the bound `remotionProject` (the capsule files +
fixture); the result records `usedTemplateCode` / `usedFallbackRenderer` / `slotBindings` /
`generatedAssets`.

## Pipeline modules

```
apps/api/src/pipeline-v5/runGen1TemplateReconstruction.ts   — Gen1 deterministic props-driven template codegen
apps/api/src/pipeline-v5/runGen1CapsuleCodegen.ts           — Gen1 AI capsule TSX codegen (triple-gated, apply≠promote)
apps/api/src/pipeline-v5/validateTemplateCapsule.ts         — compile + safety scan + T-gates
apps/api/src/pipeline-v5/renderTemplateCapsule.ts           — dynamic capsule render + renderCapsuleStill (frame-0 gate)
apps/api/src/pipeline-v5/runSameTemplateGeneration.ts       — same_template + modify_template (revise) orchestrator
apps/api/src/services/knowledgeBaseV5.ts                    — Level-1 capsule storage
```

**Web entry.** The spec_v5.1 dashboard (`apps/web/src/v5/V5Dashboard.tsx`) is now the **default** web
entry; the V4 app stays reachable at `#v4`. The dashboard has a template library with a "用此模板生成"
(Start from this template) CTA, an AIGC gap-fill toggle, and a revise panel (theme/headline → re-render).
