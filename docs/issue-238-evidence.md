# Issue 238: contiguous enumerated evidence

The frozen Portuguese MDN button client run omitted submit and the default when
`type` is absent, although the extracted source contains both in a complete line.
The selector retained reset/button and an obsolete IE submit example. The final
answer and its historical receipt remain unchanged.

The shared selector now offers short neighboring labeled, numbered or bullet
items as a single contiguous source window. Items must have matching visible
format and indentation. It expands toward nearby items on both sides, stops at
prose, blank gaps, changed format or an oversized item, and never skips a block.
This prevents ordinary lexical ranking from isolating one short alternative and
unnecessarily dropping its adjacent default or siblings. Visible enumeration is
a retrieval cue; it does not establish factual support or complete list coverage.

Expansion uses at most eight neighboring items and the existing 600-character
window. It replaces a nomination rather than creating extra nominations. The
200,000-character scan, 2,000-character selected context, nine selected windows,
16 candidates per target and existing shared nomination ceiling remain. Block
lookup uses the existing binary search, avoiding a dense-list linear index scan.
Observed preformatted multiline groups and PDF boundaries retain their existing
policies. Larger or unsupported-format lists may still lose relevant context.

Every returned passage slices one original UTF-16 source range. Existing whole
sentence quote eligibility, exact source/version/offset binding, independent
semantic review and creator reward gates remain authoritative. Grouping items
does not permit a quote assembled across an omitted source block.

The regression fixture contains the full 8,026-character frozen extracted body,
the actual question and all four actual targets from the owner-operated MCP run.
Its raw SHA256/content version is
`ad32a9abb71824e433fd4599c5f45d3f2a5c345c3ec9e107e8d8ffcbb98b4c8e`;
its NFKC/whitespace-normalized body hash is
`534bba29297913944202752c56d4f9856635e4505963c7ea1e1243bed55f1e50`.
These are different identities, as the retained corrected body binding records.
The regression failed before this change. Selection now retains the complete
submit/default/reset/button group at offsets 5280–5712 within 1,998 selected
characters, with 69 nominations and 22 retained candidates. The strict quote
menu offers the actual submit sentence, default sentence, reset sentence and
button sentence; matching the obsolete IE `submit` token cannot pass this test.
Separate checks cover original Unicode offsets, incompatible neighbors, blank
gaps, multiline groups, large items, dense-list/scan bounds and forged cross-block
passage rejection. This is an offline source-selection replay, not a new model
answer, live usefulness acceptance or independent customer traction.

Local validation passed 170 tests in 12 focused context, HTML/PDF, strict-quote,
review-input and evidence-ledger files, full TypeScript checking without emission,
ESLint on the changed TypeScript files, and `git diff --check`. The existing RFC
wrapped-rule and cross-language heading regressions pass alongside this case.

Web/SSE, APIs, A2A, OpenAI-compatible research, the repository engine/CLI, remote
and forwarded stdio MCP, desktop forwarding, extensions and bots reach this
shared server selector. Their public input, answer, citation and receipt contracts
do not change. Local saved-report inspectors retain their existing role. The
integrated release must still pass required CI/review/build and verify the deployed
commit and applicable published distributions before synchronized delivery is
claimed. A separately authorized live acceptance remains necessary to demonstrate
all four requested facts in three short Portuguese bullets. This change grants
no model, search, source-payment, funding, custody or scheduling authority.

Independent review found that grouping a last single-line pre item with ordinary
prose after `</pre>` could hide its pre role and discard the preceding prerequisite.
The correction classifies the original containing block before enumeration and
retains the inherited pre-neighbor policy. Ordinary enumeration uses a binary
lookup of its interval between observed pre regions, with barriers on both sides.
Three isolated-worker mixed-role regressions failed before the correction and now
retain the complete pre prerequisite at offsets 2420–2722 or keep ordinary windows
outside the neighboring pre region, as applicable. A separate multiple-barrier
check retains bounded lookup and the eight-sibling scan limit. These role barriers
do not change the source body, quote offsets or source/payment authority.
The corrected source passed 174 focused tests in 13 files, changed-file ESLint
and `git diff --check`; final combined release checks remain required.
