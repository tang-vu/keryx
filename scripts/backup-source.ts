import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { inspectStorageDeploymentManifest } from "../lib/db/runtime-storage-config";
import { backupStorageInChild } from "../lib/db/storage-identity-backup-core";
import { holdStorageTarget, assertStorageIdentity, assertStorageFences } from "../lib/db/storage-identity-sqlite";
import { STORAGE_SNAPSHOT_LIMITS } from "../lib/db/storage-identity-snapshot";
import { canonicalJson } from "../lib/canonical-json";
import { assertCapacity, BackupHeld, usableBytes } from "./backup-capacity";
import { assertProtectedAncestors, digest, holdPrivateFile, readPrivate } from "./backup-persistence";

/** Readonly capture capability only. It never selects an application adapter,
 * initializes a schema, grants custody, or relabels an unenrolled database. */
export function prepareBackupSource(configured: Readonly<Record<string, string | undefined>>) {
  const env = Object.freeze({ ...configured });
  const deployment = env.KERYX_STORAGE_MANIFEST ? inspectStorageDeploymentManifest(env) : null;
  const mainnet = deployment?.identity.authorityMode === "mainnet-real";
  const real = deployment && deployment.identity.authorityMode !== "testnet-offline";
  const network = mainnet ? "arc" : "arcTestnet";
  if (env.KERYX_NETWORK !== network || env.NEXT_PUBLIC_KERYX_NETWORK !== network ||
      env.KERYX_FORCE_OFFLINE !== undefined && !["", "0", "1"].includes(env.KERYX_FORCE_OFFLINE) ||
      deployment && deployment.backend.kind !== "sqlite" ||
      !deployment && env.KERYX_FORCE_OFFLINE !== "1" ||
      deployment && deployment.identity.authorityMode !== "testnet-offline" && env.KERYX_FORCE_OFFLINE === "1" ||
      real && process.platform !== "linux") throw new BackupHeld("selection");
  const file = deployment?.backend.kind === "sqlite" ? deployment.backend.databasePath : path.resolve(env.KERYX_SQLITE_PATH ?? "data/keryx.sqlite");
  if (deployment && env.KERYX_SQLITE_PATH !== undefined && env.KERYX_SQLITE_PATH !== file) throw new BackupHeld("selection");
  const held = holdStorageTarget(file);
  let privateHeld: ReturnType<typeof holdPrivateFile> | undefined, manifestHeld: ReturnType<typeof holdPrivateFile> | undefined;
  let db: DatabaseSync | undefined;
  try {
    if (deployment) manifestHeld = holdPrivateFile(env.KERYX_STORAGE_MANIFEST!);
    if (real) { assertProtectedAncestors(file); assertProtectedAncestors(env.KERYX_STORAGE_MANIFEST!); privateHeld = holdPrivateFile(file); }
    db = new DatabaseSync(file, { readOnly: true, allowExtension: false }); held.verify();
    db.exec("PRAGMA busy_timeout=10000; BEGIN");
    if (deployment) { assertStorageIdentity(db, deployment.identity); assertStorageFences(db, deployment.identity); }
    else if (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='keryx_storage_identity'").get()) {
      throw new BackupHeld("selection"); // Manifest omission cannot turn a marked store into legacy offline.
    }
    const pageSize = Number(db.prepare("PRAGMA page_size").get()?.page_size), pages = Number(db.prepare("PRAGMA page_count").get()?.page_count);
    const measured = pageSize * pages, maximum = deployment ? STORAGE_SNAPSHOT_LIMITS.fileBytes : 256 * 1024 ** 2;
    if (!Number.isSafeInteger(measured) || measured < 1 || measured > maximum) throw new BackupHeld("source-size");
    const manifestDigest = deployment ? digest(readPrivate(env.KERYX_STORAGE_MANIFEST!, 8192)) : null;
    const verify = () => { held.verify(); privateHeld?.verify(); manifestHeld?.verify(); if (deployment &&
      (digest(readPrivate(env.KERYX_STORAGE_MANIFEST!, 8192)) !== manifestDigest || canonicalJson(inspectStorageDeploymentManifest(env)) !== canonicalJson(deployment))) throw new BackupHeld("selection"); };
    verify();
    if (deployment) { db.close(); db = undefined; } // Its capture primitive owns its own short consistent transaction.
    let consumed = false;
    return { file, enrolled: !!deployment, storageManifestSha256: manifestDigest, sourceTargetDigest: held.identity,
      // The existing enrolled primitive independently pins its own transaction;
      // reserve its complete unchanged64MiB ceiling, not an earlier measurement.
      plainBytes: deployment ? maximum : measured,
      async capture(output: string) {
        if (consumed) throw new BackupHeld("interrupted"); consumed = true;
        verify(); assertCapacity(usableBytes(path.dirname(output)));
        if (deployment) {
          const receipt = await backupStorageInChild({ file, identity: deployment.identity, freshOutput: output });
          if (receipt.sourceTargetDigest !== held.identity) throw new BackupHeld("selection");
          verify(); return receipt;
        }
        const fd = fs.openSync(output, "wx", 0o600);
        let target: ReturnType<typeof holdStorageTarget> | undefined;
        try {
          target = holdStorageTarget(output);
          await backup(db!, output, { rate: 100, progress: ({ totalPages }) => {
            verify(); target!.verify(); assertCapacity(usableBytes(path.dirname(output)));
            if (totalPages * pageSize > measured || fs.fstatSync(fd).size > measured) throw new BackupHeld("source-size");
          } });
          target.verify(); fs.fsyncSync(fd); verify();
          const check = new DatabaseSync(output, { readOnly: true, allowExtension: false });
          try { if (check.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok" || check.prepare("PRAGMA foreign_key_check").all().length) throw new BackupHeld("failed"); }
          finally { check.close(); }
          return null;
        } finally { try { target?.close(); fs.closeSync(fd); } finally { db!.close(); db = undefined; } }
      }, verify, close() { try { db?.close(); } finally { try { manifestHeld?.close(); privateHeld?.close(); } finally { held.close(); } } } };
  } catch (error) { try { db?.close(); } finally { try { manifestHeld?.close(); privateHeld?.close(); } finally { held.close(); } } throw error; }
}
