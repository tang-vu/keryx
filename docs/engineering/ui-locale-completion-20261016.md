# Complete the interface language previews

The owner reported that language previews translated some UI but left other
screens in English. PR521 offered the navigation previews; most pages and client
components still selected their English catalogue explicitly. Drafts added since
PR494 also left uncovered entries in the current source inventory.

This outcome connects authored page copy and client controls to the same selected
language. Server Components keep data fetching and English public metadata; small
client text leaves update their authored copy. Client components consume shared
keyed messages or their own namespace object. Questions, reports, quotations,
source titles, receipts, URLs, identifiers and submitted arguments are not fed
through a DOM translator. Existing component state is retained across a switch.
Native attribute boundaries own their native element and leave Server Component
children opaque. SVG and option leaves return plain text to preserve valid markup.
English leaves preserve the original markup; target-language leaves mark their language.
Display hooks and leaves import a pure copy context. Catalogue loading and wallet
locale negotiation stay in the application provider, so isolated maintenance and
other display-only consumers acquire no wallet/network environment dependency.

Both targets now cover all 66 extracted namespaces: 5,858 machine-draft entries
and 29 preserved identifiers out of 5,887 structural leaves. `complete` means
structural draft coverage, not human approval. Critical payment, consent, privacy
and legal copy continues to use canonical English under the existing translation
requirements. Glossary references remain references; no review metadata or shipped
locale authority is invented. The preview notice now describes page translation.

`generate-ui-previews.mjs` validates actual drafts against independently extracted
current English, then generates separate lazy VI/Chinese preview modules. Shared
messages retain their exact keys; equal English labels in unrelated areas cannot
select each other's translation. Static namespace copy uses exact full templates
only, with ambiguity falling back to English. Placeholders and protocol tokens
retain their existing validation. The existing UI-copy gate checks generated
outputs against all current source/draft inputs, and still inspects authored text
passed into `UiText`; wrapping a literal cannot bypass the copy baseline.

The application asks LocaleProvider to prepare both navigation and page chunks
before committing a preference. A failed page chunk returns the existing English
load-failure state and can be retried. A superseded slow language cannot replace
the newer choice. English loads neither target module. This adds no research,
signing, account-writing or financial request to a language switch.

## Surface boundaries

Web pages, forms, account views, source/archive/report UI, public guides and their
hosted desktop/browser views share these UI previews. Existing public URLs,
canonical English SEO metadata and original research-language provenance stay
unchanged. The browser extension benefits when it opens hosted pages; its own
packaged UI keeps its existing role and language support. Native Operator, CLI,
API, remote and stdio MCP, and chat bots retain their existing language contracts
and output-language adapters. This increment does not add an interface-language
field to those protocols or retranslate completed research.

## Verification and delivery

Focused checks cover actual VI/Chinese assets, exact-key collisions, canonical
critical fallback, preserved object identifiers/links, interpolation, chunk retry,
out-of-order completion, original content and unsent drafts without remounting.
The built-browser scenario checks both targets at 390 and 1366 pixels, page
navigation/reload, translated input labels/placeholders, English reset, overflow
and absence of Ask/sign requests. Screenshots require visual inspection.

Run `node scripts/generate-ui-previews.mjs` after source or draft edits, then the
existing copy guard and required CI. Final production build/browser acceptance
and reviewed required PR CI govern merging; the existing coordinator alone owns
the next combined deployment. No per-PR deployment or version bump is requested.
