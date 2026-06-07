# 15 — Security and Safety

## 1. No-copy policy

Default:

```ts
const sampleContentCopyAllowed = false;
const sampleAudioCopyAllowed = false;
const samplePixelsReusable = false;
```

Sample content can be used as evidence but not as final material.

## 2. Asset policy

| Asset source | May analyze | May store evidence | May reuse in final | May use to generate recipe |
|---|---:|---:|---:|---:|
| sample video | yes | yes | no | yes, descriptive only |
| user target asset | yes | yes | yes | yes |
| generated asset | yes | yes | yes | yes |
| licensed asset | yes | yes | yes | yes |

## 3. Audio policy

Sample audio:

- may be analyzed for BPM/energy/cue points
- may not be copied into final
- may not be used as direct reference audio for music generation unless user owns and marks it reusable

Generated/procedural audio:

- must record provenance
- must be muxed as AAC
- must pass audio validity gate

## 4. Codegen sandbox

Generated code must:

- use allowlisted imports
- not read arbitrary files
- not call network
- not execute shell commands
- not reference sample media paths
- not access secrets

## 5. Path policy

Allowed paths:

```text
artifacts/project_id/target_assets/*
artifacts/project_id/generated_assets/*
artifacts/project_id/audio/*
```

Disallowed in final code:

```text
artifacts/project_id/sample_assets/*
```

## 6. Provenance

Every final asset must have provenance:

```ts
interface Provenance {
  assetId: string;
  source: "target_user" | "generated" | "licensed" | "procedural";
  createdByStage: string;
  providerDecisionId?: string;
  promptRef?: string;
  sourceKnowledgeElementIds?: string[];
}
```

## 7. Safety gates

- no sample media path in FinalVideoProgram
- no sample audio fingerprint in final audio
- no sample image perceptual hash in final visual assets
- no exact sample subtitle text in final unless user-owned target text
- no watermark/logo copied from sample

## 8. Human override

If user explicitly owns a sample and wants reuse, they must mark asset:

```text
sourcePolicy = user_owned_reusable
```

Even then, the system should clearly record the reuse in provenance.
