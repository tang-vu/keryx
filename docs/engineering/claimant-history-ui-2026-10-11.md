# Claimant history UI — source preparation for #262

This focused outcome depends on the personal-history catalogue checkpoint
`bebd6b697b519c04b0743d044121e18891fc3786` and reviewed ordinary claim/history
checkpoint `7c08de848a157047478ed7f228e82f901779b210`. Their clean union is
`8958d61ed15de6034c0c9c056b78151e8fe525e6`, tree
`782d98b890337c71a8aeef4706aaface1ffd8b9a`. Existing private-ingress and CLI
delivery follow-ups remain separately owned within the coordinated #262 outcome.

The current-network personal history page now has a distinct **Recorded and
claimed runs** pane. It reads the existing `/api/me/run-history` and private detail
endpoints. The existing current ledger, testnet ledger and `CurrentHistoryPane`
remain separate and unchanged. No claim credential, claim POST, export, public
dispatch/receipt link, creator link, analytics event or persistent client storage
is introduced. The page's server metadata and props remain unchanged; its initial
document contains no private saved run or claim credential.

The owner precondition comes from the existing server session lookup, never the
connected-wallet address. The server reauthenticates each GET and retains ordinary
capability admission and key scope checks. The browser verifies owner, configured
network and actual same-origin binding on each response. Summary pages are bounded
to 25 rows; opaque cursors are passed only to the same fixed endpoint, with a
40-page local browse bound and explicit newer/older/reset actions. This is the
server's current-store anchored cursor, not a historical transaction snapshot.

Each read has a ten-second abort deadline, same-origin credentials and redirect
refusal. Lists have a two-MiB response bound; detail allows 4,016,384 bytes for
the existing ordinary-store 4,000,000-byte original plus its bounded envelope.
There is no polling or automatic retry. Tab and
owner/network changes unmount the old pane; stale completions cannot publish old
rows or details. Each list revision hides previous detail immediately. Detail
must match the selected run's ID, saved time, question and separate ownership.
Only its question, answer and cited source markers/names are retained for plain
text display. Other original fields are discarded from component state. Claim
ownership is explicitly separate from payer, funding, receipts and settlement;
the UI changes none of those fields or the original saved run.

Missing/default-off/native/archive capability, lost ownership, malformed packets,
owner mismatch and failed requests show fixed English unavailability. There is
no alternate-store/public-report fallback or activation. The dedicated claim and
private research document protections remain under their existing implementation;
this pane has no secret ingress and does not weaken those boundaries.

All new visible English copy uses a dedicated catalogue with named placeholders
and explicit count plural forms. Original history copy, dates, funding predicates,
auth and callbacks are preserved. The new pane is a web account consumer of the
existing private API. API, CLI, stdio/remote MCP, desktop, extension and bots retain
their existing role and delivery contracts; no adapter or version is changed here.

Focused tests exercise browser-safe packet validation and the real React pane
against controlled owner-authenticated server-route fixtures with a synthetic
in-memory history port. They cover explicit pagination/private detail, refusal,
plain text, stale owner responses, abort deadlines and existing tab transitions.
The session hook, public page transport and existing browse boundary are controlled
fixtures, not actual authentication, native enrollment, production database or
normal Next boot acceptance. No real claim, provider, payment, shared DB or DDL
occurs. Hosted combined-source default Next build, review, coordinated release,
private ingress qualification and separately authorized storage/deployment gates
remain required. This preparation alone does not close #262 or #272.
