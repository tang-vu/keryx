import { describe, expect, it } from "vitest";
import { STORAGE_TESTNET_PROFILE_DIGEST, storageIdentityDigest, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
export const identity: StorageIdentity = { format: "keryx-storage-identity-v1", deploymentId: "12345678-1234-4123-8123-123456789abc",
  storageId: "12345678-1234-4123-8123-123456789abd", network: "eip155:5042002", authorityMode: "testnet-real",
  profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, enrollmentId: "12345678-1234-4123-8123-123456789abe",
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) };
describe("immutable exact storage identity", () => {
  it("canonicalizes key order without rewriting values", () => {
    const reversed = Object.fromEntries(Object.entries(identity).reverse());
    expect(storageIdentityDigest(reversed)).toBe(storageIdentityDigest(identity));
    expect(Object.isFrozen(validateStorageIdentity(identity))).toBe(true);
  });
  it.each(["deploymentId", "storageId", "enrollmentId", "provenanceDigest"])("rejects coercible non-string %s", field => {
    expect(() => validateStorageIdentity({ ...identity, [field]: { toString: () => identity[field as keyof StorageIdentity] } })).toThrow();
  });
  it.each([{ network: "eip155:5042" }, { authorityMode: "real" }, { profileDigest: "b".repeat(64) },
    { deploymentId: identity.deploymentId.toUpperCase() }, { enrolledAt: "2026-10-01" }, { extra: true },
    { format: "keryx-storage-identity-v2" }])("refuses malformed or foreign identity %j", mutation => {
    expect(() => validateStorageIdentity({ ...identity, ...mutation })).toThrow();
  });
  it("rejects getters and non-JSON object prototypes", () => {
    const getter = { ...identity }; Object.defineProperty(getter, "deploymentId", { enumerable: true, get: () => identity.deploymentId });
    expect(() => validateStorageIdentity(getter)).toThrow();
    expect(() => validateStorageIdentity(Object.assign(Object.create({ private: true }), identity))).toThrow();
  });
});
