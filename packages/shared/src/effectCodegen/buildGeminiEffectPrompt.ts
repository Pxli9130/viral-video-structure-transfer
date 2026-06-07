// Build the strict-JSON Gemini prompt that asks for a reusable, sandbox-safe Remotion effect
// component. The prompt embeds the safety denylist and motif-specific visual requirements. It never
// contains secrets/API keys.

import { createHash } from "node:crypto";
import type { CreativeEffectSpec, MotifFamily } from "../engine/creativeEffectSpec.js";

export interface CodegenLayerPlanInput {
  caseId?: string;
  motifFamily?: string;
  durationSec?: number;
  layers?: Array<{
    id?: string;
    type?: string;
    startSec?: number;
    durationSec?: number;
    role?: string;
    semanticTags?: string[];
    params?: Record<string, unknown>;
  }>;
  audio?: unknown;
  safety?: unknown;
}

export interface BuildEffectPromptInput {
  spec: CreativeEffectSpec;
  evidenceSummary?: string;
  contactSheetPathMeta?: { fileName?: string; frameCount?: number; note?: string };
  recipeContext?: { width?: number; height?: number; fps?: number; durationSec?: number; palette?: string[] };
  productTheme?: { name?: string; category?: string; cta?: string };
  /**
   * The vision/layer-plan output (actual-codegen-layers.json). The generated component's fixture +
   * section timeline MUST be derived from this so multi-section samples are NOT collapsed to a short
   * motif demo. Carries the authoritative full durationSec + per-section layers.
   */
  codegenLayerPlan?: CodegenLayerPlanInput;
}

/** Compact the layer plan into authoritative prompt lines that drive fixture + section timeline. */
function layerPlanLines(plan: CodegenLayerPlanInput | undefined): string[] {
  if (!plan || !Array.isArray(plan.layers) || plan.layers.length === 0) return [];
  const layers = plan.layers.slice(0, 48).map((l) => ({
    type: l.type,
    role: l.role,
    startSec: l.startSec,
    durationSec: l.durationSec,
    semanticTags: l.semanticTags,
    params: l.params
  }));
  return [
    "CODEGEN LAYER PLAN — authoritative sample structure. Derive fixtureJson AND the component section timeline from THIS:",
    `- fixtureJson.durationSec MUST equal ${plan.durationSec ?? "the plan's total span"} (do NOT collapse a multi-section sample into a short motif demo).`,
    "- Cover EVERY section/role below across the full timeline; schedule one visual block per section with Remotion <Sequence> (from/durationInFrames).",
    "- Derive fixtureJson.sections from these layers (role, startSec, durationSec); texts from text layers; cards/uiPanels/subtitles/transitions/audioCues from layer params/semanticTags.",
    "- Place transitions/flashes/impacts at section boundaries; do not hold a single static frame for the whole duration.",
    `Layers JSON: ${JSON.stringify(layers)}`,
    plan.audio ? `Audio evidence: ${JSON.stringify(plan.audio).slice(0, 400)}` : "",
    ""
  ].filter((l) => l !== "");
}

export interface BuiltEffectPrompt {
  prompt: string;
  promptHash: string;
}

const SAFETY_DENYLIST = [
  "no fs",
  "no child_process",
  "no net/http/https",
  "no fetch",
  "no process.env",
  "no eval",
  "no Function constructor",
  "no require()",
  "no dynamic import()",
  "no remote URLs",
  "no external npm packages except zod (React + Remotion + zod only; zod is fine for the props schema)",
  "no hardcoded sample filenames",
  "no hardcoded sample paths",
  "no /mnt/data/",
  "no test_videos/",
  "no runtime provider calls",
  "no copying sample pixels/audio"
];

