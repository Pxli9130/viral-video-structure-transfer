// pipeline-v5/capsuleRenderSafety.ts
// Two safety nets for rendering an AI-generated capsule:
//   A) repairInterpolateRanges — Gemini frequently emits `interpolate(x, [0,10], [1,1.3,1])` where the input and
//      output ranges have DIFFERENT lengths. Remotion throws "inputRange (N) and outputRange (M) must have the
//      same length" and the WHOLE render dies. This deterministically pads the shorter NUMERIC-LITERAL range so
//      the intended curve renders (e.g. input [0,10] -> [0,5,10] for a 3-point output). Conservative: only
//      touches calls where BOTH ranges are plain numeric array literals of unequal length.
//   B) buildFallbackCapsule — when a capsule's own code still fails to render, swap its code for a deterministic
//      SAFE template that consumes the SAME bound props (palette + per-section media via the timed track +
//      captions) so the generation always yields a real video instead of a silent "render failed" warning.
import { v5 } from "@vvst/shared";
import { ensureTimedMediaLayers } from "./injectMediaBaseLayer.js";
import type { Gen1ModelFn } from "./runGen1Ai.js";

function stripFences(s: string): string {
  return s.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "").trim();
}

/**
 * PRIMARY render-failure auto-fix: hand the failing component + the render error to a text model (Doubao) and
 * ask it to fix ONLY the cause, preserving the rest of the Gemini-authored creative code. Returns an updated
 * capsule or null (model unavailable / no usable change). This keeps the AI reconstruction (the system's core)
 * intact instead of letting a rigid lint rewrite it.
 */
export async function repairCapsuleCodeWithLlm(
  capsule: v5.RemotionTemplateCapsule,
  error: string,
  model: Gen1ModelFn,
): Promise<v5.RemotionTemplateCapsule | null> {
  const comp = capsule.codeBundle.componentName;
  const file =
    capsule.codeBundle.files.find((f) => /(^|\/)index\.tsx$/.test(f.path)) ??
    capsule.codeBundle.files.find((f) => /\.tsx$/.test(f.path)) ??
    capsule.codeBundle.files[0];
  if (!file || typeof file.content !== "string") return null;
  const prompt = [
    `You are fixing a Remotion (React + TypeScript) video component that FAILED TO RENDER.`,
    `Render error: ${error || "unknown render error"}`,
    `Rules:`,
    `- Fix ONLY what causes this error. Preserve ALL other code exactly: visual structure, animation, layout, on-screen text, palette/props usage, imports, and the exported component "${comp}".`,
    `- Frequent cause: Remotion's interpolate(value, inputRange, outputRange) REQUIRES inputRange.length === outputRange.length; if they differ, make them equal length while keeping the intended easing curve.`,
    `- Keep it a single self-contained file with the SAME exported component name and the same props.`,
    `- Return the COMPLETE corrected file content ONLY. No explanation. No markdown code fences.`,
    ``,
    `FILE (${file.path}):`,
    file.content,
  ].join("\n");
  let raw: string;
  try { raw = await model(prompt); } catch { return null; }
  const fixed = stripFences(raw);
  // Sanity: still the same component, still a module, and an actual change (don't loop on a no-op).
  if (!fixed || fixed.length < 80 || !fixed.includes(comp) || !/export\s+(const|function)\s/.test(fixed)) return null;
  if (fixed.trim() === file.content.trim()) return null;
  const files = capsule.codeBundle.files.map((f) => (f === file ? { ...f, content: fixed } : f));
  return { ...capsule, codeBundle: { ...capsule.codeBundle, files } };
}

/** Index of the ')' that closes the '(' at openIdx, skipping nested brackets and string/template literals. */
function matchParen(s: string, openIdx: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0 && c === ")") return i; }
  }
  return -1;
}

/** Split a function-arg string into top-level args (commas at bracket-depth 0, respecting strings). */
function splitTopLevel(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) { if (c === "\\") { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { args.push(inner.slice(start, i)); start = i + 1; }
  }
  args.push(inner.slice(start));
  return args;
}

/** Parse a trimmed string as a plain numeric array literal (e.g. "[0, 10]") -> [0,10], else null. */
function parseNumArray(s: string): number[] | null {
  const t = s.trim();
  if (!/^\[\s*-?\d/.test(t) || !t.endsWith("]")) return null;
  const body = t.slice(1, -1).trim();
  if (!body) return null;
  const parts = body.split(",").map((x) => x.trim());
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^-?\d+(\.\d+)?$/.test(p)) return null; // any non-plain-number -> bail (don't touch expressions)
    nums.push(Number(p));
  }
  return nums.length ? nums : null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const arrLit = (nums: number[]) => `[${nums.map(round3).join(", ")}]`;
