# Implementation Tasks — Spec v1.3

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

Version: **Spec v1.3 — Source-first RenderRecipe Engine**

This task plan turns the 11 implementation steps of Spec v1.3 into eleven phases `V13-P1` … `V13-P11`,
each with concrete sub-tasks and a per-phase `Verification:` block. It supersedes
[`../spec_v2/tasks.md`](../spec_v2/tasks.md) **for the final submission only** — the broader v1.2 task plan
remains valid for everything v1.3 does not override.

Read alongside:

- [`requirements.md`](./requirements.md) — FR/NFR/gates for v1.3
- [`design.md`](./design.md) — the RenderRecipe compile path + renderer roles
- [`schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json) — the authoritative render contract
- [`test-plan.md`](./test-plan.md) — gates, golden re-baseline plan, anti-overfit eval
- [`demo-playbook.md`](./demo-playbook.md) — `npm run demo:final` walkthrough

---

## Why this re-baselining exists (read first)

The overfit investigation
([`docs/artifacts/render_overfit_findings/REPORT.md`](../docs/artifacts/render_overfit_findings/REPORT.md))
proved the current product renders a **sample-blind mold**: every `videoType=beat_cut` input collapses to one
identical 6-primitive sequence (`neon_hero_intro`, `beat_text_card`, `tutorial_rule_card`, `action_montage`,
`impact_flash_stamp`, `motivation_cta`) with hardcoded subtitle copy and fixed FFmpeg geometry — measured
cross-brief render layout cross-correlation 0.868–1.000 and primitive-sequence similarity 1.00 for every
beat-cut pair. Root cause chain: (a) the material policy nulls any sample-sourced `sourceAssetId` so no real
pixels reach the canvas; (b) the beat-cut primitive is chosen from `clip.role + visualFormFamily` only, not from
visual evidence; (c) the FFmpeg renderer is fixed procedural geometry keyed on the primitive string + bpm.

Spec v1.3 replaces `role → primitive → hardcoded pixels` with
`VisualEvidence + SlotMapping + MaterialPolicy + FillPlan → RenderRecipe → FFmpeg / Remotion / HyperFrames`.
The five hard principles (source-first; every renderer consumes a RenderRecipe; one reliable vertical first;
beat_cut as style source only; no video-generation model in the critical path) are stated in
[`requirements.md`](./requirements.md) and govern every task below.

### Sequencing strategy

Tasks are ordered **additive-first**: schema/type and the AeroSpin target fixture land before any
material-policy or renderer rewrite, so build/typecheck/test stay green for as long as possible. Phases that
**unavoidably re-baseline a committed golden** are flagged inline with **[RE-BASELINE]** and consolidated in
[Golden re-baseline plan](#golden-re-baseline-plan) at the end.

---

## V13-P1 — Final target fixture (real Gemini AIGC fan assets)

Additive. No existing code touched; build/test stay green.

- [ ] T1.1 Create `docs/fixtures/final_aerospin_fan/` for the locked demo product **AeroSpin 便携涡轮小风扇**.
- [ ] T1.2 Generate target assets with the **real** Gemini 2.5 Flash Image provider (Nano Banana):
  `fan_hero.png`, `fan_card_01..04.png`, `logo.png` (requires `GEMINI_API_KEY` + external-provider opt-in).
- [ ] T1.3 Author `copy.json` (product name, ≥4 selling points, CTA copy — all bilingual where the demo shows text).
- [ ] T1.4 Author `manifest.json` as a `target-material-manifest-v1` whose every asset carries
  provenance `materialRole=aigc_generated_material` (NOT user upload, NOT a real product photo).
  AeroSpin is a **fictional** brand, so the AIGC logo is permitted.
- [ ] T1.5 Add a generator script (e.g. `scripts/generate-final-aerospin-assets.mjs`) that is deterministic-skip
  when assets already exist and refuses to run without explicit external-provider opt-in.
- [ ] T1.6 Reserve the optional real source path `test_videos/manual/fan_product_demo.mp4` (used only if a real
  fan video is ever supplied; absence MUST NOT break the demo).

Verification:

- [ ] All seven fixture files exist and load as real raster images (not zero-byte, not SVG placeholders).
- [ ] `manifest.json` validates against `target-material-manifest-v1`; every asset is `aigc_generated_material`.
- [ ] No sample frame from `editing.mov` was sent to the image provider during generation (`sampleFramesSentExternally=false`).
- [ ] Build/typecheck/test still green (this phase is fixture-only).

---

## V13-P2 — RenderRecipe type at `timeline.renderPlan.renderRecipe`

Additive. `timeline.renderPlan` is `additionalProperties:true`, so **zero change** to `timeline.schema.json`.

- [ ] T2.1 Confirm [`schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json) is wired into
  `npm run validate:schemas` (the AJV schema set).
