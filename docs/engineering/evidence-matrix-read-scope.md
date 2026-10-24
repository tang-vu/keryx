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

Absent historical scope stays unknown. Invalid or incompatible scope is labeled
and omitted, while the existing quote remains inspectable. Scope comes only from
the exact excerpt record; it is never filled from another citation, URL or version.
The existing citation/claim/version admission, synthetic labels, missing-target
rows, formula protection and verbatim quotation remain in force. No source body,
private extension field or new evidence assessment is added.

Web uses the existing inspection and download controls. Desktop's sponsored
research view opens the ordinary report URL; its native Operator view is unchanged.
CLI, API, remote/stdio MCP, extension and bot adapters do not call these presentation
helpers; their existing receipt and report-link handoffs are unchanged. This change
does not add a tool, route, payment, model request or storage format. Runtime
delivery remains with the existing release owner after the focused PR's required
acceptance.

Focused verification:

```sh
npx vitest run lib/research/evidence-matrix.test.ts lib/research/evidence-matrix-markdown.test.ts lib/research/evidence-matrix-export.test.ts lib/research/evidence-matrix-read-scope.test.ts lib/research/citation-evidence-panel.test.ts
npm run typecheck
```
