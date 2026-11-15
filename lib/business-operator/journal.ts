import { lstat, mkdir, realpath } from "node:fs/promises";
import { lstatSync,type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { writeBuyerFile } from "../buyer/journal";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";
import { readPrivatePostgresCredential } from "../db/postgres/private-credential";
import type { OperatorAuditEvent } from "./cycle";

/** Only the selected sealed store's private sibling. No request/environment path,
 * public asset directory, hidden fallback store or new custody is selected. */
export async function operatorAuditDirectory(): Promise<string> {
  const deployment = readRuntimeStorageDeployment();
  if (deployment.backend.kind === "sqlite") {
    const target = join(dirname(deployment.backend.databasePath), ".business-operator-audit");
    await prepareOperatorAuditDirectory(target);
    return target;
  }
  if (deployment.backend.kind !== "postgres") throw new Error("Operator audit storage unavailable");
  // The protected manifest selects both private role files. Their one shared
  // parent is the native private root; a separately protected manifest may live
  // elsewhere. Cutover must retain the existing audit in this selected parent.
  // This function never discovers, migrates, clears or adopts another journal.
  const paths = deployment.backend.credentialPaths, root = dirname(paths.application);
  if (paths.application === paths.reader || dirname(paths.reader) !== root)
    throw new Error("Operator audit storage unavailable");
  const wire = canonicalJson(deployment);
  const application = readPrivatePostgresCredential(paths.application, "keryx_app");
  const reader = readPrivatePostgresCredential(paths.reader, "keryx_reader");
  const originalRoot = await inspectNativeAuditDirectory(root);
  const target = join(root, ".business-operator-audit");
  await prepareOperatorAuditDirectory(target);
  const originalAudit = await inspectNativeAuditDirectory(target);
  await inspectNativeAuditDirectory(root);
  // No await follows these final bindings. A replacement during the last
  // realpath await must not reuse the earlier inode/mode observations, even
  // when the same credential and audit inodes move into a new private root.
  const currentRoot = nativeAuditDirectoryIdentity(lstatSync(root, { bigint: true }));
  const currentAudit = nativeAuditDirectoryIdentity(lstatSync(target, { bigint: true }));
  const currentApplication = readPrivatePostgresCredential(paths.application, "keryx_app");
  const currentReader = readPrivatePostgresCredential(paths.reader, "keryx_reader");
  if (canonicalJson(readRuntimeStorageDeployment()) !== wire || currentRoot !== originalRoot || currentAudit !== originalAudit
    || currentApplication.fingerprint !== application.fingerprint || currentReader.fingerprint !== reader.fingerprint)
    throw new Error("Operator audit storage unavailable");
  return target;
}

/** Read-only validation; unlike preparation, this never creates a private root. */
async function inspectNativeAuditDirectory(directory: string): Promise<string> {
  if (!isAbsolute(directory) || resolve(directory) !== directory || directory.includes("\0"))
    throw new Error("Operator audit directory refused");
  let current = parse(directory).root;
  for (const part of relative(current, directory).split(sep)) {
    current = join(current, part);
    const stat = await lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Operator audit directory refused");
  }
  const stat = await lstat(directory, { bigint: true });
  const identity = nativeAuditDirectoryIdentity(stat);
  const resolved = await realpath(directory);
  if (process.platform === "win32" ? resolved.toLowerCase() !== directory.toLowerCase() : resolved !== directory)
    throw new Error("Operator audit directory refused");
  // Creating the audit child may change parent mtime/nlink; identity and private
  // ownership/mode must stay exact across that preparation await.
  return identity;
}

function nativeAuditDirectoryIdentity(stat: BigIntStats): string {
  if (stat.isSymbolicLink() || !stat.isDirectory() || (process.platform !== "win32" &&
    (!process.getuid || stat.uid !== BigInt(process.getuid()) || (stat.mode & BigInt(0o077)) !== BigInt(0))))
    throw new Error("Operator audit directory refused");
  return [stat.dev, stat.ino, stat.uid, stat.mode].join(":");
}

export async function prepareOperatorAuditDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory) || resolve(directory) !== directory) throw new Error("Operator audit directory refused");
  let current = parse(directory).root;
  const parts = relative(current, directory).split(sep);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    if (index === parts.length - 1) {
      await mkdir(current, { mode: 0o700 }).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory() ||
      (index === parts.length - 1 && process.platform !== "win32" && (stat.mode & 0o077) !== 0))
      throw new Error("Operator audit directory refused");
  }
  const resolved = await realpath(directory);
  if (process.platform === "win32" ? resolved.toLowerCase() !== directory.toLowerCase() : resolved !== directory)
    throw new Error("Operator audit directory refused");
}

/** Exclusive immutable-by-writer records, file/directory fsync, checksum for
 * accidental corruption. This is private evidence, not a signed payment receipt. */
export async function writeOperatorAudit(directory: string, event: OperatorAuditEvent): Promise<void> {
  await prepareOperatorAuditDirectory(directory);
  if (!/^[a-f0-9-]{36}$/.test(event.cycleId) || !["decision", "outcome"].includes(event.phase))
    throw new Error("Operator audit event refused");
  const digest = createHash("sha256").update(canonicalJson(event)).digest("hex");
  await writeBuyerFile(directory, `${event.cycleId}-${event.phase}.json`, { event, digest });
}
