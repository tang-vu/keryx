const text = { type: "string" } as const;
const uri = { ...text, format: "uri" } as const;
const paperRef = { $ref: "#/components/schemas/PaperRecord" } as const;
export const paperOpenApiSchemas = {
  PaperRecord: {
    type: "object", additionalProperties: false,
    required: ["title", "authors", "authorCount", "authorsTruncated", "repository", "url", "metadataUrl", "metadataObservedAt", "publicationKind", "peerReview"],
    properties: {
      title: { ...text, minLength: 1, maxLength: 1000 }, authors: { type: "array", maxItems: 50, items: { ...text, minLength: 1, maxLength: 300 } },
      authorCount: { type: "integer", minimum: 0 }, authorsTruncated: { type: "boolean" },
      publishedYear: { type: "integer", minimum: 1000, maximum: 2999 }, venue: { ...text, maxLength: 300 }, doi: text,
      arxivId: { ...text, description: "Exact observed version, never a latest-version substitution." },
      repository: { ...text, enum: ["arxiv", "openreview", "pmlr", "acl-anthology", "crossref"] },
      url: uri, metadataUrl: uri, metadataObservedAt: { ...text, format: "date-time" },
      publicationKind: { ...text, enum: ["preprint", "conference-paper", "journal-article", "unknown"] }, peerReview: { ...text, const: "unknown" },
      links: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["label", "url"], properties: { label: { ...text, enum: ["PDF", "Repository", "Reviews"] }, url: uri } } },
    },
  },
  PaperSearchResult: {
    type: "object", additionalProperties: false, required: ["version", "scope", "groups", "totalWorks", "catalogRecords", "providers"],
    properties: {
      version: { type: "integer", const: 1 }, scope: { ...text, const: "bibliography-only" },
      totalWorks: { type: "integer", minimum: 0, maximum: 112 }, catalogRecords: { type: "integer", minimum: 0, maximum: 100 },
      groups: { type: "array", maxItems: 112, items: { type: "object", additionalProperties: false, required: ["id", "record", "records"], properties: {
        id: { ...text, pattern: "^paper:[a-f0-9]{64}$" }, record: paperRef, records: { type: "array", minItems: 1, maxItems: 112, items: paperRef },
      } } },
      providers: { type: "array", maxItems: 2, items: { type: "object", additionalProperties: false, required: ["name", "status", "records"], properties: {
        name: { ...text, enum: ["arxiv", "crossref"] }, status: { ...text, enum: ["available", "empty", "unavailable"] }, records: { type: "integer", minimum: 0, maximum: 6 },
      } } },
    },
  },
} as const;
export const paperOpenApiPaths = {
  "/api/papers": { get: {
    operationId: "browseResearchPapers", summary: "Browse or explicitly search paper bibliography", security: [],
    description: "Default: checked-in metadata only, no database, model, original read, citation or payment. search=1 sends an explicit query/DOI to fixed arXiv/Crossref endpoints: at most two requests, six records per response. Unknown peer review; linked PDFs remain unread. Author/year/DOI filter the sample. No pagination or retries. Cache-Control: no-store.",
    parameters: [
      { in: "query", name: "q", schema: { ...text, maxLength: 120 }, description: "Literal starter metadata or explicit live title/topic/identifier query." },
      { in: "query", name: "author", schema: { ...text, maxLength: 120 }, description: "All literal terms must match one observed contributor name." },
      { in: "query", name: "year", schema: { ...text, pattern: "^[12][0-9]{3}$" } },
      { in: "query", name: "doi", schema: { ...text, maxLength: 200 }, description: "Exact DOI or canonical doi.org URL. With search=1, takes lookup precedence over q." },
      { in: "query", name: "search", schema: { ...text, enum: ["0", "1"], default: "0" }, description: "Explicit external metadata admission." },
    ],
    responses: {
      "200": { description: "Bounded bibliography and per-provider available/empty/unavailable status; empty means no matching records accepted.", content: { "application/json": { schema: { $ref: "#/components/schemas/PaperSearchResult" } } } },
      "400": { description: "Invalid/duplicate filters, missing live query, or excess exact identifiers/provider operations." },
      "429": { description: "Process-local live admission exceeded: three per caller, six globally per minute; replicas multiply limits.", headers: { "Retry-After": { schema: text, description: "Seconds before retry." } } },
    },
  } },
} as const;
