import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunInput } from "./agent/run-agent";
import type { QueryRun } from "./types";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), getAgentDeps: vi.fn(), save: vi.fn(),
  parent: vi.fn(), activation: vi.fn() }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ getQueryRun: mocks.parent, recordActivationEvent: mocks.activation }) }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", checkRateLimit: async () => null }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/research/availability", () => ({ readResearchAvailability: () => ({ state: "open" }) }));
vi.mock("@/lib/config", () => ({ config: { profile: { name: "arcTestnet" }, defaultBudget: 0.02,
  anonMaxBudget: 0.05, sessionAskMaxBudget: 0.25, botKey: "" } }));

import { POST } from "@/app/api/ask/route";

function retained(question: string): QueryRun {
  return { id: "synthetic-original-text", question, budget: 0.02, engine: "synthetic",
    subClaims: [], decisions: [], citations: [], answer: "Synthetic result", totalSpent: 0,
    totalToCreators: 0, trace: [], createdAt: "2026-10-01T00:00:00.000Z" };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAgentDeps.mockResolvedValue({ db: { saveQueryRun: mocks.save }, engine: { name: "synthetic" }, gateway: { mode: "offline" } });
  mocks.save.mockResolvedValue(undefined);
  mocks.activation.mockResolvedValue(undefined);
  mocks.parent.mockResolvedValue(retained("How does the older API work?"));
  mocks.runAgent.mockImplementation(async function* (input: RunInput) {
    yield { phase: "decompose", message: "Synthetic trace", ts: 0 };
    return retained(input.question);
  });
});

describe("validated caller text at the web follow-up adapter", () => {
  it("retains raw newest instruction despite parent context and a spoofed public override", async () => {
    const question = "Name the newest release in https://creator.example/releases.atom and state its change.";
    const response = await POST(new NextRequest("https://keryx.invalid/api/ask", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, parentId: "parent", originalQuestion: "Ordinary unrelated research", budget: 0.02 }),
    }));
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.runAgent).toHaveBeenCalledOnce();
    const input = mocks.runAgent.mock.calls[0][0] as RunInput;
    expect(input.question).toMatch(/^Following on/);
    expect(input.originalQuestion).toBe(question);
    expect(input.originalQuestion).not.toContain("older API");
  });

  it("an unknown parent keeps the validated standalone original unchanged", async () => {
    mocks.parent.mockResolvedValue(null);
    const response = await POST(new NextRequest("https://keryx.invalid/api/ask", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "  Explain compatibility facts.  ", parentId: "missing" }),
    }));
    await response.text();
    expect(mocks.runAgent.mock.calls[0][0]).toMatchObject({ question: "Explain compatibility facts.", originalQuestion: "Explain compatibility facts." });
  });
});
