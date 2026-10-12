# Shipped public metadata and preview delivery

This change advances [issue 277](https://github.com/tang-vu/keryx/issues/277).
English remains the only shipped interface locale. It changes public metadata
and image assets; it does not activate Vietnamese or Chinese interfaces.

The current report adapter explicitly marks its answer language UNKNOWN (`und`):
QueryRun has no authoritative recorded output-language field. The shared answer
renderer resets inherited English on answer text with `lang="und"`; citation UI
labels remain English. This is a metadata attribute change, not translation,
language detection, answer rewriting or a new language-activation flag. Public
report head metadata retains one permalink and emits `DC.language=und` without
language alternates. Twitter uses the same current report title/preview copy as
Open Graph rather than inheriting the landing preview. The existing English
wrapper is independent of any requested answer language.

Private, unlisted, unknown and unavailable report heads replace root alternates,
description and social metadata with the same closed nonindexed/no-referrer
contract. File-based generic images keep their existing response behavior and
never acquire private question text. Public structured-data visibility checks
and omission of unrecorded answer language remain unchanged.

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

After privacy admission was added, the preview test's dispatch mock needed an
explicit public visibility. The corrected fixture now verifies that each real
route passes its supplied Vietnamese/Chinese text to the real local font
selector, in addition to producing PNGs. Unknown/private/unlisted dispatch input
must produce identical generic PNGs for the same URL and never select hidden
question text. Prior dimension-only tests with missing visibility do not prove
that a current dispatch preview rendered its non-Latin question.

Legal copy fixtures remain frozen. Their metadata assertions retain the original
titles, descriptions and canonicals while checking the exact English alternate
addition; all policy markup, link and copy-guard assertions remain unchanged.
Sponsored registration supplies its alternates in a dedicated server layout,
preserving the page's original metadata export and strict copy fixture.

## October 12 consumer completion checkpoint

The public archive now supplies answer-language browsing at
`/answers?language=<recorded-tag>` and preserves the selection across existing
pagination and Atom subscription URLs. These are English interface filters,
not activated translated pages. Filtered index views remain nonindexed and
keep their existing unfiltered canonical/English alternates. Ambiguous repeated
query preferences select the unfiltered archive consistently. Unknown answers
are browsable as undetermined; question text and script never select a language.

Slim archive entries have a recorded answer-language slot. Answer snippets and
Atom answer content carry that tag; original questions remain undetermined.
Known answer works in collection structured data declare their language without
changing the collection's English interface language. A language-aware dedup
and the write-time provenance consumer require issue 276's checkpointed shared
reader; that integration is still pending at this checkpoint. No producer or
duplicate provenance parser is introduced by the public archive worker.

With privacy admitted, archive selection uses the existing public-only privacy
port in bounded 32-row pages before deduplication. Selected IDs are freshly
projected through that same port in 32-row batches before publication, so a
revocation or tombstone created during scanning cannot reuse the old text.
Scan/publication failures, missing ports and unexpected/duplicate publication
identities return an empty result, never a partial or historical fallback.
After this process has observed admitted privacy, a database outage cannot
revive its retained legacy cache. Immutable historical archives remain excluded
from active privacy enumeration. This does not activate privacy or authorize
ordinary Supabase DDL; its reviewed storage/API rollout remains a separate gate.

Synthetic tests cover actual page/feed/metadata/pagination and rendered snippet
language contracts. A real in-memory SQLite privacy fixture checks rich hidden
duplicates and an erasure between selection and publication. All use zero model,
search and payment calls. Their source evidence is not production readback.

## Privacy, supported surfaces and remaining original criteria

The archive, sitemap and feed share the same public corpus. The existing
`publicReportLanguage` contract refuses private, unlisted and unknown records.
Public enumeration uses the existing admitted visibility port where enabled;
source-only privacy staging does not establish production activation. Separate
protected private-research storage is unchanged. Existing integrated SQLite
public-surface tests and the new tombstone fixture verify admitted local behavior.

The full original issue remains open. Recorded answer-language production and
consumer integration, the answer's correct known DOM language attribute,
language-aware dedup and actual report language in head/structured data remain
gates. The archive filter/feed/snippet contracts are implemented independently. Do not
guess historical language from the question, viewer preference or script. Public
Vietnamese/Chinese interface titles, descriptions, captions and structured data
also need human locale/glossary review and actual published variants. Prepared
locale URLs must not be advertised before that release. No new paid live trial
is required for the frozen synthetic glyph tests.

The necessary upstream input is issue 276's reviewed write-time record of actual
generated-prose language and its shared reader, bound to final answer bytes,
separate from requested language or provider/prompt settings. Until its exact
checkpoint is integrated, raw historical runs project undetermined language.
No historical backfill, classifier or new locale URL is supplied. Original
quotes/questions remain outside that provenance scope. #273's existing financial-copy gate is
retained; this phase adds no translated financial text or new human/model trial.

Web pages, sitemap, feed and social images are the applicable runtime surfaces.
Shared public links opened from desktop, CLI, remote/stdio MCP, extensions and
bots benefit after the coordinated web deployment. Their machine contracts,
answer bytes, financial displays, private claims and package/installer versions
are unchanged. Root owns versioning, combined-source acceptance, serialized
merge/deploy, public readback and original-criteria closure; worker evidence alone
does not establish production delivery. Existing held operations, default-off
pilots, financial/human translation approval and cleanup boundaries remain.
