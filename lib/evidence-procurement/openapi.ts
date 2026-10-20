const id = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" } as const;
const hash = { type: "string", pattern: "^0x[0-9a-f]{64}$" } as const;
const signature = { type: "string", pattern: "^0x[0-9a-fA-F]{130}$", description: "Optional provider signature; absence cannot establish an attributed offer or delivery." } as const;
const micros = { type: "string", pattern: "^(0|[1-9][0-9]{0,9})$", description: "Exact integer micro-USDC, at most 1000000000. Proposal only; not a reservation or payment." } as const;
const ids = { type: "array", uniqueItems: true, maxItems: 16, items: id } as const;
const timestamp = { type: "string", format: "date-time" } as const;

/** Discovery mirrors the strict executable packet; response results are never import authority. */
export const evidenceProcurementOpenApiPath = {
  "/api/research/evidence-procurement": { post: {
    operationId: "assessPrivateEvidenceProcurement",
    summary: "Plan and inspect private evidence procurement from supplied inputs",
    parameters: [{ name: "format", in: "query", required: false,
      description: "At most one format selector; no other query parameters. Default JSON result is unchanged. Markdown/CSV are private dated receipts, not restorable packets; at most 524288 UTF-8 bytes, refused without truncation. CSV formula-like cells receive a leading apostrophe.",
      schema: { type: "string", enum: ["json", "markdown", "csv"], default: "json" } }],
    security: [{ ApiKeyAuth: [] }, { WebSession: [] }],
    description: "Stateless local proposal assessment. Identifies declared missing requirements, verifies supplied provider offer/delivery signatures and exact content bindings, and ranks declared coverage per integer micro-USDC. Caller coverage, selections and reviews remain assertions; signatures prove neither source ownership nor factual quality. No provider, URL, model or benchmark is invoked, no packet stored, and no purchase, escrow, settlement or reward authorized. API keys require export scope; sessions require the exact configured public Origin and same-origin Sec-Fetch-Site when supplied. Authentication precedes body reading. At most 65536 actual UTF-8 bytes and five seconds; every response private/no-store with fixed errors. Reimport only the original packet and recompute results. Executable rules: lib/evidence-procurement/contracts.ts and engine.ts.",
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", additionalProperties: false,
      required: ["version", "scope", "request", "offers", "selectedOfferIds", "deliveries", "reviews"],
      properties: {
        version: { type: "integer", const: 1 }, scope: { type: "string", const: "private-evidence-procurement" },
        request: { type: "object", additionalProperties: false,
          required: ["id", "network", "decision", "budgetMicroUsdc", "expiresAt", "requirements"], properties: {
            id, network: { type: "string", enum: ["eip155:5042", "eip155:5042002"] },
            decision: { type: "string", minLength: 1, maxLength: 4000 }, budgetMicroUsdc: micros, expiresAt: timestamp,
            requirements: { type: "array", minItems: 1, maxItems: 16, description: "Unique requirement IDs. Coverage is caller declared.", items: {
              type: "object", additionalProperties: false, required: ["id", "question", "priority", "status"], properties: {
                id, question: { type: "string", minLength: 1, maxLength: 2000 }, priority: { type: "integer", minimum: 1, maximum: 10 },
                status: { type: "string", enum: ["missing", "covered"] },
              },
            } },
          },
        },
        offers: { type: "array", maxItems: 16, items: {
          type: "object", additionalProperties: false,
          required: ["id", "requestHash", "providerWallet", "sourceUrl", "deliverable", "priceMicroUsdc", "requirementIds", "expiresAt", "nonce"],
          properties: { id, requestHash: hash,
            providerWallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Nonzero EVM wallet. Signature identity alone is not payout authority." },
            sourceUrl: { type: "string", format: "uri", minLength: 1, maxLength: 2048, description: "HTTPS URL without credentials, whitespace or control characters. Never fetched." },
            deliverable: { type: "string", minLength: 1, maxLength: 2000 }, priceMicroUsdc: micros,
            requirementIds: { ...ids, minItems: 1 }, expiresAt: timestamp, nonce: id, signature,
          },
        } },
        selectedOfferIds: { ...ids, description: "Declared selections only. Must bind eligible or expired signed offers and remain within the request quote budget." },
        deliveries: { type: "array", maxItems: 16, items: {
          type: "object", additionalProperties: false, required: ["offerId", "offerHash", "body", "bodyHash", "excerpts"],
          properties: { offerId: id, offerHash: hash, body: { type: "string", minLength: 1, maxLength: 40000 }, bodyHash: hash, signature,
            excerpts: { type: "array", minItems: 1, maxItems: 16, description: "Unique requirement IDs with exact UTF-16 spans in body. Stance is provider declared.", items: {
              type: "object", additionalProperties: false, required: ["requirementId", "start", "end", "stance"], properties: {
                requirementId: id, start: { type: "integer", minimum: 0, maximum: 40000 }, end: { type: "integer", minimum: 1, maximum: 40000 },
                stance: { type: "string", enum: ["supports", "refutes", "inconclusive"] },
              },
            } },
          },
        } },
        reviews: { type: "array", maxItems: 16, items: {
          type: "object", additionalProperties: false,
          required: ["offerId", "deliveryHash", "acceptedRequirementIds", "reviewer", "reviewerNote"], properties: {
            offerId: id, deliveryHash: hash, acceptedRequirementIds: ids,
            reviewer: { type: "string", minLength: 1, maxLength: 120 }, reviewerNote: { type: "string", minLength: 1, maxLength: 2000 },
          },
        } },
      },
    } } } },
    responses: {
      "200": { description: "Default/json: procurement with recomputed request hash, original validated packet, observation time, offer/delivery/review reasons, missing requirements, proposal-only quote budget, optional next-offer recommendation, and payment status not-observed. Markdown/CSV: attachment containing the same dated inspection in text/markdown or text/csv. No financial reservation or factual verdict." },
      "400": { description: "Invalid selector/MIME/JSON/UTF-8, oversized or late body, invalid strict packet or proposed selection, or formatted receipt exceeding the output bound or containing non-displayable controls." },
      "401": { description: "Absent/revoked session or invalid API key. Private body unread." },
      "403": { description: "Missing export scope or cross-origin cookie request. Private body unread." },
      "503": { description: "Authentication unavailable. Private body unread." },
    },
  } },
} as const;
