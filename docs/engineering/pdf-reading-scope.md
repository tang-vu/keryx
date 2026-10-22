# Observed PDF text scope

The public PDF reader extracts text in the existing isolated, bounded PDF.js
worker. It does not render pages, inspect images/figures or run OCR. A PDF can
yield useful text on some pages and no text on others. Successful text extraction
therefore does not establish complete document coverage.

New successful PDF reads record `webProvenance.pdfTextScope`:

```json
{
  "format": "keryx-pdf-text-scope-v1",
  "pagesRead": 3,
  "totalPages": 3,
  "pagesWithoutText": [2],
  "textLimitReached": false
}
```

`pagesRead` counts pages visited by the text reader, including a last page whose
stream was stopped by the character limit. `pagesWithoutText` lists only visited
pages that yielded no non-whitespace text. A listed page can be scanned, blank or
otherwise unavailable; this observation establishes no factual negative about
its contents. An unvisited page is not classified as textless.

The existing `truncated` flag keeps its page/character-clipping meaning. A textless
page is recorded separately, so an otherwise complete sentence is not rejected
as a clipped extraction edge merely because another page yielded no text.
Useful extracted text and its existing evidence-boundary rules are retained;
an entirely textless PDF still refuses with the existing sanitized extraction
failure. The existing byte, page, character, parser-concurrency, deadline,
cancellation, child-memory and no-external-resource restrictions remain in force.

Source cards and citation inspection show the page observations and the text-only
boundary. Deterministic research follow-up suggests inspecting the same original
version. Capped reads point to the remaining original pages, including the last
visited page when a character cutoff may have interrupted it. Textless pages get
conditional guidance for publisher text, a text-layer PDF or a separately
OCR-processed copy. It starts no retry, model request, OCR job or purchase. It does
not treat a missing text layer as missing evidence or turn an operational read
observation into a claim-support or settlement verdict.

The metadata follows ordinary gathered identity into the existing evidence ledger,
citation records, API/remote-MCP projections and portable receipt JSON. Receipt
projection copies the nested scope and page array so later source mutation cannot
change its integrity-bound bytes. A checked private completed-read adapter accepts
the optional scope, keeps it bound to matching original citation/evidence metadata,
and includes the read limitation in its observations without rewriting the stored
result or financial originals. The existing caller-supplied editable-draft format
still strips unrelated report metadata; it is not a second authenticated receipt.

Historical receipts/runs have no page scope. Their absence remains unknown, with
no inferred pages, OCR or rewritten metadata. Existing plain-text and HTML readers
do not acquire PDF scope. Legacy text follow-up remains unchanged when no scope
was recorded. Model input serializers retain their existing role and receive the
existing page/character `truncated` signal and PDF extraction kind; detailed page
observations are report metadata. This change adds no model or payment authority.

Web and desktop-hosted reports gain scope presentation. CLI/API and remote/stdio
MCP retain the same commands and monetary contracts while their shared structured
receipts can carry the optional metadata and answer text includes follow-up.
Extension and bot research handoffs inherit the recorded answer/report, without
new permissions. ROOT must audit the actual affected shared client artifacts in
the next qualified runtime batch; versioning/publication remains release-owned.

Verification covers real synthetic text/image-only/text PDFs, wholly textless and
blank pages, page/character cutoffs, cancellation/recovery, schema refusal,
immutable receipt/API metadata, checked private-resume binding and reading UI.
The production trace check requires the new worker output from only assembled
runtime assets. These are internal product checks, not real-user acceptance or
claims about any external paper.
