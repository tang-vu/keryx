# Structured reference extraction

The ordinary HTML reader preserves a single visible DocBook `refentry` with a
visible `refnamediv` heading when the document has no declared `main` or `article`.
Existing primary-region precedence and ambiguous-document fallback remain intact.

This fixes an observed PostgreSQL SELECT read: the fallback boilerplate heuristic
removed the entire locking section because its ID contained `SHARE`. The retained
original had the queue and table-lock caveats, but the extracted text did not.
The same original now retains those qualifications without changing the source URL
or asking a model to fill missing evidence. This rule recognizes reference markup,
not a publisher hostname or a question's desired answer.

Hidden and inert content, parser process isolation, byte/element/depth limits,
the 60,000-character output cap and evidence/payment checks remain unchanged.
Preserving additional text can correctly change the output to `truncated: true`.
This is bounded extraction, not proof of a complete document read, semantic answer
quality or successful user work. Explicit source-fragment reads retain their
separate existing contract.

Validation includes synthetic structural/visibility/precedence/limit regressions
and replay of the retained original HTML. The four original-question heuristic
observations are diagnostics; they do not substitute for live model evaluation.
