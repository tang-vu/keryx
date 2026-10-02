# Mainnet runtime domains

The owner directed **full public mainnet Keryx** on October 2, 2026, on the existing
keryx.cc domain. The initial invited browser pilot was superseded. This document
tracks the coordinated source candidate; it does not assert a deployed mainnet
service, published package, installer acceptance or real funded settlement.

Trusted deployment configuration selects Arc mainnet (`arc`, chain 5042) or Arc
testnet (`arcTestnet`). `KERYX_NETWORK` and `NEXT_PUBLIC_KERYX_NETWORK` must match;
both unset preserve testnet. Request/challenge fields cannot choose the signing
rail. Mainnet registry twins must match the fresh verified registry. Payment-only
CLI/MCP funding and recovery use the pure selected profile without dummy registry
configuration. Retained histories use their original network and never acquire
mainnet authority by changing an environment label.

The [Arc connection guide](https://docs.arc.io/arc/references/connect-to-arc) and
[Circle contract reference](https://developers.circle.com/gateway/references/contract-addresses)
were checked October 2. Native gas/balance values use 18 decimals and ERC-20 USDC
uses 6 decimals for the same user-facing USDC balance. Mainnet Gateway contracts,
Circle service origin and RPC are independently pinned; the explorer is
`https://explorer.arc.io`.

## Coordinated public release matrix

| Surface/domain | Candidate support and authority | Remaining acceptance/release boundary |
| --- | --- | --- |
| Web research and session payments | Normal SIWE owner routes, selected-profile worker, exact original challenge/source/item authority, durable lifetime and per-question reservations before cryptography; owner/network/origin custody retained across logout. | Final composed route/worker/SQLite checks and real funded settlement/delivery evidence. No arbitrary worker transaction interface. |
| Public source/citation API and creator publishing | Fresh selected registry is payout authority; ordinary connected-wallet registration/listing updates and selected seller SDK. | Owner-reviewed registry creation, exact deployed runtime receipt and creator-owned source import; no testnet payout cache import as authority. |
| Browser and creator cashout | Original owner/signing generation, native exposure/cancel barriers and original burn/mint/finality policy; owner wallet pays setup gas. Expiry/revocation cannot erase custody/history. | Composed original recovery/cashout acceptance and concrete owner transaction review; missing reviewed block-ahead policy closes cashout. |
| Public A2A, sponsored web, private hosted research | Separate reviewed public/private dedicated custody policies, sealed native writer, lifetime/query exposure and fixed selected SDK. No implicit legacy-key fallback or automatic funding executor. | Concrete prefunding/policy caps/expiry and hosted worker/spool admission; current capacity projection is not future escrow. |
| Research Monthly | Four manual Deep requests/30 days, selected v2 native purchase/claim, actual key-address and current per-run capacity before checkout; exact slot/job replay survives disabled admission. | Final composed native API acceptance and real receipt. No reservation/escrow of all four future runs, schedule or automatic renewal. |
| CLI and stdio/remote MCP | Selected-profile shared TypeScript buyer, HTTPS merchant transport, immutable original-network journals, exact installed/packed dual-rail synthetic checks. Headless session caller uses shared browser admission plus durable local question/lifetime/original tuple reservations. | Final package/HTTP integration and real publication integrity/readback. Headless residual cashout must be separately documented/proven; discovery/web handoff does not grant treasury authority. |
| Desktop Operator | Selected TypeScript task creation and original-network read-only/recovery; retained history preserved. Native Rust role boundaries remain explicit. | Final clean packed graph and actual supported native entry/installer acceptance; a JS bundle is not installer proof. |
| Browser extension, Telegram/Discord/Slack adapters | Existing ordinary research routes consume the coordinated selected shared client; Monthly uses web handoff. No duplicate financial writer or hidden scheduler. | Exact distributed adapters/version release and deployment checks; no blanket testnet-only restriction on supported mainnet adapters. |
| Experimental scholarly rights | Supervised testnet rights protocol remains staged; mainnet paid-manuscript enrollment/purchase is refused before spending. Ordinary publishing remains supported. | Separate rights-domain migration and acceptance, independent of ordinary public mainnet release. |
| Optional Supabase and Rust finance | Supabase mainnet authority and shared Rust financial engine remain staged/fail-closed. | Independent native source-derived schema/authority acceptance and a specific cutover. Fresh sealed SQLite is the supported production target. |
| Operations | Existing domain; fresh sealed SQLite, separate keys/state, drain/backup/restore, selected monitors/indexer/reconciliation and original-network liabilities. | Final exact source/CI/review, owner transaction inputs/receipts, service/env preservation and deployed health. No ledger relabelling or automatic real funding. |

See [operations](mainnet-operations.md), [server runtime](mainnet-server-runtime.md)
and [Monthly](research-monthly.md) for concrete contracts and commands. The owner
has authorized the public-mainnet direction. Registry gas, owner wallet transactions
and hosted USDC funding amounts remain concrete financial inputs to review; source
preparation is not a receipt or proof of profitability/traction.

## Historical preparation components

The initial candidate-manifest and invited browser enrollment proposals are retained
as historical preparation, not the public runtime protocol. Their isolated signer
helpers and bundled Chromium/IndexedDB/WebCrypto checks proved context/ciphertext
isolation under synthetic inputs. They did not enable the normal public endpoints or
establish settlement. Ordinary custody now uses the reviewed owner/network/origin
context and retained ciphertext; it does not depend on a repeat-signature backup.

Non-exportable wrapping keys prevent exporting key bytes, but same-origin script
can obtain an IndexedDB CryptoKey handle and decrypt ciphertext it can access.
Worker heaps/namespaces are not an XSS security boundary. A script observing the
wallet derivation signature can also derive the session key. These residuals remain
explicit; synthetic acceptance never establishes real funded settlement.
