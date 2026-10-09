/** Discovery summary; executable field/identity rules live in evidence-draft.ts. */
export const evidenceDraftOpenApiPath = {
  "/api/research/evidence-draft": { post: {
    operationId: "assemblePrivateEvidenceDraft", summary: "Assemble retained quotation themes and manual claim assessments",
    security: [{ ApiKeyAuth: [] }, { WebSession: [] }],
    description: "Source candidate: stateless transformation, not automated semantic verification. API keys require export scope; cookie sessions require the exact configured public Origin (BASE_URL) and same-origin Sec-Fetch-Site when supplied. Request Host/forwarded headers grant no origin authority. Authentication precedes private body reading. No private history retrieval, model, source fetch, purchase, reward or draft storage. Existing authentication access and ordinary key last-used bookkeeping remain. Request is at most 65536 actual UTF-8 bytes and five seconds. Exact fields/identity rules and user-assessment bindings: docs/evidence-drafts.md and lib/research/evidence-draft.ts. Every response is private/no-store; fixed errors never echo passages. Imported report origin remains caller asserted.",
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", additionalProperties: false, required: ["version", "scope", "workspace", "reports", "passage", "claims", "themes"],
      properties: {
        version: { type: "integer", const: 1 }, scope: { type: "string", const: "private-evidence-draft" },
        workspace: { type: "object", description: "Version-1 personal-bibliography workspace. Use Include records and omit screening notes; at most 50 exact records. This summary does not replace the strict shared workspace schema." },
        reports: { type: "array", maxItems: 8, items: { type: "object" }, description: "Retained report projection: id, subClaims, citations, optional evidence; exact source/item/URL/version/marker and original claim matching required. Extra report fields are discarded, never authenticated." },
        passage: { type: "string", maxLength: 12000 },
        claims: { type: "array", maxItems: 32, items: { type: "object" }, description: "Unique id, original UTF-16 start/end span, 1–4 exact paperUrls, at most 16 excerptIds; optional explicitly user-supplied assessment bound to literal claim/rows." },
        themes: { type: "array", maxItems: 16, items: { type: "object" }, description: "Unique id, title (120 chars), authorNote (2000 chars), at most 32 exact excerptIds. Author notes stay unverified." },
      },
    } } } },
    responses: {
      "200": { description: "Private draft plus quotation-theme Markdown, biblatex LaTeX, matching BibTeX/RIS and referenceCount. Pending/unavailable/user-assessed claims are distinct; no automatic supported verdict or settlement evidence." },
      "400": { description: "Invalid selector/MIME/JSON, oversized/deadline-exceeded packet, invalid span, changed/foreign excerpt or identity mismatch." },
      "401": { description: "Absent/revoked session or invalid API key." },
      "403": { description: "Insufficient export scope or cross-origin cookie request." },
      "503": { description: "Authentication unavailable; draft body remains unread." },
    },
  } },
} as const;
