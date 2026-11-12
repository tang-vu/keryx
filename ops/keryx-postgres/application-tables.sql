-- Fresh SOURCE-only completion of the current application table inventory.
-- No enrollment, stored-row rewrite, optional-port admission or backend selection.
SET ROLE keryx_owner;
CREATE DOMAIN keryx_storage.sqlite_number AS numeric CHECK(VALUE BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308);

-- SQLite SOURCE a2a_failed_original_fulfillments sha256:83ec5f928502f783f4175e9c77b559caefec49aa7269bf446140b115b8fc4a29
CREATE TABLE public.a2a_failed_original_fulfillments (
  original_id text PRIMARY KEY REFERENCES public.a2a_orders(id),
  claim_id text NOT NULL UNIQUE,
  authority_data text NOT NULL CHECK((CASE WHEN authority_data IS NULL THEN NULL ELSE authority_data IS JSON END)),
  failed_order_data text NOT NULL CHECK((CASE WHEN failed_order_data IS NULL THEN NULL ELSE failed_order_data IS JSON END)),
  claimed_at text NOT NULL
);

-- SQLite SOURCE account267_accounts sha256:e98773f700fa538159457c4c553773647b899b1da83e7d601ed27f2ff3c280c5
CREATE TABLE public.account267_accounts (
  account_id text NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) !~ '[^a-f0-9]'),
  revision keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN revision IS NULL THEN 'null' WHEN revision=trunc(revision) AND revision BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND revision BETWEEN 0 AND 9007199254740991),
  created_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN created_at IS NULL THEN 'null' WHEN created_at=trunc(created_at) AND created_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND created_at BETWEEN 0 AND 8639999999700000),
  PRIMARY KEY(account_id)
);

-- SQLite SOURCE account267_challenges sha256:82510722cbfca603f2fa06355e0375d62f4e5e6f5dd7de0439979aff72698904
CREATE TABLE public.account267_challenges (
  nonce_hash text NOT NULL CHECK(length(nonce_hash)=64 AND nonce_hash !~ '[^a-f0-9]'),
  session_hash text NOT NULL CHECK(length(session_hash)=64 AND session_hash !~ '[^a-f0-9]'),
  payload text NOT NULL CHECK(octet_length(payload)<=8192 AND (CASE WHEN payload IS NULL THEN NULL ELSE payload IS JSON END) AND jsonb_typeof(payload::jsonb)='object'),
  expires_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN expires_at IS NULL THEN 'null' WHEN expires_at=trunc(expires_at) AND expires_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND expires_at BETWEEN 0 AND 8639999999700000),
  consumed_at keryx_storage.sqlite_number CHECK(consumed_at IS NULL OR ((CASE WHEN consumed_at IS NULL THEN 'null' WHEN consumed_at=trunc(consumed_at) AND consumed_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND consumed_at BETWEEN 0 AND 8639999999700000)),
  lease_hash text CHECK(lease_hash IS NULL OR (length(lease_hash)=64 AND lease_hash !~ '[^a-f0-9]')),
  completed_at keryx_storage.sqlite_number CHECK(completed_at IS NULL OR ((CASE WHEN completed_at IS NULL THEN 'null' WHEN completed_at=trunc(completed_at) AND completed_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND completed_at BETWEEN 0 AND 8639999999700000)),
  CHECK((consumed_at IS NULL)=(lease_hash IS NULL)),
  CHECK(completed_at IS NULL OR consumed_at IS NOT NULL),
  PRIMARY KEY(nonce_hash)
);

-- SQLite SOURCE account267_credentials sha256:f83bc5d0ed5bb549c83a84f5ca945c853e7d941932d28c451591fc6f2742f5a0
CREATE TABLE public.account267_credentials (
  wallet text NOT NULL CHECK(length(wallet)=42 AND substr(wallet,1,2)='0x' AND wallet=lower(wallet) AND substr(wallet,3) !~ '[^a-f0-9]'),
  account_id text NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) !~ '[^a-f0-9]'),
  member_generation text NOT NULL CHECK(length(member_generation)=64 AND member_generation !~ '[^a-f0-9]'),
  generation text NOT NULL CHECK(length(generation)=64 AND generation !~ '[^a-f0-9]'),
  login_after keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN login_after IS NULL THEN 'null' WHEN login_after=trunc(login_after) AND login_after BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND login_after BETWEEN 0 AND 8639999999700000),
  active keryx_storage.sqlite_number NOT NULL CHECK(active IN (0,1)),
  PRIMARY KEY(wallet),
  UNIQUE(generation)
);

