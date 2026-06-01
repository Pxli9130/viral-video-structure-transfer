import type { TechniqueAtom, VersionStrategy } from "../types.js";

export type TechniqueAtomRetrievalQuery = {
  userPrompt?: string;
  videoType?: string;
  gapType?: string;
  style?: string;
  requiredAssets?: string[];
  versionStrategy?: VersionStrategy;
};

export type TechniqueAtomRetrievalResult = {
  atomId: string;
  score: number;
  reason: string;
  matchedFields: string[];
};

export type TechniqueAtomCuratorSuggestion = {
  atomIds: string[];
  similarity: number;
  reason: string;
};

function tokenize(value: unknown): string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function synonyms(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const token of tokens) {
    if (/ribbon|彩带|丝带/.test(token)) out.add("parametric").add("surface").add("motion");
    if (/subtitle|caption|字幕|文字/.test(token)) out.add("typography").add("text").add("kinetic");
    if (/fast|hook|开头|抓人/.test(token)) out.add("hook").add("impact").add("kinetic");
    if (/poster|card|海报|卡片/.test(token)) out.add("poster").add("card").add("layout");
  }
  return Array.from(out);
}

function atomFieldText(atom: TechniqueAtom): Record<string, string> {
  return {
    name: atom.name,
    category: atom.category,
    visualPattern: atom.visualPattern,
    timingPattern: atom.timingPattern,
    requiredAssets: atom.requiredAssets.join(" "),
    renderer: [atom.renderer.component, atom.fallbackComponent].filter(Boolean).join(" "),
    transferRules: atom.transferRules.join(" "),
    qualityHints: atom.qualityHints.join(" ")
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = Array.from(a).filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function retrieveTechniqueAtoms(query: TechniqueAtomRetrievalQuery, atoms: TechniqueAtom[], limit = 5): TechniqueAtomRetrievalResult[] {
  const qTokens = synonyms(tokenize([
    query.userPrompt,
    query.videoType,
    query.gapType,
    query.style,
    query.requiredAssets?.join(" "),
    query.versionStrategy
  ].filter(Boolean).join(" ")));
  const q = new Set(qTokens);
  return atoms
    .map((atom) => {
      const fields = atomFieldText(atom);
      const matchedFields: string[] = [];
      let score = 0;
      for (const [field, text] of Object.entries(fields)) {
        const tokens = new Set(synonyms(tokenize(text)));
        const hits = Array.from(q).filter((token) => tokens.has(token));
        if (hits.length) matchedFields.push(field);
        score += hits.length * (field === "name" ? 4 : field === "category" ? 3 : 1);
        score += jaccard(q, tokens) * 5;
      }
      if (query.versionStrategy === "high_click" && /impact|kinetic|motion|hook/i.test(`${atom.name} ${atom.category}`)) score += 3;
      if (query.versionStrategy === "high_quality" && /poster|layout|card/i.test(`${atom.name} ${atom.category}`)) score += 2;
      return {
        atomId: atom.id,
        score: Math.round(score * 100) / 100,
        reason: matchedFields.length ? `Matched ${matchedFields.join(", ")} for query tokens ${qTokens.slice(0, 8).join(", ")}.` : "No lexical match; low-score fallback.",
        matchedFields
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function curateTechniqueAtomDuplicates(atoms: TechniqueAtom[], threshold = 0.72): TechniqueAtomCuratorSuggestion[] {
  const suggestions: TechniqueAtomCuratorSuggestion[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const a = atoms[i];
      const b = atoms[j];
      const aSet = new Set(tokenize(`${a.name} ${a.category} ${a.visualPattern}`));
      const bSet = new Set(tokenize(`${b.name} ${b.category} ${b.visualPattern}`));
      const similarity = Math.round(jaccard(aSet, bSet) * 100) / 100;
      if (similarity >= threshold) {
        suggestions.push({
          atomIds: [a.id, b.id],
          similarity,
          reason: `Similar atom naming/category/pattern; suggest merge review, no automatic mutation.`
        });
      }
    }
  }
  return suggestions;
}
