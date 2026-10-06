import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessions = vi.hoisted(() => ({ current: vi.fn() }));
// Only the authenticated session/DB boundary is substituted. Origin checks and all
// retained-policy, request, signature and payment admission helpers remain real.
vi.mock("../account-sessions", async importOriginal => ({
  ...await importOriginal<typeof import("../account-sessions")>(), accountSessionContext: sessions.current,
}));

import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { BUYER_NETWORK, buyerTypedData } from "../buyer/protocol";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import type { BuyerIntent } from "../buyer/journal";
import type { KeryxDB } from "../db/keryx-db";
import {
  activateBusinessCanary, businessCanaryDirectory, businessCanaryHostIdentity, canaryExecutionPaused,
  type BusinessCanaryPolicy,
} from "../business-operator/canary-policy";
import { privateIncomingFacilitator, submitPrivateIncomingPayment } from "../payments/private-incoming-payment";
import { a2aOrderId } from "./order";
import { privatePurchaseBootstrap } from "./private-purchase-bootstrap";
import { privatePurchaseHandler } from "./private-purchase-handler";
import { privateResearchService } from "./private-research-service";
import { preparePrivateResearchIntent, type PrivateResearchIntent } from "./private-research-intent";
import { privatePaymentConfirmation, type PrivatePaymentState } from "./private-payment-state";

const now = "2026-10-06T12:00:00.000Z", fixtureParent = os.homedir();
// File creation, protection, readback and file fsync are real. Production also uses
// real directory fsync; Windows substitutes only that unsupported operation.
const flush = process.platform === "win32" ? () => {} : undefined;
const privatePayee = `0x${"4".repeat(40)}`, privateSigner = `0x${"5".repeat(40)}`;
const publicSeller = `0x${"1".repeat(40)}`;
const runtime = {
  KERYX_PRIVATE_RESEARCH_ENABLED: "1", KERYX_PRIVATE_RESEARCH_PAYEE: privatePayee,
  KERYX_PRIVATE_TREASURY_ADDRESS: privateSigner, KERYX_PRIVATE_TREASURY_CAPACITY_MICROS: "100000",
  KERYX_PRIVATE_SERVICE_FEE_MICROS: "20000", KERYX_PRIVATE_MODEL_ID: "deepseek-flash",
  KERYX_PRIVATE_PROVIDER: "deepseek", KERYX_PRIVATE_PROVIDER_BASE_URL: "https://synthetic.example/v1",
  KERYX_PRIVATE_PROVIDER_API_KEY: "synthetic-test-key-no-provider-authority",
  KERYX_PRIVATE_APPROVED_ENDPOINTS: '["https://synthetic.example/v1/chat/completions"]',
  KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES: privatePayee,
};
const context = { network: BUYER_NETWORK, publicSeller, publicTreasurySigners: [`0x${"3".repeat(40)}`], privateTreasurySigner: privateSigner };
const treasury = { signer: privateSigner, capacityMicros: "100000" };
let fixtureHome: string;

function activate() {
  const from = `0x${"1".repeat(40)}`, to = `0x${"2".repeat(40)}`, nonce = `0x${"a".repeat(64)}`;
  const original: BuyerIntent = { schema: "keryx-buyer-intent-v1",
    request: { question: "Synthetic public business original for private admission isolation", budget: 0.01,
      researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    requirement: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      amount: "30000", payTo: to, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    authorization: { from, to, value: "30000", nonce, validAfter: "1791248400", validBefore: "1791936000" },
    queryId: a2aOrderId({ network: ARC_MAINNET_PROFILE.networkId, payer: from, payee: to, authorizationId: nonce }) };
  const policy: BusinessCanaryPolicy = { format: "keryx-business-canary-v1", approvalId: "operator-business-20261006",
    approvedAt: "2026-10-06T03:23:02.644Z", expiresAt: "2026-10-07T00:00:00.000Z", priceCheckedOn: "2026-10-06",
    maximumOriginals: 1, maximumMicroUsd: 250000, maximumMicroUsdc: 60000, creatorPaymentMode: "forbidden",
    executionHostSha256: businessCanaryHostIdentity(), original };
  const directory = businessCanaryDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const file = path.join(fixtureHome, "policy.json"), bytes = JSON.stringify(policy);
  const digest = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  activateBusinessCanary(file, digest, flush);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", file); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", digest);
  return { directory, file };
}

