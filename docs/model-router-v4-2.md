# Model Router v4.2

## Why v4.2 exists

v4.2 is not about adding the most models. It is about routing the right model or deterministic tool to each task, recording why that choice was made, and keeping local FFmpeg + Remotion as the reliable render backbone.

Before v4.2, provider choice was split across `AI_PROVIDER`, `VLM_PROVIDER`, `ASR_PROVIDER`, `OCR_PROVIDER`, AIGC controls, and the older coarse `providerPolicy.ts`. That made failures hard to read: a task could fall back to a heuristic or disabled adapter without a single artifact explaining what happened.

## Terminology

| Term | Meaning |
|---|---|
| Sample media | Sample video frames/audio used only as structure evidence. |
| AIGC provider | Image, video, or audio generation provider. |
| VLM understanding provider | External multimodal analysis provider. It may consume sample media only if policy explicitly allows it. |
| Quality judge provider | Provider that evaluates outputs. It may consume output frames; sample-frame comparison is separately policy-gated. |
| Renderable material | Assets allowed to enter final video pixels/audio. |

## ModelTask list

The shared router defines tasks in `packages/shared/src/model-router/types.ts`:

- `video_structure_vlm`
- `text_planning_llm`
- `technique_atom_extraction`
- `json_schema_repair`
- `asset_understanding`
- `gap_reasoning`
- `transfer_planning`
- `natural_edit`
- `recipe_lint`
- `provider_prompt_compilation`
- `gap_repair_ranking`
- `structure_explanation`
- `version_strategy_planning`
- `video_critic`
- `technique_atom_kb_curator`
- `asr`
- `ocr`
- `visual_grounding`
- `audio_analysis`
- `image_fill`
- `video_fill`
- `voiceover`
- `sound_effect`
- `music`
- `audio_cleanup`
- `dubbing`
- `knowledge_retrieval`
- `quality_judge`

## Required vs optional

Core demo tasks must always have an offline path: structure planning, ASR/OCR warning fallbacks, visual/audio analysis, render planning, and deterministic quality gates. Cloud providers are optional; missing cloud keys must not break the core demo.

Seedance 2.0 is an optional `video_fill` provider, not the core renderer. ElevenLabs is an optional audio intelligence stack, not the main video model. PaddleOCR, GroundingDINO, SAM2, CoTracker, and BGE-M3 are candidates behind abstractions, not mandatory dependencies.

Phase 3 splits required status:

- `requiredForCoreDemo`: needed for the local demo path.
- `requiredWhenFeatureEnabled`: needed only when its `featureGate` is active.
- `featureGate`: one of `analysis`, `transfer`, `render`, `demo_report`, `natural_edit`, `multi_version`, `aigc_fill`, `quality_judge`, or `knowledge_retrieval`.

Examples: `structure_explanation` is gated by `demo_report`, `version_strategy_planning` by `multi_version`, `video_critic` by `quality_judge`, and `provider_prompt_compilation` by `aigc_fill`.

## Effect scopes

`ProviderDecision.effectScope` explains how a route can influence output:

| EffectScope | Meaning |
|---|---|
| `read_only_report` | Writes explanations/reports only. |
| `planning_affects_recipe` | Can change template, gap, fill, timeline, or recipe planning. |
| `generation_affects_assets` | Can create generated assets that may enter final media after provenance checks. |
| `rendering_affects_pixels` | Local renderer/procedural route affects pixels. |
| `audio_affects_final_mix` | Affects final audio mix. |
| `quality_gate_only` | Scores or blocks output but does not directly create media. |
| `no_effect` | Recorded disabled/no-op route. |

`canAffectFinalPixels` and `canAffectFinalAudio` are derived from this scope instead of broad hand labels.

## Safety policy

Default rules:

- Sample frames/audio are never allowed as AIGC generation references.
- External VLM sample-media analysis is a separate policy from AIGC generation.
- If external VLM is enabled, the route record must say sample media was uploaded for analysis only.
- Quality judges may inspect output frames. Sample frames for comparison require explicit `--allow-sample-media-external` or equivalent config.
- Raw prompts are never renderable.
- Generated assets require provenance metadata.

## Route records

Every `ProviderDecision` records:

- task
- selected provider
- provider class
- fallback usage and fallback reason
- rejected providers and reasons
- media access policy
- required-for-core flag
- required-when-feature-enabled flag and feature gate
- effect scope
- whether it can affect final pixels/audio
- local sample pixels/audio/video consumption
- external sample pixels/audio/video upload
- generated-asset provenance requirement

Reports distinguish:

- local sample evidence analysis: OCR/ASR/visual/audio analysis running on local files.
- external VLM sample analysis: optional analysis-only upload, disabled by default.
- AIGC generation references: sample media is blocked by default.
- renderable final material: target/user/generated/procedural assets only, never sample evidence unless explicitly authorized.

## Phase 3 integration status

Implemented deterministic/offline modules:

| Task | Module | Status |
|---|---|---|
| Recipe lint / repair checks | `packages/shared/src/engine/recipeLint.ts` | detects raw prompt render risk, missing media/text/audio/provenance, sample render risk, fallback issues. |
| Provider prompt compiler | `providerPromptCompiler.ts` | emits prompt plans/fallback configs only; no provider calls. |
| Gap repair ranker | `gapRepairRanker.ts` | ranks safe local/procedural fallbacks first when cloud providers are unavailable. |
| Structure explanation | `structureExplanation.ts` | Chinese judge-facing explanation from evidence, gaps, route decisions, and safety status. |
| Version strategy planner | `versionStrategyPlanner.ts` | deterministic high_click/high_conversion/high_quality diffs. |
| Natural edit patch | `naturalEditPatch.ts` | deterministic recipe patches for the five supported Chinese commands. |
| Offline video critic | `videoCritic.ts` | metadata/gate/recipe-only critic; no pixel semantic model. |
| TechniqueAtom retrieval | `techniqueAtomRetrieval.ts` | lexical retrieval/duplicate suggestions; no BGE-M3 dependency. |

Artifact integration:

- `GenerationResult` and `RenderRecipe` can carry `modelRouteSummary`, `providerDecisions`, `recipeLintReport`, `videoCriticReport`, and `structureExplanation`.
- `GapReportItem` / `FillAction` can carry ranked repair options, prompt plans, and provider decisions.
- `scripts/evaluate-final-gates.mjs` reads route/lint/critic records when present, and blocks rather than crashing on old artifacts.
- `scripts/evaluate-model-routes.mjs --attach-to-artifacts` writes route sidecars under learned sample artifact directories.

## Offline route eval

Run:

```bash
npm run build --workspace @vvst/shared
node scripts/evaluate-model-routes.mjs --offline --json
node scripts/evaluate-model-routes.mjs --offline --json --strict-policy
```

Outputs:

- `artifacts/model-routes/provider-decisions.json`
- `artifacts/model-routes/model-route-summary.md`

The evaluator does not call cloud APIs, download model weights, or require provider keys.

## Later cloud enablement

Later phases can request cloud providers by passing explicit router options and env vars. A cloud provider must not silently replace a local provider. It must either be selected with policy and availability recorded, or rejected with an explicit reason.
