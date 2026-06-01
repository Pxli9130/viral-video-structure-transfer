# System Design — Spec v1.3

Project: **Viral Video Structure Transfer Engine / 爆款结构迁移引擎**

Version: **v1.3 — Source-first RenderRecipe Engine**

Status: active spec for the **final submission**. This document supersedes [spec_v2/design.md](../spec_v2/design.md) (v1.2-final) for everything v1.3 touches — the render contract, primitive selection, material policy on the canvas, and the anti-overfit gate. spec_v2 remains valid for everything v1.3 does not override (project/asset/analysis model, knowledge base, slot induction, AIGC safety, storage). Read [requirements.md](./requirements.md) first; the authoritative render contract is [schemas/render-recipe.schema.json](./schemas/render-recipe.schema.json).

---

## 1. Why v1.3 exists (design problem statement)

The overfit investigation ([docs/artifacts/render_overfit_findings/REPORT.md](../docs/artifacts/render_overfit_findings/REPORT.md)) proved that the current product renders a **sample-blind mold**. Every `videoType=beat_cut` input collapses to one identical 6-primitive sequence — `neon_hero_intro → beat_text_card → tutorial_rule_card → action_montage → impact_flash_stamp → motivation_cta` — with hardcoded subtitle copy and fixed FFmpeg geometry. The measured cross-brief render-layout cross-correlation is **0.868–1.000** with primitive-sequence similarity **1.00 for every beat-cut pair** (REPORT.md §11).

The root-cause chain is three coupled defects:

1. **Material policy nulls real pixels.** A sample-sourced `sourceAssetId` is dropped, so `candidateShots=[]`, no clip gets a `sourceAssetId`, and the renderer's source branch is never taken. Output frames contain zero source pixels (REPORT.md §5, §12).
2. **Primitive is chosen from `clip.role` + `visualFormFamily` only**, not from visual evidence (REPORT.md §6). `tutorial_rule_card` vs `beat_text_card` is decided solely by `subtitleText` truthiness.
3. **The FFmpeg renderer is fixed procedural geometry** keyed on the primitive string + bpm (REPORT.md §7). The only sample-derived render knob on the beat-cut path is `bpm` plus a hero palette/positionClass.

This reads as a fixed-template generator, which damages the core scoring criterion: the official task rewards transferring **structure to NEW material**, not reproducing a mold.

### 1.1 The five hard principles (design invariants)

These are the load-bearing constraints. Every design decision below is downstream of them.

- **P1 Source-first.** Sample/reference video = structure **evidence only** by default. Source video / target images / target copy / explicitly-accepted generated material = output **material**. Style-lock self-reconstruction is a diagnostic, **not** the main demo.
- **P2 Every renderer consumes a RenderRecipe.** Forbidden: `role → primitive → hardcoded pixels`. Required: `VisualEvidence + SlotMapping + MaterialPolicy + FillPlan → RenderRecipe → FFmpeg / Remotion / HyperFrames`.
- **P3 Guarantee ONE reliable vertical first** — B-end physical-product promo (the AeroSpin portable turbo fan). Do not chase beat_cut + motion_graph + vlog + short_drama + talking_head simultaneously.
- **P4 Keep beat_cut (editing.mov) but only as a STYLE SOURCE** feeding the recipe (fast-cut rhythm, black/red/yellow typography, hero-motion motif, impact-flash grammar, BGM beat grid) — never a fixed 6-clip mold.
- **P5 No video-generation model in the critical path** (no Seedance/Veo). Renderers are FFmpeg + Remotion + HyperFrames.

---

## 2. Design goals delta (v1.2 → v1.3)

v1.2 goals (structure-first, video-input ready, knowledge-base driven, renderer-agnostic, provider-agnostic, deterministic fallback, explainability) all remain. v1.3 adds or sharpens:

| # | v1.2 goal | v1.3 delta |
|---|---|---|
| 1 | Renderer-agnostic via Timeline JSON | **Renderer contract is now the RenderRecipe**, nested at `timeline.renderPlan.renderRecipe`. Timeline stays the transport; the recipe is the single thing a renderer reads to decide pixels. No renderer re-derives a primitive from `clip.role`. |
| 2 | Structure-first | **Source-first.** Structure still comes from the sample; pixels come from source/target/generated material. The two are kept on separate sides of the material policy. |
| 3 | Explainability by default | **Auditable primitive selection.** Every clip carries a `primitiveReason` string explaining why its primitive was chosen from evidence + material + capabilities. |
| 4 | Multiple verticals | **One reliable vertical first** (`product_mg` / AeroSpin fan). beat_cut and motion_graph stay as style sources and anti-overfit foils. |
| 5 | Deterministic fallback | **Anti-overfit is now measured, not assumed.** A diversity gate (layout NCC + primitive-sequence similarity) fails/warns if unrelated samples render the same mold. |
| 6 | Provider-agnostic AI | Unchanged, plus: the final demo's target material is **real Gemini 2.5 Flash Image (Nano Banana) AIGC**, provenance-labeled `aigc_generated_material`, behind `GEMINI_API_KEY` + external-provider opt-in. No video-gen model anywhere in the path (P5). |

