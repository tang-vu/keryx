import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export type PrivateWorkerPhase = "starting" | "recovering" | "working" | "idle" | "degraded" | "stopped";
const schema = z.object({ schema: z.literal("keryx-private-worker-status-v1"), instance: z.string().uuid(),
  pid: z.number().int().positive(), commit: z.string().regex(/^[a-f0-9]{7,40}$/).nullable(),
  phase: z.enum(["starting", "recovering", "working", "idle", "degraded", "stopped"]),
  recordedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const filename = "private-worker-status.json";

/** Advisory local status, never a checkout lease or proof of funding/provider health.
 * The directory must be the existing operator-controlled spool directory. */
export function privateWorkerStatusWriter(directory: string, commit: string | undefined) {
  const identity = { schema: "keryx-private-worker-status-v1" as const, instance: randomUUID(), pid: process.pid,
    commit: commit && /^[a-f0-9]{7,40}$/.test(commit) ? commit : null };
  return async (phase: PrivateWorkerPhase) => {
    const temporary = join(directory, `.private-worker-status-${randomUUID()}.tmp`);
    try {
      const record = schema.parse({ ...identity, phase, recordedAt: Date.now() });
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(record) + "\n"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, join(directory, filename));
    } catch { throw new Error("Private worker status write unavailable"); }
    finally { await unlink(temporary).catch(() => undefined); }
  };
}

export async function readPrivateWorkerStatus(directory: string, now = Date.now()) {
  try {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error();
    const handle = await open(join(directory, filename), "r");
    let record;
    try {
      if (!(await handle.stat()).isFile()) throw new Error();
      const bytes = Buffer.alloc(4097); let offset = 0;
      while (offset < bytes.length) {
        const read = await handle.read(bytes, offset, bytes.length - offset, null);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      if (offset > 4096) throw new Error();
      record = schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset))));
    } finally { await handle.close(); }
    if (record.recordedAt > now || now - record.recordedAt > 30000) return { status: "stale" as const };
    return { status: "observed" as const, ...record, checkoutReady: false as const };
  } catch { return { status: "unavailable" as const }; }
}
