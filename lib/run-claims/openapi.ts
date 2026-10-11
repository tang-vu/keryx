import { RUN_SURFACES, RUN_OWNERSHIP_METHODS } from "../research/run-provenance";
import { RUN_CLAIM_TTL_MS } from "./contracts";

const wallet = { type: "string", pattern: "^0x[0-9a-f]{40}$" };
const date = { type: "string", format: "date-time", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
  description: "Canonical UTC timestamp with milliseconds." };
const id = { type: "string", pattern: "^(?!prv_|a2a_)[A-Za-z0-9_-]{1,128}$",
  description: "Ordinary saved research id; private/native job ids are refused." };
const binding = { $ref: "#/components/schemas/RunClaimBinding" };
const ownership = { $ref: "#/components/schemas/RunOwnership" };
const cursor = { type: ["string", "null"], pattern: "^[A-Za-z0-9_-]{1,1600}$", maxLength: 1600 };
const expectedWallet = (required: boolean) => ({ name: "X-Keryx-Expected-Wallet", in: "header", required,
  schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  description: "Comparison only against the independently authenticated wallet; never selects an owner. A mismatch returns owner_changed before claim/history storage." });
const privateHeaders = {
  "Cache-Control": { schema: { type: "string", const: "no-store" } },
  "Referrer-Policy": { schema: { type: "string", const: "no-referrer" } },
  "X-Robots-Tag": { schema: { type: "string", const: "noindex, nofollow" } },
  Vary: { schema: { type: "string", const: "Cookie, Authorization, X-Keryx-Expected-Wallet" } },
};
const failure = (description: string) => ({ description, headers: privateHeaders,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const gated = "Default-off: KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED must be exactly true, with a valid configured network/origin and an admitted ordinary store. Unsupported/native/enrolled ports or unapplied ordinary RPCs return unavailable; there is no archive, public REST or schema-initialization fallback. Source preparation does not establish production activation.";
const historyDescription = "An active durable SIWE session or a verified key with explicit history:read binds the owner. Bearer presence never falls back to cookies. No client wallet/network/origin selectors, linked accounts, archive or private/native jobs. Recorded and claimed attribution are distinct; neither proves payer identity or settlement, and a claim never rewrites the saved run. " + gated;
const historyFailures = {
  "400": failure("invalid_history_query or invalid_owner_precondition: malformed, duplicate, unknown or oversized parameters/cursor; owner/network/origin/filter cursor mismatch."),
  "401": failure("Missing, invalid or revoked authentication; no bearer-to-cookie fallback."),
  "403": failure("insufficient_scope: verified key lacks explicit history:read."),
  "409": failure("owner_changed: expected-wallet precondition differs; no other owner's data."),
  "503": failure("history_unavailable or unavailable durable session: no adapter/archive fallback."),
};

/** Caller-private sidecars only. These schemas never add a credential to QueryRun or a public projection. */
export const runClaimOpenApiSchemas = {
  RunClaimBinding: { type: "object", additionalProperties: false, required: ["network", "origin"], properties: {
    network: { type: "string", enum: ["eip155:5042", "eip155:5042002"] },
    origin: { type: "string", format: "uri", maxLength: 2048,
      description: "Exact canonical configured origin. Lowercase ASCII DNS over HTTPS, or exact localhost/127.0.0.1/[::1] loopback over HTTP(S); no credentials, path, query, fragment, IDNA or noncanonical port. Request Host does not select this binding." },
  } },
  RunClaimReceipt: { type: "object", additionalProperties: false,
    required: ["version", "runId", "wallet", "claimedAt", "binding"], properties: {
      version: { type: "integer", const: 1 }, runId: id, wallet, claimedAt: date, binding,
    }, description: "Ownership-sidecar acknowledgement only. No raw token, payer authority, reward, payment receipt or rewrite of the original." },
  RunClaimDelivery: { type: "object", additionalProperties: false, required: ["version", "claimUrl", "expiresAt"], properties: {
    version: { type: "integer", const: 1 },
    claimUrl: { type: "string", format: "uri", maxLength: 2200, pattern: "^https?://[^?#]+/claim-run#[a-f0-9]{64}$",
      description: "Caller-private credential at the exact configured origin, in the fragment only. Never put it in a query, public JSON/report/receipt/export, trace, analytics or logs. No credentials or noncanonical URL spelling." },
    expiresAt: { ...date, description: `Expires exactly ${RUN_CLAIM_TTL_MS / 1000} seconds after issuance. Single use; a lost/uncertain acknowledgement cannot reissue it.` },
  } },
  PrivateRunClaimPacket: { description: "Optional one-shot original-caller transport after actual persistence. It is separate from the original answer, payment bytes and public keryx metadata; missing when default-off or genuinely owned/operational. An unavailable late sidecar preserves the completed answer.",
    oneOf: [
      { type: "object", additionalProperties: false, required: ["version", "runId", "status", "delivery"], properties: {
        version: { type: "integer", const: 1 }, runId: id, status: { type: "string", const: "available" }, delivery: { $ref: "#/components/schemas/RunClaimDelivery" },
      } },
      { type: "object", additionalProperties: false, required: ["version", "runId", "status"], properties: {
        version: { type: "integer", const: 1 }, runId: id, status: { type: "string", const: "unavailable" },
      } },
    ] },
  RunOwnership: { oneOf: [
    { type: "object", additionalProperties: false, required: ["method", "claimedAt"], properties: {
      method: { type: "string", const: "recorded" }, claimedAt: { type: "null" },
    } },
    { type: "object", additionalProperties: false, required: ["method", "claimedAt"], properties: {
      method: { type: "string", const: "claimed" }, claimedAt: date,
    } },
  ], description: "Private history attribution only. Claimed ownership never implies payer, sponsored allocation, transfer or settlement authority." },
  RunOwnershipHistoryRow: { type: "object", additionalProperties: false,
    required: ["id", "createdAt", "question", "provenance", "funding", "recordedSpendUsdc", "recordedCreatorAllocationUsdc", "paymentMode", "isFollowUp", "ownership"], properties: {
      id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, createdAt: date,
      question: { type: "string", maxLength: 8192, description: "Bounded well-formed plain text without NUL." },
      provenance: { oneOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["version", "surface", "ownershipMethod"], properties: {
        version: { type: "integer", const: 1 }, surface: { type: "string", enum: [...RUN_SURFACES] },
        ownershipMethod: { type: "string", enum: [...RUN_OWNERSHIP_METHODS] },
      } }], description: "Missing or invalid historical provenance stays unknown; claim attribution does not replace this recorded metadata." },
      funding: { type: "string", enum: ["browser-recorded", "other-or-unknown"] },
      recordedSpendUsdc: { type: "number", minimum: 0 }, recordedCreatorAllocationUsdc: { type: "number", minimum: 0 },
      paymentMode: { type: ["string", "null"], enum: ["real", "offline", null] }, isFollowUp: { type: "boolean" }, ownership,
    }, description: "Allowlist summary only, without answer, token, session hashes or original private packets. Recorded amounts are not independent settlement or claimant-spend evidence." },
  RunOwnershipHistoryPage: { type: "object", additionalProperties: false,
    required: ["version", "wallet", "binding", "scope", "rows", "nextCursor"], properties: {
      version: { type: "integer", const: 1 }, wallet, binding, scope: { type: "string", const: "ownership-current-store" },
      rows: { type: "array", maxItems: 50, items: { $ref: "#/components/schemas/RunOwnershipHistoryRow" } }, nextCursor: cursor,
    } },
  RunOwnershipOriginal: { type: "object", additionalProperties: true, required: ["id", "createdAt"], properties: {
    id, createdAt: date, question: { type: "string" }, answer: { type: "string" },
  }, description: "The unchanged owner-private saved QueryRun, not a sanitized public response. Ordinary ports bound the entire serialized original to 4,000,000 UTF-8 bytes and verify ownership/exact-original conditions. Remaining saved fields are retained rather than rebuilt; their recorded financial data grants no new payment authority. The browser separately projects bounded plaintext." },
  RunOwnershipHistoryDetail: { type: "object", additionalProperties: false,
    required: ["version", "wallet", "binding", "run", "ownership"], properties: {
      version: { type: "integer", const: 1 }, wallet, binding, run: { $ref: "#/components/schemas/RunOwnershipOriginal" }, ownership,
    } },
  PrivateRunClaimOpenAiAdmissionError: { type: "object", additionalProperties: false, required: ["error"], properties: {
    error: { type: "object", additionalProperties: false, required: ["message", "type", "code"], properties: {
      message: { type: "string" }, type: { type: "string", const: "invalid_request_error" }, code: { type: "string", const: "claims_unavailable" },
    } },
  }, description: "Non-streaming enabled ordinary-claim admission refused before research. No claim token, provider/payment call or automatic retry." },
  RunClaimChatCompletionChunk: { type: "object", required: ["id", "object", "created", "model", "choices"], properties: {
    id: { type: "string" }, object: { type: "string", const: "chat.completion.chunk" }, created: { type: "integer" }, model: { type: "string" },
    choices: { type: "array", items: { type: "object", required: ["index", "delta", "finish_reason"], properties: {
      index: { type: "integer" }, delta: { type: "object", properties: { role: { type: "string" }, content: { type: "string" }, reasoning_content: { type: "string" } } },
      finish_reason: { type: ["string", "null"], enum: ["stop", null] },
    } } },
    keryx: { $ref: "#/components/schemas/ChatCompletion/properties/keryx" },
    keryx_private: { $ref: "#/components/schemas/PrivateRunClaimPacket" },
  }, description: "Only the terminal stop chunk may carry the optional caller-private packet after persistence; it is a top-level sibling of public keryx metadata, never answer/reasoning text." },
};

