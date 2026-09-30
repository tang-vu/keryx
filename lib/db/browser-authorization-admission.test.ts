import { sqliteDomainTestFixtures } from "./sqlite-domain-test-fixture";
const sqliteFixtures = sqliteDomainTestFixtures();
import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter } from "./supabase-adapter";
import type { BrowserAuthorizationIntent } from "./browser-authorization-admission";

const files: string[] = [];
const adapters: SqliteAdapter[] = [];
const signer = "0x1111111111111111111111111111111111111111";
const input = (requestId: string, amountMicroUsdc = 1): BrowserAuthorizationIntent => ({
  sessionId: "owner", requestId, queryId: "query", grantEpoch: "epoch-1", signer,
  network: "eip155:5042002", token: "0x3600000000000000000000000000000000000000",
  gatewayContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  sourceId: "source", offerId: null, kind: "fetch",
  payee: "0x2222222222222222222222222222222222222222", amountMicroUsdc,
});

async function setup(cap = 0.000002) {
  const file = path.join(os.tmpdir(), `keryx-browser-admission-${crypto.randomUUID()}.sqlite`);
  files.push(file);
  const db = await sqliteFixtures.open(file, "testnet-real");
  adapters.push(db);
  await db.init();
  await db.upsertSessionGrant({ sessionId: "owner", sessAddr: signer, ownerAddr: "owner",
    cap, expiry: Date.now() + 60_000, txHash: "funded", grantEpoch: "epoch-1" });
  return { db, file };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const db of adapters.splice(0)) db.close();
  for (const file of files.splice(0)) for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
});

it("atomically admits exact last micro units across two SQLite connections and survives reopen", async () => {
  const { db, file } = await setup();
  const second = await sqliteFixtures.open(file, "testnet-real");
  adapters.push(second);
  await second.init();
  const results = await Promise.all([
    db.admitBrowserAuthorization(input("r1")),
    second.admitBrowserAuthorization(input("r2")),
    db.admitBrowserAuthorization(input("r3")),
  ]);
  expect(results.filter((r) => r.status === "admitted")).toHaveLength(2);
  expect(results.filter((r) => r.status === "grant_or_cap_refused")).toHaveLength(1);
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0.000002);
  db.close(); adapters.splice(adapters.indexOf(db), 1);
  second.close(); adapters.splice(adapters.indexOf(second), 1);
  const reopened = sqliteFixtures.trustedRaw(file, { readOnly: true });
  expect((reopened.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get() as { n: number }).n).toBe(2);
  reopened.close();
  const writer = sqliteFixtures.trustedRaw(file);
  expect(() => writer.exec("UPDATE browser_authorization_intents SET payee='changed'")).toThrow(/immutable/);
  expect(() => writer.exec("DELETE FROM browser_authorization_intents")).toThrow(/immutable/);
  writer.close();
});

it("rolls back reservation on duplicate request, duplicate nonce, and insert failure", async () => {
  const { db, file } = await setup(0.000004);
  const fixedNonce = Buffer.alloc(32, 7);
  vi.spyOn(crypto, "randomBytes").mockImplementation(() => fixedNonce as never);
  expect((await db.admitBrowserAuthorization(input("r1"))).status).toBe("admitted");
  await expect(db.admitBrowserAuthorization(input("r1"))).rejects.toThrow();
  await expect(db.admitBrowserAuthorization(input("r2"))).rejects.toThrow();
  const raw = sqliteFixtures.trustedRaw(file);
  raw.exec(`CREATE TRIGGER fail_intent BEFORE INSERT ON browser_authorization_intents
    BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END`);
  raw.close();
  vi.spyOn(crypto, "randomBytes").mockImplementation(() => Buffer.alloc(32, 8) as never);
  await expect(db.admitBrowserAuthorization(input("r3"))).rejects.toThrow(/forced insert failure/);
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0.000001);
});

it("refuses a replaced grant epoch without reserving", async () => {
  const { db } = await setup();
  await db.upsertSessionGrant({ sessionId: "owner", sessAddr: signer, ownerAddr: "owner",
    cap: 0.000002, expiry: Date.now() + 60_000, txHash: "recovered", grantEpoch: "epoch-2" });
  expect(await db.admitBrowserAuthorization(input("old"))).toEqual({ status: "grant_or_cap_refused" });
  expect((await db.getSessionGrant("owner"))?.spent).toBe(0);
});

it("propagates Supabase RPC error and rejects unknown outcome", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-db.example");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-no-authority");
  const db = new SupabaseAdapter();
  const failure = new Error("SQL insert failed");
  const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: failure })
    .mockResolvedValueOnce({ data: "unknown", error: null })
    .mockResolvedValueOnce({ data: "admitted", error: null });
  Object.assign(db, { sb: { rpc } });
  await expect(db.admitBrowserAuthorization(input("r1"))).rejects.toBe(failure);
  await expect(db.admitBrowserAuthorization(input("r2"))).rejects.toThrow(/Unexpected browser admission/);
  expect((await db.admitBrowserAuthorization(input("r3"))).status).toBe("admitted");
  expect(rpc).toHaveBeenCalledWith("admit_browser_authorization", expect.any(Object));
});
