import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { parseTopicWatchState, type TopicWatchKey, type TopicWatchState, type TopicWatchStore } from "../research/topic-watches";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteSelectedApplicationPolicy, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";

const sessionSchema = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), wallet: z.string().regex(/^0x[0-9a-f]{40}$/),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive() }).strict();
export type TopicWatchSession = z.infer<typeof sessionSchema>;
export interface PrivateTopicWatchStore extends TopicWatchStore { list(): Promise<TopicWatchState[]> }
export interface TopicWatchesPort { bindSession(session: TopicWatchSession): PrivateTopicWatchStore }
export class TopicWatchStorageError extends Error {
  constructor(readonly code: "watch_unavailable" | "watch_session_changed" | "watch_limit" = "watch_unavailable") { super(code); }
}
const unavailable = () => new TopicWatchStorageError();
const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
  && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
const keySchema = z.object({ ownerWallet: sessionSchema.shape.wallet,
  watchId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }).strict();
const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const storeTime = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";

/** Only same-selected native composition. No raw DB, supplied guard, DDL or
 * ordinary fallback escapes. The original session row is checked under the
 * same lock as the state; SQL never uses a request owner as authority. */
export function createEnrolledSqliteTopicWatches(db: DatabaseSync): TopicWatchesPort | undefined {
  if (arguments.length !== 1) throw unavailable();
  try { assertVerifiedSqliteConnection(db); } catch (error) {
    if (!contention(error)) { try { db.close(); } catch { /* admission permanently refused */ } }
    throw unavailable();
  }
  // A source-known legacy BEFORE has no domain port. Unknown shapes fail the
  // full connection guard above rather than acquiring a repaired subset.
  try { assertVerifiedSqliteNativeUserDomainPolicy(db); } catch { return undefined; }
  try { assertVerifiedSqliteSelectedApplicationPolicy(db); } catch { db.close(); throw unavailable(); }
  let revoked = false;
  const revoke = () => { revoked = true; try { db.close(); } catch { /* permanent latch */ } };
  const policy = (write: boolean) => {
    if (revoked) throw unavailable();
    // WeakMap-only readonly rejection precedes every SQL/transaction.
    if (write) { try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); } }
    try { assertVerifiedSqliteNativeUserDomainPolicy(db); assertVerifiedSqliteSelectedApplicationPolicy(db); assertVerifiedSqliteConnection(db); }
    catch (error) { if (!contention(error)) revoke(); throw error; }
  };
  return Object.freeze({ bindSession(raw: TopicWatchSession): PrivateTopicWatchStore {
    const session = Object.freeze(sessionSchema.parse(raw));
    const authorize = () => {
      const row = db.prepare(`SELECT hash,wallet,issued_at,expires_at FROM web_sessions
        WHERE hash=? AND wallet=? AND issued_at=? AND expires_at=? AND issued_at<=${storeTime} AND expires_at>${storeTime}`)
        .get(session.hash, session.wallet, session.issuedAt, session.expiresAt);
      if (!row) throw new TopicWatchStorageError("watch_session_changed");
    };
    const key = (rawKey: Readonly<TopicWatchKey>) => {
      const parsed = keySchema.parse(rawKey);
      if (parsed.ownerWallet !== session.wallet) throw new TopicWatchStorageError("watch_session_changed");
      return parsed;
    };
    const decode = (row: Record<string, unknown>) => {
      if (typeof row.state !== "string" || Buffer.byteLength(row.state) > 262_144) throw unavailable();
      const state = parseTopicWatchState(JSON.parse(row.state));
      if (state.key.ownerWallet !== session.wallet || state.key.watchId !== row.id || state.revision !== row.revision) throw unavailable();
      return state;
    };
    function transaction<T>(write: boolean, action: () => T): T {
      policy(write);
      let started = false, committing = false;
      try {
        db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); started = true;
        authorize(); const value = action(); authorize();
        committing = true; db.exec("COMMIT"); started = false;
        return value;
      } catch (error) {
        const benign = error instanceof TopicWatchStorageError && error.code !== "watch_unavailable";
        if (committing && !contention(error) || !benign && !contention(error)) { revoke(); throw unavailable(); }
        try { if (started) db.exec("ROLLBACK"); assertVerifiedSqliteConnection(db); }
        catch { revoke(); throw unavailable(); }
        if (benign) throw error;
        throw unavailable(); // Genuine BUSY/LOCKED may be retried by a new explicit operation.
      }
    }
    return Object.freeze({
      async list() {
        return transaction(false, () => {
          const rows = db.prepare("SELECT id,revision,state FROM topic_watches WHERE wallet=? ORDER BY id LIMIT 33").all(session.wallet);
          if (rows.length > 32) throw unavailable();
          return rows.map(decode);
        });
      },
      async read(rawKey) {
        const selected = key(rawKey);
        return transaction(false, () => {
          const row = db.prepare("SELECT id,revision,state FROM topic_watches WHERE wallet=? AND id=?").get(session.wallet, selected.watchId);
          return row ? decode(row) : null;
        });
      },
      async compareAndSwap(rawKey, expectedRevision, rawNext, notAfterMs) {
        // Must precede even input parsing for readonly ports.
        try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
        const selected = key(rawKey), next = parseTopicWatchState(rawNext);
        if (expectedRevision !== null) revisionSchema.parse(expectedRevision);
        z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(notAfterMs);
        if (next.key.ownerWallet !== session.wallet || next.key.watchId !== selected.watchId ||
          next.revision !== (expectedRevision ?? 0) + 1) throw unavailable();
        const encoded = canonicalJson(next);
        if (Buffer.byteLength(encoded) > 262_144) throw unavailable();
        return transaction(true, () => {
          const row = db.prepare("SELECT id,revision,state FROM topic_watches WHERE wallet=? AND id=?").get(session.wallet, selected.watchId);
          if (expectedRevision === null ? !!row : !row || row.revision !== expectedRevision) return false;
          if (row) {
            const previous = decode(row);
            if (previous.status === "cancelled" || next.createdAtMs !== previous.createdAtMs || next.nextSlot < previous.nextSlot)
              return false;
            if (previous.nextSlot > 0 && (canonicalJson(previous.spec) !== canonicalJson(next.spec) || previous.incarnation !== next.incarnation)) return false;
            if (previous.history.some((entry, index) => {
              const replacement = next.history[index];
              if (entry.kind !== "check" || entry.status !== "pending") return canonicalJson(entry) !== canonicalJson(replacement ?? null);
              if (!replacement || replacement.kind !== "check") return true;
              return entry.checkId !== replacement.checkId || entry.slot !== replacement.slot || entry.periodIndex !== replacement.periodIndex
                || entry.claimedAtMs !== replacement.claimedAtMs || entry.deadlineAtMs !== replacement.deadlineAtMs;
            })) return false;
            if (previous.watermark.some(entry => !next.watermark.some(candidate => canonicalJson(entry) === canonicalJson(candidate)))) return false;
          } else {
            const count = db.prepare("SELECT count(*) AS n FROM topic_watches WHERE wallet=?").get(session.wallet)!;
            if (Number(count.n) >= 32) throw new TopicWatchStorageError("watch_limit");
          }
          const result = expectedRevision === null
            ? db.prepare(`INSERT INTO topic_watches(wallet,id,revision,state) SELECT ?,?,?,? WHERE ${storeTime}<?`)
              .run(session.wallet, selected.watchId, next.revision, encoded, notAfterMs)
            : db.prepare(`UPDATE topic_watches SET revision=?,state=? WHERE wallet=? AND id=? AND revision=? AND ${storeTime}<?`)
              .run(next.revision, encoded, session.wallet, selected.watchId, expectedRevision, notAfterMs);
          return result.changes === 1;
        });
      },
    } satisfies PrivateTopicWatchStore);
  } } satisfies TopicWatchesPort);
}