The delta is deliberately narrow. v1.3 is a **focused, source-first, RenderRecipe-centered submission spec**, not a rewrite.

---

## 3. Pipeline diagram

```text
                        STRUCTURE EVIDENCE SIDE                         MATERIAL SIDE
                        (sample = evidence only)                        (reaches the canvas)
  ┌────────────────────────────────────────────────┐   ┌──────────────────────────────────────┐
  │ sample video (editing.mov / motion_graph_1.mov) │   │ source_video (optional, user_authorized)│
  │   → analyze-evidence-timeline.py                │   │ target images (AeroSpin fan assets)    │
  │   → VisualEvidenceTimeline (cuts/beats/families)│   │ target copy (sellingPoints, CTA)       │
  │   → VisualElementGraph (hero/typo/impact/bgm)   │   │ generated_target_asset (Nano Banana)   │
  │   → SourceVideoUnderstanding (if source given)  │   └──────────────────────────────────────┘
  │   → StructureTemplate (roles, rhythm, palette)  │                     │
  └────────────────────────────────────────────────┘                     │
                        │                                                 │
                        ▼                                                 ▼
            ┌──────────────────────┐                       ┌──────────────────────────┐
            │ OpenWorldSlotInduction│  ───── SlotMapping ──▶│ MaterialPolicyService     │
            │  (induced visual slots)│                      │  (R1..R5: who reaches canvas)│
            └──────────────────────┘                       └──────────────────────────┘
                        │                                                 │
                        ▼                                                 ▼
                  ┌───────────┐        ┌────────────┐        ┌──────────────────────┐
                  │ GapReport │ ─────▶ │ FillPlan    │ ─────▶ │ TargetMaterialManifest│
                  └───────────┘        └────────────┘        └──────────────────────┘
                        │                     │                            │
                        └──────────────┬──────┴────────────────────────────┘
                                       ▼
                          ╔════════════════════════════════╗
                          ║  buildRenderRecipe()           ║  ◀── ProductBrief (AeroSpin)
                          ║  + selectPrimitive(slot,        ║
                          ║      evidence, material, caps)  ║
                          ╚════════════════════════════════╝
                                       │
                                       ▼
                          RenderRecipe  (schemaVersion=render-recipe-v1)
                          carried at timeline.renderPlan.renderRecipe
                                       │
              ┌────────────────────────┼────────────────────────────┐
              ▼                        ▼                             ▼
   ┌──────────────────┐     ┌──────────────────────┐     ┌────────────────────────┐
   │ Remotion         │     │ FFmpeg               │     │ HyperFrames (optional)  │
   │ (PRIMARY visual  │     │ (cut/crop/zoom,      │     │ html+manifest+preview   │
   │  component layer; │     │  concat/mux, BGM,    │     │  if CLI exists, else    │
   │  per-clip props   │     │  preview frames,     │     │  SKIPPED_HYPERFRAMES.md │
   │  consume recipe)  │     │  final 720x1280 MP4) │     │  (never a fake MP4)     │
   └──────────────────┘     └──────────────────────┘     └────────────────────────┘
              │                        │
              └──────────┬─────────────┘
                         ▼
            final 9:16 ~15s MP4  +  preview frames  +  gates  +  diversity eval
```

The recipe is the **fence** between the evidence side and the renderers. Nothing on the evidence side draws pixels; nothing on the renderer side re-infers structure. The material policy is the **gate** on the material side: it decides which asset ids are eligible to land in `clip.material`.

---

## 4. RenderRecipe compiler stage placement

### 4.1 Where it sits

Today `generateMigrationResult` runs `understandSourceVideo → matchSlots → createFillPlan → buildTimeline`, and `renderPlan` + `audioPlan` + clips/layers are built in **one literal inside `buildTimeline`** (REPORT.md §13). v1.3 inserts a dedicated compiler stage:

