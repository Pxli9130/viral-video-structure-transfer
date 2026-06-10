# 爆款结构迁移引擎

**Viral Video Structure Transfer Engine / 爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台**

## Spec v5.1 — Same Template Reconstruction Mode（最新默认行为）

> 上传你喜欢的视频 → 系统把它变成一套**可复用、props 驱动的 Remotion 模板**（`RemotionTemplateCapsule`）→ 输入新主题 → **自动补全缺失的画面/文案/音频，并用同一套动效模板渲染新内容**。
>
> 安全边界：可复用「模板代码 / 时间线 / 布局 / 动画曲线 / 排版行为 / 转场编排 / 音频 cue 位置 / props & slot schema」；**不可复用**样例的「原图像素 / 视频帧 / 音频 / 字幕文本 / logo / 人物 / 商品素材」。
>
> 默认 `generationMode=same_template`、`aigcGapFill=auto_on`；原「多视频元素混合」保留为 `mix_elements` 高级模式。规格见 [`spec_v5/same-template-mode.md`](spec_v5/same-template-mode.md)；**评分表逐项对照见 [`spec_v5/rubric-alignment.md`](spec_v5/rubric-alignment.md)**；契约见 `packages/shared/src/contracts-v5/templateCapsule.ts`。
>
> **模型分工**：`createTextModelFn` 统一承接「文生文」任务（换主题 context-rewrite、镜头描述、自然语言改片、文本代码兜底、Gen1/Gen2 文本）：有有效 Ark/Doubao 配置时优先 Doubao-Seed，缺省或不可用时回退 Gemini（当前 `.env.example` 默认 `AI_PROVIDER=gemini` / `AI_GEMINI_MODEL=gemini-3.5-flash`）。**「看视频/帧」的多模态重建留 Gemini**；图/视频/音乐等外部 provider 均有确定性或程序化兜底。
>
> **Gen1 视觉胶囊（主路径）**：一次 Gemini 调用**看完整段视频** + 确定性证据 → 一份忠实、props 驱动的 `RemotionTemplateCapsule`（react + remotion + `@remotion/three` 真 3D）。**混合按时长选模型**（短→`gemini-3-flash-preview`，长/切块→`gemini-3.1-pro-preview`，阈值 `GEMINI_GEN1_PRO_MIN_SEC=34`）。**返回的代码即圣经**：`mergeCapsule` 逐字节保留代码、只补缺失元数据,并合并 `timingSignature`（durationSec/fps 回退确定性，杜绝「31s 只渲 16s」）。只用「**编译 + 真渲染**」两道门(其余只记录不拦)。长视频(>34s)按 scene-cut 切 ≤30s 块并发重建后拼成一个多文件胶囊。Gemini 还返回 `assetPlan`（每个「代码画不出的 missing 素材」一条,带 key/mediaKind/AIGC prompt）。**运动/覆盖保真自修**：代码若违背它自己的 sceneRecipe（该滚动的字幕静止、该 3D 单轴的 ribbon 双轴翻滚、覆盖不足)触发一次 repair；**AI 优先**：能编译+渲染的 AI 胶囊永不因保真瑕疵被丢回确定性。
>
> **生成：换主题 + AIGC 补「动态素材」**。context-rewrite 用一次 Pro 调用换文案/配色(保结构、保源明暗)。footage 槽(`mediaKind=video`)填**真实视频**：**Seedance 2.0**(火山 Ark 文生视频)为主 → **happyhorse r2v**(阿里 DashScope 参考生视频,用 Gemini 静图作 `reference_image`,Seedance 欠费/403 时自动顶上)为备份 → AIGC 静图兜底；图片槽用 Gemini 图。渲染后:**色彩守卫**(源浅底却渲成暗→重写重渲一次) + **裁掉结尾纯色冗余镜头**。并发与稳定:全局渲染信号量(`RENDER_CONCURRENCY=2`×`RENDER_TABS_PER_JOB=2`)+ `RENDER_TIMEOUT_MS=120000` + 渲染/探针崩溃重试 + 全局 AIGC 信号量(`AIGC_GLOBAL_CONCURRENCY=8` 防 429)。**改写**:`POST /api/v5/generations/:id/revise`。
>
> 音频默认 **Google Lyria 音乐床**（`lyria-3-clip-preview`，>30s 分段 + crossfade，失败重试后退程序化）。
>
> **更多能力（已实现，贴合评分表，见 rubric-alignment.md）**：素材**上传 + 画像分析**（上传走 `POST /api/projects/:projectId/assets`，V5 读取走 `GET /api/v5/assets` / `GET /api/v5/assets/:id/media` + `runTargetAssetAnalysis`）· **迁移过程可视化**一站式 trace（`GET /api/v5/generations/:id/transfer-trace`：源结构→knowledge-manifest→slot 映射→缺口/补全→scorecard→成片）· **评审证据中心**（Showcase / Learn Analysis / Structure Protocol / Gap Decisions / Transfer Map / Packaging / Export）· **多版本生成**（看板对同模板 fan-out 高点击/高转化/高节奏/高质感）· **自然语言改片**（`POST /api/v5/generations/:id/revise-natural-language`：一句话→`TemplatePatchSet`→重渲）· **两级知识库**（Level-1 模板胶囊 + Level-2 16 类原子元素；`GET /api/v5/kb/elements?kind&tag&q`、`POST /api/v5/kb/search`、`GET /api/v5/templates`）· **knowledge-manifest 种子**（每样例结构假设/原子模块/槽位）。
>
> 核心 API（均挂 `/api/v5`）：`GET /showcase` · `GET /assets` · `POST /learn-samples` · `GET /templates[/:id]` · `POST /generations`（默认 same_template）· `POST /generations/plan`（只规划不渲染）· `GET /jobs/:jobId/progress` · `POST /generations/:id/revise` · `POST /generations/:id/revise-natural-language` · `GET /generations/:id[/scorecard|/transfer-trace]` · `GET /samples/:id/{evidence,reconstruction,elements}` · `GET/POST /kb/*`。Web 默认入口是 `/#v5`（V4 仍可在 `#v4` 访问）。
>
> **四视频并行 demo**（需 conda env `viral` + 真实 key；输出 `storage/demo-runs-*/`）：
> ```bash
> export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"
> npm run build && node apps/api/dist/server.js   # 或 npm run dev
> VIDEO_CONCURRENCY=4 OUT_DIR=demo-runs python scripts/run-v5-four-aigc.py   # 四条样例：各自 learn(切块)+generate(换随机主题+AIGC 视频/静图)
> ```
> 视频 provider env：`AIGC_VIDEO_PROVIDER=seedance_2_0` + `SEEDANCE_ARK_API_KEY`（主）；`AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v` + `DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL=https://dashscope-us.aliyuncs.com/api/v1`（备份）。**依赖必须装好** `@remotion/three@4.0.341` + `@react-three/fiber@^9.6.1` + `three@0.176.0`（**fiber 必须匹配 React 版本**：本仓库 web 用 React 19，fiber 须为 9.x；用 fiber 8 会触发 `ReactCurrentBatchConfig` 渲染崩 → 3D 胶囊退回确定性）。

