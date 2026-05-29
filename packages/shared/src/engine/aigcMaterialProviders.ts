import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import type {
  AigcMaterialProviderId,
  GeneratedAssetCandidate,
  MaterialGenerationBrief
} from "../types.js";

export interface AigcMaterialProviderContext {
  outputDir: string;
  publicPathPrefix: string;
  now?: string;
}

export interface AigcMaterialProvider {
  id: AigcMaterialProviderId;
  kind: "image" | "video" | "copy" | "stub";
  generate(brief: MaterialGenerationBrief, context: AigcMaterialProviderContext): Promise<GeneratedAssetCandidate[]>;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(width: number, height: number, seed: number, label: string): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const labelBytes = Buffer.from(label, "utf8");
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const band = Math.floor((x / width) * 4) + Math.floor((y / height) * 4);
      const accent = (labelBytes[(x + y) % Math.max(1, labelBytes.length)] ?? 31) + seed + band * 19;
      raw[offset] = (seed * 31 + x + accent) % 256;
      raw[offset + 1] = (seed * 47 + y * 2 + accent) % 256;
      raw[offset + 2] = (seed * 67 + x + y + accent) % 256;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function candidatePath(prefix: string, filename: string): string {
  return `${prefix.replace(/\/$/, "")}/${filename}`.replace(/\\/g, "/");
}

function candidateTypeFor(brief: MaterialGenerationBrief): GeneratedAssetCandidate["type"] {
  return brief.assetType === "copy" ? "copy" : brief.assetType === "short_video" ? "video" : "image";
}

function maxCandidateCount(brief: MaterialGenerationBrief): number {
  if (brief.assetType === "image_set") return Math.max(1, brief.count);
  return 1;
}

export const mockProvider: AigcMaterialProvider = {
  id: "mock_provider",
  kind: "image",
  async generate(brief, context) {
    await mkdir(context.outputDir, { recursive: true });
    const generatedAt = context.now ?? new Date().toISOString();
    const count = maxCandidateCount(brief);
    const candidates: GeneratedAssetCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const ext = brief.assetType === "copy" ? "txt" : "png";
      const filename = `${brief.slotId}_${brief.assetType}_${String(index + 1).padStart(2, "0")}.${ext}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const filePath = path.join(context.outputDir, filename);
      const prompt = brief.promptPack?.[index] ?? brief.promptPack?.[0] ?? `${brief.visualFormFamily} generated material`;
      if (brief.assetType === "copy") {
        await writeFile(filePath, `${prompt}\n`, "utf8");
      } else {
        await writeFile(filePath, makePng(720, 960, index + brief.id.length, `${brief.visualFormFamily} ${index + 1}`));
      }
      candidates.push({
        id: `generated_${brief.slotId}_${String(index + 1).padStart(2, "0")}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
        briefId: brief.id,
        slotId: brief.slotId,
        provider: "mock_provider",
        model: "deterministic_mock_png_v1",
        type: candidateTypeFor(brief),
        materialRole: "aigc_generated_material",
        path: candidatePath(context.publicPathPrefix, filename),
        prompt,
        negativePrompt: brief.negativePrompts.join("; "),
        provenance: {
          generatedAt,
          userApproved: false,
          externalProviderUsed: false,
          sampleFramesSentExternally: false,
          targetAssetsSentExternally: false
        },
        quality: {
          usable: undefined,
          issues: []
        }
      });
    }
    return candidates;
  }
};

function disabledProvider(id: AigcMaterialProviderId): AigcMaterialProvider {
  return {
    id,
    kind: "stub",
    async generate() {
      throw new Error(`${id} is disabled by default; enable it explicitly and handle privacy/cost policy before use.`);
    }
  };
}

export const AIGC_MATERIAL_PROVIDER_REGISTRY: Record<AigcMaterialProviderId, AigcMaterialProvider> = {
  mock_provider: mockProvider,
  local_folder_provider: disabledProvider("local_folder_provider"),
  ark_seedance_provider_stub: disabledProvider("ark_seedance_provider_stub"),
  image_provider: disabledProvider("image_provider"),
  copy_provider: disabledProvider("copy_provider"),
  none: disabledProvider("none")
};

export function getAigcMaterialProvider(id: AigcMaterialProviderId = "mock_provider"): AigcMaterialProvider {
  return AIGC_MATERIAL_PROVIDER_REGISTRY[id] ?? mockProvider;
}
