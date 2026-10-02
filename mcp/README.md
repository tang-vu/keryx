# Keryx MCP

Keryx buys selected sources under a budget and returns a cited answer with creator-payment state.
The local stdio buyer pays the inbound x402 toll from a configured caller wallet on Arc testnet.
A Circle settlement identifier is batching evidence, not an individual EVM transaction hash.
Testnet calls and owner-operated tests do not establish external traction or mainnet readiness.

## Research Monthly

Stdio 0.3.1 and the remote service expose read-only `research_monthly` discovery.
The four-request, 30-day Arc-testnet pilot uses manual renewal and a 10% total-price
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
| `ask_keryx` | Buy research with an exact service fee plus creator-spend cap. Default deep mode is 0.05 + 0.05 = 0.10 testnet USDC. Checks the independently configured seller, exact total, token and signing domain before signing. |
| `keryx_wallet_status` | Report configured caller custody and balances, or missing-custody/merchant-policy guidance. Never creates or replaces a wallet. |
| `keryx_recover` | Inspect the original saved payment or funding attempt. Performs reads; never submits another payment, approval or deposit. |

Version **0.3.0** changes local setup. Use Node.js **22.19+ in the 22 LTS line, or 24+**.
Builds use the repository's pinned npm 11.19.0 installer. Critical consumer dependencies are
pinned to Circle x402 batching 3.5.0 and viem 2.55.19.

The verified release tarball can be installed directly. npm registry availability is a separate
publication step: do not assume `npx keryx-mcp@latest` contains these safeguards. Until 0.3.0 is
published and read back, npm's older version remains unchanged.

```bash
npm install /absolute/path/keryx-mcp-0.3.0.tgz
```

Configure your MCP client to run `node /absolute/path/node_modules/keryx-mcp/dist/keryx-mcp.mjs`.
Set caller custody and the reviewed public merchant address through your client's secure local
environment configuration; do not put private keys in command-line arguments or chat.

| Variable | Default | Meaning |
| --- | --- | --- |
| `KERYX_BUYER_PRIVATE_KEY` | unset | Explicit caller-owned testnet key; a supplied invalid key refuses operation. |
| `KERYX_WALLET_FILE` | `~/.keryx/buyer-wallet.json` | Alternative existing legacy JSON wallet with exactly `privateKey` and matching `address`. Missing, malformed, linked or inconsistent files refuse custody; none is repaired or overwritten. |
| `KERYX_BUYER_PAYEE` | unset | Required independently reviewed seller payout address. Obtain it from an owner-reviewed trusted record; the received 402 challenge does not supply this authority. |
| `KERYX_BASE_URL` | `https://keryx.cc` | Reviewed Keryx deployment. |
| `KERYX_PAYMENT_JOURNAL` | `~/.keryx/buyer-payment.json` | Private original payment barrier; its sibling `.funding.json` tracks funding separately. |
| `KERYX_GATEWAY_DEPOSIT` | `0.5` | Bounded deposit of existing caller USDC, at most 1 testnet USDC. |
| `KERYX_MAX_TOTAL_USDC` | `1` | Caller quote ceiling; exact fee/budget amounts require six or fewer decimal places. |
| `KERYX_RPC_URL` | `https://rpc.testnet.arc.network` | Endpoint attested as Arc testnet for reads, signing and submission. |

Call `keryx_wallet_status` first. Without a configured key/file, initialization and tool discovery
still work and status explains what is missing. Without merchant policy, status reports the caller
address and keeps readiness false. Fund that caller address with Arc testnet USDC and gas using
an independently checked faucet. There is no automatic faucet or server-treasury fallback.
A paid request can settle even if delivery fails. The creator cap is prepaid capacity, not a
promise that every cent is paid to creators; assess the returned settled and pending evidence.

## Upgrade and recovery

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
RPC/provider honesty and independent security review remain separate gates. Mainnet is disabled.

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
`node mcp/scripts/test-packed.mjs /absolute/path/keryx-mcp-0.3.0.tgz /absolute/path/to/pinned/npm-cli.js`.
