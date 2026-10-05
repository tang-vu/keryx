# Reading activity and source visibility

Application **0.26.22 candidate**, October 5, 2026. The owner requested useful
presentation of real activity and sources even before creator earnings. This
release changes presentation, aggregate reads and read isolation, with no source import, enrollment,
schema migration, payment authority, custody or schedule.

## Behavior

The ledger prioritizes questions and recorded citation counts. Zero payouts no
longer repeat on each question. One compact proof panel retains settled-only totals;
pending/failed attempts, payments, earnings and cash-outs appear when present.
Original networks and full payment evidence remain inspectable.

The ledger also shows recorded account totals from the existing authenticated
wallet index. Verified Google/Circle and wallet sign-ins normalize wallet identity;
one wallet counts once, and one person may have several wallets. Connecting without
authentication does not populate this index. No provider split, active-user or
unique-person estimate is inferred. The additive optional nullable
`metrics.recordedAccounts` field supplies only an exact count, never account rows.
SQLite deduplicates valid addresses inside the database. Legacy Supabase uses
metadata-only exact HEAD counts and withholds mixed-case index drift or failures.
Enrolled Supabase returns `null` until a reviewed account aggregate RPC exists;
it retains its registered scan-only boundary. Missing, invalid and unavailable
account counts stay explicit while other research/payment metrics remain visible.

Sources first presents original documents cited in recent public answers, then
retained public feeds and creator listings, including unverified entries. Citation
history shows up to 40 distinct public documents from the latest 50 public question
records, with original URLs, titles, recorded read scope and answer permalinks.
Private research results use a separate store and are never read by this view.
Private IDs, synthetic citations and unsafe links are excluded. No content bodies,
questions, wallets, allocation rationale or reward amounts enter these history cards.

Counts describe bounded citation history, retained public references, creator listings and feed-item
snapshots separately. Empty feed/creator sections are omitted when other real sources
are available. Public cards show publisher/domain links, topics, article
titles, publisher-supplied dates, full-text/excerpt/abstract/metadata scope and
collection timestamps. These snapshots do not prove that every original article
was fetched, the publisher claimed it, or the content is correct. Broad-web
discoverability is not a stored catalog count.

Fresh managed claim evidence supplies control labels. Expired/unavailable claims
and grandfathered verification flags cannot certify current publisher control.
Linked creator profiles also omit the legacy boolean's verification icon and describe
recorded payments without promising a payout for every citation.
Registration remains distinct from control and earning eligibility. Credentialed
or unsupported external URLs are not navigation links; their listing remains visible.

Confirmed-empty settlement tickers disappear. Loading and unavailable reads stay
explicit. Endpoint polling is independent, bounded and non-overlapping. Failed
refreshes retain explicitly dated prior data. Source preview storage reads stream
independently of the ledger shell and question polling. Catalog and earnings errors
preserve other available collections without inferring empty or zero.

## Surface audit

| Surface | Scope and role boundary |
| --- | --- |
| Web | Ledger, Sources, linked creator identity copy, navigation and shared ticker presentation change. |
| API / paid A2A | `/api/metrics` adds optional nullable `recordedAccounts`; no account rows or new endpoint. Existing source/payment/run evidence and A2A checkout contracts remain. The directory helper is a read-only view, never a buyer/payee allowlist. |
| Remote MCP / OpenAI | Hosted research/payment contracts and remote protocol 0.3.1 retain their roles. |
| Buyer / Operator CLI and stdio MCP | These runtimes do not import the new display/view helpers. Caller custody/recovery and MCP 0.4.5 retain their contracts. |
| Windows desktop | Task/receipt/export and buyer handoff retain desktop 0.4.6. Web links reach the updated pages. |
| Browser extension | Hosted handoff retains extension 0.1.1. No native claim/payment role is added. |
| Telegram / Discord / Slack | Existing hosted results and dispatch links remain. No messages, claims or payments are added to the research workflow. |

Verify distribution/source identities separately from public deployment. A web
release does not establish installed-client updates, useful answers, new creators
or settlement.

## Acceptance gates

Focused tests cover independent catalog/earnings outages, unknown earnings,
unverified visibility, inactive exclusion, failed claim inspection, legacy flags,
claim freshness, exact creator/source binding and safe external links. History tests
cover private/synthetic/paid exclusion, metadata-only output, newest URL deduplication,
bounds and read failures. Hermetic Chromium checks exercise actual
presentation components at 320, 768 and 1440 pixels on both supported profile labels:
zero settlements, independent/malformed metrics failure, retry, dated stale reads,
pending/failed records, expandable payment evidence, unverified listings, feed details
and partial catalog failure, including citation history with empty feed/creator
collections and history outage with other sources available. All new fixture HTTP is intercepted and read-only.
Account tests verify valid normalized deduplication, invalid-address exclusion,
metadata-only Supabase reads, count failures and the sealed/enrolled storage
boundaries. Chromium verifies a real zero, missing/invalid/unavailable account
counts and retained question/settlement metrics independently.
The built research UX suite also covers hidden-empty tickers.

TypeScript (both graphs), lint, production build, required CI, independent review,
exact merged production health and public distribution readbacks are release gates.
Their observations belong to retained release evidence; this candidate document
does not claim pending gates passed. No paid canary is required for the UX diff.
Live counts must use retained production records, not historical testnet catalogs.
