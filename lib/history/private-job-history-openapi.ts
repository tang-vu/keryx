import { RUN_SURFACES, RUN_OWNERSHIP_METHODS } from "../research/run-provenance";

const date = { type: "string", format: "date-time",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:Z|\\+00:00)$" };
const id = { type: "string", pattern: "^prv_[a-f0-9]{64}$" };
const cursor = { type: "string", pattern: "^[A-Za-z0-9_-]{1,2000}$", maxLength: 2000 };
const filters = {
  limit: { type: "integer", minimum: 1, maximum: 25, default: 25 },
  cursor: { ...cursor, description: "Opaque exact-payer/filter-bound continuation; reuse the same filters and limit." },
  search: { type: "string", maxLength: 200, description: "Literal case-sensitive substring, including % and _. Well-formed UTF-16, no NUL; length is bounded in UTF-16 code units." },
  surface: { type: "string", enum: [...RUN_SURFACES] },
  network: { type: "string", enum: ["eip155:5042", "eip155:5042002"], description: "Recorded incoming-settlement network filter; never selects a backend/archive." },
  from: { ...date, description: "Inclusive intent creation time; preserve up to six fractional digits. Must not exceed to." },
  to: { ...date, description: "Inclusive intent creation time; preserve up to six fractional digits. Must not precede from." },
};
const privateHeaders = {
  "Cache-Control": { schema: { type: "string", const: "no-store" } },
  "Referrer-Policy": { schema: { type: "string", const: "no-referrer" } },
  "X-Robots-Tag": { schema: { type: "string", const: "noindex, nofollow" } },
  Vary: { schema: { type: "string", const: "Cookie, Authorization, X-Keryx-Expected-Wallet" } },
};
const parameters = [
  { name: "Origin", in: "header", schema: { type: "string", format: "uri" },
    description: "Required exact configured origin for cookie authentication. A bearer request may omit it; any supplied Origin must match exactly. Origin grants no owner authority." },
  { name: "X-Keryx-Expected-Wallet", in: "header", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    description: "Comparison-only precondition against the authenticated payer, never an owner selector." },
];
const security = [{ WebSession: [] }, { ApiKeyAuth: [] }];
const authority = "POST only; every query parameter is rejected. Required JSON object is bounded to 8192 streamed UTF-8 bytes and a 5-second body read. Use an active keryx_session (SIWE or supported verified Circle Google login) with its exact durable session, or a verified unrevoked bearer key with explicit history:read. Authorization header presence never falls back to cookies, including malformed or revoked keys. Exact session identity or key wallet/scope is rechecked after private IO and serialization. Current authenticated payer only: no linked-wallet/account-membership inheritance, backend-signer authority, public report fallback or privacy mutation. Aborted/expired operations refuse.";
const errors = {
  "400": { description: "invalid_history_query for query selectors, invalid/unknown body fields, format, cursor/filter binding or oversized JSON; invalid_owner_precondition for a malformed expected-wallet header.", headers: privateHeaders },
  "401": { description: "Authentication absent, expired or revoked; bearer presence never falls back to cookies.", headers: privateHeaders },
  "403": { description: "invalid_origin or insufficient_scope (explicit history:read required).", headers: privateHeaders },
  "405": { description: "Only POST is supported.", headers: { ...privateHeaders, Allow: { schema: { type: "string", const: "POST" } } } },
  "409": { description: "history_owner_changed: expected payer or exact active session/key changed; no replacement owner's payload.", headers: privateHeaders },
  "503": { description: "history_unavailable: missing read capability, inconsistent/oversized stored record, auth/storage failure, abort or deadline. Never a fallback to public, linked-wallet or archived history.", headers: privateHeaders },
};
const envelope = {
  format: { type: "string", const: "private-job-history-v1" },
  wallet: { type: "string", pattern: "^0x[a-f0-9]{40}$" },
  scope: { type: "string", const: "exact-payer-private-current-store" },
  capabilities: { type: "object", additionalProperties: false,
    required: ["completedPrivateJobs", "exactPayerOnly", "multiwallet", "creatorReceipts", "privacyMutation", "publicReportLinks"],
    properties: { completedPrivateJobs: { const: true }, exactPayerOnly: { const: true }, multiwallet: { const: false },
      creatorReceipts: { const: false }, privacyMutation: { const: false }, publicReportLinks: { const: false } } },
  qualification: { type: "string", description: "Exact-payer current-store completed private jobs only; bounded intent scan, not a transaction snapshot or all archives. No linked-wallet inheritance, creator ledger, privacy mutation or public report links." },
};
const row = { type: "object", additionalProperties: false,
  required: ["id", "ownerWallet", "createdAt", "intentCreatedAt", "savedAt", "question", "researchMode", "model", "packageVersion",
    "record", "provenance", "incomingSettlement", "ownSettledSpendMicros", "creatorRewardsMicros", "paidCreators"],
  properties: {
    id, ownerWallet: envelope.wallet, createdAt: date, intentCreatedAt: { anyOf: [date, { type: "null" }] }, savedAt: date,
    question: { type: "string", maxLength: 8192 }, researchMode: { type: "string", enum: ["quick", "deep"] },
    model: { type: ["string", "null"], maxLength: 64 }, packageVersion: { type: "string", const: "1.0.0" },
    record: { type: "string", const: "finalized-private-result" },
    provenance: { type: ["object", "null"], additionalProperties: false, required: ["version", "surface", "ownershipMethod"],
      properties: { version: { const: 1 }, surface: { type: "string", enum: [...RUN_SURFACES] },
        ownershipMethod: { type: "string", enum: [...RUN_OWNERSHIP_METHODS] } },
      description: "Closed stored run provenance; null is unknown, never inferred from client input." },
    incomingSettlement: { type: "object", additionalProperties: false,
      required: ["status", "amountMicros", "network", "reference", "settledAt", "evidenceSource", "chainFinalityVerified"],
      properties: { status: { const: "settled" }, amountMicros: { type: "string", pattern: "^[1-9]\\d{0,6}$" },
        network: filters.network, reference: { type: "string", maxLength: 256 }, settledAt: date,
        evidenceSource: { type: "string", enum: ["circle-facilitator-success", "circle-transfer-search"] }, chainFinalityVerified: { const: false } } },
    ownSettledSpendMicros: { type: "null" }, creatorRewardsMicros: { type: "null" }, paidCreators: { type: "null" },
  } };
