import { PRIVATE_PROFILES_SQL } from "./private-profiles-sqlite";
import { PROFILE_IDENTITIES_SQL } from "./profile-identities-sqlite";

// Declaration for ROOT's single whole-bundle migration, never a domain installer.
// These existing tables must remain byte-for-byte schema compatible; do not recreate them.
export const PROFILE_IDENTITY_WEB_SESSIONS_SQL = `CREATE TABLE IF NOT EXISTS web_sessions (
  hash TEXT PRIMARY KEY CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  wallet TEXT NOT NULL CHECK(length(wallet) = 42 AND substr(wallet,1,2) = '0x' AND substr(wallet,3) NOT GLOB '*[^a-f0-9]*'),
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > issued_at AND expires_at <= issued_at + 604800000)
);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS web_sessions_wallet ON web_sessions(wallet, expires_at);`;

export const PROFILE_IDENTITIES_STORAGE_DOMAIN = Object.freeze({
  tables: Object.freeze(["profile_verified_identities", "profile_identity_challenges"] as const),
  sql: PROFILE_IDENTITIES_SQL,
  requiredBase: Object.freeze({ private_profiles: PRIVATE_PROFILES_SQL, web_sessions: PROFILE_IDENTITY_WEB_SESSIONS_SQL }),
  // The existing identity-digest writer fence, for EVERY operation on BOTH new tables.
  fenceOperations: Object.freeze(["INSERT", "UPDATE", "DELETE"] as const),
  foreignKeys: Object.freeze([
    "profile_verified_identities.wallet -> private_profiles.wallet ON DELETE CASCADE",
    "profile_identity_challenges.(wallet,provider) -> profile_verified_identities.(wallet,provider) ON DELETE CASCADE",
  ] as const),
  seed: null,
});

export { PROFILE_IDENTITIES_SQL };

// SQLite stores CREATE statements without IF NOT EXISTS or their final semicolon.
// Declarative expected rows avoid a constructor-created reference DB or any target DDL.
const storedSql = (sql: string) => sql.replace(/ IF NOT EXISTS/g, "").trim().replace(/;$/, "");
const statements = (sql: string) => sql.split(/;\s*(?=CREATE|$)/).map(storedSql).filter(Boolean);
const privateTable = statements(PRIVATE_PROFILES_SQL)[0];
const [sessionsTable, sessionsExpiry, sessionsWallet] = statements(PROFILE_IDENTITY_WEB_SESSIONS_SQL);
const [identitiesTable, challengesTable] = statements(PROFILE_IDENTITIES_SQL);
const table = (name: string, sql: string) => Object.freeze({ type: "table", name, tbl_name: name, sql });
const index = (name: string, owner: string, sql: string | null = null) => Object.freeze({ type: "index", name, tbl_name: owner, sql });
const sorted = (rows: ReturnType<typeof table | typeof index>[]) => Object.freeze(rows.sort((a, b) =>
  a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

export const PROFILE_IDENTITY_BASE_SCHEMA = sorted([
  table("private_profiles", privateTable), index("sqlite_autoindex_private_profiles_1", "private_profiles"),
  index("sqlite_autoindex_private_profiles_2", "private_profiles"),
  table("web_sessions", sessionsTable), index("sqlite_autoindex_web_sessions_1", "web_sessions"),
  index("web_sessions_expiry", "web_sessions", sessionsExpiry), index("web_sessions_wallet", "web_sessions", sessionsWallet),
]);
export const PROFILE_IDENTITY_SCHEMA = sorted([
  ...PROFILE_IDENTITY_BASE_SCHEMA,
  table("profile_verified_identities", identitiesTable),
  index("sqlite_autoindex_profile_verified_identities_1", "profile_verified_identities"),
  index("sqlite_autoindex_profile_verified_identities_2", "profile_verified_identities"),
  table("profile_identity_challenges", challengesTable),
  index("sqlite_autoindex_profile_identity_challenges_1", "profile_identity_challenges"),
  index("sqlite_autoindex_profile_identity_challenges_2", "profile_identity_challenges"),
]);
