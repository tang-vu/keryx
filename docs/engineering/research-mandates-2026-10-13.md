# Research Mandates: competitor-informed native adaptation

Status: source candidate, October 13, 2026. No deployed/funded mandate or modified
Gateway authority. Normal runtime integration/release belongs to the existing
release coordinator; this document retains the proposed architecture decision
while DECISIONS and global navigation/MCP docs have other active owners.

## Observed need and choices

The competitor review found good contract-level bounded purchasing in Apex and
Vestiarion, and a reproducible reserve error in Mandate: a 40-unit open bill
overdue by 25 hours was ignored against 50 units of cash, creating a 45-unit
sweep instead of preserving the unpaid obligation. Recent repository activity
was treated as research evidence, not proof of event entry or product quality.

Keryx already has session reservations, co-signing and durable pending originals.
This work does not call those paths absent or replace them. The observed new
product opportunity is an inspectable purchasing policy with pre-payment
decision bindings and an optional independently reviewed hard-cap contract.

Source references checked October 13:

- [Apex MandateBox, d931bc6](https://github.com/apexfaucet-hub/arc-mandate/blob/d931bc695cce864496c4c06d64b9f43afc509a51/src/MandateBox.sol):
  exact USDC digest reconstruction and one budget shared by direct/EIP3009
  paths. Component is MIT; source was read, not imported or executed here.
- [Vestiarion spending limit, a5b218c](https://github.com/duongnq2798/vestiarion/blob/a5b218c6537f763b0b4d535c5e33de50c719a7b3/contracts/VestiarionSpendingLimit.sol):
  independent financial limits and immutable payment references. No upstream
  code was copied; Keryx's implementation and tests are native.
- [Mandate, e350759](https://github.com/Makabeez/mandate/tree/e35075988a345881e2aeafce581a62a3e7f307dc):
  reproduced unpaid-overdue-obligation omission in the original pinned review.
  No code or license-dependent component was imported.
- [Circle USDC token implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/FiatTokenV2_2.sol):
  reference only. It does not establish deployed Arc token or Gateway compatibility.

The adaptation adds no dependency, service, scheduler or custody migration.
It uses the existing viem, Zod, MCP SDK and OpenZeppelin 5.4 MIT dependencies.
The contract keeps the repository's Solidity 0.8.24/Paris target rather than
upgrading global compiler settings. The signature helper uses existing ECDSA
and IERC1271 components instead of a newer MCOPY-dependent implementation.

## Authority and original state

Caller-supplied observations produce a deterministic assessment apart from its
explicit assessment time. Model/approval labels are declarations, not verified
provenance. No network, model, signature, funds or storage authority enters the
pure compiler. Freshness, missing/inconsistent counters, exact integer amounts,
question/source/recipient bindings, unpaid reserves and caps fail closed.

The optional contract owner configures its actual rules. A mined prepare binds
task, source, content, decision, recipient, amount and expiry to one nonce and
policy epoch. The contract does not independently prove source content, registry
ownership, evidence quality or external invoice truth. Only an owner-reviewed
source-to-recipient configuration can authorize that routing.

Committed, held and settled totals remain distinct. Direct pay and token-backed
authorization cannot both debit the same original. Signature approval requires
the earlier mined prepare, exact USDC domain/digest and appointed agent. A policy
change/pause invalidates old permissions permanently through epochs. Changes do
not reset settled lifetime spend. Release needs actual on-chain impossibility of
the unconsumed authorization; it is not a Circle timeout heuristic.

The eight-bucket weekly check deliberately over-reserves rather than undercounts
the previous 168 hours. It may refuse capacity for up to an extra UTC day.
External token consumption remains held until reconciliation, also conservative.
The owner may withdraw; an unfunded balance then refuses further agent spending.
An issuer upgrade or unverified token can invalidate these assumptions, so a
six-decimal constructor check is not a token identity/compatibility proof.

## Supported surfaces

| Surface | Actual source behavior / remaining role |
| --- | --- |
| Web | New `/mandates` EN/VI local assessment/export workspace; no wallet or provider call |
| HTTP API | New GET template / POST assessment, 64 KiB bound, Origin guard, no-store |
| Remote MCP | Dedicated `/api/research/mandates/mcp`, two read-only stateless tools; existing `/mcp` unchanged |
| CLI | Local `--example`, `--input`, no `.env.local`, no automatic file output |
| Stdio MCP | Explicit local CLI `--mcp`; same tools/compiler; published package unchanged |
| Desktop | Can open the accepted hosted route; no native custody or new installer feature claimed |
| Extension | Existing capture/research role unchanged; no mandate wallet injection |
| Bots | Existing research/payment role unchanged; can explicitly consume the public pure API |
| Contract | Undeployed optional authority; synthetic-token tests only |

Global navigation, root MCP registration, global OpenAPI/README/DECISIONS and
published package composition belong to their existing owners. Dedicated tools
are intentionally separate from research-executing tools. Release acceptance
must verify the actual route/API identity and supported distribution roles,
without claiming all packages gained new tools. No version is allocated here.

## Validation and release gates

Focused local acceptance: 17 adversarial contract cases; 28 compiler/API/CLI/
actual HTTP and stdio MCP protocol cases; EN/VI browser scenarios at 360/1440
pixels with refusal/export/edit-invalidation checks and zero network requests.
Screenshots inspect the real bundled component; they are not deployed Next-route
evidence. Local script typecheck uses `lib/research-mandate/tsconfig.json`.

Remaining release gates: full required PR aggregate/domain CI, actual production
Next build, independent financial review and combined-source/surface acceptance
by the coordinator. Contract activation additionally requires finite explicit
funding/spend/custody authorization and real vendor/network acceptance. None is
inferred from a passing fixture, BUY label, model score or source commit.

Rollback for the workbench is removal of its standalone routes; it makes no DB
migration or historical rewrite. The candidate has no activated chain state to
roll back. A future activated contract requires its separately reviewed owner
pause/withdraw/reconciliation procedure, not a web deploy rollback.
