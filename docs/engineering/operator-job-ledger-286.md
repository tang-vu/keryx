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

Duplicate identical originals deduplicate. Conflicting original IDs, reused settlement or
authorization identities, unsafe amounts, foreign networks, malformed evidence, synthetic
demonstrations and source/run binding gaps cannot enter settled totals. Pending, failed,
simulated and uncertain legs remain visibly separate. A pending or incomplete job never
has confirmed net or margin, while its individually established settled legs stay visible.

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

Qualification requires meaningful exact-unit, binding, uncertainty, conflict, privacy,
network, funding-role, balanced-export, bounded-reader and transport tests; both TypeScript
graphs; scoped lint/copy guard; default production build; actual built API and responsive
browser/export proof; and applicable distribution contracts. No version, installed package,
deployment or live funded result is claimed by source acceptance. Independent review,
hosted CI, combined release and full funded/accounting acceptance for issue 286 remain
separate gates. This public cohort outcome cannot establish complete invoices or all-job
margin without further authorized, privacy-preserving source contracts.
