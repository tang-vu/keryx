import { z } from "zod";

export const MAX_OBSERVATION_AGE_MS = 30_000;
export const MAX_RECORDS = 1_000;
export const obligationAmount = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/);
const timestamp = z.string().datetime().refine(v => new Date(v).toISOString() === v);
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine(v => v !== `0x${"0".repeat(40)}`);
export const obligationScopeSchema = z.object({
  custodyWallet: address, signer: address,
  custodyRole: z.enum(["public-hosted", "private-hosted"]),
  storageIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  network: z.enum(["eip155:5042", "eip155:5042002"]),
  asset: z.literal("0x3600000000000000000000000000000000000000"),
  compartment: z.enum(["wallet", "gateway"]),
}).strict();
export type ObligationScope = z.infer<typeof obligationScopeSchema>;
export const REQUIRED_OBLIGATION_DOMAINS = ["prepaid-work", "payment-originals", "creator-debt",
  "delivery-remedies", "refunds-withdrawals", "funding-originals", "provider-billing", "gas-fees"] as const;
const common = { id, originalId: id, evidenceId: id, snapshotId: id, scope: obligationScopeSchema, observedAt: timestamp, verifiedOriginal: z.boolean() };
export const cashRecordSchema = z.object({ ...common,
  kind: z.enum(["wallet-native", "wallet-erc20", "gateway-available", "incoming-pending", "bridge-in-transit", "vault-quote", "disputed"]),
  amount: obligationAmount, units: z.enum(["micro-usdc", "native-18"]),
  balanceId: id, finalized: z.boolean(),
}).strict();
export const liabilityRecordSchema = z.object({ ...common,
  category: z.enum(["prepaid-job-cap", "monthly-slot-cap", "payment-exposure", "creator-debt", "delivery-remedy", "refund-withdrawal", "provider-commitment", "gas-fee"]),
  amount: obligationAmount, units: z.enum(["micro-usdc", "native-18"]),
  outcome: z.enum(["due", "uncertain", "confirmed-debit"]),
  dueAt: timestamp.nullable(), confirmationId: id.nullable(),
}).strict();
export const inclusionSchema = z.object({
  childId: id, parentId: id, evidenceId: id, snapshotId: id,
  kind: z.enum(["creator-leg-in-job-cap", "monthly-slot-redeemed-to-job"]),
}).strict();
export const obligationSnapshotSchema = z.object({
  version: z.literal(1), snapshotId: id, scope: obligationScopeSchema, observedAt: timestamp,
  source: z.enum(["offline-fixture", "native-journal"]), consistency: z.enum(["atomic", "partial", "unavailable"]),
  domains: z.array(z.object({ domain: z.enum(REQUIRED_OBLIGATION_DOMAINS),
    coverage: z.enum(["complete", "partial", "unavailable"]), originalId: id, evidenceId: id, observedAt: timestamp,
  }).strict()).max(REQUIRED_OBLIGATION_DOMAINS.length),
  cash: z.array(cashRecordSchema).max(MAX_RECORDS),
  liabilities: z.array(liabilityRecordSchema).max(MAX_RECORDS),
  inclusions: z.array(inclusionSchema).max(MAX_RECORDS),
  overlap: z.enum(["resolved", "unresolved"]),
  policy: z.object({ originalId: id, evidenceId: id, snapshotId: id, scope: obligationScopeSchema,
    observedAt: timestamp, expiresAt: timestamp, horizonAt: timestamp.nullable(), reviewed: z.boolean(),
    reserveFloorMicroUsdc: obligationAmount.nullable(), operatingBudgetMicroUsdc: obligationAmount.nullable(),
    remainingOriginalCapacityMicroUsdc: obligationAmount,
  }).strict().nullable(),
}).strict();
export type ObligationSnapshot = z.infer<typeof obligationSnapshotSchema>;

export const obligationReasonSchema = z.enum(["partial-snapshot", "missing-domain", "partial-domain",
  "stale-observation", "foreign-binding", "conflicting-original", "ambiguous-inclusion", "overlap-unresolved",
  "cash-unverified", "cash-alias-mismatch", "wrong-units", "missing-policy", "policy-unreviewed", "policy-expired",
  "invalid-horizon", "coverage-short", "native-complete-unavailable", "unverified-original", "unverified-outcome"]);
export type ObligationReason = z.infer<typeof obligationReasonSchema>;
export const obligationProjectionSchema = z.object({
  version: z.literal(1), scope: obligationScopeSchema, snapshotId: id, observedAt: timestamp,
  source: z.enum(["offline-fixture", "native-journal"]),
  status: z.enum(["estimated", "unknown"]), advisoryOnly: z.literal(true), spendAuthority: z.literal(false),
  nativeComplete: z.literal(false), reasons: z.array(obligationReasonSchema).max(32),
  liquidMicroUsdc: obligationAmount.nullable(), protectedMicroUsdc: obligationAmount,
  dueNowMicroUsdc: obligationAmount, dueWithinHorizonMicroUsdc: obligationAmount.nullable(),
  excludedNonLiquidMicroUsdc: obligationAmount,
  reserveFloorMicroUsdc: obligationAmount.nullable(), operatingBudgetMicroUsdc: obligationAmount.nullable(),
  remainingOriginalCapacityMicroUsdc: obligationAmount.nullable(),
  coverageShortfallMicroUsdc: obligationAmount.nullable(),
  safeNewSpendMicroUsdc: obligationAmount, advisorySurplusMicroUsdc: obligationAmount,
}).strict();
export type ObligationProjection = z.infer<typeof obligationProjectionSchema>;
/** Delegated reader identity is separate from the custody wallet holding money. */
export const obligationInspectionSchema = z.object({ version: z.literal(1), readerWallet: address,
  projection: obligationProjectionSchema }).strict();
export type ObligationInspection = z.infer<typeof obligationInspectionSchema>;
/** Current runtime port is mainnet Gateway, partial and nonauthorizing everywhere. */
export function parseNativeObligationInspection(raw: unknown): ObligationInspection {
  const value = obligationInspectionSchema.parse(raw), p = value.projection;
  if (p.source !== "native-journal" || p.status !== "unknown" || p.scope.network !== "eip155:5042" ||
    p.scope.compartment !== "gateway" || p.scope.custodyWallet !== p.scope.signer ||
    p.safeNewSpendMicroUsdc !== "0" || p.advisorySurplusMicroUsdc !== "0") throw new Error("Operator inspection refused or unavailable");
  return value;
}

/** Reject accessors, prototypes, symbols, sparse arrays and oversized graphs before Zod traversal. */
export function assertBoundedObligationData(value: unknown) {
  const queue = [{ value, depth: 0 }]; const seen = new Set<object>(); let nodes = 0, text = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++nodes > 40_000 || item.depth > 16) throw new Error("Invalid obligation input");
    const v = item.value;
    if (typeof v === "string") { text += v.length; if (text > 1_000_000) throw new Error("Invalid obligation input"); continue; }
    if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) continue;
    if (!v || typeof v !== "object" || seen.has(v) || Object.getOwnPropertySymbols(v).length) throw new Error("Invalid obligation input");
    seen.add(v);
    const array = Array.isArray(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype || v.length > MAX_RECORDS : ![Object.prototype, null].includes(proto)) throw new Error("Invalid obligation input");
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (array && Object.keys(descriptors).length !== v.length + 1) throw new Error("Invalid obligation input");
    if (Object.keys(descriptors).length > MAX_RECORDS + 1) throw new Error("Invalid obligation input");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !("value" in descriptor) || key.length > 128) throw new Error("Invalid obligation input");
      queue.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
}
