import type { EffectScope, FeatureGate, ModelProviderDefinition, ModelRouteConfig, ModelTask } from "./types.js";
import {
  AIGC_GENERATION_POLICY,
  AIGC_GENERATION_WITH_USER_ASSETS_POLICY,
  BLOCK_SAMPLE_MEDIA_POLICY,
  DETERMINISTIC_LOCAL_POLICY,
  EXTERNAL_VLM_DEFAULT_POLICY,
  LOCAL_ANALYSIS_POLICY,
  QUALITY_JUDGE_DEFAULT_POLICY
} from "./providerPolicy.js";

export const MODEL_TASKS: ModelTask[] = [
  "video_structure_vlm",
  "text_planning_llm",
  "technique_atom_extraction",
  "json_schema_repair",
  "asset_understanding",
  "gap_reasoning",
  "transfer_planning",
  "natural_edit",
  "recipe_lint",
  "provider_prompt_compilation",
  "gap_repair_ranking",
  "structure_explanation",
  "version_strategy_planning",
  "video_critic",
  "technique_atom_kb_curator",
  "asr",
  "ocr",
  "visual_grounding",
  "audio_analysis",
  "image_fill",
  "video_fill",
  "voiceover",
  "sound_effect",
  "music",
  "audio_cleanup",
  "dubbing",
  "knowledge_retrieval",
  "quality_judge"
];

