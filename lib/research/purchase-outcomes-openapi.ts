const identifier = { type: "string", minLength: 1, maxLength: 256, pattern: "^[^\\u0000-\\u001f\\u007f]+$" };
const id = { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" };
const count = { type: "integer", minimum: 0, maximum: 512 };
const weight = { type: "number", minimum: 0, maximum: 1 };
const optionalWeight = { ...weight, type: ["number", "null"] };
const micros = { type: "string", pattern: "^(0|[1-9][0-9]{0,29})$", description: "Exact integer micro-USDC, never floating-point totals." };
const time = { type: "string", format: "date-time", maxLength: 64 };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const purchaseOutcomesOpenApiPath = { get: {
  operationId: "getRecordedPurchaseOutcomes", summary: "Read retained exact-version purchase/citation outcomes", security: [],
  description: "Public permalink authority only; current-store errors never select an archive fallback. Bounded retained BUY decisions and trace.detail payment observations are scored without source fetching, spending, private sidecars or current-catalogue backfill. Each unique source/item/version with positive matching recorded settled access counts once. Unknown participant cohort is not outside demand. Coverage is a partial retained trace sample, not a full ledger or new settlement verification. Uncited access cost is descriptive, not causal regret. Calibration compares predicted value to citation occurrence; unmeasured missed value/cost per supported claim remain null. Frozen archive provenance retains its original testnet identity.",
  parameters: [{ in: "path", name: "id", required: true, schema: id },
    { in: "query", name: "download", schema: { type: "string", enum: ["1"] }, description: "Optional JSON attachment; unknown/duplicate query arguments refuse." }],
  responses: { "200": { description: "Bounded public observation with counting and sample bindings; always no-store.", content: { "application/json": {
    schema: object({ schemaVersion: { const: "keryx-purchase-outcomes-v1" }, dispatchId: id,
      network: { type: "string", enum: ["eip155:5042", "eip155:5042002"] }, runCreatedAt: time,
      basis: { const: "retained-dispatch-trace-exact-version" }, settlementEvidence: { const: "recorded-only-not-revalidated" },
      coverage: { const: "partial-retained-trace" }, cohort: { const: "unknown" },
      archive: { oneOf: [{ type: "null" }, object({ network: { const: "eip155:5042002" }, label: { const: "Arc testnet" },
        capturedAt: time, sourceCommit: { type: "string", pattern: "^[a-f0-9]{40}$" }, databaseSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } })] },
      counts: object({ recordedBuyDecisions: count, scoredPurchases: count, citedPurchases: count, unscoredBuyDecisions: count,
        tracePaymentObservations: count, excludedPaymentObservations: count }),
      purchases: { type: "array", maxItems: 512, items: object({ assetId: identifier, sourceId: identifier, itemId: identifier,
        contentVersion: identifier, expectedValue: weight, settledAccessMicros: micros, cited: { type: "boolean" },
        contributionWeight: weight, settledRewardMicros: micros }) },
      hitRate: optionalWeight, uncitedAccessMicros: micros,
      calibration: { type: "array", minItems: 5, maxItems: 5, items: object({ lower: weight, upper: weight, samples: count,
        predictedMean: optionalWeight, citationRate: optionalWeight }) }, missedValue: { type: "null" }, costPerSupportedClaim: { type: "null" },
    }),
  } } }, "400": { description: "Invalid ID or selectors; no storage read" },
    "404": { description: "Public dispatch not found" }, "503": { description: "Uniform unavailable; no private diagnostics or inferred zero-cost success" } },
} };
