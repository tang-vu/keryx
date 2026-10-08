# Keryx MCP

Candidate 0.4.9 validates paid questions against the shared API's 2000-character
limit before loading custody or entering funding. `ask_keryx` advertises 3–2000
characters after trimming, using the server's JavaScript string-length convention.
Within the buyer handler, payment journals, pending funding journals and crash locks require
recovery first; MCP argument validation occurs before the handler. Recovery observes
the retained original query or transaction, without a new question or replacement
funding/payment. Publication and hosted deployment require separate verification.

Candidate0.4.8 adds keyless free `paper_lookup` before paid research. Retained
catalog is the default; repository lookup requires explicit opt-in. Exact version,
observation time and unknown metadata remain visible. See **Free paper metadata**
below. Published package and hosted deployment require separate verification.

Candidate 0.4.7 preserves explicit model output-limit diagnostics and bounded
guidance in research/recovery results. Historical 503s and token counters alone
do not establish truncation. It keeps existing paid-original polling/recovery and
spending authority. See [diagnostic scope and release gates](https://github.com/tang-vu/keryx/blob/main/docs/engineering/model-output-limits.md).

Candidate0.4.6 adds read-only `keryx_operator_status` with the shared public
business contract. Mainnet purchases explicitly request async execution and poll
only their original result for at most 90 seconds; pending/review/error outcomes
retain the existing journal for `keryx_recover`,never another debit. Existing
reasoning provenance and conservative fallback-input limits remain unchanged.
Verify release/npm acceptance for this archive before installation; publication
is separate from hosted deployment. The observations below are dated.


Keryx buys selected sources under a budget and returns a cited answer with creator-payment state.
The local stdio buyer pays the inbound x402 toll from a configured caller wallet on the independently configured Arc network.
Public production uses Arc mainnet (`eip155:5042`). Set BOTH `KERYX_NETWORK=arc`
and `NEXT_PUBLIC_KERYX_NETWORK=arc` in the MCP client's private environment before
connecting to `https://keryx.cc`; unset profiles retain the local testnet default.
See [current deployment and distribution evidence](../docs/mainnet-status.md).
A Circle settlement identifier is batching evidence, not an individual EVM transaction hash.
Testnet calls and owner-operated tests do not establish external traction or mainnet readiness.

Version 0.4.4 corrects Monthly discovery metadata for the configured Arc network.
It forwards the retained hosted answer and structured evidence. After an
accepted hosted deployment of the claim-grounding repair, evidence-bearing answers
contain qualified literal source excerpts and explicitly labelled quoted research
targets/gaps; arbitrary synthesis is withheld because marker-level support cannot prove
each assertion. High target coverage does not establish per-assertion entailment or a
complete useful synthesis: the answer retains an explicit Low/incomplete boundary.
Accepted excerpt citations remain eligible for creator rewards; paid-fetch debits,
source/version bindings and original settlement/receipt identities remain unchanged.
The coordinated economic repair accepts exact quoted micro-USDC budgets in hosted
async A2A. Remote sponsored research shares wallet/IP/global admission; creating more
keys adds no quota. The stdio caller still pays its own x402 toll and retains its own
original custody/recovery contract. Exact-source packed acceptance and publication
integrity are independent artifact gates. Check release manifests, npm integrity and
the hosted `/api/health` commit separately; a package does not switch the hosted server.

Hosted results can include `reasoningAttempts`, `reasoning.steps` and `reasoning.telemetry`.
The package forwards them and includes the recorded per-step serving summary in tool text.
For example, `decide: heuristic (degraded)` identifies local source selection even when other
steps used a model. The aggregate engine label alone does not identify each serving tier.
Older hosted responses without this metadata explicitly have unavailable per-step telemetry;
the package makes no extra inference request to reconstruct it. These fields do not change
caller funding, original payment recovery, source selection authority or evidence qualification.
Check hosted deployment and package publication separately before expecting this contract live.

## Research Monthly

Stdio 0.4.6 and the remote service expose read-only `research_monthly` discovery.
The four-request, 30-day package uses manual renewal and a 10% total-price
discount with unchanged creator caps. Failed and pending jobs retain slots.
Buy/redeem through the caller-wallet [web checkout](https://keryx.cc/research#monthly)
or shared API/Monthly CLI; existing MCP research tools remain separate jobs.
See the [Monthly guide](../docs/research-monthly.md).

## Remote MCP

The separately operated, treasury-funded remote service is `https://keryx.cc/mcp`.
It exposes `research` and `keryx_status`, applies server-side budget limits, and supports
ask-scoped API keys. The local package below has a separate caller-custody role.

```bash
codex mcp add keryx --url https://keryx.cc/mcp
```

See the repository's `docs/remote-mcp.md` for the remote trust model.

## Local stdio tools

| Tool | Behavior |
| --- | --- |
| `ask_keryx` | Buy research with an exact service fee plus creator-spend cap. Default deep mode is 0.05 + 0.05 = 0.10 USDC. Checks the independently configured seller, exact total, token and signing domain before signing. |
| `keryx_wallet_status` | Report configured caller custody and balances, or missing-custody/merchant-policy guidance. Never creates or replaces a wallet. |
| `keryx_recover` | Inspect the original saved payment or funding attempt. Performs reads; never submits another payment, approval or deposit. |

Version **0.4.0** changes local setup. Use Node.js **22.19+ in the 22 LTS line, or 24+**.
Builds use the repository's pinned npm 11.19.0 installer. Critical consumer dependencies are
pinned to Circle x402 batching 3.5.0 and viem 2.55.19.

On October 4, 2026, public npm readback confirmed `keryx-mcp` **0.4.3** and GitHub
release `v0.26.8` provided the matching tarball from `1297d43`. For this release
target, verify 0.4.6 publication and its exact source before installing. [Distribution evidence](../docs/mainnet-status.md)
records artifact identity separately from hosted health and payment availability.

```bash
npm install keryx-mcp@0.4.6
```

Configure your MCP client to run `node /absolute/path/node_modules/keryx-mcp/dist/keryx-mcp.mjs`.
Set caller custody and the reviewed public merchant address through your client's secure local
environment configuration; do not put private keys in command-line arguments or chat.

| Variable | Default | Meaning |
| --- | --- | --- |
| `KERYX_NETWORK` and `NEXT_PUBLIC_KERYX_NETWORK` | both unset: `arcTestnet` | Set BOTH to `arc` for a reviewed mainnet deployment, or BOTH to `arcTestnet`. Mismatched/partial configuration refuses startup; challenges and journals never select a network. |
| `KERYX_BUYER_PRIVATE_KEY` | unset | Explicit caller-owned key for the selected network; a supplied invalid key refuses operation. |
| `KERYX_WALLET_FILE` | Testnet `~/.keryx/buyer-wallet.json`; mainnet `~/.keryx/arc/buyer-wallet.json` | Alternative existing legacy JSON wallet with exactly `privateKey` and matching `address`. Missing, malformed, linked or inconsistent files refuse custody; none is repaired or overwritten. |
| `KERYX_BUYER_PAYEE` | unset | Required independently reviewed seller payout address. Obtain it from an owner-reviewed trusted record; the received 402 challenge does not supply this authority. |
| `KERYX_BASE_URL` | `https://keryx.cc` | Reviewed Keryx deployment. |
| `KERYX_PAYMENT_JOURNAL` | Beside the selected wallet: `buyer-payment.json` | Private original payment barrier; its sibling `.funding.json` tracks funding separately. |
| `KERYX_GATEWAY_DEPOSIT` | `0.5` | Bounded deposit of existing caller USDC, at most 1 USDC. |
| `KERYX_MAX_TOTAL_USDC` | `1` | Caller quote ceiling; exact fee/budget amounts require six or fewer decimal places. |
| `KERYX_RPC_URL` | Selected profile: mainnet `https://rpc.blockdaemon.mainnet.arc.io`; testnet `https://rpc.testnet.arc.network` | Endpoint attested as the selected Arc network by shared signing/funding guards. An operator-configured RPC failover is allowed; per-operation chain attestation cannot be replaced by the endpoint label. |

Call `keryx_wallet_status` first. Without a configured key/file, initialization and tool discovery
still work and status explains what is missing. Without merchant policy, status reports the caller
address and keeps readiness false. Fund that caller address with owner-authorized ERC20 USDC and native USDC gas on the selected network. The faucet is available only on testnet. There is no automatic faucet or server-treasury fallback.
A paid request can settle even if delivery fails. The creator cap is prepaid capacity, not a
promise that every cent is paid to creators; assess the returned settled and pending evidence.

## Upgrade and recovery

The mainnet default custody directory is new. Do not copy testnet funding/payment
journals into it or rename historical receipts as mainnet settlement. New v2 journals
bind the selected network; payment journals also bind the original server origin.
Unlabelled payment originals and funding v1 files remain testnet records and are
refused on mainnet before recovery I/O. Recover them with BOTH labels set to
`arcTestnet`, using their original endpoint and files. A mainnet journal is likewise
refused by a testnet process. Preserve the original bytes and custody for owner recovery.


Before upgrading from the previous 0.2.0 tarball or older 0.1.1 npm package, stop the old buyer
processes and preserve the original wallet and payment journal. Keep the same caller key and
journal paths, configure the independently reviewed merchant address, and recover original
attempts before making a new purchase. Do not replace or delete old custody to fix an error.

Each local journal admits one attempt under an exclusive filesystem lock. Payment recovery
checks the original query ID; a foreign completed response cannot clear the barrier. A retained
funding hash must match the exact caller, chain, destination, calldata, value and successful or
reverted receipt. Current Circle credit alone never proves the original transaction. An interrupted
approval or hashless attempt stays held for owner review. Completed/reverted funding history,
including original hashes, is retained before a distinct new funding admission.

Recovery may inspect an original attempt while a lock is held, but cannot overwrite that journal.
After a crash, it never steals a lock: stop all buyer processes, inspect the original transaction or
query, and have the owner determine whether the lock is stale before removing it. Do not issue a
new purchase/deposit to recover missing output. An old legacy journal can support original
GET-only inspection without a new key or merchant policy; it is not proof of environment origin.

This is local-process/restart protection, not global nonce exclusion across copied keys, alternate
journal paths or old packages that ignore the locks. Keep one authority over these private files.
Host ACLs and protection against a malicious local owner remain required. Journal readers are
bounded schema checks, not custody-file provenance proofs. File contents are flushed before
payment I/O; POSIX parent directories are flushed where supported. Windows namespace durability,
recursive-directory power-loss behavior and real host recovery still need operational acceptance.
RPC/provider honesty and independent security review remain separate gates. Mainnet
code selection grants no spending authority. Public production uses mainnet; choose
the same network explicitly in the caller profile and verify `/api/health` before use.

## Build and verify from source

```bash
npm exec -- vitest run --config mcp/vitest.config.mts
cd mcp
npm ci
npm run build
npm pack
```

The package bundles shared Keryx custody and signer guards into its executable while keeping
pinned consumer dependencies external. `mcp/scripts/test-packed.mjs` installs the tarball into an
isolated consumer and exercises actual stdio initialization, tool listing, status and synthetic
purchase/original-attempt recovery. Test transports block live payments and never use funded keys.
After the independent MCP install, also run `npm exec -- tsc --noEmit -p mcp/tsconfig.json`
from the repository root. This checks MCP and imported shared source against the MCP package's
installed viem/Circle declarations, matching the single external dependency closure used by the
bundled consumer. Run the packed acceptance with
`node mcp/scripts/test-packed.mjs /absolute/path/keryx-mcp-0.4.6.tgz /absolute/path/to/pinned/npm-cli.js`.

Mainnet purchase and original recovery require HTTPS without URL credentials or fragments. This is transport protection, not a seller host allowlist. Plain HTTP remains available for deliberate testnet local development.


### Recover residual Gateway funds

Ordinary buyer deposits belong to the configured caller EOA. Stop new purchases,
retain its original payment/funding journals and inspect any unknown attempt. If
your existing browser/hardware wallet controls that same EOA, sign in with it and
open `https://keryx.cc/me/withdrawals` on the selected deployment. The reviewed owner
withdrawal flow also accepts ordinary buyer EOAs; creator registration is not a
prerequisite. Original owner burn/mint and native gas remain explicit wallet actions.
A different wallet cannot recover the balance, and the package does not expose a
separate key-only cashout command. Keep custody protected locally; do not paste or
export private keys into chat or a web form. Preserve unknown originals rather than
repeating a burn or payment.

## Free paper metadata

`paper_lookup({query: "2005.11401v4"})` returns retained catalog bibliography with
its observation time. It works without a configured wallet, makes one GET to
Keryx's public `/api/papers` endpoint, and never runs research, reads a paper,
signs, funds or pays. Exact DOI and versioned arXiv ID/official URLs are supported.
Title/topic queries are bounded to 120 characters, exact DOI to 200.

Set `searchRepositories: true` only to explicitly send the query through Keryx
to arXiv/Crossref metadata services. This admits at most two provider requests;
there is no pagination or retry. A failed provider may leave a retained catalog
snapshot in the result; each record's observation time remains visible. Missing
DOI, peer review and withdrawal/replacement status stay unknown. Incomplete
contributor names do not establish the first author. These metadata records grant
no read, citation, payout or reward authority.

The text response includes a bibliography card, field provenance, a short reference,
and reusable BibTeX/RIS. Set `language: "fr"` or `language: "vi"` for those labels;
original titles, contributor names, identifiers and venue names keep their recorded
form. For example, `paper_lookup({query: "10.1038/s41586-021-03819-2",
searchRepositories: true, language: "fr"})` requests the exact Crossref record.
It does not fetch Nature's article or require full text to return recorded metadata.
First-author and first-three claims require a complete recorded contributor list;
missing positions, year, venue, DOI and page status remain explicit gaps. Both exports
retain metadata provenance and the exact DOI/arXiv version, and remain separate from
research citations and research evidence exports. The public HTTP JSON remains v1.
See [issue #218 scope and remaining gates](../docs/issue-218-metadata.md).

Candidate0.4.8 adds this tool; publication and hosted availability require separate
verification. Existing paid tools keep their own custody and recovery requirements.
