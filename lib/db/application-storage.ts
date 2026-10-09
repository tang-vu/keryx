import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { readRuntimeStorageDeployment } from "./runtime-storage-config";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter, assertEnrolledSqliteAdapter } from "./enrolled-sqlite-adapter";
import { createEnrolledSupabaseAdapter, createReadonlyEnrolledSupabaseAdapter, closeEnrolledSupabaseAdapter } from "./enrolled-supabase-adapter";
import { storagePaymentProfile, refuseStorage } from "./storage-identity";
import type { KeryxDB } from "./keryx-db";

const readonlyClosers = new WeakMap<KeryxDB, () => void>();

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
  if (deployment.backend.kind === "sqlite") {
    const reader = await createReadonlyEnrolledSqliteAdapter();
    readonlyClosers.set(reader, () => reader.close());
    return reader;
  }
  const reader = await createReadonlyEnrolledSupabaseAdapter();
  readonlyClosers.set(reader, () => closeEnrolledSupabaseAdapter(reader));
  return reader;
}
/** Terminal disposal only for this boundary's selected read-only readers. No
 * selector, constructor or renewed financial/storage authority is exposed. */
export function closeReadonlyApplicationStorage(reader: KeryxDB): void {
  if (arguments.length !== 1) refuseStorage("invalid_operation");
  const close = readonlyClosers.get(reader);
  if (!close) refuseStorage("invalid_operation");
  try { close(); } finally { readonlyClosers.delete(reader); }
}
/** Verify the already-selected application facade; this does not construct or
 * select another datastore, custody account or funding authority. */
export function applicationSqliteIdentity(db: KeryxDB, access: "read" | "write" = "read") {
  return assertEnrolledSqliteAdapter(db, access);
}
