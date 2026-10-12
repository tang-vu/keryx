# Source catalog expansion — October 12, 2026

The owner requested more usable sources and rechecked the previously authorized
unclaimed-source operating allocation. Add 19 publisher-linked feeds to the 31-feed
approved batch, for **50 approved feeds and 79 publisher directory links**. Existing
identities, collected evidence and source payment authority are preserved.

## Observed feed acceptance

On October 12, the development host fetched each publisher page, found its own
RSS/Atom link and fetched that exact endpoint with the unchanged public transport
and parser. The 19 selected feeds each admitted ten items: **190 temporary feed
items**, without production writes, model calls or payments. The bounds remain
500,000 bytes, 12 seconds, three redirects and ten items per feed. A parser's
delivery label does not certify a complete article or scientific accuracy.

| Publisher | Publisher-linked feed | Admitted items |
| --- | --- | ---: |
| Mozilla AI | https://blog.mozilla.ai/rss/ | 10 |
| Distill | https://distill.pub/rss.xml | 10 |
| Django | https://www.djangoproject.com/rss/weblog/ | 10 |
| Python Blog | https://blog.python.org/rss.xml | 10 |
| Kotlin | https://blog.jetbrains.com/kotlin/feed/ | 10 |
| Apache Software Foundation | https://news.apache.org/feed | 10 |
| Apache Arrow | https://arrow.apache.org/feed.xml | 10 |
| Microsoft Engineering | https://devblogs.microsoft.com/engineering-at-microsoft/feed/ | 10 |
| Mozilla Hacks | https://hacks.mozilla.org/feed/ | 10 |
| GitHub Engineering | https://github.blog/engineering/feed/ | 10 |
| Open Source Security Foundation | https://openssf.org/feed/ | 10 |
| Schneier on Security | https://www.schneier.com/feed/ | 10 |
| Krebs on Security | https://krebsonsecurity.com/feed/ | 10 |
| IPFS | https://blog.ipfs.tech/index.xml | 10 |
| Protocol Labs | https://pl.xyz/rss.xml | 10 |
| Stellar Blog | https://stellar.org/blog/rss.xml | 10 |
| Our World in Data | https://ourworldindata.org/atom-data-insights.xml | 10 |
| PLOS | https://theplosblog.plos.org/feed/ | 10 |
| Martin Fowler | https://martinfowler.com/feed.atom | 10 |

Protocol Labs' existing publisher site links to its `pl.xyz` feed; the new entry
uses the directly checked `pl.xyz` homepage and feed origin so future website-file
ownership proof does not depend on the former cross-origin publisher URL. Our World in
Data's general Atom feed admitted no usable items; its separately publisher-linked
Data Insights feed passed. Distill includes foundational older work; collection
dates do not make publication dates recent. Python, Distill, IPFS, Protocol Labs
and Stellar feed bodies can be short abstracts rather than original full articles.

Withheld observations: BAIR and Hugging Face parsed but admitted no usable items;
a16z crypto exceeded the unchanged byte cap; NASA Science's response failed XML
parsing; ACM Queue, NIH and OpenAI page requests returned 403. Other inspected
pages supplied no usable publisher-linked feed in this pass. No guessed feed,
third-party mirror, parser relaxation or oversized-response truncation is added.

## Reading, fees and live counts

Public bodies remain free to read and confer no publisher ownership or creator
payout authority. A qualified unclaimed public citation can contribute its original
share of the existing citation pool to the separately settled **Keryx operating
fee**, when the protected recipient policy and hosted funding authority are active.
This pays for Keryx's research service. It does not turn a public feed into a paid
publisher listing. Claim proof, registry linking, distribution consent and explicit
earning-policy activation remain required for future creator payments.

Settled operating fees count in research settlement volume and are reported
separately. The creator leaderboard includes settled source reads and citation
rewards, so its two first-party entries do not describe the research library's
size. See [the fee and claim contract](../sponsored-research-trial.md).

A read-only October 12 loopback health/metrics observation reported deployed
`c49f4b3e`, Arc mainnet, real settlement, 82 queries, two leaderboard entries and
zero settled operating fees. The active web and A2A roles had no operating-fee
policy pair. This establishes that the implementation was deployed but its
recipient policy had not been activated; it does not prove a funded fee canary.
The public Sources page reported 30 retained feeds and 282 feed items. These are
dated observations, separate from this candidate's approved catalog count.

## Import, upkeep and supported surfaces

After accepted deployment and a verified database backup, run the existing explicit
`npm run import:public-references -- --apply` on the reviewed SQLite production
profile. Import failures preserve prior snapshots; operator deactivation stays
preserved. Read back each retained feed and item count before reporting live import.
Checked-in feed entries contain no body or collection timestamp. Removing entries
from the static catalog does not erase retained evidence or financial originals.

Hosted web, API, remote MCP and bots discover the imported database snapshots.
CLI/stdio MCP, desktop and extensions keep their hosted research handoff and
existing custody roles. Directory links alone remain unread metadata. No packaged
client contract, registry, schema, spend cap or schedule changes. Separate local
research databases still require their own explicit import. The unchanged hourly
upkeep visits at most two combined eligible feeds; 50 public feeds alone need at
least 25 successful consumed slots for a full pass. No schedule increase is made.

Reuse the catalog schema/uniqueness/import-failure/deactivation tests, shared source
discovery and operating-fee regressions, TypeScript, lint, production build and
required hosted CI. Policy activation and bounded real settlement retain their
separate operational gates and prior finite authorization.