const heldStates = ["active", "expired", "malformed", "removed selectors"] as const;
function held(state: typeof heldStates[number]) {
  const value = activate();
  if (state === "expired") vi.setSystemTime("2026-10-08T12:00:00.000Z");
  if (state === "malformed") fs.appendFileSync(value.file, "invalid-policy-bytes");
  if (state === "removed selectors") {
    vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
  }
  expect(canaryExecutionPaused()).toBe(true);
  return value;
}
function retained(directory: string) {
  return fs.readdirSync(directory).sort().map(name => [name, fs.readFileSync(path.join(directory, name), "utf8")]);
}
function database() {
  return {
    reservePrivateResearchIntent: vi.fn(async (intent: PrivateResearchIntent) => intent),
    getPrivateResearchIntent: vi.fn< KeryxDB["getPrivateResearchIntent"] >().mockResolvedValue(null),
    getPrivatePaymentState: vi.fn< KeryxDB["getPrivatePaymentState"] >().mockResolvedValue(null),
    reservePrivateTreasury: vi.fn< KeryxDB["reservePrivateTreasury"] >().mockResolvedValue(true),
    claimPrivatePaymentSubmission: vi.fn< KeryxDB["claimPrivatePaymentSubmission"] >(),
    confirmPrivatePayment: vi.fn< KeryxDB["confirmPrivatePayment"] >(),
  };
}
function asDb(db: ReturnType<typeof database>) { return db as unknown as KeryxDB; }
function expectUntouched(db: ReturnType<typeof database>) {
  for (const method of Object.values(db)) expect(method).not.toHaveBeenCalled();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function request(body = "{") {
  return new Request("https://keryx.cc/api/agent/private-ask", { method: "POST", body,
    headers: { origin: "https://keryx.cc", host: "keryx.cc", "content-type": "application/json" } });
}
async function privateFixture(db: ReturnType<typeof database>, facilitator: typeof privateIncomingFacilitator) {
  const service = privateResearchService(asDb(db), runtime, context, { facilitator, now: () => Date.now() })!;
  const quote = service.quote({ question: "Synthetic payer-private original held during a business canary", budget: 0.03,
    researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" });
  // Disposable in-memory test key: no wallet file, funding, network or reusable authorization.
  const buyer = privateKeyToAccount(generatePrivateKey());
  const merchants = { privatePayee, publicResearchPayee: publicSeller };
  const authorization = await createPrivateAuthorization(quote.request, quote.requirement, buyer.address, merchants, Date.now());
  const signature = await buyer.signTypedData(buyerTypedData(authorization.authorization));
  const submission = { request: authorization.request, salt: authorization.salt,
    payment: { authorization: authorization.authorization, signature } };
  const intent = await preparePrivateResearchIntent(submission, quote.requirement, merchants);
  return { service, submission, intent, payer: buyer.address.toLowerCase() };
}

beforeEach(() => {
  fixtureHome = fs.mkdtempSync(path.join(fixtureParent, "keryx-private-canary-test-")); fs.chmodSync(fixtureHome, 0o700);
  vi.spyOn(os, "homedir").mockReturnValue(fixtureHome);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
  vi.stubEnv("KERYX_PRIVATE_PURCHASE_ENABLED", "1");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("External HTTP forbidden in private admission fixtures"); }));
  sessions.current.mockReset();
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  const resolved = path.resolve(fixtureHome);
  if (path.dirname(resolved) !== path.resolve(fixtureParent) || !path.basename(resolved).startsWith("keryx-private-canary-test-"))
    throw Error("Unsafe private canary fixture cleanup");
  fs.rmSync(resolved, { recursive: true, force: true });
});