export const runClaimOpenApiPaths = {
  "/api/me/run-claims": { post: {
    operationId: "consumePrivateRunClaim", tags: ["Account"], summary: "Attach a caller-private saved run to your account",
    security: [{ WebSession: [] }],
    description: "Active durable interactive SIWE session only; any Authorization header is rejected, including a history:read key. Origin must equal the configured binding exactly, and cross-site Fetch Metadata is refused. X-Keryx-Expected-Wallet is required and compared with the authenticated wallet. The store rechecks that same live session, exact eligible original and unused/unexpired claim atomically. Ownership is a sidecar; asker, provenance, payer, payment/reward receipts and saved bytes remain unchanged. " + gated + " Durable limits are 5 attempts/wallet/minute and 20/IP/minute before body/token parsing; counter failure refuses. Strict application/json body is at most 256 bytes with a 5-second read deadline. No query parameters or URL token. Never automatically retry consumption or repair lost/uncertain acknowledgements; no lookup/reissue/transfer path exists.",
    parameters: [expectedWallet(true), { name: "Origin", in: "header", required: true, schema: { type: "string", format: "uri" }, description: "Exact configured origin; never inferred from request URL/Host." }],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["token"], properties: {
      token: { type: "string", pattern: "^[a-f0-9]{64}$", minLength: 64, maxLength: 64, writeOnly: true, description: "Single-use caller credential. Wallet, origin, network and session selectors are forbidden in the body." },
    } } } } },
    responses: {
      "200": { description: "Private ownership-sidecar receipt; no token or rewritten original.", headers: privateHeaders, content: { "application/json": { schema: { $ref: "#/components/schemas/RunClaimReceipt" } } } },
      "400": failure("invalid_owner_precondition: malformed expected-wallet header."),
      "401": failure("Missing/revoked durable interactive session, including a session revoked before atomic consumption."),
      "403": failure("interactive_session_required or same_origin_required; bearer/payment proof never grants claim authority."),
      "404": failure("Uniform claim_unavailable for invalid/malformed body or token, query delivery, unknown/expired/used claim, ineligible/changed original; no existence oracle."),
      "409": failure("owner_changed: expected wallet differs; token is not consumed."),
      "428": failure("owner_precondition_required: missing expected-wallet header."),
      "429": { ...failure("claim_rate_limited before parsing/lookup. Retry-After describes the durable rate window, not permission to repair an uncertain consume."), headers: { ...privateHeaders, "Retry-After": { schema: { type: "integer", minimum: 1 } } } },
      "503": failure("claims_unavailable or unavailable durable session/counters; no research, financial mutation, schema repair or fallback."),
    },
  } },
  "/api/me/run-history": { get: {
    operationId: "readRunOwnershipHistory", tags: ["Account"], summary: "Page your recorded and claimed current-store research summaries",
    security: [{ WebSession: [] }, { ApiKeyAuth: [] }],
    description: historyDescription + " At most 50 rows/page (default 25), ordered descending by createdAt/id and deduped by original id. Cursor binds owner, configured network/origin and unchanged filters with an upper anchor excluding newer rows; this is not a transaction snapshot or whole-history aggregate. Unknown/duplicate parameters and reversed date bounds refuse. Search is literal case-sensitive text without NUL/wildcard semantics. No raw answer or credential is returned.",
    parameters: [expectedWallet(false),
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 25 } },
      { name: "cursor", in: "query", schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,1600}$", maxLength: 1600 }, description: "Opaque owner/network/origin/filter-bound cursor. No cursor reuse after owner, network or filter changes." },
      { name: "search", in: "query", schema: { type: "string", maxLength: 200 }, description: "Well-formed literal case-sensitive question substring without NUL; % and _ are literals." },
      { name: "surface", in: "query", schema: { type: "string", enum: [...RUN_SURFACES] } },
      { name: "funding", in: "query", schema: { type: "string", enum: ["browser-recorded", "other-or-unknown"] }, description: "Recorded askerFunded=true versus everything else; never claimant funding or independent settlement." },
      ...["from", "to"].map(name => ({ name, in: "query", schema: date, description: "Inclusive canonical UTC timestamp with milliseconds; from must not exceed to." })),
    ],
    responses: { "200": { description: "Bounded owner-private summary page and next cursor; no historical-network archive fallback.", headers: privateHeaders, content: { "application/json": { schema: { $ref: "#/components/schemas/RunOwnershipHistoryPage" } } } }, ...historyFailures },
  } },
  "/api/me/run-history/{id}": { get: {
    operationId: "readRunOwnershipOriginal", tags: ["Account"], summary: "Read your unchanged saved original and separate ownership attribution",
    security: [{ WebSession: [] }, { ApiKeyAuth: [] }], description: historyDescription + " No query parameters. The exact selected ordinary original is returned without appending claimant identity or recomputing financial data. Native/private job identifiers refuse; unavailable, altered claimed originals and other owners are not disclosed.",
    parameters: [expectedWallet(false), { name: "id", in: "path", required: true, schema: id }],
    responses: { "200": { description: "Owner-private unchanged original plus separate recorded/claimed ownership metadata.", headers: privateHeaders, content: { "application/json": { schema: { $ref: "#/components/schemas/RunOwnershipHistoryDetail" } } } },
      ...historyFailures, "404": failure("run_unavailable: no eligible unchanged original for this authenticated owner; no other-owner disclosure."),
    },
  } },
};

