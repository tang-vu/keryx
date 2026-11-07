# Read static text around HTML directive attributes

The existing reader rejected the official Alpine.js Start Here document because
its HTML contains directive attribute names such as `@click`. HTML accepts these
names, but they cannot be copied into the XML-oriented DOM used by Readability.
The normalization step previously rejected the complete document even when the
attribute occurred outside the requested article.

Normalization now omits attribute names that cannot enter that XML projection.
Visible text still comes from the original HTML tree; omitted attribute values
never become evidence. Standard visibility attributes and inline styles are
evaluated before projection. The existing semantic main/article/reference
selection, Readability fallback, code/table layout and text provenance remain.

No script, handler or linked resource is executed. The raw input, normalized
markup, element/depth, output, memory, deadline and parser-concurrency limits are
unchanged. Read/model-call allowances, purchasing authority, budgets and
confidence gates are unchanged. It does not render client-generated content or establish
source correctness.

A bounded snapshot of the official page reproduces failure before the change
and supports an exact-input after-check. Synthetic regressions cover shorthand,
binding and Unicode names; semantic and fallback paths; hidden content; handler
inertness; code/table text; and unchanged resource/truncation bounds. All server
research callers share this reader, with existing web, desktop, CLI, MCP,
extension and bot contracts preserved.

References: [HTML attribute syntax](https://html.spec.whatwg.org/multipage/syntax.html#attributes-2),
[Alpine.js Start Here](https://alpinejs.dev/start-here).
