# Acceptance Gates v4.1

These gates extend Spec v4.0 gates.

## Provider gates

These are the executable provider/route gates emitted by `scripts/evaluate-final-gates.mjs`
(the G-number namespace is shared with the rest of that script's G1-G28). Use these exact ids
when cross-referencing the code:

```text
G19 provider_fallbacks_are_explicit
G20 generated_assets_have_provenance
G21 model_route_summary_present
G22 no_external_sample_media_uploads
G23 provider_fallback_count_recorded
G24 unsafe_policy_issues_zero
G25 raw_prompt_not_renderable
G26 generation_provenance_policy_recorded
G27 recipe_lint_status_recorded
G28 offline_video_critic_recorded
```

Note: there is no `provider_cost_estimate_present_if_api_used` gate — no cost-estimate gate
exists in code.

## AIGC visual gates

```text
A1 Seedance request, if used, has purpose/duration/aspectRatio/provenance.
A2 Seedance output is inserted as generated video material, not as sample material.
A3 Seedance failure does not abort the render; the base procedural Remotion/FFmpeg moving proxy remains as the local material, with a recorded fallback reason.
A4 Seedream output is inserted as generated image material with prompt hash.
A5 Image/video generated assets are never mislabeled as user uploaded.
```

## ElevenLabs gates

```text
E1 Scribe output has transcript/timestamps/provider metadata.
E2 TTS output is attached as generated voiceover with provenance.
E3 Sound effects are attached as AudioLayer or asset with provenance.
E4 Music output is attached as generated BGM with provenance.
E5 If ElevenLabs unavailable, faster-whisper/procedural audio fallback works.
```

## Core-demo independence gate

A no-key environment must still be able to run:

```text
sample evidence analysis
StructureTemplate generation
TechniqueAtom extraction or fallback
GapReport generation
RenderRecipe generation
Remotion render
FFmpeg final mux
```

Optional providers can improve output but cannot be required.

## Safety gate details

The provider-safety counts below are a conceptual target. They are NOT currently emitted by
`inspect-learning-fidelity.mjs` — its real output is a `droppedEvidence[]` array (each item has
`kind`/`firstLossLayer`/`severity`/`message`) plus a top-level `status` of `pass`/`fail`
(`fail` when any `severity === "fatal"`); there is no `providerSafety` field.

The equivalent safety posture is actually enforced today by `scripts/evaluate-final-gates.mjs`
against the `buildModelRouteSummary` model-route summary:

- sample frames/audio sent to AIGC → G22 `no_external_sample_media_uploads`
- generated assets missing provenance → G20 `generated_assets_have_provenance` / G26 `generation_provenance_policy_recorded`
- raw prompt visible in render → G25 `raw_prompt_not_renderable`
- unsafe policy issues → G24 `unsafe_policy_issues_zero`

Conceptual target shape (not yet emitted):

```json
{
  "providerSafety": {
    "sampleFramesSentToAIGC": 0,
    "sampleAudioSentToAIGC": 0,
    "generatedAssetsMissingProvenance": 0,
    "optionalProviderMissingFallback": 0,
    "rawPromptVisibleInRender": 0
  }
}
```
