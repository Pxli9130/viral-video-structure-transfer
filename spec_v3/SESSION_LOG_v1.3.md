# Session Log — Spec v1.3 (Source-first RenderRecipe Engine)

> One session's work, end to end: what the problems were, how each was solved, **why** that
> approach, and **exactly what was modified**. Date: 2026-05-31. Branch: `eval_finetune`.
> Toolchain: nvm node v22.20.0 + conda env `viral` (ffmpeg/ffprobe 8.1.1, python 3.11,
> librosa/scenedetect/easyocr/faster_whisper/cv2). Real providers only (Gemini etc.); no mock outputs.

---

## 0. Starting point & guiding constraints

- The repo is the "爆款结构迁移引擎 / Viral Video Structure Transfer Engine": learn the *structure*
  of a sample video and re-apply it to new material — **learn the recipe, not the content**.
- An existing investigation (`docs/artifacts/render_overfit_findings/REPORT.md`) had proven the
  renderer was a **sample-blind mold**: every `videoType="beat_cut"` input collapsed to one identical
  6-primitive sequence; cross-brief render layout NCC **0.868–1.000**.
- User directives this session: **pursue to completion, everything real (no mock/fake), surface any
  human-involvement blocker, don't worry about cost.** Answer in Chinese, greet as "1345".

---

## Problem 1 — The product renders a fixed "mold", not transferred structure

**Question/goal.** Pivot from "a better beat_cut renderer" to a submission that demonstrably
*transfers structure to new material* instead of reproducing one template. Encode it as **Spec v1.3 —
Source-first RenderRecipe Engine**.

**How it was solved.** Built a verified, current-code implementation plan (via a fan-out code-mapping
pass), then implemented the engine:
- **Source-first material policy**: sample/reference = *structure evidence only* (never copy
  frames/audio/watermark); source video / target assets / provenance-labeled AIGC = the output material.
- **RenderRecipe** = the single renderer-agnostic contract, carried at
  `timeline.renderPlan.renderRecipe` (which is `additionalProperties:true`, so **zero schema change**),
  with a human-auditable `primitiveReason` per clip.
- **Evidence+material-driven primitive selection** (`selectPrimitive`) replacing role-only selection.
- **Two real renderers consume the recipe**: FFmpeg (canonical MP4) + a new Remotion `ViralRecipe`
  composition.
- **Anti-overfit gate**: cross-sample layout-NCC diversity probe.

**Why this approach.**
- Nesting the recipe under `renderPlan` was the *lowest-risk* landing spot (no JSON-schema change, and
  the render-quality gate already reads `generation.timeline`).
- The golden tests (`editingMovBeatCutGolden`, `editingMovMovingMaterialGolden`, `marketingPosterCase`)
  are **assertion gates, not byte snapshots**, and don't read `renderPlan.renderRecipe`, so an
  *additive* recipe keeps them green. Behavioural changes (evidence-driven primitives, adaptive
  structure) were put behind **opt-in flags defaulting OFF** so goldens stay byte-identical and only
  the demo/learn runners opt in.
- FFmpeg stays the canonical renderer (it already works + composites real pixels); Remotion is the
  recipe-driven secondary layer — proving the recipe is renderer-agnostic without betting the
  deliverable on headless Chromium.

**What was modified.**
- `packages/shared/src/types.ts`: `RenderRecipe` / `RenderRecipeClip` / `RenderRecipePrimitive` /
  `RenderRecipeFamily` types; `RenderPlan.renderRecipe?`; `RendererTarget` += `remotion_recipe`;
  `RendererBackend` += `remotion_recipe_compose`; `GenerationControls.recipeEvidencePrimitives?`;
  `TimelineClip.primitiveReason?`.
- `packages/shared/src/engine/planner.ts`: `buildRenderRecipe(...)` + mapping helpers (internal
  primitive vocab → recipe component vocab), `selectPrimitive(slot, evidence, material)` (flag-guarded),
  wired into `buildTimeline`'s `renderPlan` literal.
- `apps/api/src/adapters/renderers.ts`: `RemotionRecipeRenderer` registry entry +
  `selectRenderer` case for `remotion_recipe`.
- `apps/api/remotion/index.tsx` + **new** `apps/api/remotion/ViralRecipeRoot.tsx`: `ViralRecipe`
  composition + components (HeroSpin / SourceMontage / Typography / ImpactFlash / CtaSlate / BeatBars)
  consuming `RenderRecipe` props.
