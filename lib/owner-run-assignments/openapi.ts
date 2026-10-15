/** Recipient-only contract. No owner/apply, API-key, payment or privacy writer. */
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, properties, required });
const id = { type: "string", format: "uuid" }, hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const time = { type: "integer", minimum: 0, maximum: 8_639_999_999_700_000 };
const revision = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 };
const recipient = object({ accountId: { type: "string", pattern: "^acct_[a-f0-9]{64}$" }, accountCreatedAt: time,
  wallet: { type: "string", pattern: "^0x[a-f0-9]{40}$", not: { const: `0x${"0".repeat(40)}` } }, memberGeneration: hash });
const expected = object({ assignmentId: id, revision });
const member = object({ assignmentId: id, runId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$", description: "prv_ and a2a_ prefixes refused" },
  originalSha256: hash, completedAt: { type: "string", format: "date-time", description: "Canonical millisecond ISO UTC" } });
const network = { type: "string", enum: ["eip155:5042", "eip155:5042002"] };
const manifest = object({ version: { const: 1 }, binding: object({ network, origin: { type: "string", maxLength: 2048, format: "uri",
  description: "Exact run-claim origin grammar: canonical HTTPS ASCII DNS or explicit HTTP(S) loopback; no credentials/path/query/fragment/IDNA/default-port aliases." }, storageDigest: hash }),
  recipient, basis: object({ code: { enum: ["early-run-recovery", "documented-recipient-request"] }, reference: { type: "string", pattern: "^[A-Za-z0-9_:/.-]{1,128}$" } }),
  scope: { const: "association-history-and-confirmation" }, admissionExpiresAt: time,
  members: { type: "array", minItems: 1, maxItems: 25, items: member, description: "Unique assignment IDs; strictly ascending unique exact run IDs. One selected store/network; no wildcard." } });
const input = { oneOf: [object({ action: { const: "consent" }, requestId: id, manifest,
  acknowledgeAssignedLabel: { const: true }, noFinancialAuthority: { const: true } }),
  object({ action: { enum: ["confirm", "reject", "withdraw"] }, requestId: id, expected }),
  object({ action: { const: "withdraw-consent" }, requestId: id, consentId: id, expected: { type: "array", maxItems: 25, items: expected,
    description: "Complete current nonterminal scope, in original manifest member order. Consent invalidation and removal audit are atomic." } })] };
const status = { enum: ["assigned-by-owner", "claimed", "rejected", "revoked"] };
const receipt = object({ version: { const: 1 }, requestId: id, inputDigest: hash,
  action: { enum: ["consent", "apply", "confirm", "reject", "withdraw", "withdraw-consent", "undo", "cleanup"] }, committedAt: time,
  results: { type: "array", maxItems: 25, items: object({ assignmentId: id, revision, status }) },
  meaning: { const: "historical-committed-result-not-current-authority" } });
const item = object({ assignmentId: id, revision, status, assignedAt: time, confirmedAt: { anyOf: [time, { type: "null" }] }, admissionExpiresAt: time,
  effective: { type: "boolean" }, runId: member.properties.runId, network,
  attribution: { enum: ["assigned-by-owner", "claimed-from-owner-assignment"] } },
  ["assignmentId", "revision", "status", "assignedAt", "confirmedAt", "admissionExpiresAt", "effective"]);
const inbox = object({ version: { const: 1 }, kind: { const: "owner-assignment-inbox" }, recipient,
  history: { type: "array", maxItems: 25, items: { ...item, description: "Only nonterminal rows. Suppressed rows omit runId, network and attribution; negative actions remain possible. Effective rows require all three." } },
  profile: object({ assignedByOwner: { type: "integer", minimum: 0, maximum: 25 }, claimedFromOwnerAssignment: { type: "integer", minimum: 0, maximum: 25 } }),
  receipt }, ["version", "kind", "recipient", "history", "profile"]);
const responseHeaders = { "Cache-Control": { schema: { const: "private, no-store" } }, "Referrer-Policy": { schema: { const: "no-referrer" } },
  "X-Robots-Tag": { schema: { const: "noindex, nofollow" } }, "X-Content-Type-Options": { schema: { const: "nosniff" } } };
const response = (description: string, schema: unknown) => ({ description, headers: responseHeaders, content: { "application/json": { schema } } });
const error = (description: string) => response(description, object({ error: { type: "string" } }));
const common = { "200": response("Current qualified inbox, separate profile attribution counts, optional historical receipt; no answer, private basis/proof, payer or publication authority.", inbox),
  "400": error("Query strings, malformed wallet, strict/oversized/slow JSON refused."), "401": error("Genuine durable cookie/account session required. Authorization presence is refused."),
  "403": error("Exact configured Origin required on POST and any supplied GET Origin; supplied Sec-Fetch-Site must be same-origin."),
  "409": error("Comparison-only recipient selector/revision conflict, changed same-ID operation, or terminal association."),
  "428": error("X-Keryx-Expected-Wallet required."), "503": error("Unsupported store, unavailable dependency, final authority change, or unresolved outcome. No fallback or replacement-ID retry.") };
const wallet = { in: "header", name: "X-Keryx-Expected-Wallet", required: true, schema: recipient.properties.wallet,
  description: "Compared to the genuine current session. Never selects identity." };
const description = "Cookie-only private recipient flow on genuine selected native storage. Current durable account/member/credential generation is checked under the transaction after waits. Final response is serialized by a synchronous recheck after the route's LAST await. GET with no Origin supports same-origin browser fetch; supplied Origin must match configured origin. No query selectors. Apply remains held for separately allocated shared occupancy; Supabase/ordinary/archive lack this port. Consent is bounded to exact originals for at most 24h admission, never financial/publication authority. Exact replay returns historical committed results without reapplying positive admission. Negative decisions remain reachable after consent expiry/suppression for the exact current recipient generation.";
export const ownerAssignmentOpenApiPaths = {
  "/api/me/run-assignments": {
    get: { tags: ["Account"], summary: "Read your assignment inbox and qualified attribution counts", description,
      security: [{ WebSession: [] }], parameters: [wallet], responses: common },
    post: { tags: ["Account"], summary: "Consent, confirm, reject or withdraw your exact assignment", description,
      security: [{ WebSession: [] }], parameters: [wallet, { in: "header", name: "Origin", required: true, schema: { type: "string", format: "uri" } }],
      requestBody: { required: true, description: "application/json, 16,384 streamed bytes, five-second deadline, fatal UTF-8, closed objects. Manifest itself <=16KiB; whole envelope must fit body bound.",
        content: { "application/json": { schema: object({ expected: recipient, input }) } } },
      responses: { ...common, "422": error("Original ineligible, unknown/mixed network evidence, expired/withdrawn positive consent. Reject/withdraw do not require positive consent.") } },
  },
};
