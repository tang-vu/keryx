# Reading activity and source visibility

Application **0.26.21 candidate**, October 5, 2026. The owner requested useful
presentation of real activity and sources even before creator earnings. This
release changes presentation and read isolation, with no source import, enrollment,
schema migration, payment authority, custody or schedule.

## Behavior

The ledger prioritizes questions and recorded citation counts. Zero payouts no
longer repeat on each question. One compact proof panel retains settled-only totals;
pending/failed attempts, payments, earnings and cash-outs appear when present.
Original networks and full payment evidence remain inspectable.

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
| Web | Ledger, Sources, navigation and shared ticker presentation change. |
| API / paid A2A | Existing source/payment/run payloads and original evidence remain; no new endpoint or field. The directory helper is a read-only view, never a buyer/payee allowlist. |
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
The built research UX suite also covers hidden-empty tickers.

TypeScript (both graphs), lint, production build, required CI, independent review,
exact merged production health and public distribution readbacks are release gates.
Their observations belong to retained release evidence; this candidate document
does not claim pending gates passed. No paid canary is required for the UX diff.
Live counts must use retained production records, not historical testnet catalogs.
