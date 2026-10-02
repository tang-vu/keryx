# Full public mainnet operations and distribution

October 2, 2026: the owner requests full ordinary mainnet Keryx on `keryx.cc`,
including supported clients and creator payments. Earlier invited-pilot proposals
are superseded. Their tests remain isolation evidence, not mainnet settlement.
No concrete funded operating budget or production mainnet activation is approved.
Production remains Arc testnet until the coordinated release and owner funds gates pass.

## Trusted deployment selection

Set BOTH `KERYX_NETWORK=arc` and `NEXT_PUBLIC_KERYX_NETWORK=arc` for mainnet.
Both unset retains testnet; both `arcTestnet` explicitly selects it. Partial or
mismatched labels refuse payment startup. Mainnet requires equal, nonzero
`KERYX_REGISTRY_ADDRESS` and `NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS`, pointing to the
fresh verified mainnet registry. Configure matching read-registry twins if used.
The browser build captures its public label; rebuild after changing the pair.
Apply the same pair to standalone CLI/MCP, workers, cron and monitoring commands.
Seller challenges, saved journals and request fields cannot choose the rail.

Canonical mainnet is chain 5042 (`eip155:5042`), ERC20 USDC has six decimals,
and native gas has eighteen. The shared profile pins Gateway contracts and SDK
endpoints. Read-only manifest/proxy evidence is documented in
[the Arc probe](arc-mainnet-readonly-probe.md); it does not prove live settlement.
Mainnet has no inferred WebSocket URL: the indexer uses its HTTP polling path.

## Full supported-surface matrix

| Surface | Ordinary mainnet role | Isolation and required release evidence |
| --- | --- | --- |
| Web research, login, wallet funding and session worker | Owner-authenticated session co-signing through the normal `/api/ask`, `/api/ask/sign` and `/api/session/grant` routes | Fresh owner/origin/network custody; separately signed grant consent; original nonce/cap reservations, uncertain settlement retention and cashout acceptance. Testnet session keys/ciphers are retained for recovery, never reused as mainnet grants. |
| Creator web, source API and citation API | Creator-signed fresh registry registration; source-owned payout and exact weighted citation rewards | Fresh registry receipt/runtime/source verification, feed/content rights, fresh source cache/encryption and actual reward/withdrawal receipts. No testnet cache becomes mainnet payout authority. |
| Public paid A2A and private buyer checkout | Existing caller-funded inbound toll and durable job/recovery contracts | Shared selected-profile challenge and signature binding, fresh orders/journals, exact original GET recovery and private checkout/logout acceptance. |
| Buyer CLI, private CLI and Operator CLI | Deliberate caller-funded purchase, then inspection/recovery/export of original jobs | Both network labels; existing owner price/fee caps remain. New private state directory for mainnet. Historical testnet jobs remain identifiable and recoverable with their original profile; no ledger relabelling. |
| Local stdio MCP | Caller-owned wallet, exact inbound x402 toll, bounded approval/deposit and original-attempt recovery | Source candidate `keryx-mcp` 0.4.0. Default mainnet custody/journals live under `~/.keryx/arc`; testnet stays under `~/.keryx`. v2 journals bind network and payment origin; legacy unlabelled/v1 files mean testnet. Packed installed stdio acceptance covers both profiles, actual SDK signature verification, response-loss fencing and new-process keyless recovery; network responses are synthetic. npm publication is separately verified. |
| Remote MCP `/mcp` and OpenAI action | Existing hosted API-key/server-budget research role; shared server payment paths | Hosted services use the same selected environment and fresh treasury state. Their independent protocol identity remains separate from the caller package version. No new caller key is sent to the server. |
| Windows Tauri desktop | Local task creation, explicit buyer handoff, receipt inspection and exports | Desktop 0.4.0 source candidate adds explicit task-network selection and matched-label CLI handoff; it has no native wallet signer or autonomous scheduler. Preserve this role; verify the invoked buyer's selected labels and new state. Exact installer/build assets and standard-user handoff acceptance remain distribution gates. |
| Chrome extension | Thin selected-text research/API adapter and creator-listing handoff | Existing ZIP source version 0.1.1 research calls the OpenAI-compatible hosted treasury/free-tier API; it does not hold a caller key. Creator listing opens the normal wallet registration page. Verify hosted sponsor admission, selected-network/payment-mode responses and listing handoff; repack exact source if adapter metadata changes. Store publication is separate. |
| Telegram, Discord and Slack | Existing hosted bot-key and budget-limited research adapters | Shared server treasury policy and fresh environment, explicit real/offline/payment state and links to dispatch evidence. Do not add bot-held caller/session keys or imply bot messages independently approve treasury spending. |
| Headless web driver | Owner-operated normal wallet/session flow, tagged self-generated engine activity | Shared normal custody/grant/signature contract migration and retained funding/payment barriers are required. Testnet faucet behavior cannot fund mainnet. Its runs do not establish external traction. |
| Treasury/registry/dispatch/settlement/reconciliation monitors, workers and withdrawal relay | Selected-network operational reads or existing explicitly configured execution roles | Fresh state/custody, signer/chain attestation, required operator authorizations, private worker drain, held uncertain attempts and observed service environment. No scheduler or relay is enabled merely by code deployment. |
| Historical testnet drills and grant media | Original-network recovery, synthetic acceptance and archived demo evidence | Keep the original chain labels and retained receipts. `register-onchain` cached-source backfill and TestMint are testnet-only; they refuse mainnet. They are not the new creator registration/import path. |

