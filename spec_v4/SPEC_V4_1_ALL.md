# SPEC V4.1 ALL-IN-ONE


---

# Spec v4.1 最新完整规格 — Evidence-Faithful Atom Transfer Engine

这是**最新版本单独包**，不包含旧版 `spec_v3` 或单独的 `spec_v4` 目录。

## 一句话目标

系统从样例视频中抽取结构证据和可复用的 `TechniqueAtom`，匹配到用户新素材，识别缺口并补全，最终编译成 layer-based `RenderRecipe v4.1`，由 Remotion + FFmpeg 输出可看的新短视频。

核心不是“调用最多模型”，而是：

1. 定义视频结构；
2. 把样例结构迁移到新内容；
3. 素材不足时能识别缺口并补全；
4. 结果可解释、可调整、可展示；
5. 最终能产出 `final.mp4` / `final.remotion.mp4`。

## v4.1 相比 v4.0 的新增点

1. **Seedance 2.0** 加入 AIGC moving visual fill，但仍是 optional provider，不是核心依赖。
2. **Seedream 4.0** 加入静态海报、背景、封面、商品卡片生成。
3. **ElevenLabs** 加入音频智能栈：Scribe ASR、TTS、SFX、Music、Audio Isolation、Dubbing/Lip Sync。
4. 新增 provider policy、routing/fallback schema、generated asset provenance schema。
5. 明确所有 AIGC provider 都必须有 fallback，核心 demo 仍靠 Remotion + FFmpeg 跑通。
6. 强化安全边界：样例帧/音频默认不得进入最终画面，也不得默认作为 AIGC reference。

## 推荐阅读顺序

1. `00-executive-summary.md`
2. `requirements.md`
3. `architecture.md`
4. `design.md`
5. `model-stack.md`
6. `provider-policy.md`
7. `routing-and-fallbacks.md`
8. `renderer-spec.md`
9. `data-contracts.md`
10. `tasks.md`
11. `test-plan.md`
12. `codex-prompts.md`
13. `SPEC_V4_1_ALL.md`

## 目录说明

```text
schemas/      JSON schemas: evidence, atoms, assets, gap report, recipe, providers
examples/     sample JSON fixtures
prompts/      Codex/implementation prompts
reference/    model/provider reference notes
```

## Core statement

```text
Seedance 2.0 = optional AIGC video-fill provider
Seedream 4.0 = optional image/poster fill provider
ElevenLabs = optional audio intelligence provider
Remotion + FFmpeg = deterministic rendering backbone
TechniqueAtom + layer-based RenderRecipe = structure-transfer core
```


---

# 00. Executive Summary

## 目标

Spec v4.0 的目标是把系统从“结构说明写得像，但成片像换图模板”改到“样例结构证据能保真传递，并被 renderer 真正消费”。

一句话：

```text
学结构，不抄内容；拆原子，不套整模；编 layer，不猜 clip；能解释，能渲染，能验收。
```

## 当前已确认的主要问题

| ID | 问题 | v4 处理方式 |
|---|---|---|
| F1 | marketing analysis 有证据，template 层丢失 | `attachEvidenceToTemplate()` 统一 carry-forward |
| F2 | 3D ribbon 被识别但无人渲染 | `MotionAtomLayer` + Remotion ribbon + FFmpeg fallback |
| F3 | Remotion TypographyLayoutSequence 0 pics | `MediaLayer` / media-before-text render helper |
| F4 | CTA 结尾显示整段 prompt | `productName/ctaText/rawPrompt` 拆分 + sanitize |
| F5 | bbox/fontSize/animation 没进 recipe | `TextLayer.layout/typography/animation` 明确表达 |
| F6 | FFmpeg 复用第一个 hero bbox | `elementTrackId/slotInstanceId/evidenceRefs` layout strategy |
| F7 | 四个视频 primitive 相似 | `TechniqueAtom` + evidence-based primitive selection |
| F8 | BGM 像同一首底噪 | audioStructure 全链路保留 + style/layer/accent 驱动 synth |

## v4 架构关键

```text
VideoEvidenceBundle
  ↓
StructureTemplate + TechniqueAtoms
  ↓
AssetProfile + GapReport
  ↓
TransferPlan
  ↓
RenderRecipe v4 { clips[], layers[] }
  ↓
Remotion Layer Interpreter + FFmpeg mux/fallback
  ↓
final.mp4 / final.remotion.mp4 + evidence-fidelity report
```

## 原则

### 1. Evidence first

坐标、节奏、镜头、OCR/ASR、音频峰值等尽量由确定性工具产出。VLM/LLM 主要做命名、归纳、解释和映射，不做唯一事实来源。

### 2. Template is not enough; TechniqueAtoms matter

不能把整条样例压成一个粗 `videoType`。结构要拆成 TechniqueAtoms：字幕扫入、卡片堆叠、ribbon、impact flash、CTA slate、source montage 等。

### 3. Clip is time; Layer is pixels

clip 表示时间段和叙事 role，layer 才是真正渲染单位。一个 clip 可以包含 media/text/motion/audio 多层。

### 4. Renderer consumes recipe, not guesses structure

renderer 不应从 `role=hook` 重新猜组件。结构选择和 fallback 应该在 RenderRecipe 中显式表达。

### 5. Safety is invariant

样例视频只提供结构证据。默认 `sampleFrameCopyAllowed=false`、`sampleAudioCopyAllowed=false`。任何 sample pixel/audio 路径都不能进入 final material。

## 适合当前项目的范围

当前不要追求“万能视频生成器”。优先把三个 showcase 打强：

1. **Editing**：黑底红黄大字剪辑教程 / 卡点混剪。
2. **Marketing**：白底 3D ribbon 动态海报。
3. **Motion Graph**：黑红/蓝黑科技广告。

每个 showcase 都必须能展示：

```text
样例证据 → TechniqueAtoms → slot mapping → gap repair → layer recipe → final video
```


---

# 01. Source Alignment

本文件说明 v4 和官方课题要求、v1.3 现状、参考 arch 之间的关系。

## 1. 官方课题对齐

官方课题的关键不是“直接生成视频”，而是：

```text
样例理解 → 结构抽取 → 素材适配 → 结果生成
```

系统需要体现：

- 如何定义视频结构。
- 如何把样例结构迁移到新内容。
- 素材不足时如何识别缺口并合理补全。
- 结果是否可解释、可调整、可展示。
- 最终需要可验证产物：视频 demo / 分镜 / 时间线 / 对比展示。

v4 对应关系：

| 官方要求 | v4 模块 |
|---|---|
| 样例输入与解析 | Evidence Analyzer + Frame Sheet Builder |
| 脚本/节奏/包装结构拆解 | VideoEvidenceBundle + StructureTemplate |
| 结构沉淀 | TechniqueAtom Library |
| 新内容与素材输入 | Asset Analyzer |
| 素材缺口识别 | Gap Analyzer |
| 缺口补全 | FillPlan + repair strategy |
| 结构迁移与结果生成 | Transfer Planner + RenderRecipe Compiler |
| 迁移过程可视化 | Structure/Atom/Gap/Layer UI |
| 成片 demo | Remotion + FFmpeg renderers |
| 多版本 | version strategies: high_click/high_conversion/high_quality |
| 人工可调/自然语言改片 | timeline patch / recipe patch |

## 2. v1.3 当前状态对齐

v1.3 已经做对了这些：

- “学结构，不抄内容”的安全边界。
- 确定性证据 + VLM grounding 的感知层。
- `StructureTemplate -> generateMigrationResult -> timeline -> RenderRecipe` 的主线。
- `RenderRecipe` 作为唯一渲染契约的方向。
- FFmpeg canonical + Remotion secondary renderer。
- quality gates 与 layout NCC 反 overfit 指标。

v1.3 的主要不足：

| 当前不足 | v4 改造 |
|---|---|
| non-beat fallback template 丢 visual/typography/audio evidence | `attachEvidenceToTemplate` 统一 evidence carry-forward |
| RenderRecipe clip-only，不能表达 media/text/motion/audio 细节 | backward-compatible `layers[]` |
| motionAtoms 停在 gap/renderPlan | `MotionAtomLayer` + renderer consumption |
| Remotion TypographyLayoutSequence 只画字 | `RenderMediaLayer` + text overlay |
| CTA 使用 raw prompt | productTheme 字段拆分 + sanitize |
| 字幕固定居中/字号固定 | TextLayer bboxNorm/fontSizeRatio/keyframes |
| elementGeometry 复用第一个 hero bbox | evidenceRefs/track-aware layout strategy |
| primitive vocabulary 太小 | TechniqueAtoms + component variants |
| procedural audio 参数过近 | audioStructure-driven synth |

## 3. 从参考 arch 中应该学习什么

可学习：

- Monorepo + shared schemas。
- Frame sheet builder，让 VLM 看结构而不是盲猜原视频。
- TechniqueAtom / Structure Knowledge Base。
- Asset Analyzer + Gap Analyzer。
- Timeline UI / Layer tracks。
- Remotion 做 motion graphics，FFmpeg 做素材处理和 mux。

暂时不建议照搬：

- PostgreSQL / Redis / BullMQ / Prisma / MinIO 全套基础设施。
- 复杂 worker 拆分。
- 过早引入权限、账户、项目管理等产品功能。

当前更有效的路径：

```text
先把 local artifact pipeline 做通：JSON + files + scripts + existing API。
然后再把 UI 和后端 job 化。
```

## 4. v4 的取舍

v4 不是“论文式完整架构”，而是“参赛项目能工作”的工程规格。

优先级：

1. 证据不丢。
2. renderer 真消费。
3. final video 好看且可解释。
4. UI 能让评委看懂迁移链路。
5. 再做队列、数据库、部署扩展。


## v4.1 model/provider alignment

- 比赛/导师强调没有生视频模型资源，主要提供语言模型资源，因此 v4.1 把 Seedance 2.0 设为 optional，不作为核心闭环依赖。
- 课题要求交付代码、演示视频、视频产物 case、项目说明文档；v4.1 包含 AI 架构、工具协议、RenderRecipe 数据协议、provider policy 和安全边界。
- 评分强调迁移过程可视化、素材缺口补全、多版本、真实素材适配和人工可调；v4.1 对这些点分别定义了 UI 页面、GapReport、VersionStrategy、AssetProfile 和 Natural Edit Patch。


---

# 02. Requirements

## 1. Product Goal

