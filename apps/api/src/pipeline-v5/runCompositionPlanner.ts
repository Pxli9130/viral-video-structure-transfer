// pipeline-v5/runCompositionPlanner.ts
// Stage 10 (deterministic core): produce a CompositionProgram (JSON only, NO Remotion code).
// Post-GPT-gap-analysis upgrades: structure is NORMALIZED into <=6 readable beats (no 0.1s micro-
// sections, no single hook eating 85%), every section binds real KB elements, copy is distinct per
// section (no repeated slogans), the palette is brief/domain-aware (not always dark/red), and an
// audio cue plan is derived for beat-synced hits. The AI planner layers on top; this is the fallback.

import { v5 } from "@vvst/shared";

const DEFAULT_PALETTE = ["#0E1116", "#FFFFFF", "#2E7DFF", "#1C2230"];
const MAX_BEATS = 6;

// Per-role duration weights (relative) -> guarantees readable section lengths after distribution.
const ROLE_WEIGHT: Record<string, number> = { hook: 1.0, setup: 1.2, proof: 1.4, demo: 1.4, benefit: 1.3, transition: 0.5, cta: 1.1 };

interface PlannerInput {
  brief: v5.CreativeBriefV5;
  selectedElements: v5.KnowledgeElement[];
  targetProfiles: v5.TargetAssetProfile[];
  projectId: string;
  generationId?: string;
  composition?: { width?: number; height?: number; fps?: number; aspectRatio?: v5.AspectRatioV5 };
  beatGrid?: { bpm?: number | null; beats?: number[]; strongBeats?: number[] };
}

const MEDIA_ROLES = new Set<v5.SectionRoleV5>(["setup", "proof", "demo", "benefit"]);

export function runCompositionPlanner(input: PlannerInput): v5.CompositionProgram {
  const { brief, selectedElements, targetProfiles } = input;
  const durationSec = brief.targetDurationSec ?? 16;
  const aspectRatio = (input.composition?.aspectRatio ?? brief.aspectRatio ?? "9:16") as v5.AspectRatioV5;
  const width = input.composition?.width ?? (aspectRatio === "16:9" ? 1920 : aspectRatio === "1:1" ? 1080 : 1080);
  const height = input.composition?.height ?? (aspectRatio === "16:9" ? 1080 : aspectRatio === "1:1" ? 1080 : 1920);
  const fps = input.composition?.fps ?? 30;

  const structureEl = selectedElements.find((e) => e.kind === "structure_pattern");
  const structSections = (structureEl?.payload?.sections as Array<{ role: v5.SectionRoleV5; startSec: number; endSec: number }> | undefined) ?? null;

  // 1. Normalize structure into <=6 readable role-beats (handles micro-sections + one-hook-85%).
  const roleSeq = planRoleSequence(structSections, brief);
  const spans = distributeDurations(roleSeq, durationSec);

  // 2. Element buckets for binding (every section gets the global support set).
  const byRole = (role: string) => selectedElements.find((e) => appliedRoleFor(e) === role);
  const globalSupportIds = selectedElements
    .filter((e) => ["rhythm_pattern", "typography_pattern", "audio_pattern", "transition_pattern", "structure_pattern"].includes(e.kind))
    .map((e) => e.id);
  const visualIds = selectedElements.filter((e) => e.kind === "visual_asset_pattern" || e.kind === "image_prompt_recipe").map((e) => e.id);

  // 3. Distinct copy assignment: hook/cta strong, content sections get distinct selling points.
  const points = (brief.sellingPoints ?? []).filter(Boolean);
  let pointCursor = 0;

  const sections: v5.CompositionSection[] = spans.map((span, i) => {
    const id = `sec_${i}_${span.role}`;
    const refs = new Set<string>(globalSupportIds);
    const roleEl = byRole(span.role);
    if (roleEl) refs.add(roleEl.id);
    if (MEDIA_ROLES.has(span.role)) visualIds.forEach((v) => refs.add(v));

    let plannedText: string;
    if (span.role === "hook") plannedText = brief.prompt?.slice(0, 60) ?? `${brief.theme ?? "Watch this"}`;
    else if (span.role === "cta") plannedText = "Get yours today";
    else plannedText = points.length ? points[pointCursor++ % points.length] : defaultTextFor(span.role);

    const requiredSlots =
      span.role === "hook"
        ? [`${id}_hero`, `${id}_title`]
        : span.role === "cta"
          ? [`${id}_cta_card`, `${id}_cta_text`]
          : [`${id}_media`, `${id}_text`];

    return {
      id,
      role: span.role,
      startSec: span.startSec,
      endSec: span.endSec,
      purpose: purposeFor(span.role),
      elementRefs: Array.from(refs),
      requiredSlots,
      plannedText
    };
  });

  // 4. Slot plan.
  const slotPlan: v5.SlotPlan[] = [];
  for (const section of sections) {
    const sourceEl = selectedElements.find((e) => section.elementRefs.includes(e.id) && (e.kind === "visual_asset_pattern" || appliedRoleFor(e) === section.role));
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

  // 5. Brief/domain-aware palette (not the sample's dark/red).
  const typoEl = selectedElements.find((e) => e.kind === "typography_pattern");
  const rhythmEl = selectedElements.find((e) => e.kind === "rhythm_pattern");
  const palette = choosePalette(brief, typoEl);
  const pacing = (rhythmEl?.payload?.pacing as v5.StylePlanV5["pacing"] | undefined) ?? "fast";
  const coherenceNotes = [
    `${sections.length}-beat ad arc (normalized from ${structSections?.length ?? "fallback"} learned sections).`,
    "Brief-aware palette + harmonized typography."
  ];
  const stylePlan: v5.StylePlanV5 = {
    palette,
    typographySystem: (typoEl?.payload?.typographySystem as string | undefined) ?? "bold condensed headline plus clean subtitle",
    motionIntensity: pacing === "fast" ? "high" : pacing === "slow" ? "low" : "medium",
    textDensity: "medium",
    pacing,
    coherenceNotes
  };

  // 6. Audio plan + cue plan (beat-synced hits).
  const audioEl = selectedElements.find((e) => e.kind === "audio_pattern");
  const strongBeats = (input.beatGrid?.strongBeats?.length ? input.beatGrid.strongBeats : input.beatGrid?.beats) ?? [];
  const cues = buildAudioCuePlan(sections, durationSec, audioEl, strongBeats);
  const audioPlan: v5.AudioPlan = {
    layers: [
      { id: "audio_bed", kind: "music", audioRecipeId: audioEl?.audioRecipe?.id, startSec: 0, endSec: durationSec, gainDb: -8, duckUnderVoiceover: true }
    ],
    bedRecipeId: audioEl?.audioRecipe?.id,
    mood: (audioEl?.payload?.mood as string[] | undefined) ?? ["energetic", "commercial"],
    bpm: (audioEl?.payload?.bpm as number | undefined) ?? audioEl?.audioRecipe?.bpm ?? input.beatGrid?.bpm ?? undefined,
    cues,
    strongBeatsSec: strongBeats.slice(0, 24)
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
      whyThisStructureFitsBrief: `${sections.length}-beat ${stylePlan.pacing}-paced ad arc for "${brief.theme ?? brief.prompt ?? "the brief"}", ${targetProfiles.length} target assets.`,
      possibleRisks: targetProfiles.length === 0 ? ["No target assets; visual slots are filled by generated/designed material."] : []
    }
  };
}

