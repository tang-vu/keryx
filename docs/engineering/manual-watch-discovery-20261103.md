# One explicit current-metadata watch check

The existing private watch `check` still compares the curated local catalog with
zero outbound requests. The separate `check-current` action requires the exact
one-request consent `send-keywords-to-crossref-once`. The browser shows the actual
keywords, starts unchecked, binds consent to the current watch revision and
consumes it before submitting. Account/focus changes clear it. Refresh/list,
watch creation and ordinary controls never start an external check.

The adapter sends one unauthenticated GET to the existing official Crossref
metadata transport: `query.bibliographic`, `sort=indexed`, `order=desc` and at
most six rows, additionally bounded by the watch's row allowance. The
[official API documentation](https://github.com/CrossRef/rest-api-doc#sorting)
defines index-date sorting; it is not a publication-date claim. No cursor,
background poll, retry or alternate supplier is used. The full private question,
wallet/watch/session identifiers and author/venue filters are not sent. Existing
title/author/venue matching is applied locally to complete observed records.

The existing public-only transport fixes the official host, refuses redirects,
caps the response at 250,000 bytes and bounds acquisition to six seconds or the
remaining check deadline. It has no credentials, payment proof, paid fallback,
paper-body fetch, model or signing capability. HTTP/provider refusal fails the
check. Oversized, malformed or unexpectedly overfull pages refuse rather than
silently truncate; unusable individual rows are counted as incomplete metadata.

The ordinary watch domain still owns the positive admission/CAS, original session,
period/check capacity, concurrency, expiry, pause/cancel and unknown-ack rules.
The adapter is only substituted after authenticated same-origin body/consent and
revision validation. A stale/revoked/aborted/failed check cannot advance its
watermark or turn into a successful empty check. Reobserving the same record with
a new observation timestamp does not create a new metadata fingerprint.

This is one bounded recently indexed page, not exhaustive discovery or proof that
a paper was newly published, read, cited, accepted or paid. Historical watch state
does not acquire a provider attestation: its existing hashes/counts remain the
original contract. No state/SQL schema or migration is introduced. The API and
authenticated web UI add the explicit action; desktop may use its existing web
handoff. CLI/MCP, extension and bots gain no scheduled/private watch authority.

Source acceptance covers adapter bounds/provenance, actual domain watermark and
failure paths, authenticated action admission, UI consent, the existing native
store controls, OpenAPI and applicable PR/platform CI. All provider responses in
regressions are synthetic; no independent adoption or live discovery result is
claimed. Scheduling, standing spend, paid delivery, main merge, deployment and
release remain held by the owner.