```text
understandSourceVideo
  → matchSlots                 (SlotMapping)
  → detectGaps                 (GapReport)
  → createFillPlan             (FillPlan)
  → buildRenderRecipe          ◀── NEW STAGE (the single source of truth for primitive + material + audio decisions)
  → buildTimeline              (wraps the recipe; sets timeline.renderPlan.renderRecipe = recipe)
```

`buildRenderRecipe` is placed **between `createFillPlan` and `buildTimeline`** so that:

- it consumes the fully-resolved `FillPlan` (which slot is satisfied by which material) and the `TargetMaterialManifest`;
- `buildTimeline` becomes a thin wrapper that lays the recipe's clips onto a Timeline and attaches the recipe at `renderPlan.renderRecipe`;
- the scattered selection logic (`beatPrimitiveFromSlot`, `beatCutPrimitiveForClip`, `audioPolicy`, `beatCutLayersForClip`) is centralized into one auditable function.

### 4.2 Why `timeline.renderPlan.renderRecipe`

`renderPlan` is what both renderers already read and is `additionalProperties:true` (REPORT.md §13). Nesting the recipe there means **zero change to `timeline.schema.json`**, and the render-quality gate — which reads `generation.timeline` only — can see the recipe without new plumbing. This is the placement decision locked in REPORT.md §16 Q2.

### 4.3 Compiler inputs and contract

```text
buildRenderRecipe(
  template:        StructureTemplate,        // roles, rhythm, palette, sourceSampleIds
  elementGraph:    VisualElementGraph,        // hero/typo/impact/background/cta + shot nodes + audioStructure
  sourceUnderstanding?: SourceVideoUnderstanding, // matched source shots (if a source video was supplied)
  slotMapping:     SlotMapping[],
  gapReport:       GapReport,
  fillPlan:        FillPlan,
  targetManifest:  TargetMaterialManifest,    // AeroSpin fan assets + provenance
  productBrief:    ProductBrief,              // name, category, sellingPoints[], cta
  capabilities:    RendererCapabilities,      // which primitives each renderer can honor
): RenderRecipe
```

The compiler is **pure and deterministic** for a fixed input set (NFR — determinism, mirrored from spec_v2). It must derive the recipe from the same resolved pass that `buildTimeline` would use, so the recipe and the timeline clips never drift (the Option B risk noted in REPORT.md §15).

---

## 5. RenderRecipe type sketch

This TypeScript sketch is the in-code shape and **MUST match [schemas/render-recipe.schema.json](./schemas/render-recipe.schema.json) exactly** (field names, enum members, required-ness). The schema is authoritative; this is the type that validates against it.

```ts
type RenderRecipe = {
  schemaVersion: "render-recipe-v1";
  videoType: "product_mg" | "beat_cut_product" | "motion_graph" | "fallback_cards";
  productTheme: {
    name: string;
    category: string;            // e.g. portable_fan, beverage, desk_lamp
    sellingPoints: string[];
    cta: string;
  };
  sourcePolicy: {
    sampleUse: "structure_evidence_only" | "authorized_reuse";
    sourceVideoUse: "renderable_user_material" | "missing";
    targetAssetUse: "renderable_target_material" | "missing";
    sampleFrameCopyAllowed: false;   // const false — sample frames never reach the canvas
    sampleAudioCopyAllowed: false;   // const false — sample audio never reaches the canvas
  };
  global: {
    aspectRatio: string;             // "9:16"
    width: number;                   // integer >= 1
    height: number;                  // integer >= 1
    fps: number;                     // integer >= 1
    durationSec: number;             // > 0
    palette: string[];               // hex colors learned from sample evidence
    bpm?: number;
    beatGridSec?: number[];
    cutPattern: {
      targetCutCount: number;        // integer >= 0
      avgShotDurationSec: number;    // > 0
      fastZones: [number, number][]; // [startSec, endSec] windows
    };
    audioPlan: {
      policy: "procedural_bgm" | "user_bgm" | "authorized_sample_bgm" | "silent";
      layers: {                      // gain per synth layer; all optional
        kick?: number; bass?: number; drone?: number;
        hats?: number; riser?: number; impact?: number;
      };
    };
  };
  clips: RenderRecipeClip[];         // minItems 1
  warnings: string[];
};

type RenderRecipeClip = {
  clipId: string;
  role: "hook" | "setup" | "body" | "proof" | "transition" | "cta";
  startSec: number;                  // >= 0
  endSec: number;                    // >= 0
  slotId: string;
  visualFormFamily:
    | "source_video_montage"
    | "product_hero"
    | "media_cards"
    | "kinetic_typography"
    | "feature_list"
    | "impact_fx"
    | "brand_cta"
    | "procedural_proxy";
  selectedPrimitive:
    | "SourceClipBeatMontage"
    | "ProductHeroOrbit"
    | "FanHeroSpin"
    | "FeatureCardStack"
    | "TypographyLayoutSequence"
    | "ImpactFlash"
    | "CTAEndSlate"
    | "DynamicProxyMontage";
  primitiveReason: string;           // minLength 1 — never role alone
  rendererTarget: "remotion_recipe" | "ffmpeg" | "hyperframes_recipe";
  material: {
    kind:
      | "source_video"
      | "target_image"
      | "target_image_set"
      | "generated_target_asset"
      | "procedural"
      | "none";
    assetIds: string[];
    sourceShotIds?: string[];
    policy: "renderable" | "evidence_only" | "missing";
  };
  layout: {
    positionClass?: string;
    bboxTrackNorm?: unknown[];
    typographyLayout?:
      | "center_title" | "lower_third" | "diagonal_tag"
      | "keyword_scatter" | "top_tag";
  };
  motion: {
    pattern:
      | "orbit" | "spin" | "zoom_pulse" | "hard_cut"
      | "shake" | "pan" | "card_stack" | "none";
    beatAligned: boolean;
    beatTimestampsSec: number[];
    trajectory?: unknown[];
  };
  text: {
    copy: string;
    colorRoles: string[];
    animationHint: "per_char_reveal" | "shake" | "scale" | "flash" | "none";
  };
};
```

