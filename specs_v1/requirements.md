# Requirements — 爆款结构迁移引擎 MVP v0.1

## 1. Product Scope

MVP v0.1 聚焦一个可运行、可验证、可继续扩展的核心闭环：

> 上传样例视频 → 解析基础信息 → 抽取结构模板 → 输入新 brief 与素材 → 匹配结构槽位 → 识别缺口 → 生成补全计划 → 生成脚本/分镜/时间线 → 渲染或预览 demo → 展示迁移解释。

本版本的关键不是覆盖所有 PRD 功能，而是把系统边界、数据协议、模块接口和验证路径先定下来，使后续 P1/P2 可以在现有架构上扩展。

## 2. MVP User Stories

### US-001 创建项目

作为创作者，我希望创建一个视频迁移项目，以便管理样例、素材、模板和生成结果。

**Acceptance Criteria**

- WHEN 用户进入首页 THEN 系统 SHALL 展示项目列表与“创建项目”入口。
- WHEN 用户创建项目并填写项目名、视频类型、目标比例和目标时长 THEN 系统 SHALL 创建项目记录。
- WHEN 项目创建成功 THEN 系统 SHALL 进入项目工作台。

### US-002 上传并解析样例视频

作为创作者，我希望上传一条样例视频，让系统解析基础信息，为结构抽取做准备。

**Acceptance Criteria**

- WHEN 用户上传 MP4 或 MOV 样例视频 THEN 系统 SHALL 保存文件并创建 Asset 记录。
- WHEN 用户点击“分析样例” THEN 系统 SHALL 提取时长、分辨率、fps、音频轨信息和封面候选。
- WHEN 视频解析完成 THEN 系统 SHALL 展示 metadata、关键帧、镜头列表和处理状态。
- IF FFmpeg/FFprobe 解析失败 THEN 系统 SHALL 标记任务失败并展示可读错误。

### US-003 抽取样例结构模板

作为创作者，我希望系统从样例中抽取可迁移的结构模板，而不是只给一段自然语言总结。

**Acceptance Criteria**

- WHEN 样例基础解析完成 THEN 系统 SHALL 生成 Structure Template JSON。
- Structure Template SHALL 至少包含 `segments`、`shots`、`packaging`、`quality_rules`。
- Structure Template SHALL 至少覆盖以下 2 类结构：脚本/段落结构、节奏结构、包装结构。
- WHEN AI 模型不可用 THEN 系统 SHALL 使用 deterministic fallback 生成一个可验证的默认结构模板。
- WHEN 结构模板生成完成 THEN 用户 SHALL 能保存模板到结构库。

### US-004 查看样例结构解释

作为评审或创作者，我希望看见样例被拆出了什么结构，以便判断系统是否真正做了结构迁移。

**Acceptance Criteria**

- WHEN 用户打开样例结构页 THEN 系统 SHALL 展示段落结构、镜头节奏、包装标签和质量规则。
- WHEN 用户点击某个 segment 或 shot THEN 系统 SHALL 展示其来源时间段、功能、素材要求和替换策略。
- 系统 SHALL 展示自然语言解释，说明该结构可能如何吸引用户或推动转化。

### US-005 输入新 brief 与素材

作为创作者，我希望输入新主题/商品信息并上传少量素材，以便系统把样例结构迁移到我的新内容中。

**Acceptance Criteria**

- WHEN 用户输入 brief THEN 系统 SHALL 保存主题、目标用户、卖点、口吻、CTA 和禁用内容。
- WHEN 用户上传图片、视频或文案素材 THEN 系统 SHALL 保存 Asset 记录并提取基础信息。
- WHEN 素材理解完成 THEN 系统 SHALL 给每个素材生成基础标签，例如 `product`, `usage`, `scene`, `text_only`, `cta_candidate`。
- IF 用户只输入文案且没有媒体素材 THEN 系统 SHALL 仍可进入缺口识别与文字/包装补全流程。

### US-006 槽位匹配与缺口识别

作为创作者，我希望系统告诉我哪些样例结构槽位能被新素材满足，哪些地方缺素材。

**Acceptance Criteria**

- WHEN 用户选择模板并输入新素材 THEN 系统 SHALL 将模板中的 shot slot 与新素材进行匹配。
- 每个 slot SHALL 产生一个状态：`matched`、`weak_match` 或 `missing`。
- WHEN slot 状态为 `missing` THEN 系统 SHALL 给出影响说明和推荐补全策略。
- MVP SHALL 至少识别以下缺口类型：开头吸引镜头、商品特写、使用过程、对比镜头、结尾 CTA、字幕/文案不足。

