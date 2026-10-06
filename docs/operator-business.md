# Hosted research business Operator

October 6, 2026 implementation candidate: app 0.27.4, remote MCP 0.3.2 and
caller-funded MCP 0.4.6. Deployment/publication readbacks are release gates.

The [finite acceptance window](operator-canary.md) freezes one owner's original
and retains financial/provider ceilings before signing, claiming or supplier HTTP.
It grants no funding source, recurring quota or creator payout authority.

The first owner original settled its inbound charge but failed before delivering
an answer. A distinct verified failed closure preserves that paid-delivery
obligation and all supplier holds. Observation/GET recovery can be restored while
new paid execution stays held. Private stage/category diagnostics and serialized
source-selection batching address demonstrated reliability gaps; they do not
turn the failed trial into successful business acceptance.

The owner requested resolving the current bottlenecks and developing Operator
into an autonomous business for Tameion. The concrete business is prepaid research:
receive a customer order, assess capacity, select and purchase useful source
services within the accepted budget, deliver grounded research, record outcomes,
and escalate uncertain or insufficient capacity. This extends the existing
citation-toll product; it does not invent customer demand or settlement.

## Financial and execution cycle

1. `/api/agent/ask` verifies/settles the original inbound x402 authorization and
   durably records its order. Every mainnet request now returns 202 with the
   original query/poll URL, including a `wait` preference. Testnet retains its
   historical wait path. A replay observes the original; it never creates another
   downstream debit. Monthly redemption allocates prepaid revenue, not new income.
2. The existing mainnet A2A service worker reads **all** unfinished orders and
   unexpired unredeemed Monthly requests in one database aggregate. It retains
   full original creator caps as worst-case obligations. Redeemed jobs and unused
   Monthly slots are counted once. Expiry does not erase an already redeemed job.
3. With no active/ambiguous originals, the worker observes the original public
   treasury policy, stable accounting and Circle Gateway availability on an
   attested Arc RPC. Unconfirmed exposure remains held. Available funds are not
   credit; incoming seller revenue is not assumed deposited in the spender's
   Gateway account. No auto-deposit, rebalancing, new key or cap increase occurs.
4. Inventory is re-read after capacity observation and must remain identical
   within 30 seconds. Unknown/malformed/foreign inventory, capacity outage,
   insufficient liquidity, exceeded original policy, finite acceptance mode and
   started originals hold admission. A stale original requires review, never a
   blind purchase retry. Holding the queue is an escalation, not cancellation of
   its confirmed incoming payment.
5. A private decision record must persist before the existing atomic order
   claim. The research agent explains BUY/SKIP/CACHE and stop choices under the
   original package/creator caps. Existing nonce, journal, registry, source-owned
   payout and evidence gates remain payment authority. This forecast does not
   replace atomic signer caps or provide global cross-host business admission.
6. The original result-save and creator ledger determine completion/recovery.
   Outcome-audit/heartbeat failure never reruns research. Recovery identity is
   retained before fallible metadata writes. The existing original GET recovery
   and the worker repair saved results without buying again; manual review remains explicit.

The existing hosted worker checks every five seconds while idle/held and can
process prepaid service orders independently of the customer's desktop. Local
desktop tasks retain their deliberate purchase flow; this release adds no local
background scheduler or cron. Mainnet startup verifies the
dedicated public custody, not a legacy testnet funder key. A private exclusive
single-host lock prevents a second worker from executing. Crash locks are not
reclaimed by age/PID. SIGINT/SIGTERM drain an already claimed job; heartbeat
continues every 30 seconds during research/recovery and is suspended on errors.
Existing deployment holds and original signer limits remain authoritative.

## Audit and observation

Immutable-by-writer UUID decision/outcome files live in `.business-operator-audit`
beside the selected sealed SQLite store. The directory rejects symlinks and loose
POSIX permissions; records use exclusive creation and file/directory fsync. A
SHA256 checksum detects accidental corruption. These are private operational
records, not signed payment receipts or a tamper-proof ledger. Quiet unchanged
idle/held decisions reuse their actual retained audit timestamp for up to 15
minutes; every execution decision receives a new record before its claim.

