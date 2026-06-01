# Test Plan — Spec v1.3

Source-first RenderRecipe Engine. This plan verifies that the v1.3 submission is **not a sample-blind mold**: that every renderer reads a `RenderRecipe` derived from real evidence + real material, that user/target/generated material reaches the canvas, that sample frames/audio never do, and that two unrelated structure samples driving the same product assets produce *measurably different* renders.

It supersedes [`spec_v2/test-plan.md`](../spec_v2/test-plan.md) for the final submission. Everything spec_v2 verifies that v1.3 does not override still holds; v1.3 adds the RenderRecipe contract, the source-first material gate, evidence-driven primitive selection, the v1.3 render-quality gate set, and the anti-overfit diversity eval.

See sibling specs: [`requirements.md`](./requirements.md), [`design.md`](./design.md), [`tasks.md`](./tasks.md), and the authoritative contract [`schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json).

---

## 0. Why v1.3 needs a new test plan

The overfit investigation (`docs/artifacts/render_overfit_findings/REPORT.md`) proved that the current product renders a **sample-blind mold**: every `videoType=beat_cut` input collapsed to one identical 6-primitive sequence (`neon_hero_intro, beat_text_card, tutorial_rule_card, action_montage, impact_flash_stamp, motivation_cta`) with hardcoded subtitle copy and fixed FFmpeg geometry. Measured cross-brief render layout cross-correlation was **0.868–1.000** with **primitive-sequence similarity 1.00** for every beat-cut pair.

The spec_v2 test plan never measured this because it tested *one sample at a time* and asserted only "gates pass", not "renders differ across unrelated inputs". The v1.3 plan therefore adds:

1. **RenderRecipe purity + decision-table** unit tests so the primitive is provably chosen from evidence + material + capabilities, never from `clip.role` alone.
2. **Material-policy** unit tests so a `user_authorized` non-sample source / target / generated asset is provably renderable, and a sample asset is provably evidence-only.
3. A **golden** assertion that the recipe and the timeline agree (`renderRecipe.clips[].selectedPrimitive == clip.motionPrimitive` where the clip carries a primitive).
4. The **v1.3 render-quality gate** set (enumerated below, each with its pass condition).
5. The **anti-overfit diversity eval** that runs demo A and demo B and fails/warns on layout NCC and primitive-sequence sameness.
6. A **real-provider e2e** (`demo:final`) that is honest about what is gated vs advisory, and about sandbox / socket / EPERM / missing-CLI conditions (skipped infra is marked skipped, never faked as a pass).

---

## 1. Test principles (v1.3)

1. **Source-first (P1).** Sample/reference video is structure evidence only by default; only `source_video` (user-authorized, non-sample) / target images / target copy / explicitly-accepted generated material reaches the canvas. Style-lock self-reconstruction is diagnostic only — it is NOT the gated demo.
2. **Recipe-first (P2).** Every render assertion goes through `timeline.renderPlan.renderRecipe`. A test MUST NOT assert pixels that were produced by a `role → primitive → hardcoded geometry` path; if a renderer cannot point at a recipe field, that is a failure.
3. **One reliable vertical (P3).** The gated, must-pass path is the AeroSpin portable-turbo-fan B-end product promo. `beat_cut` / `motion_graph` remain covered but as *style sources* feeding the recipe, not as separate must-pass molds.
4. **beat_cut stays, as a style source only (P4).** `editing.mov` is exercised as structure evidence (fast-cut rhythm, black/red/yellow typography, hero-motion motif, impact-flash grammar, BGM beat grid) and never as a fixed 6-clip output mold.
5. **No video-generation model in the critical path (P5).** Renderers under test are FFmpeg + Remotion + HyperFrames only. No Seedance/Veo path is gated. Target *image* material may be Gemini-generated (provenance `aigc_generated_material`) and is opt-in.
6. **Honest skips.** Sandbox/socket/EPERM, missing CLI (`ffmpeg`, `ffprobe`, conda Python, Chromium, HyperFrames CLI), and missing `GEMINI_API_KEY` are reported as **skipped infrastructure**, never as a deterministic pass and never as a fabricated artifact.

---

## 2. Unit + builder test matrix (v1.3)

These run under `@vvst/shared` vitest with no external keys and no sockets. They are the load-bearing v1.3 additions and MUST stay green in CI.

### 2.1 RenderRecipe builder purity

`buildRenderRecipe(structureTemplate, visualElementGraph, sourceVideoUnderstanding, slotMapping, gapReport, fillPlan, targetMaterialManifest, productBrief)` is a **pure** function: same inputs → byte-identical recipe.

| Test | Expected |
|---|---|
| Pure / deterministic | Two calls on the same frozen fixture produce a deep-equal `RenderRecipe` (no `Date.now`, no RNG, no fs read). |
| Schema-valid output | The emitted recipe AJV-validates against [`schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json); `schemaVersion === "render-recipe-v1"`. |
| No mutation of inputs | Inputs are deep-frozen before the call; the call does not throw and does not mutate. |
| Every clip carries a reason | For every clip, `primitiveReason` is a non-empty string (`minLength:1`). A missing/empty reason fails. |
| `additionalProperties:false` holds | The builder never emits a field outside the schema (guards silent drift). |
| Recipe lives under renderPlan | `timeline.renderPlan.renderRecipe` is populated and `timeline.schema.json` still validates (renderPlan is `additionalProperties:true`, so zero timeline-schema change). |
| Globals derived from evidence | `global.bpm`, `global.beatGridSec`, `global.palette`, and `global.cutPattern` are copied from the sample-derived evidence (not literals); a fixture with a different bpm yields a different `global.bpm`. |

