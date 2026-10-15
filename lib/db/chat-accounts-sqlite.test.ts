/** UNRUN source controls. Disposable synthetic data, genuine registered native
 * SQLite handles. Fixture rows are not real login, provider or settlement proof. */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnrolledSqliteChatAccountLinks } from "./chat-accounts-sqlite";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { chatTokenHash } from "../chat-accounts/service";
import type { AccountSnapshot } from "../accounts/contracts";
import type { ChatRecipient } from "../chat-accounts/contracts";
import { canonicalJson } from "../canonical-json";
import { NATIVE_USER_DOMAIN_TABLES } from "./native-user-domain-schema";

const binding = { origin: "https://keryx.example", network: "eip155:5042" } as const;
const recipients: ChatRecipient[] = [
  { platform: "telegram", scope: "telegram", userId: "7", channel: "7" },
  { platform: "slack", scope: "T1", userId: "U1", channel: "D1" },
  { platform: "discord", scope: "123", userId: "456", channel: "789" },
];
const directories: string[] = [], connections: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks(); for (const connection of connections.splice(0)) connection.close();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !directory.includes("keryx-chat263-")) throw new Error("Unsafe fixture cleanup");
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(full = true) {
  const directory = mkdtempSync(join(tmpdir(), "keryx-chat263-")); directories.push(directory);
  const file = join(directory, "native.sqlite");
  const identity: StorageIdentity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
    network: binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
  const raw = new DatabaseSync(file);
  try {
    raw.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(raw);
    if (full) installNativeUserDomainSchema(raw);
    insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
  } finally { raw.close(); }
  const open = (readOnly = false) => {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard() {}, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    connections.push(connection); return connection;
  };
  const edit = <T>(action: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(file); try { registerStorageCapability(db, identity, () => true); return action(db); } finally { db.close(); }
  };
  return { file, directory, identity, open, edit };
}
/** Full real selected application factory, not a direct chat-port substitute. */
async function application(f: ReturnType<typeof fixture>) {
  vi.resetModules();
  const manifestPath = join(f.directory, "deployment.json");
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity: f.identity,
    backend: { kind: "sqlite", databasePath: f.file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", f.file);
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"5".repeat(40)}`);
  vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"5".repeat(40)}`);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "ab".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  vi.stubEnv("JWT_SECRET", "PUBLIC-SYNTHETIC-CHAT263-CONSENT-TEST-SECRET");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider/network allowed in this fixture"); }));
  const { createApplicationStorage } = await import("./application-storage");
  const db = await createApplicationStorage();
  if (!db) throw new Error("Expected selected application facade");
  const close = Reflect.get(db, "close");
  if (typeof close !== "function") throw new Error("Expected native disposal");
  connections.push({ close: () => Reflect.apply(close, db, []) });
  return db;
}
function sameAccountLogin(f: ReturnType<typeof fixture>, owner: AccountSnapshot, otherMember: boolean) {
  const now = Date.now(), session = { sessionHash: randomBytes(32).toString("hex"),
    wallet: otherMember ? `0x${"2".repeat(40)}` : owner.session.wallet, issuedAt: now - 500, expiresAt: now + 60_000 };
  const memberGeneration = otherMember ? randomBytes(32).toString("hex") : owner.memberGeneration;
  const credentialGeneration = otherMember ? randomBytes(32).toString("hex") : owner.credentialGeneration;
  f.edit(db => {
    db.exec("BEGIN IMMEDIATE");
    if (otherMember) {
      db.prepare("INSERT INTO account267_members(wallet,account_id,generation,consent_hash,linked_at) VALUES(?,?,?,?,?)")
        .run(session.wallet, owner.membership.accountId, memberGeneration, "f".repeat(64), now - 2000);
      db.prepare("INSERT INTO account267_credentials(wallet,account_id,member_generation,generation,login_after,active) VALUES(?,?,?,?,?,1)")
        .run(session.wallet, owner.membership.accountId, memberGeneration, credentialGeneration, now - 3000);
    }
    db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)")
      .run(session.sessionHash, session.wallet, session.issuedAt, session.expiresAt);
    db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent)
      VALUES(?,?,?,?,?,?,?,?,?,1)`).run(session.sessionHash, session.wallet, owner.membership.accountId, memberGeneration,
        credentialGeneration, session.issuedAt, session.expiresAt, binding.origin, binding.network);
    db.exec("COMMIT");
  });
  return session;
}
function seedAccount(f: ReturnType<typeof fixture>, digit = "1"): AccountSnapshot {
  const now = Date.now(), wallet = `0x${digit.repeat(40)}`, accountId = `acct_${digit.repeat(64)}`;
  const memberGeneration = randomBytes(32).toString("hex"), credentialGeneration = randomBytes(32).toString("hex");
  const session = { sessionHash: randomBytes(32).toString("hex"), wallet, issuedAt: now - 1000, expiresAt: now + 60_000 };
  f.edit(db => {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO account267_accounts(account_id,revision,created_at) VALUES(?,1,?)").run(accountId, now - 2000);
    db.prepare("INSERT INTO account267_members(wallet,account_id,generation,consent_hash,linked_at) VALUES(?,?,?,?,?)").run(wallet, accountId, memberGeneration, "f".repeat(64), now - 2000);
    db.prepare("INSERT INTO account267_credentials(wallet,account_id,member_generation,generation,login_after,active) VALUES(?,?,?,?,?,1)").run(wallet, accountId, memberGeneration, credentialGeneration, now - 3000);
    db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)").run(session.sessionHash, wallet, session.issuedAt, session.expiresAt);
    db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent)
      VALUES(?,?,?,?,?,?,?,?,?,1)`).run(session.sessionHash, wallet, accountId, memberGeneration, credentialGeneration, session.issuedAt, session.expiresAt, binding.origin, binding.network);
    db.exec("COMMIT");
  });
  return { membership: { version: 1, accountId, revision: 1, createdAt: now - 2000, members: [{ wallet, generation: memberGeneration, linkedAt: now - 2000 }] },
    session, memberGeneration, credentialGeneration, binding };
}
function pending(recipient: ChatRecipient) {
  const token = randomBytes(32).toString("hex"), issuedAt = Date.now();
  return { token, value: { purpose: "chat-account-link-v1" as const, tokenHash: chatTokenHash(token), recipient, binding, issuedAt, expiresAt: issuedAt + 300_000 } };
}
function untouchedFinancial(f: ReturnType<typeof fixture>) {
  return f.edit(db => ["query_runs", "payment_events", "session_grants", "browser_authorization_intents", "a2a_orders"]
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
}
describe("chat263 native durable journal (UNRUN)", () => {
  it("starts the real application facade with the expanded full family and resolves accountMembership before using chat links", async () => {
    const f = fixture(), owner = seedAccount(f), financial = untouchedFinancial(f);
    const before = f.edit(db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    expect(NATIVE_USER_DOMAIN_TABLES).toHaveLength(22); expect(supportedSqliteApplicationProfiles(true)).toHaveLength(4);
    const exec = vi.spyOn(DatabaseSync.prototype, "exec");
    const db = await application(f), account = db.accountMembership, chat = db.chatAccountLinks;
    expect(exec.mock.calls.some(([sql]) => sql === "PRAGMA busy_timeout=5000")).toBe(true);
    expect(exec.mock.calls.some(([sql]) => /busy_timeout=(?!5000)/.test(sql))).toBe(false);
    exec.mockRestore();
    expect(Object.isFrozen(db)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(db, "accountMembership")).toMatchObject({ enumerable: false, writable: false, configurable: false });
    expect(Object.getOwnPropertyDescriptor(db, "chatAccountLinks")).toMatchObject({ enumerable: false });
    expect(account).toBeDefined(); expect(chat).toBeDefined();
    expect(await account!.resolve(owner.session, binding)).toEqual(owner);
    const p = pending(recipients[0]); await chat!.issue(p.value); await chat!.complete(p.value.tokenHash, owner);
    expect(await chat!.list(owner)).toHaveLength(1);
    expect(f.edit(raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
    expect(untouchedFinancial(f)).toEqual(financial); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps the actual application facade healthy on exact BEFORE without installing optional domains", async () => {
    const f = fixture(false), before = f.edit(raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    const db = await application(f);
    expect(Object.hasOwn(db, "accountMembership")).toBe(false); expect(Object.hasOwn(db, "chatAccountLinks")).toBe(false);
    expect(await db.getWebSession("a".repeat(64))).toBeNull();
    expect(f.edit(raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses altered full-family startup through createApplicationStorage without schema repair", async () => {
    const f = fixture(); f.edit(db => db.exec("DROP INDEX account267_sessions_live"));
    const before = f.edit(raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all());
    await expect(application(f)).rejects.toThrow();
    expect(f.edit(raw => raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all())).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])("binds actual native preview to its original session across same-account replacement (otherMember=%s)", async otherMember => {
    const f = fixture(), owner = seedAccount(f), replacement = sameAccountLogin(f, owner, otherMember);
    const db = await application(f), p = pending(recipients[0]), financial = untouchedFinancial(f);
    const { createChatAccountRoutes } = await import("../chat-accounts/http");
    await db.chatAccountLinks!.issue(p.value);
    let current = owner.session;
    const routes = createChatAccountRoutes({ binding, session: async () => ({ db, wallet: current.wallet, currentId: current.sessionHash }) });
    const request = (path: string, body: unknown) => new Request(binding.origin + path, { method: "POST",
      headers: { Origin: binding.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const previewed = await routes.account(request("/api/me/chat-accounts", { action: "preview", token: p.token }));
    expect(previewed.status).toBe(200); const view = await previewed.json();
    const complete = () => request("/api/me/chat-accounts/complete", { token: p.token, consentProof: view.consentProof,
      ...view.account, consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] });
    current = replacement;
    expect((await db.accountMembership!.resolve(current, binding))?.membership.revision).toBe(view.account.revision);
    expect((await routes.complete(complete())).status).toBe(409);
    expect(await db.chatAccountLinks!.preview(p.value.tokenHash, binding)).toEqual(p.value);
    current = owner.session; expect((await routes.complete(complete())).status).toBe(200);
    expect((await routes.complete(complete())).status).toBe(410);
    expect((await db.chatAccountLinks!.lookup(recipients[0], binding))?.wallet).toBe(owner.session.wallet);
    expect(untouchedFinancial(f)).toEqual(financial); expect(fetch).not.toHaveBeenCalled();
  });
  it("rechecks the exact original native snapshot after awaiting the completion body", async () => {
    const f = fixture(), owner = seedAccount(f), db = await application(f), p = pending(recipients[0]);
    const { createChatAccountRoutes } = await import("../chat-accounts/http");
    await db.chatAccountLinks!.issue(p.value);
    const routes = createChatAccountRoutes({ binding, session: async () => ({ db, wallet: owner.session.wallet, currentId: owner.session.sessionHash }) });
    const viewed = await routes.account(new Request(binding.origin + "/api/me/chat-accounts", { method: "POST",
      headers: { Origin: binding.origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", token: p.token }) }));
    expect(viewed.status).toBe(200); const view = await viewed.json();
    let release!: () => void, waiting!: () => void;
    const arrived = new Promise<void>(yes => { waiting = yes; });
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      waiting(); return new Promise<void>(yes => { release = () => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ token: p.token, consentProof: view.consentProof,
          ...view.account, consent: { version: 1, linkFutureRuns: true, financialAuthorityUnchanged: true }, pastRunIds: [] })));
        controller.close(); yes();
      }; });
    } }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: "half" } = { method: "POST",
      headers: { Origin: binding.origin, "Content-Type": "application/json" }, body, duplex: "half" };
    const request = new Request(binding.origin + "/api/me/chat-accounts/complete", init);
    const result = routes.complete(request); await arrived;
    f.edit(raw => raw.prepare("DELETE FROM web_sessions WHERE hash=?").run(owner.session.sessionHash));
    release(); expect((await result).status).toBe(409);
    expect(await db.chatAccountLinks!.preview(p.value.tokenHash, binding)).toEqual(p.value);
    expect(f.edit(raw => raw.prepare("SELECT count(*) AS n FROM chat263_links").get()?.n)).toBe(0);
  });
  it.each(recipients)("links, looks up, lists and unlinks verified $platform identity with hash-only single use", async recipient => {
    const f = fixture(), owner = seedAccount(f), store = createEnrolledSqliteChatAccountLinks(f.open().db)!;
    const original = untouchedFinancial(f), p = pending(recipient);
    await store.issue(p.value);
    const retained = f.edit(db => db.prepare("SELECT * FROM chat263_tokens").all());
    expect(JSON.stringify(retained)).toContain(p.value.tokenHash); expect(JSON.stringify(retained)).not.toContain(p.token);
    expect(await store.preview(p.value.tokenHash, binding)).toEqual(p.value);
    const results = await Promise.allSettled([store.complete(p.value.tokenHash, owner), store.complete(p.value.tokenHash, owner)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const reopened = createEnrolledSqliteChatAccountLinks(f.open().db)!;
    await expect(reopened.complete(p.value.tokenHash, owner)).rejects.toThrow("chat_token_invalid");
    expect(await store.lookup(recipient, binding)).toMatchObject({ accountId: owner.membership.accountId, wallet: owner.session.wallet, ...recipient });
    expect(await store.list(owner)).toHaveLength(1);
    await store.unlink(recipient, binding); expect(await store.lookup(recipient, binding)).toBeNull();
    expect(untouchedFinancial(f)).toEqual(original);
  });
  it("refuses takeover, expiry, wrong domain and stale/revoked account without transferring", async () => {
    const f = fixture(), owner = seedAccount(f), other = seedAccount(f, "2"), store = createEnrolledSqliteChatAccountLinks(f.open().db)!;
    const p = pending(recipients[0]); await store.issue(p.value); await store.complete(p.value.tokenHash, owner);
    const stolen = pending(recipients[0]); await expect(store.issue(stolen.value)).rejects.toThrow("chat_takeover_refused");
    // Synthetic race: an old pending token coexists with a completed link. Consume
    // refuses takeover and commits only token burn; actual callers cannot install it.
    f.edit(db => db.prepare(`INSERT INTO chat263_tokens(token_hash,purpose,platform,scope,user_id,channel,origin,network,issued_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(stolen.value.tokenHash, stolen.value.purpose, "telegram", "telegram", "7", "7", binding.origin, binding.network, stolen.value.issuedAt, stolen.value.expiresAt));
    await expect(store.complete(stolen.value.tokenHash, other)).rejects.toThrow("chat_takeover_refused");
    await expect(store.complete(stolen.value.tokenHash, other)).rejects.toThrow("chat_token_invalid");
    expect((await store.lookup(recipients[0], binding))?.accountId).toBe(owner.membership.accountId);
    const exp = pending(recipients[1]); await store.issue(exp.value);
    const expiredAt = Date.now() - 1;
    f.edit(db => db.prepare("UPDATE chat263_tokens SET issued_at=?,expires_at=? WHERE token_hash=?").run(expiredAt - 300000, expiredAt, exp.value.tokenHash));
    await expect(store.preview(exp.value.tokenHash, binding)).rejects.toThrow("chat_token_invalid");
    const live = pending(recipients[2]); await store.issue(live.value);
    await expect(store.preview(live.value.tokenHash, { ...binding, origin: "https://other.example" })).rejects.toThrow("chat_token_invalid");
    f.edit(db => db.prepare("DELETE FROM web_sessions WHERE hash=?").run(other.session.sessionHash));
    await expect(store.complete(live.value.tokenHash, other)).rejects.toThrow("chat_account_changed");
    expect(await store.preview(live.value.tokenHash, binding)).toEqual(live.value);
  });
  it("unlink invalidates pending tokens and allows a new account only with a new explicit link", async () => {
    const f = fixture(), first = seedAccount(f), second = seedAccount(f, "2"), store = createEnrolledSqliteChatAccountLinks(f.open().db)!;
    const old = pending(recipients[0]); await store.issue(old.value); await store.unlink(recipients[0], binding);
    await expect(store.complete(old.value.tokenHash, first)).rejects.toThrow("chat_token_invalid");
    const fresh = pending(recipients[0]); await store.issue(fresh.value); await store.complete(fresh.value.tokenHash, first);
    await expect(store.unlinkAccount(recipients[0], second)).rejects.toThrow("chat_takeover_refused");
    await store.unlinkAccount(recipients[0], first);
    const next = pending(recipients[0]); await store.issue(next.value); await store.complete(next.value.tokenHash, second);
    expect((await store.lookup(recipients[0], binding))?.wallet).toBe(second.session.wallet);
  });
  it("qualifies BEFORE absence without DDL; rejects raw connections without touching/closing them", () => {
    expect(supportedSqliteApplicationProfiles(true)).toHaveLength(4);
    const before = fixture(false), db = before.open().db;
    expect(createEnrolledSqliteChatAccountLinks(db)).toBeUndefined();
    expect(before.edit(raw => raw.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'chat263_*'").all())).toEqual([]);
    const raw = new DatabaseSync(":memory:");
    try { expect(() => createEnrolledSqliteChatAccountLinks(raw)).toThrow("chat_unavailable"); expect(raw.prepare("SELECT 1 AS alive").get()?.alive).toBe(1); }
    finally { raw.close(); }
  });
  it("refuses readonly mutations before SQL while keeping genuine readers usable", async () => {
    const f = fixture(), owner = seedAccount(f), db = f.open(true).db, store = createEnrolledSqliteChatAccountLinks(db)!;
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare"), exec = vi.spyOn(DatabaseSync.prototype, "exec");
    await expect(store.issue(pending(recipients[0]).value)).rejects.toThrow("chat_unavailable");
    await expect(store.unlink(recipients[0], binding)).rejects.toThrow("chat_unavailable");
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    prepare.mockRestore(); exec.mockRestore(); expect(await store.list(owner)).toEqual([]);
  });
  it("latches complete schema drift and never reconstructs a capability", async () => {
    const f = fixture(), store = createEnrolledSqliteChatAccountLinks(f.open().db)!;
    f.edit(db => db.exec("CREATE TABLE unexpected_chat263_schema(value TEXT)"));
    await expect(store.lookup(recipients[0], binding)).rejects.toThrow("chat_unavailable");
    f.edit(db => db.exec("DROP TABLE unexpected_chat263_schema"));
    await expect(store.lookup(recipients[0], binding)).rejects.toThrow("chat_unavailable");
  });
  it("treats genuine native busy as temporary only after guarded clean-state verification", async () => {
    const f = fixture(), store = createEnrolledSqliteChatAccountLinks(f.open().db)!, p = pending(recipients[0]);
    const blocker = new DatabaseSync(f.file);
    try {
      blocker.exec("BEGIN IMMEDIATE");
      await expect(store.issue(p.value)).rejects.toThrow("chat_unavailable");
      blocker.exec("ROLLBACK");
      await store.issue(p.value);
      expect(await store.preview(p.value.tokenHash, binding)).toEqual(p.value);
    } finally { if (blocker.isTransaction) blocker.exec("ROLLBACK"); blocker.close(); }
  }, 15000);
});
