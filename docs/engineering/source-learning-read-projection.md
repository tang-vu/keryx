# Fresh metadata pages for recorded source learning

Source-learning reports inspect up to 300 recent public research runs. The previous
SQLite path streamed complete originals, rechecked each run's publication, applied
the recorded-evidence projection, and then fetched each public original again.
Questions, answers, citations and traces were materialized even though the report
needs only the recorded learning inputs. On enrolled storage, those individual
operations also traverse the fresh native admission and statement guards.

The optional `RunPrivacyStore.learningPage` supplies up to 32 metadata rows per
call. It is composed inside the existing ordinary and enrolled SQLite privacy
ports. Their schema checks, native policy and connection checks, statement guards,
post-await checks and refusal behavior remain unchanged. There is no retained
publication grant, data cache, new raw connection or writer capability.

Each SQL page selects public, non-erased identifiers in descending creation-time
and identifier order before extracting metadata. It checks the original's required
field types, raw encoded four-million-byte limit, identifier and creation-time
bindings, and nonnegative integer privacy revision. Invalid JSON, duplicate selected
fields and malformed envelopes refuse the read. The raw size and header bindings
also fail closed on padded or inconsistent historical data; they do not invent an
empty source record.

The page retains the complete recorded learning, usage and provenance packets.
It returns only source identifiers from decisions. It does not return question,
answer, trace, citation or decision prose. Original fulfillment is reduced to its
existing truthiness so protected fulfillment observations remain excluded without
materializing their originals. Nonempty text uses byte length, since SQLite text
length stops at a decoded NUL while JavaScript still considers that string truthy.
Factual-evidence projection does not change these
learning inputs; the complete report is checked against the existing full reader.

The server consumes at most 300 rows, requesting at most 32 per page and stopping
at a partial page; this bounds the scan to ten storage calls. It refuses
oversized or nonprogressing full pages. Missing optional capabilities, Supabase and
explicit privacy-OFF retain the existing streaming behavior. A selected capability
that fails does not fall back to another reader. Existing readiness checks still
precede source lookup; storage failures remain generic, uncached 503 responses.

Publication is checked for each page's storage snapshot. This is not a transaction
or continuous visibility lock across all pages of one report. Retraction before a
later page is read removes that row; already collected observations are subject to
the same request-time limitation as the previous streaming aggregate. Native
admission revoked while awaiting a page still refuses that page before return.

The report's version and API/page/MCP representation are unchanged. The 60-row
per-topic sample, one attested actor per UTC day, owner and other eligibility
exclusions, recorded-only settlement label, uncertainty and shift calculations
remain. This does not activate live outcome-based selection, exploration spend,
new funding, source purchases or citation rewards.

The synthetic cost CLI is `scripts/measure-enrolled-source-learning.mts`. It accepts
only `--fixture empty|public300 --root <existing-owned-directory>`, creates its own
temporary fixture, denies outbound I/O and removes the fixture after a successful
read. Use an owned directory under the canonical checkout's `.local/tmp`; the
measurement does not open production storage. Its actual enrolled readonly store,
whole-report hash, CPU, native prepare counts and unchanged database bytes are
checked separately from application acceptance.

The initial prototype's 300-row trial used about 85.8 seconds of CPU and 54,843
native prepares on the previous path, versus about 1.4 seconds and 535 prepares on
the metadata path, with equal whole-report hashes. These are cold instrumented
synthetic calls on one capped Linux CPU, not HTTP latency or capacity measurements.
One initial baseline trial hit its 60-second measurement deadline and was rejected;
one explicitly qualified retry of the unchanged bundle completed within a finite
180-second diagnostic bound. Product and CI assertions and timeouts were unchanged.
There was one completed 300-row baseline and two prototype candidate samples.
Empty-fixture median CPU rose about 8% while native prepares fell from 190 to 166;
that increase was within the predeclared 20% tolerance. Review added the privacy
revision check, terminal partial-page bound and NUL-safe fulfillment exclusion.
Explicitly bounded source-review refreshes reused the unchanged baseline. On the
current code, the 300-row call used 1,474.384
CPU milliseconds, 535 native prepares and 455 schema reads, versus 85,754.832
CPU milliseconds, 54,843 prepares and 46,662 schema reads on that baseline. Whole
report hashes still matched and database bytes remained unchanged. The final
empty call used 233.603 CPU milliseconds and 166 prepares. There is one current
sample per shape; the initial prototype numbers do not substitute for these
current-source checks. No baseline or failed trial was repeated for this refresh.

Tests cover full-report parity and the public scan bound, large omitted text,
corrupt envelopes and revisions, publication changes between pages, native
revocation before and after await, schema drift, closed storage and unchanged
financial columns. Required Linux native-policy cases remain acceptance gates;
a Windows-only inode skip is not a passing result. Current study reproduction,
application and operational-script types, scoped lint, and required exact PR/main
domain and platform CI remain separate gates.

No production outage trigger was sampled by this work. The measured reduction is
not evidence that this endpoint initiated a previous CPU incident. Deployment and
release still require the later explicit command under the existing release owner.
