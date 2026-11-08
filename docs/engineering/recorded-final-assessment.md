# Recorded final assessment beside the answer

A stored report can have inspectable excerpts for every target while its final
model assessment still records a missing requested part. The confidence badge's
short explanation and target counts do not expose that detailed rationale. The
retained assessment is now inspectable in the recorded-evidence panel before the
answer, without a new research request.

This is a read projection of an existing sufficiency trace message. It is not a
new evidence assessment, a statement that the model's diagnosis is correct, or a
recomputation of stored confidence. The existing notice about incomplete and
unverified evidence remains visible. The note reuses the localized sufficiency
phase label; its original recorded prose keeps undetermined language and automatic
direction rather than being silently translated or rewritten.

Only the last declared final sufficiency slot can supply a note, and only when
its final marker is true, sufficient is false and its message is a nonempty string.
A later complete or malformed final suppresses older gap messages. Explicitly
intermediate and unrelated trace entries do not replace a final. Unknown JSON,
including null entries and object-valued messages, cannot be coerced into prose.

Displayed text is literal React text, bounded at4096 UTF-16 code units. A clipped
excerpt ends with an ellipsis and does not split a surrogate pair. Original
question, answer, trace, confidence, citations, amounts and portable receipt bytes
remain unchanged. Retained final text can still be inspected when target/ledger
metadata is absent, without inventing targets or zero coverage.

The assessment text never enters a follow-up URL or an automatic research action.
Existing public/protected context rules, editable follow-up preparation, budgets,
signing and payment authority remain. Minified native-browser and actual admitted
JSON/report-rendering checks cover inert text, supersession, original preservation
and missing or malformed historical metadata. They are controlled rendering
evidence, not fresh provider, accuracy or independent usefulness acceptance.
