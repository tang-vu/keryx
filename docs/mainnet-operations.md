# Full public mainnet operations and distribution

October 2, 2026: the owner requests full ordinary mainnet Keryx on `keryx.cc`,
including supported clients and creator payments. Earlier invited-pilot proposals
are superseded. Their tests remain isolation evidence, not mainnet settlement.
The owner has authorized the full public mainnet direction. Concrete registry
deployment, native setup gas and ERC20 funding amounts or wallet transactions remain
unspecified and unperformed. Production remains Arc testnet until the coordinated
release and those concrete funding/receipt gates pass.

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
| Research Monthly | Ordinary prepaid research and immutable slot redemption through web, API, CLI and remote/stdio MCP | Current main adds Monthly0078; its selected-rail purchase admission and fresh-state integration must be composed with the final backend. Historical enrolled adapters deliberately refuse this domain. Never relabel a testnet Monthly debit or remaining slots as mainnet. |
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

## Private economics across retained networks

The private economics command selects the sealed storage identity, with an
explicit read-only enrolled adapter for mainnet. It never initializes storage or
falls back to `data/keryx.sqlite` for mainnet. Recorded mainnet payment rows must
carry their original network and settled rows their recorded settlement evidence;
a report refuses conflicting rows instead of relabelling them. Mainnet exports
use `keryx-private-economics-v3`, an explicit network and `ledger` aggregates.
Historical testnet exports retain their exact v2 shape and `testnetLedger` field.

Usage price intervals and hypothetical service fees remain estimates. Recorded
settlement observations are not reconciled invoices or realized profit. Native
SQLite read-only projection tests use synthetic evidence and preserve file bytes;
they do not establish enrolled mainnet admission, funded settlement or native
Supabase acceptance. The coordinated server sealed-SQLite migration must land before
mainnet report acceptance; optional native Supabase mainnet remains staged, and the protected Linux publisher still needs its
release-platform checks.

## Normal authenticated headless web client

`npm run web -- --help` is keyless. Both network labels select the entry point;
legacy testnet wallet/faucet behavior remains in the explicitly testnet driver.
Mainnet `prepare`, `status`, `recover` and `ask QUESTION BUDGET_MICROS CAP_MICROS`
use dedicated `KERYX_HEADLESS_OWNER_PRIVATE_KEY`, `KERYX_HEADLESS_WRAPPING_KEY`
and `KERYX_HEADLESS_STATE_DIRECTORY` in a protected environment file. Owner and
wrapping keys must differ. The existing private state directory must be owned by
the current user: Unix permissions exclude group/other access; Windows uses an
actual owner-only protected DACL (current user, trusted SYSTEM/Administrators).
Keys are never stored in the SQLite state. Keep its encrypted funded session
ciphertext, exposure history and wrapping environment together in verified private
backups. Lost wrapping custody can lose access to deposited funds; host owners,
administrators and cloned state remain outside this local protection boundary.

`prepare` retains the first encrypted signer and prints only public funding
identity. `status` never creates missing custody. Owner funding is a separate exact
approve plus Gateway `depositFor` transaction using the unsigned setup helper; the
mainnet web driver sends no faucet, EOA gas-funding, approval or deposit transaction.
The ordinary mainnet ask path signs SIWE and exact owner/session grant consent,
then consumes the shared browser authenticated journal/registry/preview payment
policy. It ignores SSE payment tuples and validates the original authenticated
challenge instead. It durably commits unique nonce exposure before signing and an
encrypted header before the paid POST. Nonces and cumulative exposure survive
process restart and grant replacement. Configure the normal bot identity for
operator-owned self-driven runs; do not count them as external product traction.

Uncertain original attempts remain held. Read-only recovery uses the ordinary
`/api/session/authorizations/{reqId}` endpoint and verifies original owner/session
signatures, nonce, epoch, network, amount and cap. Expiry/revocation cannot erase
this view. Only a recorded settled original with its settlement evidence receives
a local terminal proof; this never deletes the nonce or restores lifetime capacity.
Another ask remains refused while any original is uncertain. Per-ask client UUID
and integer budget are atomically retained with lifetime sum and unique nonce in
one SQLite transaction before signing; a larger grant cannot enlarge that question.
The owner-supplied cap is absolute cumulative signer capacity, including history. Windows tests
exercise actual native SQLite, DACL checks, WebCrypto and EOA signatures with
hermetic API/registry responses; they prove neither live settlement nor host
power-loss, distributed clone exclusion or installer acceptance.

