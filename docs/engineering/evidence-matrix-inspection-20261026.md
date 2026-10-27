# Inspect a long report's retained evidence

The research evidence matrix can narrow its targets by text, exact cited article
and excerpt availability. The same target selection applies to the target cards
and comparison table. Search matches all entered words across the original target,
eligible excerpts and their recorded article details, using the existing Unicode
search normalization. It does not search rejected or uncited evidence.

The article filter selects targets that have an eligible excerpt from that exact
citation. Its identity includes marker, source ID, item ID, URL and content version;
a shared publisher or marker does not combine distinct retained articles. Other
cited sources remain visible for comparison. A removed article selection stays
explicit until the reader resets it, rather than silently selecting another article.

Excerpt availability distinguishes targets with excerpts, including explicitly
labelled illustrative demos, from targets without excerpts. Original inspection
statuses remain intact. A missing excerpt is an inspection gap, not a verdict on
the target; an unavailable historical ledger remains unavailable.

The default view retains every target. Text entry keeps keyboard focus; Escape
clears the query outside IME composition. Reset clears all three filters and
returns focus to search. Each newly opened report starts with its complete matrix.
Optional article/availability controls use native expandable details so they do
not push the initial mobile reading view below a large filter form.

CSV and Markdown downloads always contain the complete original matrix, even
when the visible selection is empty. Filtering neither changes report data nor
fetches, buys, stores or requalifies evidence. The existing evidence ledger and
creator reward rules retain authority.

## Surface roles and validation

Web report views use the shared `AnswerCard` matrix. Desktop links that open those
web reports inherit that view; this change adds no native desktop controls.
CLI, API, remote/stdio MCP, extension and bot roles retain their existing
report data and complete exports. No filter is added to those public contracts,
and no distribution version or production availability follows from this source
change. The release owner performs the applicable final surface audit.

Focused regressions cover exact article/version isolation, Unicode and literal
text, excluded evidence, historical missing ledgers, illustrative provenance,
report changes, keyboard recovery, responsive/enlarged text and full native
download bytes. Existing matrix and AnswerCard browser regressions remain in
scope. Vietnamese and Simplified Chinese additions are machine drafts with no
human approval; their shared catalogue composition and full copy/type/build/PR
acceptance must complete before merge. ROOT/Circle retains the current release
and merge hold.
