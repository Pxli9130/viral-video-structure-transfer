// GeneratedEffectProposal (generated-effect-proposal.v1) — the envelope for a Gemini- (or
// local-fallback-) generated Remotion effect. Proposals are written to disk for validation and are
// NEVER executed or applied to production source by this module. Apply is a later, separate step.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MotifFamily } from "./creativeEffectSpec.js";

export interface GeneratedEffectProposalFiles {
  "index.tsx": string;
  "schema.ts": string;
  "fixture.json": string;
  "README.md": string;
}

export interface GeneratedEffectProposal {
  version: "generated-effect-proposal.v1";
  effectId: string;
  motifFamily: MotifFamily;
  effectName: string;
  componentName: string;
  files: GeneratedEffectProposalFiles;
  provider: "gemini" | "local_fallback";
  model?: string;
  promptHash: string;
  safetyNotes: string[];
  createdAt: string;
}

const REQUIRED_FILE_KEYS: (keyof GeneratedEffectProposalFiles)[] = ["index.tsx", "schema.ts", "fixture.json", "README.md"];

export interface ProposalEnvelopeValidation {
  valid: boolean;
  errors: string[];
}

export function validateGeneratedEffectProposalEnvelope(input: unknown): ProposalEnvelopeValidation {
  const errors: string[] = [];
  const p = input as Partial<GeneratedEffectProposal> | null | undefined;
  if (!p || typeof p !== "object") return { valid: false, errors: ["proposal is not an object"] };
  if (p.version !== "generated-effect-proposal.v1") errors.push("version must be generated-effect-proposal.v1");
  if (typeof p.effectId !== "string" || !p.effectId) errors.push("effectId is required");
  if (typeof p.effectName !== "string" || !p.effectName) errors.push("effectName is required");
  if (typeof p.componentName !== "string" || !p.componentName) errors.push("componentName is required");
  if (typeof p.motifFamily !== "string") errors.push("motifFamily is required");
  if (!["gemini", "local_fallback"].includes(p.provider as string)) errors.push("provider must be gemini|local_fallback");
  if (typeof p.promptHash !== "string" || !p.promptHash) errors.push("promptHash is required");
  if (!Array.isArray(p.safetyNotes)) errors.push("safetyNotes must be an array");
  if (typeof p.createdAt !== "string" || !p.createdAt) errors.push("createdAt is required");
  const files = p.files as unknown as Record<string, unknown> | undefined;
  if (!files || typeof files !== "object") {
    errors.push("files is required");
  } else {
    for (const key of REQUIRED_FILE_KEYS) {
      const value = files[key];
      if (typeof value !== "string" || !value) {
        errors.push(`files["${key}"] is required and must be a non-empty string`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Write the proposal files + metadata to a proposal directory. Returns the absolute dir. */
export function writeGeneratedEffectProposal(proposal: GeneratedEffectProposal, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "index.tsx"), proposal.files["index.tsx"], "utf8");
  writeFileSync(path.join(outDir, "schema.ts"), proposal.files["schema.ts"], "utf8");
  writeFileSync(path.join(outDir, "fixture.json"), proposal.files["fixture.json"], "utf8");
  writeFileSync(path.join(outDir, "README.md"), proposal.files["README.md"], "utf8");
  const metadata = {
    version: proposal.version,
    effectId: proposal.effectId,
    motifFamily: proposal.motifFamily,
    effectName: proposal.effectName,
    componentName: proposal.componentName,
    provider: proposal.provider,
    ...(proposal.model ? { model: proposal.model } : {}),
    promptHash: proposal.promptHash,
    safetyNotes: proposal.safetyNotes,
    createdAt: proposal.createdAt,
    defaultAllowed: false
  };
  writeFileSync(path.join(outDir, "proposal-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return outDir;
}

/** Read a proposal back from its directory (inverse of writeGeneratedEffectProposal). */
export function readGeneratedEffectProposal(proposalDir: string): GeneratedEffectProposal {
  const metaPath = path.join(proposalDir, "proposal-metadata.json");
  if (!existsSync(metaPath)) throw new Error(`proposal-metadata.json not found in ${proposalDir}`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Omit<GeneratedEffectProposal, "files">;
  const files: GeneratedEffectProposalFiles = {
    "index.tsx": readFileSync(path.join(proposalDir, "index.tsx"), "utf8"),
    "schema.ts": readFileSync(path.join(proposalDir, "schema.ts"), "utf8"),
    "fixture.json": readFileSync(path.join(proposalDir, "fixture.json"), "utf8"),
    "README.md": readFileSync(path.join(proposalDir, "README.md"), "utf8")
  };
  return { ...meta, files };
}