用户上传一条或多条样例视频，再上传新主题/商品信息/素材，系统自动分析样例结构，沉淀创作原子，匹配新素材，识别缺口并补全，生成新短视频。

## 2. User Stories

### US1: 样例学习

用户上传样例视频，系统展示：

- 基础信息：时长、fps、分辨率、音频、封面。
- 镜头结构：shot timeline、cut density、climax。
- 节奏结构：beat grid、energy curve、accent。
- 字幕结构：OCR/ASR、bbox、字号、动画。
- 包装结构：贴纸、卡片、ribbon、UI panel、CTA。
- TechniqueAtoms：可复用创作原子。

### US2: 新素材输入

用户上传：

- 图片：商品图、logo、截图、海报。
- 视频：产品使用、人物、场景、口播、长素材。
- 文案：商品名、卖点、CTA、风格要求。
- 可选：目标版本 high_click / high_conversion / high_quality。

系统输出 AssetProfile。

### US3: Gap Report

系统展示每个 slot/atom 的匹配情况：

- matched。
- weak_match。
- missing。

每个 gap 必须说明：

```text
缺什么 → 为什么缺 → 影响什么 → 用什么策略补 → 结果会长什么样
```

### US4: 视频生成

系统输出：

- script / storyboard / timeline / render recipe。
- `final.mp4`。
- `final.remotion.mp4`。
- preview frames。
- structure diff。

### US5: 人工可调

至少支持一种：

- 改 hook 强度。
- 改卖点顺序。
- 改包装风格。
- 改节奏。
- 改 CTA。

### US6: 自然语言改片

最小支持：

```text
“开头更抓人一些”
“减少字幕，增强节奏感”
“把商品信息提前”
```

输出 recipe patch，并重新渲染。

## 3. P0 Requirements

### P0.1 Evidence Analyzer

必须输出：

- `analysis.json`。
- frame sheets。
- shot timeline。
- beat/energy summary。
- typographyEvidence。
- visualElementGraph。
- motionAtoms。
- audioStructure。

如果没有识别到某类 evidence，必须写 explicit empty reason。

### P0.2 Template Evidence Carry-forward

`buildBeatCutTemplate()` 和 `buildFallbackTemplate()` 都必须保留：

- heroDescriptor。
- typographyEvidence。
- visualElementGraph。
- audioStructure。
- renderPlan.motionAtoms。
- evidenceRefs/sourceEvidence。

### P0.3 Layer-based RenderRecipe

保留 `clips[]`，新增 `layers[]`：

- MediaLayer。
- TextLayer。
- MotionAtomLayer。
- ShapeLayer。
- TransitionLayer。
- AudioLayer。

### P0.4 Renderer Must Consume Layers

Remotion：

- render media/image/video。
- render text with bbox/font size。
- render parametric ribbon。
- render CTA safely。

FFmpeg：

- source video cut/crop/mux。
- image overlay fallback。
- text draw fallback。
- motion atom 2D fallback。
- procedural audio from audioPlan。

### P0.5 Safety

必须满足：

```text
sampleFrameCopyAllowed = false
sampleAudioCopyAllowed = false
sample asset path not in final material.assetIds
provenance preserved
```

## 4. P1 Requirements

- TechniqueAtom extraction。
- Evidence-based primitive selection。
- Element track-aware layout。
- AudioPlan fidelity。
- 多版本 generation。
- UI 展示 mapping/gap/layer。

## 5. P2 Requirements

- Natural language editing。
- Fine-grained timeline editor。
- Structure KB search/retrieval。
- 自动评估和可视化质量报告。
- 可选数据库/队列化部署。

## 6. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Local deploy | `pnpm install && pnpm demo:final` or documented equivalent |
| Determinism | fixtures/golden tests deterministic |
| No silent fallback | every dropped evidence has reason |
| Explainability | every clip/layer has evidenceRefs or fallbackReason |
| Runtime | speed not primary; should complete demo cases reliably |
| Cost control | no external paid API in tests unless explicitly enabled |
| Security | no API keys committed; no sample copy |

## 7. Hard Definition of Done

1. `marketing` template preserves non-empty evidence.
2. `marketing` recipe has media/text/motion/audio layers.
3. Remotion no longer outputs 0 pics for image-bearing recipe.
4. CTA safe.
5. MotionAtom rendered.
6. Typography fidelity improved.
7. Element geometry not over-reused.
8. Primitive diversity across cases.
9. Audio diversity across cases.
10. Final MP4s render for at least marketing + one other case.


---

# 03. Architecture

## 1. End-to-End Pipeline

```text
Sample Video
  ↓
[1] Evidence Analyzer
    ffprobe / scene detection / optical flow / OCR / ASR / beat / frame sheets
  ↓
VideoEvidenceBundle
  ↓
[2] Structure + Atom Extractor
    StructureTemplate + TechniqueAtoms
  ↓
User Assets + Prompt
  ↓
[3] Asset Analyzer
    AssetProfile[]
  ↓
[4] Slot Matcher + Gap Analyzer
    GapReport + FillPlan
  ↓
[5] Transfer Planner
    selected atoms + narrative arc + version strategy
  ↓
[6] RenderRecipe Compiler
    layer-based RenderRecipe v4
  ↓
[7] Renderer
    Remotion visual layers + FFmpeg mux/fallback
  ↓
final.mp4 + final.remotion.mp4 + preview frames
  ↓
[8] Evaluation + UI
    fidelity gates + no-copy gates + diversity gates
```

## 2. Module Responsibilities

### 2.1 Evidence Analyzer

Responsible for accurate low-level facts:

- video metadata。
- shot boundaries。
- motion energy。
- beat grid。
- OCR/ASR text timing。
- visual element candidates。
- frame sheets。

### 2.2 Structure + Atom Extractor

Converts evidence into:

- script structure。
- rhythm structure。
- packaging structure。
- template slots。
- TechniqueAtoms。

### 2.3 Asset Analyzer

Analyzes user materials:

- image subject, saliency, colors。
- video shots and highlights。
- text selling points and CTA。
- provenance and renderability。

### 2.4 Gap Analyzer

Compares required slots/atoms with assets:

- matched / weak_match / missing。
- impact。
- repair options。
- selected fill plan。

### 2.5 Transfer Planner

Decides the new video:

- narrative arc。
- atoms used。
- material assignment。
- version strategy。
- fallback decisions。

### 2.6 RenderRecipe Compiler

Produces renderer-neutral contract:

- clips for time/role。
- layers for pixels/audio。
- evidenceSummary。
- sourcePolicy。
- warnings/droppedEvidence。

### 2.7 Renderer

Remotion:

- rich motion graphics。
- kinetic typography。
- ribbons。
- card stacks。
- CTA。

FFmpeg:

- source video slicing。
- image/video mux。
- final encode。
- fallback overlays。
- audio mix。

## 3. Recommended Repo Shape

Use current monorepo. Add modules incrementally:

```text
apps/
  web/
    src/components/
      analysis/
      knowledge/
      transfer/
      timeline/
      preview/
  api/
    src/routes/
    src/services/
    src/adapters/renderers.ts
    remotion/
      ViralRecipeRoot.tsx
      components/
        RenderLayer.tsx
        MediaLayer.tsx
        TextLayer.tsx
        MotionAtomLayer.tsx
        ParametricRibbonSurface.tsx
        KineticTypographySweep.tsx
        MediaCardCascade.tsx
        CTAEndSlate.tsx

packages/
  shared/
    src/engine/
      planner.ts
      techniqueAtoms.ts
      assetAnalyzer.ts
      gapAnalyzer.ts
      transferPlanner.ts
      renderRecipeCompiler.ts
      fidelity.ts
    src/schemas/
      video-evidence.schema.json
      technique-atom.schema.json
      structure-template.schema.json
      asset-profile.schema.json
      gap-report.schema.json
      render-recipe-v4.schema.json
    src/types.ts

scripts/
  analyze-evidence-timeline.py
  inspect-learning-fidelity.mjs
  render-case.mjs
  run-learn-samples.mjs
  evaluate-render-quality.mjs
  diversity_ncc.py

docs/spec_v4/
```

## 4. Optional Later Infrastructure

Do not block v4 on these:

```text
PostgreSQL
Redis
BullMQ
Prisma
MinIO
Kubernetes
```

They are valuable only after artifact pipeline works.

## 5. Main Runtime Flows

### Flow A: Learn sample

```text
POST /api/videos/:id/analyze
  → analysis.json
  → frame sheets
  → StructureTemplate
  → TechniqueAtoms
  → fidelity report
```

### Flow B: Generate from new content

```text
POST /api/projects/:id/transfer
  → analyze assets
  → match slots
  → gap report
  → transfer plan
  → render recipe
```

### Flow C: Render

```text
POST /api/transfer-plans/:id/render?target=remotion
POST /api/transfer-plans/:id/render?target=ffmpeg
```

### Flow D: Edit

```text
POST /api/edits/natural-language
  input: instruction + recipe
  output: recipe patch + diff + rerender option
```

## 6. Artifact Layout

```text
artifacts/
  learned_samples_max/
    marketing/
      analysis.json
      learned-template.json
      gap-report.json
      timeline.json
      render-recipe.json
      final.mp4
      final.remotion.mp4
      evidence-fidelity.json
      previews/
    editing/
    motion_graph_1/
    motion_graph_2/
```

## 7. Error Handling Principle

No silent empty.

Every empty/dropped/fallback path must produce one of:

```json
{
  "kind": "typographyEvidence",
  "stage": "template",
  "reason": "no OCR detected or OCR unavailable",
  "severity": "info"
}
```

or fatal if it indicates a bug.


---

# 04. Design: Core Protocols

## 1. VideoEvidenceBundle

`VideoEvidenceBundle` is the single source of low-level evidence.