Notes that bind the sketch to the schema:

- `RenderRecipe` is `additionalProperties:false`; required keys are `schemaVersion, videoType, productTheme, sourcePolicy, global, clips, warnings`.
- `RenderRecipeClip` is `additionalProperties:false`; required keys are `clipId, role, startSec, endSec, slotId, visualFormFamily, selectedPrimitive, primitiveReason, rendererTarget, material, layout, motion, text`. `layout` is required but all its sub-fields are optional.
- `sampleFrameCopyAllowed` and `sampleAudioCopyAllowed` are schema `const: false` — they are not booleans the compiler may flip. They encode P1 as a typed invariant.
- `global.bpm` and `global.beatGridSec` are optional (a `product_mg` clip arc may be beat-light); `cutPattern` and `audioPlan` are required.

---

## 6. selectPrimitive design

### 6.1 Signature and contract

```ts
selectPrimitive(
  slot:         InducedVisualSlot,       // role, visualFormFamily, asset requirement, evidence
  evidence:     ClipEvidence,            // hero descriptor, motion energy, OCR/typo, impact onsets, source-shot motion
  material:     ResolvedMaterial,        // what the FillPlan resolved: source shots / target images / generated / none
  capabilities: RendererCapabilities,    // primitives each renderer target can honor
): { selectedPrimitive: SelectedPrimitive; primitiveReason: string }
```

The function is **the only place** a primitive is chosen. The renderer never picks one. It is forbidden to branch on `clip.role` alone — `role` is one input among four, and the chosen primitive must be justified by `evidence` and `material` (P2). Every call returns a human-auditable `primitiveReason` that names the deciding inputs (e.g. `"FanHeroSpin: productTheme.category=portable_fan + prompt mentions 'spin/wind' + hero target image available"`).

### 6.2 Selection table

Evaluated top-to-bottom; first match wins. The reason string records which row fired and the evidence that satisfied it.

| Priority | Condition (evidence + material + brief) | selectedPrimitive | visualFormFamily | primitiveReason gist |
|---|---|---|---|---|
| 1 | `source_video_mapped` AND high-motion source shots `>= 3` | `SourceClipBeatMontage` | `source_video_montage` | real source pixels available for a beat-synced montage |
| 2 | product category `fan` AND prompt mentions fan/spin/wind AND hero image/video | `FanHeroSpin` | `product_hero` | fan-specific hero motion grounded in category + prompt |
| 3 | product hero image/video AND `role==="hook"` | `ProductHeroOrbit` | `product_hero` | generic product hero on the hook |
| 4 | no moving source AND product image exists | `DynamicProxyMontage` + emit `moving_material_missing` gap | `procedural_proxy` | no real footage; honest procedural proxy, gap kept (R4) |
| 5 | typography/OCR evidence with bbox/layout | `TypographyLayoutSequence` | `kinetic_typography` | learned typographic layout drives the card |
| 6 | target image set `>= 3` | `FeatureCardStack` | `feature_list` / `media_cards` | enough target images for a card stack |
| 7 | impact/onset evidence at the clip window | `ImpactFlash` | `impact_fx` | beat/onset-aligned impact flash |
| 8 | CTA copy exists | `CTAEndSlate` | `brand_cta` | closing call-to-action slate |

