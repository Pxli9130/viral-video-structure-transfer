#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "docs", "artifacts", "motion_graph_case");
const fixtureDir = path.join(repoRoot, "docs", "fixtures", "motion_graph_target_assets");
const outputPath = path.join(artifactDir, "render-asset-check.json");

function resolvePython() {
  const explicit = process.env.PYTHON_BIN;
  if (explicit) return explicit;
  const condaBase = process.env.CONDA_BASE ?? path.join(process.env.HOME ?? "", "anaconda3");
  const condaEnv = process.env.VIRAL_CONDA_ENV ?? "viral";
  const condaPy = path.join(condaBase, "envs", condaEnv, "bin", "python");
  return existsSync(condaPy) ? condaPy : "python3";
}

function runPython(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePython(), ["-c", code, repoRoot], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (codeValue) => {
      if (codeValue !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `python exited ${codeValue}`));
        return;
      }
      resolve(stdout);
    });
  });
}

const python = String.raw`
import cv2, json, os, sys
import numpy as np

repo = sys.argv[1]
artifact = os.path.join(repo, "docs", "artifacts", "motion_graph_case")
fixture = os.path.join(repo, "docs", "fixtures", "motion_graph_target_assets")

def read_frame(video_path, sec):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video_path}")
    cap.set(cv2.CAP_PROP_POS_MSEC, sec * 1000.0)
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise RuntimeError(f"cannot read frame at {sec}s from {video_path}")
    return frame

def fit_card(img, width, height, bg=(39, 24, 17)):
    h, w = img.shape[:2]
    scale = min(width / float(w), height / float(h))
    resized = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))))
    canvas = np.full((height, width, 3), bg, dtype=np.uint8)
    y = (height - resized.shape[0]) // 2
    x = (width - resized.shape[1]) // 2
    canvas[y:y + resized.shape[0], x:x + resized.shape[1]] = resized
    return canvas

def mean_diff(a, b):
    return float(cv2.absdiff(a, b).mean()) / 255.0

def card_scores(frame, card_path):
    img = cv2.imread(card_path)
    if img is None:
        raise RuntimeError(f"cannot read card {card_path}")
    height, width = frame.shape[:2]
    card_w = round(width * 0.42)
    card_h = round(height * 0.32)
    positions = [
        (round(width * 0.12), round(height * 0.22)),
        (round(width * 0.46), round(height * 0.18)),
        (round(width * 0.18), round(height * 0.54)),
        (round(width * 0.50), round(height * 0.50)),
    ]
    expected = fit_card(img, card_w, card_h)
    scores = []
    for x, y in positions:
        patch = frame[y:y + card_h, x:x + card_w]
        if patch.shape[:2] != expected.shape[:2]:
            scores.append(1.0)
        else:
            scores.append(mean_diff(patch, expected))
    return scores

def logo_score(frame, logo_path):
    img = cv2.imread(logo_path)
    if img is None:
        raise RuntimeError(f"cannot read logo {logo_path}")
    height, width = frame.shape[:2]
    logo = round(min(width, height) * 0.28)
    x = round((width - logo) / 2)
    y = round(height * 0.25)
    expected = fit_card(img, logo, logo, bg=(255, 255, 255))
    patch = frame[y:y + logo, x:x + logo]
    if patch.shape[:2] != expected.shape[:2]:
        return 1.0
    return mean_diff(patch, expected)

with_frame = read_frame(os.path.join(artifact, "render_with_assets.mp4"), 1.0)
malformed_frame = read_frame(os.path.join(artifact, "render_malformed_assets.mp4"), 1.0)
cta_frame = read_frame(os.path.join(artifact, "render_with_assets.mp4"), 12.2)

threshold = 0.18
cards = {}
for index in [1, 2, 3, 4]:
    card_path = os.path.join(fixture, f"card_0{index}.png")
    cards[f"card_0{index}"] = {
        "withAssetsBestDiff": min(card_scores(with_frame, card_path)),
        "malformedBestDiff": min(card_scores(malformed_frame, card_path)),
    }

blocked_wrong_role = {
    "malformedBestDiff": min(card_scores(malformed_frame, os.path.join(fixture, "blocked_wrong_role.png")))
}
logo = {"withAssetsBestDiff": logo_score(cta_frame, os.path.join(fixture, "logo.png"))}
gates = [
    {
        "id": "render_with_assets_has_user_card_images",
        "passed": all(cards[f"card_0{i}"]["withAssetsBestDiff"] <= threshold for i in [1, 2, 3, 4]),
        "value": {k: round(v["withAssetsBestDiff"], 4) for k, v in cards.items()},
    },
    {
        "id": "render_with_assets_has_user_logo",
        "passed": logo["withAssetsBestDiff"] <= threshold,
        "value": round(logo["withAssetsBestDiff"], 4),
    },
    {
        "id": "render_malformed_keeps_valid_cards",
        "passed": cards["card_01"]["malformedBestDiff"] <= threshold and cards["card_02"]["malformedBestDiff"] <= threshold,
        "value": {k: round(cards[k]["malformedBestDiff"], 4) for k in ["card_01", "card_02"]},
    },
    {
        "id": "render_malformed_omits_blocked_wrong_role_card",
        "passed": blocked_wrong_role["malformedBestDiff"] > threshold,
        "value": round(blocked_wrong_role["malformedBestDiff"], 4),
    },
]

print(json.dumps({
    "schemaVersion": "motion-graph-render-asset-check-v1",
    "threshold": threshold,
    "cards": cards,
    "blockedWrongRole": blocked_wrong_role,
    "logo": logo,
    "gates": gates,
    "passed": all(g["passed"] for g in gates),
}, indent=2))
`;

await mkdir(artifactDir, { recursive: true });
const result = JSON.parse(await runPython(python));
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
for (const gate of result.gates) {
  console.log(`${gate.passed ? "PASS" : "FAIL"} ${gate.id}: ${JSON.stringify(gate.value)}`);
}
console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
if (!result.passed) process.exit(1);