-- SQLite SOURCE account267_events sha256:311fded1eb525465628145330d136073b9ab2104afa7ac7d94dfc406ac25665d
CREATE TABLE public.account267_events (
  id text NOT NULL CHECK(length(id)=64 AND id !~ '[^a-f0-9]'),
  account_id text NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) !~ '[^a-f0-9]'),
  revision keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN revision IS NULL THEN 'null' WHEN revision=trunc(revision) AND revision BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND revision BETWEEN 0 AND 9007199254740991),
  purpose text NOT NULL CHECK(purpose IN ('create-private-account','link-wallet','unlink-wallet')),
  lineage_hash text NOT NULL CHECK(length(lineage_hash)=64 AND lineage_hash !~ '[^a-f0-9]'),
  consent_hash text NOT NULL CHECK(length(consent_hash)=64 AND consent_hash !~ '[^a-f0-9]'),
  proof_hash text NOT NULL CHECK(length(proof_hash)=64 AND proof_hash !~ '[^a-f0-9]'),
  created_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN created_at IS NULL THEN 'null' WHEN created_at=trunc(created_at) AND created_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND created_at BETWEEN 0 AND 8639999999700000),
  PRIMARY KEY(id)
);

-- SQLite SOURCE account267_members sha256:0b4da00a3ccd26cfec77682e03b2f0bc4c6ed3f7675f453040ad5224614766e5
CREATE TABLE public.account267_members (
  wallet text NOT NULL CHECK(length(wallet)=42 AND substr(wallet,1,2)='0x' AND wallet=lower(wallet) AND substr(wallet,3) !~ '[^a-f0-9]'),
  account_id text NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) !~ '[^a-f0-9]'),
  generation text NOT NULL CHECK(length(generation)=64 AND generation !~ '[^a-f0-9]'),
  consent_hash text NOT NULL CHECK(length(consent_hash)=64 AND consent_hash !~ '[^a-f0-9]'),
  linked_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN linked_at IS NULL THEN 'null' WHEN linked_at=trunc(linked_at) AND linked_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND linked_at BETWEEN 0 AND 8639999999700000),
  PRIMARY KEY(wallet),
  UNIQUE(generation)
);

-- SQLite SOURCE account267_sessions sha256:3ac8e1c2bb6b416b2f33162bb957764c1da72d5a1eff24d7087102525cb0a6d2
CREATE TABLE public.account267_sessions (
  session_hash text NOT NULL CHECK(length(session_hash)=64 AND session_hash !~ '[^a-f0-9]'),
  wallet text NOT NULL CHECK(length(wallet)=42 AND substr(wallet,1,2)='0x' AND wallet=lower(wallet) AND substr(wallet,3) !~ '[^a-f0-9]'),
  account_id text NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) !~ '[^a-f0-9]'),
  member_generation text NOT NULL CHECK(length(member_generation)=64 AND member_generation !~ '[^a-f0-9]'),
  credential_generation text NOT NULL CHECK(length(credential_generation)=64 AND credential_generation !~ '[^a-f0-9]'),
  issued_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN issued_at IS NULL THEN 'null' WHEN issued_at=trunc(issued_at) AND issued_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND issued_at BETWEEN 0 AND 8639999999700000),
  expires_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN expires_at IS NULL THEN 'null' WHEN expires_at=trunc(expires_at) AND expires_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND expires_at BETWEEN 0 AND 8639999999700000),
  origin text NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  network text NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002')),
  history_consent keryx_storage.sqlite_number NOT NULL CHECK(history_consent=1),
  revoked_at keryx_storage.sqlite_number CHECK(revoked_at IS NULL OR ((CASE WHEN revoked_at IS NULL THEN 'null' WHEN revoked_at=trunc(revoked_at) AND revoked_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND revoked_at BETWEEN 0 AND 8639999999700000)),
  CHECK(expires_at>issued_at AND expires_at<=issued_at+604800000),
  PRIMARY KEY(session_hash)
);

