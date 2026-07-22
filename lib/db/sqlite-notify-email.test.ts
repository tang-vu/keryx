/**
 * Round-trip for the citation email-alert config on the SQLite adapter — the store the email
 * dispatcher's rate cap depends on. Pins the one subtle behavior: re-saving an address resets
 * `lastSentAt`, so a fresh opt-in never inherits a stale rate window.
 */

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";

const dbFile = path.join(os.tmpdir(), `keryx-notify-email-test-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

describe("source_notify_email round-trip", () => {
  it("sets, reads, marks sent, and deletes", async () => {
    expect(await db.getSourceNotifyEmail("s1")).toBeNull();

    await db.setSourceNotifyEmail("s1", "mara@example.com", "tok-1");
    expect(await db.getSourceNotifyEmail("s1")).toEqual({
      email: "mara@example.com",
      unsubToken: "tok-1",
      lastSentAt: null,
    });

    await db.markSourceNotifyEmailSent("s1", "2026-07-23T00:00:00.000Z");
    expect((await db.getSourceNotifyEmail("s1"))?.lastSentAt).toBe("2026-07-23T00:00:00.000Z");

    await db.deleteSourceNotifyEmail("s1");
    expect(await db.getSourceNotifyEmail("s1")).toBeNull();
  });

  it("re-saving resets the rate window and replaces the unsubscribe token", async () => {
    await db.setSourceNotifyEmail("s2", "a@example.com", "tok-a");
    await db.markSourceNotifyEmailSent("s2", "2026-07-23T00:00:00.000Z");

    await db.setSourceNotifyEmail("s2", "b@example.com", "tok-b");
    expect(await db.getSourceNotifyEmail("s2")).toEqual({
      email: "b@example.com",
      unsubToken: "tok-b",
      lastSentAt: null,
    });
  });
});
