// pipeline-v5/injectMediaBaseLayer.ts
// STRUCTURE-TRANSFER timed media track. Used at TWO points:
//   1. LEARN — when an AI capsule renders NO media (a text/motion-graphics-only reconstruction, common when the
//      reference had no real footage), bake in a media track so the user's bound photos/videos can show.
//   2. GENERATION (after context-rewrite) — the Doubao re-theme rewrite can DROP the injected layers; re-run so
//      the rendered program actually paints the user's assets.
// It inserts a stack of TIMED <Sequence> media layers (one per structure section / per media slot) as the FIRST
// child of the component's root <AbsoluteFill>, at zIndex 0, each keyed to a media slot's prop accessor with a
// contrast scrim — so the reference's text / rhythm / packaging render on top of the user's CONTENT and EACH
// structure slot consumes its OWN bound asset in its OWN time window (not one hero image stretched over the whole
// video). Conditional on each bound asset being present (assets["<key>"]?.src), so an unbound slot falls back to
// the template background. Idempotent (recomputes cleanly), upgrades the older single-layer base, and never
// double-paints a key the template already renders itself.
import { v5 } from "@vvst/shared";
import { extractAssetKeys } from "./runGen1CapsuleGemini.js";

/** True if the code already renders real media (an <Img>/<Video> tag OR an `assets.<key>` reference). A bare
 *  `backgroundImage: linear-gradient(...)` is code-drawn, NOT a user photo, so it does not count. */
export function codeRendersMedia(code: string): boolean {
  return /<Img\b|<OffthreadVideo\b|<Video\b|<img\b|assets\s*[.[]/.test(code);
}

const isMediaSlot = (s: v5.TemplateSlot): boolean => /image|logo|ui_mockup|video/.test(s.kind) || s.mediaKind === "video";
const isVideoSlot = (s: v5.TemplateSlot): boolean => s.mediaKind === "video" || /video/.test(s.kind);
/** The boundProps.assets key the renderer binds this slot under — mirrors runSameTemplateGeneration's
 *  `propKey = slot.propPath?.split(".")[1] ?? slot.id` so the injected accessor matches the bound prop exactly. */
const keyOf = (s: v5.TemplateSlot): string =>
  (s.propPath && s.propPath.startsWith("assets.") ? s.propPath.split(".")[1] : undefined) ?? s.id;

interface MediaLayer { key: string; isVideo: boolean; fromSec: number; toSec: number }

/** Strip any previously-injected media block (current timed track OR the legacy single-layer base) so the pass
 *  is idempotent and upgrades old capsules. */
function stripInjected(code: string): string {
  return code
    .replace(/\s*\{\/\* vvst-media-track \*\/\}[\s\S]*?\{\/\* \/vvst-media-track \*\/\}/g, "")
    .replace(/\s*\{\/\* vvst-media-base \*\/\}[\s\S]*?\) : null\}/g, "");
}

/** Ensure the root component DESTRUCTURES `assets` from its props, so the injected `assets[...]` refs resolve.
 *  A pure motion-graphics reconstruction often declares `({ copy, palette }) => …` with no `assets` param, which
 *  would make the injected track throw "assets is not defined". Adds `assets = {}` to the destructured params when
 *  missing. No-op when already present or when the component takes a non-destructured `props` arg. */
