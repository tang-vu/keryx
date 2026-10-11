# Locale display and exact confirmation amounts

Relates to #274. This is a source candidate, not delivered issue acceptance.

## One display implementation

`lib/display/recorded-usdc.mjs` retains the existing canonical money functions and
adds locale display functions. `lib/i18n/format.ts` is a typed facade over that
implementation. The extension ships a byte-identical copy, checked by
`scripts/sync-extension-usdc.mts --check`. No dependency, version or locale activation
change is required.

`formatAmount` accepts the existing safe nonnegative micro-USDC integer range. It
splits integer whole and fractional parts before applying locale grouping and
decimal separators, preserving every micro digit, including sub-cent amounts.
`formatRecordedAmount` adapts legacy decimal records only when they describe exact
whole micros. It refuses fractional micros, unsafe values and unknown amounts;
it never rounds an accounting value into validity. `formatNumber` is separate and
may round ordinary display metrics. `selectPlural` uses the locale's plural rules.

The shipped UI registry remains English only. The shipped research bot copy uses
English, Vietnamese, Brazilian Portuguese and Spanish. Their existing language
selection now also selects monetary and contribution-weight presentation. The
prepared Simplified Chinese formatter remains unactivated. Preference integration
and translation rollout remain separate gates; this change does not add a switcher.

## Dates and viewer zones

`formatDate` accepts validated RFC3339 instants (including explicit offsets) or
integer epoch milliseconds, preserves exact UTC detail, and takes an explicit
viewer zone. `formatCalendarDate` handles publication days without inventing an
instant. Invalid dates and zones are unavailable rather than repaired.

`DisplayTime` renders deterministic UTC during server rendering and the initial
client render, then resolves the viewer's time zone after hydration. Absolute and
relative labels retain the exact UTC instant in the time element and hover title.
Relative time uses a caller clock or a mount-time observation; it creates no timer
or schedule. Static social images have no viewer context and show an explicit UTC
date. The Desktop renderer and extension resolve their local viewer zone and retain
UTC in details or the link title.

The audited display consumers include research answers and archives, payments and
cash-outs, sessions and grants, funding and withdrawals, creator registration and
offers, dispatch/history/status/proof screens, public publication dates, Desktop,
the extension popup, the human CLI and research bots.

## Verification before signing

`SigningAmount` renders ungrouped six-place amounts with the `USDC` code and the
exact integer micro amount. The detail explicitly identifies the decimal point
and absence of grouping. Grant consent, research checkout/private checkout,
funding, monthly purchases, withdrawals/cash-out and creator price/registration
confirmations use this display. Unknown or invalid amounts stay unavailable.

These components receive existing amounts for presentation only. Signer arguments,
admission checks, callbacks, reservations, stored integers and authority remain on
their existing paths. Arc native gas remains fixed 18-place native-unit display,
separate from ERC-20 USDC micros.

## Machine boundaries

Canonical `formatUsdcMicros`, `formatRecordedUsdc`, `recordedUsdcMicros` and
`sumRecordedUsdc` retain their prior implementation. API routes, remote/stdio MCP
responses, OpenAI-compatible responses, receipts, CSV, BibTeX, RIS, CSL JSON and
report exports continue using original machine serializers. They do not receive
localized output. The human bot text changes; retained run JSON does not.

The Desktop buyer-command amount retains its original fixed six-place conversion
in `buyerCommandAmount`. Display grouping is never parsed back into the command.
Remaining `toFixed` uses in API serialization, that command and graphical opacity
are intentional fixed machine/graphics contracts. Date-input, query-window,
sitemap and persisted observation timestamps retain their original machine format.

## Evidence and remaining acceptance

Focused tests cover exact integer/sub-cent/maximum-safe amounts for every shipped
display locale (plus prepared Chinese), grouping, invalid inputs, ordinary bigint
metrics, relative/plural rules, offset/sub-millisecond instants, publication days,
midnight zone changes and DST folds. Real serializers are compared byte for byte
around display calls. Actual English confirmation/time components are rendered in
the focused surface tests.

