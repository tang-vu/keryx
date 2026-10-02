import { backfillSqliteSeedProvenance } from "../sources/seed-provenance";
import { DatabaseSync } from "node:sqlite";
import { PRIVATE_CREATOR_CONFIRMATIONS_SQL } from "./private-creator-confirmations";
import { PRIVATE_CREATOR_SUBMISSIONS_SQL } from "./private-creator-submissions";
import { PRIVATE_RESEARCH_RESULTS_SQL } from "./private-research-results";
import { PRIVATE_TREASURY_CAPACITY_SQL } from "./private-treasury-capacity";
import { PRIVATE_RESEARCH_EXECUTIONS_SQL } from "./private-research-executions";
import { initializeSqliteBrowserJournal } from "./sqlite-browser-journal";
import { initializeSqliteBrowserSigningOriginals } from "./sqlite-browser-signing-originals";
import { initializeSqliteBrowserSourceContext } from "./sqlite-browser-source-context";
import { CREATOR_WITHDRAWAL_REQUESTS_SQL } from "./creator-withdrawal-requests";
import { CREATOR_WITHDRAWAL_ATTESTATIONS_SQL } from "./creator-withdrawal-attestations";
import { PRIVATE_TREASURY_RELEASE_SQL } from "./private-treasury-release";
import { PRIVATE_RESEARCH_INTERRUPTION_SQL } from "./private-research-interruptions";
import { PRIVATE_RESEARCH_PAYMENTS_SQL } from "./private-research-payments";
import { PRIVATE_RESEARCH_INTENTS_SQL } from "./private-research-intents";
import { assertOrdinarySqliteResearchAuthority, initializeSqliteResearchMonthly } from "./research-monthly";