const metadata = { ...envelope, rows: { type: "array", maxItems: 25, items: row },
  nextCursor: { anyOf: [cursor, { type: "null" }] } };
const bodyDescription = "JSON object only; 8192 UTF-8 bytes maximum. Unknown fields and all URL query parameters refuse. Never put private IDs/cursors in a URL.";
const metadataDescription = "Completed saved private results require the exact payer-bound intent, permanent execution claim and recorded validated incoming settlement. Intents, payments or claims alone are not completed jobs. Metadata has no answer body or public report links. Incoming settlement is recorded evidence, not independent chain-finality verification, own settled spend or a creator ledger; those unavailable accounting fields stay null.";

export const privateJobHistoryOpenApiPaths = {
  "/api/me/private-jobs": { post: {
    operationId: "readPrivateJobHistory", tags: ["Account"], summary: "Page your exact-payer completed private-job metadata",
    security, parameters, description: authority + " " + metadataDescription +
      " Within 15 seconds: at most 26 intent candidates, 25 scanned and 25 returned rows, 1,500,000 response bytes. Descending intent-createdAt/id continuation preserves microseconds; filtered empty pages may still continue. Not a transaction snapshot.",
    requestBody: { required: true, description: bodyDescription, content: { "application/json": {
      schema: { type: "object", additionalProperties: false, properties: { ...filters, format: { type: "string", enum: ["json"], default: "json" } } },
    } } },
    responses: { ...errors, "200": { description: metadataDescription, headers: privateHeaders, content: { "application/json": {
      schema: { type: "object", additionalProperties: false, required: [...Object.keys(metadata), "scanLimited", "scannedIntents"],
        properties: { ...metadata, scanLimited: { type: "boolean" }, scannedIntents: { type: "integer", minimum: 0, maximum: 25 } } },
    } } } },
  } },
  "/api/me/private-jobs/detail": { post: {
    operationId: "readPrivateJobHistoryDetail", tags: ["Account"], summary: "Read one exact-payer authorized private report",
    security, parameters, description: authority +
      " Within 15 seconds and 1,500,000 response bytes, returns the bounded stored report allowlist (answer, engine, dates, subClaims, decisions, citations, evidence and claimCoverage). Citation reward is labeled recordedRewardUsdc, never settled creator earnings. No raw trace, ciphertext, transport, signature, recovery packet or private journal. Stored records over 4 MiB refuse; no partial report.",
    requestBody: { required: true, description: bodyDescription, content: { "application/json": {
      schema: { type: "object", additionalProperties: false, required: ["id"], properties: { id, format: { type: "string", enum: ["report"], default: "report" } } },
    } } },
    responses: { ...errors, "404": { description: "not_found: absent, not exact-payer owned or not a completed saved private result. No existence disclosure through a public fallback.", headers: privateHeaders },
      "200": { description: "private-job-history-v1 envelope, the metadata row and result: answer (at most 512 Ki UTF-16 code units), engine, createdAt, savedAt, subClaims (128), decisions (256), citations (256 with recordedRewardUsdc), nullable evidence (512), nullable claimCoverage (128), and paymentEvidence='incoming-only-no-creator-ledger'. This is a report projection, not a creator-receipt or financial export.", headers: privateHeaders } },
  } },
  "/api/me/private-jobs/export": { post: {
    operationId: "exportPrivateJobHistory", tags: ["Account"], summary: "Export bounded exact-payer private-job metadata",
    security, parameters, description: authority + " " + metadataDescription +
      " Within 25 seconds: at most 20 pages, 500 rows and 2 MiB. complete/truncated/nextCursor qualify this bounded current-store attempt, never all archives or a transaction snapshot. CSV has a metadata row and neutralizes spreadsheet formula prefixes; JSON preserves question text. No report bodies or private receipt/creator export.",
    requestBody: { required: true, description: bodyDescription, content: { "application/json": {
      schema: { type: "object", additionalProperties: false, properties: { ...filters, format: { type: "string", enum: ["json", "csv"], default: "json" } } },
    } } },
    responses: { ...errors, "200": { description: "Metadata export with explicit completeness, continuation and bounds. complete iff not truncated and nextCursor is null. CSV carries equivalent metadata in its metadata row.", headers: {
      ...privateHeaders, "X-Keryx-History-Truncated": { description: "CSV only.", schema: { type: "string", enum: ["true", "false"] } },
      "Content-Disposition": { description: "CSV only.", schema: { type: "string", const: 'attachment; filename="keryx-private-job-history.csv"' } },
    }, content: { "application/json": { schema: { type: "object", additionalProperties: false,
      required: [...Object.keys(metadata), "complete", "truncated", "pages", "bounds"], properties: {
        ...metadata, rows: { type: "array", maxItems: 500, items: row }, complete: { type: "boolean" }, truncated: { type: "boolean" },
        pages: { type: "integer", minimum: 1, maximum: 20 }, bounds: { type: "object", additionalProperties: false,
          required: ["maxPages", "maxRows", "maxBytes"], properties: { maxPages: { const: 20 }, maxRows: { const: 500 }, maxBytes: { const: 2097152 } } },
      } } }, "text/csv": { schema: { type: "string" } } } } },
  } },
};
