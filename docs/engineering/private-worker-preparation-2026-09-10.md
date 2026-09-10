# Private worker operational preparation

Prepared against deployed code `076b208` on September 10, 2026. This is preparation,
not private checkout activation or mainnet readiness.

## Observed configuration

- Created distinct testnet merchant and treasury EOAs plus an independent 32-byte result-spool
  encryption key. Secrets are confined to ignored environment files. The local wallet/key backup
  has an explicit ACL for the current Windows user; the remote environment is mode 0600 and the
  dedicated result directory is mode 0700. The initial encrypted SSH transfer was checked for exact
  content equality before provider configuration was added on the server.
- Both private enable flags remain zero. Nothing was registered as a private PM2 service.
- The disabled configuration proposes a 100000-micro-USDC lifetime treasury ceiling and a
  20000-micro-USDC service fee for the initial testnet acceptance work. These are configuration
  values, not collected revenue or currently available private purchase terms. Backing was
  verified separately after funding, as recorded below.
- Runtime policy validation used the explicit existing DeepSeek credential and endpoint. Two
  distinct configured public signer addresses were checked for separation. This does not establish
  a complete inventory of every historical or file-backed signer.

## Read-only inspection and provider probe

The operations inspector was run with private research temporarily enabled only for that
inspection process. It reported no worker status, zero available Gateway micro-USDC, required
backing of 100000 micro-USDC, no treasury pool and `checkoutReady: false`. It did not create a
reservation, fund a wallet, sign a payment or start a worker.

A separate synthetic planning question was sent through the configured private reasoning engine
to its approved endpoint. Observed one provider-served planning result and one usage record, with
no provider failure, fallback or warning. No source/creator payment was requested. This is a single
planning probe, not full research-quality acceptance, sustained provider health or invoice reconciliation.

## Owner-funded testnet treasury

After the owner reported faucet completion, direct Arc testnet reads showed 20 native USDC,
20 ERC-20 USDC and zero Gateway USDC. Native and ERC-20 readings represent the same Arc asset
at different decimal scales; they are not additive balances.

The first bounded funding attempt stopped after durably recording approval nonce 0 as possible,
without returning a transaction hash. Subsequent latest/pending nonce reads were both zero and
the Gateway allowance was zero. Those observations alone were not treated as proof of rejection.
The original journal was preserved. Recovery used the same nonce and exact 100000-micro-USDC
approval, so the original and replacement approval could not both execute. The recovery recorded
each signed transaction hash durably before broadcasting; deposit followed only after the exact
approval transaction and receipt passed the existing funding verifier.

- Approval: `0xff1282d3b36ae3cedff62122d62d247e333bf2250cbf1f88a88af0ae746afe8e`.
- Deposit: `0x8cc92fe9576bcc8850620f958705b5c3cd7c4487b25594223a8c41f3e60ee2cd`.
- Both receipts were successful and checked with two confirmations, exact sender, target,
  calldata, value and nonce. Approval was limited to 0.1 USDC; no unlimited approval was used.
- Subsequent Gateway balance was 100000 micro-USDC. Native wallet balance was
  19.8969662827 USDC after the deposit and transaction fees.
- The operations inspector reported `treasury.status: backed`, required backing and unallocated
  capacity both 100000 micro-USDC, and no existing treasury pool. Worker status remained
  unavailable and `checkoutReady` remained false, so the inspector correctly exited nonzero.

This is owner-operated testnet funding, not a research purchase, creator payout or customer revenue.
The inspector's `chainFinalityVerified` remains false; its backing observation does not independently
verify settlement finality for future research jobs.

## Remaining activation work

The public application's reserved-merchant guard now includes this private payee, verified below.
Treasury faucet funding and the bounded Gateway deposit are also verified.
Private-worker supervision,
checkout admission readiness, result recovery under the intended operational configuration and
an owner-operated end-to-end testnet purchase remain outstanding.

## Controlled worker lifecycle drill

After funding, a real child process ran `scripts/private-research-worker.mts` on the VPS
against deployed commit `076b208a41325879a8a54f5fa363d44dc4456841`, with both enable flags
set only in the child environment. Before starting it, the database was checked for no
private treasury pool, no eligible worker candidates and no reconciliation candidates for
this treasury. The public private-purchase route remained unmounted.

The parent observed the actual child PID in a fresh idle status record, then ran the actual
operations inspector in a separate process. It exited zero with matched configuration/build,
idle phase and 100000 micro-USDC of available and required backing. It still returned
`checkoutReady: false`.

The worker completed a clean recovery sweep (two non-backup directory entries, zero restores
or errors), an empty reconciliation tick and an empty execution tick. Completed, stored,
claimed, unpersisted, provider and error counters were all zero. No paid research ran.
The parent sent SIGTERM to that same live child and awaited its exit: code zero, no terminating
signal, 31 ms elapsed after SIGTERM, and no stderr output. The resulting status was stopped,
mode 0600, and the cooperative lock was absent. Both persisted enable flags remained zero.

This proves startup, matching operational inspection and graceful **idle** shutdown for this
configuration on this host. It does not prove draining an active paid job, crash recovery with
a real encrypted result, supervisor restart behavior, public merchant-guard installation or
readiness to accept buyer payments. No daemon was left running by this drill.

## Public merchant guard installation

On September 10, the public environment's reserved-payee set was extended to include the new
private merchant. Existing entries were retained, collision validation passed, and a parsed
comparison verified every unrelated environment value was unchanged. An ignored mode-0600
environment backup was retained before atomic replacement. Private enable flags remained zero.

The host inventory covered six root environment files and both code-referenced wallet stores
(`data/wallets.json` and `data/spend-wallet.json`): ten environment key entries and twenty stored
wallet entries represented 22 distinct existing signers. Derived addresses matched wallet metadata;
none matched the private merchant or treasury. This inventory excludes external devices and
unreferenced backups, and does not make claims about their contents.

All seven public/private merchant regression tests passed. `npm run redeploy` then typechecked,
built and reloaded `origin/main` at `dc6f8f7`. At `2026-09-10T08:46:18.192Z`, the public health
endpoint reported that commit and `operational`. An unsigned public A2A quote returned 402 with
payment requirements. Three deliberately invalid, non-spendable payment payloads targeting the
reserved private merchant each returned the exact guard's 403 response and no payment receipt:
inner-only payload, full private-resource envelope, and a full envelope with public resource and
rewritten unsigned metadata. No valid payment signature was generated or submitted by this probe.

The unit tests establish rejection before facilitator invocation; the live HTTP probe establishes
the configured rejection response on the deployed public A2A endpoint. Other seller resources
share the tested guard but were not each exercised by this live probe. The private purchase route
remains unmounted, and this deployment does not activate a private worker or checkout.

The public application continues serving the deployed release. No private keys, provider credentials
or real customer inputs are included in this evidence document. The transaction hashes above are
public testnet evidence and expose the corresponding on-chain addresses.
