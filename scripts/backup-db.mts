/**
 * backup-db.mts — consistent, rotating, off-box backups of the SQLite source-of-truth.
 *
 * The deployed app keeps all real traction (payments, sources, memory, withdrawals) in a single
 * SQLite file on one VPS. A disk failure or a bad `rm` would lose it all. This script takes a
 * point-in-time snapshot that is safe to run against the LIVE database (SQLite `VACUUM INTO`
 * reads a consistent image while the app keeps serving in WAL mode), gzips it, rotates old
 * snapshots, and — when a remote is configured — copies the snapshot OFF the box.
 *
 * Off-box push is opt-in and credential-free here: set `KERYX_BACKUP_REMOTE` to any rclone
 * remote path (e.g. `r2:keryx-backups`) and the snapshot is `rclone copy`d there. Without it,
 * snapshots are still written + rotated locally (protects against corruption / accidental delete),
 * and the script prints how to enable the off-box leg. Never throws on a push failure — a missing
 * remote or a network blip must not stop the local snapshot from being kept.
 *
 * Run:  npm run backup          (locally or on the VPS; wired hourly via cron in deploy-vps.sh)
 * Env:  KERYX_SQLITE_PATH  (default data/keryx.sqlite)
 *       KERYX_BACKUP_KEEP  (local snapshots to retain, default 48)
 *       KERYX_BACKUP_REMOTE(rclone remote:path for the off-box copy; unset = local-only)
 */

import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { prunable } from "./backup-rotation.ts";

const dbPath = process.env.KERYX_SQLITE_PATH
  ? path.resolve(process.env.KERYX_SQLITE_PATH)
  : path.resolve(process.cwd(), "data", "keryx.sqlite");
const keep = Math.max(1, Number(process.env.KERYX_BACKUP_KEEP) || 48);
const remote = (process.env.KERYX_BACKUP_REMOTE ?? "").trim();
const backupsDir = path.join(path.dirname(dbPath), "backups");

/** Compact, lexicographically-sortable UTC stamp: 2026-07-01T15-30-00-123Z. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function human(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main(): void {
  if (!fs.existsSync(dbPath)) {
    console.error(`[backup] no database at ${dbPath} — nothing to back up.`);
    process.exit(1);
  }
  fs.mkdirSync(backupsDir, { recursive: true });

  const base = `keryx-${stamp()}.sqlite`;
  const tmpPath = path.join(backupsDir, base);
  const gzPath = `${tmpPath}.gz`;

  // 1) Consistent snapshot of the live DB. VACUUM INTO reads a coherent image without blocking
  //    WAL readers/writers, and compacts free pages so the snapshot is smaller than the source.
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 10000;");
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // 2) Compress and drop the uncompressed intermediate.
  fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(tmpPath)));
  fs.unlinkSync(tmpPath);
  const size = fs.statSync(gzPath).size;
  console.log(`[backup] snapshot ${path.basename(gzPath)} (${human(size)})`);

  // 3) Rotate local snapshots.
  const stale = prunable(fs.readdirSync(backupsDir), keep);
  for (const f of stale) fs.unlinkSync(path.join(backupsDir, f));
  if (stale.length) console.log(`[backup] pruned ${stale.length} old snapshot(s), keeping ${keep}`);

  // 4) Off-box copy (opt-in). Best-effort: a push failure never discards the local snapshot.
  if (!remote) {
    console.log("[backup] local-only — set KERYX_BACKUP_REMOTE=<rclone remote:path> for an off-box copy.");
    return;
  }
  const res = spawnSync("rclone", ["copy", gzPath, remote, "--no-traverse"], { encoding: "utf8" });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    console.warn("[backup] KERYX_BACKUP_REMOTE is set but `rclone` is not installed — snapshot kept locally only.");
  } else if (res.status !== 0) {
    console.warn(`[backup] rclone push to ${remote} failed (exit ${res.status}) — snapshot kept locally.\n${res.stderr ?? ""}`);
  } else {
    console.log(`[backup] pushed off-box → ${remote}`);
  }
}

// Run only when invoked directly (`npm run backup`), not when imported by the rotation test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
