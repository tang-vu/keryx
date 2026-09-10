import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Cooperative single-host exclusion on the existing controlled spool directory.
 * Never reclaim a lock based on age or PID: crash recovery requires operator checks. */
export async function withPrivateWorkerLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const file = join(directory, "private-worker.lock");
  const record = JSON.stringify({ schema: "keryx-private-worker-lock-v1", instance: randomUUID(), pid: process.pid }) + "\n";
  try {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(record); await handle.sync(); }
    finally { await handle.close(); }
    // A failed lock write above leaves the reservation in place. No work was started.
    try { return await operation(); }
    finally {
      const current = await open(file, "r");
      try {
        const stat = await current.stat();
        if (!stat.isFile() || stat.size !== Buffer.byteLength(record)) throw new Error();
        const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
        while (offset < bytes.length) {
          const read = await current.read(bytes, offset, bytes.length - offset, null);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (bytes.subarray(0, offset).toString("utf8") !== record) throw new Error();
      } finally { await current.close(); }
      await unlink(file);
    }
  } catch { throw new Error("Private worker lock or operation unavailable; inspect the existing lock before restarting"); }
}
