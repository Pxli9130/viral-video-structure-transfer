import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(scriptsDir, "..");
export const artifactRoot = path.resolve(repoRoot, process.env.VVST_ARTIFACT_ROOT ?? "docs/artifacts");
export const marketingArtifactDir = path.join(artifactRoot, "marketing_case");
export const corpusRegressionDir = path.join(artifactRoot, "corpus_regression");

export function rel(filePath) {
  return path.relative(repoRoot, filePath);
}
