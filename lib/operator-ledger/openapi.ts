import { ledgerFundingSchema, ledgerKindSchema, ledgerReasonSchema, LEDGER_PAYMENT_LIMIT, LEDGER_RUN_LIMIT } from "./contracts";
const object = <T extends Record<string, object>>(properties: T) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const unknown = { type: "null" }, date = { type: "string", format: "date-time" };
const micros = { type: "string", pattern: "^(?:0|[1-9][0-9]{0,21})$", description: "Exact integer micro-USDC text. Import CSV amount columns as text to preserve large integers." };
const id = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const funding = { type: "string", enum: ledgerFundingSchema.options };
const amounts = object({ accessMicroUsdc: micros, rewardMicroUsdc: micros, sponsoredFeeMicroUsdc: micros });
const count = { type: "integer", minimum: 0, maximum: LEDGER_PAYMENT_LIMIT };
const evidencePath = { type: "string", pattern: "^/api/dispatch/[A-Za-z0-9_-]{1,128}/receipt$" };
const reference = { type: "string", pattern: "^[A-Za-z0-9_:-]{1,200}$", description: "Retained transfer reference. Shared batches need original reconciliation attribution; never automatically an individual Arc transaction/explorer URL." };
const leg = object({ id: digest, kind: nullable({ type: "string", enum: ledgerKindSchema.options }), sourceId: nullable({ type: "string", maxLength: 256 }),
  amountMicroUsdc: nullable(micros), createdAt: nullable(date), state: { type: "string", enum: ["settled", "pending", "failed", "simulated", "uncertain"] },
  reason: nullable({ type: "string", enum: ledgerReasonSchema.options }), settlementReference: nullable(reference) });
const job = object({ id, createdAt: date, funding, customerCohort: { const: "unknown" }, evidencePath,
  decisionPath: { type: "string", pattern: "^/dispatch/[A-Za-z0-9_-]{1,128}$" },
  legCoverage: { type: "string", enum: ["matched-finish-count", "incomplete", "unknown"] }, expectedRecordedLegs: nullable(count),
  settled: amounts, uncertainLegs: count, pendingLegs: count, purchasePriceMicroUsdc: unknown, confirmedNetMicroUsdc: unknown,
  marginMicroUsdc: unknown, legs: { type: "array", maxItems: LEDGER_PAYMENT_LIMIT, items: leg } });
const entry = object({ voucherId: digest, jobId: id, funding, account: { type: "string", enum: ["sender:browser", "sender:treasury", "sender:unknown", "recipient:access", "recipient:reward", "recipient:sponsored-fee"] },
  debitMicroUsdc: micros, creditMicroUsdc: micros, settlementReference: reference, evidencePath });
export const publicJobLedgerOpenApiSchema = object({ payload: object({
  schema: { const: "keryx-public-job-transfer-ledger-v1" }, network: { type: "string", enum: ["eip155:5042", "eip155:5042002"] },
  window: object({ days: { type: "integer", minimum: 1, maximum: 31 }, from: date, readStartedAt: date, readCompletedAt: date }),
  scope: object({ cohort: { const: "persisted-public-web-dispatches" }, coverage: { const: "partial" }, consistency: { const: "separate-read-snapshots" },
    runLimit: { const: LEDGER_RUN_LIMIT }, paymentLimit: { const: LEDGER_PAYMENT_LIMIT }, runLimitReached: { type: "boolean" }, paymentLimitReached: { type: "boolean" }, allBusinessBooks: { const: false } }),
  position: object({ balanceMicroUsdc: unknown, obligationsMicroUsdc: unknown, overlapMicroUsdc: unknown, safeSpendMicroUsdc: { const: "0" }, status: { const: "unknown" } }),
  business: object({ outsideRevenueMicroUsdc: unknown, refundsMicroUsdc: unknown, providerCostMicroUsdc: unknown, invoiceCostMicroUsdc: unknown, profitMicroUsdc: unknown }),
  settledByFunding: object({ browser: amounts, treasury: amounts, unknown: amounts, offline: amounts }),
  jobs: { type: "array", maxItems: LEDGER_RUN_LIMIT, items: job }, entries: { type: "array", maxItems: LEDGER_PAYMENT_LIMIT * 2, items: entry },
  trialBalance: object({ debitMicroUsdc: micros, creditMicroUsdc: micros, balanced: { const: true } }),
}), integrity: object({ algorithm: { const: "sha256" }, canonicalization: { const: "sorted-json-v1" }, scope: { const: "payload" }, digest }) });
export const publicJobLedgerOpenApiPath = { get: { operationId: "publicJobTransferLedger", summary: "Observe public job settlement transfers and balanced export",
  security: [], description: "Read-only selected sealed store, never a caller-selected network or private fallback. Only persisted public web ingress qualifies; questions/customer identities, originalFulfillment and private review/invoice domains are excluded. Funding is the recorded public run role, not a new custody assertion. Browser transfers are not Operator expenses; sponsored fees are not outside revenue. Coverage is always bounded/partial and non-atomic. Full purchase revenue, invoices, refunds, obligations and margin remain unknown. Checksum plus voucher balance is not authenticity or independent settlement verification.",
  parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 31, default: 7 } },
    { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } },
    { name: "download", in: "query", schema: { type: "string", enum: ["1"] } }],
  responses: { "200": { description: "Observed transfer ledger; integer CSV is balanced per original voucher. Always no-store.",
    headers: { "X-Keryx-Ledger-Digest": { schema: digest, description: "Canonical JSON payload digest; included in every CSV row." } },
    content: { "application/json": { schema: publicJobLedgerOpenApiSchema }, "text/csv": { schema: { type: "string" } } } },
    "400": { description: "Invalid, duplicate or unsupported selector/export arguments" },
    "503": { description: "Uniform ledger unavailable; no private storage/error details" } } } };
