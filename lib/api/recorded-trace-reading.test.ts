import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { validatePrivacyRun } from "../run-privacy/contracts";
import { presentationRun } from "../research/presentation.test-fixture";

const mocked = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocked.getDb }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
import { GET } from "@/app/api/dispatch/[id]/route";

const id = "bb067ee3-6fc9-441e-a54f-05af8e64a716";
function run(extra: Record<string, unknown> = {}) {
  return validatePrivacyRun(JSON.parse(JSON.stringify({ ...presentationRun(), id,
    trace: [null, { phase: "future-observation", message: "Retained future event", ts: 1 }], ...extra })), id);
}
function request() { return GET(new NextRequest(`https://keryx.test/api/dispatch/${id}`), { params: Promise.resolve({ id }) }); }

it("serves the actual public GET with opaque history, preserving the stored answer and trace", async () => {
  const original = run(), before = JSON.stringify(original), read = vi.fn(async () => ({ exists: true, item: { run: original, state: { visibility: "public", revision: 0, erased: false } } }));
  mocked.getDb.mockResolvedValue({ runPrivacy: { read } });
  const response = await request(), result = await response.json();
  expect(response.status).toBe(200); expect(read).toHaveBeenCalledOnce();
  expect(result.answer).toBe(original.answer); expect(result.trace).toEqual(original.trace);
  expect(result.totalSpent).toBe(original.totalSpent); expect(result.totalToCreators).toBe(original.totalToCreators);
  expect(JSON.stringify(original)).toBe(before);
});
it("keeps private and future checkpoint sidecars out of the actual GET beside a null entry", async () => {
  const original = run({ originalFulfillment: {}, sourceLearning: { privateMarker: "PRIVATE_LEARNING_SENTINEL" },
    trace: [null, { phase: "done", message: "Retained entry", ts: 1, readCheckpoints: { status: "available", packet: { schema: 999, question: "PRIVATE_CHECKPOINT_SENTINEL" }, retainedDigest: "a".repeat(64) } }] });
  const before = JSON.stringify(original);
  mocked.getDb.mockResolvedValue({ runPrivacy: { read: async () => ({ exists: true, item: { run: original, state: { visibility: "public", revision: 0, erased: false } } }) } });
  const response = await request(), result = await response.json();
  expect(response.status).toBe(200); expect(result.trace).toEqual([null, { phase: "done", message: "Retained entry", ts: 1 }]);
  expect(result).not.toHaveProperty("originalFulfillment"); expect(result).not.toHaveProperty("sourceLearning");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_"); expect(JSON.stringify(original)).toBe(before);
});
it("preserves the real unavailable response on storage failure without a legacy read fallback", async () => {
  const legacy = vi.fn(); mocked.getDb.mockResolvedValue({ getQueryRun: legacy, runPrivacy: { read: async () => { throw Error("PRIVATE_STORAGE_SENTINEL"); } } });
  const response = await request();
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "dispatch unavailable" }); expect(legacy).not.toHaveBeenCalled();
});
