import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildFallbackTemplate,
  buildMockVideoAnalysis,
  generateMigrationResult,
  nowIso
} from "@vvst/shared";

const repoRoot = process.cwd();
const storageRoot = path.resolve(repoRoot, process.env.STORAGE_DIR || "storage");
const dbDir = path.join(storageRoot, "db");
const demoDir = path.join(storageRoot, "demo");
const dbPath = path.join(dbDir, "app.json");

const prompt = `请基于已学习的爆款营销视频结构，把这个素材重构成一个 15 秒竖屏短视频。
主题：便携式桌面加湿器
目标用户：办公室久坐人群、学生
卖点：小巧便携、静音、USB 供电、柔和夜灯、缓解干燥
风格：快节奏、字幕明显、带 MG 风格卖点卡片
CTA：点击了解更多`;

const project = {
  id: "demo_v1_1_project",
  name: "Seed Demo v1.1 - Humidifier MG Promo",
  vertical: "b2b_marketing_mg",
  aspectRatio: "9:16",
  targetDurationSec: 15,
  createdAt: nowIso(),
  updatedAt: nowIso()
};

const sampleAsset = {
  id: "demo_sample_video",
  projectId: project.id,
  role: "example_video",
  type: "video",
  filename: "demo-sample-mg-promo.mp4",
  originalName: "demo-sample-mg-promo.mp4",
  mimeType: "video/mp4",
  metadata: { mock: true },
  tags: ["example", "b2b_marketing_mg"],
  status: "ready",
  createdAt: nowIso()
};

const sourceAsset = {
  id: "demo_source_video",
  projectId: project.id,
  role: "source_video",
  type: "video",
  filename: "demo-source-humidifier.mp4",
  originalName: "demo-source-humidifier.mp4",
  mimeType: "video/mp4",
  metadata: { mock: true },
  tags: ["product_like", "background"],
  status: "ready",
  createdAt: nowIso()
};

const sampleVideo = buildMockVideoAnalysis({
  assetId: sampleAsset.id,
  filename: sampleAsset.filename,
  purpose: "sample",
  durationSec: 15
});
const template = buildFallbackTemplate(sampleVideo, "b2b_marketing_mg", project.id);
const sourceVideo = buildMockVideoAnalysis({
  assetId: sourceAsset.id,
  filename: sourceAsset.filename,
  purpose: "source",
  durationSec: 30
});

const request = {
  schemaVersion: "1.1",
  projectId: project.id,
  inputMode: "video_plus_prompt",
  selectedTemplateIds: [template.id],
  knowledgeBaseScope: { vertical: "b2b_marketing_mg", preferLatest: true },
  sourceVideo: { assetId: sourceAsset.id, role: "source_video" },
  prompt,
  target: {
    vertical: "b2b_marketing_mg",
    targetDurationSec: 15,
    aspectRatio: "9:16",
    outputMode: "storyboard_preview"
  },
  controls: {
    pace: "fast",
    hookIntensity: "strong",
    packagingStyle: "mg_motion",
    ctaStyle: "direct",
    allowAigcPlaceholder: true,
    allowReorder: true
  },
  constraints: {
    doNotUseSampleVisuals: true,
    mustUseSourceVideo: true,
    maxClips: 8
  }
};

const generation = generateMigrationResult(template, request, sourceAsset, sourceVideo);

await fs.mkdir(dbDir, { recursive: true });
await fs.mkdir(demoDir, { recursive: true });

let db;
try {
  db = JSON.parse(await fs.readFile(dbPath, "utf8"));
} catch {
  db = {
    projects: [],
    assets: [],
    jobs: [],
    analyses: [],
    templates: [],
    generations: [],
    renders: []
  };
}

db.projects = [project, ...(db.projects ?? []).filter((item) => item.id !== project.id)];
db.assets = [
  sampleAsset,
  sourceAsset,
  ...(db.assets ?? []).filter((item) => item.id !== sampleAsset.id && item.id !== sourceAsset.id)
];
db.analyses = [
  {
    id: sampleVideo.id,
    projectId: project.id,
    assetId: sampleAsset.id,
    purpose: "sample",
    video: sampleVideo,
    template,
    createdAt: nowIso()
  },
  {
    id: sourceVideo.id,
    projectId: project.id,
    assetId: sourceAsset.id,
    purpose: "source",
    video: sourceVideo,
    createdAt: nowIso()
  },
  ...(db.analyses ?? []).filter((item) => item.assetId !== sampleAsset.id && item.assetId !== sourceAsset.id)
];
db.templates = [
  {
    id: template.id,
    projectId: project.id,
    sourceAssetId: sampleAsset.id,
    name: template.name,
    vertical: template.vertical,
    template,
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  ...(db.templates ?? []).filter((item) => item.id !== template.id)
];
db.generations = [generation, ...(db.generations ?? []).filter((item) => item.id !== generation.id)];
db.jobs = db.jobs ?? [];
db.renders = db.renders ?? [];

await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(demoDir, "generation-request.v1.1.json"), `${JSON.stringify(request, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(demoDir, "timeline.v1.1.json"), `${JSON.stringify(generation.timeline, null, 2)}\n`, "utf8");

console.log(`Seeded ${project.name}`);
console.log(`DB: ${dbPath}`);
console.log(`Fixtures: ${demoDir}`);
