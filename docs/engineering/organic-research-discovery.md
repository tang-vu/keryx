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
It makes no model, retrieval, payment, account or server persistence request. Its
empty template is also downloadable without JavaScript. CSV output quotes multiline
values and uses the existing formula-neutralizing cell encoder. The exported
research question repeats on each row.

Readers can save an editable JSON file and open it after a reload to resume exact
notes, or import a UTF-8 CSV using all nine template column names. File selection
does not modify the worksheet. A preview shows the question, source counts and
first titles before explicit replacement or addition. Replacement warns about
current notes; additions preserve them, require the same question and enforce the
combined row limit. Duplicates remain distinct rows. An edit made during file
reading or preview makes that preview stale; a late read cannot displace a newer
file. Bad encoding, malformed/unsupported files, extra JSON fields and oversized
inputs refuse without changing current work. Files have a 6 MiB byte limit.

CSV imports retain safety apostrophes, because stripping them could alter original
notes. Editable JSON preserves the original text exactly, including formula-like
notes that are neutralized only when exported to a spreadsheet. A single blank CSV
template row opens as an empty worksheet. CSV is comma-separated with headers;
semicolon-separated or mixed-question spreadsheets need adjustment before import.
The page shows unsaved changes and adds a browser reload/close warning while work
has changed since the last editable-file download or import. This warning is not
an autosave or an internal-navigation guarantee; readers must keep their file.

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
- `lib/research-tools/literature-matrix-file.test.ts`: exact editable round trips,
  prior CSV compatibility, encoding/schema/size refusal, quoted record parsing,
  question conflicts and non-destructive additions.
- `lib/research-tools/guide-metadata.test.ts`: shipped sitemap URLs, English
  alternates and schema/visible-copy consistency.
- `test-support/research-guide-acceptance.ts`: raw canonical HTML, 404, blank
  template, 320/390/1366px layouts, actual CSV download, clipboard success/refusal
  and refusal of any notes/research/payment submission. The existing built product
  guide CI test calls this helper, including real file save/reload/reopen,
  invalid/stale import refusal and file-read races on mobile and desktop.
- English remains the public language. Partial Vietnamese/Chinese label drafts
  stay marked as machine drafts; no translated article URLs are manufactured.

After deployment, submit or inspect the existing sitemap in the verified search
console accounts. Record the release date and establish a baseline for impressions,
clicks, entry pages and queries for these URLs. Check indexing and canonical
selection before judging demand. Review whether people continue to the literature
workspace or research entry; attribution setup and account access must be verified
before claiming conversion or AI citation metrics. No recurring job is created.

The public website gains these discovery pages. The native Operator desktop,
CLI, API, remote and stdio MCP, extension and bots retain their established
research/payment roles; the worksheet is available through a browser. It adds no
new adapter contract, storage schema or financial authority. Existing
source/distribution acceptance remains required.
