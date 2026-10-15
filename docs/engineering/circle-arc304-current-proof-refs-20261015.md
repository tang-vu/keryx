# Issue 304: current public proof and official references

Native observations and parent public-document reads dated October 15, 2026 UTC,
against source baseline
`1476962c3ca68c1e0614aaf0352c69ae90f09fac`. This supplements the
[integration ledger](circle-arc-integration-ledger.md) and preserves the dated
[earlier acceptance map](circle-arc-304-acceptance-2026-10-13.md).
[Issue #304](https://github.com/tang-vu/keryx/issues/304) was read through the
GitHub connector: it is open, with the CI path-check and gasless-evaluation
criteria checked, the other three criteria unchecked, and no comments.

**Native raw results: 0 accepted working proofs, 0 observed public HTTP failures,
12 UNKNOWN results caused by local transport failure.** None establishes an
outage, a deployed identity, current contract state or settlement. All five existing
`Live` statuses preserve their dated, narrow demonstrated-use semantics. Current
working-link verification remains **UNKNOWN**; that is not evidence of a change
in implementation or activation. Existing Planned, Not used and Testnet only rows
also keep their statuses. Parent document reads below add official reference facts
and a cached proof-page observation, without supplying current raw runtime acceptance.

## Read scope and observations

Only exact URLs already present in the ledger or its earlier acceptance map were
attempted: 10 Keryx/explorer proof URLs and two primary official references.
The bound was 32 exact URLs maximum, 10 seconds per URL including redirects,
1 MiB maximum response body and four redirects maximum. Actual native results
used 12 GET attempts, no retries, zero redirects, zero request/body bytes and
approximately 2.02-2.04 seconds of transfer time per URL.

The initial output-only PowerShell collector was refused before any request:
`PSSecurityException / UnauthorizedAccess`, because scripts are disabled. The
policy remained Restricted. Direct installed `curl.exe` 8.13.0 then attempted the
GETs using inherited routing and normal certificate verification. Per-user curl
configuration was not loaded, to avoid implicit credentials. Every attempt exited
7 while connecting to the configured local proxy at `127.0.0.1:9`. No direct-route,
proxy, TLS, authentication, login, execution-policy or approval override was used.
The run stopped at these 12 exact URLs; no browser or alternate-route retry was
attempted.

For every row below, the HTTP status and accepted final URL are **unavailable**.
Curl's numeric status `0` means no HTTP response; it is not an HTTP status from
the public service. Its effective URL equals the requested URL below, with no
observed redirect, and does not establish arrival at that URL. There is no body
hash because no response body was received.

All observations bind the full raw pre-edit ledger SHA-256:
`114e80698e08b9d44470340204e746444a421bec9747f494a0f7b371d56e2649`.
UTC timestamps are the local completion times of actual native attempts.

| ID | Requested / curl effective URL; accepted final URL unavailable | Observed UTC | Result |
| --- | --- | --- | --- |
| U01 | [Public health](https://keryx.cc/api/health) | `2026-10-15T06:46:56.6907734Z` | UNKNOWN |
| U02 | [Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc) | `2026-10-15T06:46:56.5627352Z` | UNKNOWN |
| U03 | [Circle Gateway contract addresses](https://developers.circle.com/gateway/references/contract-addresses) | `2026-10-15T06:46:56.4583475Z` | UNKNOWN |
| U04 | [Served proof page](https://keryx.cc/proof) | `2026-10-15T06:48:02.7878064Z` | UNKNOWN |
| U05 | [Public treasury](https://keryx.cc/api/treasury) | `2026-10-15T06:48:08.4727453Z` | UNKNOWN |
| U06 | [Exact citation receipt](https://keryx.cc/api/dispatch/3d91fed3-dbaa-42b4-9970-db218b9f3f8a/receipt) | `2026-10-15T06:48:14.3616294Z` | UNKNOWN |
| U07 | [Exact access receipt](https://keryx.cc/api/dispatch/9d6d9d80-79b4-460e-bf0d-6f9c5e220c3f/receipt) | `2026-10-15T06:48:23.2153804Z` | UNKNOWN |
| U08 | [Exact retained mainnet V1 registry](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb) | `2026-10-15T06:48:28.8743074Z` | UNKNOWN |
| U09 | [Mainnet USDC address](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) | `2026-10-15T06:48:34.6372486Z` | UNKNOWN |
| U10 | [Retained owner-funded testnet mint](https://explorer.testnet.arc.io/tx/0x5cee615d7a5ffac3ae7caf4257343483b8a7c08315b4276a727cea3c14a4e257) | `2026-10-15T06:48:42.9829307Z` | UNKNOWN |
| U11 | [Retained fixture-publisher registration](https://explorer.testnet.arc.io/tx/0x4b29ca0be1b7379abf28f9ea942f07ed097493bf8d1ee5283d2d2af9b660f966) | `2026-10-15T06:48:48.2547608Z` | UNKNOWN |
| U12 | [Public Circle Wallets configuration](https://keryx.cc/api/auth/circle/config) | `2026-10-15T06:48:53.6712106Z` | UNKNOWN |

The raw native records are retained in this worktree's local
`output/current-proof-link-observation/`: `U01.json` through `U12.json`, their
stderr files, `observations.json`, the script-policy refusal and the GitHub issue
read. The compact observations include URL, null HTTP status, effective URL,
null accepted final URL, UTC, source hash and each raw receipt's SHA-256.
The original raw records and earlier handoff remain unchanged. Corrected raw
before/after documents, inverse patches and pins are retained in its
`corrected-attribution/` subdirectory for parent review; that handoff supersedes
the earlier recommendation to downgrade the five dated Live rows.
These local files are review evidence, not public proof links or CI acceptance.

## Current verification of the dated Live claims

The rows keep their original statuses. The supporting reads below are the remaining
current working-link checks from the original acceptance map, not a new status policy.

| Ledger row | Required current supporting read | Tracking |
| --- | --- | --- |
| Circle Gateway | U05 must return the actual mainnet observation with `via=circle-gateway-api`, `observation.network=eip155:5042` and `paymentReadiness=not-probed`. A balance does not prove a payment can execute. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Gateway nanopayments | U06 must retain real, settled, complete `eip155:5042` evidence for 0.025 USDC and Circle reference `19e49c04-93eb-4ddd-b9f2-b4a6be7c155e`. A 200 response without that content is insufficient. | [#252](https://github.com/tang-vu/keryx/issues/252) |
| x402 batch facilitator | U07 must retain real, settled, complete mainnet evidence for 0.002 USDC and Circle reference `ed41ddfb-5967-4b24-8064-dc0c6a2d9fd9`. This evidences the retained Gateway batching flow. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| Arc contracts: SourceRegistry | U08 must identify the exact mainnet V1 contract. U01 must identify the selected deployment/registry separately. A selected V3 or a working address page does not establish fresh payout parity, migrate V1 origins or prove a sponsored registration. | [#304](https://github.com/tang-vu/keryx/issues/304) |
| USDC | U07 must support actual USDC usage and U09 the exact mainnet token address. Official reference values alone do not establish a Keryx payment. The same access receipt is reused across layers and counted once. | [#304](https://github.com/tang-vu/keryx/issues/304) |

Keryx receipts remain Keryx public projections, not independent reads of Circle's
transfer database. Circle UUIDs are not Arc transaction hashes. U10 retains an
owner-funded mint claim; U11 retains a real financial rehearsal with fixture
publisher claims. Neither supplies genuine sponsored-user/browser acceptance.
U12 configuration availability would not prove a created or funded user wallet.

## October 15 parent document reads and retained references

U02 and U03 supplied no native public response; those raw observations remain
UNKNOWN. Separately, the parent read public documents at
`2026-10-15T07:37:26.327Z` and supplied
`parent-current-official-reference-facts.json` in the authorized parent preparation
directory. Its exact bytes are retained in `corrected-attribution/`. The official
Arc and Circle facts below come from those parent reads, not a retry by this author
or a reinterpretation of the failed native attempts. Other official reference scopes
keep their earlier dates. No runtime network profile or endpoint migration is changed.

The parent also obtained [the public proof page](https://keryx.cc/proof), with
cache crawl metadata two days old. This establishes reachable document evidence
only; it is not a fresh raw HTTP receipt, current served-link acceptance or
transaction proof. The parent's [treasury read](https://keryx.cc/api/treasury)
returned an internal reader error, leaving current runtime availability **UNKNOWN**.
Neither observation proves absence, deactivation or planned implementation.

| Reference scope | Primary source and network boundary | Current acceptance |
| --- | --- | --- |
| Arc chain/RPC/explorer | [Arc connection parameters](https://docs.arc.io/arc/references/connect-to-arc): mainnet `5042`, primary RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`; testnet `5042002`, primary RPC `https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`. Blockdaemon is listed separately. | October 15 parent official-document read confirms these vendor reference facts; U02 remains native transport UNKNOWN. No runtime/RPC acceptance. |
| USDC contract and units | Retained [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses) for the token address and six ERC-20 decimals; October 15 [Arc connection reference](https://docs.arc.io/arc/references/connect-to-arc) for 18-decimal native USDC gas. | Parent confirms the native gas unit; token address/six-decimal provenance remains the earlier dated reference. No Keryx transaction established. |
| Gateway Wallet/Minter/domain | [Circle contract addresses](https://developers.circle.com/gateway/references/contract-addresses): mainnet Wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, Minter `0x2222222d7164433c4C09B0b0D809a9b52C04C205`; testnet Wallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, Minter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`; domain `26` for both. | October 15 parent official-document read confirms these contract/domain reference values; U03 remains native transport UNKNOWN. No runtime code or transaction authentication. |
| Gateway service bases | [Circle OpenAPI](https://developers.circle.com/openapi/gateway.yaml) and [balance reference](https://developers.circle.com/api-reference/gateway/all/get-token-balances). | No fresh read. Mainnet base confirmation remains UNKNOWN; no balance POST was made. |
| Wallets chain/service | [Supported blockchains](https://developers.circle.com/wallets/supported-blockchains) and [initialization reference](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-with-pin-challenge). | No fresh read. Mainnet key/environment pairing and actual wallet proof remain UNKNOWN; no authenticated API call was made. |
| Onramp environments | [Arc hosting requirements](https://docs.arc.io/app-kit/references/onramp-hosting-requirements), separating production and sandbox widget/API origins. | No fresh read or purchase evidence. |
| Gas Station / Paymaster | [Gas Station contracts](https://developers.circle.com/wallets/gas-station/contract-addresses), [policy management](https://developers.circle.com/wallets/gas-station/policy-management) and [Paymaster overview](https://developers.circle.com/paymaster). | Retained evaluation only; no fresh support/address/billing claim or Keryx use established. |

Official documentation can establish a vendor address or reference; it cannot
establish that Keryx settled a payment or used a tool. Application-owned registry
deployments need their own exact-network deployment/source/receipt evidence.

## Open criteria and parent handoff

| Original issue criterion | This pass and remaining action |
| --- | --- |
| Ledger, README/proof links and working proof for every Live row | Existing source links and the five dated Live claims are preserved. Native U04 and every attempted proof remain UNKNOWN. Parent's two-day-old proof-page cache is document evidence only; current working-link acceptance remains open. |
| Path check in CI | Previously checked in the issue. Guard implementation is preserved. Parent must run the existing ledger guard on these edited docs and obtain actual required prose-PR CI. No project test/build/guard was run here. |
| Gasless evaluation, policy limits and abuse controls | Previously checked in the issue; preserved. Established Gas Station-sponsored user actions and approved additional Gas Station liability remain zero. The separate retained Keryx relay history is not erased or treated as unused allowance. |
| One sponsored user action end to end on testnet | Still unmet under current owner direction. No transaction, UserOperation, simulation or sponsored action was executed. Fixture publishing claims and owner-paid mint gas do not close this criterion. |
| Official addresses for each network | October 15 parent reads confirm Arc connection/native-gas and Gateway contract/domain reference facts for both networks. Other scopes keep their earlier dates; fresh mainnet Gateway service-base and Wallets mainnet key/environment confirmation remain UNKNOWN. The original criterion stays open. |

All proposed sponsorship limits remain unapproved/unimplemented. Existing abuse
controls, first-operation and billing gaps, finite gas reservations, consumed
attempts, expired allowances and ambiguous-outcome holds remain as recorded in the
ledger. No new funding, spending, custody, login, product policy or schedule is
authorized by this note. Full #304 closure is not claimed.

The source changes are limited to the ledger and this note. README, proof-page
runtime, CI checker, older issue-304 worktrees and their retained evidence remain
with their existing owners. Web/API, desktop, CLI, remote/stdio MCP, extensions and
bots keep their existing contracts and funding roles. No package/version/deploy
action follows from this prose-only outcome.

Parent owns the distinct accuracy review, existing ledger guard, one coherent
focused prose PR, required aggregate/domain CI and the existing merge queue under
`root/distribution63_review`; the sole release owner retains production authority.
The corrective author performed no new network, database, provider, project check,
test, compiler, build, Git write, commit, push or production operation. The existing
ledger guard, independent review and required prose-PR CI are **UNRUN** by this
author and remain with the parent. Current public and genuine-user evidence remain
open after a documentation merge.
