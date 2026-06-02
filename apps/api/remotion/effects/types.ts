// Local, dependency-free runtime-props contract for built-in creative effects. Mirrors
// @vvst/shared's CreativeEffectRuntimeProps but is defined here so the Remotion bundle never has to
// pull node:fs-using shared modules into the browser build.

export interface CreativeEffectRuntimeProps {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  assets?: Array<{ id: string; src?: string; role?: string; type?: string }>;
  texts?: Array<{ id?: string; text: string; role?: string }>;
  colors?: string[];
  beats?: number[];
  stylePack?: unknown;
  productTheme?: unknown;
}

/** Safe palette accessor with index wraparound + a fallback. */
export function paletteColor(colors: string[] | undefined, index: number, fallback: string): string {
  if (!colors || colors.length === 0) return fallback;
  return colors[((index % colors.length) + colors.length) % colors.length] ?? fallback;
}

/** Pick the texts for a role, else any texts, else []. */
export function textsForRole(texts: CreativeEffectRuntimeProps["texts"], role: string): string[] {
  const all = texts ?? [];
  const matched = all.filter((t) => t.role === role).map((t) => t.text);
  return matched.length ? matched : all.map((t) => t.text);
}
