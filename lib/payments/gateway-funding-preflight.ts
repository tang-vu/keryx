import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { encodeFunctionData, erc20Abi } from "viem";
import { canonicalJson } from "../canonical-json";
import { storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";
import { gatewayFundingReplayDigest, validateGatewayFundingOperation } from "./gateway-funding-policy";
import { validatePreparedGatewayFundingTransaction, type GatewayFundingTransaction } from "./gateway-funding-transaction";
import { GATEWAY_FUNDING_RECEIPT_POLICY as policy } from "./gateway-funding-receipt-policy";

const capturedFetch = globalThis.fetch.bind(globalThis), monotonicNow = performance.now.bind(performance);
const USDC = "0x3600000000000000000000000000000000000000" as const;
const GATEWAY = "0x0077777d7eba4688bdef3e311b846f25870a19b9" as const;
const UINT_MAX = BigInt(2) ** BigInt(256) - BigInt(1), SCALE = BigInt(10) ** BigInt(12);
const NONCE_MAX = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), TTL_MS = 5000;
const READ_METHODS = ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_call"] as const;
function refuse(): never { throw new Error("Gateway funding preflight refused"); }
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(d => !d.enumerable || !("value" in d))
    || keys && Object.keys(descriptors).sort().join(",") !== [...keys].sort().join(",")) refuse();
  return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]));
}
function bounded(value: bigint): bigint { if (value < BigInt(0) || value > UINT_MAX) refuse(); return value; }
function add(...values: bigint[]): bigint { return values.reduce((sum, value) => bounded(sum + value), BigInt(0)); }
function multiply(a: bigint, b: bigint): bigint { return bounded(a * b); }
function nonce(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value) || BigInt(value) > NONCE_MAX) refuse();
  return value;
}
function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value)) refuse();
  return bounded(BigInt(value));
}
function abiUint(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) refuse(); return bounded(BigInt(value));
}
function hash(value: unknown): string { if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) refuse(); return value; }
function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
const hex = (value: bigint) => `0x${value.toString(16)}`;

