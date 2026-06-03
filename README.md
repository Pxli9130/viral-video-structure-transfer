# 爆款结构迁移引擎

**Viral Video Structure Transfer Engine / 爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台**

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

**最终提交规范以 [`spec_v3/`](./spec_v3/) 为准**（Spec v1.3 — Source-first RenderRecipe Engine）；`spec_v2/` 仍是更广的产品规范，`specs_v1/` 和 `spec_v1_1/` 仅作历史追踪。

- [Spec v1.3 需求](./spec_v3/requirements.md)、[系统设计](./spec_v3/design.md)、[RenderRecipe schema](./spec_v3/schemas/render-recipe.schema.json)、[实现状态](./spec_v3/implementation-status.md)、[演示脚本](./spec_v3/demo-playbook.md)

## Spec v1.3 — Source-first RenderRecipe（最终提交演示）

针对「渲染 overfit」investigation（[REPORT](./docs/artifacts/render_overfit_findings/REPORT.md)）暴露的「样例无关的固定模具」问题（同类 beat_cut 输入坍缩成同一 6-primitive 序列，跨样例布局 NCC 0.868–1.000），v1.3 把渲染改成 **source-first + RenderRecipe 单一契约**：

```text
样例视频 = 仅结构证据（不复制帧/音频/水印）
目标素材 / 源视频 = 进画面的输出素材
→ buildRenderRecipe（timeline.renderPlan.renderRecipe，唯一渲染契约，每个 clip 带可审计 primitiveReason）
→ FFmpeg（合成真实素材像素 + 卡点字幕 + 程序化 BGM，产出 final.mp4）
   与 Remotion ViralRecipe composition（消费同一 recipe，产出 final.remotion.mp4）
```

最终演示产品是 **AeroSpin 便携涡轮小风扇**产品广告。仓库无真实风扇素材，故目标素材由**真实 Gemini 2.5 Flash Image（Nano Banana）生成**并标注 provenance `aigc_generated_material`（非用户上传、非真实产品照）。

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

- Web: <http://localhost:5173>
- API health: <http://localhost:3000/healthz>

基础 UI 流程：

1. 创建或打开项目。
2. 上传样例视频，分析结构。
3. 查看 StructureTemplate 和 KnowledgeAtom。
4. 上传源视频并输入需求。
5. 在“重构规划器”里生成重构计划、slot mapping、gap report、fill plan。
6. 可选：点击 **AIGC 补缺口并生成**，把缺失视觉槽位转成生成 brief，经质量检查后作为 `aigc_generated_material` 进入同一套匹配/渲染链路。
7. 选择 HTML preview / FFmpeg MP4 / Remotion / HyperFrames 等 renderer。用 FFmpeg MP4 渲染后，“时间线预览”卡片会显示每个片段在对应时间戳的**真实渲染帧**（从渲染分段抽帧，存到 `storage/generated/previews/<renderId>/clip_<n>.png`，随 `RenderOutput.clipPreviewFrames` 返回），而不是绿色渐变占位图。
8. 导出 request、timeline、report、scorecard。

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
→ Gemini VLM（被证据 grounding，不再自由发挥）→ Doubao/Ark 合并
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
# 1) 起 API（真实 provider 由 .env 控制：VLM_PROVIDER=gemini(.env VLM_MODEL=gemini-2.5-pro 覆盖 adapter 默认 gemini-2.5-flash), AI_PROVIDER=gemini(gemini-2.5-flash, Ark Doubao 为 backup), ASR_PROVIDER=elevenlabs_scribe(cloud-first, faster-whisper 为本地 fallback), OCR_PROVIDER=easyocr）
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

AIGC Material Fill 是可选路径，默认关闭。它用于“用户没有足够素材”时，把缺口变成结构化生成 brief，再生成候选素材、做质量检查、注册为 `aigc_generated_material`，最后进入同一个 slot matcher / fill plan / renderer。

浏览器入口：

- Web 工作台的“步骤 5 / 重构规划器”提供 **AIGC 补缺口并生成**按钮。
- 面板里有“启用 AIGC gap fill”开关。
- “允许外部 provider”是独立开关；**不勾选时 live API 不调用任何外部图片 provider**（缺口保留为程序化卡片，不生成图片）。
- API 请求会设置 `controls.allowAigcMaterialGeneration=true`；外部 provider 还需要 `controls.allowExternalAigcProvider=true`。
- 结果面板会展示 brief、candidate、quality/VLM 状态、external calls、sample frames sent 等字段。