/** n evenly-spaced points from a..b inclusive. */
function evenSpaced(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/**
 * Repair `interpolate()` calls whose input/output ranges are numeric literals of unequal length. Returns the
 * (possibly) rewritten code and the number of repairs. Pure/deterministic; no-op when nothing matches.
 */
export function repairInterpolateRanges(code: string): { code: string; repairs: number } {
  let repairs = 0;
  const re = /\binterpolate\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const end = matchParen(code, parenStart);
    if (end < 0) continue;
    const inner = code.slice(parenStart + 1, end);
    const args = splitTopLevel(inner);
    if (args.length < 3) continue;
    const inNums = parseNumArray(args[1]);
    const outNums = parseNumArray(args[2]);
    if (!inNums || !outNums || inNums.length === outNums.length) continue;
    if (outNums.length > inNums.length) {
      // common case: 3-point output curve with a 2-point input range -> expand input to match.
      args[1] = ` ${arrLit(evenSpaced(inNums[0], inNums[inNums.length - 1], outNums.length))}`;
    } else {
      // rarer: more input points than output values -> linearly extend the output range to match.
      args[2] = ` ${arrLit(evenSpaced(outNums[0], outNums[outNums.length - 1], inNums.length))}`;
    }
    repairs++;
    const newInner = args.join(",");
    code = code.slice(0, parenStart + 1) + newInner + code.slice(end);
    re.lastIndex = parenStart + 1 + newInner.length + 1; // resume after the rewritten call
  }
  return { code, repairs };
}

/** Apply repairInterpolateRanges across every file of a capsule's code bundle (mutates a shallow clone). */
export function repairCapsuleCode(capsule: v5.RemotionTemplateCapsule): { capsule: v5.RemotionTemplateCapsule; repairs: number } {
  let repairs = 0;
  const files = capsule.codeBundle.files.map((f) => {
    if (typeof f.content !== "string") return f;
    const r = repairInterpolateRanges(f.content);
    repairs += r.repairs;
    return r.repairs ? { ...f, content: r.code } : f;
  });
  if (!repairs) return { capsule, repairs: 0 };
  return { capsule: { ...capsule, codeBundle: { ...capsule.codeBundle, files } }, repairs };
}

/**
 * De-overlap horizontal text marquees. A scrolling ticker (whiteSpace:'nowrap' + a translateX transform)
 * sitting in a vertically-centered container collides with the headline captions a learned montage capsule
 * stacks in the SAME section — e.g. motion-graphics templates render a feature ticker AND a TextPop headline
 * both at screen-center, so the ticker scrolls straight through the title. Anchoring the ticker to the lower
 * band (top:76%) makes it run UNDER the headline instead of across it. Idempotent; only touches elements that
 * actually look like a horizontal marquee (nowrap + translateX nearby).
 */
