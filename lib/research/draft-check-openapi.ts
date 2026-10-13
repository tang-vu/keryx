/** Discovery summary; executable field rules live in draft-check.ts. */
const sourceIdentity = { type: "object", additionalProperties: false,
  required: ["sourceId", "itemId", "itemUrl", "contentVersion"], properties: {
    sourceId: { type: "string", minLength: 1, maxLength: 200 }, itemId: { type: "string", minLength: 1, maxLength: 200 },
    itemUrl: { type: "string", format: "uri", maxLength: 2048, description: "Credential-free https URL of the recorded work." },
    contentVersion: { type: "string", minLength: 1, maxLength: 200 }, doi: { type: "string", minLength: 1, maxLength: 1000 },
    bodyHash: { type: "string", minLength: 1, maxLength: 200 }, evidenceProvenance: { type: "string", const: "synthetic-demo" },
  }, description: "Caller-asserted immutable read identity, never authentication or payment authority. DOI or exact URL must match the written reference; synthetic or mismatched identities cannot support a citation. Partial version-bound reads without a match stay unavailable." } as const;
export const draftCheckOpenApiPath = {
  "/api/research/draft-check": { post: {
    operationId: "checkPrivateDraft", summary: "Check each cited sentence of a private passage against supplied source text",
    security: [{ ApiKeyAuth: [] }, { WebSession: [] }],
    description: "Stateless deterministic wording comparison (method lexical-overlap-v2), not semantic or expert review. Splits the passage into exact sentence spans, binds numeric, LaTeX, Pandoc and author-year citation markers to the supplied reference list, and compares each cited sentence with caller-supplied source text. Optional version identities bind excerpts to exact DOI/URL works. Optional alternative source bodies produce separately labelled suggestions without rewriting citations or changing verdicts. Keryx fetches, purchases, rewards and stores nothing on this route; supplied identity is not authenticated. Optional browser device retention is a separate explicit action, never a server record. API keys require export scope; cookie sessions require the exact configured public Origin (BASE_URL) and same-origin Sec-Fetch-Site when supplied. Authentication precedes private body reading. Request is at most 65536 actual UTF-8 bytes and five seconds. Every response is private/no-store; fixed errors never echo passages. Exact rules: docs/draft-check.md and lib/research/draft-check.ts.",
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
            identity: sourceIdentity,
          } } },
        suggestions: { type: "array", maxItems: 8, description: "Optional alternative read bodies. Suggestions cannot repair the written citations or change creator rewards.", items: {
          type: "object", additionalProperties: false, required: ["url", "title", "coverage", "text", "identity"], properties: {
            url: { type: "string", format: "uri", maxLength: 2048, description: "Exact identity.itemUrl." },
            title: { type: "string", minLength: 1, maxLength: 1000 }, coverage: { type: "string", enum: ["full-text", "partial"] },
            text: { type: "string", minLength: 1, maxLength: 40000 }, identity: sourceIdentity,
          },
        } },
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
