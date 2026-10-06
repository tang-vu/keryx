import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../canonical-json";
import { writeBuyerFile } from "../buyer/journal";
import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";
import type { OperatorAuditEvent } from "./cycle";

/** Only the selected sealed store's private sibling. No request/environment path,
 * public asset directory, hidden fallback store or new custody is selected. */
export async function operatorAuditDirectory(): Promise<string> {
  const deployment = readRuntimeStorageDeployment();
  if (deployment.backend.kind !== "sqlite") throw new Error("Operator audit storage unavailable");
  const target = join(dirname(deployment.backend.databasePath), ".business-operator-audit");
  await prepareOperatorAuditDirectory(target);
  return target;
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
