/** Data only. Constructors never install this domain or open a reference DB. */
export const CHAT_ACCOUNT_TABLES = ["chat263_links", "chat263_tokens"] as const;
const recipient = `platform TEXT NOT NULL CHECK(platform IN ('telegram','slack','discord')),
  scope TEXT NOT NULL CHECK(length(scope) BETWEEN 1 AND 128),
  user_id TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 128),
  channel TEXT NOT NULL CHECK(length(channel) BETWEEN 1 AND 128),
  origin TEXT NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  network TEXT NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002'))`;
export const CHAT_ACCOUNT_SCHEMA = [
  { name: "chat263_links", sql: `CREATE TABLE chat263_links (
  ${recipient},
  account_id TEXT NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) NOT GLOB '*[^a-f0-9]*'),
  wallet TEXT NOT NULL CHECK(length(wallet)=42 AND substr(wallet,1,2)='0x' AND substr(wallet,3) NOT GLOB '*[^a-f0-9]*'),
  member_generation TEXT NOT NULL CHECK(length(member_generation)=64 AND member_generation NOT GLOB '*[^a-f0-9]*'),
  linked_at INTEGER NOT NULL CHECK(typeof(linked_at)='integer' AND linked_at>=0),
  PRIMARY KEY(platform,scope,user_id,origin,network)
)` },
  { name: "chat263_tokens", sql: `CREATE TABLE chat263_tokens (
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  purpose TEXT NOT NULL CHECK(purpose='chat-account-link-v1'),
  ${recipient},
  issued_at INTEGER NOT NULL CHECK(typeof(issued_at)='integer' AND issued_at>=0),
  expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at=issued_at+300000),
  consumed_at INTEGER CHECK(consumed_at IS NULL OR (typeof(consumed_at)='integer' AND consumed_at>=issued_at))
)` },
  { name: "chat263_links_account", sql: "CREATE INDEX chat263_links_account ON chat263_links(account_id,origin,network,platform,scope,user_id)" },
  { name: "chat263_tokens_recipient", sql: "CREATE INDEX chat263_tokens_recipient ON chat263_tokens(platform,scope,user_id,origin,network,expires_at)" },
] as const;
export const CHAT_ACCOUNT_SQL = CHAT_ACCOUNT_SCHEMA.map(entry => `${entry.sql};`).join("\n");
