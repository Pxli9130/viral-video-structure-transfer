// CreativeEffectSpec (creative-effect-spec.v1)
//
// A renderer-agnostic, props-driven description of a motif-specific creative effect. This is the
// foundation for later Gemini Remotion codegen: a spec is selected by *motif family* (derived from
// evidence, never from sample filenames) and later resolved to a concrete effect program (built-in
// now, generated later) through the EffectRegistry. Specs carry safety flags so no sample pixels or
// audio are ever copied and nothing touches the network at runtime.

export type MotifFamily =
  | "poster_ribbon_marketing"
  | "card_orbit_motion_graph"
  | "blue_spotlight_ui_pitch"
  | "beat_cut_chinese_editing_tutorial"
  | "split_screen_compare"
  | "generic_motion_graph";

export const MOTIF_FAMILIES: readonly MotifFamily[] = [
  "poster_ribbon_marketing",
  "card_orbit_motion_graph",
  "blue_spotlight_ui_pitch",
  "beat_cut_chinese_editing_tutorial",
  "split_screen_compare",
  "generic_motion_graph"
];

export type CreativeEffectSpecSource = "deterministic" | "gemini" | "built_in" | "unknown";

export interface CreativeEffectSpec {
  version: "creative-effect-spec.v1";
  id: string;
  caseId?: string;
  motifFamily: MotifFamily;
  effectName: string;
  visualDescription: string;
  motionBehavior: string[];
  transitionBehavior: string[];
  requiredProps: string[];
  reusableRules: string[];
  forbiddenOverfitRules: string[];
  evidenceRefs: string[];
  safety: {
    noSamplePixelCopy: boolean;
    noSampleAudioCopy: boolean;
    propsDriven: boolean;
    noRuntimeNetwork: boolean;
  };
  source: CreativeEffectSpecSource;
  createdAt: string;
}

/** Loose evidence signals used to derive a motif family. Never filenames — only learned signals. */
export interface CreativeEffectEvidenceInput {
  id?: string;
  caseId?: string;
  createdAt?: string;
  /** OCR / detected on-screen text. */
  ocrText?: string[];
  /** Color palette, hex or names. */
  palette?: string[];
  /** Technique-atom / visual-form / motion keywords (e.g. "ribbon", "card_orbit", "whip_pan"). */
  techniqueKeywords?: string[];
  /** Located visual-form family labels. */
  visualForms?: string[];
  videoType?: string;
  bpm?: number;
  evidenceRefs?: string[];
  /** Explicit override; otherwise derived from CJK characters in ocrText. */
  hasChineseText?: boolean;
}

const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ]/;
const HIGH_BPM = 120;

const NAME_TO_HEX_COOL = /blue|navy|cyan|teal|azure|indigo/;

interface MotifTemplate {
  effectName: string;
  visualDescription: string;
  motionBehavior: string[];
  transitionBehavior: string[];
  requiredProps: string[];
  reusableRules: string[];
  forbiddenOverfitRules: string[];
}