## Spec v4.2 Submission Entry

当前提交目标是：**学结构，不抄内容**。样例视频只进入 analysis/template/TechniqueAtom/GapReport 作为结构证据；最终画面只允许使用目标素材、用户授权素材、本地程序化素材，或带 provenance 的生成素材。

评审入口：

- 中文 showcase：`docs/artifacts/showcase-report.md`、`docs/artifacts/showcase-report.html`
- Submission pack：`docs/artifacts/submission_pack/index.md`、`docs/artifacts/submission_pack/index.html`
- 四个 canonical FFmpeg 输出：`docs/artifacts/learned_samples_max/{marketing,editing,motion_graph_1,motion_graph_2}/final.mp4`
- Visual QA：每个 case 的 `visual-qa-report.md/json`
- Remotion host 验证：`docs/remotion-host-verification.md`

本地验证命令：

```bash
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" npm test
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/evaluate-model-routes.mjs --offline --json --strict-policy
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/visual-qa-report.mjs --all-cases
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-showcase-report.mjs
CONDA_BASE=/home/pxli/anaconda3 VIRAL_CONDA_ENV=viral PATH="/home/pxli/anaconda3/envs/viral/bin:$PATH" node scripts/export-submission-artifacts.mjs
```

默认 submission path 不调用 Seedance / Seedream / ElevenLabs / Gemini / OpenAI / Qwen / Deepgram / Runway / Veo / Kling，不上传样例媒体，不下载大模型权重。可选 provider 只在显式 opt-in 和配置密钥后使用。

这个项目不是“输入一句话直接生成一条视频”的通用视频生成器。它的核心目标是：

```text
样例/参考视频
→ 确定性证据提取
→ 开放世界槽位归纳
→ 目标素材匹配
→ 素材缺口检测
→ 填充计划 / 可替换槽位
→ 渲染能力选择
→ 代理或目标素材 MP4
→ 预览帧 / contact sheet
→ 评估器 / corpus 回归 / 产品演示
```

默认安全边界：

- 样例视频只提供结构证据，不默认复制样例帧、音频、文字或品牌。
- 目标素材、用户上传素材、授权可复用素材、程序化渲染和明确标记的 AIGC 生成素材才可进入输出。
- mock/no-path 素材不能满足视觉槽位。
- 素材缺失时必须产出 gap report、fill plan、replacement slots 或代理渲染。
- AIGC 素材补全是可选能力，不默认调用外部 provider。

当前实现状态、评审结论和 artifact 证据见：

- [当前项目指南](./CURRENT_PROJECT_GUIDE.md)
- [SDE hardening review](./docs/artifacts/review/sde_hardening_review.md)
- [SDE harness completion review](./docs/artifacts/review/sde_harness_completion_review.md)

## 文档入口

- [需求说明](./spec_v2/requirements.md)
- [系统设计](./spec_v2/design.md)
- [API 说明](./spec_v2/api.md)
- [任务拆分](./spec_v2/tasks.md)
- [测试计划](./spec_v2/test-plan.md)
- [演示脚本](./spec_v2/demo-playbook.md)
- [Schema](./spec_v2/schemas/)

**当前主提交规范以 [`spec_v5/`](./spec_v5/) 为准**（Spec v5.1 — Same Template Reconstruction Mode）。`spec_v3/`、`spec_v2/`、`specs_v1/` 和 `spec_v1_1/` 保留为历史设计与回归资料。