export const SQLITE_APPLICATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, name TEXT, url TEXT, description TEXT, rss_url TEXT,
  wallet_address TEXT, fetch_price REAL, tags TEXT, authors TEXT, created_at TEXT,
  ipfs_cid TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  onchain_id TEXT,
  register_tx TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  preview_depth TEXT,
  evidence_provenance TEXT CHECK(evidence_provenance IS NULL OR evidence_provenance='synthetic-demo')
);
CREATE TABLE IF NOT EXISTS source_meta (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  rss_url TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS source_notify (
  source_id  TEXT PRIMARY KEY,
  notify_url TEXT NOT NULL,
  secret     TEXT NOT NULL,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS source_notify_email (
  source_id    TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  unsub_token  TEXT NOT NULL,
  last_sent_at TEXT,
  updated_at   TEXT
);
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS public_references (
  id TEXT PRIMARY KEY, active INTEGER NOT NULL, rss_url TEXT NOT NULL, snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY, source_id TEXT, title TEXT, summary TEXT, content TEXT,
  link TEXT, published_at TEXT,
  ipfs_cid TEXT, item_key_enc TEXT, item_iv TEXT, item_auth_tag TEXT, item_wrap_iv TEXT,
  delivery_kind TEXT, storage_mode TEXT, plaintext_bytes INTEGER, body_hash TEXT,
  manifest_id TEXT, manifest_signer TEXT, manifest_nonce TEXT, manifest_signature TEXT,
  manifest_created_at TEXT,
  evidence_provenance TEXT CHECK(evidence_provenance IS NULL OR evidence_provenance='synthetic-demo')
);
-- Every read of this table is "one source, newest first" — discovery, the freshness counts, and the
-- ingest dedupe pass. Safe to declare beside the table: both columns are original, so this is not a
-- no-op-plus-failure on a database that predates a later ALTER (cf. query_runs).
CREATE INDEX IF NOT EXISTS source_items_source_published ON source_items(source_id, published_at);
CREATE TABLE IF NOT EXISTS article_offers (
  source_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  content_version TEXT NOT NULL,
  price_usdc6 INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  signer TEXT NOT NULL,
  nonce TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, item_id)
);
CREATE INDEX IF NOT EXISTS article_offers_expires ON article_offers(expires_at);
CREATE TABLE IF NOT EXISTS gap_intents (
  id TEXT PRIMARY KEY,
  gap_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  question TEXT NOT NULL,
  failed_query_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_item_link TEXT NOT NULL DEFAULT '',
  item_id TEXT,
  content_version TEXT,
  article_offer_id TEXT,
  owner_wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER,
  retry_run_id TEXT,
  coverage REAL,
  reward_usdc REAL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS gap_intents_offer
  ON gap_intents(gap_id, source_id, source_item_link);
CREATE INDEX IF NOT EXISTS gap_intents_queue
  ON gap_intents(status, created_at);
CREATE TABLE IF NOT EXISTS cache_items (
  source_id TEXT PRIMARY KEY, text TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY, created_at TEXT, kind TEXT, query_id TEXT, source_id TEXT,
  source_name TEXT, payer TEXT, payee TEXT, amount_usdc REAL, weight REAL,
  rationale TEXT, tx_hash TEXT, network TEXT, settled INTEGER,
  settlement_status TEXT NOT NULL DEFAULT 'simulated', authorization_id TEXT,
  authorization_expires_at TEXT, grant_epoch TEXT,
  item_id TEXT, item_title TEXT, item_url TEXT, content_version TEXT, item_published_at TEXT,
  offer_id TEXT, list_price_usdc REAL
);
CREATE TABLE IF NOT EXISTS browser_authorization_intents (
  nonce TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  grant_epoch TEXT NOT NULL,
  signer TEXT NOT NULL,
  network TEXT NOT NULL,
  token TEXT NOT NULL,
  gateway_contract TEXT NOT NULL,
  source_id TEXT NOT NULL,
  offer_id TEXT,
  kind TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount_micro_usdc INTEGER NOT NULL CHECK(amount_micro_usdc > 0),
  phase TEXT NOT NULL DEFAULT 'prepared' CHECK(phase = 'prepared'),
  created_at TEXT NOT NULL,
  UNIQUE(session_id, request_id)
);
CREATE TRIGGER IF NOT EXISTS browser_intents_immutable_update
  BEFORE UPDATE ON browser_authorization_intents
  BEGIN SELECT RAISE(ABORT, 'browser authorization intent is immutable'); END;
CREATE TRIGGER IF NOT EXISTS browser_intents_immutable_delete
  BEFORE DELETE ON browser_authorization_intents
  BEGIN SELECT RAISE(ABORT, 'browser authorization intent is immutable'); END;
CREATE TABLE IF NOT EXISTS query_runs (
  id TEXT PRIMARY KEY, created_at TEXT, question TEXT, budget REAL, engine TEXT,
  total_spent REAL, total_to_creators REAL, answer TEXT, data TEXT,
  parent_id TEXT,                       -- the dispatch this one follows up on
  asker TEXT,                           -- lowercased wallet that dispatched it (SIWE-verified)
  origin TEXT,                          -- engine | web | a2a | mcp
  mcp_client TEXT,                      -- self-declared setup channel; telemetry only
  duration_ms INTEGER,
  payment_mode TEXT,
  payment_attempts INTEGER,
  settled_payments INTEGER,
  confidence_level TEXT,
  evidence_claim_count INTEGER,
  grounded_claim_count INTEGER,
  rewarded_citation_count INTEGER,
  economics_data TEXT
);
CREATE TABLE IF NOT EXISTS a2a_orders (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL UNIQUE,
  authorization_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  payer TEXT NOT NULL,
  payee TEXT NOT NULL,
  amount_usdc REAL NOT NULL,
  creator_budget_usdc REAL NOT NULL,
  service_fee_usdc REAL NOT NULL,
  research_mode TEXT NOT NULL,
  package_data TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  transaction_id TEXT NOT NULL,
  request_data TEXT,
  started_at TEXT,
  worker_id TEXT,
  execution_journal_version INTEGER,
  payment_started_at TEXT,
  result_saving_at TEXT,
  response_data TEXT,
  error_code TEXT,
  resolution_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS a2a_orders_payer_history ON a2a_orders(LOWER(payer), created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS activation_events (
  day TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN (
    'reader_landing','reader_ask_started','reader_answer_completed',
    'reader_wallet_connected','reader_session_funded','reader_returning_dispatch',
    'creator_registration_started','creator_verification_completed',
    'creator_citation_settled','creator_withdrawal_completed'
  )),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, event)
);
CREATE INDEX IF NOT EXISTS activation_events_day ON activation_events(day);
-- No index on parent_id here: CREATE TABLE IF NOT EXISTS is a no-op against a database that
-- predates the column, so an index naming it would fail at boot on exactly the databases that
-- carry the real traction. ensureColumns() adds the column first, then the index.
CREATE TABLE IF NOT EXISTS withdrawals (
  tx_hash TEXT PRIMARY KEY, created_at TEXT, label TEXT, source_name TEXT,
  wallet TEXT, recipient TEXT, amount_usdc REAL, network TEXT
);
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  prefix      TEXT NOT NULL UNIQUE,
  key_hash    TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at  TEXT,
  scopes      TEXT,
  source_ids  TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS api_keys_wallet ON api_keys(wallet);
CREATE TABLE IF NOT EXISTS api_key_usage (
  key_id     TEXT NOT NULL,
  day        TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, day)
);
CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY,   -- lowercased; identity = wallet
  role           TEXT NOT NULL,      -- role snapshot at last sign-in (display only)
  display_handle TEXT NOT NULL,      -- compact "0x….." handle
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS answer_feedback (
  id         TEXT PRIMARY KEY,
  query_id   TEXT NOT NULL,
  rating     TEXT NOT NULL,          -- 'up' or 'down'
  comment    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS answer_feedback_query ON answer_feedback(query_id);
CREATE TABLE IF NOT EXISTS query_memories (
  id            TEXT PRIMARY KEY,
  source_scores TEXT NOT NULL,          -- JSON: { sourceId: { name, weight, reward } } — cited only
  sources_read  TEXT,                   -- JSON: string[] — every source the run read, cited or not
  topics        TEXT NOT NULL,          -- JSON: string[]
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_grants (
  session_id TEXT PRIMARY KEY,          -- lowercased SIWE address; one active grant per wallet
  sess_addr  TEXT NOT NULL,             -- session EOA (public address only — never its key)
  owner_addr TEXT NOT NULL,
  cap        REAL NOT NULL,             -- USDC ceiling, clamped to the real Gateway balance
  spent      REAL NOT NULL DEFAULT 0,
  expiry     INTEGER NOT NULL,          -- unix ms
  tx_hash    TEXT NOT NULL,
  grant_epoch TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_grants_expiry ON session_grants(expiry);
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket   TEXT PRIMARY KEY,           -- "<tier>:<key>", e.g. "treasuryAsk:1.2.3.4"
  count    INTEGER NOT NULL,           -- points spent in the current window
  reset_at INTEGER NOT NULL            -- unix ms the window closes
);
CREATE INDEX IF NOT EXISTS rate_limit_counters_reset ON rate_limit_counters(reset_at);
CREATE TABLE IF NOT EXISTS reasoning_circuits (
  key         TEXT PRIMARY KEY,
  failures    INTEGER NOT NULL,
  open_until  INTEGER NOT NULL,
  probe_until INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  hash TEXT PRIMARY KEY CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > issued_at AND expires_at <= issued_at + 300000)
);
CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS web_sessions (
  hash TEXT PRIMARY KEY CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  wallet TEXT NOT NULL CHECK(length(wallet) = 42 AND substr(wallet,1,2) = '0x' AND substr(wallet,3) NOT GLOB '*[^a-f0-9]*'),
  issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > issued_at AND expires_at <= issued_at + 604800000)
);
CREATE INDEX IF NOT EXISTS web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS web_sessions_wallet ON web_sessions(wallet, expires_at);
${PRIVATE_RESEARCH_INTENTS_SQL}
${PRIVATE_TREASURY_CAPACITY_SQL}
${PRIVATE_RESEARCH_PAYMENTS_SQL}
${PRIVATE_RESEARCH_EXECUTIONS_SQL}
${PRIVATE_RESEARCH_RESULTS_SQL}
${PRIVATE_CREATOR_SUBMISSIONS_SQL}
${PRIVATE_CREATOR_CONFIRMATIONS_SQL}
${PRIVATE_TREASURY_RELEASE_SQL}
${PRIVATE_RESEARCH_INTERRUPTION_SQL}
${CREATOR_WITHDRAWAL_REQUESTS_SQL}
${CREATOR_WITHDRAWAL_ATTESTATIONS_SQL}
`;

/** Legacy installer only; enrolled runtime validates without migrating. */
export function installSqliteApplicationSchema(db: DatabaseSync): void {
 db.exec(SQLITE_APPLICATION_SCHEMA);
 ensureSqliteApplicationColumns(db);
}

/** Deployed TypeScript authority. Monthly has no enrolled/native domain cutover. */
export function installOrdinarySqliteApplicationSchema(db: DatabaseSync): void {
  assertOrdinarySqliteResearchAuthority(db);
  installSqliteApplicationSchema(db);
  initializeSqliteResearchMonthly(db);
}

function ensureSqliteApplicationColumns(db: DatabaseSync): void {
    // sources table backfill
    const srcCols = new Set(
      (db.prepare(`PRAGMA table_info(sources)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!srcCols.has("ipfs_cid")) db.exec(`ALTER TABLE sources ADD COLUMN ipfs_cid TEXT`);
    if (!srcCols.has("active"))
      db.exec(`ALTER TABLE sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
    // On-chain provenance columns: filled when a curated source is registered on SourceRegistry.
    if (!srcCols.has("onchain_id")) db.exec(`ALTER TABLE sources ADD COLUMN onchain_id TEXT`);
    if (!srcCols.has("register_tx")) db.exec(`ALTER TABLE sources ADD COLUMN register_tx TEXT`);
    // Feed-ownership gate. DEFAULT 1 grandfathers every pre-existing row (operator-curated seed +
    // the live VPS traction rows) as verified. Only public web
    // submissions registered after this column exists start unverified (set explicitly to 0).
    if (!srcCols.has("verified"))
      db.exec(`ALTER TABLE sources ADD COLUMN verified INTEGER NOT NULL DEFAULT 1`);
    // Preview depth: NULL grandfathers every existing row as "full" (rowToSource maps it).
    if (!srcCols.has("evidence_provenance")) db.exec(`ALTER TABLE sources ADD COLUMN evidence_provenance TEXT CHECK(evidence_provenance IS NULL OR evidence_provenance='synthetic-demo')`);
    if (!srcCols.has("preview_depth")) db.exec(`ALTER TABLE sources ADD COLUMN preview_depth TEXT`);

    // source_meta.rss_url: the feed an on-chain registrant listed. The indexer has nowhere else to
    // learn it, and /api/sources/verify needs it to check the right document for the ownership token.
    const metaCols = new Set(
      (db.prepare(`PRAGMA table_info(source_meta)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!metaCols.has("rss_url")) db.exec(`ALTER TABLE source_meta ADD COLUMN rss_url TEXT`);

    // Explicit payment state: historical settled rows had Circle evidence; historical false rows
    // were offline simulations. New browser co-sign ambiguity is always written as `pending`.
    const paymentCols = new Set(
      (db.prepare(`PRAGMA table_info(payment_events)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!paymentCols.has("origin")) {
      db.exec(`ALTER TABLE payment_events ADD COLUMN origin TEXT`);
      db.exec(`UPDATE payment_events SET origin='engine' WHERE origin IS NULL`);
    }
    if (!paymentCols.has("settlement_status")) {
      db.exec(
        `ALTER TABLE payment_events ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'simulated'`,
      );
      db.exec(
        `UPDATE payment_events SET settlement_status=CASE WHEN settled=1 THEN 'settled' ELSE 'simulated' END`,
      );
    }
    if (!paymentCols.has("authorization_id")) {
      db.exec(`ALTER TABLE payment_events ADD COLUMN authorization_id TEXT`);
    }
    if (!paymentCols.has("authorization_expires_at")) {
      db.exec(`ALTER TABLE payment_events ADD COLUMN authorization_expires_at TEXT`);
    }
    if (!paymentCols.has("grant_epoch")) {
      db.exec(`ALTER TABLE payment_events ADD COLUMN grant_epoch TEXT`);
    }
    for (const column of [
      "item_id",
      "item_title",
      "item_url",
      "content_version",
      "item_published_at",
    ]) {
      if (!paymentCols.has(column)) {
        db.exec(`ALTER TABLE payment_events ADD COLUMN ${column} TEXT`);
      }
    }
    if (!paymentCols.has("offer_id")) {
      db.exec(`ALTER TABLE payment_events ADD COLUMN offer_id TEXT`);
    }
    if (!paymentCols.has("list_price_usdc")) {
      db.exec(`ALTER TABLE payment_events ADD COLUMN list_price_usdc REAL`);
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS payment_events_pending
         ON payment_events(created_at DESC) WHERE settlement_status='pending'`,
    );

    const grantCols = new Set(
      (db.prepare(`PRAGMA table_info(session_grants)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!grantCols.has("grant_epoch")) {
      db.exec(`ALTER TABLE session_grants ADD COLUMN grant_epoch TEXT`);
      // Existing grants predate generation-bound releases. Give each a unique legacy generation;
      // old pending payments have no epoch and therefore cannot release against it.
      db.exec(
        `UPDATE session_grants SET grant_epoch=lower(hex(randomblob(16))) WHERE grant_epoch IS NULL`,
      );
    }

    // api_keys scope columns. NULL on every pre-existing key and read as "all scopes, all owned
    // sources" — narrowing a key that already works in someone's integration would break it.
    const keyCols = new Set(
      (db.prepare(`PRAGMA table_info(api_keys)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!keyCols.has("scopes")) db.exec(`ALTER TABLE api_keys ADD COLUMN scopes TEXT`);
    if (!keyCols.has("source_ids")) db.exec(`ALTER TABLE api_keys ADD COLUMN source_ids TEXT`);

    // query_runs.parent_id: NULL on every existing dispatch, which is correct — they were all
    // asked standalone. Indexed so a permalink can list its follow-ups without scanning the log.
    const runCols = new Set(
      (db.prepare(`PRAGMA table_info(query_runs)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!runCols.has("parent_id")) db.exec(`ALTER TABLE query_runs ADD COLUMN parent_id TEXT`);
    // query_runs.asker: NULL on every dispatch that predates attribution, and on every anonymous,
    // engine, or A2A run — none of those has a signed-in wallet, so they belong to no one's ledger.
    if (!runCols.has("asker")) db.exec(`ALTER TABLE query_runs ADD COLUMN asker TEXT`);
    if (!runCols.has("origin")) {
      db.exec(`ALTER TABLE query_runs ADD COLUMN origin TEXT`);
      const hasPaymentOrigin = (
        db.prepare(`PRAGMA table_info(payment_events)`).all() as { name: string }[]
      ).some((c) => c.name === "origin");
      if (!hasPaymentOrigin) {
        db.exec(`ALTER TABLE payment_events ADD COLUMN origin TEXT`);
        db.exec(`UPDATE payment_events SET origin='engine' WHERE origin IS NULL`);
      }
      // Historical external rows can be proven from their payment ledger. A zero-payment legacy
      // run has no trustworthy provenance and therefore remains internal.
      db.exec(`
        UPDATE query_runs
           SET origin = CASE
             WHEN EXISTS (
               SELECT 1 FROM payment_events p
                WHERE p.query_id=query_runs.id AND p.origin='a2a'
             ) THEN 'a2a'
             WHEN EXISTS (
               SELECT 1 FROM payment_events p
                WHERE p.query_id=query_runs.id AND p.origin='web'
             ) THEN 'web'
             ELSE 'engine'
           END
         WHERE origin IS NULL
      `);
    }
    if (!runCols.has("duration_ms"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN duration_ms INTEGER`);
    if (!runCols.has("payment_mode"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN payment_mode TEXT`);
    if (!runCols.has("payment_attempts"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN payment_attempts INTEGER`);
    if (!runCols.has("settled_payments"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN settled_payments INTEGER`);
    if (!runCols.has("confidence_level"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN confidence_level TEXT`);
    if (!runCols.has("mcp_client"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN mcp_client TEXT`);
    if (!runCols.has("evidence_claim_count"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN evidence_claim_count INTEGER`);
    if (!runCols.has("grounded_claim_count"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN grounded_claim_count INTEGER`);
    if (!runCols.has("rewarded_citation_count"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN rewarded_citation_count INTEGER`);
    if (!runCols.has("economics_data"))
      db.exec(`ALTER TABLE query_runs ADD COLUMN economics_data TEXT`);
    // Unconditional: the columns are guaranteed present by the lines above (or by the CREATE TABLE
    // on a fresh database), and both paths need the indexes.
    db.exec(`CREATE INDEX IF NOT EXISTS query_runs_parent ON query_runs(parent_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS query_runs_asker ON query_runs(asker, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS query_runs_origin ON query_runs(origin, created_at)`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS query_runs_mcp_client ON query_runs(mcp_client, created_at)`,
    );

    // query_memories.sources_read: NULL on every entry written before the agent recorded what it
    // read. Those entries can prove a citation happened but never that a source was read and passed
    // over, so scoring skips them rather than reading a missing list as an empty one.
    const memCols = new Set(
      (db.prepare(`PRAGMA table_info(query_memories)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!memCols.has("sources_read")) {
      db.exec(`ALTER TABLE query_memories ADD COLUMN sources_read TEXT`);
    }

    // source_items table: encrypted-content columns added in Phase 04.
    // Existing rows have NULL for these; produce() falls back to DB plaintext content.
    const itemCols = new Set(
      (db.prepare(`PRAGMA table_info(source_items)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!itemCols.has("ipfs_cid")) db.exec(`ALTER TABLE source_items ADD COLUMN ipfs_cid TEXT`);
    if (!itemCols.has("item_key_enc")) db.exec(`ALTER TABLE source_items ADD COLUMN item_key_enc TEXT`);
    if (!itemCols.has("item_iv")) db.exec(`ALTER TABLE source_items ADD COLUMN item_iv TEXT`);
    if (!itemCols.has("item_auth_tag")) db.exec(`ALTER TABLE source_items ADD COLUMN item_auth_tag TEXT`);
    if (!itemCols.has("item_wrap_iv")) db.exec(`ALTER TABLE source_items ADD COLUMN item_wrap_iv TEXT`);
    if (!itemCols.has("delivery_kind")) db.exec(`ALTER TABLE source_items ADD COLUMN delivery_kind TEXT`);
    if (!itemCols.has("storage_mode")) db.exec(`ALTER TABLE source_items ADD COLUMN storage_mode TEXT`);
    if (!itemCols.has("plaintext_bytes")) db.exec(`ALTER TABLE source_items ADD COLUMN plaintext_bytes INTEGER`);
    if (!itemCols.has("body_hash")) db.exec(`ALTER TABLE source_items ADD COLUMN body_hash TEXT`);
    if (!itemCols.has("manifest_id")) db.exec(`ALTER TABLE source_items ADD COLUMN manifest_id TEXT`);
    if (!itemCols.has("manifest_signer")) db.exec(`ALTER TABLE source_items ADD COLUMN manifest_signer TEXT`);
    if (!itemCols.has("manifest_nonce")) db.exec(`ALTER TABLE source_items ADD COLUMN manifest_nonce TEXT`);
    if (!itemCols.has("manifest_signature")) db.exec(`ALTER TABLE source_items ADD COLUMN manifest_signature TEXT`);
    if (!itemCols.has("manifest_created_at")) db.exec(`ALTER TABLE source_items ADD COLUMN manifest_created_at TEXT`);

    if (!itemCols.has("evidence_provenance")) db.exec(`ALTER TABLE source_items ADD COLUMN evidence_provenance TEXT CHECK(evidence_provenance IS NULL OR evidence_provenance='synthetic-demo')`);
    backfillSqliteSeedProvenance(db);
    for (const table of ["sources", "source_items"]) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_preserve_demo_insert BEFORE INSERT ON ${table}
        WHEN EXISTS (SELECT 1 FROM ${table} WHERE id=NEW.id AND evidence_provenance='synthetic-demo')
          AND NEW.evidence_provenance IS NOT 'synthetic-demo'
        BEGIN SELECT RAISE(ABORT,'Synthetic evidence provenance is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS ${table}_preserve_demo_update BEFORE UPDATE ON ${table}
        WHEN OLD.evidence_provenance='synthetic-demo' AND NEW.evidence_provenance IS NOT 'synthetic-demo'
        BEGIN SELECT RAISE(ABORT,'Synthetic evidence provenance is immutable'); END;`);
    }

    db.exec(`CREATE TRIGGER IF NOT EXISTS source_items_inherit_demo AFTER INSERT ON source_items
      WHEN NEW.evidence_provenance IS NULL AND EXISTS (SELECT 1 FROM sources WHERE id=NEW.source_id AND evidence_provenance='synthetic-demo')
      BEGIN UPDATE source_items SET evidence_provenance='synthetic-demo' WHERE id=NEW.id; END;`);

    // Exact wanted-response identity. Legacy rows remain NULL and retain their generic retry.
    const gapCols = new Set(
      (db.prepare(`PRAGMA table_info(gap_intents)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!gapCols.has("item_id")) db.exec(`ALTER TABLE gap_intents ADD COLUMN item_id TEXT`);
    if (!gapCols.has("content_version"))
      db.exec(`ALTER TABLE gap_intents ADD COLUMN content_version TEXT`);
    if (!gapCols.has("article_offer_id"))
      db.exec(`ALTER TABLE gap_intents ADD COLUMN article_offer_id TEXT`);

    // Durable async A2A jobs. Existing `running` rows may already have spent creator funds, so
    // migration marks them started and the new worker can never claim them automatically.
    const a2aCols = new Set(
      (db.prepare(`PRAGMA table_info(a2a_orders)`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    const hadStartedAt = a2aCols.has("started_at");
    if (!a2aCols.has("request_data"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN request_data TEXT`);
    if (!hadStartedAt) db.exec(`ALTER TABLE a2a_orders ADD COLUMN started_at TEXT`);
    if (!a2aCols.has("worker_id"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN worker_id TEXT`);
    if (!a2aCols.has("resolution_data"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN resolution_data TEXT`);
    if (!a2aCols.has("execution_journal_version"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN execution_journal_version INTEGER`);
    if (!a2aCols.has("payment_started_at"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN payment_started_at TEXT`);
    if (!a2aCols.has("result_saving_at"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN result_saving_at TEXT`);
    if (!a2aCols.has("package_data"))
      db.exec(`ALTER TABLE a2a_orders ADD COLUMN package_data TEXT`);
    if (!hadStartedAt) {
      db.exec(
        `UPDATE a2a_orders SET started_at=updated_at,worker_id=COALESCE(worker_id,'legacy')
         WHERE status='running'`,
      );
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS a2a_orders_queued
      ON a2a_orders(created_at) WHERE status='running' AND started_at IS NULL`,
    );
    initializeSqliteBrowserJournal(db);
    initializeSqliteBrowserSigningOriginals(db);
    initializeSqliteBrowserSourceContext(db);
  }
