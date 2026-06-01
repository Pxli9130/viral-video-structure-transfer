# API — Spec v1.3

Base path: `/api`

This document specifies the **deltas** v1.3 ("Source-first RenderRecipe Engine") layers on top of [spec_v2/api.md](../spec_v2/api.md) (v1.2-final). Everything in the v1.2 API contract — common response shapes, projects, analysis, templates, knowledge base, jobs, export — remains valid and is NOT repeated here. v1.3 only changes how generation/timeline responses expose the render contract, how source material becomes renderable, how target material (the AeroSpin fan fixture) is intaked, and how AIGC material fill is gated. It also adds one CLI entrypoint (`demo:final`) that is not an HTTP route.

See also: [spec_v3/requirements.md](./requirements.md), [spec_v3/design.md](./design.md), and the authoritative render contract [spec_v3/schemas/render-recipe.schema.json](./schemas/render-recipe.schema.json).

All responses use JSON. Long-running operations create a Job and return a `jobId`; the client polls `GET /api/jobs/:jobId`.

---

## 0. What changed vs v1.2

| Area | v1.2 behavior | v1.3 delta |
|---|---|---|
| Render contract | Timeline carried `renderPlan` (renderer-specific hints) | Timeline carries `renderPlan.renderRecipe` — the single, schema-validated `RenderRecipe` every renderer reads |
| Source video | `source_video` upload role existed but was under-exercised; material policy nulled sample-sourced ids | A `source_video` asset with `sourcePolicy=user_authorized` (and id ≠ sample id) is now first-class **renderable material**; this is the main demo path |
| Target material | `target-material-manifests` normalized managed assets into a generic pool | Same intake, now the canonical feed for the **AeroSpin fan fixture**; entries may carry `materialRole=aigc_generated_material` provenance |
| AIGC fill | `allowAigcMaterialGeneration` / `allowExternalAigcProvider` produced generic gap-fill images | Same flags now drive **fan target-asset generation** via the real Gemini 2.5 Flash Image provider (provenance-labeled) |
| Async generation | `?async=true` → `202 {jobId}` | Unchanged contract; reaffirmed as the required path for the fan demo (real Gemini + AIGC + render exceeds client HTTP timeout) |
| Final demo | n/a | `npm run demo:final` — a CLI runner (not an HTTP route) orchestrating the locked AeroSpin submission + anti-overfit diversity eval |

The five hard principles behind these deltas (source-first, every-renderer-consumes-a-recipe, one reliable vertical first, beat_cut as style source only, no video-gen model in the critical path) are stated in [spec_v3/requirements.md](./requirements.md).

---

## 1. RenderRecipe in generation/timeline responses

### Where it lives

The `RenderRecipe` is carried at `timeline.renderPlan.renderRecipe`. Because `renderPlan` is `additionalProperties:true`, this requires **zero change to `timeline.schema.json`**. It validates against [spec_v3/schemas/render-recipe.schema.json](./schemas/render-recipe.schema.json) (`schemaVersion="render-recipe-v1"`).

It is the **single render contract**: the only thing a renderer reads to decide pixels. No renderer may re-derive a primitive from `clip.role`. The recipe is compiled from `StructureTemplate + VisualElementGraph + SourceVideoUnderstanding + SlotMapping + GapReport + FillPlan + TargetMaterialManifest + ProductBrief`.

### GET `/generations/:generationId`

Unchanged endpoint and top-level shape (request / selected structure plan / source understanding / slot mapping / gap report / fill plan / timeline / preview-render result). The new, load-bearing addition is `timeline.renderPlan.renderRecipe`:

