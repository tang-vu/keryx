import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "0x1111111111111111111111111111111111111111";
const SESSION = "0x2222222222222222222222222222222222222222";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getGatewayAvailableAtomic: vi.fn(),
  getBalance: vi.fn(),
  storeGrant: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
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

import { POST } from "@/app/api/session/grant/route";

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
  });

  it("fails closed when Circle cannot verify a recovery", async () => {
    mocks.getGatewayAvailableAtomic.mockResolvedValue(null);

    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.1, recover: true }),
    );

    expect(response.status).toBe(503);
    expect(mocks.getBalance).not.toHaveBeenCalled();
    expect(mocks.storeGrant).not.toHaveBeenCalled();
  });

  it("fails closed when both Circle and Arc RPC are unavailable", async () => {
    mocks.getGatewayAvailableAtomic.mockResolvedValue(null);
    mocks.getBalance.mockRejectedValue(new Error("RPC unavailable"));

    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.1, txHash: "0xfunding" }),
    );

    expect(response.status).toBe(503);
    expect(mocks.storeGrant).not.toHaveBeenCalled();
  });

  it("uses Circle's available balance as the grant ceiling", async () => {
    mocks.getGatewayAvailableAtomic.mockResolvedValue(BigInt(25_000));

    const response = await POST(
      request({ sessAddr: SESSION, budget: 0.1, txHash: "0xfunding" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.storeGrant).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ sessAddr: SESSION, ownerAddr: OWNER, cap: 0.025 }),
    );
  });
});
