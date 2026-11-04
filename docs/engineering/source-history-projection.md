# Public source history projection

The source directory needs recent citation metadata. Its existing full-run reader
also retrieves and parses question text, subclaims and large traces. The optional
`RunPrivacyStore.sourceHistory` capability selects the same latest 50 currently
public, nonerased originals in storage, validates their required metadata and
projects only the information needed by that directory. The existing SQLite
privacy port owns the operation and retains its ordinary/native guards.

Each operation first materializes the ordered public ID window, then inspects
only those originals. Hidden, erased and absent-policy originals never enter JSON
inspection. Physical original UTF8 is capped at 4,000,000 bytes. Required root
fields must occur exactly once with their existing types, canonical IDs must
match the row, and duplicate selected provenance fields refuse the projection.
Question, engine, subclaim and trace contents are omitted after their required
types are checked. No schema is installed or repaired by this reader.

The original answer and every provenance-bearing citation, decision, evidence
and claim-coverage field remain available inside the operation for the existing
synthetic-evidence projection. Source/item flags use the same metadata-only lookup
as the full SQLite reader. This ordering matters: an initially blank answer can
acquire a synthetic-content notice from a decision, evidence entry or citation
beyond position 100. Reducing to answer presence earlier would change history.

Only after that projection does the port return `{ id, createdAt, hasAnswer,
citations }`, with at most the first 100 citations per original. Citation objects
retain only the existing string identity/delivery fields, fingerprint body hash
and displayed provenance fields; quotes, rationale, rewards and other nested
fields are excluded. No top-level original answer, question, wallet, trace or
unrelated run field leaves the port. The source
history builder keeps its existing valid-public-run count, 40-document limit,
URL normalization, newest citation snapshot and delivery/provenance metadata.
These cards establish recorded citation history; they do not authenticate a
publisher, claim payment settlement or establish useful source support.

Each call reads current storage; there is no cache or TTL. A supported projection
that fails never selects the full/legacy reader. An active adapter without the
optional capability keeps its existing guarded `listRecentQueries(50)` behavior.
Inactive legacy adapters keep that same existing call. An active missing privacy
port refuses before any fallback.

The change affects the hosted source directory through its existing server-side
loader. Ask APIs, research selection, raw/owner exports, saved reports, public
reference bodies, payment/creator policy and desktop/CLI/MCP/extension/bot roles
retain their existing paths. No release version, policy renewal, funding,
schedule, provider request or deployment is granted.

Acceptance compares actual full-reader and projected card outputs, including
empty answers with synthetic provenance, latest-window/citation/document bounds
and unavailable section status. Real enrolled readonly fixtures compare guard
counts, verify unchanged original bytes, retract/erase publication, preserve
transient native contention identity and retain terminal revocation. Malformed,
duplicate and oversized originals must fail closed. Synthetic byte/count
measurements do not establish production latency, billing savings or usefulness.
