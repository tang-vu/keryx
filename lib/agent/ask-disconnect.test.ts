import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunInput } from "./run-agent";
import type { PaymentRecord, QueryRun, TraceStep } from "../types";
import { ResearchAdmissionHeldError, RESEARCH_PAUSED_MESSAGE } from "../research/availability-contract";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), getAgentDeps: vi.fn(), saveQueryRun: vi.fn(),
  recordActivationEvent: vi.fn() }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(async () => ({ recordActivationEvent: mocks.recordActivationEvent })) }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: vi.fn(async () => null) }));
vi.mock("@/lib/config", () => ({ config: { profile: { name: "arc" }, defaultBudget: 0.02,
  anonMaxBudget: 0.05, sessionAskMaxBudget: 0.25, botKey: "" } }));

import { POST } from "@/app/api/ask/route";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const run = (): QueryRun => ({ id: "disconnect-fixture", question: "Synthetic disconnect fixture", budget: 0.02,
  engine: "synthetic", subClaims: [], decisions: [], citations: [], answer: "Retained evidence",
  totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-10-05T00:00:00.000Z" });
function request(signal: AbortSignal) {
  return new NextRequest("https://keryx.invalid/api/ask", { method: "POST", signal,
    headers: { "content-type": "application/json" }, body: JSON.stringify({ question: run().question, budget: 0.02 }) });
}
const deps = () => ({ db: { saveQueryRun: mocks.saveQueryRun }, engine: { name: "synthetic" }, gateway: { mode: "offline" } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgentDeps.mockResolvedValue(deps());
  mocks.saveQueryRun.mockResolvedValue(undefined);
  mocks.recordActivationEvent.mockResolvedValue(undefined);
});

describe("web disconnect at the creator payment boundary", () => {
  it("uses a safe structured SSE category when a hold races with request admission", async () => {
    mocks.getAgentDeps.mockRejectedValue(new ResearchAdmissionHeldError("private journal instruction"));
    const response = await POST(request(new AbortController().signal));
    const text = await response.text();
    expect(text).toContain('"code":"research_paused"');
    expect(text).toContain(RESEARCH_PAUSED_MESSAGE);
    expect(text).not.toContain("private journal");
    expect(mocks.runAgent).not.toHaveBeenCalled(); expect(mocks.saveQueryRun).not.toHaveBeenCalled();
  });
  it.each(["ledger write", "cache write", "pending delivery ledger write"])(
    "retains the dispatch while %s is suspended before the first payment trace", async stage => {
      const suspended = deferred();
      const resume = deferred();
      const requestAbort = new AbortController();
      const payment: PaymentRecord = { kind: "fetch", queryId: run().id, sourceId: "synthetic-source", sourceName: "Synthetic",
        payer: "synthetic-payer", payee: "synthetic-payee", amountUsdc: 0.01, network: "synthetic",
        settled: false, settlementStatus: stage.startsWith("pending") ? "pending" : "simulated", createdAt: run().createdAt };
      let agentSignal!: AbortSignal;
      let blockedNextPayment = false;
      mocks.runAgent.mockImplementation(async function* (input: RunInput): AsyncGenerator<TraceStep, QueryRun> {
        agentSignal = input.signal!;
        await input.onCreatorPaymentBoundary!();
        // Gateway result exists, but persistence/cache has not yielded a visible receipt yet.
        suspended.resolve();
        await resume.promise;
        yield { phase: "fetch", message: `Synthetic ${stage} finished`, detail: payment, ts: 1 };
        try { await input.onCreatorPaymentBoundary!(); } catch { blockedNextPayment = true; }
        const completed = run();
        completed.trace.push({ phase: "fetch", message: "Synthetic receipt", detail: payment, ts: 1 });
        completed.pendingPayments = payment.settlementStatus === "pending" ? 1 : 0;
        completed.pendingSpendUsdc = payment.settlementStatus === "pending" ? 0.01 : 0;
        return completed;
      });
      const response = await POST(request(requestAbort.signal));
      const body = response.text();
      await suspended.promise;
      requestAbort.abort();
      expect(agentSignal.aborted).toBe(false);
      resume.resolve();
      await body;
      expect(blockedNextPayment).toBe(true);
      expect(mocks.saveQueryRun).toHaveBeenCalledOnce();
      const saved = mocks.saveQueryRun.mock.calls[0][0] as QueryRun;
      expect(saved.trace[0].detail).toEqual(payment);
      expect(saved.totalSpent).toBe(0);
      expect(saved.totalToCreators).toBe(0);
      expect(saved.pendingPayments).toBe(payment.settlementStatus === "pending" ? 1 : 0);
    },
  );

  it("cancels before any payment boundary and does not create a completed dispatch", async () => {
    const entered = deferred();
    const resume = deferred();
    const requestAbort = new AbortController();
    mocks.runAgent.mockImplementation(async function* (input: RunInput): AsyncGenerator<TraceStep, QueryRun> {
      entered.resolve();
      await resume.promise;
      expect(input.signal?.aborted).toBe(true);
      await input.onCreatorPaymentBoundary!();
      return run();
    });
    const response = await POST(request(requestAbort.signal));
    const body = response.text();
    await entered.promise;
    requestAbort.abort();
    resume.resolve();
    expect(await body).toContain("event: error");
    expect(mocks.saveQueryRun).not.toHaveBeenCalled();
  });

  it("does not start the agent if the request disconnects while dependencies load", async () => {
    const entered = deferred();
    const resume = deferred();
    const requestAbort = new AbortController();
    mocks.getAgentDeps.mockImplementation(async () => { entered.resolve(); await resume.promise; return deps(); });
    const response = await POST(request(requestAbort.signal));
    const body = response.text();
    await entered.promise;
    requestAbort.abort();
    resume.resolve();
    expect(await body).toContain("event: error");
    expect(mocks.runAgent).not.toHaveBeenCalled();
    expect(mocks.saveQueryRun).not.toHaveBeenCalled();
  });
});
