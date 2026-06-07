# Provider Policy v4.1 (router updated to v4.2)

## v4.2 router status

Provider selection is now formalized by the typed ModelTask router in `packages/shared/src/model-router/` and explained in `docs/model-router-v4-2.md`.

Default safety stance:

- AIGC generation providers cannot receive sample frames/audio/video.
- Max-ability runs are API-first by default: configured Gemini/Ark/Seedream/ElevenLabs routes are attempted before local fallbacks.
- External VLM/ASR sample-media analysis is allowed in max-ability runs and must be recorded as analysis-only, not generation/reference material. Use `--no-cloud` / `--offline-providers` or `--no-external-vlm-sample-analysis` to force local-only analysis.
- Quality judge sample-frame comparison is separately policy-gated.
- Generated assets must carry provenance.
- `mock_provider` is retained as a deprecated alias for `deterministic_local_image_fill`.

Phase 3 status:

- Router decisions distinguish local sample evidence analysis from external sample upload.
- `ProviderDecision.effectScope` defines whether a route is read-only, planning-affecting, generation-affecting, rendering-affecting, audio-affecting, or quality-gate-only.
- Feature-gated tasks are no longer marked core-required unless their feature is enabled.
- Deterministic/offline tasks exist for recipe lint, prompt compilation, gap repair ranking, structure explanation, version strategy planning, natural edit patching, video critic, and TechniqueAtom retrieval.
- Real paid providers are attempted by max-ability scripts when the matching API keys/config are present; missing/failed providers must produce explicit fallback records.
- ElevenLabs live calls are enabled by max-ability scripts when `ELEVENLABS_API_KEY` is present. Outside that path, set `ENABLE_ELEVENLABS_LIVE_TESTS=1`, `ELEVENLABS_ENABLE_CLOUD=1`, or a task-specific `ELEVENLABS_ENABLE_*` flag.
- Fake placeholders are not valid provider output. If a real provider is unavailable, the artifact must say fallback/procedural/local, not pretend an external provider succeeded.

## 1. Provider safety principles

1. Sample video pixels are evidence only.
2. Sample frames/audio must not be sent to AIGC providers unless the user explicitly marks them as authorized reusable material.
3. Generated assets must carry provenance.
4. Every generated asset must be labeled as generated in `AssetProfile.provenance` and `RenderRecipe.sourcePolicy`.
5. The final render must remain possible without optional paid providers.

## 2. Provider policy type

```ts
type ProviderPolicy = {
  provider: string;
  category: "text" | "vlm" | "image" | "video" | "audio" | "asr" | "ocr";
  requiredForCoreDemo: boolean;
  enabledByDefault: boolean;
  fallbackStrategy: string;
  provenanceRequired: true;
  sampleFramesAllowedAsInput: false;
  sampleAudioAllowedAsInput: false;
  userAssetsAllowedAsInput: boolean;
  generatedAssetLabelRequired: true;
  maxCostUsdPerRun?: number;
  maxDurationSec?: number;
  riskLevel: "low" | "medium" | "high";
};
```

## 3. Default policies

### Seedance 2.0

Runtime status: implemented for Ark task-based video material generation through
`seedance_2_0`; default model is `doubao-seedance-2-0-fast-260128`. The adapter
uses text prompts for target material only and does not upload sample video/audio
as generation references.

```json
{
  "provider": "seedance_2_0",
  "category": "video",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "remotion_motion_graph_plus_ffmpeg_mux",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": true,
  "generatedAssetLabelRequired": true,
  "maxDurationSec": 6,
  "riskLevel": "high"
}
```

### Seedream (Volcengine)

Runtime status: implemented as image provider id `volcengine_seedream`. The actual
primary image-fill provider in code is `google_gemini_image` (default `gemini-3.1-flash-image`
= Nano Banana 2; alt `gemini-3-pro-image` / `imagen-4.0-generate-001` / `gemini-2.5-flash-image`),
with `volcengine_seedream` as the optional backup. There is **no** hardcoded default
image model: `resolveSeedreamProviderConfig` throws unless `SEEDREAM_ARK_MODEL` or
`AIGC_IMAGE_MODEL` is set (`aigcMaterialProviders.ts:238-239`).

