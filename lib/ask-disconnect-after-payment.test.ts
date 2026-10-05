import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryRun, TraceStep } from "./types";

// A client that disconnects mid-run must not strand creator payments without their dispatch:
// before any payment the run is cancelled and discarded; after one it finishes and is saved.

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), getSession: vi.fn(), getGrant: vi.fn(), getAgentDeps: vi.fn(), runAgent: vi.fn(),
  admission: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./auth", () => ({ getSession: mocks.getSession }));
vi.mock("./payments/session-grants", () => ({ getGrant: mocks.getGrant }));
vi.mock("./agent", () => ({ getAgentDeps: mocks.getAgentDeps }));
vi.mock("./agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("./sponsored-admission", () => ({ checkSponsoredResearchAdmission: mocks.admission }));
vi.mock("./activation", () => ({ recordActivationEvent: vi.fn(async () => {}) }));

import { POST } from "../app/api/ask/route";

const completedRun = (): QueryRun => ({
  id: "run-1", question: "Synthetic question", budget: 0.03, engine: "fixture", subClaims: [],
  decisions: [], citations: [], answer: "Synthetic answer", totalSpent: 0.004, totalToCreators: 0.004,
  trace: [], createdAt: new Date().toISOString(), paymentMode: "offline",
});
const step = (message: string, detail?: unknown): TraceStep => ({ phase: "fetch", message, detail, ts: Date.now() });
const payment = { kind: "fetch", amountUsdc: 0.004, sourceId: "a", sourceName: "A", queryId: "run-1", settled: false };

let saveQueryRun: ReturnType<typeof vi.fn>;
let agentSignal: AbortSignal | undefined;

/**
 * Drives the route with a generator that pauses after its first step until `resume` is called.
 * With `inFlight`, the generator reaches the creator-payment boundary and is still awaiting the
 * gateway when the client disconnects: no payment step has been yielded yet.
 */
async function disconnectAfter(firstStep: TraceStep, inFlight = false) {
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  mocks.runAgent.mockImplementation((input: { signal?: AbortSignal; onCreatorPaymentBoundary?: () => Promise<void> }) => {
    agentSignal = input.signal;
    return (async function* () {
      yield firstStep;
      if (inFlight) await input.onCreatorPaymentBoundary?.();
      await paused;
      // The real orchestrator throws at its cancellation checkpoints once its signal is aborted.
      if (input.signal?.aborted) throw new DOMException("Research cancelled", "AbortError");
      yield step("Synthesizing");
      return completedRun();
    })();
  });
  const client = new AbortController();
  const response = await POST(new NextRequest("http://localhost/api/ask", {
    method: "POST", signal: client.signal,
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
    body: JSON.stringify({ question: "Synthetic question", budget: 0.03 }),
  }));
  const reader = response.body!.getReader();
  await reader.read(); // meta
  await reader.read(); // first step: the route has now inspected it
  // Let the generator run up to its pause (and through the payment boundary when in flight).
  await new Promise((resolve) => setTimeout(resolve, 0));
  client.abort();
  resume();
  // Drain until the server closes the stream; enqueue errors after a disconnect are swallowed.
  for (;;) { const { done } = await reader.read().catch(() => ({ done: true })); if (done) break; }
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSignal = undefined;
  saveQueryRun = vi.fn(async () => {});
  const db = { saveQueryRun, listQueryRunsByAsker: vi.fn(async () => []), getQueryRun: vi.fn(async () => null) };
  mocks.getDb.mockResolvedValue(db);
  mocks.getSession.mockResolvedValue(null);
  mocks.getGrant.mockResolvedValue(undefined);
  mocks.admission.mockResolvedValue(null);
  mocks.getAgentDeps.mockResolvedValue({ engine: { name: "fixture" }, gateway: { mode: "offline" }, db });
});

describe("/api/ask client disconnect", () => {
  it("cancels and discards a run that has paid nothing", async () => {
    await disconnectAfter(step("Breaking down the question"));
    expect(agentSignal?.aborted).toBe(true);
    expect(saveQueryRun).not.toHaveBeenCalled();
  });

  it("finishes and saves a run once a creator payment was observed", async () => {
    await disconnectAfter(step("Paid toll", payment));
    expect(agentSignal?.aborted).toBe(false);
    expect(saveQueryRun).toHaveBeenCalledTimes(1);
    expect(saveQueryRun.mock.calls[0]![0]).toMatchObject({ id: "run-1", totalSpent: 0.004 });
  });

  it("keeps a run whose first payment is still in flight at disconnect", async () => {
    await disconnectAfter(step("Paying toll…"), true);
    expect(agentSignal?.aborted).toBe(false);
    expect(saveQueryRun).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a decision carrying a price for a payment", async () => {
    await disconnectAfter(step("BUY A", { sourceId: "a", action: "BUY", price: 0.004, amountUsdc: 0.004, kind: "decision" }));
    expect(agentSignal?.aborted).toBe(true);
    expect(saveQueryRun).not.toHaveBeenCalled();
  });
});
