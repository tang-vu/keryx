import { describe, expect, it } from "vitest";
import { canonicalJson } from "../canonical-json";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { activeRegistrationSponsorPolicySchema, registrationAuthorizationDeadline, registrationCreatorEligible,
  registrationPolicyDigest, registrationPolicyExpired, registrationSponsorPolicySchema, registrationWalletMayPrepare,
  type RegistrationSponsorPolicy, type WalletFundedRegistrationSponsorPolicy } from "./registration-sponsor-protocol";
const wallet = "0x1111111111111111111111111111111111111111" as Address;
const registry = "0x2222222222222222222222222222222222222222" as Address;
const hash = `0x${"33".repeat(32)}` as Hex;
const legacy: RegistrationSponsorPolicy = { protocol: "keryx-registration-sponsor-v1", network: "eip155:5042",
  deploymentOrigin: "https://keryx.example", registryAddress: registry, registryCodeHash: hash, sponsorAddress: wallet,
  expiresAt: 1_800_000_600_000, maxTransactionWei: "40000000000000000", maxDailyWei: "80000000000000000",
  maxLifetimeWei: "200000000000000000", maxGas: 1_000_000, maxFeePerGasWei: "40000000000",
  maxRegistrationsPerWallet: 2, maxRegistrationsPerDay: 5, maxRegistrationsTotal: 5,
  allowlistedCreators: [], allowlistedPublisherOrigins: ["https://conzit.com"], maxRegistrationsPerOrigin: 2 };
const funded: WalletFundedRegistrationSponsorPolicy = { protocol: "keryx-registration-sponsor-v2",
  eligibility: "verified-publisher", funding: "wallet-balance", network: legacy.network, deploymentOrigin: legacy.deploymentOrigin,
  registryAddress: registry, registryCodeHash: hash, sponsorAddress: wallet,
  maxTransactionWei: legacy.maxTransactionWei, maxGas: legacy.maxGas, maxFeePerGasWei: legacy.maxFeePerGasWei };
describe("registration policy compatibility", () => {
  it("keeps finite CLI schema closed to v1 and preserves its canonical digest", () => {
    expect(registrationSponsorPolicySchema.parse(legacy)).toEqual(legacy);
    expect(registrationSponsorPolicySchema.safeParse(funded).success).toBe(false);
    expect(registrationPolicyDigest(legacy)).toBe(keccak256(toBytes(canonicalJson(legacy))));
    expect(activeRegistrationSponsorPolicySchema.parse(legacy)).toEqual(legacy);
  });
  it("admits any verified-publisher wallet without an expiry while retaining a ten-minute authorization", () => {
    expect(activeRegistrationSponsorPolicySchema.parse(funded)).toEqual(funded);
    expect(registrationWalletMayPrepare(funded, registry)).toBe(true);
    expect(registrationCreatorEligible(funded, registry, "https://any-publisher.example/rss.xml")).toBe(true);
    expect(registrationCreatorEligible(funded, registry, "http://any-publisher.example/rss.xml")).toBe(false);
    expect(registrationPolicyExpired(funded, 1_900_000_000_000)).toBe(false);
    expect(registrationAuthorizationDeadline(funded, 1_800_000_000_000)).toBe(1_800_000_600);
    expect(registrationWalletMayPrepare(funded, "not-a-wallet")).toBe(false);
  });
  it.each(["expiresAt", "maxDailyWei", "maxLifetimeWei", "maxRegistrationsTotal", "allowlistedPublisherOrigins"])("refuses hidden pilot field %s in v2", field => {
    expect(activeRegistrationSponsorPolicySchema.safeParse({ ...funded, [field]: legacy[field as keyof RegistrationSponsorPolicy] }).success).toBe(false);
  });
  it("refuses a v2 gas leg over the existing 0.04 USDC authorization", () => {
    expect(activeRegistrationSponsorPolicySchema.safeParse({ ...funded, maxTransactionWei: "40000000000000001" }).success).toBe(false);
  });
  it("retains the v2 40 gwei ceiling even when a smaller gas limit keeps the leg at 0.04 USDC", () => {
    expect(activeRegistrationSponsorPolicySchema.safeParse({ ...funded, maxGas: 500_000, maxFeePerGasWei: "80000000000" }).success).toBe(false);
    // Historical v1 policy authority and its canonical parsing remain unchanged.
    expect(registrationSponsorPolicySchema.safeParse({ ...legacy, maxGas: 500_000, maxFeePerGasWei: "80000000000" }).success).toBe(true);
  });
});
