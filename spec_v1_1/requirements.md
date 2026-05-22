# Requirements — 爆款结构迁移引擎 MVP Spec v1.1

## 1. Product Scope

MVP v1.1 聚焦一个可运行、可验证、可继续扩展的核心闭环：

```text
样例视频学习
→ 结构模板 / 结构原子沉淀
→ 结构知识库
→ 新视频 + Prompt 输入
→ 槽位匹配与素材缺口识别
→ 缺口补全与重构规划
→ Storyboard / Timeline JSON
→ 浏览器预览，后续可扩展为 FFmpeg / Remotion / HyperFrames 渲染
```

本版本的关键不是覆盖所有 PRD 功能，而是把系统边界、数据协议、模块接口和验证路径先定下来，使后续 P1/P2 可以在现有架构上扩展。

### 1.1 Official FAQ Alignment

MVP v1.1 对齐以下官方 FAQ 方向：

1. 评测时可能会使用评委自己的素材来跑系统，因此系统不能只依赖提交时绑定的固定素材。
2. 测试素材更可能是视频，通常是一个较长视频素材，而不是默认给多个分镜素材。
3. 推荐输入形态可以是“一段视频 + 一个提示词”。视频作为素材输入，系统结合已沉淀的结构知识库经验去重构生成新视频。
4. 不提供视频生成模型 token，Doubao-Seed-2.0-lite 不能直接生成视频。系统应优先用 FFmpeg、Remotion、HyperFrames 或浏览器预览完成验证。
5. 生成速度和延迟不是核心评价指标，结构规划合理性、过程可解释性和最终产物效果更重要。
6. 可以聚焦一个垂类，不要求覆盖越多视频类型越好，但需要在文档中说明方向。

### 1.2 MVP Primary Vertical

MVP 首选垂类：**B-end marketing / MG-style promo short videos**。

原因：

- 对真实视频生成模型依赖低。
- 可以通过标题条、字幕卡、商品卡片、转场、贴纸、图文动画和裁切复用完成 demo。
- 适合后续接入 Remotion 或 HyperFrames 做 video-as-code 渲染。

后续可扩展到：C-end vlog、口播剪辑、一镜到底口播重剪、剪辑卡点、短剧高光重组、多样例融合。

## 2. MVP User Stories

### US-001 创建项目与选择垂类

作为创作者，我希望创建一个视频迁移项目，以便管理样例、素材、模板、知识库和生成结果。

**Acceptance Criteria**

- WHEN 用户进入首页 THEN 系统 SHALL 展示项目列表与“创建项目”入口。
- WHEN 用户创建项目并填写项目名、视频类型、目标比例、目标时长和垂类 THEN 系统 SHALL 创建项目记录。
- WHEN 项目创建成功 THEN 系统 SHALL 进入项目工作台。
- MVP SHALL 默认提供 `b2b_marketing_mg` 垂类。

### US-002 上传样例视频并解析基础信息

作为创作者，我希望上传一条或多条样例视频，让系统解析基础信息，为结构抽取和知识库沉淀做准备。

**Acceptance Criteria**

- WHEN 用户上传 MP4 或 MOV 样例视频 THEN 系统 SHALL 保存文件并创建 Asset 记录。
- WHEN 用户点击“分析样例” THEN 系统 SHALL 提取时长、分辨率、fps、音频轨信息和封面候选。
- WHEN 视频解析完成 THEN 系统 SHALL 展示 metadata、关键帧、镜头列表和处理状态。
- IF FFmpeg/FFprobe 不可用或解析失败 THEN 系统 SHALL 使用 deterministic mock analysis 继续跑通 demo，并展示可读提示。

### US-003 抽取结构模板与结构原子

作为创作者，我希望系统从样例中抽取可迁移的结构模板和可复用结构原子，而不是只给一段自然语言总结。

**Acceptance Criteria**

- WHEN 样例基础解析完成 THEN 系统 SHALL 生成 Structure Template JSON。
- Structure Template SHALL 至少包含 `segments`、`shots`、`packaging`、`rhythm`、`qualityRules`。
- Structure Template SHALL 至少覆盖以下 2 类结构：脚本/段落结构、节奏结构、包装结构。
- Structure Template SHALL 生成 `structureAtoms`，例如 hook pattern、selling point card、CTA pattern、transition pattern。
- WHEN AI 模型不可用 THEN 系统 SHALL 使用 deterministic fallback 生成一个可验证的默认结构模板。
- WHEN 结构模板生成完成 THEN 用户 SHALL 能保存模板到结构知识库。

