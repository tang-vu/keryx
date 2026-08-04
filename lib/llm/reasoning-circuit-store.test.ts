/**
 * The production bug was lifecycle-shaped: every volume tick starts a fresh Node process, so a
 * correct in-memory circuit still forgot the previous timeout. These tests use two adapters over
 * one real SQLite file to model separate workers and pin the shared half-open lease.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "../db/sqlite-adapter";
import {
  DurableReasoningCircuitStore,
  MemoryReasoningCircuitStore,
} from "./reasoning-circuit-store";

const KEY = JSON.stringify(["llm:deepseek:deepseek-v4-flash", "decide"]);
const BASE = 1_000;
const MAX = 8_000;

let dbFile: string;
const opened: SqliteAdapter[] = [];

async function openDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(dbFile);
  await db.init();
  opened.push(db);
  return db;
}

describe("durable reasoning circuits", () => {
  beforeEach(() => {
    dbFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "keryx-circuit-")),
      "keryx.sqlite",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (opened.length) opened.pop()!.close();
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  });

  it("keeps a failure streak across worker restarts", async () => {
    const firstWorker = await openDb();
    const now = 10_000;
    const first = await firstWorker.recordReasoningCircuitFailure(
      KEY,
      true,
      now,
      2,
      BASE,
      MAX,
    );
    expect(first).toMatchObject({ failures: 1, openUntil: 0 });

    const nextWorker = await openDb();
    const second = await nextWorker.recordReasoningCircuitFailure(
      KEY,
      true,
      now + 1,
      2,
      BASE,
      MAX,
    );
    expect(second).toMatchObject({ failures: 2, openUntil: now + 1 + BASE });
    expect((await firstWorker.acquireReasoningCircuit(KEY, now + 2, 500)).allowed).toBe(false);
  });

  it("leases one half-open probe and backs off again when that probe fails", async () => {
    const firstWorker = await openDb();
    const secondWorker = await openDb();
    const now = 20_000;
    await firstWorker.recordReasoningCircuitFailure(KEY, true, now, 1, BASE, MAX);

    expect((await secondWorker.acquireReasoningCircuit(KEY, now + 1, 500)).allowed).toBe(false);

    const probeAt = now + BASE + 1;
    expect((await firstWorker.acquireReasoningCircuit(KEY, probeAt, 500)).allowed).toBe(true);
    const competing = await secondWorker.acquireReasoningCircuit(KEY, probeAt, 500);
    expect(competing.allowed).toBe(false);
    expect(competing.retryAfterMs).toBe(500);

    const failedProbe = await firstWorker.recordReasoningCircuitFailure(
      KEY,
      true,
      probeAt + 1,
      1,
      BASE,
      MAX,
    );
    expect(failedProbe.failures).toBe(2);
    expect(failedProbe.openUntil).toBe(probeAt + 1 + BASE * 2);

    await secondWorker.clearReasoningCircuit(KEY);
    expect((await firstWorker.acquireReasoningCircuit(KEY, probeAt + 2, 500)).allowed).toBe(true);
  });

  it("fails down to the memory mirror when circuit persistence is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new DurableReasoningCircuitStore(
      async () => { throw new Error("database unavailable"); },
      new MemoryReasoningCircuitStore(),
    );
    await store.failed(KEY, {
      transient: true,
      now: 30_000,
      failureThreshold: 1,
      baseCooldownMs: BASE,
      maxCooldownMs: MAX,
    });
    expect((await store.acquire(KEY, 30_001, 500)).allowed).toBe(false);
  });
});
