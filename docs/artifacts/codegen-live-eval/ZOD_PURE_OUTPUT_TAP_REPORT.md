# Zod + Pure Codegen Output Tap Report

- **Date:** 2026-06-02
- **Run:** `docs/artifacts/codegen-live-eval/zod-pure-output-r3` (real Gemini live HTTP, `gemini-2.5-pro`, 8 calls)
- **Env:** `GEMINI_TIMEOUT_MS=240000 CREATIVE_EFFECT_GEMINI=1 ALLOW_CLOUD_PROVIDERS=1 ALLOW_EXTERNAL_SAMPLE_MEDIA=1 MAX_CREATIVE_MODE=1`

## 1. Executive Summary

**Both goals work.**
1. **Zod-enabled generated schema validates.** With `zod` installed + a safe per-file contract, **3/4 cases** (`motion_graph_1`, `motion_graph_2`, `editing`) produced **real Gemini Remotion components** whose `schema.ts` uses `import { z } from "zod"`, passing the envelope + the file-aware static contract + the validator (`gemini_ok`, `pass_with_preview_blocker`, `safeToApply=true`). The 4th (`marketing`) put `import { z } from "zod"` **in `index.tsx`** → correctly **rejected** (`zod_import_outside_schema`) and fell back. The contract works as intended: zod is permitted **only** in `schema.ts`.
2. **Pure codegen output is captured before gates.** Each Gemini call's raw output is recorded in `pureGeminiOutput` (raw text + parsed proposal + envelope validation + contract violations) **before** any fallback/validation/selection, plus a report-only `PURE_CODEGEN_OUTPUT_EVAL_REPORT`. Pure report-only verdict: **2/4 PASS**.

