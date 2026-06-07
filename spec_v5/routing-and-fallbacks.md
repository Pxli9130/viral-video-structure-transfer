# 14 — Routing and Fallbacks

## 1. Principle

Every AI stage should improve quality but not be a single point of failure.

```text
AI path first when available.
Deterministic fallback always available for demo.
```

## 2. Gen1 routing

```text
primary: Gemini/VLM with whole video + evidence
fallback 1: simplified schema
fallback 2: scene-by-scene detail prompt
fallback 3: deterministic neutral template
```

Failure reasons:

- invalid JSON
- invalid code
- no placeholders
- sample content copied
- no evidence refs
- render crash

## 3. Element extraction routing

```text
primary: parser + light LLM
fallback: parser only
fallback: store candidates as pending_review
```

## 4. KB curator routing

```text
hard rules always first
embedding search second
ML judge third
fallback: conservative evidence_only or pending_review
```

## 5. Composition planner routing

```text
primary: planner LLM
fallback: deterministic plan template based on selected hook/CTA/rhythm
```

Fallback template:

```text
0-15% hook
15-45% setup/benefit
45-70% proof/demo
70-85% value reinforcement
85-100% CTA
```

## 6. Material generator routing

```text
primary: image generation from AssetRecipe
fallback: target crop/reuse
fallback: text/packaging card
fallback: explicit missing warning
```

## 7. Audio generator routing

```text
primary: generated music/TTS/SFX
fallback: procedural FFmpeg audio
fallback: silent track with explicit warning
```

## 8. Gen2 routing

```text
primary: final Remotion codegen
fallback 1: code repair
fallback 2: component-level regeneration
fallback 3: RenderRecipe using built-in components
```

## 9. Render fallback

```text
Remotion render
  -> Remotion with reduced effects
  -> FFmpeg static/card timeline render
```

## 10. Retry policy

Recommended:

- max 2 repair attempts for JSON
- max 2 repair attempts for code
- max 1 full regeneration per stage
- always store failed outputs for debugging

## 11. Fallback visibility

UI must show fallback reasons.

Example:

```text
Gen2 failed TypeScript compile.
Used deterministic compose fallback.
Final video still rendered with built-in components.
```