允许外部 provider 后，live API 按顺序尝试：`google_gemini_image`（首选，Gemini 2.5 Flash Image / “Nano Banana”）→ `volcengine_seedream`（可选 backup，需 `AIGC_IMAGE_BACKUP_PROVIDER`）→ `deterministic_local_image_fill`（本地确定性兜底）。live 图片链路不会中断：所有外部 provider 失败时退回本地程序化 PNG 并记录 `providerFallbackReason` 警告（server.ts:1687-1721）。`deterministic_local_image_fill`（旧名 `mock_provider`，现仅作弃用别名）也用于 CI/脚本的确定性产物：

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

# 首选：Google Gemini Nano Banana（AI Studio 可达）
AIGC_IMAGE_PROVIDER=google_gemini_image
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
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

# video material：Volcengine Seedance 2.0 Fast（Ark task API）
AIGC_VIDEO_PROVIDER=seedance_2_0
AIGC_VIDEO_MODEL=doubao-seedance-2-0-fast-260128
AIGC_VIDEO_MAX_ASSETS_PER_RUN=1
# 可复用同一个 Ark bearer key；若已设置 SEEDREAM_ARK_API_KEY，可不单独设置这一项
SEEDANCE_ARK_API_KEY=<your_seedance_or_seedream_ark_key>
SEEDANCE_TASK_ENDPOINT=/contents/generations/tasks
SEEDANCE_GENERATE_AUDIO=true
SEEDANCE_WATERMARK=false
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
| ASR | `elevenlabs_scribe`（首选，cloud-first） | ElevenLabs Scribe（`scribe_v2`，云端，需 ElevenLabs key + `ENABLE_ELEVENLABS_LIVE_TESTS`/`ELEVENLABS_ENABLE_CLOUD`/`_SCRIBE`/`_ASR`）→ faster-whisper（本地 fallback）→ `no_asr_with_warning`。Google TTS/Lyria 不替代带 word timestamp 的 ASR。 | `ASR_PROVIDER=elevenlabs_scribe\|faster_whisper` |
| OCR | disabled | EasyOCR | `OCR_PROVIDER=easyocr` |
| AIGC image material | disabled | Google Gemini Image 默认 `gemini-3.1-flash-image`（Nano Banana 2；alt Nano Banana Pro `gemini-3-pro-image` / `imagen-4.0-generate-001` / `gemini-2.5-flash-image`，首选）→ Volcengine Seedream（可选 backup，模型由 `SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL` 指定，无默认）→ `deterministic_local_image_fill`（本地确定性兜底，不中断） | `GEMINI_IMAGE_MODEL` 选模型；`AIGC_IMAGE_PROVIDER=google_gemini_image` / `AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream` + explicit flag |
| AIGC video material | disabled | Volcengine Seedance 2.0 Fast via Ark task API；失败不中断（保留程序化代理） | `AIGC_VIDEO_PROVIDER=seedance_2_0` + `SEEDANCE_ARK_API_KEY`/`SEEDREAM_ARK_API_KEY` + explicit flag |
| 音频生成 | Google 优先（opt-in，永不致命） | Voiceover：Gemini TTS（默认 `gemini-3.1-flash-tts-preview`）→ ElevenLabs TTS → 字幕/无旁白；Music：Lyria（默认 `lyria-3-clip-preview`）→ ElevenLabs Music → FFmpeg 程序化 BGM；SFX：ElevenLabs SFX → FFmpeg 程序化 SFX。最终经 FFmpeg 分层混音到 BGM 床上（bed 0.42 / voiceover 1.25+adelay400 / SFX 0.7，amix + highpass + alimiter）。 | `GEMINI_API_KEY` + `GOOGLE_AUDIO_ENABLE_CLOUD`/`ALLOW_CLOUD_PROVIDERS` + `GOOGLE_AUDIO_ENABLE_MUSIC\|TTS`；ElevenLabs 作为备选用 `ELEVENLABS_*` |
| Renderer | FFmpeg（mock 已删除） | FFmpeg / Remotion / HyperFrames stub（程序化卡片，无 debug 文字） | request `rendererTarget` |
| Storage | JSON | SQLite | `STORAGE_BACKEND=json|sqlite` |

