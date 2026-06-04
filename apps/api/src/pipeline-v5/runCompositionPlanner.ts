// pipeline-v5/runCompositionPlanner.ts
// Stage 10 (deterministic core): produce a CompositionProgram (JSON only, NO Remotion code) from a
// brief + selected KnowledgeElements + target asset profiles. Uses a selected structure_pattern's
// section layout when present, else the fallback template (routing-and-fallbacks.md §5). The AI
// planner layers on top later; this deterministic planner is the guaranteed fallback.

import { v5 } from "@vvst/shared";

const FALLBACK_SECTIONS: Array<{ role: v5.SectionRoleV5; frac: number }> = [
  { role: "hook", frac: 0.15 },
  { role: "setup", frac: 0.3 },
  { role: "proof", frac: 0.25 },
  { role: "benefit", frac: 0.15 },
  { role: "cta", frac: 0.15 }
];

const DEFAULT_PALETTE = ["#0A0A0A", "#FFFFFF", "#F7C948"];

function defaultSlotKindForRole(role: v5.SectionRoleV5): v5.PlaceholderKindV5 {
  if (role === "hook") return "hero_product";
  if (role === "cta") return "cta_card";
  return "product_closeup";
}

interface PlannerInput {
  brief: v5.CreativeBriefV5;
  selectedElements: v5.KnowledgeElement[];
  targetProfiles: v5.TargetAssetProfile[];
  projectId: string;
  generationId?: string;
  composition?: { width?: number; height?: number; fps?: number; aspectRatio?: v5.AspectRatioV5 };
}

export function runCompositionPlanner(input: PlannerInput): v5.CompositionProgram {
  const { brief, selectedElements, targetProfiles } = input;
  const durationSec = brief.targetDurationSec ?? 16;
  const aspectRatio = (input.composition?.aspectRatio ?? brief.aspectRatio ?? "9:16") as v5.AspectRatioV5;
  const width = input.composition?.width ?? (aspectRatio === "16:9" ? 1920 : aspectRatio === "1:1" ? 1080 : 1080);
  const height = input.composition?.height ?? (aspectRatio === "16:9" ? 1080 : aspectRatio === "1:1" ? 1080 : 1920);
  const fps = input.composition?.fps ?? 30;

  // Choose section layout: a selected structure_pattern's sections (scaled), else the fallback.
  const structureEl = selectedElements.find((e) => e.kind === "structure_pattern");
  const structSections = (structureEl?.payload?.sections as Array<{ role: v5.SectionRoleV5; startSec: number; endSec: number }> | undefined) ?? null;

  let sections: v5.CompositionSection[];
  if (structSections && structSections.length) {
    const srcDur = Math.max(...structSections.map((s) => s.endSec));
    const scale = durationSec / (srcDur || durationSec);
    sections = structSections.map((s, i) => buildSection(s.role, i, Number((s.startSec * scale).toFixed(2)), Number((s.endSec * scale).toFixed(2)), selectedElements, brief));
  } else {
    let cursor = 0;
    sections = FALLBACK_SECTIONS.map((plan, i) => {
      const start = cursor;
      const end = i === FALLBACK_SECTIONS.length - 1 ? durationSec : Number((cursor + durationSec * plan.frac).toFixed(2));
      cursor = end;
      return buildSection(plan.role, i, start, end, selectedElements, brief);
    });
  }

  // Slot plan: one entry per (section, requiredSlot).
  const slotPlan: v5.SlotPlan[] = [];
  for (const section of sections) {
    const sourceEl = selectedElements.find((e) => section.elementRefs.includes(e.id));
    section.requiredSlots.forEach((slotId, j) => {
      const kind = inferSlotKind(slotId, section.role);
      slotPlan.push({
        id: slotId,
        sectionId: section.id,
        kind,
        required: section.role === "hook" || section.role === "cta" || j === 0,
        sourceElementId: sourceEl?.id,
        preferredFill: kind === "subtitle_text" || kind === "main_title" ? "text" : section.role === "cta" ? "procedural" : "target_asset"
      });
    });
  }

  // Style plan: from a selected typography_pattern, else defaults; rhythm from a rhythm_pattern.
  const typoEl = selectedElements.find((e) => e.kind === "typography_pattern");
  const rhythmEl = selectedElements.find((e) => e.kind === "rhythm_pattern");
  const palette = (typoEl?.payload?.palette as string[] | undefined) ?? (typoEl?.style?.palette) ?? DEFAULT_PALETTE;
  const pacing = (rhythmEl?.payload?.pacing as v5.StylePlanV5["pacing"] | undefined) ?? "fast";
  const stylePlan: v5.StylePlanV5 = {
    palette,
    typographySystem: (typoEl?.payload?.typographySystem as string | undefined) ?? "bold condensed headline plus clean subtitle",
    motionIntensity: pacing === "fast" ? "high" : pacing === "slow" ? "low" : "medium",
    textDensity: "medium",
    pacing,
    coherenceNotes: ["Harmonized palette + typography across all sections"]
  };

  // Audio plan: from a selected audio_pattern, else a default procedural bed.
  const audioEl = selectedElements.find((e) => e.kind === "audio_pattern");
  const audioPlan: v5.AudioPlan = {
    layers: [
      {
        id: "audio_bed",
        kind: "music",
        audioRecipeId: audioEl?.audioRecipe?.id,
        startSec: 0,
        endSec: durationSec,
        gainDb: -8,
        duckUnderVoiceover: true
      }
    ],
    bedRecipeId: audioEl?.audioRecipe?.id,
    mood: (audioEl?.payload?.mood as string[] | undefined) ?? ["energetic", "commercial"],
    bpm: (audioEl?.payload?.bpm as number | undefined) ?? (audioEl?.audioRecipe?.bpm)
  };

  const selectedElementsField: v5.CompositionSelectedElement[] = selectedElements.map((e, i) => ({
    elementId: e.id,
    appliedRole: appliedRoleFor(e),
    priority: i + 1,
    reason: e.description
  }));

  return {
    id: `comp_${input.generationId ?? input.projectId}`,
    projectId: input.projectId,
    generationId: input.generationId,
    creativeBrief: brief,
    selectedElements: selectedElementsField,
    composition: { width, height, fps, durationSec, aspectRatio },
    sections,
    stylePlan,
    slotPlan,
    materialPlan: { fills: [] },
    audioPlan,
    explanation: {
      howElementsCombine: selectedElements.map((e) => `${e.kind} "${e.name}" applied to ${appliedRoleFor(e)}.`),
      whyThisStructureFitsBrief: `${sections.length}-section ${stylePlan.pacing}-paced structure for "${brief.theme ?? brief.prompt ?? "the brief"}" with ${targetProfiles.length} target assets.`,
      possibleRisks: targetProfiles.length === 0 ? ["No target assets provided; sections will rely on generated/text fills."] : []
    }
  };
}

