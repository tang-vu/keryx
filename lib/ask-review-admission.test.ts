import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const wallet = `0x${"1".repeat(40)}`;
const mocks = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn(), ready: vi.fn(), deps: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/payments/session-grants", () => ({ getGrant: mocks.grant }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/agent", () => ({ getAgentDeps: mocks.deps }));
import { config } from "./config";
import { POST } from "@/app/api/ask/route";
function request(patch: object = {}, origin = config.baseUrl) { return new NextRequest(`${config.baseUrl}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ question: "Synthetic question", sessionId: wallet, browserAuthorizationProtocol: "durable-v1", reviewFirst: true, ...patch }) }); }
describe("review readiness before provider admission", () => {
  let previousOrigin: string;
  beforeEach(() => { previousOrigin = config.baseUrl; Object.assign(config, { baseUrl: "https://keryx.cc" }); vi.clearAllMocks(); mocks.session.mockResolvedValue({ address: wallet }); mocks.grant.mockResolvedValue({ ownerAddr: wallet });
    mocks.db.mockResolvedValue({ browserJournalActive: async () => true, decisionReviews: { ready: mocks.ready } }); mocks.ready.mockRejectedValue(new Error("Missing source migration")); });
  afterEach(() => { Object.assign(config, { baseUrl: previousOrigin }); });
  it("refuses a missing ordinary RPC/migration before model/gateway dependency creation", async () => {
    const response = await POST(request()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "review_unavailable" });
    expect(mocks.ready).toHaveBeenCalledOnce(); expect(mocks.deps).not.toHaveBeenCalled();
  });
  it("refuses sealed/native absence without provider fallback", async () => {
    mocks.db.mockResolvedValue({ browserJournalActive: async () => true }); const response = await POST(request());
    expect(response.status).toBe(503); expect(mocks.deps).not.toHaveBeenCalled(); expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("refuses foreign origin and aliases before authentication/provider calls", async () => {
    expect((await POST(request({}, "https://foreign.example"))).status).toBe(409);
    expect((await POST(request({ reviewFirst: false, mode: "review-first" }))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.deps).not.toHaveBeenCalled();
  });
});
