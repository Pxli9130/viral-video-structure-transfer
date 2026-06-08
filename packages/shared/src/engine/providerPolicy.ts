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
    id: "google_gemini_tts",
    displayName: "Google Gemini TTS",
    tasks: ["text_to_speech"],
    optional: true,
    envVars: ["GEMINI_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Google Gemini TTS is optional; missing env or disabled live calls keep subtitles and local procedural audio."
  },
  {
    id: "google_lyria_music",
    displayName: "Google Lyria Music",
    tasks: ["music_generation"],
    optional: true,
    envVars: ["GEMINI_API_KEY"],
    mayReceiveSampleFrames: false,
    mayReceiveSampleAudio: false,
    mayReceiveUserAssets: false,
    generatedProvenance: "aigc_generated_material",
    fallbackProviderId: "local_ffmpeg_procedural",
    fallbackReason: "Google Lyria music is optional; missing env or disabled live calls fall back to local procedural BGM/SFX."
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
  if (policy.id === "google_gemini_tts" || policy.id === "google_lyria_music") {
    if (envFlag(env, "ENABLE_GOOGLE_AUDIO_LIVE_TESTS") || envFlag(env, "GOOGLE_AUDIO_ENABLE_CLOUD") || envFlag(env, "ALLOW_CLOUD_PROVIDERS")) return true;
    const taskFlags: Partial<Record<ProviderTask, string[]>> = {
      text_to_speech: ["GOOGLE_AUDIO_ENABLE_TTS", "GOOGLE_AUDIO_ENABLE_VOICEOVER"],
      music_generation: ["GOOGLE_AUDIO_ENABLE_MUSIC"]
    };
    return (taskFlags[task] ?? []).some((flag) => envFlag(env, flag));
  }
  return true;
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

  const seen = new Set<OptionalProviderId>();
  let selected = preferred;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;
  while (true) {
    if (envHasAny(env, selected.envVars) && providerEnabled(selected, task, env)) {
      return {
        task,
        requestedProviderId,
        selectedProviderId: selected.id,
        available: true,
        fallbackUsed,
        ...(fallbackReason ? { fallbackReason } : {}),
        policy: selected
      };
    }
    fallbackUsed = true;
    fallbackReason = fallbackReason ? `${fallbackReason} ${selected.fallbackReason}` : selected.fallbackReason;
    if (seen.has(selected.id) || selected.fallbackProviderId === selected.id) break;
    seen.add(selected.id);
    selected = policyFor(selected.fallbackProviderId, policies);
  }

  const fallback = selected;
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
