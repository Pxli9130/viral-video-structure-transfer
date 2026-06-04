# 12 — Provider Policy

## 1. Provider goals

Provider policy must:

- choose the best model for each stage
- prevent unsafe sample reuse
- provide local fallback
- record provenance and costs
- keep demo runnable even without premium media generation APIs

## 2. Provider classes

```ts
type ProviderClass =
  | "deterministic_local"
  | "vlm"
  | "llm_text"
  | "image_generation"
  | "audio_generation"
  | "tts"
  | "renderer";
```

## 3. Recommended providers by stage

| Stage | Primary | Fallback |
|---|---|---|
| Evidence | FFmpeg/OpenCV/librosa/OCR/ASR | reduced evidence without optional fields |
| Gen1 | Gemini VLM/codegen | simplified Gen1 prompt, deterministic neutral template |
| Element Extractor | light LLM | deterministic parser only |
| KB Curator Judge | light LLM + embeddings | hard rules only / pending review |
| Composition Planner | strong text/code LLM | deterministic planner |
| Material Fill | image model | text card / crop / layout card |
| Audio Fill | TTS/music/SFX model | FFmpeg procedural audio |
| Gen2 | strong code model | code repair, deterministic compose fallback |
| Render | Remotion + FFmpeg | FFmpeg recipe render fallback |

## 4. Sample media policy

By default:

```text
sample media can go to Gen1 as evidence input.
sample media cannot go to material/audio generators as reference for regeneration.
sample media cannot be referenced by Gen2 final code.
```

Allowed:

- sample video to VLM/Gen1 for understanding
- sample frames as evidence refs
- sample audio analyzed into beat/energy/cue pattern

Not allowed:

- sample image as image-generation reference for final asset
- sample audio as music-generation reference
- sample video path in final Remotion code
- sample logo/watermark in generated output

## 5. Provider decision record

Every model call must write:

```ts
interface ProviderDecision {
  stage: string;
  provider: string;
  model: string;
  inputArtifactRefs: string[];
  outputArtifactRefs: string[];
  promptVersion: string;
  safetyPolicy: Record<string, unknown>;
  fallbackUsed: boolean;
  fallbackReason?: string;
  costEstimate?: number;
  latencyMs?: number;
}
```

## 6. AIGC const-false clamp

If competition environment does not allow image/video/audio generation or keys are missing:

```text
materialFill = local
videoGeneration = off
audioFill = procedural
```

System must still produce final video using:

- target assets
- generated text cards
- procedural shapes
- Remotion graphics
- FFmpeg audio synthesis

## 7. Fail-closed safety

If a provider tries to produce or reference sample material in a reusable way:

```text
block output
mark as unsafe
fallback to regenerate-only description
```