`/operator`, `GET /api/operator/status`, `npm run operator:business -- status` and
MCP `keryx_operator_status` share the strict public contract. They expose only
observed state, rationale, aggregate queues/24-hour outcomes and active catalog
count. Unavailable data is unknown; an old/future heartbeat is stale. No balance,
cost, signer, question, customer/order ID or private audit path is public. Public
counts are complete aggregates, not capped REST pages. These observations are
not proof of independent traction, profit or a complete business acceptance.

SQLite's enrolled read-only method inventory explicitly classifies these reads.
Ordinary Supabase requires 0080's service-role-only aggregate RPCs; missing/error
RPCs refuse observation. **Sealed PostgreSQL explicitly refuses these two new
methods pending its separate reviewed domain enrollment.** No ordinary REST
fallback bypasses that boundary. Mainnet hosted custody remains SQLite-only.

## Research delivery

The decision brief previously expanded neighborhoods for every offered quote
before generation, exhausting the 12,000-character context cap even when selected
base passages fit. Both generation and review now retain all selected base
passages, including unfavorable material. Only candidate-used quotes add their
complete neighborhoods for review; actual combined overflow still refuses.
Compact review verdicts retain exact packet, fact/action and quote identity,
per-clause support and explicit acceptance. Missing/duplicate/foreign verdicts,
malformed or truncated generation still fail closed without an extra attempt.

`KERYX_OPERATOR_DECISION_BRIEF=1` is a protected worker rollout choice forwarded
as trusted `RunInput.answerFormat`, never from public request JSON. The global
brief setting is unchanged. Hermetic multi-target fixtures establish bounded
plumbing, not live usefulness; **leave rollout disabled until real model and
independent usefulness acceptance passes**. Qualified excerpts remain the honest
fallback. No scope, token, support or payment cap was raised to make a test pass.

## Supported surfaces and release

| Surface | Role and delivery |
|---|---|
| Web/API | Operator public observation and every mainnet prepaid order through the original worker; current main commit must be deployed/health-verified. |
| CLI | New read-only business status; existing local task/purchase/recovery authority unchanged. |
| Remote MCP 0.3.2 | New read-only public tool. Existing sponsored research is a separate treasury-bound role, not prepaid business revenue. |
| Stdio MCP 0.4.6 | New public tool; explicitly async paid order with at most 90 seconds of original GET polling, then retained manual recovery. Fresh npm bytes/provenance/publication readback required. |
| Desktop 0.4.7 candidate | Existing local task alpha uses separate GET-only original recovery imports. Hosted status is available in the browser; shell navigation, signer and native authority remain unchanged. Exact-source CI/installer publication readback remains required. |
| Extension 0.1.1 / bots | Existing hosted research adapters retain their roles. No new business scheduler or custody; public status is available by URL. No changed installer/bot publication claim. |

## Tameion acceptance still required

[Tameion RFB04](https://tameion.thecanteenapp.com/) asks for a demonstrated
complete autonomous business workflow: revenue, liquidity decision, bounded vendor
purchase, payment/outcome records and escalation. Code and synthetic fixtures do
not prove that real cycle. The October 6 read-only baseline observed mainnet
`be2e0588`, zero public creator sources and zero settled creator payments; it
establishes neither independent demand nor usefulness.

Before a new real canary, record the exact caller/source/payee, maximum operation
count, USDC/model/search/gas caps, expiry and stop conditions under the owner's
applicable authorization. Obtain a real creator's rights/payout authority and
independently accepted research task; do not populate a fake source to close the
gate. Stop new attempts on ambiguity and inspect only the original. Preserve
receipts and the failed/held escalation record in private release evidence.

A general contract-enforced business policy wallet remains a separate architecture
gate. Current sealed application/signing caps are not that contract. Do not relabel
existing EOA/Gateway custody, system-hosted execution or internal canaries as proof
of an on-chain policy wallet or external adoption. The submission still needs a
public repository, an under-three-minute demo, appropriate payment/usefulness
evidence and an honest supported-surface account before the event deadline.
