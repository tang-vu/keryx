import { expect, it } from "vitest";
import { z } from "zod";
import { z as legacy } from "zod/v3";
import { createRequire } from "node:module";

const commonjs = createRequire(import.meta.url)("zod/v3").z as typeof legacy;

it.each(["sync", "async"] as const)("rejects an oversized constrained array before inspecting elements (%s)", async mode => {
  const values = new Array(100000);
  let inspected = false;
  Object.defineProperty(values, "0", { get() { inspected = true; throw new Error("Oversized payload element was inspected"); } });
  const schema = z.array(z.object({ value: z.string() })).max(1);
  const result = mode === "sync" ? schema.safeParse(values) : await schema.safeParseAsync(values);
  expect(result.success).toBe(false);
  expect(inspected).toBe(false);
  if (!result.success) expect(result.error.issues).toHaveLength(1);
});

for (const [name, runtime] of [["legacy ESM", legacy], ["legacy CJS", commonjs]] as const) {
  for (const bound of ["max", "length"] as const) {
    it.each(["sync", "async"] as const)(`${name} ${bound} rejects oversized input before element access (%s)`, async mode => {
      const values = new Array(100000);
      let inspected = false;
      Object.defineProperty(values, "0", { get() { inspected = true; throw new Error("Inspected over-limit input"); } });
      const schema = runtime.array(runtime.object({ value: runtime.string() }))[bound](1);
      const result = mode === "sync" ? schema.safeParse(values) : await schema.safeParseAsync(values);
      expect(result.success).toBe(false);
      expect(inspected).toBe(false);
      if (!result.success) expect(result.error.issues).toHaveLength(1);
      expect(schema.parse([{ value: "valid" }])).toEqual([{ value: "valid" }]);
      expect(schema.safeParse([{ value: 42 }]).success).toBe(false);
    });
  }
}