### US-004 维护结构知识库

作为创作者，我希望系统把多个样例中学到的结构经验沉淀为知识库，以便后续新视频重构时复用。

**Acceptance Criteria**

- WHEN 用户保存 Structure Template THEN 系统 SHALL 将 template 和 structure atoms 写入项目知识库。
- Knowledge Base SHALL 支持按垂类、结构角色、包装风格、节奏类型检索。
- Knowledge Base SHALL 展示每个结构原子的来源样例、用途、适用条件和替换策略。
- MVP SHALL 至少支持本地 JSON 或 SQLite 持久化。

### US-005 输入新视频 + Prompt 进行重构

作为创作者或评委，我希望上传一段新的较长视频素材并输入提示词，让系统基于结构知识库重构生成一个新短视频方案。

**Acceptance Criteria**

- WHEN 用户选择 `video_plus_prompt` 输入模式 THEN 系统 SHALL 要求输入 source video 和 prompt。
- Source video SHALL 被保存为 `source_video` asset。
- Prompt SHALL 支持描述目标主题、商品、受众、卖点、风格、CTA、禁用内容和目标时长。
- WHEN 用户没有选择具体模板 THEN 系统 SHALL 从知识库中选择适合当前垂类和 prompt 的结构模板或结构原子。
- MVP SHALL 允许用户手动选择一个 template 作为约束，以便降低实现复杂度。

### US-006 新素材理解与候选片段生成

作为创作者，我希望系统理解新上传的视频素材，并从中选出可用于重构的候选片段。

**Acceptance Criteria**

- WHEN source video 上传完成 THEN 系统 SHALL 提取 metadata、keyframes 和 shot candidates。
- 每个 shot candidate SHALL 包含 start/end/duration、thumbnail、basic tags 和 confidence。
- MVP SHALL 支持用启发式规则生成 tags，例如 `product_like`、`person_scene`、`usage_scene`、`background`、`text_card_candidate`。
- IF source video 解析失败 THEN 系统 SHALL 允许使用 seeded/mock source shots 继续验证主流程。

### US-007 槽位匹配与素材缺口识别

作为创作者，我希望系统告诉我哪些目标结构槽位能被新视频素材满足，哪些地方需要补全或重排。

**Acceptance Criteria**

- WHEN 用户选择模板/知识库结构并上传 source video THEN 系统 SHALL 将结构 slot 与 source video shot candidates 进行匹配。
- 每个 slot SHALL 产生一个状态：`matched`、`weak_match` 或 `missing`。
- WHEN slot 状态为 `missing` THEN 系统 SHALL 给出影响说明、严重程度和推荐补全策略。
- MVP SHALL 至少识别以下缺口类型：开头吸引镜头、商品特写、使用过程、对比镜头、结尾 CTA、字幕/文案不足。
- 系统 SHALL 避免把样例视频画面直接作为新视频素材，除非该样例本身也是用户授权素材。

### US-008 缺口补全与重构计划

作为创作者，我希望即使素材不足，系统也能给出可解释的补全方案，而不是生成失败。

**Acceptance Criteria**

- WHEN 系统发现 missing slot THEN 系统 SHALL 为每个 missing slot 选择至少一种补全策略。
- MVP SHALL 支持以下补全策略中的至少 3 种：
  - `reuse_with_crop_zoom`：复用 source video 或图片片段，做裁切、放大、重复、慢放。
  - `text_card`：用标题卡、卖点卡、解释卡代替缺失画面。
  - `packaging_overlay`：使用标题条、贴纸、箭头、高亮框、字幕包装补足表达。
  - `reorder_structure`：调整段落结构，降低对缺失镜头的依赖。
  - `aigc_placeholder`：生成可后续替换的素材 prompt 或占位背景，不要求真实生视频。
- 补全计划 SHALL 写入 Timeline JSON，并确保最终时间线没有空 slot。
- 系统 SHALL 展示“缺口 → 补全策略 → 结果片段”的映射。

### US-009 结构迁移生成 Storyboard 与 Timeline

作为创作者，我希望系统基于样例结构、结构知识库、新视频素材和 prompt 生成新的脚本、分镜和时间线。

**Acceptance Criteria**

