import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.resolve(moduleDir, "..", "remotion", "index.tsx");

const RUN_REMOTION = process.env.RUN_REMOTION_BUNDLE_TEST === "true";

(RUN_REMOTION ? describe : describe.skip)("Remotion bundle smoke", () => {
  it("bundles the apps/api/remotion entry without throwing", async () => {
    const { bundle } = await import("@remotion/bundler");
    const loc = await bundle({ entryPoint });
    expect(typeof loc).toBe("string");
    expect(loc.length).toBeGreaterThan(0);
  }, 120_000);
});
