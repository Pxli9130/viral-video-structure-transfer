# Source Alignment — Spec v1.3

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

Version: **v1.3 — Source-first RenderRecipe Engine**

This spec consolidates the v1.2-final product spec, a code-grounded overfit investigation, the official course material, and a dated user directive into one focused, source-first submission spec. It does not restart the product; it narrows and corrects the render path so the final demo transfers structure onto **new material** instead of reproducing a fixed mold.

> Spec v1.3 supersedes `spec_v2/` (v1.2-final) as the **active spec for the final submission**. `spec_v2/` remains the broader, still-valid product spec for everything v1.3 does not explicitly override (see §4). Where the two conflict, v1.3 wins for the submission build.

---

## 1. Source files reviewed

Each source is listed with how it was used in v1.3.

### 1.1 spec_v2 (v1.2-final) documents

1. `spec_v2/requirements.md`
   - Inherited FR/NFR baseline. v1.3 reuses the source-first material policy (FR-007, FR-017), the gap/fill model (FR-008, FR-009), evidence-driven induction (FR-016), renderer-capability selection (FR-018), and the optional-AIGC safety rules (FR-020, NFR-005). v1.3 narrows the primary-vertical statement and tightens the render contract.
2. `spec_v2/design.md`
   - Inherited the renderer-agnostic, adapter-based architecture, the deterministic-fallback principle, and the explainability-by-default principle. v1.3 inserts the `RenderRecipe` compiler between fill planning and rendering and reorders renderer roles.
3. `spec_v2/api.md`, `spec_v2/tasks.md`, `spec_v2/test-plan.md`, `spec_v2/demo-playbook.md`, `spec_v2/implementation-status.md`
   - Used for endpoint shapes, task decomposition style, gate vocabulary, and the demo-runner conventions that v1.3 reuses for `demo:final`.
4. `spec_v2/schemas/` (esp. `timeline.schema.json`, `structure-template.schema.json`, `target-material-manifest-v1`)
   - Confirmed that `timeline.renderPlan` is `additionalProperties:true`, so the v1.3 `RenderRecipe` can nest at `timeline.renderPlan.renderRecipe` with **zero change to `timeline.schema.json`**. Confirmed `materialRole="aigc_generated_material"` provenance is already a first-class concept.

### 1.2 Overfit investigation

5. `docs/artifacts/render_overfit_findings/REPORT.md` (+ `artifacts/similarity_probe/pairwise_similarity.{json,md}`)
   - The technical root-cause source for v1.3. It proved, against the live code and measured render output, that the current product is a **sample-blind mold** (see §2). It supplied the measured similarity band, the material-policy trace, the primitive-selection trace, the renderer-hardcoding trace, the evidence-consumption matrix, the Remotion/HyperFrames status, and the `RenderRecipe` feasibility analysis that v1.3 turns into a design.

### 1.3 Official course material (`assets/`)

6. `assets/工程训练营课题：爆款结构迁移引擎-从样例拆解、素材补全到视频重组的 AI 创作平台.pdf`
   - Primary source for the official task definition, the P0/P1 tasks, and the scoring rubric. v1.3 re-reads the rubric and reaffirms that the core scoring criterion rewards **transferring structure to NEW material**, which the mold directly damages.
7. `assets/AI全栈挑战赛课题讲解：爆款结构迁移引擎.txt`
   - Mentor explanation. Reconfirmed: no video-generation token in the critical path; Remotion / HyperFrames are acceptable framework components; knowledge-base-guided reconstruction is the goal; a local runnable demo is acceptable; latency is not a core metric.
8. `assets/会议纪要.txt` and `assets/智能纪要：AI全栈挑战赛课题讲解：爆款结构迁移引擎 2026年5月20日.pdf`
   - Meeting-summary cross-check: sample understanding → structure extraction → atomization → new-video generation, with explicit resource limitations. Used to validate that v1.3's scope reduction (single guaranteed vertical) is consistent with the stated constraints.
9. `assets/Viral Video Structure Transfer MVP.pdf`
   - Reviewed as a prior product write-up; consistent with the v1.2 baseline, not used as a new requirement source.

### 1.4 User directive

