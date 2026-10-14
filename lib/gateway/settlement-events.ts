import { createHash, verify, type KeyObject } from "node:crypto";
import type { PaymentRecord } from "../types";
import { checkPendingTransfer, type CircleX402Transfer } from "./x402-transfer-reconciliation";

export const SETTLEMENT_OBSERVER_LIMITS = Object.freeze({
  bodyBytes: 65_536, headers: 32, headerBytes: 8_192,
  requests: 100, hints: 100, bindings: 100, proofRows: 100,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const NONCE = /^0x[0-9a-f]{64}$/i;
const ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const GATEWAY_EVENTS = new Set([
  "gateway.deposit.finalized", "gateway.mint.finalized", "gateway.mint.forwarded",
]);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Trusted owner cache only. Never resolve a key/URL supplied in the message body. */
export interface CachedCircleNotificationKey {
  readonly id: string;
  readonly algorithm: "ECDSA_SHA_256";
  readonly publicKey: KeyObject;
}
export type CircleNotificationObservation =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "authenticated-non-x402-event"; readonly bodySha256: string;
      readonly subscriptionId: string; readonly notificationId: string; readonly notificationType: string };

/** Authentication of raw bytes ONLY. No supported Gateway event establishes an x402 join. */
export function observeCircleNotification(
  rawBody: Uint8Array,
  headers: readonly (readonly [string, string])[],
  trusted: {
    readonly ownedSubscriptionIds: readonly string[];
    readonly readCachedPublicKey: (keyId: string) => CachedCircleNotificationKey | null;
  },
): CircleNotificationObservation {
  const refuse = (reason: string): CircleNotificationObservation => Object.freeze({ kind: "refused", reason });
  if (!(rawBody instanceof Uint8Array) || !rawBody.byteLength ||
      rawBody.byteLength > SETTLEMENT_OBSERVER_LIMITS.bodyBytes ||
      !Array.isArray(headers) || headers.length > SETTLEMENT_OBSERVER_LIMITS.headers) return refuse("input-bound");
  if (!Array.isArray(trusted.ownedSubscriptionIds) || trusted.ownedSubscriptionIds.length > 20 ||
      !trusted.ownedSubscriptionIds.every(id => typeof id === "string" && UUID4.test(id))) return refuse("invalid-owned-subscriptions");
  const subscriptions = new Set(trusted.ownedSubscriptionIds.map(id => id.toLowerCase()));
  let keyId: string | undefined;
  let signature: string | undefined;
  let bytes = 0;
  for (const pair of headers) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(pair[0]) || pair[1].length > 1_024 || /[^\x20-\x7e]/.test(pair[1])) return refuse("invalid-headers");
    bytes += pair[0].length + pair[1].length;
    if (bytes > SETTLEMENT_OBSERVER_LIMITS.headerBytes) return refuse("input-bound");
    const name = pair[0].toLowerCase();
    if (name === "x-circle-key-id") {
      if (keyId !== undefined) return refuse("duplicate-signature-headers");
      keyId = pair[1];
    }
    if (name === "x-circle-signature") {
      if (signature !== undefined) return refuse("duplicate-signature-headers");
      signature = pair[1];
    }
  }
  if (!keyId || !UUID.test(keyId) || !signature || signature.length > 192 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) return refuse("invalid-signature-headers");
  const signatureBytes = Buffer.from(signature, "base64");
  if (signatureBytes.length < 8 || signatureBytes.toString("base64") !== signature) return refuse("invalid-signature-headers");
  // Copy before the callback: it cannot change the bytes being authenticated/parsed.
  const body = Buffer.from(rawBody);
  try {
    const cached = trusted.readCachedPublicKey(keyId.toLowerCase());
    if (!cached || cached.id.toLowerCase() !== keyId.toLowerCase() || cached.algorithm !== "ECDSA_SHA_256" ||
        cached.publicKey.type !== "public" || cached.publicKey.asymmetricKeyType !== "ec") return refuse("unavailable-trusted-key");
    if (!verify("sha256", body, { key: cached.publicKey, dsaEncoding: "der" }, signatureBytes)) return refuse("invalid-signature");
  } catch { return refuse("unavailable-or-invalid-signature"); }
  let envelope: unknown;
  try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { return refuse("invalid-envelope"); }
  if (!record(envelope) || envelope.version !== 2 || typeof envelope.subscriptionId !== "string" ||
      !UUID4.test(envelope.subscriptionId) || typeof envelope.notificationId !== "string" || !UUID4.test(envelope.notificationId) ||
      typeof envelope.notificationType !== "string" || envelope.notificationType.length > 128 || !record(envelope.notification) ||
      typeof envelope.timestamp !== "string" || envelope.timestamp.length > 40 || !Number.isFinite(Date.parse(envelope.timestamp))) return refuse("invalid-envelope");
  if (!subscriptions.has(envelope.subscriptionId.toLowerCase())) return refuse("unowned-subscription");
  if (!GATEWAY_EVENTS.has(envelope.notificationType)) return refuse("unsupported-notification-type");
  // Payload is deliberately not returned or interpreted: mint transferId is an attestation-group
  // ID, not an established x402 transfer ID, and deposits do not identify a paid request.
  return Object.freeze({ kind: "authenticated-non-x402-event", bodySha256: hash(body),
    subscriptionId: envelope.subscriptionId.toLowerCase(), notificationId: envelope.notificationId.toLowerCase(),
    notificationType: envelope.notificationType });
}

