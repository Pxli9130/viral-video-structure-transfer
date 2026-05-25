# Source Alignment — Final Spec v1.2

This spec was consolidated from all available source files in the workspace.

## Source files reviewed

1. `比赛可选课题.txt`
   - Used to confirm the selected challenge topic among all challenge options.
2. `字节跳动工程系列活动官网.pdf`
   - Used to confirm challenge context, schedule, topic list, and full-stack delivery expectation.
3. `工程训练营课题：爆款结构迁移引擎-从样例拆解、素材补全到视频重组的 AI 创作平台.pdf`
   - Primary source for official task background, challenge definition, P0/P1 tasks, scoring rubric, recommended tech stack, and delivery requirements.
4. `AI全栈挑战赛课题讲解：爆款结构迁移引擎.txt`
   - Used for mentor explanation, recommended implementation direction, final deliverable emphasis, Remotion/HyperFrames guidance, knowledge-base emphasis, and evaluation clarifications.
5. `会议纪要.txt`
   - Used as a short meeting summary cross-check.
6. `智能纪要：AI全栈挑战赛课题讲解：爆款结构迁移引擎 2026年5月20日.pdf`
   - Used to verify meeting conclusions and diagrams: sample understanding, structure extraction, atomization, new video generation, and resource limitations.
7. `AI全栈挑战赛过程FAQ丨爆款结构迁移引擎-从样例拆解、素材补全到视频重组的 AI 创作平台.pdf`
   - Used for final clarifications: official test material is video, usually long video; video + prompt input is valid; knowledge-base-guided reconstruction is the goal; no video model token; Remotion/HyperFrames are acceptable framework components; local runnable demo is acceptable; latency is not a core metric.
8. `PRD_爆款结构迁移引擎.md` and `PRD_爆款结构迁移引擎.pdf`
   - Used as the product baseline for goals, feature scope, architecture direction, acceptance criteria, and scoring alignment.
9. `viral_structure_mvp_specs/*`
   - Used as v0.1 MVP baseline.
10. `viral_structure_specs_v1_1/*`
   - Used as v1.1 FAQ-aligned baseline.
11. `main (1).pdf`
   - Reviewed, but not used as a product requirement source because it is a personal resume rather than challenge/task guidance.

## Major final decisions

### D1 — Video + prompt is P0, not a future-only feature

The final spec treats `source video + prompt` as the official-style reconstruction path. Text-only/prompt-only generation is allowed as fallback, but not the main judging path.

### D2 — Knowledge base is central

The system should store reusable structure atoms and editing techniques, not only one-off templates.

### D3 — Direct video generation model is not assumed

The system should not depend on a video-generation API. The renderer path should be FFmpeg, Remotion, HyperFrames, and browser preview.

### D4 — VLM is recommended but adapterized

The system should eventually understand keyframes/visuals semantically, but MVP can use heuristic/mock understanding. VLM is an adapter, not a hard dependency.

### D5 — Explainability and visualization are required

The result page must show extraction, mapping, gap detection, fill strategy, and final output preview.

### D6 — Local runnable demo is sufficient

The project should be easy for evaluators to run locally; cloud deployment is optional.

### D7 — Primary vertical is B-end marketing / MG promo

The spec narrows MVP focus to produce stronger demos while keeping the architecture extensible.
