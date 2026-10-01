import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createOperatorGatewayFundingComposition, OPERATOR_GATEWAY_FUNDING_ACTIVATION } from "./gateway-funding-composition";

describe("dormant Operator funding release", () => {
  it("refuses supplied authority, environment opt-in and key loading", async () => {
    const loadKeys = vi.fn(() => { throw new Error("keys must remain unloaded"); });
    const request = Object.defineProperty({ loadKeys, enabled: true, reviewedBinding: {} }, "identity", {
      get() { throw new Error("untrusted binding must remain unread"); },
    });
    vi.stubEnv("KERYX_OPERATOR_FUNDING_ENABLED", "1");
    try {
      expect(OPERATOR_GATEWAY_FUNDING_ACTIVATION.state).toBe("disabled");
      await expect(createOperatorGatewayFundingComposition(request)).rejects.toThrow("reviewed enrollment and cutover required");
      expect(loadKeys).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps funding and storage enrollment absent from application runtime imports", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : /\.(?:ts|tsx|mts)$/.test(entry.name) ? [path] : [];
    });
    const roots = [...files(join(process.cwd(), "app")), ...files(join(process.cwd(), "lib"))];
    const dormant = /(?:gateway-funding-|storage-identity|supabase-authority|runtime-storage-config)/;
    for (const file of roots) {
      const name = relative(process.cwd(), file).replaceAll("\\", "/");
      if (dormant.test(name) || /(?:\.test\.|-fixture\.)/.test(name)) continue;
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/(?:from\s*|import\s*\(?)['"]([^'"]+)['"]/g)].map(match => match[1]);
      expect(imports.filter(value => dormant.test(value)), name).toEqual([]);
    }
    const composition = readFileSync(join(process.cwd(), "lib/operator/gateway-funding-composition.ts"), "utf8");
    expect(composition).not.toMatch(/\bimport\s*\(/);
  });
});