-- SQLite SOURCE anonymous_run_claims sha256:112aa03c2157a3df551e9d5df8ad70350d8f75fbe6b89eee5c78208c75739ae5
CREATE TABLE public.anonymous_run_claims (
  run_id text PRIMARY KEY CHECK(length(run_id) BETWEEN 1 AND 128 AND run_id !~ '[^A-Za-z0-9_-]' AND run_id !~ '^prv_.*$' AND run_id !~ '^a2a_.*$'),
  network text NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002')),
  origin text NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash !~ '[^a-f0-9]'),
  original_sha256 text NOT NULL CHECK(length(original_sha256)=64 AND original_sha256 !~ '[^a-f0-9]'),
  completed_at text NOT NULL,
  issued_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN issued_at IS NULL THEN 'null' WHEN issued_at=trunc(issued_at) AND issued_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND issued_at>=0 AND issued_at<=8640000000000000-86400000),
  expires_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN expires_at IS NULL THEN 'null' WHEN expires_at=trunc(expires_at) AND expires_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND expires_at=issued_at+86400000),
  claimed_wallet text CHECK(claimed_wallet IS NULL OR (length(claimed_wallet)=42 AND substr(claimed_wallet,1,2)='0x' AND substr(claimed_wallet,3) !~ '[^a-f0-9]')),
  claimed_at keryx_storage.sqlite_number CHECK(claimed_at IS NULL OR ((CASE WHEN claimed_at IS NULL THEN 'null' WHEN claimed_at=trunc(claimed_at) AND claimed_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND claimed_at>=issued_at AND claimed_at<expires_at)),
  CHECK((claimed_wallet IS NULL)=(claimed_at IS NULL))
);

-- SQLite SOURCE chat263_links sha256:14e3249b6736a4f1e9972d0a4d2cb283a7344ee3687975bc413aed4734e596a7
CREATE TABLE public.chat263_links (
  platform text NOT NULL CHECK(platform IN ('telegram','slack','discord')),
  scope text NOT NULL CHECK(length(scope) BETWEEN 1 AND 128),
  user_id text NOT NULL CHECK(length(user_id) BETWEEN 1 AND 128),
  channel text NOT NULL CHECK(length(channel) BETWEEN 1 AND 128),
  origin text NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  network text NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002')),
  account_id text NOT NULL CHECK(length(account_id)=69 AND substr(account_id,1,5)='acct_' AND substr(account_id,6) !~ '[^a-f0-9]'),
  wallet text NOT NULL CHECK(length(wallet)=42 AND substr(wallet,1,2)='0x' AND substr(wallet,3) !~ '[^a-f0-9]'),
  member_generation text NOT NULL CHECK(length(member_generation)=64 AND member_generation !~ '[^a-f0-9]'),
  linked_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN linked_at IS NULL THEN 'null' WHEN linked_at=trunc(linked_at) AND linked_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND linked_at>=0),
  PRIMARY KEY(platform,scope,user_id,origin,network)
);

-- SQLite SOURCE chat263_tokens sha256:35c31fc2d89a65596cb286437383ec62e4a37a2796a904dc3b132510ab778d9d
CREATE TABLE public.chat263_tokens (
  token_hash text PRIMARY KEY CHECK(length(token_hash)=64 AND token_hash !~ '[^a-f0-9]'),
  purpose text NOT NULL CHECK(purpose='chat-account-link-v1'),
  platform text NOT NULL CHECK(platform IN ('telegram','slack','discord')),
  scope text NOT NULL CHECK(length(scope) BETWEEN 1 AND 128),
  user_id text NOT NULL CHECK(length(user_id) BETWEEN 1 AND 128),
  channel text NOT NULL CHECK(length(channel) BETWEEN 1 AND 128),
  origin text NOT NULL CHECK(length(origin) BETWEEN 1 AND 2048),
  network text NOT NULL CHECK(network IN ('eip155:5042','eip155:5042002')),
  issued_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN issued_at IS NULL THEN 'null' WHEN issued_at=trunc(issued_at) AND issued_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND issued_at>=0),
  expires_at keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN expires_at IS NULL THEN 'null' WHEN expires_at=trunc(expires_at) AND expires_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND expires_at=issued_at+300000),
  consumed_at keryx_storage.sqlite_number CHECK(consumed_at IS NULL OR ((CASE WHEN consumed_at IS NULL THEN 'null' WHEN consumed_at=trunc(consumed_at) AND consumed_at BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND consumed_at>=issued_at))
);