The local browser fixture exercises actual confirmation components at 320px and
768px in Los Angeles and Ho Chi Minh City, with no requests, callback execution or
payment. Its fixture CSS is not a full built-app review. Source review compares
original signing controls and machine paths, and audits human display callers.

Local full-app TypeScript, focused tests, renderer TypeScript, copy guard and
extension sync are recorded with exit and stream completion in the worker handoff.
The local Next build is unavailable because the protected shared dependency
junction points outside the Turbopack root. Full Desktop TypeScript is unavailable
because the read-only local dependency set lacks `@tauri-apps/api/core`. Neither
dependency set is changed to work around these limits.
The documented `next build --webpack` alternative also fails on the local
dependency set's missing `@x402/svm/exact/client` import through the wallet SDK.
Both actual build failures remain recorded; hosted build acceptance is required.

Applicable hosted aggregate, production and Desktop/platform checks must actually
pass on the final PR source. Root review, full built signing/confirmation acceptance
for the shipped English UI, coordinated distribution/deployment and original
issue acceptance remain gates. Root owns merge, release versions, deployment and
issue closure. Local tests or source review alone do not establish delivery.

Independent comparison with existing PR410 at `61c592a9` identified a useful
verification detail: budget labels should remain ungrouped throughout Ask,
session budgets and every grant-consent variant. This candidate now applies that
detail through its existing exact module and exercises actual grant/session
components without executing action callbacks. PR410 remains the integration
destination while open; its bound API and author changes must be reconciled by
root, rather than opening a duplicate PR or installing a second money algorithm.
The remaining-budget label subtracts the exact micro integer legs before display,
so valid `0.3` and `0.2` records show `0.100000` without repairing a binary float.
This derivation changes presentation only; stored state and action values retain
their existing authority.

The authorized source convergence preserves both worker `43745785` and author
PR410 `61c592a9` histories. All four author-only additions remain: the appended
decision, historical author receipt, creator-copy formatter mapping, and ledger
browser expectation. `createFormatters` keeps its author API as wrappers around
the strict browser-safe canonical implementation. Legacy fractional micros,
negative recorded amounts and unknown records remain unavailable; requested
money digits are minimums, with every authoritative micro digit retained.
The ledger observation explicitly renders UTC and seconds, with UTC details,
while ordinary time elements resolve the viewer zone after hydration. Desktop
and extension use the same canonical zone resolver. Remaining plural choices
in the existing owned My Asks, bulk registration and Desktop paths now use the
shared rules without activating another UI locale. Native 18-place gas and
machine command, payment, signature, store and serializer authority remain fixed.

Fresh combined-source validation covers 200 formatter, actual-surface,
creator-copy, existing bot-locale and export regressions; the final narrow
source/plural corrections additionally pass the 64 applicable source tests.
Creator-copy fixtures retain all original accessibility and control assertions,
forbidden I/O/signing, and original payloads; only reviewed exact-price details,
six-place price text and UTC-first deadline text change. Two targeted synthetic
browser zones test the changed resolver and explicit UTC observation, with no
network requests or action callbacks. Grant remains covered by SSR: its existing
mount-time recovery callback is not a browser signing acceptance test. Old
screenshots and all original failed/successful receipts remain intact.

This convergence inherits accepted `e9a97de9` source through the author parent,
but still contains the worker's unaccepted `343d10d0` root candidate. PR406
`efdf7b3a` was still open when inspected; its versions and source must be synced
after root qualification. Current full generated-framework, built English
signing-screen, independent review, aggregate/domain/platform CI and delivery
gates remain open. The retained local Turbopack junction, missing
`@x402/svm/exact/client`, Tauri dependency and stale generated-type errors are
qualified to their original receipts; no dependency or cleanup workaround is used.

PR406 subsequently merged as `46d265de` at 16:48:37 UTC. The final own-branch
source syncs actual accepted main `b1b431fd`, including the peer #414 binding
correction and #411 evidence correction. Its package/native/teaching sources and
app `0.27.57`, hosted MCP `0.3.15`, stdio `0.4.17` metadata are inherited from
accepted main, without a worker version or release change. The prior `2b210c42`
convergence checkpoint remains preserved. Exact-source root review, combined
hosted CI, full built signing acceptance and delivery still remain gates.
