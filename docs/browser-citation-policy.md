# Owner approval for citation rewards

This is a dormant prerequisite for the separate-origin signer. It does not
enroll an owner, issue a reward plan, admit a payment, expose an original, or
change the deployed browser payment path. The existing owner query policy and
Gateway signatures remain unchanged.

## Why a separate approval is needed

The existing query policy signs the question digest and spending limits. It
does not sign a reward-pool rule, allocation algorithm, evidence validator, or
trusted issuer. Treating that signature as approval of new citation rules would
change its meaning after the owner signed it.

A separate `KeryxBrowserCitationPolicy` EIP-712 version 1 supplement binds the
actual retained query proof, owner, signer, namespace, query, grant epoch and
question digest. It also binds the run budget, rational pool ratio, rounding
rule, maximum pool, allocation and evidence algorithm digests, trusted issuer,
authority policy, nonce and expiry. Its domain uses the existing service salt
and Arc testnet chain. This is not a mainnet policy.

The verifier must recover the owner from both proofs, require exact query
binding, and compare all algorithm and trust-policy digests with explicitly
supplied trusted expectations. An arbitrary digest is not a supported algorithm
or evidence issuer. Capture the inputs before asynchronous verification and
return an immutable, module-provenanced result that caller JSON cannot forge.

## Preserve the existing economics

The agent currently computes the citation pool from the actual run budget and
configured ratio, then rounds to micro-USDC. The new policy uses canonical
integer micro-USDC and a rational ratio, with nearest-half-up rounding. The run
budget cannot exceed the retained query ceiling; the numerator cannot exceed
the positive denominator. A computed pool above the signed maximum refuses
rather than silently shrinking the owner's rule.

This primitive does not alter current agent arithmetic. Future enrollment must
bind the actual normalized run budget and configured ratio, and demonstrate
parity before cutover. Public-reference shares remain withheld. Missing proof
or a failed payment leg must not redistribute that share to other creators.

## Evidence and privacy remain separate requirements

A quote occurring in a body does not prove that it supports the answer. Semantic
support remains an explicitly delegated issuer judgment. A creator manifest
authenticates bytes and version; it does not prove purchase, delivery, payout
authority or semantic correctness. A receipt or database settlement flag alone
does not establish that those bytes were delivered.

The future compiler needs an opaque verified artifact produced from the actual
settlement and gated delivery path. Its encrypted durable record must bind the
query, original, source/item/version, body and manifest before plan publication.
The existing cached body and a completed QueryRun cannot manufacture this
provenance. CACHE eligibility requires authenticated prior paid-read lineage and
explicit same-owner reuse permission in the signed authority policy; the
existing query-policy signature does not grant that new permission.

Question, answer, quotes and paid bodies belong in a private encrypted artifact.
Use a dedicated environment-supplied artifact key, authenticated publication
and reread, bounded storage, and explicit backup, rotation and recovery gates.
Neither a public hash nor historical original access grants artifact access.
An owner must authenticate; signer access additionally requires the current
matching active grant and epoch. Revoked historical signers receive only the
minimal original metadata needed by the existing recovery protocol.

## Remaining implementation and acceptance gates

The supplement alone does not authorize a payment or private read. The following
remain necessary for the complete citation path:

- Owner enrollment and retention of supported, named algorithm/issuer/authority
  manifests, including current permission and revocation checks. Verification
  does not consume the supplement nonce; future atomic plan admission must
  retain its unique use and make exact replay idempotent. Enrollment must explain
  the pool and delegated trust to the owner before signing; opaque hashes alone
  are not adequate approval UI.
- A controlled settlement-to-delivery issuer, encrypted artifact publication,
  authenticated reader and verified CACHE lineage. Current routes do not supply
  this authority bridge.
- An immutable pre-payment plan with exact pool conservation, explicit withheld
  shares, pinned registry author authority and unique integer author legs.
- Atomic SQLite and PostgreSQL plan/leg admission using the existing reservation
  counters, without a second capacity ledger or a plan-creation debit.
- A proposed citation-context member of durable-v3, coherent retained plan/leg
  observation, and exact historical v2/v3-fetch callbacks. No union or database
  change is implemented by the policy primitive. An older binary cannot be
  assumed to read new citation contexts; rollback is a separate release gate.
- A fresh independent signer that authenticates the private evidence and checks
  current registry, permission and expiry before signing. Full separate-origin
  delivery, recovery, custody and owner launch acceptance remain open.

Installation must not raise the minimum-original-version floor, activate a
worker, release an uncertain hold or spend funds. Mainnet readiness is not
established by passing policy unit tests.
