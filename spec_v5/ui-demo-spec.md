# 10 — UI Demo Specification

## 1. UI goal

The UI must prove the system can:

1. analyze samples,
2. learn reusable elements,
3. store them in KB,
4. let users choose elements,
5. detect/fill gaps,
6. generate a new video,
7. explain the whole transfer process.

## 2. Recommended tabs

Minimum tabs:

```text
Analyze
Reconstruct
Knowledge
Select
Plan
Fill
Render
Evaluate
```

Full tabs:

```text
Upload
Sample Analysis
Neutral Reconstruction
Extracted Elements
Knowledge Base
Target Asset Analysis
User Selection
Gap Report
Composition Plan
Final Code/Recipe
Render Preview
Before/After Compare
Scorecard
```

## 3. Upload page

Display:

- sample videos
- target assets
- creative brief
- target duration
- aspect ratio
- variant goal

Actions:

- learn samples
- search KB
- generate video

## 4. Sample Analysis panel

Display deterministic evidence:

- video preview
- duration, fps, resolution, aspect ratio
- shot count
- shot timeline
- key frame contact sheet
- OCR text snippets
- ASR transcript
- audio stream status
- BPM / beat grid / energy curve
- motion intensity curve

## 5. Neutral Reconstruction panel

Display Gen1 output:

- original sample preview
- neutral reconstruction preview
- structure coverage score
- timing coverage score
- placeholders list
- timing map
- evidence references
- safety flags

Show explicit transformations:

```text
sample logo -> placeholder.logo
sample person/head -> placeholder.hero_head
sample subtitle -> placeholder.subtitle_text
sample audio -> audio_pattern only
```

## 6. Extracted Elements panel

Display candidate and stored elements:

- name
- type
- source sample
- timestamp
- preview
- evidence refs
- required slots
- reusable policy
- KB decision: store/merge/variant/reject/evidence_only

Element groups:

- hooks
- segment templates
- rhythm patterns
- motion patterns
- transitions
- typography/layout
- asset recipes
- audio recipes
- CTA patterns
- Remotion snippets

## 7. Knowledge Base panel

Display:

- searchable element table
- filters by type/source/tag
- preview cards
- variant/merge relationships
- quality scores
- safety/reusable policy
- recommendation button

## 8. User Selection panel

Display selected elements:

```text
Selected hook
Selected subtitle style
Selected transition
Selected CTA
Selected audio pattern
Selected asset recipe
```

Actions:

- add/remove element
- auto-recommend
- save selection set
- compare selected elements

## 9. Target Asset Analysis panel

Display:

- target asset preview
- detected product/person/scene
- quality score
- suggested usage section
- crop suggestions
- missing role hints

## 10. Gap Report panel

Display slot table:

| Slot | Required by | Status | Matched asset | Impact | Fill strategy |
|---|---|---|---|---|---|
| hero_product | hook | missing | none | weak hook | generate hero card |
| CTA background | cta | weak_match | image_2 | readable but plain | packaging card |

## 11. Composition Plan panel

Display timeline:

```text
0-2s hook
2-5s pain point
5-9s benefit demo
9-13s proof
13-16s CTA
```

For each section show:

- used elements
- bound assets
- generated assets
- text/copy
- audio cues
- evidence and explanation

## 12. Fill panel

Display optional material/audio generation:

- missing visual slots
- stored prompt recipe used
- generated result
- provenance
- audio recipe used
- generated/procedural audio result
- warnings

## 13. Final Code/Recipe panel

Display:

- Gen2 status
- TypeScript compile result
- schema validation
- no-copy gate
- RenderRecipeV5 JSON summary
- code file tree

Full code can be collapsible.

## 14. Render Preview panel

Display:

- final.mp4
- final.remotion.mp4
- preview frames
- contact sheet
- download links
- render warnings

## 15. Before/After Compare panel

Display:

```text
sample original
neutral reconstruction
final generated video
```

Also show:

- sample structure vs final structure
- selected elements origin map
- no-copy proof

## 16. Scorecard panel

Display rubric coverage:

```text
P0 Sample Parse: done
P0 Structure Extract: done
P0 Transfer Generation: done
P0 Gap Detection: done
P0 Gap Fill: done
P0 Visualization: done
P0 Final Demo: done
P1 Packaging: done
P1 Variants: partial
P1 Real Asset Fit: done
P1 Human Edit: partial
Audio Structure: done
No Sample Copy: passed
```

## 17. Demo success criteria

A judge should be able to see:

- what structure was extracted
- what knowledge was stored
- what the user selected
- how selected elements map to the new video
- what assets were missing
- how missing assets/audio were filled
- how final video was generated
- why final output is not a copy of sample content
