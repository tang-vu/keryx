# Public job settlement ledger — issue 286

## Architecture and visibility boundary

This outcome adds a public, read-only observed-transfer ledger for completed public web
dispatches. It is separate from the Activity & proof dashboard and its retained testnet
creator history. It does not restore the retired `/api/economics` endpoint. Actual invoices,
paid-service bills and realized operating results remain owner-private under
[`business-model.md`](../business-model.md).

The server-selected, sealed store and network select the reader. Requests cannot choose a
store, custody account or network. Use only the existing read-only application facade and
its already-reviewed public query/payment reads; no ordinary adapter initialization,
schema migration, provider request, wallet construction or signing occurs. Unsupported
storage is unavailable rather than an ordinary/private fallback.

The eligible cohort requires persisted, validated `RunProvenance` from the web ingress,
`origin: web`, and the existing public `query_runs` domain. The actual web ingress stamps
web/session or web/unknown guest provenance and saves its completed public run; private v2
research instead saves into private result/payment domains. Legacy A2A, private, internal,
historical runs without that provenance and uncertain publicness are not republished here.
No question, answer, customer wallet, ownership identity, authorization nonce, supplier
hold, `originalFulfillment`, private decision-review sidecar or invoice is projected.
The presence of an `originalFulfillment` marker excludes the entire run even if malformed
historical web provenance would otherwise qualify it. Sponsored fee legs additionally
match the snapshot's exact `paymentId`, amount, beneficiary and policy; equal amount alone
does not establish the original association.

`fundingOwner` is independent of customer ownership: browser-funded access/rewards are
customer transfers, treasury-funded access/rewards are sponsored transfers, and missing or
inconsistent funding stays unknown. Offline rows stay separate and never become real
settlements. Neither wallet absence, origin nor a client label establishes an outside
customer. All outside/team ownership attribution remains unknown here.

## Accounting model

Amounts are canonical integer micro-USDC strings. Legacy decimal records must describe
whole safe micro-USDC exactly; rounding cannot repair a malformed leg. Aggregates use
integers, including totals larger than one legacy safe-number amount.

Each eligible, uniquely identified, finally settled payment with a retained settlement
reference produces a voucher with equal debit and credit. Debit increases the observed
recipient-role transfer account; credit decreases the observed sender-funding-role
transfer account. These are transfer control accounts, not expense/revenue accounts or
wallet cash balances. Browser funding therefore never becomes an Operator expense.
Sponsored operating-fee transfers are separate from creator access/rewards and from
outside-customer revenue. Transfer references are not automatically Arc transaction hashes
or explorer links. Evidence links point to the existing public dispatch receipt.

Duplicate identical originals deduplicate. Conflicting original IDs, reused authorization
identities, unsafe amounts, foreign networks, malformed evidence, synthetic
demonstrations and source/run binding gaps cannot enter settled totals. Pending, failed,
simulated and uncertain legs remain visibly separate. A pending or incomplete job never
has confirmed net or margin, while its individually established settled legs stay visible.
Distinct legitimate originals can share a Circle batch reference or Arc transaction. That
is an attribution gap, not an accusation of conflicting/fraudulent originals: their known
amounts stay visible but cannot be individually posted without the original reconciliation
evidence that disambiguates the batch. This outcome never invents that per-leg chain proof.

Reads are bounded and are not an atomic all-business snapshot. Report the selected public
cohort, read interval, row limits and partial coverage explicitly. A bounded window never
claims complete business books. Full purchase revenue, refunds, invoices, obligations and
overlap are unavailable; profit/margin and cash position stay unknown, with no advisory
safe-spend amount beyond zero. The private obligation inspection remains a separately
delegated role under issue 258; a public page cannot hydrate its journals.

## Surface plan and acceptance gates

New focused modules own the projection, bounded read orchestration, JSON/CSV balanced
export, typed public contract and hosted client. A new `/operator/ledger` page and public
read-only API share that contract. CLI and remote/stdio MCP inspection use the same
contract; desktop can open the public web view. Extensions/bots do not gain execution,
customer-history or bookkeeping authority. Shared catalogues, OpenAPI, registries and CI
changes are additive and coordinated with issues 253/258. Existing receipts and immutable
payment/run schemas remain unchanged.

## Inspect and retain evidence

Open `/operator/ledger` for the selected network. The API is `GET /api/operator/ledger`;
`days` accepts 1–31 (default 7), `format=csv` downloads balanced posted-transfer rows, and
`download=1` downloads JSON. JSON includes uncertain/pending legs and coverage; CSV is the
posted-transfer voucher projection, not a separate invoice or profit report. Unknown,
duplicate or custody/network selectors are rejected before the store is read. A sealed
store refusal returns a uniform 503; no private or ordinary database fallback is attempted.

`npm run operator:ledger -- --days 7` uses public HTTPS at `https://keryx.cc` by default.
`KERYX_OPERATOR_URL` may select another HTTPS origin or a loopback HTTP fixture. Add `--csv`
for vouchers, or `--expect sha256:…` to bind a separately retained export digest. The CLI
does not load an environment file, construct a wallet or open a local financial store.
Remote and stdio MCP expose `keryx_public_job_ledger` with only the optional `days` input;
the existing remote wrapper's authentication remains unchanged. This public inspection
grants no `operator:read` delegation or access to the private obligation domain.

Exports use canonical sorted JSON, SHA-256 and exact integer text. Node and actual browser
WebCrypto validate the same voucher/leg, total and trial-balance bindings. A checksum detects
inconsistency and a separately retained digest binds earlier bytes; neither establishes
authenticity, independent chain finality or complete accounting. Receipt links retain the
existing public projection, and dispatch links show its public recorded BUY/SKIP/CACHE
decisions. They never query the private decision-review sidecar from issue 253.

The native source fixture uses an actual disposable sealed SQLite store containing only
explicit offline/simulated records. Positive settled records are immutable unit/HTTP UI
fixtures, never a fabricated real-mode store. A built API fixture checks the native read,
selectors, no-store headers, unchanged database bytes and invalid-manifest refusal; the
production-CSS browser fixture checks both the native simulated result and intercepted
positive UI evidence, export/navigation, responsive layout and tamper/empty recovery.
The stdio/CLI gate executes the actual bundle/client outside the repository against closed
loopback HTTP, with absent wallet/journal paths and observed child exit. None is a funded
live acceptance run.

Qualification requires meaningful exact-unit, binding, uncertainty, conflict, privacy,
network, funding-role, balanced-export, bounded-reader and transport tests; both TypeScript
graphs; scoped lint/copy guard; default production build; actual built API and responsive
browser/export proof; and applicable distribution contracts. No version, installed package,
deployment or live funded result is claimed by source acceptance. Independent review,
hosted CI, combined release and full funded/accounting acceptance for issue 286 remain
separate gates. This public cohort outcome cannot establish complete invoices or all-job
margin without further authorized, privacy-preserving source contracts.
