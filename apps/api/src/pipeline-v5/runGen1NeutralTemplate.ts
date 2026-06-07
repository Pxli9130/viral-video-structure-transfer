// pipeline-v5/runGen1NeutralTemplate.ts
// Deterministic Gen1 fallback (routing-and-fallbacks.md §2 "fallback 3: deterministic neutral
// template"). Builds a schema-valid, content-neutral NeutralReconstructionProgram from an
// EvidenceTimelineV5 alone — NO external API. This is the demo safety net (audit LEARN-02) and also
// the structural skeleton the AI Gen1 refines. Everything it emits is placeholder-driven; it never
// references sample media paths, sample text, or sample audio.

import { v5 } from "@vvst/shared";

const ROLE_PLAN: Array<{ role: v5.SectionRoleV5; frac: number }> = [
  { role: "hook", frac: 0.12 },
  { role: "benefit", frac: 0.33 },
  { role: "proof", frac: 0.25 },
  { role: "benefit", frac: 0.15 },
  { role: "cta", frac: 0.15 }
];

const DEFAULT_PALETTE = ["#0A0A0A", "#FFFFFF", "#F7C948"];

function pickPalette(ev: v5.EvidenceTimelineV5): string[] {
  for (const f of ev.keyFrames) {
    if (f.dominantHexPalette && f.dominantHexPalette.length >= 2) return f.dominantHexPalette.slice(0, 4);
  }
  return DEFAULT_PALETTE;
}

function refsInRange(ev: v5.EvidenceTimelineV5, startSec: number, endSec: number): string[] {
  const refs: string[] = [];
  for (const s of ev.shots) if (s.endSec > startSec && s.startSec < endSec) refs.push(s.id);
  for (const t of ev.textEvidence ?? []) if (t.timeSec >= startSec && t.timeSec <= endSec) refs.push(t.id);
  return refs.slice(0, 8);
}

interface SceneLayout {
  scene: v5.ProgramScene;
  placeholders: v5.PlaceholderSlotV5[];
  timing: v5.TimingSegmentV5;
}

function buildScene(
  ev: v5.EvidenceTimelineV5,
  role: v5.SectionRoleV5,
  index: number,
  startSec: number,
  endSec: number
): SceneLayout {
  const sceneId = `sec_${index}_${role}`;
  const evidenceRefs = refsInRange(ev, startSec, endSec);
  const placeholders: v5.PlaceholderSlotV5[] = [];
  const layers: v5.ProgramLayer[] = [];

  const mediaKind: v5.PlaceholderKindV5 = role === "hook" ? "hero_product" : role === "cta" ? "cta_card" : "product_closeup";
  const mediaPh: v5.PlaceholderSlotV5 = {
    id: `${sceneId}_media`,
    kind: mediaKind,
    required: role === "hook" || role === "cta",
    sectionId: sceneId,
    startSec,
    endSec,
    evidenceRefs,
    replacementPolicy: role === "cta" ? "generate" : "target_asset",
    safetyPolicy: role === "cta" ? "procedural_only" : "must_replace_sample",
    sourcePolicy: "sample_evidence_only"
  };
  placeholders.push(mediaPh);
  layers.push({
    id: `${sceneId}_media_layer`,
    type: role === "cta" ? "cta" : "media",
    placeholderId: mediaPh.id,
    startSec,
    endSec,
    style: { position: "center" },
    motion: { kind: role === "hook" ? "impact_zoom" : "slow_push", intensity: role === "hook" ? 0.8 : 0.4 },
    evidenceRefs
  });

  const textKind: v5.PlaceholderKindV5 = role === "hook" ? "main_title" : "subtitle_text";
  const textPh: v5.PlaceholderSlotV5 = {
    id: `${sceneId}_text`,
    kind: textKind,
    required: role === "hook" || role === "cta",
    sectionId: sceneId,
    startSec: startSec + Math.min(0.3, (endSec - startSec) * 0.15),
    endSec,
    evidenceRefs,
    replacementPolicy: "text_fallback",
    safetyPolicy: "can_use_user_asset",
    sourcePolicy: "sample_evidence_only"
  };
  placeholders.push(textPh);
  layers.push({
    id: `${sceneId}_text_layer`,
    type: "text",
    placeholderId: textPh.id,
    startSec: textPh.startSec,
    endSec,
    style: { fontWeight: role === "hook" ? 800 : 700, safeArea: role === "cta" ? "bottom" : "top" },
    motion: { kind: role === "hook" ? "slide_up_pop" : "fade_swap" },
    evidenceRefs
  });

  const scene: v5.ProgramScene = {
    id: sceneId,
    role,
    startSec,
    endSec,
    intent: `${role} section (deterministic template)`,
    layers,
    motionGrammar: [role === "hook" ? "impact_zoom" : "slow_push", "text_pop"],
    packagingGrammar: [role === "cta" ? "cta_card" : "bold_title"],
    evidenceRefs
  };

  const timing: v5.TimingSegmentV5 = {
    id: `tm_${index}`,
    startSec,
    endSec,
    role,
    visualTechnique: role === "hook" ? "center hero impact" : role === "cta" ? "CTA card reveal" : "product showcase",
    motionTechnique: role === "hook" ? "beat-aligned zoom" : "subtitle swap",
    audioCue: role === "hook" || role === "cta" ? "impact" : "bed",
    evidenceRefs
  };

  return { scene, placeholders, timing };
}

