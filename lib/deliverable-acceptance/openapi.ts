const ownerPath = "/api/me/deliverables/{id}/acceptance";
const parameters = [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^a2a_[0-9a-f]{64}$" } },
  { name: "X-Keryx-Expected-Wallet", in: "header", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Required for session auth (428 absent,409 changed). Captured owner comparison only; never selects authority." }];
const responses = { "200": { description: "Exact-version current readback; historical remedy:none, responseWindow:null; reason owner-only; no executed revision/refund." },
  "400": { description: "Closed bounded input refused." }, "401": { description: "Absent, revoked or expired owner authentication." },
  "403": { description: "Explicit deliverable scope absent or session write Origin differs from configured deployment." },
  "409": { description: "Owner/original/delivery/revision/idempotency conflict; read current state." }, "428": { description: "Session owner precondition required." },
  "503": { description: "Unsupported original/store/migration; no fallback or mutation." } };
export const deliverableAcceptanceOpenApiPaths = {
  [ownerPath]: {
    get: { operationId: "readDeliverableAcceptance", tags: ["Account"], security: [{ SessionCookie: [] }, { ApiKeyAuth: [] }], parameters, responses,
      description: "Original verified payer of a settled ordinary prepaid A2A original only. Explicit deliverable:read for keys. No wallet/network/store selector. Body/delivery digests derive from trusted retained original; native/enrolled, Monthly, private v2 and browser-only originals unavailable. Private,no-store; Vary Authorization/Cookie." },
    post: { operationId: "submitDeliverableAcceptance", tags: ["Account"], security: [{ SessionCookie: [] }, { ApiKeyAuth: [] }], parameters, responses,
      description: "Append Accept/Request revision/Reject; active session or explicit deliverable:write rechecked under store transaction. Later choices supersede current state, retaining history; sharing consent can be withdrawn by a new choice. Exact replay returns current readback, not another append. Pending creator legs remain unchanged. No execution, payment, reservation renewal or refund; original remedy:none remains authoritative.",
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false,
        required: ["originalFingerprint", "deliveredDigest", "expectedRevision", "idempotencyKey", "choice"], properties: {
          originalFingerprint: { type: "string", pattern: "^[0-9a-f]{64}$" }, deliveredDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
          expectedRevision: { type: "integer", minimum: 0, maximum: 99 }, idempotencyKey: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" },
          choice: { type: "string", enum: ["accept", "revise", "reject"] }, reason: { type: "string", maxLength: 1000, default: "", description: "Private well-formed UTF-16, bounded controls; absent defaults empty." },
          publishState: { type: "boolean", default: false, description: "Share only current state/timestamp on public report." },
        } } } } },
    },
  },
  "/api/deliverables/{id}/acceptance": { get: { operationId: "readPublicDeliverableAcceptance", tags: ["Research"], parameters: parameters.slice(0, 1),
    description: "Consent-only state/timestamp for the current exact retained version. No owner, reason, digest, question or original payment reference. Missing/changed/unsupported original shares no state.", responses: { "200": { description: "Shared choice or not_shared." }, "503": { description: "Optional ordinary domain unavailable." } } } },
  "/api/deliverables/acceptance/metrics": { get: { operationId: "readPublicDeliverableChoiceCounts", tags: ["Research"],
    description: "Identifier-free counts of consented current ordinary prepaid A2A choices, at most1000 originals; overflow unavailable, never partial. Outside/team classification, whole paid/no-response denominator and acceptance rate are null/unmeasured. These are requests, not executed remedies, settled refunds, semantic assessments or unique humans.", responses: { "200": { description: "Bounded accepted/revisionRequested/rejected counts and explicit unmeasured nulls." }, "503": { description: "Domain or bounded whole observation unavailable." } } } },
};