function appliedRoleFor(e: v5.KnowledgeElement): string {
  switch (e.kind) {
    case "hook_pattern":
      return "hook";
    case "cta_pattern":
      return "cta";
    case "audio_pattern":
      return "audio";
    case "rhythm_pattern":
      return "rhythm";
    case "typography_pattern":
      return "style";
    case "structure_pattern":
      return "structure";
    default:
      return "support";
  }
}

function buildSection(
  role: v5.SectionRoleV5,
  index: number,
  startSec: number,
  endSec: number,
  selectedElements: v5.KnowledgeElement[],
  brief: v5.CreativeBriefV5
): v5.CompositionSection {
  const id = `sec_${index}_${role}`;
  // Bind a same-role element to this section (hook->hook_pattern etc.).
  const el = selectedElements.find((e) => appliedRoleFor(e) === role);
  const sellingPoint = brief.sellingPoints?.[index % Math.max(1, brief.sellingPoints?.length ?? 1)];
  const requiredSlots = role === "hook"
    ? [`${id}_hero`, `${id}_title`]
    : role === "cta"
      ? [`${id}_cta_card`, `${id}_cta_text`]
      : [`${id}_media`, `${id}_text`];
  return {
    id,
    role,
    startSec,
    endSec,
    purpose: purposeFor(role),
    elementRefs: el ? [el.id] : [],
    requiredSlots,
    plannedText: sellingPoint ?? defaultTextFor(role)
  };
}

function purposeFor(role: v5.SectionRoleV5): string {
  const map: Record<string, string> = {
    hook: "Grab attention in the first seconds",
    setup: "Frame the problem / context",
    proof: "Show evidence / demo",
    demo: "Demonstrate the product",
    benefit: "Reinforce a key benefit",
    transition: "Bridge between sections",
    cta: "Drive conversion"
  };
  return map[role] ?? role;
}

function defaultTextFor(role: v5.SectionRoleV5): string {
  if (role === "hook") return "Watch this";
  if (role === "cta") return "Shop now";
  return "Key benefit";
}

function inferSlotKind(slotId: string, role: v5.SectionRoleV5): v5.PlaceholderKindV5 {
  if (/title/.test(slotId)) return "main_title";
  if (/text/.test(slotId)) return "subtitle_text";
  if (/cta/.test(slotId)) return "cta_card";
  if (/hero/.test(slotId)) return "hero_product";
  if (/media/.test(slotId)) return defaultSlotKindForRole(role);
  return defaultSlotKindForRole(role);
}