- [Spec v1.3 需求](./spec_v3/requirements.md)、[系统设计](./spec_v3/design.md)、[RenderRecipe schema](./spec_v3/schemas/render-recipe.schema.json)、[实现状态](./spec_v3/implementation-status.md)、[演示脚本](./spec_v3/demo-playbook.md)

## Spec v1.3 — Source-first RenderRecipe（历史演示）

针对「渲染 overfit」investigation（[REPORT](./docs/artifacts/render_overfit_findings/REPORT.md)）暴露的「样例无关的固定模具」问题（同类 beat_cut 输入坍缩成同一 6-primitive 序列，跨样例布局 NCC 0.868–1.000），v1.3 把渲染改成 **source-first + RenderRecipe 单一契约**：

```text
样例视频 = 仅结构证据（不复制帧/音频/水印）
目标素材 / 源视频 = 进画面的输出素材
→ buildRenderRecipe（timeline.renderPlan.renderRecipe，唯一渲染契约，每个 clip 带可审计 primitiveReason）
→ FFmpeg（合成真实素材像素 + 卡点字幕 + 程序化 BGM，产出 final.mp4）
   与 Remotion ViralRecipe composition（消费同一 recipe，产出 final.remotion.mp4）
```

历史演示产品是 **AeroSpin 便携涡轮小风扇**产品广告。仓库无真实风扇素材，故该 fixture 当时由 Gemini 2.5 Flash Image（Nano Banana）生成并标注 provenance `aigc_generated_material`（非用户上传、非真实产品照）；当前 V5.1 默认图片模型和 provider 配置见下方 Provider 配置摘要。

```bash
# 工具链前缀（系统 node 是过期 v12；ffmpeg/python 在 viral conda env）
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"

# 1) 生成真实 AIGC 风扇目标 fixture（需 GEMINI_API_KEY + 外部 provider opt-in）
node scripts/generate-aerospin-fan-fixture.mjs

# 2) 最终提交演示：Demo A（editing.mov beat_cut + 风扇）+ Demo B（motion_graph + 同一风扇素材）+ 反 overfit 多样性
npm run demo:final
```

产物：`docs/artifacts/final_submission/`（`demo_a_editing_fan/`、`demo_b_motion_graph_fan/`、`diversity_eval/`、`FINAL_REPORT.md`）。每个 demo 含 `final.mp4`（FFmpeg）、`final.remotion.mp4`（Remotion）、`render-recipe.json`、`quality-gates.json`、`sample-copy-safety.json`、`source-material-usage.json`、contact sheet、`HUMAN_REVIEW_REPORT.md`。**跨样例反 overfit 结果：layout NCC ≈ 0.01**（同样素材、不同样例产出结构迥异的视频，固定模具被打破）。

## 目录结构

```text
apps/
  api/       Node.js + TypeScript + Express，API、adapter、renderer 接入
  web/       React + Vite + TypeScript，工作台 UI
packages/
  shared/    类型、schema、planner、slot induction、AIGC material fill
  renderer/  HTML preview / renderer contract
scripts/
  analyze-visual-evidence.py               motion_graph_case 确定性视觉证据分析
  run-motion-graph-case.mjs                proxy / target assets / partial / malformed / AIGC 模式
  generate-motion-graph-target-assets.mjs  确定性目标素材 fixture
  check-artifact-hygiene.mjs               public artifact 泄漏扫描
docs/
  fixtures/motion_graph_target_assets/     motion graph 目标素材 fixture + manifests
  artifacts/                               可评审输出、报告、MP4、contact sheets
storage/
  uploads/, generated/, db/, demo/
```

## 本地环境

推荐使用已有 conda 环境 `viral`。FFmpeg、ffprobe、Python 辅助脚本、可选 OCR/ASR 都从这里走。

```bash
conda activate viral
npm install
npm run build
```

可选 Python 能力：

```bash
pip install faster-whisper   # ASR_PROVIDER=faster_whisper
pip install easyocr          # OCR_PROVIDER=easyocr
```

如果 conda 路径不同：

```bash
CONDA_BASE=/path/to/anaconda3
VIRAL_CONDA_ENV=viral
```

## 启动应用

```bash
npm run dev
```

打开：

- Web V5: <http://localhost:5173/#v5>（如果 5173 被占用，Vite 会打印 5174 等新端口；按终端输出打开 `/#v5`）
- Web V4: <http://localhost:5173/#v4>
- API root: <http://localhost:3000/>
- API health: <http://localhost:3000/healthz>

当前 V5 UI 流程：

1. 在 `0 · Upload` 里选择样本视频和目标图片/视频素材；选择文件后需要分别点击 `Upload`。
2. 在 `1 · Learn` 里选择一个样本视频并点击 `Learn 1 个样本`；学习结果会写入 Remotion 模板胶囊、槽位协议、KB 元素和结构学习报告。
3. 展开 `评审证据中心`，依次查看 Showcase、Learn Analysis、Structure Protocol、Gap Decisions、Transfer Map、Packaging、Export；生成前也会展示迁移草案和包装计划，生成后自动替换为真实 trace。
4. 在 `模板库` 中选择可复用 Remotion 模板，或在 Knowledge Base 中浏览/搜索 hook、rhythm、typography、transition、asset/audio recipe 等原子元素。
5. 在 `2 · Generate` 中默认使用 `same_template`；目标素材可折叠、多选并通过“上移/下移/移除”控制进入媒体槽的顺序，也可在槽位缺口表里对单个槽位上传/绑定素材。
6. 选择 AIGC 补全策略、生成模式、LLM 智能改写、变体预设；高级模式 `mix_elements` 可跨多个样例元素合成，并可开启“让 AI 现场编写动画代码”。
7. 生成后查看 final.mp4、slot binding、gap report、timeline、mapping、packaging、scorecard 和 no-copy 证据；可继续 structured patch 或自然语言改片。
8. 在 Export 下载当前页面已加载的 `template-capsule-v5.json`、`sample-evidence-v5.json`、`transfer-trace-v5.json`、`scorecard-v5.json`、生成前迁移/包装草案等评审证据。

