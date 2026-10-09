const owner = { in: "header", name: "X-Keryx-Expected-Wallet", required: true, schema: { type: "string", pattern: "^0x[0-9a-f]{40}$" }, description: "Precondition matched to the current SIWE owner; never an identity selector." };
const uuid = { type: "string", format: "uuid" };
const errors = { "400": { description: "Closed input or period refused" }, "401": { description: "Current SIWE session required; bearer keys cannot read verdicts" },
  "409": { description: "Owner/intent changed, expired gate, or missing original live continuation" }, "428": { description: "Expected owner precondition required" }, "503": { description: "Ordinary storage capability unavailable; sealed/native mode remains closed" } };
export const decisionReviewOpenApiPaths = {
  "/api/me/decision-reviews": {
    get: { operationId: "readOwnDecisionReviews", summary: "Read captured private decision sidecars for one owned run", security: [{ WebSession: [] }],
      description: "New web captures only; originals/receipts are unchanged and historical absence is unavailable. Responses are private no-store and vary on Cookie/expected wallet. Full strict record contract: lib/research/decision-review-types.ts.",
      parameters: [owner, { in: "query", name: "runId", required: true, schema: uuid }],
      responses: { "200": { description: "At most 300 current owner rows, including immutable initial model/code/terms and current code/verdict/state; no other owner's rows" }, ...errors } },
    post: { operationId: "recordOwnDecisionVerdict", summary: "Agree or Disagree with one captured decision", security: [{ WebSession: [] }],
      description: "Requires exact configured Origin and optional same-origin Sec-Fetch-Site. Gate context requires the original same-session live browser continuation and votes on immutable initial code/terms. Agree admits one expiring read through existing payment controls, never signs/spends by itself. Opinion requires expectedCode equal to the displayed current action/rule; stale snapshots atomically refuse and carry no refund/restart authority. Exact owner/key/intent retries return the CURRENT record even after code changes; conflicting reuse refuses. Each verdict retains its actual code basis. Reasons are private, not public aggregate fields.",
      parameters: [owner, { in: "header", name: "Origin", required: true, schema: { type: "string", format: "uri" } }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["id", "key", "context", "value"],
        properties: { id: uuid, key: uuid, context: { type: "string", enum: ["gate", "opinion"] }, value: { type: "string", enum: ["agree", "disagree"] }, reason: { type: "string", maxLength: 1000 },
          expectedCode: { type: "object", additionalProperties: false, required: ["action", "rule"], description: "Required for opinion; forbidden for gate.", properties: { action: { type: "string", enum: ["BUY", "SKIP", "CACHE"] }, rule: { type: "string", description: "Strict rule enum from the shared record contract." } } } } } } } },
      responses: { "200": { description: "Current owner record readback after exact-intent idempotent verdict" }, "404": { description: "No owned decision with that ID" }, ...errors } },
  },
  "/api/decision-reviews/metrics": { get: { operationId: "readDecisionReviewCounts", summary: "Read public whole-period decision counts on the configured network", security: [],
    description: "Complete UTC days, start included/end excluded, maximum 366 days, end not future. Latest recorded verdict per decision: gate votes refer to initial code/terms, later opinions to the displayed code snapshot when voted. Later code changes never rewrite a verdict's basis. Immutable intent history is private. Four ordered cohorts outside/team/scripted/unknown; no inferred outside people, unique humans, usefulness or settlement. Zero verdicts have null agreement rate. Holds/declines/expiry are not code refusals. No IDs, wallets, questions, names or reasons.",
    parameters: ["since", "until"].map(name => ({ in: "query", name, required: true, schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T00:00:00\\.000Z$" } })),
    responses: { "200": { description: "captured-owner-decisions-v1 counts/rates, machine differences and partial refusal counts" }, "400": errors["400"], "503": errors["503"] } } },
};
