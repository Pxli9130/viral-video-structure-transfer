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
Sample video → deterministic evidence → deterministic RemotionTemplateCapsule (guaranteed fallback)
  → PRIMARY: Gen1-Pro vision capsule (runGen1CapsuleGemini) — ONE best-Pro Gemini call WATCHES the whole
            video (Files API) + evidence → a faithful, props-driven RemotionTemplateCapsule. CODE IS BIBLE.
     · long videos (> CHUNK_TRIGGER_SEC=34s): runGen1ChunkedCapsule splits at scene cuts into ≤30s chunks,
       reconstructs each (concurrently), and stitches them into ONE multi-file capsule (parent + chunk{i}.tsx).
     · also returns an assetPlan: one entry per "missing 素材" (footage the code can't draw) keyed to the
       code's own asset vars → captured into slotSchema (kind image|video + AIGC prompt).
  → gate = COMPILE (T2) + REAL RENDER only (renderCapsuleStill). No-copy/fidelity NEVER block ("code is bible").
  → motion/coverage fidelity repair (one pass) + AI-priority promotion (see below)
  → [text-only fallback] Gen1 AI capsule codegen (runGen1CapsuleCodegen) when no video model
  → KB.saveTemplateCapsule  (+ runExtractElements → KB atomic elements)
```

**Gen1-Pro vision capsule (primary, `runGen1CapsuleGemini`).** A single best-Pro Gemini call
(`GEMINI_GEN1_MODEL`, default `gemini-3.1-pro-preview`) watches the entire source video and returns a
complete props-driven `RemotionTemplateCapsule` that re-creates the source's structure/timing/layout/
motion/transitions/typography (react + remotion + @remotion/three for real 3D). **The returned code is
canonical** — `mergeCapsule` keeps `codeBundle` byte-for-byte and only fills genuinely-missing metadata,
and MERGES `timingSignature` so `durationSec`/`fps` always fall back to deterministic (never undefined →
no "renders 16s of 31s"). It is gated ONLY on **compile + real render** (the two "won't run" failures);
no-copy and fidelity are recorded but never block.

**Motion/coverage fidelity repair + AI-priority promotion.** After a capsule compiles + renders it is
saved as `best`. A single **fidelity repair** is driven when the code contradicts the model's OWN declared
`sceneRecipes` (text marked `continuous_scroll` but rendered static → add a frame-driven marquee; a
described 3D ribbon with no `@remotion/three` → build real 3D on a single axis; a 2-axis tumble → single
axis) or under-covers `targetDurationSec` (chunk/source length). The repair is best-effort: a
compile+render-passing AI capsule is **never** discarded for the deterministic fallback over a mere
fidelity gap. Learn response reports `templateCode = ai | deterministic_fallback | deterministic`.

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
  → CONTEXT-REWRITE (AI capsules): a Pro call re-themes on-screen text + accent colours to the new theme,
       STRUCTURE-PRESERVING (per chunk file for stitched capsules). Honours source background lightness
       (sourceIsLight) so a light/white source never re-themes to a dark background.
  → read slotSchema → match user target assets → gap report
  → AUTO AIGC FILL (default ON), per slot:
       footage/video slot (mediaKind=video): Seedance 2.0 (plain text-to-video) → happyhorse r2v BACKUP
            (DashScope, Gemini still as reference_image; used when Seedance fails e.g. AccountOverdue/403)
            → AIGC still (ken-burns) fallback
       image slot: AIGC still (Gemini image, themed from the slot's aigcPrompt)
       text slot : LLM/brief copy (never sample text) ·  audio slot: procedural cue-aware bed
       bound asset carries { src, mediaKind } so the code branches image-vs-video by src extension
  → bind into template props → TemplateInstance
  → render the STORED capsule CODE with the bound props (renderTemplateCapsule: dynamic bundle+renderMedia)
  → POST-RENDER: colour-fidelity guard (source light but output dark → re-theme + re-render once) +
       trailing flat-scene trim (cut a redundant uniform single-colour tail) → no-copy / scorecard
```

**AIGC video providers.** Footage that the code can't draw (`mediaKind=video` slots, the "missing 素材")
is filled with real moving video. **Primary** `seedance_2_0` (Volcengine Ark `doubao-seedance-2-0-fast`,
plain text-to-video). **Backup** `happyhorse_r2v` (Alibaba DashScope `happyhorse-1.0-r2v`,
reference-to-video) — auto-used when Seedance fails; it takes the themed Gemini still as a base64
`reference_image` (async create→poll `/tasks/{id}`; US region → `dashscope-us.aliyuncs.com`). Both are
opt-in via keys; on total failure the slot degrades to an AIGC still, then procedural. The no-copy scan is
skipped for AI capsules (every layer is code-drawn or AIGC-generated — `samplePixelsUsed=false`).

**Concurrency & render reliability.** Runner fans the 4 demo videos out (`VIDEO_CONCURRENCY`). A global
`renderSemaphore` (`RENDER_CONCURRENCY=2`) × `RENDER_TABS_PER_JOB=2` bounds headless-Chrome memory;
`RENDER_TIMEOUT_MS=120000` + `offthreadVideoCacheSizeInBytes` stop `<OffthreadVideo>` fetch timeouts /
compositor `frame_cache` panics under load; renders + render-probes retry once on a transient crash. A
global `aigcSemaphore` (`AIGC_GLOBAL_CONCURRENCY=8`) bounds in-flight Seedance/Gemini calls (anti-429).
Per-chunk asset keys are namespaced `c{i}__<key>` (parent `chunkAssets()` strips the prefix); long ffmpeg
splits/audio-mux are async `spawn` (never block the event loop while a concurrent render fetches assets).
**Required deps:** `@remotion/three@4.0.341` + `@react-three/fiber@8.15.19` + `three@0.176.0` — if
`@remotion/three` is missing, any AI capsule that builds real 3D fails to render → deterministic fallback.

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
apps/api/src/pipeline-v5/runGen1CapsuleGemini.ts            — PRIMARY Gen1-Pro vision capsule (watches video) + mergeCapsule + motion/coverage fidelity repair + AI-priority promote + assetPlan
apps/api/src/pipeline-v5/runGen1ChunkedCapsule.ts           — long-video split at scene cuts → per-chunk Gen1 → stitched multi-file capsule (c{i}__ asset namespacing)
apps/api/src/pipeline-v5/runCapsuleContextRewrite.ts        — re-theme text+colours (structure-preserving, per-file; light-bg directive)
apps/api/src/pipeline-v5/runGen1TemplateReconstruction.ts   — Gen1 deterministic props-driven template (guaranteed fallback)
apps/api/src/pipeline-v5/runGen1CapsuleCodegen.ts           — text-only AI capsule TSX codegen (no-video fallback)
apps/api/src/pipeline-v5/validateTemplateCapsule.ts         — compile + safety scan + T-gates
apps/api/src/pipeline-v5/renderTemplateCapsule.ts           — dynamic capsule render + renderCapsuleStill (frame-0 gate) + global render semaphore/timeout/retry
apps/api/src/pipeline-v5/postRenderChecks.ts               — colour-fidelity (mean luma) + trailing uniform-tail detect/trim (async ffmpeg)
apps/api/src/pipeline-v5/concurrency.ts                     — mapLimit + Semaphore + shared render/aigc semaphores + RENDER_TIMEOUT_MS
apps/api/src/pipeline-v5/runSameTemplateGeneration.ts       — same_template + modify_template orchestrator (context-rewrite, AIGC fill chain, post-render passes)
packages/shared/src/engine/aigcMaterialProviders.ts        — seedance_2_0 (primary video) + happyhorse_r2v (DashScope backup) + google_gemini_image
apps/api/src/services/knowledgeBaseV5.ts                    — Level-1 capsule storage
```

**Web entry.** The spec_v5.1 dashboard (`apps/web/src/v5/V5Dashboard.tsx`) is now the **default** web
entry; the V4 app stays reachable at `#v4`. The dashboard has a template library with a "用此模板生成"
(Start from this template) CTA, an AIGC gap-fill toggle, and a revise panel (theme/headline → re-render).
