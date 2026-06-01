# Provider Policy

## v4.2 router note

The canonical v4.2 provider routing docs live in `docs/model-router-v4-2.md` and the typed router lives under `packages/shared/src/model-router/`.

The local deterministic image provider id is now `deterministic_local_image_fill`. The old `mock_provider` id remains a deprecated compatibility alias. It is not fake output: it creates deterministic local generated material with provenance and makes no external calls.

Sample media defaults:

- AIGC generation providers may not receive sample frames, sample audio, or sample video by default.
- External VLM understanding is a separate route class. Sample media upload for analysis is blocked by default and must be explicitly enabled and recorded.
- Quality judges may inspect output frames; sample-frame upload for comparison is blocked unless explicitly enabled and recorded.
- Local evidence analysis is separate from external upload. Local OCR/ASR/visual/audio analysis may consume sample pixels/audio on disk and must be recorded as local sample analysis, not external provider access.

The repo must run without paid cloud APIs. Cloud providers are optional accelerators and require explicit environment configuration.

## Phase 3 Routing Integration

Route decisions are now expected on real artifacts, not only in the standalone evaluator:

| Artifact | Route fields |
|---|---|
| `GenerationResult` | `modelRouteSummary`, `providerDecisions`, `recipeLintReport`, `videoCriticReport`, `structureExplanation` |
| `RenderRecipe` | same route/lint/critic/explanation fields consumed by renderer reports |
| `GapReportItem` / `FillAction` | ranked repair options, prompt plans, provider decisions |
| final gate report | route summary rows, external sample upload count, fallback count, unsafe policy count, raw prompt/provenance status |

`EffectScope` replaces broad hand labels for model influence:

- `read_only_report`
- `planning_affects_recipe`
- `generation_affects_assets`
- `rendering_affects_pixels`
- `audio_affects_final_mix`
- `quality_gate_only`
- `no_effect`

Feature-gated tasks such as `structure_explanation`, `version_strategy_planning`, `video_critic`, `provider_prompt_compilation`, and `knowledge_retrieval` are not core-required unless their feature gate is enabled.

## Local Defaults

- Rendering: Remotion and FFmpeg.
- Procedural visuals: local recipe primitives and motion atoms.
- Audio: procedural FFmpeg/synth layers when no licensed or user audio is supplied.
- ASR/VLM/AIGC: disabled unless configured by environment and request controls.

## Optional Providers

| Provider | Purpose | Required | Env gate | Local fallback |
| --- | --- | --- | --- | --- |
| Seedance 2.0 | video generation | no | `SEEDANCE_API_KEY` / `SEEDANCE_ARK_API_KEY` | Remotion procedural motion |
| Seedream 4.0 | image generation | no | `SEEDREAM_ARK_API_KEY` / `AIGC_IMAGE_MODEL` | local packaging/procedural visuals |
| ElevenLabs Scribe | ASR | no | `ELEVENLABS_API_KEY` | local faster-whisper when installed |
| ElevenLabs TTS/SFX/Music | voice/audio | no | `ELEVENLABS_API_KEY` | FFmpeg procedural audio |

## Rules

- No sample frames or sample audio are sent to external providers by default.
- Generated assets must carry provenance metadata.
- A provider failure must produce an explicit fallback or blocked reason.
- Missing API keys are not an error for local demos; they are reported in provider matrix and gates.
