# 13 — Model Stack

## 1. Deterministic local stack

Required:

- FFmpeg / ffprobe
- OpenCV
- PySceneDetect or custom scene detection
- librosa or FFmpeg audio filters
- OCR engine
- ASR engine

Recommended:

- faster-whisper for local ASR fallback
- EasyOCR or PaddleOCR for OCR fallback
- imagehash for perceptual hash
- audio fingerprinting for no-copy gate

## 2. VLM stack

Used for:

- Gen1 Remotion template capsule reconstruction
- scene recipe enrichment
- target asset understanding when visual detail needed
- optional render quality judge

Input should include:

```text
original video
+ deterministic evidence
+ contact sheet
+ required output schema
```

## 3. Text/code LLM stack

Used for:

- element extraction
- KB curator judge
- composition planner
- Gen2 final codegen
- repair and fallback prompts
- same-template context rewrite
- natural-language revise to `TemplatePatchSet`

Current routing:

- `createTextModelFn` prefers Ark/Doubao when `ARK_API_KEY`/`ARK_MODEL` or `DOUBAO_*` are configured.
- If Ark/Doubao is not configured, it falls back to Gemini (`GEMINI_API_KEY`, `AI_GEMINI_MODEL`).
- Multimodal video/frame tasks stay on Gemini because the text model cannot inspect pixels.

## 4. Embedding stack

Used for:

- KB semantic search
- dedupe candidate vs existing elements
- auto recommendation

## 5. Image generation stack

Optional.

Used for:

- hero image regeneration
- product card/background generation
- cover image generation
- sticker/icon generation

Must use prompt recipes, not sample raw images.

Current providers:

- Google Gemini Image (`AIGC_IMAGE_PROVIDER=google_gemini_image`, default `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image`)
- Volcengine Seedream backup
- deterministic local image fill fallback

## 5.1 Video material generation stack

Optional.

Used for footage/video template slots that cannot be drawn by code.

Current providers:

- Seedance 2.0 text-to-video (`AIGC_VIDEO_PROVIDER=seedance_2_0`)
- DashScope happyhorse r2v backup (`AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v`)
- AIGC still / procedural fallback when video providers are unavailable

## 6. Audio generation stack

Optional.

Used for:

- music bed
- SFX
- risers
- voiceover

Fallback:

- FFmpeg `sine`
- FFmpeg `anoisesrc`
- generated clicks/hits
- procedural ducking/fades

Current cloud path:

- Google Lyria music (`GOOGLE_AUDIO_ENABLE_MUSIC=1`, `GOOGLE_MUSIC_MODEL=lyria-3-clip-preview`)
- Gemini TTS (`GOOGLE_AUDIO_ENABLE_TTS=1`)

## 7. Renderer stack

- Remotion for visual composition
- FFmpeg for mux/finalization
- local validators for video/audio quality