function buildAudioCues(ev: v5.EvidenceTimelineV5, ctaStartSec: number): v5.AudioCue[] {
  const cues: v5.AudioCue[] = [{ t: 0, type: "impact", role: "hook_start" }];
  const onsets = ev.audioEvidence?.onsetsSec ?? [];
  for (const t of onsets.slice(0, 6)) {
    if (t > 0.2 && t < ctaStartSec) cues.push({ t: Number(t.toFixed(2)), type: "hit", role: "accent" });
  }
  cues.push({ t: Number(ctaStartSec.toFixed(2)), type: "impact", role: "cta" });
  return cues;
}

function buildRemotionProject(componentName: string, scenes: v5.ProgramScene[]): v5.RemotionProjectV5 {
  // A content-neutral, placeholder-driven Remotion entry. It renders solid scene backgrounds with
  // placeholder boxes/labels only — no sample media paths, no sample text, no sample audio.
  const sceneLiteral = JSON.stringify(
    scenes.map((s) => ({ id: s.id, role: s.role, startSec: s.startSec, endSec: s.endSec })),
    null,
    2
  );
  const content = `import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";

// Deterministic neutral reconstruction — placeholders only, no sample content.
const SCENES = ${sceneLiteral};

export const ${componentName}: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#0A0A0A" }}>
      {SCENES.map((s) => (
        <Sequence key={s.id} from={Math.round(s.startSec * fps)} durationInFrames={Math.max(1, Math.round((s.endSec - s.startSec) * fps))}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "#FFFFFF", fontSize: 48, fontWeight: 800, opacity: 0.25, textTransform: "uppercase" }}>{s.role}</div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

export default ${componentName};
`;
  return {
    entryFile: "index.tsx",
    componentName,
    files: [{ path: "index.tsx", content }],
    propsSchema: {},
    fixture: {},
    allowedImports: ["react", "remotion", "zod"]
  };
}

export interface Gen1TemplateResult {
  program: v5.NeutralReconstructionProgram;
  validation: v5.V5ValidationResult;
}

