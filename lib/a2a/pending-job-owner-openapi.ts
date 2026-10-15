import { paidJobEscalationOpenApiProperty } from "./overdue-openapi";

export const pendingJobOwnerHeader = {
  in: "header", name: "X-Keryx-Account-Job", required: false,
  schema: { type: "string", enum: ["associate"] },
  description: "Optional association of a newly admitted original with the current signed account session. When present, requires this exact value, a payment-signature, an active same-origin keryx_session cookie and Origin; Authorization is refused. Selected enrolled mainnet SQLite owner admission must be available. The account may differ from the verified payer: ownership never changes payer, payment terms or spending authority. Existing originals cannot acquire an association by replay. An unsigned opt-in refuses admission; ordinary unsigned requests without this header retain their normal 402 challenge.",
};
export const pendingJobOwnerDescription = " Optional X-Keryx-Account-Job: associate binds only a new original to the independently verified same-origin account cookie. It requires the original payment signature and refuses Authorization; a key, payer string or client name cannot mint account ownership. The durable session is checked again before settlement and during atomic original creation. This grants no payment, recovery or retry authority; retain the original authorization and record on ambiguity.";

const jobProperties = {
  id: { type: "string", pattern: "^a2a_[a-f0-9]{64}$" },
  question: { type: ["string", "null"], description: "Null when the selected native projection does not read the private worker request." },
  status: { type: "string", enum: ["queued", "processing", "review_required", "completed", "failed"] },
  createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
  mode: { type: "string", enum: ["quick", "deep"] },
  packagePriceUsdc: { type: ["number", "null"], minimum: 0 },
  escalation: paidJobEscalationOpenApiProperty,
  originalPayment: { type: "object", additionalProperties: false,
    required: ["kind", "reference", "network", "asset", "amountMicros"], properties: {
      kind: { type: "string", enum: ["inbound_payment", "monthly_allocation"] },
      reference: { type: ["string", "null"], maxLength: 256, pattern: "^[A-Za-z0-9:_-]{1,256}$" },
      network: { type: ["string", "null"], enum: ["eip155:5042", "eip155:5042002", null] },
      asset: { type: "string", const: "USDC" }, amountMicros: { type: ["string", "null"], pattern: "^[0-9]+$" },
    } },
  funding: { type: "string", enum: ["research-monthly-prepaid"] },
};
const jobRequired = ["id", "question", "status", "createdAt", "updatedAt", "mode", "packagePriceUsdc", "escalation", "originalPayment"];
export const pendingJobOwnerOpenApiSchemas = {
  AccountJobHistoryItem: { type: "object", additionalProperties: false, required: jobRequired, properties: jobProperties },
  AuthenticatedOriginalJobHistoryItem: { type: "object", additionalProperties: false,
    required: [...jobRequired, "attention", "recoveryState"], properties: { ...jobProperties,
      attention: { type: "string", enum: ["needs_review", "unknown"] },
      recoveryState: { type: "string", enum: ["held", "unknown"] },
    } },
};
export const pendingJobOwnerOpenApiPaths = {
  "/api/me/jobs": { get: {
    operationId: "readAccountJobs", tags: ["Account"], summary: "Read the current account's original job history",
    security: [{ WebSession: [] }],
    description: "Requires an active signed account cookie; an API key alone is not authentication. Fixed 25-row pages use a 26-row lookahead ordered by createdAt then id descending. Cursor is the existing base64url createdAt/id pair, not a snapshot. The default view retains the verified wallet's existing payer history whether or not the native owner port exists. Only pending=owned selects immutable authenticated-original associations; that explicit branch never falls back to payer history on failure and requires the native port and includes attention/recovery metadata, even for retained completed or failed originals: pending is a view selector, not a status filter. id only selects within pending=owned. Missing selected-store/session capability refuses rather than reading another owner's rows. No raw worker request, payment nonce, signed authorization or raw receipt is returned. GET observes records only: it does not reconcile, refund, rerun, pay or clear a hold.",
    parameters: [
      { in: "query", name: "cursor", required: false, schema: { type: "string", maxLength: 300, pattern: "^[A-Za-z0-9_-]{1,300}$" }, description: "Pass the previous nextCursor unchanged. Invalid cursor returns 400." },
      { in: "query", name: "pending", required: false, schema: { type: "string", enum: ["owned"] }, description: "Exact selector for authenticated-original attention/recovery metadata; not a new ownership grant." },
      { in: "query", name: "id", required: false, schema: { type: "string", pattern: "^a2a_[a-f0-9]{64}$" }, description: "Optional exact original within pending=owned; ignored by the default view. Malformed selected id refuses with 503." },
    ],
    responses: {
      "200": { description: "Owner-private retained job metadata, with optional native authenticated-original view qualifiers.",
        content: { "application/json": { schema: { type: "object", additionalProperties: false,
          required: ["wallet", "jobs", "nextCursor"], properties: {
            wallet: { type: "string", pattern: "^0x[a-f0-9]{40}$" },
            jobs: { type: "array", maxItems: 25, items: { oneOf: [
              { $ref: "#/components/schemas/AccountJobHistoryItem" },
              { $ref: "#/components/schemas/AuthenticatedOriginalJobHistoryItem" },
            ] } },
            nextCursor: { type: ["string", "null"], maxLength: 300 },
            ownership: { type: "string", const: "authenticated_original", description: "Present only for pending=owned." },
            recoveryState: { type: "string", const: "unknown", description: "View-level qualifier only; individual rows can report a retained hold." },
          } } } } },
      "400": { description: "Invalid history cursor." },
      "401": { description: "Absent, expired or revoked account session." },
      "503": { description: "History, selected native owner port or its current session proof unavailable; no payer fallback for the native branch and no automatic retry." },
    },
  } },
};