### 2.2 `selectPrimitive` decision table

`selectPrimitive(slot, evidence, material, capabilities)` is tested as an explicit decision table. The negative cases are the point: the primitive must **not** be derivable from `clip.role` alone.

| # | slot / role | evidence | material | capabilities | expected `selectedPrimitive` | expected `primitiveReason` contains |
|---|---|---|---|---|---|---|
| D1 | montage / proof | source has ≥3 high-motion shots | `source_video` mapped | remotion | `SourceClipBeatMontage` | "source_video_mapped", "≥3 high-motion shots" |
| D2 | hook | product hero image/video present | `target_image` hero | remotion | `ProductHeroOrbit` | "product hero", "hook" |
| D3 | hook | category=portable_fan, prompt mentions fan/spin/wind | `target_image` hero | remotion | `FanHeroSpin` | "fan", "spin/wind" |
| D4 | montage / proof | **no** moving source | product image exists | remotion | `DynamicProxyMontage` (+ gap `moving_material_missing`) | "no moving source", "proxy" |
| D5 | setup | typography/OCR evidence with bbox/layout | none required | remotion | `TypographyLayoutSequence` | "typography", "bbox/layout" |
| D6 | body | target image set ≥3 | `target_image_set` | remotion | `FeatureCardStack` | "target image set ≥3" |
| D7 | transition | impact/onset evidence | none | remotion | `ImpactFlash` | "impact/onset" |
| D8 | cta | CTA copy exists | target copy/logo | remotion | `CTAEndSlate` | "CTA copy" |
| D-neg1 | role=hook, **no** product/hero evidence/material | sparse | none | remotion | NOT `ProductHeroOrbit`/`FanHeroSpin` purely from role; falls to `TypographyLayoutSequence` or `DynamicProxyMontage` with an honest reason | "no product material" |
| D-neg2 | identical role across two different slots, different evidence | differing | differing | remotion | the two selections **differ** | distinct reasons |
| D-cap1 | D1 inputs but `remotion` capability absent | source ≥3 shots | `source_video` | ffmpeg only | a renderer-feasible primitive with `rendererTarget=ffmpeg` | "capability" |

Assertion style: each row asserts both the enum value and that `primitiveReason` cites the *evidence/material/capability* signal that drove it. A reason that only echoes the role (e.g. "role is hook") fails the test.

### 2.3 Material policy

The material gate is the v1.3 root-cause fix. These tests pin the four rules from [`requirements.md`](./requirements.md) (R1–R5).

