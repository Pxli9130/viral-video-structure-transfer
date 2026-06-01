# Routing and Fallbacks v4.1

## 1. Router goals

The router should choose models by task, quality, cost, and availability. It must never block the core demo if an optional provider is missing.

## 2. Task routing table

| Task | Primary route | Fallback route | Local deterministic fallback |
|---|---|---|---|
| Structure VLM | Gemini 3.1 Pro | Qwen3-VL / Doubao multimodal | frame-sheet heuristics + OCR/CV evidence |
| JSON planning | Gemini 3.1 Pro / GPT-5 | Qwen3 / Doubao-Seed-2.0-lite | rule-based template compiler |
| ASR | faster-whisper | ElevenLabs Scribe | no transcript + OCR-only mode |
| OCR | PaddleOCR / EasyOCR | Qwen3-VL OCR | manual/empty typography with warning |
| Static image fill | Seedream 4.0 | GPT Image 2 / Nano Banana 2 | Remotion poster/card |
| Video fill | Seedance 2.0 | Veo 3.1 / Kling / Runway | Remotion motion atom layer |
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
  "task": "aigc_video_fill",
  "candidates": [
    {
      "provider": "seedance_2_0",
      "model": "seedance-2.0",
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
