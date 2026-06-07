# 06 — Gen1 Neutral Reconstruction Synthesizer

## 1. Purpose

Gen1 converts a sample video into a content-neutral, typed, executable representation.

It is not a “copy original video” generator.

It should learn:

- script/segment structure
- shot rhythm
- motion grammar
- typography and subtitle style
- title/CTA packaging
- transition style
- layout and palette
- visual asset patterns
- audio cue patterns
- required placeholders

## 2. Input

```ts
interface Gen1Input {
  sampleVideoRef: string;
  evidenceTimeline: EvidenceTimelineV5;
  contactSheetRef: string;
  videoInputPolicy: VideoInputPolicy;
  allowedComponentLibrary: string[];
  safetyPolicy: {
    sampleContentCopyAllowed: false;
    sampleAudioCopyAllowed: false;
    samplePixelsReusable: false;
  };
}
```

## 3. Output

```ts
NeutralReconstructionProgram
```

Must include:

- `typedSpec`
- `remotionProject`
- `placeholders`
- `timingMap`
- `learnedAssetRecipes`
- `learnedAudioRecipes`
- `reconstructionQuality`
- `safety`

## 4. Prompt rules

Gen1 prompt must say:

```text
You are not recreating the original content.
You are creating a neutral structural reconstruction.
Replace all sample-specific images, logos, people, products, subtitles, and audio with placeholders.
Every scene and major claim must cite evidence refs.
Output typed JSON and Remotion code.
```

## 5. Evidence grounding

Gen1 receives deterministic evidence with the original video.

Examples:

```text
shot_001: 0.00-1.20s
motion_peak: 0.80s
beat: 0.00, 0.48, 0.96s
ocr: title region at frame_032
asr: speech segment at 2.10-3.20s
```

Gen1 should cite these refs in `typedSpec.scenes[].evidenceRefs`.

## 6. Remotion project requirements

The Remotion project should:

- compile with allowed imports only
- accept props/fixture
- render a neutral preview
- use placeholder assets only
- not reference source sample path directly
- not reference sample audio
- not embed exact sample text unless marked as evidence and sanitized

## 7. Placeholder coverage

Sample-specific content must become placeholders:

| Sample content | Placeholder |
|---|---|
| product image | `placeholder.hero_product` |
| person/face/hero head | `placeholder.hero_head` |
| logo | `placeholder.logo` |
| original subtitle copy | `placeholder.subtitle_text` |
| background photo | `placeholder.background` |
| voiceover | `placeholder.voiceover` |
| SFX/music | `placeholder.audio_pattern` |

## 8. Learned recipes

Gen1 should output recipes when the sample contains valuable assets/audio patterns.

### Asset recipe

Should describe:

- subject
- shape/material
- lighting
- camera angle
- composition
- mood
- generation prompt template
- negative prompt
- placement hint

### Audio recipe

Should describe:

- BPM
- mood
- instruments
- energy curve
- cue points
- generation prompt template
- negative prompt

## 9. Validation

Gen1 output is invalid if:

- schema validation fails
- Remotion project cannot compile and cannot be repaired
- any renderable file references raw sample video/image/audio
- placeholders are missing for obvious sample-specific content
- timing map does not cover the video
- key scenes lack evidence refs

## 10. Fallback

If Gen1 fails:

```text
1. Try JSON repair.
2. Try code repair.
3. Re-ask with shorter prompt and fewer components.
4. Use deterministic neutral template from EvidenceTimeline.
```

Fallback neutral template should still create:

- basic segment structure
- placeholder slots
- rhythm pattern
- simple title/card/CTA layers
- audio cue placeholders
