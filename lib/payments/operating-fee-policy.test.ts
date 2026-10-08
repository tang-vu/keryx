import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, type StorageIdentity } from "../db/storage-identity";
import { configuredOperatingFeePolicy, operatingFeeMaxMicroUsdc, operatingFeePolicyDigest,
  operatingFeePolicySchema, operatingFeeContextSchema, operatingFeeEndpointPath, operatingFeeRequestHash,
  validateOperatingFeePolicy, type OperatingFeePolicy } from "./operating-fee-policy";

const signer = `0x${"11".repeat(20)}`, beneficiary = `0x${"22".repeat(20)}`, origin = "https://keryx.cc";
const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
  network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
  deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(),
  enrolledAt: new Date().toISOString(), provenanceDigest: "aa".repeat(32) };
const policy = (): OperatingFeePolicy => ({ format: "keryx-operating-fee-policy-v1", network: "eip155:5042",
  storageIdentityDigest: storageIdentityDigest(identity), origin, beneficiary, expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600 });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("requires canonical reviewed configuration bound to the actual storage, origin and distinct beneficiary", () => {
  const value = policy();
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", canonicalJson(value));
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_DIGEST", operatingFeePolicyDigest(value));
  const selected = configuredOperatingFeePolicy(identity, origin, signer);
  expect(selected).toEqual(value); expect(Object.isFrozen(selected)).toBe(true);
  expect(() => configuredOperatingFeePolicy(identity, "https://other.example", signer)).toThrow();
  expect(() => configuredOperatingFeePolicy({ ...identity, storageId: randomUUID() }, origin, signer)).toThrow();
  expect(() => configuredOperatingFeePolicy(identity, origin, beneficiary)).toThrow();
});

it.each(["0x" + "00".repeat(20), "0x" + "AA".repeat(20), "0x1234", beneficiary + " "])("rejects an invalid beneficiary %s", wallet => {
  expect(operatingFeePolicySchema.safeParse({ ...policy(), beneficiary: wallet }).success).toBe(false);
});

it("rejects expired, missing, rewritten and digest-mismatched policies without a fallback", () => {
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", ""); vi.stubEnv("KERYX_OPERATING_FEE_POLICY_DIGEST", "");
  expect(() => configuredOperatingFeePolicy(identity, origin, signer)).toThrow();
  const value = policy();
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_DIGEST", operatingFeePolicyDigest(value));
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", JSON.stringify(value, null, 2));
  expect(() => configuredOperatingFeePolicy(identity, origin, signer)).toThrow();
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_JSON", canonicalJson(value));
  vi.stubEnv("KERYX_OPERATING_FEE_POLICY_DIGEST", "00".repeat(32));
  expect(() => configuredOperatingFeePolicy(identity, origin, signer)).toThrow();
  expect(() => validateOperatingFeePolicy({ ...value, expiresAtSeconds: Math.floor(Date.now() / 1000) }, identity, origin, signer)).toThrow();
  expect(() => validateOperatingFeePolicy({ ...value, network: "eip155:5042002" }, identity, origin, signer)).toThrow();
});

it("caps operating allocations at the integer floor of the existing half-budget pool", () => {
  expect(operatingFeeMaxMicroUsdc("50000")).toBe("25000");
  expect(operatingFeeMaxMicroUsdc("50001")).toBe("25000");
  expect(operatingFeeMaxMicroUsdc("1")).toBe("0");
  expect(() => operatingFeeMaxMicroUsdc("0")).toThrow();
  expect(() => operatingFeeMaxMicroUsdc("0.05")).toThrow();
  expect(() => operatingFeeMaxMicroUsdc("9007199254740992")).toThrow();
});

it("binds a bounded unique exact source set and canonical resource terms to the allocation", () => {
  const terms = { policyDigest: "aa".repeat(32), allocationDigest: "bb".repeat(32), amountMicroUsdc: "25000" };
  const value = { ...terms, sourceUrls: ["https://publisher.example/article"] };
  expect(operatingFeeContextSchema.parse(value)).toEqual(value);
  for (const sourceUrls of [[], ["http://publisher.example/"], ["https://user:pass@publisher.example/"],
    ["https://publisher.example/article#section"], ["https://publisher.example/article", "https://publisher.example/article"],
    Array.from({ length: 33 }, (_, index) => `https://publisher.example/article${index}`),
    Array.from({ length: 4 }, (_, index) => `https://publisher.example/${index}${"a".repeat(1100)}`)])
    expect(operatingFeeContextSchema.safeParse({ ...terms, sourceUrls }).success).toBe(false);
  const path = operatingFeeEndpointPath("query", terms);
  expect(path).toBe(`/api/research/operating-fee?query=query&amount=25000&policy=${terms.policyDigest}&allocation=${terms.allocationDigest}`);
  expect(operatingFeeRequestHash("different-query", terms)).not.toBe(operatingFeeRequestHash("query", terms));
  expect(operatingFeeRequestHash("query", { ...terms, allocationDigest: "cc".repeat(32) })).not.toBe(operatingFeeRequestHash("query", terms));
});
