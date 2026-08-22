/**
 * The limits here gate treasury-funded runs, so the two things that must hold are: a caller who
 * spent the window stays blocked across a process restart (the whole point of persisting), and a
 * DB outage degrades to the in-process limiter rather than admitting everything.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./db/sqlite-adapter";

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: () => getDb() }));

const { consumePoint } = await import("./rate-limit-store");

const WINDOW = 60_000;

/** Real file, so "restart" can mean what it means in production: a new process, same DB. */
let dbFile: string;

const opened: SqliteAdapter[] = [];

async function openDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(dbFile);
  await db.init();
  opened.push(db);
  return db;
}

async function freshDb(): Promise<SqliteAdapter> {
  return openDb();
}

describe("consumePoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getDb.mockReset();
    dbFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "keryx-rl-")),
      "keryx.sqlite",
    );
  });

  afterEach(() => {
    // Windows refuses to delete a file the process still holds open.
    while (opened.length) opened.pop()!.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  });

  it("admits up to the budget, then blocks", async () => {
    const db = await freshDb();
    getDb.mockResolvedValue(db);

    for (let i = 0; i < 3; i++) {
      expect((await consumePoint("1.2.3.4", "treasuryAsk", 3, WINDOW)).allowed).toBe(true);
    }
    const blocked = await consumePoint("1.2.3.4", "treasuryAsk", 3, WINDOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.msBeforeNext).toBeGreaterThan(0);
    expect(blocked.msBeforeNext).toBeLessThanOrEqual(WINDOW);
  });

  it("keeps a spent window spent when the process restarts", async () => {
    const db = await freshDb();
    getDb.mockResolvedValue(db);
    await consumePoint("1.2.3.4", "treasuryAsk", 1, WINDOW);

    // A restart is exactly this: same DB file, brand-new adapter, no in-process state carried over.
    getDb.mockResolvedValue(await openDb());
    expect((await consumePoint("1.2.3.4", "treasuryAsk", 1, WINDOW)).allowed).toBe(false);
  });

  it("purges legacy counters that persisted a raw API bearer key", async () => {
    const db = await freshDb();
    const legacyBucket = `ask:kx_live_${"a".repeat(96)}`;
    expect((await db.consumeRateLimit(legacyBucket, 1, WINDOW, Date.now())).allowed).toBe(true);

    // Startup migration on the same durable file removes the secret-bearing row.
    const restarted = await openDb();
    expect((await restarted.consumeRateLimit(legacyBucket, 1, WINDOW, Date.now())).allowed).toBe(
      true,
    );
  });

  it("opens a fresh window once the old one lapses", async () => {
    const db = await freshDb();
    getDb.mockResolvedValue(db);
    await consumePoint("1.2.3.4", "treasuryAsk", 1, WINDOW);
    expect((await consumePoint("1.2.3.4", "treasuryAsk", 1, WINDOW)).allowed).toBe(false);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + WINDOW + 1);
    expect((await consumePoint("1.2.3.4", "treasuryAsk", 1, WINDOW)).allowed).toBe(true);
  });

  it("counts tiers and keys separately", async () => {
    const db = await freshDb();
    getDb.mockResolvedValue(db);
    await consumePoint("1.2.3.4", "treasuryAsk", 1, WINDOW);

    expect((await consumePoint("5.6.7.8", "treasuryAsk", 1, WINDOW)).allowed).toBe(true);
    expect((await consumePoint("1.2.3.4", "a2aPublic", 1, WINDOW)).allowed).toBe(true);
  });

  it("falls back to the in-process limiter — degraded, not open — when the DB is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getDb.mockRejectedValue(new Error("database is locked"));

    expect((await consumePoint("9.9.9.9", "fallbackTier", 2, WINDOW)).allowed).toBe(true);
    expect((await consumePoint("9.9.9.9", "fallbackTier", 2, WINDOW)).allowed).toBe(true);
    expect((await consumePoint("9.9.9.9", "fallbackTier", 2, WINDOW)).allowed).toBe(false);
  });
});
