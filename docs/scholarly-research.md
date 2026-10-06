# DOI and scholarly research

The [research-paper library](paper-library.md) adds a separate metadata-only
discovery surface on `/sources`, `/api/papers` and the human `papers` CLI. It does
not change the research, original-reading or evidence rules below.

October 1, 2026. The public research composer offers **Search scholarly papers
(Crossref and arXiv)**, off by default. Enabling it sends the question to those
official scholarly services, alongside the configured broad web search. A DOI in
the question triggers exact Crossref lookup even without the checkbox. Explicit modern
versioned arXiv identifiers (for example, `arXiv 2606.02668v1` or an official
versioned PDF/abstract URL) likewise trigger one bounded exact lookup for at most
two distinct identifiers. Requested versions must match the returned provider
records; a latest-version replacement is rejected. Exact targets replace the arXiv
keyword search for that run. Unversioned and legacy arXiv identifier forms are not
resolved by this exact-intent parser. Metadata search is free of source USDC; model, search and infrastructure costs remain separate.

## Observed records and read content

Crossref supplies deposited bibliographic records, including available titles,
structured author names, DOI, journal, publication date, volume, issue and pages.
Resolve at most two distinct question DOIs per run. Exact lookup accepts only a
record whose normalized DOI matches the request. With no question DOI, the checkbox
uses one bounded bibliographic query. This supports Crossref DOI records; DataCite
and other DOI agencies are not silently substituted. Missing records and unavailable
requests remain visible in discovery totals.

Without explicit versioned targets, arXiv search uses a bounded literal keyword
query with relevance ordering. Records
retain the repository's exact versioned identifier and observed contributor names.
An arXiv record is preprint material. A Crossref `journal-article` record identifies
the publication type; a posted record is called a preprint only when the provider
explicitly supplies that subtype. Neither proves peer review. Keryx does not infer
author surnames from arXiv full-name strings.
Contributor names are capped at 50; retain the provider entry count and disclose
an incomplete list in source details and reference notes when names are omitted.

Original public READ proposals use a separate preview-ranking floor of 0.12
(`KERYX_MIN_PUBLIC_READ_EXPECTED_VALUE`), aligned with the deterministic fallback's
positive topical selection threshold. Cached creator/feed reuse retains its 0.45
floor. Both require a positive engine proposal and a normalized claim target; the
portfolio, read attempt/deadline bounds and post-read evidence gates still apply.
Raw expected values remain observable ranking estimates, never measured coverage
or accuracy. A model SKIP cannot be promoted. Increasing source USDC does not
resolve a free-source attention gate or document extraction failure.

All provider records are discovery previews. They do not become read evidence,
citations or author payees just because metadata matches the question. For selected
Crossref records, the public reader follows the DOI link to a publisher page. This
does not establish that full paper text was delivered. Paywalls are not bypassed.

For selected arXiv records, first try the exact versioned official PDF with the
existing public-only, DNS-pinned reader and contained PDF parser. Its limits remain
2 MiB, 20 pages and 60,000 extracted characters. A successful PDF read is labelled
paper text within extraction limits; truncation stays visible. The final repository
URL must retain the requested version and the delivered format must be PDF.

If the PDF is unavailable, explicitly report its failure. Try the same version's
abstract page only if a second actual read slot and aggregate deadline remain.
The fallback is labelled **abstract page only; full paper unavailable** in source
details, synthesis context, stored evidence, receipts and exports. Abstract evidence
cannot establish details absent from the supplied abstract passages.

Only content actually extracted passes to synthesis and literal quote matching.
That establishes source grounding, not factual truth or independent corroboration.
For grounding confidence, conservatively merge publisher domain groups when admitted
scholarly reads share an observed normalized DOI. This prevents repository/publisher
versions of one work from supplying two groups. Distinct versions remain inspectable
citations and exports; missing DOIs are not guessed. Domain/work grouping remains a
proxy, not proof that different papers provide independent scientific corroboration.
Scholarly references remain `public-reference` assets with no creator rewards.
Metadata never changes registered payout wallets, source ownership, signing or caps.
Author opt-in payments are a separate [proposed staged plan](paid-scholarly-papers.md).

The October 3 #128 follow-up adds a staged extractive delivery boundary for new
evidence-bearing completions. An accepted paper marker does not prove every draft
assertion carrying it, and complete target coverage does not detect an omitted
unsupported assertion. Deliver only openly quoted qualifying source excerpts, with
explicit gaps and numbered **research targets** labelled as unverified requested
topics. The synthesized draft is withheld as a conclusion even when no proposal
was rejected. Completion confidence stays Low: source matching and model-estimated
support/coverage do not establish entailment, factual truth, contradiction resolution
or a complete useful paper comparison. Original source statements may be incorrect.
Qualified free-paper excerpts remain reusable references with zero creator reward.
Previously archived answers are not rewritten or newly certified by this boundary.
See [the remaining acceptance gates](engineering/research-attention-2026-10-02.md).

