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

- Debit card, Apple Pay and Google Pay only. Credit cards are not supported.
- Offered to eligible buyers in the US, UK, selected EU countries and other
  selected regions. The exact country list is in Circle's Onramp Provider Schedule.
- Circle charges no fee for the onramp itself; providers, banks and card issuers
  may charge their own.
- Circle states that business verification (KYB) in the
  [Circle Console](https://console.circle.com/app-kits/) is required to enable
  certain payment methods.

## Remaining gates

- One production session was minted with the owner's key on 2026-10-06. No
  purchase, identity check or USDC delivery has been observed.
- Whether an individual developer can complete Circle's business verification, and
  which payment methods work before it, is unverified.
- Availability for buyers in Vietnam is unverified.
- Sandbox operation is not wired; its endpoints and test-network delivery were not
  verified.
- A real owner purchase on `keryx.cc`, including popup behaviour on mobile
  browsers, is required before describing card funding as working.
