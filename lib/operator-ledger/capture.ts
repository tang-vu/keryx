import { parseRunProvenance } from "../research/run-provenance";
import { recordedUsdcMicros } from "../display/recorded-usdc";
import { LEDGER_PAYMENT_LIMIT, type LedgerFunding } from "./contracts";

const id = /^[A-Za-z0-9_-]{1,128}$/;
const identity = /^[A-Za-z0-9_.:-]{1,256}$/;
const wallet = /^0x[0-9a-fA-F]{40}$/;
export function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(field => "value" in field && field.enumerable);
}
export function iso(value: unknown): value is string {
  return typeof value === "string" && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function closedIdentity(value: unknown): value is string { return typeof value === "string" && identity.test(value); }

export interface LedgerRunSnapshot {
  id: string; createdAt: string; funding: LedgerFunding; offline: boolean; expected: number | null;
  references: Array<{ sourceId: string; itemId: string | null; contentVersion: string | null; synthetic: boolean }>;
  fee: { beneficiary: string; amount: string; paymentId: string } | null;
}

/** Trusted persisted public-domain ingress only. Missing provenance never becomes consent.
 * Copy only required fields before another asynchronous read; never retain private run payloads. */
export function captureLedgerRun(value: unknown): LedgerRunSnapshot | null {
  if (!plain(value) || typeof value.id !== "string" || !id.test(value.id) || /^(?:a2a_|private_)/.test(value.id) ||
    !iso(value.createdAt) || value.origin !== "web" || Object.hasOwn(value, "originalFulfillment")) return null;
  const provenance = parseRunProvenance(value.provenance);
  if (!provenance || provenance.surface !== "web" || !["session", "unknown"].includes(provenance.ownershipMethod)) return null;
  if (provenance.ownershipMethod === "session" && (typeof value.asker !== "string" || !wallet.test(value.asker)) ||
    provenance.ownershipMethod === "unknown" && value.asker !== undefined) return null;
  const offline = value.paymentMode === "offline" || value.fundingOwner === "offline";
  let funding: LedgerFunding = offline ? "offline" : "unknown";
  if (!offline && value.fundingOwner === "browser" && value.askerFunded === true && provenance.ownershipMethod === "session") funding = "browser";
  if (!offline && value.fundingOwner === "treasury" && value.askerFunded !== true) funding = "treasury";
  const references: LedgerRunSnapshot["references"] = [];
  for (const group of [value.decisions, value.citations]) {
    if (!Array.isArray(group) || group.length > LEDGER_PAYMENT_LIMIT) return null;
    for (const reference of group) {
      if (!plain(reference) || !closedIdentity(reference.sourceId) ||
        reference.itemId !== undefined && !closedIdentity(reference.itemId) ||
        reference.contentVersion !== undefined && (typeof reference.contentVersion !== "string" || reference.contentVersion.length > 256)) return null;
      references.push({ sourceId: reference.sourceId, itemId: typeof reference.itemId === "string" ? reference.itemId : null,
        contentVersion: typeof reference.contentVersion === "string" ? reference.contentVersion : null,
        synthetic: reference.evidenceProvenance === "synthetic-demo" });
    }
  }
  let expected: number | null = null;
  if (Number.isSafeInteger(value.settledPayments) && Number(value.settledPayments) >= 0 &&
    (value.pendingPayments === undefined || Number.isSafeInteger(value.pendingPayments) && Number(value.pendingPayments) >= 0)) {
    const count = Number(value.settledPayments) + Number(value.pendingPayments ?? 0);
    if (Number.isSafeInteger(count) && count <= LEDGER_PAYMENT_LIMIT) expected = count;
  }
  let fee: LedgerRunSnapshot["fee"] = null;
  if (plain(value.operatingFee) && value.operatingFee.policy === "public-citation-operating-fee-v1" &&
    typeof value.operatingFee.beneficiary === "string" && wallet.test(value.operatingFee.beneficiary) &&
    closedIdentity(value.operatingFee.paymentId) && ["settled", "pending"].includes(String(value.operatingFee.status))) {
    const amount = recordedUsdcMicros(value.operatingFee.amountUsdc);
    if (amount !== null && amount > BigInt(0)) fee = { beneficiary: value.operatingFee.beneficiary.toLowerCase(), amount: amount.toString(), paymentId: value.operatingFee.paymentId };
  }
  return { id: value.id, createdAt: value.createdAt, funding, offline, expected, references, fee };
}

/** Bounded relevant identity/state fields. Never copy source names, payer history or question text. */
export function captureLedgerPayment(value: unknown): Record<string, unknown> {
  if (!plain(value)) throw new Error("Ledger payment record unavailable");
  const result: Record<string, unknown> = {};
  for (const key of ["id", "queryId", "sourceId", "itemId", "contentVersion", "kind", "network", "amountUsdc", "settled", "settlementStatus",
    "txHash", "authorizationId", "authorizationPhase", "payer", "payee", "createdAt", "evidenceProvenance"] as const) {
    const field = value[key];
    if (field !== undefined && (typeof field === "object" && field !== null || !["string", "number", "boolean", "object"].includes(typeof field) ||
      typeof field === "string" && field.length > 512 || typeof field === "number" && !Number.isFinite(field)))
      throw new Error("Ledger payment record unavailable");
    if (field !== undefined) result[key] = field;
  }
  return result;
}
