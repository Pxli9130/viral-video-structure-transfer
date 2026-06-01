# Requirements — Spec v1.3

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

Version: **v1.3 — Source-first RenderRecipe Engine**

Purpose: define the focused, source-first, RenderRecipe-centered **final submission** spec. v1.3 is the active spec for the competition submission; it succeeds [spec_v2 (v1.2-final)](../spec_v2/requirements.md), which remains the broader product spec and stays valid for everything v1.3 does not override.

Companion documents:

- [Design — Spec v1.3](./design.md)
- [API — Spec v1.3](./api.md)
- [Tasks — Spec v1.3](./tasks.md)
- [Test Plan — Spec v1.3](./test-plan.md)
- [Demo Playbook — Spec v1.3](./demo-playbook.md)
- [RenderRecipe schema](./schemas/render-recipe.schema.json) — authoritative render contract

---

## 1. Why v1.3 exists (the overfit finding)

The overfit investigation ([`docs/artifacts/render_overfit_findings/REPORT.md`](../docs/artifacts/render_overfit_findings/REPORT.md)) proved that the current product, on the `videoType=beat_cut` path, renders a **sample-blind mold**. Every beat-cut input collapses to one identical 6-primitive sequence — `neon_hero_intro`, `beat_text_card`, `tutorial_rule_card`, `action_montage`, `impact_flash_stamp`, `motivation_cta` — with hardcoded subtitle copy and fixed FFmpeg geometry. Measured cross-brief render layout cross-correlation is **0.868–1.000** with **primitive-sequence similarity 1.00** for every beat-cut pair.

Root cause chain:

1. the material policy **nulls any sample-sourced `sourceAssetId`**, so no real pixels reach the canvas;
2. the beat-cut primitive is chosen from `clip.role` + `visualFormFamily` only, **not from visual evidence**;
3. the FFmpeg renderer is **fixed procedural geometry** keyed on the primitive string + bpm.

The net effect reads as a fixed-template generator. This directly damages the core scoring criterion: the official task rewards **transferring structure to NEW material**, not reproducing a mold. v1.3 is the corrective spec.

### 1.1 Core slogan (unchanged from v1.2)

```text
Learn the viral recipe, not the original content.
Use the recipe to reconstruct a new video from new material.
```

v1.3 hardens the second line into an enforceable contract: the **RenderRecipe**.

---

## 2. Product definition delta from v1.2

v1.3 keeps the v1.2 architecture (sample → evidence → induced slots → material matching → gap/fill → renderer capability → MP4 + previews) but adds three product-level constraints that override v1.2 where they conflict.

### 2.1 Source-first (P1)

The sample / reference video is **structure evidence ONLY by default**. Output material comes from: the **source video** (`source_video` asset ≠ sample asset, when `sourcePolicy=user_authorized`), **target images**, **target copy**, or **explicitly-accepted generated material**. Style-lock self-reconstruction (the sample reproducing itself) is **diagnostic only** and is never the main demo.

This sharpens v1.2 FR-007/FR-017: in v1.2 the sample-vs-output separation was a guarantee; in v1.3 the authorized non-sample source/target path is the **main demo**, not an under-exercised branch.

### 2.2 RenderRecipe as the single render contract (P2)

Every renderer consumes a **RenderRecipe**. The forbidden path is `role → primitive → hardcoded pixels`. The required path is:

```text
VisualEvidence + SlotMapping + MaterialPolicy + FillPlan
  → RenderRecipe
  → FFmpeg / Remotion / HyperFrames
```

The RenderRecipe is carried at `timeline.renderPlan.renderRecipe`. Because `renderPlan` is `additionalProperties:true`, this requires **zero change to `timeline.schema.json`**. The full contract is [`spec_v3/schemas/render-recipe.schema.json`](./schemas/render-recipe.schema.json); this document must not redefine it differently.

### 2.3 One guaranteed vertical (P3)

