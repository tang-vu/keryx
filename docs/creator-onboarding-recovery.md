# Creator sign-in and returning feed verification

The browser registration flow keeps a prepared feed in a canonical `/register?rss=...`
URL. Wanted links retain their paired `gap` and `post`; supported manual extension fields
`url`, `name` and `desc` also survive the sign-in return. Preparing a different feed clears
the previous Wanted match. Preparing validates URL format only; it neither fetches a feed
nor proves control of it.

The registration gate passes this draft as `/connect?returnTo=...`. Return targets accept
only the relative `/register` path and recognized, normalized draft fields. Absolute and
scheme-relative URLs, path escape, backslashes, raw control characters and fragments are
rejected. Feed/post URLs allow HTTP(S), without embedded credentials and up to 2,048
normalized characters. The actual nested connect URL is capped at 6,000 characters,
reserving space for the later wallet binding. Multibyte or heavily escaped fields are
preserved intact or explicitly refused before connecting. The user can deliberately
remove optional prefill while keeping the feed/Wanted match, shorten URLs or start a new
draft. Names and descriptions are never silently truncated. A directly opened
`/connect` retains its normal asker/creator navigation.

A connected wallet binds the draft's public `owner` marker once. Reload and sign-in failure
retain the draft without creating a source. Switching wallets requires returning to that
wallet or explicitly starting a new draft. Registration requires the connected wallet to
match the current SIWE session, displays that payout address, and remounts its form when
session identity changes. Draft query fields are public context, never authentication or
payout authority. The server still derives registration identity from the authenticated
session; editing the URL cannot authorize another wallet. Continuing sign-in or restoring
a draft never automatically submits a listing or wallet transaction.

## Resume ownership proof

A payout owner can reopen an unverified RSS source in **My sources**, or its **Manage**
page, and inspect `keryx-verify:<lowercase persisted payout wallet>`. Publish that exact
token anywhere in the existing feed, wait for publishing, then choose **Verify ownership**.
The same shared panel is used in the immediate registration result. Verification only
posts the persisted source ID; it does not create another source, initiate registry
registration or require registration gas.

`GET /api/sources/verify?sourceId=...` inspects the existing source for a SIWE-authenticated
payout owner. `POST /api/sources/verify` accepts `{ sourceId }` and rechecks that same
persisted payout identity. After the asynchronous feed read, an atomic verified-only
update compares the original source ID, payout and effective feed. Identity changes or
deletion return HTTP 409 `source_changed` with inspection/retry guidance. Registry price,
active state and authors are preserved, even when updated during the check. Split authors and other payment recipients retain their existing
notification-management role but do not gain feed verification permission. The portfolio
API supplies `verificationSource` only for a payout owner's RSS source; it is `null` for
an author-share recipient. Inspection and verification have no API-key authorization path.

A readable feed without the token returns `verified: false, code: token_not_found` and
safe retry instructions. A failed bounded public feed read returns HTTP 502 with
`code: feed_unavailable`; the token has not been checked successfully. A missing index row
returns HTTP 404 and never claims verification or known pending indexing. Recheck later
rather than repeat registration. Already-verified sources return success idempotently,
without fetching the feed or rewriting the source. Delayed responses after a session,
source or payout change cannot mark the newly displayed owner/source verified.

Verification proves feed control; paid discovery still requires an active, indexed
listing and the existing payment/registry authority checks. It does not prove a paid read,
citation reward, factual quality or settlement.

## Supported surfaces and release evidence

Creator sign-in, publishing and proof remain browser SIWE management roles. The web app
and hosted registration links used by the browser extension share these routes. Desktop,
CLI, remote/stdio MCP and bots remain research or inspection clients and do not receive a
new publisher identity, registration transaction or owner-verification capability. The
server/API checks and token helper remain shared by single/bulk registration; no contract,
registry configuration, payment adapter, package protocol or custody format changes.
A coordinated application release and deployed health commit still need verification
before claiming production delivery. No independent user adoption or new settlement is
established by the tests below.

`node --import tsx scripts/test-browser-creator-onboarding.mts` runs actual React pages,
forms, auth hooks and verification panels in Chromium under both independently compiled
network profiles. Synthetic wallet/auth/API fixtures intercept every HTTP request and use
only in-memory registry receipts. It covers fresh asker and returning
creator forward flows, prepared-feed reload, Wanted request payload, failed sign-in,
wallet/session mismatch, unsafe return targets, persisted proof after reload and in another
browser, missing-token/network/index retries, success and delayed old-owner responses.
Wrong-chain sign-in is disabled, SIWE messages carry the selected chain, and registration
uses the selected registry/RPC/explorer. The registration harness separately refuses a
wrong-chain public client and an offline mainnet response; receipt/event/index gates remain.
Unit tests cover strict return parsing, bounded fail-closed feed checking, payout-only
inspection and verification, author rejection, existing-ID persistence and idempotency.
These checks create no real listing, account, wallet, signature, payment or feed modification.
