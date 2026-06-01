# Demo Playbook — Spec v1.3

Source-first RenderRecipe Engine. Use this playbook for the final submission, judge walkthroughs, and final recording.

This supersedes [spec_v2/demo-playbook.md](../spec_v2/demo-playbook.md) as the active runbook for the v1.3 final demo. Everything spec_v2 says that v1.3 does not override (UI tour, motion-graph target-asset before/after, AIGC safety story) is still valid as broader product context. The contracts and gates here are authoritative for the locked final demo:

- RenderRecipe contract: [schemas/render-recipe.schema.json](./schemas/render-recipe.schema.json)
- Requirements: [requirements.md](./requirements.md)
- Design: [design.md](./design.md)
- Tasks: [tasks.md](./tasks.md)
- Test plan / gates: [test-plan.md](./test-plan.md)

---

## 1. One-sentence demo story

```text
我让系统从一个爆款剪辑里只学“结构”——hook 节奏、黑红黄字幕语法、hero 运动母题、卡点冲击闪、CTA——
然后把这套结构迁移到一个全新的产品（AeroSpin 便携涡轮小风扇）上：
新素材来自目标素材包（真实 Gemini AIGC 生成、带 provenance 标注），不是复制样例的任何一帧、一秒音频或水印；
系统编译出一份 RenderRecipe，渲染器只读这份配方出像素，每个片段都带可审计的 primitiveReason。
最后我用两个不相关的样例（editing.mov 和 motion_graph_1.mov）证明输出不是同一个模具。
```

This is the core scoring story: **transfer structure to NEW material**, not reproduce a mold. The v1.3 demo exists because the v1.2 product was proven to render a sample-blind mold — every `beat_cut` input collapsed to one identical 6-primitive sequence with hardcoded subtitles and fixed FFmpeg geometry (cross-brief layout cross-correlation 0.868–1.000, primitive-sequence similarity 1.00). See `docs/artifacts/render_overfit_findings/REPORT.md`. v1.3 fixes this with five hard principles (source-first, recipe-driven renderers, one reliable vertical, beat_cut as style source only, no video-gen model in the critical path).

---

## 2. The locked final demo

| Field | Value |
|---|---|
| Product | **AeroSpin 便携涡轮小风扇** (portable turbo fan), fictional brand |
| Output | 9:16, ~15s high-conversion product ad |
| Sample (structure evidence only) | `test_videos/manual/editing.mov` (beat_cut style source) |
| Anti-overfit second sample | `test_videos/motion_graph_1.mov` (unrelated structure) |
| Target material | `docs/fixtures/final_aerospin_fan/` — real Gemini AIGC fan assets, `materialRole=aigc_generated_material` |
| Optional real source video | `test_videos/manual/fan_product_demo.mp4` (only if a real one is ever supplied) |
| Render contract | `timeline.renderPlan.renderRecipe` (`render-recipe-v1`) |
| Renderers | Remotion (primary visual layer) + FFmpeg (cut/crop/concat/mux/preview/fallback) + HyperFrames (optional artifact) |

### 2.1 Expected clip arc

The RenderRecipe for the editing.mov demo SHOULD compile to roughly this arc. Exact `selectedPrimitive` per clip MUST come from evidence + material + capabilities, never from `role` alone, and every clip MUST carry a human-auditable `primitiveReason`.

```text
0.0–2.5s   hook        FanHeroSpin             (product category=fan + prompt mentions fan/spin/wind)
2.5–5.5s   setup       TypographyLayoutSequence (OCR/typography evidence with bbox + layout)
5.5–8.5s   body        FeatureCardStack         (target image set >= 3)
8.5–11.5s  proof       SourceClipBeatMontage    (if source moving shots >= 3) OR
                       DynamicProxyMontage + moving_material_missing gap (if no source clip)
11.5–13.0s transition  ImpactFlash              (impact/onset evidence on beat grid)
13.0–15.0s cta         CTAEndSlate              (CTA copy exists)
```

---

## 3. Toolchain — do this first, every session

System node is stale v12; ffmpeg/ffprobe 8.1.1 + python3.11 (librosa/scenedetect/easyocr/faster_whisper/cv2) live in the `viral` conda env; node/npm are in nvm. Prefix PATH before any build/script:

```bash
export PATH="/home/pxli/.nvm/versions/node/v22.20.0/bin:/home/pxli/anaconda3/envs/viral/bin:$PATH"
node --version   # expect v22.20.0
ffmpeg -version  # expect 8.1.x
```

Build once:

```bash
npm install
npm run build
```

---

## 4. Generate the real Gemini AIGC fan fixture

