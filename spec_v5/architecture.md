# 02 — Architecture

## 1. High-level architecture

```mermaid
graph TD
  subgraph LEARN[Learn Pipeline per sample video]
    SV[Sample video] --> ING[1 Ingest]
    ING --> DET[2 Deterministic Evidence]
    DET --> EV[EvidenceTimelineV5]
    SV --> VPOL[3 Video Input Policy]
    EV --> VPOL
    VPOL --> G1[4 Gen1 Neutral Reconstruction]
    EV --> G1
    G1 --> NRP[NeutralReconstructionProgram]
    G1 -.-> G1F[Fallback Neutral Template]
    G1F --> NRP
    NRP --> EX[5 Element Extractor]
    EV --> EX
    EX --> CAND[CandidateElements]
    CAND --> CUR[6 KB Curator]
    CUR --> KB[(Knowledge Base)]
  end

  subgraph CREATE[Create Pipeline per generation]
    KB --> UISEL[7 User Selected or Recommended Elements]
    TARGET[Target assets] --> TA[Target Asset Analyzer]
    BRIEF[User brief] --> CP[8 Composition Planner]
    UISEL --> CP
    TA --> CP
    CP --> COMP[CompositionProgram]
    COMP --> GAP[9 Slot Matching and Gap Report]
    GAP -.-> MAT[10A Optional Material Generator]
    COMP -.-> AUD[10B Optional Audio Generator]
    COMP --> G2[11 Gen2 Final Remotion Codegen]
    MAT -.-> G2
    AUD -.-> G2
    G2 --> FVP[FinalVideoProgram]
    G2 -.-> G2F[Deterministic Compose Fallback]
    G2F --> FVP
    FVP --> VAL[12 Compile Lint Validate]
    VAL --> RENDER[13 Remotion and FFmpeg Render]
    RENDER --> FINAL[final.mp4]
    FINAL --> EVAL[14 Eval Gates and Scorecard]
    EVAL --> OUT[GenerationResult]
  end

  POLICY[Model Router and Provider Policy] -.-> G1
  POLICY -.-> EX
  POLICY -.-> CUR
  POLICY -.-> CP
  POLICY -.-> MAT
  POLICY -.-> AUD
  POLICY -.-> G2
  STORE[Artifact Store] -.-> EV
  STORE -.-> NRP
  STORE -.-> KB
  STORE -.-> COMP
  STORE -.-> FVP
  STORE -.-> FINAL
  STORE -.-> OUT
```

## 2. Core idea

V5 has a learn side and a create side.

### Learn side

```text
sample video -> neutral program -> knowledge elements -> KB
```

The learn side converts sample videos into content-neutral, reusable creative knowledge.

### Create side

```text
KB elements + target assets + user brief -> final program -> final.mp4
```

The create side composes selected elements into a new video.

## 3. Main services

### API Server

Responsibilities:

- route HTTP requests
- validate requests
- call pipeline stages
- write and read artifacts
- stream progress to UI

### Artifact Store

Responsibilities:

- store all JSON artifacts atomically
- store media artifacts
- maintain lineage graph
- support replay/debug

### Model Router

Responsibilities:

- select model/provider for each stage
- enforce provider policy
- enforce no-copy restrictions
- apply fallback chain
- record provider decisions

### Knowledge Base

Responsibilities:

- store KnowledgeElements
- dedupe candidates
- support semantic and metadata search
- support user selection
- support auto recommendation
- track provenance and safety

### Renderer

Responsibilities:

- render neutral reconstruction preview
- render final video
- mux audio
- apply FFmpeg fallback operations
- generate preview frames and contact sheets

## 4. Data flow

### Learn artifacts

```text
Asset
EvidenceTimelineV5
NeutralReconstructionProgram
CandidateElements
KbCurationDecision[]
KnowledgeElement[]
ReconstructionPreview.mp4
```

### Create artifacts

```text
CreativeBrief
TargetAssetProfile[]
SelectionSet
CompositionProgram
GapReport
GeneratedAsset[]
AudioPlan
FinalVideoProgram
RenderRecipeV5
final.mp4
ScorecardV5
```

## 5. Fallback hierarchy

### Gen1 fallback

```text
AI Gen1 neutral program
  -> repair malformed JSON/code
  -> re-ask with simplified schema
  -> deterministic neutral template from evidence
```

### KB curator fallback

```text
hard rule exact duplicate
  -> merge
hard rule unsafe raw sample material
  -> evidence_only
ML judge failure
  -> store as candidate_pending_review or reject_low_confidence
```

### Gen2 fallback

```text
AI final Remotion code
  -> repair code/schema
  -> regenerate only failing component
  -> deterministic compose fallback using built-in components
```

### Audio fallback

```text
user audio
  -> generated audio if enabled
  -> procedural FFmpeg bed/SFX
  -> silence with explicit warning
```

## 6. Why this architecture performs better

1. **Grounded understanding**: deterministic evidence constrains VLM/codegen.
2. **Executable IR**: neutral program can be previewed and validated.
3. **Knowledge reuse**: elements accumulate across videos.
4. **User control**: users can select learned elements.
5. **Stronger gap fill**: KB stores asset/audio generation recipes.
6. **Creative composition**: Gen2 can blend multiple learned methods into one new program.
7. **Safety**: no sample content enters final video by default.
