// pipeline-v5/runCapsuleContextRewrite.ts
// Context-modification stage. Takes a learned RemotionTemplateCapsule (the faithful reconstruction — its
// code is canonical) + a new theme/copy, and asks a Pro model to rewrite ONLY the on-screen text + colour
// content for the new campaign while keeping the exact structure / layout / motion / 3D / timing. This is
// how "same template, new theme" actually changes what you see (the reconstruction hardcodes the source's
// words; prop-binding alone can't change baked text). Code-only transform; gated on compile + render.

import { v5 } from "@vvst/shared";
import type { Gen1ModelFn } from "./runGen1Ai.js";
import { validateTemplateCapsule } from "./validateTemplateCapsule.js";
import { mapLimit } from "./concurrency.js";

export interface ContextRewriteResult {
  codeBundle: v5.RemotionTemplateCapsule["codeBundle"];
  usedAi: boolean;
  warnings: string[];
}

export function buildContextRewritePrompt(code: string, theme: string, sellingPoints: string[], repairErrors?: string[], extraDirective?: string): string {
  const points = sellingPoints.filter(Boolean);
  const repair = repairErrors?.length ? `\n\nYour previous output did not compile/render. Fix exactly:\n- ${repairErrors.slice(0, 6).join("\n- ")}` : "";
  const extra = extraDirective ? `\n\nIMPORTANT EXTRA DIRECTIVE (must satisfy this):\n${extraDirective}` : "";
  return `You are given a complete Remotion v4 component that renders one specific ad video. Rewrite it for a
NEW campaign.

NEW THEME: ${theme || "(general product)"}
NEW KEY POINTS / COPY (use these, rephrased into punchy on-screen ad copy in the theme's language):
${points.length ? points.map((p) => `- ${p}`).join("\n") : "- (invent concise on-brand copy for the theme)"}

Rewrite RULES:
- Replace EVERY readable on-screen word (headlines, captions, CTAs, kinetic text, canvas fillText/strokeText,
  3D text, SVG <text>) with NEW copy that fits the new theme + key points. Nothing from the original ad's
  wording may remain.
- You MAY shift ACCENT colours toward the new theme's mood, BUT you MUST PRESERVE THE SOURCE'S OVERALL
  BACKGROUND LIGHTNESS: if the original code renders on a LIGHT / white / high-key background, keep it
  light; if it renders dark, keep it dark. Do NOT flip a light background to dark (or dark to light).
  Only swap accent/text colours — never invert the base background tone.
- KEEP EVERYTHING ELSE IDENTICAL: component structure, layout, every Sequence, all animation/motion/3D,
  transitions, timing, image/video layers, fonts behaviour. Only CONTENT (words + colours) changes.
- Keep the EXACT SAME exported component name and signature as the original file (do NOT rename the export,
  do NOT add or remove exports — this file may be imported by a parent that renders it).
- Do NOT add any platform watermark / handle / follow-card. Do NOT use forbidden tokens (require/process/
  fs/eval/fetch/XMLHttpRequest/dynamic import) or remote http(s) URLs.

Return ONLY valid JSON (no markdown): { "componentName": "TemplateFromSample", "indexTsx": "<full TSX as a JSON string>" }

COMPONENT TO REWRITE:
\`\`\`tsx
${code.slice(0, 16000)}
\`\`\`${repair}${extra}`;
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
  /** Extra hard requirement injected into the prompt (e.g. a colour-fidelity correction). */
  extraDirective?: string;
}): Promise<ContextRewriteResult> {
  const warnings: string[] = [];
  const original = input.capsule.codeBundle;
  // Files whose on-screen text we re-theme: for a stitched multi-file (chunked) capsule the text lives in
  // the chunk modules, NOT the structural parent entry; for a single-file capsule it's the entry itself.
  const isMulti = original.files.length > 1;
  const targets = (isMulti ? original.files.filter((f) => f.path !== original.entryFile) : original.files.filter((f) => f.path === original.entryFile))
    .filter((f) => typeof f.content === "string" && f.content.length);
  if (!targets.length) return { codeBundle: original, usedAi: false, warnings: ["no text-bearing code to rewrite"] };
  const fixture = (input.capsule.fixtures?.neutralFixture ?? {}) as Record<string, unknown>;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Rewrite every target file CONCURRENTLY (one model call each — "send it to gemini multiple times" per chunk).
    const fileResults = await mapLimit(targets, Number(process.env.REWRITE_CONCURRENCY ?? 4), async (f) => {
      try {
        const raw = await input.model(buildContextRewritePrompt(f.content, input.theme, input.sellingPoints, attempt > 0 ? lastErrors : undefined, input.extraDirective));
        const obj = extractJson(raw);
        if (!obj?.indexTsx) return { path: f.path, content: null as string | null, error: `output for ${f.path} was not valid JSON {componentName, indexTsx}` };
        return { path: f.path, content: obj.indexTsx as string | null, error: null as string | null };
      } catch (err) {
        return { path: f.path, content: null as string | null, error: `context rewrite model error (${f.path}): ${err instanceof Error ? err.message.slice(0, 100) : String(err)}` };
      }
    });
    const failed = fileResults.filter((r) => !r.content);
    if (failed.length) {
      for (const fr of failed) warnings.push(fr.error ?? `rewrite failed (${fr.path})`);
      lastErrors = failed.map((fr) => fr.error ?? `rewrite failed (${fr.path})`).slice(0, 4);
      continue;
    }
    const rewritten = new Map<string, string>();
    for (const r of fileResults) rewritten.set(r.path, r.content as string);
    // Assemble the FULL bundle (parent + rewritten chunks) and gate it once: compile + render.
    const candidate: v5.RemotionTemplateCapsule["codeBundle"] = {
      files: original.files.map((f) => (rewritten.has(f.path) ? { ...f, content: rewritten.get(f.path) as string } : f)),
      entryFile: original.entryFile,
      componentName: original.componentName
    };
    const v = validateTemplateCapsule({ ...input.capsule, codeBundle: candidate });
    if (v.gates.find((g) => g.id === "T2")?.status !== "pass") {
      lastErrors = v.gates.filter((g) => g.id === "T2" && g.status === "fail").map((g) => g.message);
      if (!lastErrors.length) lastErrors = ["did not compile"];
      warnings.push(`context rewrite attempt ${attempt + 1}: compile error -> repair`);
      continue;
    }
    let probe: { ok: boolean; error?: string };
    try {
      probe = await input.renderProbe(candidate, fixture);
    } catch (err) {
      probe = { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
    }
    if (!probe.ok) {
      lastErrors = [`render failed: ${probe.error ?? "unknown"}`];
      warnings.push(`context rewrite attempt ${attempt + 1}: render error -> repair`);
      continue;
    }
    warnings.push(`context rewrite applied (new theme/copy; structure kept; ${rewritten.size} file(s)).`);
    return { codeBundle: candidate, usedAi: true, warnings };
  }
  warnings.push("context rewrite failed; using the original (un-rethemed) capsule code.");
  return { codeBundle: original, usedAi: false, warnings };
}
