/** Static supported contract; authority and validation remain in topic-watch-service.ts. */
const integer = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const id = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength,
  description: "Trimmed; no Unicode Cc/Cf characters." });
const terms = (maxItems: number, maxLength: number, minItems = 0) => ({ type: "array", minItems, maxItems,
  items: text(maxLength), description: "Distinct after NFKC/lowercase/whitespace folding." });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: "object", additionalProperties: false, required, properties });
const spec = object({ watchId: id, question: text(2000), keywords: terms(8, 80, 1),
  authors: { ...terms(4, 300), default: [] }, venues: { ...terms(4, 300), default: [] },
  cadenceMs: { ...integer, minimum: 60_000, maximum: 604_800_000 },
  periodMs: { ...integer, minimum: 60_000, maximum: 2_592_000_000 },
  maximumChecksPerPeriod: { ...integer, minimum: 1, maximum: 128 },
  maximumRowsPerCheck: { ...integer, minimum: 1, maximum: 32 },
  maximumDigestItems: { ...integer, minimum: 1, maximum: 16 }, expiresAtMs: integer,
  requestedCaps: object({ perCheckMicroUsdc: { ...integer, maximum: 1_000_000_000 },
    perPeriodMicroUsdc: { ...integer, maximum: 1_000_000_000 } }),
  consent: object({ manualMetadata: { type: "boolean", const: true }, emptyHeartbeat: { type: "boolean" } }),
}, ["watchId", "question", "keywords", "cadenceMs", "periodMs", "maximumChecksPerPeriod",
  "maximumRowsPerCheck", "maximumDigestItems", "expiresAtMs", "requestedCaps", "consent"]);
const specInput = { ...spec, description: "Strict JSON. periodMs >= cadenceMs; perCheck cap <= perPeriod cap. Both caps must be zero at this API (nonzero valid input returns 422). Creation expiry must be future and within 30 days; update preserves watchId and expiry within 30 days of original creation. Authors/venues default to []. Settings lock after the first admitted slot." };
const terminalStatuses = ["completed", "unchanged", "failed", "interrupted", "limited"];
const reasons = ["metadata-unavailable", "invalid-metadata", "conflicting-metadata", "watermark-full", "digest-full",
  "completion-window-elapsed", "paused", "cancelled", "expired", "aborted", "period-cap"];
const check = object({ kind: { const: "check" }, checkId: hash, slot: integer, periodIndex: integer,
  claimedAtMs: integer, deadlineAtMs: integer, status: { type: "string", enum: ["pending", ...terminalStatuses] },
  reason: { type: "string", enum: reasons }, finishedAtMs: integer,
  observedRows: { ...integer, maximum: 32 }, unknownRows: { ...integer, maximum: 32 }, newMatches: { ...integer, maximum: 16 },
}, ["kind", "checkId", "slot", "periodIndex", "claimedAtMs", "deadlineAtMs", "status"]);
const state = { ...object({ version: { const: 1 }, scope: { const: "metadata-only" },
  key: object({ ownerWallet: { type: "string", pattern: "^0x[0-9a-f]{40}$" }, watchId: id }),
  revision: { ...integer, minimum: 1 }, incarnation: hash, createdAtMs: integer, spec,
  status: { type: "string", enum: ["active", "paused", "cancelled"] }, nextSlot: integer,
  period: object({ index: integer, attempts: { ...integer, maximum: 128 } }),
  history: { type: "array", maxItems: 128, items: { oneOf: [check, object({ kind: { const: "missed" },
    fromSlot: integer, toSlot: integer, detectedAtMs: integer })] } },
  watermark: { type: "array", maxItems: 256, items: object({ identitySha256: hash, metadataSha256: hash }) },
}), description: "Exact validated owner-private state, not a public projection. Hashes identify metadata/state; no cookie, JWT, session selector, key or raw paper body. Full cross-field state invariants: lib/research/topic-watches.ts. Cancellation retains this state and history." };
const result = object({ status: { type: "string", enum: ["created", "controlled", ...terminalStatuses,
  "already-recorded", "missed", "overlap", "refused", "conflict"] }, code: { type: "string" },
  checkId: hash, recordedStatus: { type: "string", enum: terminalStatuses },
  missed: object({ fromSlot: integer, toSlot: integer, count: integer }),
  counts: object({ observedRows: integer, unknownRows: integer, newMatches: integer }), watermarkSha256: hash,
  digest: object({ scope: { const: "metadata-only" }, line: { type: "string" }, items: { type: "array", maxItems: 16,
    items: object({ identitySha256: hash, metadataSha256: hash, title: { type: "string" }, titleTruncated: { type: "boolean" },
      url: { type: "string" }, matchReasons: { type: "array", items: object({ field: { type: "string", enum: ["title", "author", "venue"] }, term: { type: "string" } }) } }) } }),
  paidRequests: { type: "integer", const: 0 }, standingSpend: { type: "string", const: "withheld" },
}, ["status", "paidRequests", "standingSpend"]);
const resultWith = (statuses: string[], codes?: string[]) => ({ ...result, properties: { ...result.properties,
  status: { type: "string", enum: statuses }, ...(codes ? { code: { type: "string", enum: codes } } : {}) } });