export const MODEL_PROVIDER_REGISTRY: Record<string, ModelProviderDefinition> = {
  configured_ai_adapter: {
    id: "configured_ai_adapter",
    displayName: "Configured text LLM adapter",
    providerClass: "text_llm",
    cloud: true,
    implemented: true,
    envVars: ["GEMINI_API_KEY", "OPENAI_API_KEY", "ARK_API_KEY"],
    canAffectFinalPixels: true,
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY,
    notes: "Current AI_PROVIDER path for Gemini/OpenAI-compatible/Ark text planning."
  },
  deterministic_planner: {
    id: "deterministic_planner",
    displayName: "Deterministic local planner",
    providerClass: "deterministic_local",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY
  },
  gemini_vlm_current: {
    id: "gemini_vlm_current",
    displayName: "Current Gemini VLM adapter",
    providerClass: "vlm",
    cloud: true,
    implemented: true,
    envVars: ["GEMINI_API_KEY"],
    canAffectFinalPixels: true,
    mediaAccessPolicy: EXTERNAL_VLM_DEFAULT_POLICY,
    notes: "Requires explicit sample-media upload policy before it can analyze source/sample video externally."
  },
  heuristic_vlm: {
    id: "heuristic_vlm",
    displayName: "Heuristic VLM fallback",
    providerClass: "deterministic_local",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: LOCAL_ANALYSIS_POLICY
  },
  frame_sheet_heuristics: {
    id: "frame_sheet_heuristics",
    displayName: "Frame-sheet heuristics",
    providerClass: "deterministic_local",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: LOCAL_ANALYSIS_POLICY
  },
  faster_whisper: {
    id: "faster_whisper",
    displayName: "Local faster-whisper",
    providerClass: "asr",
    cloud: false,
    implemented: true,
    binaries: ["python"],
    packages: ["faster_whisper"],
    canAffectFinalPixels: true,
    canAffectFinalAudio: false,
    mediaAccessPolicy: { ...BLOCK_SAMPLE_MEDIA_POLICY, sampleAudioAllowed: true }
  },
  no_asr_with_warning: {
    id: "no_asr_with_warning",
    displayName: "No ASR with warning",
    providerClass: "disabled",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY
  },
  easyocr_current: {
    id: "easyocr_current",
    displayName: "Current EasyOCR adapter",
    providerClass: "ocr",
    cloud: false,
    implemented: true,
    binaries: ["python"],
    packages: ["easyocr"],
    canAffectFinalPixels: true,
    mediaAccessPolicy: { ...BLOCK_SAMPLE_MEDIA_POLICY, samplePixelsAllowed: true }
  },
  no_ocr_with_warning: {
    id: "no_ocr_with_warning",
    displayName: "No OCR with warning",
    providerClass: "disabled",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY
  },
  opencv_flow_ocr_heuristic: {
    id: "opencv_flow_ocr_heuristic",
    displayName: "OpenCV/flow/OCR heuristic grounding",
    providerClass: "visual_grounding",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: LOCAL_ANALYSIS_POLICY
  },
  heuristic_bbox: {
    id: "heuristic_bbox",
    displayName: "Heuristic bbox fallback",
    providerClass: "deterministic_local",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: LOCAL_ANALYSIS_POLICY
  },
  ffmpeg_librosa_audio_analysis: {
    id: "ffmpeg_librosa_audio_analysis",
    displayName: "FFmpeg/librosa audio analysis",
    providerClass: "deterministic_local",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    canAffectFinalAudio: true,
    mediaAccessPolicy: { ...BLOCK_SAMPLE_MEDIA_POLICY, sampleAudioAllowed: true }
  },
  no_audio_analysis_with_warning: {
    id: "no_audio_analysis_with_warning",
    displayName: "No audio analysis with warning",
    providerClass: "disabled",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY
  },
  deterministic_local_image_fill: {
    id: "deterministic_local_image_fill",
    displayName: "Deterministic local image fill",
    providerClass: "image_generation",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    notes: "Canonical id for local generated material. Produces provenance-labeled material without external calls."
  },
  mock_provider: {
    id: "mock_provider",
    displayName: "Deprecated alias for deterministic local image fill",
    providerClass: "image_generation",
    cloud: false,
    implemented: true,
    aliasFor: "deterministic_local_image_fill",
    deprecated: true,
    deprecationWarning: "mock_provider is deprecated; use deterministic_local_image_fill. It is deterministic local generation, not fake output.",
    canAffectFinalPixels: true,
    mediaAccessPolicy: AIGC_GENERATION_POLICY
  },
  remotion_shape_card: {
    id: "remotion_shape_card",
    displayName: "Remotion procedural card/poster fallback",
    providerClass: "renderer",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY
  },
  google_gemini_image: {
    id: "google_gemini_image",
    displayName: "Google Gemini image generation",
    providerClass: "image_generation",
    cloud: true,
    implemented: true,
    envVars: ["GEMINI_API_KEY"],
    canAffectFinalPixels: true,
    mediaAccessPolicy: AIGC_GENERATION_WITH_USER_ASSETS_POLICY
  },
  volcengine_seedream: {
    id: "volcengine_seedream",
    displayName: "Volcengine Seedream image generation",
    providerClass: "image_generation",
    cloud: true,
    implemented: true,
    envVars: ["SEEDREAM_ARK_API_KEY", "SEEDREAM_ARK_MODEL"],
    canAffectFinalPixels: true,
    mediaAccessPolicy: AIGC_GENERATION_WITH_USER_ASSETS_POLICY
  },
  seedance_2_0: {
    id: "seedance_2_0",
    displayName: "Seedance 2.0 video fill candidate",
    providerClass: "video_generation",
    cloud: true,
    implemented: false,
    envVars: ["SEEDANCE_API_KEY", "SEEDANCE_ARK_API_KEY"],
    canAffectFinalPixels: true,
    mediaAccessPolicy: AIGC_GENERATION_WITH_USER_ASSETS_POLICY
  },
  remotion_procedural_motion: {
    id: "remotion_procedural_motion",
    displayName: "Remotion procedural motion",
    providerClass: "renderer",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY
  },
  ffmpeg_proxy_motion: {
    id: "ffmpeg_proxy_motion",
    displayName: "FFmpeg proxy motion",
    providerClass: "renderer",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: true,
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY
  },
  procedural_synth: {
    id: "procedural_synth",
    displayName: "Procedural synth audio",
    providerClass: "audio_generation",
    cloud: false,
    implemented: true,
    canAffectFinalAudio: true,
    mediaAccessPolicy: AIGC_GENERATION_POLICY
  },
  skip_with_warning: {
    id: "skip_with_warning",
    displayName: "Skip with warning",
    providerClass: "disabled",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY
  },
  elevenlabs_audio_stack: {
    id: "elevenlabs_audio_stack",
    displayName: "ElevenLabs optional audio stack",
    providerClass: "audio_generation",
    cloud: true,
    implemented: false,
    envVars: ["ELEVENLABS_API_KEY"],
    canAffectFinalAudio: true,
    mediaAccessPolicy: AIGC_GENERATION_POLICY
  },
  keyword_filter: {
    id: "keyword_filter",
    displayName: "Keyword TechniqueAtom filter",
    providerClass: "deterministic_local",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY
  },
  no_retrieval: {
    id: "no_retrieval",
    displayName: "No retrieval fallback",
    providerClass: "disabled",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY
  },
  bge_m3_candidate: {
    id: "bge_m3_candidate",
    displayName: "BGE-M3 retrieval candidate",
    providerClass: "embedding",
    cloud: false,
    implemented: false,
    packages: ["FlagEmbedding"],
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY
  },
  deterministic_gates: {
    id: "deterministic_gates",
    displayName: "Deterministic quality gates",
    providerClass: "quality_judge",
    cloud: false,
    implemented: true,
    canAffectFinalPixels: false,
    canAffectFinalAudio: false,
    mediaAccessPolicy: QUALITY_JUDGE_DEFAULT_POLICY
  },
  deterministic_gates_only: {
    id: "deterministic_gates_only",
    displayName: "Deterministic gates only",
    providerClass: "quality_judge",
    cloud: false,
    implemented: true,
    mediaAccessPolicy: QUALITY_JUDGE_DEFAULT_POLICY
  },
  gemini_vlm_judge: {
    id: "gemini_vlm_judge",
    displayName: "Gemini VLM quality judge",
    providerClass: "quality_judge",
    cloud: true,
    implemented: true,
    envVars: ["GEMINI_API_KEY"],
    mediaAccessPolicy: QUALITY_JUDGE_DEFAULT_POLICY,
    notes: "Can inspect output frames by default; sample frame comparison requires explicit policy."
  }
};