## 常用命令

```bash
npm run build
npm test
npm run validate:schemas
npm run regression:corpus:strict
VVST_REUSE_IGF_FIXTURE=1 npm run demo:product
node scripts/check-product-demo-page.mjs
node scripts/check-artifact-hygiene.mjs
```

如果 `npm test` 在受限 sandbox 中报 `listen EPERM: operation not permitted 0.0.0.0`，这是 API e2e 测试需要本地 socket 绑定导致的环境限制；在允许本地绑定的环境中重跑即可。

## Evidence-first 结构迁移（beat_cut / editing.mov）

针对 `editing.mov` 这类**快剪 / 剪辑教学**样例，pipeline 改成「先用确定性工具抽证据，再让模型做语义解释，最后让 renderer 执行学到的视觉语法」：

```text
video
→ ffprobe 元数据
→ PySceneDetect 场景切点 + 每镜头关键帧/视觉族标签 + 每镜头 motionEnergy（Farneback 光流）
→ librosa 鼓点网格（BPM / beats / onsets）
→ 60 帧 frameMetrics（blackBgRatio / redYellowRatio / motionDiffMean / cutLikeCount）+ movingObjectCandidates
→ OCR / ASR 文本按时间戳绑定到镜头
→ VisualEvidenceTimeline v2（6 视觉族：object_motion/kinetic_typography/background/storyboard/live_action_montage/bgm）
→ Gemini VLM（被证据 grounding，不再自由发挥）→ 文本模型合并（Ark/Doubao 或 Gemini）
→ beat_cut StructureTemplate（8 个 moving-material 槽位：主视觉/背景/文字卡/分镜规则/动作混剪/冲击闪/BGM/CTA）
→ 分层时间线（layers + slotId/motion/assetPolicy，按真实 152 BPM 卡点）+ 诚实缺口（moving_material_missing / bgm_missing）
→ style-locked 动态渲染器（黑底动态光带、卡点白闪、BGM EQ 条、硬切混剪、红色冲击星芒、红黄大字、CTA ticker）+ 音频
→ 渲染质量 gate v2（无 placeholder、有音频、证据覆盖 ≥0.8、motionDiffMean ≥0.04、cutLikeCount ≥5、分层片段 ≥5、moving 缺口已上报）
```

`beat_cut` 的判定来自**确定性证据**（快切 + 鼓点 + 黑底 + 动作混剪），不依赖 VLM 关键词，因此 LLM 失败也能稳定产出。AI 增强失败（如 Ark 401）会**显式标记** `aiEnrichmentStatus=failed/aiEnrichmentError`，绝不冒充干净模板。**moving 素材/背景/分镜/BGM 是一等结构槽位 + 渲染契约 + gate**：没有目标动作素材时，动作混剪用高运动的程序化代理（绝不复制样例帧）并上报 `moving_material_missing`，所以输出不会退化成静态卡片。

**v3（human-fidelity）**：分析器再抽取 **hero-object 描述符**（head/mask 类型 + 调色板 + 运动）和 **TypographyEvidenceV2**（OCR bbox → 版式角色/颜色/字号/动效），渲染器据此画**程序化霓虹头部/面罩剪影**（不再是方块，绝不复制样例人脸）、**分角色变化的字幕版式/颜色/逐字显现/抖动**，并用**分层程序化 BGM**（drone+kick+bass+hat+noise，频谱质心远高于纯 click）替代单 click。gate 升级到 **v3 per-clip** 指标（hero≥0.025、文字片段≥0.01、混剪≥0.04，静态早段无法靠全局均值蒙混）+ hero 描述符/代理、typography 证据、audio richness、storyboard 非空、bgm 去重、fillPlan 一致性等。`npm run full-loop:editing` 把整条产品链路落成 22 个可人工评审的 stage 目录。

**v3 VisualElementGraph（localize-then-label）**：架构是 **先用 CV/光流/OCR 把元素定位出来（bbox + 轨迹），VLM 只对已框出的候选做语义命名**（不再让 VLM 在 1FPS 视频里猜坐标）。分析器产出 `visualElementGraph`：hero_object（光流 bbox 轨迹 + center 轨迹 + 面积曲线）、kinetic_typography 与 **watermark**（按角落启发式分离，抖音水印只标注不复刻）、impact_fx、background、cta，加 shot 节点（dominantElements/cutType/motionClass/beatSync）与 `audioStructure`（bass/music/hats 层占比）。渲染器**真实消费**图谱：hero 剪影按 `positionClass` 定位、BGM 按学到的层占比混音。重型 tracker（Grounded-SAM2/SAM2/RAFT/CoTracker/Demucs/Essentia）是 **env-gated stub**（默认关、CI 不受影响）。v3 gate **检验真实使用**而非仅存在：`element_graph_renderer_consumed`（hero 元素已挂到 layer 且渲染开场片段确实有运动）、`typography_layout_used`、`audio_structure_used`。`--gates v3` real-API 全闭环 **47/47**。

