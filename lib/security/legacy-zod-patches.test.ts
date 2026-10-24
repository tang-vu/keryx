import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { patchLegacyZod } from "../../scripts/patch-legacy-zod.mjs";
import manifest from "../../scripts/legacy-zod-patches.json";

it("verifies the installed patched cohort without mutating it", () => {
  expect(patchLegacyZod(process.cwd())).toBe(0);
});

it("refuses tampered vendor bytes before performing any pending patch", () => {
  const temporary = mkdtempSync(join(tmpdir(), "keryx-legacy-zod-"));
  try {
    for (const row of [...manifest.runtime, ...manifest.imports]) {
      const root = join(temporary, "node_modules", row.package);
      mkdirSync(dirname(join(root, row.path)), { recursive: true });
      writeFileSync(join(root, "package.json"), JSON.stringify({ version: row.version }));
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