const plannerTask = (
  task: ModelTask,
  options: {
    notes?: string;
    requiredForCoreDemo?: boolean;
    requiredWhenFeatureEnabled?: boolean;
    featureGate?: FeatureGate;
    effectScope?: EffectScope;
  } = {}
): ModelRouteConfig => ({
  task,
  primary: "deterministic_planner",
  fallbacks: [],
  requiredForCoreDemo: options.requiredForCoreDemo ?? true,
  ...(options.requiredWhenFeatureEnabled !== undefined ? { requiredWhenFeatureEnabled: options.requiredWhenFeatureEnabled } : {}),
  ...(options.featureGate ? { featureGate: options.featureGate } : {}),
  providerClass: "deterministic_local",
  effectScope: options.effectScope ?? "planning_affects_recipe",
  mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY,
  notes: options.notes
});

export const MODEL_ROUTE_TABLE: Record<ModelTask, ModelRouteConfig> = {
  video_structure_vlm: {
    task: "video_structure_vlm",
    primary: "gemini_vlm_current",
    fallbacks: ["heuristic_vlm", "frame_sheet_heuristics"],
    requiredForCoreDemo: true,
    featureGate: "analysis",
    localFallback: "frame_sheet_heuristics",
    providerClass: "vlm",
    effectScope: "planning_affects_recipe",
    mediaAccessPolicy: EXTERNAL_VLM_DEFAULT_POLICY,
    canAffectFinalPixels: true,
    canAffectFinalAudio: false
  },
  text_planning_llm: {
    task: "text_planning_llm",
    primary: "configured_ai_adapter",
    fallbacks: ["deterministic_planner"],
    requiredForCoreDemo: true,
    featureGate: "transfer",
    localFallback: "deterministic_planner",
    providerClass: "text_llm",
    effectScope: "planning_affects_recipe",
    mediaAccessPolicy: BLOCK_SAMPLE_MEDIA_POLICY,
    canAffectFinalPixels: true,
    canAffectFinalAudio: false
  },
  technique_atom_extraction: plannerTask("technique_atom_extraction"),
  json_schema_repair: plannerTask("json_schema_repair"),
  asset_understanding: plannerTask("asset_understanding"),
  gap_reasoning: plannerTask("gap_reasoning"),
  transfer_planning: plannerTask("transfer_planning"),
  natural_edit: plannerTask("natural_edit", {
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "natural_edit",
    effectScope: "planning_affects_recipe"
  }),
  recipe_lint: plannerTask("recipe_lint", { featureGate: "quality_judge", effectScope: "quality_gate_only" }),
  provider_prompt_compilation: plannerTask("provider_prompt_compilation", {
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    effectScope: "generation_affects_assets"
  }),
  gap_repair_ranking: plannerTask("gap_repair_ranking"),
  structure_explanation: plannerTask("structure_explanation", {
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "demo_report",
    effectScope: "read_only_report"
  }),
  version_strategy_planning: plannerTask("version_strategy_planning", {
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "multi_version",
    effectScope: "planning_affects_recipe"
  }),
  video_critic: plannerTask("video_critic", {
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "quality_judge",
    effectScope: "quality_gate_only"
  }),
  technique_atom_kb_curator: {
    task: "technique_atom_kb_curator",
    primary: "keyword_filter",
    fallbacks: ["no_retrieval"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "knowledge_retrieval",
    localFallback: "keyword_filter",
    providerClass: "deterministic_local",
    effectScope: "read_only_report",
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: false
  },
  asr: {
    task: "asr",
    primary: "faster_whisper",
    fallbacks: ["no_asr_with_warning"],
    requiredForCoreDemo: true,
    featureGate: "analysis",
    localFallback: "no_asr_with_warning",
    providerClass: "asr",
    effectScope: "planning_affects_recipe",
    mediaAccessPolicy: { ...BLOCK_SAMPLE_MEDIA_POLICY, sampleAudioAllowed: true },
    canAffectFinalPixels: true,
    canAffectFinalAudio: false
  },
  ocr: {
    task: "ocr",
    primary: "easyocr_current",
    fallbacks: ["no_ocr_with_warning"],
    requiredForCoreDemo: true,
    featureGate: "analysis",
    localFallback: "no_ocr_with_warning",
    providerClass: "ocr",
    effectScope: "planning_affects_recipe",
    mediaAccessPolicy: { ...BLOCK_SAMPLE_MEDIA_POLICY, samplePixelsAllowed: true },
    canAffectFinalPixels: true,
    canAffectFinalAudio: false
  },
  visual_grounding: {
    task: "visual_grounding",
    primary: "opencv_flow_ocr_heuristic",
    fallbacks: ["heuristic_bbox"],
    requiredForCoreDemo: true,
    featureGate: "analysis",
    localFallback: "heuristic_bbox",
    providerClass: "visual_grounding",
    effectScope: "planning_affects_recipe",
    mediaAccessPolicy: LOCAL_ANALYSIS_POLICY,
    canAffectFinalPixels: true,
    canAffectFinalAudio: false
  },
  audio_analysis: {
    task: "audio_analysis",
    primary: "ffmpeg_librosa_audio_analysis",
    fallbacks: ["no_audio_analysis_with_warning"],
    requiredForCoreDemo: true,
    featureGate: "analysis",
    localFallback: "no_audio_analysis_with_warning",
    providerClass: "deterministic_local",
    effectScope: "audio_affects_final_mix",
    mediaAccessPolicy: { ...BLOCK_SAMPLE_MEDIA_POLICY, sampleAudioAllowed: true },
    canAffectFinalAudio: true
  },
  image_fill: {
    task: "image_fill",
    primary: "deterministic_local_image_fill",
    fallbacks: ["remotion_shape_card"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    localFallback: "remotion_shape_card",
    providerClass: "image_generation",
    effectScope: "generation_affects_assets",
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    canAffectFinalPixels: true,
    canAffectFinalAudio: false,
    candidateProviders: ["google_gemini_image", "volcengine_seedream"]
  },
  video_fill: {
    task: "video_fill",
    primary: "remotion_procedural_motion",
    fallbacks: ["ffmpeg_proxy_motion"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "render",
    localFallback: "ffmpeg_proxy_motion",
    providerClass: "renderer",
    effectScope: "rendering_affects_pixels",
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY,
    canAffectFinalPixels: true,
    canAffectFinalAudio: false,
    candidateProviders: ["seedance_2_0"]
  },
  voiceover: {
    task: "voiceover",
    primary: "procedural_synth",
    fallbacks: ["skip_with_warning"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    localFallback: "skip_with_warning",
    providerClass: "audio_generation",
    effectScope: "generation_affects_assets",
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: true,
    candidateProviders: ["elevenlabs_audio_stack"]
  },
  sound_effect: {
    task: "sound_effect",
    primary: "procedural_synth",
    fallbacks: ["skip_with_warning"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    localFallback: "skip_with_warning",
    providerClass: "audio_generation",
    effectScope: "generation_affects_assets",
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: true,
    candidateProviders: ["elevenlabs_audio_stack"]
  },
  music: {
    task: "music",
    primary: "procedural_synth",
    fallbacks: ["skip_with_warning"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    localFallback: "skip_with_warning",
    providerClass: "audio_generation",
    effectScope: "generation_affects_assets",
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: true,
    candidateProviders: ["elevenlabs_audio_stack"]
  },
  audio_cleanup: {
    task: "audio_cleanup",
    primary: "skip_with_warning",
    fallbacks: [],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    localFallback: "skip_with_warning",
    providerClass: "audio_generation",
    effectScope: "audio_affects_final_mix",
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: true,
    candidateProviders: ["elevenlabs_audio_stack"]
  },
  dubbing: {
    task: "dubbing",
    primary: "skip_with_warning",
    fallbacks: [],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "aigc_fill",
    localFallback: "skip_with_warning",
    providerClass: "audio_generation",
    effectScope: "audio_affects_final_mix",
    mediaAccessPolicy: AIGC_GENERATION_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: true,
    candidateProviders: ["elevenlabs_audio_stack"]
  },
  knowledge_retrieval: {
    task: "knowledge_retrieval",
    primary: "keyword_filter",
    fallbacks: ["no_retrieval"],
    requiredForCoreDemo: false,
    requiredWhenFeatureEnabled: true,
    featureGate: "knowledge_retrieval",
    localFallback: "keyword_filter",
    providerClass: "deterministic_local",
    effectScope: "planning_affects_recipe",
    mediaAccessPolicy: DETERMINISTIC_LOCAL_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: false,
    candidateProviders: ["bge_m3_candidate"]
  },
  quality_judge: {
    task: "quality_judge",
    primary: "deterministic_gates",
    fallbacks: ["deterministic_gates_only"],
    requiredForCoreDemo: true,
    featureGate: "quality_judge",
    localFallback: "deterministic_gates",
    providerClass: "quality_judge",
    effectScope: "quality_gate_only",
    mediaAccessPolicy: QUALITY_JUDGE_DEFAULT_POLICY,
    canAffectFinalPixels: false,
    canAffectFinalAudio: false,
    candidateProviders: ["gemini_vlm_judge"]
  }
};
