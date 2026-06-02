#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "artifacts/model-routes");
const OUT_JSON = path.join(OUT_DIR, "elevenlabs-connection.json");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envFlag(key) {
  return /^(1|true|yes|on)$/i.test(process.env[key]?.trim() ?? "");
}

async function getJson(endpoint, apiKey, baseUrl) {
  const res = await fetch(`${baseUrl}${endpoint}`, { headers: { "xi-api-key": apiKey } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpoint} failed ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotenv(path.join(ROOT, ".env"));
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const baseUrl = (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io/v1").replace(/\/+$/, "");
  const allowCloud = args["allow-cloud"] === true || envFlag("ENABLE_ELEVENLABS_LIVE_TESTS") || envFlag("ELEVENLABS_ENABLE_DISCOVERY");
  const report = {
    generatedAt: new Date().toISOString(),
    status: "not_run",
    configured: Boolean(apiKey),
    key: apiKey ? `SET(len=${apiKey.length})` : "missing",
    baseUrl,
    allowCloud,
    checks: {}
  };

  if (!apiKey) {
    report.status = "missing_key";
  } else if (!allowCloud) {
    report.status = "configured_cloud_disabled";
    report.reason = "Pass --allow-cloud or set ENABLE_ELEVENLABS_LIVE_TESTS=1 / ELEVENLABS_ENABLE_DISCOVERY=1 for read-only live verification.";
  } else {
    const [userResult, modelsResult, voicesResult] = await Promise.allSettled([
      getJson("/user", apiKey, baseUrl),
      getJson("/models", apiKey, baseUrl),
      getJson("/voices", apiKey, baseUrl)
    ]);
    const models = modelsResult.status === "fulfilled" ? modelsResult.value : undefined;
    const voices = voicesResult.status === "fulfilled" ? voicesResult.value : undefined;
    const requiredPassed = Array.isArray(models) && Array.isArray(voices?.voices);
    report.status = requiredPassed ? "pass" : "failed";
    report.checks = {
      user: {
        ok: userResult.status === "fulfilled",
        optional: true,
        ...(userResult.status === "fulfilled"
          ? { subscription: typeof userResult.value?.subscription === "object" ? "present" : "not_returned" }
          : { error: String(userResult.reason?.message ?? userResult.reason) })
      },
      models: {
        ok: Array.isArray(models),
        count: Array.isArray(models) ? models.length : 0,
        ttsCapable: Array.isArray(models) ? models.filter((model) => model?.can_do_text_to_speech).length : 0,
        ...(modelsResult.status === "rejected" ? { error: String(modelsResult.reason?.message ?? modelsResult.reason) } : {})
      },
      voices: {
        ok: Array.isArray(voices?.voices),
        count: Array.isArray(voices?.voices) ? voices.voices.length : 0,
        ...(voicesResult.status === "rejected" ? { error: String(voicesResult.reason?.message ?? voicesResult.reason) } : {})
      }
    };
  }

  await mkdir(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, configured: report.configured, allowCloud: report.allowCloud, out: OUT_JSON, checks: report.checks }, null, 2));
  if (report.status !== "pass" && args.strict) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
