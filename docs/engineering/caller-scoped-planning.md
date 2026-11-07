# Keep factual research within the caller's scope

Recent public research showed a planning failure: a caller asked for China's
expected population in 2050, but the planner added projection ranges and
uncertainty as required information. The final assessment correctly reported
those added requirements missing, lowering confidence despite a supported answer
to the original point-estimate question.

Factual and explanatory planning now requests an ordered partition of the exact
caller text in `request.parts`. The model labels each span as a research target,
shared factual/source scope, delivery instruction or connective framing. Local
construction uses the target spans and shared scope, so it cannot append a
model-authored requirement. Every supplied URL must occur whole in shared scope;
versions, queries and fragments remain intact. Missing, rewritten, reordered or
foreign spans refuse the plan without a repair call or automatic tier retry.

Explicitly requested uncertainty and other independent information needs remain
separate targets. Delivery instructions remain in the original question supplied
to synthesis and do not become additional factual requirements. The existing
eight-target and per-target length limits still apply. Literal provenance does
not prove that the model classified each span correctly or captured every
independent need; misclassification remains a limitation of semantic planning.

Finite named comparisons retain their existing caller-bound comparison shape.
Prospective idea generation and unnamed-candidate discovery retain the existing
constraints/claims shape so provisional discovery names can still be proposed.
Legacy plan responses remain readable. Existing recorded reports and private
originals are not rewritten or relabeled.

This changes no read limits, model-call allowance, payment authorization, citation
reward gate, coverage threshold or confidence classification. Retrieval failures
and genuinely incomplete evidence can still produce Low confidence. All server
research callers share this planner; web, desktop, CLI, MCP, extension and bot
adapters keep their current response and display contracts.

Controlled regressions cover the added population requirement, explicit missing
uncertainty, multilingual caller text, source/version retention, malformed plans,
scope limits and refusal without fallback. They validate scope handling, not a
measured improvement in real-world answer accuracy.
