# #275 explicit namespace browser preview

This source increment extends `scripts/test-browser-locale-preference.mts`, the
existing esbuild/Chromium fixture using the actual LocaleProvider, header, footer
and language switcher. Source authoring is complete; compiler, esbuild, browser,
visual, control and CI validation are **UNRUN** in this author session. The parent
owns acceptance of the finalized combined #275 source, its focused PR and required
CI. This note does not accept concurrent draft assets or their derivative manifest.

The fixture retains the shipped English default and explicitly enables prepared
locales only in its synthetic `/preview` composition. Its new preview button requests
actual lazy `ui-drafts/shell.json` and `ui-drafts/legal.json` imports for VI or
Simplified Chinese. English source paths are literal, hashes are computed from the
current English file bytes normalized to LF, and leaves come from actual English
exports. None of these trusted bindings comes from draft metadata, the checker or a
manifest. The two selected English files have single exported catalogue roots;
this bounded scenario makes no completeness claim about other namespaces, multiple
exported roots, or historical leaf counts.

The authored assertions require four distinct target/namespace chunks outside the
entry bundle. English, disabled/unknown targets, missing requests, unknown namespaces
and empty scopes invoke no loader. Changing the shell preference alone requests no
namespace chunk. Explicit VI loads only its two namespaces before Chinese is requested.
The panel visibly labels its results `Preview only · machineDraft · review:null · no
human approval`. Neutral translations must come from the actual assets and differ
from independently imported English. Named placeholders and USDC/Arc/x402 protocol
tokens retain their exact multiplicities. Paid research, legal copyright, all selected
legal prose and wallet authorization consent remain current English with `lang="en"`.

Synthetic corrupted copies test stale source hashes/paths/leaves, unknown leaves,
malformed entries, non-null review, invalid status, unread getters, failed loading,
damaged protocol tokens and damaged placeholders. Whole-namespace refusals return
empty catalogues; invalid individual leaves retain English while valid siblings
survive. Original draft assets are never modified by these controls.

The original 320px and 1366px scenarios remain; a 390px phone scenario uses the same
mobile menu and Escape/focus assertions. Both target previews add text range bounds,
font readiness, nonempty Chinese glyph runs, element overflow and page horizontal
overflow assertions, plus separate full-page screenshots. These checks use the
fixture's bounded CSS. A parent must inspect Chinese glyph shapes for missing-glyph
boxes and inspect wrapping/clipping in the screenshots; font readiness and range
geometry alone do not prove correct glyph rendering. Actual production CSS/fonts
and Next boundary acceptance remain separate.

Existing owner/network-scoped auth and preference transport, account refresh,
owner change, logout, corrupt/denied browser storage, failed account writes,
keyboard/accessibility, editor and unsent question preservation, original report
URL, exact captured Ask packet and one-child-mount assertions remain. Namespace
controls add no API requests. All routes stay on the intercepted fixture origin;
unexpected paths and real provider/target traffic refuse. Wallet/dispatch fixture
boundaries remain synthetic. No real signing, payment, credential, account storage,
target, provider or cross-device persistence acceptance is inferred.

Parent next action: finish the concurrently owned exported-root/derivative-manifest
correction, bind actual final English/runtime/assets, review this source and run the
existing checker/unit/compiler gates plus this existing browser script in an owned
output resource. Inspect VI and Chinese screenshots at 390px and desktop, run the
required failure controls, resolve observed failures and pass the focused PR's
required aggregate/domain CI before serial merge. Record the coherent #275 result
with remaining genuine human translation/legal approval gates. No shippedUiLocales,
preference defaults, flags, runtime route/source, activation, dependency, package or
distribution change belongs to this increment. Web/desktop shell evidence is bounded
to the compiled fixture; CLI, API, remote/stdio MCP, extensions and bots gain no new
runtime localization authority from it. Deployment stays with the existing batched
release owner.

## Parent validation — October 15, 2026

The final collision-aware catalogue covers 60/60 extracted namespaces and 5,575
structural leaves per locale: 5,554 machine drafts and 21 preserved identifiers.
The source/data reviews accepted the full restoration and the twelve observed VI
corrections; no translator or legal approval is implied. The corrected manifest
and CLI regression pass, as do the six changed extraction cases, eight loader
cases and focused compiler closure. Earlier failing captures remain retained.

The existing esbuild/Chromium fixture passes at 320, 390 and 1366 pixels. Nine
screenshots were retained; VI and Simplified Chinese phone/desktop images were
inspected for readable glyphs, wrapping and critical English fallback. This is
explicitly the synthetic compiled fixture, not production Next/CSS/font or human
translation acceptance. Required PR CI, current-source binding and named human
review remain gates. English stays the only shipped UI locale.
