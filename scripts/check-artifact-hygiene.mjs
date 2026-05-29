#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { artifactRoot, repoRoot } from "./artifact-paths.mjs";

const roots = [
  artifactRoot,
  path.join(repoRoot, "docs", "fixtures")
];

const textExtensions = new Set([".html", ".md", ".json", ".txt", ".csv", ".js", ".mjs"]);
const forbiddenPatterns = [
  { label: "absolute local path", pattern: /\/home\/pxli/ },
  { label: "dot-env reference", pattern: /\.env\b/ },
  { label: "Gemini key name", pattern: /GEMINI_API_KEY/i },
  { label: "Google API key prefix", pattern: /AIza[0-9A-Za-z_-]+/ },
  { label: "Ark API key prefix", pattern: /ark-[0-9A-Za-z_-]+/i }
];

async function walk(root, files = []) {
  if (!existsSync(root)) return files;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

function rel(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

const files = [];
for (const root of roots) {
  await walk(root, files);
}

const findings = [];
for (const file of files) {
  const body = await readFile(file, "utf8");
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(lines[index])) {
        findings.push({ file: rel(file), line: index + 1, pattern: label });
      }
    }
  }
}

if (findings.length) {
  console.error("Artifact hygiene check failed:");
  for (const finding of findings.slice(0, 80)) {
    console.error(`- ${finding.file}:${finding.line} ${finding.pattern}`);
  }
  if (findings.length > 80) console.error(`- ... ${findings.length - 80} more finding(s)`);
  process.exit(1);
}

console.log("Artifact hygiene check passed.");
console.log(`- scanned files: ${files.length}`);
console.log(`- roots: ${roots.map(rel).join(", ")}`);