- `apps/api/src/server.ts`: `RENDERER_TARGETS` += `remotion_recipe`.
- **New tests**: `packages/shared/src/__tests__/renderRecipe.test.ts`,
  `materialPolicySourceFirst.test.ts`, `selectPrimitive.test.ts`.

---

## Problem 2 — "mkdir spec_v3 and fill it in" (spec docs)

**Question/goal.** Create `spec_v3/` mirroring the `spec_v2/` format, encoding Spec v1.3.

**How it was solved.** Hand-wrote the authoritative contract (`render-recipe.schema.json`) myself for
precision, then authored the prose docs to match the spec_v2 house style.

**Why this approach.** The schema is the contract and must be exactly right, so it was written by hand;
the prose docs mirror the existing spec_v2 structure for consistency, and `implementation-status.md` is
kept **honest** (tracks real state, not aspiration).

**What was modified (all new).** `spec_v3/requirements.md`, `design.md`, `api.md`, `tasks.md`,
`test-plan.md`, `demo-playbook.md`, `source-alignment.md`, `implementation-status.md`,
`schemas/render-recipe.schema.json`. README.md updated to point at spec_v3 + `demo:final`.

---

## Problem 3 — No real product material exists (human-blocker, surfaced)

**Question/goal.** The final demo needs real material, but the repo has **no real fan footage** (the
prior `AeroSpin_*.mp4` were self-reconstructed from `editing.mov`). "All things real, no mock/fake"
conflicts with the spec's procedural-SVG fallback.

