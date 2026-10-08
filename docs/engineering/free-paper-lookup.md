# Free paper metadata lookup

October 8, 2026. Candidate app0.27.30, hosted MCP0.3.5, stdio MCP0.4.8,
desktop0.4.10. These identify source candidates; deployment, publication and
installed-client readback remain separate gates. This branch is stacked above
the unmerged output-limit PR220; neither candidate is deployed by this change.

## User outcome

Ask links directly to the free research-paper library. A single explicit DOI or
versioned arXiv identifier is carried to the local filter and editable repository
search field. The user's full question is not copied into that URL. Multiple
identifiers or a general topic open the library without copying private prose.
Following the link never submits research or external metadata search.

The concise handoff retains a 44px touch target before the research action. The
mobile composer keeps that action within the first 320x640 viewport even when
fallback fonts wrap the source-cap disclosure. Budget text and question controls
remain visible; the free lookup does not displace or submit research.

Both remote and stdio MCP expose `paper_lookup(query, searchRepositories?)`.
The default returns retained catalog bibliography. `searchRepositories: true`
explicitly sends the query to existing fixed arXiv/Crossref metadata services,
using their two-request limit, bounded responses, cancellation, pacing and
failure cooldown. The stdio tool makes one GET to the configured HTTPS Keryx
origin; it loads no buyer custody and adds no authentication/payment headers,
signing, funding, original-body request, journal or retry. A provider request
belongs to the hosted API's explicit-search path, not a new stdio provider client.

Example: `paper_lookup({query: "2005.11401v4"})` can return the recorded title and
contributors for that exact catalog version without a model call. An official
arXiv abs/PDF/HTML URL is normalized only when the entire URL is a supported
document identity. Exact DOI/version intent is validated on hosted responses;
another version cannot replace the requested version.

## Contract and uncertainty

Structured output uses the existing closed `PaperSearchResult` and `PaperRecord`
v1 contracts. Saved literature data, public API and CLI JSON remain compatible.
Text displays up to eight works and twelve contributor names per work, with
explicit remainder notices. The structured result preserves the bounded list.

Every record retains its metadata origin and observation time. A successful live
provider response does not make an included catalog snapshot fresh. Provider
unavailable differs from no matching records accepted. Missing DOI does not prove
that no DOI exists; publication kind does not establish peer review or page-specific
withdrawal/replacement status. Those status facts remain unknown here.

Text identifies the first listed author only for a nonempty, recorded complete
contributor list. Missing names, an internal gap or a truncated list withhold that
claim and retain the surviving names in their original order. Current provider
parsers carry raw entry counts; arbitrary legacy metadata whose count was inferred
from surviving names cannot establish original first-slot authorship. No parser
placeholder, author reordering, scientific verification or copyright claim is added.
Metadata remains outside research evidence, citations, payout authority and rewards.

## Supported surfaces and release gates

| Surface | Candidate behavior / boundary |
| --- | --- |
| Web Ask and Sources | Direct free handoff; existing catalog and explicit search; no automatic execution |
| Remote MCP | Shared lookup and text; request-bound cancellation/IP; bibliography remains independent of research availability holds |
| Published stdio MCP | Keyless GET client; strict bounded v1 response; exact identity checks; shared text |
| HTTP API / OpenAPI | Existing `/api/papers` v1; public API and hosted MCP now share live RAM admission |
| Human CLI | Existing `npm run papers`; default local catalog, `--search` explicit; same v1 JSON |
| Desktop Operator / private native / Rust | Reduced private operations role; no bibliography/research body exposed; coordinated installer version and CI source manifest |
| A2A / OpenAI research / buyer APIs | Research roles retained; clients use the public bibliography API before requesting research |
| Extensions / bots | Existing thin hosted handoffs retained; no new wallet or metadata execution capability |

Live admission is shared across the HTTP API and hosted MCP: three calls per
caller and six globally per minute per server process. It uses bounded RAM and
the same normalized caller-IP function, not database writes. Replica multiplication
and client-IP header trust remain the existing operational limitations. Stdio
consumers inherit the HTTP limit rather than adding a separate provider allowance.
One public `paper_lookup` call bypasses research-key verification and database
access, even when a configured client includes a research Bearer header. Protocol
initialization, status, research and mixed batches retain existing authentication;
a client with revoked credentials may need to connect anonymously for bibliography.
The client also rejects an exact selected version hidden behind a matching DOI,
selected snapshots absent from their group, excess total snapshots and raw whitespace
or control bytes in provenance links. It retains legitimate alternate versions
alongside the selected exact snapshot rather than deleting version history.

Acceptance uses synthetic metadata and transports: exact v4 versus substituted
v5/unrelated work, missing DOI/status, missing/internal-gap authors, provider
failure with retained snapshot, API/MCP shared admission, no-query forwarding,
actual built four-width navigation and packed keyless MCP consumers on both
synthetic profiles. Required CI, independent review, final-source provenance,
original/deployment lifetime gates, current-main health and package/installer
publication must pass before release claims. This is a focused response to
[issue218](https://github.com/tang-vu/keryx/issues/218); French narrative and
page-specific status extraction, complete synthesis, independent usefulness and
participant/return/demand evidence remain open.

Release ordering: this candidate integrates PR220's app0.27.29 source, including
PR226's app0.27.28 guard and the reviewed Operator/security source from merged
PR227/main28b071d6 (app0.27.27). Merge PR226, then PR220, and reconcile this branch
against fresh main/version ordering before publishing app0.27.30. The source-bound
original/operational lifetime and exact-head CI remain release gates. Hosted/stdio/desktop
candidate versions above are unchanged; source integration does not establish
publication or installed/deployed synchronization.