The repo has **no real fan footage**. Procedural SVG placeholders were rejected (user decision 2026-05-31: "all things real, no mock/fake"). The chosen path is to generate the fan target assets with the **real Gemini 2.5 Flash Image provider (Nano Banana)**, provenance-labeled `materialRole=aigc_generated_material`. AeroSpin is a fictional brand, so an AIGC logo is permitted (this does NOT violate the no-fake-real-brand-logo rule — see [requirements.md](./requirements.md) safety section).

### 4.1 Opt-in flags and keys

Generation requires explicit opt-in and a key:

```bash
# .env (never committed)
AIGC_MATERIAL_FILL_ENABLED=true
AIGC_IMAGE_PROVIDER=google_gemini_image
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
GEMINI_API_KEY=<your_gemini_key>

# backup provider (only used if google_gemini_image fails)
AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream
SEEDREAM_ARK_API_KEY=<your_seedream_key>
SEEDREAM_ARK_MODEL=doubao-seedream-5-0-260128
SEEDREAM_WATERMARK=false
```

### 4.2 Provider order (live path)

```text
google_gemini_image  (gemini-2.5-flash-image / Nano Banana, preferred)
  → volcengine_seedream  (backup)
    → real error  (NEVER falls back to mock in the live path)
```

`mock_provider` is the deterministic default for CI/scripts only; it is never the live fixture path. Sample frames are NEVER sent to any external provider (`sampleFramesSentExternally=false`).

### 4.3 Build the fixture

```bash
# real external generation requires the explicit opt-in flag
node scripts/generate-final-aerospin-fixture.mjs --provider google_gemini_image --allow-external-aigc
```

This writes:

```text
docs/fixtures/final_aerospin_fan/
  fan_hero.png        product hero (FanHeroSpin / ProductHeroOrbit material)
  fan_card_01.png     feature card 1
  fan_card_02.png     feature card 2
  fan_card_03.png     feature card 3
  fan_card_04.png     feature card 4   (>= 4 cards so FeatureCardStack matches)
  logo.png            AIGC brand mark (fictional brand, AIGC-labeled)
  copy.json           product name, selling points, CTA copy
  manifest.json       target-material-manifest with materialRole=aigc_generated_material + provenance
```

Each generated asset records provenance: `provider`, `model`, `prompt`, `externalCallMade=true`, `sampleFramesSentExternally=false`, `materialRole=aigc_generated_material`. These are NOT user uploads and NOT a real product photo, and the manifest must say so.

**If `GEMINI_API_KEY` is missing or `--allow-external-aigc` is absent:** the script MUST error honestly (no silent mock, no placeholder PNGs). See §9.

---

## 5. The `demo:final` command

```bash
# full AeroSpin prompt; editing.mov is the style/structure source; fan fixture is the target material
npm run demo:final -- \
  --sample test_videos/manual/editing.mov \
  --target-manifest docs/fixtures/final_aerospin_fan/manifest.json \
  --prompt "把这段爆款剪辑的结构迁移到 AeroSpin 便携涡轮小风扇上：做一个 15 秒 9:16 高转化产品广告。开头用 hero 风扇旋转抓住注意力，节奏快、黑红黄大字幕清晰，依次讲清四个卖点：三档强风、超长续航、静音、便携可挂脖；结尾引导立即下单。学习样例的快剪节奏 / 卡点 / 冲击闪语法，但不要复制样例的任何画面、音频或水印。" \
  --out docs/artifacts/final_submission/demo_a_editing_fan
```

What `demo:final` does end to end:

1. Analyze the sample (`editing.mov`) for **structure evidence only** — PySceneDetect cuts + librosa beat grid + frame metrics + OCR/typography bbox + VisualElementGraph (hero motion, watermark separated out and never reproduced). No sample frame/audio/watermark is copied.
2. Load the target manifest, normalize the fan assets, and confirm `materialRole=aigc_generated_material` is renderable target material (R2/R5).
3. Run slot induction → SlotMapping → GapReport → FillPlan.
4. Compile the **RenderRecipe** (`render-recipe-v1`) at `timeline.renderPlan.renderRecipe`, running `selectPrimitive(slot, evidence, material, capabilities)` per clip and writing a `primitiveReason` for each.
5. Render the primary visual layer with **Remotion** (components consume `RenderRecipeClip` props only and never re-infer a primitive).
6. Use **FFmpeg** for source clip cut/crop/zoom, concat/mux, procedural BGM, preview-frame extraction, and the final 720x1280 MP4 (plus any fallback card).
7. Optionally emit a HyperFrames artifact (real html+manifest+preview if the CLI exists, otherwise `SKIPPED_HYPERFRAMES.md`).
8. Run the v1.3 gates (§7) and the anti-overfit diversity eval (§6.3).

