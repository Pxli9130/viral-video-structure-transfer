import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const CONDA_BASE = process.env.CONDA_BASE ?? "/home/pxli/anaconda3";
const CONDA_ENV = process.env.VIRAL_CONDA_ENV ?? "viral";
const PYTHON_BIN = path.join(CONDA_BASE, "envs", CONDA_ENV, "bin", "python");

let cachedAvailability: boolean | undefined;

export function hasCondaEnv(): boolean {
  if (cachedAvailability === undefined) {
    cachedAvailability = existsSync(PYTHON_BIN);
  }
  return cachedAvailability;
}

export interface PythonResult {
  stdout: string;
  stderr: string;
}

export async function runPython(scriptPath: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<PythonResult> {
  const python = hasCondaEnv() ? PYTHON_BIN : "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, [scriptPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, PATH: `${path.join(CONDA_BASE, "envs", CONDA_ENV, "bin")}:${process.env.PATH ?? ""}` }
    });
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Python script ${scriptPath} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Python exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