```jsonc
{
  "ok": true,
  "data": {
    "generationId": "gen_aerospin_a",
    "timeline": {
      "renderPlan": {
        "renderRecipe": {
          "schemaVersion": "render-recipe-v1",
          "videoType": "beat_cut_product",
          "productTheme": {
            "name": "AeroSpin 便携涡轮小风扇",
            "category": "portable_fan",
            "sellingPoints": ["三档强风", "USB-C 8 小时续航", "静音 28dB", "手掌大小"],
            "cta": "立即抢购 AeroSpin"
          },
          "sourcePolicy": {
            "sampleUse": "structure_evidence_only",
            "sourceVideoUse": "missing",
            "targetAssetUse": "renderable_target_material",
            "sampleFrameCopyAllowed": false,
            "sampleAudioCopyAllowed": false
          },
          "global": {
            "aspectRatio": "9:16",
            "width": 720,
            "height": 1280,
            "fps": 30,
            "durationSec": 15,
            "palette": ["#000000", "#ff2d2d", "#ffd400"],
            "bpm": 152,
            "beatGridSec": [0.0, 0.39, 0.79, 1.18],
            "cutPattern": { "targetCutCount": 18, "avgShotDurationSec": 0.83, "fastZones": [[8.5, 11.5]] },
            "audioPlan": { "policy": "procedural_bgm", "layers": { "kick": 0.8, "bass": 0.6, "hats": 0.4, "impact": 0.7 } }
          },
          "clips": [
            {
              "clipId": "clip_hook",
              "role": "hook",
              "startSec": 0.0,
              "endSec": 2.5,
              "slotId": "slot_hero",
              "visualFormFamily": "product_hero",
              "selectedPrimitive": "FanHeroSpin",
              "primitiveReason": "product category=portable_fan and prompt mentions fan/spin/wind; hero target image fan_hero.png present -> FanHeroSpin",
              "rendererTarget": "remotion_recipe",
              "material": {
                "kind": "generated_target_asset",
                "assetIds": ["asset://managed/aerospin_fan_hero"],
                "policy": "renderable"
              },
              "layout": { "positionClass": "center" },
              "motion": { "pattern": "spin", "beatAligned": true, "beatTimestampsSec": [0.0, 0.79, 1.58] },
              "text": { "copy": "AeroSpin 便携涡轮小风扇", "colorRoles": ["accent", "on_dark"], "animationHint": "scale" }
            }
          ],
          "warnings": ["moving_material_missing: no source moving clip for proof slot; using DynamicProxyMontage"]
        }
      }
    }
  }
}
```

### Audit contract

Per the v1.3 gates ([spec_v3/test-plan.md](./test-plan.md)), responses are checked for:

- `renderRecipe` present and schema-valid;
- **every** clip carries a non-empty `primitiveReason` (the auditable selection trace, never `role` alone);
- `sourcePolicy.sampleFrameCopyAllowed=false` and `sourcePolicy.sampleAudioCopyAllowed=false` (both are `const:false` in the schema);
- at least one clip with `material.policy="renderable"` referencing a target/source/generated asset.

`primitiveReason` is produced by `selectPrimitive(slot, evidence, material, capabilities)` (see [spec_v3/design.md](./design.md)) and surfaced verbatim, so a reviewer can trace why each pixel decision was made.

---

## 2. Source video as renderable material

### POST `/projects/:projectId/assets`

Same multipart endpoint as v1.2. Fields unchanged:

- `file`: video/image file;
- `role`: `example_video` (the sample / structure source) or `source_video` (user-authorized output material);
- `sourcePolicy`: `user_authorized`, `open_download_or_user_uploaded`, `demo_only`, or `unknown`.

**v1.3 material-policy delta.** A `source_video` asset whose id is **not** in `template.sourceSampleIds` and whose `sourcePolicy=user_authorized` MUST be eligible render material. This path existed in v1.2 but was nulled by the old material policy; v1.3 makes it the main demo path. The resulting recipe shows:

- `sourcePolicy.sourceVideoUse = "renderable_user_material"`;
- montage clips with `material.kind="source_video"`, `material.policy="renderable"`, and `material.sourceShotIds=[...]` pointing at matched shots.

