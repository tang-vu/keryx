# Gateway balance and original-payment service selection

Balance reads capture the trusted deployment's canonical `config.networkId` at
module initialization. Both session credit/grant checks and the settlement-parity
watchdog use that profile's fixed Circle balances origin and Arc domain. Domain 26
is shared by Arc testnet and mainnet: a domain match cannot establish which rail
owns the funds. Redirects are refused so a selected service cannot redirect a
balance or transfer request onto another rail.

Pending x402 reconciliation selects its Circle service from each retained
`PaymentRecord.network`, independently of the current deployment environment.
Restarting or changing the configured rail does not relabel originals. Only exact
`eip155:5042002` and `eip155:5042` identifiers select the immutable public profiles;
unknown networks refuse rather than defaulting to a service. The legacy exported
testnet transfer URL remains a reference and is not the runtime search selector.

Every next-page link must match the captured original service origin and transfer
path. Missing, duplicate, malformed or cross-service cursors refuse the whole
search, even if an earlier page contained a match. The existing 20-page bound,
date/payer/payee/network/token filters, and exact nonce, payer, payee, both networks,
token and integer micro-USDC checks remain required. An empty complete search is
pending evidence; it never fails a payment or releases a session reservation.

Synthetic tests cover both service origins, deployment capture, opposite current
configuration and module restart, foreign cursors, exact tuples and retained
reservations. They perform no real Circle request, signing or settlement. Circle's
[official Gateway reference](https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-gateway/SKILL.md)
was checked on October 2, 2026 for the distinct mainnet/testnet service origins.

This shared server boundary applies to web/API credit and grant admission, browser
funding/recovery tools, treasury backing checks, CLI funding/recovery and parity
inspection. Desktop, extensions, remote/stdio MCP and bots require separate
selected-profile and adapter acceptance; this patch changes no distribution
protocol or client network enrollment. Their full profile migration,
original custody recovery, isolated storage, actual SDK settlement/withdrawal and
release acceptance remain owned by the integrating mainnet work. It grants no
mainnet activation or funded-spend permission and claims no synchronized deployed
package or installer release. Legacy configuration continues selecting testnet.