export const privateRunClaimOpenAiProperties = { keryx_private: { $ref: "#/components/schemas/PrivateRunClaimPacket" } };
export const privateRunClaimOpenAiDescription = " When default-off ordinary claims are explicitly admitted, a genuinely unowned direct caller may receive optional top-level keryx_private after actual persistence. Verified API-key owners and operational bot calls bypass preparation. The saved anonymous original remains unchanged; only a later interactive SIWE consume can attach private history. Admission fails before providers if enabled but unavailable. A late sidecar failure returns status=unavailable while preserving the completed answer and financial bytes. Keep the credential outside public keryx metadata, reports, logs, exports and telemetry; lost delivery has no lookup/reissue or automatic research retry. No payment or mainnet/native authority is created.";
export const privateRunClaimOpenAiStream = { schema: { type: "string",
  description: "SSE data frames contain RunClaimChatCompletionChunk JSON. The optional keryx_private packet is top-level on the terminal finish_reason=stop chunk, after persistence, followed by [DONE]. It is absent from ordinary answer/reasoning chunks and public keryx metadata. A caller-private handoff must wait for the successful saved completion and clean stream EOF; lost/uncertain delivery cannot be retried or reissued." },
  "x-keryx-event-schema": { $ref: "#/components/schemas/RunClaimChatCompletionChunk" },
};