v1.3 guarantees ONE reliable vertical first: **B-end physical-product promo** — the **AeroSpin 便携涡轮小风扇 (portable turbo fan)**. v1.3 does **not** chase `beat_cut` + `motion_graph` + `vlog` + `short_drama` + `talking_head` simultaneously. `beat_cut` (`editing.mov`) is retained but only as a **STYLE SOURCE** feeding the recipe (fast-cut rhythm, black/red/yellow typography, hero-motion motif, impact-flash grammar, BGM beat grid) — never a fixed 6-clip mold (P4).

### 2.4 No video-generation model in the critical path (P5)

No Seedance/Veo or any text-to-video model is in the critical path. Renderers are **FFmpeg + Remotion + HyperFrames**. Optional AIGC is **image-only target material** (Gemini 2.5 Flash Image / Nano Banana), opt-in, provenance-labeled — consistent with v1.2 FR-020 and NFR-005.

### 2.5 Primary vertical statement

```text
B-end physical-product short promo (AeroSpin portable turbo fan), 9:16, ~15s
```

---

## 3. Personas

Inherited from [spec_v2 §2](../spec_v2/requirements.md) (P1 competition evaluator, P2 creator/marketer, P3 developer). v1.3 adds emphasis:

- **P1 evaluator** now judges *diversity*: the same engine fed two unrelated samples must not produce the same render. The anti-overfit gate (FR-V13-009) exists for this persona.
- **P3 developer** gains a single, schema-validated render contract (RenderRecipe) as the boundary between planning and rendering, replacing scattered renderer-internal inference.

---

## 4. New functional requirements (v1.3)

These FRs are additive to and, where stated, override the corresponding v1.2 FRs. Each uses WHEN/THEN acceptance criteria in the v1.2 house style.

### FR-V13-001 RenderRecipe is the sole render contract

The system SHALL compile a single **RenderRecipe** and SHALL make it the only input a renderer reads to decide pixels.

**Acceptance criteria**

- WHEN a reconstruction is planned THEN the system SHALL emit a RenderRecipe at `timeline.renderPlan.renderRecipe` that validates against [`render-recipe.schema.json`](./schemas/render-recipe.schema.json) with `schemaVersion="render-recipe-v1"`.
- WHEN the RenderRecipe is compiled THEN it SHALL be derived from `StructureTemplate + VisualElementGraph + SourceVideoUnderstanding + SlotMapping + GapReport + FillPlan + TargetMaterialManifest + ProductBrief`.
- WHEN any renderer (FFmpeg, Remotion, HyperFrames) runs THEN it SHALL read clip props from the RenderRecipe and SHALL NOT re-derive a primitive, geometry, copy, or palette from `clip.role`, hidden state, or hardcoded constants.
- WHEN `timeline.renderPlan.renderRecipe` is absent THEN the renderer SHALL raise a real error rather than fall back to fixed procedural geometry.
- The RenderRecipe SHALL set `videoType` to one of `product_mg | beat_cut_product | motion_graph | fallback_cards`, and SHALL carry `productTheme`, `sourcePolicy`, `global`, `clips[]`, and `warnings[]` per schema.
- THEN no change to `timeline.schema.json` is required (relies on `renderPlan.additionalProperties=true`).

### FR-V13-002 Evidence + material driven primitive selection (no role-only)

The system SHALL choose every clip's `selectedPrimitive` via `selectPrimitive(slot, evidence, material, capabilities)`, never from `clip.role` alone.

**Acceptance criteria**

