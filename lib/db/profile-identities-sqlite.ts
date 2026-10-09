import { DatabaseSync } from "node:sqlite";
import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { assertOrdinarySqliteResearchAuthority } from "./research-monthly";
import { profileWallet } from "../profiles/private-profile";
import { ProfileIdentityError, identityChallengeSchema, identityProviderSchema, identityRecordSchema, identitySnapshotSchema,
  providerIdentitySchema, type IdentityChallenge, type ProfileIdentitiesStore } from "../profiles/verified-identities";

export const PROFILE_IDENTITIES_SQL = `CREATE TABLE IF NOT EXISTS profile_verified_identities (
  wallet TEXT NOT NULL REFERENCES private_profiles(wallet) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('orcid','github')),
  external_id TEXT, label TEXT, verified_at TEXT,
  current_state_hash TEXT CHECK(current_state_hash IS NULL OR (length(current_state_hash)=64 AND current_state_hash NOT GLOB '*[^0-9a-f]*')),
  PRIMARY KEY(wallet,provider), UNIQUE(provider,external_id),
  CHECK((external_id IS NULL AND label IS NULL AND verified_at IS NULL) OR
    (external_id IS NOT NULL AND length(external_id) BETWEEN 1 AND 32 AND label IS NOT NULL AND length(label)<=160 AND verified_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS profile_identity_challenges (
  state_hash TEXT PRIMARY KEY CHECK(length(state_hash)=64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  wallet TEXT NOT NULL, provider TEXT NOT NULL,
  session_hash TEXT NOT NULL CHECK(length(session_hash)=64 AND session_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at INTEGER NOT NULL CHECK(expires_at>=0),
  status TEXT NOT NULL CHECK(status IN ('pending','consumed')),
  UNIQUE(wallet,provider),
  FOREIGN KEY(wallet,provider) REFERENCES profile_verified_identities(wallet,provider) ON DELETE CASCADE
);`;

