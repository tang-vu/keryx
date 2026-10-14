/** Disposable native storage, real JWT/session rows and EOA membership consent.
 * No provider, custody, settlement or production acceptance is simulated. */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "../canonical-json";
import { issueWebSession, isWebSessionActive, parseWebSession, webSessionHash } from "../auth-session";
import { installMainnetApplicationSchema } from "../db/mainnet-application-schema";
import { installNativeUserDomainSchema } from "../db/native-user-domain-schema";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST } from "../db/storage-identity";
import { insertStorageIdentity, installStorageFences, registerStorageCapability } from "../db/storage-identity-sqlite";
import { createEnrolledSqliteAdapter, createReadonlyEnrolledSqliteAdapter } from "../db/enrolled-sqlite-adapter";
import { writeSqliteQueryRun } from "../db/query-run-record";
import type { KeryxDB } from "../db/keryx-db";
import type { QueryRun } from "../types";
import { createAccountMembershipService } from "./service";
import type { AccountHistoryObservation, AccountSnapshot, InteractiveSession } from "./contracts";
import { createOwnedHistoryRoute } from "../history/owned-history-route";

const binding = { origin: "https://keryx.example", network: "eip155:5042" } as const;
const consent = { version: 1, privateAccount: true, shareOwnedHistory: true } as const;
const linkConsent = { version: 1, sharePastAndFutureOwnedHistory: true, walletAuthorityStaysSeparate: true } as const;
const eoa = [1, 2, 3].map(i => privateKeyToAccount(`0x${i.toString(16).padStart(64, "0")}` as `0x${string}`));
const [alice, member, foreign] = eoa.map(w => w.address.toLowerCase());
const secret = "only-a-public-disposable-test-session-secret";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1" as const,
  network: "eip155:5042" as const, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
