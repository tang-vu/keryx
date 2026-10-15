// Data only: no runtime authority, storage, signer or header factory imports.
const token = { type: "string", pattern: "^[a-f0-9]{64}$", writeOnly: true };
const accountId = { type: "string", pattern: "^acct_[a-f0-9]{64}$" };
const revision = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const time = { type: "integer", minimum: 0, maximum: 8_639_999_999_700_000 };
const platform = { type: "string", enum: ["telegram", "slack", "discord"] };
const recipient = { oneOf: [
  { type: "object", additionalProperties: false, required: ["platform", "scope", "userId", "channel"], properties: {
    platform: { type: "string", const: "telegram" }, scope: { type: "string", const: "telegram" },
    userId: { type: "string", pattern: "^[1-9]\\d{0,15}$" }, channel: { type: "string", pattern: "^-?[1-9]\\d{0,15}$" },
  } },
  { type: "object", additionalProperties: false, required: ["platform", "scope", "userId", "channel"], properties: {
    platform: { type: "string", const: "slack" }, scope: { type: "string", pattern: "^T[A-Z0-9]{1,63}$" },
    userId: { type: "string", pattern: "^U[A-Z0-9]{1,63}$" }, channel: { type: "string", pattern: "^[CDG][A-Z0-9]{1,63}$" },
  } },
  { type: "object", additionalProperties: false, required: ["platform", "scope", "userId", "channel"], properties: {
    platform: { type: "string", const: "discord" }, scope: { type: "string", pattern: "^[1-9]\\d{0,19}$" },
    userId: { type: "string", pattern: "^[1-9]\\d{0,19}$" }, channel: { type: "string", pattern: "^[1-9]\\d{0,19}$" },
  } },
] };
const account = { type: "object", additionalProperties: false, required: ["accountId", "revision"], properties: { accountId, revision } };
const unavailablePast = { type: "object", additionalProperties: false, required: ["status"], properties: { status: { type: "string", const: "unavailable" } } };
const consentProof = { type: "string", pattern: "^[0-9]{1,16}\\.[a-f0-9]{64}$",
  description: "Private opaque HMAC precondition returned by preview; expiry plus MAC, not a session selector or login credential." };
const failures = {
  "400": { description: "invalid_chat_request (path/query/fragment, abort or invalid preview/unlink shape); invalid_chat_consent (invalid completion shape). Unknown object properties are refused." },
  "401": { description: "interactive_session_required for any Authorization header or unmatched durable row; session context may instead return Sign in to access your account." },
  "403": { description: "same_origin_required: POST needs exact configured Origin and absent or same-origin Sec-Fetch-Site; GET validates Origin when present." },
  "409": { description: "explicit_account_membership_required; chat_account_changed (account/revision, proof or current lineage); chat_takeover_refused; chat_past_runs_unavailable for a nonempty historical list." },
  "410": { description: "chat_token_invalid: missing, expired, consumed or wrong-realm pending token. Uniform refusal without token/recipient lookup details." },
  "503": { description: "chat_unavailable for unknown exceptions, missing capability, native refusal or weak/missing HMAC secret; chat_invalid_command for non-JSON content type, missing body or body above 4096 UTF-8 bytes. Malformed JSON/UTF-8 also maps to chat_unavailable. Session context may return Session management is unavailable. Please retry." },
};
const authority = "Interactive keryx_session cookie from SIWE or verified Circle Google login only. Any Authorization header is refused; API keys are not eligible. Exact durable web-session hash/wallet and current explicit account membership are required in the configured origin/network realm. No query parameters or URL fragments, wallet selector, provider or CLI credential. X-Keryx-Expected-Wallet is not enforced by these routes; accountId/revision and session-bound consent are the actual comparisons. Responses are private, no-store/no-cache and no-referrer; no token, session hash, wallet or member/credential generation is returned. Unknown failures are static and do not reflect exceptions. ";
const mutation = { name: "Origin", in: "header", required: true, schema: { type: "string" }, description: "Exact configured origin, never caller-selected realm authority." };
const previewBody = { type: "object", additionalProperties: false, required: ["action", "token"], properties: { action: { type: "string", const: "preview" }, token } };
const unlinkBody = { type: "object", additionalProperties: false, required: ["action", "recipient", "accountId", "revision"], properties: {
  action: { type: "string", const: "unlink" }, recipient, accountId: { type: "string" }, revision: { type: "integer" },
} };
const previewResponse = { type: "object", additionalProperties: false, required: ["recipient", "expiresAt", "consentProof", "account", "pastRuns"],
  properties: { recipient, expiresAt: time, consentProof, account, pastRuns: unavailablePast } };

