import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { BrowserCoSignGateway } from "./browser-cosign-gateway";
import { PaymentPendingError } from "./payment-state";
import { awaitSignature } from "./pending-signatures";
import { POST } from "../../app/api/ask/sign/route";
import type { PaymentRequirements } from "./x402-payment-evidence";
import type { BrowserJournalAdmission } from "../db/browser-authorization-journal";

const context = vi.hoisted(() => ({ db: null as unknown as SqliteAdapter }));
vi.mock("../db", () => ({ getDb: async () => context.db }));
vi.mock("../notify/alert", () => ({
  sendAlert: vi.fn().mockResolvedValue(true),
}));
const account = privateKeyToAccount(`0x${"11".repeat(32)}`),
  payee = `0x${"22".repeat(20)}`;
const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "2000",
  payTo: payee,
  maxTimeoutSeconds: 691200,
  extra: {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  },
};
const source = {
  id: "source",
  name: "Source",
  url: "https://synthetic.example",
  description: "synthetic",
  walletAddress: payee,
  fetchPrice: 0.002,
  tags: [],
  authors: [],
  createdAt: new Date().toISOString(),
};
let file: string;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  file = path.join(os.tmpdir(), `keryx-recovery-${crypto.randomUUID()}.sqlite`);
  context.db = new SqliteAdapter(file);
  await context.db.init();
  await context.db.upsertSessionGrant({
    sessionId: "owner",
    sessAddr: account.address,
    ownerAddr: "owner",
    cap: 0.004,
    expiry: Date.now() + 10 * 86400000,
    txHash: "synthetic",
    grantEpoch: "epoch",
  });
  await context.db.activateBrowserJournal();
});
afterEach(() => {
  context.db.close();
  for (const suffix of ["", "-wal", "-shm"])
    fs.rmSync(file + suffix, { force: true });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function input(requestId: string): BrowserJournalAdmission {
  return {
    sessionId: "owner",
    requestId,
    queryId: "query",
    grantEpoch: "epoch",
    signer: account.address,
    network: "eip155:5042002",
    token: requirements.asset,
    gatewayContract: requirements.extra.verifyingContract,
    sourceId: "source",
    offerId: null,
    kind: "fetch",
    payee,
    amountMicroUsdc: 2000,
    requirements,
    payment: {
      kind: "fetch",
      queryId: "query",
      sourceId: "source",
      sourceName: "Source",
      payer: account.address,
      payee,
      amountUsdc: 0.002,
      network: "eip155:5042002",
      grantEpoch: "epoch",
    },
  };
}
async function header(nonce: string, now = Math.floor(Date.now() / 1000), overrides: Partial<{validAfter: string; validBefore: string}> = {}) {
  const auth = {
    from: account.address,
    to: payee,
    value: "2000",
    validAfter: String(now - 600),
    validBefore: String(now + 691200),
    nonce,
    ...overrides,
  };
  const signature = await account.signTypedData({
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: 5042002,
      verifyingContract: requirements.extra.verifyingContract as `0x${string}`,
    },
    primaryType: "TransferWithAuthorization",
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    message: {
      ...auth,
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: nonce as `0x${string}`,
    },
  });
  return Buffer.from(
    JSON.stringify({ signature, authorization: auth })
  ).toString("base64");
}
function callback(reqId: string, paymentHeader: string) {
  return POST(
    new Request("http://localhost/api/ask/sign", {
      method: "POST",
      body: JSON.stringify({ sessionId: "owner", reqId, paymentHeader }),
    }) as NextRequest
  );
}
it("records a cryptographically valid lost callback after restart without paid replay and accepts identical callback replay", async () => {
  const admitted = await context.db.admitBrowserJournal(input("r"));
  if (admitted.status !== "admitted") throw new Error("admission");
  await context.db.exposeBrowserJournal("owner", "r");
  const signed = await header(admitted.journal.nonce);
  context.db.close();
  context.db = new SqliteAdapter(file);
  await context.db.init();
  const response = await callback("r", signed);
  expect(await response.json()).toEqual({ ok: true, delivered: false });
  expect((await context.db.getBrowserJournal("owner", "r"))?.phase).toBe(
    "signed"
  );
  expect((await context.db.getSessionGrant("owner"))?.spent).toBe(0.002);
  expect((await callback("r", signed)).status).toBe(200);
  expect(
    (await callback("r", await header(`0x${"99".repeat(32)}`))).status
  ).toBe(400);
});
it("does not acknowledge or resolve the live promise when signed metadata persistence fails", async () => {
  const admitted = await context.db.admitBrowserJournal(input("r"));
  if (admitted.status !== "admitted") throw new Error("admission");
  await context.db.exposeBrowserJournal("owner", "r");
  const abort = new AbortController(),
    pending = awaitSignature(
      "owner",
      "r",
      {
        requirements,
        expectedSigner: account.address,
        expectedNonce: admitted.journal.nonce,
      },
      abort.signal
    );
  const rejected = pending.catch((error: unknown) => error);
  vi.spyOn(context.db, "signBrowserJournal").mockRejectedValueOnce(
    new Error("storage fault")
  );
  expect(
    (await callback("r", await header(admitted.journal.nonce))).status
  ).toBe(503);
  expect((await context.db.getBrowserJournal("owner", "r"))?.phase).toBe(
    "exposed"
  );
  abort.abort();
  expect(await rejected).toBeInstanceOf(Error);
});
it("withholds live submission after replacement while preserving the original valid callback metadata", async () => {
  const admitted = await context.db.admitBrowserJournal(input("r"));
  if (admitted.status !== "admitted") throw new Error("admission");
  await context.db.exposeBrowserJournal("owner", "r");
  await context.db.upsertSessionGrant({
    sessionId: "owner",
    sessAddr: account.address,
    ownerAddr: "owner",
    cap: 0.004,
    expiry: Date.now() + 60000,
    txHash: "synthetic",
    grantEpoch: "replacement",
  });
  expect(
    await (await callback("r", await header(admitted.journal.nonce))).json()
  ).toEqual({ ok: true, delivered: false });
  expect((await context.db.getBrowserJournal("owner", "r"))?.phase).toBe(
    "signed"
  );
  expect((await context.db.getSessionGrant("owner"))?.spent).toBe(0.002);
});
it("persists submission before paid retry and settles the same admitted row without a second insert", async () => {
  const encoded = Buffer.from(
    JSON.stringify({ x402Version: 2, accepts: [requirements] })
  ).toString("base64");
  const receipt = Buffer.from(
    JSON.stringify({
      success: true,
      transaction: "circle-proof",
      payer: account.address,
      network: requirements.network,
    })
  ).toString("base64");
  const network = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("{}", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encoded },
      })
    )
    .mockImplementationOnce(async () => {
      const rows = await context.db.listPendingPayments(10);
      expect(rows).toHaveLength(1);
      expect(rows[0].authorizationPhase).toBe("submission_attempted");
      return Response.json(
        { content: "synthetic content" },
        { headers: { "PAYMENT-RESPONSE": receipt } }
      );
    });
  vi.stubGlobal("fetch", network);
  const gateway = new BrowserCoSignGateway(
    "owner",
    account.address,
    async (reqId, _requirements, _kind, _source, _paymentContext, nonce) => {
      const promise = awaitSignature("owner", reqId, {
        requirements,
        expectedSigner: account.address,
        expectedNonce: nonce,
      });
      const signed = await header(nonce);
      expect((await callback(reqId, signed)).status).toBe(200);
      return promise;
    },
    undefined,
    "epoch"
  );
  const result = await gateway.payFetch({ source, queryId: "query" });
  expect(result.payment.settled).toBe(true);
  expect(await context.db.listPayments(10)).toHaveLength(1);
  expect((await context.db.listPayments(10))[0].authorizationPhase).toBe(
    "settled"
  );
});
it("retains exposed nonce/cap after timeout and completes no paid retry", async () => {
  const encoded = Buffer.from(
    JSON.stringify({ x402Version: 2, accepts: [requirements] })
  ).toString("base64");
  const network = vi.fn().mockResolvedValue(
    new Response("{}", {
      status: 402,
      headers: { "PAYMENT-REQUIRED": encoded },
    })
  );
  vi.stubGlobal("fetch", network);
  const gateway = new BrowserCoSignGateway(
    "owner",
    account.address,
    async () => {
      throw new Error("callback timeout");
    },
    undefined,
    "epoch"
  );
  await expect(
    gateway.payFetch({ source, queryId: "query" })
  ).rejects.toBeInstanceOf(PaymentPendingError);
  expect(network).toHaveBeenCalledTimes(1);
  expect((await context.db.listPendingPayments(10))[0]).toMatchObject({
    authorizationPhase: "exposed",
    authorizationExpiresAt: undefined,
  });
  expect((await context.db.getSessionGrant("owner"))?.spent).toBe(0.002);
});