| Test | Rule | Expected |
|---|---|---|
| Sample id in `template.sourceSampleIds`, `sampleAssetReuse != authorized` | R1 | NOT eligible render material; recipe `material.policy = evidence_only`; `sourcePolicy.sampleUse = structure_evidence_only`. |
| Sample id with `sampleAssetReuse = authorized` | R1 | becomes eligible; `sourcePolicy.sampleUse = authorized_reuse`. |
| **`source_video` id != sample id, `sourcePolicy = user_authorized`, real path** | **R2** | **MUST be eligible render material**; recipe `material.kind = source_video`, `material.policy = renderable`; `sourcePolicy.sourceVideoUse = renderable_user_material`. (This is the path the mold under-exercised; v1.3 makes it the main demo.) |
| source_video has matched shots for a montage slot | R3 | montage clip's `material.sourceShotIds` is non-empty and `selectedPrimitive = SourceClipBeatMontage`; renderer MUST use source pixels (asserted via recipe + §5 gate). |
| No source moving clip exists | R4 | `DynamicProxyMontage` allowed AND `warnings`/gapReport still carries `moving_material_missing` (no faking real footage). |
| Target images for media_cards/product_hero/feature_list/brand_cta | R5 | satisfy those families (`FeatureCardStack`/`ProductHeroOrbit`/`CTAEndSlate`/`TypographyLayoutSequence`). |
| Target image asked to satisfy live_action_montage | R5 | rejected unless animated as a procedural target asset (`DynamicProxyMontage` + gap), never a fake live-action match. |
| Mock / no-path / zero-byte / wrong-role asset | R5 | MUST NOT satisfy a visual slot; recipe `material.policy = missing` and the slot keeps its gap. |
| Sample frame copy flag | P1 | `sourcePolicy.sampleFrameCopyAllowed === false` (schema `const:false`). |
| Sample audio copy flag | P1 | `sourcePolicy.sampleAudioCopyAllowed === false` (schema `const:false`). |

---

## 3. Golden test changes (v1.3)

The existing deterministic goldens (`editingMovBeatCutGolden.test.ts`, `editingMovMovingMaterialGolden.test.ts`, motion-graph fixtures) keep their v2 assertions. v1.3 adds a **recipe block** and a **join assertion**, plus a new AeroSpin product golden.

| Golden | Added assertion |
|---|---|
| `editingMovBeatCutGolden.test.ts` | `timeline.renderPlan.renderRecipe` exists and AJV-validates; for every clip that carries a primitive, `renderRecipe.clips[i].selectedPrimitive == clip.motionPrimitive` (the recipe is the source of truth, the timeline mirrors it). Every recipe clip has a non-empty `primitiveReason`. |
| `editingMovMovingMaterialGolden.test.ts` | With no source moving material: recipe shows `DynamicProxyMontage` for the montage clip **and** `warnings` includes `moving_material_missing`; `sourcePolicy.sourceVideoUse = missing`. Proves the v2 honesty bar survives the recipe refactor. |
| **new** `aerospinFanRecipeGolden.test.ts` | Drives `buildRenderRecipe` from a committed AeroSpin fixture (`docs/fixtures/final_aerospin_fan/manifest.json` + a frozen editing.mov-evidence oracle). Asserts the expected clip arc (FanHeroSpin → TypographyLayoutSequence → FeatureCardStack → SourceClipBeatMontage-or-DynamicProxyMontage → ImpactFlash → CTAEndSlate), `videoType = beat_cut_product` (or `product_mg`), `productTheme.name` visible, `sellingPoints.length >= 4`, `cta` present, every target asset carries `material.kind = generated_target_asset` with provenance, and no sample id appears in any `material.assetIds`. |
| motion-graph fixtures | Recipe block added; assert `selectedPrimitive` is chosen from the open-world family + material, and that the diversity-relevant fields (`global.cutPattern`, `global.palette`, per-clip `selectedPrimitive`) differ from the editing.mov golden's (anti-mold sanity at golden level). |

**Golden teeth.** As in v2, each golden proves the gate has teeth: an "ideal" recipe passes and a deliberately-degraded recipe (e.g. a sample id stuffed into render material, a clip missing `primitiveReason`, a static montage) fails. This is what keeps the assertion meaningful rather than tautological.

---

## 4. v1.3 render-quality gates

Run by `scripts/evaluate-render-quality.mjs --gates v3 --strict` against a real `demo:final` render plus its `template.json` / `generation.json` / recipe. Each gate has a single pass condition. A gate that cannot be evaluated because of missing infra is reported `skipped` (with reason), **not** `pass`.

