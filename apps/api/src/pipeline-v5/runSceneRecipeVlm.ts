// pipeline-v5/runSceneRecipeVlm.ts
// Optional richer per-scene perception: a VLM (Gemini vision) looks at each section's source keyframe
// and returns a CONTENT-NEUTRAL structural description (composition, layout zones, motion-graphics
// elements, typography style, treatment) so the codegen can reconstruct the ACTUAL look — not a generic
// card. It NEVER returns readable text / brand / subject identity (prompt-forbidden + re-gated in code).
// Gated by ALLOW_EXTERNAL_VLM_SAMPLE_ANALYSIS (sample frames go to the provider for STRUCTURE only).

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI, createUserContent } from "@google/genai";
import { v5 } from "@vvst/shared";
import type { SceneSectionMeta } from "./deriveSceneRecipes.js";

export type VisionFn = (imageBase64: string, mimeType: string, prompt: string) => Promise<string>;

export function createGeminiVisionFn(opts: { apiKey?: string; model?: string; timeoutMs?: number } = {}): VisionFn | undefined {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  const client = new GoogleGenAI({ apiKey });
  const model = opts.model ?? process.env.VLM_MODEL ?? process.env.AI_GEMINI_MODEL ?? "gemini-flash-latest";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return async (imageBase64, mimeType, prompt) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await client.models.generateContent({
        model,
        contents: createUserContent([{ inlineData: { data: imageBase64, mimeType } }, prompt]),
        config: { temperature: 0.2, responseMimeType: "application/json", abortSignal: controller.signal }
      });
      return response.text ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}

const PROMPT = `You are analyzing ONE still frame from a section of a short vertical (9:16) ad video, to reconstruct its
VISUAL STRUCTURE as reusable template code — NOT its content. Return STRICT JSON only, no prose.
Describe ONLY structure. Do NOT transcribe, paraphrase, or quote any readable text, brand name, or logo
wording, and do NOT name people/products. Your output must contain no words copied from on-screen text.

JSON shape:
{
 "composition": "<=160 chars on where the main subject/zones sit, framing, balance, negative space",
 "layoutZones": ["e.g. full-bleed background image","bold headline lower third","small caption top-left","logo top-right","product centered with reflection"],
 "graphicElements": ["content-neutral motion-graphics present: thin animated underline / circular ring / split-screen halves / diagonal color block / stat chip / gradient sweep / outline frame / sticker badge / progress bar / none"],
 "typography": {"position":"top|center|lower_third|bottom|top_left|top_right|bottom_left|bottom_right","sizeClass":"xl|l|m|s","weight":"black|bold|regular","case":"upper|title|normal","alignment":"left|center|right","animation":"per_char_reveal|word_stagger|pop|slide_up|none"},
 "treatment": "color grade + overlays, e.g. dark high-contrast with vignette / clean bright minimal / neon glow on black / warm film grain",
 "mood":"dark_moody|high_key|high_contrast|vibrant|desaturated|warm|cool|neutral",
 "cameraMove":"static|push_in|pull_out|pan_left|pan_right|tilt_up|tilt_down",
 "subjectAnchor":"top_left|top_center|top_right|center_left|center|center_right|bottom_left|bottom_center|bottom_right"
}`;

const ANCHORS = new Set(["top_left", "top_center", "top_right", "center_left", "center", "center_right", "bottom_left", "bottom_center", "bottom_right"]);
const MOODS = new Set(["dark_moody", "high_key", "high_contrast", "vibrant", "desaturated", "warm", "cool", "neutral"]);
const CAMS = new Set(["static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down"]);
const ANIMS = new Set(["per_char_reveal", "word_stagger", "pop", "slide_up", "flash", "scale", "none"]);

function posToAnchor(pos?: string): v5.AnchorV5 | undefined {
  if (!pos) return undefined;
  const p = pos.toLowerCase();
  if (ANCHORS.has(p)) return p as v5.AnchorV5;
  if (p.includes("lower") || p === "bottom") return "bottom_center";
  if (p === "top") return "top_center";
  if (p === "center" || p === "middle") return "center";
  return undefined;
}

