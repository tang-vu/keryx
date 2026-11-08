# Accented terms in heuristic relevance

The deterministic offline/fallback engine previously split text with the ASCII
pattern `[a-z0-9]+`. This discarded the Vietnamese query `khí hậu` entirely and
turned `résumé` into `sum`, allowing an unrelated ASCII word to appear relevant.
Composed and decomposed versions of the same word could also disagree.

The heuristic now applies NFC normalization and lowercase to matching terms,
then recognizes runs of Unicode letters/numbers with attached combining marks.
The existing stop words, short-term threshold, relevance thresholds, source-count
rule, two-source re-evaluation bound, prices and attribution formula are unchanged.
ASCII words retain their previous boundaries. This is canonical normalization,
not translation, accent removal, compatibility folding or semantic review.

Normalization does not modify questions, candidate metadata, gathered source
text, quotations, UTF-16 spans, source identity, receipts or stored reports. A
matching title still cannot qualify an unrelated body or an unavailable read.
The ordinary source/evidence gates and deterministic spending/reward authority
remain responsible for admission. Lexical relevance is not factual correctness.

## Verification

The new regression exercises the real engine's selection, coverage,
re-evaluation, exact extractive synthesis and attribution. It checks composed and
decomposed Vietnamese, French and Spanish text, a supplementary character before
an exact quote, false ASCII fragments, unchanged ASCII/short-term behavior and
the existing remaining-budget bounds.

Ordinary research composition also checks successful and failed Vietnamese reads
across both normalization forms. The supplied snapshots and source quotes remain
unchanged, valid excerpts reach the answer and reference export, and unread or
unrelated bodies remain unqualified. These cases have no payment attempts or
payment rows; heuristic confidence remains Low. All fixtures are synthetic and
are not provider, customer, settlement or general multilingual-quality evidence.

The existing 48-trial controlled study was regenerated and checked through its
network-denied worker. Its 537-file source closure changes only the engine hash;
all 48 trial objects, design, corpus and lock remain equal to the previous
accepted snapshot. The historical study archives remain untouched.
