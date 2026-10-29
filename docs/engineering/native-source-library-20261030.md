# Native source-library preview copy

The eight newer prepared locales now have 112 ordinary source-directory entries
each: 896 new machine drafts, bringing each locale to 370 authored entries. Their
status remains `machineDraft`, with `review: null`; shipped UI defaults and the
critical-copy admission filter are unchanged. Existing Vietnamese and Simplified
Chinese catalogues retain their exact compiled values.

Cited-document and feed cards use keyed messages for recorded reading scopes and
missing dates. Full text, excerpt, abstract, metadata-only, unknown scope and
bounded extraction remain distinct. Original source names, titles, descriptions,
tags and links remain literal and use `lang="und"`. This does not change what was
read, source eligibility, publisher control, citations or payment authority.

The source filter remains a Server Component with native GET navigation. Its
small client input leaf translates authored placeholder templates before inserting
identifiers. Previously those templates were interpolated in English before exact
template lookup. Input names, limits, patterns, defaults, typed values, source
question drafts and navigation parameters retain their original contracts.

Critical source-control, registration, payment and publisher notices stay in
English. Seven additional controls from the initial mechanical copy inventory
also remain outside this ordinary-copy outcome. No glossary or filter exception,
named human review or locale activation is inferred.

Regression coverage uses the actual cards, filters, input leaf, preview section,
locale provider and language switcher. It checks all reading-scope combinations,
original metadata, interpolated placeholders, language switches with unsent input,
keyboard details, invalid-year recovery and submit/clear navigation at 320 and
1366 pixels. The browser fixture permits only its fixed fake origin, fonts and an
anonymous session response; research, provider, signing and external traffic are
refused. Existing catalogue fixtures retain JavaScript-disabled GET coverage.

Required full and applicable domain/platform CI, direct hosted visual inspection
and source review remain merge gates. Runtime delivery belongs to the existing
ROOT/Circle batch; this source outcome performs no deployment.
