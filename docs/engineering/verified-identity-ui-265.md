# Saved identity UI truth and failure handling

The private profile panel accepts a verification return hint only after a strict
identity snapshot matches the current wallet, the profile is saved and at least
one stored verified identity exists. The hint creates no verification record or
date. Empty, malformed, foreign-owner and unavailable snapshots cannot display
successful verification. Typed links remain distinct from stored identity records.

Provider/transport/JSON exceptions now show fixed catalogue messages rather than
raw error details. Owner changes retain the dedicated message. Unlink still
requires the exact acknowledgement; navigation still requires the existing HTTPS
provider host/path allowlist. Owner change, profile deletion/recreation and
unmount retain the abort/remount guards against late results.

R23 independently reviewed the two source/fixture paths. The actual mounted
React DOM fixtures pass 59 cases and focused TypeScript passes. The fixtures use
synthetic authenticated-session, transport
and navigation boundaries; they make no provider, storage or payment call.
Required CI and the combined deployment remain separate steps.

This is a private web/hosted-desktop UI correction for issue #265. Provider,
OAuth/session, persistence, CLI/MCP and public-profile contracts are unchanged.
The complete issue stays open for its public projection, current provider-scope
review and live/configured activation requirements. Existing ENV and rollout
holds remain in force.
