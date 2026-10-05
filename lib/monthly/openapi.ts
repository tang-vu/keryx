const proof = { type: "object", additionalProperties: false, required: ["payer", "timestamp", "signature"], properties: {
  payer: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }, timestamp: { type: "integer", description: "Unix milliseconds, valid for five minutes" },
  signature: { type: "string", description: "EOA personal signature over the exact monthlyMessage action/payload, host and selected payment network domain. Match the network in the current quote before signing." } } };
export const monthlyOpenApiPath = {
  get: { operationId: "researchMonthlyQuoteOrStatus", summary: "Quote Monthly or read payer-authorized plan status",
    description: "GET ?quote=1 is unpaid. GET ?id=monthly_... requires x-keryx-monthly-proof JSON for action=status and payload={monthlyId}. Neither signs or submits a debit.",
    parameters: [{ in: "query", name: "quote", schema: { type: "string", enum: ["1"] } },
      { in: "query", name: "id", schema: { type: "string", pattern: "^monthly_[a-f0-9]{64}$" } },
      { in: "header", name: "x-keryx-monthly-proof", schema: { type: "string" }, description: "JSON payer/timestamp/signature proof; required for status" }],
    responses: { "200": { description: "Exact current quote or owner-only purchase snapshot, consumed jobs, remaining slots and expiry" },
      "400": { description: "Invalid wallet proof or lookup" }, "404": { description: "Plan absent or belongs to another payer" }, "503": { description: "Pilot or schema unavailable" } } },
  post: { operationId: "purchaseResearchMonthly", summary: "Buy four prepaid Deep requests over 30 days (manual renewal)",
    description: "Submit the exact complete quote returned by GET ?quote=1. First POST requires x-keryx-monthly-payer and returns x402402 with a durably purpose-bound server nonce in x-keryx-monthly-authorization and ten-minute admission expiry in x-keryx-monthly-expires. Sign that exact authorization; the paid POST must carry the original expiry header. Arbitrary prior nonces cannot activate Monthly. Verify resource, Arc USDC, payee, exact amount and Gateway signing domain. Circle authorization retains the configured multi-day validity independently of the short admission window. Persist original nonce/plan ID before signing and never retry a payment after uncertain submission. Confirmed settlement activates the plan. Best effort, non-refundable; failed/pending jobs consume slots and unused requests expire. Ten percent of the four-job total is absorbed in service allocation, rounded up to equal micro-USDC allocations; creator caps stay unchanged.",
    security: [{ X402Payment: [] }], requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", description: "Exact MonthlyQuote from GET ?quote=1, including quoteId and all terms/economic fields. Unknown fields are refused." } } } },
    responses: { "200": { description: "Confirmed purchase snapshot and deterministic monthlyId; seller-relayed payment-response accompanies acknowledgement" },
      "402": { description: "Exact unpaid challenge or payment refusal" }, "409": { description: "Quote changed" }, "500": { description: "Payment/delivery uncertain; recover original ID" }, "503": { description: "Pilot unavailable" } } },
  patch: { operationId: "redeemResearchMonthly", summary: "Admit one manual Monthly request or recover its exact original job",
    description: "Proof action=redeem payload={monthlyId,requestId,questionDigest}, SHA256 UTF8 normalized question without prefix. Five-minute proof binds host/network/action. Persist requestId and question before submitting. Atomic owner/expiry/four-slot admission creates one existing durable public research job. Exact replay returns same job even after expiry; changed question refuses. No new inbound debit, execution retry or automatic re-credit.",
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false,
      required: ["monthlyId", "requestId", "question", "proof"], properties: { monthlyId: { type: "string", pattern: "^monthly_[a-f0-9]{64}$" },
        requestId: { type: "string", format: "uuid" }, question: { type: "string" }, proof } } } } },
    responses: { "202": { description: "One slot admitted; queryId and standard job lookup location" }, "200": { description: "Original job replayed" },
      "404": { description: "Plan absent or different payer" }, "409": { description: "Owner/proof/term/cap/request mismatch; no new slot" }, "503": { description: "Admission disabled; retained jobs still recoverable" } } },
};
