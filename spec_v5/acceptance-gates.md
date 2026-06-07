# 11 — Acceptance Gates

V5 gates are grouped by learn, KB, create, render, safety, and UI.

## Learn gates

| ID | Gate | Pass condition |
|---|---|---|
| V5-G1 | Evidence exists | EvidenceTimelineV5 written and schema-valid. |
| V5-G2 | Evidence grounded | Shots, key frames, motion, text, audio fields populated or explicit empty reason. |
| V5-G3 | Video input policy | Whole/chunk/fps policy recorded. |
| V5-G4 | Gen1 output | NeutralReconstructionProgram exists or fallback exists. |
| V5-G5 | Gen1 schema | NeutralReconstructionProgram schema passes. |
| V5-G6 | Placeholder coverage | Sample-specific content represented as placeholders or evidence_only. |
| V5-G7 | Evidence refs | Major scenes and patterns cite evidence refs. |
| V5-G8 | Reconstruction preview | Preview rendered or explicit fallback reason recorded. |

## KB gates

| ID | Gate | Pass condition |
|---|---|---|
| V5-G9 | Candidate elements | CandidateElement list exists. |
| V5-G10 | Curation decisions | Each candidate has store/merge/variant/reject/evidence_only decision. |
| V5-G11 | Hard-rule dedupe | Exact duplicates not stored as new elements. |
| V5-G12 | Unsafe sample material | Raw sample pixels/audio/text marked evidence_only. |
| V5-G13 | KB write | Accepted elements stored with provenance and safety flags. |
| V5-G14 | Searchable KB | Elements retrievable by kind/tag/source/query. |

## Create gates

| ID | Gate | Pass condition |
|---|---|---|
| V5-G15 | Selection set | User selection or auto recommendation recorded. |
| V5-G16 | Target asset analysis | TargetAssetProfile exists. |
| V5-G17 | CompositionProgram | CompositionProgram schema passes. |
| V5-G18 | Gap report | Required slots have matched/weak/missing status. |
| V5-G19 | Fill decision | Missing slots have fill strategy or explicit skip reason. |
| V5-G20 | Gen2 output | FinalVideoProgram exists or compose fallback exists. |
| V5-G21 | Final schema | FinalVideoProgram and RenderRecipeV5 schema pass. |
| V5-G22 | Code compile | Remotion TypeScript compiles or fallback recipe used. |

## Render gates

| ID | Gate | Pass condition |
|---|---|---|
| V5-G23 | Final video exists | final.mp4 exists and is readable. |
| V5-G24 | Duration | Duration within configured tolerance. |
| V5-G25 | Resolution | Output matches target aspect/resolution. |
| V5-G26 | No long blank | No long black/blank visual segment. |
| V5-G27 | Audio validity | Audio stream exists unless intentionally disabled. |
| V5-G28 | Preview artifacts | Preview frames/contact sheet exist. |

## Safety gates

| ID | Gate | Pass condition |
|---|---|---|
| V5-G29 | No sample pixels | Final program does not reference sample media paths. |
| V5-G30 | No sample audio | Final output does not use sample audio. |
| V5-G31 | No sample text copy | Exact source subtitle/text not reused unless user-provided. |
| V5-G32 | Provenance | Generated/reused assets have provenance. |
| V5-G33 | Provider policy | Provider decisions recorded. |

## UI/demo gates

| ID | Gate | Pass condition |
|---|---|---|
| V5-G34 | Analysis visible | UI shows sample evidence. |
| V5-G35 | Reconstruction visible | UI shows neutral reconstruction and placeholders. |
| V5-G36 | KB visible | UI shows learned elements and KB decisions. |
| V5-G37 | Mapping visible | UI shows selected elements mapped to final sections. |
| V5-G38 | Gap visible | UI shows missing/filled slots. |
| V5-G39 | Final visible | UI shows final video and comparison. |
| V5-G40 | Scorecard visible | UI shows rubric coverage and warnings. |

## Scoring interpretation

A run can be considered demo-ready when:

```text
All P0 gates pass or warn with clear fallback reason.
No safety gate fails.
Final video exists.
UI can explain learn -> KB -> select -> compose -> render.
```