---

## 6. Demo A and Demo B (anti-overfit)

The whole point of v1.3 is that the output is NOT a fixed mold. Prove it by running the **same fan target material** against **two unrelated structure samples** and showing the recipes diverge.

### 6.1 Demo A — editing.mov + fan assets

```bash
npm run demo:final -- \
  --sample test_videos/manual/editing.mov \
  --target-manifest docs/fixtures/final_aerospin_fan/manifest.json \
  --prompt "<full AeroSpin prompt from §5>" \
  --out docs/artifacts/final_submission/demo_a_editing_fan
```

### 6.2 Demo B — motion_graph_1.mov + the SAME fan assets

```bash
npm run demo:final -- \
  --sample test_videos/motion_graph_1.mov \
  --target-manifest docs/fixtures/final_aerospin_fan/manifest.json \
  --prompt "<full AeroSpin prompt from §5>" \
  --out docs/artifacts/final_submission/demo_b_motion_graph_fan
```

### 6.3 Diversity eval

```bash
npm run demo:final:diversity -- \
  --a docs/artifacts/final_submission/demo_a_editing_fan \
  --b docs/artifacts/final_submission/demo_b_motion_graph_fan \
  --out docs/artifacts/final_submission/diversity_eval
```

The diversity eval FAILs/WARNs if any of these hold across the two unrelated samples:

- layout NCC `>= 0.85`;
- primitive-sequence similarity `= 1.0`;
- identical subtitles across the two runs.

A healthy result shows the two recipes pick a **different primitive sequence and rhythm** because the evidence differs, even though the product, palette source intent, and target material are the same.

---

## 7. What a passing run looks like (v1.3 gates)

A passing `demo:final` run satisfies every gate. They live in [test-plan.md](./test-plan.md); the operator-visible summary:

```text
final.mp4 exists ......................... PASS
720x1280 ................................. PASS
14.5–15.5s duration ...................... PASS
renderRecipe exists (render-recipe-v1) ... PASS
every clip has primitiveReason ........... PASS
>=1 target material appears in render .... PASS
source-pixel usage > threshold ........... PASS  (or moving_material_missing PRESENT if no source)
sampleFrameCopyAllowed = false ........... PASS
sampleAudioCopyAllowed = false ........... PASS
watermark reproduced = false ............. PASS
product name visible ..................... PASS  (AeroSpin)
>=4 selling points visible ............... PASS
CTA visible .............................. PASS
RemotionRecipeRenderer produced visuals .. PASS
FFmpeg muxed final mp4 ................... PASS
ANTI-OVERFIT (A vs B) .................... PASS  (NCC < 0.85, primitive sim < 1.0, subtitles differ)
```

The single most important thing to point at: open `render-recipe.json`, scroll the `clips[]`, and read each `primitiveReason`. That string is the proof the renderer is evidence-driven, not `role -> primitive -> hardcoded pixels`.

---

## 8. Reading the final_submission artifact pack

The artifact pack is the judge-facing evidence. Layout:

```text
docs/artifacts/final_submission/
  demo_a_editing_fan/
  demo_b_motion_graph_fan/
  diversity_eval/
  FINAL_REPORT.md
  README.md
```

Each demo directory (`demo_a_editing_fan`, `demo_b_motion_graph_fan`) contains:

| Artifact | What it proves |
|---|---|
| `final.mp4` | The actual 720x1280 ~15s AeroSpin ad. Watch it first. |
| `render-recipe.json` | The single render contract (`render-recipe-v1`). Every clip's `selectedPrimitive` + `primitiveReason` + `material`. This is the heart of the submission. |
| `slot-mapping.json` | Target slots ↔ source shots / target assets, with status (matched / weak_match / missing) and reason. |
| `gap-report.json` | Honest gaps. If no source moving clip exists, `moving_material_missing` MUST appear here (R4). |
| `fill-plan.json` | How each gap is filled (source crop/zoom, FeatureCardStack, DynamicProxyMontage, CTAEndSlate, etc.). |
| `source-material-usage.json` | Which pixels are user/target material vs procedural; source-pixel usage ratio. Proves real material reached the canvas (P1/R2/R3). |
| `sample-copy-safety.json` | `sampleFrameCopyAllowed=false`, `sampleAudioCopyAllowed=false`, `watermarkReproduced=false`, `sampleFramesSentExternally=false`. |
| `quality-gates.json` | The §7 gate results, machine-readable. |
| `contact-sheets/` | Frame grids extracted from `final.mp4` so a reviewer can eyeball the arc without playing video. |
| `human-review-report.md` | Plain-language walkthrough: what the sample taught, what material filled each slot, what gaps remain, what is AIGC-generated. |

