# Public creator registration with wallet-funded gas

## Owner direction and delivery gate

On October 12 the owner requested a quick creator registration flow at `/register`
for any publisher, with registration gas paid from the existing sponsor wallet
while sufficient funds remain. This replaces site-specific enrollment and the
Conzit pilot's 24-hour, daily/lifetime and attempt limits for the new activation.
It authorizes registration gas, without requesting new custody, an automatic
top-up, another contract deployment, unrelated payments or a background schedule.

This document describes the implementation candidate. Production delivery
requires accepted source, the existing release coordinator's activation slot and
one combined deployment. The earlier Conzit policy and its evidence retain their
original meaning until that activation is actually verified.

## Creator flow

The main `/register` flow keeps the source/feed draft, chosen read price and wallet
identity through Google/Circle or ordinary wallet sign-in. It presents publishing
control, registration review/signing and confirmed/indexed completion on one page.
A fresh proof must bind the exact public HTTPS source, RSS feed and creator wallet.
The creator's signature binds source terms, payout authority, chain and registry.
The sponsor covers gas; it never signs as the creator or chooses another payout.

Recovery of an existing request is secondary to first-time registration. It remains
explicit and uses the original request, signature, nonce, gas limit and reservation.
The wallet-funded fallback is explicitly selected. An unavailable sponsor does not
silently submit a transaction spending the creator's own native balance.

Matched Wanted offers retain their explicit wallet-funded handoff and existing
five-per-wallet daily treasury-retry admission gate. Their feed-matching page also
offers the public sponsored registration entry for the same feed. That entry
registers the source; a Wanted offer continues through its separate authority.
Registration gas coverage supplies no additional treasury-retry permission. General
and unmatched feed links use the default sponsored creator flow.

Indexing and creator earnings are separate facts. After confirmation/indexing the
page reloads the authoritative claim/listing. Activating paid reads or citation
rewards still requires matching registry terms and explicit distribution permission.
A verified website or successful registration alone supplies no reward evidence.

## Funding authority and accounting

The new wallet-funded policy admits any freshly verified publisher rather than
enumerating website origins or creator wallets. It has no pilot expiration or
daily/lifetime/attempt allowance. Individual creator authorizations still expire;
each registration reserves at most 0.04 native USDC, with at most 1,000,000 gas and
a 40 gwei maximum fee. The complete gas liability must fit that reservation. Funding is native
Arc USDC at 18 decimal places, separate from six-decimal source prices/rewards.

Use fresh attested observations of balance and account transaction count at the
same chain block for the exact sponsor EOA. Admission reserves the complete maximum
gas liability atomically. All unresolved reservations for that chain and sponsor
count, including prior finite-policy originals. Confirmed/reverted receipt gas is
already reflected in the observed native balance and is not charged twice.
An unsigned prepared original can expire; an unresolved signed/submitted original
keeps its complete reservation after signature or policy expiry.

The native transaction must reject funding observations that precede a receipt
which released a hold. Repeat funding/proof checks immediately before sponsor
signing and before broadcasting. Insufficient funds, stale observations or RPC
failures refuse new execution and preserve existing originals. External spending
from the same EOA can race the final broadcast; a failure never grants a replacement
nonce, releases an unknown debit or triggers an automatic retry/top-up.

Legacy policy parsing, digests, cohort keys and originals retain their identities.
The new policy has a separate immutable cohort. Cross-policy renewal is deliberate
and requires a genuinely released latest original, the same creator/source/registry
and fresh proof. An active or confirmed original cannot be relabelled or replaced.
Original receipt recovery remains available without the active policy or private key.
The secondary saved-request inspection also works without loading a source claim;
entering an original ID grants no preparation or execution authority.

The journal's bounded inspection capacity remains an operational gate. Capacity
failure must be reported separately from an empty wallet; it is not an allowance
reset or permission to prune unresolved payment evidence. Activation must account
for any old active original or prove that none exist before changing the live policy.

## Reviewed activation input

The non-secret policy candidate below retains the previously verified registry and
fee-wallet identities. Before activation the coordinator must independently attest
the deployed V3 code/version, matching custody address, fresh native balance/nonce,
and the retained journal. Inspect old originals before changing the configuration:
either prove no active legacy original remains or preserve its exact recovery path.
Use the existing key; replace only the registration policy after source acceptance.

```json
{
  "protocol": "keryx-registration-sponsor-v2",
  "eligibility": "verified-publisher",
  "funding": "wallet-balance",
  "network": "eip155:5042",
  "deploymentOrigin": "https://keryx.cc",
  "registryAddress": "0x2217250019ab614dae7391d346d05c3fc4d71ae1",
  "registryCodeHash": "0xc915aed2667848d7a52af54c6202940116145dca6f7dbb8a9c58ce8335740fb9",
  "sponsorAddress": "0xdbd07d89eb85d7a36fb204b2a4d2aa68735c24e1",
  "maxTransactionWei": "40000000000000000",
  "maxGas": 1000000,
  "maxFeePerGasWei": "40000000000"
}
```

After the combined deploy, verify the accepted commit through `/api/health`, public
`/register` text and authenticated availability for a non-allowlisted creator.
Those readbacks spend no gas and do not establish a completed registration or real
Google OAuth/creator-signing acceptance. No new contract CREATE or fee-wallet top-up
is part of this activation.

## Supported surfaces

| Surface | Role in this outcome |
| --- | --- |
| Web | `/register` is the primary creator flow. Existing claim/recovery links remain compatible; ordinary wallet-funded registration is explicit. |
| Hosted API | Authenticated, same-origin sponsor operations use the same proof, signature and native funding gates. Availability is discovery, not payment admission. |
| CLI | Existing research/payment/inspection roles remain. No sponsor key or publisher signing authority is distributed. |
| Remote and stdio MCP | Existing caller-funded roles remain; publishing requires the browser creator handoff and its own authority. |
| Desktop Operator | Existing desktop roles remain; a creator can use the hosted registration flow. No sponsor custody is installed locally. |
| Browser extension | Existing hosted handoffs remain; registration uses the creator's session, proof and signature. |
| Bots | Existing research adapters remain; registration uses the hosted creator flow. |

Published package/installer identity and deployed source must be verified by the
release coordinator before a synchronized delivery claim. This outcome supplies
no evidence of a real Google account's completed registration, independent creator
adoption or settled earnings merely from synthetic or testnet acceptance.

## Acceptance

- A non-allowlisted publisher with exact current feed control can register under
  the new policy; invalid, stale or different-wallet proof cannot.
- Google/wallet sign-in retains the exact draft, selected price and owner; identity
  changes invalidate callbacks and never move another wallet's recovery authority.
- The actual matched Wanted product link retains its explicit wallet-funded mode,
  chain, feed and post through sign-in and the existing guarded offer request;
  a separate pure-registration link permits sponsored signup for the same publisher.
- Atomic concurrent preparations share the same balance across legacy/new cohorts;
  exact liability boundaries and the target's existing reservation count once.
- A settlement racing the observation, an external balance drop, a proof revision
  change, wrong chain/EOA/block identity and RPC failure refuse unsafe execution.
- Legacy finite enforcement, digest/key stability, original receipt recovery and
  deliberate terminal renewal preserve payment evidence.
- Exhausted funds and journal capacity produce honest availability/failure states;
  pending originals remain inspectable. No automatic wallet-funded fallback occurs.
- Focused payment/auth/storage tests, return-context tests, browser flow checks,
  TypeScript and a production build pass before full required CI and source review.