-- SQLite SOURCE decision_review_records sha256:6652c55e6affb8edbdd9dfb15408be66d67c7889482dd6fba11169b2ad60766e
CREATE TABLE public.decision_review_records (
 id text PRIMARY KEY, wallet text NOT NULL, run_id text NOT NULL, network text NOT NULL, created_at text NOT NULL,
 input_json text NOT NULL CHECK(octet_length(input_json)<=8192), state text NOT NULL CHECK(state IN ('observed','held','approved','declined','expired','consumed','cancelled')),
 expires_at text, code_action text NOT NULL CHECK(code_action IN ('BUY','SKIP','CACHE')), code_rule text NOT NULL CHECK(code_rule IN ('model-skip','selected','public-read','external-only','missing-proposal','discussion','preview','attention','portfolio','terms-changed','duplicate','rights','funding-unavailable','zero-budget','budget','sufficient','assessment-unavailable','not-admitted','cache-expired','cache-selected')),
 verdict_json text, UNIQUE(wallet,run_id,id)
);

-- SQLite SOURCE decision_review_verdicts sha256:d1a7a206351007c20af61225caa51a8d14a975bd9ecf80ca60831f2e14301d00
CREATE TABLE public.decision_review_verdicts (
 wallet text NOT NULL, key text NOT NULL, decision_id text NOT NULL, input_json text NOT NULL,
 PRIMARY KEY(wallet,key)
);

-- SQLite SOURCE deliverable_acceptance_entries sha256:97ed572ffa930e65b9158b708f3c630e920ef5ec8442e2b56c587be2a0bcc7af
CREATE TABLE public.deliverable_acceptance_entries (
  owner text NOT NULL, network text NOT NULL, original_id text NOT NULL, revision keryx_storage.sqlite_number NOT NULL CHECK(revision BETWEEN 1 AND 100),
  idempotency_key text NOT NULL, original_fingerprint text NOT NULL, delivered_digest text NOT NULL, data text NOT NULL CHECK((CASE WHEN data IS NULL THEN NULL ELSE data IS JSON END)),
  PRIMARY KEY(owner,network,original_id,revision), UNIQUE(owner,network,original_id,idempotency_key)
);

-- SQLite SOURCE deliverable_acceptance_store sha256:2a6ad496bde3dbe6008334bfed7edcb977c3aa117c3cff56435db34fffc5f00c
CREATE TABLE public.deliverable_acceptance_store (singleton keryx_storage.sqlite_number PRIMARY KEY CHECK(singleton=1), id text NOT NULL);

-- SQLite SOURCE owner269_operations sha256:6bdd9c16120aa95da5c6d8efd71704d6f85b3dcd874b07fee6551d28f098591f
CREATE TABLE public.owner269_operations (
  request_id text PRIMARY KEY,
  input_digest text NOT NULL CHECK(length(input_digest)=64 AND input_digest !~ '[^a-f0-9]'),
  event text NOT NULL CHECK((CASE WHEN event IS NULL THEN 'null' ELSE 'text' END)='text' AND octet_length(event)<=65536 AND (CASE WHEN event IS NULL THEN NULL ELSE event IS JSON END))
);

-- SQLite SOURCE pending_job_owners sha256:7e7b4fd2347b272a6094b03b68a3d6252d235486564a4ba762e2f6c6083a67ae
CREATE TABLE public.pending_job_owners (
 job_id text PRIMARY KEY REFERENCES public.a2a_orders(id), query_id text NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK(length(request_hash)=64), network text NOT NULL,
 wallet text NOT NULL CHECK(length(wallet)=42 AND wallet=lower(wallet)),
 session_hash text NOT NULL CHECK(length(session_hash)=64), issued_at keryx_storage.sqlite_number NOT NULL,
 expires_at keryx_storage.sqlite_number NOT NULL CHECK(expires_at>issued_at), admitted_at text NOT NULL,
 CHECK(job_id=query_id)
);

