import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { validateStorageIdentity, type StorageIdentity } from "../db/storage-identity";

/** Proposed, unused pure terms validation. No authorization, storage, nonce,
 * signature, send, provider observation or release permission is created here. */
export interface FundingExposure {
  readonly nativeWei: string;
  readonly usdcMicros: string;
  readonly depositMicros: string;
  readonly gasWei: string;
}
export interface GatewayFundingPolicy {
  readonly format: "gateway-funding-policy-v1";
  readonly identity: Readonly<StorageIdentity>;
  readonly policyId: string;
  readonly funder: string;
  readonly spend: string;
  readonly lifetimeLimits: FundingExposure;
  readonly maxTransactionGas: string;
  readonly maxFeePerGasWei: string;
}
export interface GatewayFundingOperation {
  readonly format: "gateway-funding-operation-v1";
  readonly policy: Readonly<GatewayFundingPolicy>;
  readonly operationId: string;
  readonly ownerAuthorizationId: string;
  readonly ownerAuthorizationDigest: string;
  readonly minimumAvailableMicros: string;
  /** Immutable arithmetic observation only; not provider/credit/readiness proof. */
  readonly initialAvailableMicros: string;
  readonly nativeTransferWei: string;
  readonly usdcTransferMicros: string;
  readonly approvalMicros: string;
  readonly depositMicros: string;
  readonly gasLimits: Readonly<{ nativeTransfer: string; usdcTransfer: string; approval: string; deposit: string }>;
  readonly maxFeePerGasWei: string;
  readonly maxPriorityFeePerGasWei: string;
}
const UINT_MAX = BigInt(2) ** BigInt(256) - BigInt(1);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function refuse(): never { throw new Error("Invalid Gateway funding policy or operation"); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !d.enumerable || !("value" in d))) refuse();
  const observed = Object.keys(value).sort(), expected = [...keys].sort();
  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) refuse();
  return value as Record<string, unknown>;
}
function uint(value: unknown, positive = false): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) refuse();
  const parsed = BigInt(value);
  if (parsed > UINT_MAX || (positive && parsed === BigInt(0))) refuse();
  return value;
}
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) refuse(); return value; }
function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value) || /^0x0{40}$/.test(value)) refuse();
  return value;
}
function bounded(value: bigint): bigint { if (value < BigInt(0) || value > UINT_MAX) refuse(); return value; }
const EXPOSURE_KEYS = ["nativeWei", "usdcMicros", "depositMicros", "gasWei"] as const;
function exposure(value: unknown): Readonly<FundingExposure> {
  const r = record(value, EXPOSURE_KEYS);
  return Object.freeze({ nativeWei: uint(r.nativeWei), usdcMicros: uint(r.usdcMicros),
    depositMicros: uint(r.depositMicros), gasWei: uint(r.gasWei) });
}

export function validateGatewayFundingPolicy(input: unknown): Readonly<GatewayFundingPolicy> {
  const r = record(input, ["format", "identity", "policyId", "funder", "spend", "lifetimeLimits", "maxTransactionGas", "maxFeePerGasWei"]);
  if (r.format !== "gateway-funding-policy-v1") refuse();
  const identity = validateStorageIdentity(r.identity);
  if (identity.authorityMode !== "testnet-real") refuse();
  const funder = address(r.funder), spend = address(r.spend);
  if (funder === spend) refuse();
  return Object.freeze({ format: r.format, identity, policyId: uuid(r.policyId), funder, spend,
    lifetimeLimits: exposure(r.lifetimeLimits), maxTransactionGas: uint(r.maxTransactionGas, true),
    maxFeePerGasWei: uint(r.maxFeePerGasWei, true) });
}

