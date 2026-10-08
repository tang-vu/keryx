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

## Validation and remaining gates

Focused tests use frozen original-shaped metadata and synthetic transports. They cover the
owner-retained DOI title/first-three/year/Nature/DOI fields, exact arXiv v4, French labels,
field gaps, original-order withholding after a missing name, over-bound fields, mismatched
provenance, replacement version, DOI/version exports, injection escaping, hosted MCP and
keyless stdio schema/format acceptance. They do not re-fetch an original provider, attest the
complete live author list, establish current page status, or prove independent usefulness.

Candidate checks: 89 focused Vitest tests across 12 files, application and operational
script TypeScript checks, changed-file ESLint and stdio esbuild passed. The direct
`scripts/test-paper-lookup-mcp-package.mts` consumer passed against the current built
source on both synthetic network profiles: an actual SDK/stdio process, one keyless
metadata GET, explicit French card, exact version, provenance and both export formats.
This uses the installed dependency closure and is not a clean-install/package-publication
claim. Final-version packed-consumer checks remain in the root release workflow.

Issue #218 remains open for a research-surface metadata-only task contract and routing that
preserves language, exact DOI/version, zero-payment ledger and bibliographic exports while
keeping metadata outside scientific/full-paper evidence and payout authority. A frozen
exact arXiv abstract-page status parser remains absent; the current Atom/catalog boundary
reports status unknown. Live original-provider and actual client acceptance, any required
surface presentation, final-source CI/review, coordinated package/installer publication and
safe production release remain explicit gates. Production is held while the separately
active Operator session completes its original work.
