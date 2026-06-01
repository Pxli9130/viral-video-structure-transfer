# Implementation Status — Spec v1.3

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

Spec: **Spec v1.3 — Source-first RenderRecipe Engine**

Date snapshot: **2026-05-31** (revision 0 — spec authored, implementation NOT started)

> Honesty contract for this file: this status is written the moment the
> spec_v3 doc set lands. **No v1.3 product code exists yet.** Only the
> spec_v3 documents and [`spec_v3/schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json)
> have been written. Everything below that is not explicitly marked **Done**
> is **Not started**. Nothing in this file claims an implementation that has
> not happened. The v1.2-final product (audited in
> [`spec_v2/implementation-status.md`](../spec_v2/implementation-status.md))
> is the live baseline; v1.3 is a focused, source-first, RenderRecipe-centered
> submission spec layered on top of it and does not yet replace any v1.2 code.

诚实声明 / honesty in one line: spec_v3 截至本日**只有文档与 RenderRecipe schema**，11 个实现步骤尚未动工。

---

## Revision 1 (2026-05-31, implemented) — supersedes the revision-0 snapshot below

All 11 implementation steps have now landed. The revision-0 "Not started" table below is kept for history but is superseded by this section.

| # | Step | Status | Evidence |
|---|---|---:|---|
| 1 | Real Gemini AIGC fan fixture | ✅ Done | `docs/fixtures/final_aerospin_fan/` (fan_hero + fan_card_01..04 + logo, real `google_gemini_image`, provenance.json) via `scripts/generate-aerospin-fan-fixture.mjs` |
| 2 | RenderRecipe type + builder | ✅ Done | `RenderRecipe`/`RenderRecipeClip` in `types.ts`; `buildRenderRecipe` in `engine/planner.ts` emits at `timeline.renderPlan.renderRecipe`; `renderRecipe.test.ts` |
| 3 | Material policy (source-first) | ✅ Done | `dropSampleVisual` discriminator + `moving_material_missing` gap + server `asset://managed` resolver fix; `materialPolicySourceFirst.test.ts` |
| 4 | Evidence+material `selectPrimitive` | ✅ Done | flag-guarded `controls.recipeEvidencePrimitives`; `selectPrimitive` in planner; `selectPrimitive.test.ts` (divergence) |
| 5 | RemotionRecipeRenderer | ✅ Done | `apps/api/remotion/ViralRecipeRoot.tsx` + `ViralRecipe` composition + `remotion_recipe` target/backend; renders `final.remotion.mp4` (chromium verified) |
| 6 | FFmpeg source compositing + mux | ✅ Done | renderClip composites real target/source media regardless of clip.type; removed meta genre labels; canonical `final.mp4` |
| 7 | HyperFrames optional | ✅ Done | `final_submission/SKIPPED_HYPERFRAMES.md` (no public SDK; not presented as a finished MP4 renderer) |
| 8 | `demo:final` runner | ✅ Done | `scripts/run-demo-final.mjs` + `npm run demo:final`; Demo A (editing.mov beat_cut + fan) + Demo B (motion_graph + fan) |
| 9 | Gates + diversity | ✅ Done | 13 inline gates (all PASS) + `scripts/diversity_ncc.py` (`npm run eval:render-diversity`) |
| 10 | final_submission artifacts | ✅ Done | `docs/artifacts/final_submission/{demo_a_editing_fan,demo_b_motion_graph_fan,diversity_eval,FINAL_REPORT.md,README.md}` |
| 11 | Verification | ✅ Done | see below |

**Verification (2026-05-31, real toolchain):**
- `npm run typecheck` — clean (all 4 workspaces).
- `npm test` — shared **71 passed** (61 baseline + renderRecipe(2) + materialPolicySourceFirst(2) + selectPrimitive(6) new tests), api **8 passed / 1 skipped**. Goldens (`editingMovBeatCutGolden`, `editingMovMovingMaterialGolden`, `marketingPosterCase`) stay green — the recipe is additive and evidence-driven selection is flag-guarded OFF by default.
- `npm run validate:schemas` — **967 passed, 0 failed**.
- `npm run regression:corpus:strict` — **9 passed, 0 failed, 1 skipped** (010_editing_beatcut needs the live API server). Note: 009 had a PRE-EXISTING failure from stale external-Seedream AIGC artifacts on disk (unrelated to v1.3); regenerated with the deterministic mock provider to restore green.
- `npm run demo:final` — Demo A gates **ALL PASS** (720×1280, 15.0s, 4 clips composite real fan assets, sample-copy=0); both `final.mp4` (FFmpeg) and `final.remotion.mp4` (Remotion) consume the same recipe.

**Headline anti-overfit result:** cross-sample `layout_ncc_mean` = **0.0103** (Demo A beat_cut vs Demo B motion_graph, same fan assets), vs the investigation's measured **0.868–1.000** mold band. The sample-blind mold is broken.

**Honest remaining gaps:** (a) FFmpeg owns the canonical MP4; Remotion is the recipe-driven secondary layer (both work). (b) Evidence-driven `selectPrimitive` is flag-guarded OFF by default to keep the editing.mov goldens byte-identical; flipping it ON by default would require re-baselining those goldens (deliberate future step). (c) No real fan footage exists, so a distinct `--source` video path (R2/R3 source-pixel compositing) is implemented but exercised via target images, not a live source video; supply a real `--source` to exercise it. (d) Demo A uses the committed real editing.mov evidence-derived template for a deterministic, server-free run; the live-analysis path is `npm run full-loop:editing`.

---

---

## 0. Why v1.3 exists (the overfit finding)

The investigation [`docs/artifacts/render_overfit_findings/REPORT.md`](../docs/artifacts/render_overfit_findings/REPORT.md)
proved that the current product renders a **sample-blind mold**: every input
classified `videoType="beat_cut"` collapses to one identical 6-primitive
sequence (`neon_hero_intro, beat_text_card, tutorial_rule_card, action_montage,
impact_flash_stamp, motivation_cta`) with hardcoded subtitle copy and fixed
FFmpeg geometry. Measured cross-brief render layout cross-correlation is
**0.868–1.000 with primitive-sequence similarity 1.00 for every beat-cut pair**
(`artifacts/similarity_probe/pairwise_similarity.json`). The root-cause chain:

1. **Material policy** nulls any sample-sourced `sourceAssetId`, so no real
   pixels reach the canvas (`planner.ts:1210-1260, 3292-3300`).
2. **Primitive selection** is keyed on `clip.role` + `clip.visualFormFamily`
   only, not on visual evidence (`planner.ts:2952-2962`).
3. The **FFmpeg renderer** is fixed procedural geometry keyed on the primitive
   string + `bpm` (`renderers.ts:894-962`).

This reads as a fixed-template generator and damages the core scoring criterion:
the official task rewards transferring structure to **new material**, not
reproducing a mold. v1.3 replaces `role → primitive → hardcoded pixels` with
`VisualEvidence + SlotMapping + MaterialPolicy + FillPlan → RenderRecipe →
FFmpeg / Remotion / HyperFrames`. See [`requirements.md`](./requirements.md) and
[`design.md`](./design.md) for the full source-first principles (P1–P5) and the
RenderRecipe contract.

---

## 1. Step status (the 11 implementation steps)

Legend: ✅ Done · 🟡 In progress · ⬜ Not started · 🛈 design note.

| # | Step | Status | Notes |
|---|---|---|---|
| — | **Spec v1.3 authored** | ✅ Done | `spec_v3/*.md` doc set written (requirements, design, this status, and siblings per [`requirements.md`](./requirements.md)). |
| — | **RenderRecipe schema drafted** | ✅ Done | [`spec_v3/schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json) is the authoritative contract: `schemaVersion=render-recipe-v1`, `videoType` ∈ {`product_mg`,`beat_cut_product`,`motion_graph`,`fallback_cards`}, `productTheme`, `sourcePolicy` (`sampleFrameCopyAllowed`/`sampleAudioCopyAllowed` hard `const:false`), `global`, `clips[]` (each with a required `primitiveReason`), `warnings[]`. `additionalProperties:false`. NOT wired into code yet. |
| 1 | Final target fixture (real Gemini AIGC fan assets + manifest) | ⬜ Not started | Target: `docs/fixtures/final_aerospin_fan/` (`fan_hero.png`, `fan_card_01..04.png`, `logo.png`, `copy.json`, `manifest.json`), provenance `materialRole=aigc_generated_material`. Requires `GEMINI_API_KEY` + external-provider opt-in. No fixture files exist yet. |
| 2 | RenderRecipe type at `timeline.renderPlan.renderRecipe` | ⬜ Not started | Additive only — `renderPlan` schema is `additionalProperties:true` (`schemas.ts:726`), so zero change to `timeline.schema.json`. The TS `RenderRecipe` type, the AJV registration, and the `RenderPlan.renderRecipe?` field do not exist yet. |
| 3 | Material-policy fix (user_authorized non-sample source/target reaches canvas) | ⬜ Not started | Implements R1–R5 from [`design.md`](./design.md). Touches golden-pinned planner output (`planner.ts:1210-1260, 3292-3300, 2197-2214`) — flagged as the highest-risk change (see §5). Not begun. |
| 4 | Evidence + material driven `selectPrimitive(slot, evidence, material, capabilities)` | ⬜ Not started | Replaces `beatCutPrimitiveForClip` (`planner.ts:2952-2962`). Must write a human-auditable `primitiveReason` per clip; primitive must NOT be chosen from `clip.role` alone. Not begun. |
| 5 | RemotionRecipeRenderer components | ⬜ Not started | Primary visual renderer. Components consume `RenderRecipeClip` props only and never re-infer: `FanHeroSpin`, `ProductHeroOrbit`, `SourceClipBeatMontage`, `DynamicProxyMontage`, `TypographyLayoutSequence`, `FeatureCardStack`, `ImpactFlash`, `CTAEndSlate`, `BeatBars`. None exist. |
| 6 | FFmpeg final mux/concat/crop + preview frames | ⬜ Not started | FFmpeg owns source-clip cut/crop/zoom, concat/mux, procedural BGM, preview-frame extraction, the final 720×1280 MP4, and the fallback-card render. Not begun. |
| 7 | HyperFrames optional artifact | ⬜ Not started | Optional MG/HTML preview artifact: real `html+manifest+preview` if the CLI exists, otherwise write `SKIPPED_HYPERFRAMES.md`. Never presented in UI as a completed MP4 renderer while it is only a JSON stub. Not begun. |
| 8 | `demo:final` runner | ⬜ Not started | Drives the locked AeroSpin demo (see §3). No `npm run demo:final` script exists. |
| 9 | Gates (v1.3) | ⬜ Not started | The v1.3 gate set + ANTI-OVERFIT diversity gate (§4) are not implemented. |
| 10 | Artifacts + reports | ⬜ Not started | Target: `docs/artifacts/final_submission/{demo_a_editing_fan,demo_b_motion_graph_fan,diversity_eval}` + `FINAL_REPORT.md` + `README.md`. None exist. |
| 11 | Verify typecheck/test/build/`demo:final` + honest remaining-gaps writeup | ⬜ Not started | Final verification pass, not begun. |

**Done so far: 2 of 13 rows** (spec authored; RenderRecipe schema drafted).
**Implementation steps 1–11: all Not started.**

---

## 2. Verified baseline (inherited from v1.2-final)

The v1.2-final product baseline is **green** as confirmed by the overfit
investigation (`docs/artifacts/render_overfit_findings/REPORT.md` §2, from
`artifacts/baseline_*.txt`). v1.3 inherits this baseline; no v1.3 code has been
added on top of it.

| Check | Verdict | Result |
|---|---|---|
| `npm run build` | ✅ Pass | exit=0 — all workspaces compile, web Vite build succeeds (`baseline_build.txt:30`). |
| `npm test` | ✅ Pass | shared **61 passed** (5 files incl. `editingMovBeatCutGolden`, `editingMovMovingMaterialGolden`, `marketingPosterCase`); api **8 passed / 1 skipped** (`baseline_test.txt:26-27,44-45,49`). |
| `npm run typecheck` | ✅ Pass | exit=0 — all four workspaces `--noEmit` clean (`baseline_typecheck.txt:29`). |
| git working tree | 🛈 | Only `M scripts/run-full-loop-editing-artifacts.mjs` is modified (+155/-1; `baseline_git_status.txt:1`, `baseline_git_diff_stat.txt:1-2`). The spec_v3 doc set is the only new untracked content. |

The 1 skipped api test is the Remotion bundle smoke (`RUN_REMOTION_BUNDLE_TEST`
unset; `apps/api/tests/remotion-bundle.test.ts:8-16`). This skip becomes a
material risk for v1.3 step 5 — see §5.

> **No product code was changed during the investigation** that produced this
> baseline. As of this snapshot, **no product code has been changed for v1.3
> either.** The build/test/typecheck numbers above describe v1.2-final, and v1.3
> must hold them green (re-baselining only the goldens it deliberately changes).

---

## 3. Final demo (locked) — current readiness

The submission demo is **locked** (see [`demo-playbook.md`](./demo-playbook.md)):

- **Product:** AeroSpin 便携涡轮小风扇 (portable turbo fan), 9:16, ~15s
  high-conversion product ad.
- **Sample:** `editing.mov` — **structure evidence only** (fast-cut rhythm,
  black/red/yellow typography, hero-motion motif, impact-flash grammar, BGM
  beat grid). No frame / audio / watermark copy (P1, P4).
- **Expected clip arc:** 0–2.5 hook `FanHeroSpin`; 2.5–5.5 setup
  `TypographyLayoutSequence`; 5.5–8.5 body `FeatureCardStack`; 8.5–11.5 proof
  `SourceClipBeatMontage` (or `DynamicProxyMontage` + `moving_material_missing`
  gap); 11.5–13 transition `ImpactFlash`; 13–15 cta `CTAEndSlate`.

Readiness as of 2026-05-31:

| Demo asset / path | Status | Notes |
|---|---|---|
| `editing.mov` sample (structure evidence) | ✅ Available | Already present in the v1.2 corpus / fixtures; used as evidence only. |
| `docs/fixtures/final_aerospin_fan/` target fixture | ⬜ Not started | Step 1. Not generated. |
| Optional real `--source` `test_videos/manual/fan_product_demo.mp4` | 🛈 Optional / absent | Repo has **no real fan footage**. If a real source is ever supplied, R2/R3 route its pixels to the montage; otherwise `DynamicProxyMontage` + `moving_material_missing` gap (R4). |
| `npm run demo:final` runner | ⬜ Not started | Step 8. |
| `docs/artifacts/final_submission/**` | ⬜ Not started | Step 10. |

### Material-decision blocker — RESOLVED (user-confirmed 2026-05-31)

The single open blocker that gated step 1 is **resolved**:

- The repo has **no real fan footage**.
- The user **rejected procedural SVG placeholders** ("all things real, no
  mock/fake").
- **Chosen path:** generate the fan target assets with the **real Gemini 2.5
  Flash Image provider (Nano Banana)**, provenance-labeled
  `materialRole=aigc_generated_material` (NOT user uploads, NOT a real product
  photo). Requires `GEMINI_API_KEY` + external-provider opt-in.
- AeroSpin is a **fictional brand**, so an AIGC logo is permitted (this does not
  violate the v1.2 "no fake logos for REAL brands" guarantee — see §6).

This decision unblocks step 1 conceptually, but step 1 is still **Not started**:
no AIGC asset has been generated and no manifest exists.

---

## 4. Gates and anti-overfit (planned, not implemented)

The v1.3 gate set (step 9) is **specified but not built**. For traceability, the
planned `mustPass` set is:

- final MP4 exists; 720×1280; duration 14.5–15.5s;
- `renderRecipe` exists; every clip carries a `primitiveReason`;
- ≥1 target material appears in the render;
- if a source exists, source-pixel usage > threshold, else
  `moving_material_missing` is present;
- `sampleFrameCopyAllowed=false`; `sampleAudioCopyAllowed=false`; watermark
  reproduced = false;
- product name visible; ≥4 selling points visible; CTA visible;
- the RemotionRecipeRenderer produced the main visual layer; FFmpeg muxed the
  final MP4.

**ANTI-OVERFIT gate (the reason v1.3 exists):** run demo A (`editing.mov` + fan
assets) and demo B (`motion_graph_1.mov` + the same fan assets). FAIL/WARN if,
across the two unrelated samples:

- layout NCC ≥ **0.85** (today's measured beat-cut↔beat-cut band is 0.87–1.00),
- or primitive-sequence similarity = **1.0**,
- or identical subtitles.

None of these gates are implemented; `scripts/evaluate-render-quality.mjs` has
no diversity check yet (`REPORT.md` §16 Q5).

---

## 5. Known risks before submission (from REPORT.md §14)

These are carried verbatim-in-spirit from the investigation risk matrix
(`docs/artifacts/render_overfit_findings/REPORT.md` §14) and are the items most
likely to bite a v1.3 implementation attempt.

| Risk | Severity | Area | Evidence |
|---|---|---|---|
| **Golden re-baseline risk.** Fixing material policy / swapping the renderer edits golden-pinned planner output and turns the green baseline **red**. The editing.mov goldens pin `role+primitive+family` sequences and per-clip thresholds. | high | decisions | `planner.ts:1210-1260, 3292-3300`; `baseline_test.txt` (editing goldens); `server.ts:2354` |
| **Remotion chromium dependency.** The only Remotion bundle test is **skipped by default** (`RUN_REMOTION_BUNDLE_TEST` unset). Whether the bundle actually renders in this environment is unverified; Remotion auto-downloads headless Chromium on first render, and replacement video assets get `file://` URLs Chromium may block. Step 5 (RemotionRecipeRenderer as the PRIMARY visual layer) depends on this path working. | high / medium | remotion | `apps/api/tests/remotion-bundle.test.ts:8-16`; `ReconstructionRoot.tsx:706`; `renderers.ts:91-96` |
| **Source-pixel path untested end-to-end.** The "source pixels appear on the canvas" branch (R2/R3) is real in the planner but has **never been exercised e2e**; `moving_material` gap logic also ignores `source_video_mapped` today. Demo A/B both rely on `DynamicProxyMontage` + gap unless a real `--source` is supplied. | medium | source_material | `renderers.ts:838-876`; `server.ts:887-892`; `planner.ts:2197-2214` |

Additional carried risks worth noting before step 3–6 begin:

- **Renderer mold / hardcoded subtitle copy** (high, diversity) —
  `planner.ts:3249-3285`; `renderers.ts:509-530, 894-962`. This is the defect
  v1.3 step 4 + step 5 must remove; the anti-overfit gate (§4) is its
  regression net.
- **`action_montage` composites NO source footage** (high, ffmpeg) —
  `renderers.ts:913-920, 654-656`. v1.3 makes this honest: real source pixels
  (R3) or `DynamicProxyMontage` + an explicit `moving_material_missing` gap (R4),
  never a faked montage.
- **Hero silhouette ignores `centerTrajectory`; fixed orbit/size** (high,
  evidence_unused) — `renderers.ts:571-576, 1014-1015`. `FanHeroSpin` /
  `ProductHeroOrbit` must consume the recipe's `motion.trajectory`, not a fixed
  sin/cos path.
- **v3 gates certify "consumption" that is existence/length only** (high) —
  `evaluate-render-quality.mjs:259,263`. v1.3 gates must test ACTUAL pixel
  consumption, not field presence.
- **Remotion silently degrades beat-cut clips to text cards; no parity gate**
  (high, remotion) — `ReconstructionRoot.tsx:706`. The RemotionRecipeRenderer
  components must render the selected primitive, and step 9 needs a parity gate.
- **HyperFrames manifest-only stub** (medium) — `renderers.ts:1357-1369`. Per
  P (renderer roles), HyperFrames stays optional and must write
  `SKIPPED_HYPERFRAMES.md` rather than be shown as a finished MP4 renderer.

### Risk posture

Per `REPORT.md` §15/§16, steps 3–6 are the **destabilizing** changes (Option C
territory) because they touch golden-pinned planner output and the
renderer-dispatch contract. The mitigations baked into the v1.3 plan are: keep
FFmpeg the primary final-mux renderer (Remotion is the recipe-driven visual
layer, but FFmpeg owns the MP4), nest the recipe under
`timeline.renderPlan.renderRecipe` (no `timeline.schema.json` change), and
re-baseline only the goldens v1.3 deliberately changes — with the anti-overfit
gate as the proof that the change removed the mold rather than re-skinned it.

---

## 6. Relation to spec_v2 (what still holds)

spec_v3 **supersedes** spec_v2 as the active spec for the final submission;
spec_v2 (v1.2-final) remains the broader product spec and stays valid for
everything v1.3 does not override. v1.3 does **not** contradict any spec_v2
FR/NFR safety guarantee:

- no mock / no-path outputs satisfy visual slots (R5);
- no fake brand logos for **real** brands (AeroSpin is fictional, so an AIGC
  logo is permitted; this is consistent with the v1.2 guarantee, which forbids
  fabricating a logo for a real brand);
- sample frames / audio are **never** sent to external providers and never
  copied to the canvas (`sourcePolicy.sampleFrameCopyAllowed`/
  `sampleAudioCopyAllowed` are `const:false` in the schema);
- external AIGC is **opt-in** and provenance-labeled on every generated asset
  (`materialRole=aigc_generated_material`).

The v1.2 audited status (revisions 1–9, build-stage map, schema-equivalence
decision, etc.) remains the record of the live product and is unchanged by this
file. See [`spec_v2/implementation-status.md`](../spec_v2/implementation-status.md).

---

## 7. Toolchain (confirmed)

Builds and scripts require Node v22 + the `viral` conda env; the system `node`
is a stale v12 and will break builds if used. Prefix `PATH` before any build or
script:

```bash
export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
node -v   # v22.20.0
```

- **node / npm:** nvm (`/home/pxli/.nvm/versions/node/v22.20.0/bin`), node
  v22.20.0.
- **FFmpeg / ffprobe:** 8.1.1, from the `viral` conda env.
- **Python:** 3.11 in the `viral` env, with `librosa`, `scenedetect`,
  `easyocr`, `faster_whisper`, `cv2` for the evidence pipeline.
- **AIGC provider (step 1 only):** Gemini 2.5 Flash Image (Nano Banana),
  gated behind `GEMINI_API_KEY` + external-provider opt-in.

---

## 8. Honest summary

As of **2026-05-31**, spec_v3 / Spec v1.3 consists of **documents and one schema
only**:

- ✅ spec_v3 doc set authored;
- ✅ [`render-recipe.schema.json`](./schemas/render-recipe.schema.json) drafted
  as the authoritative contract;
- ⬜ all 11 implementation steps **Not started**;
- ✅ v1.2-final baseline inherited green (shared 61 passed; api 8 passed / 1
  skipped; typecheck + build clean; only `M scripts/run-full-loop-editing-artifacts.mjs`
  dirty);
- ✅ material-decision blocker resolved (real Gemini AIGC fan assets,
  provenance-labeled);
- ⚠️ three known submission risks remain (golden re-baseline, Remotion chromium
  dependency, untested source-pixel path).

No part of the RenderRecipe engine is implemented. This file will be revised
(revision 1+) as steps 1–11 land, and every claim of "Done" must be backed by a
verification command result, exactly as the spec_v2 status file requires.
