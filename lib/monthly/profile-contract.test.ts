import { describe, expect, it } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { monthlyQuoteSchemaForProfile, monthlyRecoveryFileSchemaForProfile } from "./protocol";

const request = { monthlyId: `monthly_${"a".repeat(64)}`, requestId: "00000000-0000-4000-8000-000000000001",
  question: "What evidence supports this finding?", payer: `0x${"b".repeat(40)}` };
function quote(network: string) {
  return { plan: "research-monthly-v1", requests: 4, termDays: 30, researchMode: "deep", packageVersion: "1.0.0",
    creatorBudgetMicros: 500000, serviceFeeMicros: 1600000, totalMicros: 3600000, separateTotalMicros: 4000000,
    roundingMicros: 0, payee: request.payer, network, quoteId: "c".repeat(64) };
}
describe("Monthly selected-profile and original recovery contract", () => {
  it("mainnet uses the reviewed package economics without the historical one-USDC pilot ceiling", () => {
    expect(monthlyQuoteSchemaForProfile(ARC_MAINNET_PROFILE).parse(quote(ARC_MAINNET_PROFILE.networkId)).totalMicros).toBe(3600000);
    expect(() => monthlyQuoteSchemaForProfile(ARC_TESTNET_PROFILE).parse(quote(ARC_TESTNET_PROFILE.networkId))).toThrow();
  });
  it("rejects another rail and changed allocation or rounding", () => {
    const schema = monthlyQuoteSchemaForProfile(ARC_MAINNET_PROFILE), value = quote(ARC_MAINNET_PROFILE.networkId);
    for (const changed of [{ network: ARC_TESTNET_PROFILE.networkId }, { creatorBudgetMicros: 500001 },
      { totalMicros: 3600001 }, { roundingMicros: 1 }, { separateTotalMicros: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => schema.parse({ ...value, ...changed })).toThrow();
    }
  });
  it("preserves legacy raw testnet recovery while requiring explicit original rail for mainnet", () => {
    expect(monthlyRecoveryFileSchemaForProfile(ARC_TESTNET_PROFILE).parse(request)).toEqual(request);
    expect(() => monthlyRecoveryFileSchemaForProfile(ARC_MAINNET_PROFILE).parse(request)).toThrow();
    const envelope = { schema: "keryx-monthly-recovery-v2", network: ARC_MAINNET_PROFILE.networkId, request };
    expect(monthlyRecoveryFileSchemaForProfile(ARC_MAINNET_PROFILE).parse(envelope)).toEqual(request);
    expect(() => monthlyRecoveryFileSchemaForProfile(ARC_TESTNET_PROFILE).parse(envelope)).toThrow();
  });
});