实跑（需要 conda env `viral` + 真实 provider，分析会跑 Gemini/ASR/OCR/PySceneDetect/librosa，约几分钟）：

```bash
# 1) 起 API（真实 provider 由 .env 控制：VLM_PROVIDER=gemini，VLM_MODEL 默认 gemini-3.5-flash；AI_PROVIDER=gemini 默认 gemini-3.5-flash，Ark/Doubao 可作为文本 LLM 路径；ASR_PROVIDER=faster_whisper/disabled，OCR_PROVIDER=easyocr）
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$HOME/anaconda3/envs/viral/bin:$PATH"   # 系统 node 是过期 v12
npm run build && node apps/api/dist/server.js

# 2) editing.mov → beat_cut → style-locked 15s 重构 → 渲染 → 导出
npm run e2e:editing-beatcut

# 3) 渲染质量 gate v3（beat_cut moving-material + human-fidelity 严格模式，40 项）
npm run eval:render-quality -- --render storage/generated/<renderId>.mp4 \
  --template /tmp/editing_e2e/template.json --generation /tmp/editing_e2e/generation.json \
  --sample test_videos/editing.mov --expect-video-type beat_cut --gates v3 --strict

# 4) 产品级全闭环 artifact runner（22 个 stage 目录 + 对比图 + per-clip motion + audio + v3 gate）
npm run full-loop:editing -- --sample ./test_videos/manual/editing.mov \
  --prompt "主题：爆款结构迁移引擎；..." --out docs/artifacts/full_loop_editing_mov

# 4) 单独跑证据分析器 / 模型 provider 评测
npm run analyze:evidence -- --video test_videos/editing.mov --out /tmp/ev.json --frames-dir /tmp/ev_frames
npm run eval:model-understanding -- --sample test_videos/editing.mov
```

输出（`storage/generated/` 渲染产物 + `docs/artifacts/model_eval/`）：beat_cut MP4（黑底大字 + 卡点 + 音频）、按 clip 抽帧的真实预览、`docs/artifacts/model_eval/editing_mov_model_eval.{json,md}`（heuristic / Gemini / Ark 对比，失败可见）。

验收：`packages/shared/src/__tests__/editingMovMovingMaterialGolden.test.ts`（v2 确定性 golden：8 槽位/分层时间线/诚实缺口/152 BPM；并证明 gate 有牙——理想渲染过线、修复前的静态渲染不过 motion 线）+ `editingMovBeatCutGolden.test.ts` + `scripts/evaluate-render-quality.mjs --gates v2`（27/27 gate）。v2 测试 oracle 在 `test_fixtures/expected_editing_mov_case_v2/`。

## Motion Graph 结构迁移演示

这是当前最强的 SDE/MLE harness 路径，专门证明系统不是只展示静态 JSON 或通用 B2B 模板。

```bash
# 无目标素材：输出 family-specific 程序化卡片（干净中文族名 + 真实文案，无 PROXY/PLACEHOLDER/占位 debug 文字）
node scripts/run-motion-graph-case.mjs

# 完整目标素材 fixture：卡片图、logo、copy 替换代理槽位
node scripts/run-motion-graph-case.mjs --with-target-assets

# 部分素材压力：只有 2 张卡片 + copy，无 logo
node scripts/run-motion-graph-case.mjs --with-partial-target-assets

# malformed 素材压力：外部路径、零字节、错误角色等必须被阻断
node scripts/run-motion-graph-case.mjs --with-malformed-target-assets

# 本地 manifest 输入：脚本模式支持 path manifest
node scripts/run-motion-graph-case.mjs --target-assets-manifest docs/fixtures/motion_graph_target_assets/manifest.json
```

主要输出：

```text
docs/artifacts/motion_graph_case/visual-evidence.json
docs/artifacts/motion_graph_case/induced-slots.json
docs/artifacts/motion_graph_case/selected-template.json
docs/artifacts/motion_graph_case/asset-evidence.json
docs/artifacts/motion_graph_case/slot-asset-matches.json
docs/artifacts/motion_graph_case/fill-plan.proxy.json
docs/artifacts/motion_graph_case/fill-plan.with-assets.json
docs/artifacts/motion_graph_case/replacement-slots.proxy.json
docs/artifacts/motion_graph_case/replacement-slots.with-assets.json
docs/artifacts/motion_graph_case/render_proxy.mp4
docs/artifacts/motion_graph_case/render_with_assets.mp4
docs/artifacts/motion_graph_case/render_partial_assets.mp4
docs/artifacts/motion_graph_case/render_malformed_assets.mp4
docs/artifacts/motion_graph_case/before_after_contact_sheet.png
docs/artifacts/motion_graph_case/partial_assets_contact_sheet.png
docs/artifacts/motion_graph_case/evaluation.motion_graph.json
```

目标素材 fixture：

