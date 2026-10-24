import { expect, it } from "vitest";
import { z } from "zod";
import { z as nativeV4 } from "zod/v4";
import { z as legacy } from "zod/v3";
import { createRequire } from "node:module";

const commonjs = createRequire(import.meta.url)("zod/v3").z as typeof legacy;

it("retains root UTF-16 limits and refinement wrapping", () => {
  expect(z.string().max(1).safeParse("🧪").success).toBe(false);
  expect(z.string().length(2).parse("🧪")).toBe("🧪");
  const shape = z.object({ value: z.string() });
  expect(shape.refine(() => true).innerType()).toBe(shape);
});

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

const runtimes = [
  ["root ESM", (bound: "max" | "length") => z.array(z.object({ value: z.string() }))[bound](1)],
  ["legacy ESM", (bound: "max" | "length") => legacy.array(legacy.object({ value: legacy.string() }))[bound](1)],
  ["legacy CJS", (bound: "max" | "length") => commonjs.array(commonjs.object({ value: commonjs.string() }))[bound](1)],
  ["native v4", (bound: "max" | "length") => nativeV4.array(nativeV4.object({ value: nativeV4.string() }))[bound](1)],
] as const;
for (const [name, schemaFor] of runtimes) {
  for (const bound of ["max", "length"] as const) {
    it.each(["sync", "async"] as const)(`${name} ${bound} rejects oversized input before element access (%s)`, async mode => {
      const values = new Array(100000);
      let inspected = false;
      Object.defineProperty(values, "0", { get() { inspected = true; throw new Error("Inspected over-limit input"); } });
      const schema = schemaFor(bound);
      const result = mode === "sync" ? schema.safeParse(values) : await schema.safeParseAsync(values);
      expect(result.success).toBe(false);
      expect(inspected).toBe(false);
      if (!result.success) expect(result.error.issues).toHaveLength(1);
      expect(schema.parse([{ value: "valid" }])).toEqual([{ value: "valid" }]);
      expect(schema.safeParse([{ value: 42 }]).success).toBe(false);
    });
  }
}
