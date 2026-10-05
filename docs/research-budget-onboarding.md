# Research budgets and Google wallet onboarding

The owner requested fewer repeated wallet confirmations on October 5, 2026. A
mainnet research budget now has an explicitly selected duration (1 hour, 24 hours
or 7 days), a total allowance and a maximum for each question. The default form
keeps the existing 0.05 USDC allowance and selects seven days; it does not activate
or fund anything until the owner reviews the wallet actions and signs the budget.

## Using a budget

Sign in, choose the allowance and per-question maximum, and select **Enable
research budget**. First-time funding still requires exact USDC approval, a
Gateway deposit and budget confirmation. Subsequent questions and conversations
reuse the active budget without another owner-wallet signature for each source.

Reload restores an active budget from the same browser. **Renew duration** keeps
the prior cumulative ceiling and all previously spent or pending amounts. An
external deposit cannot expand that ceiling. **Add to budget** is a separate,
reviewed funding and owner-consent operation. **Stop spending** blocks new
admission; prior exposed authorizations remain liabilities and funds remain in
Gateway for the owner's withdrawal.

The remaining amount is authorization capacity. Pending/uncertain signatures count
against it; only payment receipts establish real settled spending. The existing
server source/payment ceilings still apply to every question. Logout retains
encrypted recovery and locks signing. Clearing browser data or losing the device
can lose access to a funded browser signer. A Google wallet does not turn the
separate browser research signer into portable custody.

Google sign-in remembers only the public account identity across browser tabs.
A current, wallet-matching Keryx session must verify that identity before
reconnecting. Signing credentials remain in memory; **Reconnect Google wallet**
is required for new owner signatures after reload or expiry. Existing browser
budget custody can continue without a fresh Google signature while its own
authorization and authenticated session remain valid.

## Signed policy and compatibility

`keryx-session-grant-consent-v2` binds duration and exact integer micro-USDC
question maximum into both owner consent and session-key possession proof.
Server admission and the production signer independently enforce the selected
question maximum, immutable question budget and cumulative signer exposure.
Renewal verifies the original retained proof and cannot raise its ceiling.

Version 1 messages, proof bytes, original network, legacy deployment TTL and
funded custody remain unchanged. No payment history is migrated or reset. Existing
immutable consent JSON stores version 2; no new database schema is needed.
These are application/worker limits, not an on-chain policy wallet or an XSS-proof
vault. A longer signed lifetime deliberately extends the period of exposure within
the funded signer balance; independent security and live vendor acceptance remain
separate from synthetic source validation.

## Optional Google wallet setup

Circle User-Controlled Wallets provides a Google-authenticated, user-controlled
EOA on the selected Arc network. Backend session issuance derives wallet ownership
from authenticated Circle responses, never a client-selected wallet address.
Existing external wallets and their sign-in flow remain available.

Google requires a Circle Developer Console configuration and a Google OAuth client:

- `NEXT_PUBLIC_CIRCLE_APP_ID`: public Circle Wallets app identifier.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: public Google web OAuth client identifier.
- `CIRCLE_API_KEY`: private Circle Developer API key, environment only.
- `KERYX_CIRCLE_GOOGLE_ENABLED=true`: explicit activation after configuration and
  vendor acceptance; the checked-in template leaves this false.
- Existing `JWT_SECRET` and correctly selected network/profile configuration.

Configure Google OAuth redirect `https://keryx.cc/connect` for production and each
explicit development origin's `/connect` path for isolated testing. Add the web
client ID under Circle Wallets → User Controlled → Configurator → Social Logins →
Google. Google audience publication/test-user settings determine who can sign in.
Follow the [official Circle setup](https://developers.circle.com/wallets/user-controlled/build-a-wallet-app).

Absent or unavailable configuration hides the option and refuses its APIs. Source
implementation and synthetic tests do not establish that production Google login
is activated or that real wallet creation/signing/funding has passed. No mainnet
funding or live vendor mutation is part of source validation.

The configured mainnet packaging check uses synthetic public OAuth IDs, removes
the private Circle key, and exercises the emitted Next signer and Google SDK/UI
under the build's actual CSP. The separate Circle fixture covers OAuth return,
initialization, confirmations, reload and cross-tab logout with intercepted vendor
transport. SDK-only overrides keep its Firebase gRPC/HTTP dependencies on patched
versions of their existing major lines; the high-severity dependency gate remains
required.

Before activation, verify Google return/recovery and Circle Arc EOA message,
typed-data and raw-transaction signing on an isolated testnet configuration. The
vendor's raw-signing endpoint description and current supported-chain schema are
not fully consistent; source support alone does not resolve that integration
gate. Mainnet funding acceptance requires its own finite authorization.

## Supported surfaces

| Surface | Release impact and boundary |
| --- | --- |
| Web and browser API | Budget controls, signed policy, Google connector/authentication and independent signing checks. |
| Headless web client | Shared versioned consent/runtime validation accepts retained v1/v2 originals; no Google OAuth UI or unattended authority. |
| Public/private paid APIs, Monthly, remote MCP/OpenAI | Existing quote, entitlement, sponsored custody and payment rails remain separate; Google login creates no caller spending authority here. |
| Buyer/Operator CLI and stdio MCP | Caller-provisioned keys/journals remain authoritative; no Google tokens or automatic wallet creation. |
| Windows desktop | Existing research/task/receipt interface and deliberate browser/buyer handoff; no native Google signer or new budget reset. |
| Extension and Telegram/Discord/Slack | Existing hosted research adapters and browser handoff; no user-wallet signing in these adapters. |

Distribution versions are verified during release; a deployed web commit does not
prove that an installed desktop, extension or MCP package was updated.
