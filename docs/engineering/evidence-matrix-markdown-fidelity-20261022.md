# Preserve recorded text in Markdown evidence exports

The first Markdown export trimmed whitespace from the last recorded excerpt and
placed source metadata directly into document syntax. A publication containing a
newline and a heading could therefore change the exported document's structure.
The synthetic reproduction retains the original quote in the evidence matrix,
then loses its final two spaces only during Markdown serialization.

Recorded targets, markers, source identities, article fields, and excerpts now use
literal fenced blocks. Each fence is longer than every backtick run in its value,
so recorded Markdown or HTML stays inside that block. Labels, inspection status,
and provenance remain separate. No final whitespace trimming or document-wide
newline replacement touches the values. See the
[CommonMark fenced-code rules](https://spec.commonmark.org/0.31.2/#fenced-code-blocks).
The raw Markdown retains the recorded characters; a viewer may normalize line
endings during rendering.

This changes only Markdown formatting. CSV eligibility, reward/answer evidence
selection, payment authority, and stored research stay unchanged. Regression
checks cover Unicode, trailing whitespace and blank lines, CR/LF, hostile metadata,
HTML, and embedded fences. The existing tests still check excluded/overlong
excerpts, missing evidence, and article version separation.

App 0.27.86 is the next source cut for the combined runtime batch. The public
0.27.85 tag remains pinned to its original source and was not deployed. Only root
version metadata and the controlled offline study's lockfile binding change;
dependencies and the study's trial results stay unchanged. Runtime delivery still
requires exact-main CI, publication, preservation, and deployment acceptance by
the existing ROOT/Circle release owner.