- [ ] T2.2 Add a `RenderRecipe` TypeScript type in `packages/shared` mirroring the schema exactly
  (`schemaVersion=render-recipe-v1`, `videoType`, `productTheme`, `sourcePolicy`, `global`, `clips[]`, `warnings[]`).
- [ ] T2.3 Add an AJV validator + valid/invalid fixtures for RenderRecipe under `packages/shared`.
- [ ] T2.4 Type the carrier field `timeline.renderPlan.renderRecipe?: RenderRecipe` without redefining `Timeline`.
- [ ] T2.5 Add a unit test that a fixture RenderRecipe round-trips type → schema → type.

Verification:

- [ ] `npm run validate:schemas` includes RenderRecipe and passes on the valid fixture.
- [ ] Invalid fixtures (missing `primitiveReason`, `sampleFrameCopyAllowed:true`, unknown primitive) fail with readable errors.
- [ ] `npm run typecheck` green; no change to `timeline.schema.json`.

---

## V13-P3 — Material policy fix (user_authorized non-sample source/target reaches canvas)

**[RE-BASELINE]** This is the first behavior change; it alters what pixels reach the canvas and may shift
`editingMovMovingMaterialGolden` expectations. Land the schema/type (P2) and fixture (P1) first.

- [ ] T3.1 Implement material-policy rules R1–R5 from [`requirements.md`](./requirements.md):
  - R1 a sample id in `template.sourceSampleIds` cannot be render material unless `sampleAssetReuse=authorized`.
  - R2 a `source_video` id ≠ sample id with `sourcePolicy=user_authorized` MUST be eligible render material.
  - R3 if source has matched shots for a montage slot, the renderer MUST use source pixels.
  - R4 no source moving clip → `DynamicProxyMontage` allowed but `moving_material_missing` gap MUST remain.
  - R5 target images satisfy media_cards / product_hero / feature_list / brand_cta but cannot pretend to be
    `live_action_montage` unless animated as a procedural target asset; mock/no-path assets satisfy nothing.
- [ ] T3.2 Stop nulling sample-sourced `sourceAssetId`; instead classify each asset as
  `evidence_only` vs `renderable` and surface it in `material.policy`.
- [ ] T3.3 Thread `sourcePolicy` (sampleUse / sourceVideoUse / targetAssetUse / sampleFrameCopyAllowed:false /
  sampleAudioCopyAllowed:false) into the recipe compiler.
- [ ] T3.4 Keep `sampleFrameCopyAllowed` and `sampleAudioCopyAllowed` hard-`false`; watermark never reproduced.
- [ ] T3.5 **[RE-BASELINE]** Update `editingMovMovingMaterialGolden` oracle so authorized target/source material
  now appears as `renderable` while the sample stays `evidence_only` and `moving_material_missing` is still honest.

Verification:

- [ ] An authorized non-sample source asset is marked `renderable` and reaches a clip's `material.assetIds`.
- [ ] A sample asset stays `evidence_only` unless `sampleAssetReuse=authorized`.
- [ ] A mock/no-path asset satisfies no visual slot.
- [ ] Golden test re-baselined intentionally (diff reviewed, not blindly snapshot-updated); `npm test` green.

---

## V13-P4 — Evidence + material driven `selectPrimitive`

**[RE-BASELINE]** Removes the `role → primitive` mapping that produced the identical 6-clip mold; this changes
the primitive sequence emitted for `editing.mov` and re-baselines beat-cut goldens.

- [ ] T4.1 Implement `selectPrimitive(slot, evidence, material, capabilities)` returning
  `{ selectedPrimitive, primitiveReason }`. Primitive MUST NOT come from `clip.role` alone.
- [ ] T4.2 Encode the selection rules from [`requirements.md`](./requirements.md):
  - `source_video_mapped` + high-motion source shots ≥ 3 → `SourceClipBeatMontage`.
  - product hero image/video + hook role → `ProductHeroOrbit` or `FanHeroSpin`.
  - product category fan + prompt mentions fan/spin/wind → `FanHeroSpin`.
  - no moving source + product image exists → `DynamicProxyMontage` + `moving_material_missing` gap.
  - typography/OCR evidence with bbox/layout → `TypographyLayoutSequence`.
  - target image set ≥ 3 → `FeatureCardStack`.
  - impact/onset evidence → `ImpactFlash`.
  - CTA copy exists → `CTAEndSlate`.
