import { z } from "zod";

export const LEDGER_RUN_LIMIT = 250;
export const LEDGER_PAYMENT_LIMIT = 1_000;
export const ledgerNetworkSchema = z.enum(["eip155:5042", "eip155:5042002"]);
export const ledgerFundingSchema = z.enum(["browser", "treasury", "unknown", "offline"]);
export const ledgerKindSchema = z.enum(["fetch", "citation", "operating-fee"]);
export const ledgerReasonSchema = z.enum(["pending", "failed", "simulated", "conflicting-identity", "invalid-amount",
  "missing-identity", "missing-settlement-evidence", "inconsistent-state", "foreign-network", "source-binding",
  "synthetic-demo", "invalid-record", "offline-funding", "shared-settlement-reference"]);
const micros = z.string().regex(/^(?:0|[1-9][0-9]{0,21})$/);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const date = z.string().datetime();
const amounts = z.object({ accessMicroUsdc: micros, rewardMicroUsdc: micros, sponsoredFeeMicroUsdc: micros }).strict();
export const ledgerLegSchema = z.object({
  id: digest, kind: ledgerKindSchema.nullable(), sourceId: z.string().max(256).nullable(),
  amountMicroUsdc: micros.nullable(), createdAt: date.nullable(),
  state: z.enum(["settled", "pending", "failed", "simulated", "uncertain"]),
  reason: ledgerReasonSchema.nullable(), settlementReference: z.string().regex(/^[A-Za-z0-9_:-]{1,200}$/).nullable(),
}).strict();
export const ledgerJobSchema = z.object({
  id: identifier, createdAt: date, funding: ledgerFundingSchema, customerCohort: z.literal("unknown"),
  evidencePath: z.string().regex(/^\/api\/dispatch\/[A-Za-z0-9_-]{1,128}\/receipt$/),
  decisionPath: z.string().regex(/^\/dispatch\/[A-Za-z0-9_-]{1,128}$/),
  legCoverage: z.enum(["matched-finish-count", "incomplete", "unknown"]),
  expectedRecordedLegs: z.number().int().min(0).max(LEDGER_PAYMENT_LIMIT).nullable(),
  settled: amounts, uncertainLegs: z.number().int().min(0).max(LEDGER_PAYMENT_LIMIT),
  pendingLegs: z.number().int().min(0).max(LEDGER_PAYMENT_LIMIT),
  purchasePriceMicroUsdc: z.null(), confirmedNetMicroUsdc: z.null(), marginMicroUsdc: z.null(),
  legs: z.array(ledgerLegSchema).max(LEDGER_PAYMENT_LIMIT),
}).strict();
export const ledgerEntrySchema = z.object({
  voucherId: digest, jobId: identifier, funding: ledgerFundingSchema,
  account: z.enum(["sender:browser", "sender:treasury", "sender:unknown", "recipient:access", "recipient:reward", "recipient:sponsored-fee"]),
  debitMicroUsdc: micros, creditMicroUsdc: micros, settlementReference: z.string().regex(/^[A-Za-z0-9_:-]{1,200}$/),
  evidencePath: z.string().regex(/^\/api\/dispatch\/[A-Za-z0-9_-]{1,128}\/receipt$/),
}).strict();
export const operatorLedgerPayloadSchema = z.object({
  schema: z.literal("keryx-public-job-transfer-ledger-v1"), network: ledgerNetworkSchema,
  window: z.object({ days: z.number().int().min(1).max(31), from: date, readStartedAt: date, readCompletedAt: date }).strict(),
  scope: z.object({ cohort: z.literal("persisted-public-web-dispatches"), coverage: z.literal("partial"),
    consistency: z.literal("separate-read-snapshots"), runLimit: z.literal(LEDGER_RUN_LIMIT), paymentLimit: z.literal(LEDGER_PAYMENT_LIMIT),
    runLimitReached: z.boolean(), paymentLimitReached: z.boolean(), allBusinessBooks: z.literal(false) }).strict(),
  position: z.object({ balanceMicroUsdc: z.null(), obligationsMicroUsdc: z.null(), overlapMicroUsdc: z.null(),
    safeSpendMicroUsdc: z.literal("0"), status: z.literal("unknown") }).strict(),
  business: z.object({ outsideRevenueMicroUsdc: z.null(), refundsMicroUsdc: z.null(), providerCostMicroUsdc: z.null(),
    invoiceCostMicroUsdc: z.null(), profitMicroUsdc: z.null() }).strict(),
  settledByFunding: z.object({ browser: amounts, treasury: amounts, unknown: amounts, offline: amounts }).strict(),
  jobs: z.array(ledgerJobSchema).max(LEDGER_RUN_LIMIT),
  entries: z.array(ledgerEntrySchema).max(LEDGER_PAYMENT_LIMIT * 2),
  trialBalance: z.object({ debitMicroUsdc: micros, creditMicroUsdc: micros, balanced: z.literal(true) }).strict(),
}).strict();
export const operatorLedgerSchema = z.object({ payload: operatorLedgerPayloadSchema,
  integrity: z.object({ algorithm: z.literal("sha256"), canonicalization: z.literal("sorted-json-v1"),
    scope: z.literal("payload"), digest }).strict() }).strict();
export type LedgerFunding = z.infer<typeof ledgerFundingSchema>;
export type LedgerLeg = z.infer<typeof ledgerLegSchema>;
export type LedgerJob = z.infer<typeof ledgerJobSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type OperatorLedgerPayload = z.infer<typeof operatorLedgerPayloadSchema>;
export type OperatorLedger = z.infer<typeof operatorLedgerSchema>;

/** Aggregates can exceed the safe legacy single-leg bound. No floating point display. */
export function formatLedgerMicros(value: string): string {
  const amount = BigInt(micros.parse(value));
  return `${amount / BigInt(1_000_000)}.${(amount % BigInt(1_000_000)).toString().padStart(6, "0")} USDC`;
}