function ensureAssetsParam(code: string, comp: string): string {
  const compRe = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${comp}\\s*=\\s*|function\\s+${comp}\\s*`);
  const m = compRe.exec(code);
  if (!m) return code;
  const open = code.indexOf("(", m.index + m[0].length);
  if (open < 0) return code;
  let depth = 0, close = open;
  for (; close < code.length; close++) { const ch = code[close]; if (ch === "(") depth++; else if (ch === ")") { depth--; if (depth === 0) break; } }
  const params = code.slice(open + 1, close);
  if (/(^|[\s{,])assets(\s*[:=,}]|\s*$)/.test(params)) return code; // already destructures (or names) assets
  const brace = params.indexOf("{");
  if (brace < 0) return code; // non-destructured props arg — can't safely add a binding
  const insertAt = open + 1 + brace + 1;
  return `${code.slice(0, insertAt)} assets = {},${code.slice(insertAt)}`;
}

/** Ensure each named import is present on the `from "remotion"` import line (adds the line if absent). */
function ensureRemotionImports(code: string, names: string[]): string {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]remotion['"]/;
  const m = code.match(re);
  if (m) {
    const have = new Set(m[1].split(",").map((s) => s.trim()).filter(Boolean));
    const add = names.filter((n) => !have.has(n));
    if (!add.length) return code;
    return code.replace(re, `import { ${[...have, ...add].join(", ")} } from 'remotion'`);
  }
  return `import { ${names.join(", ")} } from 'remotion';\n${code}`;
}

/**
 * Map media slots -> timed windows. Two modes:
 *   A (section-aligned): slots named `<sectionId>_...` (the v2/AI convention) — each section paints its own
 *      media slot over the section's [startSec,endSec], exactly matching timeline-v2.json.
 *   B (even spread): slots NOT section-named (bg1/bg2, clip_intro, ...) — spread evenly across the full
 *      duration so every bound asset still gets its own on-screen window.
 * De-duplicated by accessor key (a deterministic template can point several slots at the same prop).
 */
function planLayers(capsule: v5.RemotionTemplateCapsule, mediaSlots: v5.TemplateSlot[], synthetic: boolean): MediaLayer[] {
  const sections = [...(capsule.timingSignature.sections ?? [])].sort((a, b) => a.startSec - b.startSec);
  const total = sections.length ? sections[sections.length - 1].endSec : (capsule.timingSignature.durationSec || 0);

  let layers: MediaLayer[] = [];
  const sectionMatched = sections
    .map((sec) => ({ sec, slot: mediaSlots.find((s) => s.id.startsWith(sec.id)) }))
    .filter((x): x is { sec: typeof sections[number]; slot: v5.TemplateSlot } => Boolean(x.slot));

  if (!synthetic && sectionMatched.length >= 2) {
    for (const { sec, slot } of sectionMatched) layers.push({ key: keyOf(slot), isVideo: isVideoSlot(slot), fromSec: sec.startSec, toSec: sec.endSec });
  } else if (synthetic || total <= 0) {
    const s = mediaSlots[0];
    layers.push({ key: keyOf(s), isVideo: isVideoSlot(s), fromSec: 0, toSec: total > 0 ? total : 0 });
  } else {
    // Even spread across the structure's full duration (de-dup keys before splitting so each gets a real share).
    const seen = new Set<string>();
    const uniq = mediaSlots.filter((s) => { const k = keyOf(s); if (seen.has(k)) return false; seen.add(k); return true; });
    const K = uniq.length;
    uniq.forEach((s, i) => layers.push({ key: keyOf(s), isVideo: isVideoSlot(s), fromSec: (total * i) / K, toSec: (total * (i + 1)) / K }));
  }
  // De-dup by accessor key (Mode A can map two sections onto a shared prop) — keep the first window.
  const seen = new Set<string>();
  layers = layers.filter((l) => (seen.has(l.key) ? false : (seen.add(l.key), true)));
  // Hold the LAST shot through to the end of the composition so a trailing non-media section (e.g. a CTA text
  // card) never drops to the bare template background — otherwise the final ~1-2s renders black after the photos.
  const fullEnd = Math.max(total, capsule.timingSignature.durationSec || 0);
  if (layers.length && fullEnd > layers[layers.length - 1].toSec) layers[layers.length - 1].toSec = fullEnd;
  return layers;
}

/**
 * Inject / refresh the timed media track. Returns the keys actually painted. `changed` is true when the code was
 * modified (track (re)written, or a stale block stripped).
 */
export function ensureTimedMediaLayers(
  capsule: v5.RemotionTemplateCapsule,
): { changed: boolean; layeredKeys: string[] } {
  const file =
    capsule.codeBundle.files.find((f) => /(^|\/)index\.tsx$/.test(f.path)) ??
    capsule.codeBundle.files.find((f) => /\.tsx$/.test(f.path)) ??
    capsule.codeBundle.files[0];
  if (!file) return { changed: false, layeredKeys: [] };

  const original = file.content;
  let code = stripInjected(original);

  let mediaSlots = capsule.slotSchema.filter(isMediaSlot);
  let synthetic = false;
  // A capsule whose ONLY media slot is a prior lone backdrop is treated as "no real media slots" so it gets
  // upgraded to a per-section track (this is how a single-backdrop capsule learned earlier becomes a real
  // per-shot composition at generation time, without re-learning).
  const onlyBackdrop = mediaSlots.length === 1 && mediaSlots[0].id === "userMediaBackdrop";
  if (!mediaSlots.length || onlyBackdrop) {
    // The reconstruction declared no per-section footage (a pure text / motion-graphics reference). For STRUCTURE
    // TRANSFER we still want EACH structure section to show the user's OWN uploaded photo/video. So synthesize one
    // optional media slot PER CONTENT section (hook/benefit/proof/…, skipping the CTA text card), named with the
    // `<sectionId>_media` convention so binding + timeline-v2 + the timed track all pick them up. Each is bound to
    // a distinct user asset (or AIGC fill); unbound slots stay invisible (guarded by ?.src). When the timing has
    // too few usable sections, fall back to ONE full-frame backdrop (the original single-layer behaviour).
    const sections = [...(capsule.timingSignature.sections ?? [])].sort((a, b) => a.startSec - b.startSec);
    const contentSections = sections.filter((s) => s.role !== "cta" && s.role !== "transition");
    const kindForRole = (role: string): v5.TemplateSlotKind =>
      role === "hook" ? "hero_image" : role === "setup" ? "background_image" : "product_image";
    if (contentSections.length >= 2) {
      if (onlyBackdrop) capsule.slotSchema = capsule.slotSchema.filter((s) => s.id !== "userMediaBackdrop");
      const synth: v5.TemplateSlot[] = contentSections.map((sec) => ({
        id: `${sec.id}_media`,
        kind: kindForRole(sec.role),
        required: false,
        originalRole: `${sec.role} section media (structure-transfer)`,
        replacementPolicy: "user_asset",
        propPath: `assets.${sec.id}_media`,
        userAssetSlot: true,
        mediaKind: "image",
        description: `Media for the ${sec.role} section; binds a user asset (or AIGC fill) so this structure slot shows real content.`,
      }));
      capsule.slotSchema.push(...synth);
      mediaSlots = synth;
    } else if (!mediaSlots.length) {
      const syn: v5.TemplateSlot = {
        id: "userMediaBackdrop",
        kind: "background_image",
        required: false,
        originalRole: "structure-transfer user content base",
        replacementPolicy: "user_asset",
        propPath: "assets.userMediaBackdrop",
        userAssetSlot: true,
        mediaKind: "image",
        description: "Full-frame base layer for the user's primary uploaded photo/video; the reference template's text / rhythm / packaging renders on top.",
      };
      capsule.slotSchema.push(syn);
      mediaSlots = [syn];
      synthetic = true;
    }
  }

  const layers = planLayers(capsule, mediaSlots, synthetic);
  // Never double-paint a key the template already renders itself (its own <Img>/accessor outside our block).
  const native = new Set(extractAssetKeys(code));
  const toInject = layers.filter((l) => !native.has(l.key));

  if (!toInject.length) {
    // Nothing to add (the template already paints every slot, or there is no timing). Persist a strip-only change
    // so a stale legacy block doesn't linger, but report changed only if the code actually differs.
    if (code !== original) { file.content = code; return { changed: true, layeredKeys: [] }; }
    return { changed: false, layeredKeys: [] };
  }

  // Locate the component's root return -> first <AbsoluteFill ...> and the end of its opening tag.
  const comp = capsule.codeBundle.componentName;
  const compRe = new RegExp(`(function\\s+${comp}\\b|(?:const|let|var)\\s+${comp}\\s*=)`);
  const fnIdx = code.search(compRe);
  const afIdx = fnIdx >= 0 ? code.indexOf("<AbsoluteFill", fnIdx) : -1;
  const gt = afIdx >= 0 ? code.indexOf(">", afIdx) : -1;
  if (gt < 0 || code[gt - 1] === "/") {
    // Can't locate an open root <AbsoluteFill> to host the track. Persist any strip-only change, else no-op.
    if (code !== original) { file.content = code; return { changed: true, layeredKeys: [] }; }
    return { changed: false, layeredKeys: [] };
  }

  const fps = capsule.timingSignature.fps || 30;
  const cover = "{ width: '100%', height: '100%', objectFit: 'cover' }";
  // Hero fallback: if a section's OWN slot is unbound at render time, fall back to the first painted asset, so no
  // window ever drops to the bare template background (no black mid-roll / gap). The first layer is the fallback.
  const heroAcc = `assets[${JSON.stringify(toInject[0].key)}]`;
  const blocks = toInject
    .map((l, i) => {
      const fromF = Math.max(0, Math.round(l.fromSec * fps));
      const durF = Math.max(1, Math.round((l.toSec - l.fromSec) * fps));
      const acc = `assets[${JSON.stringify(l.key)}]`;
      const src = i === 0 ? `${acc}?.src` : `(${acc}?.src || ${heroAcc}?.src)`;
      const media = l.isVideo
        ? `<OffthreadVideo src={${src}} muted style={${cover}} />`
        : `<Img src={${src}} style={${cover}} />`;
      return (
        `        {${src} ? (\n` +
        `          <Sequence from={${fromF}} durationInFrames={${durF}}>\n` +
        `            <AbsoluteFill>\n` +
        `              ${media}\n` +
        `              <AbsoluteFill style={{ backgroundColor: 'rgba(0,0,0,0.2)' }} />\n` +
        `            </AbsoluteFill>\n` +
        `          </Sequence>\n` +
        `        ) : null}`
      );
    })
    .join("\n");
  const inject =
    `\n      {/* vvst-media-track */}` +
    `\n      <AbsoluteFill style={{ zIndex: 0 }}>\n${blocks}\n      </AbsoluteFill>` +
    `\n      {/* /vvst-media-track */}`;
  code = code.slice(0, gt + 1) + inject + code.slice(gt + 1);
  // The injected layers read `assets[...]`; guarantee the root component destructures `assets` (a pure
  // motion-graphics reconstruction often doesn't), else the render throws "assets is not defined".
  code = ensureAssetsParam(code, comp);

  const imports = ["AbsoluteFill", "Sequence", "Img", ...(toInject.some((l) => l.isVideo) ? ["OffthreadVideo"] : [])];
  code = ensureRemotionImports(code, imports);

  file.content = code;
  return { changed: true, layeredKeys: toInject.map((l) => l.key) };
}
