import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_PACKAGE_FILES = Object.freeze(["package.json", "README.md", "dist/keryx-mcp.mjs", "dist/build-inputs.json",
  "LICENSE-APACHE-2.0.txt", "LICENSE-ZOD.txt", "THIRD-PARTY-NOTICES.txt"]);
export function assertMcpPackageFiles(pack) {
  assert(Array.isArray(pack.files), "Missing npm pack file inventory");
  const paths = pack.files.map(file => file.path);
  assert.deepEqual([...paths].sort(), [...MCP_PACKAGE_FILES].sort(), "Unexpected or missing MCP package file");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packs = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
  assert.equal(packs.length, 1); assertMcpPackageFiles(packs[0]);
}
