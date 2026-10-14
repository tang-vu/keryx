import type { DatabaseSync } from "node:sqlite";
import { AccountError, MAX_ACCOUNT_WALLETS, accountConsentSchema, bindingSchema, challengeSchema, digestSchema, interactiveSessionSchema,
  membershipSchema, preconditionSchema, snapshotSchema, timeSchema, walletInputSchema, type AccountBinding, type AccountMembershipStore,
  type AccountSnapshot, type InteractiveSession, type MembershipChallenge, type TakenMembershipChallenge } from "./contracts";
import { accountConsentHash, accountDigest, membershipNonceHash, randomAccountValue, sessionCommitment } from "./protocol";
import { ACCOUNT_MEMBERSHIP_SCHEMA_DATA, ACCOUNT_WEB_SESSION_SCHEMA_DATA } from "./sqlite-schema-data";

const unavailable = () => new AccountError("account_unavailable");
const MAX_RETAINED_ACCOUNT_ROWS = 1024;
const MAX_LIVE_ACCOUNT_SESSIONS = 1024;
const normalize = (sql: string | null) => sql === null ? null : sql.replace(/\s+/g, " ").trim();
const expectedShape = [...ACCOUNT_MEMBERSHIP_SCHEMA_DATA, ...ACCOUNT_WEB_SESSION_SCHEMA_DATA]
  .map(v => ({ type: v.type, name: v.name, table: v.table, sql: normalize(v.sql) }))
  .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** No reference database, runtime DDL, install, repair, file open or fallback.
 * The parent must supply the actual ordinary adapter-owned connection. */
export function assertAccountSqliteSchema(db: DatabaseSync) {
  try {
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE lower(name)='keryx_storage_identity' LIMIT 1").get()) throw unavailable();
    const timeout = db.prepare("PRAGMA busy_timeout").get()?.timeout;
    if (typeof timeout !== "number" || timeout < 0 || timeout > 1000) throw unavailable();
    const shape = db.prepare(`SELECT type,name,tbl_name AS 'table',substr(sql,1,16385) AS sql FROM sqlite_schema
      WHERE lower(tbl_name)='web_sessions' OR lower(name) GLOB 'account267_*' OR lower(tbl_name) GLOB 'account267_*'
        OR (type='trigger' AND (length(sql)>16384 OR instr(lower(substr(sql,1,16384)),'account267_')>0
          OR instr(lower(substr(sql,1,16384)),'web_sessions')>0)) ORDER BY name LIMIT 64`).all()
      .map(v => ({ type: v.type, name: v.name, table: v.table, sql: typeof v.sql === "string" ? normalize(v.sql) : v.sql }));
    if (JSON.stringify(shape) !== JSON.stringify(expectedShape)) throw unavailable();
  } catch { throw unavailable(); }
}

