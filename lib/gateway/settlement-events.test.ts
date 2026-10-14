import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CircleX402Transfer } from "./x402-transfer-reconciliation";
import {
  observeCircleNotification, observeSettlementRequests, SETTLEMENT_OBSERVER_LIMITS,
  type AdmittedSettlementRequest, type CachedCircleNotificationKey,
  type RetainedSettlementProof, type SettlementProofReadPort, type SettlementRequestBinding,
} from "./settlement-events";

// Generated only by the isolated fixture runner. No provider keys, wallets, SDK or real proof.
let keys: { privateKey: KeyObject; publicKey: KeyObject };
beforeAll(() => { keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }); });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden in passive observer fixture"); })); });
afterEach(() => { vi.unstubAllGlobals(); });
const KEY_ID = "10000000-0000-4000-8000-000000000001";
const SUB_ID = "20000000-0000-4000-8000-000000000002";
const NOTICE_ID = "30000000-0000-4000-8000-000000000003";
const START = "2026-01-01T00:00:00.000Z";
const END = "2026-01-01T00:00:01.234Z";
const nonce = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const rawNotice = (type = "gateway.mint.finalized", patch: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
  version: 2, subscriptionId: SUB_ID, notificationId: NOTICE_ID, notificationType: type,
  timestamp: END, notification: { transferId: "attestation-group-not-x402", attestations: [] }, ...patch,
}));
const signedHeaders = (body: Uint8Array): [string, string][] => [
  ["X-Circle-Signature", sign("sha256", body, keys.privateKey).toString("base64")], ["X-Circle-Key-Id", KEY_ID],
];
const cachedKey = (): CachedCircleNotificationKey => ({ id: KEY_ID, algorithm: "ECDSA_SHA_256", publicKey: keys.publicKey });
const trustedKeys = (readCachedPublicKey = vi.fn(() => cachedKey())) => ({ ownedSubscriptionIds: [SUB_ID], readCachedPublicKey });
const request = (patch: Partial<AdmittedSettlementRequest> = {}): AdmittedSettlementRequest => ({
  requestId: "request-one", submittedAt: START,
  payment: { payer: `0x${"1".repeat(40)}`, payee: `0x${"2".repeat(40)}`, network: "eip155:5042002",
    amountUsdc: 0.004001, authorizationId: nonce(1), createdAt: START }, ...patch,
});
const transfer = (patch: Partial<CircleX402Transfer> = {}): CircleX402Transfer => ({
  id: "synthetic-transfer-one", status: "confirmed", token: "USDC", sendingNetwork: "eip155:5042002",
  recipientNetwork: "eip155:5042002", fromAddress: request().payment.payer, toAddress: request().payment.payee,
  amount: "4001", nonce: nonce(1), txHash: null, createdAt: START, updatedAt: END, ...patch,
});
const proof = (rows: readonly CircleX402Transfer[] = [transfer()], confirmedAt: string | null = END): RetainedSettlementProof => ({
  transfers: rows, confirmedTransferId: rows[0]?.id ?? null, confirmedAt,
});
const observe = (options: {
  requests?: readonly AdmittedSettlementRequest[];
  hints?: readonly { requestId: string; transferId: string }[];
  retainedBindings?: readonly SettlementRequestBinding[];
  read?: SettlementProofReadPort["readRetainedProof"];
} = {}) => observeSettlementRequests({ requests: options.requests ?? [request()], hints: options.hints ?? [],
  retainedBindings: options.retainedBindings ?? [] }, { readRetainedProof: options.read ?? (() => proof()) });