**Gates were not disabled.** The strict gate (`evaluateCase`: motif + EffectRegistry selection + strict layer-count + semantic + `proposal_*`) is unchanged and still decides final eval (strict **0/4**, for layer-plan coverage gaps + marketing's misplaced zod — see §6). The pure-output eval is explicitly report-only (`pre_gate_only_not_final_success`), separate from the strict gate.

> Honest scope: the 3 validated Gemini components are **dry-run validated, not applied**. They were NOT promoted, registered to the KB, selected by RenderRecipe, or rendered. So the full apply→KB→RenderRecipe→render path is **not** claimed here (§8).

## 2. Files Changed

| File | Change | Risk |
|---|---|---|
| `packages/shared/src/effectCodegen/buildGeminiEffectPrompt.ts` | full ZOD-ENABLED GENERATED EFFECT CONTRACT (zod only in schema.ts; required `<C>PropsSchema`/`<C>Props`; fixture `proceduralFallback`+`assets:[]`; motif requirements) | low — prompt only |
| `packages/shared/src/effectCodegen/generateRemotionEffectProposal.ts` | file-aware import policy (`INDEX_ALLOWED_IMPORT` no zod / `SCHEMA_ALLOWED_IMPORT` zod ok); zod-subset denylist; `pureGeminiOutput` pre-gate capture; gemini_ok requires clean contract | medium — central codegen path; covered by tests |
| `scripts/validate-generated-effect.mjs` | file-aware allowlist; `zod_import_outside_schema`; `zodContractViolations`; `FIXTURE_REQUIRED` += `assets`,`proceduralFallback` | medium — gating logic; covered by 13 tests |
| `scripts/run-live-codegen-eval.mjs` | inline report-only `evaluatePureCodegenOutput` + `pure-codegen-output.{json,md}` + run-level `PURE_CODEGEN_OUTPUT_EVAL_REPORT.{json,md}`; **strict `evaluateCase` unchanged** | low — additive; gates intact |
| `apps/api/tests/effectValidator.test.ts`, `packages/shared/src/__tests__/effectCodegen.test.ts` | zod-contract tests (zod-in-schema passes; zod-in-index fails; `.refine` fails; fixture fallback) | low — tests |

> Implementation note: the zod contract + pure-output capture were applied directly to the codegen module + validator + harness (the simpler, inline form) rather than the spec's separate `codegenOutputTap.ts` / `evaluate-pure-codegen-output.mjs` / `00-09` directory. Pure pre-gate output is fully captured and evaluated in this simpler form.

## 3. Zod Dependency

| Workspace | package.json | lockfile | resolution |
|---|---|---|---|
| `@vvst/api` | unchanged | existing lock already carries `zod@3.22.3` via Remotion | ✅ resolves; Remotion bundle compiles generated `schema.ts` |
| root | — (hoisted transitive) | — | ✅ `require.resolve("zod")` → `node_modules/zod/lib/index.js` (validator scripts) |
| `@vvst/shared` | not added | — | shared code never imports zod (string-scan only) → no dep needed |

Verified: shared build ✓, api build ✓, all-workspace typecheck (= lint) ✓, full tests **49 passed + 1 skipped** (`effectValidator` 13).

## 4. Pure Codegen Output Artifacts

Per case under `zod-pure-output-r3/<case>/`:

| Case | layer raw | layer normalized | proposal raw | proposal files | pure-output capture |
|---|---|---|---|---|---|
| marketing | `gemini-layer-plan.raw.json` | `actual-codegen-layers.json` | `pureGeminiOutput.rawResponse` | `proposal/{index.tsx,schema.ts,fixture.json,README.md}` + `validation-report.json` | `pure-codegen-output.{json,md}` |
| motion_graph_1 | ✅ | ✅ | ✅ | ✅ | ✅ |
| motion_graph_2 | ✅ | ✅ | ✅ | ✅ | ✅ |
| editing | ✅ | ✅ | ✅ | ✅ | ✅ |

`pure-codegen-output.json` carries `layerPlan` (rawResponse + extractedText + parsedJson) and `remotionProposal.pureGeminiOutput` (status + rawResponse + parsedProposal + envelopeValidation + contractViolations) — the pure Gemini output **before** the fallback/selection that the strict path applies.

## 5. Pure Output Eval (report-only)

| Case | layer-plan | remotion proposal (pure) | main gaps |
|---|---|---|---|
| marketing | ok (motif poster_ribbon_marketing) | **FAIL** `parsed_contract_failed` | `import {z} from "zod"` in **index.tsx** → `zod_import_outside_schema` + `forbidden_external_import:zod` |
| motion_graph_1 | ok | **PASS** `parsed_contract_pass` (zod in schema.ts) | — |
| motion_graph_2 | ok | **PASS** `parsed_contract_pass` | — |
| editing | ok | code contract PASS, but **`pure_output_no_sample_literals` FAIL** | layer-plan JSON contains platform names `douyin`/`fenda` (source *description*, evidence-only) — see §8 |

Pure report-only: **2/4 PASS** (mg1, mg2). marketing fails on the (correct) zod-placement contract; editing fails on a sample-literal in the raw layer-plan that the code-only validator does not scan — **the tap's added sensitivity working**.

## 6. Existing Gates (NOT disabled, NOT bypassed)

| Case | validator status | EffectRegistry selection | final strict gate |
|---|---|---|---|
| marketing | `pass_with_preview_blocker` (validated the local fallback; Gemini proposal was `invalid_response`) | `built_in` → RibbonPosterSweep | **FAIL** (layer_count media/text/transition, proposal_live_generated, semantic_light_poster, semantic_ribbon_color_cycle) |
| motion_graph_1 | `pass_with_preview_blocker` (**real Gemini** component, `gemini_ok`) | `built_in` → CardOrbitStack | **FAIL** (layer_count media, transition) |
| motion_graph_2 | `pass_with_preview_blocker` (**real Gemini**, `gemini_ok`) | `built_in` → BlueUiSpotlight | **FAIL** (layer_count motion_atom) |
| editing | `pass_with_preview_blocker` (**real Gemini**, `gemini_ok`) | `built_in` → BeatCutKineticText | **FAIL** (layer_count motion_atom/audio, semantic_black_cards, semantic_red_yellow_white) |

**Statement:** No gate was disabled, skipped, or made easier. `selectEffect` runs with `preferGenerated:true, strictEffectCoverage:true`; the promotion gate (un-promoted generated never overrides built-in) is intact, so selection resolves to the motif-specific built-in for all 4. The strict `evaluateCase` is byte-for-byte the same logic; the pure-output eval is additive and report-only. Motif classification + effect selection: **4/4 correct**. Strict gate **0/4** is driven by layer-plan coverage minimums + semantic-token strictness + marketing's contract rejection — not by anything the pure-output tap changed.

## 7. Commands Run

| Command | Result | Notes |
|---|---|---|
| `npm run build --workspace @vvst/shared` | ✅ | clean |
| `npm run build --workspace @vvst/api` | ✅ | clean |
| `npm run typecheck` (= `npm run lint`) | ✅ | all 4 workspaces clean |
| `npm test` | ✅ 49 passed / 1 skipped | `effectValidator` 13, `effectCodegen` 15 |
| `node scripts/run-live-codegen-eval.mjs --run-id zod-pure-output-r3` (full env) | ✅ exit 0; 8 live calls | strict 0/4, pure 2/4 |

## 8. Remaining Risks (honest)

1. **Full generated-code path NOT proven.** The 3 validated Gemini components are dry-run only — not applied, promoted, KB-registered, RenderRecipe-selected, or rendered. End-to-end (apply→KB→RenderRecipe→Remotion/FFmpeg-fallback render) is unverified by this eval.
2. **Gemini layer-plan variance.** Temperature 0.1 still varies run-to-run (layer counts, motif evidence). Also a latent classifier risk: a Chinese poster with `bpm≥120` can misclassify to `beat_cut_chinese` (`HIGH_BPM=120` inclusive + tie-break) — did **not** trigger this run (marketing motif correct) but remains a real edge (fix: `HIGH_BPM`→~140).
3. **Generated TSX quality.** marketing put zod in `index.tsx` (contract reject); the prompt could be tightened to repeat "zod ONLY in schema.ts; never in index.tsx."
4. **Sample-literal in raw layer-plan (editing).** Gemini *described* the source as `douyin`/`fenda` in the layer-plan JSON (evidence-only, not copied into output code, which passed the validator). The pure-output tap correctly flags it; consider instructing the layer-plan prompt to avoid naming platforms even in descriptions.
5. **Remotion preview is environment-blocked.** `validationStatus` tops out at `pass_with_preview_blocker`; "does the component actually render" is not executed (recorded as env blocker, not faked).
6. **Pure-output eval is diagnostic, not a final pass/fail.** It must never gate releases; the strict gate + downstream render remain authoritative.
7. **Layer-plan coverage (Phase 7 not applied).** Strict layer-count/semantic minimums are still missed in places; the canonical-tags + per-motif layer-plan prompt (deferred to keep this change simple) would raise coverage but is not required for the zod/pure-output capability.
