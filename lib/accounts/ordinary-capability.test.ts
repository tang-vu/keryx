/** AUTHORED, UNRUN. Real disposable ordinary SQLite adapter fixtures only.
 * Provisioning SQL / connection timeout changes below are synthetic fixture setup,
 * never operational rollout. Run only in the parent's isolated offline test scope. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { ACCOUNT_MEMBERSHIP_SQL_DATA } from "./sqlite-schema-data";
import { createAccountRequestAdapter, createOrdinaryAccountMembershipRoutes } from "./request-adapter";
import { createAccountMembershipService } from "./service";

const binding = { origin: "https://keryx.example", network: "eip155:5042002" } as const;
const wallet = `0x${"1".repeat(40)}`, secret = "PUBLIC-SYNTHETIC-ORDINARY-ACCOUNT267-TEST-SECRET";
const consent = { version: 1, privateAccount: true, shareOwnedHistory: true } as const;
const cleanups: Array<() => void> = [];

async function fixture(qualify = true) {
  const folder = mkdtempSync(join(tmpdir(), "keryx-account267-port-")), file = join(folder, "ordinary.sqlite");
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  const adapter = new SqliteAdapter(file); cleanups.push(() => adapter.close());
  await adapter.init();
  // Test-only inspection of the adapter-owned connection. No product raw port is exposed.
  const connection = (adapter as unknown as { db: DatabaseSync }).db;
  if (qualify) connection.exec(ACCOUNT_MEMBERSHIP_SQL_DATA + "\nPRAGMA busy_timeout=1000;");
  return { adapter, connection, file };
}
function request(token: string, input?: unknown) {
  return new Request(`${binding.origin}/api/account/membership`, { method: input === undefined ? "GET" : "POST", headers: {
    Cookie: `keryx_session=${token}`,
    ...(input === undefined ? {} : { Origin: binding.origin, "Content-Type": "application/json", "X-Keryx-Expected-Wallet": wallet }),
  }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
const schema = (db: DatabaseSync) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all();
beforeEach(() => { vi.stubEnv("KERYX_FORCE_OFFLINE", "1"); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllEnvs();
});

describe("ordinary adapter-owned optional account capability", () => {
  it("publishes only after completed ordinary init and keeps the current 5000ms timeout and missing namespace refused without DDL", async () => {
    const folder = mkdtempSync(join(tmpdir(), "keryx-account267-uninitialized-")), file = join(folder, "ordinary.sqlite");
    cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
    const adapter = new SqliteAdapter(file); cleanups.push(() => adapter.close());
    const connection = (adapter as unknown as { db: DatabaseSync }).db, prepare = vi.spyOn(connection, "prepare");
    expect(Object.hasOwn(adapter, "accountMembership")).toBe(false); expect(adapter.accountMembership).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    await adapter.init();
    expect(connection.prepare("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    const before = schema(connection), exec = vi.spyOn(connection, "exec");
    expect(adapter.accountMembership).toBeUndefined(); expect(exec).not.toHaveBeenCalled();
    expect(schema(connection)).toEqual(before);
    expect(connection.prepare("SELECT 1 FROM sqlite_schema WHERE lower(name) GLOB 'account267_*'").get()).toBeUndefined();
    exec.mockRestore();
    connection.exec("PRAGMA busy_timeout=1000;");
    const mutation = vi.spyOn(connection, "exec");
    expect(adapter.accountMembership).toBeUndefined(); expect(mutation).not.toHaveBeenCalled();
    expect(schema(connection)).toEqual(before); // A shorter wait policy does not install any account table.
  });

  it("exposes a non-enumerable immutable descriptor for the exact connection and composes existing issuance + HTTP without inferred accounts", async () => {
    const { adapter, connection } = await fixture(), before = schema(connection), exec = vi.spyOn(connection, "exec");
    const descriptor = Object.getOwnPropertyDescriptor(adapter, "accountMembership");
    expect(descriptor?.enumerable).toBe(false); expect(descriptor?.configurable).toBe(false); expect(descriptor?.set).toBeUndefined();
    const port = adapter.accountMembership; expect(port).toBeDefined(); expect(Object.isFrozen(port)).toBe(true);
    expect(exec).not.toHaveBeenCalled(); expect(schema(connection)).toEqual(before);
    expect(Object.keys(adapter)).not.toContain("accountMembership"); expect({ ...adapter }).not.toHaveProperty("accountMembership");
    expect(adapter).not.toHaveProperty("historyMembership");
    const l = await issueWebSession(adapter, secret, wallet, "asker");
    const r = createOrdinaryAccountMembershipRoutes({ db: adapter, ...binding, jwtSecret: secret });
    const read = await r.GET(request(l.token)); expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ version: 1, wallet, membership: null, offer: null });
    const prepared = await r.POST(request(l.token, { action: "prepare-create", consent })); expect(prepared.status).toBe(200);
    const proof = await prepared.json();
    const created = await r.POST(request(l.token, { action: "complete-create", nonce: proof.nonce, consent })); expect(created.status).toBe(200);
    const membership = (await created.json()).membership;
    expect(connection.prepare("SELECT account_id FROM account267_accounts").get()?.account_id).toBe(membership.accountId);
    const claims = (await parseWebSession(l.token, secret))!;
    expect(connection.prepare("SELECT session_hash FROM account267_sessions").get()?.session_hash).toBe(webSessionHash(claims.jti));
    expect(schema(connection)).toEqual(before);
  });

  it("refuses altered schema/foreign triggers/case-folded enrollment without repairing and rechecks captured stores before mutation", async () => {
    for (const alteration of [
      "DROP INDEX account267_sessions_live",
      "CREATE TABLE foreign_sidecar(id TEXT); CREATE TRIGGER foreign_account BEFORE INSERT ON foreign_sidecar BEGIN DELETE FROM account267_sessions; END;",
      "CREATE TABLE KERYX_STORAGE_IDENTITY(id TEXT)",
    ]) {
      const { adapter, connection } = await fixture(), port = adapter.accountMembership!;
      connection.exec(alteration);
      const before = schema(connection), exec = vi.spyOn(connection, "exec");
      expect(adapter.accountMembership).toBeUndefined(); expect(exec).not.toHaveBeenCalled(); expect(schema(connection)).toEqual(before);
      await expect(port.resolve({ sessionHash: "a".repeat(64), wallet, issuedAt: 1000, expiresAt: 2000 }, binding)).rejects.toThrow("account_unavailable");
      expect(exec).not.toHaveBeenCalled(); expect(schema(connection)).toEqual(before);
      exec.mockRestore();
    }
  });

  it("omits the port on readonly/archive and enrolled assemblies without account/session probes or fallback init", async () => {
    const { adapter, connection, file } = await fixture();
    const reader = new SqliteAdapter(file, { readOnly: true }); cleanups.push(() => reader.close());
    const readerConnection = (reader as unknown as { db: DatabaseSync }).db, readerPrepare = vi.spyOn(readerConnection, "prepare");
    expect(Object.hasOwn(reader, "accountMembership")).toBe(false); expect(reader.accountMembership).toBeUndefined();
    expect(readerPrepare).not.toHaveBeenCalled();
    const core = SqliteAdapter.assembleConnectionCore(connection, syntheticStorageIdentity("testnet-offline"), vi.fn());
    const prepare = vi.spyOn(connection, "prepare");
    expect(Object.hasOwn(core, "accountMembership")).toBe(false); expect(core.accountMembership).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    const l = await issueWebSession(adapter, secret, wallet, "asker");
    for (const facade of [reader, core]) {
      const read = vi.spyOn(facade, "getWebSession"), init = vi.spyOn(facade, "init");
      const auth = await createAccountRequestAdapter({ db: facade, ...binding, jwtSecret: secret }).authenticate(request(l.token));
      expect(auth).toBeInstanceOf(Response); expect((auth as Response).status).toBe(503);
      expect(read).not.toHaveBeenCalled(); expect(init).not.toHaveBeenCalled();
    }
  });

  it("does not give a captured request authority to a deleted original login or a changed wait policy", async () => {
    const { adapter, connection } = await fixture(), l = await issueWebSession(adapter, secret, wallet, "asker");
    const auth = await createAccountRequestAdapter({ db: adapter, ...binding, jwtSecret: secret }).authenticate(request(l.token));
    if (auth instanceof Response) throw new Error("Expected synthetic authority");
    await adapter.revokeWebSession(auth.session.sessionHash, wallet);
    await expect(auth.service.prepareCreate(auth.session, consent)).rejects.toThrow("account_unauthenticated");
    expect(connection.prepare("SELECT count(*) AS n FROM account267_challenges").get()?.n).toBe(0);
    const port = adapter.accountMembership!;
    connection.exec("PRAGMA busy_timeout=5000;");
    expect(adapter.accountMembership).toBeUndefined();
    await expect(createAccountMembershipService(port, binding).offer(auth.session)).rejects.toThrow("account_unavailable");
  });
});
