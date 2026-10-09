# Conservative Operator obligation projection

Source candidate for [issue258](https://github.com/tang-vu/keryx/issues/258), after
the dated [float evaluation](../operator-treasury-float-evaluation.md). No money
movement, funded acceptance, deployment, published/installed package, current balance
or vendor eligibility is claimed.

## Exact accounting

`lib/operator-obligations/projection.ts` calculates one independently spendable
custody wallet/signer/role/storage-identity/network/USDC compartment. It never pools
chains or custody roles. The custody wallet comes from the sealed policy signer;
the delegated reader is separate inspection authority, not an owner/payee claim.

Amounts are canonical integer strings up to 30 digits for inputs **and results**.
Larger aggregate results refuse without truncation. Arrays allow at most 1,000
records each, with additional finite plain-graph depth/node/text bounds. Accessors,
cycles, nonplain objects, sparse arrays, malformed IDs, fractional/negative amounts
and unknown fields refuse. Observations must be within 30 seconds, never future.
A reviewed forecast horizon is finite and at most 90 days.

Protect full unfinished job caps, unused Monthly slots, uncertain payment exposure,
creator debt, delivery remedies, refunds/withdrawals, provider commitments and fees.
Missing deadlines are protected now; future due times do not remove present reserves.
Confirmed original debits with explicit confirmations are historical outflows, not
another unpaid liability. Expiry, failure and empty lookup create no release/refund.

Explicit inclusion records can contain creator legs in job caps or redeemed slots
in jobs. Both original records must exist and bind compatible snapshot/scope,
categories/units and parent capacity. Missing/conflicting/duplicate/overlarge
memberships retain full holds and refuse surplus. Inclusion keeps the earliest or
unknown child deadline. Identical liability duplicates deduplicate; conflicting
duplicates retain both possible amounts and return unknown independent of order.
Stale, unverified or wrong-unit evidence also retains full holds rather than removing
an included leg or a claimed historical debit.

Arc native 18-decimal and ERC20 micro-USDC wallet views count as one cash balance
only with matching explicit balance/original/evidence IDs, time and value. Native
dust floors liquid micros; gas ceilings round **up**. Gateway cash is separate.
Incoming pending, bridge-in-transit, vault-quote and disputed value contributes zero
liquidity. Foreign currencies, missing fee bounds, reserve policy/history and
unresolved overlap are never replaced with zero or an optimistic conversion.

```text
protected = deduplicated obligations + uncertain exposure + bounded gas/fees
safeNewSpend = min(max(0, liquid - protected - reserveFloor), originalCapacity, operatingBudget)
advisorySurplus = max(0, liquid - protected - reserveFloor - operatingBudget)
```

Complete offline fixtures yield only a nonauthorizing `estimated` calculation.
Every result has `advisoryOnly:true`, `spendAuthority:false`, `nativeComplete:false`.
No complete native port exists: `source:native-journal` **always** yields `unknown`
with both safe/advisory amounts `"0"`. API/MCP accept no snapshot import; arbitrary
caller JSON cannot assert trusted native completeness or spending authority.

## Private reader boundary

Disabled by default. Protected server configuration may explicitly name
`KERYX_OPERATOR_OBLIGATION_READER` (exact lowercase wallet) and
`KERYX_OPERATOR_OBLIGATION_ROLE` (`public`/`private`). This change sets neither and
issues no key. A valid unrevoked bearer must also have explicit `operator:read`.
Legacy ask/export, profile/history, dev or cookie identities gain no rights.
Delegation grants no signer/custody/payment authority.

`GET /api/operator/obligations` accepts no body, owner, role, signer, store or snapshot
selector. All absent/invalid/revoked key/scope/reader cases use one 401 unavailable
response. Recheck configuration after async auth and before delivery; revocation or
role change discards data. Private results are `private, no-store`, vary on
Authorization and add no public CORS. Errors include no journal paths/values.

Existing API-key verification requires an auth-store lookup/last-used metadata
write before wallet/scopes are known: the explicit auth exception. NEW private
inspection hydration and journal reads happen only after both gates. Hosted MCP's
existing global auth wrapper can precede tool configuration checks. No replacement
authentication, authority enrollment, key or revocation protocol is introduced.

Inspection opens only `createReadonlyApplicationStorage`, verifies actual enrolled
SQLite facade provenance and the keyless hosted role policy against immutable
storage identity/configured origin. `readerWallet` is a separate response-envelope
field. Close the reader on success/refusal. Ordinary stores/enrolled PostgreSQL have
no supported port and remain unavailable without an alternate-store fallback.

Public role can read existing all-orders/unused-slot caps only when selected payee,
network and records validate. Both roles retain original `retained - confirmed`
exposure and remaining lifetime capacity. Private role imports no public prepaid
inventory. These are **partial** aggregate reads, not an atomic liability graph:
individual inclusion, complete private allocation/remedy/provider/funding/withdrawal
history, verified cash and reviewed reserve/operating/horizon policy are unavailable.
Possible overlaps stay overreserved; no complete solvency statement is made.

No wallet construction, wallet-secret use/signing, model/search/vendor probe,
writer reservation, release/refund, Earn/CCTP/sweep or schedule is added. Central
server configuration imports can read environment fields; this is not a claim that
the whole import graph contains no secret definitions. No wallet secret is passed
to the new reader or surfaced in output.

## Surfaces and remaining gates

API, `npm run operator:obligations -- read`, remote MCP and packaged stdio MCP share
the private contract. CLI uses HTTPS `KERYX_OPERATOR_URL` and existing process
`KERYX_API_KEY`, with no env-file loader/wallet initialization. Tool
`operator_obligations_read` has no caller selectors or discovery books, read-only
annotations and generic errors. Client sends one bounded deadline-limited HTTPS GET
without redirects, retries or cookies.

Web/desktop may call the scoped API but get no new UI or session role. Public
Operator/treasury privacy remains unchanged. Extensions/bots retain hosted research
roles. Native Rust status/result/brief contracts lack complete treasury observation
and stay unchanged. No supported surface gains a signer or scheduler.

Offline tests cover exact arithmetic/gas/aliases, inclusion/deadlines, duplicate and
uncertain/confirmed originals, domain freshness/binding, policy ceilings, nonliquid
values and unsupported FX. Route/MCP/native-shape tests check authorization,
revocation, fabricated-facade refusal, role isolation and unknown-zero delivery.
Synthetic fixtures do not prove live history or atomic cash. Final source requires
both TypeScript graphs, lint, default production route build, applicable CI/review
and built transport/distribution evidence. Actual deployed commit and published/
installed versions remain gates before synchronized-delivery claims.

Full issue258 funded acceptance remains open: finite owner authorization, complete
native history/reservation coverage, fresh selected SDK/vendor/venue/eligibility proof
and actual testnet deposit/sweep, redemption **ahead of** an obligation and refusal
when the venue cannot pay, with every obligation/liquid floor covered. This source
reuses no funds or previous financial grant.