- [ ] T4.3 Write a human-auditable `primitiveReason` for **every** clip (the gate checks this).
- [ ] T4.4 Build the RenderRecipe compiler that derives the full recipe from StructureTemplate +
  VisualElementGraph + SourceVideoUnderstanding + SlotMapping + GapReport + FillPlan +
  TargetMaterialManifest + ProductBrief, and attach it at `timeline.renderPlan.renderRecipe`.
- [ ] T4.5 **[RE-BASELINE]** Update `editingMovBeatCutGolden` oracle for the new evidence-driven primitive
  sequence + per-clip `primitiveReason`; assert the sequence is no longer the fixed 6-clip mold.
- [ ] T4.6 **[RE-BASELINE]** Update `marketingPosterCase` if its asserted primitive/slot mapping shifts under
  evidence-driven selection.

Verification:

- [ ] Every clip in the compiled recipe has a non-empty `primitiveReason`.
- [ ] Two unrelated samples produce **different** primitive sequences (no forced mold).
- [ ] FanHeroSpin is selected for the AeroSpin hook; CTAEndSlate for the CTA; reasons cite the evidence.
- [ ] Goldens re-baselined with reviewed diffs; `npm test` green.

---

## V13-P5 — Remotion recipe renderer components

Additive to renderer surface (new `rendererTarget=remotion_recipe` path); does not yet replace FFmpeg geometry.

- [ ] T5.1 Build Remotion components that consume **`RenderRecipeClip` props only** and never re-infer a primitive:
  `FanHeroSpin`, `ProductHeroOrbit`, `SourceClipBeatMontage`, `DynamicProxyMontage`, `TypographyLayoutSequence`,
  `FeatureCardStack`, `ImpactFlash`, `CTAEndSlate`, `BeatBars`.
- [ ] T5.2 Drive layout/motion/text from `clip.layout`, `clip.motion`, `clip.text`, `global.palette`,
  `global.beatGridSec` — no hardcoded copy, no hardcoded geometry.
- [ ] T5.3 Register a Remotion composition whose props are the compiled RenderRecipe; render the **main visual layer**.
- [ ] T5.4 `SourceClipBeatMontage` / `DynamicProxyMontage` resolve `material.assetIds` / `material.sourceShotIds`;
  a `none`/`evidence_only` material renders nothing real and keeps the gap.
