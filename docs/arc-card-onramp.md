# Arc card onramp

An optional mainnet step that lets a signed-in owner buy USDC on Arc with a debit
card, Apple Pay or Google Pay through Circle's hosted
[Arc Onramp](https://docs.arc.io/app-kit/onramp). It exists so a new reader without
USDC can fund their own wallet without leaving Keryx for an exchange.

## What it does

1. The owner signs in and selects **Prepare card purchase** in the research budget
   panel or under **Add USDC to Gateway**.
2. `POST /api/onramp/session` mints a short-lived Circle session for the signed-in
   wallet, scoped to USDC on Arc.
3. **Open Arc Onramp** opens Circle's flow in a separate window. Circle's providers
   (Transak for card and wallet payments, Socure for identity) verify the buyer and
   take the payment there.
4. USDC is delivered to the owner's wallet on Arc. Depositing to Gateway and
   enabling a research budget remain the existing, separate owner-signed steps.

## Boundaries

- Keryx never receives the funds, card data or identity data, and stores no
  purchase record. The wallet's on-chain balance is the only evidence of delivery.
  Widget events are best-effort hints and can be missed if the window is closed.
- The delivery address is the authenticated web-session wallet. The request body
  is not read, so a caller cannot redirect a purchase or widen the offered assets.
- The route requires a same-origin POST and an active session, and is limited to
  six sessions per wallet per minute. Vendor error detail is not returned.
- The server pins the launch URL to `https://onramp.arc.io` and returns only the
  modeled session fields. The Circle API key never reaches the browser.
- No Content-Security-Policy or Permissions-Policy change: the flow runs in its own
  window, not an embedded frame.

## Configuration

| Variable | Purpose |
| --- | --- |
| `KERYX_ARC_CARD_ONRAMP_ENABLED=true` | Explicit activation. Anything else hides the option and refuses the API. |
| `ARC_ONRAMP_API_KEY` | Optional dedicated production Circle key. |
| `CIRCLE_API_KEY` | Used when the dedicated key is blank. Needs App Kit access in the Circle Console. |

The feature also requires the mainnet profile, a production-format key
(`LIVE_API_KEY:…`) and the web-session secret. A test key or the testnet profile
keeps it off.

## Limits set by Circle

- Payment methods, per the [Onramp documentation](https://docs.arc.io/app-kit/onramp),
  rechecked October 8:

  | Method | Business verification (KYB) | Offered |
  | --- | --- | --- |
  | Bank transfer | Not required | USDC on Arc, in select US states and select EU countries |
  | Debit card, Apple Pay, Google Pay | Required; the server must also pass `referrerDomain` when creating the session | US, UK, select EU countries and other countries |
  | Credit card | Not supported | — |

- The exact country list is in Circle's Onramp Provider Schedule.
- A sandbox environment exists, with its own API key.
- Circle charges no fee for the onramp itself; providers, banks and card issuers
  may charge their own.
- Business verification is completed in the
  [Circle Console](https://console.circle.com/app-kits/). It applies to the card and
  wallet-pay methods only, not to bank transfer.

## Remaining gates

- One production session was minted with the owner's key on 2026-10-06. No
  purchase, identity check or USDC delivery has been observed.
- Bank transfer needs no business verification and is the method to enable first.
  This page and the integration still describe card funding only; widening both is
  tracked in [issue 256](https://github.com/tang-vu/keryx/issues/256).
- Card, Apple Pay and Google Pay are blocked until Keryx has a registered legal
  entity to complete business verification. That is not expected before the event
  deadline.
- Bank transfer is not listed for the regions where current mainnet users are. Users in regions without a supported
  method need sponsored credit or a cross-chain USDC deposit instead.
- Sandbox operation is not wired; its endpoints and test-network delivery were not
  verified.
- A real owner purchase on `keryx.cc`, including popup behaviour on mobile
  browsers, is required before describing card funding as working.
