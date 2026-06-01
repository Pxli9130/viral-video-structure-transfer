import type {
  BBoxNormObject,
  MotionAtomSpec,
  RenderRecipe,
  RenderRecipeAudioLayer,
  RenderRecipeClip,
  RenderRecipeLayer,
  RenderRecipeMediaLayer,
  RenderRecipeMotionAtomLayer,
  RenderRecipeTextLayer
} from "../types.js";

const PROMPT_DISPLAY_DENYLIST = [
  "15 秒",
  "15秒",
  "高转化",
  "CTA",
  "prompt",
  "生成",
  "换成",
  "版本",
  "镜头",
  "素材",
  "文案：",
  "文案:",
  "要求：",
  "要求:"
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value: string): string {
  return value
    .replace(/^(?:subject|topic|product|主题|商品|产品|CTA|引导|结尾)\s*[:：-]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,，。；;：:\s]+|[,，。；;：:\s]+$/g, "")
    .trim();
}

export function containsPromptLikeDisplayText(value: string | undefined): boolean {
  const text = value ?? "";
  if (!text) return false;
  if (text.length > 64) return true;
  return PROMPT_DISPLAY_DENYLIST.some((token) => text.toLowerCase().includes(token.toLowerCase()));
}

export function sanitizeDisplayText(value: string | undefined, fallback = "Product", maxChars = 24): string {
  const raw = cleanText(value ?? "");
  if (!raw) return fallback;
  const firstBad = PROMPT_DISPLAY_DENYLIST
    .map((token) => raw.toLowerCase().indexOf(token.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const beforeBad = firstBad !== undefined ? raw.slice(0, firstBad) : raw;
  const sentence = beforeBad.split(/[。！？\n]/).map((part) => part.trim()).find(Boolean) ?? beforeBad;
  const cleaned = cleanText(sentence);
  if (!cleaned) return fallback;
  return Array.from(cleaned).slice(0, maxChars).join("");
}

export function extractProductNameFromPrompt(prompt: string, fallback = "Product"): string {
  const labeled = prompt.match(/(?:主题|商品|产品|product|topic)[:：]\s*([^\n。；;]+)/i)?.[1];
  if (labeled) return sanitizeDisplayText(labeled, fallback);
  const beforeCta = prompt.split(/CTA[:：]/i)[0] ?? prompt;
  return sanitizeDisplayText(beforeCta, fallback);
}

export function extractCtaTextFromPrompt(prompt: string, fallback = "Click to learn more"): string {
  const labeled = prompt.match(/(?:CTA|引导|结尾)[:：]\s*([^\n。；;]+)/i)?.[1];
  if (labeled) {
    const safe = sanitizeDisplayText(labeled, fallback, 36);
    const firstClause = safe.split(/[，,]/).map((part) => part.trim()).find(Boolean);
    if (firstClause && /[一-鿿]/.test(firstClause) && Array.from(firstClause).length >= 4) return firstClause;
    return safe;
  }
  return fallback;
}

export function extractBrandName(productName: string | undefined): string | undefined {
  const text = productName?.trim();
  if (!text) return undefined;
  const latin = text.match(/^[A-Za-z][A-Za-z0-9_-]{1,31}/)?.[0];
  return latin && !containsPromptLikeDisplayText(latin) ? latin : undefined;
}

function bboxArrayToObject(value: unknown): BBoxNormObject | undefined {
  if (Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    const [x, y, w, h] = value;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0.01, 1), h: clamp(h, 0.01, 1) };
  }
  if (isRecord(value)) {
    const x = typeof value.x === "number" ? value.x : undefined;
    const y = typeof value.y === "number" ? value.y : undefined;
    const w = typeof value.w === "number" ? value.w : undefined;
    const h = typeof value.h === "number" ? value.h : undefined;
    if ([x, y, w, h].every((item) => typeof item === "number" && Number.isFinite(item))) {
      return { x: clamp(x as number, 0, 1), y: clamp(y as number, 0, 1), w: clamp(w as number, 0.01, 1), h: clamp(h as number, 0.01, 1) };
    }
  }
  return undefined;
}

function fallbackTextBBox(layout: string | undefined, role: RenderRecipeClip["role"]): BBoxNormObject {
  if (role === "cta") return { x: 0.08, y: 0.72, w: 0.84, h: 0.13 };
  if (layout === "lower_third") return { x: 0.08, y: 0.72, w: 0.84, h: 0.13 };
  if (layout === "top_tag") return { x: 0.12, y: 0.1, w: 0.76, h: 0.11 };
  if (layout === "diagonal_tag") return { x: 0.12, y: 0.22, w: 0.76, h: 0.12 };
  if (layout === "keyword_scatter") return { x: 0.14, y: 0.32, w: 0.72, h: 0.18 };
  return { x: 0.1, y: 0.4, w: 0.8, h: 0.16 };
}