// Exact ordinary session domain, including its indices. No optional domain may substitute sessions.
const SESSION_SQL = `CREATE TABLE IF NOT EXISTS web_sessions (
  hash TEXT PRIMARY KEY CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  wallet TEXT NOT NULL CHECK(length(wallet) = 42 AND substr(wallet,1,2) = '0x' AND substr(wallet,3) NOT GLOB '*[^a-f0-9]*'),
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > issued_at AND expires_at <= issued_at + 604800000)
);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS web_sessions_wallet ON web_sessions(wallet, expires_at);`;
const shape = (db: DatabaseSync, identityOnly = false) => db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql
  FROM sqlite_schema WHERE tbl_name IN (${identityOnly ? "'profile_verified_identities','profile_identity_challenges'"
    : "'private_profiles','web_sessions','profile_verified_identities','profile_identity_challenges'"}) ORDER BY type,name LIMIT 24`).all();
let expectedShape: string | undefined, expectedBaseShape: string | undefined;
function referenceShapes() {
  if (expectedShape) return;
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec(PRIVATE_PROFILES_SQL + SESSION_SQL);
    expectedBaseShape = JSON.stringify(shape(reference));
    reference.exec(PROFILE_IDENTITIES_SQL); expectedShape = JSON.stringify(shape(reference));
  } finally { reference.close(); }
}
function ordinary(db: DatabaseSync) {
  try { assertOrdinarySqliteResearchAuthority(db); }
  catch { throw new ProfileIdentityError("identity_unavailable"); }
  if (db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1) throw new ProfileIdentityError("identity_unavailable");
}
function assertShape(db: DatabaseSync, installing = false) {
  ordinary(db); referenceShapes();
  const actual = JSON.stringify(shape(db));
  if (actual !== expectedShape && !(installing && !shape(db, true).length && actual === expectedBaseShape))
    throw new ProfileIdentityError("identity_unavailable");
}
const expiry = (challenge: IdentityChallenge) => Date.parse(challenge.expiresAt);

/** Ordinary, already-admitted private profiles only. No sealed installer/profile is changed.
 * A fixture clock supplies a SQL function solely for deterministic temporary-store acceptance. */
export function createSqliteProfileIdentities(db: DatabaseSync, options: { fixtureClock?: () => number } = {}): ProfileIdentitiesStore {
  ordinary(db); db.exec("BEGIN IMMEDIATE");
  try { assertShape(db, true); db.exec(PROFILE_IDENTITIES_SQL); assertShape(db); db.exec("COMMIT"); }
  catch (error) { db.exec("ROLLBACK"); throw error; }
  if (options.fixtureClock) db.function("keryx_profile_identity_fixture_clock", options.fixtureClock);
  const nowSql = options.fixtureClock ? "keryx_profile_identity_fixture_clock()" : "CAST(unixepoch('subsec')*1000 AS INTEGER)";
  const transaction = <T>(work: (now: number) => T): T => {
    ordinary(db); db.exec("BEGIN IMMEDIATE");
    try {
      assertShape(db);
      const now = db.prepare(`SELECT ${nowSql} AS now`).get()?.now;
      if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) throw new ProfileIdentityError("identity_unavailable");
      const result = work(now); db.exec("COMMIT"); return result;
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof ProfileIdentityError) throw error;
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed: profile_verified_identities.provider, profile_verified_identities.external_id"))
        throw new ProfileIdentityError("identity_conflict");
      throw new ProfileIdentityError("identity_unavailable");
    }
  };
  const active = (challenge: IdentityChallenge, now: number) => {
    if (!db.prepare("SELECT 1 FROM private_profiles WHERE wallet=?").get(challenge.wallet)) throw new ProfileIdentityError("profile_required");
    const session = db.prepare(`SELECT 1 FROM web_sessions WHERE hash=? AND wallet=? AND typeof(issued_at)='integer' AND typeof(expires_at)='integer' AND issued_at<=? AND expires_at>?
      AND expires_at>=?`).get(challenge.sessionHash, challenge.wallet, now, now, expiry(challenge));
    if (!session || expiry(challenge) <= now) throw new ProfileIdentityError("identity_expired");
  };
  const current = (challenge: IdentityChallenge, status: "pending" | "consumed") => {
    if (!db.prepare(`SELECT 1 FROM profile_identity_challenges c JOIN profile_verified_identities l
      ON l.wallet=c.wallet AND l.provider=c.provider AND l.current_state_hash=c.state_hash
      WHERE c.state_hash=? AND c.wallet=? AND c.provider=? AND c.session_hash=? AND c.expires_at=? AND c.status=?`)
      .get(challenge.stateHash, challenge.wallet, challenge.provider, challenge.sessionHash, expiry(challenge), status))
      throw new ProfileIdentityError("identity_expired");
  };
  return Object.freeze({
    async list(owner) {
      const wallet = profileWallet(owner);
      return transaction(() => identitySnapshotSchema.parse({ wallet, identities: db.prepare(`SELECT provider,external_id,label,verified_at
        FROM profile_verified_identities WHERE wallet=? AND external_id IS NOT NULL ORDER BY provider`).all(wallet)
        .map(row => ({ wallet, provider: row.provider, externalId: row.external_id, label: row.label, verifiedAt: row.verified_at })) }));
    },
    async begin(raw) {
      const challenge = identityChallengeSchema.parse(raw);
      transaction(now => {
        active(challenge, now);
        if (db.prepare("SELECT 1 FROM profile_identity_challenges WHERE state_hash=?").get(challenge.stateHash)) throw new ProfileIdentityError("identity_expired");
        // Fresh cryptographic state is caller-owned. Retain only the current lineage, never an unbounded nonce history.
        db.prepare("DELETE FROM profile_identity_challenges WHERE wallet=? AND provider=?").run(challenge.wallet, challenge.provider);
        db.prepare(`INSERT INTO profile_verified_identities(wallet,provider,current_state_hash) VALUES(?,?,?)
          ON CONFLICT(wallet,provider) DO UPDATE SET current_state_hash=excluded.current_state_hash`)
          .run(challenge.wallet, challenge.provider, challenge.stateHash);
        db.prepare(`INSERT INTO profile_identity_challenges(state_hash,wallet,provider,session_hash,expires_at,status) VALUES(?,?,?,?,?,'pending')`)
          .run(challenge.stateHash, challenge.wallet, challenge.provider, challenge.sessionHash, expiry(challenge));
      });
    },
    async consume(raw) {
      const challenge = identityChallengeSchema.parse(raw);
      transaction(now => { active(challenge, now); current(challenge, "pending");
        db.prepare("UPDATE profile_identity_challenges SET status='consumed' WHERE state_hash=?").run(challenge.stateHash); });
    },
    async complete(raw, rawIdentity) {
      const challenge = identityChallengeSchema.parse(raw), identity = providerIdentitySchema.parse(rawIdentity);
      if (identity.provider !== challenge.provider) throw new ProfileIdentityError("identity_expired");
      return transaction(now => {
        active(challenge, now); current(challenge, "consumed");
        const result = identityRecordSchema.parse({ ...identity, wallet: challenge.wallet, verifiedAt: new Date(now).toISOString() });
        db.prepare(`UPDATE profile_verified_identities SET external_id=?,label=?,verified_at=?,current_state_hash=NULL
          WHERE wallet=? AND provider=? AND current_state_hash=?`).run(identity.externalId, identity.label, result.verifiedAt,
            challenge.wallet, challenge.provider, challenge.stateHash);
        return result;
      });
    },
    async unlink(owner, rawProvider) {
      const wallet = profileWallet(owner), provider = identityProviderSchema.parse(rawProvider);
      transaction(() => { db.prepare("DELETE FROM profile_verified_identities WHERE wallet=? AND provider=?").run(wallet, provider); });
    },
  } satisfies ProfileIdentitiesStore);
}
