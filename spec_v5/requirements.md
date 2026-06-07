# 01 — Requirements

## 1. Product requirements

### R1. Sample learning

The system must support uploading one or more sample videos and learning reusable creative elements from them.

Must support:

- `.mov` and `.mp4` input.
- sample metadata extraction.
- deterministic video/audio evidence extraction.
- VLM-assisted neutral reconstruction.
- extracted candidate elements.
- KB storage with dedupe and provenance.

### R2. Target creation

The system must support generating a new video from:

- user brief or product theme
- target assets: images, videos, text, product info
- selected or auto-recommended KB elements
- optional generated missing assets
- optional generated audio

### R3. Multi-video recomposition

The system must support selecting elements learned from multiple different sample videos and composing them into one coherent new video.

Example:

```text
hook from sample A
subtitle layout from sample B
transition from sample C
CTA from sample D
audio cue pattern from sample E
```

### R4. No-copy policy

The system must not directly copy sample pixels, sample audio, sample logo, watermark, or original sample text into final generated videos unless the user explicitly owns and marks the sample as reusable material.

Default policy:

```text
sampleContentCopyAllowed = false
sampleAudioCopyAllowed = false
samplePixelsReusable = false
```

### R5. Gap handling

The system must detect missing or weak target assets for required slots and choose a fill strategy:

- structure rearrangement
- text/subtitle replacement
- packaging card
- target asset crop/reuse
- generated image/background/card
- generated voiceover/SFX/music
- explicit warning and graceful fallback

### R6. Display and explain

The UI must display:

- sample analysis
- neutral reconstruction
- extracted elements
- KB storage decisions
- user-selected elements
- target asset analysis
- slot mapping and gap report
- composition timeline
- material/audio fill decisions
- final render
- scorecard and gates

## 2. Functional requirements by pipeline

### Learn pipeline

| ID | Requirement |
|---|---|
| L1 | Ingest sample video and create Asset record. |
| L2 | Run deterministic evidence extraction. |
| L3 | Send original video + evidence to Gen1. |
| L4 | Gen1 outputs NeutralReconstructionProgram. |
| L5 | Validate Gen1 output and fallback if invalid. |
| L6 | Extract candidate elements from typed spec, recipes, timing map, placeholders. |
| L7 | Curate elements with hard rules + ML judge. |
| L8 | Store accepted elements in KB with provenance and safety flags. |

### Create pipeline

| ID | Requirement |
|---|---|
| C1 | Analyze target assets. |
| C2 | Let user select KB elements or auto-recommend elements. |
| C3 | Generate CompositionProgram JSON. |
| C4 | Match required slots to target/generated assets. |
| C5 | Generate missing visual/audio materials if enabled. |
| C6 | Run Gen2 to generate final Remotion project and RenderRecipe. |
| C7 | Validate final code, schema, no-copy policy, and render quality. |
| C8 | Render final video with Remotion + FFmpeg. |
| C9 | Produce scorecard and UI artifacts. |

## 3. Non-functional requirements

### Reliability

- Every AI stage must have schema validation.
- Every critical AI stage must have fallback.
- Gen1 invalid output must fall back to neutral template generation.
- Gen2 invalid output must fall back to deterministic compose recipe.

### Observability

Every stage must write an artifact:

```text
evidence.json
neutral-reconstruction-program.json
candidate-elements.json
kb-curation-decisions.json
composition-program.json
gap-report.json
final-video-program.json
render-recipe.json
scorecard.json
```

### Reproducibility

Every generation must store:

- model name
- prompt version
- input artifact ids
- selected KB element ids
- provider decision
- fallback reason
- random seed when applicable

### Performance

Default short-video strategy:

```text
whole video global pass
fps 2-5 for visual understanding
scene-aware detail pass only when needed
```

No default 8-second chunking unless the video is long or fast-motion detail pass is required.

### Local fallback

At minimum, the system should run without premium image/audio/video generation APIs:

- target asset reuse/crop
- text cards
- procedural Remotion graphics
- procedural FFmpeg audio bed/SFX
- deterministic RenderRecipe fallback

## 4. Rubric alignment

V5 explicitly supports:

- sample input and basic analysis
- structure decomposition
- structure transfer generation
- material gap detection
- material gap filling
- transfer process visualization
- final result verification
- packaging generation
- multi-version generation
- real material adaptation
- human adjustment
- natural-language editing as optional enhancement