| # | Gate | Pass condition |
|---|---|---|
| G1 | `final_mp4_exists` | The final MP4 file exists and is non-zero bytes. |
| G2 | `dimensions_720x1280` | `ffprobe` reports width=720, height=1280 (9:16). |
| G3 | `duration_in_band` | Duration in `[14.5, 15.5]` s. |
| G4 | `render_recipe_exists` | `timeline.renderPlan.renderRecipe` exists and AJV-validates against the schema. |
| G5 | `every_clip_has_reason` | Every `renderRecipe.clips[].primitiveReason` is a non-empty string. |
| G6 | `target_material_in_render` | ≥1 target/generated material id from the manifest appears in some clip's `material.assetIds`, and its `material.policy = renderable`. |
| G7 | `source_pixel_usage` | IF a real `--source` is supplied: source-pixel usage > threshold (motion-diff/sample-of-source check). ELSE: `moving_material_missing` is present in `warnings`/gapReport. (Exactly one branch must hold — never both faked.) |
| G8 | `no_sample_frame_copy` | `sourcePolicy.sampleFrameCopyAllowed === false` AND no rendered frame matches a sample keyframe above the copy-detection threshold. |
| G9 | `no_sample_audio_copy` | `sourcePolicy.sampleAudioCopyAllowed === false` AND the audio track is procedural/user/authorized — not the sample's audio fingerprint. |
| G10 | `no_watermark_reproduced` | No sample watermark region is reproduced in the render (watermark is labeled in evidence, never re-drawn). |
| G11 | `product_name_visible` | `productTheme.name` appears as rendered text in ≥1 clip (OCR or recipe `text.copy` cross-check). |
| G12 | `selling_points_visible` | ≥4 distinct `productTheme.sellingPoints` are surfaced across the clips' `text.copy`. |
| G13 | `cta_visible` | `productTheme.cta` appears in the CTA clip (`CTAEndSlate`). |
| G14 | `remotion_main_visual_layer` | The Remotion recipe renderer (`rendererTarget=remotion_recipe`) produced the main visual layer; components consumed `RenderRecipeClip` props only (asserted via the render manifest / component-prop log, not re-inference). |
| G15 | `ffmpeg_muxed_final` | FFmpeg performed the final concat/mux to the 720x1280 MP4 (and source cut/crop/zoom + procedural BGM + preview-frame extraction where applicable). |
| G16 | `every_clip_primitive_in_enum` | Every `selectedPrimitive` is one of the eight allowed primitives; every `rendererTarget` ∈ {`remotion_recipe`,`ffmpeg`,`hyperframes_recipe`}. |
| G17 | `no_placeholder_debug_text` | No rendered frame carries `PROXY`/`PLACEHOLDER`/`占位`/`代理` debug text (carried over from v2). |
| G18 | `preview_frames_present` | One real preview still per clip exists under the render's preview dir, keyed by clip id. |

**HyperFrames is not gated as an MP4 renderer.** If the HyperFrames CLI exists, G-HF (advisory) checks that a real `html + manifest + preview` artifact was written; if the CLI is absent, the runner writes `SKIPPED_HYPERFRAMES.md` and G-HF is `skipped`. HyperFrames must never be presented in the UI or in a gate as a completed MP4 renderer while it is only a JSON stub.

---

## 5. Anti-overfit diversity eval

This is the eval the spec_v2 plan lacked and the one that directly defends the official scoring criterion (transfer to NEW material, not reproduce a mold).

### 5.1 Setup

Run two reconstructions with the **same product assets** (AeroSpin fan fixture) but **two unrelated structure samples**:

- **Demo A** — sample = `test_videos/manual/editing.mov` (beat-cut style) + AeroSpin fan assets.
- **Demo B** — sample = `test_videos/motion_graph_1.mov` (motion-graph style) + the *same* AeroSpin fan assets.

Both write under `docs/artifacts/final_submission/{demo_a_editing_fan, demo_b_motion_graph_fan}` and the eval writes under `.../diversity_eval/`.

### 5.2 Metrics + thresholds

| Metric | Definition | Threshold (across distinct briefs A vs B) |
|---|---|---|
| `layout_ncc_mean` | Mean normalized cross-correlation of sampled render frames between A and B. | **WARN if >= 0.85** (same-shape mold suspected); TARGET <= 0.70. |
| `primitive_seq_similarity` | Sequence similarity of `renderRecipe.clips[].selectedPrimitive` between A and B. | **REQUIRE `< 1.0`** across distinct briefs (an identical primitive sequence for unrelated samples is a FAIL). |
| `subtitle_identity` | Whether the rendered subtitle copy is byte-identical across A and B. | **FAIL if identical** subtitles across unrelated samples. |
| `color_corr` | Palette correlation (advisory only — palettes can legitimately overlap because both share the fan brand). | advisory; not gated. |

