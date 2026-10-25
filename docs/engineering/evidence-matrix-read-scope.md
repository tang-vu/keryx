# Exact source context in evidence inspection and exports

Evidence CSV and Markdown downloads now retain the extraction scope attached to
each admitted excerpt. Previously the downloads kept exact quotes and article
identity but dropped whether the reader had inspected only an HTML heading or a
limited PDF text extraction. A researcher taking the matrix into a draft can now
inspect that boundary alongside the quote.

The citation inspection dialog also matches the selected marker, source, item,
article URL and content version before displaying an excerpt. This aligns it with
the matrix and downloads: two retained versions under the same marker cannot lend
each other a quote. Historical records still match when both sides lack the same
identity fields. Citation reward/payment presentation keeps its existing rules.

The CSV preserves its existing first 13 columns and appends `read_scope`,
`extraction`, `retrieved_at`, `extracted_text_truncated`, `normalized_body_sha256`,
`pdf_text_scope` and `html_section_scope`. The last two contain validated JSON in
ordinary quoted CSV cells. Markdown includes the same values in literal blocks.
CSV consumers should select columns by header rather than assume a fixed width.

HTML heading metadata retains the fragment, heading level, original HTML start/end
offsets, document length and original-document SHA-256. Offsets count UTF-16 code
units in the fetched HTML, not characters in the extracted prose. PDF metadata
retains pages visited, total pages, pages without extracted text and the text-limit
flag. Visiting all pages does not establish image or OCR coverage. An unclipped
body does not establish complete reading or correctness. Digests identify recorded
bytes; they do not authenticate a publisher or its claims.

Absent or unsupported historical scope stays unknown. Detail follows the existing
public receipt projection: PDF bounds belong to PDF reads; heading bounds belong
to partial HTML reads. Contradictory PDF clipping flags are labeled alongside the
observed page counts rather than silently discarding those facts. Scope comes only from
the exact excerpt record; it is never filled from another citation, URL or version.
The existing citation/claim/version admission, synthetic labels, missing-target
rows, formula protection and verbatim quotation remain in force. No source body,
private extension field or new evidence assessment is added.

Web uses the existing inspection and download controls. The shared API/remote MCP
result includes the same CSV through `researchExports`. CLI/stdio MCP and desktop
Operator recovery reconstruct it through `exportsFromCheckedReceipt`, which now
retains validated optional extraction metadata from each checked receipt record.
Direct and reconstructed exports match without modifying receipt bytes or hashes;
malformed optional metadata does not remove an otherwise usable quote. Desktop's
sponsored research view also opens the ordinary report URL. Extension and bot
report-link handoffs remain unchanged. There is no new tool, route, purchase,
model request or storage format. Required package/desktop acceptance and later
runtime delivery remain with the existing release owner.

Focused verification:

```sh
npx vitest run lib/research/evidence-matrix.test.ts lib/research/evidence-matrix-markdown.test.ts lib/research/evidence-matrix-export.test.ts lib/research/evidence-matrix-read-scope.test.ts lib/research/citation-evidence-panel.test.ts
npx vitest run lib/research/receipt-exports.test.ts lib/research/surface-result.test.ts lib/agent/run-agent.test.ts
npm run typecheck
```
