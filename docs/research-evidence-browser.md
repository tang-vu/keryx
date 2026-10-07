# Inspect evidence before paid research

The `/research` page includes a read-only creator-source browser before the price
and checkout. It uses the existing public source index and per-source preview API;
it neither purchases content nor changes a research request.

The source index loads 20 entries per page, up to 100 in this panel. Search matches
all entered terms against loaded source names, descriptions and tags only. It is
not global article search or an answerability assessment. The full `/sources`
registry also lists free public references, which are not included in this panel.

Selecting a source displays up to five public article titles, publisher dates when
provided, and creator-permitted summary text. Locked previews show titles only.
No paid article body, offer signature, wallet or content receipt is projected into
the panel. Article dates are publisher metadata, not freshness verification.
Preview text is rendered as text, never HTML. A changed selection cancels and
invalidates its earlier request; a mismatched preview identity is refused.

Unverified source flags are shown explicitly. Unflagged records can include legacy
defaults and do not independently establish ownership, on-chain activity, payout
authority, full-content availability or quality. Listing and preview failures stay
unknown, distinct from an empty list or empty preview. Failed reads can be retried.
Requests time out after 15 seconds and remain GET-only. Search stays in component
memory and is not placed in the URL or sent to the API.

The existing reading engine still selects evidence. Configured research can also
use [bounded web discovery and original-document reading](broad-web-research.md)
beyond registered creator sources and free public RSS references; external
marketplace endpoints remain discovery-only. This panel searches only its loaded
source metadata, not the web. Search previews and a corpus preview do not establish
document contents or guarantee a useful answer. The seller link goes to existing
registration/ownership verification, without a promised purchase or citation.

After reads, the current JSON-engine contract can deliver
[sentence-cited summaries](engineering/cited-summary-2026-10-06.md): each accepted
model-written sentence is paired with the one verbatim excerpt it was reviewed
against. Qualified excerpts and gaps remain when no sentence survives or the
engine does not implement that contract. Complete synthesis stays unverified;
source-marker admission and recorded support/coverage cannot establish factual
accuracy, complete comparisons or support for omitted assertions. The reviewed
decision brief remains disabled. This boundary neither proves source quality nor
makes a preview purchase-worthy. See [scholarly research](scholarly-research.md)
and [researcher exports](researcher-exports.md). Current production availability
and real-user acceptance require their own evidence.

Run `node --import tsx scripts/test-research-evidence-browser.mts` for the hermetic
Chromium acceptance. It is also part of `npm run test:browser-research-ux` after the
production build in CI. All HTTP is intercepted: no source ingestion, research,
payment, wallet signature or live database access occurs. Synthetic checks establish
UI behavior, not real corpus quality, source-owner adoption or customer demand.
See [product validation](./product-validation.md) for the independent pilot gates.
