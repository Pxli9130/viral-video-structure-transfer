# 评分表对照 / Rubric Alignment（spec_v5.1）

> 本文把课题评分表（满分 100 + 加分 ≤10，权威来源 `assets/工程训练营课题：爆款结构迁移引擎…pdf` P5-7）
> 逐项映射到本系统**已实现的功能 / API 端点 / 代码位置**，作为答辩与「项目说明文档」的可解释性依据。
> 端点均挂在 `/api/v5`（`apps/api/src/v5Routes.ts`）；Web 看板 `apps/web/src/v5/V5Dashboard.tsx`（默认入口，V4 在 `#v4`）。

## 资源边界（先说清楚）
课题提供 **Doubao-Seed-2.0-lite**（文本 LLM），本系统同时支持 Gemini。当前代码里的分工是：
- **「文生文」任务 → `createTextModelFn`**：有有效 Ark/Doubao key 和 model 时优先 Doubao；缺省、不可用或本地演示时回退 Gemini。覆盖换主题 context-rewrite、镜头描述、自然语言改片 NL→patch、文本代码兜底、Gen1/Gen2 文本。
- **「看视频/帧」的多模态 → Gemini**：Gen1 视觉胶囊重建、样例场景 VLM、用户素材像素级富化需要视觉模型；用户目标素材 VLM 由 `ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=1` 显式开启。
- **画面/footage/音乐**是可选外部 provider（自带 key）：Gemini 图、Seedance/happyhorse 文生视频、Google Lyria 音乐——全部有确定性/Remotion/程序化兜底，核心链路可本地出片，云能力提升画面丰富度。

---

## 一、基础闭环完成度（25）

| 项 | 分 | 实现 | 位置 |
|---|---|---|---|
| 样例输入与基础解析 | 5 | 上传/选样例 → 证据时间线（时长、镜头数、关键帧、字幕 OCR、语音 ASR、音频鼓点、运动）。支持多条样例。 | `POST /api/v5/learn-samples`、`GET /api/v5/samples/:id/evidence`；`runEvidenceV5.ts`（ffprobe/PySceneDetect/librosa/OCR/ASR） |
| 结构拆解 | 10 | **三类全有**：①脚本/段落（`sceneRecipes.role` = hook/benefit/proof/cta + manifest `structureHypothesis.phases`）②节奏（`timingSignature` 段落+鼓点、`motionSignature.beatSyncedCueCount`）③包装（`typographyAnimations` / `transitions` / `motifs` / `palette`）。再原子化沉淀为 16 类 KB 元素。 | `runGen1CapsuleGemini.ts`、`runExtractElements.ts`、`knowledgeManifest.ts`、`GET /api/v5/samples/:id/elements` |
| 结构迁移生成 | 10 | same_template：换主题 → 绑定/补全 → 渲染同一动效模板的**成片 mp4** + 时间线 + slot 映射 + 分镜 recipe（覆盖 成片/时间线/分镜 多项）。 | `POST /api/v5/generations`、`runSameTemplateGeneration.ts` |

## 二、素材缺口处理能力（20）

| 项 | 分 | 实现 | 位置 |
|---|---|---|---|
| 素材缺口识别 | 8 | `gapReport` + `slotMapping`（每槽 status：matched / weak_match / missing）+ `readinessImpact`（缺必需槽数、影响、readiness 降级）。 | `runGapReportV5.ts`、`runSameTemplateGeneration.ts`、transfer-trace |
| 素材缺口补全 | 12 | **多种策略**：AIGC 图（Gemini）·真实文生视频（Seedance→happyhorse→静图兜底）·文案（Doubao/brief）·音乐（Lyria→程序化）·**结构补全**（`ensureSlotsCoverCode` 自动补齐代码读到却没声明的槽）·用户素材·程序化。 | `runSameTemplateGeneration.ts`、`aigcMaterialProviders.ts`、`googleAudio.ts` |

## 三、结果展示与可验证性（20）

| 项 | 分 | 实现 | 位置 |
|---|---|---|---|
| 迁移过程可视化 | 10 | **一个端点给出完整迁移链路**：源结构（sceneRecipes/phases/关键帧）→ knowledge-manifest → 目标 brief + 素材画像 → **slot 映射**（每槽来源/补全策略/原因）→ gapReport/fillActions → scorecard → 成片。评审证据中心还在生成前展示 Transfer Map / Packaging 草案。 | `GET /api/v5/generations/:id/transfer-trace`、`GET /api/v5/jobs/:jobId/transfer-trace`、`V5Dashboard.tsx` |
| 最终效果展示 | 10 | 结果页：成片 `<video>` + 样例↔成片前后对比 + slot 绑定 + scorecard 门 + readiness 徽章。 | `V5Dashboard.tsx`、`GET /api/v5/generations/:id[/scorecard]` |

