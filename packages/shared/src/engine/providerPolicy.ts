import type {
  OptionalProviderId,
  ProviderCallRecord,
  ProviderPolicy,
  ProviderRoute,
  ProviderTask
} from "../types.js";
import { nowIso } from "./planner.js";

export const DEFAULT_PROVIDER_POLICIES: ProviderPolicy[] = [
  {
    id: "seedance_2_0",
    displayName: "Seedance 2.0",
    tasks: ["video_generation"],
    optional: true,
    envVars: ["SEEDANCE_API_KEY", "SEEDANCE_ARK_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_remotion_procedural",
    fallbackReason: "Seedance is optional; missing env falls back to local procedural motion."
  },
  {
    id: "seedream_4_0",
    displayName: "Seedream 4.0",
    tasks: ["image_generation"],
    optional: true,
    envVars: ["SEEDREAM_ARK_API_KEY", "AIGC_IMAGE_MODEL"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_remotion_procedural",
    fallbackReason: "Seedream is optional; missing env falls back to packaging/procedural visuals."
  },
  {
    id: "elevenlabs_scribe",
    displayName: "ElevenLabs Scribe",
    tasks: ["speech_to_text"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: true,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_faster_whisper",
    fallbackReason: "Scribe is optional; missing env falls back to local ASR when available."
  },
  {
    id: "elevenlabs_tts",
    displayName: "ElevenLabs TTS",
    tasks: ["text_to_speech"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "TTS is optional; missing env keeps the local procedural audio path."
  },
  {
    id: "elevenlabs_sound_effects",
    displayName: "ElevenLabs Sound Effects",
    tasks: ["sound_effects"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Sound effects are optional; missing env uses FFmpeg procedural SFX."
  },
  {
    id: "elevenlabs_music",
    displayName: "ElevenLabs Music",
    tasks: ["music_generation"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Music generation is optional; missing env keeps procedural BGM."
  },
  {
    id: "elevenlabs_audio_isolation",
    displayName: "ElevenLabs Audio Isolation",
    tasks: ["audio_isolation"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: true,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Audio isolation is optional; missing env skips isolation and keeps local audio planning."
  },
  {
    id: "local_remotion_procedural",
    displayName: "Local Remotion Procedural",
    tasks: ["video_generation", "image_generation", "procedural_motion"],
    optional: true,
    envVars: [],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "procedural",
    fallbackProviderId: "local_remotion_procedural",
    fallbackReason: "Local procedural renderer is the core fallback."
  },
  {
    id: "local_ffmpeg_procedural",
    displayName: "Local FFmpeg Procedural Audio",
    tasks: ["text_to_speech", "sound_effects", "music_generation", "audio_isolation", "procedural_audio"],
    optional: true,
    envVars: [],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "procedural",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Local FFmpeg audio synthesis is the core fallback."
  },
  {
    id: "local_faster_whisper",
    displayName: "Local faster-whisper",
    tasks: ["speech_to_text"],
    optional: true,
    envVars: [],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: true,
    generatedProvenance: "procedural",
    fallbackProviderId: "local_faster_whisper",
    fallbackReason: "Local ASR is the core speech-to-text fallback."
  }
];

function envHasAny(env: Record<string, string | undefined>, keys: string[]): boolean {
  return keys.length === 0 || keys.some((key) => Boolean(env[key]?.trim()));
}

function policyFor(id: OptionalProviderId, policies: ProviderPolicy[]): ProviderPolicy {
  const policy = policies.find((item) => item.id === id);
  if (!policy) throw new Error(`Provider policy ${id} is not registered.`);
  return policy;
}

export interface ProviderRouterOptions {
  env?: Record<string, string | undefined>;
  policies?: ProviderPolicy[];
}

export function resolveProviderRoute(
  task: ProviderTask,
  options: ProviderRouterOptions = {},
  requestedProviderId?: OptionalProviderId
): ProviderRoute {
  const env = options.env ?? process.env;
  const policies = options.policies ?? DEFAULT_PROVIDER_POLICIES;
  const candidates = policies.filter((policy) => policy.tasks.includes(task));
  const requested = requestedProviderId ? policyFor(requestedProviderId, policies) : undefined;
  const preferred = requested && requested.tasks.includes(task) ? requested : candidates[0];
  if (!preferred) throw new Error(`No provider policy registered for task ${task}.`);

  if (envHasAny(env, preferred.envVars)) {
    return {
      task,
      requestedProviderId,
      selectedProviderId: preferred.id,
      available: true,
      fallbackUsed: false,
      policy: preferred
    };
  }

  const fallback = policyFor(preferred.fallbackProviderId, policies);
  return {
    task,
    requestedProviderId,
    selectedProviderId: fallback.id,
    available: envHasAny(env, fallback.envVars),
    fallbackUsed: true,
    fallbackReason: preferred.fallbackReason,
    policy: fallback
  };
}

export function buildProviderCallRecord(route: ProviderRoute, userAssetsSentExternally = false): ProviderCallRecord {
  return {
    providerId: route.selectedProviderId,
    task: route.task,
    selectedAt: nowIso(),
    available: route.available,
    fallbackUsed: route.fallbackUsed,
    ...(route.fallbackReason ? { fallbackReason: route.fallbackReason } : {}),
    sampleFramesSentExternally: false,
    sampleAudioSentExternally: false,
    userAssetsSentExternally: route.policy.mayReceiveUserAssets && userAssetsSentExternally,
    provenance: route.policy.generatedProvenance
  };
}