If none match, the compiler emits `fallback_cards` videoType behavior with a `procedural_proxy` family and records the miss in `recipe.warnings[]`.

### 6.3 Why this kills the mold

The current code chose primitives from `role` + `visualFormFamily` only (REPORT.md §6), so every beat-cut input produced the same six-primitive sequence. `selectPrimitive` makes the chosen primitive a function of **available material** (rows 1, 2, 3, 4, 6) and **detected evidence** (rows 5, 7), so two unrelated samples with different evidence/material produce different primitive sequences — which the diversity gate (§11) verifies.

---

## 7. Material-policy data flow

### 7.1 The policy is the canvas gate

`MaterialPolicyService` (kept from spec_v2) decides which asset ids are eligible to appear in `clip.material.assetIds` and what `clip.material.policy` is. The recipe compiler calls it per slot; the renderer trusts the resolved `material` block and never re-resolves.

### 7.2 Rules (R1–R5)

| Rule | Statement | Effect on the recipe |
|---|---|---|
| **R1** | A sample asset id in `template.sourceSampleIds` cannot appear in render material unless `sampleAssetReuse=authorized`. | Such an id is dropped; `material.policy="evidence_only"`. `sourcePolicy.sampleUse="structure_evidence_only"`. |
| **R2** | A `source_video` asset id ≠ sample asset id with `sourcePolicy=user_authorized` MUST be eligible render material. | `material.kind="source_video"`, `policy="renderable"`, `sourcePolicy.sourceVideoUse="renderable_user_material"`. This path is real but under-exercised today (REPORT.md §12); v1.3 makes it the main demo. |
| **R3** | If `source_video` has matched shots for a montage slot, the renderer MUST use source pixels. | `selectPrimitive` row 1 fires; `material.sourceShotIds` is populated; FFmpeg opens the real clip. |
| **R4** | If no source moving clip exists, `DynamicProxyMontage` is allowed but the `moving_material_missing` gap MUST remain. | `selectPrimitive` row 4 fires; `material.kind="procedural"`; the gap is **not** cleared (no faking real footage). |
| **R5** | Target images can satisfy `media_cards` / `product_hero` / `feature_list` / `brand_cta` but cannot pretend to be `live_action_montage` unless animated as a procedural target asset. Mock/no-path assets MUST NOT satisfy visual slots. | `material.kind` ∈ {`target_image`, `target_image_set`, `generated_target_asset`}; mock/no-path → `policy="missing"` and a gap. |

### 7.3 Data flow

```text
TargetMaterialManifest ─┐
source_video (authorized)┤
sample ids (blocked)     ┼─▶ MaterialPolicyService.resolve(slot, candidates)
                         │        │
                         │        ├─ eligible? (R1 sample block, R2 authorized source, R5 mock/no-path block)
                         │        ├─ kind?     (source_video / target_image[_set] / generated_target_asset / procedural / none)
                         │        └─ policy?   (renderable / evidence_only / missing)
                         │                 │
                         ▼                 ▼
                 buildRenderRecipe ──▶ clip.material { kind, assetIds, sourceShotIds?, policy }
                                          │
                                          ▼
                          renderer resolves assetIds → real media path (server-side only)
                          (public artifacts use safe refs: asset://managed/<assetId>)
```

The no-sample-copy guarantee is enforced at policy resolution time (the source of `material.policy="evidence_only"`), not by hoping the renderer honors an intent string — the v1.2 weakness called out in REPORT.md §8 (`assetPolicy` was write-only intent).

---

## 8. RemotionRecipeRenderer (PRIMARY visual component layer)

Remotion is the **primary visual component renderer** in v1.3. `rendererTarget="remotion_recipe"` clips are rendered by React components whose props are **the `RenderRecipeClip` and nothing else**. A component never re-infers a primitive, never reads the raw Timeline, and never reaches back into evidence — it consumes recipe props (P2).

### 8.1 Component set and prop consumption

