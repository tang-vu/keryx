/** DATA ONLY for a separately reviewed ordinary migration/isolated fixture.
 * Nothing in the account factory executes this SQL or opens a database. */
const hash = (field: string) => `${field} TEXT NOT NULL CHECK(length(${field})=64 AND ${field} NOT GLOB '*[^a-f0-9]*')`;
const wallet = (field: string) => `${field} TEXT NOT NULL CHECK(length(${field})=42 AND substr(${field},1,2)='0x' AND ${field}=lower(${field}) AND substr(${field},3) NOT GLOB '*[^a-f0-9]*')`;
const account = "account_id TEXT NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) NOT GLOB '*[^a-f0-9]*')";
const time = (field: string) => `${field} INTEGER NOT NULL CHECK(typeof(${field})='integer' AND ${field} BETWEEN 0 AND 8639999999700000)`;
const nullableTime = (field: string) => `${field} INTEGER CHECK(${field} IS NULL OR (typeof(${field})='integer' AND ${field} BETWEEN 0 AND 8639999999700000))`;
const revision = "revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991)";
const tables = [
  { name: "account267_accounts", columns: [account, revision, time("created_at"), "PRIMARY KEY(account_id)"], auto: 1 },
  { name: "account267_members", columns: [wallet("wallet"), account, hash("generation"), hash("consent_hash"), time("linked_at"), "PRIMARY KEY(wallet)", "UNIQUE(generation)"], auto: 2 },
  { name: "account267_credentials", columns: [wallet("wallet"), account, hash("member_generation"), hash("generation"), time("login_after"),
    "active INTEGER NOT NULL CHECK(active IN (0,1))", "PRIMARY KEY(wallet)", "UNIQUE(generation)"], auto: 2 },
  { name: "account267_sessions", columns: [hash("session_hash"), wallet("wallet"), account, hash("member_generation"), hash("credential_generation"),
    time("issued_at"), time("expires_at"), "origin TEXT NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048)", "network TEXT NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002'))",
    "history_consent INTEGER NOT NULL CHECK(history_consent=1)", nullableTime("revoked_at"),
    "CHECK(expires_at>issued_at AND expires_at<=issued_at+604800000)", "PRIMARY KEY(session_hash)"], auto: 1 },
  { name: "account267_challenges", columns: [hash("nonce_hash"), hash("session_hash"),
    "payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=8192 AND json_valid(payload) AND json_type(payload)='object')",
    time("expires_at"), nullableTime("consumed_at"), "lease_hash TEXT CHECK(lease_hash IS NULL OR (length(lease_hash)=64 AND lease_hash NOT GLOB '*[^a-f0-9]*'))",
    nullableTime("completed_at"), "CHECK((consumed_at IS NULL)=(lease_hash IS NULL))", "CHECK(completed_at IS NULL OR consumed_at IS NOT NULL)", "PRIMARY KEY(nonce_hash)"], auto: 1 },
  { name: "account267_events", columns: [hash("id"), account, revision, "purpose TEXT NOT NULL CHECK(purpose IN ('create-private-account','link-wallet','unlink-wallet'))",
    hash("lineage_hash"), hash("consent_hash"), hash("proof_hash"), time("created_at"), "PRIMARY KEY(id)"], auto: 1 },
];
export const ACCOUNT_MEMBERSHIP_SCHEMA_DATA = tables.flatMap(t => [
  { type: "table", name: t.name, table: t.name, sql: `CREATE TABLE ${t.name} (\n  ${t.columns.join(",\n  ")}\n)` as string | null },
  ...Array.from({ length: t.auto }, (_, i) => ({ type: "index", name: `sqlite_autoindex_${t.name}_${i + 1}`, table: t.name, sql: null as string | null })),
]).concat([
  { type: "index", name: "account267_members_account", table: "account267_members", sql: "CREATE INDEX account267_members_account ON account267_members(account_id,wallet)" },
  { type: "index", name: "account267_credentials_account", table: "account267_credentials", sql: "CREATE INDEX account267_credentials_account ON account267_credentials(account_id,wallet)" },
  { type: "index", name: "account267_sessions_account", table: "account267_sessions", sql: "CREATE INDEX account267_sessions_account ON account267_sessions(account_id,wallet,revoked_at,expires_at,session_hash)" },
  { type: "index", name: "account267_sessions_live", table: "account267_sessions", sql: "CREATE INDEX account267_sessions_live ON account267_sessions(account_id,revoked_at,expires_at,session_hash)" },
  { type: "index", name: "account267_challenges_session", table: "account267_challenges", sql: "CREATE INDEX account267_challenges_session ON account267_challenges(session_hash,consumed_at,expires_at)" },
  { type: "index", name: "account267_challenges_account", table: "account267_challenges", sql: "CREATE INDEX account267_challenges_account ON account267_challenges(json_extract(payload,'$.accountId'),consumed_at,nonce_hash)" },
  { type: "index", name: "account267_events_account", table: "account267_events", sql: "CREATE INDEX account267_events_account ON account267_events(account_id,revision)" },
  { type: "trigger", name: "account267_revision_monotonic", table: "account267_accounts", sql: `CREATE TRIGGER account267_revision_monotonic BEFORE UPDATE ON account267_accounts
    WHEN NEW.account_id IS NOT OLD.account_id OR NEW.created_at IS NOT OLD.created_at OR NEW.revision != OLD.revision+1
    BEGIN SELECT RAISE(ABORT,'account_unavailable'); END` },
  { type: "trigger", name: "account267_challenge_immutable", table: "account267_challenges", sql: `CREATE TRIGGER account267_challenge_immutable BEFORE UPDATE ON account267_challenges
    WHEN NEW.nonce_hash IS NOT OLD.nonce_hash OR NEW.session_hash IS NOT OLD.session_hash OR NEW.payload IS NOT OLD.payload OR NEW.expires_at IS NOT OLD.expires_at
      OR (OLD.consumed_at IS NOT NULL AND (NEW.consumed_at IS NOT OLD.consumed_at OR NEW.lease_hash IS NOT OLD.lease_hash))
      OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS NOT OLD.completed_at)
    BEGIN SELECT RAISE(ABORT,'account_unavailable'); END` },
  { type: "trigger", name: "account267_session_immutable", table: "account267_sessions", sql: `CREATE TRIGGER account267_session_immutable BEFORE UPDATE ON account267_sessions
    WHEN NEW.session_hash IS NOT OLD.session_hash OR NEW.wallet IS NOT OLD.wallet OR NEW.account_id IS NOT OLD.account_id
      OR NEW.member_generation IS NOT OLD.member_generation OR NEW.credential_generation IS NOT OLD.credential_generation
      OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.origin IS NOT OLD.origin
      OR NEW.network IS NOT OLD.network OR NEW.history_consent IS NOT OLD.history_consent
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
    BEGIN SELECT RAISE(ABORT,'account_unavailable'); END` },
]);
export const ACCOUNT_MEMBERSHIP_SQL_DATA = ACCOUNT_MEMBERSHIP_SCHEMA_DATA.filter(s => s.sql !== null).map(s => `${s.sql};`).join("\n");

/** Exact existing ordinary durable web-session domain; independent of account SQL. */
export const ACCOUNT_WEB_SESSION_SCHEMA_DATA = [
  { type: "table", name: "web_sessions", table: "web_sessions", sql: `CREATE TABLE web_sessions (
  hash TEXT PRIMARY KEY CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  wallet TEXT NOT NULL CHECK(length(wallet) = 42 AND substr(wallet,1,2) = '0x' AND substr(wallet,3) NOT GLOB '*[^a-f0-9]*'),
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > issued_at AND expires_at <= issued_at + 604800000)
)` },
  { type: "index", name: "sqlite_autoindex_web_sessions_1", table: "web_sessions", sql: null },
  { type: "index", name: "web_sessions_expiry", table: "web_sessions", sql: "CREATE INDEX web_sessions_expiry ON web_sessions(expires_at)" },
  { type: "index", name: "web_sessions_wallet", table: "web_sessions", sql: "CREATE INDEX web_sessions_wallet ON web_sessions(wallet, expires_at)" },
];