export function validateGatewayFundingOperation(input: unknown): Readonly<GatewayFundingOperation> {
  const r = record(input, ["format", "policy", "operationId", "ownerAuthorizationId", "ownerAuthorizationDigest",
    "minimumAvailableMicros", "initialAvailableMicros", "nativeTransferWei", "usdcTransferMicros", "approvalMicros",
    "depositMicros", "gasLimits", "maxFeePerGasWei", "maxPriorityFeePerGasWei"]);
  if (r.format !== "gateway-funding-operation-v1" || typeof r.ownerAuthorizationDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(r.ownerAuthorizationDigest)) refuse();
  const policy = validateGatewayFundingPolicy(r.policy);
  const g = record(r.gasLimits, ["nativeTransfer", "usdcTransfer", "approval", "deposit"]);
  const gasLimits = Object.freeze({ nativeTransfer: uint(g.nativeTransfer, true), usdcTransfer: uint(g.usdcTransfer, true),
    approval: uint(g.approval, true), deposit: uint(g.deposit, true) });
  const operation: GatewayFundingOperation = Object.freeze({ format: r.format, policy,
    operationId: uuid(r.operationId), ownerAuthorizationId: uuid(r.ownerAuthorizationId), ownerAuthorizationDigest: r.ownerAuthorizationDigest,
    minimumAvailableMicros: uint(r.minimumAvailableMicros, true), initialAvailableMicros: uint(r.initialAvailableMicros),
    nativeTransferWei: uint(r.nativeTransferWei), usdcTransferMicros: uint(r.usdcTransferMicros),
    approvalMicros: uint(r.approvalMicros, true), depositMicros: uint(r.depositMicros, true), gasLimits,
    maxFeePerGasWei: uint(r.maxFeePerGasWei, true), maxPriorityFeePerGasWei: uint(r.maxPriorityFeePerGasWei) });
  if (operation.approvalMicros !== operation.depositMicros
    || BigInt(operation.usdcTransferMicros) > BigInt(operation.depositMicros)
    || bounded(BigInt(operation.initialAvailableMicros) + BigInt(operation.depositMicros)) < BigInt(operation.minimumAvailableMicros)
    || BigInt(operation.maxPriorityFeePerGasWei) > BigInt(operation.maxFeePerGasWei)
    || BigInt(operation.maxFeePerGasWei) > BigInt(policy.maxFeePerGasWei)
    || Object.values(gasLimits).some(v => BigInt(v) > BigInt(policy.maxTransactionGas))) refuse();
  reserveFundingExposure(policy.lifetimeLimits, { nativeWei: "0", usdcMicros: "0", depositMicros: "0", gasWei: "0" }, operationExposure(operation));
  return operation;
}

function operationExposure(operation: GatewayFundingOperation): Readonly<FundingExposure> {
  // Conservatively reserve all four gas ceilings even if a step may be skipped.
  const gas = bounded(Object.values(operation.gasLimits).reduce((sum, v) => bounded(sum + BigInt(v)), BigInt(0))
    * BigInt(operation.maxFeePerGasWei));
  return Object.freeze({ nativeWei: operation.nativeTransferWei, usdcMicros: operation.usdcTransferMicros,
    depositMicros: operation.depositMicros, gasWei: gas.toString() });
}
export function gatewayFundingExposure(input: unknown): Readonly<FundingExposure> {
  return operationExposure(validateGatewayFundingOperation(input));
}
/** Pure addition only. No refund/reset operation: terminal receipt or expiry
 * cannot reopen cumulative lifetime funding/gas allowance. DB CAS is separate. */
export function reserveFundingExposure(limitsInput: unknown, usedInput: unknown, requestedInput: unknown): Readonly<FundingExposure> {
  const limits = exposure(limitsInput), used = exposure(usedInput), requested = exposure(requestedInput);
  const result = {} as Record<keyof FundingExposure, string>;
  for (const key of EXPOSURE_KEYS) {
    const total = bounded(BigInt(used[key]) + BigInt(requested[key]));
    if (total > BigInt(limits[key])) refuse();
    result[key] = total.toString();
  }
  return Object.freeze(result);
}
export function gatewayFundingReplayDigest(input: unknown): string {
  return createHash("sha256").update(canonicalJson(validateGatewayFundingOperation(input))).digest("hex");
}
export function assertGatewayFundingReplay(original: unknown, proposed: unknown): void {
  if (gatewayFundingReplayDigest(original) !== gatewayFundingReplayDigest(proposed)) refuse();
}

export type FundingStepState = "reserved" | "crypto-claimed" | "prepared" | "broadcast-claimed" | "pending"
  | "unresolved" | "finalized-success" | "finalized-reverted" | "cancelled-unexposed";
const TRANSITIONS: Record<FundingStepState, readonly FundingStepState[]> = {
  reserved: ["crypto-claimed", "cancelled-unexposed"], "crypto-claimed": ["prepared", "unresolved"],
  prepared: ["broadcast-claimed"], "broadcast-claimed": ["pending", "unresolved", "finalized-success", "finalized-reverted"],
  pending: ["unresolved", "finalized-success", "finalized-reverted"], unresolved: ["finalized-success", "finalized-reverted"],
  "finalized-success": [], "finalized-reverted": [], "cancelled-unexposed": [],
};
/** Legal shape only, never verified receipt, lease, signing or sending authority.
 * Lease expiry leaves irreversible state/exposure intact; recovery cannot move
 * unresolved back to preparation or broadcast. Finalizing unresolved also needs
 * a saved prepared original and validated observation; a crypto-claimed crash
 * without saved bytes cannot finalize merely because this shape check passes. */
export function assertFundingStepTransition(from: FundingStepState, to: FundingStepState): void {
  if (typeof from !== "string" || typeof to !== "string" || !Object.hasOwn(TRANSITIONS, from) || !Object.hasOwn(TRANSITIONS, to)
    || (from !== to && !TRANSITIONS[from].includes(to))) refuse();
}
