# V5 Canonical Contracts — Reconciliation Record

> Authoritative source of truth for all V5 data contracts is now **code**:
> `packages/shared/src/contracts-v5/` (TypeScript types + ajv-2020 JSON Schemas + validators),
> exported from `@vvst/shared` under the `v5` namespace:
>
> ```ts
> import { v5 } from "@vvst/shared";
> const r = v5.validateNeutralReconstructionProgram(obj); // { valid, errors }
> type N = v5.NeutralReconstructionProgram;
> ```
>
> Validate the shipped examples: `npm run validate:schemas:v5`.

The spec_v5 doc set originally shipped three divergent representations of the same types
(`spec_v5/data-contracts.md`, `spec_v5/schemas/*.json`, and the single-file mirror
`spec_v5_program_kb_dual_codegen.md` / `SPEC_V5_ALL.md`). The 2026-06-04 feasibility audit
confirmed pervasive field/enum drift. This file records the canonical decision for each conflict.
**The v5 ARCHITECTURE is unchanged** — only naming/shape was canonicalized. Where a doc disagrees
with this record or with `contracts-v5/`, the code wins.

## Reconciliation decisions

| Type / field | Conflict | Canonical decision |
|---|---|---|
| **EvidenceTimelineV5** | data-contracts/schema (`assetId/video/shots/keyFrames/textEvidence/...`) vs single-file (`sampleId/meta/frameSheets/visualTracks/rhythm/audio/...`) | data-contracts/schema shape. V4 perception output is mapped INTO it by the `runEvidenceV5` wrapper. |
| **SourcePolicy** | `sample_evidence_only` (data-contracts) vs `sample_evidence` (single-file) | 5-value union: `sample_evidence_only \| user_owned_reusable \| generated_reusable \| licensed_reusable \| system_procedural`. Short forms are aliases. |
| **AssetRole** | enum drift between docs | `sample_video \| target_video \| target_image \| target_text \| generated_asset \| audio_asset`. |
| **NeutralReconstructionProgram** | single-file omits `evidenceTimelineId`; example used `sampleAssetId/evidencePackId/visualRecipes/audioRecipes` | Required keys: `id, sourceSampleId, evidenceTimelineId, typedSpec, remotionProject, placeholders, timingMap, safety`. Recipes are `learnedAssetRecipes` / `learnedAudioRecipes`. |
| **RenderProgramSpecV5.typedSpec** | example used flat `sections` + `layers`; data-contracts used `scenes` | `scenes[]` (layers nest inside each scene) + `globalStyle` + `audioCues`. Optional `rhythm`/`packaging`. |
| **AssetRecipe / AudioRecipe** | `promptTemplate` vs `generationPromptTemplate`; cue `timeSec` vs `t` | `generationPromptTemplate`; cue point time key is `t`. |
| **ReusablePolicy** | three different vocabularies across types | One union: `direct_reuse \| parametric_reuse \| regenerate_only \| procedural_recreate \| evidence_only` (data-contracts' `reusable` ≡ `direct_reuse`). |
| **KnowledgeElement.reusablePolicy** | nested under `safety` (data-contracts) vs top-level (single-file) | **Top-level** `reusablePolicy`. `safety` keeps the boolean flags + `renderable`. |
| **KbCurationDecision** | flat object (schema) vs discriminated union (single-file); judge tags/compatibility had no home | Flat object superset; added `assignedTags` + `assignedCompatibility` so the judge output fits (audit PVS-03). Actions include `store_variant` and `pending_review`. |
| **CompositionProgram.selectedElements** | example `{locked,reason}` vs contract `{priority}` | `{ elementId, appliedRole, priority }` required; `reason`/`locked` optional. |
| **CompositionProgram.slotPlan** | example object `{slots:[]}` vs contract `SlotPlan[]` | **Array** `SlotPlan[]`. |
| **GapReport** | named `GapReport` and `GapReportV5`; no schema existed | `GapReportV5` with `{ id, gaps[] }`; status adds `not_needed_after_replan`. |
| **RenderRecipeV5** | example missing `version`/`audioLayers`/`aspectRatio` | Required: `version: "render-recipe-v5"`, `composition` (with `aspectRatio`), `layers`, `audioLayers`, `assets`. |
| **Previously-undefined types** | `RemotionProject`, `VideoInputPolicy`, `TimingSegment`, `CandidateElement`, `GeneratedVisualAsset`, `GeneratedAudioAsset`, `AudioLayer`, `CompositionSection`, `SlotPlan`, `MaterialPlan`, `AudioPlan`, `StylePlan`, `CreativeBrief`, `TargetAssetProfile`, `SelectionSet`, `Provenance`, `Compatibility`, `PlacementHint` were referenced but never defined | All defined in `contracts-v5/common.ts`, `composition.ts`, `finalProgram.ts`. |

## Gate set (resolves the 20-vs-40 contradiction — audit AG-1 / XD-03)

Canonical = the **40-gate** set (`V5-G1..V5-G40`) from `acceptance-gates.md`, encoded in
`contracts-v5/gates.ts` as `V5_GATES` with a stable `id`, `category`
(`learn|kb|create|render|safety|ui`), `priority` (`P0|P1`), `name`, and `pass` condition.
The single-file mirror's 20-gate list (§4.16) is **superseded**. The scorecard example's `V5-G23`
("Final video exists") now resolves. "Demo-ready = all P0 gates pass/warn and no safety gate fails"
reads real priorities via `V5_P0_GATE_IDS`.

## Stage model (resolves 17-vs-14 — audit XD-01/XD-02)

Canonical = the **17-stage** `pipeline.md` enumeration (most granular). The 14-stage diagram in
`architecture.md` / single-file is the high-level view; stage NUMBERS in older diagrams are not
authoritative — refer to stage NAMES. Pipeline module names live under `apps/api/src/pipeline-v5/`.