-- SQLite SOURCE private_bibliographies sha256:227b0aa858d56aeb106eb3abb5b98215b845ca069bcaedfbe207caa0450e32ff
CREATE TABLE public.private_bibliographies (
  id text PRIMARY KEY, wallet text NOT NULL CHECK(length(wallet)=42 AND wallet=lower(wallet) AND substr(wallet,1,2)='0x' AND substr(wallet,3) !~ '[^0-9a-f]'),
  token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash !~ '[^0-9a-f]'),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  content text NOT NULL CHECK(octet_length(content)<=524288),
  reference_count keryx_storage.sqlite_number NOT NULL CHECK(reference_count BETWEEN 0 AND 50),
  revision keryx_storage.sqlite_number NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
  created_at text NOT NULL, updated_at text NOT NULL
);

-- SQLite SOURCE private_profiles sha256:86a9af97aa4572ac444c8e56c1b2a64e7a89e6e4f8b2fd32990b8e8f7fc2b115
CREATE TABLE public.private_profiles (
  wallet text PRIMARY KEY CHECK(length(wallet)=42 AND wallet=lower(wallet) AND substr(wallet,1,2)='0x' AND substr(wallet,3) !~ '[^0-9a-f]'),
  handle text UNIQUE CHECK(handle IS NULL OR (length(handle) BETWEEN 3 AND 32 AND handle=lower(handle) AND substr(handle,1,1) ~ '^[a-z]$' AND handle !~ '[^a-z0-9_]' AND handle NOT IN ('keryx','admin','administrator','api','auth','circle','arc','creator','creators','developer','dev','dispatch','gateway','help','integrations','login','mainnet','me','moderator','official','operator','owner','profile','research','root','signup','sources','status','support','system','testnet','treasury','wallet'))),
  display_name text NOT NULL CHECK(length(display_name)<=80), bio text NOT NULL CHECK(length(bio)<=160), purpose text NOT NULL CHECK(length(purpose)<=160),
  links text NOT NULL CHECK((CASE WHEN links IS NULL THEN NULL ELSE links IS JSON END) AND jsonb_typeof(links::jsonb)='array' AND jsonb_array_length(links::jsonb)<=6),
  created_at text NOT NULL, updated_at text NOT NULL
);

-- SQLite SOURCE public_reference_article_terms sha256:b816b69802650d3fc0de6a74ccc24ffaef024fb9859bb76ab5b8f1f9757747d2
CREATE TABLE public.public_reference_article_terms (
  term text NOT NULL, reference_id text NOT NULL, item_id text NOT NULL,
  weight keryx_storage.sqlite_number NOT NULL CHECK(weight > 0), PRIMARY KEY(term,reference_id,item_id)
);

-- SQLite SOURCE public_reference_article_versions sha256:52b49d90e5155982c488df5f74ee0659513381783a1096d7a2394f545db862d3
CREATE TABLE public.public_reference_article_versions (
  reference_id text NOT NULL, item_id text NOT NULL, revision text NOT NULL,
  content_version text NOT NULL, snapshot text NOT NULL, original_snapshot text NOT NULL,
  collection_kind text NOT NULL CHECK(collection_kind IN ('feed','article')), collected_at text NOT NULL,
  PRIMARY KEY(reference_id,item_id,revision)
);

-- SQLite SOURCE public_reference_articles sha256:226bbcf46aecee0907b4851c24553de234613ddc48e563f8a1a2dd3f9eede58d
CREATE TABLE public.public_reference_articles (
  reference_id text NOT NULL, item_id text NOT NULL, canonical_url text NOT NULL,
  current_revision text NOT NULL, first_collected_at text NOT NULL, last_collected_at text NOT NULL,
  published_at text, sort_at text NOT NULL,
  PRIMARY KEY(reference_id,item_id), UNIQUE(reference_id,canonical_url)
);

-- SQLite SOURCE public_references sha256:4cb4317ab4f7317977996634eef94b2f5e8ce3b116d9fee02ece6a4b068068e3
CREATE TABLE public.public_references (
  id text PRIMARY KEY, active keryx_storage.sqlite_number NOT NULL, rss_url text NOT NULL, snapshot text NOT NULL
);

-- SQLite SOURCE research_monthly sha256:a1723b5b730b04b11b4d51754374ebf66df41555b9bdcf7e9544cb01ee915eda
CREATE TABLE public.research_monthly (
  id text PRIMARY KEY, payer text NOT NULL, data text NOT NULL
);

