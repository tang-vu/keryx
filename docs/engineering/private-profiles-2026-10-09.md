# Owner-edited private profiles — source capability

Issue [260](https://github.com/tang-vu/keryx/issues/260) remains open. This additive
implementation enables ordinary SQLite and migrated ordinary Supabase development
stores. The current enrolled/native production store intentionally has no profile
capability. No production DDL, enrollment, identity/provenance refresh, funding,
custody, auth grant or original payment-history change is authorized by this source.

The signed wallet remains authentication authority. Display names, handles, text
and links are owner assertions, not independent identity, verified affiliation,
creator/source ownership or payout authority. There is no public profile mode or
lookup by handle/wallet. Profile JSON never joins queries, receipts, public user
summaries, activity streams, creator rankings or research exports.

## Fields and ownership

`/me/profile` reads, replaces and deletes the authenticated owner's fields.
`/api/me/profile` supports GET, PUT and DELETE with `Cache-Control: no-store`.
Owner is the active revocable SIWE session wallet or verified bearer-key wallet;
there is no URL/body wallet selector. Present invalid/revoked bearer credentials
never fall back to cookie authentication. Cookie PUT and DELETE require exact
same origin and `X-Keryx-Expected-Wallet` from the editor's bound wallet. This is
a comparison-only precondition against the independently authenticated wallet;
it cannot select ownership. Missing/malformed headers refuse (428/400), and a
changed owner refuses (409) before profile access. GET also compares this header
when supplied; the web editor sends it on its initial read, so another wallet's
activity cannot populate a stale editor even when its profile is null. Existing
API/key clients may omit it on GET. Key writes may send the same optional
precondition without gaining scopes. A wallet change remounts the editor,
cancels its old reads/mutations and withholds stale response updates; sign-out
removes the entire editor. Cancelling a request is not a rollback promise for
an already accepted owner-bound write, and no write is automatically retried.

Full replacement requires `displayName`, `handle`, `bio`, `purpose` and `links`.
Display name is at most 80 UTF-16 units; bio and purpose are at most 160, single
line, without controls, formatting controls or invalid surrogates. React renders
them as plain text/input values. Handle is optional; otherwise 3–32 ASCII letters,
digits/underscores, first character a letter. Canonical lowercase and a DB UNIQUE
constraint prevent case variants and concurrent collisions; reserved names reject
system impersonation. Collision responses expose no other owner's identity.

At most one link each: ORCID (`orcid.org`), GitHub (`github.com`), LinkedIn
(`linkedin.com`/`www.linkedin.com`), X (`x.com`/`twitter.com`), Telegram (`t.me`),
and a public personal website. HTTPS only; no credentials, nondefault port,
query/fragment, IP address or local/internal/test hostname. Website hostnames are
syntactically public; DNS ownership/reachability is not verified. Links are at most 512
characters. They are never fetched, embedded or used as authentication; the UI
opens explicit links with `noopener noreferrer nofollow`. Deletion removes only
the owner's private row and releases its handle. Account and all research/payment
records remain untouched.

## Explicit key scopes and transports

Historical NULL/blank/unknown-only and unspecified mint requests retain exactly
`ask,export`. The developer portal also starts/resets with these historical scopes.
New `profile:read` and `profile:write` permissions require explicit selection.
Write does **not** imply read: PUT/MCP update returns only the replacement and
server timestamps, with no prior private fields or activity. GET requires read.

Remote and stdio MCP expose `profile_read()` and `profile_update(profile)` through
one registration. Remote scope/owner live in the verified request closure.
Profile-only keys can use these tools/discovery but cannot call research, including
mixed research batches. Anonymous, historical keys and actor strings without
explicit scopes cannot read a profile. The stdio package uses `KERYX_API_KEY` to
the fixed deployment `/api/me/profile` endpoint, without loading signer custody,
paying, retries or redirects. Its buyer wallet is not profile ownership authority.

CLI consumers use this same scoped API; no local profile-store bypass exists.
Desktop follows the authenticated hosted web page. OpenAI/A2A research, extensions,
bots, exports and payment receipts carry no profile fields. Bundled stdio changes
require coordinated distribution before a surface-parity claim; no independent
package/installer version bump is made in this source checkpoint.

## Derived activity

Activity is not an editable field. `scope: attributed-current-store` explicitly
limits it to stored dispatch rows attributed to the authenticated wallet; anonymous
and read-only historical archives are excluded. Dispatch counts include recorded
simulations and are full-store aggregates, independent of REST page sizes.
`firstSeenAt` derives from the original users index (null if absent), and
`surfacesUsed` derives from recorded origins. Up to 12 recorded topics derive from
query memories joined to that wallet's dispatch IDs; they are recorded machine
topics, not a user-edited biography or complete research classification.

`creatorsPaid` is the API field name for **distinct creator payee wallets
with recorded settled payments in attributed runs**, not a claim that the profile
owner funded them. It includes positive fetch/citation events only, exact selected
network, settled flag + settled status + nonempty recorded transfer ID; excludes
pending/simulated/operating-fee/other-network events. Treasury/API-key attribution
does not establish payer identity. This projection does not independently
reconcile Circle or relabel the recorded transfer ID as an EVM hash.

Unavailable/malformed source results refuse with `profile_unavailable`; no partial
REST slice, guessed zero or in-memory successful fallback is returned.

## Storage and remaining gates

The optional `KeryxDB.privateProfiles` port is non-enumerable and installed solely
on ordinary adapters. SQLite installs the separate private table after ordinary
schema admission; the source-owned sealed schema installer and its exact profiles
remain unchanged. Unknown profile table/index/trigger shapes refuse without
repair; each operation checks its exact domain shape inside the transaction.
An unknown optional profile schema disables that port while ordinary account,
source and research reads retain their existing behavior.
Supabase uses only fixed service-role RPCs from additive
`0083_private_profiles.sql`: private RLS/ACLs, atomic handle index, full owner
aggregates and enrolled-identity refusal. It never falls back to `.from()`.
Enrolled SQLite facades omit the port; enrolled Supabase rejects it before guard,
RPC or REST I/O. No exhaustive sealed method inventory or digest is widened.

Acceptance is split deliberately: focused contract/auth/privacy tests and actual
ordinary SQLite behavior; PostgreSQL17 isolated migration/ACL/concurrent-collision
acceptance in CI; built-CSS hermetic web and packaged stdio fixtures. Synthetic
fixtures are not live SIWE/production acceptance. Main aggregate and applicable
domain/platform CI, independent combined review and coordinated distribution are
merge/release gates. Production CRUD additionally needs its own reviewed sealed
domain migration/enrollment capability, owner-authorized operations and actual
SIWE/scoped-key deployed acceptance. Public profiles are a separate issue.
