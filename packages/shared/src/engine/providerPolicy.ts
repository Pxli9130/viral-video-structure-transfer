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
    envVars: ["SEEDANCE_ARK_API_KEY", "SEEDANCE_API_KEY", "SEEDREAM_ARK_API_KEY", "ARK_API_KEY"],
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
    generatedProvenance: "processed_user_audio",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Audio isolation is optional; missing env skips isolation and keeps local audio planning."
  },
  {
    id: "elevenlabs_forced_alignment",
    displayName: "ElevenLabs Forced Alignment",
    tasks: ["forced_alignment"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: true,
    generatedProvenance: "read_only_report",
    fallbackProviderId: "local_read_only_report",
    fallbackReason: "Forced alignment is optional; missing env keeps local timing heuristics."
  },
  {
    id: "elevenlabs_models",
    displayName: "ElevenLabs Models Read",
    tasks: ["model_discovery"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "read_only_report",
    fallbackProviderId: "local_read_only_report",
    fallbackReason: "Models discovery is optional and read-only."
  },
  {
    id: "elevenlabs_voices_read",
    displayName: "ElevenLabs Voices Read",
    tasks: ["voice_discovery"],
    optional: true,
    envVars: ["ELEVENLABS_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "read_only_report",
    fallbackProviderId: "local_read_only_report",
    fallbackReason: "Voices discovery is optional and read-only; voice writes are not supported."
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
  },
  {
    id: "local_read_only_report",
    displayName: "Local Read-only Report",
    tasks: ["forced_alignment", "model_discovery", "voice_discovery"],
    optional: true,
    envVars: [],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "read_only_report",
    fallbackProviderId: "local_read_only_report",
    fallbackReason: "Read-only cloud capability is disabled; keep a local report entry instead."
  }
];

function envHasAny(env: Record<string, string | undefined>, keys: string[]): boolean {
  return keys.length === 0 || keys.some((key) => Boolean(env[key]?.trim()));
}

function envFlag(env: Record<string, string | undefined>, key: string): boolean {
  return /^(1|true|yes|on)$/i.test(env[key]?.trim() ?? "");
}

function providerEnabled(policy: ProviderPolicy, task: ProviderTask, env: Record<string, string | undefined>): boolean {
  if (!policy.id.startsWith("elevenlabs_")) return true;
  if (envFlag(env, "ENABLE_ELEVENLABS_LIVE_TESTS") || envFlag(env, "ELEVENLABS_ENABLE_CLOUD")) return true;
  const taskFlags: Partial<Record<ProviderTask, string[]>> = {
    speech_to_text: ["ELEVENLABS_ENABLE_SCRIBE", "ELEVENLABS_ENABLE_ASR"],
    text_to_speech: ["ELEVENLABS_ENABLE_TTS", "ELEVENLABS_ENABLE_VOICEOVER"],
    sound_effects: ["ELEVENLABS_ENABLE_SOUND_EFFECTS", "ELEVENLABS_ENABLE_SFX"],
    music_generation: ["ELEVENLABS_ENABLE_MUSIC"],
    audio_isolation: ["ELEVENLABS_ENABLE_AUDIO_ISOLATION", "ELEVENLABS_ENABLE_AUDIO_CLEANUP"],
    forced_alignment: ["ELEVENLABS_ENABLE_FORCED_ALIGNMENT", "ELEVENLABS_ENABLE_ALIGNMENT"],
    model_discovery: ["ELEVENLABS_ENABLE_DISCOVERY", "ELEVENLABS_ENABLE_MODELS_READ"],
    voice_discovery: ["ELEVENLABS_ENABLE_DISCOVERY", "ELEVENLABS_ENABLE_VOICES_READ"]
  };
  return (taskFlags[task] ?? []).some((flag) => envFlag(env, flag));
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

  if (envHasAny(env, preferred.envVars) && providerEnabled(preferred, task, env)) {
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