- WHEN 缺口补全计划生成完成 THEN 系统 SHALL 生成新视频脚本。
- 系统 SHALL 生成 storyboard，每个镜头包含画面描述、素材引用、字幕、时长、转场和包装说明。
- 系统 SHALL 生成 Timeline JSON，并通过 schema validation。
- 系统 SHALL 生成 migration explanation，说明每个样例 segment / structure atom 如何映射到新内容。
- Timeline SHALL 明确 `rendererTarget`，MVP 默认使用 `html_preview` 或 `mock_preview`。

### US-010 视频预览与可扩展渲染

作为评审，我希望看到可验证结果，不只是脚本。

**Acceptance Criteria**

- WHEN Timeline JSON 生成完成 THEN 系统 SHALL 支持浏览器 timeline/storyboard preview。
- MVP MAY 使用 HTML preview 作为 P0 验证结果，不强制生成 MP4。
- P1 SHOULD 增加 FFmpeg 或 Remotion/HyperFrames 渲染路径，输出 9:16 720p MP4。
- IF 当前环境无法完成视频渲染 THEN 系统 SHALL 保留 Timeline JSON、storyboard 和 preview，确保主流程可验证。
- 渲染结果 SHALL 使用新 source video / 新素材 / 补全包装，不得直接复刻样例视频。

### US-011 迁移过程可视化与导出

作为评审，我希望清楚看到系统从样例到新视频的迁移过程。

**Acceptance Criteria**

- WHEN 用户进入结果页 THEN 系统 SHALL 展示四个区域：样例结构、知识库/结构原子、映射关系与缺口补全、结果时间线/预览。
- 系统 SHALL 支持查看每个 segment 的来源结构、目标内容、使用素材和补全策略。
- 系统 SHALL 支持导出 Structure Template JSON、Generation Request JSON、Timeline JSON 和生成报告。

### US-012 本地可部署与演示数据

作为评审，我希望能在本地启动项目并跑通一个固定 demo。

**Acceptance Criteria**

- WHEN 评审按 README 安装依赖并启动 THEN 系统 SHALL 打开 Web 页面。
- 系统 SHALL 提供至少一个 seed demo project 或 demo script。
- Demo SHALL 在无外部 AI API Key 时可用 mock/fallback 模式跑通核心流程。
- README SHALL 说明如何配置真实 LLM/VLM/ASR provider，但真实 provider 不是 MVP 必需条件。

## 3. Non-Functional Requirements

### NFR-001 可扩展性

- 系统 SHALL 通过 adapter/plugin 设计隔离 AI provider、video analyzer、gap-fill strategy 和 renderer。
- 新增 VLM、ASR、OCR、TTS、Remotion renderer、HyperFrames renderer 不应重写核心业务流程。

### NFR-002 可观测性

- 每个 job SHALL 记录状态、输入摘要、输出路径、错误信息和耗时。
- AI 输出 SHALL 保留原始 JSON 与 schema validation 结果，便于 debug。
- 系统 SHALL 保存关键中间产物：analysis、template、knowledge atoms、slot mapping、gap report、fill plan、timeline。

### NFR-003 稳定性

- 所有 AI 输出 SHALL 做 JSON schema validation。
- schema validation 失败时 SHALL 支持 retry 或 fallback。
- 文件上传、分析、生成、渲染 SHALL 使用 job 状态机，避免前端长时间阻塞。

### NFR-004 安全与合规

- API Key SHALL 只通过环境变量或本地配置读取，不写入仓库。
- 系统 SHALL 明确提醒用户不要上传无授权内容进行商业复用。
- 样例分析只迁移结构，不复制原视频画面、音乐、人物肖像或文案。
- 样例素材 source policy SHALL 记录为 `open_download_or_user_uploaded`、`user_authorized` 或 `demo_only`。

### NFR-005 性能优先级

- MVP SHALL 不以生成速度和延迟作为核心优化目标。
- 系统 SHOULD 优先保证结构规划正确、输出可解释、结果可验证。
- 长耗时任务 MAY 使用异步 job 和状态轮询。

## 4. Out of Scope for MVP v1.1

- 多样例融合与模板聚类。
- 自然语言改片。
- 高质量自动 OCR 和字幕安全区分析。
- 完整 beat detection 与音乐卡点。
- TTS/配音生产链路。
- 高质量 MP4 渲染不是 P0 硬性要求。
- 真实生图/生视频模型调用。
- 团队协作、模板市场、账号系统。
- 真实电商投放效果评估。
