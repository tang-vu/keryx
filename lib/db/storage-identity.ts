import { createHash } from "node:crypto";

/** Public immutable testnet contract profile, independent of environment and secret presence. */
export const STORAGE_TESTNET_PROFILE = Object.freeze({ format: "keryx-storage-profile-v1", chainId: 5042002,
  network: "eip155:5042002", usdc: "0x3600000000000000000000000000000000000000",
  gatewayWallet: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
  gatewayMinter: "0x0022222abe238cc2c7bb1f21003f0a260052475b", circleEnvironment: "testnet", cctpDomain: 26 });
export const STORAGE_TESTNET_PROFILE_DIGEST = createHash("sha256").update(JSON.stringify(STORAGE_TESTNET_PROFILE)).digest("hex");
export interface StorageIdentity {
  format: "keryx-storage-identity-v1";
  deploymentId: string;
  storageId: string;
  network: "eip155:5042002";
  authorityMode: "testnet-real" | "testnet-offline";
  profileDigest: string;
  enrollmentId: string;
  enrolledAt: string;
  provenanceDigest: string;
}
export class StorageIdentityRefused extends Error {
  constructor(readonly reason: string) { super(`Storage identity refused: ${reason}`); }
}
export function refuseStorage(reason: string): never { throw new StorageIdentityRefused(reason); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const STORAGE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
/** Strict validation returns a canonical copy; no normalization silently changes identity. */
export function validateStorageIdentity(input: unknown): Readonly<StorageIdentity> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Object.getOwnPropertySymbols(input).length ||
      Object.values(Object.getOwnPropertyDescriptors(input)).some(descriptor => !descriptor.enumerable || !("value" in descriptor))) refuseStorage("invalid_identity");
  const value = input as StorageIdentity;
  if (Object.keys(value).sort().join(",") !== "authorityMode,deploymentId,enrolledAt,enrollmentId,format,network,profileDigest,provenanceDigest,storageId" ||
      value.format !== "keryx-storage-identity-v1" || value.network !== "eip155:5042002" ||
      !["testnet-real", "testnet-offline"].includes(value.authorityMode) ||
      typeof value.deploymentId !== "string" || !UUID.test(value.deploymentId) ||
      typeof value.storageId !== "string" || !UUID.test(value.storageId) ||
      typeof value.enrollmentId !== "string" || !UUID.test(value.enrollmentId) ||
      value.profileDigest !== STORAGE_TESTNET_PROFILE_DIGEST || typeof value.provenanceDigest !== "string" || !STORAGE_DIGEST_PATTERN.test(value.provenanceDigest) ||
      typeof value.enrolledAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.enrolledAt) ||
      !Number.isFinite(Date.parse(value.enrolledAt)) || new Date(value.enrolledAt).toISOString() !== value.enrolledAt) refuseStorage("invalid_identity");
  return Object.freeze({ format: value.format, deploymentId: value.deploymentId, storageId: value.storageId,
    network: value.network, authorityMode: value.authorityMode, profileDigest: value.profileDigest,
    enrollmentId: value.enrollmentId, enrolledAt: value.enrolledAt, provenanceDigest: value.provenanceDigest });
}
export function storageIdentityDigest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(validateStorageIdentity(input))).digest("hex");
}
