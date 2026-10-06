import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), settle: vi.fn(), getDb: vi.fn(), claim: vi.fn() }));
vi.mock("./config", () => ({ config: { networkId: "eip155:5042", usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", maxTimeoutSeconds: 691200,
  sellerAddress: `0x${"2".repeat(40)}`, privateResearchReservedPayees: "" } }));
vi.mock("./payment-runtime-config", () => ({ paymentRuntimeConfig: () => ({ gatewayApiUrl: "https://synthetic-facilitator.invalid" }) }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("@circle-fin/x402-batching/server", () => ({ BatchFacilitatorClient: class {
  verify = mocks.verify; settle = mocks.settle;
} }));

import { settleThenServe, type PaidOptions } from "./x402-server";
import { ARC_MAINNET_PROFILE } from "./arc-network-profile";
import { a2aOrderId } from "./a2a/order";
import type { BuyerIntent } from "./buyer/journal";
import { businessCanaryPaidAdmission, canaryUnavailableResponse } from "./business-operator/canary-paid-admission";
import { activateBusinessCanary, assertPreparedCanarySubmission, businessCanaryDirectory, businessCanaryHostIdentity,
  reserveCanaryInboundSettlement, type BusinessCanaryPolicy } from "./business-operator/canary-policy";

const payer = `0x${"1".repeat(40)}`, payee = `0x${"2".repeat(40)}`, nonce = `0x${"a".repeat(64)}`;
const authorization = { from: payer, to: payee, value: "30000", nonce, validAfter: "1791248400", validBefore: "1791936000" };
const valid = { isValid: true, payer };
const settled = { success: true, payer, transaction: "synthetic-confirmed-receipt", network: ARC_MAINNET_PROFILE.networkId };
const options: PaidOptions = { priceUsdc: 0.03, payTo: payee, endpoint: "/api/agent/ask", purchasePurpose: "a2a",
  purchaseRequestHash: "a".repeat(64) };
const discovery = { path: options.endpoint, method: "POST" };
const fixtureParent = os.homedir(), fixtureRoots: string[] = [];
const flush = process.platform === "win32" ? () => {} : undefined;

function paidRequest() {
  return new NextRequest(`http://localhost${options.endpoint}`, { method: "POST", headers: {
    "payment-signature": Buffer.from(JSON.stringify({ authorization, signature: "synthetic-never-signed-or-forwarded" })).toString("base64"),
  } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mutableAdmission() {
  let held = false;
  return { hold: () => { held = true; }, check: vi.fn(() => held ? canaryUnavailableResponse() : null) };
}
async function expectHeld(response: Response) {
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "research_service_unavailable" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("payment-response")).toBeNull();
}
function protectedOriginal() {
  const root = fs.mkdtempSync(path.join(fixtureParent, "keryx-x402-canary-test-")); fixtureRoots.push(root); fs.chmodSync(root, 0o700);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  const original: BuyerIntent = { schema: "keryx-buyer-intent-v1",
    request: { question: "Which supplier bounds apply to this single research original?", budget: 0.01,
      researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    requirement: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      amount: "30000", payTo: payee, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    authorization, queryId: a2aOrderId({ network: ARC_MAINNET_PROFILE.networkId, payer, payee, authorizationId: nonce }) };
  const policy: BusinessCanaryPolicy = { format: "keryx-business-canary-v1", approvalId: "operator-business-20261006",
    approvedAt: "2026-10-06T03:23:02.644Z", expiresAt: "2026-10-07T00:00:00.000Z", priceCheckedOn: "2026-10-06",
    maximumOriginals: 1, maximumMicroUsd: 250000, maximumMicroUsdc: 60000, creatorPaymentMode: "forbidden",
    executionHostSha256: businessCanaryHostIdentity(), original };
  const directory = businessCanaryDirectory(); fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const file = path.join(root, "policy.json"), bytes = JSON.stringify(policy), digest = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(file, bytes, { mode: 0o600 }); activateBusinessCanary(file, digest, flush);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", file); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", digest);
  assertPreparedCanarySubmission(original, flush);
  const req = paidRequest();
  const input = { body: original.request, signatureHeader: req.headers.get("payment-signature"), network: ARC_MAINNET_PROFILE.networkId,
    payee, amountMicroUsdc: "30000", creatorBudgetMicroUsdc: "10000", bot: false };
  const admissionCheck = () => businessCanaryPaidAdmission(input);
  const beforeSettlement = () => {
    const held = admissionCheck(); if (held) return held;
    // Same exclusive central ledger as the production callback. Only its injectable Windows
    // directory flush differs; file creation/readback/fsync are real, POSIX uses production flush.
    try { reserveCanaryInboundSettlement(flush); return null; } catch { return canaryUnavailableResponse(); }
  };
  return { directory, original, admissionCheck, beforeSettlement };
}

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime("2026-10-06T12:00:00.000Z");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Network is forbidden in seller admission fixtures"); }));
  vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.verify.mockResolvedValue(valid); mocks.settle.mockResolvedValue(settled);
  mocks.claim.mockResolvedValue(undefined); mocks.getDb.mockResolvedValue({ claimResearchPurchase: mocks.claim });
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const root of fixtureRoots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(fixtureParent) || !path.basename(resolved).startsWith("keryx-x402-canary-test-"))
      throw Error("Unsafe x402 fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("seller mutable admission at every vendor boundary", () => {
  it("returns the held response before the first verify, DB claim or settlement", async () => {
    const admission = mutableAdmission(), beforeSettlement = vi.fn(), produce = vi.fn(); admission.hold();
    await expectHeld(await settleThenServe(paidRequest(), { ...options, discovery, admissionCheck: admission.check, beforeSettlement }, produce));
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled(); expect(beforeSettlement).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
  });

  it("rechecks after a successful verify await before claiming an original", async () => {
    const admission = mutableAdmission(), started = deferred<void>(), verified = deferred<typeof valid>(), produce = vi.fn();
    mocks.verify.mockImplementation(() => { started.resolve(); return verified.promise; });
    const pending = settleThenServe(paidRequest(), { ...options, admissionCheck: admission.check }, produce);
    await started.promise; admission.hold(); verified.resolve(valid);
    await expectHeld(await pending);
    expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
  });

  it("rechecks a hold acquired during getDb before the native purchase claim", async () => {
    const admission = mutableAdmission(), started = deferred<void>(), database = deferred<{ claimResearchPurchase: typeof mocks.claim }>();
    mocks.getDb.mockImplementation(() => { started.resolve(); return database.promise; });
    const pending = settleThenServe(paidRequest(), { ...options, admissionCheck: admission.check }, () => ({}));
    await started.promise; admission.hold(); database.resolve({ claimResearchPurchase: mocks.claim });
    await expectHeld(await pending);
    expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("retains the native claim but never settles if admission changes during its await", async () => {
    const admission = mutableAdmission(), started = deferred<void>(), claimed = deferred<void>(), beforeSettlement = vi.fn();
    mocks.claim.mockImplementation(() => { started.resolve(); return claimed.promise; });
    const pending = settleThenServe(paidRequest(), { ...options, admissionCheck: admission.check, beforeSettlement }, () => ({}));
    await started.promise; admission.hold(); claimed.resolve();
    await expectHeld(await pending);
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ authorizationId: nonce, purpose: "a2a", amountMicros: 30000 }));
    expect(beforeSettlement).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("treats a retained before-settlement refusal as held, without retry or bare fallback", async () => {
    const beforeSettlement = vi.fn(canaryUnavailableResponse), produce = vi.fn();
    await expectHeld(await settleThenServe(paidRequest(), { ...options, discovery, beforeSettlement }, produce));
    expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(beforeSettlement).toHaveBeenCalledTimes(1); expect(mocks.settle).not.toHaveBeenCalled(); expect(produce).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not verify again after a hold during retry backoff", async () => {
    const admission = mutableAdmission(), attempted = deferred<void>();
    mocks.verify.mockImplementationOnce(async () => { attempted.resolve(); throw Error("synthetic transient verification failure"); });
    const pending = settleThenServe(paidRequest(), { ...options, discovery, admissionCheck: admission.check }, () => ({}));
    await attempted.promise; admission.hold(); await vi.runAllTimersAsync();
    await expectHeld(await pending);
    expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
  });

  it.each(["soft rejection", "exhausted throwing attempts"] as const)
    ("rechecks admission before bare verification after %s", async kind => {
      const admission = mutableAdmission();
      if (kind === "soft rejection") mocks.verify.mockImplementationOnce(async () => {
        admission.hold(); return { isValid: false, invalidReason: "synthetic extension rejection" };
      });
      else mocks.verify.mockRejectedValueOnce(Error("synthetic first rejection")).mockImplementationOnce(async () => {
        admission.hold(); throw Error("synthetic second rejection");
      });
      const pending = settleThenServe(paidRequest(), { ...options, discovery, admissionCheck: admission.check }, () => ({}));
      await vi.runAllTimersAsync(); await expectHeld(await pending);
      expect(mocks.verify).toHaveBeenCalledTimes(kind === "soft rejection" ? 1 : 2);
      expect(mocks.verify.mock.calls.every(([payload]) => !!payload.extensions)).toBe(true);
      expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.settle).not.toHaveBeenCalled();
    });

  it.each(["retry", "bare fallback"] as const)("rechecks a hold before a normal settlement %s", async stage => {
    const admission = mutableAdmission(), beforeSettlement = vi.fn(() => null), produce = vi.fn();
    if (stage === "bare fallback") mocks.settle.mockRejectedValueOnce(Error("synthetic first ambiguous settlement"));
    mocks.settle.mockImplementationOnce(async () => { admission.hold(); throw Error("synthetic lost settlement response"); });
    const pending = settleThenServe(paidRequest(), { ...options, discovery, admissionCheck: admission.check, beforeSettlement }, produce);
    await vi.runAllTimersAsync(); await expectHeld(await pending);
    const attempts = stage === "retry" ? 1 : 2;
    expect(mocks.settle).toHaveBeenCalledTimes(attempts); expect(beforeSettlement).toHaveBeenCalledTimes(attempts);
    expect(mocks.settle.mock.calls.every(([payload]) => !!payload.extensions && payload.payload.authorization.nonce === nonce)).toBe(true);
    expect(mocks.claim).toHaveBeenCalledTimes(1); expect(produce).not.toHaveBeenCalled();
  });
});

describe("finite original settlement exposure and ordinary compatibility", () => {
  it.each([false, true])("makes exactly one finite ambiguous settlement attempt with discovery=%s", async extended => {
    const admissionCheck = vi.fn(() => null), beforeSettlement = vi.fn(() => null), produce = vi.fn();
    mocks.settle.mockRejectedValue(Error("synthetic timeout after possible debit"));
    const response = await settleThenServe(paidRequest(), { ...options, ...(extended ? { discovery } : {}),
      singleSettlementAttempt: true, admissionCheck, beforeSettlement }, produce);
    expect(response.status).toBe(500); expect(response.headers.get("payment-response")).toBeNull();
    expect(mocks.verify).toHaveBeenCalledTimes(1); expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.settle).toHaveBeenCalledTimes(1); expect(beforeSettlement).toHaveBeenCalledTimes(1);
    expect(produce).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps normal retry compatible while admitting every identical-nonce vendor attempt", async () => {
    const admissionCheck = vi.fn(() => null), beforeSettlement = vi.fn(() => null);
    mocks.settle.mockRejectedValueOnce(Error("synthetic transient reply loss"));
    const pending = settleThenServe(paidRequest(), { ...options, admissionCheck, beforeSettlement }, () => ({ delivered: true }));
    await vi.runAllTimersAsync(); const response = await pending;
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ delivered: true });
    expect(mocks.settle).toHaveBeenCalledTimes(2); expect(beforeSettlement).toHaveBeenCalledTimes(2);
    expect(admissionCheck).toHaveBeenCalledTimes(4); // verify, post-getDb, each settle attempt.
    expect(mocks.settle.mock.calls[0]).toEqual(mocks.settle.mock.calls[1]);
    expect(response.headers.get("payment-response")).toBeTruthy();
  });

  it("keeps normal bare settlement fallback compatible with a fresh admission before it", async () => {
    const admissionCheck = vi.fn(() => null), beforeSettlement = vi.fn(() => null);
    mocks.settle.mockImplementation(async payload => { if (payload.extensions) throw Error("synthetic extension rejection"); return settled; });
    const pending = settleThenServe(paidRequest(), { ...options, discovery, admissionCheck, beforeSettlement }, () => ({ delivered: true }));
    await vi.runAllTimersAsync(); const response = await pending;
    expect(response.status).toBe(200); expect(mocks.settle).toHaveBeenCalledTimes(3);
    expect(beforeSettlement).toHaveBeenCalledTimes(3); expect(admissionCheck).toHaveBeenCalledTimes(5);
    expect(mocks.settle.mock.calls[2][0].extensions).toBeUndefined();
    expect(mocks.settle.mock.calls.every(([payload]) => payload.payload.authorization.nonce === nonce)).toBe(true);
  });

  it.each(["queued response", "producer failure"] as const)("retains a confirmed finite receipt for %s", async outcome => {
    const beforeSettlement = vi.fn(() => null), produce = vi.fn(() => {
      if (outcome === "producer failure") throw Error("synthetic saved-result failure");
      return Response.json({ status: "queued" }, { status: 202, headers: { Location: "/original-poll", "Retry-After": "2" } });
    });
    const response = await settleThenServe(paidRequest(), { ...options, singleSettlementAttempt: true, beforeSettlement }, produce);
    expect(response.status).toBe(outcome === "queued response" ? 202 : 500);
    expect(mocks.settle).toHaveBeenCalledTimes(1); expect(beforeSettlement).toHaveBeenCalledTimes(1);
    expect(beforeSettlement.mock.invocationCallOrder[0]).toBeLessThan(mocks.settle.mock.invocationCallOrder[0]);
    expect(produce).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ authorizationId: nonce, transaction: settled.transaction, amountUsdc: 0.03 }));
    const receipt = JSON.parse(Buffer.from(response.headers.get("payment-response")!, "base64").toString("utf8"));
    expect(receipt).toEqual({ success: true, transaction: settled.transaction, payer, network: ARC_MAINNET_PROFILE.networkId });
    if (outcome === "queued response") {
      expect(response.headers.get("location")).toBe("/original-poll"); expect(response.headers.get("retry-after")).toBe("2");
    }
  });

  it("lets only one concurrent POST cross the actual retained inbound ledger, preserving an ambiguous attempt", async () => {
    const value = protectedOriginal(), started = deferred<void>(), verified = deferred<typeof valid>();
    const before = fs.readFileSync(path.join(value.directory, "original.json"), "utf8");
    mocks.verify.mockImplementation(() => { if (mocks.verify.mock.calls.length === 2) started.resolve(); return verified.promise; });
    mocks.settle.mockRejectedValue(Error("synthetic ambiguity after the exclusive original exposure"));
    const produce = vi.fn(), opts = { ...options, discovery, admissionCheck: value.admissionCheck,
      beforeSettlement: value.beforeSettlement, singleSettlementAttempt: true };
    const first = settleThenServe(paidRequest(), opts, produce), second = settleThenServe(paidRequest(), opts, produce);
    await started.promise; verified.resolve(valid);
    const responses = await Promise.all([first, second]);
    expect(responses.map(response => response.status).sort()).toEqual([500, 503]);
    expect(mocks.settle).toHaveBeenCalledTimes(1); expect(produce).not.toHaveBeenCalled();
    const file = path.join(value.directory, "inbound-settlement.json"), retained = fs.readFileSync(file, "utf8");
    expect(JSON.parse(retained)).toMatchObject({ format: "keryx-business-canary-inbound-attempt-v1",
      queryId: value.original.queryId, outcome: "held-regardless-of-facilitator-outcome" });
    expect(fs.readFileSync(path.join(value.directory, "original.json"), "utf8")).toBe(before);
    const again = await settleThenServe(paidRequest(), opts, produce);
    await expectHeld(again); expect(mocks.settle).toHaveBeenCalledTimes(1); expect(fs.readFileSync(file, "utf8")).toBe(retained);
    expect(fs.readdirSync(value.directory).sort()).toEqual(["inbound-settlement.json", "original.json", "window.json"]);
  });
});
