/** Documentation contract only; owner mutation remains a same-origin web role. */
const claimId = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const httpsUrl = { type: "string", format: "uri", maxLength: 2048, description: "Canonical credential-free HTTPS URL; path case and query are preserved, fragment removed." } as const;
const revision = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
const mode = { type: "string", enum: ["free", "citation-only", "paid"] } as const;
const proofMethod = { type: "string", enum: ["website-file", "rss-channel"], default: "website-file" } as const;
const address = { type: "string", pattern: "^0x[0-9a-f]{40}$" } as const;
const date = { type: "string", format: "date-time" } as const;
const claimRef = { $ref: "#/components/schemas/SourceClaim" } as const;
const nullableClaim = { anyOf: [claimRef, { type: "null" }] } as const;
const originParameter = { in: "header", name: "Origin", required: true, schema: { type: "string", format: "uri" },
  description: "Must exactly equal this deployment's configured origin. SIWE cookie and same-origin browser request are required; an API key is not creator authority." } as const;
const idParameter = { in: "path", name: "id", required: true, schema: claimId } as const;
const ownerSecurity = [{ WebSession: [] }] as const;
const errors = {
  "400": { description: "Invalid bounded JSON, URL, proof scope or consent." },
  "401": { description: "SIWE web session required." },
  "403": { description: "Origin, verified wallet or live registry creator differs." },
  "409": { description: "Stale revision, changed identity, proof expiry/replay or incompatible registry price. Refresh explicitly; no automatic payment retry." },
  "413": { description: "JSON body exceeds 8192 bytes." },
  "503": { description: "Atomic backend, claim history or fresh registry authority unavailable; no earning activation." },
} as const;
function body(schema: unknown) { return { required: true, content: { "application/json": { schema } } }; }
function response(schema: unknown, description: string) { return { description, content: { "application/json": { schema } } }; }
const claimResponse = response({ type: "object", required: ["claim"], properties: { claim: claimRef } }, "Persisted current claim; verification and linking retain free mode until explicit policy activation.");
const challengeResponse = response({ type: "object", required: ["challenge", "proof", "proofToken", "proofUrl", "claim"], properties: {
  challenge: { $ref: "#/components/schemas/SourceClaimChallenge" }, proof: { $ref: "#/components/schemas/SourceClaimProof" },
  proofToken: { type: "string", description: "Publish only in RSS/Atom publisher channel title/description/subtitle; item bodies/comments do not count." },
  proofUrl: httpsUrl, claim: nullableClaim,
} }, "Owner-only single-use proof material; expires after 15 minutes. No charge or earning activation.");

export const sourceClaimOpenApiSchemas = {
  Source: {
    type: "object", additionalProperties: true, properties: {
      id: { type: "string" }, name: { type: "string" }, url: { type: "string", format: "uri" },
      fetchPrice: { type: "number", minimum: 0 },
      sourceClaimId: { ...claimId, description: "Sticky managed-source marker, including when policy history cannot be read. Marker is not payout authority. Catalog import must retain the original atomic claim history or fail closed." },
    },
  },
  SourceClaimReceipt: {
    type: "object", additionalProperties: false, required: ["id", "revision", "mode", "effectiveAt", "verifiedAt"],
    properties: { id: claimId, revision, mode, effectiveAt: date, verifiedAt: date },
    description: "Policy identity captured before a new use and retained with its original financial authorization. Informational receipt alone does not authorize a payout; current atomic claim and fresh live registry must still agree.",
  },
  SourceClaim: {
    type: "object", additionalProperties: false,
    required: ["id", "canonicalUrl", "ownerWallet", "deploymentOrigin", "network", "verifiedAt", "revision", "effectiveAt", "mode", "distributionPermission"],
    properties: {
      id: claimId, canonicalUrl: httpsUrl, rssUrl: httpsUrl, publicReferenceId: { type: "string", pattern: "^public:", maxLength: 256 },
      ownerWallet: address, deploymentOrigin: { type: "string", format: "uri" }, network: { type: "string", pattern: "^eip155:[0-9]+$" },
      verifiedAt: date, revision, effectiveAt: date, mode, distributionPermission: { type: "boolean" }, proofMethod,
      linkedSourceId: { type: "string", maxLength: 256, description: "Exact owned listing; public reference IDs remain permanently free." },
      onchainId: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }, registryAddress: address,
    },
  },
  SourceClaimChallenge: {
    type: "object", additionalProperties: false,
    required: ["id", "claimId", "wallet", "canonicalUrl", "deploymentOrigin", "network", "nonce", "createdAt", "expiresAt"],
    properties: { id: claimId, claimId, wallet: address, canonicalUrl: httpsUrl, rssUrl: httpsUrl,
      publicReferenceId: { type: "string", pattern: "^public:", maxLength: 256 }, deploymentOrigin: { type: "string", format: "uri" },
      network: { type: "string", pattern: "^eip155:[0-9]+$" }, nonce: claimId, createdAt: date, expiresAt: date, consumedAt: date, proofMethod },
  },
  SourceClaimProof: {
    type: "object", additionalProperties: false,
    required: ["protocol", "challengeId", "claimId", "wallet", "canonicalUrl", "deploymentOrigin", "network", "nonce", "expiresAt"],
    properties: { protocol: { type: "string", const: "keryx-source-claim-v1" }, challengeId: claimId, claimId,
      wallet: address, canonicalUrl: httpsUrl, rssUrl: httpsUrl, deploymentOrigin: { type: "string", format: "uri" },
      network: { type: "string", pattern: "^eip155:[0-9]+$" }, nonce: claimId, expiresAt: date, proofMethod },
  },
} as const;