export interface AdmittedSettlementRequest {
  readonly requestId: string;
  readonly payment: Readonly<Pick<PaymentRecord,
    "payer" | "payee" | "network" | "amountUsdc" | "authorizationId" | "createdAt">>;
  /** Actual retained submission time; never inferred from admission or notification time. */
  readonly submittedAt: string | null;
}
/** Locally retained SDK SettleResultContext.result.transaction, bound by the caller to its
 * original admission. This is a hint even when result.success was true; it is never proof. */
export interface SettlementReceiptHint {
  readonly requestId: string;
  readonly transferId: string;
}
export interface SettlementRequestBinding {
  readonly requestId: string;
  readonly transferId: string;
  readonly authorizationId: string;
  readonly tupleSha256: string;
}
export interface RetainedSettlementProof {
  readonly transfers: readonly CircleX402Transfer[];
  /** Identity of the transfer whose confirmation time was actually recorded. */
  readonly confirmedTransferId: string | null;
  /** Independently recorded authoritative confirmation time; NOT transfer.updatedAt. */
  readonly confirmedAt: string | null;
}
export interface SettlementProofReadPort {
  /** Explicit cached/retained read only. No fetch, search, subscription or mutation fallback. */
  readRetainedProof(request: AdmittedSettlementRequest): RetainedSettlementProof | null;
}
export type SettlementObservationStatus =
  "confirmed" | "already-confirmed" | "awaiting" | "processing" | "failed-observed" | "unresolved" | "unavailable";
export interface SettlementRequestObservation {
  readonly requestId: string;
  readonly status: SettlementObservationStatus;
  readonly reason: string;
  readonly binding: SettlementRequestBinding | null;
  readonly latencyMs: number | null;
  readonly hint: "present" | "missing" | "conflicting";
}
export interface SettlementObservationSummary {
  readonly kind: "observed" | "refused";
  readonly reason: string | null;
  readonly requests: readonly SettlementRequestObservation[];
  readonly duplicateHints: number;
  readonly unmatchedHints: number;
  /** Missing retained hints, not proof that Circle dropped a delivery. */
  readonly confirmedWithoutHint: number;
}

