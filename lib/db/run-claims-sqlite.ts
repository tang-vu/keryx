import { createHash } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteNativeUserDomainPolicy, assertVerifiedSqliteWritePolicy } from "./storage-identity-connection";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { RUN_CLAIM_TTL_MS, RunClaimError, runClaimAttemptSchema, runClaimIssueSchema, runClaimIssuanceSchema,
  runClaimReceiptSchema, type RunClaimsStore } from "../run-claims/contracts";

/** Explicit isolated-fixture/reviewed-migration SQL. The factory never executes this installer. */
export const RUN_CLAIMS_SQL = `CREATE TABLE anonymous_run_claims (
  run_id TEXT PRIMARY KEY CHECK(length(run_id) BETWEEN 1 AND 128 AND run_id NOT GLOB '*[^A-Za-z0-9_-]*' AND run_id NOT GLOB 'prv_*' AND run_id NOT GLOB 'a2a_*'),
  network TEXT NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002')),
  origin TEXT NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  original_sha256 TEXT NOT NULL CHECK(length(original_sha256)=64 AND original_sha256 NOT GLOB '*[^a-f0-9]*'),
  completed_at TEXT NOT NULL,
  issued_at INTEGER NOT NULL CHECK(typeof(issued_at)='integer' AND issued_at>=0 AND issued_at<=8640000000000000-${RUN_CLAIM_TTL_MS}),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at=issued_at+${RUN_CLAIM_TTL_MS}),
  claimed_wallet TEXT CHECK(claimed_wallet IS NULL OR (length(claimed_wallet)=42 AND substr(claimed_wallet,1,2)='0x' AND substr(claimed_wallet,3) NOT GLOB '*[^a-f0-9]*')),
  claimed_at INTEGER CHECK(claimed_at IS NULL OR (typeof(claimed_at)='integer' AND claimed_at>=issued_at AND claimed_at<expires_at)),
  CHECK((claimed_wallet IS NULL)=(claimed_at IS NULL))
);
CREATE INDEX anonymous_run_claims_owner ON anonymous_run_claims(claimed_wallet,run_id);
CREATE TRIGGER anonymous_run_claims_initial BEFORE INSERT ON anonymous_run_claims
  WHEN NEW.claimed_wallet IS NOT NULL OR NEW.claimed_at IS NOT NULL
  BEGIN SELECT RAISE(ABORT,'claim_unavailable'); END;
CREATE TRIGGER anonymous_run_claims_single_use BEFORE UPDATE ON anonymous_run_claims
  WHEN OLD.claimed_wallet IS NOT NULL OR NEW.claimed_wallet IS NULL OR NEW.claimed_at IS NULL
    OR NEW.run_id IS NOT OLD.run_id OR NEW.network IS NOT OLD.network OR NEW.origin IS NOT OLD.origin
    OR NEW.token_hash IS NOT OLD.token_hash OR NEW.original_sha256 IS NOT OLD.original_sha256
    OR NEW.completed_at IS NOT OLD.completed_at OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at
  BEGIN SELECT RAISE(ABORT,'claim_unavailable'); END;
CREATE TRIGGER anonymous_run_claims_no_delete BEFORE DELETE ON anonymous_run_claims
  BEGIN SELECT RAISE(ABORT,'claim_unavailable'); END;`;
