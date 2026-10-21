# Useful organic research discovery

The research desk connects a free browser worksheet to Keryx's existing literature
and research workflows. It adds four canonical English pages:

| URL | Reader intent | Useful next action |
| --- | --- | --- |
| `/guides` | Find a practical research workflow | Choose a guide or free tool |
| `/guides/literature-review-matrix` | Literature review matrix template/example | Build and download a CSV |
| `/guides/verify-ai-citations` | Check an AI citation or unsupported claim | Record identity, support and status checks |
| `/tools/literature-review-matrix` | Make a literature review matrix | Add notes and download all rows |

These are editorial intent hypotheses, not measured keyword demand or ranking
claims. The two guides have direct summaries, section anchors, source references,
illustrative examples and links to the existing literature/research surfaces.
No synthetic study is presented as actual evidence.

The worksheet uses tab memory only, with 50 sources and 2,000 characters per cell.
It makes no model, retrieval, payment, account or persistence request. Its empty
template is also downloadable without JavaScript. CSV output quotes multiline
values and uses the existing formula-neutralizing cell encoder. The exported
research question repeats on each row; no sources or notes are silently filtered.
The page explicitly tells users to download before reloading or leaving.

## Crawlability and machine-readable descriptions

The homepage and footer link to the research desk. All four pages enter the
sitemap and `llms.txt`, with reciprocal English alternates and individual canonical
URLs. Guides are generated from an explicit slug allowlist; unknown slugs return
404. The CSV attachment is excluded from indexing with `X-Robots-Tag`.

Article, CollectionPage, BreadcrumbList and WebApplication descriptions match the
visible content. The free offer belongs only to this worksheet. Authored dates are
fixed rather than refreshed on each request. No ratings, unearned expert identity,
fabricated updates or claims of systematic-review completeness are added.

Google's [AI search guidance](https://developers.google.com/search/docs/appearance/ai-features)
requires the usual searchable, helpful content; it specifies no extra AI file or
special schema requirement. `llms.txt` is an additional existing discovery surface,
not an indexing or AI-citation guarantee. The guides link their methodological
references from Cochrane and Crossref where used.

## Verification and measurement

- `lib/research-tools/literature-matrix.test.ts`: Unicode, multiline CSV, formula
  injection, blank download and explicit limits.
- `lib/research-tools/guide-metadata.test.ts`: shipped sitemap URLs, English
  alternates and schema/visible-copy consistency.
- `test-support/research-guide-acceptance.ts`: raw canonical HTML, 404, blank
  template, 320/390/1366px layouts, actual CSV download, clipboard success/refusal
  and refusal of any notes/research/payment submission. The existing built product
  guide CI test calls this helper.
- English remains the public language. Partial Vietnamese/Chinese label drafts
  stay marked as machine drafts; no translated article URLs are manufactured.

After deployment, submit or inspect the existing sitemap in the verified search
console accounts. Record the release date and establish a baseline for impressions,
clicks, entry pages and queries for these URLs. Check indexing and canonical
selection before judging demand. Review whether people continue to the literature
workspace or research entry; attribution setup and account access must be verified
before claiming conversion or AI citation metrics. No recurring job is created.

Web and desktop's hosted-web view gain these discovery pages. CLI, API, remote and
stdio MCP, extension and bots retain their established research/payment roles.
This browser-only worksheet adds no new adapter contract, storage schema or
financial authority. Existing source/distribution acceptance remains required.
