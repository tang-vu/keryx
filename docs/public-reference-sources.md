# Free public reference sources

Keryx can research publicly published RSS bodies alongside verified creator sources.
Public references are free evidence: they carry no publisher wallet, feed ownership
verification, registry registration, access toll, or citation reward. Public availability
does not establish an agreement with the publisher or authorize Keryx to monetize their
writing. Existing verified creator sources keep their payment and registry authority.

The current approved catalog contains **59 public feeds and 88 publisher directory
links**, including nine developer and AI/academic feeds audited on October 16.
These are configuration counts, not live imported feeds or articles. See
[the current expansion and delivery boundaries](engineering/article-source-expansion-20261016.md).
The October 12 batch contained 50 feeds and 79 directory links; its
[dated audit and live-count observations](engineering/source-catalog-2026-10-12.md)
remain historical. Qualified unclaimed public
citations may contribute to a separately authorized Keryx operating fee under the
[existing sponsored fee policy](sponsored-research-trial.md); public feed reading
remains free and this is separate from publisher ownership and creator rewards.

## Current catalog additions

The October 16 read-only audit used the repository's bounded public HTTP transport,
`fetchPublicReferenceFeed` and `referenceSnapshot`. Each selected endpoint returned
HTTP 200 and multiple canonical HTTPS article links with nonempty publisher bodies.
The **663 article snapshots below were parsed in memory**, deduplicated within each feed, without database writes,
article-page fetches, production import, model calls or payments. They describe one
feed observation, not complete publisher archives or guaranteed future availability.
Checked-in entries retain `items: []`; article counts are audit evidence only.
A subsequent isolated in-memory SQLite trial retained all 663 snapshots and
confirmed that importing the same snapshots again added no articles or versions;
it did not mutate production. See the linked engineering note for that boundary.

| Feed | Audited endpoint | Unique articles in memory | Parser delivery / material scope |
| --- | --- | ---: | --- |
| MDN Blog | https://developer.mozilla.org/en-US/blog/rss.xml | 71 | `abstract`: short article summaries |
| web.dev | https://web.dev/static/blog/feed.xml | 10 | `abstract`: short article summaries |
| Chrome for Developers | https://developer.chrome.com/static/blog/feed.xml | 10 | `abstract`: short article summaries |
| WebKit | https://webkit.org/feed/ | 10 | `full_text`: substantial feed bodies |
| React Blog | https://react.dev/rss.xml | 24 | `abstract`: short article summaries |
| V8 | https://v8.dev/blog.atom | 10 | `excerpt`: engineering article bodies |
| W3C Blog | https://www.w3.org/blog/feed/ | 25 | `full_text`: blog bodies, separate from normative specifications |
| MIT News: Artificial Intelligence | https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml | 50 | `full_text`: institutional research news, not research papers |
| arXiv cs.AI paper announcements | https://rss.arxiv.org/rss/cs.AI | 453 | `excerpt`: announcement metadata and abstracts only, not full papers |

Parser delivery labels are length/format classifications, not proof of article
completeness or scientific validity. The arXiv paper feed has its own
`public:arxiv-cs-ai` identity; the existing `public:arxiv` remains the platform blog.
Announcement dates are not independently verified original paper-publication dates,
and preprints do not establish peer review. The separate scholarly original-paper
reader keeps its existing extraction and evidence gates. MDN and V8 include older
work; collection time does not make it recent.

The suggested Chrome `/feeds/blog.xml` returned 404; Chrome's official feeds page
links the working `/static/blog/feed.xml` endpoint. web.dev's `/feed.xml` redirected
to its configured static endpoint. MIT's topic page links the configured topic
RSS URL. Hugging Face (880 parsed entries), BAIR (10) and JMLR (205) produced zero
usable linked bodies under the current parser/snapshot and remain unapproved.
ACM Queue's suggested feed returned 410 and its homepage 403. W3C News also passed
with 25 usable entries but was not added alongside W3C Blog in this focused batch.
No failed feed, mirror, synthetic body or parser relaxation is included.

The historical October 6 approved batch contains 31 public feeds, including 26 additions across
AI/agents, data/infrastructure, payments and creator research. A separate 60-entry
publisher directory contains unread links rather than retained article evidence.
See [the exact feed audit and limits](engineering/source-catalog-2026-10-06.md).
The original batch contains Cloudflare Workers, Chip Huyen, Lilian Weng,
Vicki Boykis and Super Simple Songs. Official Circle RSS candidates returned 404 during the September 30
endpoint audit and are deferred. No feed wrapper or publisher authorization is invented.
Publication dates come from the publisher; older foundational articles are not labeled
recent because they were just collected.

### YouTube publisher metadata