**How it was solved.** Surfaced the blocker and asked; user chose **real Gemini 2.5 Flash Image
("Nano Banana") generation**, provenance-labeled `aigc_generated_material`. Wrote
`scripts/generate-aerospin-fan-fixture.mjs` (reuses the repo's `googleGeminiImageProvider`) →
`docs/fixtures/final_aerospin_fan/` (fan_hero + fan_card_01..04 + logo + copy.json + manifest +
provenance). Visually QA'd the output (real, on-prompt product imagery).

**Why this approach.** AIGC via a real provider is honest "real generation" (not a fake placeholder),
is a first-class material path in this project (FR-020), and keeps the on-theme fan demo. Procedural
SVG was rejected because it would be the kind of fake the user forbade.

**What was modified (new).** `scripts/generate-aerospin-fan-fixture.mjs`,
`docs/fixtures/final_aerospin_fan/*`.

---

## Problem 4 — The end-to-end material/render path didn't actually reach the canvas

**Question/goal.** Make the source-first pipeline real: target/source pixels must reach the rendered
frame; sample must never be copied.

**How it was solved.**
- **Material policy fix** (`planner.ts`): `dropSampleVisual` discriminator now drops *only* the
  evidence-only / learned-from-sample source; a genuinely reusable, distinct `user_authorized` source
  keeps its `sourceAssetId`. `moving_material_missing` gap clears when a reusable source montage exists.
- **Server resolver fix** (`server.ts`): `asset://managed/<id>` target assets now fall through to the
  managed-asset lookup, so HTTP-uploaded target material actually renders.
- **FFmpeg fix** (`renderers.ts`): the source-image branch composites a real resolvable asset even when
  `clip.type` is a `generated_card` (family-renderer fill that still bound a real asset).
- **`scripts/run-demo-final.mjs`** + `npm run demo:final`: orchestrates Demo A (editing.mov beat_cut +
  fan) + Demo B (motion_graph + fan) + the diversity probe, writing `docs/artifacts/final_submission/`.
- **Gates** + **`scripts/diversity_ncc.py`** (`npm run eval:render-diversity`).

**Why this approach.** The audit later confirmed FFmpeg is the *de-facto* renderer, so making real
pixels reach the FFmpeg canvas (not just Remotion) was essential. Empirically verified (contact sheet):
real fan hero + montage + logo composited; **Demo A 13/13 gates PASS**; Demo A vs Demo B layout NCC
**0.0103** (vs the 0.868–1.000 mold).

**What was modified.** `planner.ts`, `server.ts`, `renderers.ts`; **new**
`scripts/run-demo-final.mjs`, `scripts/diversity_ncc.py`; `package.json` scripts.

---

## Problem 5 — "Generate a video from learning each of these 4 videos"

**Question/goal.** For `editing.mov`, `marketing.mov`, `motion_graph_1.mov`, `motion_graph_2.mov`:
learn each one's structure (real analysis) and render a fan video from it.

**How it was solved.** **`scripts/run-learn-samples.mjs`** (`npm run learn:samples`): starts the real
API server, uploads+analyzes each video (FFmpeg + PySceneDetect + librosa + Gemini VLM + ASR/OCR → a
learned template), then in-process generates+renders a fan video from that learned template + the same
fan material, and computes a pairwise diversity matrix.

**Why this approach.** The server does the *real* learning (full analyzer + VLM); rendering in-process
reuses the proven generate→render path. Holding prompt + target material constant makes the **only**
variable the learned structure — a clean anti-overfit test.

**What was modified (new).** `scripts/run-learn-samples.mjs`; `package.json` `learn:samples`.

**What it revealed.** 3 of the 4 (editing/mg1/mg2) classified as `beat_cut` collapsed to the same mold
(layout NCC **0.92–0.98**) → Problem 6.

---

## Problem 6 — Within-type mold + meta-placeholder subtitles

**Question/goal (user).** (a) The beat_cut videos are still too similar; "did we really learn each
sample's structure?"  (b) Subtitles showed a hardcoded placeholder `分镜=时间线 字幕=结构`; generate
real subtitles instead. Two root causes named: coarse `videoType` classifier; fixed per-type structure.

**How it was solved.**
1. **Sample-adaptive structure** (`recipeAdaptiveStructure` flag, default OFF; ON in learn/demo):
   `adaptiveBeatCutSegments(template)` derives **clip count** (`clamp(round(bpm/22),4,9)`) + **per-clip
   durations** from the sample's *real* shot signature (`visualElementGraph.shots`) + BPM. Result:
   editing/mg1/mg2 → **7 / 6 / 5 clips**; within-beat_cut NCC dropped **0.92–0.98 → 0.35–0.57**.
2. **Subtitle generation**: de-meta'd the planner's `beatCutCjkFallback` (now product-derived from the
   brief, product name cleaned/capped — never engine/meta phrases); the server's
   `applySubtitleGeneration` now LLM-generates via the configured provider (Gemini) by default
   (new `auto` mode, not just `ark_doubao`); the runners' polish became role+quality based
   (hook→product name, cta→CTA, else cycle real selling points; strips prompt/English-generic leakage).
   Result: **0 placeholder subtitles** across all 4 samples.
3. **Classifier root cause = bypassed, not reclassified**: adaptive structure makes the *same label*
   produce *different structure*, so the coarse label no longer causes a mold. The fast MGs are
   genuinely fast-cut/beat-driven; forcing them into the slow `motion_graph` card template would be a
   misclassification, so they were intentionally left as `beat_cut`.

**Why this approach.** The mold lives at the **structure** layer, not the label; making structure
sample-driven is the principled fix and the user explicitly allowed "solve or bypass". Subtitles were
fixed at three layers (planner fallback / server LLM / runner polish) so no path can ship the meta
placeholder.

**What was modified.** `packages/shared/src/types.ts` (`recipeAdaptiveStructure`,
`subtitleGenerationMode` += `auto`/`llm`); `planner.ts` (`adaptiveBeatCutSegments`, de-meta fallback,
clean productName, clip-id uniqueness for reused slots); `apps/api/src/server.ts`
(`applySubtitleGeneration` LLM-by-default); `scripts/run-learn-samples.mjs`,
`scripts/run-demo-final.mjs` (flags + robust polish).

---

## Problem 7 — "Still too similar; burned text; did we get size/motion/location?"

**Question/goal (user).** Videos still share the same fan picture, the same circular motion, the same
synth drum; one sample shows a burned `STRUCTURE / REMIX / TIMELINE / AIGC` + placeholder card despite
AIGC. **"First identify the causes."**

**How it was solved.** Ran an **adversarial root-cause audit** (6 investigators + synthesis) that read
the real code + artifacts and tried to refute each suspected cause. Headline finding: the project
**captures** size/motion/location richly (in `visualElementGraph`); the signal dies in
**planner→timeline forwarding** (dropped/mislabeled fields) and **renderer hardcoding** — a
*captured-but-unused* problem, not a perception gap. Also: for these runs the active renderer is
**FFmpegRenderer**, so the `render-recipe.json` was inert metadata.

Then fixed the highest-impact causes:
1. **Removed burned debug strings** (`renderers.ts`): the literal `STRUCTURE / REMIX / TIMELINE / AIGC`
   (`mgMotionDecorationFilters`) and family meta-labels (`动态文字/霓虹几何/品牌 CTA/功能展示`); the
   kinetic proxy card now shows the **real product subtitle** instead of the family label.
2. **Element size/position/motion now transferred** (the core fidelity fix): the planner attaches the
   sample's real hero `bbox` + `motionPattern` to image clips (`elementGeometryForClip` /
   `attachElementGeometry`); the FFmpeg source-image branch composites the asset **at that bbox**
   (size + position) on a dark bed with motion derived from `motionPattern`, instead of always
   full-bleed + a fixed sin/cos pan. Verified: editing (hero ≈95%) renders near-full-frame (faithful),
   motion_graph_2 (hero 83%×79%) renders **smaller, offset** — size now varies per sample.
