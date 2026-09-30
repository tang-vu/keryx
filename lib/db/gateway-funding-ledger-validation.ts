import { canonicalJson } from "../canonical-json";
import { reserveFundingExposure, validateGatewayFundingPolicy } from "../payments/gateway-funding-policy";
import { storageIdentityDigest, type StorageIdentity } from "./storage-identity";
import type { FundingNamespaceSnapshot, FundingOwnerInstallation, GatewayFundingStep } from "./gateway-funding-ledger-types";

export const FUNDING_UINT_MAX = BigInt(2) ** BigInt(256) - BigInt(1);
export const FUNDING_ZERO = Object.freeze({ nativeWei: "0", usdcMicros: "0", depositMicros: "0", gasWei: "0" });
export function fundingRefused(): never { throw new Error("Gateway funding authority unavailable"); }
export function fundingRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    || Object.getOwnPropertySymbols(input).length || Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !d.enumerable || !("value" in d))) fundingRefused();
  const observed = Object.keys(input).sort(), expected = [...keys].sort();
  if (observed.length !== expected.length || observed.some((key, index) => key !== expected[index])) fundingRefused();
  return input as Record<string, unknown>;
}
export function fundingUint(input: unknown): string {
  if (typeof input !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(input) || BigInt(input) > FUNDING_UINT_MAX) fundingRefused();
  return input;
}
export function fundingNonce(input: unknown): string {
  const value = fundingUint(input); if (BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) fundingRefused(); return value;
}
export function fundingDigest(input: unknown): string {
  if (typeof input !== "string" || !/^[0-9a-f]{64}$/.test(input)) fundingRefused(); return input;
}
export function fundingUuid(input: unknown): string {
  if (typeof input !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)) fundingRefused(); return input;
}
export function fundingAddress(input: unknown): string {
  if (typeof input !== "string" || !/^0x[0-9a-f]{40}$/.test(input) || /^0x0{40}$/.test(input)) fundingRefused(); return input;
}
export function fundingStep(input: unknown): GatewayFundingStep {
  if (typeof input !== "string" || !["nativeTransfer", "usdcTransfer", "approval", "deposit"].includes(input)) fundingRefused();
  return input as GatewayFundingStep;
}
export function fundingSum(...values: string[]): string {
  const sum = values.reduce((total, value) => total + BigInt(fundingUint(value)), BigInt(0));
  if (sum > FUNDING_UINT_MAX) fundingRefused(); return sum.toString();
}
export function fundingAggregate(exposure: { nativeWei: string; usdcMicros: string; depositMicros: string; gasWei: string }): string {
  const micros = BigInt(fundingSum(exposure.usdcMicros, exposure.depositMicros));
  const converted = micros * BigInt(1000000000000);
  if (converted > FUNDING_UINT_MAX) fundingRefused();
  return fundingSum(exposure.nativeWei, converted.toString(), exposure.gasWei);
}
export function fundingExposure(input: unknown) {
  const r = fundingRecord(input, ["nativeWei", "usdcMicros", "depositMicros", "gasWei"]);
  return Object.freeze({ nativeWei: fundingUint(r.nativeWei), usdcMicros: fundingUint(r.usdcMicros),
    depositMicros: fundingUint(r.depositMicros), gasWei: fundingUint(r.gasWei) });
}
export function fundingJson(value: unknown): string {
  const json = canonicalJson(value); if (Buffer.byteLength(json) > 32768) fundingRefused(); return json;
}
export function readFundingJson(value: unknown): unknown {
  if (typeof value !== "string" || Buffer.byteLength(value) > 32768) fundingRefused();
  try { const parsed: unknown = JSON.parse(value); if (fundingJson(parsed) !== value) fundingRefused(); return parsed; }
  catch { return fundingRefused(); }
}
export function validateFundingOwnerInstallation(input: unknown): Readonly<FundingOwnerInstallation> {
  const r = fundingRecord(input, ["format", "policy", "funderGasBudgetWei", "spendGasBudgetWei", "reviewedSnapshotDigest",
    "reviewedTargetDigest", "finalityPolicyDigest", "history"]);
  if (r.format !== "gateway-funding-owner-installation-v1") fundingRefused();
  const policy = validateGatewayFundingPolicy(r.policy);
  const h = fundingRecord(r.history, ["format", "documentDigest", "funderInitialNonce", "spendInitialNonce"]);
  if (h.format !== "gateway-funding-empty-isolated-history-v1" || h.funderInitialNonce !== "0" || h.spendInitialNonce !== "0") fundingRefused();
  const funderGasBudgetWei = fundingUint(r.funderGasBudgetWei), spendGasBudgetWei = fundingUint(r.spendGasBudgetWei);
  if (BigInt(fundingSum(funderGasBudgetWei, spendGasBudgetWei)) > BigInt(policy.lifetimeLimits.gasWei)) fundingRefused();
  // Native value and the same sender's gas share a currency; no overflow or
  // implicit doubling of an independent aggregate policy limit is accepted.
  fundingAggregate({ ...policy.lifetimeLimits, depositMicros: "0", gasWei: funderGasBudgetWei });
  fundingAggregate({ nativeWei: "0", usdcMicros: "0", depositMicros: policy.lifetimeLimits.depositMicros, gasWei: spendGasBudgetWei });
  return Object.freeze({ format: r.format, policy, funderGasBudgetWei, spendGasBudgetWei,
    reviewedSnapshotDigest: fundingDigest(r.reviewedSnapshotDigest), reviewedTargetDigest: fundingDigest(r.reviewedTargetDigest),
    finalityPolicyDigest: fundingDigest(r.finalityPolicyDigest), history: Object.freeze({ format: h.format,
      documentDigest: fundingDigest(h.documentDigest), funderInitialNonce: "0", spendInitialNonce: "0" }) });
}
export function validateFundingNamespace(input: unknown, identity: StorageIdentity, backendDigest: string): Readonly<FundingNamespaceSnapshot> {
  const r = fundingRecord(input, ["identityDigest", "chainId", "sender", "peer", "role", "historyDocumentDigest", "backendBindingDigest",
    "finalityPolicyDigest", "initialNonce", "nextNonce", "limits", "used", "nativeAggregateLimitWei", "nativeAggregateUsedWei"]);
  if (r.identityDigest !== storageIdentityDigest(identity) || r.backendBindingDigest !== backendDigest || r.chainId !== "5042002"
    || typeof r.role !== "string" || !["funder", "spend"].includes(r.role) || r.initialNonce !== "0") fundingRefused();
  const limits = fundingExposure(r.limits);
  const used = reserveFundingExposure(limits, r.used, FUNDING_ZERO);
  const nativeAggregateLimitWei = fundingAggregate(limits), nativeAggregateUsedWei = fundingAggregate(used);
  if (r.nativeAggregateLimitWei !== nativeAggregateLimitWei || r.nativeAggregateUsedWei !== nativeAggregateUsedWei
    || r.role === "funder" && (limits.depositMicros !== "0" || used.depositMicros !== "0")
    || r.role === "spend" && (limits.nativeWei !== "0" || limits.usdcMicros !== "0" || used.nativeWei !== "0" || used.usdcMicros !== "0")) fundingRefused();
  const sender = fundingAddress(r.sender), peer = fundingAddress(r.peer); if (sender === peer) fundingRefused();
  return Object.freeze({ identityDigest: r.identityDigest, chainId: "5042002", sender, peer, role: r.role as "funder" | "spend",
    historyDocumentDigest: fundingDigest(r.historyDocumentDigest), backendBindingDigest: backendDigest,
    finalityPolicyDigest: fundingDigest(r.finalityPolicyDigest), initialNonce: "0", nextNonce: fundingNonce(r.nextNonce),
    limits, used, nativeAggregateLimitWei, nativeAggregateUsedWei });
}