The October 1 audit verified [Super Simple's official channel directory](https://supersimple.com/channels/)
links to its YouTube channel, whose canonical channel ID and RSS alternate identify
`UCLsooMJoIpl_7ux2jvdPB-Q`. The feed returned HTTP 200 with 15 entries.
[Numberblocks' publisher links](https://www.blocksuniverse.tv/blocks-links) also identify
its official channel, but its feed returned HTTP 500 and onboarding is deferred.
An audit response is availability evidence for that observation, not a freshness guarantee.

Only the exact approved Super Simple feed URL uses the YouTube adapter. The unchanged
bounded public fetch transport obtains XML; the adapter validates namespaces, feed and
entry channel identity, video identity and canonical HTTPS watch links. It admits at
most ten distinct valid entries, caps descriptions at 10,000 characters and labels
every body `metadata_only`, including a title-only entry without a description.
Malformed XML or namespace rebinding fails the feed refresh, preserving the prior
snapshot. Dates are retained only when parseable; absent dates are omitted, and malformed
publisher dates can cause the underlying parser to reject the refresh. No media,
transcript, article or description links are fetched. YouTube RSS
can contain community statistics; this release discards them and does not validate or
use them as research evidence.

The material supports attributed observations of publisher titles, descriptions and
dates, plus clearly tentative creative ideas. It does not establish actual video content,
age suitability, teaching quality, audience demand, competition, trends, virality,
CTR, retention or revenue. Query-relevant metadata choices within the run's existing
attention bounds are not a representative channel or market sample. Quotes from a description establish
what the publisher wrote, not what the video demonstrates. Public availability does
not grant ownership or permission to republish gated material.

## Storage and reads

SQLite `public_references` stores a separate validated current feed snapshot, with
at most 1,000 usable entries in one public RSS/Atom processing batch. This is not a
lifetime article limit. The separate [cumulative article library](source-library-archive.md)
retains articles and immutable versions across refreshes when its storage migration
is installed; disappearance from the current feed does not delete retained history.
The approved YouTube metadata adapter keeps its separate ten-entry batch bound.
Neither catalog has payout fields. Refresh deduplicates canonical HTTPS article
links and preserves feed-provided delivery labels.
The importer and upkeep use the existing DNS-pinned public-address fetch transport:
public RSS/Atom feeds have a 5,000,000-byte, 12-second and three-redirect bound.
Feeds exceeding the 1,000-entry processing batch are refused rather than silently
truncated; historical recovery uses the explicit resumable backfill helper.
These feed paths fetch the feed only, never
follow article links, circumvent paywalls, purchase content, encrypt it as owned paid
content, pin it remotely, or invoke an LLM.

Discovery can select distinct query-relevant articles from a publisher's current
snapshot and retained library within the existing run limits. It captures each
selected body, exact article link, publisher date and version before reasoning.
Several articles by one publisher do not establish independent corroboration. Model proposals cannot
change its free price or enable payment. A public-only portfolio never invokes wallet
funding or a deposit; an owned source admitted during expansion funds only at that boundary. Public reads share the same claim-target and
attention portfolio as paid reads. The existing model context selector scans at most
200,000 characters and supplies at most 2,000 selected passage characters per source;
the candidate preview is limited to 600 characters. A refresh during a run cannot replace
its captured evidence. A feed excerpt remains an excerpt, not an inferred full article.

Exact quotes, declared answer markers and minimum support govern answer eligibility
(`qualifiesForAnswer`). Public evidence always has `qualifiesForReward=false`.
Attribution allocates the original contribution weights in integer micro-USDC, then
withholds public shares: owned weights 40% and 10% with a public 50% share pay those
owned shares, never an inflated 80% and 20%. Public citations and portable receipts
identify free provenance; no fake payment row or settled traction is recorded.

Reserved `public:` IDs cannot be persisted as paid sources or resolve payment terms.
The source, article and citation toll endpoints reject them before database or settlement
work. Public evidence is not put in paid decrypted caches. Supabase public catalog reads
return no entries and writes fail closed; deploying public catalogs on that adapter
requires a separate schema and acceptance review.

## Import and ongoing upkeep

After deploying the reviewed commit to the SQLite host:

```powershell
npm run import:public-references
npm run import:public-references -- --apply
```

The first command lists the fixed approved batch without network or writes. `--apply`
fetches each approved feed sequentially and idempotently upserts its snapshot.
It outputs publisher names, success state and item counts only; any failure sets a
nonzero exit status while preserving other successful entries. Existing deactivation
is preserved. This explicit initial onboarding never resets or bypasses the recurring
hourly journal. `/sources` renders current database state on each request so the imported
catalog is immediately inspectable; verify all approved entries before reporting live success.

When invoked, existing upkeep uses one atomic allowance and round-robin cursor across BOTH catalogs:
at most two feeds per hour, with the existing 45-second job deadline
and eligibility/URL recheck before writes. The Worker is unchanged. With thirteen
verified feeds and five public references, the historical stable combined pool required nine hourly
batches to visit each source. The allowance remains at most 48 feed fetches per day;
the old twenty-candidate hourly figure is not a public article-retention limit.
Creator feed batches retain ten entries; public RSS/Atom batches use the bounds above.
The hourly journal accepts up to two existing 1,000-item public batches and validates
completion before persisting it. This does not enlarge its two-feed allowance.
A failed or interrupted slot stays consumed. With all 59 public
feeds eligible and no creator feeds, a pass requires at least 30 hourly slots. More
creator feeds lengthen that pass. This does not establish active scheduling or successful
collection; the catalog expansion raises no hourly allowance and installs no refresh schedule.

## Acceptance and rollback

Focused tests cover free-only and mixed runs, malicious BUY proposals, shared attention,
original weighted shares, weak/noncited public evidence, direct toll refusal, immutable
versions and bounded context, separate SQLite persistence, fixed-batch idempotency,
combined upkeep fairness and late-fetch write refusal. TypeScript, lint, the production
build, full tests and required CI are release gates. Local checks do not establish live
publisher cooperation, independent usage, settled revenue or research quality.

To remove a public reference, preserve its snapshot but set `active=false` using the
validated SQLite catalog interface. This removes it from discovery and scheduled upkeep;
past run snapshots and receipts remain honest historical evidence. Reverting this release
leaves the isolated table dormant and does not change creator payment records.
