# Locale source foundation

This source increment addresses independent preparation for issues
[271](https://github.com/tang-vu/keryx/issues/271),
[274](https://github.com/tang-vu/keryx/issues/274) and
[277](https://github.com/tang-vu/keryx/issues/277). It activates no translated
interface, switcher, profile preference, public locale route or report metadata
adapter. English remains the sole shipped interface locale. Vietnamese and
Simplified Chinese remain prepared locales, with unapproved draft glossaries
under the [translation review gate](../translation-instructions.md).

## Catalogue and preference contracts

`lib/i18n/locales.ts` admits explicit preference, then stored preference, then
quality-ranked `Accept-Language`, then English. It does no request, cookie,
profile or browser I/O. The default enabled list contains English only; a future
adapter must supply the actual release allowlist after its translation gates
pass. Unsupported scripts are not silently folded into a reviewed script.
Traditional Chinese has no prepared catalogue. Equal header weights preserve
header order. Invalid quality values are ignored; zero quality conservatively
excludes region aliases of that same prepared locale. Headers and preferences
are bounded. Wildcards retain the English default.

`lib/i18n/messages.ts` defines English source keys and derives required named
parameters in TypeScript. A misspelled key or missing parameter fails type
checking. Valid missing target entries render English and may report the locale
and key through an injected development reporter; parameter/question values
are not included. Unknown English keys refuse rather than rendering a raw key.
The catalogue validator reports missing and invalid entries for CI/review.
Target placeholders must match the source. This is plain text, not HTML; callers
must render it as text rather than through an HTML injection API.

Pass only the selected catalogue through a server/client boundary; the helper
does not import every target dictionary. The source has no runtime loader or
profile migration. Its English navigation/source labels do not retrospectively
approve existing payment or legal prose.

## Exact formatting contracts

`lib/i18n/format.ts` uses the existing bounded authoritative micro-USDC formatter
instead of introducing a second amount parser. Locale display groups the whole
BigInt and inserts the locale decimal separator while retaining every known
fractional micro digit. It accepts the same canonical nonnegative safe integer
inputs and maximum as the existing module. No floating-point monetary amount
or rounding repair is introduced. Invalid or missing amounts remain unavailable.

Signing verification text remains invariant, ungrouped, with six decimal places
and `USDC`. Display values never flow into signatures, comparison, persistence
or budgets. Generic number formatting is separate and may round its display;
it is not an amount-authority API.

Dates accept exact UTC instants, require an explicit viewer zone and return the
UTC value for `<time dateTime>` and hover/details. Invalid calendar dates and
zones refuse rather than normalizing silently. Relative display requires a
caller-supplied observed clock; it introduces no scheduler or hidden clock I/O.
Plural categories use `Intl.PluralRules`, including `other` for singular counts
in Vietnamese and Chinese. Each catalogue owns its actual wording.

The canonical `lib/display/recorded-usdc.mjs` and byte-identical extension copy
remain unchanged. API fields, stored answers, signed requests, portable receipt
digests, CSV/BibTeX/RIS/CSL-JSON and other machine outputs have no locale dependency
in this increment. Tests check canonical strings and exact formatter boundaries;
they do not claim a future integrated response is byte-identical.

## Public URL and content-language contracts

Keep existing report and profile URLs unchanged. Preference negotiation will
not add mandatory prefixes or redirect public permalinks. The framework's
prefix approach is available for an eventual independently published translated
interface page, but it is not needed to negotiate an interface preference.
Each actual page family must qualify rendering/cache behavior before integration.
The static root layout must not gain request cookie/header access incidentally.

`lib/i18n/public-metadata.ts` requires actual published root-relative variants
and a canonical that is one of them. It creates an `x-default` pointing at the
English fallback. Prepared but unshipped locales are refused by default. It
does not create variant URLs by string concatenation or advertise a page merely
because a viewer selected a locale.

The report helper requires explicit public visibility before producing any
language metadata. Private, unlisted and unknown inputs return nothing before
reading the identity/language. The caller must authenticate the stored visibility;
the flag is not itself an authorization capability. A report keeps exactly one
`/dispatch/<id>` canonical. Recorded answer language is independent of viewer or
question language; there is no text detection or model inference. Missing
historical language returns `lang="und"` and omits structured `inLanguage`.

Current `QueryRun` has no persisted content-language or visibility field. This
increment therefore does not connect the helper to the public report, sitemap,
feed or archive. An adapter needs independently reviewed recorded output-language
and privacy authority, including private/unlisted enumeration regressions. Never
backfill language from question heuristics or relabel protected historical data.

## Surfaces, checks and remaining gates

Web server/client consumers, desktop and extension presentation can use these
browser-safe pure helpers after their own integration and release gates. CLI,
API, remote/stdio MCP and bots retain existing machine fields, human text and
versions. No adapter imports these modules, so there is no user-visible runtime
release or version reservation. No model, search, payment, shared database,
deployment, package publication or custody action is performed by these checks.

Focused offline regressions cover preference order/admission, named parameters,
fallback/missing-key reporting, exact amounts and invalid input, zone rollovers,
relative clocks/plurals, canonical/alternate boundaries, unknown historical
language and nonpublic refusal. They run in the existing Vitest CI discovery and
TypeScript graph. Full applicable hosted CI, including production build, must
accept the exact source before merge.

All three issues remain open. Issue271 still needs an integrated switcher,
draft-preserving changes, persistent signed-in preference, selected-catalogue
delivery and `<html lang>` behavior. Issue274 still needs component migration,
active-locale integration and human signing/confirmation review. Issue277 still
needs recorded answer-language/visibility adapters, translated public metadata,
archive filtering, actual sitemap/feed alternates, structured-data validation
and verified Vietnamese/Chinese preview fonts. These gates are not satisfied by
the pure source tests. The release45 operational main freeze also remains in
force; this candidate stays draft without merge or deployment.
