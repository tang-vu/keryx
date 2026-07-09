/**
 * Grants back the non-custodial cap, so their accounting must outlive the process that made it.
 * These run against a real SQLite file rather than a fake, because the properties worth pinning
 * — atomic increments, micro-USDC rounding, survival across a reopen — live in the SQL.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "../db/sqlite-adapter";

const dbFile = path.join(os.tmpdir(), `keryx-grants-${Date.now()}-${process.pid}.sqlite`);

// The module under test resolves its database through getDb(); point that at our temp file.
const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown as SqliteAdapter } }));
vi.mock("../db", () => ({ getDb: async () => dbRef.current }));

const {
  storeGrant,
  getGrant,
  isGrantValid,
  canSpend,
  recordSpend,
  dropGrant,
  pruneExpiredGrants,
} = await import("./session-grants");

const SESSION = "0xowner";
const SESS_ADDR = "0xSessionEOA";

function grantFor(cap: number, ttlMs = 60_000) {
  return {
    sessAddr: SESS_ADDR,
    ownerAddr: SESSION,
    cap,
    expiry: Date.now() + ttlMs,
    txHash: "0xfund",
  };
}

beforeAll(async () => {
  dbRef.current = new SqliteAdapter(dbFile);
  await dbRef.current.init();
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(dbFile + suffix); } catch { /* already gone */ }
  }
});

beforeEach(async () => {
  await dropGrant(SESSION);
});

describe("grant lifecycle", () => {
  it("stores a grant with nothing spent yet", async () => {
    await storeGrant(SESSION, grantFor(1));
    const grant = await getGrant(SESSION);

    expect(grant?.sessAddr).toBe(SESS_ADDR);
    expect(grant?.cap).toBe(1);
    expect(grant?.spent).toBe(0);
    expect(await isGrantValid(SESSION)).toBe(true);
  });

  it("re-registering resets the spend, because the new cap is the live Gateway residual", async () => {
    await storeGrant(SESSION, grantFor(1));
    await recordSpend(SESSION, 0.4);
    await storeGrant(SESSION, grantFor(0.6));

    const grant = await getGrant(SESSION);
    expect(grant?.cap).toBe(0.6);
    expect(grant?.spent).toBe(0);
  });

  it("treats a lapsed grant as absent and deletes the row", async () => {
    await storeGrant(SESSION, grantFor(1, -1)); // already expired
    expect(await getGrant(SESSION)).toBeUndefined();
    expect(await dbRef.current.getSessionGrant(SESSION)).toBeNull();
  });

  it("revoking removes the grant", async () => {
    await storeGrant(SESSION, grantFor(1));
    await dropGrant(SESSION);
    expect(await isGrantValid(SESSION)).toBe(false);
  });

  it("prunes only the grants that have lapsed", async () => {
    await storeGrant(SESSION, grantFor(1, -1));
    await storeGrant("0xlive", grantFor(1));
    await pruneExpiredGrants();

    expect(await dbRef.current.getSessionGrant(SESSION)).toBeNull();
    expect(await dbRef.current.getSessionGrant("0xlive")).not.toBeNull();
    await dropGrant("0xlive");
  });
});

describe("cap enforcement", () => {
  it("permits a spend that lands exactly on the cap", async () => {
    await storeGrant(SESSION, grantFor(0.05));
    await recordSpend(SESSION, 0.04);
    expect(await canSpend(SESSION, 0.01)).toBe(true);
  });

  it("refuses a spend that would cross the cap", async () => {
    await storeGrant(SESSION, grantFor(0.05));
    await recordSpend(SESSION, 0.04);
    expect(await canSpend(SESSION, 0.011)).toBe(false);
  });

  it("refuses every spend once the grant is gone", async () => {
    expect(await canSpend(SESSION, 0.000001)).toBe(false);
    expect(await recordSpend(SESSION, 0.000001)).toBe(false);
  });

  it("accumulates many sub-cent spends without float drift", async () => {
    await storeGrant(SESSION, grantFor(1));
    // 0.1 + 0.2 in binary floating point is 0.30000000000000004; a cap check must not see that.
    for (const amount of [0.1, 0.2]) await recordSpend(SESSION, amount);
    expect((await getGrant(SESSION))?.spent).toBe(0.3);

    // Typical citation rewards, a hundred of them, still land on an exact total.
    for (let i = 0; i < 100; i++) await recordSpend(SESSION, 0.0001);
    expect((await getGrant(SESSION))?.spent).toBe(0.31);
  });

  it("rounds a spend finer than a micro-USDC to the settlement floor", async () => {
    // Circle settles in integer micro-USDC, so a half-micro spend cannot exist on-chain. The
    // accounting rounds to that floor rather than letting sub-atomic dust accumulate as drift.
    await storeGrant(SESSION, grantFor(1));
    await recordSpend(SESSION, 0.0000004);
    expect((await getGrant(SESSION))?.spent).toBe(0);

    await recordSpend(SESSION, 0.0000006);
    expect((await getGrant(SESSION))?.spent).toBe(0.000001);
  });

  it("applies concurrent spends atomically", async () => {
    await storeGrant(SESSION, grantFor(1));
    await Promise.all(Array.from({ length: 20 }, () => recordSpend(SESSION, 0.001)));
    expect((await getGrant(SESSION))?.spent).toBeCloseTo(0.02, 6);
  });
});

describe("surviving a restart", () => {
  it("keeps the cap and the running spend when the process comes back", async () => {
    await storeGrant(SESSION, grantFor(0.05));
    await recordSpend(SESSION, 0.03);

    // A deploy: the old process dies, a new one opens the same database file.
    dbRef.current = new SqliteAdapter(dbFile);
    await dbRef.current.init();

    const grant = await getGrant(SESSION);
    expect(grant?.cap).toBe(0.05);
    expect(grant?.spent).toBe(0.03);
    // The pre-restart spend still counts against the cap — it used to reset to zero.
    expect(await canSpend(SESSION, 0.03)).toBe(false);
    expect(await canSpend(SESSION, 0.02)).toBe(true);
  });
});
