/** Discovery summary; executable field rules live in draft-check.ts. */
export const draftCheckOpenApiPath = {
  "/api/research/draft-check": { post: {
    operationId: "checkPrivateDraft", summary: "Check each cited sentence of a private passage against supplied source text",
    security: [{ ApiKeyAuth: [] }, { WebSession: [] }],
    description: "Stateless deterministic wording comparison (method lexical-overlap-v1), not semantic or expert review. Splits the passage into exact sentence spans, binds numeric, LaTeX, Pandoc and author-year citation markers to the supplied reference list, and compares each cited sentence with caller-supplied source text. Keryx fetches, purchases, rewards and stores nothing; references are not resolved over the network and supplied text is not authenticated as the cited work. API keys require export scope; cookie sessions require the exact configured public Origin (BASE_URL) and same-origin Sec-Fetch-Site when supplied. Authentication precedes private body reading. Request is at most 65536 actual UTF-8 bytes and five seconds. Every response is private/no-store; fixed errors never echo passages. Exact rules: docs/draft-check.md and lib/research/draft-check.ts.",
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", additionalProperties: false, required: ["version", "scope", "passage", "references", "sources"],
      properties: {
        version: { type: "integer", const: 1 }, scope: { type: "string", const: "private-draft-check" },
        passage: { type: "string", minLength: 1, maxLength: 12000 },
        references: { type: "object", additionalProperties: false, required: ["format", "text"], properties: {
          format: { type: "string", enum: ["bibtex", "ris", "list"], description: "list: one DOI, https link or formatted citation per line." },
          text: { type: "string", maxLength: 24000, description: "At most 64 references." },
        } },
        sources: { type: "array", maxItems: 32, description: "Text you hold for cited works. A cited reference without an entry is reported source-unavailable.", items: {
          type: "object", additionalProperties: false, required: ["reference", "coverage", "text"], properties: {
            reference: { type: "string", description: "A reference key from the parsed list (citation key, RIS ID, or ref<N>)." },
            coverage: { type: "string", enum: ["full-text", "partial"], description: "partial when only an abstract, section or retained excerpts are supplied." },
            text: { type: "string", minLength: 1, maxLength: 40000 },
          } } },
        claims: { type: "array", maxItems: 128, description: "Optional ordered, non-overlapping UTF-16 start/end spans. Omit to check one claim per sentence.", items: {
          type: "object", additionalProperties: false, required: ["start", "end"], properties: { start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 1 } } } },
      },
    } } } },
    responses: {
      "200": { description: "check: parsed references, claims with exact spans and one verdict each (supported, partly-supported, not-found, source-unavailable or not-checked), per-citation verbatim excerpt offsets or an explicit no-supporting-passage-found state, unmatched wording, and reference/citation flags. not-found means not found in the supplied text only." },
      "400": { description: "Invalid selector/MIME/JSON, oversized/deadline-exceeded packet, invalid span, more than 64 references or 128 claims, or source text for an unknown reference." },
      "401": { description: "Absent/revoked session or invalid API key." },
      "403": { description: "Insufficient export scope or cross-origin cookie request." },
      "503": { description: "Authentication unavailable; draft body remains unread." },
    },
  } },
} as const;