export const chatAccountOpenApiPaths = {
  "/api/me/chat-accounts": {
    get: { operationId: "listPrivateChatAccounts", tags: ["Account"], security: [{ WebSession: [] }], summary: "List current private account chat links",
      description: authority + "GET resolves current membership before listing at most 32 links. Only account ID/revision and platform/scope/userId/channel/linkedAt are projected. Historical runs remain unavailable; no inferred provenance.",
      responses: { "200": { description: "Current account and private link projection; pastRuns includes a fixed unavailable reason.", content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["account", "links", "pastRuns"], properties: { account,
          links: { type: "array", maxItems: 32, items: { type: "object", additionalProperties: false, required: ["platform", "scope", "userId", "channel", "linkedAt"],
            properties: { platform, scope: { type: "string", minLength: 1, maxLength: 128 }, userId: { type: "string", minLength: 1, maxLength: 128 }, channel: { type: "string", minLength: 1, maxLength: 128 }, linkedAt: time } } },
          pastRuns: { type: "object", additionalProperties: false, required: ["status", "reason"], properties: { status: { type: "string", const: "unavailable" }, reason: { type: "string", const: "No verified retained chat-user provenance exists for historical runs." } } },
        },
      } } } }, ...failures },
    },
    post: { operationId: "previewOrUnlinkPrivateChatAccount", tags: ["Account"], security: [{ WebSession: [] }], parameters: [mutation], summary: "Preview a private link or unlink it",
      description: authority + "Same-origin application/json body, at most 4096 UTF-8 bytes. action:preview validates the five-minute purpose/origin/network-bound token, rechecks current membership and returns the private recipient, expiry and opaque HMAC consent proof without consuming. action:unlink compares accountId/revision and rechecks exact durable session/member/credential lineage inside the native transaction, removes the account's link and invalidates pending tokens. Another account's link is refused. No DELETE route is exported. Unlink does not select or link a wallet.",
      requestBody: { required: true, content: { "application/json": { schema: { oneOf: [previewBody, unlinkBody] } } } },
      responses: { "200": { description: "Preview projection or unlinked:true; no credential echoed.", content: { "application/json": { schema: { oneOf: [previewResponse,
        { type: "object", additionalProperties: false, required: ["unlinked"], properties: { unlinked: { type: "boolean", const: true } } },
      ] } } } }, ...failures },
    },
  },
  "/api/me/chat-accounts/complete": {
    post: { operationId: "completePrivateChatAccountLink", tags: ["Account"], security: [{ WebSession: [] }], parameters: [mutation], summary: "Explicitly consent to a one-time private chat link",
      description: authority + "Same-origin application/json body, at most 4096 UTF-8 bytes. Explicit version-1 consent and empty pastRunIds required. Compare accountId/revision and recompute purpose-separated HMAC against token digest, expiry, exact session hash/wallet/times, member/credential generations and origin/network. Expiry must be future and within five minutes; secret rotation or another session requires fresh preview. Native BEGIN IMMEDIATE rechecks fresh durable session and current member proof after body await, consumes once and refuses takeover without transfer. Token replay/expiry refuses uniformly; historical attachment remains unavailable. The consent field financialAuthorityUnchanged is an acknowledgement, not wallet or payment inheritance.",
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false,
        required: ["token", "consentProof", "accountId", "revision", "consent", "pastRunIds"], properties: {
          token, consentProof, accountId, revision,
          consent: { type: "object", additionalProperties: false, required: ["version", "linkFutureRuns", "financialAuthorityUnchanged"], properties: {
            version: { type: "integer", const: 1 }, linkFutureRuns: { type: "boolean", const: true }, financialAuthorityUnchanged: { type: "boolean", const: true },
          } }, pastRunIds: { type: "array", maxItems: 0, items: { type: "string" } },
        },
      } } } },
      responses: { "200": { description: "linked:true and platform only; historical attachment unavailable.", content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["linked", "platform", "pastRuns"], properties: { linked: { type: "boolean", const: true }, platform, pastRuns: unavailablePast },
      } } } }, ...failures },
    },
  },
};
