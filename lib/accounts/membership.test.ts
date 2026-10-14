/** Synthetic acceptance against a real temporary on-disk SQLite database.
 * Fixture provisioning is not operational admission. These tests must only run
 * under the parent's isolated-fixture authority; no target/provider is used. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createSqliteAccountMembership } from "./sqlite-store";
import { ACCOUNT_MEMBERSHIP_SQL_DATA, ACCOUNT_WEB_SESSION_SCHEMA_DATA } from "./sqlite-schema-data";
import { createAccountMembershipService } from "./service";
import { membershipMessage, membershipNonceHash, randomAccountValue, sessionCommitment } from "./protocol";
import { createAccountHistoryProjection, readWithAccountFence } from "./history-projection";
import { createAccountMembershipRoutes } from "./http";
import { AccountError, type InteractiveSession, type Membership, type MembershipChallenge } from "./contracts";

const binding = { origin: "https://keryx.example", network: "eip155:5042002" } as const;
const consent = { version: 1, privateAccount: true, shareOwnedHistory: true } as const;
const linkConsent = { version: 1, sharePastAndFutureOwnedHistory: true, walletAuthorityStaysSeparate: true } as const;
const expectedOf = (m: Membership) => ({ accountId: m.accountId, revision: m.revision });
// PUBLIC SYNTHETIC TEST KEYS. Never payment custody or provider credentials.
const wallets = Array.from({ length: 12 }, (_, i) => privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, "0")}` as `0x${string}`));
let directory: string, db: DatabaseSync;
function session(i = 0): InteractiveSession {
  const issuedAt = Math.floor(Date.now() / 1000) * 1000;
  const s = { sessionHash: randomAccountValue(), wallet: wallets[i].address.toLowerCase(), issuedAt, expiresAt: issuedAt + 60_000 };
  db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)").run(s.sessionHash, s.wallet, s.issuedAt, s.expiresAt);
  return s;
}
const setup = () => { const store = createSqliteAccountMembership(db); return { store, service: createAccountMembershipService(store, binding) }; };
async function bootstrap(i = 0) {
  const { store, service } = setup(), s = session(i), proof = await service.prepareCreate(s, consent);
  const start = await service.completeCreate(s, proof.nonce, consent);
  return { store, service, s, start };
}
async function link(base: Awaited<ReturnType<typeof bootstrap>>, i = 1) {
  const state = (await base.service.resolve(base.s))!;
  const issued = await base.service.prepareLink(base.s, wallets[i].address, expectedOf(state.membership), linkConsent);
  const signature = await wallets[i].signMessage({ message: issued.message });
  return { issued, signature, result: await base.service.completeLink(base.s, issued.nonce, signature, linkConsent) };
}
function retainChallenge(challenge: MembershipChallenge, sessionHash: string, consumed: boolean) {
  const nonceHash = membershipNonceHash(randomAccountValue());
  db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at,consumed_at,lease_hash) VALUES(?,?,?,?,?,?)")
    .run(nonceHash, sessionHash, JSON.stringify(challenge), challenge.expiresAt, consumed ? challenge.expiresAt : null, consumed ? randomAccountValue() : null);
  return nonceHash;
}
function retainedRows() {
  return ["account267_accounts", "account267_members", "account267_credentials", "account267_sessions", "account267_challenges", "account267_events", "web_sessions"]
    .map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() }));
}
async function seedExactSessionCapacity(base: Awaited<ReturnType<typeof bootstrap>>, revoked = false) {
  // Synthetic cardinality in this disposable schema, using an actual resumed
  // binding as the row template; this is not 1024 service admissions.
  const known = session(), resumed = await base.service.resume(known, expectedOf(base.start.membership), consent);
  if (revoked) await base.service.revokeSession(known, expectedOf(base.start.membership));
  const template = db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(known.sessionHash)!;
  expect(template).toEqual({ session_hash: known.sessionHash, wallet: known.wallet, account_id: resumed.membership.accountId,
    member_generation: resumed.memberGeneration, credential_generation: resumed.credentialGeneration,
    issued_at: known.issuedAt, expires_at: known.expiresAt, origin: binding.origin, network: binding.network,
    history_consent: 1, revoked_at: revoked ? Date.now() : null });
  const expectedRows = [db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash)!, template];
  const insert = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
    SELECT ?,wallet,account_id,member_generation,credential_generation,issued_at,?,origin,network,history_consent,revoked_at
    FROM account267_sessions WHERE session_hash=?`);
  let last = known;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let i = 0; i < 1022; i++) {
      last = session(); insert.run(last.sessionHash, last.expiresAt, known.sessionHash);
      expectedRows.push({ ...template, session_hash: last.sessionHash, wallet: last.wallet, issued_at: last.issuedAt, expires_at: last.expiresAt });
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  // Prove exact row fidelity and unchanged CHECK/immutability constraints on
  // seeded inputs, including their original login expiry and current lineage.
  expect(() => insert.run(randomAccountValue(), known.issuedAt, known.sessionHash)).toThrow("CHECK constraint failed");
  expect(() => db.prepare("UPDATE account267_sessions SET expires_at=? WHERE session_hash=?")
    .run(last.expiresAt + 1000, last.sessionHash)).toThrow("account_unavailable");
  expect(db.prepare("SELECT * FROM account267_sessions WHERE account_id=? ORDER BY session_hash").all(base.start.membership.accountId))
    .toEqual(expectedRows.sort((a, b) => String(a.session_hash).localeCompare(String(b.session_hash))));
  expect(db.prepare("SELECT count(*) AS n FROM web_sessions WHERE wallet=?").get(base.s.wallet)?.n).toBe(1024);
  if (!revoked) expect(await base.service.resolve(last)).toEqual({ ...resumed, session: last });
  return last;
}
function expectLiveSessionPlans(actualSql: string[]) {
  const selected = actualSql.filter(sql => sql.startsWith("SELECT ") && sql.includes("FROM account267_sessions INDEXED BY account267_sessions_live"));
  expect(selected.length).toBeGreaterThan(0);
  for (const sql of selected) {
    expect(sql).toContain("account_id=? AND revoked_at IS NULL AND expires_at>?"); expect(sql).toMatch(/\bLIMIT\b/);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => null));
    const detail = plan.map(row => String(row.detail)).join("\n");
    expect(detail).toContain("SEARCH account267_sessions USING COVERING INDEX account267_sessions_live");
    expect(detail).toContain("expires_at>?"); expect(detail).not.toContain("SCAN account267_sessions");
  }
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "keryx-account267-")); db = new DatabaseSync(join(directory, "ordinary.sqlite"));
  db.exec(ACCOUNT_WEB_SESSION_SCHEMA_DATA.filter(v => v.sql).map(v => `${v.sql};`).join("\n") + ACCOUNT_MEMBERSHIP_SQL_DATA);
});
afterEach(() => { vi.restoreAllMocks(); db.close(); rmSync(directory, { recursive: true, force: true }); });

describe("ordinary durable account membership", () => {
  it("requires explicit consent and creates one opaque account with stable revision", async () => {
    const { service } = setup(), s = session();
    await expect(service.prepareCreate(s, { ...consent, privateAccount: false } as never)).rejects.toThrow();
    const proof = await service.prepareCreate(s, consent), start = await service.completeCreate(s, proof.nonce, consent);
    expect(start.membership.accountId).toMatch(/^acct_[a-f0-9]{64}$/); expect(start.membership.accountId).not.toContain(s.wallet);
    expect(start.membership.revision).toBe(1); expect(start.membership.members.map(m => m.wallet)).toEqual([s.wallet]);
    expect((await service.resolve(s))!.membership).toEqual(start.membership);
    expect((await service.resolve(s))!.membership.revision).toBe(1);
    await expect(service.completeCreate(s, proof.nonce, consent)).rejects.toThrow("invalid_membership_proof");
  });
  it("reopens committed membership through another connection without an in-memory producer", async () => {
    const base = await bootstrap(), other = new DatabaseSync(join(directory, "ordinary.sqlite"));
    try { expect((await createSqliteAccountMembership(other).resolve(base.s, binding))!.membership).toEqual(base.start.membership); }
    finally { other.close(); }
  });
  it("does not bootstrap another account for an already bound wallet or derive it from a label", async () => {
    const base = await bootstrap();
    await expect(base.service.prepareCreate(base.s, consent)).rejects.toThrow("account_changed");
    expect(db.prepare("SELECT count(*) AS n FROM account267_accounts").get()?.n).toBe(1);
  });
  it("links only a fresh exact target EOA proof and increments revision once", async () => {
    const base = await bootstrap(), { result } = await link(base);
    expect(result.membership.accountId).toBe(base.start.membership.accountId); expect(result.membership.revision).toBe(2);
    expect(new Set(result.membership.members.map(m => m.wallet))).toEqual(new Set([base.s.wallet, wallets[1].address.toLowerCase()]));
    expect(db.prepare("SELECT count(*) AS n FROM account267_events").get()?.n).toBe(2);
  });
  it("consumes invalid signatures and explicit consent refusal instead of allowing replay", async () => {
    const base = await bootstrap();
    for (const kind of ["foreign-signature", "refusal"] as const) {
      const proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
      const signature = await wallets[kind === "foreign-signature" ? 2 : 1].signMessage({ message: proof.message });
      await expect(base.service.completeLink(base.s, proof.nonce, signature, kind === "refusal" ? { ...linkConsent, sharePastAndFutureOwnedHistory: false } : linkConsent)).rejects.toThrow("invalid_membership_proof");
      await expect(base.service.completeLink(base.s, proof.nonce, await wallets[1].signMessage({ message: proof.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
    }
    expect((await base.service.resolve(base.s))!.membership.revision).toBe(1);
  });
  it("rejects wrong message bytes and purpose reuse", async () => {
    const base = await bootstrap(), p = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const signature = await wallets[1].signMessage({ message: p.message.replace("Membership revision: 1", "Membership revision: 2") });
    await expect(base.service.completeLink(base.s, p.nonce, signature, linkConsent)).rejects.toThrow("invalid_membership_proof");
    const other = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(base.start.membership), linkConsent);
    await expect(base.service.completeCreate(base.s, other.nonce, consent)).rejects.toThrow("invalid_membership_proof");
    await expect(base.service.completeLink(base.s, other.nonce, await wallets[2].signMessage({ message: other.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
  });
  it("refuses foreign same-wallet sessions and configured origin/network mismatch", async () => {
    const base = await bootstrap();
    for (const wrong of [{ origin: "https://foreign.example", network: binding.network }, { origin: binding.origin, network: "eip155:5042" }] as const) {
      const p = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
      const other = createAccountMembershipService(base.store, wrong);
      await expect(other.completeLink(base.s, p.nonce, await wallets[1].signMessage({ message: p.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
    }
    const p = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent), sameWallet = session();
    await expect(base.service.completeLink(sameWallet, p.nonce, await wallets[1].signMessage({ message: p.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
    expect(await base.service.resolve(sameWallet)).toBeNull();
  });
  it("retains one winner for simultaneous mixed-case cross-account target proofs", async () => {
    const a = await bootstrap(0), b = await bootstrap(2);
    const pa = await a.service.prepareLink(a.s, wallets[1].address, expectedOf(a.start.membership), linkConsent);
    const pb = await b.service.prepareLink(b.s, wallets[1].address.toLowerCase(), expectedOf(b.start.membership), linkConsent);
    const result = await Promise.allSettled([
      a.service.completeLink(a.s, pa.nonce, await wallets[1].signMessage({ message: pa.message }), linkConsent),
      b.service.completeLink(b.s, pb.nonce, await wallets[1].signMessage({ message: pb.message }), linkConsent),
    ]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const failed = result.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.message).toBe("wallet_unavailable"); expect(failed.reason.message).not.toContain(a.start.membership.accountId);
    expect(db.prepare("SELECT count(*) AS n FROM account267_members WHERE wallet=?").get(wallets[1].address.toLowerCase())?.n).toBe(1);
  });
  it("serializes stale same-account competing mutations", async () => {
    const base = await bootstrap(), a = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent),
      b = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(base.start.membership), linkConsent);
    await base.service.completeLink(base.s, a.nonce, await wallets[1].signMessage({ message: a.message }), linkConsent);
    await expect(base.service.completeLink(base.s, b.nonce, await wallets[2].signMessage({ message: b.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
    expect((await base.service.resolve(base.s))!.membership.revision).toBe(2);
  });
  it("enforces eight members without truncation", async () => {
    const base = await bootstrap(); for (let i = 1; i < 8; i++) await link(base, i);
    const state = (await base.service.resolve(base.s))!; expect(state.membership.members).toHaveLength(8);
    await expect(base.service.prepareLink(base.s, wallets[8].address, expectedOf(state.membership), linkConsent)).rejects.toThrow("account_full");
  });
  it("unlinks a lost wallet without its cooperation and uses a fresh generation on relink", async () => {
    const base = await bootstrap(), { result } = await link(base), member = result.membership.members.find(m => m.wallet === wallets[1].address.toLowerCase())!;
    const pending = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent);
    const after = await base.service.unlink(base.s, expectedOf(result.membership), member.wallet, member.generation, true);
    expect(after!.revision).toBe(3); expect(after!.members).toHaveLength(1);
    await expect(base.store.assertCurrent(result)).rejects.toThrow("account_changed");
    await expect(base.service.completeLink(base.s, pending.nonce, await wallets[2].signMessage({ message: pending.message }), linkConsent)).rejects.toThrow();
    const relinked = await link(base, 1), fresh = relinked.result.membership.members.find(m => m.wallet === member.wallet)!;
    expect(fresh.generation).not.toBe(member.generation); expect(relinked.result.membership.revision).toBe(4);
    await expect(base.service.unlink(base.s, expectedOf(relinked.result.membership), member.wallet, member.generation, true)).rejects.toThrow("account_changed");
  });
  it("uses account-indexed bounded unlink queries amid many unrelated accounts and retained challenges", async () => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock); db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(), { result } = await link(base), member = result.membership.members.find(m => m.wallet !== base.s.wallet)!;
    clock += 1000;
    const removedSession = session(1), removedSnapshot = await base.service.resume(removedSession, expectedOf(result.membership), consent);
    const descendant = session(1); await base.service.resume(descendant, expectedOf(result.membership), consent);
    const pending = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent);
    const now = Date.now(), expiredAt = now - 1000;
    const addAccount = db.prepare("INSERT INTO account267_accounts(account_id,revision,created_at) VALUES(?,1,?)");
    const addMember = db.prepare("INSERT INTO account267_members(wallet,account_id,generation,consent_hash,linked_at) VALUES(?,?,?,?,?)");
    const addCredential = db.prepare("INSERT INTO account267_credentials(wallet,account_id,member_generation,generation,login_after,active) VALUES(?,?,?,?,?,1)");
    const addSession = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`);
    const addLogin = db.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)");
    // Unlink must include still-revocable descendants even when their generation
    // is no longer current; neither admission nor cancellation joins it away.
    const oldGeneration = session(1);
    addSession.run(oldGeneration.sessionHash, member.wallet, result.membership.accountId, randomAccountValue(), randomAccountValue(),
      oldGeneration.issuedAt, oldGeneration.expiresAt, binding.origin, binding.network);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < 128; i++) {
        const accountId = `acct_${randomAccountValue()}`, wallet = `0x${(65536 + i).toString(16).padStart(40, "0")}`;
        const generation = randomAccountValue(), credentialGeneration = randomAccountValue(), sessionHash = randomAccountValue();
        addAccount.run(accountId, now); addMember.run(wallet, accountId, generation, pending.challenge.consentHash, now);
        addCredential.run(wallet, accountId, generation, credentialGeneration, now + 1000);
        addSession.run(sessionHash, wallet, accountId, generation, credentialGeneration, now - 60_000, now, binding.origin, binding.network);
        const c = { ...pending.challenge, accountId, revision: 1, wallet, generation, issuedAt: expiredAt - 300_000, expiresAt: expiredAt };
        for (let retained = 0; retained < 32; retained++) retainChallenge(c, sessionHash, retained % 2 === 0);
      }
      // More dead unrevoked rows than the cancellation cap, in the exact removed
      // wallet partition, cannot block unlink or regain authority after relink.
      for (let i = 0; i < 1025; i++) {
        const sessionHash = randomAccountValue(); addLogin.run(sessionHash, member.wallet, now - 60_000, now);
        addSession.run(sessionHash, member.wallet, result.membership.accountId, member.generation,
          removedSnapshot.credentialGeneration, now - 60_000, now, binding.origin, binding.network);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const ownExpired = retainChallenge({ ...pending.challenge, issuedAt: expiredAt - 300_000, expiresAt: expiredAt }, base.s.sessionHash, false);
    const foreignBefore = db.prepare("SELECT * FROM account267_challenges WHERE json_extract(payload,'$.accountId')!=? ORDER BY nonce_hash").all(result.membership.accountId);
    const credentialsBefore = db.prepare("SELECT * FROM account267_credentials WHERE account_id!=? ORDER BY wallet").all(result.membership.accountId);
    const sessionsBefore = db.prepare("SELECT * FROM account267_sessions WHERE account_id!=? ORDER BY session_hash").all(result.membership.accountId);
    const expiredSessionsBefore = db.prepare("SELECT * FROM account267_sessions WHERE account_id=? AND wallet=? AND expires_at<=? ORDER BY session_hash")
      .all(result.membership.accountId, member.wallet, now);
    const loginsBefore = db.prepare("SELECT * FROM web_sessions ORDER BY hash").all();
    const originalLogin = db.prepare("SELECT * FROM web_sessions WHERE hash=?").get(base.s.sessionHash);
    const removedLogin = db.prepare("SELECT * FROM web_sessions WHERE hash=?").get(removedSession.sessionHash);
    expect(foreignBefore).toHaveLength(4096); expect(credentialsBefore).toHaveLength(128);
    expect(expiredSessionsBefore).toHaveLength(1025);
    await expect(base.service.resolve(oldGeneration)).rejects.toThrow("account_unauthenticated");
    const queries = vi.spyOn(db, "prepare");
    const after = await base.service.unlink(base.s, expectedOf(result.membership), member.wallet, member.generation, true);
    const actualSql = queries.mock.calls.map(([sql]) => sql); queries.mockRestore();
    expect(after!.revision).toBe(3); expect(after!.members).toHaveLength(1);
    expect(db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(pending.nonce))?.consumed_at).not.toBeNull();
    expect(db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?").get(ownExpired)?.consumed_at).not.toBeNull();
    expect(db.prepare("SELECT * FROM account267_challenges WHERE json_extract(payload,'$.accountId')!=? ORDER BY nonce_hash").all(result.membership.accountId)).toEqual(foreignBefore);
    expect(db.prepare("SELECT * FROM account267_credentials WHERE account_id!=? ORDER BY wallet").all(result.membership.accountId)).toEqual(credentialsBefore);
    expect(db.prepare("SELECT * FROM account267_sessions WHERE account_id!=? ORDER BY session_hash").all(result.membership.accountId)).toEqual(sessionsBefore);
    expect(db.prepare("SELECT * FROM account267_sessions WHERE account_id=? AND wallet=? AND expires_at<=? ORDER BY session_hash")
      .all(result.membership.accountId, member.wallet, now)).toEqual(expiredSessionsBefore);
    expect(db.prepare("SELECT * FROM web_sessions ORDER BY hash").all()).toEqual(loginsBefore);
    expect(db.prepare("SELECT * FROM web_sessions WHERE hash=?").get(base.s.sessionHash)).toEqual(originalLogin);
    expect(db.prepare("SELECT * FROM web_sessions WHERE hash=?").get(removedSession.sessionHash)).toEqual(removedLogin);
    expect(db.prepare("SELECT revoked_at FROM account267_sessions WHERE session_hash=?").get(removedSession.sessionHash)?.revoked_at).not.toBeNull();
    for (const child of [descendant, oldGeneration]) {
      expect(db.prepare("SELECT revoked_at FROM account267_sessions WHERE session_hash=?").get(child.sessionHash)?.revoked_at).not.toBeNull();
      await expect(base.service.resolve(child)).rejects.toThrow("account_unauthenticated");
    }
    await expect(base.service.resolve(removedSession)).rejects.toThrow("account_unauthenticated");
    // Inspect queries actually issued by unlink, rather than a separately copied candidate query.
    for (const [table, index] of [["account267_credentials", "account267_credentials_account"], ["account267_challenges", "account267_challenges_account"],
      ["account267_sessions", "account267_sessions_account"], ["account267_events", "account267_events_account"]]) {
      const selected = actualSql.filter(sql => sql.startsWith("SELECT ") && sql.includes(`FROM ${table} INDEXED BY ${index}`));
      expect(selected.length).toBeGreaterThan(0);
      for (const sql of selected) {
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => null));
        const detail = plan.map(row => String(row.detail)).join("\n");
        expect(detail).toContain(index); expect(detail).toContain(`SEARCH ${table}`);
        expect(detail).not.toContain(`SCAN ${table}`); expect(sql).toMatch(/\bLIMIT\b/);
        if (table === "account267_sessions") expect(detail).toContain("expires_at>?");
      }
    }
    await expect(base.service.completeLink(base.s, pending.nonce, await wallets[2].signMessage({ message: pending.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
    await expect(base.store.assertCurrent(result)).rejects.toThrow("account_changed");
  });
  it("refuses account challenge-retention exhaustion across initiating sessions without pruning evidence or blocking a bounded unlink", async () => {
    const base = await bootstrap(), { result } = await link(base), member = result.membership.members.find(m => m.wallet !== base.s.wallet)!;
    const pending = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent), expiredAt = Date.now() - 1000;
    const expired = { ...pending.challenge, issuedAt: expiredAt - 300_000, expiresAt: expiredAt };
    db.exec("BEGIN IMMEDIATE");
    try { for (let i = 0; i < 1021; i++) retainChallenge(expired, randomAccountValue(), true); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
    expect(db.prepare("SELECT count(*) AS n FROM account267_challenges WHERE json_extract(payload,'$.accountId')=?").get(result.membership.accountId)?.n).toBe(1024);
    await expect(base.service.prepareLink(base.s, wallets[3].address, expectedOf(result.membership), linkConsent)).rejects.toThrow("account_unavailable");
    expect((await base.service.resolve(base.s))!.membership).toEqual(result.membership);
    expect((await base.service.unlink(base.s, expectedOf(result.membership), member.wallet, member.generation, true))!.revision).toBe(3);
    expect(db.prepare("SELECT count(*) AS n FROM account267_challenges").get()?.n).toBe(1024);
    await expect(base.service.completeLink(base.s, pending.nonce, await wallets[2].signMessage({ message: pending.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
  });
  it.each(["pending challenges", "removed-wallet sessions"])("refuses an oversized %s lineage before any unlink mutation", async kind => {
    const base = await bootstrap(), { result } = await link(base), member = result.membership.members.find(m => m.wallet !== base.s.wallet)!;
    const pending = await base.service.prepareLink(base.s, wallets[2].address, expectedOf(result.membership), linkConsent);
    const c = db.prepare("SELECT generation FROM account267_credentials WHERE wallet=?").get(member.wallet)!;
    const addSession = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < 1025; i++) {
        if (kind === "pending challenges") retainChallenge(pending.challenge, randomAccountValue(), false);
        else addSession.run(randomAccountValue(), member.wallet, result.membership.accountId, member.generation, c.generation, base.s.issuedAt, base.s.expiresAt, binding.origin, binding.network);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const evidenceBefore = retainedRows(), queries = vi.spyOn(db, "prepare");
    await expect(base.service.unlink(base.s, expectedOf(result.membership), member.wallet, member.generation, true)).rejects.toThrow("account_unavailable");
    const actualSql = queries.mock.calls.map(([sql]) => sql); queries.mockRestore();
    expect(actualSql.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
    expect(retainedRows()).toEqual(evidenceBefore);
    expect((await base.service.resolve(base.s))!.membership).toEqual(result.membership);
    expect(db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(pending.nonce))?.consumed_at).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM account267_events").get()?.n).toBe(2);
    expect(db.prepare("SELECT count(*) AS n FROM account267_sessions WHERE revoked_at IS NOT NULL").get()?.n).toBe(0);
  });
  it.each(["revoked", "expired"])("resumes an exact fresh login after all 1024 retained bindings are %s without changing old or foreign evidence", async kind => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock); db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(), foreign = await bootstrap(2); clock += 1000;
    const last = await seedExactSessionCapacity(base, kind === "revoked");
    if (kind === "revoked") await base.service.revokeSession(base.s, expectedOf(base.start.membership));
    else clock = last.expiresAt; // Equality is dead; no expiry extension or early discount.
    expect(db.prepare("SELECT count(*) AS n FROM account267_sessions WHERE account_id=?").get(base.start.membership.accountId)?.n).toBe(1024);
    expect(db.prepare("SELECT count(*) AS n FROM account267_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>?")
      .get(base.start.membership.accountId, clock)?.n).toBe(0);
    for (const dead of [base.s, last]) {
      await expect(base.service.resolve(dead)).rejects.toThrow("account_unauthenticated");
      await expect(base.service.resume(dead, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
    }
    const fresh = session(), evidenceBefore = retainedRows();
    expect(await base.service.offer(fresh)).toEqual(expectedOf(base.start.membership));
    const queries = vi.spyOn(db, "prepare"), resumed = await base.service.resume(fresh, expectedOf(base.start.membership), consent);
    const actualSql = queries.mock.calls.map(([sql]) => sql); queries.mockRestore();
    expect(resumed.membership).toEqual(base.start.membership); expect(resumed.session).toEqual(fresh);
    expect(resumed.memberGeneration).toBe(base.start.memberGeneration); expect(resumed.credentialGeneration).toBe(base.start.credentialGeneration);
    expect((await base.service.resolve(fresh))!).toEqual(resumed);
    expect(db.prepare("SELECT count(*) AS n FROM account267_sessions WHERE account_id=?").get(base.start.membership.accountId)?.n).toBe(1025);
    for (const { table, rows } of evidenceBefore) {
      const after = table === "account267_sessions" ? db.prepare(`SELECT * FROM ${table} WHERE session_hash!=? ORDER BY 1`).all(fresh.sessionHash)
        : db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
      expect(after).toEqual(rows);
    }
    expect(db.prepare("SELECT account_id FROM account267_sessions WHERE session_hash=?").get(foreign.s.sessionHash)?.account_id).toBe(foreign.start.membership.accountId);
    expectLiveSessionPlans(actualSql);
  });
  it("refuses 1024 actually live bindings before any resume mutation, then recovers one slot through exact revocation", async () => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock); db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(); clock += 1000;
    const last = await seedExactSessionCapacity(base);
    expect(db.prepare("SELECT count(*) AS n FROM account267_sessions WHERE account_id=?").get(base.start.membership.accountId)?.n).toBe(1024);
    expect(db.prepare("SELECT count(*) AS n FROM account267_sessions WHERE account_id=? AND revoked_at IS NULL AND expires_at>?")
      .get(base.start.membership.accountId, clock)?.n).toBe(1024);
    const fresh = session(), evidenceBefore = retainedRows(), queries = vi.spyOn(db, "prepare");
    await expect(base.service.resume(fresh, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unavailable");
    const actualSql = queries.mock.calls.map(([sql]) => sql); queries.mockRestore();
    expect(actualSql.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
    expect(retainedRows()).toEqual(evidenceBefore); expect(await base.service.resolve(fresh)).toBeNull();
    expectLiveSessionPlans(actualSql);
    await base.service.revokeSession(last, expectedOf(base.start.membership));
    expect((await base.service.resume(fresh, expectedOf(base.start.membership), consent)).session).toEqual(fresh);
    await expect(base.service.resume(last, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
  });
  it("keeps original binding expiry and lineage immutable and account revocation monotonic", async () => {
    const base = await bootstrap(), before = retainedRows();
    for (const [field, value] of [["expires_at", base.s.expiresAt + 1000], ["issued_at", base.s.issuedAt + 1],
      ["member_generation", randomAccountValue()], ["credential_generation", randomAccountValue()]] as const) {
      expect(() => db.prepare(`UPDATE account267_sessions SET ${field}=? WHERE session_hash=?`).run(value, base.s.sessionHash)).toThrow("account_unavailable");
    }
    expect(retainedRows()).toEqual(before); expect(await base.service.resolve(base.s)).toEqual(base.start);
    await expect(base.store.assertCurrent({ ...base.start, membership: { ...base.start.membership, revision: 2 } })).rejects.toThrow("account_changed");
    await base.service.revokeSession(base.s, expectedOf(base.start.membership));
    const revoked = db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash)!;
    for (const value of [null, Number(revoked.revoked_at) + 1]) {
      expect(() => db.prepare("UPDATE account267_sessions SET revoked_at=? WHERE session_hash=?").run(value, base.s.sessionHash)).toThrow("account_unavailable");
    }
    expect(db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash)).toEqual(revoked);
    await expect(base.service.resume(base.s, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
  });
  it.each(["expiry", "issued time", "member generation", "credential generation"])("refuses a substituted stored %s against the exact durable login and current lineage", async kind => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock); db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(); clock += 1000;
    const fresh = session();
    db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`).run(fresh.sessionHash, fresh.wallet, base.start.membership.accountId,
      kind === "member generation" ? randomAccountValue() : base.start.memberGeneration,
      kind === "credential generation" ? randomAccountValue() : base.start.credentialGeneration,
      kind === "issued time" ? fresh.issuedAt - 1000 : fresh.issuedAt,
      kind === "expiry" ? fresh.expiresAt - 1000 : fresh.expiresAt, binding.origin, binding.network);
    const before = retainedRows();
    await expect(base.service.resolve(fresh)).rejects.toThrow("account_unauthenticated");
    await expect(base.service.resume(fresh, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
    expect(retainedRows()).toEqual(before);
  });
  it("refuses malformed binding expiry and stale resume revision without replacing rows or advancing lineage", async () => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock); db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(); clock += 1000;
    const fresh = session(), before = retainedRows();
    const insert = db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`);
    for (const expiry of [fresh.issuedAt, fresh.issuedAt + 604_800_001, "invalid", fresh.expiresAt + 0.5]) {
      expect(() => insert.run(fresh.sessionHash, fresh.wallet, base.start.membership.accountId, base.start.memberGeneration,
        base.start.credentialGeneration, fresh.issuedAt, expiry, binding.origin, binding.network)).toThrow();
    }
    await expect(base.service.resume(fresh, { ...expectedOf(base.start.membership), revision: 2 }, consent)).rejects.toThrow("account_changed");
    expect(retainedRows()).toEqual(before); expect(await base.service.resolve(fresh)).toBeNull();
    expect((await base.service.resume(fresh, expectedOf(base.start.membership), consent)).credentialGeneration).toBe(base.start.credentialGeneration);
  });
  it("does not revive or count an expired binding when its durable login is substituted with a later expiry", async () => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock); db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(), substituted = { ...base.s, expiresAt: base.s.expiresAt + 60_000 };
    // Adversarial fixture input, not an issuer/schema change or accepted renewal.
    db.prepare("UPDATE web_sessions SET expires_at=? WHERE hash=?").run(substituted.expiresAt, base.s.sessionHash);
    clock = base.s.expiresAt;
    const old = db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash);
    await expect(base.service.resolve(substituted)).rejects.toThrow("account_unauthenticated");
    await expect(base.service.resume(substituted, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
    expect(() => db.prepare("UPDATE account267_sessions SET expires_at=? WHERE session_hash=?").run(substituted.expiresAt, base.s.sessionHash)).toThrow("account_unavailable");
    const fresh = session(), queries = vi.spyOn(db, "prepare");
    const resumed = await base.service.resume(fresh, expectedOf(base.start.membership), consent);
    const actualSql = queries.mock.calls.map(([sql]) => sql); queries.mockRestore();
    expect(resumed.membership).toEqual(base.start.membership); expect(resumed.credentialGeneration).toBe(base.start.credentialGeneration);
    expect(db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(base.s.sessionHash)).toEqual(old);
    expectLiveSessionPlans(actualSql);
    await expect(base.service.resolve(substituted)).rejects.toThrow("account_unauthenticated");
  });
  it("retains the eight-live-proof limit and permits a new proof only after durable consumption", async () => {
    const base = await bootstrap(), proofs = [];
    for (let i = 0; i < 8; i++) proofs.push(await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent));
    await expect(base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent)).rejects.toThrow("account_unavailable");
    await expect(base.service.completeLink(base.s, proofs[0].nonce, "bad", linkConsent)).rejects.toThrow("invalid_membership_proof");
    expect(db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(proofs[0].nonce))?.consumed_at).not.toBeNull();
    const fresh = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    expect(fresh.nonce).not.toBe(proofs[0].nonce);
    expect((await base.service.resolve(base.s))!.membership.revision).toBe(1);
  });
  it.each(["before", "after"])("returns no success or retry when the final COMMIT acknowledgement fails %s persistence", async timing => {
    const base = await bootstrap(), proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const signature = await wallets[1].signMessage({ message: proof.message }), originalExec = db.exec.bind(db);
    let commits = 0;
    const exec = vi.spyOn(db, "exec").mockImplementation(sql => {
      // The first commit consumes the proof. Only the separate completion acknowledgement fails.
      if (sql === "COMMIT" && ++commits === 2) {
        if (timing === "after") originalExec(sql);
        throw new Error("Synthetic lost COMMIT acknowledgement");
      }
      return originalExec(sql);
    });
    await expect(base.service.completeLink(base.s, proof.nonce, signature, linkConsent)).rejects.toThrow("account_unavailable");
    expect(commits).toBe(2); exec.mockRestore();
    const current = (await base.service.resolve(base.s))!;
    expect(current.membership.revision).toBe(timing === "after" ? 2 : 1);
    expect(current.membership.members).toHaveLength(timing === "after" ? 2 : 1);
    const row = db.prepare("SELECT consumed_at,completed_at FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(proof.nonce))!;
    expect(row.consumed_at).not.toBeNull();
    if (timing === "after") expect(row.completed_at).not.toBeNull(); else expect(row.completed_at).toBeNull();
    await expect(base.service.completeLink(base.s, proof.nonce, signature, linkConsent)).rejects.toThrow("invalid_membership_proof");
    expect(db.prepare("SELECT count(*) AS n FROM account267_events").get()?.n).toBe(timing === "after" ? 2 : 1);
    expect(db.prepare("SELECT * FROM web_sessions WHERE hash=?").get(base.s.sessionHash))
      .toEqual({ hash: base.s.sessionHash, wallet: base.s.wallet, issued_at: base.s.issuedAt, expires_at: base.s.expiresAt });
  });
  it("refuses the last active login credential and does not expose a cohort after self-unlink", async () => {
    const base = await bootstrap(), first = base.start.membership.members[0];
    await expect(base.service.unlink(base.s, expectedOf(base.start.membership), first.wallet, first.generation, true)).rejects.toThrow("last_credential");
    const { result } = await link(base);
    expect(await base.service.unlink(base.s, expectedOf(result.membership), first.wallet, first.generation, true)).toBeNull();
    await expect(base.service.resolve(base.s)).rejects.toThrow("account_unauthenticated");
    // Wallet login/payment state is not deleted by account unlink.
    expect(db.prepare("SELECT hash FROM web_sessions WHERE hash=?").get(base.s.sessionHash)?.hash).toBe(base.s.sessionHash);
  });
  it("requires fresh login lineage and explicit consent for returning account binding", async () => {
    const base = await bootstrap(), old = session(1), { result } = await link(base);
    await expect(base.service.offer(old)).rejects.toThrow("account_unauthenticated");
    // Controlled fixture age, with the exact same production eligibility check.
    db.prepare("UPDATE account267_credentials SET login_after=? WHERE wallet=?").run(old.issuedAt - 1000, old.wallet);
    expect(await base.service.resolve(old)).toBeNull();
    expect(await base.service.offer(old)).toEqual({ accountId: result.membership.accountId, revision: 2 });
    await expect(base.service.resume(old, expectedOf(result.membership), { ...consent, shareOwnedHistory: false } as never)).rejects.toThrow();
    const resumed = await base.service.resume(old, expectedOf(result.membership), consent);
    expect(resumed.membership).toEqual(result.membership);
    const member = resumed.membership.members.find(m => m.wallet === old.wallet)!;
    await base.service.unlink(base.s, expectedOf(result.membership), old.wallet, member.generation, true);
    await expect(base.service.resolve(old)).rejects.toThrow("account_unauthenticated");
    await link(base, 1);
    await expect(base.service.resume(old, expectedOf((await base.service.resolve(base.s))!.membership), consent)).rejects.toThrow("account_unauthenticated");
  });
  it("refuses exact-second pre-link and pre-relink logins and admits the next whole-second login without changing expiry", async () => {
    let clock = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // Only the isolated fixture's database clock changes; the production session issuer is untouched.
    db.function("unixepoch", { varargs: true }, () => clock / 1000);
    const base = await bootstrap(), retained: InteractiveSession[] = [];
    let previousGeneration: string | undefined;
    for (let round = 0; round < 2; round++) {
      const beforeLink = session(1), completedAt = clock, { result } = await link(base);
      const member = result.membership.members.find(m => m.wallet === beforeLink.wallet)!;
      expect(member.linkedAt).toBe(completedAt);
      expect(db.prepare("SELECT login_after FROM account267_credentials WHERE wallet=?").get(beforeLink.wallet)?.login_after).toBe(completedAt + 1000);
      if (previousGeneration) expect(member.generation).not.toBe(previousGeneration);
      const sameSecond = session(1); retained.push(beforeLink, sameSecond);
      clock = completedAt + 999;
      for (const old of retained) {
        expect(await base.service.resolve(old)).toBeNull();
        await expect(base.service.offer(old)).rejects.toThrow("account_unauthenticated");
        await expect(base.service.resume(old, expectedOf(result.membership), consent)).rejects.toThrow("account_unauthenticated");
      }
      clock = completedAt + 1000;
      const fresh = session(1);
      expect(await base.service.offer(fresh)).toEqual(expectedOf(result.membership));
      expect((await base.service.resume(fresh, expectedOf(result.membership), consent)).membership).toEqual(result.membership);
      for (const original of [base.s, ...retained, fresh]) {
        expect(db.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE hash=?").get(original.sessionHash))
          .toEqual({ hash: original.sessionHash, wallet: original.wallet, issued_at: original.issuedAt, expires_at: original.expiresAt });
      }
      if (round === 0) {
        const unlinked = await base.service.unlink(base.s, expectedOf(result.membership), member.wallet, member.generation, true);
        await expect(base.service.resume(fresh, expectedOf(unlinked!), consent)).rejects.toThrow("account_unauthenticated");
        previousGeneration = member.generation; clock += 1000;
      }
    }
  });
  it("does not renew expiry or underlying revocation through another session", async () => {
    const base = await bootstrap(); db.prepare("DELETE FROM web_sessions WHERE hash=?").run(base.s.sessionHash);
    session(); await expect(base.store.assertCurrent(base.start)).rejects.toThrow("account_unauthenticated");
    const expired = { ...session(2), issuedAt: Date.now() - 120_000, expiresAt: Date.now() - 60_000 };
    db.prepare("UPDATE web_sessions SET issued_at=?,expires_at=? WHERE hash=?").run(expired.issuedAt, expired.expiresAt, expired.sessionHash);
    await expect(base.service.offer(expired)).rejects.toThrow("account_unauthenticated");
  });
  it("keeps consumed proof dead across account-session revocation and storage restart", async () => {
    const base = await bootstrap(), proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const taken = await base.store.take(base.s, binding, proof.nonce, "link-wallet", randomAccountValue());
    await base.service.revokeSession(base.s, expectedOf(base.start.membership));
    await expect(base.store.complete(base.s, taken, randomAccountValue())).rejects.toThrow("account_unauthenticated");
    await expect(base.service.resume(base.s, expectedOf(base.start.membership), consent)).rejects.toThrow("account_unauthenticated");
  });
  it("refuses overflow and a malformed membership/credential cohort", async () => {
    const base = await bootstrap();
    db.prepare("UPDATE account267_credentials SET active=0 WHERE wallet=?").run(base.s.wallet);
    await expect(base.service.resolve(base.s)).rejects.toThrow("account_unauthenticated");
    db.prepare("UPDATE account267_credentials SET active=1 WHERE wallet=?").run(base.s.wallet);
    // Fixture-only schema manipulation to admit the overflow boundary as input.
    db.exec("DROP TRIGGER account267_revision_monotonic");
    db.prepare("UPDATE account267_accounts SET revision=?").run(Number.MAX_SAFE_INTEGER);
    db.exec(ACCOUNT_MEMBERSHIP_SQL_DATA.slice(ACCOUNT_MEMBERSHIP_SQL_DATA.indexOf("CREATE TRIGGER account267_revision_monotonic"), ACCOUNT_MEMBERSHIP_SQL_DATA.indexOf("CREATE TRIGGER account267_challenge_immutable")));
    const current = (await base.service.resolve(base.s))!;
    const proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(current.membership), linkConsent);
    await expect(base.service.completeLink(base.s, proof.nonce, await wallets[1].signMessage({ message: proof.message }), linkConsent)).rejects.toThrow("account_unavailable");
    expect((await base.service.resolve(base.s))!.membership.revision).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("refuses expired challenges durably, including absent/pruned nonces", async () => {
    const base = await bootstrap(), p = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent), nonce = randomAccountValue();
    const expiredAt = Date.now() - 1000;
    const c = { ...p.challenge, issuedAt: expiredAt - 300_000, expiresAt: expiredAt };
    c.sessionCommitment = sessionCommitment(base.s, membershipNonceHash(nonce));
    db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at) VALUES(?,?,?,?)")
      .run(membershipNonceHash(nonce), base.s.sessionHash, JSON.stringify(c), c.expiresAt);
    await expect(base.service.completeLink(base.s, nonce, await wallets[1].signMessage({ message: membershipMessage(c, nonce) }), linkConsent)).rejects.toThrow("invalid_membership_proof");
    expect(db.prepare("SELECT consumed_at FROM account267_challenges WHERE nonce_hash=?").get(membershipNonceHash(nonce))?.consumed_at).not.toBeNull();
    await expect(base.service.completeCreate(base.s, randomAccountValue(), consent)).rejects.toThrow("invalid_membership_proof");
  });
  it("refuses altered schemas, unknown triggers and enrolled storage without repairing", async () => {
    const base = await bootstrap();
    db.exec("CREATE TRIGGER account267_foreign AFTER INSERT ON account267_members BEGIN SELECT 1; END;");
    await expect(base.service.resolve(base.s)).rejects.toThrow("account_unavailable");
    expect(() => createSqliteAccountMembership(db)).toThrow("account_unavailable");
    db.exec("DROP TRIGGER account267_foreign; CREATE TABLE keryx_storage_identity(value TEXT);");
    expect(() => createSqliteAccountMembership(db)).toThrow("account_unavailable");
    expect(db.prepare("SELECT count(*) AS n FROM account267_accounts").get()?.n).toBe(1);
  });
  it.each([
    ["uppercase account writer", "INSERT INTO ACCOUNT267_MEMBERS SELECT * FROM ACCOUNT267_MEMBERS WHERE 0; INSERT INTO ACCOUNT267_CREDENTIALS SELECT * FROM ACCOUNT267_CREDENTIALS WHERE 0;"],
    ["mixed-case account writer", "INSERT INTO AcCoUnT267_MeMbErS SELECT * FROM AcCoUnT267_MeMbErS WHERE 0; INSERT INTO AcCoUnT267_CrEdEnTiAlS SELECT * FROM AcCoUnT267_CrEdEnTiAlS WHERE 0;"],
    ["uppercase durable-session writer", "UPDATE WEB_SESSIONS SET expires_at=expires_at WHERE 0;"],
    ["mixed-case durable-session writer", "DELETE FROM WeB_SeSsIoNs WHERE 0;"],
  ])("refuses a foreign-table trigger with %s references before any business IO", async (_label, body) => {
    const base = await bootstrap();
    db.exec(`CREATE TABLE unrelated_input(value TEXT); CREATE TRIGGER foreign_writer AFTER INSERT ON unrelated_input BEGIN ${body} END;`);
    // The trigger's name and owner table contain no account or session domain prefix.
    await expect(base.service.resolve(base.s)).rejects.toThrow("account_unavailable");
    expect(() => createSqliteAccountMembership(db)).toThrow("account_unavailable");
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='foreign_writer'").get()).toBeDefined();
    expect(db.prepare("SELECT count(*) AS n FROM account267_members").get()?.n).toBe(1);
  });
  it.each(["ACCOUNT267_FOREIGN", "AcCoUnT267_Foreign", "KERYX_STORAGE_IDENTITY", "KeRyX_Storage_Identity"])
    ("refuses the forbidden object/marker case variant %s without repair", async name => {
      const base = await bootstrap(); db.exec(`CREATE TABLE "${name}"(value TEXT);`);
      await expect(base.service.resolve(base.s)).rejects.toThrow("account_unavailable");
      expect(() => createSqliteAccountMembership(db)).toThrow("account_unavailable");
      expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(name)).toBeDefined();
      expect(db.prepare("SELECT count(*) AS n FROM account267_accounts").get()?.n).toBe(1);
    });
  it.each(["ACCOUNT267_FOREIGN", "AcCoUnT267_Foreign"])("refuses an unknown case-variant domain trigger named %s on a foreign table", async name => {
    const base = await bootstrap();
    db.exec(`CREATE TABLE unrelated_input(value TEXT); CREATE TRIGGER "${name}" AFTER INSERT ON unrelated_input BEGIN SELECT 1; END;`);
    await expect(base.service.resolve(base.s)).rejects.toThrow("account_unavailable");
    expect(() => createSqliteAccountMembership(db)).toThrow("account_unavailable");
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(name)).toBeDefined();
  });
  it("rejects actual connection lock contention with no partial write or alternate connection", async () => {
    const base = await bootstrap(), other = new DatabaseSync(join(directory, "ordinary.sqlite"));
    try {
      other.exec("BEGIN IMMEDIATE");
      await expect(base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent)).rejects.toThrow("account_unavailable");
      other.exec("ROLLBACK"); expect((await base.service.resolve(base.s))!.membership.revision).toBe(1);
    } finally { other.close(); }
  });
  it("stores no raw nonce, signature, provider label or token in minimal audit events", async () => {
    const base = await bootstrap(), { issued, signature } = await link(base);
    const persisted = JSON.stringify(db.prepare("SELECT * FROM account267_events").all()) + JSON.stringify(db.prepare("SELECT * FROM account267_challenges").all());
    expect(persisted).not.toContain(issued.nonce); expect(persisted).not.toContain(signature);
    expect(persisted).not.toContain("userToken"); expect(persisted).not.toContain("Google");
    expect(persisted).not.toContain("payTo"); expect(persisted).not.toContain("budget");
  });
  it("fences unlinked/relinked/revoked account reads and propagates privacy failures", async () => {
    const base = await bootstrap(), { result } = await link(base), m = result.membership.members.find(v => v.wallet === wallets[1].address.toLowerCase())!;
    await expect(readWithAccountFence(base.store, result, async projection => {
      expect((await projection.resolve(base.s.wallet))!.wallets).toHaveLength(2);
      await base.service.unlink(base.s, expectedOf(result.membership), m.wallet, m.generation, true); return "private output";
    }, async () => undefined)).rejects.toThrow("account_changed");
    const current = (await base.service.resolve(base.s))!;
    await expect(readWithAccountFence(base.store, current, async () => "private output", async () => { throw new Error("privacy storage unavailable"); })).rejects.toThrow("privacy storage unavailable");
    await expect(readWithAccountFence(base.store, current, async () => { await base.service.revokeSession(base.s, expectedOf(current.membership)); return "private output"; }, async () => undefined)).rejects.toThrow("account_unauthenticated");
    await expect(createAccountHistoryProjection(base.store, current).resolve(wallets[2].address)).rejects.toThrow("account_unauthenticated");
  });
  it("rejects all bearer presence before cookie authority or IO and keeps errors private", async () => {
    let called = 0;
    const route = createAccountMembershipRoutes({ origin: binding.origin, async authenticate() { called++; throw new AccountError("account_unavailable"); } });
    for (const authorization of ["", "Bearer invalid", `Bearer kx_live_${"a".repeat(96)}`]) {
      const response = await route.GET(new Request(`${binding.origin}/api/account/membership`, { headers: { authorization } }));
      expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(called).toBe(0);
    expect((await route.POST(new Request(`${binding.origin}/api/account/membership`, { method: "POST", headers: { origin: "https://foreign.example" } }))).status).toBe(403);
    const fail = await route.GET(new Request(`${binding.origin}/api/account/membership`)); expect(fail.status).toBe(503); expect(await fail.text()).not.toContain("sessionHash");
  });
  it("consumes HTTP refusal and wrong-signature attempts before their validation", async () => {
    const base = await bootstrap(), proof = await base.service.prepareLink(base.s, wallets[1].address, expectedOf(base.start.membership), linkConsent);
    const route = createAccountMembershipRoutes({ origin: binding.origin, async authenticate() { return { service: base.service, session: base.s }; } });
    const response = await route.POST(new Request(`${binding.origin}/api/account/membership`, { method: "POST", headers: { origin: binding.origin, "content-type": "application/json", "x-keryx-expected-wallet": base.s.wallet },
      body: JSON.stringify({ action: "complete-link", nonce: proof.nonce, signature: "bad", consent: { ...linkConsent, sharePastAndFutureOwnedHistory: false } }) }));
    expect(response.status).toBe(400);
    await expect(base.service.completeLink(base.s, proof.nonce, await wallets[1].signMessage({ message: proof.message }), linkConsent)).rejects.toThrow("invalid_membership_proof");
  });
});