## 四、进阶能力（20）

| 项 | 分 | 实现 | 位置 |
|---|---|---|---|
| 画面包装 | 8 | **多项**：字幕高对比 + 不重叠（Gen1 prompt 强约束）、转场、主题配色、色彩守卫（源浅底保护）、结尾冗余裁剪、真 3D ribbon（`@remotion/three`）、kinetic 文字。 | `runGen1CapsuleGemini.ts`、`postRenderChecks.ts`、`runSameTemplateGeneration.ts` |
| 多版本生成 | 4 | 看板「生成多版本」对同一模板 fan-out 多条 `/generations`（高点击/高转化/高节奏/高质感等 variant 策略），版本差异明确。 | `V5Dashboard.tsx`（`variantStrategy`）、`brief.variant` |
| 真实素材适配 | 8 | 用户上传素材 → 画像分析（kind/labels/qualityScore/bestSection/裁切建议）→ 映射到 slot；目标素材可以排序，且可对单个 slot 显式绑定。像素级 VLM 富化已接入，默认需 `ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=1`。 | 上传 UI、`GET /api/v5/assets/:id/media`、`runTargetAssetAnalysis.ts` |

## 五、人机协同与整体完成度（15）

| 项 | 分 | 实现 | 位置 |
|---|---|---|---|
| 人工可调 | 8 | revise（换主题/配色/文案 patch，复用画面重渲）+ 自然语言改片 + AIGC 补全开关（图/文/音独立 on/off/provider）+ 目标素材顺序调整 + 多版本择优。 | `POST /api/v5/generations/:id/revise`、`POST /api/v5/generations/:id/revise-natural-language`、`V5Dashboard.tsx` |
| 创意与产品完成度 | 7 | 完整 Web 产品：learn → 模板库 → 生成（same_template / mix_elements）→ 结果 → 改写；KB 浏览/搜索、迁移可视化为亮点。 | `V5Dashboard.tsx` |

## 加分项（≤10，酌情）

| 加分点 | 实现 | 位置 |
|---|---|---|
| **自然语言改片** | 「开头更抓人」一句话 → 文本模型结构化输出 `TemplatePatchSet` → 重渲（绝不让 NL 直接改代码）。 | `POST /api/v5/generations/:id/revise-natural-language`（`patchFromInstruction`） |
| 真实素材 + AIGC 融合 | 用户素材填可填槽，其余 AIGC 补全，混合成片。 | same_template 绑定链 |
| 结构迁移可解释性 | transfer-trace + 每条知识带 `evidenceRefs` + knowledge-manifest + scorecard 门。 | transfer-trace、`knowledge.ts` |
| 较完整画面包装链路 | 字幕样式 / 转场 / 配色 / 结尾裁剪 / 3D。 | 见「画面包装」 |
| 工程质量 | T1-T12 + 40 条 canonical 门、诚实 scorecard、cv2/librosa no-copy 扫描、fiber9/React19 修复、并发与渲染稳定性。 | `validateTemplateCapsule.ts`、`runNoCopyScan.ts`、`concurrency.ts` |

## 导师强调的「经验沉淀 / 知识库」
两级知识库：**Level-1 模板胶囊**（每样例一份可复用 Remotion 模板）+ **Level-2 原子元素**（16 类：hook/rhythm/typography/transition/cta/asset-recipe/audio-recipe/remotion_snippet…），随学习视频增多沉淀越来越多，可浏览/检索/复用。learn 时 Gemini 的 `knowledgeElements` 也会 curate 入库。
- 端点：`GET /kb/elements?kind&tag&q`、`POST /kb/search`、`GET /kb/decisions`、`GET /templates[/:id]`
- 代码：`services/knowledgeBaseV5.ts`、`runExtractElements.ts`、`knowledgeManifest.ts`

## 交付物 · 工具协议与安全边界（说明文档要求）
- **AI 架构**：见 `spec_v5/architecture.md` + `spec_v5/same-template-mode.md`。
- **工具协议**：`gen1ModelFactory.ts` 统一文本模型路由（Doubao/Ark 优先，Gemini fallback），视觉→Gemini，音乐→Lyria→程序化。
- **安全边界**：运行 VLM 生成的 TSX 前做**静态黑名单扫描**（`FORBIDDEN_API_RE` = require/process/child_process/fs/eval/fetch/XMLHttpRequest/dynamic-import + 远程 URL + 样例路径/文案），再在 **headless Chrome** 沙箱内 bundle+render；no-copy 扫描确保不含样例像素/音频/文案。容器级隔离（Docker）列为后续加固项。
