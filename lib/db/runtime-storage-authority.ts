import type { KeryxDB } from "./keryx-db";
import { readRuntimeStorageDeployment } from "./runtime-storage-config";
import { storageIdentityDigest } from "./storage-identity";

/** Individually verified injected stores must also belong to the pinned runtime deployment. */
export function assertRuntimeStorageAuthority(db: Pick<KeryxDB, "getStorageIdentity">) {
  const deployment = readRuntimeStorageDeployment();
  try {
    if (storageIdentityDigest(db.getStorageIdentity()) !== storageIdentityDigest(deployment.identity)) throw new Error();
  } catch { throw new Error("Payment storage identity does not match runtime deployment"); }
  return deployment;
}