-- SQLite SOURCE research_purchase_authorizations sha256:ca3459363ace7f5e1469af9fe8f2946bdaf32492bbdea1c0a2613896aa77042a
CREATE TABLE public.research_purchase_authorizations (
  network text NOT NULL CHECK(network='eip155:5042'), asset text NOT NULL CHECK(asset='0x3600000000000000000000000000000000000000'),
  payer text NOT NULL, payee text NOT NULL, authorization_id text NOT NULL,
  product text NOT NULL CHECK(product IN ('a2a','monthly','resource')), purchase_id text NOT NULL,
  request_hash text NOT NULL, amount_micros keryx_storage.sqlite_number NOT NULL CHECK(amount_micros > 0),
  issued_data text,
  PRIMARY KEY(network,asset,payer,authorization_id)
);

-- SQLite SOURCE run_privacy sha256:b8232e111034c420d5248c7877c377ee7f8b04c15b2d98273a80ccfd402d9842
CREATE TABLE public.run_privacy (
  run_id text PRIMARY KEY, visibility text NOT NULL CHECK(visibility IN ('private','unlisted','public')),
  revision keryx_storage.sqlite_number NOT NULL DEFAULT 0 CHECK(revision>=0), erased keryx_storage.sqlite_number NOT NULL DEFAULT 0 CHECK(erased IN (0,1)),
  retained_owner text, retained_digest text, retained_binding text, updated_at text NOT NULL
);

-- SQLite SOURCE run_privacy_audit sha256:6414b198f34963a4d5efb19ba6ab1e81599ca8e4de3fd4cbb054beab910f34c7
CREATE TABLE public.run_privacy_audit (
  request_id text PRIMARY KEY, wallet text NOT NULL, run_id text NOT NULL, action text NOT NULL,
  input text NOT NULL, result text NOT NULL, original_digest text, created_at text NOT NULL
);

-- SQLite SOURCE run_privacy_defaults sha256:ec38167944570dfea5b864a750aec75cc72fbc0ac0ff4b9f299a2341278be10e
CREATE TABLE public.run_privacy_defaults (wallet text PRIMARY KEY, visibility text NOT NULL CHECK(visibility IN ('private','unlisted','public')));

-- SQLite SOURCE topic_watches sha256:d6ec6e458ff5794b478a87e4a8fd47b4bd56fa4d19e89c5e7533e49dfc25e65d
CREATE TABLE public.topic_watches (
  wallet text NOT NULL CHECK(wallet ~ '^0x.*$' AND length(wallet)=42 AND wallet=lower(wallet)),
  id text NOT NULL CHECK(length(id) BETWEEN 1 AND 64),
  revision keryx_storage.sqlite_number NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK(octet_length(state)<=262144 AND (CASE WHEN state IS NULL THEN NULL ELSE state IS JSON END)),
  PRIMARY KEY(wallet,id)
);

-- SQLite SOURCE a2a_fulfillment_completions sha256:31b81244c1130145d1e4bd5a22e166eb385e8fa7d87abaa729d92fd81dfd14fc
CREATE TABLE public.a2a_fulfillment_completions (
  original_id text PRIMARY KEY REFERENCES public.a2a_failed_original_fulfillments(original_id),
  claim_id text NOT NULL UNIQUE,
  run_sha256 text NOT NULL,
  provider_ledger_sha256 text NOT NULL,
  completed_at text NOT NULL
);

-- SQLite SOURCE owner269_associations sha256:c8731bfa43f2990735ff7a8f5d29797f638cbe50918aaa4c760533d60824ce22
CREATE TABLE public.owner269_associations (
  assignment_id text PRIMARY KEY,
  run_id text NOT NULL,
  recipient_account text NOT NULL,
  recipient_generation text NOT NULL,
  revision keryx_storage.sqlite_number NOT NULL CHECK((CASE WHEN revision IS NULL THEN 'null' WHEN revision=trunc(revision) AND revision BETWEEN -9223372036854775808 AND 9223372036854775807 THEN 'integer' ELSE 'real' END)='integer' AND revision BETWEEN 1 AND 9007199254740990),
  status text NOT NULL CHECK(status IN ('assigned-by-owner','claimed','rejected','revoked')),
  apply_id text NOT NULL REFERENCES public.owner269_operations(request_id) DEFERRABLE INITIALLY DEFERRED,
  last_operation_id text NOT NULL REFERENCES public.owner269_operations(request_id) DEFERRABLE INITIALLY DEFERRED,
  state text NOT NULL CHECK((CASE WHEN state IS NULL THEN 'null' ELSE 'text' END)='text' AND octet_length(state)<=32768 AND (CASE WHEN state IS NULL THEN NULL ELSE state IS JSON END))
);