- WHEN a clip is added to the RenderRecipe THEN `selectedPrimitive` SHALL be one of the schema enum (`SourceClipBeatMontage`, `ProductHeroOrbit`, `FanHeroSpin`, `FeatureCardStack`, `TypographyLayoutSequence`, `ImpactFlash`, `CTAEndSlate`, `DynamicProxyMontage`) AND SHALL carry a non-empty human-auditable `primitiveReason` citing the evidence + material + capability that drove it.
- WHEN `material.kind=source_video` with high-motion source shots ≥ 3 are mapped to the slot THEN selection SHALL be `SourceClipBeatMontage`.
- WHEN a product hero image/video exists and the clip role is `hook` THEN selection SHALL be `ProductHeroOrbit` or `FanHeroSpin`.
- WHEN the product `category` is a fan AND the prompt mentions fan/spin/wind THEN selection SHALL be `FanHeroSpin`.
- WHEN no moving source exists but a product image exists THEN selection SHALL be `DynamicProxyMontage` AND a `moving_material_missing` gap/warning SHALL remain.
- WHEN typography/OCR evidence with bbox/layout exists THEN selection SHALL be `TypographyLayoutSequence`.
- WHEN a target image set of ≥ 3 images exists THEN selection SHALL be `FeatureCardStack`.
- WHEN impact/onset evidence exists THEN selection SHALL be `ImpactFlash`.
- WHEN CTA copy exists THEN selection SHALL be `CTAEndSlate`.
- WHEN two unrelated samples are fed THEN the primitive sequence SHALL be permitted to differ; an identical primitive sequence across unrelated samples is a diversity failure (see FR-V13-009).

### FR-V13-003 Material policy (the five R-rules)

The system SHALL enforce the v1.3 material policy so that only renderable, real material reaches the canvas. This overrides the v1.2 behavior that nulled sample-sourced ids without admitting the authorized non-sample path.

**Acceptance criteria**

- **R1** — WHEN an asset id appears in `template.sourceSampleIds` THEN it SHALL NOT appear in render material UNLESS `sampleAssetReuse=authorized`; otherwise the clip material `policy` SHALL be `evidence_only`.
- **R2** — WHEN a `source_video` asset id ≠ any sample asset id has `sourcePolicy=user_authorized` THEN it SHALL be eligible render material (`material.kind=source_video`, `policy=renderable`). v1.3 makes this path the main demo.
- **R3** — WHEN the source video has matched shots for a montage slot THEN the renderer SHALL use source pixels (`sourceShotIds` populated, `kind=source_video`).
- **R4** — WHEN no source moving clip exists THEN `DynamicProxyMontage` is allowed BUT the `moving_material_missing` gap MUST remain in `warnings[]`/GapReport (no faking real footage).
- **R5** — WHEN target images are present THEN they MAY satisfy `media_cards / product_hero / feature_list / brand_cta` but SHALL NOT pretend to be `source_video_montage` unless animated as a procedural target asset; mock/no-path assets MUST NOT satisfy any visual slot.
- WHEN `sourcePolicy` is written THEN `sampleFrameCopyAllowed` SHALL be `false` and `sampleAudioCopyAllowed` SHALL be `false` (schema `const`).

### FR-V13-004 RemotionRecipeRenderer primary, FFmpeg mux, HyperFrames optional

The system SHALL render the main visual layer through Remotion components that consume RenderRecipe clip props only, mux/finalize through FFmpeg, and treat HyperFrames as an optional artifact.

**Acceptance criteria**

- WHEN `rendererTarget=remotion_recipe` THEN the Remotion components SHALL be the **primary** visual component renderer; each component SHALL consume `RenderRecipeClip` props only and SHALL NOT re-infer primitive/geometry/copy.
- THEN the Remotion component library SHALL include: `FanHeroSpin`, `ProductHeroOrbit`, `SourceClipBeatMontage`, `DynamicProxyMontage`, `TypographyLayoutSequence`, `FeatureCardStack`, `ImpactFlash`, `CTAEndSlate`, `BeatBars`.
- WHEN final assembly runs THEN **FFmpeg** SHALL perform source clip cut/crop/zoom, concat/mux, procedural BGM, preview-frame extraction, the final **720×1280** MP4, and the fallback card render.
- WHEN `rendererTarget=hyperframes_recipe` THEN HyperFrames SHALL produce a real `html` + `manifest` + `preview` artifact IF the HyperFrames CLI exists, OTHERWISE the system SHALL write `SKIPPED_HYPERFRAMES.md`; HyperFrames SHALL NEVER be presented in the UI as a completed MP4 renderer while it is only a JSON stub.
- WHEN the main demo renders THEN the RenderRecipe SHALL show that `RemotionRecipeRenderer` produced the main visual layer AND FFmpeg muxed the final MP4 (asserted by the gates, FR-V13-008).