> Google 音频栈（Gemini TTS voiceover + Lyria music）已接入 `apps/api/src/adapters/googleAudio.ts`，server 渲染前先注入 Google 音频，再尝试 ElevenLabs 备选，最后走本地 FFmpeg 程序化音频。ElevenLabs 仍负责 Scribe ASR、SFX、Audio Isolation、Forced Alignment，并作为 TTS/Music 备选。全部为显式 opt-in，失败仅降级为 warning + 下一层 fallback，永不致命。Dubbing / Lip Sync **尚未实现**（`dubbing` ModelTask 首选 `skip_with_warning`，无 adapter 方法；不存在 `lip_sync` 任务），不作为当前能力。

## 仍需人工配置的内容

- Ark Doubao / OpenAI-compatible LLM key：用于结构抽取、自然语言修改、LLM scorecard。
- Gemini key：用于真实 VLM 视频理解和 AIGC 素材质量 gate。
- Seedream key + model id：用于可选外部图片素材生成；`SEEDREAM_ARK_MODEL`/`AIGC_IMAGE_MODEL` 无内置默认，未设置时配置直接抛错。
- Seedance/Ark key：用于可选外部视频素材生成；可复用 `SEEDREAM_ARK_API_KEY`。
- Google audio：Gemini TTS / Lyria 复用 `GEMINI_API_KEY`，需要 `GOOGLE_AUDIO_ENABLE_CLOUD=1` 或 `ALLOW_CLOUD_PROVIDERS=1`，当前账号仍需要可用 billing/credits。
- ElevenLabs key：用于备选 ElevenLabs 音频栈（Scribe ASR / TTS / SFX / Music）；默认 ASR 首选 cloud Scribe（`ASR_PROVIDER=elevenlabs_scribe`）。
- faster-whisper / easyocr：按需安装到 conda env `viral`（faster-whisper 是 cloud Scribe 不可用时的本地 ASR fallback）。
- Remotion Chromium：第一次真实 Remotion render 会下载浏览器缓存。

## 当前限制

- 外部 AIGC 图片和 Seedance 短视频素材都已接入；默认仍需显式开关和真实 key，且不会上传样例媒体给生成 provider。
- Gemini 只作为质量 gate，不是唯一事实来源。
- evidence-first beat_cut pipeline 已接入实时 API 并升级到 **v2 moving-material 版**（`editing.mov` 端到端经真实 Gemini/ASR/OCR/PySceneDetect/librosa + 光流 motionEnergy 产出 8 槽位 beat_cut、分层时间线、动态渲染，通过 `--gates v2` 27/27）；motion_graph 仍走 ribbon-centric analyzer，两条线尚未统一成单一证据分析器。
- v2 本轮聚焦 感知→模板→渲染→gate 闭环；KB 的 moving/背景/BGM/分镜 证据面板、SAM2 物体追踪、AIGC 视频（Seedance）补 moving 素材属于下一轮（当前缺 moving 素材用高运动程序化代理 + 上报 `moving_material_missing`）。
- **已删除所有 mock 适配器**（MockAIAdapter / MockVideoToolAdapter / MockRenderer / `mock_preview` / 文本 mock 样例分析）。真实 provider 失败时直接报错，绝不伪造结果。`AI_PROVIDER` 现支持 `gemini`（默认，文本 LLM 与 Gemini VLM 是**分离的不同 request**）/ `ark_doubao` / `openai_compatible`；因示例 `ARK_API_KEY` 401，已切到 `AI_PROVIDER=gemini`，`aiEnrichmentStatus=ok`。（`buildMockVideoAnalysis` 仅作为单元测试/seed/case 脚本的确定性 fixture，不在运行链路中。）
- beat-cut renderer / 真实帧目前在 FFmpeg MP4 路径最完整；Remotion 组件尚未镜像全部 beat-cut primitives（ImpactFlashStamp 等）。
- 浏览器已有 AIGC gap-fill 按钮和基础结果面板；更完整的拖拽上传、人工审核/选择生成候选、批量素材管理仍是产品化工作。
- 时间线预览的真实帧目前只在 FFmpeg MP4 渲染路径生成；HTML preview / Remotion / HyperFrames 仍回退到占位卡（Remotion 后续可从最终 MP4 按 `clip.startSec` 抽帧统一支持）。
- FFmpeg renderer 的程序化卡片（`media_cards`/`ui_showcase`/`kinetic_typography`/`geometric_mg`/`brand_cta` 等）已改为干净中文族名 + 真实文案，渲染帧不再出现任何 `PROXY`/`PLACEHOLDER`/占位 debug 文字（已逐族渲染验证）。
