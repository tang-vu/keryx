import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import { validateStorageIdentity, type StorageIdentity } from "./storage-identity";

/** Node-only authority configuration. Never import into browser/shared config. */
export const STORAGE_MANIFEST_MAX_BYTES = 8192;
export type StorageBackend = Readonly<{ kind: "sqlite"; databasePath: string } | { kind: "supabase"; url: string }>;
export interface StorageDeploymentManifest {
  readonly format: "keryx-storage-deployment-v1";
  readonly identity: Readonly<StorageIdentity>;
  readonly backend: StorageBackend;
}
export class RuntimeStorageRefused extends Error {
  constructor() { super("Storage deployment configuration unavailable"); }
}
function refuse(): never { throw new RuntimeStorageRefused(); }
function exactKeys(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys) refuse();
  return value as Record<string, unknown>;
}
function targetStat(target: string) {
  if (target.length > 2048 || !isAbsolute(target) || resolve(target) !== target || target.includes("\0")) refuse();
  const root = parse(target).root;
  let current = root;
  for (const part of relative(root, target).split(sep)) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) refuse();
  }
  const stat = lstatSync(target, { bigint: true });
  const resolved = realpathSync(target);
  if (!stat.isFile() || (process.platform === "win32" ? resolved.toLowerCase() !== target.toLowerCase() : resolved !== target)) refuse();
  return stat;
}
/** Expected artifact inspection may describe a lost source; it never opens or accepts that store. */
function declaredSqliteTarget(target: string): void {
  if (target.length > 2048 || !isAbsolute(target) || resolve(target) !== target || target.includes("\0")) refuse();
  const root = parse(target).root, parts = relative(root, target).split(sep);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      refuse();
    }
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) refuse();
  }
}
function statIdentity(stat: ReturnType<typeof targetStat>) {
  return [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs].join(":");
}

/** No fallback, environment-file loader, target discovery, identity adoption, or enrollment. */
export function inspectStorageDeploymentManifest(env: Readonly<Record<string, string | undefined>>): Readonly<StorageDeploymentManifest> {
  let descriptor: number | undefined;
  try {
    const target = env.KERYX_STORAGE_MANIFEST;
    if (!target) refuse();
    const before = targetStat(target);
    if (before.size < BigInt(1) || before.size > BigInt(STORAGE_MANIFEST_MAX_BYTES)) refuse();
    descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor, { bigint: true });
    if (statIdentity(before) !== statIdentity(opened)) refuse();
    // Fixed allocation; refuse growth without fetching arbitrary unbounded values.
    const buffer = Buffer.alloc(STORAGE_MANIFEST_MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, bytes);
      if (!count) break;
      bytes += count;
    }
    if (bytes > STORAGE_MANIFEST_MAX_BYTES || BigInt(bytes) !== before.size ||
      statIdentity(fstatSync(descriptor, { bigint: true })) !== statIdentity(before) ||
      statIdentity(targetStat(target)) !== statIdentity(before)) refuse();
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytes));
    const text = decoded.endsWith("\n") ? decoded.slice(0, -1) : decoded;
    const parsed: unknown = JSON.parse(text);
    // Exact canonical wire format rejects duplicate keys, including conflicting duplicates.
    if (canonicalJson(parsed) !== text) refuse();
    const manifest = exactKeys(parsed, "backend,format,identity");
    if (manifest.format !== "keryx-storage-deployment-v1") refuse();
    const identity = validateStorageIdentity(manifest.identity);
    let backend: StorageBackend;
    const selected = manifest.backend as { kind?: unknown };
    if (selected?.kind === "sqlite") {
      const fields = exactKeys(selected, "databasePath,kind");
      if (typeof fields.databasePath !== "string") refuse();
      declaredSqliteTarget(fields.databasePath);
      backend = Object.freeze({ kind: "sqlite", databasePath: fields.databasePath });
    } else if (selected?.kind === "supabase") {
      const fields = exactKeys(selected, "kind,url");
      if (typeof fields.url !== "string" || fields.url.length > 2048) refuse();
      const url = new URL(fields.url);
      if (url.protocol !== "https:" || url.username || url.password || url.origin !== fields.url) refuse();
      backend = Object.freeze({ kind: "supabase", url: fields.url });
    } else refuse();
    return Object.freeze({ format: "keryx-storage-deployment-v1", identity, backend });
  } catch { throw new RuntimeStorageRefused(); }
  finally { if (descriptor !== undefined) { try { closeSync(descriptor); } catch {} } }
}

let runtimeSnapshot: { manifestPath: string; deployment: Readonly<StorageDeploymentManifest> } | undefined;

/** Runtime identity is pinned for this module/process lifetime. Changed configuration refuses; restart under drain. */
export function readRuntimeStorageDeployment(): Readonly<StorageDeploymentManifest> {
  const current = inspectStorageDeploymentManifest(process.env);
  if (process.env.KERYX_FORCE_OFFLINE !== undefined && !["", "0", "1"].includes(process.env.KERYX_FORCE_OFFLINE)) refuse();
  if (current.identity.authorityMode !== "testnet-offline" && process.env.KERYX_FORCE_OFFLINE === "1") refuse();
  if (current.backend.kind === "sqlite") {
    try { targetStat(current.backend.databasePath); } catch { refuse(); }
    if (process.env.KERYX_SQLITE_PATH !== undefined && process.env.KERYX_SQLITE_PATH !== current.backend.databasePath) refuse();
  } else if (process.env.NEXT_PUBLIC_SUPABASE_URL !== current.backend.url || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) refuse();
  const manifestPath = process.env.KERYX_STORAGE_MANIFEST!;
  if (!runtimeSnapshot) runtimeSnapshot = { manifestPath, deployment: current };
  else if (manifestPath !== runtimeSnapshot.manifestPath || canonicalJson(current) !== canonicalJson(runtimeSnapshot.deployment)) refuse();
  return runtimeSnapshot.deployment;
}

export function requireRuntimeStorageMode(mode: StorageIdentity["authorityMode"]): void {
  if (readRuntimeStorageDeployment().identity.authorityMode !== mode) refuse();
}
