# Reading heading-first HTML sections

The bounded original reader accepts a caller's explicit URL fragment on a
semantic `<section id="…">` when its first content is a direct heading. Whitespace
and comments may precede that heading. Sphinx uses this shape, including the
[Python task-cancellation documentation](https://docs.python.org/3/library/asyncio-task.html#task-cancellation)
observed on October 25, 2026. Previously, the same selector failed because the ID
belonged to the section rather than the heading.

The selected source range starts at that heading and ends at the enclosing
section's closing tag or the next admitted peer heading, whichever comes first.
Nested subsections remain within that range. The original source hash, character
offsets and heading level use the existing `keryx-html-section-scope-v1` receipt
metadata. A selected section remains a partial document read.

This is a narrow extension of the existing heading-ID and empty named-anchor
forms. Content before the heading, an indirect heading, a generic container,
hidden ancestry, duplicate anchors and malformed markup remain unavailable.
The complete byte-bounded document is still scanned for duplicate anchors, and
the selected range still passes through the isolated ordinary HTML parser.
Transport, parser admission, element/depth/time/text limits and caller-selector
identity checks remain in force. Redirects cannot choose the section.

Web, desktop's hosted workspace, API, repository CLI and remote/local MCP research
reuse the server reader. Extension and bot requests retain their existing
handoffs. No new public parameters, receipt format, payment path, model request,
storage schema or distribution version is introduced by this fix. Regression
tests use synthetic prose with the same container shape and the actual isolated
worker; the retained official original is separate local reproduction evidence.
