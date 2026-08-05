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
    version: "0.3.0",
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
          "Still requires `payment-signature` — key is identity + rate-limit only. Keys carry " +
          "scopes (`ask`, `export`); calling outside a key's scopes returns 403. Keys minted " +
          "before scopes existed carry all of them.",
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
          evidence: {
            type: "array",
            description:
              "Exact source spans that passed Keryx's deterministic evidence gate.",
            items: {
              type: "object",
              properties: {
                claimIndex: { type: "integer" },
                claim: { type: "string" },
                marker: { type: "string" },
                sourceName: { type: "string" },
                quote: { type: "string" },
                support: { type: "number" },
                qualifiesForReward: { type: "boolean" },
              },
            },
          },
          claimCoverage: {
            type: "array",
            description:
              "Final per-claim coverage bounded by validated evidence.",
            items: {
              type: "object",
              properties: {
                claimIndex: { type: "integer" },
                claim: { type: "string" },
                coverage: { type: "number" },
                coveredBy: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
          creatorsPaid: { type: "integer" },
          totalToCreators: { type: "number" },
          feePaid: { type: "number" },
          engine: { type: "string" },
        },
      },
      ChatCompletionRequest: {
        type: "object",
        required: ["messages"],
        properties: {
          model: { type: "string", example: "keryx" },
          messages: {
            type: "array",
            description: "OpenAI messages. Keryx researches the last user message.",
            items: {
              type: "object",
              properties: {
                role: { type: "string", example: "user" },
                content: { type: "string", example: "What is Arc?" },
              },
            },
          },
          stream: {
            type: "boolean",
            description: "When true, stream reasoning as `reasoning_content` deltas, then the answer.",
            example: false,
          },
          budget: {
            type: "number",
            description:
              "Keryx extension (extra_body): max USDC for creator payouts, clamped to the tier cap.",
            example: 0.05,
          },
        },
      },
      ChatCompletion: {
        type: "object",
        properties: {
          id: { type: "string", example: "chatcmpl-…" },
          object: { type: "string", example: "chat.completion" },
          model: { type: "string", example: "keryx" },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                message: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    content: { type: "string" },
                  },
                },
                finish_reason: { type: "string", example: "stop" },
              },
            },
          },
          keryx: {
            type: "object",
            description: "Vendor extension — the creators Keryx paid for this answer.",
            properties: {
              queryId: { type: "string" },
              creatorsPaid: { type: "integer" },
              totalToCreators: { type: "number" },
              dispatchUrl: { type: "string" },
              evidence: { type: "array", items: { type: "object" } },
              claimCoverage: {
                type: "array",
                items: { type: "object" },
              },
            },
          },
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
          scopes: {
            type: "array",
            items: { type: "string", enum: ["ask", "export"] },
            description: "Resolved scopes — a pre-scopes key reads back as all of them.",
          },
          sourceIds: {
            type: "array",
            items: { type: "string" },
            nullable: true,
            description: "Sources this key is pinned to; null means every source the wallet owns.",
          },
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
    "/api/v1/chat/completions": {
      post: {
        operationId: "chatCompletions",
        summary: "OpenAI-compatible research completion",
        description:
          "Drop-in OpenAI Chat Completions endpoint. Set base_url to https://keryx.cc/api/v1 and " +
          "model `keryx`. The free tier needs no key (treasury-funded, IP rate-limited); a " +
          "`kx_live_…` Bearer key raises limits and meters usage. Keryx researches the last user " +
          "message over paid sources and pays every cited creator downstream in USDC on Arc. With " +
          "`stream:true`, live reasoning streams as `reasoning_content` deltas. This path is NOT " +
          "x402 — no payment-signature required.",
        security: [{}, { ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ChatCompletionRequest" } },
          },
        },
        responses: {
          "200": {
            description:
              "ChatCompletion object, or an SSE stream of chat.completion.chunk when stream=true.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ChatCompletion" } },
            },
          },
          "400": {
            description: "No user message with content.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "401": {
            description: "A kx_live_ key was supplied but is invalid or revoked.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate limit exceeded (free tier by IP, keyed tier by key).",
            headers: {
              "Retry-After": {
                description: "Seconds until the rate limit window resets.",
                schema: { type: "integer" },
              },
            },
          },
          "500": { description: "Treasury wallet not configured." },
        },
      },
    },
    "/api/v1/models": {
      get: {
        operationId: "listModels",
        summary: "OpenAI-compatible model list",
        description:
          "Lists the single logical model `keryx`. Some OpenAI clients probe this on connect.",
        responses: { "200": { description: "OpenAI model list." } },
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
                properties: {
                  label: { type: "string", description: "Optional nickname." },
                  scopes: {
                    type: "array",
                    items: { type: "string", enum: ["ask", "export"] },
                    description:
                      "Operations this key may perform. `ask` runs dispatches; `export` reads " +
                      "the wallet's earnings ledger. Omitted or empty mints a full-power key.",
                  },
                  sourceIds: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Pin the key to specific sources (export only). Omitted means every " +
                      "source the wallet owns. Always intersected with live ownership, so a " +
                      "pin can never widen access.",
                  },
                },
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
    "/api/creator/export": {
      get: {
        operationId: "exportOwnEarnings",
        summary: "Audit export: every payout across the sources your wallet owns",
        description:
          "One ledger for the whole portfolio — CSV for a spreadsheet, JSON for a script. Each " +
          "row carries the source, the question that triggered the payout, the amount in USDC, " +
          "the citation weight, settlement state and a link back to the dispatch. Authenticate " +
          "with a wallet-issued key (or a SIWE session in the browser); the file is private to " +
          "that wallet. Sources deactivated on-chain are included — retiring a feed does not " +
          "erase what it earned. `settlement_ref` is Circle's settlement id, NOT an EVM tx hash: " +
          "it does not resolve at the block explorer.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            in: "query",
            name: "format",
            required: false,
            schema: { type: "string", enum: ["csv", "json"], default: "csv" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100000, default: 10000 },
            description: "Max payouts, newest first. Larger values are clamped.",
          },
        ],
        responses: {
          "200": { description: "Ledger as text/csv or application/json." },
          "401": { description: "No SIWE session and no valid API key." },
          "404": { description: "The authenticated wallet owns no sources." },
          "429": { description: "Rate limited (per wallet)." },
        },
      },
    },
    "/api/creator/{id}/export": {
      get: {
        operationId: "exportCreatorEarnings",
        summary: "Public payout ledger for one source",
        description:
          "The same ledger scoped to a single source, and public — a source's payouts are " +
          "already visible on its creator page and on-chain. No auth.",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
          {
            in: "query",
            name: "format",
            required: false,
            schema: { type: "string", enum: ["csv", "json"], default: "csv" },
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 50000, default: 5000 },
          },
        ],
        responses: {
          "200": { description: "Ledger as text/csv or application/json." },
          "404": { description: "Creator not found." },
        },
      },
    },
    "/api/wanted": {
      get: {
        operationId: "getDemandBoard",
        summary: "Claims paid dispatches left uncovered (demand board)",
        description:
          "Sub-claims that real paid dispatches finished below the coverage threshold — demand " +
          "the corpus could not serve, each carrying the dispatch id that proves it. Identical " +
          "claims across dispatches collapse to one entry with `seen`. Public, no auth. Runs " +
          "that recorded no coverage assessment are skipped entirely rather than counted as gaps, " +
          "and Keryx's own retries of a failed question never add to `seen`. `filled` carries " +
          "claims a later dispatch went on to cover. `offers` exposes durable creator-offer status; " +
          "`filled` offer status requires both evidence-qualified coverage and real settlement.",
        parameters: [
          {
            in: "query",
            name: "limit",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          "200": {
            description:
              "{ windowRuns, gaps: [{ id, claim, coverage, seen, queryId, question, createdAt }], " +
              "filled: [...], offers: [{ id, gapId, sourceId, sourceItemLink, status, attempts, " +
              "retryRunId?, coverage?, rewardUsdc?, createdAt, updatedAt }] }",
          },
          "503": { description: "Demand board temporarily unavailable." },
        },
      },
    },
    "/api/creator/{id}/performance": {
      get: {
        operationId: "getCreatorPerformance",
        summary: "How the agent judged one source (decision feedback)",
        description:
          "Aggregates the agent's own buy/cache/skip decisions for one source across the recent " +
          "dispatch window: how often it was weighed, chosen, cited and passed, the median " +
          "expected value on each side of the choice, the median listed price of the sources " +
          "chosen in the runs that passed on it, and the most recent skip rationales verbatim. " +
          "Public — every underlying decision trace is already published on its dispatch " +
          "permalink. `performance` is null when the window never weighed the source.",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "{ sourceId, name, windowRuns, performance }" },
          "404": { description: "Source not found." },
        },
      },
    },
    "/api/offers": {
      get: {
        operationId: "listArticleMarket",
        summary: "List payable article versions and creator-signed offers",
        description:
          "Public article offer book built only from free preview metadata. Every row includes " +
          "the exact item/content version, registry list price, effective x402 price, and paidPath. " +
          "A discounted row also carries the creator's EIP-712 signature and JSON-safe typed data " +
          "so another agent can verify it independently. Paid content is never returned here.",
        parameters: [
          { in: "query", name: "q", required: false, schema: { type: "string" } },
          { in: "query", name: "limit", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: {
          "200": { description: "{ offers: ArticleMarketEntry[], count }" },
        },
      },
    },
    "/api/creator/{id}/offers": {
      get: {
        operationId: "getCreatorArticleOffers",
        summary: "Owner view of article pricing and current offers",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Pricing authority, article identities, and current offers." }, "401": { description: "SIWE session required." }, "403": { description: "Only the registry creator may price articles." } },
      },
      post: {
        operationId: "publishArticleOffer",
        summary: "Publish a creator-signed, version-bound article discount",
        description:
          "Requires the live SIWE wallet to equal SourceRegistry.creator. The EIP-712 price is " +
          "integer micro-USDC, cannot exceed the live registry ceiling, expires within 30 days, " +
          "and is reverified before every 402 challenge.",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Offer published." }, "400": { description: "Invalid price, expiry, nonce, or signature." }, "409": { description: "Article version changed or source cannot earn." } },
      },
      delete: {
        operationId: "revokeArticleOffer",
        summary: "Revoke the current offer for one article",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { itemId: { type: "string" } }, required: ["itemId"] } } } },
        responses: { "200": { description: "Offer revoked; registry list price applies." } },
      },
    },
    "/api/sources": {
      get: {
        operationId: "listSources",
        summary: "Public source catalog (optionally cursor-paginated)",
        description:
          "Lists every active registered source: name, tags, fetch price, payout wallet, " +
          "author split, on-chain registration. No auth. Without `limit` the response is the " +
          "COMPLETE catalog (in-app payment allowlists depend on that). Pass `limit` to page: " +
          "the response then carries `total` and, while more rows remain, `nextCursor` to feed " +
          "back as `cursor`. Ordering is stable (registration time, then id).",
        parameters: [
          {
            in: "query",
            name: "limit",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100 },
            description: "Page size 1..100 (larger values are clamped). Omit for the full list.",
          },
          {
            in: "query",
            name: "cursor",
            required: false,
            schema: { type: "string" },
            description: "Opaque `nextCursor` from the previous page.",
          },
        ],
        responses: {
          "200": {
            description:
              "Source list. Paginated form: { sources, total, nextCursor? }; full form: { sources }.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sources: { type: "array", items: { type: "object" } },
                    total: {
                      type: "integer",
                      description: "Total active sources (paginated form only).",
                    },
                    nextCursor: {
                      type: "string",
                      description: "Present while more pages remain (paginated form only).",
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Non-positive `limit`, or a malformed `cursor`.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
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