function colorRoleForV41(role: string | undefined): RenderRecipeTextLayer["typography"]["colorRole"] {
  if (role === "yellow" || role === "amber" || role === "orange") return "accent";
  if (role === "white") return "on_dark";
  if (role === "muted") return "muted";
  return "primary";
}

function animationForV41(hint: string | undefined): RenderRecipeTextLayer["animation"]["enter"] {
  if (hint === "pop" || hint === "scale" || hint === "sweep" || hint === "typewriter") return hint;
  if (hint === "per_char_reveal") return "typewriter";
  if (hint === "shake" || hint === "flash") return "pop";
  return "none";
}

function provenanceForMaterial(material: RenderRecipeClip["material"]): RenderRecipeMediaLayer["material"]["provenance"] {
  if (material.kind === "source_video") return "source_video";
  if (material.kind === "generated_target_asset") return "aigc_generated";
  if (material.assetIds.some((id) => /^fan_|^aigc_|generated/i.test(id))) return "aigc_generated";
  return "user_uploaded";
}

function mediaKindForV41(kind: RenderRecipeClip["material"]["kind"]): RenderRecipeMediaLayer["material"]["kind"] {
  if (kind === "none") return "procedural";
  return kind;
}

function fitForPrimitive(primitive: RenderRecipeClip["selectedPrimitive"]): RenderRecipeMediaLayer["layout"]["fit"] {
  if (primitive === "FanHeroSpin" || primitive === "ProductHeroOrbit" || primitive === "ProductPosterHero" || primitive === "ObjectTrackReveal" || primitive === "CTAEndSlate") return "contain";
  if (primitive === "FeatureCardStack" || primitive === "MediaCardCascade" || primitive === "SplitScreenCompare") return "cardInset";
  return "cover";
}

function evidenceRefsForClip(recipe: RenderRecipe, clip: RenderRecipeClip): string[] {
  if (clip.evidenceRefs?.length) return clip.evidenceRefs;
  const sample = recipe.evidenceSummary?.sourceSampleIds?.[0] ?? "sample";
  if (clip.material.sourceShotIds?.length) return clip.material.sourceShotIds.map((id) => `evidence://${sample}/shot/${id}`);
  return [`evidence://${sample}/clip/${clip.clipId}`];
}

function textRoleForClip(clip: RenderRecipeClip): RenderRecipeTextLayer["text"]["role"] {
  if (clip.role === "cta" || clip.selectedPrimitive === "CTAEndSlate") return "cta";
  if (clip.role === "hook") return "headline";
  if (clip.role === "proof") return "selling_point";
  return "subtitle";
}

function audioKindFromKey(key: string): RenderRecipeAudioLayer["audio"]["kind"] {
  if (/kick/.test(key)) return "kick";
  if (/bass/.test(key)) return "bass";
  if (/hat|air/.test(key)) return "hat";
  if (/riser/.test(key)) return "riser";
  if (/impact/.test(key)) return "impact";
  if (/music|drone|harmonic/.test(key)) return "drone";
  return "music";
}

function motionAtomLayer(atom: MotionAtomSpec, index: number, durationSec: number): RenderRecipeMotionAtomLayer {
  const direction = atom.axis === "screen_y" ? "right_to_left" : "left_to_right";
  const path = atom.pathFamily === "horizontal_wave" ? "horizontal_wave" : atom.pathFamily === "vertical_helix" ? "s_curve_orbit" : "diagonal_sweep";
  return {
    id: `layer_motion_atom_${index + 1}`,
    type: "motion_atom",
    zIndex: 30,
    startSec: atom.startSec ?? 0,
    durationSec: Math.max(0.1, (atom.endSec ?? durationSec) - (atom.startSec ?? 0)),
    atom: {
      kind: "parametric_ribbon_surface",
      direction,
      path,
      thicknessRatio: clamp((atom.bandWidth ?? 82) / 720, 0.02, 0.28),
      twist: clamp(atom.twistIntensity ?? 0.5, 0, 1),
      opacity: clamp(atom.opacity ?? 0.62, 0, 1),
      colorRoles: atom.gradientStops?.length ? atom.gradientStops : atom.colorProgression
    },
    fallback: { renderer: "ffmpeg", mode: "simple_overlay", reason: "FFmpeg uses 2D ribbon overlay fallback for parametric_ribbon_surface." },
    evidenceRefs: atom.evidenceFrames?.length
      ? atom.evidenceFrames.map((t) => `evidence://sample/motion/ribbon@${t}`)
      : ["evidence://sample/motion/parametric_ribbon_surface"]
  };
}

