# Public citation activity boundary

The landing ticker reads `/api/activity`, whose payload has no per-row network
field. The route previously selected every citation with a truthy `settled` flag.
The native payment readers preserve historical row metadata, including another
network and a status that can disagree with that flag. These rows could therefore
appear as current settled citation activity. A normal writer already rejects
inconsistent flag/status pairs; this finding does not establish that the current
writer creates them, or that any particular production ticker row was wrong.

The route now requires a citation, `settled === true`, the existing shared
`paymentSettlementStatus` result of `settled`, and a recorded network matching
the trusted server-selected `config.networkId`. Selection happens before the
15-row limit and question enrichment. The existing 80-row scan remains bounded;
it is a recent sample, not exhaustive settled history.

Network attribution reuses `recordedArcProfile`, the existing display convention:
canonical payment-row network IDs are recognized; an undefined legacy network
is attributed to testnet. Missing network cannot become mainnet. Explicit null,
unknown strings, near matches and configuration aliases such as `arc` remain
unattributed in this payment-row field. This does not claim that a configuration
alias names a different chain, normalize stored originals or choose signing
authority. No request parameter can select the route's profile. An absent legacy
status keeps the shared flag-based fallback; an explicit contradictory or unknown
status is withheld from this settled-activity projection.

Eligible rows retain their original amount, article/version metadata, order and
existing response keys. Question IDs are deduplicated after qualification through
the existing privacy reader; unlisted/private questions stay null. A failed
eligible question lookup retains unavailable activity without raw fallback. A
sample containing only ineligible rows requires no question lookup. The successful
response remains `no-store` and the existing graceful error contract is retained.

Fourteen focused cases exercise actual isolated SQLite payment reads, raw legacy
metadata, unchanged normal-writer refusal, both selected-network contexts, filter
ordering and unchanged rows, missing optional legacy fields and privacy failure.
Two minified Chromium cases consume the actual route output in the real ticker.
Storage remains an ordinary in-memory testnet/offline fixture; only the route's
selected-network acquisition and privacy lookup are synthetic boundaries. These
checks do not establish mainnet enrollment, funded payment, Circle verification
or production traffic contents. Earlier fixture precondition failures are retained
separately from the qualified failing baseline.

This changes public activity eligibility only. Payment state, financial totals,
pending liabilities, receipts, reconciliation, custody, nonce/cap/payee authority
and database schema stay untouched. `/api/payments` retains its separate historical
record role. Web ticker consumers keep the same payload; API/CLI/MCP/desktop,
extension and bot role contracts otherwise retain their existing behavior. No
new settlement proof or creator-payout authority is created. Source merge and
required CI remain separate from a later explicitly authorized deployment.
