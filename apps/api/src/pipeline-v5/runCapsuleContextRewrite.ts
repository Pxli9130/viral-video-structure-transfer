// pipeline-v5/runCapsuleContextRewrite.ts
// Context-modification stage. Takes a learned RemotionTemplateCapsule (the faithful reconstruction — its
// code is canonical) + a new theme/copy, and asks a Pro model to rewrite ONLY the on-screen text + colour
// content for the new campaign while keeping the exact structure / layout / motion / 3D / timing. This is
// how "same template, new theme" actually changes what you see (the reconstruction hardcodes the source's
// words; prop-binding alone can't change baked text). Code-only transform; gated on compile + render.

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";

export interface ContextRewriteResult {
  codeBundle: v5.RemotionTemplateCapsule["codeBundle"];
  usedAi: boolean;
  warnings: string[];
}

export function buildContextRewritePrompt(code: string, theme: string, sellingPoints: string[], repairErrors?: string[]): string {
  const points = sellingPoints.filter(Boolean);
  const repair = repairErrors?.length ? `\n\nYour previous output did not compile/render. Fix exactly:\n- ${repairErrors.slice(0, 6).join("\n- ")}` : "";
  return `You are given a complete Remotion v4 component that renders one specific ad video. Rewrite it for a
NEW campaign.

NEW THEME: ${theme || "(general product)"}
NEW KEY POINTS / COPY (use these, rephrased into punchy on-screen ad copy in the theme's language):
${points.length ? points.map((p) => `- ${p}`).join("\n") : "- (invent concise on-brand copy for the theme)"}

Rewrite RULES:
- Replace EVERY readable on-screen word (headlines, captions, CTAs, kinetic text, canvas fillText/strokeText,
  3D text, SVG <text>) with NEW copy that fits the new theme + key points. Nothing from the original ad's
  wording may remain.
- You MAY shift the colour palette / accent colours toward the new theme's mood.
- KEEP EVERYTHING ELSE IDENTICAL: component structure, layout, every Sequence, all animation/motion/3D,
  transitions, timing, image/video layers, fonts behaviour. Only CONTENT (words + colours) changes.
- Keep the exact export: export const TemplateFromSample = ({ assets = {}, copy = {}, audio = {}, theme = "", palette = PALETTE }) => ...
- Do NOT add any platform watermark / handle / follow-card. Do NOT use forbidden tokens (require/process/
  fs/eval/fetch/XMLHttpRequest/dynamic import) or remote http(s) URLs.

Return ONLY valid JSON (no markdown): { "componentName": "TemplateFromSample", "indexTsx": "<full TSX as a JSON string>" }

COMPONENT TO REWRITE:
\`\`\`tsx
${code.slice(0, 16000)}
\`\`\`${repair}`;
}

function extractJson(raw: string): { componentName?: string; indexTsx?: string } | null {
  try {
    const fenced = raw.match(/```(?:json|tsx?)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const s = body.indexOf("{");
    const e = body.lastIndexOf("}");
    if (s < 0 || e <= s) return null;
    return JSON.parse(body.slice(s, e + 1));
  } catch {
    return null;
  }
}

export async function runCapsuleContextRewrite(input: {
  capsule: v5.RemotionTemplateCapsule;
  theme: string;
  sellingPoints: string[];
  model: Gen1ModelFn;
  renderProbe: (codeBundle: v5.RemotionTemplateCapsule["codeBundle"], neutralFixture: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  maxAttempts?: number;
}): Promise<ContextRewriteResult> {
  const warnings: string[] = [];
  const original = input.capsule.codeBundle;
  const entry = original.files.find((f) => f.path === original.entryFile)?.content ?? original.files[0]?.content ?? "";
  if (!entry) return { codeBundle: original, usedAi: false, warnings: ["no entry code to rewrite"] };
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let raw: string;
    try {
      raw = await input.model(buildContextRewritePrompt(entry, input.theme, input.sellingPoints, attempt > 0 ? lastErrors : undefined));
    } catch (err) {
      warnings.push(`context rewrite model error: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
      break;
    }
    const obj = extractJson(raw);
    if (!obj?.indexTsx) {
      lastErrors = ["output was not valid JSON {componentName, indexTsx}"];
      continue;
    }
    const candidate: v5.RemotionTemplateCapsule["codeBundle"] = {
      files: [{ path: original.entryFile, content: obj.indexTsx }],
      entryFile: original.entryFile,
      componentName: original.componentName
    };
    // Gate: compile (syntax) + render (the only "won't run" checks; no no-copy gate).
    const v = validateTemplateCapsule({ ...input.capsule, codeBundle: candidate });
    if (v.gates.find((g) => g.id === "T2")?.status !== "pass") {
      lastErrors = v.gates.filter((g) => g.id === "T2" && g.status === "fail").map((g) => g.message);
      if (!lastErrors.length) lastErrors = ["did not compile"];
      warnings.push(`context rewrite attempt ${attempt + 1}: compile error -> repair`);
      continue;
    }
    let probe: { ok: boolean; error?: string };
    try {
      probe = await input.renderProbe(candidate, (input.capsule.fixtures?.neutralFixture ?? {}) as Record<string, unknown>);
    } catch (err) {
      probe = { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
    }
    if (!probe.ok) {
      lastErrors = [`render failed: ${probe.error ?? "unknown"}`];
      warnings.push(`context rewrite attempt ${attempt + 1}: render error -> repair`);
      continue;
    }
    warnings.push("context rewrite applied (new theme/copy; structure kept).");
    return { codeBundle: candidate, usedAi: true, warnings };
  }
  warnings.push("context rewrite failed; using the original (un-rethemed) capsule code.");
  return { codeBundle: original, usedAi: false, warnings };
}
