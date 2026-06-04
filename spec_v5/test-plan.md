# 18 — Test Plan

## 1. Unit tests

### Evidence

- parses video metadata
- handles no-audio video
- generates shot timeline
- generates contact sheet
- extracts OCR/ASR if available
- records explicit empty reasons

### Gen1 validation

- accepts valid NeutralReconstructionProgram
- rejects raw sample media references
- rejects missing placeholders
- rejects missing evidence refs
- repairs malformed JSON when possible
- falls back to neutral template

### Element extraction

- extracts hook pattern
- extracts transition pattern
- extracts typography pattern
- extracts visual asset recipe
- extracts audio recipe
- uses light model only for text input

### KB curator

- exact duplicate merges
- sample raw image becomes evidence_only
- sample audio fingerprint becomes evidence_only
- similar element becomes variant
- low-quality candidate rejected

### Composition planner

- creates sections covering full duration
- binds selected elements
- harmonizes style
- creates slot plan
- creates audio plan

### Gen2 validation

- rejects unapproved imports
- rejects sample path references
- rejects network calls
- accepts valid code
- fallback render works

## 2. Integration tests

### Learn one video

Input:

```text
sample_video.mov
```

Expected artifacts:

```text
evidence.json
neutral-reconstruction-program.json
candidate-elements.json
kb-decisions.json
kb-elements.json
```

### Learn multiple videos

Input:

```text
sample_A.mov
sample_B.mov
sample_C.mov
```

Expected:

- KB contains elements from multiple sources.
- duplicate/variant relationships recorded.
- search works.

### Create with selected elements

Input:

```text
selected hook from A
selected transition from B
selected CTA from C
target product image
brief
```

Expected:

- CompositionProgram exists.
- GapReport exists.
- FinalVideoProgram exists.
- final.mp4 exists.
- scorecard passes P0 gates.

### Missing material

Input lacks hero product closeup.

Expected:

- GapReport marks missing slot.
- Material fill uses AssetRecipe or text card fallback.
- final.mp4 still renders.

### Audio unavailable

Cloud audio disabled.

Expected:

- procedural audio fallback used.
- audio provenance recorded.
- final has AAC track or explicit silence warning.

## 3. Safety tests

- final code cannot reference sample media path.
- final audio fingerprint does not match sample audio.
- final images do not pHash-match sample frames above threshold.
- exact sample subtitle text is not reused.
- sample logo/watermark detected as evidence_only.

## 4. Render quality tests

- final video readable by ffprobe.
- duration within tolerance.
- no long black segments.
- no unintended silence.
- correct resolution/aspect.
- first/last frames valid.

## 5. UI tests

- Analyze tab shows evidence.
- Reconstruct tab shows neutral program and placeholders.
- KB tab shows elements and decisions.
- Select tab saves selection set.
- Plan tab shows composition and gaps.
- Render tab plays final video.
- Evaluate tab shows scorecard.

## 6. Golden cases

Recommended golden cases:

```text
marketing.mov
editing.mov
motion_graph_1.mov
motion_graph_2.mov
```

For each case run:

```text
learn sample
store KB elements
select at least 3 elements
compose target video
render final
scorecard
```

## 7. Regression criteria

A change fails regression if:

- final video no longer renders
- no-copy gate fails
- KB duplicates explode
- Gen2 fallback not working
- UI cannot show learn -> KB -> compose path