export interface RenderRecipeV41MigrationOptions {
  motionAtoms?: MotionAtomSpec[];
  evidenceSummary?: RenderRecipe["evidenceSummary"];
  rawPrompt?: string;
}

export function migrateRenderRecipeToV4_1(input: RenderRecipe, options: RenderRecipeV41MigrationOptions = {}): RenderRecipe {
  const durationSec = input.global.durationSec;
  const motionAtoms = options.motionAtoms ?? input.motionAtoms ?? [];
  const layers: RenderRecipeLayer[] = [];
  const migratedClips: RenderRecipeClip[] = input.clips.map((clip) => {
    const layerIds: string[] = [];
    const evidenceRefs = evidenceRefsForClip(input, clip);
    const duration = Math.max(0.1, clip.durationSec ?? clip.endSec - clip.startSec);

    if (clip.material.kind !== "none" && clip.material.kind !== "procedural" && clip.material.assetIds.length) {
      const id = `layer_${clip.clipId}_media`;
      const mediaBBox = clip.layout.mediaBBoxNorm ?? clip.layout.bboxNorm;
      layerIds.push(id);
      layers.push({
        id,
        type: "media",
        clipId: clip.clipId,
        zIndex: 10,
        startSec: clip.startSec,
        durationSec: duration,
        material: {
          kind: mediaKindForV41(clip.material.kind),
          assetIds: clip.material.assetIds,
          ...(clip.material.sourceShotIds?.length ? { sourceShotIds: clip.material.sourceShotIds } : {}),
          policy: clip.material.policy,
          provenance: clip.material.provenance ?? provenanceForMaterial(clip.material)
        },
        layout: {
          ...(mediaBBox ? { bboxNorm: mediaBBox } : {}),
          fit: fitForPrimitive(clip.selectedPrimitive),
          ...(clip.selectedPrimitive === "ProductPosterHero" || clip.selectedPrimitive === "ObjectTrackReveal" ? { minAreaRatio: 0.18 } : {}),
          safeArea: clip.role === "cta" ? "cta" : clip.role === "hook" ? "title" : "body"
        },
        motion: {
          pattern: clip.motion.pattern === "zoom_pulse" ? "zoom" : clip.motion.pattern === "shake" || clip.motion.pattern === "none" ? "static" : clip.motion.pattern,
          beatAligned: clip.motion.beatAligned,
          beatTimestampsSec: clip.motion.beatTimestampsSec
        },
        evidenceRefs
      } satisfies RenderRecipeMediaLayer);
    }

    if (clip.text.copy.trim()) {
      const id = `layer_${clip.clipId}_text`;
      const bbox = clip.layout.bboxNorm ?? fallbackTextBBox(clip.layout.typographyLayout, clip.role);
      layerIds.push(id);
      layers.push({
        id,
        type: "text",
        clipId: clip.clipId,
        zIndex: 40,
        startSec: clip.startSec,
        durationSec: duration,
        text: { content: clip.text.copy, role: textRoleForClip(clip), maxChars: 48 },
        layout: { bboxNorm: bbox, align: "center", anchor: "center" },
        typography: {
          fontSizeRatio: clamp(clip.text.fontSizeRatio ?? Math.min(0.12, Math.max(0.045, bbox.h * 0.72)), 0.025, 0.16),
          weight: 900,
          colorRole: colorRoleForV41(clip.text.colorRoles[0]),
          color: clip.text.colorRoles.includes("yellow") ? "#f5c518" : clip.text.colorRoles.includes("white") ? "#f5f5f5" : "#e11d2a",
          shadow: { color: "rgba(0,0,0,0.75)", blurRatio: 0.012, dxRatio: 0.004, dyRatio: 0.004 }
        },
        animation: {
          enter: animationForV41(clip.text.animationHint),
          exit: "none",
          ...(clip.motion.beatTimestampsSec.length
            ? { beatReactive: { property: "scale", amplitude: 0.06, beatRefs: clip.motion.beatTimestampsSec.slice(0, 12) } }
            : {})
        },
        evidenceRefs
      } satisfies RenderRecipeTextLayer);
    }

    return {
      ...clip,
      id: clip.id ?? clip.clipId,
      durationSec: duration,
      atomIds: clip.atomIds ?? [],
      layerIds: clip.layerIds ?? layerIds,
      evidenceRefs
    };
  });

  motionAtoms.forEach((atom, index) => {
    layers.push(motionAtomLayer(atom, index, durationSec));
  });

  const audioLayers = input.global.audioPlan.layers;
  Object.entries(audioLayers).forEach(([key, weight], index) => {
    if (typeof weight !== "number" || !Number.isFinite(weight)) return;
    const accentPattern = input.global.beatGridSec?.slice(0, 32);
    const densityCurve = accentPattern?.length
      ? accentPattern.slice(0, 12).map((beat) => ({ t: beat, value: clamp(weight, 0, 1) }))
      : undefined;
    layers.push({
      id: `layer_audio_${key}`,
      type: "audio",
      zIndex: -10 - index,
      startSec: 0,
      durationSec,
      audio: {
        kind: audioKindFromKey(key),
        policy: input.global.audioPlan.policy === "silent" ? "missing" : "procedural",
        weight: clamp(weight, 0, 1),
        bpm: input.global.bpm,
        accentPattern,
        ...(densityCurve?.length ? { densityCurve } : {})
      },
      evidenceRefs: [`evidence://sample/audio/${key}`]
    } satisfies RenderRecipeAudioLayer);
  });

  const safeProductName = sanitizeDisplayText(input.productTheme.productName ?? input.productTheme.name, "Product");
  const safeCta = sanitizeDisplayText(input.productTheme.ctaText ?? input.productTheme.cta, "Click to learn more", 18);
  const brandName = input.productTheme.brandName && !containsPromptLikeDisplayText(input.productTheme.brandName)
    ? sanitizeDisplayText(input.productTheme.brandName, safeProductName, 18)
    : extractBrandName(safeProductName);
  const preserved = options.evidenceSummary?.preservedEvidence ?? input.evidenceSummary?.preservedEvidence ?? {
    visualElements: 0,
    typographyRuns: layers.filter((layer) => layer.type === "text").length,
    motionAtoms: motionAtoms.length,
    audioLayers: layers.filter((layer) => layer.type === "audio").length
  };
  const droppedEvidence = options.evidenceSummary?.droppedEvidence ?? input.evidenceSummary?.droppedEvidence ?? [];

  return {
    ...input,
    schemaVersion: "render-recipe-v1",
    version: "render-recipe-v4.1",
    composition: {
      width: input.global.width,
      height: input.global.height,
      fps: input.global.fps,
      durationSec,
      aspectRatio: input.global.aspectRatio
    },
    productTheme: {
      ...input.productTheme,
      name: safeProductName,
      productName: safeProductName,
      ...(brandName ? { brandName } : {}),
      cta: safeCta,
      ctaText: safeCta,
      ...(input.productTheme.brief ? { brief: input.productTheme.brief } : {}),
      ...(input.productTheme.generationPrompt ?? input.productTheme.rawPrompt ?? options.rawPrompt
        ? { generationPrompt: input.productTheme.generationPrompt ?? input.productTheme.rawPrompt ?? options.rawPrompt }
        : {})
    },
    evidenceSummary: {
      sourceSampleIds: options.evidenceSummary?.sourceSampleIds ?? input.evidenceSummary?.sourceSampleIds ?? [],
      preservedEvidence: preserved,
      droppedEvidence
    },
    clips: migratedClips,
    layers,
    motionAtoms
  };
}

