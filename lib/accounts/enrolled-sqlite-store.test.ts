/** Genuine controls first ran 28 PASS / 17 FAIL; R104 selected 18 PASS / 5 timeouts.
 * R114 focused types PASS; its measured MAX8 case still timed out at 20 seconds.
 * The synthetic population transaction correction below is UNRUN.
 * Real temporary SQLite and genuine verified WeakMap handles.
 * Synthetic identities, public test keys and settled-looking fixture rows are
 * not provider/custody/settlement evidence. ROOT owns isolated execution after
 * composing its full19 migration and fixed metadata policy dependency. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { syntheticA2aOriginal } from "../db/a2a-original-fixture";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "../db/storage-identity";
import { installMainnetApplicationSchema } from "../db/mainnet-application-schema";
import { installNativeUserDomainSchema, NATIVE_USER_DOMAIN_TABLES } from "../db/native-user-domain-schema";
import { insertStorageIdentity, installStorageFences, registerStorageCapability, STORAGE_APPLICATION_TABLES } from "../db/storage-identity-sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteForeignKeys, assertVerifiedSqliteNativeUserDomainPolicy, openVerifiedSqliteStorage } from "../db/storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "../db/enrolled-sqlite-schema-profile";
import { assertAccountSqliteSchema, createEnrolledSqliteAccountMembership, createSqliteAccountMembership } from "./sqlite-store";
import { createAccountMembershipService } from "./service";
import { createAccountHistoryProjection, readWithAccountFence } from "./history-projection";
import { accountConsentHash, accountDigest, membershipNonceHash, randomAccountValue, sessionCommitment } from "./protocol";
import type { InteractiveSession, Membership, MembershipChallenge } from "./contracts";

const binding = { origin: "https://keryx.example", network: "eip155:5042" } as const;
const consent = { version: 1, privateAccount: true, shareOwnedHistory: true } as const;
const linkConsent = { version: 1, sharePastAndFutureOwnedHistory: true, walletAuthorityStaysSeparate: true } as const;
const expectedOf = (membership: Membership) => ({ accountId: membership.accountId, revision: membership.revision });
// Public synthetic EOA keys; used for membership personal_sign, never payment.
const wallets = Array.from({ length: 10 }, (_, i) => privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, "0")}` as `0x${string}`));
const tables = [...NATIVE_USER_DOMAIN_TABLES.filter(name => name.startsWith("account267_")), "web_sessions"];
let directory: string, sequence: number;
const opened: Array<{ close(): void }> = [];
const originals: Array<{ file: string; hash: string }> = [];

function inspect<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return read(db); } finally { db.close(); }
}
function financialHash(file: string) {
  return inspect(file, db => {
    const available = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    const names = STORAGE_APPLICATION_TABLES.filter(name => available.has(name) && name !== "web_sessions"
      && !(NATIVE_USER_DOMAIN_TABLES as readonly string[]).includes(name));
    return createHash("sha256").update(JSON.stringify(names.map(table => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all()]))).digest("hex");
  });
}
function retained(file: string) {
  return inspect(file, db => tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
}
function edit(f: Fixture, action: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(f.file);
  // Explicit setup actor for disposable synthetic data. Never native authority.
  try { registerStorageCapability(db, f.identity, () => true); action(db); } finally { db.close(); }
}
function syntheticPopulationTransaction(f: Fixture, action: (db: DatabaseSync) => void) {
  // Only bulk disposable setup uses this wrapper; edit still closes in finally.
  edit(f, db => {
    try { db.exec("BEGIN IMMEDIATE"); action(db); db.exec("COMMIT"); }
    catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  });
}
function seedOriginal(db: DatabaseSync) {
  const { order, binding: originalBinding } = syntheticA2aOriginal(1, ARC_MAINNET_PROFILE);
  db.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,
    amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,package_data,status,transaction_id,
    request_data,response_data,execution_journal_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(order.id, order.id, order.authorizationId, order.requestHash, order.payer, order.payee, order.amountUsdc,
      order.creatorBudgetUsdc, order.serviceFeeUsdc, order.researchMode, JSON.stringify(order.researchPackage), "completed", order.transaction,
      JSON.stringify(order.request), JSON.stringify({ status: "completed", answer: "Synthetic original only" }), 1, order.createdAt, order.updatedAt);
  db.prepare(`INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,
    network,tx_hash,settled,settlement_status,authorization_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`inbound_${order.id}`, order.id, "inbound", "a2a", "Synthetic only", order.payer, order.payee, order.amountUsdc,
      originalBinding.network, order.transaction, 1, "settled", order.authorizationId, order.createdAt);
}
function fixture(options: { full?: boolean; profiles?: boolean; archive?: boolean; runtimeGuard?: () => void } = {}) {
  const file = join(directory, `native-${++sequence}.sqlite`);
  const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: "eip155:5042", profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const raw = new DatabaseSync(file);
  try {
    raw.exec("PRAGMA foreign_keys=ON"); raw.exec("BEGIN IMMEDIATE");
    installMainnetApplicationSchema(raw, { publicReferenceArchive: options.archive });
    if (options.full !== false) installNativeUserDomainSchema(raw);
    seedOriginal(raw);
    insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
  } finally { raw.close(); }
  originals.push({ file, hash: financialHash(file) });
  const connection = openVerifiedSqliteStorage(file, identity, { runtimeGuard: options.runtimeGuard,
    ...(options.profiles === false ? {} : { applicationProfiles: supportedSqliteApplicationProfiles(true) }) });
  opened.push(connection);
  return { file, identity, connection };
}
type Fixture = ReturnType<typeof fixture>;
function requiredStore(db: DatabaseSync) {
  const store = createEnrolledSqliteAccountMembership(db);
  if (!store) throw new Error("Expected full19 account membership");
  return store;
}
function setup(f: Fixture) {
  const store = requiredStore(f.connection.db);
  return { ...f, store, service: createAccountMembershipService(store, binding) };
}
function session(f: Fixture, index = 0, issuedAt = Math.floor(Date.now() / 1000) * 1000): InteractiveSession {
  const value = { sessionHash: randomAccountValue(), wallet: wallets[index].address.toLowerCase(), issuedAt, expiresAt: issuedAt + 600_000 };
  edit(f, db => db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
    .run(value.sessionHash, value.wallet, value.issuedAt, value.expiresAt));
  return value;
}
async function freshLogin(f: Fixture, index = 0) {
  const eligibleAt = inspect(f.file, db => Number(db.prepare("SELECT login_after FROM account267_credentials WHERE wallet=?")
    .get(wallets[index].address.toLowerCase())?.login_after));
  if (eligibleAt > Date.now()) await new Promise(resolve => setTimeout(resolve, eligibleAt - Date.now() + 5));
  return session(f, index);
}
async function bootstrap(f = fixture(), index = 0) {
  const base = setup(f), s = session(f, index), issued = await base.service.prepareCreate(s, consent);
  const start = await base.service.completeCreate(s, issued.nonce, consent);
  return { ...base, s, start, issued };
}
async function link(base: Awaited<ReturnType<typeof bootstrap>>, index = 1) {
  const current = (await base.service.resolve(base.s))!;
  const proof = await base.service.prepareLink(base.s, wallets[index].address, expectedOf(current.membership), linkConsent);
  const signature = await wallets[index].signMessage({ message: proof.message });
  return { proof, signature, result: await base.service.completeLink(base.s, proof.nonce, signature, linkConsent) };
}
// Temporary diagnostics for the parent's one changed observation. Only fixed
// public labels and elapsed milliseconds; no rows, paths, wallets or proof data.
// Call only at the named boundaries below, never per SQL call or fixture row.
function phaseTiming(journey: "unlink" | "oversized-challenges" | "oversized-sessions" | "max8-retention" | "exclusive-cleanup") {
  const started = performance.now();
  let previous = started;
  const mark = (phase: string) => {
    const now = performance.now();
    console.info(`[native-account267-phase] ${journey} ${phase} phaseMs=${Math.round(now - previous)} elapsedMs=${Math.round(now - started)}`);
    previous = now;
  };
  mark("start");
  return mark;
}
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "keryx-native-account267-")); sequence = 0; });
afterEach(() => {
  vi.restoreAllMocks();
  for (const connection of opened.splice(0)) connection.close();
  vi.unstubAllEnvs();
  // All actual tests, including failure paths, preserve every original financial
  // application table, with nonempty payment/order/authorization originals.
  try { for (const original of originals.splice(0)) expect(financialHash(original.file)).toBe(original.hash); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

describe("genuine enrolled account membership", () => {
  it("rolls back a failed synthetic population transaction and closes its setup connection", () => {
    const f = fixture(), before = retained(f.file), original = financialHash(f.file);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    let setupDb: DatabaseSync | undefined;
    expect(() => syntheticPopulationTransaction(f, db => {
      setupDb = db;
      const hash = randomAccountValue(), now = Date.now();
      const insert = db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)");
      insert.run(hash, wallets[0].address.toLowerCase(), now, now + 600_000);
      insert.run(randomAccountValue(), wallets[1].address.toLowerCase(), now, now + 600_000);
      expect(db.prepare("SELECT count(*) AS n FROM web_sessions").get()?.n).toBe(2);
      // Actual SQLite uniqueness failure after two successful synthetic inserts.
      insert.run(hash, wallets[0].address.toLowerCase(), now, now + 600_000);
    })).toThrow(/UNIQUE constraint failed/);
    expect(exec.mock.calls).toEqual([["BEGIN IMMEDIATE"], ["ROLLBACK"]]); exec.mockRestore();
    expect(setupDb).toBeDefined();
    expect(() => setupDb!.prepare("SELECT 1")).toThrow();
    expect(retained(f.file)).toEqual(before);
    expect(financialHash(f.file)).toBe(original);
  });
  it.each([false, true])("admits the full19 native family with archive=%s, positive FK and fixed policy", archive => {
    const f = fixture({ archive }), store = requiredStore(f.connection.db);
    expect(Object.isFrozen(store)).toBe(true);
    expect(() => assertVerifiedSqliteForeignKeys(f.connection.db)).not.toThrow();
    expect(() => f.connection.db.prepare("PRAGMA foreign_keys")).toThrow();
    expect(() => f.connection.db.exec("PRAGMA busy_timeout=0")).toThrow();
    expect(() => f.connection.db.exec("PRAGMA foreign_keys=OFF")).toThrow();
    expect(() => assertAccountSqliteSchema(f.connection.db)).toThrow("account_unavailable");
    expect(() => createSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
  });
  it("rejects ordinary/raw/foreign wrappers and extra constructor authority", () => {
    const f = fixture(), raw = new DatabaseSync(f.file); opened.push(raw);
    expect(() => createEnrolledSqliteAccountMembership(raw)).toThrow("account_unavailable");
    expect(() => createEnrolledSqliteAccountMembership(new Proxy(f.connection.db, {}))).toThrow("account_unavailable");
    expect(() => Reflect.apply(createEnrolledSqliteAccountMembership, undefined, [f.connection.db, () => true])).toThrow("account_unavailable");
    expect(() => Reflect.apply(createEnrolledSqliteAccountMembership, undefined, [f.connection.db, { native: true }])).toThrow("account_unavailable");
    expect(() => raw.prepare("INSERT INTO account267_accounts(account_id,revision,created_at) VALUES(?,0,?)")
      .run(`acct_${randomAccountValue()}`, Date.now())).toThrow();
  });
  it("requires trusted source policy even when genuine identity/fences are present", () => {
    const f = fixture({ profiles: false });
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
  });
  it("keeps one full guard per hot check and every genuine SQL primitive guard", async () => {
    let guardCalls = 0;
    const base = await bootstrap(fixture({ runtimeGuard: () => { guardCalls++; } }));
    guardCalls = 0;
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
    // Final post-COMMIT check + isTransaction/BEGIN/COMMIT + current clock execution
    // + one fused current read. Each primitive still runs its genuine full guard.
    expect(guardCalls).toBe(6);
  });
  it.each(["after BEGIN IMMEDIATE", "after the final fused read"] as const)("keeps the genuine full guard at the next primitive %s", async phase => {
    let failure = false;
    const base = await bootstrap(fixture({ runtimeGuard: () => { if (failure) throw new Error("Synthetic changed runtime guard"); } }));
    const before = retained(base.file), original = financialHash(base.file);
    let changed = 0;
    const exec = DatabaseSync.prototype.exec, get = StatementSync.prototype.get;
    const execSpy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, query: string) {
      const result = Reflect.apply(exec, this, [query]);
      if (phase === "after BEGIN IMMEDIATE" && query === "BEGIN IMMEDIATE") { changed++; failure = true; }
      return result;
    });
    const getSpy = vi.spyOn(StatementSync.prototype, "get").mockImplementation(function (this: StatementSync, ...args: Parameters<StatementSync["get"]>) {
      const result = Reflect.apply(get, this, args);
      if (phase === "after the final fused read" && this.sourceSQL.startsWith("WITH account_read AS")) { changed++; failure = true; }
      return result;
    });
    try {
      const operation = phase === "after BEGIN IMMEDIATE"
        ? base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent)
        : base.store.resolve(base.s, binding);
      await expect(operation).rejects.toThrow("account_unavailable");
    } finally { execSpy.mockRestore(); getSpy.mockRestore(); failure = false; }
    expect(changed).toBe(1);
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(() => assertVerifiedSqliteConnection(base.connection.db)).toThrow();
    expect(retained(base.file)).toEqual(before); expect(financialHash(base.file)).toBe(original);
  });
  it("reuses only guarded statements and rechecks current session rows on every read", async () => {
    const base = await bootstrap();
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
    // Bootstrap has already prepared this exact fixed native read. Full guards
    // still prepare their own identity/fence/schema statements on each execute.
    expect(prepare.mock.calls.filter(([query]) => query.startsWith("WITH account_read AS")).length).toBe(0);
    prepare.mockRestore();
    edit(base, db => db.prepare("UPDATE web_sessions SET wallet=? WHERE hash=?").run(wallets[1].address.toLowerCase(), base.s.sessionHash));
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unauthenticated");
    edit(base, db => db.prepare("UPDATE web_sessions SET wallet=? WHERE hash=?").run(base.s.wallet, base.s.sessionHash));
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
  });
  it("keeps the independent bounded credential set in fused membership reads", async () => {
    const base = await bootstrap(), wallet = wallets[1].address.toLowerCase();
    edit(base, db => db.prepare(`INSERT INTO account267_credentials(wallet,account_id,member_generation,generation,login_after,active)
      VALUES(?,?,?,?,?,1)`).run(wallet, base.start.membership.accountId, randomAccountValue(), randomAccountValue(), 0));
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    edit(base, db => db.prepare("DELETE FROM account267_credentials WHERE wallet=?").run(wallet));
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
  });
  it("refuses a genuine JSONB BLOB origin before any fused session admission", async () => {
    const base = await bootstrap();
    const replaceOrigin = (blob: boolean) => edit(base, db => db.prepare(`INSERT OR REPLACE INTO account267_sessions(
      session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
      SELECT session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,
        ${blob ? "jsonb(?)" : "?"},network,history_consent,revoked_at FROM account267_sessions WHERE session_hash=?`)
      .run(blob ? JSON.stringify(binding.origin) : binding.origin, base.s.sessionHash));
    replaceOrigin(true);
    const stored = inspect(base.file, db => db.prepare("SELECT origin,typeof(origin) AS storage,json_extract(origin,'$') AS decoded FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash)!);
    expect(stored.storage).toBe("blob");
    expect(stored.origin).not.toBe(binding.origin); // The original raw-row strict comparison refuses this value.
    expect(stored.decoded).toBe(binding.origin); // Genuine JSONB coercion, not a mocked decoder.
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unauthenticated");
    replaceOrigin(false);
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
  });
  it.each([false, true])("returns optional absence on exact BEFORE with archive=%s and preserves the same healthy connection", archive => {
    let guardCalls = 0;
    const f = fixture({ full: false, archive, runtimeGuard: () => { guardCalls++; } }), db = f.connection.db;
    const before = inspect(f.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    const calls = guardCalls;
    expect(createEnrolledSqliteAccountMembership(db)).toBeUndefined();
    expect(guardCalls).toBeGreaterThan(calls);
    expect(createEnrolledSqliteAccountMembership(db)).toBeUndefined();
    expect(f.connection.db).toBe(db); expect(db.isTransaction).toBe(false);
    expect(assertVerifiedSqliteConnection(db)).toEqual(f.identity);
    expect(() => assertVerifiedSqliteForeignKeys(db)).not.toThrow();
    expect(() => assertVerifiedSqliteNativeUserDomainPolicy(db)).toThrow();
    expect(db.prepare("SELECT count(*) AS n FROM payment_events").get()?.n).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_schema WHERE type='table'
      AND name IN (${NATIVE_USER_DOMAIN_TABLES.map(() => "?").join(",")})`).all(...NATIVE_USER_DOMAIN_TABLES)).toEqual([]);
    expect(inspect(f.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
  });
  it.each(["partial-family", "unknown-trigger"] as const)("refuses %s beside BEFORE instead of returning optional absence", kind => {
    // Deliberately omit captured profile policy so this also exercises the
    // constructor's own exact BEFORE check, rather than only the core guard.
    const f = fixture({ full: false, profiles: false });
    edit(f, db => {
      if (kind === "partial-family") {
        db.exec("CREATE TABLE private_profiles(wallet TEXT PRIMARY KEY)");
        installStorageFences(db, f.identity);
      } else db.exec("CREATE TRIGGER unknown_before_session AFTER INSERT ON web_sessions BEGIN SELECT 1; END");
    });
    const before = inspect(f.file, db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
    expect(() => assertVerifiedSqliteConnection(f.connection.db)).toThrow();
    expect(inspect(f.file, db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
  });
  it("refuses BEFORE fence failure and keeps qualified authority retired after exact restoration", () => {
    const f = fixture({ full: false }), name = `storage_fence_${accountDigest("web_sessions").slice(0, 16)}_insert`;
    const fence = inspect(f.file, db => String(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name)!.sql));
    edit(f, db => db.exec(`DROP TRIGGER ${name}`));
    const before = inspect(f.file, db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
    expect(inspect(f.file, db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
    edit(f, db => db.exec(fence));
    expect(() => assertVerifiedSqliteConnection(f.connection.db)).toThrow();
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
  });
  it("refuses a BEFORE manifest guard failure and never reinterprets restoration as healthy absence", () => {
    let fail = false;
    const f = fixture({ full: false, runtimeGuard: () => { if (fail) throw new Error("Synthetic BEFORE manifest drift"); } });
    fail = true;
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
    fail = false;
    expect(() => assertVerifiedSqliteConnection(f.connection.db)).toThrow();
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
  });
  it("refuses a partial native account shape before construction without installing or repairing it", () => {
    const f = fixture();
    edit(f, db => db.exec("DROP INDEX account267_challenges_account"));
    const before = inspect(f.file, db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    expect(() => createEnrolledSqliteAccountMembership(f.connection.db)).toThrow("account_unavailable");
    expect(inspect(f.file, db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
  });
  it("requires explicit private-history consent, exact target EOA proof and single consumption", async () => {
    const f = fixture(), base = setup(f), s = session(f), before = retained(f.file);
    await expect(base.service.prepareCreate(s, { ...consent, privateAccount: false } as never)).rejects.toThrow();
    expect(retained(f.file)).toEqual(before);
    const proof = await base.service.prepareCreate(s, consent);
    expect(proof.challenge.expiresAt - proof.challenge.issuedAt).toBe(300_000);
    const start = await base.service.completeCreate(s, proof.nonce, consent);
    expect(start.membership.members.map(member => member.wallet)).toEqual([s.wallet]);
    expect(start.membership.revision).toBe(1);
    await expect(base.service.completeCreate(s, proof.nonce, consent)).rejects.toThrow("invalid_membership_proof");
    const next = await base.service.prepareLink(s, wallets[1].address, expectedOf(start.membership), linkConsent);
    await expect(base.service.completeLink(s, next.nonce, await wallets[2].signMessage({ message: next.message }), linkConsent))
      .rejects.toThrow("invalid_membership_proof");
    await expect(base.service.completeLink(s, next.nonce, await wallets[1].signMessage({ message: next.message }), linkConsent))
      .rejects.toThrow("invalid_membership_proof");
    const valid = await base.service.prepareLink(s, wallets[1].address, expectedOf(start.membership), linkConsent);
    const linked = await base.service.completeLink(s, valid.nonce, await wallets[1].signMessage({ message: valid.message }), linkConsent);
    expect(linked.membership.members).toHaveLength(2); expect(linked.membership.revision).toBe(2);
    const events = inspect(f.file, db => db.prepare("SELECT * FROM account267_events ORDER BY revision").all());
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(proof.nonce); expect(JSON.stringify(events)).not.toContain(s.sessionHash);
  });
  it("resolves committed membership after genuine reopen and resumes only a fresh durable login with consent", async () => {
    const base = await bootstrap(), oldLogin = session(base, 0, base.s.issuedAt);
    await expect(base.service.offer(oldLogin)).rejects.toThrow("account_unauthenticated");
    const fresh = await freshLogin(base);
    expect(await base.service.resolve(fresh)).toBeNull();
    expect(await base.service.offer(fresh)).toEqual(expectedOf(base.start.membership));
    const before = retained(base.file);
    await expect(base.service.resume(fresh, expectedOf(base.start.membership), { ...consent, shareOwnedHistory: false } as never)).rejects.toThrow();
    expect(retained(base.file)).toEqual(before);
    const resumed = await base.service.resume(fresh, expectedOf(base.start.membership), consent);
    expect(resumed.membership).toEqual(base.start.membership);
    expect(resumed.memberGeneration).toBe(base.start.memberGeneration); expect(resumed.credentialGeneration).toBe(base.start.credentialGeneration);
    base.connection.close();
    const reopened = openVerifiedSqliteStorage(base.file, base.identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(reopened);
    expect(await requiredStore(reopened.db).resolve(fresh, binding)).toEqual(resumed);
    expect(inspect(base.file, db => db.prepare("SELECT expires_at FROM account267_sessions WHERE session_hash=?").get(fresh.sessionHash)?.expires_at)).toBe(fresh.expiresAt);
  });
  it.each(["wallet", "issued_at", "expires_at", "deleted"] as const)("refuses replaced durable session %s and leaves retained account binding intact", async field => {
    const base = await bootstrap(), before = inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions").all());
    edit(base, db => {
      if (field === "deleted") db.prepare("DELETE FROM web_sessions WHERE hash=?").run(base.s.sessionHash);
      else db.prepare(`UPDATE web_sessions SET ${field}=? WHERE hash=?`).run(field === "wallet" ? wallets[1].address.toLowerCase()
        : field === "issued_at" ? base.s.issuedAt + 1 : base.s.expiresAt + 1, base.s.sessionHash);
    });
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unauthenticated");
    await expect(base.store.assertCurrent(base.start)).rejects.toThrow("account_unauthenticated");
    expect(inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions").all())).toEqual(before);
  });
  it("consumes purpose/origin/network/session mismatches without nonce resurrection or inflated expiry", async () => {
    const base = await bootstrap(), otherSession = await freshLogin(base);
    for (const kind of ["purpose", "origin", "network", "session"] as const) {
      const proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
      const wrongBinding = kind === "origin" ? { ...binding, origin: "https://other.example" }
        : kind === "network" ? { ...binding, network: "eip155:5042002" as const } : binding;
      await expect(base.store.take(kind === "session" ? otherSession : base.s, wrongBinding, proof.nonce,
        kind === "purpose" ? "create-private-account" : "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
      const spent = inspect(base.file, db => db.prepare("SELECT * FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(proof.nonce))!);
      expect(spent.consumed_at).not.toBeNull(); expect(spent.expires_at).toBe(proof.challenge.expiresAt);
      await expect(base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
      expect(inspect(base.file, db => db.prepare("SELECT * FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(proof.nonce)))).toEqual(spent);
    }
    await expect(base.store.take(base.s, binding, randomAccountValue(), "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
  });
  it("rejects noncanonical origin, substituted consent/session commitments and altered proof TTL before admission", async () => {
    const base = await bootstrap(), proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const before = retained(base.file);
    expect(() => createAccountMembershipService(base.store, { ...binding, origin: `${binding.origin}/` })).toThrow();
    for (const changed of [{ ...proof.challenge, expiresAt: proof.challenge.expiresAt + 1 },
      { ...proof.challenge, consentHash: randomAccountValue() }, { ...proof.challenge, sessionCommitment: randomAccountValue() }])
      await expect(base.store.issue(base.s, changed, membershipNonceHash(proof.nonce))).rejects.toThrow();
    expect(retained(base.file)).toEqual(before);
  });
  it("keeps an expired retained proof consumed and an abandoned lease single-use across reopen", async () => {
    const base = await bootstrap(), nonce = randomAccountValue(), expiresAt = Date.now() - 1000;
    const challenge: MembershipChallenge = { ...base.issued.challenge, purpose: "link-wallet", wallet: wallets[1].address.toLowerCase(),
      revision: 1, generation: randomAccountValue(), consentHash: accountConsentHash("link-wallet"), issuedAt: expiresAt - 300_000, expiresAt,
      sessionCommitment: sessionCommitment(base.s, membershipNonceHash(nonce)) };
    edit(base, db => db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at) VALUES(?,?,?,?)")
      .run(membershipNonceHash(nonce), base.s.sessionHash, JSON.stringify(challenge), expiresAt));
    await expect(base.store.take(base.s, binding, nonce, "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
    const proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const taken = await base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue());
    await expect(base.store.complete(base.s, { ...taken, lease: randomAccountValue() }, randomAccountValue())).rejects.toThrow("invalid_membership_proof");
    base.connection.close();
    const connection = openVerifiedSqliteStorage(base.file, base.identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(connection);
    const store = requiredStore(connection.db);
    await expect(store.take(base.s, binding, nonce, "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
    await expect(store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
    expect((await store.complete(base.s, taken, randomAccountValue())).membership.revision).toBe(2);
    await expect(store.complete(base.s, taken, randomAccountValue())).rejects.toThrow("invalid_membership_proof");
  });
  it("rejects captured snapshots and pending final completion after account revision changes", async () => {
    const base = await bootstrap(), pending = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(base.start.membership), linkConsent);
    const taken = await base.store.take(base.s, binding, pending.nonce, "link-wallet", randomAccountValue());
    const linked = await link(base);
    await expect(base.store.assertCurrent(base.start)).rejects.toThrow("account_changed");
    await expect(base.store.complete(base.s, taken, randomAccountValue())).rejects.toThrow("account_changed");
    await expect(base.store.resume(await freshLogin(base), binding, expectedOf(base.start.membership), consent)).rejects.toThrow("account_changed");
    expect((await base.service.resolve(base.s))!.membership).toEqual(linked.result.membership);
    await expect(createAccountHistoryProjection(base.store, base.start).resolve(base.s.wallet)).rejects.toThrow("account_changed");
  });
  it("projects history only for the exact current consenting session and fences post-read unlink", async () => {
    const base = await bootstrap(), { result } = await link(base), projection = createAccountHistoryProjection(base.store, result);
    expect(await projection.resolve(base.s.wallet)).toEqual({ accountId: result.membership.accountId, revision: 2,
      wallets: result.membership.members.map(member => member.wallet) });
    await expect(projection.resolve(wallets[2].address)).rejects.toThrow("account_unauthenticated");
    const target = result.membership.members.find(member => member.wallet !== base.s.wallet)!;
    await expect(readWithAccountFence(base.store, result, async () => {
      await base.store.unlink(result, target.wallet, target.generation); return "private synthetic history";
    }, async () => {})).rejects.toThrow("account_changed");
  });
  it("unlink revokes live removed generations, cancels all unconsumed proofs, and preserves dead evidence/last credential", async () => {
    const mark = phaseTiming("unlink");
    const base = await bootstrap(); mark("bootstrap");
    const { result } = await link(base); mark("initial-link");
    const fresh = await freshLogin(base, 1); mark("fresh-login");
    const target = await base.service.resume(fresh, expectedOf(result.membership), consent);
    mark("resume");
    const proof = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent);
    mark("pending-proof");
    const removed = result.membership.members.find(member => member.wallet === fresh.wallet)!;
    const beforeSession = inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(fresh.sessionHash)!);
    const after = (await base.store.unlink(result, removed.wallet, removed.generation))!;
    mark("unlink");
    expect(after.revision).toBe(3); expect(after.members).toHaveLength(1);
    await expect(base.store.resolve(fresh, binding)).rejects.toThrow("account_unauthenticated");
    await expect(base.store.assertCurrent(target)).rejects.toThrow("account_unauthenticated");
    const revoked = inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(fresh.sessionHash)!);
    expect(revoked.revoked_at).not.toBeNull(); expect({ ...revoked, revoked_at: null }).toEqual(beforeSession);
    expect(inspect(base.file, db => db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(proof.nonce))?.consumed_at)).not.toBeNull();
    await expect(base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue())).rejects.toThrow("invalid_membership_proof");
    mark("revocation-and-nonce-refusals");
    const current = (await base.service.resolve(base.s))!, before = retained(base.file), last = current.membership.members[0];
    await expect(base.store.unlink(current, last.wallet, last.generation)).rejects.toThrow("last_credential");
    expect(retained(base.file)).toEqual(before);
    mark("last-credential-refusal");
    const relinked = await link(base, 1);
    mark("relink");
    expect(relinked.result.membership.members.find(member => member.wallet === fresh.wallet)!.generation).not.toBe(removed.generation);
    await expect(base.service.resume(fresh, expectedOf(relinked.result.membership), consent)).rejects.toThrow("account_unauthenticated");
    mark("old-session-refusal");
  });
  it("revoke keeps original session expiry immutable and old consent/proofs dead", async () => {
    const base = await bootstrap(), proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const taken = await base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue());
    await base.store.revokeSession(base.start);
    await expect(base.store.complete(base.s, taken, randomAccountValue())).rejects.toThrow("account_unauthenticated");
    await expect(base.service.resume(base.s, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
    const row = inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash)!);
    edit(base, db => {
      for (const [column, value] of [["revoked_at", null], ["revoked_at", Number(row.revoked_at) + 1], ["expires_at", base.s.expiresAt + 1000],
        ["issued_at", base.s.issuedAt + 1], ["member_generation", randomAccountValue()], ["credential_generation", randomAccountValue()]] as const)
        expect(() => db.prepare(`UPDATE account267_sessions SET ${column}=? WHERE session_hash=?`).run(value, base.s.sessionHash)).toThrow("account_unavailable");
    });
    expect(inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash))).toEqual(row);
    expect((await base.service.resume(await freshLogin(base), expectedOf(base.start.membership), consent)).membership).toEqual(base.start.membership);
  });
  it("unlink cancels old live generations but preserves expired generations and foreign account proof evidence", async () => {
    const base = await bootstrap(), { result } = await link(base), other = await bootstrap(base, 3);
    const target = result.membership.members.find(member => member.wallet !== base.s.wallet)!, now = Date.now();
    const credential = inspect(base.file, db => String(db.prepare("SELECT generation FROM account267_credentials WHERE wallet=?").get(target.wallet)!.generation));
    const liveHash = randomAccountValue(), deadHash = randomAccountValue(), expiredNonce = randomAccountValue(), expiresAt = now - 1000;
    const pending = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent);
    const expired: MembershipChallenge = { ...pending.challenge, issuedAt: expiresAt - 300_000, expiresAt,
      sessionCommitment: sessionCommitment(base.s, membershipNonceHash(expiredNonce)) };
    edit(base, db => {
      const insert = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,
        issued_at,expires_at,origin,network,history_consent,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`);
      insert.run(liveHash, target.wallet, result.membership.accountId, randomAccountValue(), randomAccountValue(), now - 1000, now + 60_000, binding.origin, binding.network);
      insert.run(deadHash, target.wallet, result.membership.accountId, target.generation, credential, now - 2000, expiresAt, binding.origin, binding.network);
      db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at) VALUES(?,?,?,?)")
        .run(membershipNonceHash(expiredNonce), base.s.sessionHash, JSON.stringify(expired), expiresAt);
    });
    const foreign = () => inspect(base.file, db => [
      ...["account267_accounts", "account267_members", "account267_credentials", "account267_sessions", "account267_events"]
        .map(table => db.prepare(`SELECT * FROM ${table} WHERE account_id=? ORDER BY 1`).all(other.start.membership.accountId)),
      db.prepare("SELECT * FROM account267_challenges WHERE json_extract(payload,'$.accountId')=? ORDER BY nonce_hash").all(other.start.membership.accountId),
      db.prepare("SELECT * FROM web_sessions WHERE hash=?").get(other.s.sessionHash),
    ]);
    const dead = inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(deadHash)), foreignBefore = foreign();
    await base.store.unlink(result, target.wallet, target.generation);
    expect(inspect(base.file, db => db.prepare("SELECT revoked_at FROM account267_sessions WHERE session_hash=?").get(liveHash)?.revoked_at)).not.toBeNull();
    expect(inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(deadHash))).toEqual(dead);
    for (const nonce of [expiredNonce, pending.nonce]) expect(inspect(base.file, db => db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?")
      .get(membershipNonceHash(nonce))?.consumed_at)).not.toBeNull();
    expect(foreign()).toEqual(foreignBefore);
  });
  it.each(["challenges", "sessions"] as const)("oversized retained unlink %s refuses atomically before any journal mutation", async kind => {
    const mark = phaseTiming(kind === "challenges" ? "oversized-challenges" : "oversized-sessions");
    const base = await bootstrap(); mark("bootstrap");
    const { result } = await link(base), target = result.membership.members.find(member => member.wallet !== base.s.wallet)!;
    mark("link");
    const proof = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent);
    mark("pending-proof");
    syntheticPopulationTransaction(base, db => {
      const challenge = db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at) VALUES(?,?,?,?)");
      const sessionInsert = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,
        issued_at,expires_at,origin,network,history_consent,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`);
      for (let i = 0; i < 1025; i++) {
        if (kind === "challenges") challenge.run(membershipNonceHash(randomAccountValue()), randomAccountValue(), JSON.stringify(proof.challenge), proof.challenge.expiresAt);
        else sessionInsert.run(randomAccountValue(), target.wallet, result.membership.accountId, randomAccountValue(), randomAccountValue(),
          base.s.issuedAt, base.s.expiresAt, binding.origin, binding.network);
      }
    });
    mark("populated-1025");
    const before = retained(base.file), prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    mark("snapshot");
    await expect(base.store.unlink(result, target.wallet, target.generation)).rejects.toThrow("account_unavailable");
    mark("unlink-refusal");
    expect(prepare.mock.calls.some(([query]) => /^(INSERT|UPDATE|DELETE)\b/.test(query))).toBe(false); prepare.mockRestore();
    expect(retained(base.file)).toEqual(before); expect((await base.service.resolve(base.s))!.membership).toEqual(result.membership);
    mark("postconditions");
  });
  it("preserves MAX8, eight live challenges and bounded retained challenge/event refusal", async () => {
    const mark = phaseTiming("max8-retention");
    const base = await bootstrap();
    mark("bootstrap");
    for (let i = 1; i < 8; i++) await link(base, i);
    mark("seven-links");
    const full = (await base.service.resolve(base.s))!;
    await expect(base.service.prepareLink(base.s, wallets[8].address, expectedOf(full.membership), linkConsent)).rejects.toThrow("account_full");
    mark("full-account-refusal");
    const other = await bootstrap(fixture(), 9);
    mark("second-bootstrap");
    const proofs: Awaited<ReturnType<typeof other.service.prepareLink>>[] = [];
    for (let i = 0; i < 8; i++) proofs.push(await other.service.prepareLink(other.s, wallets[0].address, expectedOf(other.start.membership), linkConsent));
    mark("eight-live-proofs");
    const before = retained(other.file);
    await expect(other.service.prepareLink(other.s, wallets[0].address, expectedOf(other.start.membership), linkConsent)).rejects.toThrow("account_unavailable");
    expect(retained(other.file)).toEqual(before);
    mark("live-cap-refusal");
    // Retention capacity is independent from live capacity. Synthetic retained
    // rows preserve exact payload/expiry; no pruning or issuer clock is changed.
    syntheticPopulationTransaction(other, db => {
      db.prepare("UPDATE account267_challenges SET consumed_at=?,lease_hash=? WHERE consumed_at IS NULL").run(Date.now(), randomAccountValue());
      const insert = db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at,consumed_at,lease_hash) VALUES(?,?,?,?,?,?)");
      for (let i = 8; i < 1024; i++) insert.run(membershipNonceHash(randomAccountValue()), other.s.sessionHash,
        JSON.stringify(proofs[0].challenge), proofs[0].challenge.expiresAt, Date.now(), randomAccountValue());
    });
    mark("retained-challenges-populated");
    const retainedBefore = retained(other.file);
    await expect(other.service.prepareLink(other.s, wallets[0].address, expectedOf(other.start.membership), linkConsent)).rejects.toThrow("account_unavailable");
    expect(retained(other.file)).toEqual(retainedBefore);
    mark("retained-cap-refusal");
    const eventBase = await bootstrap(fixture(), 8); mark("event-bootstrap");
    const proof = await eventBase.service.prepareLink(eventBase.s, wallets[0].address, expectedOf(eventBase.start.membership), linkConsent);
    const taken = await eventBase.store.take(eventBase.s, binding, proof.nonce, "link-wallet", randomAccountValue());
    mark("event-proof-taken");
    syntheticPopulationTransaction(eventBase, db => {
      const insert = db.prepare(`INSERT INTO account267_events(id,account_id,revision,purpose,lineage_hash,consent_hash,proof_hash,created_at)
        SELECT ?,account_id,revision,purpose,lineage_hash,consent_hash,proof_hash,created_at FROM account267_events LIMIT 1`);
      for (let i = 1; i < 1024; i++) insert.run(randomAccountValue());
    });
    mark("retained-events-populated");
    const eventsBefore = retained(eventBase.file);
    await expect(eventBase.store.complete(eventBase.s, taken, randomAccountValue())).rejects.toThrow("account_unavailable");
    expect(retained(eventBase.file)).toEqual(eventsBefore);
    mark("event-cap-refusal");
  });
  it.each(["revoked", "expired", "live"] as const)("counts live bindings rather than cumulative retained %s rows", async kind => {
    const base = await bootstrap(), fresh = await freshLogin(base), now = Date.now();
    if (kind !== "live") await base.store.revokeSession(base.start);
    syntheticPopulationTransaction(base, db => {
      const insert = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,
        issued_at,expires_at,origin,network,history_consent,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,1,?)`);
      for (let i = 0; i < (kind === "live" ? 1023 : 1024); i++) insert.run(randomAccountValue(), base.s.wallet,
        base.start.membership.accountId, base.start.memberGeneration, base.start.credentialGeneration,
        kind === "expired" ? now - 2000 : fresh.issuedAt, kind === "expired" ? now - 1000 : fresh.expiresAt,
        binding.origin, binding.network, kind === "revoked" ? now : null);
    });
    const before = retained(base.file);
    if (kind === "live") {
      await expect(base.service.resume(fresh, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unavailable");
      expect(retained(base.file)).toEqual(before);
      await base.store.revokeSession(base.start);
    }
    const retainedBefore = inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions ORDER BY session_hash").all());
    const resumed = await base.service.resume(fresh, expectedOf(base.start.membership), consent);
    expect(resumed.credentialGeneration).toBe(base.start.credentialGeneration);
    expect(inspect(base.file, db => db.prepare("SELECT * FROM account267_sessions WHERE session_hash!=? ORDER BY session_hash").all(fresh.sessionHash))).toEqual(retainedBefore);
  });
  it("uses genuine read transactions and denies all readonly mutation methods before any SQL", async () => {
    const base = await bootstrap(), pending = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const taken = await base.store.take(base.s, binding, pending.nonce, "link-wallet", randomAccountValue());
    const unused = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(base.start.membership), linkConsent);
    let guardCalls = 0;
    const connection = openVerifiedSqliteStorage(base.file, base.identity, { readOnly: true, runtimeGuard: () => { guardCalls++; },
      applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(connection);
    const reader = requiredStore(connection.db), before = retained(base.file), calls = guardCalls;
    const member = base.start.membership.members[0];
    for (const write of [() => reader.resume(base.s, binding, expectedOf(base.start.membership), consent),
      () => reader.issue(base.s, unused.challenge, membershipNonceHash(randomAccountValue())),
      () => reader.take(base.s, binding, unused.nonce, "link-wallet", randomAccountValue()),
      () => reader.complete(base.s, taken, randomAccountValue()), () => reader.unlink(base.start, member.wallet, member.generation),
      () => reader.revokeSession(base.start)]) await expect(write()).rejects.toThrow("account_unavailable");
    expect(guardCalls).toBe(calls); expect(retained(base.file)).toEqual(before);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    expect(await reader.offer(base.s, binding)).toEqual(expectedOf(base.start.membership));
    expect(await reader.resolve(base.s, binding)).toEqual(base.start); await reader.assertCurrent(base.start);
    expect(exec.mock.calls.some(([sql]) => sql === "BEGIN")).toBe(true);
    expect(exec.mock.calls.some(([sql]) => sql === "BEGIN IMMEDIATE")).toBe(false);
    exec.mockRestore();
    expect(() => assertVerifiedSqliteConnection(connection.db)).not.toThrow();
  });
  it("enforces positive immutable native FK policy on an actual financial FK", () => {
    const f = fixture(), store = requiredStore(f.connection.db);
    expect(store).toBeDefined(); expect(() => assertVerifiedSqliteForeignKeys(f.connection.db)).not.toThrow();
    // A missing monthly/order parent cannot be admitted on this genuine
    // connection. This is a rollback-only negative fixture, not a financial API.
    f.connection.db.exec("BEGIN IMMEDIATE");
    try {
      expect(() => f.connection.db.prepare(`INSERT INTO research_monthly_redemptions(monthly_id,request_id,order_id,request_hash,created_at,slot)
        VALUES(?,?,?,?,?,0)`).run("synthetic-missing-monthly", "synthetic-request", "synthetic-missing-order", randomAccountValue(), new Date().toISOString()))
        .toThrow("FOREIGN KEY");
    }
    finally { f.connection.db.exec("ROLLBACK"); }
  });
  it.each(["index", "fence", "foreign-trigger", "family"] as const)("permanently latches %s schema drift, including after exact restoration", async kind => {
    const base = await bootstrap(), before = retained(base.file);
    let restore: (db: DatabaseSync) => void = () => {};
    edit(base, db => {
      if (kind === "index") {
        const sql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='account267_credentials_account'").get()!.sql);
        db.exec("DROP INDEX account267_credentials_account"); restore = raw => raw.exec(sql);
      } else if (kind === "fence") {
        const name = `storage_fence_${accountDigest("account267_members").slice(0, 16)}_insert`;
        const sql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(name)!.sql);
        db.exec(`DROP TRIGGER ${name}`); restore = raw => raw.exec(sql);
      } else if (kind === "foreign-trigger") {
        db.exec("CREATE TRIGGER foreign_account_writer AFTER INSERT ON users BEGIN DELETE FROM account267_members; END");
        restore = raw => raw.exec("DROP TRIGGER foreign_account_writer");
      } else {
        const sql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='profile_identity_challenges'").get()!.sql);
        const dependents = db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='profile_identity_challenges' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
        db.exec("DROP TABLE profile_identity_challenges");
        restore = raw => { raw.exec(sql); for (const row of dependents) raw.exec(String(row.sql)); };
      }
    });
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    edit(base, restore);
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(retained(base.file)).toEqual(before);
  });
  it.each(["manifest", "ordinary-error"])("permanently latches restored %s guard failures without treating arbitrary Error as contention", async kind => {
    let fail = false;
    const base = await bootstrap(fixture({ runtimeGuard: () => { if (fail) throw new Error(kind === "manifest" ? "Synthetic manifest changed" : "database is locked"); } }));
    const before = retained(base.file); fail = true;
    await expect(base.store.offer(base.s, binding)).rejects.toThrow("account_unavailable"); fail = false;
    await expect(base.store.offer(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(retained(base.file)).toEqual(before);
    expect(() => assertVerifiedSqliteConnection(base.connection.db)).toThrow();
  });
  it("latches a real guard failure inside the swallowed take projection and never returns an invalid-proof fallback", async () => {
    let fail = false;
    const base = await bootstrap(fixture({ runtimeGuard: () => { if (fail) throw new Error("Synthetic internal manifest drift"); } }));
    const proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const before = retained(base.file), run = StatementSync.prototype.run;
    const spy = vi.spyOn(StatementSync.prototype, "run").mockImplementation(function (this: StatementSync, ...args) {
      const result = Reflect.apply(run, this, args);
      if (this.sourceSQL === "UPDATE account267_challenges SET consumed_at=?,lease_hash=? WHERE nonce_hash=? AND consumed_at IS NULL") fail = true;
      return result;
    });
    await expect(base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue())).rejects.toThrow("account_unavailable");
    spy.mockRestore(); fail = false;
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(retained(base.file)).toEqual(before);
  });
  it("refuses actual fixed-timeout native contention without retries, then preserves healthy shared readers", async () => {
    const base = await bootstrap(), proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const blocker = new DatabaseSync(base.file); opened.push(blocker);
    const before = retained(base.file), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    blocker.exec("BEGIN IMMEDIATE");
    await expect(base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue())).rejects.toThrow("account_unavailable");
    const attempts = exec.mock.calls.filter(([query]) => query === "BEGIN IMMEDIATE").length;
    blocker.exec("ROLLBACK"); exec.mockRestore();
    expect(attempts).toBe(2); // one blocker + exactly one account attempt
    expect(retained(base.file)).toEqual(before);
    expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
    expect(base.connection.db.prepare("SELECT count(*) AS n FROM payment_events").get()?.n).toBe(1);
    expect(() => assertVerifiedSqliteConnection(base.connection.db)).not.toThrow();
    const taken = await base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue());
    expect((await base.store.complete(base.s, taken, randomAccountValue())).membership.revision).toBe(2);
  }, 15_000);
  it("permanently latches when an actual EXCLUSIVE lock prevents cleanup inspection", async () => {
    const mark = phaseTiming("exclusive-cleanup");
    const base = await bootstrap(), before = retained(base.file);
    mark("bootstrap-and-snapshot");
    const blocker = new DatabaseSync(base.file); opened.push(blocker);
    blocker.exec("BEGIN EXCLUSIVE");
    try {
      mark("exclusive-acquired");
      await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
      mark("cleanup-refusal");
    }
    finally { blocker.exec("ROLLBACK"); mark("exclusive-released"); }
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(() => assertVerifiedSqliteConnection(base.connection.db)).toThrow();
    expect(retained(base.file)).toEqual(before);
    mark("permanent-latch-and-retention");
  }, 15_000);
  it.each([false, true])("lost final COMMIT acknowledgement (persisted=%s) grants no success and permanently latches the port", async persisted => {
    const f = fixture(), base = setup(f), s = session(f), proof = await base.service.prepareCreate(s, consent);
    const taken = await base.store.take(s, binding, proof.nonce, "create-private-account", randomAccountValue());
    const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
    let finalWrite = false, commits = 0;
    const prepareSpy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, query: string) {
      if (query.startsWith("INSERT INTO account267_accounts")) finalWrite = true;
      return Reflect.apply(prepare, this, [query]);
    });
    const execSpy = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, query: string) {
      if (query === "COMMIT" && finalWrite) {
        finalWrite = false; commits++;
        if (persisted) Reflect.apply(exec, this, [query]);
        throw new Error("Synthetic lost native COMMIT acknowledgement");
      }
      return Reflect.apply(exec, this, [query]);
    });
    await expect(base.store.complete(s, taken, randomAccountValue())).rejects.toThrow("account_unavailable");
    execSpy.mockRestore(); prepareSpy.mockRestore(); expect(commits).toBe(1);
    await expect(base.store.resolve(s, binding)).rejects.toThrow("account_unavailable");
    expect(inspect(f.file, db => db.prepare("SELECT count(*) AS n FROM account267_accounts").get()?.n)).toBe(persisted ? 1 : 0);
    const row = inspect(f.file, db => db.prepare("SELECT * FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(proof.nonce))!);
    expect(row.consumed_at).not.toBeNull(); expect(row.completed_at !== null).toBe(persisted); expect(row.expires_at).toBe(proof.challenge.expiresAt);
    const reopened = openVerifiedSqliteStorage(f.file, f.identity, { applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(reopened);
    expect(Boolean(await requiredStore(reopened.db).resolve(s, binding))).toBe(persisted);
  });
  it("identity replacement permanently latches after the exact marker and guards are restored", async () => {
    const base = await bootstrap();
    const marker = inspect(base.file, db => db.prepare("SELECT identity FROM keryx_storage_identity WHERE id=1").get()!.identity);
    const trigger = inspect(base.file, db => String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='storage_identity_no_update'").get()!.sql));
    const replace = (value: string) => edit(base, db => {
      db.exec("DROP TRIGGER storage_identity_no_update");
      db.prepare("UPDATE keryx_storage_identity SET identity=? WHERE id=1").run(value);
      db.exec(trigger);
    });
    replace(JSON.stringify({ ...base.identity, storageId: syntheticStorageIdentity("mainnet-real").storageId }));
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    replace(String(marker));
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(() => assertVerifiedSqliteConnection(base.connection.db)).toThrow();
  });
  it("qualifies actual held-file rename prevention or permanent refusal after real replacement", async () => {
    const base = await bootstrap(), replacement = fixture();
    const original = join(directory, "held-original.sqlite"), db = base.connection.db;
    const bytes = readFileSync(base.file), identity = statSync(base.file, { bigint: true });
    const schema = inspect(base.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    // Exactly one actual substitution attempt, with every held handle intact.
    let renameError: unknown;
    try { renameSync(base.file, original); } catch (error) { renameError = error; }
    if (process.platform === "win32") {
      expect(renameError).toBeInstanceOf(Error);
      expect(renameError).toMatchObject({ code: "EBUSY", syscall: "rename", path: base.file, dest: original });
      expect(existsSync(original)).toBe(false); expect(readFileSync(base.file)).toEqual(bytes);
      const unchanged = statSync(base.file, { bigint: true });
      expect([unchanged.dev, unchanged.ino, unchanged.birthtimeNs]).toEqual([identity.dev, identity.ino, identity.birthtimeNs]);
      expect(base.connection.db).toBe(db); expect(assertVerifiedSqliteConnection(db)).toEqual(base.identity);
      expect(await base.store.resolve(base.s, binding)).toEqual(base.start);
      expect(inspect(base.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(schema);
      expect(readFileSync(base.file)).toEqual(bytes);
      return;
    }
    if (renameError) throw renameError;
    try {
      copyFileSync(replacement.file, base.file);
      await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    } finally { rmSync(base.file); renameSync(original, base.file); }
    await expect(base.store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(readFileSync(base.file)).toEqual(bytes);
    expect(inspect(base.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(schema);
  });
});

/** Actual selected-facade construction; no mocked factory or supplied authority. */
async function facadeFixture(f: Fixture) {
  vi.resetModules();
  const manifestPath = join(directory, `deployment-${sequence}.json`);
  const manifest = canonicalJson({ format: "keryx-storage-deployment-v1", identity: f.identity,
    backend: { kind: "sqlite", databasePath: f.file } });
  writeFileSync(manifestPath, manifest);
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", f.file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "ab".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  const api = await import("../db/enrolled-sqlite-adapter");
  return { api, manifestPath, manifest };
}
describe("genuine enrolled account facade", () => {
  it.each([false, true])("keeps optional account absence on exact BEFORE with archive=%s and a healthy facade", async archive => {
    const f = fixture({ full: false, archive }), { api } = await facadeFixture(f);
    const schema = inspect(f.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    const adapter = await api.createEnrolledSqliteAdapter(); opened.push(adapter);
    expect(Object.isFrozen(adapter)).toBe(true); expect(Object.hasOwn(adapter, "accountMembership")).toBe(false);
    expect(api.assertEnrolledSqliteAdapter(adapter)).toEqual(f.identity);
    expect(await adapter.getWebSession(randomAccountValue())).toBeNull();
    expect(inspect(f.file, raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(schema);
  });
  it("publishes a frozen nonenumerable account port and keeps readonly denial ahead of manifest I/O", async () => {
    const base = await bootstrap(), { api, manifestPath, manifest } = await facadeFixture(base);
    const adapter = await api.createReadonlyEnrolledSqliteAdapter(); opened.push(adapter);
    const reader = adapter.accountMembership;
    if (!reader) throw new Error("Expected selected native account membership");
    expect(Object.getOwnPropertyDescriptor(adapter, "accountMembership")).toEqual({ value: reader,
      enumerable: false, writable: false, configurable: false });
    expect(Object.isFrozen(adapter)).toBe(true); expect(Object.isFrozen(reader)).toBe(true);
    expect(Object.keys(adapter)).not.toContain("accountMembership");
    expect(Reflect.get(adapter, "db")).toBeUndefined();
    const before = retained(base.file);
    writeFileSync(manifestPath, "{}");
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    await expect(reader.revokeSession(base.start)).rejects.toThrow("account_unavailable");
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    prepare.mockRestore(); exec.mockRestore(); writeFileSync(manifestPath, manifest);
    expect(await reader.resolve(base.s, binding)).toEqual(base.start);
    expect(retained(base.file)).toEqual(before); expect(api.assertEnrolledSqliteAdapter(adapter)).toEqual(base.identity);
  });
  it("retires the selected facade after account manifest failure even when exact configuration is restored", async () => {
    const base = await bootstrap(), { api, manifestPath, manifest } = await facadeFixture(base);
    const adapter = await api.createEnrolledSqliteAdapter(); opened.push(adapter);
    const store = adapter.accountMembership;
    if (!store) throw new Error("Expected selected native account membership");
    expect(await store.resolve(base.s, binding)).toEqual(base.start);
    const before = retained(base.file);
    writeFileSync(manifestPath, "{}");
    await expect(store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    writeFileSync(manifestPath, manifest);
    await expect(store.resolve(base.s, binding)).rejects.toThrow("account_unavailable");
    expect(() => api.assertEnrolledSqliteAdapter(adapter)).toThrow();
    expect(() => adapter.getWebSession(base.s.sessionHash)).toThrow();
    expect(retained(base.file)).toEqual(before);
  });
});
