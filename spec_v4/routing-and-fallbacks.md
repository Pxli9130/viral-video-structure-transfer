# Routing and Fallbacks v4.1

> Note: This spec doc is versioned v4.1. The implemented route engine is the typed `model-router-v4.2` summary literal (`packages/shared/src/model-router/router.ts`); routing tables below reflect that engine.

## 1. Router goals

The router should choose models by task, quality, cost, and availability. It must never block the core demo if an optional provider is missing.

## 2. Task routing table

| Task | Primary route | Fallback route | Local deterministic fallback |
|---|---|---|---|
| Structure VLM | Gemini (default `gemini-3.5-flash`; alt `gemini-2.5-pro`) | Qwen3-VL / Doubao multimodal | frame-sheet heuristics + OCR/CV evidence |
| JSON planning / creative-effect codegen | Gemini (default `gemini-3.5-flash`) / GPT-5 | Qwen3 / Doubao-Seed-2.0-lite | rule-based template compiler / local_fallback effect |
| ASR | ElevenLabs Scribe (elevenlabs_scribe) | faster-whisper | no transcript + OCR-only mode (no_asr_with_warning) |
| OCR | PaddleOCR / EasyOCR | Qwen3-VL OCR | manual/empty typography with warning |
| Static image fill | google_gemini_image (default gemini-3.1-flash-image = Nano Banana 2; alt gemini-3-pro-image / imagen-4.0-generate-001 / gemini-2.5-flash-image) | volcengine_seedream (model from SEEDREAM_ARK_MODEL/AIGC_IMAGE_MODEL, no default) | deterministic_local_image_fill / Remotion shape card |
| Video fill | Seedance 2.0 (doubao-seedance-2-0-fast-260128) | remotion_procedural_motion (Veo/Kling/Runway are unimplemented candidates) | ffmpeg_proxy_motion |
| Voiceover | ElevenLabs TTS | provider-specific TTS | no voiceover + subtitle emphasis |
| Sound effects | ElevenLabs SFX | procedural SFX | FFmpeg generated hits/whooshes |
| Music | ElevenLabs Music | stock/user audio | procedural synth from AudioLayer |

## 3. Routing config

```ts
type ModelRoutingPolicy = {
  task: string;
  candidates: Array<{
    provider: string;
    model?: string;
    priority: number;
    enabled: boolean;
    maxCostUsd?: number;
    timeoutMs: number;
    fallbackOn: Array<"timeout" | "rate_limit" | "schema_error" | "empty_output" | "policy_block">;
  }>;
  deterministicFallback: {
    strategy: string;
    severity: "info" | "warn" | "fatal";
  };
};
```

## 4. Example route config

```json
{
  "task": "video_fill",
  "candidates": [
    {
      "provider": "seedance_2_0",
      "model": "doubao-seedance-2-0-fast-260128",
      "priority": 1,
      "enabled": false,
      "maxCostUsd": 2.0,
      "timeoutMs": 240000,
      "fallbackOn": ["timeout", "rate_limit", "policy_block"]
    },
    {
      "provider": "veo_3_1",
      "model": "veo-3.1",
      "priority": 2,
      "enabled": false,
      "maxCostUsd": 2.5,
      "timeoutMs": 240000,
      "fallbackOn": ["timeout", "rate_limit", "policy_block"]
    }
  ],
  "deterministicFallback": {
    "strategy": "render_motion_atom_with_remotion",
    "severity": "warn"
  }
}
```

> Note: `veo_3_1` is an aspirational candidate and is **not** present in `modelRegistry.ts`. The implemented `video_fill` route is `seedance_2_0` → `remotion_procedural_motion` → `ffmpeg_proxy_motion`.

## 5. Provider telemetry

All provider calls should log:

```ts
type ProviderCallTelemetry = {
  provider: string;
  model?: string;
  task: string;
  status: "success" | "failed" | "fallback_used" | "policy_blocked";
  latencyMs: number;
  estimatedCostUsd?: number;
  inputAssetIds: string[];
  outputAssetIds: string[];
  provenanceIds: string[];
  errorCode?: string;
};
```

## 6. Graceful degradation policy

If optional providers fail:

```text
Seedance unavailable -> Remotion motion-graph insert
Seedream unavailable -> Remotion generated poster/card
ElevenLabs Music unavailable -> procedural synth from audioPlan.layers
ElevenLabs TTS unavailable -> subtitles-only CTA
ElevenLabs Scribe unavailable -> faster-whisper
Gemini unavailable -> Qwen/Doubao or deterministic JSON compiler
```