```ts
export type VideoEvidenceBundle = {
  version: "evidence-v4";
  sampleId: string;

  meta: {
    durationSec: number;
    fps: number;
    width: number;
    height: number;
    aspectRatio: "9:16" | "16:9" | "1:1" | string;
  };

  shots: Array<{
    id: string;
    startSec: number;
    endSec: number;
    durationSec: number;
    thumbnailPath?: string;
    motionScore: number;
    sceneChangeType: "hard_cut" | "soft_cut" | "fade" | "unknown";
    sourceFrameRefs: string[];
  }>;

  rhythm: {
    bpm?: number;
    beatTimestampsSec: number[];
    onsetTimestampsSec: number[];
    energyCurve: Array<{ t: number; value: number }>;
    cutDensity: number;
    climaxRanges: Array<[number, number]>;
  };

  typographyEvidence: Array<{
    id: string;
    startSec: number;
    endSec: number;
    text?: string;
    role?: "headline" | "subtitle" | "badge" | "cta" | "price" | "unknown";
    bboxNorm: { x: number; y: number; w: number; h: number };
    fontSizeRatio?: number;
    color?: string;
    stroke?: boolean;
    shadow?: boolean;
    animationHint?: "pop" | "scale" | "flash" | "sweep" | "slide" | "typewriter" | "none";
    evidenceRefs: string[];
  }>;

  visualElementGraph: {
    elements: Array<{
      id: string;
      family:
        | "hero_object"
        | "media_card"
        | "ribbon"
        | "ui_panel"
        | "badge"
        | "sticker"
        | "watermark"
        | "background"
        | "unknown";
      startSec: number;
      endSec: number;
      bboxTrack: Array<{ t: number; bboxNorm: { x: number; y: number; w: number; h: number } }>;
      motionPattern?: "orbit" | "slide" | "spin" | "scale_pop" | "sweep" | "static" | "unknown";
      confidence: number;
      labelSource: "cv" | "ocr" | "vlm" | "hybrid";
    }>;
    relations: Array<{ from: string; to: string; type: "overlays" | "follows" | "syncs_with" | "masks" | "near" }>;
  };

  motionAtoms: Array<{
    id: string;
    type:
      | "parametric_ribbon_surface"
      | "text_sweep_mask"
      | "card_orbit"
      | "hero_spin"
      | "impact_flash"
      | "light_sweep";
    startSec: number;
    endSec: number;
    params: Record<string, unknown>;
    evidenceRefs: string[];
  }>;

  audioStructure: {
    estimatedLayers: Array<{
      kind: "kick" | "bass" | "hat" | "drone" | "riser" | "impact" | "voice" | "music";
      weight: number;
      accentPattern?: number[];
    }>;
    style?: "beat_cut_dark" | "marketing_glossy" | "motion_graph_ambient" | "unknown";
  };

  frameSheets: {
    globalSheet?: string;
    shotSheet?: string;
    transitionSheet?: string;
    textSheet?: string;
    motionSheet?: string;
  };

  safety: {
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
    watermarkRegions?: Array<{ bboxNorm: { x: number; y: number; w: number; h: number } }>;
  };
};
```

## 2. TechniqueAtom

TechniqueAtoms are reusable creative units.

```ts
export type TechniqueAtom = {
  id: string;
  name: string;
  category: "hook" | "rhythm" | "typography" | "transition" | "motion_graph" | "poster" | "cta" | "audio" | "layout";
  sourceSampleId: string;
  sourceEvidenceRefs: string[];

  visualPattern: {
    family:
      | "kinetic_typography"
      | "image_card_orbit"
      | "ribbon_poster"
      | "product_hero"
      | "source_montage"
      | "impact_flash"
      | "feature_card_stack"
      | "cta_slate";
    description: string;
    colorPalette?: string[];
    layoutMotif?: string;
    motionMotif?: string;
  };

  timingPattern: {
    startRole?: "opening" | "middle" | "climax" | "ending";
    durationRangeSec: [number, number];
    beatSync?: boolean;
    cutDensity?: "low" | "medium" | "high";
    accentBeats?: number[];
  };

  requiredAssets: Array<{
    role: "hero_image" | "source_video_shots" | "media_cards" | "logo" | "selling_points" | "background" | "cta_text" | "audio";
    type: "image" | "video" | "text" | "audio" | "generated" | "none";
    minCount: number;
    importance: "low" | "medium" | "high";
  }>;

  renderer: {
    preferred: "remotion" | "ffmpeg";
    component:
      | "KineticTypographySweep"
      | "ParametricRibbonSurface"
      | "MediaCardCascade"
      | "ProductPosterHero"
      | "SourceClipBeatMontage"
      | "FeatureCardStack"
      | "ImpactFlash"
      | "CTAEndSlate";
    fallbackComponent?: string;
  };

  transferRules: {
    canUseTargetImages: boolean;
    canUseSourceVideo: boolean;
    canUseAigcFill: boolean;
    samplePixelsAllowed: false;
    fallbackStrategies: Array<"structure_reorder" | "text_fill" | "packaging_fill" | "aigc_fill" | "asset_reuse" | "procedural_motion">;
  };
};
```

## 3. StructureTemplate

```ts
export type StructureTemplate = {
  version: "structure-template-v4";
  id: string;
  sourceSampleIds: string[];
  videoType: "editing_tutorial" | "marketing_poster" | "motion_graph_ad" | "product_ad" | "mixed";

  scriptStructure: Array<{
    id: string;
    role: "hook" | "setup" | "proof" | "demo" | "benefit" | "climax" | "cta" | "outro";
    startSec: number;
    endSec: number;
    viewerPurpose: string;
    sourceEvidenceRefs: string[];
  }>;

  rhythmStructure: {
    bpm?: number;
    beatGridSec: number[];
    avgShotDurationSec: number;
    cutDensity: "low" | "medium" | "high";
    fastZones: Array<[number, number]>;
    climaxRanges: Array<[number, number]>;
  };

  packagingStructure: {
    colorPalette: string[];
    typographySystem: {
      textTracks: string[];
      dominantPlacements: Array<"center" | "top" | "bottom" | "left" | "right" | "diagonal">;
      fontSizeRangeRatio: [number, number];
      animationHints: string[];
    };
    motionAtoms: VideoEvidenceBundle["motionAtoms"];
    visualElementFamilies: Record<string, number>;
  };

  templateSlots: TemplateSlot[];
  techniqueAtoms: TechniqueAtom[];

  evidenceSummary: {
    visualElements: number;
    typographyRuns: number;
    motionAtoms: number;
    audioLayers: number;
    heroDescriptors: number;
  };

  safety: {
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
  };
};
```

## 4. AssetProfile

```ts
export type AssetProfile = {
  id: string;
  kind: "image" | "video" | "text" | "audio" | "generated";
  uri?: string;
  text?: string;

  provenance: {
    source: "user_uploaded" | "aigc_generated" | "fixture" | "source_video" | "sample_evidence";
    sampleDerived: boolean;
    renderable: boolean;
    notes?: string;
  };

  image?: {
    subject?: "product" | "person" | "scene" | "logo" | "screenshot" | "unknown";
    bboxNorm?: { x: number; y: number; w: number; h: number };
    dominantColors?: string[];
    suitableFor: Array<"hero" | "card" | "background" | "cta" | "cover">;
  };

  video?: {
    shots: Array<{
      id: string;
      startSec: number;
      endSec: number;
      motionScore: number;
      suitableFor: Array<"opening" | "demo" | "proof" | "transition" | "cta">;
    }>;
    highlights: Array<{ startSec: number; endSec: number; reason: string }>;
  };

  textFeatures?: {
    sellingPoints: string[];
    ctaCandidates: string[];
    keywords: string[];
    subtitleCandidates: string[];
  };
};
```

## 5. GapReport

```ts
export type GapReport = {
  version: "gap-report-v4";
  gaps: Array<{
    id: string;
    slotId: string;
    atomId?: string;
    status: "matched" | "weak_match" | "missing";
    requiredAsset: string;
    matchedAssetIds: string[];
    reason: string;
    impact: "low" | "medium" | "high";
    repairOptions: Array<{
      type: "structure_reorder" | "text_fill" | "packaging_fill" | "aigc_fill" | "asset_reuse" | "procedural_motion";
      description: string;
      selected: boolean;
      expectedVisualResult: string;
    }>;
  }>;
};
```

## 6. RenderRecipe v4

```ts
export type RenderRecipe = {
  version: "render-recipe-v4";

  composition: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    aspectRatio: "9:16" | "16:9" | "1:1";
  };

  productTheme: {
    productName: string;
    brandName?: string;
    brief?: string;
    sellingPoints: string[];
    ctaText: string;
    generationPrompt?: string;
  };

  sourcePolicy: {
    sampleUse: "structure_evidence_only" | "authorized_reuse";
    sampleFrameCopyAllowed: false;
    sampleAudioCopyAllowed: false;
    sourceVideoUse: "missing" | "renderable_user_material";
    targetAssetUse: "renderable_target_material" | "missing";
  };

  evidenceSummary: {
    sourceSampleIds: string[];
    preservedEvidence: {
      visualElements: number;
      typographyRuns: number;
      motionAtoms: number;
      audioLayers: number;
    };
    droppedEvidence: Array<{ kind: string; stage: string; reason: string; severity: "info" | "warn" | "fatal" }>;
  };

  clips: Array<{
    id: string;
    role: "hook" | "setup" | "proof" | "demo" | "benefit" | "transition" | "cta";
    startSec: number;
    durationSec: number;
    atomIds: string[];
    layerIds: string[];
    primitiveReason: string;
    evidenceRefs: string[];
  }>;

  layers: Array<MediaLayer | TextLayer | ShapeLayer | MotionAtomLayer | TransitionLayer | AudioLayer>;
  warnings: string[];
};
```

## 7. Layer Types

### MediaLayer

```ts
export type MediaLayer = {
  id: string;
  type: "media";
  clipId: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  material: {
    kind: "source_video" | "target_image" | "target_image_set" | "generated_target_asset" | "procedural";
    assetIds: string[];
    sourceShotIds?: string[];
    policy: "renderable" | "missing" | "evidence_only";
    provenance: "user_uploaded" | "aigc_generated" | "source_video" | "fixture";
  };
  layout: {
    bboxNorm?: { x: number; y: number; w: number; h: number };
    fit: "cover" | "contain" | "heroFill" | "cardInset" | "backgroundFill";
    minAreaRatio?: number;
    safeArea?: "full" | "title" | "body" | "cta";
  };
  motion?: {
    pattern: "static" | "zoom" | "pan" | "orbit" | "spin" | "card_stack" | "hard_cut";
    beatAligned?: boolean;
    beatTimestampsSec?: number[];
    keyframes?: Array<{ t: number; x?: number; y?: number; scale?: number; rotate?: number; opacity?: number }>;
  };
  evidenceRefs: string[];
};
```

### TextLayer