describe("private purchase admission while a retained finite business canary holds execution", () => {
  it.each(heldStates)("refuses %s before bootstrap, body parsing, DB admission or facilitator work", async state => {
    const db = database(), facilitator = vi.fn<typeof privateIncomingFacilitator>();
    const service = privateResearchService(asDb(db), runtime, context, { facilitator })!;
    const value = held(state), before = retained(value.directory);
    // Malformed customer input would normally produce 400; the hold precedes parsing.
    sessions.current.mockResolvedValue({ db: asDb(db), wallet: publicSeller, currentId: "synthetic-session" });
    const bootstrap = vi.fn(), limit = vi.fn();
    const response = await privatePurchaseHandler({ bootstrap, limit })(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(bootstrap).not.toHaveBeenCalled(); expect(limit).not.toHaveBeenCalled();
    // Readiness must expose purchasing unavailable without touching custody, DB or providers.
    const untouched = new Proxy({} as KeryxDB, { get() { throw Error("Bootstrap inspected DB while held"); } });
    expect(await privatePurchaseBootstrap(untouched, new AbortController().signal, publicSeller)).toBeNull();
    await expect(service.submit(null, publicSeller)).rejects.toThrow("holds new private admission");
    for (const action of ["verify", "settle"] as const)
      await expect(privateIncomingFacilitator(action, { paymentPayload: {}, paymentRequirements: {} })).rejects.toThrow("holds new private payment");
    expectUntouched(db); expect(facilitator).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(retained(value.directory)).toEqual(before);
  });

  it("rechecks the real retained policy after an awaited authenticated readiness observation", async () => {
    const db = database(), entered = deferred<void>(), release = deferred<void>();
    const submit = vi.fn(), quote = vi.fn();
    sessions.current.mockResolvedValue({ db: asDb(db), wallet: publicSeller, currentId: "synthetic-session" });
    const bootstrap = vi.fn(async () => { entered.resolve(); await release.promise; return { quote, submit }; });
    const limit = vi.fn(async () => null);
    const outcome = privatePurchaseHandler({ bootstrap, limit })(request("{}"));
    await entered.promise;
    const value = activate(), before = retained(value.directory); release.resolve();
    const response = await outcome;
    expect(response.status).toBe(503); expect(sessions.current).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled(); expectUntouched(db); expect(fetch).not.toHaveBeenCalled();
    expect(retained(value.directory)).toEqual(before);
  });

  it("retains a locally verified intent but never verifies payment when activation crosses awaited DB admission", async () => {
    const db = database(), facilitator = vi.fn<typeof privateIncomingFacilitator>();
    const value = await privateFixture(db, facilitator), entered = deferred<PrivateResearchIntent>(), release = deferred<void>();
    db.reservePrivateResearchIntent.mockImplementationOnce(async intent => { entered.resolve(intent); await release.promise; return intent; });
    const outcome = value.service.submit(value.submission, value.payer);
    const reserved = await entered.promise;
    expect(reserved).toEqual(value.intent);
    const hold = activate(), before = retained(hold.directory); release.resolve();
    await expect(outcome).rejects.toThrow("holds new private settlement");
    expect(db.reservePrivateResearchIntent).toHaveBeenCalledTimes(1);
    for (const [name, method] of Object.entries(db)) if (name !== "reservePrivateResearchIntent") expect(method).not.toHaveBeenCalled();
    expect(facilitator).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(retained(hold.directory)).toEqual(before);
  });

  it.each(["intent read", "payment-state read", "verify", "treasury reservation", "payment claim"] as const)
    ("never dispatches settlement if activation crosses an awaited %s", async boundary => {
      const db = database(), entered = deferred<void>(), release = deferred<void>();
      const facilitator = vi.fn<typeof privateIncomingFacilitator>(async action => {
        if (action !== "verify") throw Error("Settlement must not be called");
        if (boundary === "verify") { entered.resolve(); await release.promise; }
        return { isValid: true, payer: value.payer };
      });
      const value = await privateFixture(db, facilitator);
      const pending: PrivatePaymentState = { id: value.intent.id, startedAt: now, status: "pending", confirmation: null, settledAt: null };
      db.getPrivateResearchIntent.mockImplementationOnce(async () => {
        if (boundary === "intent read") { entered.resolve(); await release.promise; } return value.intent;
      });
      db.getPrivatePaymentState.mockImplementationOnce(async () => {
        if (boundary === "payment-state read") { entered.resolve(); await release.promise; } return null;
      });
      db.reservePrivateTreasury.mockImplementationOnce(async () => {
        if (boundary === "treasury reservation") { entered.resolve(); await release.promise; } return true;
      });
      db.claimPrivatePaymentSubmission.mockImplementationOnce(async () => {
        if (boundary === "payment claim") { entered.resolve(); await release.promise; } return { claimed: true, state: pending };
      });
      const outcome = submitPrivateIncomingPayment(asDb(db), value.intent.id, value.payer, { facilitator, treasury });
      await entered.promise;
      const hold = activate(), before = retained(hold.directory); release.resolve();
      if (boundary === "payment claim") expect(await outcome).toEqual({ status: "pending", confirmation: null });
      else await expect(outcome).rejects.toThrow("holds new private payment");
      expect(facilitator.mock.calls.map(([action]) => action)).toEqual(
        boundary === "intent read" || boundary === "payment-state read" ? [] : ["verify"],
      );
      expect(db.confirmPrivatePayment).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
      expect(retained(hold.directory)).toEqual(before);
    });

  it.each(["pending", "settled"] as const)("preserves read-only original %s recovery after retained-policy expiry", async status => {
    const db = database(), facilitator = vi.fn<typeof privateIncomingFacilitator>();
    const value = await privateFixture(db, facilitator);
    const authorization = value.intent.submission.payment.authorization;
    const confirmation = privatePaymentConfirmation({ source: "circle-facilitator-success", transaction: "synthetic-stored-proof-only",
      network: BUYER_NETWORK, payer: authorization.from, payee: authorization.to, amountMicros: authorization.value,
      authorizationId: authorization.nonce }, value.intent);
    const previous: PrivatePaymentState = status === "pending"
      ? { id: value.intent.id, startedAt: now, status, confirmation: null, settledAt: null }
      : { id: value.intent.id, startedAt: now, status, confirmation, settledAt: now };
    db.getPrivateResearchIntent.mockResolvedValue(value.intent); db.getPrivatePaymentState.mockResolvedValue(previous);
    const hold = held("expired"), before = retained(hold.directory);
    expect(await submitPrivateIncomingPayment(asDb(db), value.intent.id, value.payer, { facilitator, treasury }))
      .toEqual({ status, confirmation: previous.confirmation });
    expect(db.reservePrivateTreasury).not.toHaveBeenCalled(); expect(db.claimPrivatePaymentSubmission).not.toHaveBeenCalled();
    expect(db.confirmPrivatePayment).not.toHaveBeenCalled(); expect(facilitator).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(retained(hold.directory)).toEqual(before);
  });
});