export function findRenderRecipeSafetyIssues(recipe: RenderRecipe): string[] {
  const issues: string[] = [];
  if (recipe.sourcePolicy.sampleFrameCopyAllowed !== false) issues.push("sampleFrameCopyAllowed must be false");
  if (recipe.sourcePolicy.sampleAudioCopyAllowed !== false) issues.push("sampleAudioCopyAllowed must be false");
  const sampleIds = new Set(recipe.evidenceSummary?.sourceSampleIds ?? []);
  const mediaIds = [
    ...recipe.clips.flatMap((clip) => clip.material.policy === "renderable" ? clip.material.assetIds : []),
    ...((recipe.layers ?? []).flatMap((layer) =>
      layer.type === "media" && layer.material.policy === "renderable" ? layer.material.assetIds : []
    ))
  ];
  for (const id of mediaIds) {
    if (sampleIds.has(id)) issues.push(`renderable material references sample evidence asset ${id}`);
  }
  for (const layer of recipe.layers ?? []) {
    if (layer.type === "media" && layer.material.policy === "renderable" && !layer.material.provenance) {
      issues.push(`media layer ${layer.id} is missing provenance`);
    }
  }
  const displayFields = [
    recipe.productTheme.name,
    recipe.productTheme.productName,
    recipe.productTheme.brandName,
    recipe.productTheme.cta,
    recipe.productTheme.ctaText
  ];
  if (displayFields.some((field) => containsPromptLikeDisplayText(field))) {
    issues.push("display productTheme fields contain raw prompt-like content");
  }
  return issues;
}