## Fresh registry and creator catalog

`npm run mainnet:unsigned-setup -- --help` reads no environment, key, database,
artifact or RPC. The offline command emits unsigned JSON to stdout only; it never
signs or broadcasts. Deploy mode binds the current full clean release commit,
including nonignored untracked source, and checks a curated Solidity 0.8.24,
Paris/optimizer-200 SourceRegistry artifact against the current LF-normalized
contract source before emitting creation bytecode. This is reviewed release data,
not an arbitrary local build artifact. Changed compiler/source/settings/bytecode
require a newly reviewed pin.

```sh
npm run mainnet:unsigned-setup -- deploy PUBLIC_DEPLOYER_ADDRESS FULL_RELEASE_SHA
npm run mainnet:unsigned-setup -- prepare PUBLIC_OPERATION_JSON FRESH_REGISTRY_ADDRESS FULL_RELEASE_SHA
```

A `register` operation contains `kind`, creator address, canonical HTTP(S) URL,
payout wallet, 1–20 `{wallet,basisPoints}` authors summing exactly to 10000,
`fetchPriceMicros` as a uint64 integer string, `contentCid` (128 bytes maximum)
and `tags` (256 bytes maximum). There is no invite list, proposed pilot budget or
pilot source-price ceiling. The actual deployment and registration must be signed
by the respective owner; matching public addresses are declarations, not proof.

A `fund` operation contains `kind`, owner address, distinct session signer and
positive uint256 `amountMicros` string. It emits exact USDC `approve` and Gateway
`depositFor(token,sessionSigner,value)` calldata. The owner must independently
compare the normal worker's fresh network/origin/owner-scoped signer. Its amount
is an operator declaration, not approval to spend. Native setup gas, fees/nonce
and subsequent research/session caps are separate. Existing protocol/session and
caller-configured limits continue to govern payments.

Before configuring the registry twins, verify the deployment transaction and
receipt on the fixed mainnet RPC, chain ID, exact deployed runtime-bytecode hash,
block/hash stability and published compiler/source provenance. Then use ordinary
creator registration, verify creator/payout/authors/price/active state and receipt,
and index a fresh catalog only after source/feed rights and content encryption
acceptance. Import public descriptions and creator-owned source identity through
this verified path; never import testnet payment/settlement/grant records as mainnet.

## Existing-host cutover, backup and rollback

1. Freeze an exact reviewed release and inventory current private runtime files,
   owner custodians, service names, selected environment and unresolved original
   transactions. Record redacted fingerprints rather than secrets. Preserve the
   existing `/root/keryx` checkout and owner-only backups outside it.
2. Drain PM2 `keryx` and `keryx-a2a-worker`, systemd private worker, indexer,
   reconciliation, withdrawal relay, scheduled engine and every cron writer.
   Preserve locks and pending original hashes/nonces. Do not clear uncertainty to
   create capacity. Make a consistent database snapshot plus encrypted content,
   treasury/source custody, withdrawal/funding journals, private worker state and
   environment/service configuration. Verify readable off-host backups privately.
3. Provision fresh mainnet storage identity, database, source catalog, content
   encryption and network-scoped treasury/funding/withdrawal journals using the
   shared server's mainnet storage contract. Never enroll/adopt the historical
   testnet database or copy its balances, signed headers or settlement records.
   Preserve old custody and read/recovery tools separately. No script should print
   or copy keys into release artifacts.
4. After the separately approved deployment/funding transactions and receipts,
   set the matched network/registry pair in the protected web, A2A, private worker,
   reconciliation/withdrawal and cron environments. Verify each effective profile;
   build and deploy the exact reviewed commit on the same `keryx.cc` domain.
   Start writers only after schema/identity and old-writer drain checks. Update
   outside-host health expectations for commit/network and confirm they observe
   the new instance; do not silence settlement/registry alarms to pass readiness.
5. Verify `/api/health` commit/network/database, normal SIWE/fresh grant and original
   payment recovery, creator receipt/index authority, one actual paid delivery,
   cited reward/reconciliation and withdrawal under the owner-approved budget.
   Check web/A2A/private worker, HTTP indexer, monitors and relay individually.
   Synthetic/native browser/packed package tests are transport and safety evidence,
   never funded acceptance or revenue.
6. Publish/read back the exact CLI/MCP tarball/npm and applicable desktop/extension
   assets, recording versions and checksums; verify hosted APIs against that source.
   A source version bump does not establish package or installer publication.
   Publish a product update only after the coordinated deploy succeeds; use
   settled figures only when real evidence supports them.

Rollback first stops every new mainnet writer. Preserve the mainnet database,
custody, pending attempts and recovery configuration; reconcile originals on
mainnet instead of replaying them on testnet. Restore the prior testnet code,
matched labels and historical testnet state only as an independent instance.
Existing funded mainnet users require their recovery/cashout path even if new
research admission is disabled. Changing a source SHA cannot undo external
authorizations or Gateway deposits.

## Current evidence and remaining gates

Selected-profile source, offline bytecode/calldata preparation and local synthetic
journal checks are preparation evidence. Real fresh registry deployment, catalog
authority, owner-funded acceptance, coordinated host cutover and exact distributed
package/installer publication remain open. The last verified production preparation
deployment was `0cddd01981ea4a5d5f10aaaa4633d6555edc0922`, operational on Arc testnet;
it does not establish the current release's deployment. Current published versions
must be read back at release time rather than inferred from this matrix.
