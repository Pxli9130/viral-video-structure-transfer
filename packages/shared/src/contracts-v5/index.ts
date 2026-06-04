// contracts-v5/index.ts — canonical v5 contract surface.
// Re-exported from @vvst/shared (packages/shared/src/index.ts) under the contracts-v5 namespace so
// V5 pipeline modules import from "@vvst/shared". V4 exports are untouched (V5 runs in parallel).

export * from "./common.js";
export * from "./evidence.js";
export * from "./neutralProgram.js";
export * from "./knowledge.js";
export * from "./composition.js";
export * from "./finalProgram.js";
export * from "./scorecard.js";
export * from "./gates.js";
export * as v5Schemas from "./schemas.js";
export * from "./validation.js";