const SESSION_SQL = `CREATE TABLE IF NOT EXISTS web_sessions (
  hash TEXT PRIMARY KEY CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  wallet TEXT NOT NULL CHECK(length(wallet) = 42 AND substr(wallet,1,2) = '0x' AND substr(wallet,3) NOT GLOB '*[^a-f0-9]*'),
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > issued_at AND expires_at <= issued_at + 604800000)
);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS web_sessions_wallet ON web_sessions(wallet, expires_at);`;
const shape = (db: DatabaseSync) => db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema
  WHERE tbl_name IN ('anonymous_run_claims','web_sessions') ORDER BY type,name LIMIT 20`).all();
let expectedShape: string | undefined;
export function assertSqliteRunClaimsSchema(db: DatabaseSync) {
  try {
    assertOrdinarySqliteResearchAuthority(db);
    if (!expectedShape) {
      const reference = new DatabaseSync(":memory:");
      try { reference.exec(SESSION_SQL + RUN_CLAIMS_SQL); expectedShape = JSON.stringify(shape(reference)); }
      finally { reference.close(); }
    }
    if (JSON.stringify(shape(db)) !== expectedShape) throw new Error("Unknown claim domain");
    for (const name of ["query_runs", "a2a_orders"]) {
      const entry = db.prepare("SELECT type,sql FROM sqlite_schema WHERE name=?").get(name);
      if (entry?.type !== "table" || typeof entry.sql !== "string" || !/^CREATE TABLE\b/i.test(entry.sql)) throw new Error("Unavailable original domain");
    }
  } catch { throw new RunClaimError("claims_unavailable"); }
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function original(db: DatabaseSync, id: string, completedAt: string) {
  const row = db.prepare("SELECT id,asker,created_at,data FROM query_runs WHERE id=?").get(id);
  if (!row || row.asker !== null || row.created_at !== completedAt || typeof row.data !== "string"
    || Buffer.byteLength(row.data) > 4_000_000 || db.prepare("SELECT 1 FROM a2a_orders WHERE query_id=?").get(id))
    throw new RunClaimError("claim_unavailable");
  try {
    const run: unknown = JSON.parse(row.data);
    if (!run || typeof run !== "object" || Array.isArray(run) || Reflect.get(run, "id") !== id || Reflect.get(run, "createdAt") !== completedAt
      || Object.hasOwn(run, "asker") || Object.hasOwn(run, "originalFulfillment") || Reflect.get(run, "askerFunded") === true
      || Reflect.get(run, "fundingOwner") === "browser") throw new Error("Ineligible original");
    return hash(row.data);
  } catch { throw new RunClaimError("claim_unavailable"); }
}

/** Ordinary, exact pre-existing schema only. No initialization, repair or native adoption.
 * Fixture clock is solely for explicit synthetic temporary-store acceptance. */
export function createSqliteRunClaims(db: DatabaseSync, options: { fixtureClock?: () => number } = {}): RunClaimsStore {
  assertSqliteRunClaimsSchema(db);
  if (options.fixtureClock) db.function("keryx_run_claim_fixture_clock", options.fixtureClock);
  const clock = options.fixtureClock ? "keryx_run_claim_fixture_clock()" : "CAST(unixepoch('subsec')*1000 AS INTEGER)";
  return claimsPort(db, clock, () => assertSqliteRunClaimsSchema(db));
}

/** Genuine complete native bundle only. No fixture clock, DDL or caller guard. */
export function createEnrolledSqliteRunClaims(db: DatabaseSync): RunClaimsStore {
  const unavailable = () => new RunClaimError("claims_unavailable");
  if (arguments.length !== 1) throw unavailable();
  assertVerifiedSqliteNativeUserDomainPolicy(db);
  const identity = assertVerifiedSqliteConnection(db);
  if (identity.authorityMode !== "mainnet-real") throw unavailable();
  let refused = false;
  const contention = (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
    && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
  const retire = () => { refused = true; db.close(); };
  const check = (write = false) => {
    if (refused) throw unavailable();
    if (write) { try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); } }
    try { assertVerifiedSqliteNativeUserDomainPolicy(db); assertVerifiedSqliteConnection(db); }
    catch (error) { if (!contention(error)) retire(); throw unavailable(); }
  };
  const sql = <T>(action: () => T): T => {
    if (refused) throw unavailable();
    try { return action(); } catch (error) { if (!contention(error)) retire(); throw unavailable(); }
  };
  const guarded = new Proxy(db, { get(target, property) {
    if (property === "exec") return (query: string) => sql(() => target.exec(query));
    if (property === "prepare") return (query: string) => {
      const statement = sql(() => target.prepare(query));
      return new Proxy(statement, { get(value, key) {
        if (["get", "all", "run"].includes(String(key))) return (...args: unknown[]) => sql(() => Reflect.apply(Reflect.get(value, key), value, args));
        throw unavailable();
      } }) as StatementSync;
    };
    throw unavailable();
  } });
  const port = claimsPort(guarded, "CAST(unixepoch('subsec')*1000 AS INTEGER)", check, () => check());
  return Object.freeze({ ...port,
    async issue(input) {
      try { if (runClaimIssueSchema.parse(input).binding.network !== identity.network) throw unavailable(); }
      catch { throw new RunClaimError("claim_unavailable"); }
      return port.issue(input);
    },
    async claim(input) {
      try { if (runClaimAttemptSchema.parse(input).binding.network !== identity.network) throw unavailable(); }
      catch { throw new RunClaimError("claim_unavailable"); }
      return port.claim(input);
    },
  } satisfies RunClaimsStore);
}

/** Same journal bodies; authority callbacks never leave constructor composition. */
function claimsPort(db: DatabaseSync, clock: string, guard: (write?: boolean) => void, afterNative?: () => void): RunClaimsStore {
  function transaction<T>(action: (now: number) => T): T {
    guard(true);
    let started = false;
    try {
      db.exec("BEGIN IMMEDIATE"); started = true;
      guard(true);
      const now = db.prepare(`SELECT ${clock} AS now`).get()?.now;
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 - RUN_CLAIM_TTL_MS)
        throw new RunClaimError("claims_unavailable");
      const result = action(now); afterNative?.(); db.exec("COMMIT"); afterNative?.(); return result;
    } catch (error) {
      if (started) { try { db.exec("ROLLBACK"); } catch { /* Keep the fixed public refusal. */ } }
      if (error instanceof RunClaimError) throw error;
      throw new RunClaimError("claims_unavailable");
    }
  }
  return Object.freeze({
    async assertAvailable() { guard(); },
    async issue(raw) {
      let input;
      try { input = runClaimIssueSchema.parse(raw); } catch { throw new RunClaimError("claim_unavailable"); }
      return transaction(now => {
        if (Date.parse(input.completedAt) > now || db.prepare("SELECT 1 FROM anonymous_run_claims WHERE run_id=? OR token_hash=?").get(input.runId, input.tokenHash))
          throw new RunClaimError("claim_unavailable");
        const fingerprint = original(db, input.runId, input.completedAt);
        const result = runClaimIssuanceSchema.parse({ version: 1, runId: input.runId, binding: input.binding,
          issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + RUN_CLAIM_TTL_MS).toISOString() });
        db.prepare("INSERT INTO anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(input.runId, input.binding.network, input.binding.origin, input.tokenHash, fingerprint, input.completedAt, now, now + RUN_CLAIM_TTL_MS);
        return result;
      });
    },
    async claim(raw) {
      let input;
      try { input = runClaimAttemptSchema.parse(raw); } catch { throw new RunClaimError("claim_unavailable"); }
      return transaction(now => {
        const session = db.prepare(`SELECT 1 FROM web_sessions WHERE hash=? AND wallet=?
          AND typeof(issued_at)='integer' AND typeof(expires_at)='integer' AND issued_at<=? AND expires_at>?`).get(input.sessionHash, input.wallet, now, now);
        if (!session) throw new RunClaimError("claim_unauthenticated");
        const row = db.prepare("SELECT * FROM anonymous_run_claims WHERE token_hash=? AND network=? AND origin=?")
          .get(input.tokenHash, input.binding.network, input.binding.origin);
        if (!row || row.claimed_wallet !== null || typeof row.issued_at !== "number" || typeof row.expires_at !== "number"
          || row.issued_at > now || row.expires_at <= now || typeof row.run_id !== "string" || typeof row.completed_at !== "string"
          || original(db, row.run_id, row.completed_at) !== row.original_sha256) throw new RunClaimError("claim_unavailable");
        const result = runClaimReceiptSchema.parse({ version: 1, runId: row.run_id, wallet: input.wallet, binding: input.binding, claimedAt: new Date(now).toISOString() });
        const updated = db.prepare("UPDATE anonymous_run_claims SET claimed_wallet=?,claimed_at=? WHERE run_id=? AND claimed_wallet IS NULL")
          .run(input.wallet, now, row.run_id);
        if (updated.changes !== 1) throw new RunClaimError("claim_unavailable");
        return result;
      });
    },
  } satisfies RunClaimsStore);
}
