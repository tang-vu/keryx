# Observed partial HTTP responses in public articles

Public article reads retain useful bounded text from a successful response that
identifies itself as partial: HTTP 206 or any terminal `Content-Range` header.
The transport carries only an optional true flag. It does not retain the header
value, infer missing byte offsets, issue a Range request or fetch a continuation.
Redirect-response headers cannot describe the final document's reading scope.

HTML, XHTML, plain text, Markdown and PDF reads compose that fact with their
existing extraction limits. The resulting article and public receipt use the
existing `webProvenance.truncated` field. Received text, source URL, body/version
digests, HTML structure and observed PDF page scope retain their existing roles.
A one-page PDF parsed successfully from a partial HTTP response still carries
incomplete transport scope; its page count cannot establish the missing original.
The absence of a partial flag does not independently certify a complete source.

Whole-document membership callers retain their stricter existing behavior:
require status 200 and no Content-Range, cancelling a refused body before parsing.
All DNS/socket, HTTPS, byte, timeout, redirect, type, parser and cancellation bounds
remain in place. There is no new request, purchase, retry, reward qualification,
payment authority, receipt schema or stored-report backfill.
