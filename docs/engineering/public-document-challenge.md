# Explicit verification responses are unread documents

Cloudflare documents the exact response header `cf-mitigated: challenge` as a
signal that a Challenge Page replaced the requested resource. Its documented
value is `challenge`, and the challenge is served as HTML regardless of the
requested resource type. See the [official detection contract](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/).

Public byte/document reads now refuse that exact marker before redirect, status,
type or body processing. The unread body is cancelled through the existing
transport lifecycle. The response cannot become source text, a content version,
an extraction result or evidence. Plain Cloudflare server/Ray headers, URL/query
words and article prose do not trigger the rule. This handles an explicit marker;
it does not detect every publisher verification system or infer that every blocked
response uses Cloudflare.

The content-free diagnostic adds `publisher-verification-required`, with only
elapsed time. Article reads map it to their already supported failure code of the
same name, so existing unread-source reporting and recovery instructions apply.
No response text, URL/query, Ray ID, cookie or arbitrary header value is retained
in the diagnostic. Caller cancellation retains precedence. Existing OpenReview
route handling, DNS/all-address and per-hop checks, pinned socket policy,
negotiation, deadlines, byte/type/full-response limits and ordinary HTTP failures
remain in place. Signed outbound webhook requests use a separate unchanged path.

Native fixtures use the real Undici response, headers, streams and Agent plus an
ephemeral loopback HTTP server. Only logical DNS and physical URL acquisition are
controlled; they do not establish public TLS/socket-pin acceptance or a live
Cloudflare observation. The real article extractor and source-outcome validator
run. Marked successful, partial, redirect and error responses remain unavailable;
unmarked original prose stays readable. A held body verifies refusal before EOF.
Existing SSRF, cancellation, byte-limit and ordinary HTTP controls remain covered.
No challenge solver, page execution, cookie replay, supplier retry, purchase or
payment action is introduced. This is document identity/failure handling, not
independent usefulness acceptance or a confidence increase.