Conversely, a sample asset id from `template.sourceSampleIds` cannot appear in render material unless `sampleAssetReuse=authorized` (rule R1). The sample (editing.mov) is **structure evidence only by default**: no frame copy, no audio copy, no watermark reproduction.

If a montage slot has no matched source moving shot, the renderer MAY emit `DynamicProxyMontage`, but the gap `moving_material_missing` MUST remain in `renderRecipe.warnings[]` and in the gap report (rule R4 — no faking real footage).

---

## 3. Target material manifest intake (the fan fixture feed)

### POST `/projects/:projectId/target-material-manifests`

Unchanged endpoint and contract from v1.2. It is the **API-backed material intake path**: it does not accept arbitrary local paths, and entries reference managed `assetId` values previously created through `POST /projects/:projectId/assets`. In v1.3 this is the canonical way the AeroSpin fan target pool reaches a generation.

Request (fan fixture, all entries are managed `assetId` refs):

```json
{
  "schemaVersion": "target-material-manifest-v1",
  "brandName": "AeroSpin",
  "cta": "立即抢购 AeroSpin",
  "features": ["三档强风", "USB-C 8 小时续航", "静音 28dB", "手掌大小"],
  "assets": [
    { "assetId": "aerospin_fan_hero", "kind": "image", "role": "product_hero", "materialRole": "aigc_generated_material" },
    { "assetId": "aerospin_card_01", "kind": "image", "role": "media_card",   "materialRole": "aigc_generated_material" },
    { "assetId": "aerospin_card_02", "kind": "image", "role": "media_card",   "materialRole": "aigc_generated_material" },
    { "assetId": "aerospin_card_03", "kind": "image", "role": "media_card",   "materialRole": "aigc_generated_material" },
    { "assetId": "aerospin_card_04", "kind": "image", "role": "media_card",   "materialRole": "aigc_generated_material" },
    { "assetId": "aerospin_logo",    "kind": "logo",  "role": "brand_logo",   "materialRole": "aigc_generated_material" }
  ]
}
```

Response:

```json
{
  "schemaVersion": "target-material-manifest-v1",
  "projectId": "project_aerospin",
  "brandName": "AeroSpin",
  "cta": "立即抢购 AeroSpin",
  "features": ["三档强风", "USB-C 8 小时续航", "静音 28dB", "手掌大小"],
  "targetAssets": [],
  "assetEvidence": [],
  "blockedAssets": [],
  "materialPolicy": {
    "source": "managed_upload",
    "externalPathsAllowed": false,
    "sampleReferenceUse": "structure_evidence_only"
  }
}
```

Public refs use safe managed identifiers such as `asset://managed/<assetId>`. Renderer adapters resolve actual server-side file paths internally; real paths never enter public JSON/HTML.

**Provenance & policy notes (v1.3):**

- `materialRole=aigc_generated_material` marks assets generated by an AIGC provider, **not** user uploads and **not** real product photos. AeroSpin is a fictional brand, so an AIGC logo is permitted; this does NOT relax the v1.2 rule that real brand logos are never fabricated.
- Target images satisfy `media_cards` / `product_hero` / `feature_list` / `brand_cta`. They cannot pretend to be `live_action_montage` unless animated as a procedural target asset (rule R5).
- Mock / no-path assets MUST NOT satisfy visual slots; they appear in `blockedAssets`.
- When the repo has no real fan footage and no real fan photo, the disk fixture at `docs/fixtures/final_aerospin_fan/` (`fan_hero.png`, `fan_card_01..04.png`, `logo.png`, `copy.json`, `manifest.json`) is produced once by the real Gemini image provider and reused; the CLI runner registers it through this same managed-intake contract.

---

## 4. Generation with source video + fan target pool + optional AIGC fill

### POST `/generations`

Same endpoint and request schema (`generation-request.schema.json`) as v1.2. The request body is `additionalProperties:false`, so the async flag stays a query param.