```text
docs/fixtures/motion_graph_target_assets/
  logo.png
  card_01.png
  card_02.png
  card_03.png
  card_04.png
  copy.json
  manifest.json
  manifest.partial.json
  manifest.malformed.json
```

当前主流程 slot mapping：

| 诱导槽位 | 满足方式 |
|---|---|
| `media_cards` | 目标 image_set，至少 4 张卡片 |
| `kinetic_typography` | 目标品牌名 / copy |
| `ui_showcase` | 目标 feature copy list |
| `geometric_mg` | 程序化 neon geometry，不需要外部素材 |
| `brand_cta` | 目标 logo + CTA；缺 logo 时走 placeholder/proxy |

Corpus fixture：`test_videos/corpus/009_motion_graph_card_stack/fixture.json`。

## Managed Material Intake API

浏览器/API 模式不要求用户把本地路径暴露给 public artifacts。流程是：

```text
POST /api/projects/:projectId/assets
→ POST /api/projects/:projectId/target-material-manifests
→ 返回 normalized targetAssets / assetEvidence / blockedAssets
```

API manifest 使用 `assetId`，不使用任意本地路径：

```json
{
  "schemaVersion": "target-material-manifest-v1",
  "brandName": "Viral Structure Engine",
  "cta": "Upload. Analyze. Remix.",
  "features": ["Analyze sample videos", "Induce reusable slots"],
  "assets": [
    { "assetId": "uploaded_card_01", "kind": "image", "role": "media_card" },
    { "assetId": "uploaded_logo", "kind": "logo", "role": "brand_logo" }
  ]
}
```

响应中的素材引用使用安全 ID，例如 `asset://managed/<assetId>`；真实服务器路径只在 renderer 内部解析，不进入 public JSON/HTML。

## 可选 AIGC 素材补全

AIGC Material Fill 是可选增强路径。V5 UI 默认会在缺素材时开启缺口补全，但真实外部 provider 仍受 `.env`、API 选项和安全开关控制；没有 key 或未允许外呼时会走程序化/确定性兜底。它用于“用户没有足够素材”时，把缺口变成结构化生成 brief，再生成候选素材、做质量检查、注册为 `aigc_generated_material`，最后进入同一个 slot matcher / fill plan / renderer。

浏览器入口：

- V5 Web 工作台的 `2 · Generate` 提供 **AIGC 补缺口并生成**能力。
- 面板里有“启用 AIGC gap fill”开关。
- 外部 provider 受独立安全开关控制；未允许外呼或缺少 key 时 live API 不调用外部图片 provider，而是回退到程序化卡片/本地确定性素材。
- API 请求会设置 AIGC gap-fill 选项；外部 provider 还需要 `.env` 中的 provider/key 和显式 allow 开关。
- 结果面板会展示 brief、candidate、quality/VLM 状态、external calls、sample frames sent 等字段。

允许外部 provider 后，live API 按顺序尝试：`google_gemini_image`（首选，默认 `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image`）→ `volcengine_seedream`（可选 backup，需 `AIGC_IMAGE_BACKUP_PROVIDER`）→ `deterministic_local_image_fill`（本地确定性兜底）。live 图片链路不会中断：所有外部 provider 失败时退回本地程序化 PNG 并记录 `providerFallbackReason` 警告。`deterministic_local_image_fill`（旧名 `mock_provider`，现仅作弃用别名）也用于 CI/脚本的确定性产物：

```bash
# 确定性本地 provider deterministic_local_image_fill（旧名 mock_provider，现仅作弃用别名；仅脚本/CI，不外呼）
node scripts/run-motion-graph-case.mjs --with-aigc-materials

# .env 指定 provider，显式允许外部调用
node scripts/run-motion-graph-case.mjs --with-aigc-materials --aigc-provider env --allow-external-aigc

# 端到端实跑：editing/motion 样例 → 真实 Gemini AIGC 图片 + 字幕 → 渲染 → 落到 docs/artifacts/full_pipeline_aigc_*/
node scripts/run-full-pipeline-aigc-demo.mjs --sample test_videos/motion_graph_1.mov --theme "AI 短视频结构迁移引擎"
```

> 真实生成（Gemini chunk + AIGC + 渲染）可能超过客户端 HTTP 超时。长任务用异步：`POST /api/generations?async=true` 立即返回 `202 {jobId}`，再轮询 `GET /api/jobs/:jobId` 拿 `outputRefs.generationId`，最后 `GET /api/generations/:id`。上面的脚本已内置该轮询。

Provider 配置示例，`.env` 不要提交：