### FR-V13-005 Final AeroSpin demo with real-AIGC target assets

The system SHALL ship a locked final demo for the AeroSpin portable turbo fan using real Gemini-generated target assets with provenance.

**Acceptance criteria**

- THEN the locked demo product SHALL be **AeroSpin 便携涡轮小风扇**, 9:16, ~15s high-conversion product ad, with the sample = `editing.mov` used as **structure evidence only** (no frame/audio/watermark copy).
- WHEN the demo runs THEN the target fan assets SHALL be loaded from `docs/fixtures/final_aerospin_fan/` (`fan_hero.png`, `fan_card_01..04.png`, `logo.png`, `copy.json`, `manifest.json`).
- THEN the fan target assets SHALL be generated by the **real Gemini 2.5 Flash Image provider (Nano Banana)**, provenance-labeled `materialRole=aigc_generated_material` (NOT user uploads, NOT a real product photo), and SHALL require `GEMINI_API_KEY` + external-provider opt-in to (re)generate.
- THEN because AeroSpin is a **fictional brand**, an AIGC-generated logo is permitted (this does not violate the v1.2/NFR no-fake-real-brand-logo guarantee).
- WHEN a real source video is supplied at `test_videos/manual/fan_product_demo.mp4` via `--source` THEN it SHALL feed the `SourceClipBeatMontage` proof slot; otherwise that slot SHALL fall back to `DynamicProxyMontage` + `moving_material_missing`.
- THEN the expected clip arc SHALL be: `0–2.5 hook FanHeroSpin`; `2.5–5.5 setup TypographyLayoutSequence`; `5.5–8.5 body FeatureCardStack`; `8.5–11.5 proof SourceClipBeatMontage (or DynamicProxyMontage + gap)`; `11.5–13 transition ImpactFlash`; `13–15 cta CTAEndSlate`.
- THEN procedural SVG placeholders for the fan SHALL NOT be used (user decision 2026-05-31: "all things real, no mock/fake").

### FR-V13-006 demo:final runner

The system SHALL provide a single runner that produces the full final submission end to end.

**Acceptance criteria**

- WHEN `npm run demo:final` is invoked THEN the runner SHALL execute the full source-first pipeline for the AeroSpin demo and write the final-submission artifacts (FR-V13-007).
- WHEN run with the editing.mov sample THEN it SHALL emit demo A; WHEN run with the `motion_graph_1.mov` sample + the same fan assets THEN it SHALL emit demo B (for the diversity evaluation).
- WHEN `--source <path>` is provided AND the file exists THEN the runner SHALL admit it as `user_authorized` source material; otherwise it SHALL proceed with target assets only and record the moving-material gap.
- THEN the runner SHALL be reproducible from a fresh clone given `GEMINI_API_KEY` and external-provider opt-in (fixtures may be reused when already generated).

### FR-V13-007 final_submission artifacts

The system SHALL write a complete, reviewable final-submission artifact set.

**Acceptance criteria**

- THEN artifacts SHALL live under `docs/artifacts/final_submission/` with subdirectories `demo_a_editing_fan/`, `demo_b_motion_graph_fan/`, and `diversity_eval/`.
- THEN each demo directory SHALL contain at least: the RenderRecipe JSON, the timeline JSON, the final 720×1280 MP4, per-clip preview frames, and a gate report.
- THEN `docs/artifacts/final_submission/diversity_eval/` SHALL contain the cross-sample layout NCC, primitive-sequence similarity, and subtitle-identity measurements (FR-V13-009).
- THEN `docs/artifacts/final_submission/FINAL_REPORT.md` and `docs/artifacts/final_submission/README.md` SHALL summarize what was produced, the gate results, and honest remaining gaps.
- THEN public artifacts SHALL avoid absolute private paths and secret patterns (NFR carried from v1.2 NFR-005; enforced by `scripts/check-artifact-hygiene.mjs`).

### FR-V13-008 v1.3 render gates

