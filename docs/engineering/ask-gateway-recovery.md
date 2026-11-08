# Ask gateway delivery recovery

An Ask POST receiving HTTP502 or504 previously read its entire error body and
displayed that body as the conversation error. A proxy HTML page became visible
markup text; an error body without EOF kept the interface streaming. Neither
response establishes whether the upstream application processed the request.

The browser now identifies these two statuses before reading the body, requests
cancellation and immediately displays the existing localized HTTP error and
unknown-outcome guidance. Cancellation rejection or an unfinished cancellation
promise cannot delay the error state. The parser applies the same classification
to every body; a JSON `research_paused`, `session_expired`, maintenance packet or
`Retry-After` cannot supply application, refusal or retry authority at502/504.
This follows the intermediary semantics in [RFC9110, sections15.6.3 and15.6.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.3);
unknown research/payment outcome is Keryx's conservative application conclusion,
not an assertion that any work or payment actually occurred.

The fixed `/status` link opens a separate tab without a referrer. It is a manual
GET, not validated planned-maintenance status. No report ID is invented. The
existing **Reopen original question** action remains explicit: it restores the
original question and request context for review, preserves subsequent edits,
and retains wallet/revision and hidden-turn ownership guards. It never submits,
signs, funds, renews, refunds or reconciles a job. Gateway errors do not invoke
automatic draft restoration or retry. Existing exact503 front-door validation,
ordinary errors, session expiry, rate limits, SSE interruption and terminal/stale
request guards retain their behavior.

The focused tests cover16 body/status combinations, seven other-status controls
and four minified Chromium conversations. They exercise actual parser, stream
hook, conversation, composer, error row, locale selection and owner guards with
synthetic responses: HTML, never-ending body, rejected cancellation and pending
cancellation. They check zero body reads, one Ask only, manual original recovery,
literal caller text, public/unlisted/private publication, hidden-turn removal on
owner change and a referrer-free status GET. Wallet sign-in and funding UI have
explicit fixture boundaries; these tests do not certify authentication, funded
research, payment completion or production availability.

Only the web Ask response consumer changes. The server, stream protocol, durable
payment journals, source/creator settlement, API/CLI/MCP/desktop/extension/bot
contracts and stored answers/receipts are unchanged. Desktop/extension/bot
handoffs keep their established roles. This source increment addresses recovery
from an observed class of gateway failure; it does not fix origin availability,
upgrade confidence or establish live research usefulness. Deployment remains a
separate owner-authorized operation.
