import type {
  AssetProfileKind,
  KnowledgeAtom,
  RendererBackend,
  RenderRecipePrimitive,
  SegmentRole,
  StructureTemplate,
  TechniqueAtom,
  TechniqueAtomCategory,
  TypographyEvidenceItem,
  VisualElementNode
} from "../types.js";

export function extractKnowledgeAtoms(template: StructureTemplate): KnowledgeAtom[] {
  return template.structureAtoms;
}

interface AtomSeed {
  name: TechniqueAtom["name"];
  category: TechniqueAtomCategory;
  visualPattern: string;
  timingPattern: string;
  requiredAssets: AssetProfileKind[];
  preferred: RendererBackend;
  component: RenderRecipePrimitive | string;
  fallbackComponent?: RenderRecipePrimitive | string;
  transferRules: string[];
  qualityHints: string[];
  confidence: number;
  evidenceRefs?: string[];
  fallbackReason?: string;
}

function sourceSampleId(template: StructureTemplate): string {
  return template.sourceSampleIds?.[0] ?? template.sourceAssetFilename ?? template.id ?? "sample";
}

function stableTechniqueId(sampleId: string, name: string, refs: string[]): string {
  const input = `${sampleId}|${name}|${refs.join("|")}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `tech_${name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_${(hash >>> 0).toString(36)}`;
}

function visualRef(sampleId: string, element: VisualElementNode): string {
  const frameId = element.evidence?.frameIds?.find(Boolean);
  return frameId ? `evidence://${sampleId}/frame/${frameId}` : `evidence://${sampleId}/visual/${element.id}`;
}

function typoRef(sampleId: string, item: TypographyEvidenceItem): string {
  return `evidence://${sampleId}/typography/${item.textLayerId}`;
}

function segmentRef(template: StructureTemplate, role: SegmentRole): string | undefined {
  const segment = template.segments.find((item) => item.role === role);
  return segment ? `template://${template.id}/segment/${segment.id}` : undefined;
}

function addSeed(map: Map<string, AtomSeed>, seed: AtomSeed): void {
  const existing = map.get(seed.name);
  if (!existing) {
    map.set(seed.name, {
      ...seed,
      evidenceRefs: Array.from(new Set(seed.evidenceRefs ?? []))
    });
    return;
  }
  map.set(seed.name, {
    ...existing,
    confidence: Math.max(existing.confidence, seed.confidence),
    evidenceRefs: Array.from(new Set([...(existing.evidenceRefs ?? []), ...(seed.evidenceRefs ?? [])])),
    transferRules: Array.from(new Set([...existing.transferRules, ...seed.transferRules])),
    qualityHints: Array.from(new Set([...existing.qualityHints, ...seed.qualityHints])),
    fallbackReason: existing.fallbackReason && seed.evidenceRefs?.length ? undefined : existing.fallbackReason ?? seed.fallbackReason
  });
}

function bboxArea(element: VisualElementNode): number {
  const box = element.bboxTrackNorm?.[0]?.bbox;
  if (!box) return 0;
  return Math.max(0, box[2]) * Math.max(0, box[3]);
}

function hasMotion(text: string | undefined): boolean {
  return /sweep|slide|ticker|scroll|orbit|spin|pan|zoom|reveal|mask|helix|ribbon|flash|pulse/i.test(text ?? "");
}

function typographicPattern(items: TypographyEvidenceItem[]): string {
  const roles = Array.from(new Set(items.map((item) => item.layoutRole).filter(Boolean))).slice(0, 4).join("+");
  const anims = Array.from(new Set(items.map((item) => item.animationHint).filter(Boolean))).slice(0, 4).join("+");
  return [roles ? `roles=${roles}` : "", anims ? `animations=${anims}` : ""].filter(Boolean).join("; ") || "text evidence";
}

function timingFromRhythm(template: StructureTemplate): string {
  const bpm = template.rhythm?.bpm ? `${Math.round(template.rhythm.bpm)}bpm` : undefined;
  return [template.rhythm?.pace, bpm, `${template.rhythm?.averageShotDurationSec ?? 0}s avg shot`]
    .filter(Boolean)
    .join(", ");
}

export function extractTechniqueAtoms(template: StructureTemplate): TechniqueAtom[] {
  const sampleId = sourceSampleId(template);
  const seeds = new Map<string, AtomSeed>();
  const elements = template.visualElementGraph?.elements ?? [];
  const typography = template.typographyEvidence ?? [];
  const motionAtoms = template.motionAtoms ?? [];
  const audioStructure = (template.audioStructure ?? {}) as Record<string, unknown>;
  const timingPattern = timingFromRhythm(template);

  if (typography.length) {
    const refs = typography.map((item) => typoRef(sampleId, item));
    addSeed(seeds, {
      name: "KineticTypographySweep",
      category: "typography",
      visualPattern: typographicPattern(typography),
      timingPattern,
      requiredAssets: ["text"],
      preferred: "remotion_recipe_compose",
      component: "KineticTypographySweep",
      fallbackComponent: "TypographyLayoutSequence",
      transferRules: ["transfer bboxNorm/fontSizeRatio/colorRole/animationHint", "replace visible copy with target brief copy"],
      qualityHints: ["text must stay inside learned bbox", "unsupported animation falls back visibly, never silently"],
      confidence: Math.max(0.55, ...typography.map((item) => item.confidence ?? 0.72)),
      evidenceRefs: refs
    });
  }

  for (const atom of motionAtoms) {
    const refs = atom.evidenceFrames?.length
      ? atom.evidenceFrames.map((t) => `evidence://${sampleId}/motion/${atom.type}@${t}`)
      : [`evidence://${sampleId}/motion/${atom.type}`];
    if (atom.type === "parametric_ribbon_surface" || /ribbon|helix/i.test(`${atom.pathFamily ?? ""} ${atom.type}`)) {
      addSeed(seeds, {
        name: "ParametricRibbonSurface",
        category: "motion_atom",
        visualPattern: `${atom.surfaceType ?? "ribbon"} ${atom.pathFamily ?? "path"} ${atom.depthBehavior ?? "depth"}`,
        timingPattern: `${atom.startSec ?? 0}-${atom.endSec ?? template.targetDurationSec ?? 0}s; ${timingPattern}`,
        requiredAssets: ["generated"],
        preferred: "remotion_recipe_compose",
        component: "ParametricRibbonSurface",
        fallbackComponent: "TypographyLayoutSequence",
        transferRules: ["render procedurally from motion atom parameters", "do not request or copy sample frames"],
        qualityHints: ["ribbon must be visible over base media", "FFmpeg fallback draws a moving 2D band"],
        confidence: atom.confidence ?? 0.82,
        evidenceRefs: refs
      });
    }
  }

  for (const element of elements) {
    const family = element.family.toLowerCase();
    const refs = [visualRef(sampleId, element)];
    const pattern = [
      `family=${element.family}`,
      element.positionClass ? `position=${element.positionClass}` : "",
      element.motionPattern ? `motion=${element.motionPattern}` : "",
      bboxArea(element) ? `area=${bboxArea(element).toFixed(3)}` : ""
    ].filter(Boolean).join("; ");
    const confidence = element.evidence?.confidence ?? 0.68;
    if (/hero|product|poster/.test(family)) {
      addSeed(seeds, {
        name: "ProductPosterHero",
        category: "poster_layout",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["image", "generated"],
        preferred: "remotion_recipe_compose",
        component: "ProductPosterHero",
        fallbackComponent: "ProductHeroOrbit",
        transferRules: ["place target product in learned bbox", "enforce minAreaRatio for hero media"],
        qualityHints: ["main product cannot shrink to a tiny sticker", "keep source sample as evidence only"],
        confidence,
        evidenceRefs: refs
      });
      if (hasMotion(element.motionPattern) || (element.centerTrajectory?.length ?? 0) > 1) {
        addSeed(seeds, {
          name: "ObjectTrackReveal",
          category: "object_reveal",
          visualPattern: pattern,
          timingPattern,
          requiredAssets: ["image", "video"],
          preferred: "remotion_recipe_compose",
          component: "ObjectTrackReveal",
          fallbackComponent: "ProductHeroOrbit",
          transferRules: ["reuse element track geometry with target asset only", "round-robin tracks when evidence id is absent"],
          qualityHints: ["bbox/motion should vary by evidence track"],
          confidence,
          evidenceRefs: refs
        });
      }
    }
    if (/media_card|card|collage|stack/.test(family)) {
      addSeed(seeds, {
        name: "MediaCardCascade",
        category: "media_layout",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["image"],
        preferred: "remotion_recipe_compose",
        component: "MediaCardCascade",
        fallbackComponent: "FeatureCardStack",
        transferRules: ["map card count and relative positions, not sample pixels"],
        qualityHints: ["use at least two distinct target/generated assets when available"],
        confidence,
        evidenceRefs: refs
      });
      addSeed(seeds, {
        name: "FeatureCardStack",
        category: "media_layout",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["image", "text"],
        preferred: "remotion_recipe_compose",
        component: "FeatureCardStack",
        fallbackComponent: "MediaCardCascade",
        transferRules: ["pair product features with target media cards"],
        qualityHints: ["card positions must not collapse to centered text"],
        confidence: Math.max(0.58, confidence - 0.05),
        evidenceRefs: refs
      });
    }
    if (/montage|live_action|action|shot/.test(family)) {
      addSeed(seeds, {
        name: "SourceClipBeatMontage",
        category: "source_montage",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["video"],
        preferred: "ffmpeg_compose",
        component: "SourceClipBeatMontage",
        fallbackComponent: "DynamicProxyMontage",
        transferRules: ["use target/source moving clips only", "sample video frames remain evidence-only"],
        qualityHints: ["warn when no real moving material is available"],
        confidence,
        evidenceRefs: refs
      });
    }
    if (/impact|flash|stamp/.test(family)) {
      addSeed(seeds, {
        name: "ImpactFlash",
        category: "transition",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["generated"],
        preferred: "remotion_recipe_compose",
        component: "ImpactFlash",
        fallbackComponent: "ImpactFlash",
        transferRules: ["align flashes to strong beats/onsets"],
        qualityHints: ["flash must be brief and visible"],
        confidence,
        evidenceRefs: refs
      });
    }
    if (/light|leak|sweep|transition/.test(family)) {
      addSeed(seeds, {
        name: "LightLeakTransition",
        category: "transition",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["generated"],
        preferred: "remotion_recipe_compose",
        component: "LightLeakTransition",
        fallbackComponent: "ImpactFlash",
        transferRules: ["render as procedural light sweep; no sample frames"],
        qualityHints: ["must sit above media and below primary text"],
        confidence,
        evidenceRefs: refs
      });
    }
    if (/compare|split/.test(family)) {
      addSeed(seeds, {
        name: "SplitScreenCompare",
        category: "comparison",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["image", "video"],
        preferred: "remotion_recipe_compose",
        component: "SplitScreenCompare",
        fallbackComponent: "FeatureCardStack",
        transferRules: ["map two target states into learned split layout"],
        qualityHints: ["left/right assets must not duplicate unless source data is duplicated"],
        confidence,
        evidenceRefs: refs
      });
    }
    if (/cta|logo|brand/.test(family)) {
      addSeed(seeds, {
        name: "CTAEndSlate",
        category: "cta",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["image", "text"],
        preferred: "remotion_recipe_compose",
        component: "CTAEndSlate",
        fallbackComponent: "CTAEndSlate",
        transferRules: ["replace CTA copy from target brief", "do not burn prompt text"],
        qualityHints: ["CTA remains in safe area"],
        confidence,
        evidenceRefs: refs
      });
    }
    if (/price|badge|deal|discount/.test(family) || /price|badge|deal|discount/i.test(JSON.stringify(element.text ?? {}))) {
      addSeed(seeds, {
        name: "PriceBadgePulse",
        category: "pricing",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["text"],
        preferred: "remotion_recipe_compose",
        component: "PriceBadgePulse",
        fallbackComponent: "TypographyLayoutSequence",
        transferRules: ["use target price/offer copy only"],
        qualityHints: ["badge must not cover product hero"],
        confidence,
        evidenceRefs: refs
      });
    }
    if (/ribbon|geometric|mg/.test(family) || /ribbon|helix/i.test(element.motionPattern ?? "")) {
      addSeed(seeds, {
        name: "ParametricRibbonSurface",
        category: "motion_atom",
        visualPattern: pattern,
        timingPattern,
        requiredAssets: ["generated"],
        preferred: "remotion_recipe_compose",
        component: "ParametricRibbonSurface",
        fallbackComponent: "TypographyLayoutSequence",
        transferRules: ["render as procedural motion atom", "never call image/video provider with sample frame"],
        qualityHints: ["visible ribbon/sweep layer required in Remotion and FFmpeg"],
        confidence,
        evidenceRefs: refs
      });
    }
  }

  const ctaRef = segmentRef(template, "cta");
  if (ctaRef) {
    addSeed(seeds, {
      name: "CTAEndSlate",
      category: "cta",
      visualPattern: "CTA segment structure",
      timingPattern,
      requiredAssets: ["text", "image"],
      preferred: "remotion_recipe_compose",
      component: "CTAEndSlate",
      fallbackComponent: "CTAEndSlate",
      transferRules: ["derive CTA copy from target brief", "keep learned end-slate timing"],
      qualityHints: ["CTA should not contain prompt/meta instructions"],
      confidence: 0.58,
      evidenceRefs: [ctaRef]
    });
  }

  const onsets = Array.isArray(audioStructure.onsets) ? audioStructure.onsets : [];
  const strongBeats = Array.isArray(audioStructure.strongBeats) ? audioStructure.strongBeats : [];
  if (onsets.length || strongBeats.length) {
    addSeed(seeds, {
      name: "ImpactFlash",
      category: "audio",
      visualPattern: "audio onsets/strong beats",
      timingPattern: `${strongBeats.length || onsets.length} audio accents; ${timingPattern}`,
      requiredAssets: ["generated", "audio"],
      preferred: "ffmpeg_compose",
      component: "ImpactFlash",
      fallbackComponent: "ImpactFlash",
      transferRules: ["use strongBeatSec/accentPattern to drive flash and impact layers"],
      qualityHints: ["audio-driven visual accents must change when beat evidence changes"],
      confidence: 0.62,
      evidenceRefs: [`evidence://${sampleId}/audio/strong_beats`]
    });
  }

  return Array.from(seeds.values()).map((seed) => {
    const refs = Array.from(new Set(seed.evidenceRefs ?? []));
    return {
      id: stableTechniqueId(sampleId, seed.name, refs),
      name: seed.name,
      category: seed.category,
      sourceSampleId: sampleId,
      sourceEvidenceRefs: refs,
      visualPattern: seed.visualPattern,
      timingPattern: seed.timingPattern,
      requiredAssets: seed.requiredAssets,
      renderer: { preferred: seed.preferred, component: seed.component },
      ...(seed.fallbackComponent ? { fallbackComponent: seed.fallbackComponent } : {}),
      transferRules: seed.transferRules,
      qualityHints: seed.qualityHints,
      confidence: Math.max(0, Math.min(1, seed.confidence)),
      ...(refs.length ? {} : { fallbackReason: seed.fallbackReason ?? "No direct visual evidence; retained only as an explicit fallback technique." })
    };
  });
}