const responseHeaders = {
  "Cache-Control": { schema: { const: "private, no-store" } }, "Referrer-Policy": { schema: { const: "no-referrer" } },
  "X-Robots-Tag": { schema: { const: "noindex, nofollow" } }, "X-Content-Type-Options": { schema: { const: "nosniff" } },
};
const response = (description: string, schema: unknown) => ({ description, headers: responseHeaders,
  content: { "application/json": { schema } } });
const error = (description: string, values: string[]) => response(description, object({ error: { type: "string", enum: values } }));
const errors = {
  "400": error("Query string, invalid id/wallet, malformed/oversized/slow JSON or strict input refused.", ["invalid_watch", "invalid_owner_precondition", "invalid_watch_action"]),
  "401": error("Authorization header forbidden; durable cookie session required.", ["session_required", "Sign in to access your account."]),
  "403": error("Exact configured Origin required on writes and whenever Origin is supplied on reads; Sec-Fetch-Site must be absent or same-origin.", ["same_origin_required"]),
  "409": response("Expected owner changed, stale revision/CAS conflict, existing watch or overlapping check.", { oneOf: [object({ error: { const: "watch_owner_changed" } }), object({ result: resultWith(["conflict", "overlap"]) })] }),
  "428": error("Expected wallet missing; item mutation also requires a quoted positive safe-integer If-Match revision.", ["owner_precondition_required", "revision_precondition_required"]),
  "503": response("Session/storage unavailable or changed across await; dependency/owner refusal. No fallback or private result release.", { oneOf: [object({ error: { type: "string", enum: ["watch_unavailable", "Session management is unavailable. Please retry."] } }), object({ result: resultWith(["refused"], ["dependency-unavailable", "owner-unavailable"]) })] }),
};
const owner = { in: "header", name: "X-Keryx-Expected-Wallet", required: true,
  schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Compared lowercase to captured session wallet; a precondition, never identity authority." };
const origin = { in: "header", name: "Origin", required: true, schema: { type: "string", format: "uri" } };
const revision = { in: "header", name: "If-Match", required: true, schema: { type: "string", pattern: '^"([1-9]\\d{0,15})"$' },
  description: "Positive safe integer <= Number.MAX_SAFE_INTEGER, in double quotes. Not an ETag response; obtain revision from read/list. No wildcard or weak validator." };
const pathId = { in: "path", name: "id", required: true, schema: id };
const description = "Manual local-curated-catalog metadata only; no scheduler, catch-up, live provider, model, paid requests or payment authority. No query parameters accepted (including token/owner selectors). Existing WebSession cookie is verified by accountSessionContext; exact selected DB, wallet and session remain fixed across awaits and native transactional CAS. API keys/Authorization cannot substitute. GET without Origin is allowed; supplied Origin is checked. No ETag or Vary header is emitted by this factory. Digests are lexical matches, not factual support or literature completeness.";
const body = (schema: unknown) => ({ required: true, description: "application/json; maximum 16,384 streamed bytes, five-second body deadline, fatal UTF-8 and strict JSON parsing.", content: { "application/json": { schema } } });
const invalidInput = error("Query string, invalid id/wallet, malformed/oversized/slow JSON or strict spec refused.", ["invalid_watch", "invalid_owner_precondition"]);
const semanticRefusal = object({ result: resultWith(["refused"]) });
const readErrors = { "400": invalidInput, "401": errors["401"], "403": errors["403"],
  "409": error("Expected session owner changed.", ["watch_owner_changed"]),
  "428": error("Expected owner precondition required.", ["owner_precondition_required"]),
  "503": error("Session or selected storage unavailable/changed.", ["watch_unavailable", "Session management is unavailable. Please retry."]) };
const mutationResponses = { "200": response("Controlled or manual check result; failed/interrupted/limited/already-recorded outcomes can be HTTP 200.", object({ result: resultWith(["controlled", ...terminalStatuses, "already-recorded", "missed"]) })),
  "404": response("No watch in captured owner namespace.", object({ result: resultWith(["refused"], ["not-found"]) })),
  "422": response("Semantic refusal (expiry, cancelled, settings-locked, history-full and other domain bounds).", semanticRefusal), ...errors };
const specRefusal = response("Nonzero caps withheld or semantic refusal.", { oneOf: [object({ error: { const: "standing_spend_withheld" } }), semanticRefusal] });
export const topicWatchOpenApiPaths = {
  "/api/me/topic-watches": {
    get: { operationId: "listOwnTopicWatches", summary: "List private manual metadata watches", security: [{ WebSession: [] }], description,
      parameters: [owner], responses: { "200": response("At most 32 owner-private watches, including cancelled tombstones.", object({ watches: { type: "array", maxItems: 32, items: state }, metadataSource: { const: "local-curated-catalog" }, spendMicroUsdc: { const: 0 } })), ...readErrors } },
    post: { operationId: "createOwnTopicWatch", summary: "Create a zero-spend manual watch", security: [{ WebSession: [] }], description,
      parameters: [owner, origin], requestBody: body(specInput), responses: {
        "201": response("Created revision 1; read/list returns the state.", object({ result: resultWith(["created"]) })),
        "400": invalidInput, "401": errors["401"], "403": errors["403"],
        "409": response("Expected owner changed or key already exists/CAS refused.", { oneOf: [object({ error: { const: "watch_owner_changed" } }), object({ result: resultWith(["conflict"]) })] }),
        "422": specRefusal, "428": readErrors["428"], "503": errors["503"],
      } },
  },
  "/api/me/topic-watches/{id}": {
    get: { operationId: "readOwnTopicWatch", summary: "Read one private manual watch", security: [{ WebSession: [] }], description,
      parameters: [owner, pathId], responses: { "200": response("Validated owner-private state.", object({ watch: state })), "404": error("No owned watch.", ["watch_not_found"]), ...readErrors } },
    put: { operationId: "updateOwnTopicWatch", summary: "Replace unchecked watch settings", security: [{ WebSession: [] }], description,
      parameters: [owner, pathId, origin, revision], requestBody: body(specInput), responses: { ...mutationResponses, "400": invalidInput,
        "200": response("Unchecked settings updated.", object({ result: resultWith(["controlled"]) })), "422": specRefusal } },
    post: { operationId: "controlOwnTopicWatch", summary: "Explicit check, pause, resume or cancel", security: [{ WebSession: [] }], description,
      parameters: [owner, pathId, origin, revision], requestBody: body(object({ action: { type: "string", enum: ["check", "pause", "resume", "cancel"] } })), responses: mutationResponses },
    delete: { operationId: "cancelOwnTopicWatch", summary: "Cancel while retaining tombstone and history", security: [{ WebSession: [] }], description: description + " No request body is read; this never deletes or recreates the key.",
      parameters: [owner, pathId, origin, revision], responses: { ...mutationResponses, "400": invalidInput,
        "200": response("Cancelled or already cancelled; retained tombstone.", object({ result: resultWith(["controlled"]) })) } },
  },
};