10. **User directive of 2026-05-31** (final-demo decisions, recorded in §3 as D-V13-4 and D-V13-5)
    - The locked final product (AeroSpin portable turbo fan, 9:16, ~15s), the locked sample-as-evidence-only rule, and the **material decision** (real Gemini 2.5 Flash Image AIGC target assets, provenance-labeled, because the repo has no real fan footage and the user rejected procedural placeholders). This directive is the authority for the LOCKED final-demo section of the sibling specs.

---

## 2. Why v1.3 exists (the problem statement)

The overfit investigation proved, with no product code changed and a green baseline, that the current product **renders a sample-blind mold**:

- Every input classified `videoType="beat_cut"` collapses to one identical 6-primitive sequence — `neon_hero_intro, beat_text_card, tutorial_rule_card, action_montage, impact_flash_stamp, motivation_cta` — with the same hardcoded subtitle copy and the same fixed FFmpeg `lavfi`/`drawbox` geometry; non-beat-cut inputs collapse to a second static-card mold.
- Measured cross-brief render layout cross-correlation is **0.868–1.000** with **primitive-sequence similarity 1.00 for every beat-cut pair** (`artifacts/similarity_probe/pairwise_similarity.json`), while only `bpm` plus a hero palette/positionClass actually vary with the sample.

The root cause is a three-link chain:

1. **Material policy nulls real pixels.** Any sample-sourced `sourceAssetId` is dropped (`planner.ts:3292-3300`), and the editing.mov demo conflates mock + `sourceSampleIds` + demo-derived, so no real pixels ever reach the canvas.
2. **Primitive chosen from role alone.** The beat-cut primitive is selected from `clip.role` + `clip.visualFormFamily` only (`planner.ts:2952-2962`), not from visual evidence; evidence merely adjusts cosmetics inside an already-chosen primitive.
3. **Renderer is fixed procedural geometry.** The FFmpeg renderer dispatches on the `motionPrimitive` string + `bpm` with hardcoded geometry (`renderers.ts:894-962`); `action_montage` composites **zero** source pixels.

This reads as a fixed-template generator. It directly damages the official task's core scoring criterion, which rewards transferring structure onto new material rather than reproducing a mold. v1.3 is the source-first, RenderRecipe-centered correction.

---

## 3. Major decisions

Each decision is tagged `D-V13-n` and records what v1.3 keeps from v1.2 and what it overrides.

### D-V13-1 — Source-first is the main judging path

**Decision.** The sample/reference video is **structure evidence only by default**. Output material comes from the **source video / target images / target copy / explicitly-accepted generated material**. Style-locked self-reconstruction (rebuilding the sample from itself) is a **diagnostic** path only, NOT the main demo.

- **Keeps from v1.2.** FR-007 and FR-017 already separate reference structure evidence from output material; NFR-005 already forbids sample-frame copy and mock satisfaction of visual slots.
- **Overrides from v1.2.** v1.2's de-facto demo path was style-lock self-reconstruction (the full-loop runner set `sourceVideo.assetId = sourceAssetId ?? sampleAssetId`, collapsing to the sample). v1.3 promotes the distinct-source / target-material path to the primary path and demotes style-lock to diagnostics. This is principle **P1**.

### D-V13-2 — RenderRecipe is the sole render contract, nested under renderPlan

