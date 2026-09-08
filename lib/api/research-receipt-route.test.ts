import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentRecord, QueryRun } from "@/lib/types";
import { verifyResearchReceipt } from "@/lib/research-receipt";

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
      listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([]),
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

  it.each([false, true])("includes access tolls alongside citation rewards; pending access=%s", async (pending) => {
    const payment: PaymentRecord = {
      kind: "citation", queryId: run.id, sourceId: "source-1", sourceName: "Source",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222", amountUsdc: 0.015,
      network: "eip155:5042002", settled: true, settlementStatus: "settled",
      txHash: "2bdee39e-36c2-4167-970b-8ae1c4d851d8", createdAt: run.createdAt,
    };
    const access: PaymentRecord = { ...payment, kind: "fetch", amountUsdc: 0.002,
      settled: !pending, settlementStatus: pending ? "pending" : "settled",
      txHash: pending ? null : "6f297e8c-ae3b-4d05-9fcf-44b84e20bba5" };
    mocks.getDb.mockResolvedValue({
      getQueryRun: vi.fn().mockResolvedValue({ ...run, settledPayments: pending ? 1 : 2, pendingPayments: pending ? 1 : 0 }),
      // The legacy query intentionally returns only citation rows: using it loses the toll.
      listPaymentsByQuery: vi.fn().mockResolvedValue([payment]),
      listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([access, payment]),
    });
    const response = await GET(new Request("https://keryx.test/api/dispatch/dispatch-1/receipt"), { params: Promise.resolve({ id: run.id }) });
    const receipt = await response.json();
    expect(response.status).toBe(200);
    expect(verifyResearchReceipt(receipt).valid).toBe(true);
    expect(receipt.payload.settlement).toMatchObject({
      ledgerCompleteness: "complete", recordedCreatorPayments: 2,
      settledAccessUsdc: pending ? 0 : 0.002, settledCitationUsdc: 0.015,
      settledCreatorUsdc: pending ? 0.015 : 0.017, pendingCreatorUsdc: pending ? 0.002 : 0,
      status: pending ? "pending" : "settled",
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