```json
{
  "provider": "volcengine_seedream",
  "category": "image",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "remotion_generated_poster_card",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": true,
  "generatedAssetLabelRequired": true,
  "riskLevel": "medium"
}
```

### Audio providers

Implementation mapping:

- `google_gemini_tts` -> ModelTask `voiceover`, fallback `elevenlabs_tts`, then `skip_with_warning` / subtitles-only.
- `google_lyria_music` -> ModelTask `music`, fallback `elevenlabs_music`, then procedural BGM from `audioPlan.layers`.
- `elevenlabs_scribe` -> ModelTask `asr`, fallback `faster_whisper`, then `no_asr_with_warning`.
- `elevenlabs_tts` -> ModelTask `voiceover`, backup after Google TTS, fallback `skip_with_warning` / procedural audio.
- `elevenlabs_sound_effects` -> ModelTask `sound_effect`, fallback procedural SFX.
- `elevenlabs_music` -> ModelTask `music`, backup after Lyria, fallback procedural BGM from `audioPlan.layers`.
- `elevenlabs_audio_isolation` -> ModelTask `audio_cleanup`, allowed only for authorized user/source audio, never sample evidence.
- `elevenlabs_forced_alignment` -> ModelTask `forced_alignment`, allowed only for generated voiceover or authorized user/source audio.
- `elevenlabs_models` and `elevenlabs_voices_read` are read-only discovery providers.

Google/ElevenLabs generation routes keep `sampleFramesAllowedAsInput=false` and `sampleAudioAllowedAsInput=false`; generated voice/music/SFX assets require provenance. ElevenLabs Scribe may receive sample audio only when external sample analysis is explicitly enabled and recorded. Google TTS/Lyria do not receive sample audio in this repo.

The runtime opts Google audio in via `GOOGLE_AUDIO_ENABLE_CLOUD` or `ALLOW_CLOUD_PROVIDERS`
plus per-task `GOOGLE_AUDIO_ENABLE_MUSIC`/`GOOGLE_AUDIO_ENABLE_TTS`. ElevenLabs backup routes
remain gated by `ENABLE_ELEVENLABS_LIVE_TESTS`/`ELEVENLABS_ENABLE_CLOUD` plus per-task flags.

```json
{
  "provider": "google_lyria_music",
  "category": "audio",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "procedural_bgm_from_audio_layers",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": false,
  "generatedAssetLabelRequired": true,
  "riskLevel": "medium"
}
```

```json
{
  "provider": "elevenlabs_scribe",
  "category": "asr",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "local_faster_whisper",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": true,
  "generatedAssetLabelRequired": true,
  "riskLevel": "low"
}
```

## 4. Provenance fields

Every generated asset must include:

```ts
type GeneratedAssetProvenance = {
  source: "aigc_generated";
  provider: string;
  model?: string;
  promptHash: string;
  userPromptExcerpt?: string;
  generatedAt: string;
  sampleDerived: false;
  renderable: true;
  materialRole:
    | "aigc_video_fill"
    | "aigc_image_fill"
    | "aigc_voiceover"
    | "aigc_sound_effect"
    | "aigc_music";
};
```

## 5. Hard deny rules

The renderer and asset resolver must reject:

```text
- material.assetIds that point to sample frame paths
- AIGC requests that include sample frame/audio paths without explicit authorization
- generated assets without provenance
- raw prompts displayed in CTA or productTheme.name
- sample audio copied into final BGM
```

## 6. Local vs external sample access

| Access type | Allowed by default? | Notes |
|---|---|---|
| Local sample pixels | yes for OCR/visual grounding | Files stay local and are analysis-only. |
| Local sample audio | yes for ASR/audio analysis | Files stay local and are analysis-only. |
| External VLM sample upload | no | Requires explicit enablement and must be recorded as analysis-only. |
| AIGC sample reference | no | Sample frames/audio/video must not be sent to generation providers. |
| Renderable sample material | no | Only target/user/generated/procedural material may render unless explicit authorized reuse is set. |
