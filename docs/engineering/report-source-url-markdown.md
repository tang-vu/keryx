# Source URLs in copied and downloaded reports

A valid HTTP URL can contain Markdown delimiters in its query or fragment. When
the report exporter emitted that URL directly, a CommonMark reader could turn an
embedded `![…](…)` into an image or `[label](…)` into a link to a different
destination. Ordinary bare URLs also need a viewer extension to become links.

The report exporter now encloses each accepted canonical URL in a
[CommonMark URI autolink](https://spec.commonmark.org/0.31.2/#autolinks).
The entire URL remains one link and its query/fragment stay URL data. Existing
HTTP/HTTPS and credential checks still apply. URLs are not fetched or enriched.
The exported URL text retains the same `URL.href` value; a reader can apply its
normal URI percent encoding without changing the target or query parameters.

Unit coverage checks image/link delimiters, emphasis, code, entity-looking text,
fragments, Unicode, existing percent encoding and ordinary query parameters.
Unsafe-protocol, credential and malformed-URL controls retain refusal. Browser
coverage exercises actual Copy and Download artifacts together, retaining the
answer, excerpt, pending payment label, file name and object-URL cleanup.

The official standalone CommonMark reference parser was also used for isolated
before/after AST and HTML verification of actual generated reports. That parser
is temporary verification tooling, with its origin and hash retained in local
evidence; it adds no project or runtime dependency. Parsing did not render HTML
or request any source or image URL.

This changes web report Copy/Download formatting. API, CLI, desktop, remote/stdio
MCP, extension and bot contracts retain their existing export roles. The original
run, authored answer Markdown, confidence, receipts and financial history remain
unchanged. Deployment, publication and version allocation remain separate actions.