it("reopens the same submitted journal after paid response loss without releasing capacity", async () => {
  const encoded = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [requirements] })).toString("base64");
  const network = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encoded } }))
    .mockRejectedValueOnce(new Error("response lost after paid retry"));
  vi.stubGlobal("fetch", network);
  const gateway = new BrowserCoSignGateway("owner", account.address,
    async (_request, _challenge, _kind, _source, _context, nonce) => header(nonce), undefined, "epoch");
  await expect(gateway.payFetch({ source, queryId: "query" })).rejects.toBeInstanceOf(PaymentPendingError);
  const before = (await context.db.listPendingPayments(10))[0];
  expect(before.authorizationPhase).toBe("submission_attempted");
  expect(before.authorizationExpiresAt).toBeDefined();
  context.db.close();
  context.db = new SqliteAdapter(file);
  await context.db.init();
  expect((await context.db.listPendingPayments(10))[0]).toEqual(before);
  expect((await context.db.getSessionGrant("owner"))?.spent).toBe(0.002);
  expect(network).toHaveBeenCalledTimes(2);
});


it("recovers delayed original signing after two hours and acknowledges expired identical replays without delivery", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  const admitted = await context.db.admitBrowserJournal(input("late"));
  if (admitted.status !== "admitted") throw new Error("admission");
  await context.db.exposeBrowserJournal("owner", "late");
  const seconds = Math.floor(start / 1000);
  // Browser authority lookup can delay signing after admission.
  const signed = await header(admitted.journal.nonce, seconds + 30, {
    validAfter: String(seconds + 30),
  });
  context.db.close();
  context.db = new SqliteAdapter(file);
  await context.db.init();
  vi.setSystemTime(start + 2 * 3600000);
  expect(await (await callback("late", signed)).json()).toEqual({ ok: true, delivered: false });
  expect((await context.db.getBrowserJournal("owner", "late"))?.signedValidAfter).toBe(String(seconds + 30));
  expect((await callback("late", signed)).status).toBe(200);

  vi.setSystemTime(start + 9 * 86400000);
  const abort = new AbortController();
  const slot = awaitSignature("owner", "late", {
    requirements, expectedSigner: account.address, expectedNonce: admitted.journal.nonce,
  }, abort.signal);
  const rejected = slot.catch((error: unknown) => error);
  const paidFetch = vi.fn();
  vi.stubGlobal("fetch", paidFetch);
  expect(await (await callback("late", signed)).json()).toEqual({ ok: true, delivered: false });
  expect(paidFetch).not.toHaveBeenCalled();
  abort.abort();
  expect(await rejected).toBeInstanceOf(Error);
  expect((await callback("late", await header(admitted.journal.nonce, seconds + 30, {
    validAfter: String(seconds + 30), validBefore: String(seconds + 691229),
  }))).status).toBe(409);
  expect((await callback("late", await header(`0x${"99".repeat(32)}`, seconds))).status).toBe(400);
});

it("refuses authorization windows beyond the bounded original signing latency", async () => {
  const admitted = await context.db.admitBrowserJournal(input("future"));
  if (admitted.status !== "admitted") throw new Error("admission");
  await context.db.exposeBrowserJournal("owner", "future");
  const seconds = Math.floor(Date.parse(admitted.journal.admittedAt) / 1000);
  for (const bounds of [
    { validAfter: String(seconds + 301) },
    { validBefore: String(seconds + 691501) },
    { validAfter: String(seconds + 30), validBefore: String(seconds + 20) },
  ]) {
    expect((await callback("future", await header(admitted.journal.nonce, seconds, bounds))).status).toBe(400);
  }
  expect((await context.db.getBrowserJournal("owner", "future"))?.phase).toBe("exposed");
});
