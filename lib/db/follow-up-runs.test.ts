/**
 * A follow-up's link to its parent has to survive the round-trip, because the thread on the
 * permalink is rebuilt from it — and a dropped parent_id would silently turn a threaded dispatch
 * back into an orphan.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import type { QueryRun } from "../types";

function run(id: string, question: string, parentId?: string): QueryRun {
  return {
    id,
    question,
    budget: 0.05,
    engine: "heuristic",
    subClaims: [],
    decisions: [],
    citations: [],
    answer: "…",
    totalSpent: 0,
    totalToCreators: 0,
    trace: [],
    createdAt: new Date().toISOString(),
    ...(parentId ? { parentId } : {}),
  };
}

let dir: string;
let db: SqliteAdapter;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-followup-"));
  db = new SqliteAdapter(path.join(dir, "keryx.sqlite"));
  await db.init();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("follow-up threading", () => {
  it("lists follow-ups against their parent, oldest first", async () => {
    await db.saveQueryRun(run("11111111-1111-4111-8111-111111111111", "What is Arc?"));
    await db.saveQueryRun(
      run("22222222-2222-4222-8222-222222222222", "How does that settle?", "11111111-1111-4111-8111-111111111111"),
    );
    await db.saveQueryRun(
      run("33333333-3333-4333-8333-333333333333", "And the fees?", "11111111-1111-4111-8111-111111111111"),
    );

    const kids = await db.listFollowUps("11111111-1111-4111-8111-111111111111");
    expect(kids.map((k) => k.question)).toEqual(["How does that settle?", "And the fees?"]);
    expect(kids[0]!.parentId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("returns nothing for a dispatch nobody followed up on", async () => {
    await db.saveQueryRun(run("44444444-4444-4444-8444-444444444444", "Standalone?"));
    expect(await db.listFollowUps("44444444-4444-4444-8444-444444444444")).toEqual([]);
  });

  /**
   * The live databases carry real traction and predate parent_id. `CREATE TABLE IF NOT EXISTS` is
   * a no-op against them, so anything in the schema that names the new column — an index, say —
   * fails at boot on precisely those databases and nowhere else. A fresh-DB test cannot see it.
   */
  it("upgrades a database created before parent_id existed", async () => {
    const legacyFile = path.join(dir, "legacy.sqlite");
    const legacy = new DatabaseSync(legacyFile);
    legacy.exec(`CREATE TABLE query_runs (
      id TEXT PRIMARY KEY, created_at TEXT, question TEXT, budget REAL, engine TEXT,
      total_spent REAL, total_to_creators REAL, answer TEXT, data TEXT
    )`);
    legacy.exec(
      `INSERT INTO query_runs (id, created_at, question, data)
       VALUES ('old', '2026-01-01T00:00:00.000Z', 'Asked before threading existed', '{"id":"old","question":"Asked before threading existed"}')`,
    );
    legacy.close();

    const upgraded = new SqliteAdapter(legacyFile);
    await expect(upgraded.init()).resolves.not.toThrow();
    try {
      // The pre-existing row survives, and threading works on the upgraded file.
      expect((await upgraded.getQueryRun("old"))!.question).toBe("Asked before threading existed");
      await upgraded.saveQueryRun(
        run("77777777-7777-4777-8777-777777777777", "And now?", "old"),
      );
      expect((await upgraded.listFollowUps("old")).map((r) => r.question)).toEqual(["And now?"]);
    } finally {
      upgraded.close();
    }
  });

  it("a follow-up is a paid dispatch in its own right, not a child record of the parent's",
    async () => {
      const parent = run("55555555-5555-4555-8555-555555555555", "What is Arc?");
      parent.totalToCreators = 0.02;
      const child = run("66666666-6666-4666-8666-666666666666", "How does that settle?", parent.id);
      child.totalToCreators = 0.03;
      await db.saveQueryRun(parent);
      await db.saveQueryRun(child);

      // Each keeps its own payout total — threading must not merge or reassign them.
      expect((await db.getQueryRun(parent.id))!.totalToCreators).toBe(0.02);
      expect((await db.getQueryRun(child.id))!.totalToCreators).toBe(0.03);
    });
});