/** Build a <=6 role sequence, hook-first cta-last, from a learned structure or an ad-arc archetype. */
function planRoleSequence(
  structSections: Array<{ role: v5.SectionRoleV5; startSec: number; endSec: number }> | null,
  brief: v5.CreativeBriefV5
): v5.SectionRoleV5[] {
  const benefits = Math.min(3, Math.max(1, (brief.sellingPoints ?? []).length || 2));
  const adArc = (): v5.SectionRoleV5[] => {
    const mids: v5.SectionRoleV5[] = ["setup"];
    for (let i = 0; i < benefits; i++) mids.push("benefit");
    mids.push("proof");
    // hook first, cta ALWAYS last — cap the middles so cta is never sliced off.
    return ["hook", ...mids.slice(0, MAX_BEATS - 2), "cta"];
  };

  if (!structSections || structSections.length < 3) return adArc();

  // collapse consecutive duplicate roles, weighted by original duration
  const collapsed: Array<{ role: v5.SectionRoleV5; dur: number }> = [];
  for (const s of structSections) {
    const dur = Math.max(0, s.endSec - s.startSec);
    const last = collapsed[collapsed.length - 1];
    if (last && last.role === s.role) last.dur += dur;
    else collapsed.push({ role: s.role, dur });
  }
  const distinctContent = new Set(collapsed.map((c) => c.role).filter((r) => r !== "hook" && r !== "cta" && r !== "transition"));
  if (distinctContent.size < 2) return adArc(); // degenerate (e.g. one hook eating everything)

  // keep hook + cta + the longest middles, cap to MAX_BEATS
  let roles = collapsed.map((c) => c.role);
  if (roles.length > MAX_BEATS) {
    const middles = collapsed
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.role !== "hook" && c.role !== "cta")
      .sort((a, b) => b.dur - a.dur)
      .slice(0, MAX_BEATS - 2)
      .sort((a, b) => a.i - b.i)
      .map((c) => c.role);
    roles = middles;
  } else {
    roles = roles.filter((r) => r !== "hook" && r !== "cta");
  }
  return ["hook", ...roles.slice(0, MAX_BEATS - 2), "cta"];
}

