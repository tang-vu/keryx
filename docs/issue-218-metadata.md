# Exact metadata bibliography — issue #218 candidate

The two retained failures in [issue #218](https://github.com/tang-vu/keryx/issues/218)
are actual research calls. Discovery metadata did not become admitted answer evidence,
and original-paper access failure left no usable bibliography. The free `paper_lookup`
boundary supplies a separate bibliography deliverable; it does not establish that
either retained research call now succeeds.

## Implemented boundary

Hosted and stdio MCP share the same metadata-only tool, strict v1 result validator,
card formatter and exports. An exact DOI requests its Crossref works record; an exact
versioned arXiv ID requests that version's Atom entry. Explicit repository search
remains opt-in and retains the existing bounded provider admission, no retries,
cancellation and cooldown. Default lookup uses observed catalog snapshots. It performs
no model call, original-paper read, database write, wallet operation or creator payment.

The card preserves the title, recorded names in provider order, year, venue and observed
DOI/version. English is the default; explicit `language: "fr"` or `"vi"` changes labels,
not original bibliographic values. The first author and first three ordered positions
are stated only for a nonempty complete recorded list. An absent name or capped list
withholds position claims rather than shifting a later contributor into a missing slot.
Missing DOI does not prove no DOI exists. Publication kind is a repository classification;
peer review and page-specific withdrawal/replacement status remain unknown.

Each card retains its exact metadata link and observation time, with known provider field
paths for present Crossref/Atom fields. Other retained publisher snapshots have a clearly
limited provenance description: the closed v1 contract does not retain raw field paths.
Crossref metadata links must identify the same exact works DOI. arXiv metadata links must
identify the same exact abstract version or exact Atom `id_list`, so provider help pages,
unversioned/latest records and another version cannot serve as that record's provenance.

Crossref and Atom parsers retain complete metadata fields within the bibliography bounds.
They no longer slice a long title to a preview-sized string, or slice a contributor/venue
and then present that fragment as the provider's complete value. A title beyond the
1000-character contract is rejected; an over-bound name or venue is withheld. The current
required-title v1 contract cannot return a partially usable record with a missing title.
The arXiv publication year comes only from explicit `entry/published`; the RSS parser's
fallback from an update timestamp cannot supply a missing publication date.

The same text response includes a short bibliographic reference and separate reusable
BibTeX/RIS blocks for at most eight displayed works. Both formats preserve exact identity,
metadata provenance, observation time and incomplete-list limitations. BibTeX uses literal
names without guessing surnames; controls and delimiters are escaped. Missing fields are
omitted. Export validation fails the response for invalid provenance instead of formatting
an apparently usable reference. A result with no accepted record reports field-level gaps
and zero exports; it does not infer a failed full-text read.

## Surface audit

| Surface | Candidate behavior and role |
| --- | --- |
| Hosted MCP | Shared card, explicit language, BibTeX/RIS; research description points metadata tasks to `paper_lookup` |
| Stdio MCP | One keyless HTTP GET, same strict v1 validation and card; language remains local to formatting and is not sent to providers |
| Public HTTP API / OpenAPI | Existing closed `PaperSearchResult`/`PaperRecord` v1 JSON preserved; exact metadata provenance validation tightened; no new endpoint or format parameter |
| Web Sources / literature workspace | Existing metadata browse and saved RIS consume the stricter shared record/export validation; Ask's existing local handoff remains |
| Human CLI | Existing metadata JSON path preserved; provider parser and exact identity rules shared; no new research execution |
| Research APIs / A2A / OpenAI / browser Ask | Existing ordinary research evidence/reward gates unchanged; no automatic metadata task routing or inferred citation authority |
| Desktop / private native / Rust | Existing reduced operational roles preserved; no new bibliography or evidence authority |
| Extensions / bots | Existing thin hosted handoffs preserved; no metadata execution or custody added |

The compiled stdio package bytes change and require a coordinated package version/release.
App, package, installer, hosted tool and deployed commit synchronization remain root release
gates. No production deployment, live provider trial, payment or issue closure is implied.

## Staged original-page primitive

`lib/research/bibliographic-original.ts` provides a separate, explicit typed primitive:
`scope: "metadata-only"`, a canonical exact DOI or versioned arXiv ID, and explicit
`language: "en" | "fr" | "vi"`. Missing/false/other scope and noncanonical or over-bound
identifiers fail before any reader call. There is no public request flag, default live
transport, natural-language regex classifier or activation in the research pipeline.
The injected reader must preserve the original bounded body, requested/final URLs,
content type, nontruncation and observation time. Request text and URLs alone cannot
attest document identity: Crossref's accepted works envelope must report the same DOI,
and arXiv must independently display the same exact version in a recognized ID element.
An unversioned/latest marker, changed URL, conflicting marker or another identifier
produces explicit unavailable fields and zero bibliography exports.

The arXiv HTML observer runs in an inert 64 MiB child with a two-second deadline,
250,000 input bytes, 200,000 output bytes, 25,000 DOM observations and 150 metadata
units. It shares the ordinary process-wide single-parser admission and releases on
success, failure and cancellation. No script or subresource executes. Existing explicit
inline visibility handling excludes hidden/inert bait; this does not claim computed
browser CSS or page rendering. Only head `citation_*` fields, the visible exact-ID
element, title heading and a dedicated withdrawal notice are recognized. Abstracts,
comments, submission histories, journal names and repository presence never become
scientific findings or inferred publication/peer-review status. Explicit status is kept
as a literal observation, with contradictory explicit fields withheld. Otherwise status
is a precise not-explicit gap and peer review remains unknown.

Accepted records retain source-body SHA-256, original observation time and field paths.
HTML units have checked exact raw offsets and, within the excerpt bound, an exact raw
HTML excerpt; these are metadata provenance, not ordinary evidence quotes. Crossref
fields retain original JSON paths. A missing author slot does not shift later names:
each retained name has its original 1-based position, so a known slot 1 can be reported
even if a later slot is missing. Conventional BibTeX/RIS use only the intact author
prefix and disclose incomplete provider names. Missing/conflicting title withholds the
export while preserving other individually observed fields. Both formats retain only
verified DOI/version identities. Their existing v1 notes do not encode page-specific
status; the separately rendered status field and provenance carry that observation.

`bibliographicOriginalDeliverable` supplies French/English/Vietnamese field labels,
precise gaps, first three original positions, provenance, a short reference and distinct
`bibliographyExports`. It creates no ordinary citations, research citation exports,
reward weights, settlement record or full-paper assertion. The new worker is explicitly
included in Next output tracing so a future typed adapter can ship its runtime asset;
this packaging entry does not activate an endpoint. Coordinated final-source Next build
and trace verification remain root release gates.

The frozen arXiv fixture is original-shaped HTML with the owner-retained v4 title and
ordered contributor values; its markup, abstract, comments and history are synthetic.
It is not a retained complete raw capture, new live read or verification of current page
status. Frozen Crossref tests likewise use the retained DOI/first-three fields without
claiming a new complete provider observation. Tests exercise the actual isolated parser,
French field support, exact-ID refusal, missing author slots, complete-field bounds,
conflicts and exports; controlled worker tests cover deadline/output failures, invalid
closed output and forged raw provenance. Original captured-page/client acceptance is
still required before claiming the reported natural-language failures are resolved.

## Architectural integration gate

The current `ReasoningEngine.decompose(question)` contract returns only target strings.
It does not establish an explicit metadata-only scope, requested field contract or
language. Inferring scope from those targets would silently change ordinary/full-paper
requests. The existing original-article route does read an exact scholarly URL, but
`readArticle`/`extractHtml` discard raw head metadata when producing `ArticleRead`.
Its cleaned body cannot supply these raw-field observations. A future typed planning
contract and original-body adapter must preserve scope, exact identifier, language,
bounded raw provenance and cancellation, then select the separate bibliography result
before ordinary body-evidence synthesis. Its result/receipt adapters must serialize a
zero-payment metadata completion separately from citations/reward allocation and
ordinary `researchExports`. Every existing ordinary/full-paper/Operator path must remain
the false default; unsupported or mixed requests retain their existing evidence gates.
No partial raw read, generic page availability or bibliography may enter ordinary
`GatheredContent`, `Citation`, creator payout or scientific supported-answer authority.

## Validation and remaining gates

Focused tests use frozen original-shaped metadata and synthetic transports. They cover the
owner-retained DOI title/first-three/year/Nature/DOI fields, exact arXiv v4, French labels,
field gaps, original-order withholding after a missing name, over-bound fields, mismatched
provenance, replacement version, DOI/version exports, injection escaping, hosted MCP and
keyless stdio schema/format acceptance. They do not re-fetch an original provider, attest the
complete live author list, establish current page status, or prove independent usefulness.

The earlier tool-card leaf passed 89 focused Vitest tests across 12 files, application
and operational script TypeScript checks, changed-file ESLint and stdio esbuild. The direct
`scripts/test-paper-lookup-mcp-package.mts` consumer passed against the current built
source on both synthetic network profiles: an actual SDK/stdio process, one keyless
metadata GET, explicit French card, exact version, provenance and both export formats.
This uses the installed dependency closure and is not a clean-install/package-publication
claim. Final-version packed-consumer checks remain in the root release workflow.

The staged primitive passed 20 tests across its three test files, including actual
child-process parsing and controlled containment/provenance failures. Another 35
existing bibliography/Crossref discovery regression checks passed alongside the new
primitive. Application and operational TypeScript checks and changed-file ESLint
passed. These are frozen source/dependency-closure checks; the primitive has no
activated browser, hosted/stdio, CLI or API consumer. Root's coordinated final-source
build/CI and independent review remain required.

Issue #218 remains open for a research-surface metadata-only task contract and routing that
preserves language, exact DOI/version, zero-payment ledger and bibliographic exports while
keeping metadata outside scientific/full-paper evidence and payout authority. The staged
raw-page parser now exists; it is not activated, and the current Atom/catalog/tool boundary
still reports page-specific status unknown. Live original-provider/captured-page and
actual client acceptance, any required surface presentation, final-source CI/review,
coordinated package/installer publication and
safe production release remain explicit gates. Production is held while the separately
active Operator session completes its original work.
