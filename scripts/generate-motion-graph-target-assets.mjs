#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "docs", "fixtures", "motion_graph_target_assets");

const copy = {
  brandName: "Viral Structure Engine",
  features: [
    "Analyze sample videos",
    "Induce reusable slots",
    "Detect missing assets",
    "Render editable timelines"
  ],
  cta: "Upload. Analyze. Remix."
};

function resolveFfmpegBin() {
  const explicit = process.env.FFMPEG_PATH;
  if (explicit && explicit !== "ffmpeg") return explicit;
  const condaBase = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaBin = path.join(condaBase, "envs", condaEnv, "bin", "ffmpeg");
  return existsSync(condaBin) ? condaBin : "ffmpeg";
}

function resolveFontFile() {
  const explicit = process.env.FFMPEG_FONT_FILE;
  const candidates = [
    explicit,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const ffmpegBin = resolveFfmpegBin();
const fontFile = resolveFontFile();

function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’");
}

function fontPrefix() {
  if (!fontFile) return "";
  return `fontfile=${escapeFilterValue(fontFile)}:`;
}

function drawText(text, size, y, color = "white", box = false) {
  const boxArgs = box ? ":box=1:boxcolor=black@0.35:boxborderw=18" : "";
  return `drawtext=${fontPrefix()}text='${escapeFilterValue(text)}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}${boxArgs}`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve();
    });
  });
}

async function renderCard(index, feature, color, accent) {
  const label = `0${index}`;
  const filter = [
    `color=c=${color}:s=720x960:d=1`,
    "format=rgba",
    "drawbox=x=52:y=62:w=616:h=836:color=white@0.10:t=fill",
    `drawbox=x=78:y=88:w=564:h=784:color=${accent}@0.20:t=6`,
    `drawbox=x=96:y=112:w=118:h=118:color=${accent}@0.96:t=fill`,
    drawText(label, 56, 136, "white"),
    drawText(feature, 46, 390, "white", true),
    drawText("TARGET CARD ASSET", 26, 760, "0xdbeafe"),
    `drawbox=x=128:y=816:w=464:h=14:color=${accent}@0.78:t=fill`
  ].join(",");
  await run(ffmpegBin, ["-y", "-f", "lavfi", "-i", filter, "-frames:v", "1", path.join(fixtureDir, `card_0${index}.png`)]);
}

async function renderLogo() {
  const filter = [
    "color=c=0x0f172a:s=512x512:d=1",
    "format=rgba",
    "drawbox=x=44:y=44:w=424:h=424:color=white@0.96:t=fill",
    "drawbox=x=44:y=44:w=424:h=424:color=0xe11d48@0.95:t=14",
    "drawbox=x=98:y=208:w=316:h=42:color=0xe11d48@0.96:t=fill",
    "drawbox=x=232:y=98:w=48:h=316:color=0x38bdf8@0.92:t=fill",
    drawText("VSE", 92, 204, "0x0f172a"),
    drawText("Viral Structure Engine", 30, 384, "0x0f172a")
  ].join(",");
  await run(ffmpegBin, ["-y", "-f", "lavfi", "-i", filter, "-frames:v", "1", path.join(fixtureDir, "logo.png")]);
}

async function main() {
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(path.join(fixtureDir, "copy.json"), `${JSON.stringify(copy, null, 2)}\n`, "utf8");
  const manifest = {
    schemaVersion: "motion-graph-target-assets-manifest-v1",
    brandName: copy.brandName,
    cta: copy.cta,
    assets: [
      ...[1, 2, 3, 4].map((index) => ({
        id: `target_card_0${index}`,
        kind: "image",
        role: "media_card",
        path: `card_0${index}.png`
      })),
      {
        id: "target_feature_copy",
        kind: "copy",
        role: "feature_copy",
        text: copy.features.join("\n")
      },
      {
        id: "target_kinetic_copy",
        kind: "copy",
        role: "kinetic_copy",
        text: copy.brandName
      },
      {
        id: "target_logo",
        kind: "logo",
        role: "brand_logo",
        path: "logo.png"
      }
    ]
  };
  const partialManifest = {
    schemaVersion: "motion-graph-target-assets-manifest-v1",
    brandName: copy.brandName,
    cta: copy.cta,
    assets: [
      {
        id: "target_card_01",
        kind: "image",
        role: "media_card",
        path: "card_01.png"
      },
      {
        id: "target_card_02",
        kind: "image",
        role: "media_card",
        path: "card_02.png"
      },
      {
        id: "target_feature_copy",
        kind: "copy",
        role: "feature_copy",
        text: copy.features.join("\n")
      },
      {
        id: "target_kinetic_copy",
        kind: "copy",
        role: "kinetic_copy",
        text: copy.brandName
      }
    ]
  };
  await writeFile(path.join(fixtureDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(fixtureDir, "manifest.partial.json"), `${JSON.stringify(partialManifest, null, 2)}\n`, "utf8");
  const colors = ["0x0f172a", "0x111827", "0x172554", "0x3b0764"];
  const accents = ["0x38bdf8", "0x22c55e", "0xf97316", "0xe11d48"];
  for (let index = 0; index < copy.features.length; index += 1) {
    await renderCard(index + 1, copy.features[index], colors[index], accents[index]);
  }
  await renderLogo();
  console.log(`Generated motion graph target assets at ${path.relative(repoRoot, fixtureDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