| Component | selectedPrimitive | Consumes from RenderRecipeClip | Renders |
|---|---|---|---|
| `FanHeroSpin` | `FanHeroSpin` | `material.assetIds[0]` (hero image), `motion.pattern=spin`, `motion.beatTimestampsSec`, `global.palette` | spinning turbo-fan hero with wind/blur motion locked to beats |
| `ProductHeroOrbit` | `ProductHeroOrbit` | `material.assetIds[0]`, `motion.pattern=orbit`, `layout.positionClass`, `motion.trajectory?` | product hero orbiting on the learned trajectory |
| `SourceClipBeatMontage` | `SourceClipBeatMontage` | `material.sourceShotIds`, `motion.beatTimestampsSec`, `global.cutPattern.fastZones` | hard-cut montage of **real source clips** on the beat grid |
| `DynamicProxyMontage` | `DynamicProxyMontage` | `material.kind=procedural`, `motion.pattern=hard_cut`, `global.palette` | high-motion procedural proxy when no real footage exists (gap stays) |
| `TypographyLayoutSequence` | `TypographyLayoutSequence` | `text.copy`, `text.colorRoles`, `text.animationHint`, `layout.typographyLayout` | per-role typography (center_title / lower_third / diagonal_tag / keyword_scatter / top_tag) with per-char reveal / shake |
| `FeatureCardStack` | `FeatureCardStack` | `material.assetIds[]` (target image set), `text.copy`, `motion.pattern=card_stack` | stacked feature cards over target images |
| `ImpactFlash` | `ImpactFlash` | `motion.beatTimestampsSec`, `text.copy`, `global.palette` | beat-aligned red/yellow impact starburst + stamp |
| `CTAEndSlate` | `CTAEndSlate` | `productTheme.cta`, `text.copy`, `material.assetIds` (logo) | closing CTA slate with brand/logo (AIGC logo permitted for the fictional AeroSpin) |
| `BeatBars` | (layer overlay) | `global.bpm`, `global.beatGridSec`, `motion.beatTimestampsSec` | animated beat-EQ bars synced to the grid |

### 8.2 Why Remotion is primary now

In v1.2 Remotion was a **real** parameterized renderer only for the ribbon/poster/MG family; for beat-cut it silently degraded to plain text cards because the composition omitted `motionPrimitive`, `beatGrid`, `audioPlan`, and beat-cut layer kinds (REPORT.md §9). v1.3 fixes this by making the recipe the prop contract: the Remotion composition reads `RenderRecipeClip` fields directly, so there is no hand-maintained `TimelineLike` subset to drift, and a `remotion_recipe` clip cannot silently fall back to a generic card. FFmpeg muxes the final MP4 (§9).

---

## 9. FFmpeg final-mux responsibilities

FFmpeg is **not demoted** — it owns the parts Remotion does not: real source-pixel handling and final assembly. Its v1.3 responsibilities:

- **Source clip cut / crop / zoom** — `-ss`/`-to`, crop to 9:16, zoom/pan on real source pixels for `SourceClipBeatMontage` (the only path that touches real footage).
- **Concat / mux** — assemble the Remotion-rendered visual segments and any FFmpeg source segments into the final 720×1280 MP4.
- **Procedural BGM** — synthesize the beat-aligned layered track per `global.audioPlan` (`procedural_bgm` / `user_bgm` / `authorized_sample_bgm` / `silent`); mux audio onto the final video. Never copies sample audio (`sampleAudioCopyAllowed=false`).
- **Preview-frame extraction** — sample one real still per clip from its rendered segment into `storage/generated/previews/<renderId>/clip_<n>.png` for the UI timeline.
- **Fallback card render** — when `videoType="fallback_cards"` or a clip has `rendererTarget="ffmpeg"` and `material.policy="missing"`, render a clean family card (no `PROXY`/`PLACEHOLDER`/占位 debug text ever reaches a frame).

The final MP4 is the product of **Remotion (visual components) → FFmpeg (source segments + concat + mux + BGM)**. The render-quality gate asserts both stages ran (§11).

---

## 10. HyperFrames optional handling

HyperFrames stays **optional and honest**. In v1.2 it was a JSON-manifest writer (version `stub-v1`) that the UI labeled `HyperFrames（占位）`, easy to mistake for a broken render (REPORT.md §10). v1.3 rule:

- If a real HyperFrames CLI exists, produce a **real** artifact: HTML + manifest + preview, consuming the recipe (`rendererTarget="hyperframes_recipe"`).
- If it does not exist, write `SKIPPED_HYPERFRAMES.md` explaining it was skipped. **Never** present a JSON stub in the UI as a completed MP4 renderer.

HyperFrames is an optional MG/HTML preview artifact, never on the final-demo critical path (P5 keeps the path FFmpeg + Remotion). The `hyperframes` enum must not be overloaded by an AIGC-video stub renderer.

---

## 11. Anti-overfit diversity metric

### 11.1 The two-demo design

The submission runs **two demos that share the same fan material but use unrelated samples**:

- **Demo A** — `editing.mov` (beat_cut style source) + AeroSpin fan target assets.
- **Demo B** — `motion_graph_1.mov` (different style source) + the **same** AeroSpin fan target assets.