export const sourceClaimFinancialQueryParameters = [
  { in: "query", name: "claimId", required: false, schema: claimId,
    description: "Required together with claimRevision for any new paid request to a managed source; must match the snapshot retained in the original browser/hosted authorization. Cannot rewrite unsigned URL queries to a newer policy." },
  { in: "query", name: "claimRevision", required: false, schema: revision,
    description: "Exact admitted policy revision. Policy changes, proof expiry or unavailable authority decline a new payment even if price is unchanged; rediscover explicitly." },
] as const;

export const sourceClaimOpenApiPaths = {
  "/api/source-claims": {
    get: {
      operationId: "inspectSourceClaims", summary: "Inspect persisted source policy or resume the owner's proof",
      description: "canonicalUrl/claimId inspect public safe policy without proof nonce. challengeId resumes owner-only unexpired proof. With no selector a SIWE session lists that owner's scoped claims. Responses are no-store; inspection confers no earning authority.",
      parameters: [
        { in: "query", name: "canonicalUrl", required: false, schema: httpsUrl },
        { in: "query", name: "claimId", required: false, schema: claimId },
        { in: "query", name: "challengeId", required: false, schema: claimId },
      ],
      responses: {
        "200": response({ oneOf: [
          { type: "object", required: ["claim", "controlMaxAgeMs", "network"], properties: { claim: nullableClaim, controlMaxAgeMs: { type: "integer", const: 86400000 }, network: { type: "string" } } },
          { type: "object", required: ["claims"], properties: { claims: { type: "array", items: claimRef } } },
          challengeResponse.content["application/json"].schema,
        ] }, "Scoped public policy, owner's claims, or owner-only proof material."),
        "401": errors["401"], "404": { description: "Owner challenge unavailable." }, "409": errors["409"], "503": errors["503"],
      },
    },
  },
  "/api/source-claims/challenge": {
    post: {
      operationId: "createSourceClaimChallenge", summary: "Create a free source-control proof challenge",
      description: "Wallet/deployment/network/exact URL/feed bound nonce. Website proof uses origin-root /.well-known/keryx-source-claim.json; RSS proof uses exact publisher channel metadata. Catalog source/feed pair must match server state; general RSS canonicalUrl equals rssUrl. Proof requests never perform transactions.",
      security: ownerSecurity, parameters: [originParameter],
      requestBody: body({ type: "object", additionalProperties: false, required: ["canonicalUrl"], properties: { canonicalUrl: httpsUrl, rssUrl: httpsUrl, publicReferenceId: { type: "string", pattern: "^public:", maxLength: 256 }, proofMethod } }),
      responses: { "200": challengeResponse, ...errors, "429": { description: "Durable wallet challenge limit: five per hour." } },
    },
  },
  "/api/source-claims/verify": {
    post: {
      operationId: "verifySourceClaimProof", summary: "Verify exact publishing control, retaining free default",
      description: "DNS-pinned bounded public HTTPS fetch; no redirects. Website JSON must exactly match challenge; RSS token in publisher channel fields only. Atomically consumes the challenge and retains evidence. A refresh changes revision and preserves existing policy; does not reward historical public uses.",
      security: ownerSecurity, parameters: [originParameter],
      requestBody: body({ type: "object", additionalProperties: false, required: ["challengeId"], properties: { challengeId: claimId } }),
      responses: { "200": claimResponse, ...errors,
        "429": { description: "Durable wallet verification-attempt limit: ten per hour, including failed fetch/proof attempts." },
        "502": { description: "Dedicated bounded HTTPS proof could not be fetched without redirects; challenge remains unused." } },
    },
  },
  "/api/source-claims/{id}/link": {
    post: {
      operationId: "linkSourceClaimListing", summary: "Attach an exact live creator listing in free mode",
      description: "Fresh SourceRegistry creator, active exact URL/feed and retained registry identity must match the verified wallet. Initial link keeps free mode and disabled distribution permission. Scholarly rights enrollment is excluded.",
      security: ownerSecurity, parameters: [idParameter, originParameter],
      requestBody: body({ type: "object", additionalProperties: false, required: ["sourceId", "expectedRevision"], properties: { sourceId: { type: "string", minLength: 1, maxLength: 256 }, expectedRevision: revision } }),
      responses: { "200": claimResponse, ...errors, "404": { description: "Claim not found." } },
    },
  },
  "/api/source-claims/{id}/policy": {
    post: {
      operationId: "setSourceClaimPolicy", summary: "Explicitly choose free, citation-only or paid policy",
      description: "Expected revision CAS. Earning activation requires proof no older than 24 hours, exact live creator, active listing and explicit distributionPermission=true. citation-only requires registry price zero; paid requires positive price. Free disables earnings without new proof/RPC. Policy timestamps apply only to future uses; no receipt rewriting or retroactive billing.",
      security: ownerSecurity, parameters: [idParameter, originParameter],
      requestBody: body({ type: "object", additionalProperties: false, required: ["mode", "expectedRevision"], properties: { mode, expectedRevision: revision, distributionPermission: { type: "boolean", default: false } } }),
      responses: { "200": claimResponse, ...errors, "404": { description: "Claim not found." } },
    },
  },
} as const;
