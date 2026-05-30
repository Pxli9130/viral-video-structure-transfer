# 爆款结构迁移引擎

**Viral Video Structure Transfer Engine / 爆款结构迁移引擎：从样例拆解、素材补全到视频重组的 AI 创作平台**

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

旧版 `specs_v1/` 和 `spec_v1_1/` 仅保留作历史追踪，当前以 `spec_v2/` 为准。

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
→ PySceneDetect 场景切点 + 每镜头关键帧/视觉族标签（scripts/analyze-evidence-timeline.py）
→ librosa 鼓点网格（BPM / beats / onsets）
→ OCR / ASR 文本按时间戳绑定到镜头
→ VisualEvidenceTimeline（每个 induced/required 槽位带 frameIds + timeRange + 证据缩略图）
→ Gemini VLM（被证据 grounding，不再自由发挥）→ Doubao/Ark 合并
→ beat_cut StructureTemplate（neon hero → kinetic rule cards → beat-sync montage → impact flash → CTA）
→ style-locked renderer（黑底、红黄大字、卡点硬切、动作混剪、红色 CTA ticker）+ 音频
→ 渲染质量 gate（无 placeholder、有音频/卡点、证据覆盖 ≥70%）
```

`beat_cut` 的判定来自**确定性证据**（快切 + 鼓点 + 黑底 + 动作混剪），不依赖 VLM 关键词，因此 LLM 失败也能稳定产出。AI 增强失败（如 Ark 401）会**显式标记** `aiEnrichmentStatus=failed/aiEnrichmentError`，绝不冒充干净模板。

实跑（需要 conda env `viral` + 真实 provider，分析会跑 Gemini/ASR/OCR/PySceneDetect/librosa，约几分钟）：

```bash
# 1) 起 API（真实 provider 由 .env 控制：VLM_PROVIDER=gemini(gemini-2.5-pro), AI_PROVIDER=gemini(gemini-2.5-flash, Ark Doubao 为 backup), ASR_PROVIDER=faster_whisper, OCR_PROVIDER=easyocr）
npm run build && node apps/api/dist/server.js

# 2) editing.mov → beat_cut → style-locked 15s 重构 → 渲染 → 导出
npm run e2e:editing-beatcut

# 3) 渲染质量 gate（beat_cut 严格模式）
npm run eval:render-quality -- --render storage/generated/<renderId>.mp4 \
  --template /tmp/editing_e2e/template.json --generation /tmp/editing_e2e/generation.json \
  --sample test_videos/editing.mov --expect-video-type beat_cut --strict

# 4) 单独跑证据分析器 / 模型 provider 评测
npm run analyze:evidence -- --video test_videos/editing.mov --out /tmp/ev.json --frames-dir /tmp/ev_frames
npm run eval:model-understanding -- --sample test_videos/editing.mov
```

输出（`storage/generated/` 渲染产物 + `docs/artifacts/model_eval/`）：beat_cut MP4（黑底大字 + 卡点 + 音频）、按 clip 抽帧的真实预览、`docs/artifacts/model_eval/editing_mov_model_eval.{json,md}`（heuristic / Gemini / Ark 对比，失败可见）。

验收：`packages/shared/src/__tests__/editingMovBeatCutGolden.test.ts`（golden 模板/时间线/风格锁）+ `scripts/evaluate-render-quality.mjs`（10/10 gate）。

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

允许外部 provider 后，live API 按顺序尝试真实 provider：`google_gemini_image`（首选，Gemini 2.5 Flash Image / “Nano Banana”）→ `volcengine_seedream`（backup）→ **真实报错**。它**不会**在 live 链路里回退到 mock；`mock_provider` 只保留给 CI/脚本的确定性产物：

```bash
# 确定性 mock provider（仅脚本/CI，不外呼）
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
SEEDREAM_ARK_MODEL=doubao-seedream-5-0-260128
SEEDREAM_IMAGE_ENDPOINT=/images/generations
SEEDREAM_RESPONSE_FORMAT=url
SEEDREAM_IMAGE_SIZE=2K
SEEDREAM_STREAM=false
SEEDREAM_WATERMARK=false
```

Gemini VLM 既驱动视频理解，也作为生成素材质量 gate：

```bash
VLM_PROVIDER=gemini
VLM_MODEL=gemini-2.5-pro
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
- 允许后 live 链路按 `google_gemini_image → volcengine_seedream → 真实报错` 顺序调用真实 provider，绝不在 live 链路回退 mock。
- 样例帧不会发给外部 provider（`sampleFramesSentExternally=false`）。
- Seedream 图片请求默认 `watermark=false`。
- 不伪造真实品牌 logo；`brand_cta` 缺 logo 时生成程序化卡片/copy 或要求用户上传。
- 生成素材必须带 provenance，标记为 `aigc_generated_material`，不能冒充用户上传素材。