export function deOverlapTextMarquees(code: string): { code: string; changed: number } {
  let changed = 0;
  const out = code.replace(/whiteSpace:\s*(['"])nowrap\1/g, (full, _q, offset: number) => {
    const win = code.slice(Math.max(0, offset - 600), Math.min(code.length, offset + 600));
    if (!/translateX\s*\(/.test(win)) return full;          // not a horizontal scroller
    if (win.includes("top: '76%'")) return full;            // already de-overlapped (idempotent)
    changed++;
    return `${full}, top: '76%', bottom: 'auto'`;           // later key wins over any earlier centered top
  });
  return { code: out, changed };
}

/**
 * Stop on-screen captions from PILING UP. A learned capsule's caption component often fades the text IN and then
 * `extrapolateRight: 'clamp'`s the opacity at 1 — so a section that reveals several staggered captions
 * (different `delay`s) at the SAME screen position never clears the earlier ones: they stack into garbled,
 * superimposed text (e.g. "transforms" over "today"). This rewrites such a fade-IN-only opacity into a
 * fade-in → hold → fade-OUT pulse so each caption clears before / as the next arrives. Matches ONLY an
 * `opacity = interpolate(x, [0, N], [0, 1], { extrapolateRight: 'clamp' })` (the telltale never-fades pattern);
 * idempotent (skips an opacity that already fades out).
 */
export function patchAccumulatingCaptions(code: string): { code: string; changed: number } {
  let changed = 0;
  const re = /(\bopacity\s*=\s*interpolate\(\s*)([^,]+?)(\s*,\s*\[\s*0\s*,\s*)(\d+)(\s*\]\s*,\s*\[\s*0\s*,\s*1\s*\]\s*,\s*\{\s*)extrapolateRight:\s*(['"])clamp\6(\s*\}\s*\))/g;
  const out = code.replace(re, (_m, pre, inExpr, midA, n, midB, _q, tail) => {
    changed++;
    // fade in (0→N) → hold (→~48f ≈ 1.6s) → fade out (→60f); clamped both sides so it never re-appears.
    return `${pre}${inExpr}, [0, ${n}, 48, 60], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp'${tail}`;
  });
  return { code: out, changed };
}

/** Apply patchAccumulatingCaptions across every file of a capsule's code bundle (shallow clone on change). */
export function patchCapsuleCaptions(capsule: v5.RemotionTemplateCapsule): { capsule: v5.RemotionTemplateCapsule; changed: number } {
  let changed = 0;
  const files = capsule.codeBundle.files.map((f) => {
    if (typeof f.content !== "string") return f;
    const r = patchAccumulatingCaptions(f.content);
    changed += r.changed;
    return r.changed ? { ...f, content: r.code } : f;
  });
  if (!changed) return { capsule, changed: 0 };
  return { capsule: { ...capsule, codeBundle: { ...capsule.codeBundle, files } }, changed };
}

/** Apply deOverlapTextMarquees across every file of a capsule's code bundle (shallow clone on change). */
export function deOverlapCapsuleMarquees(capsule: v5.RemotionTemplateCapsule): { capsule: v5.RemotionTemplateCapsule; changed: number } {
  let changed = 0;
  const files = capsule.codeBundle.files.map((f) => {
    if (typeof f.content !== "string") return f;
    const r = deOverlapTextMarquees(f.content);
    changed += r.changed;
    return r.changed ? { ...f, content: r.code } : f;
  });
  if (!changed) return { capsule, changed: 0 };
  return { capsule: { ...capsule, codeBundle: { ...capsule.codeBundle, files } }, changed };
}

// ---------------------------------------------------------------------------------------------------
// B) Deterministic SAFE fallback template — guaranteed to compile + render, consumes the same bound props.
// ---------------------------------------------------------------------------------------------------

const SAFE_COMPONENT = "VvstSafeTemplate";
const SAFE_TEMPLATE_TSX = `import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig, interpolate, useCurrentFrame } from 'remotion';

export const ${SAFE_COMPONENT} = ({ assets = {}, copy = {}, palette = ['#0A0A0A', '#FFFFFF', '#F7C948'], theme = '' }) => {
  const bg = palette[0] || '#0A0A0A';
  const fg = palette[1] || '#FFFFFF';
  const accent = palette[2] || '#F7C948';
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const caps = Object.values(copy).filter(Boolean);
  const per = Math.max(1, Math.floor(durationInFrames / Math.max(1, caps.length)));
  const titleOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: 'sans-serif' }}>
      {/* timed media track is injected here as the first child (zIndex 0) */}
      {theme ? (
        <div style={{ position: 'absolute', top: '7%', left: '6%', right: '6%', color: fg, fontSize: 54, fontWeight: 900, opacity: titleOpacity, textShadow: '0 3px 12px rgba(0,0,0,0.6)' }}>{theme}</div>
      ) : null}
      {caps.map((c, i) => (
        <Sequence key={i} from={i * per} durationInFrames={per}>
          <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', padding: '0 8% 14%' }}>
            <div style={{ color: fg, backgroundColor: 'rgba(0,0,0,0.45)', borderLeft: '6px solid ' + accent, padding: '14px 22px', fontSize: 40, fontWeight: 700, borderRadius: 8, maxWidth: '90%', textAlign: 'center' }}>{String(c)}</div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
`;

/**
 * Build a deterministic fallback capsule from a capsule whose own code failed to render: keep its slotSchema +
 * timingSignature (those are valid — only the generated CODE was broken) but swap the codeBundle for the SAFE
 * template, then inject the timed media track so the user's per-section assets still paint. Render this with the
 * SAME boundProps to always produce a real video.
 */
export function buildFallbackCapsule(failed: v5.RemotionTemplateCapsule): v5.RemotionTemplateCapsule {
  const fallback: v5.RemotionTemplateCapsule = {
    ...failed,
    codeBundle: { files: [{ path: "index.tsx", content: SAFE_TEMPLATE_TSX }], entryFile: "index.tsx", componentName: SAFE_COMPONENT },
    slotSchema: failed.slotSchema.map((s) => ({ ...s })),
    quality: { ...failed.quality, codeOrigin: "deterministic" },
  };
  // Paint each section's bound user asset behind the safe captions (reuses the same timed-track logic).
  ensureTimedMediaLayers(fallback);
  return fallback;
}
