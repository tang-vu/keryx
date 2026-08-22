import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  checkRateLimit: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-keys", () => ({ verifyApiKey: mocks.verifyApiKey }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/agent", () => ({ collectRun: vi.fn() }));
vi.mock("@/lib/payments/payment-gateway", () => ({ makePayment: vi.fn() }));
vi.mock("@/lib/x402-server", () => ({
  settleThenServe: vi.fn(),
  challengeResponse: vi.fn(),
}));
vi.mock("@/lib/x402-discovery", () => ({ a2aDiscovery: {} }));

import { POST as postA2a } from "@/app/api/agent/ask/route";
import { POST as postChat } from "@/app/api/v1/chat/completions/route";

const RAW_KEY = `kx_live_${"a".repeat(96)}`;
const KEY_CONTEXT = {
  keyId: "key-id-123",
  walletAddress: "0x1111111111111111111111111111111111111111",
  scopes: "ask",
  sourceIds: null,
};

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${RAW_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("authenticated ask rate-limit identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyApiKey.mockResolvedValue(KEY_CONTEXT);
    mocks.checkRateLimit.mockResolvedValue(
      Response.json({ error: "rate limit exceeded" }, { status: 429 }),
    );
  });

  it("keys the paid A2A route by verified key id, never the bearer secret", async () => {
    const response = await postA2a(request("/api/agent/ask", { question: "q" }));

    expect(response.status).toBe(429);
    expect(mocks.verifyApiKey).toHaveBeenCalledWith(RAW_KEY);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(KEY_CONTEXT.keyId, "ask");
    expect(mocks.checkRateLimit).not.toHaveBeenCalledWith(RAW_KEY, expect.anything());
  });

  it("keys the OpenAI-compatible route by verified key id", async () => {
    const response = await postChat(
      request("/api/v1/chat/completions", {
        model: "keryx",
        messages: [{ role: "user", content: "q" }],
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.verifyApiKey).toHaveBeenCalledWith(RAW_KEY);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(KEY_CONTEXT.keyId, "ask");
    expect(mocks.checkRateLimit).not.toHaveBeenCalledWith(RAW_KEY, expect.anything());
  });

  it("rejects an invalid key before touching the durable limiter", async () => {
    mocks.verifyApiKey.mockResolvedValue(null);

    const response = await postA2a(request("/api/agent/ask", { question: "q" }));

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });
});