3. **Image de-dup**: both runners now spread all 5 distinct fan images (hero + 4 cards) across image
   clips, so the same picture isn't reused.

**Why this approach.** The audit insisted on identifying causes first (per the user) and distinguishing
*captured-but-unused* from *not-captured* — which directly answers "did we get size/motion/location?"
(yes, captured; the fix is to *consume* it). The burned strings are pure hardcoded leftovers (highest
visual impact, zero risk to remove). Geometry is the real "transfer fidelity" fix.

**What was modified.** `apps/api/src/adapters/renderers.ts` (remove burned strings/labels; kinetic uses
real subtitle; source-branch element-geometry placement); `packages/shared/src/engine/planner.ts`
(`elementGeometryForClip` + `attachElementGeometry`, attached in `buildTimeline`);
`scripts/run-learn-samples.mjs`, `scripts/run-demo-final.mjs` (5-image spread).

---

## Problem 8 — Deferred palette / audio / text-position fixes

**Question/goal (user).** Continue the explicitly deferred items: learned palette must affect FFmpeg
pixels, audio must not be just BPM-only / silent outside `beat_cut`, and text horizontal placement must
come from `typographyEvidence.bboxNorm`.

**How it was solved.**
1. **RenderRecipe schema gate is now real**: added `renderRecipeSchema` + `validateRenderRecipe`, and
   `scripts/validate-schemas.mjs` now validates embedded `timeline.renderPlan.renderRecipe` plus
   `docs/artifacts/**/render-recipe.json`. This prevents invalid recipes from passing only because
   `timeline.renderPlan` is `additionalProperties:true`.
2. **Learned palette reaches FFmpeg**: planner now derives `recipe.global.palette` from
   `visualElementGraph.globalStyle.palette`, `visualStyle.colorProgression`, `heroDescriptor.palette`,
   and typography color roles; FFmpeg consumes it for backgrounds, streaks, EQ bars, proxy accents,
   CTA bands, source-image beds, media cards, and hero glow/visor colors.
3. **Audio is evidence-driven procedural BGM**: non-`timeline_only` non-beat-cut outputs now get
   procedural BGM instead of silence. FFmpeg reads learned `layers`, `strongBeatsSec`,
   `spectralCentroidMean`, and `spectralFlatnessMean` to weight bass/drone/hats/air/impacts; it also
   supports both raw analyzer layer keys (`bass_kick`, `music_harmonic`, `hats_air`) and normalized
   recipe keys (`kick`, `bass`, `drone`, `hats`).
4. **Text position consumes bbox evidence**: planner forwards typography `bboxNorm` into text layers;
   FFmpeg drawtext uses the bbox center for horizontal placement (and y placement too), instead of
   always centering every headline.

**Why this approach.** These were all "captured-but-unused" signals. The low-risk fix is to keep the
existing evidence extraction and planner shape, then wire the already-learned fields into the renderer
and protect the render contract with a dedicated schema validator.

**What was modified.** `packages/shared/src/{schemas.ts,validation.ts,types.ts}`;
`packages/shared/src/engine/planner.ts`; `apps/api/src/adapters/renderers.ts`;
`scripts/validate-schemas.mjs`; `packages/shared/src/__tests__/renderRecipe.test.ts`.

---

## Verification status

| Check | Result |
|---|---|
| `npm run typecheck` (4 workspaces) | clean |
| `npm test` | shared **71 passed**, api **8 passed / 1 skipped**; 3 goldens green |
| `npm run validate:schemas` | **1097 passed, 0 failed**; now includes RenderRecipe artifact validation |
| `npm run regression:corpus:strict` | 9 passed, 0 failed, 1 skipped (010 needs server) |
| `npm run demo:final` | Demo A final 720x1280, 14.99s, gates PASS, real-material clips=3; Remotion final rendered; Demo A↔B layout NCC **0.254 → DIVERSE(PASS)** |
| `npm run learn:samples` | Previous confirmed run: 4/4 gates PASS; within-beat_cut NCC 0.92–0.98 → 0.35–0.57; 0 placeholder subtitles. Not rerun after Problem 8. |