`diversity_eval/` contains the A-vs-B comparison (NCC matrix, primitive-sequence diff, subtitle diff) plus a side-by-side contact sheet.

`FINAL_REPORT.md` is the top-level narrative + honest remaining gaps. `README.md` is the index into the pack.

### 8.1 Provenance check for judges

Open `demo_a_editing_fan/render-recipe.json` and confirm:

- `sourcePolicy.sampleUse = "structure_evidence_only"` (editing.mov is evidence, not material);
- `sourcePolicy.targetAssetUse = "renderable_target_material"` (fan assets reach the canvas);
- `sourcePolicy.sampleFrameCopyAllowed = false` and `sampleAudioCopyAllowed = false`;
- at least one clip's `material.kind = "generated_target_asset"` with `policy = "renderable"` (the AIGC fan assets);
- the fan asset manifest tags them `materialRole=aigc_generated_material` with full provider/model/prompt provenance.

---

## 9. When a step needs a human

v1.3 never fakes its way past a missing dependency. Each blocker has an honest, specific behavior:

### 9.1 Missing real source video

There is no real fan footage in the repo. Demo A/B run WITHOUT `--source` and that is expected.

- If you do NOT pass `--source`: the proof slot uses `DynamicProxyMontage` and `gap-report.json` MUST keep `moving_material_missing` (R4 — no faking real footage). This is a passing state.
- If a real `test_videos/manual/fan_product_demo.mp4` is ever supplied: pass `--source test_videos/manual/fan_product_demo.mp4 --source-policy user_authorized`. A non-sample `user_authorized` source MUST become eligible render material (R2); if it has matched moving shots for the montage slot, the renderer MUST use source pixels (R3) and the proof slot upgrades to `SourceClipBeatMontage`.

### 9.2 Missing `GEMINI_API_KEY` / external opt-in

The fixture generator (§4) needs `GEMINI_API_KEY` and `--allow-external-aigc`.

- If the key is missing or the opt-in flag is absent: the generator errors honestly and writes no placeholder assets. It does NOT silently fall back to mock in the live path. The human must supply the key + opt-in, then re-run §4.3.
- For a fully offline dry-run of the pipeline plumbing (NOT the final submission), `--provider mock_provider` produces deterministic CI assets — clearly labeled and never presented as the real fixture.

### 9.3 Missing HyperFrames CLI

HyperFrames is an optional MG/HTML preview artifact, not a required renderer.

- If the HyperFrames CLI exists: the demo writes real `html` + `manifest` + `preview`.
- If it does not: the demo writes `SKIPPED_HYPERFRAMES.md` explaining the skip. HyperFrames MUST NOT be presented in the UI or report as a completed MP4 renderer while it is only a JSON stub. The final MP4 always comes from FFmpeg muxing the Remotion visual layer.

### 9.4 Fallback statement (if real providers are disabled for a walkthrough)

```text
当前这段是 deterministic fallback：用 mock provider 跑通 RenderRecipe → 渲染器 的数据契约，
目的是演示主流程和协议，不是最终提交产物。最终提交用真实 Gemini AIGC 素材 + 真实 FFmpeg/Remotion 渲染，
接入真实 provider 不改核心流程，只换 adapter。样例帧永远不外呼，生成素材永远带 provenance。
```

---

## 10. Final recording / submission checklist

- [ ] PATH prefix exported; `node --version` = v22.20.0; `ffmpeg` 8.1.x present;
- [ ] `npm run build` green;
- [ ] real Gemini AIGC fan fixture generated under `docs/fixtures/final_aerospin_fan/` with provenance;
- [ ] Demo A (`editing.mov` + fan assets) run to `final_submission/demo_a_editing_fan`;
- [ ] Demo B (`motion_graph_1.mov` + fan assets) run to `final_submission/demo_b_motion_graph_fan`;
- [ ] diversity eval run to `final_submission/diversity_eval`; A-vs-B NCC < 0.85, primitive sim < 1.0, subtitles differ;
- [ ] open `render-recipe.json`, read every `primitiveReason` out loud;
- [ ] point at `source-material-usage.json` (real material on canvas) and `sample-copy-safety.json` (no frame/audio/watermark copy, no sample frames sent external);
- [ ] play `final.mp4`: product name AeroSpin visible, >=4 selling points, CTA;
- [ ] confirm RemotionRecipeRenderer produced the visual layer and FFmpeg muxed the final MP4;
- [ ] read `FINAL_REPORT.md` honest remaining gaps (e.g. no real source footage → `moving_material_missing` kept; HyperFrames skipped if no CLI);
- [ ] typecheck / test / build / `demo:final` all run; remaining gaps stated honestly, nothing faked.
```