### 5.3 Pass/warn/fail policy

- **FAIL** (blocks the "anti-overfit" claim): `primitive_seq_similarity == 1.0` for the A/B distinct-brief pair, OR identical subtitles across A and B.
- **WARN** (surfaced in `FINAL_REPORT.md`, does not block submission but must be disclosed): `layout_ncc_mean >= 0.85`.
- Same-input determinism is asserted separately (A run twice → byte-identical) so a WARN/FAIL is never a flaky artifact.
- Do **not** gate on frame-identity count: the investigation already measured 0/9 identical frames across distinct briefs, so that metric has no headroom.

The eval emits `diversity_eval/pairwise_similarity.{json,md}` mirroring the investigation's probe format so the before/after is directly comparable to the 0.868–1.000 baseline.

---

## 6. Real-provider e2e — `demo:final`

`npm run demo:final` is the locked submission flow (see [`demo-playbook.md`](./demo-playbook.md)). It is a **real-provider** path and is therefore split into gated vs advisory.

### 6.1 Inputs

- Product: AeroSpin 便携涡轮小风扇 (portable turbo fan), 9:16, ~15 s.
- Sample: `editing.mov` (structure evidence only — no frame/audio/watermark copy).
- Target material: `docs/fixtures/final_aerospin_fan/` (`fan_hero.png`, `fan_card_01..04.png`, `logo.png`, `copy.json`, `manifest.json`), generated by the **real Gemini 2.5 Flash Image** provider (Nano Banana), provenance `materialRole=aigc_generated_material`. Requires `GEMINI_API_KEY` + external-provider opt-in.
- Optional real `--source` video (`test_videos/manual/fan_product_demo.mp4`) if ever supplied.

### 6.2 Expected clip arc

`0–2.5` hook `FanHeroSpin` → `2.5–5.5` setup `TypographyLayoutSequence` → `5.5–8.5` body `FeatureCardStack` → `8.5–11.5` proof `SourceClipBeatMontage` (or `DynamicProxyMontage` + `moving_material_missing` gap) → `11.5–13` transition `ImpactFlash` → `13–15` cta `CTAEndSlate`.

### 6.3 Gated vs advisory

| Item | Status |
|---|---|
| All v1.3 render-quality gates (§4 G1–G18) | **Gated** — `demo:final` fails if any non-skipped gate fails. |
| Anti-overfit diversity eval (§5) | **Gated** on `primitive_seq_similarity < 1.0` and non-identical subtitles; **advisory** on `layout_ncc_mean`. |
| RenderRecipe AJV validity + clip↔recipe join | **Gated** (also covered by goldens). |
| Material provenance (`aigc_generated_material`, no sample id in render) | **Gated**. |
| Gemini target-asset generation succeeded with this key | **Advisory at run time** — if `GEMINI_API_KEY` is absent or the call fails, the runner uses the committed `docs/fixtures/final_aerospin_fan/` assets (already generated + checked in with provenance) and marks the live generation step `skipped (using committed fixture)`. The render gates still run on the committed assets. |
| Optional real `--source` pixel usage (G7 source branch) | **Advisory** unless a real fan source video is supplied; otherwise the `moving_material_missing` branch of G7 is the gated path. |
| HyperFrames artifact | **Advisory** — real artifact if CLI exists, else `SKIPPED_HYPERFRAMES.md`. |

### 6.4 Artifacts

`demo:final` writes to `docs/artifacts/final_submission/`:

```text
demo_a_editing_fan/        # editing.mov + fan assets: recipe, timeline, render mp4, preview frames, gate report
demo_b_motion_graph_fan/   # motion_graph_1.mov + same fan assets
diversity_eval/            # pairwise_similarity.{json,md}, layout_ncc, primitive_seq, subtitle_identity
FINAL_REPORT.md            # honest pass/warn/fail summary + remaining gaps
README.md                  # how to reproduce
```

Artifact hygiene (`scripts/check-artifact-hygiene.mjs`) MUST pass: no API keys, no `.env` values, no private absolute paths in any public artifact.

---

## 7. Honest handling of infra limits (skipped, never faked)

