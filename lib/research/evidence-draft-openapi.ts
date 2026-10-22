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
        reports: { type: "array", maxItems: 8, items: { type: "object" }, description: "Retained report projection: id, subClaims, citations, optional evidence; literal source/item/read-URL/version/marker and original claim matching required. Canonical explicitly versioned arXiv PDF URLs may then map to the exact same-version saved landing record; mapped excerpts retain the original readUrl, including in user-assessment bindings. All other bibliography matching remains exact-URL. Valid consistent PDF webProvenance.pdfTextScope is retained only when citation and evidence record the same scope; it appears in the excerpt payload and draft text exports and binds manual assessments. Quotation IDs/selections remain stable when optional scope changes, while old assessments become stale. Missing, malformed, contradictory or conflicting annotations supply no page bounds and do not discard an otherwise eligible quote. Other report fields are discarded. Imported metadata never authenticates reading or semantic support." },
        passage: { type: "string", maxLength: 12000 },
        claims: { type: "array", maxItems: 32, items: { type: "object" }, description: "Unique id, original UTF-16 start/end span, 1–4 exact paperUrls, at most 16 excerptIds; optional explicitly user-supplied assessment bound to literal claim/rows." },
        themes: { type: "array", maxItems: 16, items: { type: "object" }, description: "Unique id, title (120 chars), authorNote (2000 chars), at most 32 exact excerptIds. Author notes stay unverified. Optional statements (at most 24 per theme): draft-unique id, kind (contribution, agreement, disagreement or gap), text (600 chars), at most 8 exact Include paperUrls and at most 16 exact excerptIds from those papers. A contribution names one paper; agreement and disagreement name at least two; a gap may name none." },
        assembly: { oneOf: [
          { type: "object", additionalProperties: false, required: ["mode"], properties: { mode: { const: "append" } } },
          { type: "object", additionalProperties: false, required: ["mode", "themeId"], properties: { mode: { const: "regenerate" }, themeId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,80}$" } } },
        ], description: "Optional one-shot zero-I/O extractive assembly. Append groups previously unorganised exact records by original research targets; regenerate replaces only the chosen theme's statements using its selected excerpts and preserves all titles, notes and other themes. No semantic comparison or model call." },
        readingStatuses: { type: "array", maxItems: 50, items: { type: "object", additionalProperties: false, required: ["paperUrl", "status", "reason"], properties: {
          paperUrl: { type: "string", format: "uri", maxLength: 2048 }, status: { enum: ["unread", "unavailable"] }, reason: { type: "string", maxLength: 300 },
        } }, description: "Caller observations for unique exact Include records lacking retained evidence. Contradictions and foreign records refuse. Unread/unavailable are separate from unknown retention gaps and never supply citations or access-check authority." },
      },
    } } } },
    responses: {
      "200": { description: "Private draft plus quotation-theme Markdown, biblatex LaTeX, matching BibTeX/RIS and referenceCount. When assembly is requested, draft.editableRequest returns validated editable inputs with the one-shot assembly operation removed, preserving future edits. Separate reading lists report caller observations or unknown status. Each statement is excerpt-bound, author-gap or withheld; a withheld statement (wrong paper count, or a named paper without a selected retained excerpt) is returned with its reason and omitted from every export. Binding is structural, not a semantic support verdict. Exports are refused unless cited keys and reference entries correspond one to one. Pending/unavailable/user-assessed claims are distinct; no automatic supported verdict or settlement evidence." },
      "400": { description: "Invalid selector/MIME/JSON, oversized/deadline-exceeded packet, invalid span, changed/foreign excerpt, duplicate statement identifier or selection, or identity mismatch." },
      "401": { description: "Absent/revoked session or invalid API key." },
      "403": { description: "Insufficient export scope or cross-origin cookie request." },
      "503": { description: "Authentication unavailable; draft body remains unread." },
    },
  } },
} as const;