If the engine were still a mold, both would render near-identically regardless of the sample. The diversity eval proves they do not.

### 11.2 Metrics

```text
layout_ncc(demoA, demoB)              = mean normalized cross-correlation of per-clip frame layout
primitive_seq_similarity(demoA, demoB)= sequence similarity of selectedPrimitive[] across the two recipes
subtitle_identity(demoA, demoB)       = fraction of identical text.copy strings across the two recipes
```

### 11.3 Thresholds (FAIL / WARN)

Calibrated against REPORT.md §11 (same-category mold measured at NCC 0.868–1.000, primitive_seq 1.00) and §16 Q5:

| Metric | Condition | Verdict |
|---|---|---|
| `layout_ncc` across unrelated samples | `>= 0.85` | **FAIL/WARN** (mold) |
| `layout_ncc` across unrelated samples | `<= 0.70` | target (healthy diversity) |
| `primitive_seq_similarity` across unrelated samples | `== 1.0` | **FAIL/WARN** (same primitive sequence) |
| `subtitle_identity` across unrelated samples | identical subtitles | **FAIL/WARN** (hardcoded copy) |

Frame-byte identity is **not** gated (already 0/9 across briefs, REPORT.md §11). The metric is computed by the diversity-eval stage and written under `docs/artifacts/final_submission/diversity_eval/`.

---

## 12. Kept vs demoted modules (from REPORT.md §15–16)

v1.3 follows the **Option B → toward C** path: a real `buildRenderRecipe` compiler is the source of truth, material policy is fixed so authorized non-sample source/target reaches the canvas, and evidence-aware `selectPrimitive` replaces role-only selection. The smaller Option A (additive recipe + advisory metric) is the safe floor.

### 12.1 Kept (promoted to first-class)

| Module / service | v1.3 role |
|---|---|
| `MaterialPolicyService` | **Promoted to canvas gate.** Now enforces R1–R5 at resolution time and sets `clip.material.policy`; no longer a write-only `assetPolicy` intent string (fixes REPORT.md §8). |
| `OpenWorldSlotInductionService` + `VisualEvidenceTimeline` + `VisualElementGraph` | Kept as the evidence side feeding `buildRenderRecipe`. The localize-then-label element graph (hero/typo/impact/bgm) is the evidence source for `selectPrimitive`. |
| FFmpeg renderer | **Kept and re-scoped** to source cut/crop/zoom, concat/mux, procedural BGM, preview frames, final MP4, fallback cards (§9). Real source-pixel handling lives here. |
| `analyze-evidence-timeline.py` | Kept as the deterministic perception entry; `--metrics-only` remains the gate's source of truth on the rendered MP4. |
| Target-material intake API + provenance labeling | Kept; the AeroSpin fan assets enter as `aigc_generated_material` with provenance (no fake real-brand logo; AeroSpin is fictional so an AIGC logo is permitted). |

### 12.2 Demoted / replaced

| Module / behavior | v1.3 disposition |
|---|---|
| Role-only primitive selection (`beatPrimitiveFromSlot`, `beatCutPrimitiveForClip`, `subtitleText`-truthiness rule-card switch) | **Replaced** by `selectPrimitive(slot, evidence, material, capabilities)` (§6). The scattered logic is centralized into the recipe compiler. |
| The fixed 6-primitive beat-cut mold (`neon_hero_intro`…`motivation_cta`) | **Demoted to a style source** (P4). beat_cut grammar feeds the recipe (rhythm, typography, impact, BGM grid) but never as a fixed clip sequence. |
| `renderPlan` literal built inside `buildTimeline` | **Demoted.** `buildTimeline` becomes a thin wrapper; the recipe compiler is the source of truth (§4). |
| Material policy nulling sample-sourced `sourceAssetId` with no eligible alternative | **Fixed** by R2/R3 — authorized non-sample source and target material now reach the canvas (REPORT.md §12 counterfactual becomes the main path). |
| Hero silhouette ignoring `centerTrajectory`; fixed orbit/size | **Fixed** — `ProductHeroOrbit`/`FanHeroSpin` consume `motion.trajectory` and `layout.positionClass` from the recipe (REPORT.md §7). |
| Remotion beat-cut degradation to text cards via hand-maintained `TimelineLike` | **Replaced** by `RemotionRecipeRenderer` whose props are the `RenderRecipeClip` (§8); no subset to drift (REPORT.md §9). |
| HyperFrames JSON stub presented as a renderer | **Demoted** to optional artifact; real artifact if CLI exists else `SKIPPED_HYPERFRAMES.md` (§10). |
| `mock_provider` / mock adapters in the live path | **Already removed in v1.2; stays out.** Real provider failure raises a real error. AIGC fan material uses real Gemini 2.5 Flash Image. |
| `areaRatioCurve` / `orientationCurve` dead evidence | Out of the recipe critical path; only fields with real consumers are threaded (REPORT.md §8). |