```ts
export type TextLayer = {
  id: string;
  type: "text";
  clipId: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  text: {
    content: string;
    role: "headline" | "subtitle" | "badge" | "selling_point" | "cta" | "price";
    maxChars?: number;
  };
  layout: {
    bboxNorm: { x: number; y: number; w: number; h: number };
    align: "left" | "center" | "right";
    anchor?: "center" | "top-left" | "bottom-center";
  };
  typography: {
    fontSizeRatio: number;
    weight?: number;
    colorRole?: "primary" | "accent" | "on_dark" | "muted";
    color?: string;
    stroke?: { color: string; widthRatio: number };
    shadow?: { color: string; blurRatio: number; dxRatio: number; dyRatio: number };
    background?: { color: string; radiusRatio: number; paddingRatio: number };
  };
  animation: {
    enter?: "pop" | "scale" | "slide_left" | "slide_right" | "sweep" | "typewriter" | "none";
    exit?: "fade" | "slide" | "none";
    beatReactive?: { property: "scale" | "opacity" | "x" | "y" | "rotation"; amplitude: number; beatRefs: number[] };
  };
  evidenceRefs: string[];
};
```

### MotionAtomLayer

```ts
export type MotionAtomLayer = {
  id: string;
  type: "motion_atom";
  clipId?: string;
  zIndex: number;
  startSec: number;
  durationSec: number;
  atom:
    | {
        kind: "parametric_ribbon_surface";
        direction: "right_to_left" | "left_to_right";
        path: "s_curve_orbit" | "diagonal_sweep" | "horizontal_wave";
        thicknessRatio: number;
        twist: number;
        opacity: number;
        colorRoles: string[];
      }
    | {
        kind: "text_sweep_mask";
        targetTextLayerId: string;
        direction: "right_to_left" | "left_to_right";
        widthRatio: number;
        softnessRatio: number;
      }
    | { kind: "impact_flash"; intensity: number; beatRefs: number[] }
    | { kind: "light_sweep"; direction: "diagonal" | "horizontal" | "vertical"; opacity: number };
  fallback?: { renderer: "ffmpeg" | "remotion"; mode: "2d_svg" | "simple_overlay" | "skip"; reason: string };
  evidenceRefs: string[];
};
```

### AudioLayer

```ts
export type AudioLayer = {
  id: string;
  type: "audio";
  zIndex: number;
  startSec: number;
  durationSec: number;
  audio: {
    kind: "kick" | "bass" | "hat" | "drone" | "riser" | "impact" | "voice" | "music";
    policy: "procedural" | "user_audio" | "licensed" | "missing";
    weight: number;
    bpm?: number;
    accentPattern?: number[];
    atSec?: number[];
    densityCurve?: Array<{ t: number; value: number }>;
  };
  evidenceRefs: string[];
};
```

## 8. Compatibility Rules

1. Existing `recipe.clips[]` remains valid.
2. If `layers[]` exists, renderers should prefer layers.
3. If `layers[]` is missing, compile a best-effort layer view from old clips.
4. New fields should be optional where possible during migration, but gates should fail for learned sample cases if required evidence is missing.


---

# Model Stack v4.1

## 1. Required/core stack

These are required or strongly recommended for the core demo because they support deterministic structure transfer and local reproducibility.

| Layer | Primary | Backup | Role |
|---|---|---|---|
| Video metadata / mux | FFmpeg / FFprobe | — | duration, fps, waveform, final mux, fallback render |
| CV / video analysis | OpenCV, PySceneDetect, optical flow | frame-diff heuristics | scene cuts, motion energy, bbox tracks, visual candidates |
| Audio analysis | librosa | FFmpeg audio filters | BPM, onsets, beat grid, energy curve |
| ASR | faster-whisper | ElevenLabs Scribe in cloud mode | transcript, word timestamps, dialogue zones |
| OCR | PaddleOCR or EasyOCR | VLM OCR fallback | subtitle bbox, on-screen text, typography evidence |
| VLM | Gemini 3.1 Pro or Qwen3-VL | Doubao multimodal if available | frame-sheet interpretation, visual naming, material suitability |
| Text planner | Gemini 3.1 Pro / GPT-5 / Qwen3 | Doubao-Seed-2.0-lite | TechniqueAtoms, GapReport, TransferPlan, JSON normalization |
| Renderer | Remotion + FFmpeg | HyperFrames optional | layer-based motion graphics + final mp4 |

## 2. Optional AIGC visual providers

These are useful but must not be mandatory for core success.

| Use case | Preferred | Backup | Fallback without API |
|---|---|---|---|
| Missing moving visual insert | Seedance 2.0 | Veo 3.1, Kling 3.0, Runway Gen-4 | Remotion procedural motion + existing assets |
| Product-in-motion / hero motion | Seedance 2.0 image-to-video | Veo / Kling | product image + Remotion orbit/zoom/sweep |
| Cinematic motion background | Seedance 2.0 | Runway / Kling | procedural gradients, ribbons, particles |
| Static poster / background / cover | Seedream 4.0 | GPT Image 2, Nano Banana 2, FLUX | Remotion generated poster/card |
| CTA visual / product card | Seedream 4.0 | GPT Image 2, Nano Banana 2 | text + card + existing product image |

## 3. ElevenLabs audio stack

ElevenLabs should be used for audio intelligence and audio generation, not as the main visual video generator.

| Module | Provider | Use |
|---|---|---|
| ASR | ElevenLabs Scribe / Scribe Realtime | higher-quality transcript, timestamps, audio-event tags |
| TTS | ElevenLabs TTS | product ad voiceover, CTA narration, multilingual versions |
| SFX | ElevenLabs Sound Effects | whoosh, hit, riser, impact, UI clicks |
| Music | ElevenLabs Music | custom BGM bed matching style, mood, duration |
| Cleanup | ElevenLabs Audio Isolation | clean user source video audio |
| Dubbing | ElevenLabs Dubbing | multilingual localization |
| Lip Sync | ElevenLabs Lip Sync | optional talking-head insert only |

## 4. Provider classification

```ts
type ModelProviderRole =
  | "core_deterministic"
  | "core_ml"
  | "optional_aigc_visual"
  | "optional_aigc_audio"
  | "optional_quality_gate";
```

## 5. Recommended final stack

```text
Core:
- FFmpeg / FFprobe
- OpenCV / PySceneDetect / optical flow
- librosa
- faster-whisper
- PaddleOCR or EasyOCR
- Gemini 3.1 Pro or Qwen3-VL
- Doubao-Seed-2.0-lite as contest-provided LLM fallback
- Remotion + FFmpeg

Optional upgrades:
- Seedance 2.0 for missing moving visuals
- Seedream 4.0 for static poster/background/cover fill
- ElevenLabs Scribe for ASR
- ElevenLabs TTS for voiceover
- ElevenLabs Sound Effects for hits/whoosh/riser
- ElevenLabs Music for BGM
- ElevenLabs Audio Isolation for cleanup
- ElevenLabs Dubbing/Lip Sync for localization/talking-head cases
```

## 6. Why this is the right balance

The project is judged on structure migration,素材缺口处理,结果展示,多版本,真实素材适配, and人机协同. AIGC providers can improve missing assets and audio polish, but they should not hide or replace the structure-transfer system. The core demo must still work with local evidence extraction and Remotion/FFmpeg rendering.


---

# Provider Policy v4.1

## 1. Provider safety principles

1. Sample video pixels are evidence only.
2. Sample frames/audio must not be sent to AIGC providers unless the user explicitly marks them as authorized reusable material.
3. Generated assets must carry provenance.
4. Every generated asset must be labeled as generated in `AssetProfile.provenance` and `RenderRecipe.sourcePolicy`.
5. The final render must remain possible without optional paid providers.

## 2. Provider policy type

```ts
type ProviderPolicy = {
  provider: string;
  category: "text" | "vlm" | "image" | "video" | "audio" | "asr" | "ocr";
  requiredForCoreDemo: boolean;
  enabledByDefault: boolean;
  fallbackStrategy: string;
  provenanceRequired: true;
  sampleFramesAllowedAsInput: false;
  sampleAudioAllowedAsInput: false;
  userAssetsAllowedAsInput: boolean;
  generatedAssetLabelRequired: true;
  maxCostUsdPerRun?: number;
  maxDurationSec?: number;
  riskLevel: "low" | "medium" | "high";
};
```

## 3. Default policies

### Seedance 2.0

```json
{
  "provider": "seedance_2_0",
  "category": "video",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "remotion_motion_graph_plus_ffmpeg_mux",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": true,
  "generatedAssetLabelRequired": true,
  "maxDurationSec": 6,
  "riskLevel": "high"
}
```

### Seedream 4.0

```json
{
  "provider": "seedream_4_0",
  "category": "image",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "remotion_generated_poster_card",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": true,
  "generatedAssetLabelRequired": true,
  "riskLevel": "medium"
}
```

### ElevenLabs audio providers

```json
{
  "provider": "elevenlabs_music",
  "category": "audio",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "procedural_bgm_from_audio_layers",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": false,
  "generatedAssetLabelRequired": true,
  "riskLevel": "medium"
}
```

```json
{
  "provider": "elevenlabs_scribe",
  "category": "asr",
  "requiredForCoreDemo": false,
  "enabledByDefault": false,
  "fallbackStrategy": "local_faster_whisper",
  "provenanceRequired": true,
  "sampleFramesAllowedAsInput": false,
  "sampleAudioAllowedAsInput": false,
  "userAssetsAllowedAsInput": true,
  "generatedAssetLabelRequired": true,
  "riskLevel": "low"
}
```

## 4. Provenance fields

Every generated asset must include:

```ts
type GeneratedAssetProvenance = {
  source: "aigc_generated";
  provider: string;
  model?: string;
  promptHash: string;
  userPromptExcerpt?: string;
  generatedAt: string;
  sampleDerived: false;
  renderable: true;
  materialRole:
    | "aigc_video_fill"
    | "aigc_image_fill"
    | "aigc_voiceover"
    | "aigc_sound_effect"
    | "aigc_music";
};
```

## 5. Hard deny rules

The renderer and asset resolver must reject:

```text
- material.assetIds that point to sample frame paths
- AIGC requests that include sample frame/audio paths without explicit authorization
- generated assets without provenance
- raw prompts displayed in CTA or productTheme.name
- sample audio copied into final BGM
```


---

# Routing and Fallbacks v4.1

## 1. Router goals

