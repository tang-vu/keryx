# Clarification after a bounded planning refusal

The retained public question `book` received a terminal planning refusal followed
by comparison-specific advice. Its wording did not establish a book, topic,
intended result or comparison. The refusal correctly avoided inventing those
details, but the next step could help a wider range of requests.

The existing English and Vietnamese guidance now asks for the topic and desired
result, with examples of an explanation, comparison, plan or shortlist. Requests
covering several subjects or dimensions still receive advice to choose a narrower
focus while preserving original source URLs, versions and qualifications. This
generic guidance does not classify the user or presume that every refusal means
the request was ambiguous: the original failure reason and bounded-plan message
remain.

The change only affects guidance text. Status 422, refusal codes/reasons, the
eight-target ceiling, output-limit details, supplier calls and terminal retry
behavior remain. Private caller excerpts stay outside generic error messages,
logging and serialized error fields. Existing bounded caller-only focus excerpts
and source URL masking remain. A suggested focus is not a rewritten question,
new submitted request or automatic paid retry.

Shared web, desktop, CLI, API, MCP and bot callers receive the existing failure
message through their established paths. No request schema, authority, surface
version, source selection, budget, signing or settlement changes. Tests preserve
the original planning and failure-surface contracts. The source change does not
prove live user acceptance, fix an unavailable supplier or establish a new answer
to the historical question. Production delivery still requires explicit release
authorization after the normal source checks and merge.