The system SHALL pass a v1.3 gate set asserting the source-first RenderRecipe contract was honored.

**Acceptance criteria**

- WHEN the demo render completes THEN the gates SHALL assert ALL of:
  - final MP4 exists;
  - resolution is **720×1280**;
  - duration is **14.5–15.5 s**;
  - `renderRecipe` exists and validates;
  - every clip has a non-empty `primitiveReason`;
  - **≥ 1 target material** appears in the render;
  - IF a source video exists THEN source-pixel usage > threshold ELSE `moving_material_missing` is present;
  - `sampleFrameCopyAllowed=false`;
  - `sampleAudioCopyAllowed=false`;
  - watermark reproduced = false;
  - product name visible;
  - **≥ 4 selling points** visible;
  - CTA visible;
  - `RemotionRecipeRenderer` produced the main visual layer;
  - FFmpeg muxed the final MP4.
- WHEN any gate fails THEN the runner SHALL report the failure explicitly and SHALL NOT emit a passing report.

### FR-V13-009 Anti-overfit diversity gate

The system SHALL prove it is not a fixed-template generator by rendering two unrelated samples with the same target assets and measuring divergence.

**Acceptance criteria**

- WHEN the diversity evaluation runs THEN it SHALL render **demo A** (`editing.mov` + fan assets) and **demo B** (`motion_graph_1.mov` + same fan assets).
- THEN the gate SHALL FAIL/WARN if ANY of:
  - layout **NCC across unrelated samples ≥ 0.85**;
  - **primitive-sequence similarity = 1.0** across unrelated samples;
  - **identical subtitles** across unrelated samples.
- THEN the measured values SHALL be written to `docs/artifacts/final_submission/diversity_eval/` for evaluator inspection.
- THEN this gate directly contradicts the overfit baseline (0.868–1.000 NCC, 1.00 primitive similarity) and SHALL be treated as the headline regression for v1.3.

### FR-V13-010 Final target fixture provenance

The system SHALL register the AeroSpin fan assets as generated target material with full provenance, never as user uploads or a real product photo.

**Acceptance criteria**

- WHEN fan assets are generated THEN each asset SHALL record provenance: provider, model, prompt, external-call status, and whether sample frames were sent (`sampleFramesSentExternally=false`).
- THEN usable generated assets SHALL be registered with `materialRole="aigc_generated_material"`.
- THEN `docs/fixtures/final_aerospin_fan/manifest.json` SHALL describe the asset set, roles, and provenance for reuse by `demo:final`.
- THEN sample frames from `editing.mov` SHALL NEVER be sent to the external image provider.

### FR-V13-011 Honest source-pixel usage and gap reporting

The system SHALL be honest about whether real footage reached the canvas.

**Acceptance criteria**

- WHEN a `SourceClipBeatMontage` clip renders with real source pixels THEN the RenderRecipe clip SHALL carry `material.kind=source_video`, populated `sourceShotIds`, and `policy=renderable`.
- WHEN a montage slot is filled by `DynamicProxyMontage` THEN the RenderRecipe `warnings[]` SHALL include `moving_material_missing` AND the clip SHALL NOT be labeled as real footage.
- THEN the gate SHALL measure source-pixel usage and SHALL NOT count procedural proxy frames as source footage.

---

## 5. Non-functional requirements (v1.3)

These extend [spec_v2 §5](../spec_v2/requirements.md) and do not contradict its safety guarantees.

### NFR-V13-001 Determinism caveats with real providers

- The planner, primitive selection, material policy, and recipe compilation SHALL be deterministic given the same evidence + material inputs.
- WHEN real providers are in the path (Gemini VLM video understanding, Gemini Image asset generation, ASR/OCR) THEN exact-pixel determinism is NOT guaranteed; tests and gates SHALL assert **structural invariants** (recipe shape, primitive selection rules, gate booleans, diversity thresholds) rather than byte-identical MP4s.
- Generated fan fixtures MAY be cached and reused so the demo is reproducible without re-calling the provider on every run.

### NFR-V13-002 Schema safety

