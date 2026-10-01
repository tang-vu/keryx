import { closeSync, existsSync, fstatSync, lstatSync, openSync, readlinkSync, readSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ProvenanceLimits } from "./storage-provenance";
import { SNAPSHOT_PROCESS_BYTES, SNAPSHOT_UNIT_PATTERN } from "./storage-provenance-containment";

/** Operator-declared offline input, never proof that no other owner can write it. */
export function checkSnapshotSidecars(target: string): void {
  if (["-wal", "-shm", "-journal"].some(suffix => existsSync(`${target}${suffix}`))) throw new Error("snapshot_sidecar");
}

export function checkSnapshotUnchanged(target: string, descriptor: number, size: bigint, mtimeNs: bigint): void {
  checkSnapshotSidecars(target);
  const opened = fstatSync(descriptor, { bigint: true }), named = lstatSync(target, { bigint: true });
  if (opened.size !== size || opened.mtimeNs !== mtimeNs || named.size !== size || named.mtimeNs !== mtimeNs) throw new Error("snapshot_changed");
}

export function validateSnapshotHeader(descriptor: number): void {
  const header = Buffer.alloc(100);
  if (readSync(descriptor, header, 0, header.length, 0) !== header.length ||
    header.subarray(0, 16).toString("ascii") !== "SQLite format 3\0") throw new Error("snapshot_header");
  const encoded = header.readUInt16BE(16), pageSize = encoded === 1 ? 65536 : encoded;
  const bytes = fstatSync(descriptor, { bigint: true }).size;
  // This profile requires a finalized rollback-journal snapshot, not a detached WAL main file.
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 ||
    header[18] !== 1 || header[19] !== 1 || pageSize - header[20] < 480 ||
    bytes % BigInt(pageSize) !== BigInt(0) || header.readUInt32BE(24) !== header.readUInt32BE(92) ||
    header.readUInt32BE(28) === 0 || BigInt(header.readUInt32BE(28)) * BigInt(pageSize) !== bytes) throw new Error("snapshot_header");
}

function boundedKernelText(path: string, bytes = 4096): string {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(bytes + 1), length = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (length > bytes) throw new Error("native_limits_unavailable");
    return buffer.subarray(0, length).toString("utf8").trim();
  } finally { closeSync(descriptor); }
}

/** Verify actual kernel-enforced limits and service membership before opening the target. */
export function verifySnapshotContainment(unit?: string): void {
  if (process.platform !== "linux" || !unit || !SNAPSHOT_UNIT_PATTERN.test(unit)) throw new Error("native_limits_unavailable");
  const relative = `/system.slice/${unit}`;
  if (boundedKernelText("/proc/self/cgroup") !== `0::${relative}`) throw new Error("native_limits_unavailable");
  const root = `/sys/fs/cgroup${relative}`;
  if (boundedKernelText(`${root}/memory.max`) !== String(SNAPSHOT_PROCESS_BYTES) ||
    boundedKernelText(`${root}/memory.swap.max`) !== "0" || boundedKernelText(`${root}/pids.max`) !== "32" ||
    !/^NoNewPrivs:\s+1$/m.test(boundedKernelText("/proc/self/status", 16384)) ||
    readlinkSync("/proc/self/ns/net") === readlinkSync("/proc/1/ns/net")) throw new Error("native_limits_unavailable");
}

export function configureSnapshotConnection(db: DatabaseSync, limits: ProvenanceLimits): void {
  if ([...db.prepare("PRAGMA compile_options").iterate()].some(row => row.compile_options === "TEMP_STORE=0")) throw new Error("native_limits_unavailable");
  db.exec(`PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;
    PRAGMA cache_size=-${limits.cacheKiB}; PRAGMA cache_spill=OFF; PRAGMA mmap_size=0;`);
  for (const [name, expected] of [["query_only", 1], ["trusted_schema", 0], ["temp_store", 2],
    ["cache_size", -limits.cacheKiB!], ["cache_spill", 0], ["mmap_size", 0]] as const) {
    if (db.prepare(`PRAGMA ${name}`).get()?.[name] !== expected) throw new Error("native_limits_unavailable");
  }
}
