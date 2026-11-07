# Source URLs in copied and downloaded reports

A valid HTTP URL can contain Markdown delimiters in its query or fragment. When
the report exporter emitted that URL directly, a CommonMark reader could turn an
embedded `![…](…)` into an image or `[label](…)` into a link to a different
destination. Ordinary bare URLs also need a viewer extension to become links.

The report exporter uses a generated native HTML anchor, supported by
[CommonMark raw HTML](https://spec.commonmark.org/0.31.2/#raw-html).
Reviewed Markdown URI encoders can rewrite destination brackets or decode escapes
in visible URL text. Encoding HTML/Markdown delimiters in both anchor fields as
character references preserves the exact canonical destination and visible label
without allowing embedded images or attributes. The complete URL remains one link
and its query/fragment stay URL data. Existing HTTP/HTTPS and credential checks
still apply. URLs are not fetched or enriched. Readers that disable raw HTML
retain the escaped source reference as recorded text; their link policy remains separate.

Unit coverage checks image/link delimiters, emphasis, code, entity-looking text,
fragments, Unicode, existing percent encoding, IPv6 and ordinary query parameters.
Unsafe-protocol, credential and malformed-URL controls retain refusal. Browser
coverage exercises actual Copy and Download artifacts together, retaining the
answer, excerpt, pending payment label, file name and object-URL cleanup.

The official standalone CommonMark reference parser and an independent Markdown-it
bundle were also used for before/after verification of actual generated reports.
Static DOM checks require one anchor, its exact canonical destination and visible
label, and no extra image or attributes, across HTML-enabled CommonMark and
linkification profiles. These parsers are temporary verification tooling, with
their origins and hashes retained in local evidence; they add no project or
runtime dependency. Parsing and static DOM inspection load no HTML resources or
scripts and request no source or image URL.

This changes web report Copy/Download formatting. API, CLI, desktop, remote/stdio
MCP, extension and bot contracts retain their existing export roles. The original
run, authored answer Markdown, confidence, receipts and financial history remain
unchanged. Deployment, publication and version allocation remain separate actions.
