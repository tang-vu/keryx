import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE } from "./arc-network-profile";

const owner = "0x1111111111111111111111111111111111111111", signer = "0x2222222222222222222222222222222222222222";
const mocks = vi.hoisted(() => ({ getGrant: vi.fn(), readAuthority: vi.fn(), runAgent: vi.fn(), getAgentDeps: vi.fn() }));
vi.mock("@/lib/config", async importOriginal => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, config: { ...actual.config, profile: ARC_MAINNET_PROFILE } };
});
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ address: owner }) }));
vi.mock("@/lib/db", () => ({ getDb: async () => ({ browserJournalActive: async () => true }) }));
vi.mock("@/lib/payments/session-grants", () => ({ getGrant: mocks.getGrant }));
vi.mock("@/lib/payments/retained-session-authority", () => ({ readRetainedMainnetSessionAuthority: mocks.readAuthority }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => null, clientIp: () => "127.0.0.1" }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.getAgentDeps }));
vi.mock("@/lib/agent/run-agent", () => ({ runAgent: mocks.runAgent }));
import { POST } from "../app/api/ask/route";

beforeEach(() => {
  vi.clearAllMocks();
  const expiry = Date.now()+3600000;
  mocks.getGrant.mockResolvedValue({ sessionId: owner, ownerAddr: owner, sessAddr: signer, cap: 0.5, spent: 0, expiry, grantEpoch: "epoch" });
  mocks.readAuthority.mockResolvedValue({ consent: { format: "keryx-session-grant-consent-v2", capMicroUsdc: "500000",
    expirySeconds: String(expiry/1000), questionCapMicroUsdc: "10000" } });
  mocks.getAgentDeps.mockResolvedValue({ engine: { name: "heuristic" }, gateway: { mode: "browser-cosign" }, db: { saveQueryRun: async () => {} } });
  mocks.runAgent.mockImplementation(() => (async function* () { return { id: "run", trace: [], answer: "Synthetic answer", payments: [] }; })());
});
function request(budget = 0.5) { return new NextRequest("https://keryx.cc/api/ask", { method: "POST", body: JSON.stringify({
  question: "How do signed research budgets work?", sessionId: owner, budget, browserAuthorizationProtocol: "durable-v1",
}) }); }
it("limits API research to the signed per-question maximum before starting the agent", async () => {
  const response = await POST(request()); await response.text();
  expect(response.status).toBe(200);
  expect(mocks.runAgent).toHaveBeenCalledWith(expect.objectContaining({ budget: 0.01 }), expect.anything());
});
it("refuses unavailable or replaced consent without dispatching research", async () => {
  mocks.readAuthority.mockRejectedValueOnce(new Error("Unavailable original proof"));
  expect((await POST(request())).status).toBe(503);
  mocks.readAuthority.mockResolvedValueOnce({ consent: { capMicroUsdc: "500001", expirySeconds: "1800000000" } });
  expect((await POST(request())).status).toBe(503);
  expect(mocks.getAgentDeps).not.toHaveBeenCalled(); expect(mocks.runAgent).not.toHaveBeenCalled();
});

it("preserves an explicit zero source budget instead of substituting the default", async () => {
  const response = await POST(request(0)); await response.text();
  expect(response.status).toBe(200);
  expect(mocks.runAgent).toHaveBeenCalledWith(expect.objectContaining({ budget: 0 }), expect.anything());
});
