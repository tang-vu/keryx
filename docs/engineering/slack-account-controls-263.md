# Slack account-control refusal

Signed Slack `/link`, `/unlink` and `/whoami`, including those verbs under
`/keryx`, now return a fixed private unavailable response before opening storage,
checking sponsored research admission or scheduling research. Arguments never
appear in that response. Signature validation still happens first; invalid,
tampered or stale signatures are refused. Ordinary questions and existing help
and language controls keep their current behavior.

This is a Slack front-door correction for issue #263. Account linking remains
unavailable. It creates no token, account binding, history ownership or past-run
attachment. Telegram and Discord, web/API history, desktop, CLI, remote/stdio
MCP and browser extensions acquire no linking feature from this change. The
complete issue remains open until all three bots support verified private linking,
unlinking and identity reads, atomic binding uniqueness, expiry and token reuse
refusal, and user-confirmed past-run attachment.

Local validation uses actual HMAC signatures over synthetic POST bodies and
controlled admission/storage/delivery mocks. The parser, signed endpoint and
existing bot-language regressions pass 99 cases, and focused TypeScript passes.
These fixtures make no vendor
call or provider/payment request and establish no live Slack delivery. Required
CI, merge and the next combined deployment remain separate acceptance steps.