let directory: string, file: string, template: string;
let db: Awaited<ReturnType<typeof createEnrolledSqliteAdapter>>;
let tokens: string[], sessions: InteractiveSession[];
const extraConnections: Array<{ close(): void }> = [];
function inspect<T>(read: (raw: DatabaseSync) => T) {
  const raw = new DatabaseSync(file, { readOnly: true });
  try { return read(raw); } finally { raw.close(); }
}
function edit(change: (raw: DatabaseSync) => void) {
  const raw = new DatabaseSync(file);
  // Negative/setup actor only. Positive ports always come from actual verified facades.
  try { registerStorageCapability(raw, identity, () => true); raw.exec("BEGIN IMMEDIATE");
    change(raw); raw.exec("COMMIT");
  } catch (error) { if (raw.isTransaction) raw.exec("ROLLBACK"); throw error; }
  finally { raw.close(); }
}
function financial() {
  return inspect(raw => JSON.stringify(["payment_events", "a2a_orders", "session_grants"].map(table =>
    [table, raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])));
}
function run(id: string, wallet?: string): QueryRun {
  return { id, question: `Question ${id}`, answer: `PRIVATE original ${id}`, budget: .1, engine: "heuristic",
    totalSpent: .03, totalToCreators: .02, subClaims: [], decisions: [], trace: [],
    citations: [{ marker: "S1", sourceId: "fixture", sourceName: "Synthetic source", weight: 1, reward: .02, rationale: "Synthetic only",
      itemTitle: "Private cited work", itemUrl: "https://example.test/document" }],
    createdAt: new Date(Date.now() - 1000).toISOString(), paymentMode: "offline", ...(wallet ? { asker: wallet } : {}) };
}
async function authenticated(index = 0, target: KeryxDB = db) {
  const claims = await parseWebSession(tokens[index], secret);
  if (!claims || !await isWebSessionActive(target, claims)) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return { db: target, wallet: claims.address.toLowerCase(), currentId: webSessionHash(claims.jti) };
}
const expected = (snapshot: AccountSnapshot) => ({ accountId: snapshot.membership.accountId, revision: snapshot.membership.revision });
async function current() { return (await db.accountMembership!.resolve(sessions[0], binding))!; }
function route(action: "list" | "detail" | "export", options: {
  index?: number; target?: KeryxDB; last?: () => void | Promise<void>; key?: () => Promise<{ walletAddress: string; scopes: string | null } | null>;
} = {}) {
  let calls = 0;
  return createOwnedHistoryRoute({ binding, db: async () => options.target ?? db,
    key: options.key ?? (async () => null), session: async () => {
      const value = await authenticated(options.index ?? 0, options.target ?? db);
      if (++calls === 2) await options.last?.(); // Mutation AFTER real final credential check, before its awaited return.
      return value;
    } }, action);
}
const request = (suffix = "", init?: RequestInit) => new Request(`https://keryx.example/api/me/asks${suffix}`, init);
async function observed(id = "member") {
  const item = await db.runPrivacy!.owner(id, { wallet: member, binding });
  if (!item) throw new Error("Expected genuine member original");
  return { id, ownerWallet: member, ...item } satisfies AccountHistoryObservation;
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "keryx-account-owned-history-")); file = join(directory, "active.sqlite"); template = join(directory, "template.sqlite");
  const raw = new DatabaseSync(file);
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE"); installMainnetApplicationSchema(raw); installNativeUserDomainSchema(raw);
    for (const [id, wallet] of [["alice", alice], ["member", member], ["foreign", foreign], ["claimed", undefined]] as const)
      writeSqliteQueryRun(raw, run(id, wallet), true);
    raw.prepare(`INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,created_at)
      VALUES('retained','member','citation','fixture','Synthetic',?,?,.02,?,'synthetic-only',0,'pending',?)`)
      .run(member, foreign, binding.network, new Date().toISOString());
    insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
  } finally { raw.close(); }
  const manifest = join(directory, "deployment.json");
  writeFileSync(manifest, canonicalJson({ format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifest); vi.stubEnv("KERYX_SQLITE_PATH", file); vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("CONTENT_MASTER_KEY", "ab".repeat(32)); vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "true");
  db = await createEnrolledSqliteAdapter();
  try {
    tokens = []; sessions = [];
    for (const wallet of [alice, member]) {
      const issued = await issueWebSession(db, secret, wallet, "asker"); tokens.push(issued.token);
      const claims = (await parseWebSession(issued.token, secret))!;
      sessions.push({ sessionHash: webSessionHash(claims.jti), wallet, issuedAt: claims.iat * 1000, expiresAt: claims.exp * 1000 });
    }
    const service = createAccountMembershipService(db.accountMembership!, binding);
    const issued = await service.prepareCreate(sessions[0], consent); await service.completeCreate(sessions[0], issued.nonce, consent);
    const snapshot = (await service.resolve(sessions[0]))!;
    const proof = await service.prepareLink(sessions[0], eoa[1].address, expected(snapshot), linkConsent);
    await service.completeLink(sessions[0], proof.nonce, await eoa[1].signMessage({ message: proof.message }), linkConsent);
    const original = inspect(sql => sql.prepare("SELECT created_at FROM query_runs WHERE id='claimed'").get()!);
    await db.runClaims!.issue({ runId: "claimed", tokenHash: sha("disposable-claim"), completedAt: String(original.created_at), binding });
    await db.runClaims!.claim({ tokenHash: sha("disposable-claim"), wallet: member, sessionHash: sessions[1].sessionHash, binding });
  } finally { db.close(); }
  copyFileSync(file, template);
});
beforeEach(async () => { copyFileSync(template, file); db = await createEnrolledSqliteAdapter(); });
afterEach(() => { vi.restoreAllMocks(); for (const handle of extraConnections.splice(0)) handle.close(); db?.close(); });
afterAll(() => { vi.unstubAllEnvs(); if (directory) rmSync(directory, { recursive: true, force: true }); });