The router should choose models by task, quality, cost, and availability. It must never block the core demo if an optional provider is missing.

## 2. Task routing table

| Task | Primary route | Fallback route | Local deterministic fallback |
|---|---|---|---|
| Structure VLM | Gemini 3.1 Pro | Qwen3-VL / Doubao multimodal | frame-sheet heuristics + OCR/CV evidence |
| JSON planning | Gemini 3.1 Pro / GPT-5 | Qwen3 / Doubao-Seed-2.0-lite | rule-based template compiler |
| ASR | faster-whisper | ElevenLabs Scribe | no transcript + OCR-only mode |
| OCR | PaddleOCR / EasyOCR | Qwen3-VL OCR | manual/empty typography with warning |
| Static image fill | Seedream 4.0 | GPT Image 2 / Nano Banana 2 | Remotion poster/card |
| Video fill | Seedance 2.0 | Veo 3.1 / Kling / Runway | Remotion motion atom layer |
| Voiceover | ElevenLabs TTS | provider-specific TTS | no voiceover + subtitle emphasis |
| Sound effects | ElevenLabs SFX | procedural SFX | FFmpeg generated hits/whooshes |
| Music | ElevenLabs Music | stock/user audio | procedural synth from AudioLayer |

## 3. Routing config

```ts
type ModelRoutingPolicy = {
  task: string;
  candidates: Array<{
    provider: string;
    model?: string;
    priority: number;
    enabled: boolean;
    maxCostUsd?: number;
    timeoutMs: number;
    fallbackOn: Array<"timeout" | "rate_limit" | "schema_error" | "empty_output" | "policy_block">;
  }>;
  deterministicFallback: {
    strategy: string;
    severity: "info" | "warn" | "fatal";
  };
};
```

## 4. Example route config

```json
{
  "task": "aigc_video_fill",
  "candidates": [
    {
      "provider": "seedance_2_0",
      "model": "seedance-2.0",
      "priority": 1,
      "enabled": false,
      "maxCostUsd": 2.0,
      "timeoutMs": 240000,
      "fallbackOn": ["timeout", "rate_limit", "policy_block"]
    },
    {
      "provider": "veo_3_1",
      "model": "veo-3.1",
      "priority": 2,
      "enabled": false,
      "maxCostUsd": 2.5,
      "timeoutMs": 240000,
      "fallbackOn": ["timeout", "rate_limit", "policy_block"]
    }
  ],
  "deterministicFallback": {
    "strategy": "render_motion_atom_with_remotion",
    "severity": "warn"
  }
}
```

## 5. Provider telemetry

All provider calls should log:

```ts
type ProviderCallTelemetry = {
  provider: string;
  model?: string;
  task: string;
  status: "success" | "failed" | "fallback_used" | "policy_blocked";
  latencyMs: number;
  estimatedCostUsd?: number;
  inputAssetIds: string[];
  outputAssetIds: string[];
  provenanceIds: string[];
  errorCode?: string;
};
```

## 6. Graceful degradation policy

If optional providers fail:

```text
Seedance unavailable -> Remotion motion-graph insert
Seedream unavailable -> Remotion generated poster/card
ElevenLabs Music unavailable -> procedural synth from audioPlan.layers
ElevenLabs TTS unavailable -> subtitles-only CTA
ElevenLabs Scribe unavailable -> faster-whisper
Gemini unavailable -> Qwen/Doubao or deterministic JSON compiler
```


---

# 05. Renderer Spec

## 1. Renderer Contract

Both Remotion and FFmpeg consume RenderRecipe. Renderer must not re-infer structure from `clip.role` except as explicit fallback.

Every renderer output should write a `render-log.json`:

```json
{
  "renderer": "remotion",
  "recipeVersion": "render-recipe-v4",
  "consumed": {
    "mediaLayers": 8,
    "textLayers": 9,
    "motionAtomLayers": 1,
    "audioLayers": 4
  },
  "fallbacks": [],
  "warnings": []
}
```

## 2. Remotion Renderer

### 2.1 Root Design

```tsx
export function ViralRecipeRoot({ recipe }: { recipe: RenderRecipe }) {
  if (recipe.layers?.length) {
    return <LayerRecipeRoot recipe={recipe} />;
  }
  return <LegacyClipRecipeRoot recipe={recipe} />;
}

function LayerRecipeRoot({ recipe }: { recipe: RenderRecipe }) {
  return (
    <AbsoluteFill>
      {recipe.layers
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((layer) => (
          <Sequence
            key={layer.id}
            from={secToFrame(layer.startSec)}
            durationInFrames={secToFrame(layer.durationSec)}
          >
            <RenderLayer layer={layer} recipe={recipe} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
}
```

### 2.2 Required Components

| Component | Required for | Notes |
|---|---|---|
| `RenderMediaLayer` | image/video/procedural backgrounds | Uses asset resolver; failures logged |
| `RenderTextLayer` | all text | Uses bboxNorm/fontSizeRatio |
| `RenderMotionAtomLayer` | ribbon/sweep/flash | Dispatches by atom.kind |
| `ParametricRibbonSurface` | marketing ribbon | 2.5D SVG/CSS first; three.js optional later |
| `KineticTypographySweep` | text sweep / kinetic title | Should be visible, not just animationHint |
| `MediaCardCascade` | card stack / image orbit | Uses multiple assets |
| `ProductPosterHero` | product poster hero | image + title + badge |
| `CTAEndSlate` | final CTA | safe productName + ctaText only |

### 2.3 Fix: TypographyLayoutSequence with Media

If legacy clip has:

```json
{
  "selectedPrimitive": "TypographyLayoutSequence",
  "material": { "assetIds": ["..."] }
}
```

Then Remotion must render media first and overlay text. It cannot output 0 pics.

### 2.4 TextLayer Layout

`bboxNorm` to CSS:

```ts
const style = {
  position: "absolute",
  left: `${bbox.x * 100}%`,
  top: `${bbox.y * 100}%`,
  width: `${bbox.w * 100}%`,
  height: `${bbox.h * 100}%`,
  fontSize: clamp(height * fontSizeRatio, min, max),
};
```

Animation mapping:

| animation.enter | Remotion behavior |
|---|---|
| `pop` | scale spring from .85 to 1 |
| `scale` | scale interpolate on beat |
| `slide_left` | x from -bbox.w to 0 |
| `slide_right` | x from +bbox.w to 0 |
| `sweep` | clip-path / mask reveal |
| `typewriter` | substring reveal |

### 2.5 CTA Safety

`CTAEndSlate` allowed fields:

- `productTheme.brandName` if safe。
- else `productTheme.productName`。
- `productTheme.ctaText`。

Forbidden fields:

- `generationPrompt`。
- `rawPrompt`。
- long `productTheme.name` from legacy prompt。

### 2.6 MotionAtom Rendering

Minimum for `parametric_ribbon_surface`:

- animated SVG path。
- direction right-to-left / left-to-right。
- opacity。
- thickness。
- color gradient。
- zIndex order。

## 3. FFmpeg Renderer

FFmpeg renderer should be pragmatic, not pixel-perfect to Remotion.

### 3.1 Responsibilities

- source video cut/crop/concat。
- image overlay。
- drawtext fallback。
- 2D ribbon/sweep fallback。
- audio synth and mix。
- final mux and encode。

### 3.2 MotionAtom Fallback

`parametric_ribbon_surface` fallback acceptable options:

1. Generate transparent PNG/SVG frames and overlay.
2. Use FFmpeg drawbox/drawgrid/geq for moving translucent band.
3. Render Remotion overlay video with alpha, then mux.

Must not silently skip.

### 3.3 Typography Fallback

FFmpeg should read:

- `TextLayer.layout.bboxNorm`。
- `TextLayer.typography.fontSizeRatio`。
- `TextLayer.animation.enter` where supported。

If not supported, write fallback reason.

### 3.4 Audio Synth

Audio synth must use `AudioLayer`:

- style。
- bpm。
- weights。
- accentPattern。
- riser/impact positions。
- densityCurve。

It should not use one fixed formula with tiny weight differences.

## 4. Renderer Consumption Matrix

| Field | Remotion | FFmpeg |
|---|---|---|
| `layers[].type=media` | full | full/fallback |
| `TextLayer.bboxNorm` | full | drawtext layout |
| `TextLayer.fontSizeRatio` | full | drawtext size |
| `MotionAtomLayer.parametric_ribbon_surface` | full 2.5D | fallback |
| `AudioLayer` | optional visualization / pass-through | full procedural mix |
| `productTheme.generationPrompt` | never display | never display |
| `sourcePolicy.sampleFrameCopyAllowed=false` | enforced | enforced |
| `provenance` | logged | logged |

## 5. Renderer Gates

- image-bearing layers count equals rendered media count or has warning.
- text layers rendered with non-default bbox if provided.
- motionAtoms consumed or fatal.
- CTA safe.
- no sample material rendered.


---

# 07. Data Contracts and Artifact Conventions

## 1. Artifact Directory

```text
artifacts/
  learned_samples_max/
    <case>/
      input/
        sample.mp4
        target-assets/
      analysis/
        analysis.json
        global_sheet.jpg
        shot_sheet.jpg
        transition_sheet.jpg
        text_sheet.jpg
        motion_sheet.jpg
      template/
        learned-template.json
        technique-atoms.json
      transfer/
        asset-profiles.json
        slot-mapping.json
        gap-report.json
        fill-plan.json
        transfer-plan.json
      render/
        timeline.json
        render-recipe.json
        render-log.ffmpeg.json
        render-log.remotion.json
        final.mp4
        final.remotion.mp4
        previews/
      eval/
        evidence-fidelity.json
        quality-gates.json
        diversity.json
```

Backward compatibility: if current repo stores files directly under case root, scripts should auto-detect both layouts.

## 2. ID Conventions

| Entity | Prefix |
|---|---|
| sample | `sample_` |
| shot | `shot_` |
| typography evidence | `typo_` |
| visual element | `ve_` |
| motion atom | `ma_` |
| technique atom | `atom_` |
| slot | `slot_` |
| asset | `asset_` |
| clip | `clip_` |
| layer | `layer_` |

## 3. EvidenceRefs

Evidence refs should use stable URI-like strings:

```text
evidence://sample_marketing/visual/ve_001
evidence://sample_marketing/typography/typo_003
evidence://sample_marketing/motion/ma_ribbon_001
evidence://sample_marketing/audio/layer_kick
```