v1.3 keeps spec_v2's hard rule: a missing capability is reported as skipped infrastructure with a reason, never as a deterministic pass and never as a fabricated artifact.

| Condition | Handling |
|---|---|
| `listen EPERM: operation not permitted 0.0.0.0` (API e2e needs a local socket in a restricted sandbox) | The API e2e test is reported `skipped (sandbox: socket bind not permitted)`; re-run in an environment that allows local binding. Unit/builder tests in §2–§3 do not need a socket and still run. |
| `ffmpeg` / `ffprobe` absent | G2/G3/G7/G9/G15/G18 are `skipped (ffmpeg unavailable)`; the runner does not emit a fake MP4 or fabricated dimensions. |
| conda `viral` Python (PySceneDetect/librosa/easyocr/faster_whisper/cv2) absent | Evidence analysis is `skipped`; the goldens use committed evidence oracles so §2–§3 still run; live `demo:final` evidence step is `skipped` with reason. |
| Remotion Chromium not yet downloaded | First real render downloads it; if download is blocked, G14 is `skipped (chromium unavailable)` and the runner says so rather than claiming a Remotion render happened. The Remotion bundle test stays gated by `RUN_REMOTION_BUNDLE_TEST`. |
| HyperFrames CLI absent | Write `SKIPPED_HYPERFRAMES.md`; G-HF `skipped`. Never presented as a completed MP4 renderer. |
| `GEMINI_API_KEY` absent / external opt-in off | Live target-asset generation `skipped (no key / opt-in off)`; render runs on the committed provenance-labeled fixture. Sample frames are NEVER sent to the external provider (`sampleFramesSentExternally=false`), key conditions or not. |
| Any gate cannot read its input | Reported `skipped (missing input: …)`, counted separately from pass/fail in the gate summary. |

The gate summary always prints `pass / fail / skipped` counts. A submission claim of "N/N gates pass" must state N excludes skipped infra and must list what was skipped and why.

---

## 8. E2E acceptance criteria (v1.3)

The v1.3 submission passes if:

- [ ] `npm run typecheck` is clean across all workspaces.
- [ ] `@vvst/shared` vitest is green, including the §2 builder/decision/material-policy tests and the §3 goldens (recipe block + clip↔recipe join + AeroSpin recipe golden).
- [ ] `npm run build` succeeds (api, web, shared, renderer).
- [ ] `npm run demo:final` produces both demo A and demo B renders with valid `renderRecipe` and passes all non-skipped §4 gates.
- [ ] Anti-overfit eval: `primitive_seq_similarity < 1.0` and non-identical subtitles across demo A/B; `layout_ncc_mean` reported (WARN disclosed if `>= 0.85`).
- [ ] ≥1 provenance-labeled target/generated material reaches the canvas; no sample id appears in render material; sample frame/audio copy = false; no watermark reproduced.
- [ ] The Remotion recipe renderer produced the main visual layer from `RenderRecipeClip` props; FFmpeg muxed the final 720x1280 MP4.
- [ ] `FINAL_REPORT.md` + `README.md` under `docs/artifacts/final_submission/` honestly state pass/warn/fail and remaining gaps; artifact hygiene passes.

---

## 9. Known limitations to declare (v1.3)

- The gated must-pass vertical is the single AeroSpin product promo (P3). `beat_cut`, `motion_graph`, vlog, short_drama, and talking_head are not simultaneously gated; they remain style sources or future work.
- The AeroSpin target assets are **AIGC-generated** (Gemini 2.5 Flash Image), labeled `aigc_generated_material` — they are not user uploads and not a real product photo. AeroSpin is a fictional brand, so an AIGC logo is permitted; this exception does not extend to real brands (NFR-005 / spec_v2 still forbids fake logos for real brands).
- The source-pixel branch of G7 is exercised end-to-end only when a real `--source` fan video is supplied; without one, the gated path is the honest `moving_material_missing` gap + `DynamicProxyMontage`.
- HyperFrames remains an optional artifact, not a gated MP4 renderer.
- No video-generation model is in the critical path; direct video generation (Seedance/Veo) stays out of scope (P5).
- The diversity thresholds (`layout_ncc_mean` WARN at 0.85, TARGET 0.70) are product judgments derived from the investigation's measured 0.868–1.000 baseline, not a universal constant; they should be re-reviewed as the renderer evolves.
