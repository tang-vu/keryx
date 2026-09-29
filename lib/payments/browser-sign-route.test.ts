import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { awaitSignature, cancelPending, getPendingChallenge } from "@/lib/payments/pending-signatures";

vi.mock("@/lib/payments/session-grants", () => ({
  getGrant: vi.fn().mockResolvedValue({ sessAddr: `0x${"11".repeat(20)}` }),
}));

import { POST } from "../../app/api/ask/sign/route";

const session = `0x${"11".repeat(20)}`;
const reqId = "test-request";
const challenge = {
  expectedSigner: session,
  requirements: {
    scheme: "exact", network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000", amount: "2000",
    payTo: `0x${"22".repeat(20)}`, maxTimeoutSeconds: 691200,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
  },
};

describe("POST /api/ask/sign", () => {
  afterEach(() => cancelPending(session, reqId));

  it("does not acknowledge or resolve an unsigned callback and keeps the original slot", async () => {
    const pending = awaitSignature(session, reqId, challenge);
    const request = new Request("http://localhost/api/ask/sign", {
      method: "POST", body: JSON.stringify({ sessionId: session, reqId, paymentHeader: "Zm9v" }),
    }) as NextRequest;
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(getPendingChallenge(session, reqId)).toEqual(challenge);
    cancelPending(session, reqId);
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("keeps the slot unresolved when callback contains a competing seller payload", async () => {
    const pending = awaitSignature(session, reqId, challenge);
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({
      signature: `0x${"ab".repeat(65)}`,
      authorization: {
        from: session, to: challenge.requirements.payTo, value: "2000",
        validAfter: String(now - 600), validBefore: String(now + 691200),
        nonce: `0x${"44".repeat(32)}`,
      },
      payload: {
        signature: `0x${"cd".repeat(65)}`,
        authorization: { nonce: `0x${"99".repeat(32)}` },
      },
    })).toString("base64");
    const request = new Request("http://localhost/api/ask/sign", {
      method: "POST", body: JSON.stringify({ sessionId: session, reqId, paymentHeader: header }),
    }) as NextRequest;

    expect((await POST(request)).status).toBe(400);
    expect(getPendingChallenge(session, reqId)).toEqual(challenge);
    cancelPending(session, reqId);
    await expect(pending).rejects.toThrow("cancelled");
  });
});
