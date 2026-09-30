import { randomUUID } from "node:crypto";
import { createSqliteStorage } from "./storage-identity-provision";
import { STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";

/** Explicit synthetic identity, not inferred from NODE_ENV or missing funding secrets. */
export function syntheticStorageIdentity(authorityMode: StorageIdentity["authorityMode"]): StorageIdentity {
  return { format: "keryx-storage-identity-v1", deploymentId: randomUUID(), storageId: randomUUID(),
    network: "eip155:5042002", authorityMode, profileDigest: STORAGE_TESTNET_PROFILE_DIGEST,
    enrollmentId: randomUUID(), enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) };
}
export async function provisionSyntheticStorage(file: string, authorityMode: StorageIdentity["authorityMode"]): Promise<StorageIdentity> {
  const identity = syntheticStorageIdentity(authorityMode);
  await createSqliteStorage(file, identity);
  return identity;
}