**Execution modes.** By default the call runs the full pipeline synchronously and returns the finished generation. For the fan demo (real Gemini chunking + AIGC fan-asset fill + Remotion/FFmpeg render can exceed a client HTTP timeout), pass `?async=true`: the API immediately returns `202 {jobId}`, runs the pipeline in the background, and the client polls `GET /jobs/:jobId` until `status="completed"`, then reads `outputRefs.generationId` and fetches `GET /generations/:generationId`.

```jsonc
// POST /generations?async=true  -> 202
{ "ok": true, "data": { "jobId": "job_aerospin", "status": "queued" } }
```

Example — AeroSpin fan, source-first with an (optional) authorized source video and the fan target pool:

```json
{
  "projectId": "project_aerospin",
  "inputMode": "video_plus_prompt",
  "sourceVideo": { "assetId": "asset_fan_product_demo" },
  "selectedTemplateIds": ["template_editing_beat_cut"],
  "prompt": "为 AeroSpin 便携涡轮小风扇生成一条 15 秒高转化产品广告，突出三档强风、USB-C 8 小时续航、静音、手掌大小，CTA 立即抢购。",
  "target": {
    "vertical": "b2b_marketing_mg",
    "aspectRatio": "9:16",
    "targetDurationSec": 15,
    "outputMode": "storyboard_preview"
  },
  "controls": {
    "pace": "fast",
    "hookIntensity": "strong",
    "packagingStyle": "mg_motion",
    "ctaStyle": "direct",
    "allowAigcMaterialGeneration": true,
    "allowExternalAigcProvider": true
  }
}
```

Notes specific to v1.3:

- `sourceVideo.assetId` is optional. If supplied (e.g. `test_videos/manual/fan_product_demo.mp4` registered as a `source_video` asset with `sourcePolicy=user_authorized`), its matched shots become renderable montage material and the recipe shows `sourceVideoUse="renderable_user_material"`. If omitted, the recipe shows `sourceVideoUse="missing"` and proof/montage slots fall back to `DynamicProxyMontage` with the `moving_material_missing` gap retained.
- `selectedTemplateIds` references the **editing.mov** beat_cut template. Per principle P4, editing.mov contributes structure only (cut rhythm, black/red/yellow typography, hero-motion motif, impact-flash grammar, BGM beat grid); it never becomes a fixed 6-clip mold and never supplies output pixels.
- The fan target pool is bound to the generation via the project's target material manifest (Section 3).

### AIGC material-fill controls

Same control flags and ordering as v1.2:

- `allowAigcMaterialGeneration=true` enables generation briefs and generated-material matching.
- `allowExternalAigcProvider=false` keeps the live API path from calling any external image provider — no generated images; gaps stay as procedural cards.
- `allowExternalAigcProvider=true` lets the API call real providers in order: `AIGC_IMAGE_PROVIDER` (default `google_gemini_image` / `gemini-2.5-flash-image`, "Nano Banana") → `AIGC_IMAGE_BACKUP_PROVIDER` (default `volcengine_seedream`) → a real error. **Sample frames are never sent.** The live path does not fall back to a mock.
- Generated material is returned with provenance `materialRole="aigc_generated_material"`, never as a user upload.

For the fan demo, both flags are `true` and `GEMINI_API_KEY` plus external-provider opt-in must be configured (see [spec_v3/requirements.md](./requirements.md) environment section). When AIGC material fill runs, the full `generation` object includes:

```json
{
  "aigcMaterialFill": {
    "enabled": true,
    "provider": "google_gemini_image",
    "externalProviderUsed": true,
    "sampleFramesSentExternally": false,
    "briefs": ["...MaterialGenerationBrief (fan hero / feature cards / logo)"],
    "candidates": ["...GeneratedAssetCandidate"],
    "quality": ["...GeneratedAssetQualityResult"],
    "generatedTargetAssets": ["...TargetAssetInput with materialRole=aigc_generated_material"]
  }
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "generationId": "gen_aerospin_a",
    "jobId": "job_aerospin",
    "status": "completed"
  }
}
```