/** Build a deterministic NeutralReconstructionProgram from evidence alone. */
export function runGen1NeutralTemplate(
  ev: v5.EvidenceTimelineV5,
  opts: { programId?: string; reason?: string } = {}
): Gen1TemplateResult {
  const lastShotEnd = ev.shots.length ? Math.max(...ev.shots.map((s) => s.endSec)) : 0;
  const duration = ev.video.durationSec || lastShotEnd || 16;

  const layouts: SceneLayout[] = [];
  let cursor = 0;
  ROLE_PLAN.forEach((plan, i) => {
    const start = cursor;
    const end = i === ROLE_PLAN.length - 1 ? duration : Math.min(duration, cursor + duration * plan.frac);
    if (end - start < 0.2) return;
    layouts.push(buildScene(ev, plan.role, i + 1, Number(start.toFixed(2)), Number(end.toFixed(2))));
    cursor = end;
  });

  const scenes = layouts.map((l) => l.scene);
  const placeholders = layouts.flatMap((l) => l.placeholders);
  const timingMap = layouts.map((l) => l.timing);
  const ctaStart = scenes.find((s) => s.role === "cta")?.startSec ?? duration * 0.85;
  const palette = pickPalette(ev);

  const cutDensity = ev.motionEvidence?.cutDensity ?? "medium";
  const motionIntensity: v5.StylePlanV5["motionIntensity"] = cutDensity === "high" ? "high" : cutDensity === "low" ? "low" : "medium";
  const pacing: v5.StylePlanV5["pacing"] = cutDensity === "high" ? "fast" : cutDensity === "low" ? "slow" : "medium";

  const typedSpec: v5.RenderProgramSpecV5 = {
    composition: {
      width: ev.video.width,
      height: ev.video.height,
      fps: ev.video.fps,
      durationSec: Number(duration.toFixed(2)),
      aspectRatio: (["9:16", "16:9", "1:1"].includes(String(ev.video.aspectRatio)) ? ev.video.aspectRatio : "9:16") as v5.AspectRatioV5,
      background: palette[0]
    },
    scenes,
    globalStyle: {
      palette,
      typographySystem: "bold condensed title with clean subtitles",
      motionIntensity,
      textDensity: "medium",
      pacing,
      coherenceNotes: ["Deterministic neutral template — refine with AI Gen1 when available"]
    },
    audioCues: buildAudioCues(ev, ctaStart),
    rhythm: {
      cutDensity,
      beatAlignedCuts: Boolean(ev.audioEvidence?.beatGridSec?.length),
      peakMomentsSec: ev.motionEvidence?.peakMomentsSec ?? []
    }
  };

  const learnedAssetRecipes: v5.AssetRecipeV5[] = [
    {
      id: "ar_hero_product",
      kind: "hero_product",
      observedDescription: { subject: "primary hero subject", composition: "centered", mood: "premium" },
      generationPromptTemplate: "Create a new centered hero image for {targetProduct} with clean studio lighting and a dark background. Do not copy the source sample.",
      negativePrompt: "no watermark, no sample logo, no exact original product, no original text",
      placementHint: { sectionRole: "hook", motion: "impact zoom", durationSec: Math.max(1, ctaStart * 0.1) },
      reusablePolicy: "regenerate_only",
      evidenceRefs: scenes[0]?.evidenceRefs ?? []
    }
  ];

  const learnedAudioRecipes: v5.AudioRecipeV5[] = ev.audioEvidence?.hasAudio
    ? [
        {
          id: "au_bed_impact",
          kind: ev.audioEvidence.bpm ? "music_bed" : "impact",
          bpm: ev.audioEvidence.bpm,
          mood: ["energetic", "commercial"],
          cuePoints: typedSpec.audioCues.map((c) => ({ t: c.t, type: (c.type === "beat" ? "hit" : c.type) as v5.AudioCueType, role: c.role ?? "cue" })),
          generationPromptTemplate: `Generate a commercial bed around ${ev.audioEvidence.bpm ?? 120} BPM with impacts at hook and CTA. Do not imitate the source track.`,
          negativePrompt: "do not recreate the sample melody or track",
          reusablePolicy: "procedural_recreate",
          evidenceRefs: ["audio_beat_grid"]
        }
      ]
    : [];

  const componentName = "NeutralSampleReconstruction";
  const coveredSec = scenes.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);

  const program: v5.NeutralReconstructionProgram = {
    id: opts.programId ?? `nrp_${ev.assetId}`,
    sourceSampleId: ev.assetId,
    evidenceTimelineId: ev.id,
    evidenceRefs: Array.from(new Set(scenes.flatMap((s) => s.evidenceRefs))).slice(0, 24),
    typedSpec,
    remotionProject: buildRemotionProject(componentName, scenes),
    placeholders,
    timingMap,
    learnedAssetRecipes,
    learnedAudioRecipes,
    reconstructionQuality: {
      structureCoverage: scenes.length >= 4 ? 0.7 : 0.5,
      timingCoverage: Math.min(1, coveredSec / Math.max(1, duration)),
      placeholderCoverage: 0.8,
      warnings: ["Deterministic template; structure inferred from evidence proportions, not VLM."]
    },
    safety: {
      samplePixelsRemoved: true,
      sampleTextSanitized: true,
      sampleAudioRemoved: true,
      renderableSampleMaterialRefs: []
    },
    fallbackUsed: true,
    fallbackReason: opts.reason ?? "deterministic_neutral_template"
  };

  return { program, validation: v5.validateNeutralReconstructionProgram(program) };
}