---

## 13. Final demo design (locked)

Product: **AeroSpin 便携涡轮小风扇** (portable turbo fan). 9:16, ~15s high-conversion product ad.

- **Sample** = `editing.mov` (structure evidence only; no frame/audio/watermark copy).
- **Material** = the repo has **no real fan footage**; procedural SVG placeholders were rejected ("all things real, no mock/fake"). The chosen path generates fan target assets with the **real Gemini 2.5 Flash Image (Nano Banana)** provider, provenance-labeled `materialRole=aigc_generated_material` (not user uploads, not a real product photo). Requires `GEMINI_API_KEY` + external-provider opt-in. AeroSpin is fictional, so an AIGC logo is permitted.
- **Target fixture**: `docs/fixtures/final_aerospin_fan/` (`fan_hero.png`, `fan_card_01..04.png`, `logo.png`, `copy.json`, `manifest.json`).
- **Optional real `--source`**: `test_videos/manual/fan_product_demo.mp4` if ever supplied (exercises R2/R3 and `SourceClipBeatMontage`).

### 13.1 Expected clip arc

| Window | role | selectedPrimitive | visualFormFamily |
|---|---|---|---|
| 0–2.5s | hook | `FanHeroSpin` | `product_hero` |
| 2.5–5.5s | setup | `TypographyLayoutSequence` | `kinetic_typography` |
| 5.5–8.5s | body | `FeatureCardStack` | `feature_list` |
| 8.5–11.5s | proof | `SourceClipBeatMontage` (or `DynamicProxyMontage` + `moving_material_missing` gap) | `source_video_montage` / `procedural_proxy` |
| 11.5–13s | transition | `ImpactFlash` | `impact_fx` |
| 13–15s | cta | `CTAEndSlate` | `brand_cta` |

This arc is the expected output of `selectPrimitive` over the AeroSpin brief + fan material, **not** a hardcoded sequence — change the sample or material and the recipe changes (verified by §11).

---

## 14. Module / service boundaries (summary)

```text
Evidence side (no pixels):
  analyze-evidence-timeline.py ─▶ VisualEvidenceTimeline ─▶ VisualElementGraph ─▶ StructureTemplate
  SourceUnderstandingService   ─▶ SourceVideoUnderstanding (only when a distinct source_video is given)
  OpenWorldSlotInductionService ─▶ InducedVisualSlot[] ─▶ SlotMatchingService ─▶ SlotMapping[]
  GapDetectionService ─▶ GapReport ─▶ GapFillService ─▶ FillPlan

Material side (gate to canvas):
  MaterialPolicyService (R1..R5) ─▶ clip.material { kind, assetIds, sourceShotIds?, policy }
  TargetMaterialManifest (AeroSpin fan AIGC assets + provenance)

Compiler (the fence):
  buildRenderRecipe(template, elementGraph, sourceUnderstanding?, slotMapping, gapReport,
                    fillPlan, targetManifest, productBrief, capabilities)
    └─ selectPrimitive(slot, evidence, material, capabilities) per clip → primitiveReason
  ─▶ RenderRecipe @ timeline.renderPlan.renderRecipe

Renderers (read recipe only):
  RemotionRecipeRenderer   (rendererTarget=remotion_recipe)   PRIMARY visual layer
  FFmpeg                   (rendererTarget=ffmpeg)            source cut/crop/zoom + concat/mux + BGM + preview + final MP4
  HyperFrames              (rendererTarget=hyperframes_recipe) optional artifact or SKIPPED_HYPERFRAMES.md

Verification:
  render-quality gate (reads generation.timeline → renderPlan.renderRecipe)
  diversity eval (Demo A vs Demo B: layout_ncc + primitive_seq_similarity + subtitle_identity)
```

The boundary discipline is the whole point: **structure flows left-to-right and never draws; material flows top-down through the policy gate; the recipe is the single contract; renderers read it and only it.** This is what turns the v1.2 mold into a source-first engine.

See [requirements.md](./requirements.md) for the FR/NFR list, [schemas/render-recipe.schema.json](./schemas/render-recipe.schema.json) for the authoritative contract, and [tasks.md](./tasks.md) for the 11 implementation steps.
