# More useful sources and article choices

The owner requested broader source coverage and more than one useful article from
the same publisher. A larger retained library is useful when discovery can select
the articles that answer different parts of a question. It does not justify buying
every article or counting one publisher as several independent confirmations.

## Existing behavior and focused change

Public-reference archive discovery already retrieves by question and subclaim and
can propose different articles from one publisher. This change preserves that
behavior and removes the corresponding single-article bottleneck for registered
creator sources. Candidate selection uses free title/summary metadata, while exact
article identity, content version, cache, active offer and source-owned payment
terms remain attached to each proposed article.

The existing portfolio, attention and spending limits still decide which proposed
articles are actually read. Additional candidates do not authorize additional
spend. Exact targeted-article requests and latest-article recency resolution remain
single, exact selections. Legacy sources without retained articles keep their
existing source-level delivery path.

The accompanying compatibility fixes keep repeated-publisher behavior consistent:
publisher memory combines article contributions into one per-run observation;
known equal publisher identities cannot create extra confidence groups through
different domains; economic allocation capture uses the same per-article keys as
attribution while payment records retain their original source and recipients.
Legacy publisher-only decisions keep the strongest overall article.

The upkeep journal accepts the existing public batch size when recording actual
additions, while preserving the two-feed hourly allowance, consumed slots, cursor
and deadline. This changes counter compatibility, not fetch or spending authority.

The broader public catalog remains free reference evidence. Adding a feed grants
no creator verification, registry authority, recipient wallet or entitlement to
citation rewards. Feed excerpts, abstracts and complete feed bodies retain their
delivery-kind labels; they are not relabeled as recovered full website articles.

## Observed catalog expansion

The approved configuration grows from 50 to 59 feeds and the browsing directory
from 79 to 88 entries. On October 16, the repository transport/parser and a fresh
in-memory SQLite archive retained **663 articles from the nine added feeds**:

| Feed | Retained articles | Material returned by the feed |
| --- | ---: | --- |
| MDN Blog | 71 | Short summaries |
| web.dev | 10 | Short summaries |
| Chrome for Developers | 10 | Short summaries |
| WebKit | 10 | Feed article bodies |
| React Blog | 24 | Short summaries |
| V8 | 10 | Excerpts |
| W3C Blog | 25 | Feed article bodies, separate from normative specifications |
| MIT News: Artificial Intelligence | 50 | Institutional news article bodies |
| arXiv cs.AI announcements | 453 | Paper announcements and abstracts; not full papers or peer-review claims |

These are observations of this feed window, not guaranteed future counts or
production ingestion claims. Reimporting the same snapshots added zero articles
and zero versions. Every new reference remained absent from the payable source
table. Failed HTTP endpoints and feeds yielding no usable retained bodies were
excluded; W3C News was omitted because of substantial overlap with W3C Blog.
The existing explicit catalog importer activates these entries in the retained
library; no private database, wallet or production state was used in this trial.

## Acceptance and delivery

Focused regression tests cover complementary article choices, irrelevant extras,
duplicates, exact targeting, article identity and existing budget/attention gates.
The controlled paying-source study is regenerated from actual offline runs after
the implementation is frozen. Hosted aggregate and applicable domain checks plus
an independent review remain required before merge.

The shared agent path serves web/API and its hosted callers, including CLI, remote
and stdio MCP, desktop handoffs, extensions and bots. This increment does not add a
surface-specific control or change their request/response schemas. Direct source
and citation endpoints retain their exact-article and payment authority checks.

Source acceptance, catalog ingestion and production deployment are separate facts.
The existing release coordinator owns the combined deployment and serialized
production catalog import. No recurring refresh or backfill schedule is added.