**Flags keep goldens green**: `recipeEvidencePrimitives` and `recipeAdaptiveStructure` default OFF; the
recipe is additive; the demo/learn runners opt in.

## Deferred follow-ups

- **Done in Problem 8**: learned palette → FFmpeg pixels; evidence-driven procedural audio; typography
  bbox → text position; independent RenderRecipe schema validation.
- **Still open**: matcher-side cross-slot de-dup for the server/UI path (the runner-level spread covers
  the demo artifacts only).

---

## File modification summary

### Modified (this session)
| File | What changed |
|---|---|
| `packages/shared/src/types.ts` | RenderRecipe types; renderer target/backend; control flags (`recipeEvidencePrimitives`, `recipeAdaptiveStructure`); `subtitleGenerationMode` += `auto`/`llm`; `TimelineClip.primitiveReason`; audioPlan evidence fields |
| `packages/shared/src/schemas.ts`, `packages/shared/src/validation.ts` | `renderRecipeSchema` + `validateRenderRecipe` |
| `packages/shared/src/engine/planner.ts` | `buildRenderRecipe`, sample-derived palette, non-beat procedural audio policy/evidence forwarding, typography `bboxNorm` forwarding, `selectPrimitive`, `adaptiveBeatCutSegments`, `elementGeometryForClip`/`attachElementGeometry`; material-policy discriminator + moving gap; de-meta'd subtitle fallback + clean productName; clip-id uniqueness |
| `apps/api/src/adapters/renderers.ts` | `remotion_recipe` registry/select; learned palette consumed by FFmpeg; evidence-driven procedural BGM; typography bbox controls drawtext placement; source-branch composites real assets regardless of `clip.type` + at the sample's element bbox/motion; removed burned `STRUCTURE/REMIX/TIMELINE/AIGC` + family meta-labels + beat-cut genre tag; kinetic proxy uses real subtitle |
| `apps/api/src/server.ts` | `asset://managed` resolver fall-through; `applySubtitleGeneration` LLM-by-default via configured provider; `RENDERER_TARGETS` += `remotion_recipe` |
| `apps/api/remotion/index.tsx` | registered the `ViralRecipe` composition |
| `package.json` | `demo:final`, `learn:samples`, `eval:render-diversity` scripts |
| `README.md` | spec_v3 + Spec v1.3 source-first / demo:final section |
| `scripts/validate-schemas.mjs` | validates embedded and artifact RenderRecipes |

### New (this session)
| File | Purpose |
|---|---|
| `spec_v3/*.md` + `spec_v3/schemas/render-recipe.schema.json` | Spec v1.3 doc set + RenderRecipe contract |
| `apps/api/remotion/ViralRecipeRoot.tsx` | Remotion composition consuming RenderRecipe |
| `scripts/generate-aerospin-fan-fixture.mjs` | real Gemini AIGC fan target fixture generator |
| `scripts/run-demo-final.mjs` | submission demo runner (Demo A/B + diversity) |
| `scripts/run-learn-samples.mjs` | learn-from-each-sample runner |
| `scripts/diversity_ncc.py` | cross-sample layout-NCC diversity probe |
| `packages/shared/src/__tests__/{renderRecipe,materialPolicySourceFirst,selectPrimitive}.test.ts` | unit tests |
| `docs/fixtures/final_aerospin_fan/*` | real AIGC fan target assets (gitignored) |
| `docs/artifacts/{final_submission,learned_samples}/*` | rendered outputs + reports (gitignored) |

### NOT changed by this session (noted for honesty)
- `scripts/run-full-loop-editing-artifacts.mjs` was already modified at session start (pre-existing `M`).
- `.gitignore` was modified during the session by something other than this work (added a vvst-eval
  exception); left as-is to avoid disturbing the submodule setup.

---

## How to reproduce

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"
npm run typecheck && npm test                 # green
node scripts/generate-aerospin-fan-fixture.mjs # real Gemini fan fixture (needs GEMINI_API_KEY)
npm run demo:final                             # Demo A/B + diversity → docs/artifacts/final_submission/
npm run learn:samples                          # learn from each test_videos/*.mov → docs/artifacts/learned_samples/
```
