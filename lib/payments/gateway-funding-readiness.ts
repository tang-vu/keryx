import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { canonicalJson } from "../canonical-json";
import { gatewayAvailableAtomic } from "../gateway/available-balance";
import { storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";
import { validateFundingNamespace } from "../db/gateway-funding-ledger-validation";
import type { GatewayFundingLedger } from "../db/gateway-funding-ledger-types";
import { gatewayFundingReplayDigest, validateGatewayFundingOperation } from "./gateway-funding-policy";
import { validatePreparedGatewayFundingTransaction } from "./gateway-funding-transaction";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "./gateway-funding-receipt-policy";

const capturedFetch = globalThis.fetch.bind(globalThis), now = performance.now.bind(performance);
const ENDPOINT = "https://gateway-api-testnet.circle.com/v1/balances";
const TOTAL_MS = 15000, REQUEST_MS = 5000, TTL_MS = 5000, MAX_BYTES = 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const KEYS = ["ledger", "operationId", "expectedIdentity", "expectedBackendBindingDigest", "installedPolicyDigest", "finalityPolicyDigest", "assertCurrentAuthority"];
function refuse(): never { throw new Error("Gateway funding readiness unknown; inspect original operation"); }
function digest(value: unknown) { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function shape(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).sort().join(",") !== [...keys].sort().join(",")
    || Object.values(descriptors).some(d => !d.enumerable || !("value" in d))) refuse();
  return Object.fromEntries(Object.entries(descriptors).map(([k, d]) => [k, d.value]));
}
export interface GatewayFundingReadinessRequest {
  /** Trusted host composition, never an HTTP/JSON ledger or caller terminal flag. */
  readonly ledger: GatewayFundingLedger;
  readonly operationId: string;
  readonly expectedIdentity: Readonly<StorageIdentity>;
  readonly expectedBackendBindingDigest: string;
  readonly installedPolicyDigest: string;
  readonly finalityPolicyDigest: string;
  readonly assertCurrentAuthority: () => void;
}
export interface GatewayFundingReadinessEvidence {
  readonly format: "gateway-funding-readiness-evidence-v1";
  readonly basis: "finalized-original-deposit-plus-current-available";
  /** Descriptive current observation only: not credit attribution or permission. */
  readonly currentFundingReady: true;
  readonly identityDigest: string;
  readonly backendBindingDigest: string;
  readonly policyDigest: string;
  readonly finalityPolicyDigest: string;
  readonly operationDigest: string;
  readonly operationId: string;
  readonly namespaceDigest: string;
  readonly depositor: string;
  readonly domain: 26;
  readonly depositTransactionHash: string;
  readonly availableMicros: string;
  readonly minimumAvailableMicros: string;
}
declare const verified: unique symbol;
export interface VerifiedGatewayFundingReadiness { readonly [verified]: true }
type Issued = { ledger: GatewayFundingLedger; guard: () => void; metadata: string; snapshot: string;
  observed: number; evidence: Readonly<GatewayFundingReadinessEvidence> };
const issued = new WeakMap<object, Issued>();
function metadata(request: GatewayFundingReadinessRequest) {
  const r = shape(request, KEYS), identity = validateStorageIdentity(r.expectedIdentity);
  if (identity.authorityMode !== "testnet-real" || typeof r.operationId !== "string" || !UUID.test(r.operationId)
    || typeof r.expectedBackendBindingDigest !== "string" || !DIGEST.test(r.expectedBackendBindingDigest)
    || typeof r.installedPolicyDigest !== "string" || !DIGEST.test(r.installedPolicyDigest)
    || r.finalityPolicyDigest !== GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST || typeof r.assertCurrentAuthority !== "function") refuse();
  return { identity, key: digest({ operationId: r.operationId, identity, backend: r.expectedBackendBindingDigest,
    policy: r.installedPolicyDigest, finality: r.finalityPolicyDigest }) };
}
function binding(request: GatewayFundingReadinessRequest) {
  const original = metadata(request), ledger = request.ledger, guard = request.assertCurrentAuthority;
  const check = () => {
    const exact = () => { if (metadata(request).key !== original.key || request.ledger !== ledger || request.assertCurrentAuthority !== guard
      || storageIdentityDigest(ledger.getStorageIdentity()) !== storageIdentityDigest(original.identity)) refuse(); };
    exact(); if (guard() !== undefined) refuse(); exact();
  };
  check(); return { ...original, ledger, guard, check };
}
function lifetime(check: () => void, ms: number, start = now()) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, ms - (now() - start)));
  const elapsed = () => { const n = now() - start; if (controller.signal.aborted || !Number.isFinite(n) || n < 0 || n >= ms) refuse(); };
  const live = () => { elapsed(); check(); elapsed(); };
  const bounded = async <T>(pending: Promise<T>): Promise<T> => {
    let deny!: () => void;
    const cancelled = new Promise<never>((_, reject) => { deny = () => reject(new Error("Readiness deadline")); });
    controller.signal.addEventListener("abort", deny, { once: true });
    try { if (controller.signal.aborted) deny(); const result = await Promise.race([pending, cancelled]); live(); return result; }
    finally { controller.signal.removeEventListener("abort", deny); }
  };
  return { live, bounded, signal: controller.signal, close: () => { clearTimeout(timer); controller.abort(); } };
}
/** Actual backend inspection validates retained ECDSA originals and protected
 * terminal authority. This helper additionally binds every descriptive field. */