The full generation detail (Section 1) carries `timeline.renderPlan.renderRecipe`. `POST /generations/:generationId/revise`, `/variants`, and `/scorecard` are unchanged from [spec_v2/api.md](../spec_v2/api.md).

---

## 5. Render and preview

### POST `/generations/:generationId/render`

Same endpoint as v1.2. The v1.3 delta is that **every renderer consumes `renderRecipe`** and never re-infers a primitive from `clip.role`. Each `renderRecipeClip` carries its own `rendererTarget`.

```json
{ "rendererTarget": "remotion" }
```

Allowed targets and their v1.3 roles:

- `remotion` — **PRIMARY visual component renderer** (`rendererTarget=remotion_recipe` clips). The `RemotionRecipeRenderer` bundles components that consume `RenderRecipeClip` props only and never re-infer: `FanHeroSpin`, `ProductHeroOrbit`, `SourceClipBeatMontage`, `DynamicProxyMontage`, `TypographyLayoutSequence`, `FeatureCardStack`, `ImpactFlash`, `CTAEndSlate`, `BeatBars`. First call may download a headless Chromium.
- `ffmpeg` — source clip cut / crop / zoom, concat / mux, procedural BGM, preview-frame extraction, the final 720×1280 MP4, and fallback card render (`rendererTarget=ffmpeg` clips). It also samples one real still per clip and returns them as `clipPreviewFrames`.
- `hyperframes` — **optional** MG / HTML preview artifact (`rendererTarget=hyperframes_recipe` clips). If the HyperFrames CLI exists, it writes real `html` + `manifest` + `preview`; otherwise it writes `SKIPPED_HYPERFRAMES.md`. It MUST NOT be presented in the UI as a completed MP4 renderer while it is only a JSON stub.
- `html_preview` — `HtmlPreviewRenderer`, self-contained HTML preview (diagnostic).

Response: `{ jobId, renderId, status, render: RenderOutput }`. `RenderOutput` carries `renderId`, `generationId`, `rendererTarget`, `status`, `outputPath`, `previewHtml`, and optional `clipPreviewFrames` (FFmpeg only):

```json
{
  "render": {
    "rendererTarget": "remotion",
    "status": "completed",
    "outputPath": ".../storage/generated/render_aerospin_<id>.mp4",
    "clipPreviewFrames": []
  }
}
```

`clipPreviewFrames` is a per-clip still sampled near the midpoint of each FFmpeg-rendered clip, written under `storage/generated/previews/<renderId>/clip_<n>.png` and served under `/generated/...`. Frame extraction is non-fatal.

### GET `/renders/:renderId`

Unchanged. Returns render result metadata and path.

---

## 6. `demo:final` — CLI runner (not an HTTP route)

The locked AeroSpin final submission is driven by a **command-line runner**, not an HTTP endpoint. It is the v1.3 analogue of `full-loop:editing` and is invoked as:

```bash
export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
npm run build && npm run demo:final
```

It runs **in-process** against the same library code the HTTP API uses (the same `generateMigrationResult`, the same renderers), so its outputs are byte-for-byte the contract described above; it does not require the HTTP server to be running.

### What it orchestrates