/** Distribute durationSec across roles by per-role weight -> readable, gap-free section spans. */
function distributeDurations(roles: v5.SectionRoleV5[], durationSec: number): Array<{ role: v5.SectionRoleV5; startSec: number; endSec: number }> {
  const weights = roles.map((r) => ROLE_WEIGHT[r] ?? 1.2);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return roles.map((role, i) => {
    const start = cursor;
    const end = i === roles.length - 1 ? durationSec : Number((cursor + (durationSec * weights[i]) / total).toFixed(2));
    cursor = end;
    return { role, startSec: Number(start.toFixed(2)), endSec: end };
  });
}

/** impact@hook, hit on each section start (title pops), riser ~1s before cta, impact@cta. */
function buildAudioCuePlan(
  sections: v5.CompositionSection[],
  durationSec: number,
  audioEl: v5.KnowledgeElement | undefined,
  strongBeats: number[]
): v5.AudioCuePoint[] {
  const cues: v5.AudioCuePoint[] = [{ t: 0, type: "impact", role: "hook_start" }];
  const cta = sections.find((s) => s.role === "cta");
  const snap = (t: number) => {
    if (!strongBeats.length) return Number(t.toFixed(2));
    let best = strongBeats[0];
    for (const b of strongBeats) if (Math.abs(b - t) < Math.abs(best - t)) best = b;
    return Math.abs(best - t) <= 0.4 ? Number(best.toFixed(2)) : Number(t.toFixed(2));
  };
  for (const s of sections) {
    if (s.role === "hook" || s.startSec === 0) continue;
    if (s.role === "cta") continue;
    cues.push({ t: snap(s.startSec), type: "hit", role: `${s.role}_pop` });
  }
  if (cta) {
    cues.push({ t: snap(Math.max(0, cta.startSec - 0.8)), type: "riser", role: "pre_cta" });
    cues.push({ t: snap(cta.startSec), type: "impact", role: "cta" });
  }
  // merge any audioRecipe cue points
  for (const c of audioEl?.audioRecipe?.cuePoints ?? []) {
    if (c.t > 0.1 && c.t < durationSec) cues.push({ t: Number(c.t.toFixed(2)), type: c.type, role: c.role });
  }
  return cues.sort((a, b) => a.t - b.t);
}

/** Domain-aware palette from the brief, so a fan / fintech / energy / cinematic ad each look distinct. */
function choosePalette(brief: v5.CreativeBriefV5, typoEl: v5.KnowledgeElement | undefined): string[] {
  const hay = `${brief.theme ?? ""} ${brief.vertical ?? ""} ${(brief.sellingPoints ?? []).join(" ")} ${brief.prompt ?? ""}`.toLowerCase();
  const has = (re: RegExp) => re.test(hay);
  if (has(/fan|cool|cold|fresh|breeze|portable|air|ac\b|chill/)) return ["#0A1A2E", "#E8F4FF", "#00C2FF", "#0E2A47"];
  if (has(/fintech|bank|pay|money|finance|secure|wallet|crypto|invest|transfer/)) return ["#0B1F3A", "#FFFFFF", "#1EC28B", "#123A63"];
  if (has(/energy|hype|explosive|sport|gym|power|drink|boost|fuel|workout/)) return ["#0A0A0C", "#FFEC3D", "#FF3E3E", "#1A1A1F"];
  if (has(/cinematic|night|drive|neon|teaser|film|city|moody|trailer/)) return ["#070710", "#E6E6FF", "#7A5CFF", "#141430"];
  if (has(/luxury|premium|beauty|skincare|jewel|gold/)) return ["#100C08", "#F5E6C8", "#C9A227", "#241A10"];
  const fromEl = (typoEl?.payload?.palette as string[] | undefined) ?? typoEl?.style?.palette;
  return fromEl && fromEl.length >= 3 ? fromEl : DEFAULT_PALETTE;
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
  if (role === "proof") return "Proven results";
  if (role === "setup") return "Here's the problem";
  return "Key benefit";
}

function inferSlotKind(slotId: string, role: v5.SectionRoleV5): v5.PlaceholderKindV5 {
  if (/title/.test(slotId)) return "main_title";
  if (/text/.test(slotId)) return "subtitle_text";
  if (/cta/.test(slotId)) return "cta_card";
  if (/hero/.test(slotId)) return "hero_product";
  return role === "hook" ? "hero_product" : role === "cta" ? "cta_card" : "product_closeup";
}