describe("Circle raw-message authentication is not settlement", () => {
  it.each(["gateway.deposit.finalized", "gateway.mint.finalized", "gateway.mint.forwarded"])("authenticates %s without exposing a transfer/request/proof", type => {
    const body = rawNotice(type);
    const result = observeCircleNotification(body, signedHeaders(body), trustedKeys());
    expect(result).toMatchObject({ kind: "authenticated-non-x402-event", notificationId: NOTICE_ID, notificationType: type });
    expect(result).not.toHaveProperty("binding");
    expect(result).not.toHaveProperty("notification");
    expect(result).not.toHaveProperty("transferId");
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects altered raw bytes even when parsed JSON would be identical", () => {
    const body = rawNotice();
    expect(observeCircleNotification(Buffer.concat([body, Buffer.from("\n")]), signedHeaders(body), trustedKeys()))
      .toMatchObject({ kind: "refused", reason: "invalid-signature" });
  });
  it("rejects a forged signature and signed unknown types", () => {
    const body = rawNotice();
    const foreign = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(observeCircleNotification(body, [["X-Circle-Key-Id", KEY_ID],
      ["X-Circle-Signature", sign("sha256", body, foreign.privateKey).toString("base64")]], trustedKeys())).toMatchObject({ kind: "refused" });
    const unsupported = rawNotice("gateway.x402.settled");
    expect(observeCircleNotification(unsupported, signedHeaders(unsupported), trustedKeys()))
      .toMatchObject({ kind: "refused", reason: "unsupported-notification-type" });
  });
  it("does not use notification-supplied keys, URLs or financial fields", () => {
    const body = rawNotice("gateway.mint.finalized", { keyId: "other", publicKey: "attacker-key",
      url: "https://attacker.invalid", payee: "attacker", network: "attacker" });
    const read = vi.fn(() => cachedKey());
    expect(observeCircleNotification(body, signedHeaders(body), trustedKeys(read))).toMatchObject({ kind: "authenticated-non-x402-event" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(KEY_ID);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds headers, raw body and selector before touching the cache", () => {
    const body = rawNotice(), headers = signedHeaders(body), read = vi.fn(() => cachedKey());
    for (const input of [
      { body: new Uint8Array(SETTLEMENT_OBSERVER_LIMITS.bodyBytes + 1), headers },
      { body, headers: [...headers, ["x-circle-signature", headers[0][1]] as [string, string]] },
      { body, headers: [["X-Circle-Key-Id", "https://attacker.invalid/key"], headers[0]] as [string, string][] },
      { body, headers: [["X-Circle-Signature", "%%%="], headers[1]] as [string, string][] },
      { body, headers: [["X-Circle-Signature", "A".repeat(1_025)], headers[1]] as [string, string][] },
      { body, headers: [...headers, ["bad", "value\r\ninjected"] as [string, string]] },
    ]) expect(observeCircleNotification(input.body, input.headers, trustedKeys(read))).toMatchObject({ kind: "refused" });
    expect(read).not.toHaveBeenCalled();
  });
  it("refuses missing/unverified/wrong cached keys and unowned subscriptions", () => {
    const body = rawNotice(), headers = signedHeaders(body);
    expect(observeCircleNotification(body, headers, { ownedSubscriptionIds: [SUB_ID], readCachedPublicKey: () => null })).toMatchObject({ kind: "refused" });
    for (const patch of [{ id: SUB_ID }, { algorithm: "HMAC_SHA_256" }, { publicKey: keys.privateKey }]) {
      expect(observeCircleNotification(body, headers, { ownedSubscriptionIds: [SUB_ID],
        readCachedPublicKey: () => ({ ...cachedKey(), ...patch }) as CachedCircleNotificationKey })).toMatchObject({ kind: "refused" });
    }
    expect(observeCircleNotification(body, headers, { ownedSubscriptionIds: [], readCachedPublicKey: () => cachedKey() }))
      .toMatchObject({ kind: "refused", reason: "unowned-subscription" });
    const invalid = rawNotice("gateway.mint.finalized", { version: 1 });
    expect(observeCircleNotification(invalid, signedHeaders(invalid), trustedKeys())).toMatchObject({ kind: "refused", reason: "invalid-envelope" });
  });
  it("copies authenticated bytes before a cache callback can mutate the input", () => {
    const body = rawNotice(), headers = signedHeaders(body);
    const result = observeCircleNotification(body, headers, trustedKeys(vi.fn(() => { body.fill(0); return cachedKey(); })));
    expect(result).toMatchObject({ kind: "authenticated-non-x402-event" });
  });
});

describe("passive exact-request attribution over retained inputs", () => {
  it("notices a confirmed original with no hint, returning a frozen proposal and real recorded latency", () => {
    const original = request(), before = JSON.stringify(original);
    const read = vi.fn((_original: AdmittedSettlementRequest) => proof());
    const result = observe({ requests: [original], read });
    expect(result).toMatchObject({ kind: "observed", confirmedWithoutHint: 1,
      requests: [{ requestId: original.requestId, status: "confirmed", hint: "missing", latencyMs: 1_234,
        binding: { requestId: original.requestId, transferId: transfer().id } }] });
    expect(JSON.stringify(original)).toBe(before);
    expect(Object.isFrozen(read.mock.calls[0][0].payment)).toBe(true);
    expect(Object.isFrozen(result.requests[0].binding)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cannot promote from SDK success hints or an authenticated webhook with no authoritative proof", () => {
    const read = vi.fn(() => proof([]));
    const result = observe({ hints: [{ requestId: request().requestId, transferId: transfer().id }], read });
    expect(result.requests[0]).toMatchObject({ status: "awaiting", binding: null, latencyMs: null });
    expect(result.confirmedWithoutHint).toBe(0);
  });
  it("deduplicates/reorders hints, keeps an existing binding and notices unmatched hints without lookups", () => {
    const first = observe();
    const binding = first.requests[0].binding!;
    const h = { requestId: request().requestId, transferId: transfer().id };
    const orphan = { requestId: "outside-window", transferId: "outside-transfer" };
    const read = vi.fn((_original: AdmittedSettlementRequest) => proof());
    const a = observe({ hints: [h, orphan, h], retainedBindings: [binding, binding], read });
    const b = observe({ hints: [h, h, orphan], retainedBindings: [binding], read: () => proof([transfer({ status: "completed" })]) });
    expect(a).toEqual(b);
    expect(a).toMatchObject({ duplicateHints: 1, unmatchedHints: 1, requests: [{ status: "already-confirmed", binding }] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0].requestId).toBe(request().requestId);
  });
  it.each(["received", "batched", "failed", "unknown"])("observes %s without a confirmed binding", status => {
    const result = observe({ read: () => proof([transfer({ status: status as CircleX402Transfer["status"] })]) });
    expect(result.requests[0]).toMatchObject({ status: status === "failed" ? "failed-observed" : status === "unknown" ? "unresolved" : "processing",
      binding: null, latencyMs: null });
  });
  it.each([
    { fromAddress: `0x${"3".repeat(40)}` }, { toAddress: `0x${"3".repeat(40)}` },
    { sendingNetwork: "eip155:5042" }, { recipientNetwork: "eip155:5042" },
    { token: "OTHER" }, { amount: "4000" }, { amount: "4001.0" },
  ])("refuses a proof economic mismatch %j", patch => {
    expect(observe({ read: () => proof([transfer(patch)]) }).requests[0]).toMatchObject({ status: "unresolved", binding: null });
  });
  it("keeps an unmatched nonce awaiting and refuses malformed proof rather than calling a fallback", () => {
    expect(observe({ read: () => proof([transfer({ nonce: nonce(2) })]) }).requests[0]).toMatchObject({ status: "awaiting", binding: null });
    expect(observe({ read: () => proof([transfer({ amount: undefined as unknown as string })]) }).requests[0]).toMatchObject({ status: "unavailable", binding: null });
    expect(observe({ read: () => { throw new Error("retained read unavailable"); } }).requests[0]).toMatchObject({ status: "unavailable", binding: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses duplicate nonce evidence including a matching row plus a forged different tuple", () => {
    for (const duplicate of [transfer(), transfer({ id: "other", toAddress: `0x${"3".repeat(40)}` }),
      transfer({ id: "other", nonce: ` ${nonce(1).toUpperCase()} `, amount: "9999" })]) {
      expect(observe({ read: () => proof([transfer(), duplicate]) }).requests[0])
        .toMatchObject({ status: "unresolved", reason: "duplicate-proof-nonce", binding: null });
    }
  });
  it("collects owned witnesses but refuses duplicate admissions/nonces and conflicting hints", () => {
    const read = vi.fn((_original: AdmittedSettlementRequest) => proof());
    for (const extra of [request(), request({ requestId: "request-two" })]) {
      expect(observe({ requests: [request(), extra], read }).requests.every(r =>
        r.status === "unresolved" && r.binding === null && r.latencyMs === null)).toBe(true);
    }
    expect(observe({ hints: [{ requestId: request().requestId, transferId: "one" },
      { requestId: request().requestId, transferId: "two" }], read }).requests[0])
      .toMatchObject({ status: "unresolved", binding: null, latencyMs: null });
    expect(read).toHaveBeenCalledTimes(5);
    expect(read.mock.calls.every(([r]) => Object.isFrozen(r) && Object.isFrozen(r.payment))).toBe(true);
  });
  it("rejects a hint/prior proof mismatch and retained economic-tuple rebinding", () => {
    const binding = observe().requests[0].binding!;
    expect(observe({ hints: [{ requestId: request().requestId, transferId: "wrong" }] }).requests[0]).toMatchObject({ status: "unresolved", binding: null });
    expect(observe({ retainedBindings: [{ ...binding, transferId: "different-transfer" }] }).requests[0]).toMatchObject({ status: "unresolved", binding: null });
    const changed = request({ payment: { ...request().payment, payee: `0x${"3".repeat(40)}` } });
    const read = vi.fn((_original: AdmittedSettlementRequest) => proof());
    expect(observe({ requests: [changed], retainedBindings: [binding], read }).requests[0]).toMatchObject({ status: "unresolved", binding: null });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toEqual(changed);
    expect(observe({ retainedBindings: [binding, { ...binding, requestId: "request-two" }] }))
      .toMatchObject({ kind: "refused", reason: "conflicting-retained-bindings" });
  });
  it("refuses one confirmed transfer attributed to two originals across independent proof reads", () => {
    const two = request({ requestId: "request-two", payment: { ...request().payment, authorizationId: nonce(2) } });
    const read = (r: AdmittedSettlementRequest) => proof([transfer({ nonce: r.payment.authorizationId! })]);
    const result = observe({ requests: [request(), two], read });
    expect(result.requests).toHaveLength(2);
    expect(result.requests.every(r => r.status === "unresolved" && r.binding === null)).toBe(true);
    expect(observe({ requests: [two, request()], read })).toEqual(result);
  });
  it.each([
    { status: "confirmed", conflictingId: "request-one" },
    { status: "confirmed", conflictingId: "request-two" },
    { status: "failed", conflictingId: "request-one" },
    { status: "failed", conflictingId: "request-two" },
  ] as const)("keeps a $status cross-read witness from $conflictingId despite conflicting hints", ({ status, conflictingId }) => {
    const one = request();
    const two = request({ requestId: "request-two", payment: { ...one.payment, authorizationId: nonce(2) } });
    const safe = request({ requestId: "request-safe", payment: { ...one.payment, authorizationId: nonce(3) } });
    const originals = [one, two, safe], before = JSON.stringify(originals);
    const clean = conflictingId === one.requestId ? two : one;
    const retained = (r: AdmittedSettlementRequest) => proof([transfer({
      id: r.requestId === safe.requestId ? "safe-transfer" : transfer().id,
      nonce: r.payment.authorizationId!, status: r.requestId === conflictingId ? status : "confirmed",
    })]);
    // The other original has an exact confirmed proof and explicit synthetic recorded times in isolation.
    const isolated = observe({ requests: [clean], read: retained });
    expect(isolated.requests[0]).toMatchObject({ status: "confirmed", latencyMs: 1_234 });
    const binding = isolated.requests[0].binding!;
    const a = { requestId: conflictingId, transferId: "hint-a" };
    const b = { requestId: conflictingId, transferId: "hint-b" };
    const hints = [b, { requestId: "unowned", transferId: "orphan-a" }, a, b,
      { requestId: "unowned", transferId: "orphan-b" }];
    let baseline: ReturnType<typeof observe> | undefined;
    for (const retainedBindings of [[], [binding, binding]]) {
      for (const reversed of [false, true]) {
        const read = vi.fn(retained);
        const result = observe({ requests: reversed ? [...originals].reverse() : originals,
          hints: reversed ? [...hints].reverse() : hints, retainedBindings, read });
        expect(read).toHaveBeenCalledTimes(3);
        expect(read.mock.calls.map(([r]) => r.requestId)).toEqual([one.requestId, safe.requestId, two.requestId]);
        expect(read.mock.calls.every(([r]) => Object.isFrozen(r) && Object.isFrozen(r.payment))).toBe(true);
        expect(result.requests.find(r => r.requestId === clean.requestId)).toMatchObject({
          status: "unresolved", reason: "ambiguous-transfer-owner", binding: null, latencyMs: null,
        });
        expect(result.requests.find(r => r.requestId === conflictingId)).toMatchObject({
          status: "unresolved", reason: "ambiguous-or-changed-admission", hint: "conflicting", binding: null, latencyMs: null,
        });
        expect(result.requests.find(r => r.requestId === safe.requestId)).toMatchObject({
          status: "confirmed", hint: "missing", binding: { transferId: "safe-transfer", authorizationId: nonce(3) }, latencyMs: 1_234,
        });
        expect(result).toMatchObject({ kind: "observed", duplicateHints: 1, unmatchedHints: 2, confirmedWithoutHint: 1 });
        if (baseline) expect(result).toEqual(baseline);
        else baseline = result;
      }
    }
    expect(JSON.stringify(originals)).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("collects duplicate nonce witnesses in a conflicting-hint original's separate proof window", () => {
    const one = request();
    const two = request({ requestId: "request-two", payment: { ...one.payment, authorizationId: nonce(2) } });
    const contradictory = transfer({ id: "other-transfer", nonce: ` ${nonce(1).toUpperCase()} `, amount: "1234" });
    const read = vi.fn((r: AdmittedSettlementRequest) => r.requestId === two.requestId
      ? proof([contradictory, contradictory]) : proof());
    const hints = [{ requestId: two.requestId, transferId: "hint-a" }, { requestId: two.requestId, transferId: "hint-b" }];
    const result = observe({ requests: [one, two], hints, read });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.requests).toMatchObject([
      { requestId: one.requestId, status: "unresolved", reason: "ambiguous-transfer-owner", binding: null, latencyMs: null },
      { requestId: two.requestId, status: "unresolved", hint: "conflicting", binding: null, latencyMs: null },
    ]);
    expect(result.confirmedWithoutHint).toBe(0);
    expect(observe({ requests: [two, one], hints: [...hints].reverse(), read })).toEqual(result);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("also refuses conflicting failed evidence for a transfer claimed confirmed by another read", () => {
    const two = request({ requestId: "request-two", payment: { ...request().payment, authorizationId: nonce(2) } });
    const result = observe({ requests: [request(), two], read: r => proof([transfer({ nonce: r.payment.authorizationId!,
      status: r.requestId === two.requestId ? "failed" : "confirmed" })]) });
    expect(result.requests[0]).toMatchObject({ status: "unresolved", binding: null });
  });
  it("cannot rebind a retained nonce to a new request/transfer even when the proof looks exact", () => {
    const binding = observe().requests[0].binding!;
    const read = vi.fn((_original: AdmittedSettlementRequest) => proof([transfer({ id: "another-transfer" })]));
    expect(observe({ requests: [request({ requestId: "new-request" })], retainedBindings: [binding], read }).requests[0])
      .toMatchObject({ status: "unresolved", binding: null });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0].requestId).toBe("new-request");
  });
  it("detects a duplicate nonce split across retained proof windows, without trusting read order", () => {
    const two = request({ requestId: "request-two", payment: { ...request().payment, authorizationId: nonce(2) } });
    const result = observe({ requests: [request(), two], read: r => r.requestId === two.requestId
      ? proof([transfer({ id: "other-transfer", amount: "1234" })]) : proof() });
    expect(result.requests.every(r => r.binding === null)).toBe(true);
    expect(result.requests[0]).toMatchObject({ status: "unresolved" });
  });
  it.each(["eip155:5042", "eip155:5042002"])("uses the recorded canonical %s tuple without deployment defaults", network => {
    const original = request({ payment: { ...request().payment, network } });
    expect(observe({ requests: [original], read: () => proof([transfer({ sendingNetwork: network, recipientNetwork: network })]) }).requests[0])
      .toMatchObject({ status: "confirmed", binding: { authorizationId: nonce(1) } });
  });
  it.each([null, "invalid", "2025-01-01T00:00:00.000Z"])("does not invent latency for confirmation time %s", confirmedAt => {
    expect(observe({ read: () => proof([transfer()], confirmedAt) }).requests[0]).toMatchObject({ status: "confirmed", latencyMs: null });
  });
  it("keeps absent submission latency NULL and permits zero only from two explicit recorded times", () => {
    expect(observe({ requests: [request({ submittedAt: null })] }).requests[0].latencyMs).toBeNull();
    expect(observe({ read: () => proof([transfer()], START) }).requests[0].latencyMs).toBe(0);
    expect(observe({ read: () => proof([transfer({ updatedAt: END })], null) }).requests[0].latencyMs).toBeNull();
    expect(observe({ read: () => ({ ...proof(), confirmedTransferId: "different-transfer" }) }).requests[0].latencyMs).toBeNull();
  });
  it("bounds the entire retained input and each proof read without truncating or implying completeness", () => {
    const read = vi.fn(() => proof());
    expect(observe({ requests: Array.from({ length: SETTLEMENT_OBSERVER_LIMITS.requests + 1 }, () => request()), read }))
      .toMatchObject({ kind: "refused", reason: "input-bound" });
    expect(read).not.toHaveBeenCalled();
    expect(observe({ read: () => proof(Array.from({ length: SETTLEMENT_OBSERVER_LIMITS.proofRows + 1 }, () => transfer())) }).requests[0])
      .toMatchObject({ status: "unavailable", binding: null });
    expect(observe({ requests: [request({ payment: { ...request().payment, amountUsdc: 0.0000001 } })], read }))
      .toMatchObject({ kind: "refused", reason: "invalid-admitted-history" });
    expect(observe({ requests: [request({ payment: { ...request().payment, amountUsdc: 0.00400100001 } })], read }))
      .toMatchObject({ kind: "refused", reason: "invalid-admitted-history" });
  });
  it("does not infer a supported original network from otherwise exact-looking proof", () => {
    const original = request({ payment: { ...request().payment, network: "arcTestnet" } });
    expect(observe({ requests: [original], read: () => proof([transfer({ sendingNetwork: "arcTestnet", recipientNetwork: "arcTestnet" })]) })
      .requests[0]).toMatchObject({ status: "unresolved", binding: null });
  });
});