function snapshotRequest(value: AdmittedSettlementRequest): AdmittedSettlementRequest | null {
  if (!record(value) || typeof value.requestId !== "string" || !ID.test(value.requestId) || !record(value.payment)) return null;
  const p = value.payment;
  if (typeof p.payer !== "string" || !ADDRESS.test(p.payer) || typeof p.payee !== "string" || !ADDRESS.test(p.payee) ||
      typeof p.network !== "string" || p.network.length > 32 || typeof p.authorizationId !== "string" || !NONCE.test(p.authorizationId) ||
      typeof p.amountUsdc !== "number" || typeof p.createdAt !== "string" || p.createdAt.length > 40 || !Number.isFinite(Date.parse(p.createdAt)) ||
      !(value.submittedAt === null || (typeof value.submittedAt === "string" && value.submittedAt.length <= 40))) return null;
  const micros = Math.round(p.amountUsdc * 1_000_000);
  if (!Number.isSafeInteger(micros) || micros <= 0 || p.amountUsdc !== micros / 1_000_000) return null;
  return Object.freeze({ requestId: value.requestId, submittedAt: value.submittedAt,
    payment: Object.freeze({ payer: p.payer.toLowerCase(), payee: p.payee.toLowerCase(), network: p.network,
      authorizationId: p.authorizationId.toLowerCase(), amountUsdc: p.amountUsdc, createdAt: p.createdAt }) });
}
function tupleHash(request: AdmittedSettlementRequest): string {
  const p = request.payment;
  return hash(JSON.stringify([p.authorizationId, p.payer, p.payee, p.network, "USDC", String(Math.round(p.amountUsdc * 1_000_000))]));
}
function snapshotProof(value: RetainedSettlementProof): RetainedSettlementProof | null {
  if (!record(value) || !Array.isArray(value.transfers) || value.transfers.length > SETTLEMENT_OBSERVER_LIMITS.proofRows ||
      !(value.confirmedTransferId === null || (typeof value.confirmedTransferId === "string" && ID.test(value.confirmedTransferId))) ||
      !(value.confirmedAt === null || (typeof value.confirmedAt === "string" && value.confirmedAt.length <= 40))) return null;
  const rows: CircleX402Transfer[] = [];
  for (const t of value.transfers) {
    if (!record(t) || !["id", "status", "token", "sendingNetwork", "recipientNetwork", "fromAddress", "toAddress", "amount", "nonce", "createdAt", "updatedAt"]
      .every(k => typeof t[k] === "string" && (t[k] as string).length <= 128) || !ID.test(t.id as string) ||
      !(t.txHash === null || (typeof t.txHash === "string" && t.txHash.length <= 128))) return null;
    rows.push(Object.freeze({ id: t.id, status: t.status, token: t.token, sendingNetwork: t.sendingNetwork,
      recipientNetwork: t.recipientNetwork, fromAddress: t.fromAddress, toAddress: t.toAddress, amount: t.amount,
      nonce: t.nonce, txHash: t.txHash, createdAt: t.createdAt, updatedAt: t.updatedAt }) as CircleX402Transfer);
  }
  return Object.freeze({ transfers: Object.freeze(rows), confirmedTransferId: value.confirmedTransferId, confirmedAt: value.confirmedAt });
}
function latency(submittedAt: string | null, confirmedAt: string | null): number | null {
  if (submittedAt === null || confirmedAt === null) return null;
  const start = Date.parse(submittedAt), end = Date.parse(confirmedAt);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start && Number.isSafeInteger(end - start) ? end - start : null;
}