// Per-family deterministic spec body. These describe the *behavior* of the built-in effect so the
// same shape can later be produced by Gemini; props remain the contract between spec and renderer.
const MOTIF_TEMPLATES: Record<MotifFamily, MotifTemplate> = {
  poster_ribbon_marketing: {
    effectName: "RibbonPosterSweep",
    visualDescription: "Light/white poster background with a colorful ribbon/silk sweep, clean poster typography and a soft gallery CTA.",
    motionBehavior: ["ribbon_silk_sweep", "soft_parallax_drift", "headline_settle"],
    transitionBehavior: ["cross_dissolve", "panel_slide"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors"],
    reusableRules: ["keep poster bg light", "ribbon colors from palette", "headline always readable"],
    forbiddenOverfitRules: ["do not embed sample frames", "do not hardcode a specific brand name"]
  },
  card_orbit_motion_graph: {
    effectName: "CardOrbitStack",
    visualDescription: "Black/red palette with 8-12 cards orbiting/stacking/scattering and a neon frame pulse.",
    motionBehavior: ["card_orbit", "stack_collapse", "scatter_burst", "neon_frame_pulse"],
    transitionBehavior: ["beat_cut", "card_flip"],
    requiredProps: ["width", "height", "fps", "durationSec", "colors", "beats"],
    reusableRules: ["8-12 card placeholders when assets missing", "neon frame follows accent color"],
    forbiddenOverfitRules: ["do not copy sample card images", "do not lock card count to one sample"]
  },
  blue_spotlight_ui_pitch: {
    effectName: "BlueUiSpotlight",
    visualDescription: "Blue/black palette with a spotlight/orb sweep, floating UI/dashboard/search panels and sequential pitch text reveal.",
    motionBehavior: ["spotlight_orb_sweep", "panel_float", "sequential_text_reveal"],
    transitionBehavior: ["spotlight_wipe", "panel_stagger"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors"],
    reusableRules: ["panels are generic UI placeholders", "spotlight follows cool accent"],
    forbiddenOverfitRules: ["do not screenshot the sample UI", "do not embed real product dashboards"]
  },
  beat_cut_chinese_editing_tutorial: {
    effectName: "BeatCutKineticText",
    visualDescription: "Black/red/yellow/white large Chinese kinetic text with beat-synced pop/flash/glitch/whip approximations and slash/title bars.",
    motionBehavior: ["kinetic_text_pop", "beat_flash", "glitch_whip_cut", "slash_bars"],
    transitionBehavior: ["whip_pan", "hard_beat_cut", "flash_cut"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors", "beats"],
    reusableRules: ["generate Chinese-style labels when no Chinese text present", "sync pops to beats"],
    forbiddenOverfitRules: ["do not copy sample captions verbatim", "do not reuse sample audio"]
  },
  split_screen_compare: {
    effectName: "SplitScreenCompare",
    visualDescription: "Side-by-side split screen with an animated divider, before/after panels (one side tinted vs the other) and comparison labels.",
    motionBehavior: ["divider_sweep", "panel_push_in", "label_pop"],
    transitionBehavior: ["wipe_split", "hard_cut"],
    requiredProps: ["width", "height", "fps", "durationSec", "texts", "colors"],
    reusableRules: ["two generic panels when assets missing", "labels from texts (before/after) else defaults", "divider follows accent color"],
    forbiddenOverfitRules: ["do not embed sample frames", "do not hardcode a specific product comparison"]
  },
  generic_motion_graph: {
    effectName: "GenericMotionGraph",
    visualDescription: "Neutral motion-graphic bed (streaks + beat EQ) used when no specific motif is detected.",
    motionBehavior: ["streak_bed", "beat_eq"],
    transitionBehavior: ["cross_dissolve"],
    requiredProps: ["width", "height", "fps", "durationSec", "colors"],
    reusableRules: ["palette-driven", "never static"],
    forbiddenOverfitRules: ["do not embed sample frames"]
  }
};

function lc(values: (string | undefined)[] | undefined): string {
  return (values ?? []).filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
}

function countMatches(haystack: string, re: RegExp): number {
  const m = haystack.match(re);
  return m ? m.length : 0;
}

/**
 * Map learned evidence to a motif family. Motif-based scoring only — no filename logic. Returns the
 * highest-scoring family; ties resolved by specificity (Chinese beat-cut > blue UI > card orbit >
 * poster ribbon). Returns generic_motion_graph when nothing scores.
 */
export function mapEvidenceToMotifFamily(input: CreativeEffectEvidenceInput): MotifFamily {
  const ocr = input.ocrText ?? [];
  const haystack = lc([...(ocr), ...(input.palette ?? []), ...(input.techniqueKeywords ?? []), ...(input.visualForms ?? []), input.videoType]);
  const paletteText = lc(input.palette);
  const hasChinese = input.hasChineseText ?? ocr.some((t) => typeof t === "string" && CJK_RE.test(t));
  const isBeatCut = /beat_cut|beatcut/.test(lc([input.videoType, ...(input.techniqueKeywords ?? [])]));
  const highBpm = typeof input.bpm === "number" && input.bpm >= HIGH_BPM;
  const hasGlitchWhip = /glitch|whip|hard_cut|flash_cut/.test(haystack);

  const scores: Record<MotifFamily, number> = {
    beat_cut_chinese_editing_tutorial: 0,
    split_screen_compare: 0,
    blue_spotlight_ui_pitch: 0,
    card_orbit_motion_graph: 0,
    poster_ribbon_marketing: 0,
    generic_motion_graph: 0
  };

  // Chinese editing tutorial requires Chinese text AND a beat-cut / glitch / high-tempo signal.
  if (hasChinese && (isBeatCut || hasGlitchWhip || highBpm)) {
    scores.beat_cut_chinese_editing_tutorial = 3 + (isBeatCut ? 1 : 0) + (highBpm ? 1 : 0) + (hasGlitchWhip ? 1 : 0);
  }

  scores.blue_spotlight_ui_pitch =
    countMatches(haystack, /\b(ui|dashboard|spotlight|search|panel|interface|app)\b/g) +
    (NAME_TO_HEX_COOL.test(paletteText) ? 1 : 0);

  scores.card_orbit_motion_graph =
    countMatches(haystack, /\b(card|orbit|stack|scatter|grid)\b/g) +
    (/red/.test(paletteText) && /black/.test(paletteText) ? 1 : 0);

  scores.poster_ribbon_marketing =
    countMatches(haystack, /\b(ribbon|poster|silk|gallery|catalog|lookbook)\b/g) +
    (/white|cream|ivory/.test(paletteText) ? 1 : 0);

  // Split-screen comparison: strong signals (split-screen / side-by-side / compare) weigh 2, weaker
  // before/after/vs weigh 1, CJK 对比/分屏 +2. CJK has no \b word boundary so it is tested separately.
  scores.split_screen_compare =
    countMatches(haystack, /\b(split[_\s-]?screen|side[_\s-]?by[_\s-]?side|versus|comparison|compare)\b/g) * 2 +
    countMatches(haystack, /\b(before|after|vs)\b/g) +
    (/对比|分屏|前后对比|左右对比/.test(haystack) ? 2 : 0);

  // Specificity order for ties.
  const order: MotifFamily[] = [
    "beat_cut_chinese_editing_tutorial",
    "split_screen_compare",
    "blue_spotlight_ui_pitch",
    "card_orbit_motion_graph",
    "poster_ribbon_marketing"
  ];
  let best: MotifFamily = "generic_motion_graph";
  let bestScore = 0;
  for (const family of order) {
    if (scores[family] > bestScore) {
      bestScore = scores[family];
      best = family;
    }
  }
  return bestScore > 0 ? best : "generic_motion_graph";
}

function isoNow(input?: string): string {
  if (typeof input === "string" && input) return input;
  return new Date().toISOString();
}

/**
 * Build a deterministic CreativeEffectSpec from learned evidence. The motif family is chosen by
 * mapEvidenceToMotifFamily (never by filename); the body comes from the per-family template.
 */
export function buildDeterministicCreativeEffectSpecFromEvidence(input: CreativeEffectEvidenceInput): CreativeEffectSpec {
  const motifFamily = mapEvidenceToMotifFamily(input);
  const tpl = MOTIF_TEMPLATES[motifFamily];
  const id = input.id ?? `ces_${motifFamily}_${(input.caseId ?? "case").replace(/[^a-z0-9_-]/gi, "")}`;
  return {
    version: "creative-effect-spec.v1",
    id,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    motifFamily,
    effectName: tpl.effectName,
    visualDescription: tpl.visualDescription,
    motionBehavior: [...tpl.motionBehavior],
    transitionBehavior: [...tpl.transitionBehavior],
    requiredProps: [...tpl.requiredProps],
    reusableRules: [...tpl.reusableRules],
    forbiddenOverfitRules: [...tpl.forbiddenOverfitRules],
    evidenceRefs: input.evidenceRefs ?? [],
    safety: {
      noSamplePixelCopy: true,
      noSampleAudioCopy: true,
      propsDriven: true,
      noRuntimeNetwork: true
    },
    source: "deterministic",
    createdAt: isoNow(input.createdAt)
  };
}

export interface CreativeEffectSpecValidation {
  valid: boolean;
  errors: string[];
}

/** Structural + safety validation for a CreativeEffectSpec. */
export function validateCreativeEffectSpec(input: unknown): CreativeEffectSpecValidation {
  const errors: string[] = [];
  const spec = input as Partial<CreativeEffectSpec> | null | undefined;
  if (!spec || typeof spec !== "object") {
    return { valid: false, errors: ["spec is not an object"] };
  }
  if (spec.version !== "creative-effect-spec.v1") errors.push("version must be creative-effect-spec.v1");
  if (typeof spec.id !== "string" || !spec.id) errors.push("id is required");
  if (!spec.motifFamily || !MOTIF_FAMILIES.includes(spec.motifFamily)) errors.push("motifFamily is invalid");
  if (typeof spec.effectName !== "string" || !spec.effectName) errors.push("effectName is required");
  if (typeof spec.visualDescription !== "string" || !spec.visualDescription) errors.push("visualDescription is required");
  for (const key of ["motionBehavior", "transitionBehavior", "requiredProps", "reusableRules", "forbiddenOverfitRules", "evidenceRefs"] as const) {
    if (!Array.isArray(spec[key])) errors.push(`${key} must be an array`);
  }
  const safety = spec.safety;
  if (!safety || typeof safety !== "object") {
    errors.push("safety is required");
  } else {
    if (safety.noSamplePixelCopy !== true) errors.push("safety.noSamplePixelCopy must be true");
    if (safety.noSampleAudioCopy !== true) errors.push("safety.noSampleAudioCopy must be true");
    if (safety.propsDriven !== true) errors.push("safety.propsDriven must be true");
    if (safety.noRuntimeNetwork !== true) errors.push("safety.noRuntimeNetwork must be true");
  }
  if (!["deterministic", "gemini", "built_in", "unknown"].includes(spec.source as string)) errors.push("source is invalid");
  if (typeof spec.createdAt !== "string" || !spec.createdAt) errors.push("createdAt is required");
  return { valid: errors.length === 0, errors };
}

export function isCreativeEffectSpec(input: unknown): input is CreativeEffectSpec {
  return validateCreativeEffectSpec(input).valid;
}

/** Normalized, props-only contract passed to a runtime effect component. No sample paths, no fs. */
export interface CreativeEffectRuntimeProps {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  assets?: Array<{ id: string; src?: string; role?: string; type?: string }>;
  texts?: Array<{ id?: string; text: string; role?: string }>;
  colors?: string[];
  beats?: number[];
  stylePack?: unknown;
  productTheme?: unknown;
}

/** Per-motif default palette, used only when no evidence/recipe palette is available. */
export const MOTIF_DEFAULT_COLORS: Record<MotifFamily, string[]> = {
  poster_ribbon_marketing: ["#f7f1e8", "#e11d2a", "#f5c518", "#1f2937"],
  card_orbit_motion_graph: ["#05060a", "#e11d2a", "#f5f5f5", "#22d3ee"],
  blue_spotlight_ui_pitch: ["#020617", "#2563eb", "#38bdf8", "#e2e8f0"],
  beat_cut_chinese_editing_tutorial: ["#05060a", "#e11d2a", "#f5c518", "#f5f5f5"],
  split_screen_compare: ["#0f172a", "#ef4444", "#22c55e", "#f8fafc"],
  generic_motion_graph: ["#05060a", "#22d3ee", "#f5f5f5"]
};

/** Paths/ids that must never reach effect props (sample evidence). */
const SAMPLE_PATH_RE = /test_videos\/|learned_samples|sample[_-]?evidence|\/samples?\//i;

export function looksLikeSamplePath(value: unknown): boolean {
  return typeof value === "string" && SAMPLE_PATH_RE.test(value);
}
