# Current Arc mainnet deployment

October 6 distribution observation (`2026-10-06T04:05:21.690Z`):
[v0.27.0](https://github.com/tang-vu/keryx/releases/tag/v0.27.0) binds source
`df17c4243e87cb2ea7cefebe0e8f20befb1f9890` ([PR 185](https://github.com/tang-vu/keryx/pull/185));
exact-main CI and package/desktop acceptance passed. Downloaded npm
**keryx-mcp 0.4.6** equals the accepted Linux release tarball byte-for-byte,
SHA256 `033bb67384a24ff5af8fe29dbde861a8e2e11b96b394f76df1b37eca419c0cc0`.
Official MCP Registry exact/latest both read back 0.4.6. Npm exposes provenance
attestations; downloaded attestation metadata was retained separately from byte
verification.

All six release assets were downloaded and checked against their accepted
manifests/checksums. Desktop **0.4.6** setup SHA256 is
`c00b6bb3b9fba483fc950211701778be5d21c60dfb9a69ee91bc9b24bf4e16ba`;
portable ZIP is `36a8dd87d9c8b22ab1faf122c79378b4fef1ad771da2403d7ef5c00d67efa148`.
The extracted executable hash and actual PE product/file version match acceptance;
download verification did not install or run it on the owner's computer.

These publication observations do not establish production availability or a
completed paid business cycle. Source delivery was separately in a held
maintenance transition on October 6. The [0.27.2 finite-canary candidate](operator-canary.md)
and desktop 0.4.7 require their own exact-source CI/deployment/artifact readbacks;
unchanged MCP 0.4.6 remains bound to its accepted publication above.

October 5 planning-repair baseline: read-only public health at
`2026-10-05T08:20:26.904Z` reported operational, database ok, Arc and real settlement
mode at `31286250`; SSH source identity was
`3128625054836e51aaace3310bda426bbe06da14`, application **0.26.16**. Public roles used
the reviewed steady brief-disabled definitions, no allowance environment, zero active
root-crontab entries, and an idle A2A queue. Separately installed system cron jobs
were activated by the other authorized delivery at 08:02 UTC; they require an explicit
hold/drain and reviewed source/storage repinning before this maintenance deployment.
The existing private worker was active with
infinite graceful stop and no forced kill. This establishes baseline identity and
availability, not useful research or a new settlement.

The **0.26.17 candidate** addresses [bounded planning and heading recall](engineering/research-planning-2026-10-05.md).
It retains remote MCP **0.3.1**, accepted caller-funded MCP **0.4.5**, desktop **0.4.6**
and extension **0.1.1**. Its deployment and independent publication readbacks remain
release steps. The closed browser round remains 0/3 useful; #128 and #169 live
acceptance gates remain open.

October 5 release observation: [PR 166](https://github.com/tang-vu/keryx/pull/166)
was merged and app **0.26.12**, commit `a85bc1b6f75138ede9980d1123d5449a0da9693f`,
was deployed. Public health at `2026-10-05T04:12:43.013Z` reported operational,
database ok, Arc and real settlement mode at `a85bc1b6`. This establishes service
availability and release identity, not a new settled payment or complete usefulness.
Steady public controls retained brief0, the old closed allowance/journal, held schedules
and unchanged custody; the previously active private worker was restored.

Public distribution readback at `2026-10-05T04:30:40.677Z` verified all six assets in
[v0.26.12](https://github.com/tang-vu/keryx/releases/tag/v0.26.12), Operator **0.4.5**
with source/embedded commit `a85bc1b`, public npm **keryx-mcp 0.4.4** with bytes equal
to the GitHub tarball, and official MCP Registry exact/latest **0.4.4**. The MCP tarball
SHA-256 is `74b3e2c564b4100fc3ac9e0d170096e77999b6db16da8f180c001d3f0f5a1f77`.
Subsequent main commits and the **0.26.16 / remote MCP 0.3.1 candidate** have their own
deployment gates; recheck health before treating any source version as live.

Updated October 4, 2026. Keryx production at [keryx.cc](https://keryx.cc) is on
**Arc mainnet**. The owner confirmed the launch, and a read-only
[/api/health](https://keryx.cc/api/health) observation at
`2026-10-04T16:42:30.685Z` reported `operational`, database `ok`, network `arc`,
settlement mode `real`, and deployed commit `1297d43`. This is a dated deployment
observation; recheck health for the current release.

## October 5 reliability candidate

Application 0.26.15, stdio MCP 0.4.5 and Operator desktop 0.4.6 coordinate
[the open-issue repairs](engineering/issue-followups-2026-10-05.md). They require
exact-source CI/review, separate accepted package publication and deployed-health
readback. The dated observations below remain historical. Remote MCP protocol
0.3.0 from the merged v0.26.12 correction and extension 0.1.1 retain their roles. This candidate does not
reopen paid evaluation, clear durable circuits, activate richer briefs or admit
immutable production cutover.

## Network and public contracts

The implementation source of truth is [the canonical network profile](../lib/arc-network-profile.ts).
Network parameters were rechecked against [Arc's connection guide](https://docs.arc.io/arc/references/connect-to-arc)
and [Circle's Gateway contracts](https://developers.circle.com/gateway/references/contract-addresses)
on October 4. The RPC below is the repository's pinned public default, not a disclosure
of the production host's private provider configuration.

| Parameter | Mainnet value |
| --- | --- |
| Configuration label | `arc` |
| Chain / x402 network | `5042` / `eip155:5042` |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` — 6 decimals |
| Native USDC gas | 18 decimals |
| Gateway Wallet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| Gateway Minter | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |
| Default RPC | `https://rpc.blockdaemon.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| Circle Gateway API | `https://gateway-api.circle.com` |
| CCTP domain | `26` |
| Production SourceRegistry, observed through health | [`0x42a64061b6cd84067bb660b2a9b8aa881fd225bb`](https://explorer.arc.io/address/0x42a64061b6cd84067bb660b2a9b8aa881fd225bb) |

Creator payout wallets, caller session signers and merchant payees are workflow-specific.
Read their authoritative mainnet registry or current quote; an old testnet address
must not stand in for a current payee. A contract address or health response alone
does not prove a particular payment, delivery or withdrawal.

## Configuration and retained history

Mainnet builds, servers and standalone payment callers use matched `KERYX_NETWORK=arc`
and `NEXT_PUBLIC_KERYX_NETWORK=arc`. Application servers/browser builds additionally
require matching nonzero registry address twins and fresh sealed mainnet storage;
hosted signing roles require dedicated reviewed custody/policy. Browser signing
captures the public profile at build time. Payment-only buyer CLI and stdio MCP use
private network-scoped caller custody/journals without dummy registry configuration
or server database enrollment. Setting a label cannot migrate state or authorize
funding. See [server runtime](mainnet-server-runtime.md) and
[operations and surface roles](mainnet-operations.md).

The checked-in `.env.example` deliberately supplies an isolated **testnet development**
configuration. Both network labels unset also retain the legacy testnet default in
code. These compatibility defaults do not describe production. Faucet, TestMint,
legacy cached-source backfill and destructive payment drills stay testnet-only.

Historical testnet plans, receipts, balances, custody, grant evidence and demos retain
their original network and dates. They are not mainnet revenue or current mainnet
payout authority. Pre-launch checklists are historical preparation unless an item is
explicitly carried forward as an unresolved quality, security or operational gate.

## Delivery and evidence limits

The observed hosted release is [v0.26.8](https://github.com/tang-vu/keryx/releases/tag/v0.26.8)
at `1297d43f7c1a8356ceccac061b1cba65b93d2819`. Its GitHub assets include MCP 0.4.3
and Windows desktop 0.4.3; the public npm registry independently reported
`keryx-mcp` 0.4.3 on October 4. Remote MCP protocol 0.2.0 and extension source 0.1.1
have independent identities. Desktop remains a local task/receipt client with an
explicit buyer handoff; extension and bots remain hosted research adapters.
Publication does not establish that every installed client has updated. See
[surface parity](surface-parity.md) for artifact and role-specific evidence.

The health snapshot recorded zero payments and zero creator payouts in the current
ledger. It does not establish mainnet paid adoption, profitability, external audit
closure or complete useful synthesis. Hosted capacity is explicitly `not-probed`;
the public Monthly quote returned HTTP 503 during this documentation check, so
purchase readiness and its current merchant were not verified here. Preserve these
unknowns instead of importing old testnet figures.

At that documentation-only refresh, one runtime-copy follow-up remained:
`research_monthly` tool metadata in `lib/monthly/mcp-discovery.ts` and the immutable
MCP 0.4.3 package still says “Arc-testnet Monthly quote”. The selected payment
profile/API determines the actual network; correcting distributed runtime metadata
requires its own coordinated release. The October 5 **0.26.12 / MCP 0.4.4**
candidate corrects that metadata and related Slack/API/discovery copy; exact-source
publication and deployment remain separate gates. Its unpaid Monthly quote check
returned mainnet successfully, superseding the earlier unavailable observation
for current availability only. See [scope and open gates](engineering/mainnet-consistency-2026-10-05.md)
and [surface parity](surface-parity.md).

Routine changes follow [the post-mainnet update flow](mainnet-update-flow.md).
Documentation-only changes require review and CI, without redeploying unchanged
runtime code. New paid exercises, custody changes and schedules retain their own
explicit authorization and finite limits.
