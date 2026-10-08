# Bounded current-feed observation adapters

Issue 217 helper candidate from PR 244 source `e9077764`; ordinary shared-agent
integration, independent review, deployment and useful-task acceptance remain
separate gates. These helpers perform no model, search, catalog refresh, database
write, article read or payment. Fixture transport is intercepted.

## Authority and observation scope

Call `createSourceRecencyFeedObserver` once at the trusted run boundary, granting
reads from the existing public-read allowance. The default is one; zero is valid
and the hard maximum is four. Granting this helper does not create extra budget.
Each exact feed consumes a read before transport; failed reads consume the grant,
duplicates cannot retry, and concurrent calls cannot exceed it. Original caller
recognition remains the caller's responsibility. Models or public request fields
cannot manufacture the explicit requirement.

Each request binds `current-feed`, source ID, exact canonical feed URL and the
observer's random run ID. Successful bytes, native membership, read start,
capture time and raw SHA are published atomically in one frozen process-local
capability. Plain XML parser output, JSON restoration, proxies and legacy item
arrays do not acquire observation authority. A fresh observation means the
newest publication observed in that returned feed document at the reported time.
It does not establish that the publisher has no other/newer publication, that a
server returned its historical archive, or that feed metadata is scientific
evidence. There is no invented universal freshness interval; callers keep the
observer and observation bound to the same actual run.

## Bounded native parsing

The existing public transport checks all DNS answers, pins the vetted socket,
enforces streamed bytes and observes cancellation. The observer permits zero
redirects, XML media only, HTTP 200 without any Content-Range, two million bytes and an eight-second total deadline
including parsing. UTF-8 is decoded strictly. SAX parsing yields between 4KB
chunks and bounds depth 32, nodes 20,000, fields 2,000 characters and entries 1,000.
There are no external entities, scripts or secondary resource fetches. DTDs,
unsupported encoding/format, XML errors, `xml:base`, pagination and unsupported
deleted-member structures refuse the document; no accepted prefix becomes a
complete cohort.

Supported document formats are namespaced Atom 1.0 and unnamespaced RSS 2.0.
Every native entry is retained, including missing/invalid/ambiguous dates and
identity issues. `filteredCount=0` and `truncated=false` describe that complete
document membership only. Atom ordering uses native `published`; native `updated`
is retained separately and never substitutes. RSS uses native `pubDate`, never
extension or legacy normalized dates. Dates are qualified with a conservative
calendar/timezone subset; unfamiliar legitimate representations remain a gap.
Titles/identifiers must be scalar. Atom requires its native entry ID; RSS can
bind a unique absolute item link when GUID is absent. Malformed, duplicate or
ambiguous identities remain unqualified.

Atom link relations bind the normative short name and exact IANA relation IRI
forms described in [RFC 4287 section 4.2.7.2](https://datatracker.ietf.org/doc/html/rfc4287#section-4.2.7.2).
Empty or invalid relation values refuse the document. Pagination/archive links
refuse membership qualification in either registered form; unsupported HTTPS
IANA variants are conservatively refused rather than assigned equivalence.
Archive membership markers and archive/current links are also refused, following
the document distinctions in [RFC 5005 section 4](https://datatracker.ietf.org/doc/html/rfc5005#section-4).

`entryMetadataVersion` hashes exact entry XML text as UTF-8. It is interpreted
with the whole observation digest, which binds inherited namespace/feed context.
It never replaces the catalog article's `contentVersion` or authenticates body,
creator, payee, price, offer, citation or reward.

## Exact catalog resolution

`selectCurrentFeedCatalogItem` requires an explicit current-feed/publication-date
requirement, the enrolled observation, exact trusted source RSS binding and the
matching run. Missing/invalid/future dates anywhere in membership, duplicate
identities, empty feeds and tied maxima refuse selection before catalog lookup.
An uncertain row is never filtered away to call the remainder newest.

The trusted lookup callback resolves exactly the winner's source and link to one
actual catalog `SourceItem`, or null, and must refuse duplicate rows. It is lookup
authority only: no returned array proves membership completeness. A local
two-second bound and cancellation contain an unresponsive lookup; a backend
query that cannot cancel may finish later without changing the returned selection.
No additional lookup or older fallback follows failure.

An absent winner returns `newest-entry-not-indexed` with safe feed observation
and winner metadata. It cannot fall back to an older indexed article before
CACHE/BUY. A source/link/title/publication mismatch returns a catalog conflict.
The eligible item is a frozen clone of the actual selected catalog row and uses
`sourceItemIdentity` for its real article ID/content version. Existing exact wanted
source/item/version remains binding. Registry activation, payee and price remain
in the existing caller; the helper does not read or copy feed payout fields.
The internal selected item may contain private body/storage fields and must not
be serialized as a free observation or exported receipt.

## Integration and remaining gates

Root owns shared-agent admission, existing read/attention cap accounting,
reusing the same eligible result across portfolio/reevaluation/cache/legacy
fallback, UI/report/receipt metadata and all supported caller surfaces. Ordinary
topical selection stays unchanged. Retained-set requests remain separate from
current-feed observation; the older retained selector is not promoted by arrays
or freshness timestamps. No persistent schema or SQLite/Supabase refresh policy
changes are included in this helper candidate.

Tests cover native namespace/date roles, complete membership limits, malformed
and unsafe transport boundaries, cancellation, forged capabilities, atomic read
caps, exact current winner, missing catalog winner, wanted-version conflicts and
ordinary relevance behavior. Paid customer usefulness and actual deployment
require their own evidence; fixture correctness does not close issue 217.

Local acceptance on pinned Node 24.21 passed 156 tests across seven files,
including the retained-set selector and actual bounded public reader. Independent
read-only review reproduced the RSS namespace and Atom relation-role refusals
and passed the four new test files (97 tests). Nine-file lint and the root
TypeScript graph passed. The
whole-response transport and its typed fixture checkpoints are root-owned
`8490760b` / `4db4ecad`, included here as `46aa688c` / `5c493b01` for compilation.
No live feed, provider, payment, database write or deployment was performed.