```bash
AIGC_MATERIAL_FILL_ENABLED=false

# 首选：Google Gemini Image / Nano Banana（AI Studio 可达）
AIGC_IMAGE_PROVIDER=google_gemini_image
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_API_KEY=<your_gemini_key>

# backup：Volcengine Seedream
AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream
SEEDREAM_ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDREAM_ARK_API_KEY=<your_seedream_key>
SEEDREAM_ARK_MODEL=<your_seedream_model_id>   # 必填，无内置默认；未设置 SEEDREAM_ARK_MODEL/AIGC_IMAGE_MODEL 时 Seedream 配置直接抛错
SEEDREAM_IMAGE_ENDPOINT=/images/generations
SEEDREAM_RESPONSE_FORMAT=url
SEEDREAM_IMAGE_SIZE=2K
SEEDREAM_STREAM=false
SEEDREAM_WATERMARK=false

# video material（主）：Volcengine Seedance 2.0 Fast（Ark task API，纯文生视频）
AIGC_VIDEO_PROVIDER=seedance_2_0
AIGC_VIDEO_MODEL=doubao-seedance-2-0-fast-260128
# 可复用同一个 Ark bearer key；若已设置 SEEDREAM_ARK_API_KEY，可不单独设置这一项
SEEDANCE_ARK_API_KEY=<your_seedance_or_seedream_ark_key>
SEEDANCE_TASK_ENDPOINT=/contents/generations/tasks
SEEDANCE_GENERATE_AUDIO=true
SEEDANCE_WATERMARK=false

# video material（备份）：Alibaba DashScope happyhorse-1.0-r2v（reference-to-video）
# Seedance 失败（AccountOverdue/403/审核 400）时自动顶上；用 Gemini 静图作 base64 reference_image。
# 地域必须一致：US key → dashscope-us 域名。
AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v
DASHSCOPE_API_KEY=<your_dashscope_key>
DASHSCOPE_BASE_URL=https://dashscope-us.aliyuncs.com/api/v1
HAPPYHORSE_MODEL=happyhorse-1.0-r2v
HAPPYHORSE_RESOLUTION=720P
```

Gemini VLM 既驱动视频理解，也作为生成素材质量 gate（默认 `gemini-3.5-flash`；`gemini-2.5-pro`/`gemini-2.5-flash` 为可选备选，经 `VLM_MODEL` 切换）：

```bash
VLM_PROVIDER=gemini
VLM_MODEL=gemini-3.5-flash          # alt: gemini-2.5-pro | gemini-2.5-flash
GEMINI_VLM_FALLBACK_MODEL=gemini-2.5-flash
GEMINI_API_KEY=<your_gemini_key>
```

AIGC 输出：

```text
docs/artifacts/motion_graph_case/aigc-material-briefs.json
docs/artifacts/motion_graph_case/generated-assets/
docs/artifacts/motion_graph_case/generated-asset-candidates.json
docs/artifacts/motion_graph_case/generated-asset-quality.json
docs/artifacts/motion_graph_case/asset-evidence.aigc.json
docs/artifacts/motion_graph_case/slot-asset-matches.aigc.json
docs/artifacts/motion_graph_case/fill-plan.aigc.json
docs/artifacts/motion_graph_case/replacement-slots.aigc.json
docs/artifacts/motion_graph_case/render_aigc_materials.mp4
docs/artifacts/motion_graph_case/aigc_materials_contact_sheet.png
```

AIGC 安全策略：

- 默认不生成、不外呼。
- 外部 provider 必须显式勾选 UI 开关，或在脚本模式下传 `--allow-external-aigc`。
- 允许后 live 链路按 `google_gemini_image → volcengine_seedream → deterministic_local_image_fill` 顺序调用，所有外部 provider 失败时退回本地确定性程序化 PNG（不中断渲染，记录 `providerFallbackReason`）。
- Seedance 视频素材生成走真实 Ark task API；失败时记录错误警告但不中断渲染——不产出云端视频，base 生成的程序化 Remotion/FFmpeg 动态代理仍作为本地素材保留（server.ts:1855-1860）。
- 样例帧不会发给外部 provider（`sampleFramesSentExternally=false`）。
- 样例视频/音频不会作为 Seedance `reference_video`/`reference_audio` 上传；当前只发送目标素材文本 prompt。
- Seedream 图片请求默认 `watermark=false`。
- 不伪造真实品牌 logo；`brand_cta` 缺 logo 时生成程序化卡片/copy 或要求用户上传。
- 生成素材必须带 provenance，标记为 `aigc_generated_material`，不能冒充用户上传素材。

## Provider 配置摘要

