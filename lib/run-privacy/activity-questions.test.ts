import { beforeEach, expect, it, vi } from "vitest";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord } from "../types";
const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.db }));
import { GET } from "../../app/api/activity/route";

beforeEach(() => vi.clearAllMocks());
function payment(id: string, queryId: string, amountUsdc: number, extra: Partial<PaymentRecord> = {}): PaymentRecord {
  return { id, queryId, kind: "citation", sourceId: "source_" + id, sourceName: "Source " + id, amountUsdc,
    payer: "0x" + "a".repeat(40), payee: "0x" + "b".repeat(40), settled: true, txHash: "0x" + "c".repeat(64),
    createdAt: "2026-11-04T00:00:00Z", origin: "web", itemId: "item_" + id, itemTitle: "Original " + id,
    itemUrl: "https://synthetic.example/" + id, contentVersion: "version_" + id, itemPublishedAt: "2026-11-03T00:00:00Z", ...extra } as PaymentRecord;
}
function expected(row: PaymentRecord, question: string | null) {
  return { sourceId: row.sourceId, sourceName: row.sourceName, itemId: row.itemId ?? null, itemTitle: row.itemTitle ?? null,
    itemUrl: row.itemUrl ?? null, contentVersion: row.contentVersion ?? null, itemPublishedAt: row.itemPublishedAt ?? null,
    question, rewardUsdc: row.amountUsdc, origin: row.origin ?? "engine", createdAt: row.createdAt };
}

it("keeps the actual settled-citation payload/order/amounts while enriching questions once", async () => {
  const payments = [payment("a", "public", 0.000001), payment("fetch", "public", 0.123456, { kind: "fetch" }),
    payment("pending", "private", 0.2, { settled: false }), payment("b", "private", 0.000002), payment("c", "public", 0.000003)];
  const original = structuredClone(payments), listPayments = vi.fn(async () => payments);
  const questions = vi.fn(async () => [{ id: "public", question: "Canonical public question" }]);
  const list = vi.fn(() => { throw Error("Full originals are forbidden"); }), legacy = vi.fn(() => { throw Error("Legacy is forbidden"); });
  mocks.db.mockResolvedValue({ listPayments, runPrivacyActive: true, runPrivacy: { questions, list }, getQueryRun: legacy });
  const response = await GET(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ activity: [expected(payments[0], "Canonical public question"), expected(payments[3], null), expected(payments[4], "Canonical public question")] });
  expect(payments).toEqual(original); expect(listPayments).toHaveBeenCalledExactlyOnceWith(80);
  expect(questions).toHaveBeenCalledExactlyOnceWith(["public", "private"]); expect(list).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled();
});

it("keeps the 15-settled-row limit and at most15 deduplicated question IDs", async () => {
  const payments = Array.from({ length: 30 }, (_, index) => payment(String(index), "q_" + index, index / 1_000_000));
  const questions = vi.fn(async () => []);
  mocks.db.mockResolvedValue({ listPayments: async () => payments, runPrivacyActive: true, runPrivacy: { questions } });
  expect(await (await GET()).json()).toEqual({ activity: payments.slice(0, 15).map(row => expected(row, null)) });
  expect(questions).toHaveBeenCalledExactlyOnceWith(Array.from({ length: 15 }, (_, index) => "q_" + index));
});

it("preserves equivalent payloads through the existing list fallback and captured inactive legacy path", async () => {
  const payments = [payment("a", "q", 0.000001)], list = vi.fn(async () => [{ id: "q", question: "Question" }]);
  const db = { listPayments: async () => payments, runPrivacyActive: true, runPrivacy: { list } } as unknown as KeryxDB;
  mocks.db.mockResolvedValue(db); const active = await (await GET()).text();
  expect(list).toHaveBeenCalledExactlyOnceWith({ take: 1, ids: ["q"] });
  const legacy = vi.fn(async () => ({ question: "Question" }));
  mocks.db.mockResolvedValue({ ...db, runPrivacyActive: false, getQueryRun: legacy });
  expect(await (await GET()).text()).toBe(active); expect(legacy).toHaveBeenCalledExactlyOnceWith("q");
});

it("keeps genuine empty activity separate from an active privacy failure and never retries raw reads", async () => {
  mocks.db.mockResolvedValue({ listPayments: async () => [], runPrivacyActive: true });
  expect(await (await GET()).json()).toEqual({ activity: [] });
  const questions = vi.fn(async () => { throw Error("privacy_unavailable"); }), list = vi.fn(), legacy = vi.fn();
  mocks.db.mockResolvedValue({ listPayments: async () => [payment("a", "q", 0.000001)], runPrivacyActive: true,
    runPrivacy: { questions, list }, getQueryRun: legacy });
  const response = await GET(); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ error: "privacy_unavailable", activity: [] });
  expect(questions).toHaveBeenCalledOnce(); expect(list).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled();
});
