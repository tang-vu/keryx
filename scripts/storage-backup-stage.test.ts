import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { provisionSyntheticStorage } from "../lib/db/storage-identity-fixture";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { backupVerifiedSqliteStorage } from "../lib/db/storage-identity-provision";
import { createVerifiedBackupSnapshot } from "./storage-backup-stage";

it("retains an actual verified copy after lost acknowledgment and blocks a different output retry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "keryx-backup-uncertain-"));
  try {
    const source = join(directory, "source.sqlite"), output = join(directory, "copy.sqlite"), marker = join(directory, "review.json");
    const identity = await provisionSyntheticStorage(source, "testnet-offline");
    const adapter = new SqliteAdapter(source, { expectedIdentity: identity }); await adapter.init(); adapter.close();
    const before = readFileSync(source);
    const lostAck = vi.fn(async (...args: Parameters<typeof backupVerifiedSqliteStorage>) => {
      await backupVerifiedSqliteStorage(...args); throw new Error("operation_deadline_uncertain_ack");
    });
    await expect(createVerifiedBackupSnapshot(source, identity, output, marker, lostAck)).rejects.toThrow("requires inspection");
    expect(existsSync(output)).toBe(true); expect(readFileSync(source)).toEqual(before);
    expect(JSON.parse(readFileSync(marker, "utf8"))).toMatchObject({ snapshot: "copy.sqlite", signingResumeAuthorized: false });
    const retry = join(directory, "different-copy.sqlite");
    await expect(createVerifiedBackupSnapshot(source, identity, retry, marker, lostAck)).rejects.toThrow("prior uncertain");
    expect(lostAck).toHaveBeenCalledOnce(); expect(existsSync(retry)).toBe(false);
  } finally { rmSync(directory, { recursive: true }); }
});