Every TechniqueAtom and RenderRecipe layer should have at least one `evidenceRefs[]` or explicit `fallbackReason`.

## 4. Provenance

Renderable material provenance:

```ts
provenance.source:
  | "user_uploaded"
  | "source_video"
  | "aigc_generated"
  | "fixture"
```

Non-renderable evidence provenance:

```ts
provenance.source = "sample_evidence"
provenance.renderable = false
```

Rule:

```text
sample_evidence must never become MediaLayer.material.assetIds.
```

## 5. Product Theme Contract

Do not store raw prompt in display fields.

```ts
productTheme = {
  productName: "AeroSpin 便携涡轮小风扇",
  brandName: "AeroSpin",
  brief: "便携涡轮小风扇，高速降温",
  sellingPoints: ["小巧便携", "高转速", "长续航"],
  ctaText: "现在入手",
  generationPrompt: "raw prompt only for audit, never displayed"
}
```

Legacy compatibility:

```ts
productTheme.name = productTheme.productName
```

## 6. Fallback Reasons

Any unsupported evidence must generate:

```json
{
  "kind": "motionAtom:parametric_ribbon_surface",
  "stage": "ffmpeg_renderer",
  "reason": "full 3D unsupported; using 2D sweep overlay",
  "severity": "warn"
}
```

## 7. Fidelity Counts

Counts should be computed in a uniform way:

- `visualElements`: `visualElementGraph.elements.length` or family counts.
- `typographyRuns`: `typographyEvidence.length` or TextLayer count with bbox.
- `audioLayers`: `audioStructure.estimatedLayers.length` or AudioLayer count.
- `motionAtoms`: `motionAtoms.length` or MotionAtomLayer count.

## 8. Schema Compatibility

During migration:

- v1.3 recipe accepted。
- v4 recipe preferred。
- old clip fields compile into layers with `fallbackReason: "legacy_clip_migration"`。


---

# 06. API and CLI Spec

## 1. REST API

### Projects

```text
POST /api/projects
GET  /api/projects/:id
```

### Uploads

```text
POST /api/projects/:id/sample-videos
POST /api/projects/:id/assets
```

### Analysis

```text
POST /api/videos/:id/analyze
GET  /api/videos/:id/analysis
GET  /api/videos/:id/frame-sheets
GET  /api/videos/:id/structure-template
GET  /api/videos/:id/technique-atoms
```

### Transfer

```text
POST /api/projects/:id/transfer
GET  /api/transfer-plans/:id
GET  /api/transfer-plans/:id/gap-report
GET  /api/transfer-plans/:id/render-recipe
PATCH /api/transfer-plans/:id/recipe
```

### Render

```text
POST /api/transfer-plans/:id/render
GET  /api/render-jobs/:id
GET  /api/render-jobs/:id/download
GET  /api/render-jobs/:id/log
```

Query:

```text
?target=remotion|ffmpeg|both
?quality=preview|final
```

### Natural Edits

```text
POST /api/edits/natural-language
```

Input:

```json
{
  "recipeId": "recipe_xxx",
  "instruction": "开头更抓人一些",
  "mode": "patch_only"
}
```

Output:

```json
{
  "patch": [{ "op": "replace", "path": "/layers/3/text/content", "value": "3 秒抓住眼球" }],
  "explanation": "增强 hook 标题并缩短开头铺垫",
  "requiresRerender": true
}
```

## 2. Important Response Shapes

### Analysis Response

```json
{
  "videoId": "sample_marketing",
  "analysisPath": "artifacts/.../analysis.json",
  "frameSheets": {
    "globalSheet": ".../global_sheet.jpg",
    "shotSheet": ".../shot_sheet.jpg"
  },
  "summary": {
    "shots": 12,
    "typographyRuns": 24,
    "visualElements": 33,
    "motionAtoms": 1,
    "audioLayers": 4
  }
}
```

### Transfer Response

```json
{
  "transferPlanId": "tp_xxx",
  "templateId": "tmpl_xxx",
  "gapReportPath": ".../gap-report.json",
  "renderRecipePath": ".../render-recipe.json",
  "summary": {
    "clips": 9,
    "mediaLayers": 8,
    "textLayers": 9,
    "motionAtomLayers": 1,
    "audioLayers": 4
  }
}
```

## 3. CLI Scripts

### inspect-learning-fidelity

```bash
node scripts/inspect-learning-fidelity.mjs --case marketing
node scripts/inspect-learning-fidelity.mjs \
  --analysis artifacts/marketing/analysis.json \
  --template artifacts/marketing/learned-template.json \
  --timeline artifacts/marketing/timeline.json \
  --recipe artifacts/marketing/render-recipe.json
```

Output:

```json
{
  "case": "marketing",
  "status": "pass",
  "counts": {
    "analysis": { "visualElements": 33, "typographyRuns": 24, "audioLayers": 4, "motionAtoms": 1 },
    "template": { "visualElements": 33, "typographyRuns": 24, "audioLayers": 4, "motionAtoms": 1 },
    "recipe": { "mediaLayers": 8, "textLayers": 9, "motionAtomLayers": 1, "audioLayers": 4 }
  },
  "droppedEvidence": []
}
```

Fatal rules:

- analysis visual > 0 but template visual = 0。
- analysis typography > 0 but recipe TextLayer no bbox/fontSize。
- analysis motionAtoms > 0 but recipe renderer cannot consume。
- image-bearing TypographyLayoutSequence not rendering media。
- CTA display contains raw prompt。

### render-case

```bash
node scripts/render-case.mjs --case marketing --target both
node scripts/render-case.mjs --recipe artifacts/marketing/render-recipe.json --target remotion
```

### run-learn-samples

```bash
node scripts/run-learn-samples.mjs --cases marketing,editing,motion_graph_1,motion_graph_2
```

### evaluate-render-quality

```bash
node scripts/evaluate-render-quality.mjs --case marketing --strict v4
```

## 4. WebSocket Events

Optional:

```text
analysis.started
analysis.shots_done
analysis.frame_sheets_done
analysis.structure_done
transfer.gap_done
transfer.recipe_done
render.progress
render.done
render.failed
```

## 5. API Safety

Never return committed API keys. Environment config should be documented as:

```text
ARK_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

Do not put real secrets in docs or fixtures.


---

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


---

# 09. Implementation Tasks

## P0 — Make It Work

### T0.1 Baseline artifact inventory

- Locate learned sample artifacts.
- Record counts for marketing/editing/motion_graph_1/motion_graph_2.
- Run git status.

Acceptance:

```text
baseline report saved under artifacts/.../eval/baseline-fidelity.json
```

### T0.2 Evidence carry-forward

Files likely touched:

- `packages/shared/src/engine/planner.ts`
- `packages/shared/src/types.ts`

Tasks:

- Add `attachEvidenceToTemplate()`.
- Call from `buildBeatCutTemplate()` and `buildFallbackTemplate()`.
- Add tests.

Acceptance:

```text
marketing template visual > 0
typography > 0
audio > 0
motionAtoms > 0
```

### T0.3 ProductTheme sanitize

Files:

- planner prompt parsing.
- Remotion CTA component.
- shared utils maybe.

Tasks:

- Split productName/brandName/brief/ctaText/generationPrompt.
- Add sanitizeDisplayText.
- Update CtaSlate.
- Add tests.

Acceptance:

```text
CTA does not display raw prompt
productTheme.name length <= safe max
```

### T0.4 Layer-based RenderRecipe

Files:

- types.
- schemas.
- buildRenderRecipe.
- renderers.

Tasks:

- Add layers[] optional.
- Add MediaLayer/TextLayer/MotionAtomLayer/AudioLayer.
- Compile old clips to layers.
- Preserve old clips.

Acceptance:

```text
old recipe validates
new recipe validates
marketing recipe has layers[]
```

### T0.5 Remotion layer interpreter

Files:

- `apps/api/remotion/ViralRecipeRoot.tsx`
- new components under `apps/api/remotion/components/`

Tasks:

- `RenderLayer` dispatcher.
- `RenderMediaLayer`.
- `RenderTextLayer`.
- `RenderMotionAtomLayer`.
- legacy fallback.

Acceptance:

```text
TypographyLayoutSequence with assetIds renders media
TextLayer uses bbox/fontSize
MotionAtomLayer visible
```

### T0.6 FFmpeg fallback consumption

Files:

- `apps/api/src/adapters/renderers.ts`

Tasks:

- Use bbox/fontSize.
- Add motion atom fallback plan/log.
- Use audio layers.

Acceptance:

```text
render-log.ffmpeg.json records consumed motionAtoms/audioLayers
```

### T0.7 Fidelity script

File:

- `scripts/inspect-learning-fidelity.mjs`

Tasks:

- Load artifacts by case or explicit paths.
- Count evidence across layers.
- Detect fatal losses.
- Exit 1 on fatal.

Acceptance:

```bash
node scripts/inspect-learning-fidelity.mjs --case marketing
```

## P1 — Stop Looking Like a Template

### T1.1 TechniqueAtom extraction

Tasks:

- Add `techniqueAtoms.ts`.
- Extract atoms from visual/typography/motion/audio evidence.
- Add renderer component mapping.

Acceptance:

```text
marketing has ParametricRibbonSurface atom
editing has KineticTypography/SourceMontage atoms
motion_graph has motion/card/sweep atoms
```

### T1.2 Evidence-based primitive selection

Tasks:

- Replace role/videoType-only mapping.
- Add evidence score.
- Add fallback reason.

Acceptance:

```text
four learned samples primitive histograms not identical
```

### T1.3 Geometry strategy

Tasks:

- Track elementTrackId/slotInstanceId.
- Change `elementGeometryForClip`.
- Add minAreaRatio / fit.

Acceptance:

```text
no all-image-clips-same-hero-bbox warning
```

### T1.4 Audio fidelity

Tasks:

- Carry audioStructure.
- Generate AudioLayers.
- Synth from layers.

Acceptance:

```text
audio plan differs across cases
```

## P2 — Demo and Product

### T2.1 UI panels

- EvidenceTimeline。
- TechniqueAtomLibrary。
- SlotMappingTable。
- GapReportPanel。
- LayerTimeline。
- RenderPreview。

### T2.2 Multi-version

- high_click。
- high_conversion。
- high_quality。

Each affects at least two of:

- hook duration。
- text density。
- CTA placement。
- motion intensity。
- audio density。

### T2.3 Natural edit

Support three commands:

- 开头更抓人一些。
- 减少字幕，增强节奏感。
- 把商品信息提前。

## Final Tasks

- Run learn samples.
- Render marketing and at least one other case with both renderers.
- Generate demo report.
- Update README and demo playbook.


---

# 10. Test Plan

## 1. Test Pyramid

```text
Unit tests:
  schema, parsing, mapping, sanitization, geometry, atom extraction
