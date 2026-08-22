import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x1111111111111111111111111111111111111111";
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getGrant: vi.fn(),
  checkRateLimit: vi.fn(),
  getAgentDeps: vi.fn(),
  runAgent: vi.fn(),
  saveQueryRun: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/payments/session-grants", () => ({ getGrant: mocks.getGrant }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));

import { POST } from "@/app/api/ask/route";

function request(budget: number) {
  return new NextRequest("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How does x402 settle?", sessionId: OWNER, budget }),
  });
}

function completedRun() {
  return {
    id: "run-1",
    question: "How does x402 settle?",
    budget: 0.02,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [],
    answer: "answer",
    totalSpent: 0,
    totalToCreators: 0,
    trace: [],
    createdAt: new Date().toISOString(),
  };
}

describe("browser session ask guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ address: OWNER });
    mocks.getGrant.mockResolvedValue({
      sessionId: OWNER,
      ownerAddr: OWNER,
      sessAddr: "0x2222222222222222222222222222222222222222",
      cap: 0.2,
      spent: 0.18,
      expiry: Date.now() + 60_000,
      txHash: "0xabc",
      grantEpoch: "epoch",
    });
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.getAgentDeps.mockResolvedValue({
      engine: { name: "heuristic" },
      gateway: { mode: "browser-cosign" },
      db: { saveQueryRun: mocks.saveQueryRun },
    });
    mocks.runAgent.mockImplementation((input: unknown) =>
      (async function* () {
        void input;
        return completedRun();
      })(),
    );
  });

  it("rate-limits compute by the SIWE-verified wallet", async () => {
    mocks.checkRateLimit.mockResolvedValue(
      Response.json({ error: "rate limit exceeded" }, { status: 429 }),
    );

    const response = await POST(request(0.05));

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      OWNER,
      "sessionAsk",
      expect.objectContaining({ code: "session_rate_limit" }),
    );
    expect(mocks.getAgentDeps).not.toHaveBeenCalled();
  });

  it("clamps one dispatch to the exact unreserved grant balance", async () => {
    const response = await POST(request(1));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ question: "How does x402 settle?", budget: 0.02 }),
      expect.anything(),
    );
  });

  it("rejects a fully reserved grant before starting the agent", async () => {
    mocks.getGrant.mockResolvedValue({
      ...(await mocks.getGrant()),
      cap: 0.2,
      spent: 0.2,
    });

    const response = await POST(request(0.05));

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: "session_budget_exhausted" });
    expect(mocks.getAgentDeps).not.toHaveBeenCalled();
  });
});
