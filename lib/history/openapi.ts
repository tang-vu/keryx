import { RUN_SURFACES } from "../research/run-provenance";
export const personalHistoryOpenApiPaths = { "/api/me/history": { get: {
  operationId: "readPersonalHistory", tags: ["Account"], summary: "Page your attributed current-store dispatch summaries",
  security: [{ SessionCookie: [] }, { ApiKeyAuth: [] }],
  description: "Active SIWE or a verified key with explicit history:read. Bearer presence never falls back to cookies. No owner/network selectors, raw answers, private fulfillment, archived or linked-wallet history. Recorded amounts are not independently verified settlement, service prices or payer attribution. storeNetwork labels the selected deployment only. Cursor binds owner, store network and filters; descending createdAt/id keyset and an upper anchor exclude newer rows, without a transaction snapshot or backdated-insert guarantee. No-store; unsupported/enrolled ports and unapplied ordinary RPC return unavailable. Legacy /api/me/asks and SIWE testnet archive remain unchanged.",
  parameters: [
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 25 } },
    { name: "cursor", in: "query", schema: { type: "string", maxLength: 1600 }, description: "Opaque cursor from the same owner, store and filters." },
    { name: "search", in: "query", schema: { type: "string", maxLength: 200 }, description: "Literal case-sensitive question substring; % and _ have no wildcard semantics." },
    { name: "surface", in: "query", schema: { type: "string", enum: RUN_SURFACES }, description: "Closed recorded provenance; missing/malformed metadata is unknown, never inferred from origin/client." },
    { name: "funding", in: "query", schema: { type: "string", enum: ["browser-recorded", "other-or-unknown"] }, description: "Exact askerFunded=true record versus everything else. Does not classify sponsored/free/paid service." },
    ...["from", "to"].map(name => ({ name, in: "query", schema: { type: "string", format: "date-time" }, description: "Inclusive UTC timestamp with milliseconds." })),
    { name: "X-Keryx-Expected-Wallet", in: "header", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Comparison-only owner precondition; never selects authority." },
  ], responses: { "200": { description: "version, wallet, scope, storeNetwork, bounded rows and nextCursor; no whole-history aggregate. Rows link by safe id to the existing public dispatch/receipt endpoints." },
    "400": { description: "Invalid, duplicate, unknown or oversized filters/cursor; owner/store/filter cursor mismatch." }, "401": { description: "Absent/revoked authentication." },
    "403": { description: "Explicit history:read absent." }, "409": { description: "history_owner_changed; no other owner's rows." }, "503": { description: "history_unavailable; no adapter/archive fallback." } },
} } };
