/**
 * Hand-written OpenAPI 3.1 spec for the Keryx public API surface.
 *
 * x402 is not an IANA-registered security scheme, so it is documented as
 * an apiKey-in-header with prose explaining the 402 challenge flow.
 * This is the standard workaround until x402 standardizes an OpenAPI extension.
 */

import { config } from "./config";
import { paperOpenApiPaths, paperOpenApiSchemas } from "./papers/openapi";
import { operatorStatusOpenApiPath } from "./business-operator/openapi";
import { monthlyOpenApiPath } from "./monthly/openapi";
import { RUN_SURFACES, RUN_OWNERSHIP_METHODS } from "./research/run-provenance";

import { privateProfileOpenApiPaths } from "./profiles/openapi";
import { evidenceDraftOpenApiPath } from "./research/evidence-draft-openapi";
import { personalHistoryOpenApiPaths } from "./history/openapi";
import { API_KEY_SCOPES } from "./api-key-scopes";
import { sourceClaimOpenApiPaths, sourceClaimOpenApiSchemas, sourceClaimFinancialQueryParameters } from "./sources/public-source-claim-openapi";
import {
  A2A_RESEARCH_PACKAGE_VERSION,
  supportedA2aPackageVersions,
} from "./a2a/research-package";

const runProvenanceProperty = { provenance: { type: "object", additionalProperties: false,
  description: "Optional closed server-recorded ingress/proof metadata for new runs. Absent historical metadata is unknown; no wallet, client telemetry or payment authority is exported here.",
  required: ["version", "surface", "ownershipMethod"], properties: { version: { type: "integer", const: 1 },
    surface: { type: "string", enum: [...RUN_SURFACES] },
    ownershipMethod: { type: "string", enum: [...RUN_OWNERSHIP_METHODS] } } } };

