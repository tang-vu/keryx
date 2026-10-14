import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { profileWallet } from "../profiles/private-profile";
import { ProfileIdentityError, identityChallengeSchema, identityProviderSchema, identityRecordSchema, identitySnapshotSchema,
  providerIdentitySchema, type IdentityChallenge, type ProfileIdentitiesStore } from "../profiles/verified-identities";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { PROFILE_IDENTITY_BASE_SCHEMA, PROFILE_IDENTITY_SCHEMA } from "./profile-identities-storage-domain";
import { sqliteApplicationSchemaProfile } from "./sqlite-application-schema-profile";
import { assertVerifiedSqliteConnection, assertVerifiedSqliteWritePolicy, assertVerifiedSqliteForeignKeys } from "./storage-identity-connection";
import { assertStorageFences, STORAGE_IDENTITY_TABLE, storageFenceStatements } from "./storage-identity-sqlite";

const unavailable = () => new ProfileIdentityError("identity_unavailable");
const nativeContention = (error: unknown) => error instanceof Error
  && "code" in error && error.code === "ERR_SQLITE_ERROR"
  && "errcode" in error && (error.errcode === 5 || error.errcode === 6);
const expiry = (challenge: IdentityChallenge) => Date.parse(challenge.expiresAt);
const expectedDomain = canonicalJson(PROFILE_IDENTITY_SCHEMA);
const expectedSessions = canonicalJson(PROFILE_IDENTITY_BASE_SCHEMA.filter(row => row.tbl_name === "web_sessions"));
const expectedProfile = canonicalJson(PROFILE_IDENTITY_BASE_SCHEMA.filter(row => row.tbl_name === "private_profiles"));

/** Same-store native composition ONLY. No configuration, DDL, seed, second DB,
 * ordinary guard bypass, fixture clock, provider calls or raw-native escape.
 * ROOT supplies the positive sealed FK declaration and final full-bundle profile. */