function zodContract(componentName: string): string[] {
  return [
    "ZOD-ENABLED GENERATED EFFECT CONTRACT",
    "",
    "You are generating a reusable Remotion effect module.",
    "Return STRICT JSON only. No markdown.",
    "",
    "Output JSON fields:",
    "{",
    '  "effectId": "...",',
    '  "componentName": "...",',
    '  "indexTsx": "...",',
    '  "schemaTs": "...",',
    '  "fixtureJson": "...",',
    '  "readmeMd": "...",',
    '  "safetyNotes": []',
    "}",
    "",
    "schema.ts rules:",
    "- schema.ts MAY import zod.",
    "- schema.ts may contain exactly this external import:",
    '  import { z } from "zod";',
    "- schema.ts MUST NOT import anything else.",
    "- schema.ts MUST NOT import React.",
    "- schema.ts MUST NOT import Remotion.",
    "- schema.ts MUST NOT import fs, child_process, net, http, https.",
    "- schema.ts MUST NOT call fetch.",
    "- schema.ts MUST NOT read process.env.",
    "- schema.ts MUST NOT use eval, Function, require, or dynamic import.",
    `- schema.ts MUST export a Zod object schema named ${componentName}PropsSchema.`,
    `- schema.ts MUST export a TypeScript type named ${componentName}Props using z.infer.`,
    "- schema.ts MUST define a data-only schema. No transforms, refinements, custom functions, async, or runtime logic.",
    "- Do NOT use:",
    "  z.function",
    "  z.lazy",
    "  z.promise",
    "  z.preprocess",
    "  z.custom",
    "  .transform",
    "  .refine",
    "  .superRefine",
    "- Use only declarative Zod APIs:",
    "  z.object",
    "  z.array",
    "  z.string",
    "  z.number",
    "  z.boolean",
    "  z.unknown",
    "  z.record",
    "  z.enum",
    "  z.union",
    "  z.literal",
    "  .optional()",
    "  .default()",
    "",
    "Required schema.ts shape:",
    "",
    'import { z } from "zod";',
    "",
    "export const CreativeEffectAssetSchema = z.object({",
    "  id: z.string(),",
    "  src: z.string().optional(),",
    "  role: z.string().optional(),",
    "  type: z.string().optional()",
    "});",
    "",
    "export const CreativeEffectTextSchema = z.object({",
    "  id: z.string().optional(),",
    "  text: z.string(),",
    "  role: z.string().optional()",
    "});",
    "",
    `export const ${componentName}PropsSchema = z.object({`,
    "  width: z.number().optional().default(1080),",
    "  height: z.number().optional().default(1920),",
    "  fps: z.number().optional().default(30),",
    "  durationSec: z.number().optional().default(8),",
    "  assets: z.array(CreativeEffectAssetSchema).optional().default([]),",
    "  texts: z.array(CreativeEffectTextSchema).optional().default([]),",
    "  colors: z.array(z.string()).optional().default([]),",
    "  beats: z.array(z.number()).optional().default([]),",
    "  stylePack: z.unknown().optional(),",
    "  productTheme: z.unknown().optional(),",
    "  proceduralFallback: z.boolean().optional().default(true)",
    "});",
    "",
    `export type ${componentName}Props = z.infer<typeof ${componentName}PropsSchema>;`
  ];
}

const MOTIF_REQUIREMENTS: Record<MotifFamily, string[]> = {
  poster_ribbon_marketing: [
    "white/light poster layout",
    "colorful ribbon/silk sweep",
    "poster typography blocks",
    "elegant gallery motion"
  ],
  card_orbit_motion_graph: ["black/red card stack/orbit/scatter", "bold center text", "neon frame accents"],
  blue_spotlight_ui_pitch: [
    "blue/black background",
    "spotlight/orb/light sweep",
    "floating UI/dashboard panels",
    "sequential pitch reveal"
  ],
  beat_cut_chinese_editing_tutorial: [
    "black background",
    "red/yellow/white large Chinese kinetic text",
    "beat-synced pop/flash/glitch/whip cuts"
  ],
  split_screen_compare: [
    "side-by-side split screen with a vertical divider",
    "two before/after panels (one tinted vs the other)",
    "comparison labels from texts (before/after) with a label pop",
    "animated divider sweep — never a static split"
  ],
  generic_motion_graph: ["neutral motion-graphic bed (streaks + beat EQ)", "palette-driven", "never static"]
};

