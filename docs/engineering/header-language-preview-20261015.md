# Offer the existing header language previews

The owner observed that the header language selector offered only English.
The preference provider, lazy Vietnamese and Simplified Chinese shell catalogues,
and preview labels were already implemented, but the application composition
still used the provider's English-only default.

Offer `en`, `vi` and `zh-Hans` explicitly in the application provider. Keep this
list separate from `shippedUiLocales`: the latter remains English-only authority
for fully shipped interfaces and public language variants. Preparing another
locale must not automatically offer it to users.

The two target options remain labelled previews. Only the existing neutral
header/footer navigation changes. The full notice explains that these are
machine drafts and other text remains English. It stays visible in the phone
menu; desktop controls expose it through their tooltip and accessible description
so the long notice cannot overflow the fixed-height header. Route content, wallet and payment
messages, consent, legal terms and public canonical/alternate URLs retain their
existing language and review requirements. This does not complete issues 271,
273, 275 or 276, or claim a fully translated product.

Existing preference handling preserves the current page, unsent questions,
editor state, wallet identity and request fields. Browser preference persistence
and authenticated account storage continue through the existing scoped paths;
this change adds no storage adapter, migration or cross-device guarantee.

## Validation and surfaces

Validate the actual application provider composition alongside the existing
compiled locale fixture. Cover the three offered options, both translated
navigation previews, mobile selection, browser restoration, unchanged draft and
URL state, and English fallbacks. Retain the existing disabled/default-provider,
synthetic account and invalid-catalogue controls. Check the real stylesheet for
header/footer overflow before release. Required PR CI and source review remain
merge gates.

Web desktop/mobile header and footer use the changed provider. The desktop app's
embedded web pages receive it with the web release. Standalone CLI, API,
remote/stdio MCP, extension popup and bot language contracts are unchanged;
links into the website use its preference behavior. Public metadata continues
to advertise only actual English page variants.

This focused outcome has no version allocation, package/installer publication
or individual deployment. After review, applicable CI and the serialized merge,
the existing release coordinator includes it in the next deployment batch and
checks the public header. Source completion does not claim deployed delivery.

Local acceptance: 61 existing locale/context/catalogue/public-metadata tests
passed. The extended retained Chromium fixture passed at 320, 390 and 1366 px
using the actual application provider and app stylesheet for `/offered`, while
retaining the original default/preview and failure controls. Both browser
preferences survive reload, drafts and editor state survive selection, and
the original request fixture is unchanged. The first 1366 px failure exposed
notice overflow; the corrected source passes the same height assertion. VI
desktop and Chinese phone screenshots were inspected. Changed-source lint,
the UI-copy guard and whitespace checks passed. Wallet/auth transport stays
synthetic; these checks do not claim actual account persistence, production
Next rendering, payment execution or human translation approval. Hosted build
and full applicable CI remain required before merge.
