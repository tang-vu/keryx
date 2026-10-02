import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { readRuntimeStorageDeployment } from "./runtime-storage-config";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter, assertEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter } from "./enrolled-supabase-adapter";
import { storagePaymentProfile, refuseStorage } from "./storage-identity";
import type { KeryxDB } from "./keryx-db";

/** Application role only: verified storage access grants neither wallet custody nor funding-executor authority. */
export async function createApplicationStorage(): Promise<KeryxDB | undefined> {
  const profile = config.profile;
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) refuseStorage("invalid_profile");
  // Preserve the existing testnet selector when no explicit storage deployment is declared.
  if (profile === ARC_TESTNET_PROFILE && process.env.KERYX_STORAGE_MANIFEST === undefined) return undefined;
  const deployment = readRuntimeStorageDeployment();
  if (storagePaymentProfile(deployment.identity) !== profile) refuseStorage("identity_mismatch");
  if (profile === ARC_TESTNET_PROFILE) return undefined;
  if (deployment.identity.authorityMode !== "mainnet-real") refuseStorage("identity_mismatch");
  return deployment.backend.kind === "sqlite" ? createEnrolledSqliteAdapter() : createEnrolledSupabaseAdapter();
}
/** Operator observation role: use only the sealed selected store's read-only facade.
 * No ordinary initialization, schema migration or application writer is admitted. */
export async function createReadonlyApplicationStorage(): Promise<KeryxDB | undefined> {
  if (arguments.length) refuseStorage("invalid_operation");
  const profile = config.profile;
  if (profile !== ARC_MAINNET_PROFILE && profile !== ARC_TESTNET_PROFILE) refuseStorage("invalid_profile");
  if (profile === ARC_TESTNET_PROFILE && process.env.KERYX_STORAGE_MANIFEST === undefined) return undefined;
  const deployment = readRuntimeStorageDeployment();
  if (storagePaymentProfile(deployment.identity) !== profile) refuseStorage("identity_mismatch");
  if (profile === ARC_MAINNET_PROFILE && deployment.identity.authorityMode !== "mainnet-real") refuseStorage("identity_mismatch");
  return deployment.backend.kind === "sqlite" ? createReadonlyEnrolledSqliteAdapter() : createReadonlyEnrolledSupabaseAdapter();
}
/** Verify the already-selected application facade; this does not construct or
 * select another datastore, custody account or funding authority. */
export function applicationSqliteIdentity(db: KeryxDB, access: "read" | "write" = "read") {
  return assertEnrolledSqliteAdapter(db, access);
}