async function load(request: GatewayFundingReadinessRequest, live: () => void) {
  live(); const operation = validateGatewayFundingOperation(await request.ledger.inspectOperation(request.operationId)); live();
  const identity = validateStorageIdentity(request.expectedIdentity), identityDigest = storageIdentityDigest(identity);
  if (operation.operationId !== request.operationId || storageIdentityDigest(operation.policy.identity) !== identityDigest
    || digest(operation.policy) !== request.installedPolicyDigest) refuse();
  const namespaces = [];
  for (const role of ["funder", "spend"] as const) {
    live(); const ns = validateFundingNamespace(await request.ledger.inspectNamespace(operation.policy[role]), identity, request.expectedBackendBindingDigest); live();
    if (ns.role !== role || ns.sender !== operation.policy[role] || ns.peer !== operation.policy[role === "funder" ? "spend" : "funder"]
      || ns.finalityPolicyDigest !== request.finalityPolicyDigest) refuse(); namespaces.push(ns);
  }
  if (namespaces[0].historyDocumentDigest !== namespaces[1].historyDocumentDigest
    || namespaces[0].limits.nativeWei !== operation.policy.lifetimeLimits.nativeWei
    || namespaces[0].limits.usdcMicros !== operation.policy.lifetimeLimits.usdcMicros
    || namespaces[1].limits.depositMicros !== operation.policy.lifetimeLimits.depositMicros
    || BigInt(namespaces[0].limits.gasWei) + BigInt(namespaces[1].limits.gasWei) > BigInt(operation.policy.lifetimeLimits.gasWei)) refuse();
  live(); const slot = await request.ledger.inspectReservation(request.operationId, "deposit"); live();
  if (!slot || slot.state !== "finalized-success" || !slot.prepared || !slot.cryptoClaimId || !UUID.test(slot.cryptoClaimId)
    || !slot.broadcastClaimId || !UUID.test(slot.broadcastClaimId) || !slot.terminal
    || canonicalJson(validateGatewayFundingOperation(slot.operation)) !== canonicalJson(operation)) refuse();
  const tx = validatePreparedGatewayFundingTransaction(operation, "deposit", slot.transaction.nonce, slot.transaction), terminal = slot.terminal;
  if (canonicalJson(slot.prepared.transaction) !== canonicalJson(tx) || terminal.format !== "gateway-funding-terminal-evidence-v1"
    || storageIdentityDigest(terminal.identity) !== identityDigest || terminal.identityDigest !== identityDigest
    || terminal.operationDigest !== gatewayFundingReplayDigest(operation) || terminal.operationId !== request.operationId
    || terminal.step !== "deposit" || terminal.receiptStatus !== "success" || terminal.transactionHash !== slot.prepared.transactionHash
    || terminal.cryptoClaimId !== slot.cryptoClaimId || terminal.broadcastClaimId !== slot.broadcastClaimId
    || canonicalJson(terminal.prepared) !== canonicalJson(slot.prepared) || terminal.sender !== operation.policy.spend
    || terminal.nonce !== tx.nonce || terminal.chainId !== "5042002" || terminal.finalityPolicyDigest !== request.finalityPolicyDigest
    || BigInt(namespaces[1].nextCryptoNonce) <= BigInt(tx.nonce)) refuse();
  live(); return { operation, namespaces, hash: terminal.transactionHash, snapshot: digest({ operation, namespaces, slot }) };
}
async function observe(request: GatewayFundingReadinessRequest, endpoint: string, total: number, requestMs: number): Promise<VerifiedGatewayFundingReadiness | null> {
  const started = now(); // includes initial synchronous binding/guard work
  let life: ReturnType<typeof lifetime> | undefined;
  try {
    const b = binding(request); life = lifetime(b.check, total, started); life.live();
    const initial = await life.bounded(load(request, life.live));
    const body = JSON.stringify({ token: "USDC", sources: [{ depositor: initial.operation.policy.spend, domain: 26 }] });
    const start = now(), signal = AbortSignal.any([life.signal, AbortSignal.timeout(requestMs)]);
    const requestLive = () => { life!.live(); const elapsed = now() - start; if (signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= requestMs) refuse(); };
    const init: RequestInit = { method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
      headers: { "Content-Type": "application/json" }, body };
    requestLive(); const pending = capturedFetch(endpoint, init);
    const response = await life.bounded(pending); requestLive();
    if (!response.ok || response.redirected || !response.body) { void response.body?.cancel().catch(() => {}); refuse(); }
    const length = response.headers.get("content-length"); if (length !== null && (!/^\d{1,12}$/.test(length) || Number(length) > MAX_BYTES)) {
      void response.body.cancel().catch(() => {}); refuse();
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let count = 0;
    try { for (;;) { const next = await life.bounded(reader.read()); requestLive(); if (next.done) break;
      count += next.value.length; if (count > MAX_BYTES) refuse(); chunks.push(next.value); } }
    finally { void reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const available = gatewayAvailableAtomic(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), initial.operation.policy.spend, 26);
    requestLive(); const observed = now();
    if (available === null || available < BigInt(initial.operation.minimumAvailableMicros)) refuse();
    const current = await life.bounded(load(request, life.live)); if (current.snapshot !== initial.snapshot || now() - observed >= TTL_MS) refuse();
    const evidence = Object.freeze({ format: "gateway-funding-readiness-evidence-v1" as const,
      basis: "finalized-original-deposit-plus-current-available" as const, currentFundingReady: true as const,
      identityDigest: storageIdentityDigest(b.identity), backendBindingDigest: request.expectedBackendBindingDigest,
      policyDigest: request.installedPolicyDigest, finalityPolicyDigest: request.finalityPolicyDigest,
      operationDigest: gatewayFundingReplayDigest(initial.operation), operationId: request.operationId, namespaceDigest: digest(initial.namespaces),
      depositor: initial.operation.policy.spend, domain: 26 as const, depositTransactionHash: initial.hash,
      availableMicros: available.toString(), minimumAvailableMicros: initial.operation.minimumAvailableMicros });
    life.live(); const token = Object.freeze({}) as VerifiedGatewayFundingReadiness;
    issued.set(token, { ledger: b.ledger, guard: b.guard, metadata: b.key, snapshot: initial.snapshot, observed, evidence });
    assertVerifiedGatewayFundingReadinessCurrent(token, request); return token;
  } catch { return null; } finally { life?.close(); }
}
export function observeGatewayFundingReadiness(request: GatewayFundingReadinessRequest) { return observe(request, ENDPOINT, TOTAL_MS, REQUEST_MS); }
/** Fixed native localhost HTTP only; lower-only synthetic deadlines, no fetch or clock delegate. */
export function createGatewayFundingReadinessObserverForTrustedSyntheticComposition(endpoint: string, limits?: Readonly<{ totalDeadlineMs: number; requestDeadlineMs: number }>) {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/v1/balances" || url.search || url.hash) refuse();
  let total = TOTAL_MS, request = REQUEST_MS;
  if (limits) { shape(limits, ["totalDeadlineMs", "requestDeadlineMs"]); total = limits.totalDeadlineMs; request = limits.requestDeadlineMs;
    if (!Number.isSafeInteger(total) || total <= 0 || total > TOTAL_MS || !Number.isSafeInteger(request) || request <= 0 || request > REQUEST_MS) refuse(); }
  return (value: GatewayFundingReadinessRequest) => observe(value, url.href, total, request);
}
/** Last synchronous consumer boundary. Does not claim a new DB/Circle snapshot. */
export function assertVerifiedGatewayFundingReadinessCurrent(token: VerifiedGatewayFundingReadiness, request: GatewayFundingReadinessRequest): void {
  const saved = issued.get(token); if (!saved) refuse();
  const elapsed = () => { const n = now() - saved.observed; if (!Number.isFinite(n) || n < 0 || n >= TTL_MS) refuse(); };
  elapsed(); const b = binding(request); b.check(); elapsed();
  if (b.ledger !== saved.ledger || b.guard !== saved.guard || b.key !== saved.metadata) refuse();
}
export async function unsealVerifiedGatewayFundingReadiness(token: VerifiedGatewayFundingReadiness, request: GatewayFundingReadinessRequest): Promise<Readonly<GatewayFundingReadinessEvidence>> {
  assertVerifiedGatewayFundingReadinessCurrent(token, request); const saved = issued.get(token)!;
  const life = lifetime(() => assertVerifiedGatewayFundingReadinessCurrent(token, request), TTL_MS);
  try { const current = await life.bounded(load(request, life.live)); if (current.snapshot !== saved.snapshot) refuse();
    life.live(); assertVerifiedGatewayFundingReadinessCurrent(token, request); return saved.evidence; }
  finally { life.close(); }
}
