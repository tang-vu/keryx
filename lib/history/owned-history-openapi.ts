import { RUN_SURFACES } from "../research/run-provenance";
const filters = [
  { name: "contract", in: "query", schema: { type: "string", enum: ["owned"] }, description: "Explicit v2 selection. OFF otherwise preserves the prior session ledger; active privacy defaults to v2. Keys never fall back." },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 25 } },
  { name: "cursor", in: "query", schema: { type: "string", maxLength: 3000 }, description: "Bound to current verified authority, membership revision, origin/network and filters; not a transaction snapshot." },
  { name: "search", in: "query", schema: { type: "string", maxLength: 200 }, description: "Literal case-sensitive question substring, including % and _." },
  { name: "surface", in: "query", schema: { type: "string", enum: RUN_SURFACES } },
  { name: "network", in: "query", schema: { type: "string", enum: ["eip155:5042", "eip155:5042002", "unknown"] }, description: "Recorded receipt networks only; does not select archives or infer settlement network from this deployment." },
  { name: "funding", in: "query", schema: { type: "string", enum: ["paid", "sponsored", "mixed", "unknown"] }, description: "Confirmed recorded receipt payer cohorts, not price/budget/allocation or a promise of free service; simulated, pending and missing evidence stay unknown." },
  { name: "visibility", in: "query", schema: { type: "string", enum: ["private", "unlisted", "public"] } },
  ...["from", "to"].map(name => ({ name, in: "query", schema: { type: "string", format: "date-time" }, description: "Inclusive canonical UTC timestamp with milliseconds." })),
];
const auth = [{ WebSession: [] }, { ApiKeyAuth: [] }];
const responses = { "200": { description: "Owner-private v2 contract; missing membership/claims and bounded continuations are explicit." },
  "400": { description: "Invalid/duplicate query, owner selector or cursor binding." }, "401": { description: "Absent/revoked authentication; no bearer-to-cookie fallback." },
  "403": { description: "Explicit history:read absent." }, "409": { description: "Verified owner precondition changed." }, "503": { description: "Privacy/storage/membership capability unavailable; no fallback." } };
export const ownedHistoryOpenApiPaths = {
  "/api/me/asks": { get: { operationId: "readOwnedHistory", tags: ["Account"], summary: "Your owned current-store history across recorded surfaces",
    security: auth, parameters: filters, responses,
    description: "Same v2 contract as history_owned_read. At most 8 current proven member wallets, 51 candidates per wallet and 50 scanned per page, 50 returned rows and 1.5 MB row payload. Empty filtered pages can have nextCursor. Stored claim proof is reused without assigning a financial payer. Missing membership stays wallet-only. Legacy SIWE recent ledger is explicitly view=recent; network=arcTestnet is the separately qualified legacy archive." } },
  "/api/me/asks/export": { get: { operationId: "exportOwnedHistory", tags: ["Account"], summary: "Bounded whole-history JSON or CSV attempt", security: auth,
    parameters: [...filters, { name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"], default: "json" } }], responses,
    description: "At most 20 pages/1000 rows/2 MiB of row JSON. complete/truncated/nextCursor describe admitted current-store metadata only, not all archives, absent membership/claims, report bodies or a snapshot. CSV always has a metadata row and neutralizes spreadsheet formulas; JSON question bytes stay unchanged." } },
  "/api/me/asks/{id}": { get: { operationId: "readOwnedHistoryDetail", tags: ["Account"], summary: "Owner-authorized report, receipts or reference export", security: auth,
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" } },
      { name: "format", in: "query", schema: { type: "string", enum: ["report", "receipts", "bibtex", "ris", "csl-json"], default: "report" } }],
    responses: { ...responses, "404": { description: "Absent, erased or not currently owned; no public read fallback." } },
    description: "Report is the unchanged stored owner record. Receipt projection excludes private journal/authorization fields and is explicitly truncated at 200. Reference exports reuse the existing serializer and omission metadata. Mutation remains the existing interactive-session privacy contract, never API-key authority." } },
};
