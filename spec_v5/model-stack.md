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

- Gen1 neutral reconstruction
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

## 7. Renderer stack

- Remotion for visual composition
- FFmpeg for mux/finalization
- local validators for video/audio quality
