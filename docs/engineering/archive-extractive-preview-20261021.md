# Extractive answer previews

Saved low-confidence answers start with a repeated delivery caveat. Archive cards,
topic cards and the Atom feed were taking their preview from the first 220 characters,
so that caveat hid the later sentence.

`archiveAnswerSnippet` recognizes only the four current opening caveats. When a later
sentence exists, the preview keeps the original short caution label and that later
sentence verbatim. The stored answer is not rewritten, translated or regraded. A caveat
with no later sentence stays in full. Dispatch metadata uses the same extract when a
caveat is recognized, and otherwise keeps the historical 160-character raw slice.

Search continues to match the question and cited source names. Collection structured
data still names the question and does not copy the preview into a description. The
dispatch page still shows the original report, including the full caveat. Recorded
confidence level and reason are unchanged.
