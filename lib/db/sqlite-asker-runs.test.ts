/**
 * Asker attribution on the SQLite adapter — the query behind a wallet's dispatch ledger.
 * Pins the three things a receipts page cannot get wrong: one wallet never sees another's
 * dispatches, unattributed runs (anonymous / engine / A2A) belong to nobody, and address
 * casing never splits a wallet's history in two.
 */

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import type { QueryRun } from "../types";

const dbFile = path.join(os.tmpdir(), `keryx-asker-runs-test-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

const ALICE = "0xAAAA000000000000000000000000000000000001";
const BOB = "0xbbbb000000000000000000000000000000000002";

function run(id: string, createdAt: string, asker?: string, funded?: boolean): QueryRun {
  return {
    id,
    question: `q-${id}`,
    budget: 0.05,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [],
    answer: "a",
    totalSpent: 0.01,
    totalToCreators: 0.008,
    trace: [],
    createdAt,
    ...(asker ? { asker, askerFunded: funded } : {}),
  };
}

describe("listQueryRunsByAsker", () => {
  it("returns only the wallet's own dispatches, newest first", async () => {
    await db.saveQueryRun(run("r1", "2026-07-24T10:00:00.000Z", ALICE, true));
    await db.saveQueryRun(run("r2", "2026-07-24T12:00:00.000Z", ALICE, false));
    await db.saveQueryRun(run("r3", "2026-07-24T11:00:00.000Z", BOB, true));
    await db.saveQueryRun(run("r4", "2026-07-24T13:00:00.000Z")); // anonymous / engine

    const mine = await db.listQueryRunsByAsker(ALICE, 50);
    expect(mine.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(mine[0].askerFunded).toBe(false);
    expect(mine[1].askerFunded).toBe(true);

    // Bob's ledger sees Bob's row only — never Alice's, never the unattributed one.
    expect((await db.listQueryRunsByAsker(BOB, 50)).map((r) => r.id)).toEqual(["r3"]);
  });

  it("matches a wallet regardless of address casing on either side", async () => {
    // Stamped upper-case, queried lower-case (and the reverse) — same wallet, one ledger.
    expect((await db.listQueryRunsByAsker(ALICE.toLowerCase(), 50)).length).toBe(2);
    expect((await db.listQueryRunsByAsker(BOB.toUpperCase(), 50)).length).toBe(1);
  });

  it("honours the limit", async () => {
    expect((await db.listQueryRunsByAsker(ALICE, 1)).map((r) => r.id)).toEqual(["r2"]);
  });

  it("gives an unknown wallet an empty ledger, not everyone's", async () => {
    expect(await db.listQueryRunsByAsker("0xdead", 50)).toEqual([]);
  });

  /**
   * The live database carries every real dispatch and predates the column. `CREATE TABLE IF NOT
   * EXISTS` is a no-op against it, so the ALTER + index in ensureColumns is the only thing that
   * makes attribution work there — and a fresh-DB test can never see that path fail.
   */
  it("upgrades a database created before asker existed", async () => {
    const legacyFile = path.join(os.tmpdir(), `keryx-asker-legacy-${process.pid}.sqlite`);
    const legacy = new SqliteAdapter(legacyFile);
    await legacy.init();
    legacy.close();
    // Reopen raw and strip the column, standing in for a database written by the older schema.
    const { DatabaseSync } = await import("node:sqlite");
    const raw = new DatabaseSync(legacyFile);
    raw.exec(`DROP INDEX IF EXISTS query_runs_asker; ALTER TABLE query_runs DROP COLUMN asker`);
    raw.close();

    const upgraded = new SqliteAdapter(legacyFile);
    await expect(upgraded.init()).resolves.not.toThrow();
    try {
      await upgraded.saveQueryRun(run("r9", "2026-07-24T14:00:00.000Z", ALICE, true));
      expect((await upgraded.listQueryRunsByAsker(ALICE, 50)).map((r) => r.id)).toEqual(["r9"]);
    } finally {
      upgraded.close();
      for (const s of ["", "-wal", "-shm"]) fs.rmSync(legacyFile + s, { force: true });
    }
  });
});
