import { beforeEach, expect, it, vi } from "vitest";

const wallet = `0x${"cd".repeat(20)}`;
const state = vi.hoisted(() => ({ ready: true, owner: null as { wallet: string } | Response | null, limited: false }));
const mint = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onramp/arc-card-onramp", () => ({ arcCardOnrampReady: () => state.ready, mintArcCardOnrampSession: mint }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => state.limited ? Response.json({ error: "rate limit exceeded" }, { status: 429 }) : null),
}));
vi.mock("@/lib/account-sessions", async original => ({
  ...await original<typeof import("@/lib/account-sessions")>(),
  accountSessionContext: async () => state.owner,
}));
import { GET, POST } from "@/app/api/onramp/session/route";
import { checkRateLimit } from "@/lib/rate-limit";

const session = { sessionId: "s", sessionToken: "t", widgetUrl: "https://onramp.arc.io/?t=1",
  expiresAt: "2026-10-06T00:30:00.000Z", traceId: "trace", destinationWallet: wallet };
const post = (headers: Record<string, string> = { origin: "https://keryx.example", host: "keryx.example" }, body?: string) =>
  new Request("https://keryx.example/api/onramp/session", { method: "POST", headers, ...(body ? { body } : {}) });

beforeEach(() => {
  state.ready = true; state.owner = { wallet }; state.limited = false;
  mint.mockReset(); mint.mockResolvedValue(session); vi.mocked(checkRateLimit).mockClear();
});

it("reports availability without authentication and never caches it", async () => {
  state.ready = false;
  const off = await GET();
  expect(await off.json()).toEqual({ available: false });
  expect(off.headers.get("cache-control")).toBe("no-store");
  state.ready = true;
  expect(await (await GET()).json()).toEqual({ available: true });
});

it("mints for the signed-in wallet and ignores a caller-chosen destination", async () => {
  const attacker = `0x${"ee".repeat(20)}`;
  const response = await POST(post({ origin: "https://keryx.example", host: "keryx.example", "content-type": "application/json" },
    JSON.stringify({ destinationAddress: attacker, appUserId: "other", assets: { chains: ["ethereum"] } })));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ session });
  expect(mint).toHaveBeenCalledTimes(1);
  expect(mint).toHaveBeenCalledWith(wallet);
  expect(checkRateLimit).toHaveBeenCalledWith(`card-onramp:${wallet}`, "cardOnramp");
});

it("refuses before any vendor call when the feature is off, cross-origin, signed out or throttled", async () => {
  state.ready = false;
  expect((await POST(post())).status).toBe(503);
  state.ready = true;
  expect((await POST(post({ origin: "https://attacker.example", host: "keryx.example" }))).status).toBe(403);
  expect((await POST(post({ host: "keryx.example" }))).status).toBe(403);
  state.owner = Response.json({ error: "Sign in to access your account." }, { status: 401 });
  expect((await POST(post())).status).toBe(401);
  state.owner = { wallet }; state.limited = true;
  const throttled = await POST(post());
  expect(throttled.status).toBe(429);
  expect(throttled.headers.get("cache-control")).toBe("no-store");
  expect(mint).not.toHaveBeenCalled();
});

it("returns a generic failure when Circle is unavailable", async () => {
  mint.mockRejectedValue(new Error("vendor detail"));
  const response = await POST(post());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("vendor detail");
});
