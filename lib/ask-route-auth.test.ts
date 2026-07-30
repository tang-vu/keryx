import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getGrant: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/payments/session-grants", () => ({ getGrant: mocks.getGrant }));

import { POST } from "@/app/api/ask/route";

const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function request(sessionId: string) {
  return new NextRequest("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How does x402 settle?", sessionId }),
  });
}

function rawRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("browser co-sign ask authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a public session id when there is no SIWE identity", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await POST(request(OWNER));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "session_auth_required" });
    expect(mocks.getGrant).not.toHaveBeenCalled();
  });

  it("rejects a session id owned by a different SIWE wallet", async () => {
    mocks.getSession.mockResolvedValue({ address: OTHER });

    const response = await POST(request(OWNER));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "session_owner_mismatch" });
    expect(mocks.getGrant).not.toHaveBeenCalled();
  });

  it("rejects grant state whose persisted owner does not match the SIWE wallet", async () => {
    mocks.getSession.mockResolvedValue({ address: OWNER });
    mocks.getGrant.mockResolvedValue({ ownerAddr: OTHER });

    const response = await POST(request(OWNER));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "session_expired" });
  });

  it("does not reinterpret an empty or non-string session id as treasury-funded", async () => {
    for (const sessionId of ["", 123]) {
      const response = await POST(
        rawRequest({ question: "How does x402 settle?", sessionId }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getGrant).not.toHaveBeenCalled();
  });
});
