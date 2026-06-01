# Acceptance Gates v4.1

These gates extend Spec v4.0 gates.

## Provider gates

```text
G19 provider_policy_schema_valid
G20 optional_providers_have_deterministic_fallback
G21 generated_assets_have_provenance
G22 seedance_not_required_for_core_demo
G23 elevenlabs_not_required_for_core_demo
G24 aigc_input_does_not_include_sample_frames
G25 aigc_input_does_not_include_sample_audio
G26 provider_usage_report_present
G27 provider_cost_estimate_present_if_api_used
G28 fallback_reason_present_when_provider_skipped
```

## AIGC visual gates

```text
A1 Seedance request, if used, has purpose/duration/aspectRatio/provenance.
A2 Seedance output is inserted as generated video material, not as sample material.
A3 Seedance failure falls back to Remotion MotionAtomLayer.
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

`inspect-learning-fidelity` should add:

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