const outputLimitMetadataProperties = {
  outputLimits: {
    type: "array", maxItems: 2304,
    description: "Optional explicit model response stops from validated attempt/synthesis trace metadata; absence is unknown. Diagnostic kinds are not a supplier-call count. No retry or payment authority.",
    items: { type: "object", additionalProperties: false, required: ["step", "outputTokenLimit"], properties: {
      step: { type: "string", enum: ["decompose", "decide", "sufficiency", "reevaluate", "synthesize", "attribute"] },
      stage: { type: "string", enum: ["generation", "review", "synthesis"], description: "Present only for synthesis subcall diagnostics." },
      outputTokenLimit: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    } },
  },
  outputLimitTraceStepsOmitted: { type: "integer", minimum: 1, description: "Earlier trace steps outside the bounded diagnostic scan; not a count of output-limit events." },
};

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Keryx API",
    version: "0.27.0",
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
  servers: [{ url: "https://keryx.cc", description: "Production (Arc mainnet; verify /api/health for active mode)" }],
  components: {
    securitySchemes: {
      WebSession: {
        type: "apiKey", in: "cookie", name: "keryx_session",
        description: "Revocable SIWE web session. Creator claim writes also require exact same-origin Origin header; API keys and research payment signatures cannot manage claims.",
      },
      ApiKeyAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Wallet-issued API key (`kx_live_…`). Mint at `/api/keys` after SIWE sign-in. " +
          "Still requires `payment-signature` — key is identity + rate-limit only. Keys carry " +
          "scopes (`ask`, `export`, explicit `profile:read`/`profile:write`/`history:read`); calling outside a key's scopes returns 403. " +
          "Historical/default keys retain ask/export and never gain private-profile or history rights. These scoped read/profile operations require no payment signature.",
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
      ...paperOpenApiSchemas,
      ...sourceClaimOpenApiSchemas,
      ReferenceExport: {
        type: "object", required: ["content", "count", "omitted"],
        properties: { content: { type: "string" }, count: { type: "integer", minimum: 0 }, omitted: { type: "integer", minimum: 0 } },
      },
      ResearchExports: {
        type: "object", description: "Derived recorded citation exports. No enrichment, payment authority or replacement of saved receipt bytes. CSL-JSON content is a JSON array with stable exact article/version keys.",
        properties: { bibtex: { $ref: "#/components/schemas/ReferenceExport" }, ris: { $ref: "#/components/schemas/ReferenceExport" },
          cslJson: { $ref: "#/components/schemas/ReferenceExport" }, evidenceCsv: { type: "string" } },
      },
      DashboardGroundingStatus: {
        type: "object",
        required: ["groundedClaimRate", "evidenceQuality"],
        properties: {
          groundedClaimRate: { type: "null", description: "Aggregate factual grounding is unavailable until provenance-aware historical reassessment. This is separate from per-run A2A quality." },
          evidenceQuality: {
            type: "object",
            required: ["status", "basis", "explanation"],
            properties: {
              status: { type: "string", const: "unavailable" },
              basis: { type: "string", const: "recorded-unreassessed" },
              explanation: { type: "string", description: "Stored historical counters have not been reassessed against current source provenance." },
            },
          },
        },
      },
      A2aResearchPackage: {
        type: "object",
        required: ["schema", "id", "version", "researchMode", "execution", "serviceLevel", "quality"],
        properties: {
          schema: { type: "string", const: "urn:keryx:a2a-research-package:1" },
          id: { type: "string", enum: ["keryx-quick", "keryx-deep"] },
          version: { type: "string", enum: supportedA2aPackageVersions() },
          researchMode: { type: "string", enum: ["quick", "deep"] },
          execution: {
            type: "object",
            required: ["attentionLimit", "reevaluateRounds"],
            properties: {
              attentionLimit: { type: "integer" },
              reevaluateRounds: { type: "integer" },
            },
          },
          serviceLevel: {
            type: "object",
            required: ["kind", "targetCompletionMs", "startsAt", "remedy"],
            properties: {
              kind: { type: "string", const: "provisional_slo" },
              targetCompletionMs: { type: "integer" },
              startsAt: { type: "string", const: "accepted_at" },
              remedy: { type: "string", const: "none" },
            },
          },
          quality: {
            type: "object",
            required: ["measurement", "groundingThreshold", "commitment"],
            properties: {
              measurement: { type: "string", const: "evidence-ledger-v1" },
              groundingThreshold: { type: "number", const: 0.4 },
              commitment: { type: "string", const: "best_effort" },
            },
          },
        },
      },
      A2aServiceStatus: {
        type: "object",
        required: [
          "packageId",
          "packageVersion",
          "state",
          "acceptedAt",
          "startedAt",
          "targetCompletionAt",
          "targetCompletionMs",
          "elapsedMs",
          "targetBreached",
          "objectiveKind",
          "remedy",
        ],
        properties: {
          packageId: { type: "string", enum: ["keryx-quick", "keryx-deep"] },
          packageVersion: { type: "string", enum: supportedA2aPackageVersions() },
          state: { type: "string", enum: ["queued", "processing", "review_required"] },
          acceptedAt: { type: "string", format: "date-time" },
          startedAt: { type: ["string", "null"], format: "date-time" },
          targetCompletionAt: { type: "string", format: "date-time" },
          targetCompletionMs: { type: "integer" },
          elapsedMs: { type: "integer" },
          targetBreached: { type: "boolean" },
          objectiveKind: { type: "string", const: "provisional_slo" },
          remedy: { type: "string", const: "none" },
        },
      },
      A2aServiceReceipt: {
        type: "object",
        required: [
          "packageId",
          "packageVersion",
          "outcome",
          "acceptedAt",
          "startedAt",
          "finishedAt",
          "queueDurationMs",
          "executionDurationMs",
          "totalDurationMs",
          "targetCompletionMs",
          "targetMet",
          "objectiveKind",
          "remedy",
        ],
        properties: {
          packageId: { type: "string", enum: ["keryx-quick", "keryx-deep"] },
          packageVersion: { type: "string", enum: supportedA2aPackageVersions() },
          outcome: { type: "string", enum: ["completed", "failed"] },
          acceptedAt: { type: "string", format: "date-time" },
          startedAt: { type: ["string", "null"], format: "date-time" },
          finishedAt: { type: "string", format: "date-time" },
          queueDurationMs: { type: ["integer", "null"] },
          executionDurationMs: { type: ["integer", "null"] },
          totalDurationMs: { type: "integer" },
          targetCompletionMs: { type: "integer" },
          targetMet: { type: "boolean" },
          objectiveKind: { type: "string", const: "provisional_slo" },
          remedy: { type: "string", const: "none" },
          quality: {
            type: "object",
            properties: {
              measurement: { type: "string", const: "evidence-ledger-v1" },
              groundingThreshold: { type: "number", const: 0.4 },
              status: { type: "string", enum: ["measured", "unavailable"] },
              claimCount: { type: "integer" },
              measuredClaims: { type: "integer" },
              groundedClaims: { type: "integer" },
              groundedClaimRate: { type: ["number", "null"] },
              qualifyingEvidence: { type: "integer" },
              rewardedCitations: { type: "integer", description: "Creator citations with positive planned allocation; not a settled creator count." },
              confidence: { type: ["object", "null"] },
            },
          },
          portableReceiptUrl: { type: "string" },
        },
      },
      AskRequest: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "Research question.", example: "What is Arc?" },
          budget: {
            type: "number",
            minimum: 0.000001,
            maximum: config.a2aMaxBudget,
            description: "Prepaid creator-spend cap in USDC (default 0.05).",
            example: 0.05,
          },
          researchMode: {
            type: "string",
            enum: ["quick", "deep"],
            default: "deep",
          },
          packageVersion: {
            type: "string",
            enum: supportedA2aPackageVersions(),
            default: A2A_RESEARCH_PACKAGE_VERSION,
            description:
              "Optional version pin for the immutable execution contract; unsupported versions fail before payment.",
          },
          responseMode: {
            type: "string",
            enum: ["wait", "async"],
            default: "wait",
            description:
              "Mainnet always returns a durable 202 original job, including wait; poll its returned URL without paying again. Testnet also supports request-local wait or async with Prefer: respond-async.",
          },
        },
      },
      A2aPendingResponse: {
        type: "object",
        required: ["status", "queryId", "pollUrl"],
        properties: {
          status: {
            type: "string",
            enum: ["queued", "processing", "review_required"],
          },
          queryId: { type: "string", pattern: "^a2a_[a-f0-9]{64}$" },
          pollUrl: { type: "string" },
          researchPackage: { $ref: "#/components/schemas/A2aResearchPackage" },
          serviceStatus: { $ref: "#/components/schemas/A2aServiceStatus" },
          message: { type: "string" },
        },
      },
      A2aFailedResponse: {
        type: "object",
        required: ["status", "queryId", "error", "pricing", "creatorPayments"],
        properties: {
          status: { type: "string", enum: ["failed"] },
          queryId: { type: "string", pattern: "^a2a_[a-f0-9]{64}$" },
          error: { type: "string" },
          researchPackage: { $ref: "#/components/schemas/A2aResearchPackage" },
          serviceReceipt: { $ref: "#/components/schemas/A2aServiceReceipt" },
          pricing: { type: "object" },
          creatorPayments: {
            type: "object",
            properties: {
              attempts: { type: "integer" },
              failedUsdc: { type: "number" },
              simulatedUsdc: { type: "number" },
              accountingComplete: { type: "boolean" },
            },
          },
          resolution: {
            type: "object",
            description:
              "Sanitized evidence-bound terminal resolution. Private question, wallets, transaction, and worker identity are never returned.",
          },
        },
      },
      AskResponse: {
        type: "object",
        properties: {
          ...outputLimitMetadataProperties,
          ...runProvenanceProperty,
          queryId: { type: "string" },
          status: { type: "string", enum: ["completed"] },
          researchPackage: { $ref: "#/components/schemas/A2aResearchPackage" },
          serviceReceipt: { $ref: "#/components/schemas/A2aServiceReceipt" },
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
          creatorsPaid: { type: ["integer", "null"], description: "Distinct settled creators; null when unavailable. Citation allocations are not settlement evidence." },
          totalToCreators: { type: "number" },
          feePaid: { type: "number" },
          totalPricePaid: { type: "number" },
          researchExports: { $ref: "#/components/schemas/ResearchExports" },
          pricing: {
            type: "object",
            properties: {
              policy: { type: "string", example: "a2a-fixed-package-v2" },
              researchMode: { type: "string", enum: ["quick", "deep"] },
              serviceFeeUsdc: { type: "number" },
              creatorBudgetUsdc: { type: "number" },
              settledCreatorSpendUsdc: { type: "number" },
              pendingCreatorSpendUsdc: { type: "number" },
              unusedCreatorReserveUsdc: { type: "number" },
              refundable: { type: "boolean", enum: [false] },
            },
          },
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
          scholarly: { type: "boolean", default: false, description: "Opt into bounded Crossref/arXiv discovery; sends the public question to those providers." },
          mode: { type: "string", enum: ["quick", "deep"], default: "deep" },
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
            description: "Vendor extension with recorded citations, planned allocations and classified payment metadata.",
            properties: {
              queryId: { type: "string" },
              creatorsPaid: { type: ["integer", "null"], description: "Distinct settled creators; null when unavailable. Citation allocations are not settlement evidence." },
              totalToCreators: { type: "number" },
              dispatchUrl: { type: "string" },
              researchExports: { $ref: "#/components/schemas/ResearchExports" },
              evidence: { type: "array", items: { type: "object" } },
              ...outputLimitMetadataProperties,
              ...runProvenanceProperty,
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
            items: { type: "string", enum: API_KEY_SCOPES },
            description: "Resolved scopes. Historical/default keys retain only ask/export; private profile and history rights require explicit selection.",
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
      DispatchFreshness: {
        type: "object",
        properties: {
          queryId: { type: "string" },
          settledAt: { type: "string", format: "date-time" },
          checkedAt: { type: "string", format: "date-time" },
          freshness: {
            type: "object",
            properties: {
              citedCount: { type: "integer" },
              watchedCount: { type: "integer" },
              newItems: { type: "integer" },
              versionedCitations: { type: "integer" },
              currentVersions: { type: "integer" },
              supersededVersions: { type: "integer" },
              unavailableVersions: { type: "integer" },
              unavailableSourceChecks: { type: "integer" },
              publicationCheck: {
                type: "string",
                enum: ["complete", "unavailable", "not_applicable"],
              },
              versions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    marker: { type: "string" },
                    sourceId: { type: "string" },
                    sourceName: { type: "string" },
                    itemId: { type: "string" },
                    itemTitle: { type: "string" },
                    citedVersion: { type: "string" },
                    currentVersion: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["current", "superseded", "unavailable"],
                    },
                  },
                },
              },
            },
          },
          limits: { type: "array", items: { type: "string" } },
        },
      },
      ResearchReceipt: {
        type: "object",
        required: ["payload", "integrity"],
        properties: {
          payload: {
            type: "object",
            required: ["schema", "dispatch", "agency", "claims", "citations", "settlement", "limits"],
            properties: {
              schema: { type: "string", const: "urn:keryx:research-receipt:1" },
              dispatch: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  question: { type: "string" },
                  answer: { type: "string" },
                  answerSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
                  createdAt: { type: "string", format: "date-time" },
                  budgetUsdc: { type: "number" },
                  researchMode: { type: "string", enum: ["quick", "deep"] },
                  engine: { type: "string" },
                  confidence: { type: ["object", "null"] },
                },
              },
              agency: {
                type: "object",
                properties: {
                  decisions: {
                    type: "array",
                    description: "Visible BUY/SKIP/CACHE decisions; never payment authority.",
                    items: { type: "object" },
                  },
                },
              },
              claims: {
                type: "array",
                description: "Decomposed claims with evidence-bounded coverage and exact public excerpts.",
                items: { type: "object" },
              },
              citations: {
                type: "array",
                description: "Exact cited assets and planned reward weights. Actual money is in settlement.",
                items: { type: "object" },
              },
              settlement: {
                type: "object",
                description:
                  "Sanitized outbound-payment snapshot. Creator rewards and Keryx operating fees are separate. Only Circle-evidenced rows enter settled totals; " +
                  "payer and authorization correlation data are omitted.",
                properties: {
                  mode: { type: "string", enum: ["real", "offline", "legacy"] },
                  status: {
                    type: "string",
                    enum: ["settled", "pending", "failed", "mixed", "none", "offline", "incomplete"],
                  },
                  ledgerCompleteness: {
                    type: "string",
                    enum: ["complete", "incomplete", "legacy", "not_applicable"],
                  },
                  settledCreatorUsdc: { type: "number" },
                  settledAccessUsdc: { type: "number" },
                  settledCitationUsdc: { type: "number" },
                  pendingCreatorUsdc: { type: "number" },
                  failedCreatorUsdc: { type: "number" },
                  simulatedCreatorUsdc: { type: "number" },
                  creatorPayments: { type: "array", items: { type: "object" } },
                  operatingPayments: { type: "array", description: "Keryx operating fees, separate from creator rewards. Absent in historical receipts.", items: { type: "object" } },
                  settledOperatingFeeUsdc: { type: "number" },
                  pendingOperatingFeeUsdc: { type: "number" },
                  failedOperatingFeeUsdc: { type: "number" },
                  simulatedOperatingFeeUsdc: { type: "number" },
                },
              },
              limits: { type: "array", items: { type: "string" } },
            },
          },
          integrity: {
            type: "object",
            required: ["algorithm", "canonicalization", "scope", "digest"],
            properties: {
              algorithm: { type: "string", const: "sha256" },
              canonicalization: { type: "string", const: "keryx-json-v1" },
              scope: { type: "string", const: "payload" },
              digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
            },
          },
        },
      },
    },
  },
  paths: {
    ...evidenceDraftOpenApiPath,
    ...privateProfileOpenApiPaths,
    ...personalHistoryOpenApiPaths,
    ...paperOpenApiPaths,
    ...sourceClaimOpenApiPaths,
    "/api/source/{id}": {
      get: {
        operationId: "readRegisteredSource", summary: "Read an eligible registered source bundle",
        description: "Fresh registry supplies creator and read toll. Claim-managed sources require current opt-in policy and fresh control. Eligible zero-price reads return creator-free content without x402 or access-settlement receipt; free bundles are limited to five articles and 1 MiB. Paid requests bind expected claim id/revision before settlement. Public reference IDs retain their separate free discovery path.",
        parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }, ...sourceClaimFinancialQueryParameters],
        responses: {
          "200": { description: "Source content and read provenance; zero-price response includes access=creator-free and current sourceClaim snapshot when managed." },
          "402": { description: "Registered positive toll requires payment-signature; exact managed claim selectors must accompany the original authorization." },
          "409": { description: "Expected policy differs; rediscover explicitly before a new payment." },
          "410": { description: "Inactive/unverified source, public reference, or owner policy does not enable access at current price." },
          "413": { description: "Free bundle exceeds its article/byte limit; use article reads." },
          "503": { description: "Current claim/registry authority or exact free content unavailable." },
        },
      },
    },
    "/api/source/{id}/item/{itemId}": {
      get: {
        operationId: "readRegisteredArticle", summary: "Read an exact registered article version",
        description: "Captures exact content version, valid creator offer and managed policy. Zero-price registered reads need no x402 access signature. A changed version, offer, ceiling or claim revision declines payment; cached public/free identity never becomes retroactively payable.",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
          { in: "path", name: "itemId", required: true, schema: { type: "string" } },
          { in: "query", name: "version", required: true, schema: { type: "string" }, description: "Exact discovered contentVersion." },
          { in: "query", name: "offer", required: false, schema: { type: "string" }, description: "Exact signed discount offer id." },
          { in: "query", name: "listPriceUsdc6", required: false, schema: { type: "string", pattern: "^[0-9]+$" }, description: "Required with offer; integer micro-USDC live registry ceiling." },
          ...sourceClaimFinancialQueryParameters,
        ],
        responses: {
          "200": { description: "Exact content, item identity and pricing; creator-free managed identity includes sourceClaim receipt snapshot." },
          "402": { description: "Positive exact article price requires payment-signature." },
          "404": { description: "Source or item not found." },
          "409": { description: "Content version, offer, price or managed policy changed." },
          "410": { description: "Source or owner policy ineligible for current access." },
          "503": { description: "Current authority or exact free content unavailable." },
        },
      },
    },
    "/api/cite/{id}": {
      post: {
        operationId: "settleCreatorCitation", summary: "Authorize a bounded citation reward to an allowed source creator",
        description: "Separate x402 citation payment. Managed sources require active citation-only/paid policy, current control and expected original policy selectors. Free policy cannot earn. Mainnet payee must be allowed by fresh live registry. The shared research pipeline separately requires qualified evidence from content actually read; verification and historical public citations do not grant rewards.",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
          { in: "query", name: "author", required: false, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Source-owned registry-authorized recipient; omitted uses source payee." },
          { in: "query", name: "amount", required: true, schema: { type: "number", exclusiveMinimum: 0 }, description: "USDC reward bounded by deployment citation ceiling and admitted budget." },
          ...sourceClaimFinancialQueryParameters,
        ],
        responses: {
          "200": { description: "Circle-evidenced citation settlement acknowledgment." },
          "400": { description: "Invalid or excessive citation amount." },
          "402": { description: "Separate citation payment-signature required." },
          "403": { description: "Recipient is not source-owned registry payout authority." },
          "409": { description: "Expected original policy differs; no automatic re-admission." },
          "410": { description: "Source inactive/unverified, free public identity or citation policy disabled." },
          "503": { description: "Current managed policy or mainnet registry authority unavailable." },
        },
      },
    },
    "/api/metrics": {
      get: {
        operationId: "getDashboardMetrics",
        summary: "Read aggregate dashboard telemetry",
        description: "Public aggregate telemetry and settled payment totals. Recorded historical evidence samples do not establish current factual support; groundedClaimRate is null with an explicit unreassessed basis. This endpoint neither reads paid bodies nor reassesses archived evidence.",
        responses: { "200": { description: "Dashboard metrics, leaderboard, topics and daily settled volume.", content: {
          "application/json": { schema: { type: "object", required: ["metrics"], properties: {
            metrics: { allOf: [
              { $ref: "#/components/schemas/DashboardGroundingStatus" },
              { type: "object", properties: {
                guestQuestions: { type: ["integer", "null"], minimum: 0,
                  description: "Optional count of recorded web questions without a recorded signed-in wallet, included in totalQueries. Counts questions, not visits or unique people; null or absent means unavailable." },
              } },
            ] },
          } } },
        } } },
      },
    },
    "/api/health": {
      get: {
        operationId: "getServiceHealth",
        summary: "Read datastore readiness and aggregate traction",
        description: "Chain-free health probe. Traction preserves settled payment totals and identifies aggregate factual grounding as unavailable pending historical provenance reassessment; per-run A2A quality is separate.",
        responses: {
          "200": { description: "Datastore ready, with operational status and traction.", content: {
            "application/json": { schema: { type: "object", required: ["ok", "traction"], properties: {
              ok: { type: "boolean", const: true }, traction: { $ref: "#/components/schemas/DashboardGroundingStatus" },
            } } },
          } },
          "503": { description: "Datastore unavailable; no traction snapshot is returned." },
        },
      },
    },
    "/api/research/monthly": monthlyOpenApiPath,
    "/api/dispatch/{id}/receipt": {
      get: {
        operationId: "getDispatchResearchReceipt",
        summary: "Export an integrity-checkable research receipt",
        description:
          "Projects one archived dispatch into deterministic JSON containing its answer hash, " +
          "visible BUY/SKIP/CACHE decisions, exact cited asset versions, evidence-bounded claims, " +
          "and a sanitized creator settlement snapshot. Retain the SHA-256 separately to detect a " +
          "later payload change; the self-hash is not a Keryx or creator signature. Read-only: no purchase, decryption, grant reservation, " +
          "or settlement mutation. Public, no auth.",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
          {
            in: "query",
            name: "download",
            required: false,
            schema: { type: "string", enum: ["1"] },
            description: "Set to 1 to return an attachment filename.",
          },
        ],
        responses: {
          "200": {
            description: "Portable receipt and X-Keryx-Receipt-Digest response header.",
            headers: {
              "X-Keryx-Receipt-Digest": {
                description: "Same SHA-256 digest carried in the JSON integrity block.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ResearchReceipt" },
              },
            },
          },
          "404": { description: "Dispatch not found." },
          "503": { description: "Receipt projection is temporarily unavailable." },
        },
      },
    },
    "/api/dispatch/{id}/freshness": {
      get: {
        operationId: "getDispatchFreshness",
        summary: "Audit exact citation-version drift without buying content",
        description:
          "Compares the immutable content version each dispatch bought with Keryx's current " +
          "indexed article asset, and counts newly published feed items. Metadata-only: this " +
          "endpoint never decrypts or purchases replacement text and never treats drift as a " +
          "correctness verdict. Public, no auth.",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Current metadata audit with explicit interpretation limits.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DispatchFreshness" },
              },
            },
          },
          "404": { description: "Dispatch not found." },
          "503": { description: "Freshness metadata is temporarily unavailable." },
        },
      },
    },
    "/api/operator/status": operatorStatusOpenApiPath,
    "/api/agent/ask": {
      get: {
        operationId: "inspectOrPollAgentAsk",
        summary: "Inspect default A2A pricing or poll an existing order",
        parameters: [
          {
            in: "query",
            name: "queryId",
            required: false,
            schema: { type: "string", pattern: "^a2a_[a-f0-9]{64}$" },
            description:
              "When present, reads durable queued/processing/review-required/completed/failed state without payment.",
          },
        ],
        responses: {
          "200": {
            description: "Durable order state for the supplied queryId.",
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    { $ref: "#/components/schemas/A2aPendingResponse" },
                    { $ref: "#/components/schemas/AskResponse" },
                    { $ref: "#/components/schemas/A2aFailedResponse" },
                  ],
                },
              },
            },
          },
          "402": { description: "No queryId: side-effect-free default-package x402 discovery challenge." },
          "404": { description: "A2A order not found." },
        },
      },
      post: {
        operationId: "agentAsk",
        summary: "Run autonomous research (x402 pay-per-call)",
        description:
          "Keryx answers a research question, buys the paid sources worth reading, " +
          "and settles weighted citation nanopayments to creators in USDC on Arc. " +
          "The body determines an exact all-in x402 price before settlement: a fixed Quick/Deep " +
          "orchestration fee plus the bounded creator-spend cap. The non-refundable receipt " +
          "itemizes actual creator spend and unused reserve. Every mainnet original returns a " +
          "durable 202 job through the business worker, including responseMode=wait. Each new order stores " +
          "a versioned execution contract and returns provisional latency/evidence-quality measurements; " +
          "these objectives have no contractual remedy. New completed public runs are attributed to the " +
          "verified original payer, with agent-to-agent ingress recorded separately from payment origin. " +
          "Client names cannot establish stdio, desktop, CLI or extension identity; ownership grants no new budget.",
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
          "202": {
            description:
              "Payment settled and research durably queued. Poll Location until completed, failed, or review_required.",
            headers: {
              Location: {
                description: "Read-only durable order URL.",
                schema: { type: "string" },
              },
              "Retry-After": {
                description: "Suggested seconds before the next poll.",
                schema: { type: "integer" },
              },
              "Preference-Applied": {
                description: "Present when Prefer: respond-async selected async delivery.",
                schema: { type: "string", enum: ["respond-async"] },
              },
              "PAYMENT-RESPONSE": {
                description: "Base64-encoded x402 settlement confirmation.",
                schema: { type: "string", format: "base64" },
              },
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/A2aPendingResponse" },
              },
            },
          },
          "400": {
            description: "Invalid question or response mode.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "409": {
            description: "Requested research package version is unsupported; no payment is issued.",
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
              "Payment required. The exact amount is derived from the validated request body. " +
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
          "`kx_live_…` Bearer key identifies its wallet and meters usage. All keys for a wallet share " +
          "10 sponsored calls/minute across chat and remote MCP; direct IP and shared global limits also apply. " +
          "New keys add no quota; unavailable durable counters refuse admission. Keryx researches the last user " +
          "message over paid sources and pays every cited creator downstream in USDC on Arc. With " +
          "`stream:true`, live reasoning streams as `reasoning_content` deltas. This path is NOT " +
          "x402 — no payment-signature required. New runs record API ingress and API-key ownership when verified; " +
          "anonymous runs remain ownerless. IPs, user agents and client telemetry never establish ownership.",
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
              "ChatCompletion object, or an SSE stream of chat.completion.chunk when stream=true. " +
              "A terminal planning refusal in a started stream is emitted as [keryx error] content, without a successful completion or automatic retry.",
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
          "422": {
            description: "Non-streaming research could not prepare a valid complete plan within eight independent targets. " +
              "Code research_plan_refinement_required supplies original-caller guidance; a model call may already have incurred compute cost. No automatic paid retry or completed report follows.",
            content: { "application/json": { schema: {
              type: "object", required: ["error"], properties: { error: {
                type: "object", required: ["message", "type", "code"], properties: {
                  message: { type: "string" }, type: { type: "string", enum: ["invalid_request_error"] },
                  code: { type: "string", enum: ["research_plan_refinement_required"] },
                },
              } },
            } } },
          },
          "429": {
            description: "Shared sponsored allowance exceeded (anonymous IP, verified wallet, direct IP or global capacity).",
            headers: {
              "Retry-After": {
                description: "Seconds until the rate limit window resets.",
                schema: { type: "integer" },
              },
            },
          },
          "500": { description: "Treasury wallet not configured." },
          "503": {
            description: "Durable sponsored admission is unavailable; no research was started.",
            headers: { "Retry-After": { description: "Seconds before retrying admission.", schema: { type: "integer" } } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
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
                    items: { type: "string", enum: API_KEY_SCOPES },
                    description:
                      "Operations this key may perform. `ask` runs dispatches; `export` reads " +
                      "the wallet's earnings ledger. Omitted or empty retains ask/export. Profile and history rights require explicit selection.",
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
                    sources: { type: "array", items: { $ref: "#/components/schemas/Source" } },
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