1. **Fixture intake.** Ensure the AeroSpin fan target fixture exists at `docs/fixtures/final_aerospin_fan/`. If absent and `GEMINI_API_KEY` + external-provider opt-in are present, generate `fan_hero.png`, `fan_card_01..04.png`, `logo.png` via the real Gemini 2.5 Flash Image provider and write `copy.json` + `manifest.json` with `materialRole=aigc_generated_material` provenance. Register the fixture through the managed target-material-manifest contract (Section 3).
2. **Optional source video.** If a real `--source` is supplied (e.g. `test_videos/manual/fan_product_demo.mp4`), register it as a `source_video` asset with `sourcePolicy=user_authorized` so its shots become renderable montage material; otherwise proceed source-less and keep the `moving_material_missing` gap.
3. **Demo A — editing.mov + fan assets.** Use the editing.mov beat_cut template as the structure source, the fan target pool as material, run the pipeline, compile the `RenderRecipe`, and render the main visual layer with `RemotionRecipeRenderer`, then mux the final 720×1280 MP4 with FFmpeg. Expected clip arc: `0–2.5 hook FanHeroSpin`, `2.5–5.5 setup TypographyLayoutSequence`, `5.5–8.5 body FeatureCardStack`, `8.5–11.5 proof SourceClipBeatMontage (or DynamicProxyMontage + gap)`, `11.5–13 transition ImpactFlash`, `13–15 cta CTAEndSlate`.
4. **Demo B — motion_graph_1.mov + the same fan assets.** Identical material, a different, unrelated structure source. Used to prove the engine is not a sample-blind mold.
5. **Diversity / anti-overfit eval.** Compare Demo A and Demo B. FAIL/WARN if layout NCC across the unrelated samples `>= 0.85`, or primitive-sequence similarity `= 1.0` across unrelated samples, or identical subtitles across unrelated samples.
6. **Gates.** Run the v1.3 gates (final MP4 exists, 720×1280, 14.5–15.5s, recipe present, every clip has `primitiveReason`, ≥1 target material appears in render, source-pixel usage threshold or `moving_material_missing` present, sample frame/audio copy false, watermark reproduced false, product name visible, ≥4 selling points visible, CTA visible, Remotion produced the main visual layer, FFmpeg muxed the final MP4). See [spec_v3/test-plan.md](./test-plan.md).
7. **Artifacts.** Write reviewable outputs under `docs/artifacts/final_submission/{demo_a_editing_fan,demo_b_motion_graph_fan,diversity_eval}` plus `FINAL_REPORT.md` and `README.md`.

### CLI flags (indicative)

| Flag | Meaning |
|---|---|
| `--source <path>` | Optional real source video (registered as `source_video`, `user_authorized`); omit to run source-less. |
| `--fixture <dir>` | Override the fan target fixture dir (default `docs/fixtures/final_aerospin_fan/`). |
| `--out <dir>` | Output root (default `docs/artifacts/final_submission/`). |
| `--allow-external-aigc` | Permit the real Gemini image provider for one-time fan fixture generation (requires `GEMINI_API_KEY`). |
| `--skip-demo-b` | Run only Demo A (anti-overfit eval is skipped; not for submission). |
| `--gates v3` | Run the v1.3 gate set (default for submission). |

### Honest-failure contract

Consistent with v1.2: the runner never fabricates a passing result. If the Gemini image provider is unavailable and no fixture exists on disk, fan fixture generation fails loudly (no SVG / mock placeholder, per the user material decision). If a renderer fails, the gate fails with the real error. If HyperFrames is only a JSON stub, it writes `SKIPPED_HYPERFRAMES.md` rather than reporting a completed MP4 renderer.

---

## 7. Unchanged from v1.2

The following sections are inherited verbatim from [spec_v2/api.md](../spec_v2/api.md) and are NOT redefined here:

- common success / error response shapes;
- `POST /projects`, `GET /projects`, `GET /projects/:projectId`;
- `POST /assets/:assetId/analyze`, `GET /assets/:assetId/analysis`;
- templates and knowledge base (`/templates*`, `/projects/:projectId/knowledge-base*`);
- `POST /generations/:generationId/revise`, `/variants`, `/scorecard`;
- export (`/generations/:generationId/export/*`, `/templates/:templateId/export`);
- `GET /jobs/:jobId` (async poll target; `outputRefs.generationId` on completion, real `error.message` on failure, never a fabricated success).