-- SQLite SOURCE profile_verified_identities sha256:7e551ce6c07c9e10ac12ab90aa43c5cfb9bab7234fe25409b723986e2251d046
CREATE TABLE public.profile_verified_identities (
  wallet text NOT NULL REFERENCES public.private_profiles(wallet) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('orcid','github')),
  external_id text, label text, verified_at text,
  current_state_hash text CHECK(current_state_hash IS NULL OR (length(current_state_hash)=64 AND current_state_hash !~ '[^0-9a-f]')),
  PRIMARY KEY(wallet,provider), UNIQUE(provider,external_id),
  CHECK((external_id IS NULL AND label IS NULL AND verified_at IS NULL) OR
    (external_id IS NOT NULL AND length(external_id) BETWEEN 1 AND 32 AND label IS NOT NULL AND length(label)<=160 AND verified_at IS NOT NULL))
);

-- SQLite SOURCE public_researcher_profiles sha256:1eb9de8b2eef1cd4ecffe95001c8cacdb690b206f5d6c8a8f15a257759acb2b6
CREATE TABLE public.public_researcher_profiles (
  wallet text PRIMARY KEY REFERENCES public.private_profiles(wallet) ON DELETE CASCADE,
  handle text NOT NULL, published keryx_storage.sqlite_number NOT NULL CHECK(published IN (0,1)),
  fields text NOT NULL CHECK((CASE WHEN fields IS NULL THEN NULL ELSE fields IS JSON END) AND jsonb_typeof(fields::jsonb)='array' AND jsonb_array_length(fields::jsonb)<=5),
  run_ids text NOT NULL CHECK((CASE WHEN run_ids IS NULL THEN NULL ELSE run_ids IS JSON END) AND jsonb_typeof(run_ids::jsonb)='array' AND jsonb_array_length(run_ids::jsonb)<=50),
  binding text NOT NULL CHECK((CASE WHEN binding IS NULL THEN NULL ELSE binding IS JSON END)), revision keryx_storage.sqlite_number NOT NULL CHECK(revision BETWEEN 0 AND 2147483647), updated_at text NOT NULL
);

-- SQLite SOURCE research_monthly_redemptions sha256:3d5a8e3bde5e8fcb06300ad20876fa9be64cf7ba1f27466e5c916d095daadc7b
CREATE TABLE public.research_monthly_redemptions (
  monthly_id text NOT NULL REFERENCES public.research_monthly(id), request_id text NOT NULL,
  order_id text NOT NULL UNIQUE REFERENCES public.a2a_orders(id) DEFERRABLE INITIALLY DEFERRED,
  request_hash text NOT NULL, created_at text NOT NULL, slot keryx_storage.sqlite_number NOT NULL CHECK(slot BETWEEN 0 AND 3),
  PRIMARY KEY(monthly_id,request_id), UNIQUE(monthly_id,slot)
);

-- SQLite SOURCE profile_identity_challenges sha256:182a63c5324087056024c2b41f43862abdadf712bdbd534eaa208f4caef5a320
CREATE TABLE public.profile_identity_challenges (
  state_hash text PRIMARY KEY CHECK(length(state_hash)=64 AND state_hash !~ '[^0-9a-f]'),
  wallet text NOT NULL, provider text NOT NULL,
  session_hash text NOT NULL CHECK(length(session_hash)=64 AND session_hash !~ '[^0-9a-f]'),
  expires_at keryx_storage.sqlite_number NOT NULL CHECK(expires_at>=0),
  status text NOT NULL CHECK(status IN ('pending','consumed')),
  UNIQUE(wallet,provider),
  FOREIGN KEY(wallet,provider) REFERENCES public.profile_verified_identities(wallet,provider) ON DELETE CASCADE
);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader;
RESET ROLE;
