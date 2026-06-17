/**
 * Hand-written OpenAPI 3.1 spec for the Keryx public API surface.
 *
 * x402 is not an IANA-registered security scheme, so it is documented as
 * an apiKey-in-header with prose explaining the 402 challenge flow.
 * This is the standard workaround until x402 standardizes an OpenAPI extension.
 */

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Keryx API",
    version: "0.2.0",
    description:
      "Citation-toll autonomous research. POST a question + budget — Keryx buys paid sources via x402, " +
      "answers with citations, and settles weighted nanopayments to every cited creator in USDC on Arc. " +
      "\n\n**Authentication:** Two modes — \n" +
      "1. **x402-only:** attach a valid `payment-signature` header (x402 v2 format). No key needed.\n" +
      "2. **Key + x402:** mint an API key at `/api/keys` (SIWE wallet required), then attach both " +
      "`Authorization: Bearer kx_live_…` and `payment-signature`. Key adds identity, rate-limit, " +
      "and usage metering — it does NOT waive the payment requirement. No free compute.",
    contact: { url: "https://keryx.cc" },
    license: { name: "MIT" },
  },
  servers: [{ url: "https://keryx.cc", description: "Production (Arc testnet)" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Wallet-issued API key (`kx_live_…`). Mint at `/api/keys` after SIWE sign-in. " +
          "Still requires `payment-signature` — key is identity + rate-limit only.",
      },
      X402Payment: {
        type: "apiKey",
        in: "header",
        name: "payment-signature",
        description:
          "Base64-encoded x402 v2 payment signature. Required for all `/api/agent/ask` calls. " +
          "When omitted or invalid, server returns 402 with a `PAYMENT-REQUIRED` header " +
          "containing the base64-encoded JSON challenge (amount, asset, payTo, network, scheme).",
      },
    },
    schemas: {
      AskRequest: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "Research question.", example: "What is Arc?" },
          budget: {
            type: "number",
            description: "Max USDC budget for creator payouts (default 0.05).",
            example: 0.05,
          },
        },
      },
      AskResponse: {
        type: "object",
        properties: {
          queryId: { type: "string" },
          answer: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                weight: { type: "number" },
                reward: { type: "number" },
              },
            },
          },
          creatorsPaid: { type: "integer" },
          totalToCreators: { type: "number" },
          feePaid: { type: "number" },
          engine: { type: "string" },
        },
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "string" },
          prefix: { type: "string", example: "kx_live_a3f2b1" },
          label: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          revokedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
  paths: {
    "/api/agent/ask": {
      post: {
        operationId: "agentAsk",
        summary: "Run autonomous research (x402 pay-per-call)",
        description:
          "Keryx answers a research question, buys the paid sources worth reading, " +
          "and settles weighted citation nanopayments to creators in USDC on Arc. " +
          "The caller pays `config.a2aFeeUsdc` (default 0.02 USDC) to the treasury via x402. " +
          "Creators are paid downstream from the budget.",
        security: [{ X402Payment: [] }, { ApiKeyAuth: [], X402Payment: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AskRequest" } } },
        },
        responses: {
          "200": {
            description: "Research answer with citations and payment summary.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AskResponse" } },
            },
          },
          "400": {
            description: "Missing or empty question.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "401": {
            description: "Invalid or revoked API key.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "402": {
            description:
              "Payment required. Response body is empty. " +
              "`PAYMENT-REQUIRED` header contains base64-encoded JSON with payment requirements " +
              "(amount, asset, payTo address, network, scheme).",
            headers: {
              "PAYMENT-REQUIRED": {
                description: "Base64-encoded x402 v2 payment challenge JSON.",
                schema: { type: "string", format: "base64" },
              },
            },
          },
          "429": {
            description: "Rate limit exceeded (key-authed callers only).",
            headers: {
              "Retry-After": {
                description: "Seconds until the rate limit window resets.",
                schema: { type: "integer" },
              },
            },
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "500": {
            description: "Internal error (treasury wallet not configured).",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/keys": {
      get: {
        operationId: "listApiKeys",
        summary: "List API keys for the signed-in wallet",
        description: "Returns all keys (active and revoked) for the SIWE-authenticated wallet.",
        security: [{ ApiKeyAuth: [] }],
        responses: {
          "200": {
            description: "Array of API key records.",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } },
              },
            },
          },
          "401": { description: "No SIWE session." },
        },
      },
      post: {
        operationId: "mintApiKey",
        summary: "Mint a new API key",
        description:
          "Creates a new key scoped to the SIWE-authenticated wallet. " +
          "The raw `kx_live_…` value is returned ONCE in the response — it is never stored " +
          "and cannot be retrieved again. Revoke immediately if compromised.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { label: { type: "string", description: "Optional nickname." } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Newly minted key. `rawKey` shown once — copy it now.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    rawKey: { type: "string", example: "kx_live_a3f2b1c4…" },
                    prefix: { type: "string" },
                    id: { type: "string" },
                  },
                },
              },
            },
          },
          "401": { description: "No SIWE session." },
        },
      },
    },
    "/api/keys/{id}": {
      delete: {
        operationId: "revokeApiKey",
        summary: "Revoke an API key",
        description: "Soft-deletes the key (sets revoked_at). Only the issuing wallet can revoke.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Key revoked." },
          "401": { description: "No SIWE session or key not owned by caller." },
          "404": { description: "Key not found." },
        },
      },
    },
    "/api/openapi.json": {
      get: {
        operationId: "getOpenApiSpec",
        summary: "OpenAPI 3.1 spec (this document)",
        responses: {
          "200": { description: "OpenAPI JSON spec." },
        },
      },
    },
  },
} as const;