| 能力 | 默认 | 真实实现 | 开关 |
|---|---|---|---|
| 视频分析 | FFmpeg（mock 已删除） | FFmpeg / ffprobe / keyframes（失败直接报错） | `VIDEO_TOOL=ffmpeg` |
| 证据分析器 | 自动（有 conda 时） | PySceneDetect 切点 + librosa 鼓点 + 关键帧/视觉族（`scripts/analyze-evidence-timeline.py`） | 随分析自动运行，失败非致命 |
| LLM（文本增强/改写/评分） | `gemini`（默认 `gemini-3.5-flash`；alt 2.5-pro/2.5-flash） | Gemini（首选） / Ark Doubao（backup） / OpenAI-compatible | `AI_PROVIDER=gemini|ark_doubao|openai_compatible`；`AI_GEMINI_MODEL` 选模型 |
| VLM | disabled | Gemini（默认 `VLM_MODEL=gemini-3.5-flash`；alt `gemini-2.5-pro`/`gemini-2.5-flash`） | `VLM_PROVIDER=gemini` |
| 创意特效 codegen | disabled | Gemini 生成 Remotion 特效组件（默认 `GEMINI_CODEGEN_MODEL=gemini-3.5-flash`；zod schema + 静态校验 + named-import 存在性检查），失败回 local_fallback | `CREATIVE_EFFECT_GEMINI=1` + `ALLOW_CLOUD_PROVIDERS=1` |
| ASR | `faster_whisper`（本地） | faster-whisper（本地，可选）→ `no_asr_with_warning`。音频节奏/BPM 由 FFmpeg/librosa 证据链路负责，ASR 不再依赖 ElevenLabs。 | `ASR_PROVIDER=faster_whisper\|off` |
| OCR | disabled | EasyOCR | `OCR_PROVIDER=easyocr` |
| AIGC image material | disabled | Google Gemini Image 默认 `gemini-3.1-flash-image`（Nano Banana 2；alt Nano Banana Pro `gemini-3-pro-image` / `imagen-4.0-generate-001` / `gemini-2.5-flash-image`，首选）→ Volcengine Seedream（可选 backup，模型由 `SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL` 指定，无默认）→ `deterministic_local_image_fill`（本地确定性兜底，不中断） | `GEMINI_IMAGE_MODEL` 选模型；`AIGC_IMAGE_PROVIDER=google_gemini_image` / `AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream` + explicit flag |
| AIGC video material | disabled | 主 Volcengine Seedance 2.0 Fast（Ark，纯 t2v）→ 备份 Alibaba DashScope happyhorse-1.0-r2v（参考生视频，Gemini 静图作 base64 reference_image，Seedance 欠费/403 时自动顶上）→ AIGC 静图兜底 | `AIGC_VIDEO_PROVIDER=seedance_2_0` + `SEEDANCE_ARK_API_KEY`；`AIGC_VIDEO_BACKUP_PROVIDER=happyhorse_r2v` + `DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL`（US 域名） |
| 音频生成 | Google 优先（opt-in，永不致命） | Voiceover：Gemini TTS（默认 `gemini-3.1-flash-tts-preview`）→ 字幕/无旁白；Music：Lyria（默认 `lyria-3-clip-preview`）→ FFmpeg 程序化 BGM；SFX：FFmpeg 程序化 hit/riser/whoosh。最终经 FFmpeg 分层混音到 BGM 床上（bed / voiceover + adelay / procedural SFX，amix + highpass + alimiter）。 | `GEMINI_API_KEY` + `GOOGLE_AUDIO_ENABLE_CLOUD`/`ALLOW_CLOUD_PROVIDERS` + `GOOGLE_AUDIO_ENABLE_MUSIC\|TTS` |
| Renderer | FFmpeg（mock 已删除） | FFmpeg / Remotion / HyperFrames stub（程序化卡片，无 debug 文字） | request `rendererTarget` |
| Storage | JSON | SQLite | `STORAGE_BACKEND=json|sqlite` |

> Google 音频栈（Gemini TTS voiceover + Lyria music）已接入 `apps/api/src/adapters/googleAudio.ts`，server 渲染前先注入 Google 音频；失败后直接走本地 FFmpeg/librosa/procedural 音频。ElevenLabs 不再是必要 provider，也不再作为 ASR、Music、TTS、SFX 的默认/备选路径。Forced Alignment / Audio Isolation / Dubbing / Lip Sync 不属于当前 rubric 必需能力，路由为 skip/local report。

## 仍需人工配置的内容

- Ark Doubao / OpenAI-compatible LLM key：用于结构抽取、自然语言修改、LLM scorecard。
- Gemini key：用于真实 VLM 视频理解和 AIGC 素材质量 gate。
- Seedream key + model id：用于可选外部图片素材生成；`SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL` 无内置默认，未设置时配置直接抛错。
- Seedance/Ark key：用于可选外部视频素材生成；可复用 `SEEDREAM_ARK_API_KEY`。
- Google audio：Gemini TTS / Lyria 复用 `GEMINI_API_KEY`，需要 `GOOGLE_AUDIO_ENABLE_CLOUD=1` 或 `ALLOW_CLOUD_PROVIDERS=1`，当前账号仍需要可用 billing/credits。
- faster-whisper / easyocr：按需安装到 conda env `viral`（faster-whisper 是本地 ASR；音频节奏/BPM 主要由 FFmpeg/librosa 证据链路提供）。
- Remotion Chromium：第一次真实 Remotion render 会下载浏览器缓存。

## 运行边界与注意事项

- 外部 AIGC 图片、Seedance 短视频、happyhorse 参考转视频、Google Lyria/TTS 都已接入；真实云效果需要 `.env` 中显式开关和可用 key。
- 默认安全策略不会把样例视频/音频作为生成 provider 的参考素材；用户目标素材的像素级 VLM 分析也需要 `ALLOW_EXTERNAL_VLM_USER_ASSET_ANALYSIS=1`。
- 文本模型和多模态模型是分离请求：`createTextModelFn` 有 Ark/Doubao key 时优先 Doubao，否则走 Gemini；样例视频/帧理解和 Gen1 视觉胶囊生成走 Gemini。
- 真实 provider 失败时不会伪造云结果；生成链路会记录 warning，并回退到程序化视觉/音频或确定性 fixture。
- Remotion 真渲染依赖本地 Chromium、FFmpeg 和 `@remotion/three` / `@react-three/fiber` 版本匹配；长视频和 AIGC 视频生成耗时较长，建议用 UI 进度条或 `/api/v5/jobs/:jobId/progress` 观察状态。
- `scripts/record-v5-demo.mjs` 可用 Playwright 录制高分辨率 UI 演示，支持只演示按钮、真实 Learn/Generate/Revise、下载导出 JSON 等开关。