Integration tests:
  analysis -> template -> recipe, renderer consumption, fidelity script
E2E/demo tests:
  marketing/editing/motion_graph cases render outputs
```

## 2. Required Unit Tests

### U1: buildFallbackTemplate evidence carry-forward

Input mock analysis:

```text
visualElements=3, typography=2, audioLayers=2, motionAtoms=1
```

Assert fallback template preserves all.

### U2: parsePromptToBrief + sanitizeDisplayText

Input:

```text
AeroSpin 便携涡轮小风扇。15 秒高转化...CTA：现在入手...
```

Assert:

```text
productName = AeroSpin 便携涡轮小风扇
ctaText = 现在入手
display does not include raw prompt
```

### U3: RenderRecipe v4 schema compatibility

- old v1.3 recipe validates via legacy path。
- new v4 recipe validates with layers。

### U4: TextLayer bbox/fontSize style

Given two bboxes/fontSizeRatio values, Remotion style differs.

### U5: MotionAtomLayer parametric_ribbon_surface

Recipe with ribbon produces Remotion component and FFmpeg fallback plan.

### U6: TypographyLayoutSequence media rendering

Legacy clip with material.assetIds must render media.

### U7: elementGeometry no over-reuse

Multiple evidence elements + multiple image clips should not all use first hero bbox.

### U8: TechniqueAtom extraction

Evidence with ribbon -> ParametricRibbonSurface atom.
Evidence with text sweeps -> KineticTypographySweep atom.

### U9: primitive diversity

Four fixtures produce different primitive histograms.

### U10: audioPlan diversity

Different audioStructure inputs produce distinct audio layers/synth params.

### U11: safety invariant

Assert:

```text
sampleFrameCopyAllowed=false
sampleAudioCopyAllowed=false
sample evidence asset not in media material.assetIds
provenance preserved
```

## 3. Fidelity Gates

`inspect-learning-fidelity` fatal conditions:

| Gate | Fatal Condition |
|---|---|
| G1 visual carry | analysis visual > 0 and template visual = 0 |
| G2 typography carry | analysis typography > 0 and recipe text bbox/fontSize = 0 |
| G3 motion carry | analysis motionAtoms > 0 and recipe motionAtomLayers = 0 |
| G4 audio carry | analysis audio > 0 and recipe audioLayers = 0 |
| G5 media render | image-bearing TypographyLayoutSequence has no media render path |
| G6 CTA safety | display field contains raw prompt tokens |
| G7 sample copy | sample path/id in renderable material |

## 4. Render Quality Gates

| Gate | Target |
|---|---|
| final exists | final.mp4 and/or final.remotion.mp4 |
| dimensions | 720x1280 or configured aspect |
| duration | 10-20 sec for challenge showcase |
| clip coverage | every clip has layerIds |
| evidence coverage | every layer evidenceRefs or fallbackReason |
| media coverage | media layers rendered |
| text coverage | text visible and positioned |
| motion coverage | motion atoms visible/fallback |
| audio coverage | audio layers present |
| safety | sample copy 0 |

## 5. Case Acceptance Matrix

| Case | Must Pass |
|---|---|
| marketing | visual/typography/audio/motion evidence preserved; ribbon visible; Remotion media visible; CTA safe |
| editing | typography + source montage + varied geometry; no small sticker bug |
| motion_graph_1 | motion/card/sweep atoms; primitive differs from editing |
| motion_graph_2 | motion/card/sweep atoms; primitive differs from motion_graph_1 |

## 6. Commands

Scripts should be discovered first. Suggested commands:

```bash
cat package.json
find apps packages scripts -maxdepth 3 -name package.json -print
pnpm typecheck
pnpm test
pnpm lint
node scripts/inspect-learning-fidelity.mjs --case marketing
node scripts/inspect-learning-fidelity.mjs --case editing
node scripts/inspect-learning-fidelity.mjs --case motion_graph_1
node scripts/inspect-learning-fidelity.mjs --case motion_graph_2
node scripts/render-case.mjs --case marketing --target both
node scripts/evaluate-render-quality.mjs --case marketing --strict v4
```

If command does not exist, report actual alternatives; do not invent passing results.

## 7. Regression Tests for Known Bugs

| Bug | Regression Test |
|---|---|
| marketing template 0/0/0 | fallback template carry test |
| Remotion 0 pics | TypographyLayoutSequence media test |
| CTA prompt pollution | display denylist test |
| ribbon not rendered | MotionAtomLayer test |
| fixed centered text | bbox style test |
| hero bbox overuse | geometry diversity test |
| primitive collapse | primitive histogram test |
| audio sameness | synth params distance test |


---

# Implementation Delta from v4.0 to v4.1

## P0: Add provider configs without disrupting core render

Files likely touched:

```text
packages/shared/src/types.ts
packages/shared/src/schemas/provider-policy.schema.json
packages/shared/src/schemas/model-routing-policy.schema.json
packages/shared/src/engine/providerPolicy.ts
packages/shared/src/engine/modelRouter.ts
apps/api/src/adapters/*.ts
apps/api/src/adapters/renderers.ts
apps/api/remotion/ViralRecipeRoot.tsx
scripts/inspect-learning-fidelity.mjs
```

Tasks:

1. Add provider policy types.
2. Add model routing config.
3. Add AIGC provider interface.
4. Add generated asset provenance fields.
5. Keep all optional providers disabled by default unless env keys/config are present.
6. Add deterministic fallback for every optional provider.

## P1: Add Seedance 2.0 video-fill adapter shell

Do not block on real API access. Implement an adapter interface and disabled-by-default route.

```ts
type AIGCVideoFillRequest = {
  purpose:
    | "opening_hook_motion"
    | "product_motion_insert"
    | "moving_background"
    | "missing_use_case_clip"
    | "transition_clip";
  prompt: string;
  userAssetIds: string[];
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  safety: {
    sampleFramesAllowedAsInput: false;
    sampleAudioAllowedAsInput: false;
  };
};
```

Adapter result:

```ts
type AIGCVideoFillResult = {
  assetId: string;
  uri: string;
  durationSec: number;
  provenance: GeneratedAssetProvenance;
  fallbackUsed?: boolean;
  warnings: string[];
};
```

## P2: Add Seedream 4.0 image-fill adapter shell

Use for missing static material:

```text
background_fill
hero_image_fill
cover_image
poster_card
cta_visual
```

Fallback: `RemotionPosterCard` or existing target image with package layer.

## P3: Add ElevenLabs audio adapters

Adapters:

```text
elevenlabs_scribe.adapter.ts
elevenlabs_tts.adapter.ts
elevenlabs_sound_effects.adapter.ts
elevenlabs_music.adapter.ts
elevenlabs_audio_isolation.adapter.ts
elevenlabs_dubbing.adapter.ts optional
```

Do not require all adapters immediately. Priority:

1. Scribe ASR fallback
2. TTS voiceover
3. Sound effects
4. Music
5. Audio isolation
6. Dubbing / lip sync

## P4: Update RenderRecipe v4 with provider provenance

Add fields:

```ts
type RenderRecipe = {
  providerUse?: Array<{
    task: string;
    provider: string;
    model?: string;
    assetIds: string[];
    fallbackUsed: boolean;
    provenanceIds: string[];
  }>;
};
```

For generated material:

```ts
material: {
  kind: "generated_target_asset" | "generated_video_insert" | "generated_audio";
  assetIds: string[];
  policy: "renderable";
  provenance: "aigc_generated";
  provider?: string;
}
```

## P5: Update UI/report

Add sections:

```text
Provider usage table
AIGC assets generated
Fallbacks used
Cost estimate
Safety/provenance summary
```

This helps judges see that AIGC is controlled and not hiding the core structure-transfer logic.


---

# Acceptance Gates v4.1

These gates extend Spec v4.0 gates.

## Provider gates

```text
G19 provider_policy_schema_valid
G20 optional_providers_have_deterministic_fallback
G21 generated_assets_have_provenance
G22 seedance_not_required_for_core_demo
G23 elevenlabs_not_required_for_core_demo
G24 aigc_input_does_not_include_sample_frames
G25 aigc_input_does_not_include_sample_audio
G26 provider_usage_report_present
G27 provider_cost_estimate_present_if_api_used
G28 fallback_reason_present_when_provider_skipped
```

## AIGC visual gates

```text
A1 Seedance request, if used, has purpose/duration/aspectRatio/provenance.
A2 Seedance output is inserted as generated video material, not as sample material.
A3 Seedance failure falls back to Remotion MotionAtomLayer.
A4 Seedream output is inserted as generated image material with prompt hash.
A5 Image/video generated assets are never mislabeled as user uploaded.
```

## ElevenLabs gates

```text
E1 Scribe output has transcript/timestamps/provider metadata.
E2 TTS output is attached as generated voiceover with provenance.
E3 Sound effects are attached as AudioLayer or asset with provenance.
E4 Music output is attached as generated BGM with provenance.
E5 If ElevenLabs unavailable, faster-whisper/procedural audio fallback works.
```

## Core-demo independence gate

A no-key environment must still be able to run:

```text
sample evidence analysis
StructureTemplate generation
TechniqueAtom extraction or fallback
GapReport generation
RenderRecipe generation
Remotion render
FFmpeg final mux
```

Optional providers can improve output but cannot be required.

## Safety gate details

`inspect-learning-fidelity` should add:

```json
{
  "providerSafety": {
    "sampleFramesSentToAIGC": 0,
    "sampleAudioSentToAIGC": 0,
    "generatedAssetsMissingProvenance": 0,
    "optionalProviderMissingFallback": 0,
    "rawPromptVisibleInRender": 0
  }
}
```


---

# 08. Migration Plan: v3/v1.3 to v4

This plan is based on the confirmed root causes F1-F8.

## F1. marketing evidence lost at template

### Before

`buildBeatCutTemplate()` copies evidence, but `buildFallbackTemplate()` non-beat branch only keeps style/rhythm/segments/slots.

### After

Introduce:

```ts
function attachEvidenceToTemplate<T extends Partial<StructureTemplate>>(
  base: T,
  analysis: VideoAnalysisResult,
  options?: { sourceSampleId?: string }
): T & EvidenceAttachedFields
```

Carry forward:

- `heroDescriptor`
- `typographyEvidence`
- `visualElementGraph`
- `audioStructure`
- `renderPlan.motionAtoms`
- `sourceEvidence/evidenceRefs`

### Validation

`marketing/learned-template.json`:

```text
visualElements > 0
typographyEvidence.length > 0
audioStructure.estimatedLayers.length > 0
motionAtoms.length > 0
```

## F2. motionAtoms/ribbon not consumed

### Before

`timeline.renderPlan.motionAtoms` exists, renderers iterate only clips.

### After

- `RenderRecipe.motionAtoms` top-level for compatibility.
- `MotionAtomLayer` in `layers[]`.
- Remotion `ParametricRibbonSurface`.
- FFmpeg 2D sweep fallback.

### Validation

- recipe has `MotionAtomLayer`.
- remotion render log consumed motion atoms.
- marketing video visibly includes ribbon/sweep.

## F3. Remotion TypographyLayoutSequence ignores media

### Before

Typography branch only renders text.

### After

- `RenderMediaLayer` helper.
- Legacy `TypographyLayoutSequence` with `material.assetIds` renders media background/card first.
- text overlays.

### Validation

Remotion media count equals image-bearing clip/layer count or has warnings.

## F4. CTA prompt pollution

### Before

`parsePromptToBrief()` uses first line as productTheme.name; CtaSlate displays it as brand.

### After

- parse productName/brandName/brief/ctaText/generationPrompt.
- sanitizeDisplayText max length and denylist.
- CtaSlate never reads raw prompt.

### Validation

No CTA display contains:

```text
15 秒 / 高转化 / CTA： / prompt / 生成 / 换成 / 结构 / 镜头 / 要求：
```

## F5. typography fidelity loss

### Before

Timeline has bboxNorm/animationHint, recipe loses bbox/fontSizeRatio, Remotion fixed center/fontSize=84.

### After

- TextLayer carries bboxNorm/fontSizeRatio/animation。
- RenderRecipe compiler maps timeline typography to TextLayer。
- Remotion uses bbox and font size。
- FFmpeg drawtext uses same fields where possible。

### Validation

Different bbox inputs produce different rendered positions; font size is not fixed.

## F6. elementGeometry hero bbox over-reuse

### Before

`elementGeometryForClip()` uses first hero_object bbox for hook/proof/object/montage.

### After

Priority:

1. clip.evidenceRefs -> element track。
2. slotInstanceId/family -> matching element family。
3. role-specific fallback layout。
4. first hero bbox only as last fallback, with reason。

Add:

- elementTrackId。
- slotInstanceId。
- fit mode。
- minAreaRatio。

### Validation

Image-bearing clips do not all share same bbox/motion unless evidenceRefs point to same track.

## F7. primitive collapse

### Before

`detectVideoType()` often maps to beat_cut; `selectPrimitive()` maps to a small vocabulary.

### After

- Extract TechniqueAtoms。
- Choose primitives from evidence + atoms + material + renderer capability。
- Add visible variants:
  - `KineticTypographySweep`
  - `ParametricRibbonSurface`
  - `MediaCardCascade`
  - `ProductPosterHero`
  - `SplitScreenCompare`
  - `ObjectTrackReveal`
  - `PriceBadgePulse`
  - `LightLeakTransition`

### Validation

Primitive sequence/histogram differs across editing, marketing, motion_graph_1, motion_graph_2.

## F8. BGM sameness

### Before

Fixed procedural synth; layer weights nearly identical.

### After

- Preserve audioStructure.
- AudioLayer per layer.
- Synth uses style/bpm/weights/accent/density/riser/impact.

### Validation

Audio plan parameters differ meaningfully across cases.

## Migration Stages

### Stage 0: Read and test baseline

- Snapshot current learned sample artifacts.
- Add fidelity script first.

### Stage 1: P0 hard fixes

- F1 evidence carry-forward。
- F3 Remotion media rendering。
- F4 CTA safe。
- Basic layer schema。

### Stage 2: Renderer consumption

- TextLayer fidelity。
- MotionAtomLayer。
- AudioLayer。

### Stage 3: Diversity and quality

- TechniqueAtoms。
- primitive selection。
- geometry and audio diversity。

### Stage 4: UI and demo

- Structure/gap/layer/preview pages。
- multi-version。
- natural edit。


---

# 12. Codex Prompts

## 1. Main Implementation Prompt

```text
你是这个 repo 的 senior engineer。请实施 Spec v4.0: Evidence-Faithful Atom Transfer Engine。

目标：让 learned_samples_max / marketing / editing / motion_graph cases 真正从样例学习结构，并迁移到新素材，最终输出可看的 final.mp4 / final.remotion.mp4。不要只修单点，也不要为了架构洁癖重写全项目；目标是 make it work。

核心原则：
1. 样例只提供结构证据，不得复制样例帧/音频/水印。
2. analysis evidence 必须保真流过 template -> transferPlan -> RenderRecipe -> renderer。
3. RenderRecipe 从 clip-only 升级为 backward-compatible layer-based recipe。
4. TechniqueAtom 成为结构迁移的主要中间表示，避免 videoType/role-only primitive collapse。
5. Remotion 是主视觉 renderer；FFmpeg 负责 source video cut/crop/mux 和 fallback。
6. 先使用 local JSON/filesystem，不要引入 PostgreSQL/Redis/BullMQ/Prisma，除非已有项目强依赖。
7. 所有修复必须有 tests/gates，不要靠肉眼。

请先阅读：
- spec_v4/README.md
- spec_v4/requirements.md
- spec_v4/architecture.md
- spec_v4/design.md
- spec_v4/migration-v3-to-v4.md
- packages/shared/src/engine/planner.ts
- packages/shared/src/types.ts
- apps/api/remotion/ViralRecipeRoot.tsx
- apps/api/src/adapters/renderers.ts
- scripts/analyze-evidence-timeline.py
- learned_samples_max artifacts if present

P0：
1. 修 buildFallbackTemplate evidence carry-forward。
2. 修 productTheme prompt pollution。
3. 修 Remotion TypographyLayoutSequence 0 pics。
4. 扩 RenderRecipe 为 backward-compatible layer-based schema。
5. 实现 Remotion layer interpreter。
6. FFmpeg renderer 消费新增字段或 fallback。
7. 新增 scripts/inspect-learning-fidelity.mjs。

P1：
8. 新增 TechniqueAtom extraction。
9. selectPrimitive 改成 evidence + atom + material + capability。
10. 修 elementGeometry hero bbox over-reuse。
11. 修 audio fidelity。

P2：
12. Web UI 补 Evidence/Structure、TechniqueAtom、GapReport、Layer timeline、Render preview。
13. 多版本 high_click / high_conversion / high_quality。
14. Natural edit 最小实现。

测试：
必须新增/更新 evidence carry-forward、CTA sanitize、media rendering、schema compatibility、TextLayer bbox/fontSize、MotionAtomLayer、FFmpeg fallback、TechniqueAtom、primitive diversity、geometry、audioPlan、safety、fidelity script tests。

Validation：
先发现真实 package scripts，不要编造命令。尽量跑 pnpm typecheck/test/lint，以及 inspect-learning-fidelity for four cases。

Final report：
输出 Spec v4.0 Implementation Report，包括 files changed、fixes by root cause、tests run、artifact counts、render outputs、safety check、remaining risks、git status。
```

## 2. Focus Prompt: Evidence Carry-forward

```text
只修 analysis -> learned-template evidence carry-forward，不要改 renderer。

找到 buildBeatCutTemplate 和 buildFallbackTemplate。
抽 attachEvidenceToTemplate。
保留 heroDescriptor、typographyEvidence、visualElementGraph、audioStructure、renderPlan.motionAtoms、evidenceRefs。
添加测试证明 marketing/non-beat 不再 0/0/0。
最后运行相关 unit tests 和 git diff summary。
```

## 3. Focus Prompt: CTA and Remotion 0 Pics

```text
只修两个高影响 bug：
1. productTheme.name raw prompt pollution。
2. Remotion TypographyLayoutSequence ignores media。

要求：
- parsePromptToBrief 拆 productName/brandName/brief/ctaText/generationPrompt。
- sanitizeDisplayText。
- CtaSlate 不显示 raw prompt。
- TypographyLayoutSequence 有 material.assetIds 时先渲 media。
- 加 regression tests。
```

## 4. Focus Prompt: Layer-based RenderRecipe

```text
实现 backward-compatible RenderRecipe v4 layers[]。
保留 clips[]。
新增 MediaLayer/TextLayer/MotionAtomLayer/AudioLayer types and schema。
buildRenderRecipe carry bboxNorm/fontSizeRatio/animation/motionAtoms/audioLayers/provenance。
旧 recipe 继续 validate，新 recipe preferred。
加 tests。
```

## 5. Focus Prompt: Renderer Consumption

```text
让 Remotion 和 FFmpeg 消费 RenderRecipe v4 layers。
Remotion：LayerRecipeRoot, RenderLayer, MediaLayer, TextLayer, MotionAtomLayer, ParametricRibbonSurface。
FFmpeg：bbox/fontSize drawtext, motionAtom 2D fallback, audioPlan layers。
输出 render-log.json 记录 consumed/fallbacks。
加 renderer tests。
```

## 6. Focus Prompt: Primitive Diversity and Geometry

```text
实现 TechniqueAtom extraction 和 evidence-based primitive selection。
修 elementGeometryForClip 不再复用第一个 hero bbox。
四个 learned samples primitive histograms 不得完全相同。
多 image clips 不得全部 same bbox unless same evidence track。
加 tests 和 fidelity warnings。
```
```


---

# CHANGELOG

## v4.1 latest-only package

- Created a standalone latest-version package.
- Removed old `spec_v3` and separate `spec_v4` folders from the deliverable.
- Integrated the v4 base architecture with the v4.1 provider/model updates.
- Added Seedance 2.0 as optional video-fill provider.
- Added Seedream 4.0 as optional image/poster/cover provider.
- Added ElevenLabs audio stack.
- Added provider policy, routing/fallback, generated provenance, and acceptance gates.
