import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryRun } from "@/lib/types";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { GET } from "@/app/api/dispatch/[id]/receipt/route";

const run: QueryRun = {
  id: "dispatch-1",
  question: "What is a research receipt?",
  budget: 0.05,
  engine: "llm:test",
  subClaims: ["A receipt binds public evidence."],
  decisions: [],
  citations: [],
  evidence: [],
  claimCoverage: [
    { claimIndex: 0, claim: "A receipt binds public evidence.", coverage: 0, coveredBy: [] },
  ],
  answer: "No source qualified.",
  totalSpent: 0,
  totalToCreators: 0,
  trace: [],
  createdAt: "2026-08-23T00:00:00.000Z",
  paymentMode: "real",
  settledPayments: 0,
  pendingPayments: 0,
};

describe("GET /api/dispatch/[id]/receipt", () => {
  beforeEach(() => mocks.getDb.mockReset());

  it("returns a no-store receipt, digest header and safe attachment filename", async () => {
    mocks.getDb.mockResolvedValue({
      getQueryRun: vi.fn().mockResolvedValue(run),
      listPaymentsByQuery: vi.fn().mockResolvedValue([]),
    });
    const response = await GET(
      new Request("https://keryx.test/api/dispatch/dispatch-1/receipt?download=1"),
      { params: Promise.resolve({ id: "dispatch-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="keryx-receipt-dispatch-1.json"',
    );
    expect(response.headers.get("x-keryx-receipt-digest")).toBe(body.integrity.digest);
    expect(body.payload).toMatchObject({
      schema: "urn:keryx:research-receipt:1",
      dispatch: { id: run.id },
      settlement: { status: "none", ledgerCompleteness: "complete" },
    });
  });

  it("returns 404 for an unknown dispatch and a generic 503 on adapter failure", async () => {
    mocks.getDb.mockResolvedValueOnce({
      getQueryRun: vi.fn().mockResolvedValue(null),
    });
    const missing = await GET(
      new Request("https://keryx.test/api/dispatch/missing/receipt"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(missing.status).toBe(404);

    mocks.getDb.mockRejectedValueOnce(new Error("private database details"));
    const failed = await GET(
      new Request("https://keryx.test/api/dispatch/dispatch-1/receipt"),
      { params: Promise.resolve({ id: "dispatch-1" }) },
    );
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ error: "receipt unavailable" });
  });
});