export interface GatewayFundingPreflightRequest {
  readonly operation: unknown;
  readonly transaction: Readonly<GatewayFundingTransaction>;
  readonly expectedIdentity: Readonly<StorageIdentity>;
  readonly backendBindingDigest: string;
  /** Actual ledger caller supplies both retained barriers; never inferred from RPC. */
  readonly expectedNextCryptoNonces: Readonly<{ funder: string; spend: string }>;
}
export interface GatewayFundingPreflightEvidence {
  readonly format: "gateway-funding-preflight-evidence-v1";
  readonly requestDigest: string;
  readonly identityDigest: string;
  readonly backendBindingDigest: string;
  readonly operationDigest: string;
  readonly transaction: Readonly<GatewayFundingTransaction>;
  readonly expectedNextCryptoNonces: Readonly<{ funder: string; spend: string }>;
  readonly anchor: Readonly<{ number: string; hash: string; timestamp: string }>;
  readonly funder: Readonly<{ nativeWei: string; usdcMicros: string; pendingNonce: string }>;
  readonly spend: Readonly<{ nativeWei: string; usdcMicros: string; pendingNonce: string }>;
  readonly gatewayAllowanceMicros: string;
  readonly requiredFunderNativeWei: string;
  readonly requiredSpendNativeWei: string;
  readonly anticipatedSpendNativeWei: string;
  readonly observedAt: string;
  readonly maximumAgeMs: 5000;
  /** Solvency observation only, not Circle credit, owner authority or future exclusivity. */
  readonly basis: "two-managed-providers-common-finalized-anchor";
}
declare const verifiedPreflight: unique symbol;
export interface VerifiedGatewayFundingPreflight { readonly [verifiedPreflight]: true; }
const issued = new WeakMap<object, { evidence: Readonly<GatewayFundingPreflightEvidence>; issuedAt: number }>();
function input(request: GatewayFundingPreflightRequest) {
  const r = object(request, ["operation", "transaction", "expectedIdentity", "backendBindingDigest", "expectedNextCryptoNonces"]);
  const operation = validateGatewayFundingOperation(r.operation), identity = validateStorageIdentity(r.expectedIdentity);
  if (identity.authorityMode !== "testnet-real" || storageIdentityDigest(identity) !== storageIdentityDigest(operation.policy.identity)
    || typeof r.backendBindingDigest !== "string" || !/^[0-9a-f]{64}$/.test(r.backendBindingDigest)) refuse();
  const n = object(r.expectedNextCryptoNonces, ["funder", "spend"]);
  const expectedNextCryptoNonces = Object.freeze({ funder: nonce(n.funder), spend: nonce(n.spend) });
  const t = object(r.transaction);
  const transaction = validatePreparedGatewayFundingTransaction(operation, t.step as GatewayFundingTransaction["step"], t.nonce as string, t);
  const role = transaction.step === "nativeTransfer" || transaction.step === "usdcTransfer" ? "funder" : "spend";
  if (transaction.nonce !== expectedNextCryptoNonces[role]) refuse();
  return Object.freeze({ operation, transaction, expectedIdentity: identity, backendBindingDigest: r.backendBindingDigest, expectedNextCryptoNonces });
}
interface Anchor { number: bigint; hash: string; timestamp: bigint; }
function block(value: unknown): Anchor {
  const b = object(value); return { number: quantity(b.number), hash: hash(b.hash), timestamp: quantity(b.timestamp) };
}
function same(a: unknown, b: unknown): void { if (canonicalJson(a) !== canonicalJson(b)) refuse(); }
const anchorRecord = (a: Anchor) => Object.freeze({ number: a.number.toString(), hash: a.hash, timestamp: a.timestamp.toString() });
interface Sample { native: bigint; usdc: bigint; pending: bigint; }
function solvency(copy: ReturnType<typeof input>, funder: Sample, spend: Sample, allowance: bigint) {
  const op = copy.operation, step = copy.transaction.step;
  const deposit = multiply(BigInt(op.depositMicros), SCALE);
  const gas = (selected: keyof typeof op.gasLimits) => multiply(BigInt(op.gasLimits[selected]), BigInt(op.maxFeePerGasWei));
  const spendRequired = add(deposit, gas("deposit"), step === "deposit" ? BigInt(0) : gas("approval"));
  let funderRequired = BigInt(0), anticipated = spend.native;
  if (step === "nativeTransfer" || step === "usdcTransfer") {
    const native = step === "nativeTransfer" ? BigInt(op.nativeTransferWei) : BigInt(0);
    const usdc = multiply(BigInt(op.usdcTransferMicros), SCALE);
    funderRequired = add(native, usdc, native > BigInt(0) ? gas("nativeTransfer") : BigInt(0),
      usdc > BigInt(0) ? gas("usdcTransfer") : BigInt(0));
    anticipated = add(spend.native, native, usdc);
    if (funder.native < funderRequired) refuse();
  }
  if (anticipated < spendRequired || step === "deposit" && allowance < BigInt(op.depositMicros)) refuse();
  return { requiredFunderNativeWei: funderRequired.toString(), requiredSpendNativeWei: spendRequired.toString(), anticipatedSpendNativeWei: anticipated.toString() };
}

