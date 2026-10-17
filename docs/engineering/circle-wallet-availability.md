# Recoverable Google wallet availability checks

The deployed Google wallet configuration endpoint was observed returning an
explicit `available: true` after 13.061 seconds. The previous UI aborted after
10 seconds and silently hid Google after network errors, leaving the owner
unable to reconnect a retained wallet.

The public readiness GET now has a bounded 30-second deadline. The configured
Google option remains visible while loading, with its action disabled. A timeout,
network failure, non-success HTTP response or malformed readiness result shows a
persistent failure and an explicit retry. That retry only reads public readiness;
connecting the wallet requires a separate click. An explicit boolean `false`
continues to disable this option. Abandoned checks are aborted and cannot publish
late readiness into another component. Reconnect initiation is serialized even
when it starts outside Wagmi's pending connection state.

Existing catalogue messages cover loading, failure and retry. No new locale
activation, translation claim, authority or configuration fallback is introduced.
This does not repair the origin's underlying response latency. That operational
investigation remains with the existing release owner.

The web connect, wallet and creator-browser handoffs share this component.
Desktop, CLI, remote/stdio MCP, API, extension and bots keep their existing
browser sign-in handoff and gain no signing or financial operation. Server
authentication, OAuth validation and expiry, wallet verification, POST deadlines,
signing, funding, cancellation, spend caps and retained custody are unchanged.
Required PR CI and independent authentication review gate merge; the existing
release coordinator owns the combined deployment. Source tests do not establish
a successful production login or settlement.
