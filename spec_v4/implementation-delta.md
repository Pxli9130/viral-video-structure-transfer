# Implementation Delta from v4.0 to v4.1

## P0: Add provider configs without disrupting core render

Files likely touched:

```text
packages/shared/src/types.ts
packages/shared/src/schemas/provider-policy.schema.json
packages/shared/src/schemas/model-routing-policy.schema.json
packages/shared/src/engine/providerPolicy.ts
packages/shared/src/engine/modelRouter.ts
apps/api/src/adapters/*.ts
apps/api/src/adapters/renderers.ts
apps/api/remotion/ViralRecipeRoot.tsx
scripts/inspect-learning-fidelity.mjs
```

Tasks:

1. Add provider policy types.
2. Add model routing config.
3. Add AIGC provider interface.
4. Add generated asset provenance fields.
5. Keep all optional providers disabled by default unless env keys/config are present.
6. Add deterministic fallback for every optional provider.

## P1: Add Seedance 2.0 video-fill adapter shell

Do not block on real API access. Implement an adapter interface and disabled-by-default route.

```ts
type AIGCVideoFillRequest = {
  purpose:
    | "opening_hook_motion"
    | "product_motion_insert"
    | "moving_background"
    | "missing_use_case_clip"
    | "transition_clip";
  prompt: string;
  userAssetIds: string[];
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  safety: {
    sampleFramesAllowedAsInput: false;
    sampleAudioAllowedAsInput: false;
  };
};
```

Adapter result:

```ts
type AIGCVideoFillResult = {
  assetId: string;
  uri: string;
  durationSec: number;
  provenance: GeneratedAssetProvenance;
  fallbackUsed?: boolean;
  warnings: string[];
};
```

## P2: Add Seedream 4.0 image-fill adapter shell

Use for missing static material:

```text
background_fill
hero_image_fill
cover_image
poster_card
cta_visual
```

Fallback: `RemotionPosterCard` or existing target image with package layer.

## P3: Add ElevenLabs audio adapters

Adapters:

```text
elevenlabs_scribe.adapter.ts
elevenlabs_tts.adapter.ts
elevenlabs_sound_effects.adapter.ts
elevenlabs_music.adapter.ts
elevenlabs_audio_isolation.adapter.ts
elevenlabs_dubbing.adapter.ts optional
```

Do not require all adapters immediately. Priority:

1. Scribe ASR fallback
2. TTS voiceover
3. Sound effects
4. Music
5. Audio isolation
6. Dubbing / lip sync

## P4: Update RenderRecipe v4 with provider provenance

Add fields:

```ts
type RenderRecipe = {
  providerUse?: Array<{
    task: string;
    provider: string;
    model?: string;
    assetIds: string[];
    fallbackUsed: boolean;
    provenanceIds: string[];
  }>;
};
```

For generated material:

```ts
material: {
  kind: "generated_target_asset" | "generated_video_insert" | "generated_audio";
  assetIds: string[];
  policy: "renderable";
  provenance: "aigc_generated";
  provider?: string;
}
```

## P5: Update UI/report

Add sections:

```text
Provider usage table
AIGC assets generated
Fallbacks used
Cost estimate
Safety/provenance summary
```

This helps judges see that AIGC is controlled and not hiding the core structure-transfer logic.