export function buildGeminiEffectPrompt(input: BuildEffectPromptInput): BuiltEffectPrompt {
  const { spec } = input;
  const motifReqs = MOTIF_REQUIREMENTS[spec.motifFamily] ?? MOTIF_REQUIREMENTS.generic_motion_graph;
  const lines: string[] = [
    "You are generating a reusable Remotion React component.",
    "",
    `Target motif family: ${spec.motifFamily}`,
    `Effect name: ${spec.effectName}`,
    `Visual description: ${spec.visualDescription}`,
    `Motion behavior: ${spec.motionBehavior.join(", ")}`,
    `Transition behavior: ${spec.transitionBehavior.join(", ")}`,
    input.evidenceSummary ? `Evidence summary: ${input.evidenceSummary}` : "",
    input.productTheme?.name ? `Product theme: ${input.productTheme.name} (${input.productTheme.category ?? "product"}), CTA: ${input.productTheme.cta ?? ""}` : "",
    input.recipeContext
      ? `Render context: ${input.recipeContext.width ?? 720}x${input.recipeContext.height ?? 1280} @ ${input.recipeContext.fps ?? 30}fps, ${input.recipeContext.durationSec ?? 15}s, palette ${(input.recipeContext.palette ?? []).join(", ")}`
      : "",
    input.contactSheetPathMeta?.fileName
      ? `A contact sheet (${input.contactSheetPathMeta.fileName}, ${input.contactSheetPathMeta.frameCount ?? "?"} frames) describes the sample look; use it for STYLE inspiration only — do not reproduce sample pixels.`
      : "",
    "",
    ...layerPlanLines(input.codegenLayerPlan),
    "Requirements:",
    "- TypeScript",
    "- React + Remotion in index.tsx; zod is allowed only in schema.ts under the contract below",
    "- only import remotion exports that exist in current Remotion (v4). For interpolate extrapolation use the STRING value (e.g. extrapolateLeft: \"clamp\", extrapolateRight: \"clamp\"); do NOT import or use `Extrapolate` (removed — `Extrapolate.clamp` will be undefined at runtime and crash the render)",
    "- props-driven",
    ...SAFETY_DENYLIST.map((d) => `- ${d}`),
    "- accept assets/texts/colors/beats via props",
    "- render procedural fallback visuals when assets are absent",
    "- NEVER render debug/placeholder text in the video: do NOT render the literal strings \"Procedural Fallback\", \"Asset not provided\", \"No asset\", or any placeholder/debug label. When an asset is absent, render motif-specific procedural visuals (shapes/gradients/typography) instead.",
    "",
    "NON-BLANK / FULL-COVERAGE CONTRACT (HARD — a render that sits on a blank/near-black frame is REJECTED):",
    "- EVERY scene / <Sequence> / branch (including any 'media'/'clip'/'image'/'placeholder' branch when assets are absent) MUST render a FULL-BLEED OPAQUE <AbsoluteFill> with an EXPLICIT backgroundColor taken from the motif palette (the `colors` prop / fixtureJson.colors), so the page background never shows through. Never render an AbsoluteFill with no backgroundColor on top of the root.",
    "- Do NOT rely on flexbox or percentage-height children to fill the frame — in headless render they can collapse to zero size and leave a black frame. Fill the frame with <AbsoluteFill> (which is position:absolute, inset:0) or explicit pixel width/height. Children may use flex for LAYOUT, but the opaque background fill must come from an AbsoluteFill, not a flex child.",
    "- EVERY scheduled section MUST also carry animated, clearly visible FOREGROUND content (text/shapes/cards/panels) on the opaque background — not just a flat color. Animate via useCurrentFrame()/interpolate so it moves.",
    "- The <Sequence> ranges MUST tile the WHOLE [0, durationSec] timeline with NO GAPS and NO uncovered tail (sum/overlap so every frame belongs to at least one section that paints a full-bleed opaque background). The first frame (frame 0) and the last frame must both be non-blank.",
    "- A frame is 'blank' if it is a near-uniform flat color (no foreground). Self-check your component: at any sampled time there must be visible foreground over an opaque motif-colored background.",
    `- export a named component matching componentName (${spec.effectName})`,
    "- fixtureJson MUST include durationSec, width, height, fps, assets: [], texts, colors, beats, and proceduralFallback: true",
    "- if a CODEGEN LAYER PLAN is provided above: fixtureJson.durationSec MUST equal the plan duration and the component MUST cover EVERY section across the full timeline with Remotion <Sequence> (do NOT collapse a multi-section sample into a short motif demo)",
    "- fixtureJson SHOULD also carry: sections[] ({role,startSec,durationSec} from the plan) and any of cards/uiPanels/subtitles/transitions/audioCues derived from layer params; declare matching OPTIONAL fields in the zod schema (declarative APIs only)",
    "- declare procedural audio cues in fixtureJson: audio = { policy: \"procedural\", bgm: <motif-appropriate>, sfx: [{ at: <sec>, kind: \"whoosh\"|\"impact\"|\"sweep\"|\"glitch\"|\"riser\" }] } at transition/beat times (renderer adds the actual track; never reference remote URLs or sample audio)",
    "- include README explaining props and motif use",
    `- useful for the motif family "${spec.motifFamily}", not generic`,
    "",
    ...zodContract(spec.effectName),
    "",
    `Motif requirements (${spec.motifFamily}):`,
    ...motifReqs.map((r) => `- ${r}`),
    "",
    "Output STRICT JSON ONLY (no markdown, no prose, no code fences), exactly this shape:",
    "{",
    '  "effectId": "...",',
    '  "componentName": "...",',
    '  "indexTsx": "...",',
    '  "schemaTs": "...",',
    '  "fixtureJson": "...",',
    '  "readmeMd": "...",',
    '  "safetyNotes": []',
    "}"
  ].filter((line) => line !== "");

  const prompt = lines.join("\n");
  const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
  return { prompt, promptHash };
}
