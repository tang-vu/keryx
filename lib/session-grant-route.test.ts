import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x1111111111111111111111111111111111111111";
const SESSION = "0x2222222222222222222222222222222222222222";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getGatewayAvailableAtomic: vi.fn(),
  getBalance: vi.fn(),
  storeGrant: vi.fn(),
  browserJournalActive: vi.fn(),
  browserSignerConfirmedSpendMicro: vi.fn(),
  getSessionGrant: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/account-sessions", () => ({ accountSessionContext: async () => {
  const session = await mocks.getSession();
  return session ? { wallet: session.address.toLowerCase(), db: mocks } : Response.json({ error: "unauthenticated" }, { status: 401 });
} }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(async () => mocks) }));
vi.mock("@/lib/gateway/gateway-balance", () => ({
  getGatewayAvailableAtomic: mocks.getGatewayAvailableAtomic,
}));
vi.mock("@/lib/payments/session-grants", () => ({
  storeGrant: mocks.storeGrant,
  grantExpiry: vi.fn(() => Date.now() + 60_000),
}));
vi.mock("viem", async (importOriginal) => {
  const original = await importOriginal<typeof import("viem")>();
  return {
    ...original,
    createPublicClient: vi.fn(() => ({ getBalance: mocks.getBalance })),
  };
});

import { GET, POST } from "@/app/api/session/grant/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/session/grant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("session grant funding authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ address: OWNER });
    mocks.browserJournalActive.mockResolvedValue(false);
    mocks.browserSignerConfirmedSpendMicro.mockResolvedValue(0);
    mocks.storeGrant.mockResolvedValue("epoch");
  });

  it("fails closed when Circle cannot verify a recovery", async () => {
    mocks.getGatewayAvailableAtomic.mockResolvedValue(null);

    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.1, recover: true })
    );

    expect(response.status).toBe(503);
    expect(mocks.getBalance).not.toHaveBeenCalled();
    expect(mocks.storeGrant).not.toHaveBeenCalled();
  });

  it("fails closed when both Circle and Arc RPC are unavailable", async () => {
    mocks.getGatewayAvailableAtomic.mockResolvedValue(null);
    mocks.getBalance.mockRejectedValue(new Error("RPC unavailable"));

    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.1, txHash: "0xfunding" })
    );

    expect(response.status).toBe(503);
    expect(mocks.storeGrant).not.toHaveBeenCalled();
  });

  it("uses Circle's available balance as the grant ceiling", async () => {
    mocks.getGatewayAvailableAtomic.mockResolvedValue(BigInt(25_000));

    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.1, txHash: "0xfunding" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.expiresAt).toBe(new Date(mocks.storeGrant.mock.calls[0][1].expiry).toISOString());
    expect(body.remainingMs).toBe(Date.parse(body.expiresAt) - Date.parse(body.serverNow));
    expect(body.grantEpoch).toBe("epoch");
    expect(mocks.storeGrant).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        sessAddr: SESSION,
        ownerAddr: OWNER,
        cap: 0.025,
      })
    );
  });
  it("recovers the original cumulative cap using only evidenced confirmed consumption", async () => {
    mocks.browserJournalActive.mockResolvedValue(true);
    mocks.browserSignerConfirmedSpendMicro.mockResolvedValue(3000);
    mocks.getGatewayAvailableAtomic.mockResolvedValue(BigInt(2000));
    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.005, recover: true })
    );
    expect(response.status).toBe(200);
    expect(mocks.storeGrant).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ cap: 0.005 })
    );
    expect(mocks.browserSignerConfirmedSpendMicro).toHaveBeenCalledWith(
      SESSION
    );
  });
  it("does not add pending or unknown exposure back to independently available balance", async () => {
    mocks.browserJournalActive.mockResolvedValue(true);
    mocks.browserSignerConfirmedSpendMicro.mockResolvedValue(0);
    mocks.getGatewayAvailableAtomic.mockResolvedValue(BigInt(2000));
    await POST(request({ sessAddr: SESSION, budget: 0.005, recover: true }));
    expect(mocks.storeGrant).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ cap: 0.002 })
    );
  });
  it("fails closed when historical accounting is inconsistent", async () => {
    mocks.browserJournalActive.mockResolvedValue(true);
    mocks.browserSignerConfirmedSpendMicro.mockRejectedValue(
      new Error("conflicting nonce")
    );
    mocks.getGatewayAvailableAtomic.mockResolvedValue(BigInt(2000));
    expect(
      (await POST(request({ sessAddr: SESSION, budget: 0.005, recover: true })))
        .status
    ).toBe(503);
    expect(mocks.storeGrant).not.toHaveBeenCalled();
  });
});

describe("read-only current-owner grant status", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ address: OWNER }); });
  const row = () => ({ sessionId: OWNER, ownerAddr: OWNER, sessAddr: SESSION, cap: 0.05, spent: 0.002,
    expiry: Date.now() + 60000, grantEpoch: "retained-epoch", txHash: "synthetic" });
  it("reads only the authenticated owner without renewing or changing capacity", async () => {
    const retained = row(); mocks.getSessionGrant.mockResolvedValue(retained);
    const response = await GET(new NextRequest("http://localhost/api/session/grant")), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ active: true, sessionId: OWNER, ownerAddr: OWNER, sessAddr: SESSION, grantEpoch: "retained-epoch" });
    expect(body.expiresAt).toBe(new Date(retained.expiry).toISOString());
    expect(body.remainingMs).toBe(retained.expiry - Date.parse(body.serverNow));
    expect(mocks.getSessionGrant).toHaveBeenCalledExactlyOnceWith(OWNER);
    expect(mocks.storeGrant).not.toHaveBeenCalled(); expect(mocks.getGatewayAvailableAtomic).not.toHaveBeenCalled();
    expect(retained).toEqual({ ...row(), expiry: retained.expiry });
  });
  it("rejects selectors and unauthenticated requests before reading a grant", async () => {
    expect((await GET(new NextRequest("http://localhost/api/session/grant?sessionId=" + SESSION))).status).toBe(400);
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/session/grant"))).status).toBe(401);
    expect(mocks.getSessionGrant).not.toHaveBeenCalled();
  });
  it("fails closed for expired, missing or mismatched grants and storage errors", async () => {
    for (const value of [null, { ...row(), expiry: Date.now() - 1 }, { ...row(), ownerAddr: SESSION }, { ...row(), sessionId: SESSION }]) {
      mocks.getSessionGrant.mockResolvedValue(value);
      const response = await GET(new NextRequest("http://localhost/api/session/grant"));
      expect(await response.json()).toEqual({ active: false });
    }
    mocks.getSessionGrant.mockRejectedValue(new Error("synthetic-private-diagnostic"));
    const failed = await GET(new NextRequest("http://localhost/api/session/grant"));
    expect(failed.status).toBe(503); expect(await failed.json()).toEqual({ error: "Session status unavailable" });
    expect(mocks.storeGrant).not.toHaveBeenCalled();
  });
});
