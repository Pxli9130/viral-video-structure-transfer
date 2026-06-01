# 11. UI and Demo Spec

## 1. UI Goal

The UI must help judges see the transfer chain. It does not need to be beautiful first, but must be understandable.

```text
样例学到了什么 → 新素材匹配到哪里 → 缺什么 → 怎么补 → recipe 怎么渲染 → 成片
```

## 2. Page 1: Sample Analysis

Components:

- video preview。
- meta summary。
- shot timeline。
- beat graph。
- frame sheets。
- OCR/ASR table。
- visual element list。
- motion atom list。

Key counters:

```text
shots
visual elements
typography runs
motion atoms
audio layers
```

## 3. Page 2: Structure KB

TechniqueAtom cards:

- name。
- category。
- source sample。
- evidence snippets。
- required assets。
- renderer component。
- fallback strategies。

Example cards:

```text
Parametric Ribbon Surface
Kinetic Typography Sweep
Source Clip Beat Montage
Media Card Cascade
Impact Flash Stamp
CTA Product Slate
```

## 4. Page 3: Asset Mapping + Gap Report

Table:

| Slot/Atom | Required | Matched Asset | Status | Gap Impact | Repair |
|---|---|---|---|---|---|

Each missing gap expands to:

```text
reason
impact
repair options
selected repair
expected visual result
```

## 5. Page 4: Layer Timeline

Tracks:

- Video/Media Track。
- Text Track。
- Motion Graphics Track。
- Transition Track。
- Audio Track。

Each layer shows:

- start/duration。
- zIndex。
- evidenceRefs。
- fallbackReason if any。

## 6. Page 5: Render Preview

Layout:

```text
left: sample video / sample structure
middle: structure diff + mapping
right: generated video
bottom: recipe inspector + gate report
```

Buttons:

- Render FFmpeg。
- Render Remotion。
- Download MP4。
- Download recipe。
- Run gates。

## 7. Minimal Artificial Controls

At least one of:

- hook intensity slider。
- text density selector。
- rhythm speed selector。
- CTA text input。
- version selector。

## 8. Multi-Version UI

Version cards:

### High Click

- shorter hook。
- larger text。
- more impact flash。
- faster cuts。

### High Conversion

- selling points earlier。
- clearer proof。
- CTA visible longer。

### High Quality

- less text。
- smoother motion。
- more whitespace。
- softer audio。

## 9. Natural Edit UI

Input:

```text
开头更抓人一些
```

Output:

- patch diff。
- explanation。
- preview。
- rerender。

## 10. Recommended Final Demo Script

1. Show three learned sample templates: Editing, Marketing, Motion Graph。
2. Open Marketing sample analysis。
3. Show visual elements=33, typography=24, audio=4, ribbon atom=1。
4. Show TechniqueAtom: ParametricRibbonSurface。
5. Upload new product assets。
6. Show gap report: missing moving ribbon/video material, repaired by procedural motion + product image。
7. Show layer timeline: media/text/ribbon/audio layers。
8. Render Remotion: media visible + ribbon + safe CTA。
9. Render FFmpeg: fallback sweep + mux。
10. Show high_click and high_quality versions side-by-side。
11. Run gates: evidence fidelity pass, no sample copy pass。
