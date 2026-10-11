# Shipped public metadata and preview delivery

This change advances [issue 277](https://github.com/tang-vu/keryx/issues/277).
English remains the only shipped interface locale. It changes public metadata
and image assets; it does not activate Vietnamese or Chinese interfaces.

## Current public URLs

The landing, archive and pagination, topic hubs, creator profiles, wanted pages,
source directory, legal pages and other existing indexed interface routes use
their existing canonical URL, with reciprocal `en` and `x-default` links to that
same published page. Client pages use small server layouts for metadata. No
cookie, preference negotiation, locale prefix or redirect is added. The existing
`/answers/page/1` redirect to `/answers` remains unchanged.

The sitemap uses the same English/x-default contract for interface pages. Report
URLs remain `/dispatch/<id>` with one canonical and no claimed language alternate.
The collection, website and creator-profile structured data declare their English
interface language; individual report answers are not relabelled English.
Atom declares English for its own wrapper and an English archive alternate.
Each entry resets inherited `xml:lang`, because the question and answer language
are not recorded. Atom alternates use actual language tags; `x-default` is used
in HTML and sitemap alternates, not as a claimed Atom content language.

## Local preview assets and checks

Dispatch, creator and wanted previews render their existing recorded text with
checked-in, licensed Noto Sans, Noto Sans SC and Noto Sans Math. The Chinese and
math faces load only when their glyph coverage is needed. The math face covers
the existing wanted-card `≤` caption. Font script selection is not evidence of
an answer's language. Provenance, exact hashes and licenses are in
[the asset record](../../app/fonts/og/README.md).

Existing Vitest tests exercise canonical/alternate admission, generated sitemap
and Atom output, collection language scope, complete Vietnamese diacritic samples,
Chinese text and all three actual preview route renderers. Fixtures contain only
synthetic public text, mock storage reads and refuse remote asset requests; they
make no database writes or model/search/payment calls. PNG inspection is local
rendering evidence, not a deployed link preview or remote indexing observation.

Legal copy fixtures remain frozen. Their metadata assertions retain the original
titles, descriptions and canonicals while checking the exact English alternate
addition; all policy markup, link and copy-guard assertions remain unchanged.
Sponsored registration supplies its alternates in a dedicated server layout,
preserving the page's original metadata export and strict copy fixture.

## Privacy, supported surfaces and remaining original criteria

The archive, sitemap, feed and wanted paths keep their existing public-data
readers; no private storage, private report adapter, new enumeration or visibility
authority is introduced. The existing `publicReportLanguage` contract still
refuses private, unlisted and unknown records. Public `QueryRun` currently has
neither persisted answer language nor an unlisted-visibility contract. Private
research uses separate protected storage; this change does not make it public.
Original private/unlisted acceptance still needs integrated tests once a reviewed
visibility adapter exists, rather than synthetic flags being treated as authority.

The full original issue remains open. Recorded answer-language production and
storage, the answer's DOM language attribute, language-aware archive browsing,
and actual report language in metadata/structured data/feed remain gates. Do not
guess historical language from the question, viewer preference or script. Public
Vietnamese/Chinese interface titles, descriptions, captions and structured data
also need human locale/glossary review and actual published variants. Prepared
locale URLs must not be advertised before that release. No new paid live trial
is required for the frozen synthetic glyph tests.

Web pages, sitemap, feed and social images are the applicable runtime surfaces.
Shared public links opened from desktop, CLI, remote/stdio MCP, extensions and
bots benefit after the coordinated web deployment. Their machine contracts,
answer bytes, financial displays, private claims and package/installer versions
are unchanged. Root owns versioning, combined-source acceptance, serialized
merge/deploy, public readback and original-criteria closure; worker evidence alone
does not establish production delivery. Existing held operations, default-off
pilots, financial/human translation approval and cleanup boundaries remain.