### US-007 缺口补全计划

作为创作者，我希望即使素材不足，系统也能给出可解释的补全方案，而不是生成失败。

**Acceptance Criteria**

- WHEN 系统发现 missing slot THEN 系统 SHALL 为每个 missing slot 选择至少一种补全策略。
- MVP SHALL 支持以下补全策略中的至少 3 种：结构重排、文案/字幕卡、包装补全、素材复用/局部放大、AIGC 占位补全。
- 补全计划 SHALL 写入 Timeline JSON，并确保最终时间线没有空 slot。
- 系统 SHALL 展示“缺口 → 补全策略 → 结果片段”的映射。

### US-008 结构迁移生成

作为创作者，我希望系统基于样例结构和新内容生成新的脚本、分镜和时间线。

**Acceptance Criteria**

- WHEN 缺口补全计划生成完成 THEN 系统 SHALL 生成新视频脚本。
- 系统 SHALL 生成 storyboard，每个镜头包含画面描述、素材引用、字幕、时长、转场和包装说明。
- 系统 SHALL 生成 Timeline JSON，并通过 schema validation。
- 系统 SHALL 生成 migration explanation，说明每个样例 segment 如何映射到新内容。

### US-009 视频预览与 MVP 渲染

作为评审，我希望看到可验证结果，不只是脚本。

**Acceptance Criteria**

- WHEN Timeline JSON 生成完成 THEN 系统 SHALL 支持至少一种结果验证方式：可播放 MP4 或浏览器时间线预览。
- MVP SHOULD 使用 Remotion 或 FFmpeg 生成 9:16 720p MP4。
- IF 当前环境无法完成视频渲染 THEN 系统 SHALL 生成 deterministic HTML/Canvas timeline preview，并保留 Timeline JSON 供后续渲染。
- 渲染结果 SHALL 使用新内容和新素材/补全包装，不得直接复刻样例视频。

### US-010 迁移过程可视化

作为评审，我希望清楚看到系统从样例到新视频的迁移过程。

**Acceptance Criteria**

- WHEN 用户进入结果页 THEN 系统 SHALL 展示四个区域：样例结构、映射关系、缺口补全、结果时间线/视频。
- 系统 SHALL 支持查看每个 segment 的来源结构、目标内容、使用素材和补全策略。
- 系统 SHALL 支持导出 Structure Template JSON、Timeline JSON 和生成报告。

### US-011 本地可部署与演示数据

作为评审，我希望能在本地启动项目并跑通一个固定 demo。

**Acceptance Criteria**

- WHEN 评审按 README 安装依赖并启动 THEN 系统 SHALL 打开 Web 页面。
- 系统 SHALL 提供至少一个 seed demo project 或 demo script。
- Demo SHALL 在无外部 AI API Key 时可用 mock/fallback 模式跑通核心流程。
- README SHALL 说明如何配置真实 LLM/VLM/ASR provider。

## 3. Non-Functional Requirements

### NFR-001 可扩展性

- 系统 SHALL 通过 adapter/plugin 设计隔离 AI provider、video analyzer、gap-fill strategy 和 renderer。
- 新增 VLM、ASR、OCR、TTS、Remotion renderer 不应重写核心业务流程。

### NFR-002 可观测性

- 每个 job SHALL 记录状态、输入摘要、输出路径、错误信息和耗时。
- AI 输出 SHALL 保留原始 JSON 与 schema validation 结果，便于 debug。

### NFR-003 稳定性

- 所有 AI 输出 SHALL 做 JSON schema validation。
- schema validation 失败时 SHALL 支持一次 retry 或 fallback。
- 文件上传、分析、生成、渲染 SHALL 使用 job 状态机，避免前端长时间阻塞。

### NFR-004 安全与合规

- API Key SHALL 只通过环境变量或本地配置读取，不写入仓库。
- 系统 SHALL 明确提醒用户不要上传无授权内容进行商业复用。
- 样例分析只迁移结构，不复制原视频画面、音乐、人物肖像或文案。

## 4. Out of Scope for MVP

- 多样例融合与模板聚类。
- 自然语言改片。
- 高质量自动 OCR 和字幕安全区分析。
- 完整 beat detection 与音乐卡点。
- TTS/配音生产链路。
- 团队协作、模板市场、账号系统。
- 真实电商投放效果评估。