function strArr(v: unknown, n: number): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length < 80).slice(0, n) as string[] : [];
}

/** Enrich the cv2 base recipes with VLM structural detail. Per-scene failure keeps the base recipe. */
export async function runSceneRecipeVlm(opts: {
  evidence: v5.EvidenceTimelineV5;
  sections: SceneSectionMeta[];
  base: v5.SceneVisualRecipeV5[];
  storageRoot: string;
  vision: VisionFn;
  maxScenes?: number;
}): Promise<v5.SceneVisualRecipeV5[]> {
  const { evidence, sections, base, storageRoot, vision } = opts;
  const keyFrames = (evidence.keyFrames ?? []).map((k) => ({ timeSec: k.timeSec, frameRef: (k as { frameRef?: string }).frameRef })).filter((k) => k.frameRef);
  const maxScenes = opts.maxScenes ?? 8;
  const byId = new Map(base.map((r) => [r.sectionId, r]));

  let done = 0;
  for (const sec of sections) {
    const rec = byId.get(sec.id);
    if (!rec || done >= maxScenes) continue;
    const mid = (sec.startSec + sec.endSec) / 2;
    const kf = keyFrames.filter((k) => k.timeSec >= sec.startSec && k.timeSec < sec.endSec).sort((a, b) => Math.abs(a.timeSec - mid) - Math.abs(b.timeSec - mid))[0]
      ?? keyFrames.sort((a, b) => Math.abs(a.timeSec - mid) - Math.abs(b.timeSec - mid))[0];
    if (!kf?.frameRef) continue;
    const fp = path.join(storageRoot, String(kf.frameRef).replace(/^\//, ""));
    if (!existsSync(fp)) continue;
    try {
      const b64 = (await fs.readFile(fp)).toString("base64");
      const raw = await vision(b64, "image/png", PROMPT);
      const j = parseJson(raw) as Record<string, unknown>;
      if (!j) continue;
      const typo = (j.typography ?? {}) as Record<string, unknown>;
      rec.vlm = {
        composition: typeof j.composition === "string" ? j.composition.slice(0, 200) : "",
        layoutZones: strArr(j.layoutZones, 6),
        graphicElements: strArr(j.graphicElements, 6),
        typography: {
          position: typeof typo.position === "string" ? typo.position : undefined,
          sizeClass: typeof typo.sizeClass === "string" ? typo.sizeClass : undefined,
          weight: typeof typo.weight === "string" ? typo.weight : undefined,
          case: typeof typo.case === "string" ? typo.case : undefined,
          alignment: typeof typo.alignment === "string" ? typo.alignment : undefined,
          animation: typeof typo.animation === "string" ? typo.animation : undefined
        },
        treatment: typeof j.treatment === "string" ? j.treatment.slice(0, 120) : ""
      };
      // Let the VLM override coarse cv2 labels when it is confident (it sees more than pixel stats).
      if (typeof j.mood === "string" && MOODS.has(j.mood)) rec.grading.mood = j.mood as v5.GradingMoodV5;
      if (typeof j.cameraMove === "string" && CAMS.has(j.cameraMove) && rec.subject) rec.subject.cameraMove = j.cameraMove as v5.CameraMoveV5;
      if (typeof j.subjectAnchor === "string" && ANCHORS.has(j.subjectAnchor) && rec.subject) rec.subject.anchor = j.subjectAnchor as v5.AnchorV5;
      const ta = posToAnchor(typo.position as string | undefined);
      if (ta) rec.textAnchor = ta;
      if (typeof typo.animation === "string" && ANIMS.has(typo.animation)) rec.textAnim = typo.animation as v5.TextAnimV5;
      rec.source = "vlm";
      rec.confidence = Math.max(rec.confidence, 0.7);
      done++;
    } catch {
      // keep cv2 base for this scene
    }
  }
  return base;
}

function parseJson(raw: string): unknown {
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s < 0 || e <= s) return null;
    return JSON.parse(body.slice(s, e + 1));
  } catch {
    return null;
  }
}
