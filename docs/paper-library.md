# Research-paper library

October 6, 2026, app v0.27.3. `/sources` includes 40 observed individual papers:
16 exact-version arXiv records, six public OpenReview ICLR submissions, eight PMLR
records and ten ACL Anthology records. The library covers selected agent, retrieval,
language-model evaluation and systems work. It is a starter set, not a systematic
review or a claim of sufficient scholarly coverage.

## Browse and discover

Choose **Research papers**, search titles/authors/identifiers, and optionally set
author, publication year or exact DOI. GET filters remain shareable and browser
Back/Clear restore their visible values. Paper filters select paper records;
non-paper collections do not invent corresponding bibliographic fields.

Cards retain observed contributor names/counts, venue/year when supplied, exact
repository version, DOI when observed, original metadata URL and observation time.
PDF and review links are locations. No paper body or abstract is collected for this
catalog. Peer review remains unknown. A publication-type label reports repository
metadata and does not certify review, correctness, copyright or publishing control.

Grouping uses only observed DOI, arXiv base identifier or original landing URL.
It never guesses aliases from matching titles. Distinct versions and snapshots
remain inspectable inside the work. Author/year/DOI filters must match one observed
record together; they cannot combine attributes from different versions. The
displayed work ID describes that observed group and may change when a new alias is
observed; it is not an immutable citation or settlement identity.

**Ask with this paper** prepares an editable question; it never auto-runs research.
Subsequent research uses the existing [original-reader and evidence limits](scholarly-research.md).
Only actually extracted content can become read evidence. Catalog papers never
become registered creators, payment recipients or past citations through metadata.

## Explicit live bibliography

The [literature workspace](literature-workspace.md) adds a browser-local shortlist,
personal screening notes, backup/CSV export and an editable two-paper comparison.
Save actions retain exact records, including individually inspected versions;
neither saving nor preparing a draft reads a paper or submits research.

The separate **Search repositories** button sends the entered title/topic or exact
identifier to arXiv/Crossref as applicable. Page load, local filters, topic links and
collection changes make no external metadata requests. A privacy explanation is
adjacent to the submit button. Live results are ephemeral, not stored in the database.

Keyword search admits one arXiv and one Crossref request. Exact DOI lookup admits
at most two distinct DOIs; versioned arXiv lookup batches at most two distinct
identifiers into one request. A bare standalone versioned arXiv ID is supported.
An explicit arXiv prefix also carries through an adjacent list, such as
`arXiv 2606.02668v1 and 2607.13716v1`; unrelated prose ends that list.
One DOI plus up to two versioned arXiv identifiers resolves both types in two requests.
More than two DOIs, more than two arXiv identifiers, or exact intent needing more
than two provider requests is refused before a request rather than dropping targets.
When supplied, the exact DOI filter selects the live lookup instead of keyword `q`.

Every search has at most two provider requests, six records per response, no
pagination or retry loop. Existing fixed official HTTPS transports retain
DNS pinning, no redirects, 250,000-byte/six-second bounds, one in-flight request
per provider, completion pacing and failure cooldown. Cancellation stops subsequent
operations and suppresses aborted browser results. Empty means no matching metadata
was accepted; unavailable never means the repository has no papers.

Author/year/DOI filter the returned sample locally. A repository's ranked keyword
sample is not re-filtered by every literal query word. A missing result does not
establish that a paper or author is absent. OpenAlex and DOAJ are external discovery
links; this release does not integrate their APIs, assume their quotas, or re-label
aggregator metadata as publisher records.

## API and human CLI

`GET /api/papers` is public, bibliography-only, version 1. Default is catalog-only;
`?q=retrieval&search=1` explicitly enables external requests. Optional `author`,
`year`, `doi` apply to results. Query/author are capped at 120 characters, DOI at
200 and year at four digits (1000–2999). Duplicate recognized parameters, malformed
input and excess exact intent return 400. Responses always use `Cache-Control:
no-store`. See the published [OpenAPI document](https://keryx.cc/api/openapi.json).

Live endpoint admission uses bounded RAM only: three searches per caller and six
globally per minute per server process. A refused request returns 429 and
`Retry-After` seconds. The global ceiling bounds spoofed IP rotation; replicas
multiply these local limits. No database limiter or durable caller log is added.

```powershell
npm run papers -- --q retrieval --author Lewis
npm run papers -- --doi 10.18653/v1/N19-1423 --search
```

CLI output shares the API result contract and filters. Without `--search` it makes
no external requests. It loads no environment file, database, model or wallet.
Metadata search makes no source-USDC payment; network/infrastructure costs are
separate. The existing public research workflow continues to own model execution,
original reads, evidence and payment decisions.

## Collection and surfaces

`npm run papers:collect` lists the fixed reviewed target manifest without network
or writes. `-- --apply` refreshes only the local JSON after every target passes
the same strict runtime schema. Requests have a five-minute aggregate deadline,
six-second/250,000-byte responses, fixed hosts and at most two requests per target.
PMLR HTTP PDF locations are offered as HTTPS only after a bounded HEAD confirms
the same publisher path; no PDF body is read. Replacement uses an exclusive temp
file and atomic rename. A failed refresh preserves the existing catalog.

The initial collection observed all 40 targets on October 6 in 48 requests:
40 metadata responses and eight PMLR HTTPS HEAD checks. Nine DOIs were supplied.
This is availability/provenance evidence, not read evidence, usage or traction.
OpenReview accepts only one exact public top-level note with the expected venue
and title. PMLR/ACL canonical URLs and arXiv versions must match the reviewed target.

Web, public API/OpenAPI and the human metadata CLI gain this bibliography surface.
`/api/sources` retains its registered-source/payee contract. Remote/stdio MCP,
desktop, extensions, A2A/Monthly, bots and unattended workers retain their existing
roles and explicit research policy; none automatically queries this catalog or
receives a new paid capability. Their package bytes and versions are unchanged.
The financial API version remains 0.27.0; the new bibliography envelope is version 1.
No database schema, registry, custody, spend cap, scheduler or payment behavior changes.

Release gates are strict catalog/parser/API/grouping tests, scholarly regressions,
both TypeScript projects, lint, production build, responsive browser checks,
independent review and required CI. Hosted commit and actual published artifacts
must be read back before claiming delivery across surfaces.
