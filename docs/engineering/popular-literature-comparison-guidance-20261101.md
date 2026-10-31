# Literature comparison in ten partial language previews

The comparison panel now has source-bound drafts for its heading, hidden labels,
selection context, review-focus description, prepared-question disclosure and
remove controls in Spanish, Brazilian Portuguese, French, German, Japanese,
Korean, Hindi, Indonesian, Russian and Arabic. Each locale adds ten report
messages, preserving its existing 130 report drafts. Each partial preview has
551 authored entries; the report namespace admits 139 message keys after the
existing critical-copy filter. Counts of unique English text keys can be smaller
because source sentences repeat.

All new text remains `machineDraft` with `review: null`. English remains the
shipped interface. This change provides neither named human translation approval
nor activation or production deployment.

## Comparison metadata and original content

Screening descriptions use the existing `paperWorkspace.screening.*` display
messages. The four state identifiers, their order, fixed English screening CSV,
storage schema and comparison selection behavior do not change. This also lets
the existing Vietnamese and Simplified Chinese previews use their authored
screening descriptions in the comparison metadata.

The full paper-description sentence still uses named React-node placeholders.
Repository names retain explicit English/LTR isolation, arXiv identifiers retain
English/LTR attribution, and original URLs retain LTR direction. Paper titles,
saved focus and prepared comparison question use automatic direction without
passing their content through translation lookup. React continues to escape
original data, including text resembling HTML or message placeholders.

Removing a paper from comparison changes selection only. Selected context stays
inspectable when search or screening hides saved cards. Removing the last
selection hides the comparison panel. Neither action removes a saved paper,
changes notes, writes storage, submits a question or starts research/payment.

## Focused validation and required admission

Focused validation covers 86 unique Vitest cases in five files and 49 copy-guard
contracts. This includes all four screening states across five repository
identities, rich-message language and direction, original-data preservation,
accessible remove/prepared-question labels, empty selection and no-focus states.
The Crossref fixture is explicitly synthetic; the seed catalogue has no Crossref
record.

Twenty-four actual Chromium cases exercise all ten locales at 320/1366 pixels,
Arabic at 390 pixels, and Portuguese/Russian/Arabic at 320 pixels with 32-pixel
root text. Each checks hidden selection context, prepared-question text, locale
switches, removal, zero storage writes and no outbound requests. Fifty-two final
captures support original-scale visual review. The initial test assertions were
corrected to count admitted message keys rather than deduplicated English-text
keys, provide a synthetic Crossref fixture, and locate the focus textbox by its
accessible role. Those failed diagnostic receipts remain separate from accepted
results; reruns do not increase the unique-case count.

The copy guard passes with no new baseline exception. All 505 paid-study source
inputs are unchanged, with no unresolved inputs or need for another 48-case
offline reproduction. Package/lock files, payment/consent copy, critical filters,
English/Vietnamese/Chinese source catalogues, storage and export logic remain
unchanged. Web comparison UI is the affected surface; API, CLI, remote/stdio MCP,
extension and bot contracts retain their established roles.

Current full PR CI, applicable domain/platform workflows, required hosted
originals and exact-main acceptance remain necessary. Focused local acceptance
does not establish those gates or production delivery. ROOT/Circle retains the
existing batched release authority and the online release remains undisturbed.