describe("native account-consented owned history", () => {
  it("publishes the genuine optional synchronous seal without enumerable authority or raw handles", async () => {
    expect(Object.isFrozen(db)).toBe(true); expect(Object.keys(db)).not.toContain("accountMembership");
    expect(Reflect.get(db, "db")).toBeUndefined(); expect(typeof db.accountMembership!.prepareHistoryFence).toBe("function");
    const before = financial(), item = await observed(), snapshot = await current();
    const seal = await db.accountMembership!.prepareHistoryFence!(snapshot, [item], Date.now() + 25_000);
    expect(seal()).toBeUndefined(); expect(() => seal()).toThrow("account_unavailable"); expect(financial()).toBe(before);
  });
  it("lists recorded and claimed member originals without disclosing private report text or foreign owners", async () => {
    const before = financial(), response = await route("list")(request()), body = await response.json();
    expect(response.status).toBe(200); expect(body.scope).toBe("account-owned-current-store");
    expect(body.rows.map((row: { id: string }) => row.id).sort()).toEqual(["alice", "claimed", "member"]);
    expect(body.rows.find((row: { id: string }) => row.id === "claimed").ownership.method).toBe("claimed");
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE original|foreign|sessionHash|credentialGeneration|tokenHash/);
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(financial()).toBe(before);
  });
  it.each(["report", "receipts", "bibtex", "ris", "csl-json"] as const)("reads member %s through the same final native fence", async format => {
    const before = financial(), response = await route("detail")(request(`?format=${format}`), "member"), body = await response.text();
    expect(response.status).toBe(200);
    if (format === "report") expect(JSON.parse(body).run.answer).toBe("PRIVATE original member");
    else if (format === "receipts") { expect(JSON.parse(body).payments[0].id).toBe("retained"); expect(body).not.toContain("PRIVATE original"); }
    else expect(body).toContain("Private cited work");
    expect(financial()).toBe(before);
  });
  it.each(["json", "csv"])("exports account rows as %s with existing bounds", async format => {
    const response = await route("export")(request(`?format=${format}`)), text = await response.text();
    expect(response.status).toBe(200); expect(text).toContain("Question member"); expect(text).not.toMatch(/PRIVATE original|Question foreign/);
  });
  it("keeps a new unconsented session wallet-only even for an already linked wallet", async () => {
    const issued = await issueWebSession(db, secret, alice, "asker"), old = tokens[0]; tokens[0] = issued.token;
    try {
      const response = await route("list")(request()), body = await response.json();
      expect(response.status).toBe(200); expect(body.scope).toBe("wallet-owned-current-store"); expect(body.rows.map((row: { id: string }) => row.id)).toEqual(["alice"]);
    } finally { tokens[0] = old; }
  });
  it("keeps bearer keys wallet-only and rechecks their independent scope after IO", async () => {
    let calls = 0; const key = vi.fn(async () => ({ walletAddress: alice, scopes: ++calls === 2 ? "asks:read" : "history:read" }));
    const response = await route("list", { key })(request("", { headers: { authorization: `Bearer kx_live_${"a".repeat(96)}` } }));
    expect(response.status).toBe(403); expect(key).toHaveBeenCalledTimes(2);
    const good = await route("list", { key: async () => ({ walletAddress: alice, scopes: "history:read" }) })(request("", { headers: { authorization: `Bearer kx_live_${"a".repeat(96)}` } }));
    expect((await good.json()).rows.map((row: { id: string }) => row.id)).toEqual(["alice"]);
  });
  it.each(["unlink", "unlink-relink", "revoke", "session-revoke", "session-expire", "private-body", "privacy", "erase"] as const)("refuses %s during the final real session await", async change => {
    const before = financial(); let mutations = 0;
    const response = await route("detail", { last: async () => {
      mutations++;
      if (change === "unlink" || change === "unlink-relink") { const snapshot = await current(), m = snapshot.membership.members.find(v => v.wallet === member)!;
        const service = createAccountMembershipService(db.accountMembership!, binding);
        await service.unlink(sessions[0], expected(snapshot), member, m.generation, true);
        if (change === "unlink-relink") {
          const proof = await service.prepareLink(sessions[0], eoa[1].address, expected(await current()), linkConsent);
          const next = await service.completeLink(sessions[0], proof.nonce, await eoa[1].signMessage({ message: proof.message }), linkConsent);
          expect(next.membership.members.map(m => m.wallet).sort()).toEqual(snapshot.membership.members.map(m => m.wallet).sort());
          expect(next.membership.revision).toBeGreaterThan(snapshot.membership.revision);
          expect(next.membership.members.find(v => v.wallet === member)!.generation).not.toBe(m.generation);
        }
      }
      else if (change === "revoke") await db.accountMembership!.revokeSession(await current());
      else if (change === "session-revoke") await db.revokeWebSession(sessions[0].sessionHash, alice);
      else if (change === "session-expire") edit(raw => raw.prepare("UPDATE web_sessions SET expires_at=? WHERE hash=?").run(Date.now() - 1, sessions[0].sessionHash));
      else if (change === "private-body") edit(raw => raw.prepare("UPDATE query_runs SET data=json_set(data,'$.answer','CHANGED private body') WHERE id='member'").run());
      else if (change === "privacy") await db.runPrivacy!.change("member", { wallet: member, sessionHash: sessions[1].sessionHash, binding }, { revision: 0, visibility: "public", requestId: randomUUID() });
      else await db.runPrivacy!.erase("member", { wallet: member, sessionHash: sessions[1].sessionHash, binding }, { revision: 0, requestId: randomUUID() });
    } })(request(), "member");
    expect(mutations).toBe(1); expect([401, 409, 503]).toContain(response.status);
    expect(await response.text()).not.toMatch(/PRIVATE original|CHANGED private body/); expect(financial()).toBe(before);
  });
  it("refuses a changed original captured while receipt IO is pending instead of overwriting its first proof", async () => {
    const original = db.personalHistory!, receipts = original.receipts!; let mutated = false;
    const view = Object.create(null) as KeryxDB;
    Object.defineProperties(view, Object.getOwnPropertyDescriptors(db));
    // A request-local IO delay adapter preserves every genuine owner/native port.
    const target = Object.create(null) as KeryxDB;
    for (const key of Object.getOwnPropertyNames(view)) if (key !== "personalHistory") Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(view, key)!);
    Object.defineProperty(target, "personalHistory", { value: { ...original, receipts: async (id: string, take: number) => {
      const value = await receipts(id, take);
      if (id === "member" && !mutated) { mutated = true; edit(raw => raw.prepare("UPDATE query_runs SET data=json_set(data,'$.totalSpent',.04) WHERE id='member'").run()); }
      return value;
    } } }); Object.freeze(target);
    const response = await route("list", { target })(request());
    expect(mutated).toBe(true); expect(response.status).toBe(503); expect(await response.text()).not.toContain("Question member");
  });
  it("rejects mutation before prepare against the observed payload, including unchanged question/date", async () => {
    const item = await observed(), snapshot = await current();
    edit(raw => raw.prepare("UPDATE query_runs SET data=json_set(data,'$.answer','new answer') WHERE id='member'").run());
    await expect(db.accountMembership!.prepareHistoryFence!(snapshot, [item], Date.now() + 25_000)).rejects.toThrow("account_unavailable");
  });
  it.each(["privacy-metadata", "owner", "date"] as const)("seals raw %s ownership inputs as well as the full original", async field => {
    const item = await observed(), seal = await db.accountMembership!.prepareHistoryFence!(await current(), [item], Date.now() + 25_000);
    edit(raw => {
      if (field === "privacy-metadata") raw.prepare("UPDATE run_privacy SET updated_at=? WHERE run_id='member'").run(new Date().toISOString());
      else if (field === "owner") raw.prepare("UPDATE query_runs SET asker=? WHERE id='member'").run(foreign);
      else raw.prepare("UPDATE query_runs SET created_at=? WHERE id='member'").run(new Date().toISOString());
    });
    expect(() => seal()).toThrow("account_unavailable");
  });
  it("allows semantic JSON key-order differences but refuses invalid typed original storage", async () => {
    const item = await observed(); const reordered = Object.fromEntries(Object.entries(item.run).reverse());
    edit(raw => raw.prepare("UPDATE query_runs SET data=? WHERE id='member'").run(JSON.stringify(reordered)));
    const seal = await db.accountMembership!.prepareHistoryFence!(await current(), [item], Date.now() + 25_000); expect(seal()).toBeUndefined();
    edit(raw => raw.prepare("UPDATE query_runs SET data=jsonb(data) WHERE id='member'").run());
    await expect(db.accountMembership!.prepareHistoryFence!(await current(), [item], Date.now() + 25_000)).rejects.toThrow("account_unavailable");
  });
  it("refuses unknown member selectors, duplicates, expired deadlines and excessive observed bytes", async () => {
    const item = await observed(), snapshot = await current(), prepare = db.accountMembership!.prepareHistoryFence!;
    await expect(prepare(snapshot, [{ ...item, ownerWallet: foreign }], Date.now() + 25_000)).rejects.toThrow();
    await expect(prepare(snapshot, [item, item], Date.now() + 25_000)).rejects.toThrow();
    await expect(prepare(snapshot, Array.from({ length: 1001 }, () => item), Date.now() + 25_000)).rejects.toThrow();
    await expect(prepare(snapshot, [item], Date.now() - 1)).rejects.toThrow();
    await expect(prepare(snapshot, [{ ...item, run: { ...item.run, answer: "x".repeat(4_000_001) } }], Date.now() + 25_000)).rejects.toThrow();
  });
  it("refuses aggregate original overflow even when each observed item is below its individual bound", async () => {
    const item = await observed(), snapshot = await current();
    const items = Array.from({ length: 5 }, (_, i) => ({ ...item, id: `large_${i}`, run: { ...item.run, id: `large_${i}`, answer: "x".repeat(3_300_000) } }));
    expect(items.every(value => Buffer.byteLength(JSON.stringify(value.run)) < 4_000_000)).toBe(true);
    expect(items.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value.run)), 0)).toBeGreaterThan(16_000_000);
    await expect(db.accountMembership!.prepareHistoryFence!(snapshot, items, Date.now() + 25_000)).rejects.toThrow("account_unavailable");
  });
  it("refuses an abort during the final session await without returning the prebuilt body", async () => {
    const controller = new AbortController();
    const response = await route("detail", { last: () => controller.abort() })(request("", { signal: controller.signal }), "member");
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE original");
  });
  it("uses the same genuine readonly capability while refusing all account writes", async () => {
    const reader = await createReadonlyEnrolledSqliteAdapter(); extraConnections.push(reader);
    const before = financial(), snapshot = await current(), item = await observed();
    const seal = await reader.accountMembership!.prepareHistoryFence!(snapshot, [item], Date.now() + 25_000); expect(seal()).toBeUndefined();
    await expect(reader.accountMembership!.revokeSession(snapshot)).rejects.toThrow("account_unavailable");
    const response = await route("detail", { target: reader })(request(), "member"); expect(response.status).toBe(200); expect(financial()).toBe(before);
  });
});