interface SyntheticLimits { readonly totalDeadlineMs: number; readonly requestDeadlineMs: number; }
function issuer(fetchRead: typeof fetch, origins: readonly [string, string], nowMs: () => number, limits?: Readonly<SyntheticLimits>) {
  let total: number = policy.totalDeadlineMs, perRequest: number = policy.requestDeadlineMs;
  if (limits) {
    const l = object(limits, ["totalDeadlineMs", "requestDeadlineMs"]);
    const lower = (value: unknown, max: number) => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > max) refuse(); return value; };
    total = lower(l.totalDeadlineMs, total); perRequest = lower(l.requestDeadlineMs, perRequest);
  }
  return async (request: GatewayFundingPreflightRequest, assertCurrentAuthority: () => void): Promise<VerifiedGatewayFundingPreflight | null> => {
    const stop = new AbortController(), started = monotonicNow(); let expired = false, id = 0;
    const timer = setTimeout(() => { expired = true; stop.abort(); }, total);
    const live = () => { const elapsed = monotonicNow() - started;
      if (expired || stop.signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= total) refuse(); };
    const authority = () => { live(); if (typeof assertCurrentAuthority !== "function" || assertCurrentAuthority() !== undefined) refuse(); live(); };
    const fresh = (a: Anchor) => {
      const now = nowMs(); if (!Number.isSafeInteger(now) || now < 0) refuse();
      const age = BigInt(now) - multiply(a.timestamp, BigInt(1000));
      if (age > BigInt(policy.maximumAnchorAgeMs) || age < -BigInt(policy.maximumFutureSkewMs)) refuse();
      return new Date(now).toISOString();
    };
    const rpc = async (endpoint: string, method: typeof READ_METHODS[number], params: unknown[]): Promise<unknown> => {
      authority(); if (!origins.includes(endpoint) || !READ_METHODS.includes(method)) refuse();
      const requestStarted = monotonicNow(), signal = AbortSignal.any([stop.signal, AbortSignal.timeout(perRequest)]), requestId = ++id;
      const requestLive = () => { authority(); const elapsed = monotonicNow() - requestStarted;
        if (signal.aborted || !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= perRequest) refuse(); };
      const pending = (async () => {
        const init: RequestInit = { method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) };
        requestLive(); const response = await fetchRead(endpoint, init); requestLive();
        const rejected = () => { void response.body?.cancel().catch(() => {}); return refuse(); };
        if (!response.ok || response.redirected || !response.body) return rejected();
        const length = response.headers.get("content-length");
        if (length !== null && (!/^[0-9]{1,12}$/.test(length) || Number(length) > policy.maximumResponseBytes)) return rejected();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const next = await reader.read(); requestLive(); if (next.done) break;
          bytes += next.value.length; if (bytes > policy.maximumResponseBytes) refuse(); chunks.push(next.value); } }
        finally { void reader.cancel().catch(() => {}); }
        const joined = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
        const value = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)), ["jsonrpc", "id", "result"]);
        if (value.jsonrpc !== "2.0" || value.id !== requestId) refuse(); requestLive(); return value.result;
      })();
      let cancel!: () => void;
      const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new Error("Funding preflight unavailable")); });
      signal.addEventListener("abort", cancel, { once: true });
      try { if (signal.aborted) cancel(); const answer = await Promise.race([pending, cancelled]); requestLive(); return answer; }
      finally { signal.removeEventListener("abort", cancel); }
    };
    try {
      authority(); const copy = input(request); authority();
      const chains = await Promise.all(origins.map(origin => rpc(origin, "eth_chainId", []))); authority();
      if (chains.some(chain => quantity(chain) !== BigInt(policy.chainId))) refuse();
      const tips = await Promise.all(origins.map(async origin => block(await rpc(origin, "eth_getBlockByNumber", ["finalized", false])))); authority();
      const height = tips[0].number < tips[1].number ? tips[0].number : tips[1].number;
      const anchors = await Promise.all(origins.map(async origin => block(await rpc(origin, "eth_getBlockByNumber", [hex(height), false])))); authority();
      if (anchors.some(a => a.number !== height)) refuse(); same(anchorRecord(anchors[0]), anchorRecord(anchors[1]));
      for (const [index, tip] of tips.entries()) if (tip.number === height) same(anchorRecord(tip), anchorRecord(anchors[index]));
      fresh(anchors[0]);
      const sample = async (origin: string) => {
        const role = async (address: `0x${string}`): Promise<Sample> => {
          const native = quantity(await rpc(origin, "eth_getBalance", [address, hex(height)]));
          const usdc = abiUint(await rpc(origin, "eth_call", [{ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [address] }) }, hex(height)]));
          const pending = quantity(await rpc(origin, "eth_getTransactionCount", [address, "pending"]));
          if (native / SCALE !== usdc) refuse(); return { native, usdc, pending };
        };
        const [funder, spend] = await Promise.all([role(copy.operation.policy.funder as `0x${string}`), role(copy.operation.policy.spend as `0x${string}`)]);
        const allowance = abiUint(await rpc(origin, "eth_call", [{ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance",
          args: [copy.operation.policy.spend as `0x${string}`, GATEWAY] }) }, hex(height)]));
        return { funder, spend, allowance };
      };
      const samples = await Promise.all(origins.map(sample)); authority();
      // canonicalJson cannot encode bigint: compare exact decimal views.
      const view = (s: Awaited<ReturnType<typeof sample>>) => ({ funder: { native: s.funder.native.toString(), usdc: s.funder.usdc.toString(), pending: s.funder.pending.toString() },
        spend: { native: s.spend.native.toString(), usdc: s.spend.usdc.toString(), pending: s.spend.pending.toString() }, allowance: s.allowance.toString() });
      same(view(samples[0]), view(samples[1]));
      for (const role of ["funder", "spend"] as const) if (samples[0][role].pending.toString() !== copy.expectedNextCryptoNonces[role]) refuse();
      await Promise.all(origins.map(async (origin, index) => {
        for (const role of ["funder", "spend"] as const) if (quantity(await rpc(origin, "eth_getTransactionCount", [copy.operation.policy[role], "pending"])) !== samples[index][role].pending) refuse();
        const tip = block(await rpc(origin, "eth_getBlockByNumber", ["finalized", false])); if (tip.number < height) refuse();
        if (tip.number === height) same(anchorRecord(tip), anchorRecord(anchors[index]));
        const anchor = block(await rpc(origin, "eth_getBlockByNumber", [hex(height), false])); same(anchorRecord(anchor), anchorRecord(anchors[index])); fresh(anchor);
        if (quantity(await rpc(origin, "eth_chainId", [])) !== BigInt(policy.chainId)) refuse();
      })); authority();
      const s = samples[0], requirements = solvency(copy, s.funder, s.spend, s.allowance);
      const evidence: Readonly<GatewayFundingPreflightEvidence> = Object.freeze({ format: "gateway-funding-preflight-evidence-v1", requestDigest: digest(copy),
        identityDigest: storageIdentityDigest(copy.expectedIdentity), backendBindingDigest: copy.backendBindingDigest,
        operationDigest: gatewayFundingReplayDigest(copy.operation), transaction: copy.transaction, expectedNextCryptoNonces: copy.expectedNextCryptoNonces,
        anchor: anchorRecord(anchors[0]), funder: Object.freeze({ nativeWei: s.funder.native.toString(), usdcMicros: s.funder.usdc.toString(), pendingNonce: s.funder.pending.toString() }),
        spend: Object.freeze({ nativeWei: s.spend.native.toString(), usdcMicros: s.spend.usdc.toString(), pendingNonce: s.spend.pending.toString() }),
        gatewayAllowanceMicros: s.allowance.toString(), ...requirements, observedAt: fresh(anchors[0]), maximumAgeMs: TTL_MS,
        basis: "two-managed-providers-common-finalized-anchor" });
      const token = Object.freeze(Object.create(null)) as VerifiedGatewayFundingPreflight;
      authority(); live(); issued.set(token, { evidence, issuedAt: monotonicNow() }); return token;
    } catch { return null; } finally { clearTimeout(timer); stop.abort(); }
  };
}
/** Fixed production transport and origins. This is read evidence, not funding authority. */
export const observeGatewayFundingPreflight = issuer(capturedFetch, [policy.primary, policy.secondary], Date.now);
/** Explicit trusted local protocol fixture composition; production has no endpoint/deadline override. */
export function createGatewayFundingPreflightForTrustedSyntheticComposition(origins: readonly [string, string], nowMs: () => number = Date.now,
  limits?: Readonly<SyntheticLimits>) {
  if (!Array.isArray(origins) || origins.length !== 2 || origins[0] === origins[1]) refuse();
  const copy = origins.map(origin => { const url = new URL(origin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) refuse(); return url.href; });
  return issuer(capturedFetch, copy as [string, string], nowMs, limits);
}
/** Provenance, exact copied request and short monotonic freshness all remain required. */
export function unsealVerifiedGatewayFundingPreflight(token: VerifiedGatewayFundingPreflight, expected: GatewayFundingPreflightRequest,
  assertCurrentAuthority: () => void): Readonly<GatewayFundingPreflightEvidence> {
  try {
    const entry = issued.get(token); if (!entry) refuse();
    const live = () => { const elapsed = monotonicNow() - entry.issuedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= TTL_MS) refuse(); };
    const authority = () => { live(); if (typeof assertCurrentAuthority !== "function" || assertCurrentAuthority() !== undefined) refuse(); live(); };
    authority(); if (digest(input(expected)) !== entry.evidence.requestDigest) refuse(); authority(); live(); return entry.evidence;
  } catch { return refuse(); }
}
