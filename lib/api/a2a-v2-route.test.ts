import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectRun: vi.fn(),
  getDb: vi.fn(),
  settleThenServe: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  config: {
    sellerAddress: "0x2222222222222222222222222222222222222222",
    networkId: "eip155:5042002",
    a2aFeeUsdc: 0.02,
    a2aDeepFeeUsdc: 0.05,
    a2aMaxBudget: 0.5,
    defaultBudget: 0.05,
    botKey: "",
    funderKey: "0xtest-private-key",
  },
}));
vi.mock("@/lib/agent", () => ({ collectRun: mocks.collectRun }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/x402-discovery", () => ({ a2aDiscovery: {} }));
vi.mock("@/lib/x402-server", () => ({
  challengeResponse: vi.fn(),
  settleThenServe: mocks.settleThenServe,
}));

import { GET, POST } from "@/app/api/agent/ask/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/agent/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = {
  id: "filled-by-test",
  question: "q",
  budget: 0.05,
  answer: "answer",
  subClaims: ["claim"],
  decisions: [],
  citations: [],
  evidence: [],
  claimCoverage: [{ claimIndex: 0, claim: "claim", coverage: 0, coveredBy: [] }],
  totalSpent: 0.031,
  totalToCreators: 0.031,
  trace: [],
  createdAt: "2026-09-02T00:01:00.000Z",
  durationMs: 60_000,
  engine: "heuristic",
  paymentMode: "real",
};

describe("A2A v2 route", () => {
  let db: {
    recordPaymentOnce: ReturnType<typeof vi.fn>;
    createA2aOrder: ReturnType<typeof vi.fn>;
    completeA2aOrder: ReturnType<typeof vi.fn>;
    failA2aOrder: ReturnType<typeof vi.fn>;
    resolveA2aOrder: ReturnType<typeof vi.fn>;
    markA2aOrderPaymentStarted: ReturnType<typeof vi.fn>;
    markA2aOrderResultSaving: ReturnType<typeof vi.fn>;
    getQueryRun: ReturnType<typeof vi.fn>;
    getA2aOrder: ReturnType<typeof vi.fn>;
    listCreatorPaymentAttemptsByQuery: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
    mocks.checkRateLimit.mockResolvedValue(null);
    db = {
      recordPaymentOnce: vi.fn().mockResolvedValue(true),
      createA2aOrder: vi.fn(),
      completeA2aOrder: vi.fn().mockResolvedValue(true),
      failA2aOrder: vi.fn().mockResolvedValue(true),
      resolveA2aOrder: vi.fn().mockResolvedValue(true),
      markA2aOrderPaymentStarted: vi.fn().mockResolvedValue(true),
      markA2aOrderResultSaving: vi.fn().mockResolvedValue(true),
      getQueryRun: vi.fn().mockResolvedValue(null),
      getA2aOrder: vi.fn().mockResolvedValue(null),
      listCreatorPaymentAttemptsByQuery: vi.fn().mockResolvedValue([
        { amountUsdc: 0.031, settled: true, settlementStatus: "settled" },
      ]),
    };
    db.createA2aOrder.mockImplementation(async (order) => {
      db.getA2aOrder.mockResolvedValue(order);
      return { created: true, order };
    });
    mocks.getDb.mockResolvedValue(db);
    mocks.collectRun.mockImplementation(async (input) => ({ ...run, id: input.queryId }));
    mocks.settleThenServe.mockImplementation(async (_req, opts, produce) => {
      try {
        const produced = await produce({
          payer: "0x1111111111111111111111111111111111111111",
          transaction: "circle-transfer",
          amountUsdc: opts.priceUsdc,
          authorizationId: "0xnonce",
        });
        return produced instanceof Response ? produced : Response.json(produced);
      } catch {
        return Response.json({ error: "paid resource unavailable after settlement" }, { status: 500 });
      }
    });
  });

  it("prices the body before settlement and bounds downstream spend to the prepaid cap", async () => {
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(response.status).toBe(200);
    expect(mocks.settleThenServe.mock.calls[0][1].priceUsdc).toBe(0.1);
    expect(mocks.collectRun).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: 0.05,
        researchMode: "deep",
        fundingOwner: "treasury",
        executionLimits: { attentionLimit: 4, reevaluateRounds: 1 },
      }),
    );
    expect(await response.json()).toMatchObject({
      status: "completed",
      feePaid: 0.05,
      totalPricePaid: 0.1,
      pricing: {
        settledCreatorSpendUsdc: 0.031,
        pendingCreatorSpendUsdc: 0,
        unusedCreatorReserveUsdc: 0.019,
      },
      researchPackage: { id: "keryx-deep", version: "1.0.0" },
      serviceReceipt: {
        outcome: "completed",
        targetCompletionMs: 300_000,
        objectiveKind: "provisional_slo",
        quality: { status: "measured", groundedClaimRate: 0 },
      },
    });
  });

  it("returns the durable completed result on authorization replay without rerunning", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({
      created: false,
      order: { ...order, status: "completed", response: { status: "completed", queryId: order.id } },
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(await response.json()).toMatchObject({ status: "completed", replayed: true });
    expect(mocks.collectRun).not.toHaveBeenCalled();
    expect(db.completeA2aOrder).not.toHaveBeenCalled();
  });

  it("returns a historical completed authorization without relabeling it package v1", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({
      created: false,
      order: {
        ...order,
        requestHash: "8cb6a2f97128ce20d77011dc361c084ec5d64ec7613adfabda891816b148075a",
        researchPackage: null,
        request: null,
        status: "completed",
        response: { status: "completed", queryId: order.id, answer: "historical answer" },
      },
    }));

    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "completed",
      answer: "historical answer",
      replayed: true,
    });
    expect(payload).not.toHaveProperty("researchPackage");
    expect(payload).not.toHaveProperty("serviceReceipt");
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("returns processing for an already-claimed authorization with no saved run", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({ created: false, order }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(await response.json()).toMatchObject({ status: "processing", replayed: true });
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("settles, durably queues, and returns 202 without running research inline", async () => {
    const response = await POST(
      request({ question: "q", budget: 0.05, researchMode: "deep", responseMode: "async" }),
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toMatch(/^\/api\/agent\/ask\?queryId=a2a_/);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toMatchObject({
      status: "queued",
      pollUrl: expect.any(String),
      researchPackage: { id: "keryx-deep", version: "1.0.0" },
      serviceStatus: {
        state: "queued",
        targetCompletionMs: 300_000,
        targetBreached: false,
        objectiveKind: "provisional_slo",
      },
    });
    expect(mocks.collectRun).not.toHaveBeenCalled();
    const proposed = db.createA2aOrder.mock.calls[0][0];
    expect(proposed).toMatchObject({
      request: { question: "q", origin: "a2a" },
      startedAt: null,
      workerId: null,
    });
  });

  it("honors Prefer: respond-async and rejects unknown response modes", async () => {
    const preferred = request({ question: "q", budget: 0.05 });
    preferred.headers.set("prefer", "respond-async");
    const preferredResponse = await POST(preferred);
    expect(preferredResponse.status).toBe(202);
    expect(preferredResponse.headers.get("preference-applied")).toBe("respond-async");
    expect(preferredResponse.headers.get("vary")).toBe("Prefer");
    expect(mocks.collectRun).not.toHaveBeenCalled();

    const invalid = await POST(request({ question: "q", responseMode: "later" }));
    expect(invalid.status).toBe(400);
    expect(mocks.settleThenServe).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported package version before issuing or settling a payment", async () => {
    const response = await POST(request({ question: "q", packageVersion: "2.0.0" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "unsupported A2A research package version",
      supportedPackageVersions: ["1.0.0"],
    });
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });

  it("repairs a lost completion write from the saved real QueryRun", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({ created: false, order }));
    db.getQueryRun.mockImplementation(async (queryId) => ({ ...run, id: queryId }));
    db.getA2aOrder.mockImplementation(async (queryId) => ({
      ...db.createA2aOrder.mock.calls[0]?.[0],
      id: queryId,
      queryId,
      status: "completed",
      response: { status: "completed", queryId },
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(await response.json()).toMatchObject({ status: "completed", replayed: true });
    expect(db.resolveA2aOrder).toHaveBeenCalledOnce();
    expect(db.completeA2aOrder).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("keeps a simulated saved run under review without publishing it", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({ created: false, order }));
    db.getQueryRun.mockImplementation(async (queryId) => ({
      ...run,
      id: queryId,
      paymentMode: "offline",
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "processing", replayed: true });
    expect(db.resolveA2aOrder).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("fails closed when a replay changes the signed economic tuple", async () => {
    db.createA2aOrder.mockImplementation(async (order) => ({
      created: false,
      order: { ...order, amountUsdc: order.amountUsdc + 0.01 },
    }));
    const response = await POST(request({ question: "q", budget: 0.05, researchMode: "deep" }));
    expect(response.status).toBe(500);
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("polls a durable order without settling or launching research", async () => {
    const queryId = `a2a_${"a".repeat(64)}`;
    db.getA2aOrder.mockResolvedValue({
      id: queryId,
      queryId,
      authorizationId: "0xnonce",
      requestHash: "request-hash",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      researchPackage: null,
      status: "completed",
      transaction: "circle-transfer",
      request: { question: "q", origin: "a2a" },
      startedAt: "now",
      workerId: "worker",
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: { status: "completed", queryId, answer: "saved" },
      errorCode: null,
      resolution: null,
      createdAt: "now",
      updatedAt: "now",
    });
    db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([
      { amountUsdc: 0.03, settled: true, settlementStatus: "settled" },
      { amountUsdc: 0.005, settled: false, settlementStatus: "pending" },
    ]);
    const response = await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`));
    expect(await response.json()).toMatchObject({
      status: "completed",
      answer: "saved",
      totalToCreators: 0.03,
      pricing: {
        settledCreatorSpendUsdc: 0.03,
        pendingCreatorSpendUsdc: 0.005,
        unusedCreatorReserveUsdc: 0.015,
      },
    });
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
    expect(mocks.collectRun).not.toHaveBeenCalled();
  });

  it("distinguishes queued from processing without exposing private worker input", async () => {
    const queryId = `a2a_${"b".repeat(64)}`;
    const queued = {
      id: queryId,
      queryId,
      authorizationId: "0xnonce",
      requestHash: "request-hash",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      researchPackage: null,
      status: "running",
      transaction: "circle-transfer",
      request: { question: "private question", origin: "a2a" },
      startedAt: null,
      workerId: null,
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: null,
      errorCode: null,
      resolution: null,
      createdAt: "now",
      updatedAt: "now",
    };
    db.getA2aOrder.mockResolvedValue(queued);
    const response = await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`));
    const payload = await response.json();
    expect(payload).toMatchObject({ status: "queued", queryId });
    expect(JSON.stringify(payload)).not.toContain("private question");

    db.getA2aOrder.mockResolvedValue({
      ...queued,
      startedAt: new Date().toISOString(),
      workerId: "worker",
    });
    const processing = await GET(
      new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`),
    );
    expect(await processing.json()).toMatchObject({ status: "processing", queryId });
  });

  it("publishes audited failed economics without exposing private order data", async () => {
    const queryId = `a2a_${"c".repeat(64)}`;
    const failedOrder = {
      id: queryId,
      queryId,
      authorizationId: "0xprivate-nonce",
      requestHash: "request-hash",
      payer: "0x1111111111111111111111111111111111111111",
      payee: "0x2222222222222222222222222222222222222222",
      amountUsdc: 0.1,
      creatorBudgetUsdc: 0.05,
      serviceFeeUsdc: 0.05,
      researchMode: "deep",
      researchPackage: null,
      status: "failed",
      transaction: "private-circle-transfer",
      request: { question: "private failed question", origin: "a2a" },
      startedAt: "2026-09-01T00:00:00.000Z",
      workerId: "private-worker",
      executionJournalVersion: 1,
      paymentStartedAt: null,
      resultSavingAt: null,
      response: null,
      errorCode: "operator_reviewed_no_result",
      resolution: {
        action: "close_failed",
        actor: "operator-cli",
        reason: "no_saved_run_before_execution_boundaries",
        evidence: {
          executionJournalVersion: 1,
          paymentBoundaryCrossed: false,
          resultSaveBoundaryCrossed: false,
          creatorAttempts: 0,
          settledCreatorMicros: 0,
          pendingCreatorMicros: 0,
          failedCreatorMicros: 0,
          simulatedCreatorMicros: 0,
          queryRunFound: false,
        },
        resolvedAt: "2026-09-01T00:20:00.000Z",
      },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:20:00.000Z",
    } as const;
    db.getA2aOrder.mockResolvedValue(failedOrder);
    db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([]);
    const response = await GET(new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`));
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "failed",
      error: "operator_reviewed_no_result",
      pricing: {
        settledCreatorSpendUsdc: 0,
        pendingCreatorSpendUsdc: 0,
        unusedCreatorReserveUsdc: 0.05,
      },
      creatorPayments: { attempts: 0, failedUsdc: 0, accountingComplete: true },
      resolution: {
        action: "close_failed",
        reason: "no_saved_run_before_execution_boundaries",
        evidence: { settledCreatorSpendUsdc: 0, failedCreatorSpendUsdc: 0 },
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /private failed question|private-worker|private-circle-transfer|0xprivate-nonce/,
    );

    db.getA2aOrder.mockResolvedValue({
      ...failedOrder,
      paymentStartedAt: "2026-09-01T00:00:01.000Z",
      errorCode: "research_failed",
      resolution: null,
    });
    db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([
      { amountUsdc: 0.01, settled: true, settlementStatus: "settled" },
    ]);
    const incomplete = await GET(
      new NextRequest(`http://localhost/api/agent/ask?queryId=${queryId}`),
    );
    expect(await incomplete.json()).toMatchObject({
      status: "failed",
      pricing: { accountingComplete: false, unusedCreatorReserveUsdc: null },
      creatorPayments: { accountingComplete: false },
      message: expect.stringContaining("lower bound"),
    });
  });

  it("refuses payment before issuing a challenge when the server is forced offline", async () => {
    vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
    const response = await POST(request({ question: "q", budget: 0.05 }));
    expect(response.status).toBe(503);
    expect(mocks.settleThenServe).not.toHaveBeenCalled();
  });

  it("does not terminally hide a saved run with unexpected offline accounting", async () => {
    mocks.collectRun.mockImplementation(async (input) => ({
      ...run,
      id: input.queryId,
      paymentMode: "offline",
    }));
    const response = await POST(request({ question: "q", budget: 0.05 }));
    expect(response.status).toBe(500);
    expect(db.failA2aOrder).not.toHaveBeenCalled();
    expect(db.completeA2aOrder).not.toHaveBeenCalled();
  });

  it("does not terminally fail a saved paid run when only the completion CAS is unavailable", async () => {
    db.completeA2aOrder.mockRejectedValue(new Error("database timeout"));

    const response = await POST(request({ question: "q", budget: 0.05 }));

    expect(response.status).toBe(500);
    expect(mocks.collectRun).toHaveBeenCalledOnce();
    expect(db.failA2aOrder).not.toHaveBeenCalled();
  });
});
