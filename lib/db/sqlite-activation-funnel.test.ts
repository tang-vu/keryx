import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";

const dbFile = path.join(os.tmpdir(), `keryx-activation-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

describe("SQLite activation funnel", () => {
  it("atomically aggregates event counts without actor fields", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await Promise.all([
      db.recordActivationEvent("reader_landing", today),
      db.recordActivationEvent("reader_landing", today),
      db.recordActivationEvent("reader_ask_started", today),
    ]);
    const funnel = await db.activationFunnel(30);
    expect(funnel.counts.reader_landing).toBe(2);
    expect(funnel.counts.reader_ask_started).toBe(1);
    expect(funnel.counts.creator_withdrawal_completed).toBe(0);
  });
});