- [ ] T5.5 Add a gated Remotion bundle smoke test (mirror v1.2's `RUN_REMOTION_BUNDLE_TEST` gate to keep CI fast).

Verification:

- [ ] Each component renders from RenderRecipe props with no in-component primitive inference.
- [ ] Changing `clip.text.copy` / `global.palette` in the recipe changes the rendered output.
- [ ] Remotion produces the main visual layer for the AeroSpin demo (proven later by the gate in P9).
- [ ] `npm run typecheck` + bundle smoke (when enabled) green.

---

## V13-P6 — FFmpeg final mux / concat / crop + preview frames

Additive/compose role. FFmpeg becomes the compositor + fallback, not the primitive geometry engine.

- [ ] T6.1 FFmpeg source-clip cut / crop / zoom from `material.sourceShotIds` for `SourceClipBeatMontage`.
- [ ] T6.2 FFmpeg concat/mux of the Remotion main visual layer + source clips + procedural BGM into one MP4.
- [ ] T6.3 Procedural BGM from `global.audioPlan` (layers: kick/bass/drone/hats/riser/impact) honoring `beatGridSec`.
- [ ] T6.4 Final output **720x1280, 9:16, ~15s** (gate window 14.5–15.5s).
- [ ] T6.5 Extract per-clip preview frames at `clip.startSec` into `storage/generated/previews/<renderId>/`.
- [ ] T6.6 FFmpeg fallback-card render for `videoType=fallback_cards` (clean family names + real copy, no debug text).

Verification:

- [ ] Final MP4 is 720x1280 and 14.5–15.5s.
- [ ] BGM is present and beat-aligned; no sample audio is muxed (`sampleAudioCopyAllowed=false`).
- [ ] Per-clip preview frames are real rendered frames, not placeholder gradients.
- [ ] Fallback-card render contains no `PROXY`/`PLACEHOLDER`/debug text.

---

## V13-P7 — HyperFrames optional artifact

Additive; clearly optional. Never shown in UI as a finished MP4 renderer while it is only a JSON stub.

- [ ] T7.1 If the HyperFrames CLI exists, emit a **real** html + manifest + preview artifact for the MG/HTML preview.
- [ ] T7.2 If the CLI is absent, write `SKIPPED_HYPERFRAMES.md` explaining the skip (no fake completion).
- [ ] T7.3 Ensure `rendererTarget=hyperframes_recipe` clips are surfaced as a preview artifact, not the final deliverable.

Verification:

- [ ] With CLI present: html + manifest + preview produced.
- [ ] Without CLI: `SKIPPED_HYPERFRAMES.md` written; the demo's final MP4 still comes from FFmpeg.
- [ ] UI/report never labels a JSON stub as a completed MP4 render.

---

## V13-P8 — `demo:final` runner

Additive runner that drives the locked AeroSpin demo end to end.

- [ ] T8.1 Add `npm run demo:final` driving: sample `editing.mov` (structure evidence only) + AeroSpin fixture
  → analyze → induce → compile RenderRecipe → Remotion main layer → FFmpeg mux → 720x1280 ~15s MP4 + previews + exports.
- [ ] T8.2 Accept optional `--source test_videos/manual/fan_product_demo.mp4`; absence → `DynamicProxyMontage` +
  `moving_material_missing` (no faked footage).
- [ ] T8.3 Emit the expected clip arc and assert it: 0–2.5 hook FanHeroSpin; 2.5–5.5 setup TypographyLayoutSequence;
  5.5–8.5 body FeatureCardStack; 8.5–11.5 proof SourceClipBeatMontage (or DynamicProxyMontage + gap);
  11.5–13 transition ImpactFlash; 13–15 cta CTAEndSlate.
- [ ] T8.4 Surface honest status: external calls made, sample frames sent (`false`), watermark reproduced (`false`),
  AIGC provenance on every target asset.

Verification:

- [ ] `npm run demo:final` produces a 720x1280 ~15s MP4 with the compiled RenderRecipe attached.
- [ ] The six-clip arc roles/times match the locked spec; product name, ≥4 selling points, and CTA are visible.
- [ ] Runner reports `sampleFrameCopy=false`, `sampleAudioCopy=false`, `watermarkReproduced=false`.

---

## V13-P9 — Gates (v1.3) + anti-overfit eval

The acceptance gate is the contract that the mold is gone. See [`test-plan.md`](./test-plan.md).

- [ ] T9.1 Implement the core gate: final MP4 exists; 720x1280; 14.5–15.5s; `renderRecipe` exists; every clip has
  a `primitiveReason`; ≥1 target material appears in the render; if source exists source-pixel usage > threshold
  else `moving_material_missing` present; `sampleFrameCopy=false`; `sampleAudioCopy=false`;
  `watermarkReproduced=false`; product name visible; ≥4 selling points visible; CTA visible;
  RemotionRecipeRenderer produced the main visual layer; FFmpeg muxed the final MP4.
- [ ] T9.2 Implement the **anti-overfit** eval: run demo A (`editing.mov` + fan assets) and demo B
  (`motion_graph_1.mov` + the same fan assets).
- [ ] T9.3 FAIL/WARN if any holds across the unrelated samples:
  - layout NCC ≥ 0.85;
  - primitive-sequence similarity = 1.0;
  - identical subtitles.
- [ ] T9.4 Wire gates into `eval:render-quality` (e.g. `--gates v13`) and the `demo:final` runner.

Verification:

- [ ] Core gate passes on the AeroSpin demo MP4.
- [ ] Anti-overfit eval reports NCC, primitive-sequence similarity, and subtitle-identity across A/B; none trip the FAIL thresholds.
- [ ] Removing `primitiveReason` from any clip fails the gate (gate has teeth).

---

## V13-P10 — Submission artifacts

Additive; produces the evaluator-facing evidence bundle.

- [ ] T10.1 Write artifacts under
  `docs/artifacts/final_submission/{demo_a_editing_fan, demo_b_motion_graph_fan, diversity_eval}`.
- [ ] T10.2 Each demo dir: compiled RenderRecipe JSON, final MP4, per-clip preview frames, gate report.
- [ ] T10.3 `diversity_eval`: the A-vs-B NCC / primitive-sequence / subtitle comparison + contact sheet.
- [ ] T10.4 Write `docs/artifacts/final_submission/FINAL_REPORT.md` (what changed vs the mold, evidence, gate results).
- [ ] T10.5 Write `docs/artifacts/final_submission/README.md` (how to reproduce with `npm run demo:final`).
- [ ] T10.6 Run `scripts/check-artifact-hygiene.mjs` so no local paths / secrets leak into public artifacts.

Verification:

- [ ] All three artifact dirs populated; both demo MP4s play and differ visibly.
- [ ] `FINAL_REPORT.md` cites the overfit findings and the v1.3 gate results.
- [ ] Artifact hygiene scan passes.

---

## V13-P11 — Verify + honest gaps

Final green pass + truthful limitations.

- [ ] T11.1 Run `npm run typecheck`, `npm test`, `npm run build`, `npm run validate:schemas` — all green.
- [ ] T11.2 Run `npm run demo:final` clean from a fresh state; gate passes.
- [ ] T11.3 Run the anti-overfit A/B eval; record the diversity metrics.
- [ ] T11.4 Update [`../README.md`](../README.md) entry points to mention `npm run demo:final` and spec_v3.
- [ ] T11.5 Document honest remaining gaps (e.g. no real fan footage → DynamicProxyMontage + gap; HyperFrames
  optional; Remotion vs FFmpeg responsibilities; beat_cut/motion_graph not yet unified under one analyzer).

Verification:

- [ ] typecheck + test + build + validate:schemas + demo:final all pass.
- [ ] Remaining-gaps section is accurate and does not overclaim (no mock outputs, no fake real-brand logos,
  no sample frames sent externally, AIGC opt-in, provenance on generated assets).

---

## Golden re-baseline plan

These phases knowingly change committed golden oracles. Re-baseline each **with a reviewed diff** — never a blind
snapshot update — and keep the deterministic fixtures honest (sample stays evidence-only, gaps stay honest).

| Phase | Golden affected | Why it re-baselines | Reviewer check |
|---|---|---|---|
| V13-P3 | `editingMovMovingMaterialGolden` | Authorized source/target now reaches the canvas as `renderable` | Sample still `evidence_only`; `moving_material_missing` still present |
| V13-P4 | `editingMovBeatCutGolden` | Evidence-driven `selectPrimitive` replaces the fixed 6-clip mold | New sequence ≠ old mold; every clip has `primitiveReason` |
| V13-P4 | `marketingPosterCase` | Primitive/slot mapping may shift under evidence-driven selection | Mapping still satisfies required slots; no mock satisfies a slot |

`editingMovMovingMaterialGolden` also keeps its "gate has teeth" assertion (ideal render passes, pre-fix static
render fails); preserve that intent through the re-baseline.

---

## Toolchain note

Builds and scripts require node v22 + the `viral` conda env (system node is stale v12). Prefix once per shell:

```bash
export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
```

FFmpeg/ffprobe 8.1.1 + python3.11 + librosa/scenedetect/easyocr/faster_whisper/cv2 live in `viral`; node/npm in nvm.
Real provider runs (Gemini image generation in P1, Gemini VLM analysis) need `GEMINI_API_KEY` + external-provider opt-in.

---

## Suggested commit order

1. `docs: add spec v1.3 (source-first RenderRecipe engine)`
2. `feat(fixtures): add real Gemini AIGC AeroSpin fan target fixture` *(V13-P1)*
3. `feat(shared): add RenderRecipe type + AJV validator at timeline.renderPlan.renderRecipe` *(V13-P2)*
4. `feat(material): authorize non-sample source/target material to canvas; rebaseline moving-material golden` *(V13-P3)*
5. `feat(recipe): evidence+material driven selectPrimitive + recipe compiler; rebaseline beat-cut goldens` *(V13-P4)*
6. `feat(remotion): RenderRecipe-driven components (FanHeroSpin … CTAEndSlate, BeatBars)` *(V13-P5)*
7. `feat(ffmpeg): source cut/crop + concat/mux + procedural BGM + per-clip preview frames` *(V13-P6)*
8. `feat(hyperframes): optional html+manifest+preview artifact or SKIPPED_HYPERFRAMES.md` *(V13-P7)*
9. `feat(demo): demo:final AeroSpin runner (editing.mov style source + fan target)` *(V13-P8)*
10. `feat(gates): v1.3 acceptance gate + anti-overfit A/B diversity eval` *(V13-P9)*
11. `docs(artifacts): final_submission demos + diversity_eval + FINAL_REPORT` *(V13-P10)*
12. `chore: verify typecheck/test/build/demo:final + honest remaining gaps` *(V13-P11)*
