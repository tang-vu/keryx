# English account and session catalogue

This increment of [issue 272](https://github.com/tang-vu/keryx/issues/272)
extracts the existing English copy from `/connect`, its connection/sign-in
steps, and the signed-in session inventory into the typed `account.*` and
`accountSessions.*` keys in [messages.ts](../../lib/i18n/messages.ts). The
headings, instructions, chain-switch title, buttons, accessibility labels,
loading/error notices and page-owned toasts retain their existing English.
Wallet addresses, role values and server error messages remain data. Session
dates retain the existing `en-US` presentation; locale formatting belongs to
[issue 274](https://github.com/tang-vu/keryx/issues/274).

The sign-in title and wallet-bound registration warning are whole catalogue
sentences with named React-node placeholders. The small
[rich-message adapter](../../lib/i18n/rich-messages.tsx) reuses the validated
selected-catalogue snapshot and English fallback, then inserts keyed Fragments
without DOM wrappers. It permits sentence order changes and repeated named
nodes, refuses missing or extra parameters, and never parses inserted strings
as templates or HTML. The existing plain-text formatter keeps its behavior.
The network instructions and session date sentences also retain their original
adjacent text-node boundaries through named Fragment insertion, preserving font
shaping at those data boundaries.

Only 54 retired copy allowances from the three migrated files are removed from
the UI-copy baseline. Other files, its original source provenance and parser
version are preserved. The three step-indicator digits remain documented
presentation data rather than language-bearing prose.

Acceptance covers the existing auth/session/registration tests and browser
failure-path tests, rich-node contract tests, copy-guard regressions and scan,
app and operations TypeScript, scoped lint and the default production build.
The bounded local render check compares the base and migrated real account
components with the same production CSS at 390px and 1280px for both compiled
network profiles. It checks connection, wrong-chain, signing/verifying,
authenticated asker/creator, resumed registration/claim and wallet-mismatch
states, plus existing page sign-in/sign-out controls. Authentication/connector
identity and HTTP are synthetic; no wallet signature, provider call, mainnet
operation or shared database is required. Retained local receipts distinguish
actual passing checks from pending release gates.

The applicable runtime surface is the web account UI. Desktop, CLI, remote and
stdio MCP, API, extension and bot account roles keep their existing contracts;
this migration changes no shared authentication/payment protocol or client
distribution. Nested wallet/Google-auth widgets, profiles, API keys, other web
areas and other surfaces still require their own catalogue migration. No
locale or translation pilot is activated. App/OpenAPI0.27.49 identifies this
coherent release candidate because app0.27.48 was already published from
acf818e3. The root lockfile changes only its two root version fields; dependency
closures and independent client/installer versions remain unchanged. Catalogue
imports are confined to the web app/components; the other supported surfaces
import no changed account copy graph. OpenAPI changes only its document release
label. The retained source study binds the complete normalized root lockfile,
so its artifact and write-up are reproducibly refreshed through the documented
offline command. All 48 trials remain deterministic simulations with denied
outbound calls, an in-memory fixture store and zero real settlement.

Issue272 remains open. This extraction does not establish human approval of
payment, signature-consent or legal translations. The separate
[translation review gates](../translation-instructions.md) continue to apply,
and hosted CI, source review and the coordinated runtime release remain gates
before synchronized production delivery can be claimed.