/** Pure summary over one explicitly supplied retained window. No state promotion or persistence. */
export function observeSettlementRequests(input: {
  readonly requests: readonly AdmittedSettlementRequest[];
  readonly hints: readonly SettlementReceiptHint[];
  readonly retainedBindings: readonly SettlementRequestBinding[];
}, port: SettlementProofReadPort): SettlementObservationSummary {
  const refuse = (reason: string): SettlementObservationSummary => Object.freeze({ kind: "refused", reason,
    requests: Object.freeze([]), duplicateHints: 0, unmatchedHints: 0, confirmedWithoutHint: 0 });
  if (!Array.isArray(input.requests) || input.requests.length > SETTLEMENT_OBSERVER_LIMITS.requests ||
      !Array.isArray(input.hints) || input.hints.length > SETTLEMENT_OBSERVER_LIMITS.hints ||
      !Array.isArray(input.retainedBindings) || input.retainedBindings.length > SETTLEMENT_OBSERVER_LIMITS.bindings) return refuse("input-bound");
  const requests = input.requests.map(snapshotRequest);
  if (requests.some(r => r === null)) return refuse("invalid-admitted-history");
  const originals = (requests as AdmittedSettlementRequest[]).sort((a, b) => a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0);
  const bindings = new Map<string, SettlementRequestBinding>();
  const transfers = new Map<string, SettlementRequestBinding>();
  const authorizations = new Map<string, SettlementRequestBinding>();
  for (const b of input.retainedBindings) {
    if (!record(b) || typeof b.requestId !== "string" || !ID.test(b.requestId) || typeof b.transferId !== "string" || !ID.test(b.transferId) ||
        typeof b.authorizationId !== "string" || !NONCE.test(b.authorizationId) ||
        typeof b.tupleSha256 !== "string" || !DIGEST.test(b.tupleSha256)) return refuse("invalid-retained-bindings");
    const authorizationId = b.authorizationId.toLowerCase();
    for (const previous of [bindings.get(b.requestId), transfers.get(b.transferId), authorizations.get(authorizationId)]) {
      if (previous && (previous.requestId !== b.requestId || previous.transferId !== b.transferId ||
          previous.authorizationId !== authorizationId || previous.tupleSha256 !== b.tupleSha256)) return refuse("conflicting-retained-bindings");
    }
    const saved = Object.freeze({ requestId: b.requestId, transferId: b.transferId, authorizationId, tupleSha256: b.tupleSha256 });
    bindings.set(b.requestId, saved); transfers.set(b.transferId, saved); authorizations.set(authorizationId, saved);
  }
  const hints = new Map<string, Set<string>>();
  let duplicateHints = 0, unmatchedHints = 0;
  const originalIds = new Set(originals.map(r => r.requestId));
  for (const h of input.hints) {
    if (!record(h) || typeof h.requestId !== "string" || !ID.test(h.requestId) || typeof h.transferId !== "string" || !ID.test(h.transferId)) return refuse("invalid-hints");
    const ids = hints.get(h.requestId) ?? new Set<string>();
    if (ids.has(h.transferId)) duplicateHints++;
    else if (!originalIds.has(h.requestId)) unmatchedHints++;
    ids.add(h.transferId); hints.set(h.requestId, ids);
  }
  const proofIdentities = new Map<string, Set<string>>();
  const proofNonces = new Map<string, Set<string>>();
  // Collect every owned admission's retained witnesses before hints can refuse an outcome.
  // Only frozen originals reach this bounded synchronous port; hint IDs never trigger reads.
  const proofs = originals.map(request => {
    let proof: RetainedSettlementProof | null;
    try { const read = port.readRetainedProof(request); proof = read === null ? null : snapshotProof(read); }
    catch { proof = null; }
    if (!proof) return null;
    for (const t of proof.transfers) {
      const identities = proofIdentities.get(t.id) ?? new Set<string>();
      const proofNonce = t.nonce.trim().toLowerCase().replace(/^0x/, "");
      const identity = JSON.stringify([proofNonce, t.fromAddress.trim().toLowerCase(), t.toAddress.trim().toLowerCase(),
        t.sendingNetwork, t.recipientNetwork, t.token.toUpperCase(), t.amount,
        t.status === "failed" ? "failed" : ["received", "batched", "confirmed", "completed"].includes(t.status) ? "accepted" : "unknown"]);
      identities.add(identity);
      proofIdentities.set(t.id, identities);
      const nonceIdentities = proofNonces.get(proofNonce) ?? new Set<string>();
      nonceIdentities.add(JSON.stringify([t.id, identity]));
      proofNonces.set(proofNonce, nonceIdentities);
    }
    return proof;
  });
  const observations: SettlementRequestObservation[] = [];
  for (const [index, request] of originals.entries()) {
    const ids = hints.get(request.requestId);
    const hint = ids ? ids.size > 1 ? "conflicting" : "present" : "missing";
    const row = (status: SettlementObservationStatus, reason: string, binding: SettlementRequestBinding | null = null,
      latencyMs: number | null = null): SettlementRequestObservation => ({ requestId: request.requestId, status, reason, binding, latencyMs, hint });
    const prior = bindings.get(request.requestId);
    const priorNonce = authorizations.get(request.payment.authorizationId!);
    if (originals.filter(r => r.requestId === request.requestId || r.payment.authorizationId === request.payment.authorizationId).length !== 1 ||
        hint === "conflicting" || (prior && (prior.tupleSha256 !== tupleHash(request) || prior.authorizationId !== request.payment.authorizationId)) ||
        (priorNonce && priorNonce.requestId !== request.requestId)) {
      observations.push(row("unresolved", "ambiguous-or-changed-admission")); continue;
    }
    const proof = proofs[index];
    if (!proof) { observations.push(row("unavailable", "retained-proof-unavailable")); continue; }
    const nonceRows = proof.transfers.filter(t => t.nonce.trim().toLowerCase().replace(/^0x/, "") === request.payment.authorizationId!.slice(2));
    if (nonceRows.length > 1) { observations.push(row("unresolved", "duplicate-proof-nonce")); continue; }
    const payment: PaymentRecord = { ...request.payment, kind: "inbound", queryId: "", sourceId: "", sourceName: "",
      settled: false, settlementStatus: "pending" };
    const checked = checkPendingTransfer(payment, [...proof.transfers]);
    if (checked.verdict === "awaiting") { observations.push(row("awaiting", "no-authoritative-transfer")); continue; }
    if (checked.verdict === "mismatch" || !checked.transfer) { observations.push(row("unresolved", "authoritative-tuple-mismatch")); continue; }
    const t = checked.transfer;
    const used = transfers.get(t.id);
    if ((ids && !ids.has(t.id)) || (prior && prior.transferId !== t.id) ||
        (used && (used.requestId !== request.requestId || used.tupleSha256 !== tupleHash(request))) ||
        proof.transfers.filter(other => other.id === t.id).length !== 1) {
      observations.push(row("unresolved", "transfer-binding-mismatch")); continue;
    }
    if (checked.verdict === "failed") { observations.push(row("failed-observed", "authoritative-failed-observation")); continue; }
    if (t.status !== "confirmed" && t.status !== "completed") { observations.push(row("processing", "not-authoritatively-confirmed")); continue; }
    const binding = Object.freeze({ requestId: request.requestId, transferId: t.id,
      authorizationId: request.payment.authorizationId!, tupleSha256: tupleHash(request) });
    observations.push(row(prior ? "already-confirmed" : "confirmed", "exact-authoritative-transfer", binding,
      latency(request.submittedAt, proof.confirmedTransferId === t.id ? proof.confirmedAt : null)));
  }
  // Detect cross-read collisions before returning ANY binding. Read order is never authority.
  const collisions = new Set(observations.filter(r => r.binding && observations.some(other =>
    other !== r && other.binding?.transferId === r.binding!.transferId)).map(r => r.binding!.transferId));
  for (const [id, identities] of proofIdentities) if (identities.size > 1) collisions.add(id);
  const final = observations.map(r => Object.freeze(r.binding && (collisions.has(r.binding.transferId) ||
    (proofNonces.get(r.binding.authorizationId.slice(2))?.size ?? 0) > 1)
    ? { ...r, status: "unresolved" as const, reason: "ambiguous-transfer-owner", binding: null, latencyMs: null } : r));
  return Object.freeze({ kind: "observed", reason: null, requests: Object.freeze(final), duplicateHints, unmatchedHints,
    confirmedWithoutHint: final.filter(r => r.status === "confirmed" && r.hint === "missing").length });
}
