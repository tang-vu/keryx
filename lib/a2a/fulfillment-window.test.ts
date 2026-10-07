import { describe, expect, it } from "vitest";
import { fulfillmentSupplierWindowSchema } from "./fulfillment-window";
import { fulfillmentAuthoritySchema, fulfillmentClaimInputSchema, fulfillmentObjectSha256,
  ORIGINAL_FULFILLMENT_LIMITS } from "./failed-original-fulfillment-protocol";
import { fulfillmentAuthorizationSchema } from "../business-operator/fulfillment-policy";
import { syntheticFailedOriginal } from "../db/a2a-fulfillment-fixture";

const window = { approvalReceivedAt: "2026-10-07T01:30:00.000Z", expiresAt: "2026-10-07T03:00:00.000Z",
  maximumDurationMs: 5_400_000 as const };
const authority = () => ({ ...syntheticFailedOriginal().authority,
  format: "keryx-a2a-failed-original-fulfillment-authority-v2" as const, expiresAt: window.expiresAt, supplierWindow: window });
const authorization = () => ({
  format: "keryx-canary-original-fulfillment-authorization-v2", approvalId: "operator-business-20261006",
  approvedAt: "2026-10-07T01:30:01.000Z", executionHostSha256: "a".repeat(64), executorCommit: "b".repeat(40),
  policySha256: "a".repeat(64), failedClosureSha256: "a".repeat(64), originalEvidenceSha256: "a".repeat(64),
  originalProviderLedgerSha256: "a".repeat(64), inputFile: "/fixture/input", inputSha256: "a".repeat(64),
  inputSemanticSha256: "a".repeat(64), sourceManifestFile: "/fixture/manifest", sourceManifestSha256: "a".repeat(64),
  packetSha256: "a".repeat(64), requiredSupportedTargetIndexes: [0], tariffFile: "/fixture/tariff",
  tariffBodySha256: "a".repeat(64), tariffUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
  tariffRetrievedAt: "2026-10-06T11:00:00.000Z", tariffInputUsdPerMillion: 0.30, tariffOutputUsdPerMillion: 1.20,
  provider: "deepseek", endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-v4-flash",
  expiresAt: window.expiresAt, supplierWindow: window, maximumNewModelCalls: 3, reserveMicroUsd: 20660,
  originalReservedMicroUsd: 36660, creatorPayments: "forbidden", searches: "forbidden",
});

describe("explicit bounded original-fulfillment window", () => {
  it("requires a supplied canonical window of at most 90 minutes with no default", () => {
    expect(fulfillmentSupplierWindowSchema.parse(window)).toEqual(window);
    expect(fulfillmentSupplierWindowSchema.safeParse({ ...window, expiresAt: "2026-10-07T01:30:00.001Z" }).success).toBe(true);
    expect(fulfillmentAuthoritySchema.parse(authority())).toMatchObject({ supplierWindow: window });
    expect(fulfillmentAuthorizationSchema.parse(authorization())).toMatchObject({ supplierWindow: window });
    const { supplierWindow: _window, ...missing } = authority();
    expect(fulfillmentAuthoritySchema.safeParse(missing).success).toBe(false);
    expect(ORIGINAL_FULFILLMENT_LIMITS.maximumNewModelCalls).toBe(10);
    expect(ORIGINAL_FULFILLMENT_LIMITS.expiresAt).toBe("2026-10-07T00:00:00.000Z");
  });
  it.each([
    { expiresAt: "2026-10-07T03:00:00.001Z" }, { expiresAt: window.approvalReceivedAt },
    { expiresAt: "2026-10-07T01:29:59.999Z" }, { maximumDurationMs: 5_400_001 },
    { approvalReceivedAt: "2026-10-07T01:30:00Z" }, { expiresAt: "2026-10-07T03:00:00+00:00" },
    { extra: true },
  ])("rejects oversized/empty/inverted/noncanonical or open window %j", change => {
    expect(fulfillmentSupplierWindowSchema.safeParse({ ...window, ...change }).success).toBe(false);
  });
  it("binds top-level expiry and approval chronology, preserving the three-call tariff", () => {
    expect(fulfillmentAuthoritySchema.safeParse({ ...authority(), expiresAt: "2026-10-07T02:59:59.999Z" }).success).toBe(false);
    for (const change of [{ expiresAt: "2026-10-07T02:59:59.999Z" },
      { approvedAt: "2026-10-07T01:29:59.999Z" }, { approvedAt: window.expiresAt },
      { maximumNewModelCalls: 10 }, { reserveMicroUsd: 0 }])
      expect(fulfillmentAuthorizationSchema.safeParse({ ...authorization(), ...change }).success).toBe(false);
  });
  it("binds recorded native claim time without making historical parse depend on the current clock", () => {
    const claim = { ...syntheticFailedOriginal().input, authority: authority(), claimedAt: window.approvalReceivedAt };
    expect(fulfillmentClaimInputSchema.parse(claim)).toEqual(claim);
    for (const claimedAt of ["2026-10-07T01:29:59.999Z", window.expiresAt])
      expect(fulfillmentClaimInputSchema.safeParse({ ...claim, claimedAt }).success).toBe(false);
    expect(fulfillmentObjectSha256(authority())).not.toBe(fulfillmentObjectSha256({ ...authority(),
      supplierWindow: { ...window, approvalReceivedAt: "2026-10-07T01:30:00.001Z" } }));
    expect(fulfillmentAuthoritySchema.parse(syntheticFailedOriginal().authority).format)
      .toBe("keryx-a2a-failed-original-fulfillment-authority-v1");
  });
  it("keeps the strict legacy format and fixed expiry separate from v2 permission", () => {
    const v1 = syntheticFailedOriginal().authority;
    expect(fulfillmentAuthoritySchema.safeParse({ ...v1, supplierWindow: window }).success).toBe(false);
    expect(fulfillmentAuthoritySchema.safeParse({ ...v1, expiresAt: window.expiresAt }).success).toBe(false);
    const { supplierWindow: _window, ...auth } = authorization();
    expect(fulfillmentAuthorizationSchema.safeParse({ ...auth,
      format: "keryx-canary-original-fulfillment-authorization-v1", expiresAt: "2026-10-07T00:00:00.000Z" }).success).toBe(true);
  });
});
