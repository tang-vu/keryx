# Skip the fixed delivery lead in archive previews

Release 84 already skips a recognized low-confidence closer. On the live archive
at `https://keryx.cc/answers` on 2026-10-22, the next text is still the same
grounding introduction, so the card hides the first original sentence.

`archiveAnswerSnippet` now also skips one exact introduction written by the
current grounded-answer delivery, an exact short-bullet notice for counts 1
through 8, and the first exact research-target heading plus its quoted
requested topic. It does this only when a later sentence remains. The short
`⚠` label stays when a recognized confidence closer was skipped. An answer
without that closer does not gain one.

The stored answer, confidence reason and full report stay unchanged. Evidence-gap
and limitation sentences are not treated as leads. A lead or target label with
nothing after it stays intact. A requested topic whose quote contains a closing
curly quote is left in place. Search still uses the question and source names.
Collection structured data still names the question. Archive cards, topic rows,
the Atom feed and the dispatch metadata excerpt share this extract.

These checks use the current delivery writer on supplied ledger rows. They do
not read a paper, call a model, spend funds or change a payment record. Runtime
delivery of this preview stays with the existing release owner.
