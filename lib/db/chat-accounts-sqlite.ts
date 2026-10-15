import type { DatabaseSync } from "node:sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteForeignKeys, assertVerifiedSqliteWritePolicy,
  assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteSelectedApplicationPolicy } from "./storage-identity-connection";
import { bindingSchema, digestSchema, snapshotSchema, type AccountSnapshot, type AccountBinding } from "../accounts/contracts";
import { ChatAccountError, pendingSchema, recipientSchema, linkSchema, type ChatRecipient, type ChatLink,
  type PendingChatLink, type ChatAccountLinksStore } from "../chat-accounts/contracts";

const unavailable = () => new ChatAccountError("chat_unavailable");
const busy = (e: unknown) => e instanceof Error && "code" in e && e.code === "ERR_SQLITE_ERROR"
  && "errcode" in e && (e.errcode === 5 || e.errcode === 6);

/** Source-local native factory. Positive WeakMap metadata BEFORE all SQL; the
 * original connection proxy supplies one complete runtime guard per primitive.
 * No reference DB, constructor DDL, raw escape, caller policy or clock override. */
export function createEnrolledSqliteChatAccountLinks(db: DatabaseSync): ChatAccountLinksStore | undefined {
  if (arguments.length !== 1) throw unavailable();
  let admitted = false, revoked = false;
  const retire = () => { revoked = true; if (admitted) try { db.close(); } catch { /* remains revoked */ } };
  const metadata = () => {
    if (revoked) throw unavailable();
    assertVerifiedSqliteForeignKeys(db);
    assertVerifiedSqliteSelectedApplicationPolicy(db);
  };
  try {
    metadata(); admitted = true;
    const identity = assertVerifiedSqliteConnection(db);
    if (identity.authorityMode !== "mainnet-real") throw unavailable();
    // Exact selected BEFORE is optional absence. Complete bundle metadata is the
    // positive declaration for this source's chat tables, pinned by full guard.
    try { assertVerifiedSqliteNativeUserDomainPolicy(db); }
    catch { return undefined; }
  } catch (error) {
    if (!busy(error)) retire();
    throw unavailable();
  }
  function transaction<T>(write: boolean, work: (now: number) => T): T {
    if (revoked) throw unavailable();
    // Readonly refusal is metadata-only, before SQL/full guard, without revocation.
    if (write) try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
    let began = false, committing = false;
    try {
      metadata(); assertVerifiedSqliteNativeUserDomainPolicy(db);
      if (db.isTransaction) { retire(); throw unavailable(); }
      db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); began = true;
      const now = db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()?.now;
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) throw unavailable();
      const result = work(now);
      committing = true; db.exec("COMMIT"); began = false;
      return result;
    } catch (error) {
      let clean = !began;
      if (began) try { db.exec("ROLLBACK"); clean = !db.isTransaction; } catch { clean = false; }
      // Never replay an uncertain commit. Only 5/6 before COMMIT may remain usable
      // after guarded rollback, no transaction and a successful full final guard.
      if (busy(error) && clean && !committing) {
        try {
          if (db.isTransaction) throw unavailable();
          assertVerifiedSqliteConnection(db);
        } catch { retire(); }
      } else if (!(error instanceof ChatAccountError) || !clean || committing) retire();
      throw error instanceof ChatAccountError ? error : unavailable();
    }
  }
  const key = (r: ChatRecipient, b: AccountBinding) => [r.platform, r.scope, r.userId, b.origin, b.network];
  const where = "platform=? AND scope=? AND user_id=? AND origin=? AND network=?";
  function rowLink(row: Record<string, unknown>): ChatLink {
    return linkSchema.parse({ platform: row.platform, scope: row.scope, userId: row.user_id, channel: row.channel,
      accountId: row.account_id, wallet: row.wallet, memberGeneration: row.member_generation, linkedAt: row.linked_at,
      binding: { origin: row.origin, network: row.network } });
  }
  function current(r: ChatRecipient, b: AccountBinding): ChatLink | null {
    const row = db.prepare(`SELECT * FROM chat263_links WHERE ${where}`).get(...key(r, b));
    if (!row) return null;
    const link = rowLink(row);
    const member = db.prepare(`SELECT 1 FROM account267_members m JOIN account267_credentials c ON c.wallet=m.wallet
      JOIN account267_accounts a ON a.account_id=m.account_id WHERE m.wallet=? AND m.account_id=? AND m.generation=?
      AND c.account_id=m.account_id AND c.member_generation=m.generation AND c.active=1`).get(link.wallet, link.accountId, link.memberGeneration);
    // Keep stale binding reserved until explicit unlink; never silently transfer it.
    if (!member) throw new ChatAccountError("chat_account_changed");
    return link;
  }
  function pending(hash: string, b: AccountBinding, now: number): PendingChatLink {
    const row = db.prepare("SELECT * FROM chat263_tokens WHERE token_hash=? AND origin=? AND network=? AND consumed_at IS NULL").get(hash, b.origin, b.network);
    if (!row || Number(row.issued_at) > now || Number(row.expires_at) <= now) throw new ChatAccountError("chat_token_invalid");
    return pendingSchema.parse({ purpose: row.purpose, tokenHash: row.token_hash,
      recipient: { platform: row.platform, scope: row.scope, userId: row.user_id, channel: row.channel },
      binding: { origin: row.origin, network: row.network }, issuedAt: row.issued_at, expiresAt: row.expires_at });
  }
  function account(raw: AccountSnapshot, now: number): AccountSnapshot {
    const s = snapshotSchema.parse(raw), login = s.session;
    // Same-store exact login and current account lineage, inside the link transaction.
    const row = db.prepare(`SELECT 1 FROM web_sessions w JOIN account267_sessions s ON s.session_hash=w.hash
      JOIN account267_members m ON m.wallet=s.wallet JOIN account267_credentials c ON c.wallet=m.wallet
      JOIN account267_accounts a ON a.account_id=m.account_id WHERE w.hash=? AND w.wallet=? AND w.issued_at=? AND w.expires_at=?
      AND s.wallet=w.wallet AND s.issued_at=w.issued_at AND s.expires_at=w.expires_at AND s.revoked_at IS NULL
      AND s.history_consent=1 AND s.origin=? AND s.network=? AND s.account_id=? AND a.account_id=s.account_id AND a.revision=?
      AND m.account_id=s.account_id AND m.generation=? AND s.member_generation=m.generation
      AND c.account_id=m.account_id AND c.member_generation=m.generation AND c.generation=?
      AND s.credential_generation=c.generation AND c.active=1 AND w.issued_at<=? AND w.expires_at>?`)
      .get(login.sessionHash, login.wallet, login.issuedAt, login.expiresAt, s.binding.origin, s.binding.network,
        s.membership.accountId, s.membership.revision, s.memberGeneration, s.credentialGeneration, now, now);
    if (!row) throw new ChatAccountError("chat_account_changed");
    return s;
  }
  function remove(r: ChatRecipient, b: AccountBinding) {
    db.prepare(`DELETE FROM chat263_links WHERE ${where}`).run(...key(r, b));
    // Invalidate every pending token, including tokens issued before the unlink.
    db.prepare(`UPDATE chat263_tokens SET consumed_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE ${where} AND consumed_at IS NULL`).run(...key(r, b));
  }
  return Object.freeze({
    async issue(raw) {
      const p = pendingSchema.parse(raw);
      transaction(true, now => {
        if (p.issuedAt > now || p.expiresAt <= now || p.issuedAt < now - 30_000) throw new ChatAccountError("chat_token_invalid");
        if (db.prepare(`SELECT 1 FROM chat263_links WHERE ${where}`).get(...key(p.recipient, p.binding))) throw new ChatAccountError("chat_takeover_refused");
        db.prepare(`UPDATE chat263_tokens SET consumed_at=? WHERE ${where} AND consumed_at IS NULL`).run(now, ...key(p.recipient, p.binding));
        // Expired rows confer no authority; retain every unexpired burned hash.
        db.prepare(`DELETE FROM chat263_tokens WHERE ${where} AND expires_at<=?`).run(...key(p.recipient, p.binding), now);
        db.prepare(`INSERT INTO chat263_tokens(token_hash,purpose,platform,scope,user_id,channel,origin,network,issued_at,expires_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(p.tokenHash, p.purpose, p.recipient.platform, p.recipient.scope, p.recipient.userId,
            p.recipient.channel, p.binding.origin, p.binding.network, p.issuedAt, p.expiresAt);
      });
    },
    async preview(rawHash, rawBinding) {
      const hash = digestSchema.parse(rawHash), b = bindingSchema.parse(rawBinding);
      return transaction(false, now => pending(hash, b, now));
    },
    async complete(rawHash, rawSnapshot) {
      const hash = digestSchema.parse(rawHash);
      const result = transaction(true, now => {
        const s = account(rawSnapshot, now), p = pending(hash, s.binding, now);
        if (db.prepare("UPDATE chat263_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?")
          .run(now, hash, now).changes !== 1) throw new ChatAccountError("chat_token_invalid");
        if (db.prepare(`SELECT 1 FROM chat263_links WHERE ${where}`).get(...key(p.recipient, p.binding))) return null;
        const existing = db.prepare("SELECT count(*) AS n FROM (SELECT 1 FROM chat263_links WHERE account_id=? AND origin=? AND network=? LIMIT 32)")
          .get(s.membership.accountId, s.binding.origin, s.binding.network)?.n;
        if (typeof existing !== "number" || existing >= 32) throw unavailable();
        const r = p.recipient;
        db.prepare(`INSERT INTO chat263_links(platform,scope,user_id,channel,origin,network,account_id,wallet,member_generation,linked_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(r.platform, r.scope, r.userId, r.channel, p.binding.origin, p.binding.network,
            s.membership.accountId, s.session.wallet, s.memberGeneration, now);
        return linkSchema.parse({ ...r, accountId: s.membership.accountId, wallet: s.session.wallet,
          memberGeneration: s.memberGeneration, linkedAt: now, binding: s.binding });
      });
      // Takeover refusal burns the token and commits no transfer.
      if (!result) throw new ChatAccountError("chat_takeover_refused");
      return result;
    },
    async lookup(raw, rawBinding) {
      const r = recipientSchema.parse(raw), b = bindingSchema.parse(rawBinding);
      return transaction(false, () => current(r, b));
    },
    async unlink(raw, rawBinding) {
      const r = recipientSchema.parse(raw), b = bindingSchema.parse(rawBinding);
      transaction(true, () => remove(r, b));
    },
    async list(raw) {
      return transaction(false, now => {
        const s = account(raw, now);
        const rows = db.prepare("SELECT * FROM chat263_links WHERE account_id=? AND origin=? AND network=? ORDER BY platform,scope,user_id LIMIT 33")
          .all(s.membership.accountId, s.binding.origin, s.binding.network);
        if (rows.length > 32) throw unavailable();
        return rows.map(rowLink);
      });
    },
    async unlinkAccount(raw, rawSnapshot) {
      const r = recipientSchema.parse(raw);
      transaction(true, now => {
        const s = account(rawSnapshot, now);
        const row = db.prepare(`SELECT account_id FROM chat263_links WHERE ${where}`).get(...key(r, s.binding));
        if (row && row.account_id !== s.membership.accountId) throw new ChatAccountError("chat_takeover_refused");
        remove(r, s.binding);
      });
    },
  } satisfies ChatAccountLinksStore);
}