## Metadata reuse

Every admitted scholarly citation retains its observed provider record URL and time,
bibliographic fields, exact repository version where supplied, and actual read scope.
The recorded content body hash and final read URL remain the document provenance.
Archived runs are not silently enriched with a newer metadata response.

[BibTeX and RIS exports](researcher-exports.md) reuse this snapshot in the browser.
Crossref given/family names retain those supplied parts; arXiv full names have an
explicit literal-name fallback rather than invented surname splits. Journal records
use BibTeX `article` / RIS `JOUR`, preprints use `misc` / `UNPB`, and ordinary web
references retain their existing format. Provenance notes retain read limitations
and unknown peer review. Review imported records before academic use. Exporting does
not upload to Zotero or synchronize an account.

## Request bounds and privacy

Public browser requests can submit `{"question":"...","scholarly":true}` to
`/api/ask`; nonboolean flags are rejected. DOI lookup applies to public research
channels that already permit external requests. Private jobs and unattended engine
runs make no scholarly calls. A trusted human CLI opt-in to external research may
resolve question DOIs and supported versioned arXiv identifiers; public request JSON cannot override private execution policy.

Requests go only to fixed official HTTPS endpoints, with no credentials, redirects,
endpoint input from the question, pagination or retry loops. Responses are bounded
at 250,000 bytes and six seconds. arXiv XML refuses DTD/entity declarations and
invalid namespaces. Search returns at most six records from each provider.

Use one in-flight request per provider per server process without a queue. Pace
Crossref conservatively at least one second after completion and arXiv at least
three seconds. Exact two-DOI comparison adds a bounded, abortable 1.1-second interval.
Failures impose a 30-second process-local cooldown. Concurrent requests may therefore
report temporarily unavailable discovery. Multiple server processes multiply these
local admission limits; there is no cross-host distributed quota guarantee.

Scholarly discovery precedes broad search for explicit intent. An unavailable exact
metadata request remains unavailable, never a fabricated record; other configured
discovery channels may still find a readable original. Both share the existing
30/55-second Quick/Deep operation allowance and 4/8 document-read attempt caps.
PDF failures and abstract fallbacks each consume a read attempt. Cancellation and
one source failure retain other usable evidence and never authorize payment retries.

Official guidance: [Crossref access and rate limits](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/),
[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/),
[arXiv API manual](https://info.arxiv.org/help/api/user-manual.html).
OpenAlex integration is deferred to its own quota, authentication and open-location
validation. Its [current authentication guidance](https://help.openalex.org/api/authentication/)
permits basic keyless queries and offers a larger budget with a free account key;
this release does not call it or assume its quota is available.

## Validation and availability

Hermetic tests cover exact DOI matching, punctuation and encoded suffixes, structured
names, malformed metadata/XML, pacing, cancellation, provider failure, original-read
refusal, precise fallback attempt caps, version binding, public payment isolation,
private refusal, export injection and immutable portable receipt snapshots. Chromium
checks cover the checkbox, actual exported fields and abstract-only source details.
TypeScript, lint, production build, required CI and independent review are release gates.

The October 1 read-only smoke made two metadata requests: exact DOI
`10.1038/nature14539` returned **Deep learning**, with three contributors; an
attention/transformer query returned six versioned arXiv records. Both selected
originals were unavailable. A separate two-request diagnostic found Attention's
`1706.03762v7` PDF exceeded the existing byte limit while its abstract page was accessible.
A final two-read fixture extracted `1512.03385v1` PDF text to the 60,000-character limit
(truncated) and 1,798 characters from the `1706.03762v7` abstract page. No model,
database write or payment was exercised. These observations establish bounded
repository availability, not answer accuracy, participant demand or complete paper coverage.

Reproduce bounded live metadata and selected-original checks with
`node --import tsx scripts/smoke-scholarly.mts`; add `--reader-fixtures` to use the two
fixed original-reader examples. Each invocation allows two metadata requests and
at most two document reads. Remote availability may change independently of deployment.


The October 2 [issue #128 investigation](engineering/research-attention-2026-10-02.md)
reproduced a preview-selection mismatch without relaxing extraction or evidence
controls. Local bounded original reads succeeded for the exact Weng PDF and a
truncated CAVA PDF. Exact metadata lookup was unavailable in that diagnostic;
end-to-end production research and a separate useful paid workflow remain gates.
