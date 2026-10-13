# Bank-first USDC funding on Arc

An optional mainnet step that lets a signed-in owner check bank-transfer eligibility
and buy USDC on Arc through Circle's hosted
[Arc Onramp](https://docs.arc.io/app-kit/onramp). It exists so a new reader without
USDC can fund their own wallet without leaving Keryx for an exchange.

## What it does

1. The owner signs in and selects **Check bank transfer eligibility** in the research budget
   panel or under **Add USDC to Gateway**.
2. `POST /api/onramp/session` mints a short-lived Circle session for the signed-in
   wallet, scoped to USDC on Arc.
3. A second click, **Open Arc Onramp**, opens Circle's flow synchronously in a separate
   window. Circle's providers check the buyer's eligibility, perform purchaser KYC
   and show their fees before taking payment. Preparing a session is not a purchase.
4. USDC is delivered to the owner's wallet on Arc. Depositing to Gateway and
   enabling a research budget remain the existing, separate owner-signed steps.

## Boundaries

- Keryx never receives the funds, bank/card data or identity data, and stores no
  purchase record. The wallet's on-chain balance is the only evidence of delivery.
  Widget events are best-effort hints and can be missed if the window is closed.
- The delivery address is the authenticated web-session wallet. The request body
  is not read, so a caller cannot redirect a purchase or widen the offered assets.
- The route requires a same-origin POST and an active session, and is limited to
  six sessions per wallet per minute. Vendor error detail is not returned.
- The server pins production API and popup origins, USDC/Arc asset filters and the
  session token. Sessions must expire in the next 30 minutes. Invalid or zero
  delivery wallets, foreign origins and credentials in launch URLs are refused.
  Only modeled session fields reach the browser; Circle API keys stay server-side.
- No Content-Security-Policy or Permissions-Policy change: the flow runs in its own
  window, not an embedded frame.

## Configuration

| Variable | Purpose |
| --- | --- |
| `KERYX_ARC_ONRAMP_ENABLED=true` | Generic explicit activation. When present, takes precedence over the legacy flag, including an explicit hold. |
| `KERYX_ARC_CARD_ONRAMP_ENABLED=true` | Existing activation flag retained when the generic flag is absent. No flag is set by this change. |
| `ARC_ONRAMP_ENVIRONMENT=production` | Production selection; omission preserves existing production callers. Other values except `sandbox` fail closed. |
| `ARC_ONRAMP_API_KEY` | Dedicated production `LIVE_API_KEY:…`; a nonblank invalid key refuses rather than falling back. |
| `CIRCLE_API_KEY` | Production-only fallback when the dedicated production key is blank. Needs App Kit access. |
| `ARC_ONRAMP_ENVIRONMENT=sandbox` | Isolated sandbox selection; never uses a production key or origin. Arc bank funding remains unavailable. |
| `ARC_ONRAMP_SANDBOX_API_KEY` | Dedicated `TEST_API_KEY:…` only. No fallback to either production variable. |

Production requires canonical `arc` server/public profiles (`KERYX_NETWORK` and
`NEXT_PUBLIC_KERYX_NETWORK`), a LIVE key and the existing `JWT_SECRET`/active web
session. Sandbox configuration is bound only to canonical `arcTestnet` profiles
and a TEST key. A copied/untrusted profile object or opposite-environment key
refuses. Environment and profile selection are server configuration, never request
body fields. The route still ignores the entire request body.

An operator must supply the correct existing account's App Kit credential and
explicit activation in the chosen environment. No credentials, account access,
KYB, wallets, funding or runtime environment have been created, tested or changed
for this source outcome. Credential format checks do not establish account access.

`GET /api/onramp/session` retains `available` and adds public `environment`,
`widgetOrigin` and `bankTransfer` metadata. `provider-dependent` means a configured
production widget can check eligibility; it does not mean this buyer can pay.
`unavailable` provides no purchase session. GET is unauthenticated and no-store;
POST retains authentication, same-origin checks and the existing rate limit.

### Verified SDK and sandbox boundary

The lockfile pins `@circle-fin/onramp-kit` **1.0.3**. Its local server types and
implementation were read alongside the official docs on October 14, 2026. The
server supports `baseUrl` and `widgetBaseUrl`; the browser supports `widgetBaseUrl`.
The SDK has no payment-method selection option. `assets.pairs` constrains the
launch URL, while `destinationChain: "Arc"` binds the server request. Do not invent
a bank-only SDK option or take `referrerDomain` from an Origin/header/request body.

Official [hosting requirements](https://docs.arc.io/app-kit/references/onramp-hosting-requirements)
bind production to `https://api.circle.com` / `https://onramp.arc.io`, and sandbox
to `https://api-test.circle.com` / `https://onramp-sandbox.arc.io`. Both SDK sides
must pin the selected widget origin. The existing production popup does so.

Sandbox bank test deposits are currently documented to arrive **only on Ethereum**.
Sandbox emits submitted hints, not settled events. Therefore this Arc-only
integration reports sandbox bank transfer unavailable and refuses POST before any
vendor call, even with a valid TEST key. It does not change delivery to Ethereum
or claim Arc testnet funding. The panel can display this limitation from capability
metadata, without purchase controls. Existing parent panels still hide the onramp
on testnet; this change does not activate or widen those foreign callers. Integrated
sandbox proof on Arc remains a vendor capability/verification gate. Any future
authorized sandbox trial must use dummy data and wallet-balance evidence.

## Limits set by Circle

- Payment methods, per the [Onramp documentation](https://docs.arc.io/app-kit/onramp),
  rechecked October 14, 2026 (retaining the issue #256 October 8 correction):

  | Method | Business verification (KYB) | Offered |
  | --- | --- | --- |
  | Bank transfer | Merchant KYB not required; purchaser KYC still required | Mainnet USDC on Arc in select US states and select EU countries; individual eligibility is provider-dependent |
  | Debit card, Apple Pay, Google Pay | Merchant KYB and server-derived `referrerDomain` required | Not enabled by this integration |
  | Credit card | Not supported | — |

- No exact country/state list or country-provider availability contract was verified
  here. Vietnam is not documented as supported. No guessed country list, eligible
  country picker or claim of support for all US/EU residents is added. Unsupported
  and unverified methods remain unavailable/unknown. Provider `NO_PAYMENT_OPTIONS`
  has an explicit refusal message; vendor refusal never creates settlement evidence.
- Review provider terms and fees in the hosted flow before paying.
- Business verification is completed in the
  [Circle Console](https://console.circle.com/app-kits/). It applies to the card and
  wallet-pay methods only, not to bank transfer.

## Remaining gates

- One production session was minted with the owner's key on 2026-10-06. No
  purchase, identity check or USDC delivery has been observed.
- A real eligible mainnet bank purchase, purchaser KYC, correct-wallet USDC arrival
  and mobile popup behavior remain unobserved for this candidate. Historical session
  minting is not that proof. No merchant KYB is needed for the documented bank method;
  card/wallet-pay activation retains its separate merchant KYB/domain gates.
- Integrated sandbox delivery to Arc is not proven and the documented bank test
  method is Ethereum-only. Safe configuration/refusal is not integrated sandbox proof.
- Exact country/provider UI and availability evidence remain open; no guessed list.
- Original [issue 256](https://github.com/tang-vu/keryx/issues/256) also retains its
  CCTP, sponsorship and passkey acceptance gates. This bank source increment does not
  close the issue or claim those other outcomes complete.

## Validation and surfaces

The focused unit/route tests retain prior assertions and add environment/key/profile,
origin, expiry, authenticated-owner wallet, sandbox-method and vendor-refusal controls.
`scripts/test-browser-arc-card-onramp.mts` uses real React/SDK/popup behavior with
synthetic HTTP at mobile/desktop sizes; it makes no Circle calls or purchases and
adds unavailable-method, malformed-session and event-hint controls. ROOT runs those
checks, TypeScript and applicable build/CI/review gates; they were not run by this worker.

Web and the existing authenticated API are the applicable funding surfaces. Desktop
uses the hosted browser for identity/payment entry. CLI, remote/stdio MCP, extension
and bots retain their existing wallet/browser handoff roles; no key, popup session,
purchase automation or new funding contract is exposed there. Deployment, release
versions and activation remain with ROOT's existing batch owner.