export function createEnrolledSqliteProfileIdentities(db: DatabaseSync): ProfileIdentitiesStore | undefined {
  if (arguments.length !== 1) throw unavailable();
  let revoked = false, verified = false;
  const revoke = () => {
    revoked = true;
    if (verified) try { db.close(); } catch { /* the original capability remains revoked */ }
    return unavailable();
  };
  try {
    const identity = assertVerifiedSqliteConnection(db);
    verified = true;
    // Metadata-only positive assertion, issued by trusted native opening after FK
    // configuration/verification and sealing. Never issue PRAGMA through this port.
    assertVerifiedSqliteForeignKeys(db);
    const schema = () => {
      if (revoked) throw unavailable();
      assertVerifiedSqliteConnection(db);
      assertVerifiedSqliteForeignKeys(db);
      assertStorageFences(db, identity);
      const fences = Object.keys(storageFenceStatements(db, identity));
      const profile = sqliteApplicationSchemaProfile(db, new Set([STORAGE_IDENTITY_TABLE,
        "storage_identity_no_update", "storage_identity_no_delete", "storage_identity_no_insert", ...fences]));
      if (!supportedSqliteApplicationProfiles(identity.authorityMode === "mainnet-real").includes(profile)) throw unavailable();
      const rows = db.prepare(`SELECT type,name,tbl_name,substr(sql,1,16385) AS sql FROM sqlite_schema
        WHERE tbl_name IN ('private_profiles','web_sessions','profile_verified_identities','profile_identity_challenges')
        AND name NOT IN (${fences.map(() => "?").join(",")}) ORDER BY type,name LIMIT 24`).all(...fences);
      const present = rows.some(row => row.tbl_name === "profile_verified_identities" || row.tbl_name === "profile_identity_challenges");
      if (present) {
        if (canonicalJson(rows) !== expectedDomain) throw unavailable();
      } else {
        if (canonicalJson(rows.filter(row => row.tbl_name === "web_sessions")) !== expectedSessions) throw unavailable();
        const profiles = rows.filter(row => row.tbl_name === "private_profiles");
        if (profiles.length && canonicalJson(profiles) !== expectedProfile) throw unavailable();
      }
      return { profile, present };
    };
    const admitted = schema();
    if (!admitted.present) return undefined;
    if (identity.authorityMode !== "mainnet-real") throw unavailable();
    const check = () => {
      try {
        const current = schema();
        if (!current.present || current.profile !== admitted.profile) throw unavailable();
      } catch { throw revoke(); }
    };
    const writeAccess = () => {
      if (revoked) throw unavailable();
      // Fixed WeakMap readonly refusal runs before ALL SQL and keeps readers usable.
      try { assertVerifiedSqliteWritePolicy(db); } catch { throw unavailable(); }
      // On writable ports, a WRITE-FIRST call must discover and latch drift too.
      check();
    };
    const transaction = <T>(write: boolean, work: (now: number) => T): T => {
      check();
      let open = false;
      try {
        db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN"); open = true;
        check();
        let now = 0;
        if (write) {
          const value = db.prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now").get()?.now;
          if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw unavailable();
          now = value;
        }
        const result = work(now);
        check(); db.exec("COMMIT"); open = false; check();
        return result;
      } catch (error) {
        if (open && !revoked) {
          try {
            db.exec("ROLLBACK"); open = false;
            if (db.isTransaction) throw unavailable();
            check();
          }
          catch { throw revoke(); }
          if (nativeContention(error)) throw unavailable();
          if (error instanceof ProfileIdentityError && error.code !== "identity_unavailable") throw error;
          if (error instanceof Error && "code" in error && error.code === "ERR_SQLITE_ERROR"
            && "errcode" in error && error.errcode === 2067
            && error.message.includes("UNIQUE constraint failed: profile_verified_identities.provider, profile_verified_identities.external_id"))
            throw new ProfileIdentityError("identity_conflict");
        } else if (!revoked && nativeContention(error)) {
          // A genuine busy/locked BEGIN owns no transaction. Refuse only this
          // request, after proving the borrowed connection and every guard intact.
          try { if (db.isTransaction) throw unavailable(); check(); }
          catch { throw revoke(); }
          throw unavailable();
        }
        throw revoke();
      }
    };
    const active = (challenge: IdentityChallenge, now: number) => {
      if (!db.prepare("SELECT 1 FROM private_profiles WHERE wallet=?").get(challenge.wallet)) throw new ProfileIdentityError("profile_required");
      const session = db.prepare(`SELECT 1 FROM web_sessions WHERE hash=? AND wallet=?
        AND typeof(issued_at)='integer' AND typeof(expires_at)='integer' AND issued_at<=? AND expires_at>? AND expires_at>=?`)
        .get(challenge.sessionHash, challenge.wallet, now, now, expiry(challenge));
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
        check(); const wallet = profileWallet(owner);
        return transaction(false, () => identitySnapshotSchema.parse({ wallet,
          identities: db.prepare(`SELECT provider,
            CASE WHEN length(CAST(external_id AS BLOB))<=128 THEN external_id ELSE NULL END AS external_id,
            CASE WHEN length(CAST(label AS BLOB))<=640 THEN label ELSE NULL END AS label,
            CASE WHEN length(CAST(verified_at AS BLOB))<=64 THEN verified_at ELSE NULL END AS verified_at
            FROM profile_verified_identities WHERE wallet=? AND external_id IS NOT NULL ORDER BY provider LIMIT 3`).all(wallet)
            .map(row => ({ wallet, provider: row.provider, externalId: row.external_id, label: row.label, verifiedAt: row.verified_at })) }));
      },
      async begin(raw) {
        writeAccess(); const challenge = identityChallengeSchema.parse(raw);
        transaction(true, now => {
          active(challenge, now);
          if (db.prepare("SELECT 1 FROM profile_identity_challenges WHERE state_hash=?").get(challenge.stateHash)) throw new ProfileIdentityError("identity_expired");
          // Retain one current nonce per wallet/provider and preserve prior verification.
          db.prepare("DELETE FROM profile_identity_challenges WHERE wallet=? AND provider=?").run(challenge.wallet, challenge.provider);
          db.prepare(`INSERT INTO profile_verified_identities(wallet,provider,current_state_hash) VALUES(?,?,?)
            ON CONFLICT(wallet,provider) DO UPDATE SET current_state_hash=excluded.current_state_hash`)
            .run(challenge.wallet, challenge.provider, challenge.stateHash);
          db.prepare(`INSERT INTO profile_identity_challenges(state_hash,wallet,provider,session_hash,expires_at,status)
            VALUES(?,?,?,?,?,'pending')`).run(challenge.stateHash, challenge.wallet, challenge.provider, challenge.sessionHash, expiry(challenge));
        });
      },
      async consume(raw) {
        writeAccess(); const challenge = identityChallengeSchema.parse(raw);
        transaction(true, now => {
          active(challenge, now); current(challenge, "pending");
          if (db.prepare("UPDATE profile_identity_challenges SET status='consumed' WHERE state_hash=? AND status='pending'")
            .run(challenge.stateHash).changes !== 1) throw new ProfileIdentityError("identity_expired");
        });
      },
      async complete(raw, rawIdentity) {
        writeAccess(); const challenge = identityChallengeSchema.parse(raw), identity = providerIdentitySchema.parse(rawIdentity);
        if (identity.provider !== challenge.provider) throw new ProfileIdentityError("identity_expired");
        return transaction(true, now => {
          active(challenge, now); current(challenge, "consumed");
          const result = identityRecordSchema.parse({ ...identity, wallet: challenge.wallet, verifiedAt: new Date(now).toISOString() });
          if (db.prepare(`UPDATE profile_verified_identities SET external_id=?,label=?,verified_at=?,current_state_hash=NULL
            WHERE wallet=? AND provider=? AND current_state_hash=?`)
            .run(identity.externalId, identity.label, result.verifiedAt, challenge.wallet, challenge.provider, challenge.stateHash).changes !== 1)
            throw new ProfileIdentityError("identity_expired");
          return result;
        });
      },
      async unlink(owner, rawProvider) {
        writeAccess(); const wallet = profileWallet(owner), provider = identityProviderSchema.parse(rawProvider);
        transaction(true, () => { db.prepare("DELETE FROM profile_verified_identities WHERE wallet=? AND provider=?").run(wallet, provider); });
      },
    } satisfies ProfileIdentitiesStore);
  } catch { throw revoke(); }
}
