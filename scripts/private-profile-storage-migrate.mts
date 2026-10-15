import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../lib/canonical-json";
import { inspectStorageDeploymentManifest } from "../lib/db/runtime-storage-config";
import { storageIdentityDigest, type StorageIdentity } from "../lib/db/storage-identity";
import { assertStorageCreationParent, holdStorageTarget } from "../lib/db/storage-identity-sqlite";
import { STORAGE_SNAPSHOT_LIMITS as limits } from "../lib/db/storage-identity-snapshot";
import { migratePrivateProfilesStorage, privateProfilesMigrationProfiles,
  snapshotPrivateProfilesStorage } from "../lib/db/private-profiles-storage-migration";
import { NATIVE_USER_DOMAIN_TABLES } from "../lib/db/native-user-domain-schema-data";
import { migrateTopicWatchesStorage, topicWatchesMigrationProfiles } from "../lib/db/topic-watches-storage-migration";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function fail(): never { throw new Error("Private profile storage migration refused; preserve originals, backup and stopped writers"); }
function openSnapshot(file: string, identity: StorageIdentity, profiles: readonly string[]) {
  const held = holdStorageTarget(file);
  let db: DatabaseSync | undefined;
  try {
    if (fstatSync(held.descriptor).size > limits.fileBytes) fail();
    db = new DatabaseSync(file, { readOnly: true, allowExtension: false }); db.exec("PRAGMA busy_timeout=1000; BEGIN");
    held.verify(); const value = snapshotPrivateProfilesStorage(db, identity, profiles); held.verify();
    return { db, held, value, close() { try { db!.close(); } finally { held.close(); } } };
  } catch (error) { try { db?.close(); } finally { held.close(); } throw error; }
}
function freshFile(file: string): number {
  assertStorageCreationParent(file);
  return openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
}
function syncDirectory(file: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(dirname(file), constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
export function inspectPrivateProfileStorage(manifestFile: string) {
  const manifest = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: manifestFile });
  if (manifest.backend.kind !== "sqlite" || manifest.identity.authorityMode !== "mainnet-real") fail();
  const pairs = [...privateProfilesMigrationProfiles(), ...topicWatchesMigrationProfiles()];
  const snapshot = openSnapshot(manifest.backend.databasePath, manifest.identity, pairs.flat());
  try { return { format: "keryx-private-profile-storage-inspection-v1", manifestDigest: sha(canonicalJson(manifest)),
    identityDigest: storageIdentityDigest(manifest.identity), targetDigest: snapshot.held.identity,
    schemaDigest: snapshot.value.schemaDigest, snapshotDigest: sha(canonicalJson(snapshot.value)),
    rows: snapshot.value.rows, signingResumeAuthorized: false }; }
  finally { snapshot.close(); }
}
export interface PrivateProfileMigrationOptions {
  manifest: string; expectedManifestDigest: string; expectedIdentityDigest: string;
  backup: string; receipt: string; writersStopped: boolean;
}
/** Explicit operator command only; the flag records established writer-stop evidence. */
export async function migratePrivateProfileStorage(options: PrivateProfileMigrationOptions) {
  if (options.writersStopped !== true || !/^[a-f0-9]{64}$/.test(options.expectedManifestDigest)
    || !/^[a-f0-9]{64}$/.test(options.expectedIdentityDigest)) fail();
  const manifest = inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: options.manifest });
  if (manifest.backend.kind !== "sqlite" || manifest.identity.authorityMode !== "mainnet-real" || sha(canonicalJson(manifest)) !== options.expectedManifestDigest
    || storageIdentityDigest(manifest.identity) !== options.expectedIdentityDigest) fail();
  const recheck = () => { if (canonicalJson(inspectStorageDeploymentManifest({ KERYX_STORAGE_MANIFEST: options.manifest })) !== canonicalJson(manifest)) fail(); };
  const historicalPairs = topicWatchesMigrationProfiles();
  const pairs = [...privateProfilesMigrationProfiles(), ...historicalPairs], profiles = pairs.flat();
  const source = openSnapshot(manifest.backend.databasePath, manifest.identity, profiles);
  let receiptFd: number | undefined, outputFd: number | undefined, outputHeld: ReturnType<typeof holdStorageTarget> | undefined, sourceClosed = false;
  const append = (record: unknown) => {
    const bytes = Buffer.from(canonicalJson(record) + "\n"); let offset = 0;
    while (offset < bytes.length) offset += writeSync(receiptFd!, bytes, offset, bytes.length - offset);
    fsyncSync(receiptFd!); syncDirectory(options.receipt);
  };
  try {
    receiptFd = freshFile(options.receipt); outputFd = freshFile(options.backup); outputHeld = holdStorageTarget(options.backup);
    const created = fstatSync(outputFd, { bigint: true }), held = fstatSync(outputHeld.descriptor, { bigint: true });
    if (created.dev !== held.dev || created.ino !== held.ino || created.birthtimeNs !== held.birthtimeNs) fail();
    await backup(source.db, options.backup, { rate: 100, progress() {
      source.held.verify(); outputHeld!.verify(); if (fstatSync(outputFd!).size > limits.fileBytes) fail();
    } });
    outputHeld.verify(); source.held.verify(); fsyncSync(outputFd); syncDirectory(options.backup);
    const copied = openSnapshot(options.backup, manifest.identity, profiles);
    try { if (canonicalJson(copied.value) !== canonicalJson(source.value)) fail(); } finally { copied.close(); }
    recheck();
    append({ format: "keryx-private-profile-storage-migration-v1", phase: "backup-verified", manifestDigest: options.expectedManifestDigest,
      identityDigest: options.expectedIdentityDigest, sourceTargetDigest: source.held.identity, backupTargetDigest: outputHeld.identity,
      beforeSnapshotDigest: sha(canonicalJson(source.value)), signingResumeAuthorized: false });
    source.close(); sourceClosed = true;
    const migrationTarget = holdStorageTarget(manifest.backend.databasePath);
    let result: ReturnType<typeof migratePrivateProfilesStorage>;
    try {
      if (migrationTarget.identity !== source.held.identity) fail();
      // Dispatch only after this same verified backup. The helper rechecks the
      // exact profile under EXCLUSIVE and the callback compares the full source.
      const migrate = historicalPairs.some(([before, after]) => before !== after && sha(before) === source.value.schemaDigest)
        ? migrateTopicWatchesStorage : migratePrivateProfilesStorage;
      result = migrate(manifest.backend.databasePath, manifest.identity, db => {
        migrationTarget.verify(); recheck(); outputHeld!.verify();
        if (canonicalJson(snapshotPrivateProfilesStorage(db, manifest.identity, profiles)) !== canonicalJson(source.value)) fail();
        const retained = openSnapshot(options.backup, manifest.identity, profiles);
        try { if (canonicalJson(retained.value) !== canonicalJson(source.value)) fail(); } finally { retained.close(); }
      });
    } finally { migrationTarget.close(); }
    const after = openSnapshot(manifest.backend.databasePath, manifest.identity, pairs.map(pair => pair[1]));
    try {
      recheck(); outputHeld.verify();
      if (after.held.identity !== source.held.identity) fail();
      const retained = { ...after.value.tables };
      for (const table of NATIVE_USER_DOMAIN_TABLES) if (!(table in source.value.tables)) {
        if (retained[table]?.rows !== (table === "deliverable_acceptance_store" ? 1 : 0)) fail();
        delete retained[table];
      }
      if (canonicalJson(retained) !== canonicalJson(source.value.tables)) fail();
      const retainedBackup = openSnapshot(options.backup, manifest.identity, profiles);
      try { if (canonicalJson(retainedBackup.value) !== canonicalJson(source.value)) fail(); }
      finally { retainedBackup.close(); }
      const receipt = { ...result, phase: "migration-verified", manifestDigest: options.expectedManifestDigest,
        identityDigest: options.expectedIdentityDigest, beforeSnapshotDigest: sha(canonicalJson(source.value)), afterSnapshotDigest: sha(canonicalJson(after.value)) };
      append(receipt); return receipt;
    } finally { after.close(); }
  } finally {
    try { if (!sourceClosed) source.close(); } finally {
      try { outputHeld?.close(); } finally {
        try { if (outputFd !== undefined) closeSync(outputFd); } finally { if (receiptFd !== undefined) closeSync(receiptFd); }
      }
    }
  }
}
export async function runPrivateProfileStorageCli(args: string[]) {
  if (args.length === 3 && args[0] === "inspect" && args[1] === "--manifest") return inspectPrivateProfileStorage(args[2]);
  const names = ["--manifest", "--expected-manifest", "--expected-identity", "--backup", "--receipt"];
  if (args.length !== 12 || args[0] !== "migrate" || args[11] !== "--writers-stopped" || names.some((name, index) => args[index * 2 + 1] !== name)) fail();
  return migratePrivateProfileStorage({ manifest: args[2], expectedManifestDigest: args[4], expectedIdentityDigest: args[6],
    backup: args[8], receipt: args[10], writersStopped: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runPrivateProfileStorageCli(process.argv.slice(2)))); }
  catch { console.error("Private profile migration refused or acknowledgement incomplete; keep writers stopped and preserve all evidence."); process.exitCode = 1; }
}
