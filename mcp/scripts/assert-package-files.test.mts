import { expect, it } from "vitest";
import { assertMcpPackageFiles, MCP_PACKAGE_FILES } from "./assert-package-files.mjs";

const pack = (paths: readonly string[]) => ({ files: paths.map(path => ({ path })) });
it("requires exactly the executable, manifest, README, provenance and all third-party notices/licenses", () => {
  expect(() => assertMcpPackageFiles(pack(MCP_PACKAGE_FILES))).not.toThrow();
  for (const missing of MCP_PACKAGE_FILES) expect(() => assertMcpPackageFiles(pack(MCP_PACKAGE_FILES.filter(path => path !== missing)))).toThrow();
});
it("refuses unexpected files, duplicate entries and credential/traversal paths", () => {
  for (const added of [".env.local", "dist/keys.json", "../README.md", MCP_PACKAGE_FILES[0]]) {
    expect(() => assertMcpPackageFiles(pack([...MCP_PACKAGE_FILES, added]))).toThrow();
  }
});
