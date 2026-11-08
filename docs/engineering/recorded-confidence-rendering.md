# Readable stored confidence assessments

Persisted report admission intentionally retains opaque historical optional
fields. A stored confidence level may therefore be recognized while its reason
is an object, array, number, boolean, null or absent. Previously the shared
confidence reader returned that object unchanged. The real answer card could
then throw while rendering an object explanation; other malformed explanations
could show a grade that the strict public projection already omitted.

The reader now returns a recognized first-class assessment only when its reason
is a string. An unreadable recognized assessment is unavailable and stops
fallback to older verdicts. It does not replace a malformed current assessment
with an older High grade. Valid stored assessments, including an explicitly empty
string reason, retain their exact object identity and explanation.

Historical trace explanations keep their existing conversion contract. The
strict public projection keeps its separate scalar-only and text-size rules,
including omission of unsupported later recognized explanations. Sharing level
recognition lets it preserve this precedence without depending on the reader's
renderable return value.

Regression cases pass serialized JSON through actual persisted-report admission,
then render the real React answer card. They also exercise archive iteration,
portable receipt construction/verification, comparison and completed A2A quality
facts. Checks retain the original answer, citations, financial facts and
serialized input. No assessment is recomputed, no stored JSON is rewritten, and
no read, payment or provider call is authorized by this projection.

The paying-source study tracks both changed source files, so its original
48-trial write/check protocol must be reproduced. Its corpus, design, spending
boundaries and trial outcomes remain separate acceptance requirements.