export function createSqliteAccountMembership(db: DatabaseSync): AccountMembershipStore {
  assertAccountSqliteSchema(db);
  function transaction<T>(action: (now: number) => T): T {
    let begun = false;
    try {
      assertAccountSqliteSchema(db);
      db.exec("BEGIN IMMEDIATE"); begun = true;
      assertAccountSqliteSchema(db);
      const now = timeSchema.parse(db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()?.now);
      const value = action(now); db.exec("COMMIT"); return value;
    } catch (error) {
      if (begun) { try { db.exec("ROLLBACK"); } catch { /* An uncertain acknowledgement grants no success. */ } }
      if (error instanceof AccountError) throw error;
      throw unavailable();
    }
  }
  function live(raw: InteractiveSession, now: number) {
    const s = interactiveSessionSchema.parse(raw);
    const row = db.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE hash=?").get(s.sessionHash);
    if (!row || row.hash !== s.sessionHash || row.wallet !== s.wallet || row.issued_at !== s.issuedAt || row.expires_at !== s.expiresAt
      || s.issuedAt > now || s.expiresAt <= now) throw new AccountError("account_unauthenticated");
    return s;
  }
  function membership(accountId: string) {
    const a = db.prepare("SELECT account_id,revision,created_at FROM account267_accounts WHERE account_id=?").get(accountId);
    if (!a) throw unavailable();
    const rows = db.prepare("SELECT wallet,generation,linked_at FROM account267_members WHERE account_id=? ORDER BY wallet LIMIT 9").all(accountId);
    const result = membershipSchema.parse({ version: 1, accountId: a.account_id, revision: a.revision, createdAt: a.created_at,
      members: rows.map(m => ({ wallet: m.wallet, generation: m.generation, linkedAt: m.linked_at })) });
    const credentials = db.prepare("SELECT wallet,member_generation,generation,login_after,active FROM account267_credentials INDEXED BY account267_credentials_account WHERE account_id=? ORDER BY wallet LIMIT 9").all(accountId);
    if (credentials.length !== rows.length || credentials.some((c, i) => c.wallet !== rows[i].wallet || c.member_generation !== rows[i].generation
      || !digestSchema.safeParse(c.generation).success || !timeSchema.safeParse(c.login_after).success || c.active !== 0 && c.active !== 1)
      || new Set(credentials.map(c => c.generation)).size !== rows.length || !credentials.some(c => c.active === 1)) throw unavailable();
    return result;
  }
  function resolve(raw: InteractiveSession, rawBinding: AccountBinding, now: number): AccountSnapshot | null {
    const s = live(raw, now), binding = bindingSchema.parse(rawBinding);
    const row = db.prepare("SELECT * FROM account267_sessions WHERE session_hash=?").get(s.sessionHash);
    if (!row) return null; // Not admitted: this is NOT a history fallback.
    if (row.revoked_at !== null || row.wallet !== s.wallet || row.issued_at !== s.issuedAt || row.expires_at !== s.expiresAt
      || row.origin !== binding.origin || row.network !== binding.network || row.history_consent !== 1) throw new AccountError("account_unauthenticated");
    const m = db.prepare("SELECT account_id,generation FROM account267_members WHERE wallet=?").get(s.wallet);
    const c = db.prepare("SELECT account_id,member_generation,generation,active FROM account267_credentials WHERE wallet=?").get(s.wallet);
    if (!m || !c || c.active !== 1 || m.account_id !== row.account_id || c.account_id !== row.account_id || m.generation !== row.member_generation
      || c.member_generation !== row.member_generation || c.generation !== row.credential_generation) throw new AccountError("account_unauthenticated");
    return snapshotSchema.parse({ membership: membership(row.account_id as string), session: s, memberGeneration: m.generation, credentialGeneration: c.generation, binding });
  }
  function current(raw: AccountSnapshot, now: number) {
    const start = snapshotSchema.parse(raw), end = resolve(start.session, start.binding, now);
    if (!end || JSON.stringify(end) !== JSON.stringify(start)) throw new AccountError("account_changed");
    return end;
  }
  function bind(s: InteractiveSession, accountId: string, memberGeneration: string, credentialGeneration: string, b: AccountBinding, now: number) {
    // Retained dead evidence is not admission capacity. Immutable original expiry
    // and monotonic revocation keep it dead; count every still-revocable generation.
    if (Number(db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM account267_sessions INDEXED BY account267_sessions_live
      WHERE account_id=? AND revoked_at IS NULL AND expires_at>? LIMIT ?)`).get(accountId, now, MAX_LIVE_ACCOUNT_SESSIONS)?.n) >= MAX_LIVE_ACCOUNT_SESSIONS) throw unavailable();
    db.prepare(`INSERT INTO account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,NULL)`).run(s.sessionHash, s.wallet, accountId, memberGeneration, credentialGeneration, s.issuedAt, s.expiresAt, b.origin, b.network);
  }
  function event(c: MembershipChallenge, purpose: string, revision: number, proofHash: string, now: number) {
    if (Number(db.prepare("SELECT count(*) AS n FROM (SELECT 1 FROM account267_events INDEXED BY account267_events_account WHERE account_id=? LIMIT ?)")
      .get(c.accountId, MAX_RETAINED_ACCOUNT_ROWS)?.n) >= MAX_RETAINED_ACCOUNT_ROWS) throw unavailable();
    db.prepare("INSERT INTO account267_events(id,account_id,revision,purpose,lineage_hash,consent_hash,proof_hash,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(randomAccountValue(), c.accountId, revision, purpose, accountDigest(`keryx-membership-lineage-v1:${c.generation}`), c.consentHash, proofHash, now);
  }
  return Object.freeze({
    async offer(raw, rawBinding) {
      return transaction(now => {
        const s = live(raw, now), b = bindingSchema.parse(rawBinding), existing = resolve(s, b, now);
        if (existing) return { accountId: existing.membership.accountId, revision: existing.membership.revision };
        const m = db.prepare("SELECT account_id,generation FROM account267_members WHERE wallet=?").get(s.wallet);
        if (!m) return null;
        const c = db.prepare("SELECT account_id,member_generation,login_after,active FROM account267_credentials WHERE wallet=?").get(s.wallet);
        if (!c || c.active !== 1 || c.account_id !== m.account_id || c.member_generation !== m.generation || typeof c.login_after !== "number" || s.issuedAt < c.login_after)
          throw new AccountError("account_unauthenticated");
        const a = membership(m.account_id as string);
        // No other wallet or private activity is exposed before account-read consent.
        return { accountId: a.accountId, revision: a.revision };
      });
    },
    async resolve(s, b) { return transaction(now => resolve(s, b, now)); },
    async resume(raw, rawBinding, rawExpected, rawConsent) {
      const expected = preconditionSchema.parse(rawExpected), b = bindingSchema.parse(rawBinding); accountConsentSchema.parse(rawConsent);
      return transaction(now => {
        const s = live(raw, now), existing = resolve(s, b, now);
        if (existing) {
          if (existing.membership.accountId !== expected.accountId || existing.membership.revision !== expected.revision) throw new AccountError("account_changed");
          return existing;
        }
        const m = db.prepare("SELECT account_id,generation FROM account267_members WHERE wallet=?").get(s.wallet);
        const c = db.prepare("SELECT * FROM account267_credentials WHERE wallet=?").get(s.wallet);
        if (!m || !c || c.active !== 1 || c.account_id !== m.account_id || c.member_generation !== m.generation || typeof c.login_after !== "number" || s.issuedAt < c.login_after)
          throw new AccountError("account_unauthenticated");
        const cohort = membership(m.account_id as string);
        if (cohort.accountId !== expected.accountId || cohort.revision !== expected.revision) throw new AccountError("account_changed");
        bind(s, cohort.accountId, m.generation as string, c.generation as string, b, now);
        return resolve(s, b, now)!;
      });
    },
    async issue(raw, rawChallenge, rawNonceHash) {
      const c = challengeSchema.parse(rawChallenge), nonceHash = digestSchema.parse(rawNonceHash);
      return transaction(now => {
        const s = live(raw, now);
        if (c.sessionCommitment !== sessionCommitment(s, nonceHash) || c.consentHash !== accountConsentHash(c.purpose)
          || c.issuedAt > now || c.issuedAt < now - 5000 || c.expiresAt <= now) throw new AccountError("invalid_membership_proof");
        if (c.purpose === "create-private-account") {
          if (c.wallet !== s.wallet || c.revision !== 0 || db.prepare("SELECT 1 FROM account267_members WHERE wallet=?").get(s.wallet)
            || db.prepare("SELECT 1 FROM account267_sessions WHERE session_hash=?").get(s.sessionHash)) throw new AccountError("wallet_unavailable");
        } else {
          const a = resolve(s, c.binding, now);
          if (!a || a.membership.accountId !== c.accountId || a.membership.revision !== c.revision) throw new AccountError("account_changed");
          if (a.membership.members.length >= MAX_ACCOUNT_WALLETS) throw new AccountError("account_full");
          if (db.prepare("SELECT 1 FROM account267_members WHERE wallet=?").get(c.wallet)) throw new AccountError("wallet_unavailable");
        }
        if (Number(db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM account267_challenges INDEXED BY account267_challenges_session
          WHERE session_hash=? AND expires_at>? AND consumed_at IS NULL LIMIT 8)`).get(s.sessionHash, now)?.n) >= 8
          || Number(db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM account267_challenges INDEXED BY account267_challenges_session
            WHERE session_hash=? LIMIT ?)`).get(s.sessionHash, MAX_RETAINED_ACCOUNT_ROWS)?.n) >= MAX_RETAINED_ACCOUNT_ROWS
          || Number(db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM account267_challenges INDEXED BY account267_challenges_account
            WHERE json_extract(payload,'$.accountId')=? LIMIT ?)`).get(c.accountId, MAX_RETAINED_ACCOUNT_ROWS)?.n) >= MAX_RETAINED_ACCOUNT_ROWS) throw unavailable();
        db.prepare("INSERT INTO account267_challenges(nonce_hash,session_hash,payload,expires_at) VALUES(?,?,?,?)").run(nonceHash, s.sessionHash, JSON.stringify(c), c.expiresAt);
      });
    },
    async take(raw, rawBinding, nonce, purpose, lease) {
      const nonceHash = membershipNonceHash(nonce), b = bindingSchema.parse(rawBinding); digestSchema.parse(lease);
      const result = transaction(now => {
        const s = live(raw, now), row = db.prepare("SELECT * FROM account267_challenges WHERE nonce_hash=?").get(nonceHash);
        if (!row || row.consumed_at !== null) return null;
        db.prepare("UPDATE account267_challenges SET consumed_at=?,lease_hash=? WHERE nonce_hash=? AND consumed_at IS NULL")
          .run(now, accountDigest(`keryx-membership-lease-v1:${lease}`), nonceHash);
        // Invalid attempts commit the spent marker without disclosing another account.
        try {
          const c = challengeSchema.parse(JSON.parse(row.payload as string));
          if (row.session_hash !== s.sessionHash || row.expires_at !== c.expiresAt || c.issuedAt > now || c.expiresAt <= now || c.purpose !== purpose
            || c.binding.origin !== b.origin || c.binding.network !== b.network || c.sessionCommitment !== sessionCommitment(s, nonceHash)
            || c.consentHash !== accountConsentHash(c.purpose)) return null;
          if (purpose === "create-private-account") {
            if (c.wallet !== s.wallet || c.revision !== 0 || db.prepare("SELECT 1 FROM account267_members WHERE wallet=?").get(s.wallet)) return null;
          } else {
            const a = resolve(s, b, now);
            if (!a || a.membership.accountId !== c.accountId || a.membership.revision !== c.revision) return null;
          }
          return { challenge: c, nonce, lease };
        } catch { return null; }
      });
      if (!result) throw new AccountError("invalid_membership_proof");
      return result;
    },
    async complete(raw, taken: TakenMembershipChallenge, proofHash) {
      const c = challengeSchema.parse(taken.challenge), nonceHash = membershipNonceHash(taken.nonce); digestSchema.parse(proofHash); digestSchema.parse(taken.lease);
      return transaction(now => {
        const s = live(raw, now), row = db.prepare("SELECT * FROM account267_challenges WHERE nonce_hash=?").get(nonceHash);
        if (!row || row.session_hash !== s.sessionHash || row.payload !== JSON.stringify(c) || row.consumed_at === null || row.completed_at !== null
          || row.lease_hash !== accountDigest(`keryx-membership-lease-v1:${taken.lease}`) || row.expires_at !== c.expiresAt
          || c.issuedAt > now || c.expiresAt <= now || c.sessionCommitment !== sessionCommitment(s, nonceHash)) throw new AccountError("invalid_membership_proof");
        let cohort: AccountSnapshot | null = null;
        if (c.purpose === "create-private-account") {
          if (c.wallet !== s.wallet || c.revision !== 0 || db.prepare("SELECT 1 FROM account267_sessions WHERE session_hash=?").get(s.sessionHash)) throw new AccountError("account_changed");
        } else {
          cohort = resolve(s, c.binding, now);
          if (!cohort || cohort.membership.accountId !== c.accountId || cohort.membership.revision !== c.revision) throw new AccountError("account_changed");
          if (cohort.membership.members.length >= MAX_ACCOUNT_WALLETS) throw new AccountError("account_full");
          if (c.revision === Number.MAX_SAFE_INTEGER) throw unavailable();
        }
        if (db.prepare("SELECT 1 FROM account267_members WHERE wallet=?").get(c.wallet)) throw new AccountError("wallet_unavailable");
        if (c.purpose === "create-private-account") db.prepare("INSERT INTO account267_accounts(account_id,revision,created_at) VALUES(?,0,?)").run(c.accountId, now);
        const credentialGeneration = randomAccountValue(), loginAfter = timeSchema.parse((Math.floor(now / 1000) + 1) * 1000);
        db.prepare("INSERT INTO account267_members(wallet,account_id,generation,consent_hash,linked_at) VALUES(?,?,?,?,?)").run(c.wallet, c.accountId, c.generation, c.consentHash, now);
        db.prepare("INSERT INTO account267_credentials(wallet,account_id,member_generation,generation,login_after,active) VALUES(?,?,?,?,?,1)")
          .run(c.wallet, c.accountId, c.generation, credentialGeneration, loginAfter);
        const updated = db.prepare("UPDATE account267_accounts SET revision=revision+1 WHERE account_id=? AND revision=?").run(c.accountId, c.revision);
        if (updated.changes !== 1) throw new AccountError("account_changed");
        db.prepare("UPDATE account267_challenges SET completed_at=? WHERE nonce_hash=? AND completed_at IS NULL").run(now, nonceHash);
        // Any other pending proof in this cohort becomes stale through its immutable revision.
        event(c, c.purpose, c.revision + 1, proofHash, now);
        if (!cohort) bind(s, c.accountId, c.generation, credentialGeneration, c.binding, now);
        return resolve(s, c.binding, now)!;
      });
    },
    async unlink(raw, rawWallet, rawGeneration) {
      const wallet = walletInputSchema.parse(rawWallet), generation = digestSchema.parse(rawGeneration);
      return transaction(now => {
        const a = current(raw, now), m = a.membership.members.find(v => v.wallet === wallet && v.generation === generation);
        if (!m) throw new AccountError("account_changed");
        if (a.membership.revision === Number.MAX_SAFE_INTEGER) throw unavailable();
        if (!db.prepare("SELECT 1 FROM account267_credentials INDEXED BY account267_credentials_account WHERE account_id=? AND wallet!=? AND active=1 LIMIT 1").get(a.membership.accountId, wallet))
          throw new AccountError("last_credential");
        const pending = db.prepare(`SELECT nonce_hash FROM account267_challenges INDEXED BY account267_challenges_account
          WHERE json_extract(payload,'$.accountId')=? AND consumed_at IS NULL LIMIT ?`).all(a.membership.accountId, MAX_RETAINED_ACCOUNT_ROWS + 1);
        const sessions = db.prepare(`SELECT session_hash FROM account267_sessions INDEXED BY account267_sessions_account
          WHERE account_id=? AND wallet=? AND revoked_at IS NULL AND expires_at>? LIMIT ?`).all(a.membership.accountId, wallet, now, MAX_LIVE_ACCOUNT_SESSIONS + 1);
        if (pending.length > MAX_RETAINED_ACCOUNT_ROWS || sessions.length > MAX_LIVE_ACCOUNT_SESSIONS) throw unavailable();
        db.prepare("DELETE FROM account267_members WHERE wallet=? AND account_id=? AND generation=?").run(wallet, a.membership.accountId, generation);
        db.prepare("DELETE FROM account267_credentials WHERE wallet=? AND account_id=? AND member_generation=?").run(wallet, a.membership.accountId, generation);
        const revoke = db.prepare("UPDATE account267_sessions SET revoked_at=? WHERE session_hash=? AND revoked_at IS NULL");
        for (const row of sessions) revoke.run(now, row.session_hash);
        db.prepare("UPDATE account267_accounts SET revision=revision+1 WHERE account_id=? AND revision=?").run(a.membership.accountId, a.membership.revision);
        const cancel = db.prepare("UPDATE account267_challenges SET consumed_at=?,lease_hash=? WHERE nonce_hash=? AND consumed_at IS NULL");
        const leaseHash = accountDigest(`keryx-membership-unlink-cancel-v1:${randomAccountValue()}`);
        for (const row of pending) cancel.run(now, leaseHash, row.nonce_hash);
        event({ version: 1, purpose: "link-wallet", accountId: a.membership.accountId, revision: a.membership.revision, wallet,
          generation, sessionCommitment: accountDigest(a.session.sessionHash), consentHash: accountDigest("keryx-membership-unlink-consent-v1"),
          binding: a.binding, issuedAt: now, expiresAt: now + 300_000 }, "unlink-wallet", a.membership.revision + 1, accountDigest(`unlink:${generation}`), now);
        return wallet === a.session.wallet ? null : membership(a.membership.accountId);
      });
    },
    async revokeSession(raw) {
      transaction(now => { const a = current(raw, now); db.prepare("UPDATE account267_sessions SET revoked_at=? WHERE session_hash=?").run(now, a.session.sessionHash); });
    },
    async assertCurrent(raw) { transaction(now => { current(raw, now); }); },
  } satisfies AccountMembershipStore);
}
