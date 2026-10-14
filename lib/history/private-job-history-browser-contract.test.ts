import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { privateResearchIdSchema, privateHistoryCursorSchema } from "../a2a/private-research-identifiers";
import { privateJobPositionSchema, privateJobHistoryDetailInputSchema, privateJobHistoryCursorSchema } from "./private-job-history-contract";

// A reachable server dependency must fail this import, without opening any DB.
vi.mock("../db/private-research-intents", () => { throw new Error("Browser contract reached server storage"); });
const id = `prv_${"a".repeat(64)}`;
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("retains the exact ID/cursor instances and compatible server re-exports", () => {
  expect(privateHistoryCursorSchema.shape.id).toBe(privateResearchIdSchema);
  expect(privateJobPositionSchema.shape.id).toBe(privateResearchIdSchema);
  expect(privateJobHistoryDetailInputSchema.shape.id).toBe(privateResearchIdSchema);
  expect(source("../a2a/private-research-intent.ts")).toContain('export { privateResearchIdSchema } from "./private-research-identifiers";');
  expect(source("../db/private-research-intents.ts")).toContain('export { privateHistoryCursorSchema } from "../a2a/private-research-identifiers";');
});

it("matches the pre-extraction validators including offset dates and strict keys", () => {
  const oldId = z.string().regex(/^prv_[a-f0-9]{64}$/);
  const oldCursor = z.object({ createdAt: z.string().datetime({ offset: true }), id: oldId }).strict();
  const inputs: unknown[] = [
    { id, createdAt: "2026-10-14T00:00:00Z" },
    { id, createdAt: "2026-10-14T00:00:00.123456+00:00" },
    { id, createdAt: "2026-10-14T07:00:00+07:00" },
    { id, createdAt: "2026-10-14T00:00:00" },
    { id, createdAt: "2026-02-30T00:00:00Z" },
    { id: id.toUpperCase(), createdAt: "2026-10-14T00:00:00Z" },
    { id: id + "a", createdAt: "2026-10-14T00:00:00Z" },
    { id, createdAt: "2026-10-14T00:00:00Z", wallet: "foreign" },
    { id }, null, [],
  ];
  for (const input of inputs) {
    const before = oldCursor.safeParse(input), after = privateHistoryCursorSchema.safeParse(input);
    expect(after.success).toBe(before.success);
    if (before.success && after.success) expect(after.data).toEqual(before.data);
  }
  expect(privateHistoryCursorSchema.parse(inputs[2])).toEqual(inputs[2]);
  expect(privateJobPositionSchema.safeParse(inputs[2]).success).toBe(false); // The existing Web contract is UTC-only.
  expect(privateResearchIdSchema.safeParse(`prv_${"A".repeat(64)}`).success).toBe(false);
  expect(privateResearchIdSchema.safeParse(`prv_${"a".repeat(63)}`).success).toBe(false);
  expect(privateHistoryCursorSchema.safeParse(inputs[7]).success).toBe(false);
});

it("keeps strict browser cursor positions and the narrow pure dependency boundary", () => {
  const position = { id, createdAt: "2026-10-14T00:00:00.123456+00:00" };
  const cursor = { format: "private-job-history-cursor-v1", owner: "a".repeat(64), query: "b".repeat(64), upper: position, before: position };
  expect(privateJobHistoryCursorSchema.parse(cursor)).toEqual(cursor);
  expect(privateJobHistoryCursorSchema.safeParse({ ...cursor, before: { ...position, credential: "foreign" } }).success).toBe(false);
  expect(privateJobHistoryCursorSchema.safeParse({ ...cursor, before: { ...position, createdAt: "2026-10-14T00:00:00.123457Z" } }).success).toBe(false);
  const pure = source("../a2a/private-research-identifiers.ts");
  expect(pure.match(/^import .+$/gm)).toEqual(['import { z } from "zod";']);
  expect(pure).not.toMatch(/\b(?:require|import)\s*\(|node:|\/db\//);
  const contract = source("./private-job-history-contract.ts");
  expect(contract).toContain('import { privateHistoryCursorSchema } from "../a2a/private-research-identifiers";');
  expect(contract).not.toMatch(/(?:from\s*["'][^"']*\/db\/|node:|\brequire\s*\()/);
});