The normal headless v2 state retains the detached authenticated original challenge and
SHA256 of its canonical payment requirements in the same atomic reservation as the
question budget, cumulative cap and nonce, before cryptography. Recovery requires the
same original requirements, payer, payee, source and payment kind, plus both public grant
signatures. A retained server journal with a transaction hash is recorded server evidence;
this read is not an independently observed chain receipt. It grants no retry authority
and never refunds local exposure. Older unreleased v1 headless files are refused in place
with custody retained; the command never rotates their signer or adopts their ledger.

Headless control requests use a 60-second deadline; the complete research SSE has
a separate 10-minute deadline. A payment-leg refusal or lost sign acknowledgment
retains its original exposure and encrypted header, emits a fixed concise stderr
notice, and continues to the completed answer. It never signs that original again
or clears uncertainty. Malformed SSE/protocol data still fails the run.


## Cashout deployment policy

The normal mainnet cashout worker captures
`NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS` at build time. Its server admission
requires the identical positive integer in `KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS`.
Choose this exact block window from reviewed current chain/expiry evidence and the
owner's withdrawal policy before deploying cashout; this runbook supplies no guessed
Arc block-rate limit. Missing or mismatched values close cashout only. Changing the
public value requires rebuilding the worker and checking the effective server twin.

A prepared unsigned withdrawal remains cancellable only before native exposure,
signed-request admission or claim. Native authorization marks exposure before
cryptography. Any exposed, signed, submitted or unknown original remains retained
and holds its financial barrier until exact observed completion; a timeout does
not cancel it. Final headless cashout consumes the same independently checked
normal withdrawal policy when that shared client domain is frozen.

## Package publication boundary

The October 2 13:56 UTC registry read reports `keryx-mcp` npm latest 0.3.2,
independently published before this 0.4.0 source candidate; source version numbers
alone do not prove publication. Current main's publishing workflow uses
npm Trusted Publishing through GitHub OIDC and environment `npm`; local npm login
or a token secret is not required by that workflow. An earlier relative tarball
path failure is corrected by PR132, and that independent publication propagated successfully. The corrected workflow
now waits for public registry readback; the final 0.4.0 candidate still needs its
own exact tarball/integrity/clean-consumer evidence.

Use the reviewed exact tarball, clean-consumer checks, registry integrity comparison
and successful authorized workflow as npm publication evidence. Retain the immutable
GitHub release tarball plus source commit/hash manifest as a supported distribution
channel. Its `npmRegistryPublished` flag must match observed publication. Do not claim
that installer, tarball and npm versions are synchronized from source numbers alone.

## Owner wallet registry deployment handoff

The owner uses their existing personal wallet. Public deployer:
`0xca5b29b4f8bfbbd027ddc8516914a262f7ef6478`. No personal private key, recovery
phrase or hardware-wallet secret is imported into Keryx, Remix or chat.

From the exact clean reviewed release, prepare a fresh public folder:

```text
npm run mainnet:unsigned-setup -- workspace <public-deployer-address> <full-release-commit> <fresh-absolute-output-directory>
npm run mainnet:unsigned-setup -- verify-compiled <public-compiler-output-json> <full-release-commit>
```

Import the folder into [Remix](https://remix.ethereum.org). Keep the exact
`contracts/source-registry.sol` path, Solidity `0.8.24+commit.e11b9ed9`, optimizer
enabled with 200 runs, and Paris EVM. The exported compiler result must match
reviewed creation bytecode, deployed runtime, ABI, source hash and compiler settings
before proceeding. The helper accepts standard solc output or Remix's exported
contract artifact; it never connects a wallet, signs or broadcasts. Existing or
redirected output directories and symlink/junction parents refuse.

Use Remix's Browser Extension or WalletConnect environment with the existing
wallet. Both require an explicit wallet approval; see the [official connected-wallet
workflow](https://remix-ide.readthedocs.io/en/latest/run.html). Verify account, chain
5042, creation data and value zero against `registry-review.json`. A read-only
chain/nonce/balance/gas observation supplies a separate time-bound proposed fee
ceiling for owner review. Native gas and ERC20 balances are two encodings of the
same user-facing USDC asset, not two funding pots. No deployment transaction can
run from the currently observed zero balance.

Stop before wallet approval until the exact native-USDC funding and maximum
deployment charge are reviewed. After owner signing, retain transaction and final
receipt, attest chain 5042 and exact deployed runtime, then pin the fresh registry
in the coordinated release. Normal creator `/register` and bulk feed registration
use each creator's connected wallet afterward. Source/feed rights and mainnet
receipts remain required; old testnet catalog or payout caches are never relabelled.