## Provider 配置摘要

| 能力 | 默认 | 真实实现 | 开关 |
|---|---|---|---|
| 视频分析 | FFmpeg（mock 已删除） | FFmpeg / ffprobe / keyframes（失败直接报错） | `VIDEO_TOOL=ffmpeg` |
| 证据分析器 | 自动（有 conda 时） | PySceneDetect 切点 + librosa 鼓点 + 关键帧/视觉族（`scripts/analyze-evidence-timeline.py`） | 随分析自动运行，失败非致命 |
| LLM（文本增强/改写/评分） | `gemini`（gemini-2.5-flash；mock 已删除） | Gemini（首选） / Ark Doubao（backup） / OpenAI-compatible | `AI_PROVIDER=gemini|ark_doubao|openai_compatible`（未知值直接报错，不再回退 mock） |
| VLM | disabled | Gemini gemini-2.5-pro（视频理解 + 素材质量 gate） | `VLM_PROVIDER=gemini` |
| ASR | disabled | faster-whisper | `ASR_PROVIDER=faster_whisper` |
| OCR | disabled | EasyOCR | `OCR_PROVIDER=easyocr` |
| AIGC image material | disabled | Google Gemini Image gemini-2.5-flash-image（首选）→ Volcengine Seedream（backup）→ 真实报错 | `AIGC_IMAGE_PROVIDER=google_gemini_image` / `AIGC_IMAGE_BACKUP_PROVIDER=volcengine_seedream` + explicit flag |
| Renderer | FFmpeg（mock 已删除） | FFmpeg / Remotion / HyperFrames stub（程序化卡片，无 debug 文字） | request `rendererTarget` |
| Storage | JSON | SQLite | `STORAGE_BACKEND=json|sqlite` |

## 仍需人工配置的内容

- Ark Doubao / OpenAI-compatible LLM key：用于结构抽取、自然语言修改、LLM scorecard。
- Gemini key：用于真实 VLM 视频理解和 AIGC 素材质量 gate。
- Seedream key：用于可选外部图片素材生成。
- faster-whisper / easyocr：按需安装到 conda env `viral`。
- Remotion Chromium：第一次真实 Remotion render 会下载浏览器缓存。

## 当前限制

- 外部 AIGC 目前只用于图片素材生成；不默认生成整段视频。
- Seedance/视频生成 provider 仍是后续 P1 能力，不是当前默认路径。
- Gemini 只作为质量 gate，不是唯一事实来源。
- evidence-first beat_cut pipeline 已接入实时 API（`editing.mov` 端到端经真实 Gemini/ASR/OCR/PySceneDetect/librosa 产出 beat_cut MP4 并通过 10/10 gate）；motion_graph 仍走 ribbon-centric analyzer，两条线尚未统一成单一证据分析器。
- **已删除所有 mock 适配器**（MockAIAdapter / MockVideoToolAdapter / MockRenderer / `mock_preview` / 文本 mock 样例分析）。真实 provider 失败时直接报错，绝不伪造结果。`AI_PROVIDER` 现支持 `gemini`（默认，文本 LLM 与 Gemini VLM 是**分离的不同 request**）/ `ark_doubao` / `openai_compatible`；因示例 `ARK_API_KEY` 401，已切到 `AI_PROVIDER=gemini`，`aiEnrichmentStatus=ok`。（`buildMockVideoAnalysis` 仅作为单元测试/seed/case 脚本的确定性 fixture，不在运行链路中。）
- beat-cut renderer / 真实帧目前在 FFmpeg MP4 路径最完整；Remotion 组件尚未镜像全部 beat-cut primitives（ImpactFlashStamp 等）。
- 浏览器已有 AIGC gap-fill 按钮和基础结果面板；更完整的拖拽上传、人工审核/选择生成候选、批量素材管理仍是产品化工作。
- 时间线预览的真实帧目前只在 FFmpeg MP4 渲染路径生成；HTML preview / Remotion / HyperFrames 仍回退到占位卡（Remotion 后续可从最终 MP4 按 `clip.startSec` 抽帧统一支持）。
- FFmpeg renderer 的程序化卡片（`media_cards`/`ui_showcase`/`kinetic_typography`/`geometric_mg`/`brand_cta` 等）已改为干净中文族名 + 真实文案，渲染帧不再出现任何 `PROXY`/`PLACEHOLDER`/占位 debug 文字（已逐族渲染验证）。
