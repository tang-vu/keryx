import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunInput } from "../agent/run-agent";
import type { QueryRun } from "../types";
import { newRunUsage } from "../research/usage-provenance";
import { ResearchPlanningError } from "../llm/research-plan";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), getAgentDeps: vi.fn(), save: vi.fn(), activation: vi.fn(),
  gateway: { mode: "real" as "real" | "offline", agentAddress: vi.fn(() => `0x${"a".repeat(40)}`),
    ensureFunded: vi.fn(), payFetch: vi.fn(), payCitation: vi.fn() } }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ recordActivationEvent: mocks.activation }) }));
vi.mock("@/lib/rate-limit", () => ({ clientIp: () => "127.0.0.1", checkRateLimit: async () => null }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: async () => null }));
vi.mock("@/lib/research/availability", () => ({ readResearchAvailability: () => ({ state: "open" }) }));
vi.mock("@/lib/config", () => ({ config: { profile: { name: "arc", networkId: "eip155:5042" },
  baseUrl: "https://keryx.invalid", defaultBudget: 0.02, anonMaxBudget: 0.05,
  sessionAskMaxBudget: 0.25, botKey: "synthetic-bot-key", devWallets: [] } }));
import { POST } from "@/app/api/ask/route";

function retained(input: RunInput): QueryRun {
  return { id: input.queryId!, question: input.question, budget: 0.02, engine: "synthetic",
    subClaims: [], decisions: [], citations: [], answer: "Synthetic result", totalSpent: 0,
    totalToCreators: 0, trace: [], createdAt: "2026-10-23T00:00:00.000Z",
    usage: newRunUsage(input, "eip155:5042", []) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.gateway.mode = "real";
  mocks.gateway.agentAddress.mockReturnValue(`0x${"a".repeat(40)}`);
  mocks.getAgentDeps.mockResolvedValue({ db: { saveQueryRun: mocks.save }, engine: { name: "synthetic" }, gateway: mocks.gateway });
  mocks.save.mockResolvedValue(undefined);
  mocks.activation.mockResolvedValue(undefined);
  mocks.runAgent.mockImplementation(async function* (input: RunInput) {
    yield { phase: "decompose", message: "Synthetic trace", ts: 0 };
    return retained(input);
  });
});

async function ask(body: Record<string, unknown>, suffix = "") {
  const response = await POST(new NextRequest(`https://keryx.invalid/api/ask${suffix}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "Explain one documented constraint.", ...body }),
  }));
  expect(response.status).toBe(200);
  await response.text();
}

describe("public trial funding at the actual web adapter", () => {
  it("ignores spoofed body funding/cohort and retains server-selected sponsorship", async () => {
    await ask({ fundingOwner: "browser", usage: { cohort: "outside", payment: "independent" },
      usageContext: { cohort: "outside", payment: "independent" } });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0].usage).toMatchObject({ cohort: "unknown", payment: "team" });
    expect(mocks.gateway.ensureFunded).not.toHaveBeenCalled();
    expect(mocks.gateway.payFetch).not.toHaveBeenCalled();
    expect(mocks.gateway.payCitation).not.toHaveBeenCalled();
  });

  it("keeps offline activity unproved", async () => {
    mocks.gateway.mode = "offline";
    await ask({});
    expect(mocks.save.mock.calls[0][0].usage).toMatchObject({ cohort: "unknown", payment: "unknown" });
    expect(mocks.gateway.agentAddress).not.toHaveBeenCalled();
  });

  it("retains the admitted funding context in a saved planning failure without any payment", async () => {
    mocks.runAgent.mockImplementation(async function* (input: RunInput) {
      yield { phase: "decompose", message: "Synthetic refusal", ts: 0 };
      throw new ResearchPlanningError(input.question, "invalid_output");
    });
    await ask({});
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ totalSpent: 0, paymentMode: "real",
      usage: { cohort: "unknown", payment: "team" }, decisions: [], citations: [] });
    expect(mocks.gateway.payFetch).not.toHaveBeenCalled();
  });

  it("preserves authenticated controlled bot classification without claiming an outside payer", async () => {
    await ask({}, "?bot=synthetic-bot-key");
    expect(mocks.save.mock.calls[0][0].usage).toMatchObject({ cohort: "scripted", payment: "team" });
  });
});
