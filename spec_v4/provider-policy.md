# Provider Policy v4.1

## v4.2 router status

Provider selection is now formalized by the typed ModelTask router in `packages/shared/src/model-router/` and explained in `docs/model-router-v4-2.md`.

Default safety stance:

- AIGC generation providers cannot receive sample frames/audio/video.
- External VLM sample-media analysis is blocked by default and must be explicitly enabled and recorded as analysis-only, not generation/reference material.
- Quality judge sample-frame comparison is separately policy-gated.
- Generated assets must carry provenance.
- `mock_provider` is retained as a deprecated alias for `deterministic_local_image_fill`.

Phase 3 status:

- Router decisions distinguish local sample evidence analysis from external sample upload.
- `ProviderDecision.effectScope` defines whether a route is read-only, planning-affecting, generation-affecting, rendering-affecting, audio-affecting, or quality-gate-only.
- Feature-gated tasks are no longer marked core-required unless their feature is enabled.
- Deterministic/offline tasks exist for recipe lint, prompt compilation, gap repair ranking, structure explanation, version strategy planning, natural edit patching, video critic, and TechniqueAtom retrieval.
- Real paid providers remain disabled unless explicitly configured; Phase 3 still performs no Seedance/Seedream/ElevenLabs/Gemini/OpenAI/Runway/Kling calls.

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

### Seedream 4.0

```json
{
  "provider": "seedream_4_0",
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

### ElevenLabs audio providers

```json
{
  "provider": "elevenlabs_music",
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