**Decision.** Every renderer consumes a `RenderRecipe`. The forbidden pattern is `role → primitive → hardcoded pixels`. The required pipeline is `VisualEvidence + SlotMapping + MaterialPolicy + FillPlan → RenderRecipe → FFmpeg / Remotion / HyperFrames`. The recipe is carried at `timeline.renderPlan.renderRecipe`; its authoritative contract is [`schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json).

- **Keeps from v1.2.** The renderer-agnostic principle (Timeline JSON is the contract) and the `additionalProperties:true` `renderPlan` shape; **no change to `timeline.schema.json`**.
- **Overrides from v1.2.** v1.2 had no recipe; both renderers consumed the raw `Timeline` and re-derived pixels. v1.3 makes the recipe the single, schema-validated, gate-visible source of truth for primitive + capability + material + audio decisions. This is principle **P2**.

### D-V13-3 — Primitive selection must be evidence + material driven

**Decision.** Primitives are chosen by `selectPrimitive(slot, evidence, material, capabilities)`, never from `clip.role` alone. Every clip carries a human-auditable `primitiveReason`. The selection rules are: source_video_mapped with ≥3 high-motion source shots → `SourceClipBeatMontage`; product hero image/video + hook → `ProductHeroOrbit` / `FanHeroSpin`; fan category + fan/spin/wind prompt → `FanHeroSpin`; no moving source + product image → `DynamicProxyMontage` plus a `moving_material_missing` gap; typography/OCR evidence with bbox/layout → `TypographyLayoutSequence`; target image set ≥3 → `FeatureCardStack`; impact/onset evidence → `ImpactFlash`; CTA copy → `CTAEndSlate`.

- **Keeps from v1.2.** FR-016 (evidence-driven induction) and FR-018 (renderer-capability selection by family + fill strategy).
- **Overrides from v1.2.** v1.2's beat-cut selection ignored typography/VEG/OCR/asset signals. v1.3 wires them into the actual primitive choice and requires the recorded `primitiveReason`. This is the §6.2 anti-overfit guarantee in the requirements.

### D-V13-4 — Single guaranteed vertical: AeroSpin portable turbo fan

**Decision.** v1.3 guarantees **one** reliable vertical end-to-end: B-end physical-product promo for the **AeroSpin 便携涡轮小风扇** (fictional brand), 9:16, ~15s, high-conversion product ad. It does NOT chase beat_cut + motion_graph + vlog + short_drama + talking_head simultaneously. `beat_cut` (editing.mov) is kept but **only as a STYLE SOURCE** feeding the recipe (fast-cut rhythm, black/red/yellow typography, hero-motion motif, impact-flash grammar, BGM beat grid) — never a fixed 6-clip mold. Expected clip arc: 0–2.5 hook `FanHeroSpin`; 2.5–5.5 setup `TypographyLayoutSequence`; 5.5–8.5 body `FeatureCardStack`; 8.5–11.5 proof `SourceClipBeatMontage` (or `DynamicProxyMontage` + gap); 11.5–13 transition `ImpactFlash`; 13–15 cta `CTAEndSlate`.

- **Keeps from v1.2.** The B-end marketing primary vertical (FR-001 default vertical, requirements §1.2) and the architecture's extensibility to other verticals.
- **Overrides from v1.2.** v1.2 kept several verticals demo-eligible at once. v1.3 narrows the **submission guarantee** to one vertical to produce a stronger, non-overfit demo. The course meeting summary's stated resource limitations support this reduction. This is principles **P3** and **P4**.

### D-V13-5 — Material decision: real Gemini AIGC target assets (provenance-labeled)

**Decision.** The repo has **no real fan footage**, and the user **rejected procedural SVG placeholders** ("all things real, no mock/fake"). The chosen path is to **generate the fan target assets with the real Gemini 2.5 Flash Image provider (Nano Banana)**, provenance-labeled `materialRole="aigc_generated_material"` (NOT user uploads, NOT a real product photo). This requires `GEMINI_API_KEY` plus external-provider opt-in. AeroSpin is a fictional brand, so an AIGC logo is permitted. The target fixture lives at `docs/fixtures/final_aerospin_fan/` (`fan_hero.png`, `fan_card_01..04.png`, `logo.png`, `copy.json`, `manifest.json`). An optional real `--source` video (`test_videos/manual/fan_product_demo.mp4`) may be supplied if a real one ever exists.

- **Rationale (recorded explicitly).** A real AIGC provider output is **"real provider material," not a "fake output"**: it has a verifiable provider/model/prompt provenance trail and is honestly labeled as generated, which is materially different from a mock adapter or a procedural placeholder pretending to be a photo.
- **Keeps from v1.2.** FR-020 and NFR-005 in full: AIGC is opt-in, external provider requires explicit opt-in, sample frames are never sent to external providers, generated assets carry provenance and are NOT represented as user uploads, and no fake logo is created for a **real** brand.
- **Overrides from v1.2.** v1.2 treated AIGC as an optional gap-fill side path and treated procedural proxies as acceptable demo material. v1.3 makes AIGC-generated, provenance-labeled fan assets the **primary target material** for the locked final demo (because no real footage exists and placeholders were rejected), while keeping every v1.2 safety rule. This is principle **P5**'s boundary: no video-generation model in the critical path — image AIGC for target stills is permitted; Seedance/Veo are not.

### D-V13-6 — Renderer roles: Remotion primary, FFmpeg mux, HyperFrames optional

**Decision.** **Remotion** (`rendererTarget=remotion_recipe`) is the **primary visual component renderer**; its components consume `RenderRecipeClip` props only and never re-infer (FanHeroSpin, ProductHeroOrbit, SourceClipBeatMontage, DynamicProxyMontage, TypographyLayoutSequence, FeatureCardStack, ImpactFlash, CTAEndSlate, BeatBars). **FFmpeg** does source-clip cut/crop/zoom, concat/mux, procedural BGM, preview-frame extraction, the final 720×1280 MP4, and fallback card render. **HyperFrames** is an optional MG/HTML preview artifact (real html + manifest + preview if the CLI exists, else `SKIPPED_HYPERFRAMES.md`); it is NEVER presented in the UI as a completed MP4 renderer while it is only a JSON stub.

- **Keeps from v1.2.** The three renderers as adapters and Timeline/recipe as the renderer-agnostic contract.
- **Overrides from v1.2.** v1.2's de-facto product renderer was FFmpeg, Remotion was a secondary ribbon/poster renderer that ignored `motionPrimitive`, and HyperFrames was an unlabeled JSON stub surfaced as a UI option. v1.3 makes Remotion the primary visual layer driven by the recipe, formalizes FFmpeg as the mux/source/fallback layer, and gates HyperFrames behind honest "SKIPPED" labeling. This is principle **P2** plus the RENDERER ROLES rules.

### D-V13-7 — Anti-overfit gate is mandatory

**Decision.** The submission must run **demo A** (editing.mov + fan assets) and **demo B** (motion_graph_1.mov + the **same** fan assets) and FAIL/WARN if, across unrelated samples, layout NCC ≥ 0.85, OR primitive-sequence similarity = 1.0, OR subtitles are identical. This directly measures the mold the investigation found.

- **Keeps from v1.2.** The gate-driven, artifact-driven review discipline (FR-019 motion-graph gates, render-quality gates).
- **Overrides from v1.2.** v1.2 had no cross-sample diversity gate; the investigation's recommendation #5 (advisory `layout_ncc_mean`, require `primitive_seq_similarity < 1.0` across distinct briefs) is promoted in v1.3 to a mandatory submission gate with the diversity-eval artifact directory.

---

## 4. What v1.3 keeps from v1.2 vs overrides (summary)

| Area | v1.2 (still valid) | v1.3 change |
|---|---|---|
| Material policy: sample = evidence only | FR-007 / FR-017 / NFR-005 | **Kept.** Plus R1–R5 made the main demo: a `user_authorized` non-sample source/target MUST reach the canvas (fixes the nulled-pixel root cause). |
| Render contract | Timeline JSON is the contract | **Extended.** `RenderRecipe` nested at `timeline.renderPlan.renderRecipe` is now the sole render contract; renderers read the recipe, never re-derive primitives. |
| Primitive selection | role/family heuristics | **Overridden.** `selectPrimitive(slot, evidence, material, capabilities)` with mandatory `primitiveReason`. |
| Primary vertical | B-end marketing, multiple verticals demo-eligible | **Narrowed.** One guaranteed vertical (AeroSpin fan); beat_cut kept only as a style source. |
| Material for the demo | procedural proxies / optional AIGC gap-fill | **Overridden for the demo.** Real Gemini AIGC fan assets are the primary target material, provenance-labeled; all v1.2 AIGC safety rules kept. |
| Renderer roles | FFmpeg de-facto primary, Remotion secondary, HyperFrames stub | **Reordered.** Remotion primary visual layer, FFmpeg mux/source/fallback, HyperFrames optional + honestly labeled. |
| Diversity | none | **Added.** Mandatory anti-overfit gate (layout NCC, primitive-sequence, subtitle identity across unrelated samples). |
| Safety guarantees | NFR-005 (no mock outputs, no fake real-brand logo, no sample frames to external providers, AIGC opt-in, provenance) | **Kept in full.** v1.3 does NOT relax any of these. |

---

## 5. Sibling spec_v3 documents

This document aligns sources and records decisions. The decisions are turned into requirements, design, and verification in the sibling files:

- [`requirements.md`](./requirements.md) — Spec v1.3 functional/non-functional requirements (P1–P5, R1–R5, gates).
- [`design.md`](./design.md) — Spec v1.3 system design (RenderRecipe compiler, `selectPrimitive`, renderer roles).
- [`schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json) — the authoritative `RenderRecipe` contract.

> For any product concern v1.3 does not cover (knowledge base, full API surface, broader verticals, the general AIGC gap-fill flow), `spec_v2/` remains authoritative.
