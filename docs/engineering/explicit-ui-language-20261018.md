# Keep the explicit interface language

The installed interface could render English, then switch to Vietnamese when an account preference arrived. A saved English browser choice lost to the account value on remount; a choice made while session identity was unknown was discarded when identity resolved.

Preference order is now current explicit choice, explicit browser choice for the same origin/network/owner, account preference, Accept-Language, then English. A first unknown-session choice binds once in memory when identity resolves. An observed connected wallet takes precedence over an older confirmed guest for that fresh choice. Resolution does not copy or persist the choice: account/browser writes still require a new explicit selection with a confirmed scope. Owner, origin, network and logout boundaries remain isolated. Drafts and child DOM are retained.

## Validation and review

The new selected-English cases failed five of five against the exact prior runtime sources. The final focused run passed **29/29** tests in 9.01 seconds with offline testnet configuration, blank Supabase settings, one worker and Vitest cache disabled. Coverage includes immediate/delayed account reads on remount, unknown identity resolution/refocus, denied storage, failed account writes, observed-wallet changes, logout/network isolation, hydration and retained drafts/editor DOM. No live account, provider, payment or browser acceptance is inferred.

Independent source review by `critical_paths_qa`: **ACCEPT**, no concrete P1/P2, bound to implementation commit `43cda740c6ff1265d24bb731cfd844969504c2a8` (tree `cf532ce1d71943070789748850d3894c3753112d`). Review did not rerun tests. The shipped-English default allowlist is unchanged; this fix does not activate previews.

## Surface roles

| Surface | Effect and boundary |
| --- | --- |
| Hosted web, desktop/mobile browser shell | Shared locale provider keeps the explicit choice during account refresh, focus and navigation. |
| Browser and account preferences | Existing owner/origin/network storage keys, authenticated reply checks, request deadlines and explicit-write authorization remain. |
| Hosted account/session APIs | Wire contracts and server persistence are unchanged. |
| Desktop host, CLI, remote/stdio MCP, extension and bots | No independent native locale resolver, package contract or payment behavior is changed here. Any hosted page they open uses the hosted web provider; their own interface roles remain unchanged. |

ROOT owns required CI, merge and the deployment batch. This source note does not claim deployed or synchronized package delivery.
