/** Documentation only. SIWE/proof/native caps remain execution authority. */
const hash = { type: "string", pattern: "^0x[0-9a-f]{64}$" } as const;
const address = { type: "string", pattern: "^0x[0-9a-f]{40}$" } as const;
const decimal = { type: "string", pattern: "^(0|[1-9][0-9]*)$" } as const;
const claimId = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const original = { $ref: "#/components/schemas/SponsoredRegistration" } as const;
const originalResponse = { type: "object", required: ["original"], properties: { original, recoveryUnavailable: { type: "boolean" } } } as const;
const json = (schema: unknown) => ({ "application/json": { schema } });
const retainedOperation = (operation: string) => ({ type: "object", additionalProperties: false,
  required: ["operation", "id"], properties: { operation: { const: operation }, id: hash } });

export const registrationSponsorOpenApiSchemas = {
  SponsoredRegistration: { type: "object", additionalProperties: false,
    description: "Owner-scoped public original. No creator signature, sponsor key or signed transaction bytes are returned. Native gas wei uses 18 decimals; source read-price micro-USDC uses 6.",
    required: ["id", "policyDigest", "creator", "canonicalUrl", "rssUrl", "claimId", "claimRevision", "sourceId", "onchainId", "registryAddress", "registryCodeHash", "relayer", "chainId", "params", "nonce", "deadline", "createdAt", "updatedAt", "reservedWei", "state"],
    properties: { id: hash, policyDigest: hash, creator: address,
      canonicalUrl: { type: "string", format: "uri" }, rssUrl: { type: "string", format: "uri" },
      claimId, claimRevision: { type: "integer", minimum: 1 }, sourceId: { type: "string" }, onchainId: hash,
      registryAddress: address, registryCodeHash: hash, relayer: address, chainId: { type: "integer", enum: [5042, 5042002] },
      params: { type: "object", additionalProperties: false, required: ["urlHash", "payoutWallet", "authors", "fetchPriceUsdc6", "contentCid", "tags"],
        properties: { urlHash: hash, payoutWallet: address, authors: { type: "array", minItems: 1, maxItems: 20,
          items: { type: "object", additionalProperties: false, required: ["wallet", "basisPoints"], properties: {
            wallet: address, basisPoints: { type: "integer", minimum: 1, maximum: 10000 } } } },
          fetchPriceUsdc6: decimal, contentCid: { type: "string" }, tags: { type: "string" } } },
      nonce: decimal, deadline: { type: "integer", description: "Contract authorization deadline in Unix seconds." },
      createdAt: { type: "integer", description: "Admission time in Unix milliseconds." }, updatedAt: { type: "integer" },
      reservedWei: decimal, actualGasWei: decimal,
      state: { type: "string", enum: ["prepared", "signing", "submitted", "confirmed", "reverted", "expired"] },
      replacesRequestId: hash, transactionHash: hash, transactionNonce: { type: "integer", minimum: 0 },
      expiredResolution: { const: true, description: "Expired-original resolution was attempted. A prior matching success remains authoritative if its receipt arrives later." },
    } },
} as const;

export const registrationSponsorOpenApiPaths = {
  "/api/sources/sponsor": {
    get: { tags: ["Sources"], summary: "Inspect sponsorship availability or the creator's retained original",
      description: "Without id/claimId, returns availability for the SIWE wallet and any exact eligible publisher origins. This is discovery, not admission. Original lookup requires its creator session. Receipt inspection needs no active policy/key and never signs or broadcasts.",
      parameters: [{ in: "query", name: "id", schema: hash }, { in: "query", name: "claimId", schema: claimId }],
      responses: { "200": { description: "Availability or retained public original; recoveryUnavailable preserves the original when receipt observation fails.",
        content: json({ oneOf: [originalResponse, { type: "object", required: ["available"], properties: {
          available: { type: "boolean" }, network: { type: "string", enum: ["eip155:5042", "eip155:5042002"] },
          registryAddress: address, sponsorAddress: address, policyDigest: hash, maxGasWei: decimal,
          requiresPublishingProof: { const: true }, publisherOrigins: { type: "array", items: { type: "string", format: "uri" } },
        } }] }) }, "401": { description: "Sign in with the original creator wallet." }, "404": { description: "No retained original for this owner/claim." } } },
    post: { tags: ["Sources"], summary: "Explicitly prepare, submit, resume or resolve one sponsored registration",
      security: [{ WebSession: [] }],
      description: "Same-origin SIWE creator role; API keys do not grant publishing authority. Preparation requires fresh publishing proof and exact policy eligibility/caps. Submit accepts one creator EIP-712 authorization. Resume retains exact nonce/calldata/fees/reservation. resolveExpired requires fresh chain expiry and the still-live original policy; it can only send original bytes, without a replacement or hold reset. Receipt-reverted renewal names its predecessor and consumes another capped attempt. No automatic retry or creator earnings activation.",
      parameters: [{ in: "header", name: "Origin", required: true, schema: { type: "string", format: "uri" }, description: "This deployment's exact configured origin." }],
      requestBody: { required: true, content: json({ oneOf: [
        { type: "object", additionalProperties: false, required: ["operation", "claimId", "fetchPrice"], properties: {
          operation: { const: "prepare" }, claimId, fetchPrice: { type: "number", minimum: 0, maximum: 1000000 }, replacesRequestId: hash } },
        { type: "object", additionalProperties: false, required: ["operation", "id", "signature"], properties: {
          operation: { const: "submit" }, id: hash, signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" } } },
        retainedOperation("resume"), retainedOperation("resolveExpired"),
      ] }) },
      responses: { "200": { description: "Prepared or previously retained original.", content: json(originalResponse) },
        "202": { description: "Retained original state. Submitted/unknown is not confirmation.", content: json(originalResponse) },
        "400": { description: "Invalid bounded JSON or exact registration terms." }, "401": { description: "SIWE creator session required." },
        "403": { description: "Origin, owner, proof or publisher eligibility differs." }, "409": { description: "Cap, identity, proof, nonce, expiry or policy conflict; retain the original." },
        "413": { description: "JSON exceeds 8192 bytes." }, "503": { description: "Sponsor/storage/registry unavailable; no new authority granted." } },
    },
  },
} as const;