- The RenderRecipe SHALL validate against [`render-recipe.schema.json`](./schemas/render-recipe.schema.json) before any renderer consumes it; an invalid recipe SHALL raise a real error, never a silent fallback.
- The Timeline SHALL continue to validate against the existing `timeline.schema.json`; v1.3 SHALL NOT modify `timeline.schema.json`.

### NFR-V13-003 Security and provenance

- API keys (`GEMINI_API_KEY`, etc.) SHALL be read from `.env`, never committed, never printed, and never placed in public artifacts or prompts/reports.
- Sample (`editing.mov`) frames and audio SHALL NEVER be sent to external providers and SHALL NEVER be copied into output.
- Generated assets SHALL carry provenance and `materialRole="aigc_generated_material"` and SHALL NOT be represented as user uploads or real product photos.
- External AIGC generation SHALL remain opt-in (consistent with v1.2 FR-020 / NFR-005).
- Public artifacts SHALL pass `scripts/check-artifact-hygiene.mjs` (no absolute private paths, no secret patterns).

### NFR-V13-004 No-fake guarantee

- Mock / no-path / placeholder assets SHALL NOT satisfy any visual slot.
- A failed renderer or provider SHALL raise a real error rather than emit a placeholder MP4.
- The system SHALL NOT fabricate real footage; a missing moving slot SHALL surface `moving_material_missing` rather than disguise a proxy as source pixels.
- A real brand's logo SHALL NOT be fabricated; the AIGC logo is permitted ONLY because AeroSpin is a fictional brand.
- The system SHALL NOT claim a video will go viral and SHALL NOT rely on platform performance data.

### NFR-V13-005 Toolchain

- Builds/scripts SHALL run under node v22 (nvm) + the `viral` conda env (ffmpeg/ffprobe 8.1.1, python 3.11 with librosa/scenedetect/easyocr/faster_whisper/cv2). The system `node` (stale v12) SHALL NOT be used; PATH SHALL be prefixed before any build/script.

### NFR-V13-006 Latency priority

- As in v1.2, generation speed is NOT the primary optimization target. Correct source-first structure transfer, an honest RenderRecipe, and diversity across samples are higher priority than throughput.

---

## 6. Relation to spec_v2

- v1.3 **supersedes** spec_v2 as the active spec for the final submission.
- spec_v2 (v1.2-final) remains the broader product spec and is still valid for everything v1.3 does not override.
- v1.3 is a focused, source-first, RenderRecipe-centered submission spec; it does NOT contradict spec_v2 FR/NFR safety guarantees: no mock outputs, no fake brand logos for REAL brands, sample frames never sent to external providers, AIGC opt-in, provenance on generated assets.
- Where v1.3 and v1.2 disagree (material policy admitting authorized non-sample source/target material; primitive selection forbidden from role alone; RenderRecipe as the single render contract; one guaranteed vertical), **v1.3 wins** for the final submission.

---

## 7. Out of scope for v1.3

- Simultaneous coverage of `beat_cut` + `motion_graph` + `vlog` + `short_drama` + `talking_head` as guaranteed verticals (v1.3 guarantees only the AeroSpin physical-product promo; `beat_cut` is a style source, `motion_graph` is used only for the diversity demo).
- Any video-generation model (Seedance / Veo / text-to-video) in the critical path.
- AIGC generation of **moving** material to fill the montage slot (a missing source clip stays a reported gap, not a generated video).
- HyperFrames as a presented MP4 renderer (it remains an optional HTML/manifest/preview artifact, or a `SKIPPED_HYPERFRAMES.md`).
- Procedural SVG placeholder fan assets (rejected by the user; real Gemini AIGC assets only).
- Fake logos for real brands (only the fictional AeroSpin logo is permitted).
- Multi-user collaboration, account systems, cloud deployment, editable-project export, and viral-performance prediction (all carried over as out of scope from v1.2).
- Unifying the `beat_cut` and `motion_graph` analyzers into a single evidence analyzer (carried as a known gap from v1.2; v1.3 only requires both to feed the same RenderRecipe contract for the diversity demo).
