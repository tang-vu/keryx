import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
afterEach(() => { vi.doUnmock("../account-sessions"); vi.doUnmock("./mainnet-session-grants"); vi.unstubAllGlobals(); });
it("refuses a denied or unavailable durable actor limit before funding reads or issued epochs", async () => {
  vi.resetModules();
  const consumeRateLimit = vi.fn().mockResolvedValueOnce({ allowed: false, msBeforeNext: 50000 }).mockRejectedValueOnce(new Error("Private storage error"));
  const issueMainnetSessionGrant = vi.fn(() => { throw new Error("Must not reach authority"); });
  vi.doMock("../account-sessions", () => ({ accountSessionContext: async () => ({ wallet: `0x${"11".repeat(20)}`, db: { consumeRateLimit } }) }));
  vi.doMock("./mainnet-session-grants", () => ({ requireMainnetGrantOrigin: () => {}, issueMainnetSessionGrant }));
  const transport = vi.fn(() => { throw new Error("Must not reach Circle"); }); vi.stubGlobal("fetch", transport);
  const { POST } = await import("../../app/api/session/grant/challenge/route");
  const request = () => new NextRequest("https://keryx.cc/api/session/grant/challenge", { method: "POST", body: "{}" });
  const refused = await POST(request()); expect(refused.status).toBe(429);
  expect(refused.headers.get("retry-after")).toBe("50"); expect(refused.headers.get("cache-control")).toBe("no-store");
  expect((await POST(request())).status).toBe(503);
  expect(issueMainnetSessionGrant).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});
