import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  GeneratedAssetCandidate,
  GeneratedAssetQualityResult,
  MaterialGenerationBrief
} from "../types.js";

function resolveCandidatePath(candidate: GeneratedAssetCandidate, rootDir?: string): string {
  if (path.isAbsolute(candidate.path)) return candidate.path;
  return path.resolve(rootDir ?? process.cwd(), candidate.path);
}

async function imageDimensions(filePath: string): Promise<{ width: number; height: number; codec: string } | undefined> {
  const buffer = await readFile(filePath);
  if (buffer.length < 24) return undefined;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      codec: "png"
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          codec: "jpeg"
        };
      }
      offset += Math.max(2, length + 2);
    }
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        codec: "webp"
      };
    }
  }
  return undefined;
}

function expectedTypeMatches(brief: MaterialGenerationBrief, candidate: GeneratedAssetCandidate): boolean {
  if (brief.assetType === "copy") return candidate.type === "copy";
  if (brief.assetType === "short_video") return candidate.type === "video";
  return candidate.type === "image";
}

export async function checkGeneratedMaterialCandidate(input: {
  brief: MaterialGenerationBrief;
  candidate: GeneratedAssetCandidate;
  rootDir?: string;
  vlmAvailable?: boolean;
  vlmReview?: (input: {
    brief: MaterialGenerationBrief;
    candidate: GeneratedAssetCandidate;
    filePath: string;
  }) => Promise<{ usable?: boolean; slotFitScore?: number; targetThemeFitScore?: number; noSampleCopyScore?: number; textArtifactRisk?: number; issues?: string[] }>;
}): Promise<GeneratedAssetQualityResult> {
  const filePath = resolveCandidatePath(input.candidate, input.rootDir);
  const deterministicChecks: GeneratedAssetQualityResult["deterministicChecks"] = [];
  const issues: string[] = [];
  const exists = existsSync(filePath);
  deterministicChecks.push({ id: "generated_asset_file_exists", passed: exists, value: input.candidate.path });
  if (!exists) issues.push("generated asset file does not exist");

  const typeMatches = expectedTypeMatches(input.brief, input.candidate);
  deterministicChecks.push({ id: "generated_asset_type_matches_slot", passed: typeMatches, value: input.candidate.type });
  if (!typeMatches) issues.push(`candidate type ${input.candidate.type} does not match ${input.brief.assetType}`);

  let notEmpty = false;
  let dimensions: { width: number; height: number; codec: string } | undefined;
  if (exists) {
    const info = statSync(filePath);
    notEmpty = info.size > 0;
    if (input.candidate.type === "image") dimensions = await imageDimensions(filePath);
  }
  deterministicChecks.push({ id: "generated_asset_not_empty", passed: notEmpty, value: exists ? statSync(filePath).size : 0 });
  if (!notEmpty) issues.push("generated asset is empty");

  if (input.candidate.type === "image") {
    const dimensionsOk = Boolean(dimensions && dimensions.width > 0 && dimensions.height > 0);
    deterministicChecks.push({ id: "generated_asset_dimensions_valid", passed: dimensionsOk, value: dimensions ?? null });
    if (!dimensionsOk) issues.push("generated image dimensions are missing or invalid");
  }

  const noPrivatePath = !/\/home\/pxli|\.env|GEMINI_API_KEY|AIza|ark-/i.test(input.candidate.path);
  deterministicChecks.push({ id: "generated_asset_no_private_path", passed: noPrivatePath, value: input.candidate.path });
  if (!noPrivatePath) issues.push("candidate path contains a private or secret-looking token");

  const noSampleCopy = !input.candidate.provenance.sampleFramesSentExternally && !input.brief.privacyPolicy.sampleFramesAllowedToProvider;
  deterministicChecks.push({
    id: "generated_asset_no_sample_copy_risk",
    passed: noSampleCopy,
    value: {
      sampleFramesSentExternally: input.candidate.provenance.sampleFramesSentExternally,
      sampleFramesAllowedToProvider: input.brief.privacyPolicy.sampleFramesAllowedToProvider
    }
  });
  if (!noSampleCopy) issues.push("sample frames were allowed or sent externally");

  const deterministicUsable = deterministicChecks.every((check) => check.passed);
  let vlmStatus: GeneratedAssetQualityResult["vlmStatus"] = input.vlmAvailable ? "not_run" : "skipped_infra";
  let vlmScores: Partial<GeneratedAssetQualityResult> = {};
  if (deterministicUsable && input.vlmAvailable && input.vlmReview) {
    try {
      const review = await input.vlmReview({ brief: input.brief, candidate: input.candidate, filePath });
      if (review.usable === false) issues.push(...(review.issues ?? ["VLM review marked generated asset unusable"]));
      else if (review.issues?.length) issues.push(...review.issues);
      vlmScores = {
        slotFitScore: review.slotFitScore,
        targetThemeFitScore: review.targetThemeFitScore,
        noSampleCopyScore: review.noSampleCopyScore,
        textArtifactRisk: review.textArtifactRisk
      };
      vlmStatus = "ok";
    } catch (error) {
      vlmStatus = "failed";
      issues.push(`VLM review failed: ${(error as Error).message}`);
    }
  }
  const usable = deterministicUsable && vlmStatus !== "failed" && !issues.some((issue) => /unusable/i.test(issue));
  return {
    candidateId: input.candidate.id,
    slotId: input.candidate.slotId,
    usable,
    slotFitScore: vlmScores.slotFitScore ?? (usable ? 0.82 : 0.2),
    targetThemeFitScore: vlmScores.targetThemeFitScore ?? (usable ? 0.78 : 0.2),
    noSampleCopyScore: vlmScores.noSampleCopyScore ?? (noSampleCopy ? 1 : 0),
    textArtifactRisk: vlmScores.textArtifactRisk ?? (input.brief.styleConstraints.noTextUnlessRequested ? 0.08 : 0.18),
    deterministicChecks,
    vlmStatus,
    issues
  };
}

export async function checkGeneratedMaterials(input: {
  briefs: MaterialGenerationBrief[];
  candidates: GeneratedAssetCandidate[];
  rootDir?: string;
  vlmAvailable?: boolean;
  vlmReview?: (input: {
    brief: MaterialGenerationBrief;
    candidate: GeneratedAssetCandidate;
    filePath: string;
  }) => Promise<{ usable?: boolean; slotFitScore?: number; targetThemeFitScore?: number; noSampleCopyScore?: number; textArtifactRisk?: number; issues?: string[] }>;
}): Promise<GeneratedAssetQualityResult[]> {
  const briefById = new Map(input.briefs.map((brief) => [brief.id, brief]));
  const results: GeneratedAssetQualityResult[] = [];
  for (const candidate of input.candidates) {
    const brief = briefById.get(candidate.briefId);
    if (!brief) {
      results.push({
        candidateId: candidate.id,
        slotId: candidate.slotId,
        usable: false,
        deterministicChecks: [{ id: "generated_asset_brief_exists", passed: false, value: candidate.briefId }],
        vlmStatus: input.vlmAvailable ? "not_run" : "skipped_infra",
        issues: ["brief missing for generated asset candidate"]
      });
      continue;
    }
    results.push(await checkGeneratedMaterialCandidate({
      brief,
      candidate,
      rootDir: input.rootDir,
      vlmAvailable: input.vlmAvailable,
      vlmReview: input.vlmReview
    }));
  }
  return results;
}
