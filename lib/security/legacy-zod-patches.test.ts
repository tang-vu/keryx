import { expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { patchLegacyZod } from "../../scripts/patch-legacy-zod.mjs";
import manifest from "../../scripts/legacy-zod-patches.json";

it("verifies the installed patched cohort without mutating it", () => {
  expect(patchLegacyZod(process.cwd())).toBe(0);
});

it("refuses tampered vendor bytes before performing any pending patch", () => {
  const temporary = mkdtempSync(join(tmpdir(), "keryx-legacy-zod-"));
  try {
    for (const row of [manifest.entry, ...manifest.runtime, ...manifest.imports]) {
      const root = join(temporary, "node_modules", row.package);
      mkdirSync(dirname(join(root, row.path)), { recursive: true });
      if (!existsSync(join(root, "package.json"))) writeFileSync(join(root, "package.json"), JSON.stringify({ version: row.version }));
      writeFileSync(join(root, row.path), readFileSync(join(process.cwd(), "node_modules", row.package, row.path)));
    }
    const first = join(temporary, "node_modules", "zod/v3/types.js");
    const original = readFileSync(first, "utf8").replace(/^\/\/ Keryx security backport:[^\n]*\n/, "")
      .replace("\n                if (tooBig) return INVALID;", "").replace("                return INVALID;\n            }\n        }\n        if (ctx.common.async)", "                status.dirty();\n            }\n        }\n        if (ctx.common.async)");
    writeFileSync(first, original);
    const bad = manifest.imports[0];
    writeFileSync(join(temporary, "node_modules", bad.package, bad.path), "tampered");
    expect(() => patchLegacyZod(temporary)).toThrow("Unexpected legacy validation bytes");
    expect(readFileSync(first, "utf8")).toBe(original);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

it.each([
  ["linux-contained-snapshot", ["scripts/test-storage-provenance-capacity.mts", "scripts/postgres/test-online-snapshot.mts"]],
  ["development-offline-intake", ["scripts/postgres/qualify-offline-intake.mts"]],
] as const)("requires the verified security patch before every bounded %s worker", (name, workers) => {
  const yaml = createRequire(import.meta.url)("js-yaml") as { load: (wire: string) => unknown };
  type Step = { run?: string; if?: string; "continue-on-error"?: boolean };
  const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/storage-provenance-capacity.yml", import.meta.url), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const steps = workflow.jobs[name].steps;
  const install = steps.findIndex(step => step.run === "npm ci --ignore-scripts --no-audit --no-fund");
  expect(install).toBeGreaterThanOrEqual(0);
  const patches = steps.filter(step => step.run === "node scripts/patch-legacy-zod.mjs");
  expect(patches).toHaveLength(1);
  expect(steps[install + 1]).toBe(patches[0]);
  expect(patches[0].if).toBeUndefined();
  expect(patches[0]["continue-on-error"]).toBeUndefined();
  for (const worker of workers) {
    const index = steps.findIndex(step => step.run?.includes(worker));
    expect(index).toBeGreaterThan(install + 1);
  }
});
