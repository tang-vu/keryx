# Source catalog audit — October 6, 2026

The owner requested a substantial source expansion and better discovery across AI/agents,
data/infrastructure, payments and creator/research. This release selects **60 browsable
publisher/documentation links** and expands the explicit approved public-feed batch from
five to **31 feeds**, adding **26**. The original five identities and metadata are preserved.
Directory links remain unread suggestions, separate from retained feed items, past citations,
creator listings, publisher-control verification and payment eligibility.

## Method and limits

Official publisher/project pages were checked directly for identity, topic and publisher-linked
RSS/Atom endpoints. Independent authors identify their own writing; listing them does not
certify their claims or employer affiliation. Candidate endpoints were confirmed against
primary-host feed responses before admission; guessed wrapper feeds and third-party mirrors
were not imported. OpenAI News was independently read through the web tool because the
repository transport returned HTTP 403 for its HTML page; its directly linked official news
feed was then refused by the repository's existing byte limit. The Super Simple channel
retains the publisher-link verification documented in [public reference sources](../public-reference-sources.md);
its exact existing YouTube feed was also rechecked in this audit.

Each accepted feed was fetched using the unchanged 'fetchPublicReferenceFeed' and passed
through 'referenceSnapshot': DNS-pinned public-address transport, 12-second timeout,
500,000-byte maximum, three redirects maximum, ten-item maximum, credential-free HTTPS
item links, nonempty content and exact-link deduplication. The audit read feeds only; it did
not follow articles, load media/transcripts, call an LLM, spend funds, or access any production
database. Page identity checks used the same safe transport with a two-megabyte HTML bound;
this does not relax the stricter feed import bound. Checks ran on the development host on
October 6, 2026 with Node.js 24.12.0. Availability can differ on the production host.

Accepted observations total **292 admissible items across 31 feeds**, including **242**
from the 26 added feeds. These were temporary in-memory snapshots, not live retained counts.
All checked-in approved entries still have empty 'items' and no 'refreshedAt'. Only a separate
explicit importer run creates actual collection timestamps and retained rows. Feed-provided
publication dates do not become current because a feed was collected today.

Delivery labels below are the unchanged parser's classifications. In particular, its
'full_text' heuristic does not independently establish article completeness, accuracy,
licensing, cooperation or permission to republish. Abstract feeds can be very short; Google
Research and DeepMind illustrate that a usable link/body is not an assurance of useful
research coverage. The 60 directory entries have no collected bodies or dates and never
enter evidence discovery automatically.

## Accepted bounded feed observations

Characters are the sum of admitted item bodies after the existing parser and snapshot caps;
these are neither downloaded byte counts nor measured semantic coverage.

| Publisher | Exact endpoint | Admitted items | Parser delivery labels | Body characters |
| --- | --- | ---: | --- | ---: |
| Super Simple Songs - Kids Songs | [Feed](https://www.youtube.com/feeds/videos.xml?channel_id=UCLsooMJoIpl_7ux2jvdPB-Q) | 10 | 10 metadata_only | 24,787 |
| Cloudflare Workers | [Feed](https://blog.cloudflare.com/tag/workers/rss/) | 10 | 10 full_text | 118,009 |
| Chip Huyen | [Feed](https://huyenchip.com/feed.xml) | 10 | 10 excerpt | 222,409 |
| Lilian Weng | [Feed](https://lilianweng.github.io/index.xml) | 10 | 9 excerpt, 1 abstract | 8,434 |
| Vicki Boykis | [Feed](https://vickiboykis.com/index.xml) | 10 | 10 excerpt | 89,343 |
| OpenAI Developers | [Feed](https://developers.openai.com/rss.xml) | 10 | 10 abstract | 1,191 |
| Google DeepMind | [Feed](https://deepmind.google/blog/rss.xml) | 3 | 3 abstract | 280 |
| Google Research | [Feed](https://research.google/blog/rss/) | 10 | 10 abstract | 174 |
| Ollama | [Feed](https://ollama.com/blog/rss.xml) | 10 | 10 abstract | 1,920 |
| vLLM | [Feed](https://vllm.ai/blog/rss.xml) | 10 | 10 abstract | 1,509 |
| Eugene Yan | [Feed](https://eugeneyan.com/rss/) | 10 | 10 abstract | 896 |
| Sebastian Raschka | [Feed](https://sebastianraschka.com/rss_feed.xml) | 10 | 10 abstract | 1,178 |
| Microsoft Research | [Feed](https://www.microsoft.com/en-us/research/feed/) | 10 | 10 full_text | 111,375 |
| PyTorch | [Feed](https://pytorch.org/feed/) | 10 | 10 full_text | 133,010 |
| PostgreSQL | [Feed](https://www.postgresql.org/news.rss) | 10 | 9 excerpt, 1 abstract | 31,244 |
| Docker | [Feed](https://www.docker.com/blog/feed) | 10 | 10 full_text | 82,802 |
| DuckDB | [Feed](https://duckdb.org/feed.xml) | 10 | 10 excerpt | 81,510 |
| Tailscale | [Feed](https://tailscale.com/blog/index.xml) | 10 | 10 abstract | 690 |
| Spotify Engineering | [Feed](https://engineering.atspotify.com/feed) | 5 | 5 abstract | 979 |
| Netlify | [Feed](https://www.netlify.com/feed.xml) | 10 | 10 abstract | 1,482 |
| Supabase | [Feed](https://supabase.com/rss.xml) | 10 | 10 abstract | 1,258 |
| Rust Blog | [Feed](https://blog.rust-lang.org/feed.xml) | 10 | 10 excerpt | 46,339 |
| The Go Blog | [Feed](https://go.dev/blog/feed.atom) | 10 | 10 excerpt | 142,222 |
| Stripe Blog | [Feed](https://stripe.com/blog/feed.rss) | 10 | 10 abstract | 2,277 |
| x402 | [Feed](https://x402.org/feed/) | 5 | 4 full_text, 1 excerpt | 27,388 |
| Bank for International Settlements | [Feed](https://www.bis.org/doclist/bis_fsi_publs.rss) | 9 | 9 abstract | 3,395 |
| Creative Commons | [Feed](https://creativecommons.org/feed/) | 10 | 10 full_text | 88,487 |
| arXiv | [Feed](https://blog.arxiv.org/feed/) | 10 | 9 full_text, 1 excerpt | 35,532 |
| Directory of Open Access Journals | [Feed](https://blog.doaj.org/feed/) | 10 | 10 full_text | 51,579 |
| OpenAlex | [Feed](https://blog.openalex.org/feed/) | 10 | 10 full_text | 68,117 |
| Wikimedia Diff | [Feed](https://diff.wikimedia.org/feed/) | 10 | 10 full_text | 55,244 |

## Withheld endpoint observations

These observations are from the same audit date and keep the existing transport and content
gates intact. A parseable feed with zero admissible items is not imported. Large feeds are
not truncated, proxied or replaced by invented subset URLs. Endpoint aliases for vLLM were
also observed to yield the same content; only the canonical publisher-linked
'https://vllm.ai/blog/rss.xml' is admitted, preventing duplicate catalog entries.

| Candidate endpoint | Observed reason for withholding |
| --- | --- |
| [Endpoint](https://huggingface.co/blog/feed.xml) | Parsed successfully; zero admissible nonempty HTTPS-linked items |
| [Endpoint](https://nodejs.org/en/feed/blog.xml) | Parsed successfully; zero admissible nonempty HTTPS-linked items |
| [Endpoint](https://simonwillison.net/atom/everything/) | Parsed successfully; zero admissible nonempty HTTPS-linked items |
| [Endpoint](https://github.blog/feed/) | that file is too large to read |
| [Endpoint](https://clickhouse.com/rss.xml) | that file is too large to read |
| [Endpoint](https://vercel.com/atom) | that file is too large to read |
| [Endpoint](https://blog.ethereum.org/en/feed.xml) | that file is too large to read |
| [Endpoint](https://planetscale.com/blog/feed.atom) | that file is too large to read |
| [Endpoint](https://www.digitalocean.com/rss/blog.atom) | that file is too large to read |
| [Endpoint](https://info.orcid.org/feed/) | that file is too large to read |
| [Endpoint](https://kubernetes.io/feed.xml) | that file is too large to read |
| [Endpoint](https://www.eff.org/rss/updates.xml) | that file is too large to read |
| [Endpoint](https://hamel.dev/index.xml) | that file is too large to read |
| [Endpoint](https://aws.amazon.com/blogs/machine-learning/feed/) | that file is too large to read |
| [Endpoint](https://openai.com/news/rss.xml) | that file is too large to read |
| [Endpoint](https://www.crossref.org/blog/index.xml) | that file is too large to read |
| [Endpoint](https://deno.com/feed) | Parsed successfully; zero admissible nonempty HTTPS-linked items |

No feed was newly admitted for Anthropic, LlamaIndex, Pydantic AI, Gemini API, LangChain,
SQLite, Python docs, Redis, Grafana, Prometheus, Circle, Arc, Stripe docs, Ethereum docs,
Stellar docs, DataCite or Zenodo. The checked pages support browse links; this audit did not
establish a usable feed for them. This is not a claim that none exists. Historical Circle
feed 404 observations remain dated history in the existing documentation; they were not
promoted to current availability evidence. The initial ORCID '/blog/' candidate returned
404 and was replaced with its successfully checked official homepage. Coinbase developer
and ACM Queue HTML candidates returned 403 and were not selected for this directory.

## Selected directory links

The entries below are descriptive metadata and external navigation, including documentation
sites that need no feed. Duplicate exact URLs and directory IDs are forbidden; multiple
sections of one publisher do not imply multiple independent publishers. Topic labels aid
browsing and do not certify publisher control, accuracy or payment terms.

| Publisher / project link | Topic | Feed role |
| --- | --- | --- |
| [OpenAI News](https://openai.com/news/) | AI & agents | Directory link only |
| [OpenAI Developers](https://developers.openai.com/) | AI & agents | Explicit approved feed; empty until imported |
| [Anthropic](https://www.anthropic.com/news) | AI & agents | Directory link only |
| [Google DeepMind](https://deepmind.google/blog/) | AI & agents | Explicit approved feed; empty until imported |
| [Google Research](https://research.google/blog/) | AI & agents | Explicit approved feed; empty until imported |
| [Hugging Face](https://huggingface.co/blog) | AI & agents | Directory link only |
| [LangChain](https://blog.langchain.com/) | AI & agents | Directory link only |
| [LlamaIndex](https://www.llamaindex.ai/blog) | AI & agents | Directory link only |
| [Pydantic AI](https://ai.pydantic.dev/) | AI & agents | Directory link only |
| [Ollama](https://ollama.com/blog) | AI & agents | Explicit approved feed; empty until imported |
| [vLLM](https://vllm.ai/blog) | AI & agents | Explicit approved feed; empty until imported |
| [Gemini API](https://ai.google.dev/gemini-api/docs) | AI & agents | Directory link only |
| [Simon Willison](https://simonwillison.net/) | AI & agents | Directory link only |
| [Eugene Yan](https://eugeneyan.com/) | AI & agents | Explicit approved feed; empty until imported |
| [Hamel Husain](https://hamel.dev/) | AI & agents | Directory link only |
| [Sebastian Raschka](https://sebastianraschka.com/blog/) | AI & agents | Explicit approved feed; empty until imported |
| [Chip Huyen](https://huyenchip.com/) | AI & agents | Explicit approved feed; empty until imported |
| [Lilian Weng](https://lilianweng.github.io/) | AI & agents | Explicit approved feed; empty until imported |
| [Vicki Boykis](https://vickiboykis.com/) | AI & agents | Explicit approved feed; empty until imported |
| [Microsoft Research](https://www.microsoft.com/en-us/research/blog/) | AI & agents | Explicit approved feed; empty until imported |
| [PyTorch](https://pytorch.org/blog/) | AI & agents | Explicit approved feed; empty until imported |
| [PostgreSQL](https://www.postgresql.org/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [SQLite](https://www.sqlite.org/docs.html) | Data & infrastructure | Directory link only |
| [Node.js](https://nodejs.org/en/blog) | Data & infrastructure | Directory link only |
| [Python Documentation](https://docs.python.org/3/) | Data & infrastructure | Directory link only |
| [Kubernetes](https://kubernetes.io/blog/) | Data & infrastructure | Directory link only |
| [Docker](https://www.docker.com/blog/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [Redis](https://redis.io/blog/) | Data & infrastructure | Directory link only |
| [DuckDB](https://duckdb.org/news/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [ClickHouse](https://clickhouse.com/blog) | Data & infrastructure | Directory link only |
| [Grafana Labs](https://grafana.com/blog/) | Data & infrastructure | Directory link only |
| [Prometheus](https://prometheus.io/blog/) | Data & infrastructure | Directory link only |
| [Tailscale](https://tailscale.com/blog) | Data & infrastructure | Explicit approved feed; empty until imported |
| [GitHub Blog](https://github.blog/) | Data & infrastructure | Directory link only |
| [Spotify Engineering](https://engineering.atspotify.com/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [Netlify](https://www.netlify.com/blog/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [Vercel](https://vercel.com/blog) | Data & infrastructure | Directory link only |
| [Supabase](https://supabase.com/blog) | Data & infrastructure | Explicit approved feed; empty until imported |
| [Cloudflare Workers](https://blog.cloudflare.com/tag/workers/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [Rust Blog](https://blog.rust-lang.org/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [The Go Blog](https://go.dev/blog/) | Data & infrastructure | Explicit approved feed; empty until imported |
| [Circle Blog](https://www.circle.com/blog) | Payments | Directory link only |
| [Circle Developer Docs](https://developers.circle.com/) | Payments | Directory link only |
| [Arc Docs](https://docs.arc.network/) | Payments | Directory link only |
| [Stripe Blog](https://stripe.com/blog) | Payments | Explicit approved feed; empty until imported |
| [Stripe Documentation](https://docs.stripe.com/) | Payments | Directory link only |
| [Ethereum Developer Docs](https://ethereum.org/en/developers/docs/) | Payments | Directory link only |
| [Stellar Developer Docs](https://developers.stellar.org/) | Payments | Directory link only |
| [x402](https://www.x402.org/) | Payments | Explicit approved feed; empty until imported |
| [Bank for International Settlements](https://www.bis.org/) | Payments | Explicit approved feed; empty until imported |
| [Creative Commons](https://creativecommons.org/blog/) | Creators & research | Explicit approved feed; empty until imported |
| [DataCite](https://blog.datacite.org/) | Creators & research | Directory link only |
| [Crossref](https://www.crossref.org/blog/) | Creators & research | Directory link only |
| [ORCID](https://info.orcid.org/) | Creators & research | Directory link only |
| [Directory of Open Access Journals](https://blog.doaj.org/) | Creators & research | Explicit approved feed; empty until imported |
| [OpenAlex](https://blog.openalex.org/) | Creators & research | Explicit approved feed; empty until imported |
| [arXiv](https://blog.arxiv.org/) | Creators & research | Explicit approved feed; empty until imported |
| [Zenodo](https://blog.zenodo.org/) | Creators & research | Directory link only |
| [Wikimedia Diff](https://diff.wikimedia.org/) | Creators & research | Explicit approved feed; empty until imported |
| [Super Simple Songs](https://www.youtube.com/channel/UCLsooMJoIpl_7ux2jvdPB-Q) | Creators & research | Explicit approved feed; empty until imported |

## Acceptance, operations and rollback

Catalog tests check unique IDs and normalized URLs, credential-free HTTPS, the four supported
topics, metadata-only directory shape, preserved existing source identities, explicit approved
feed associations, empty checked-in evidence, and exclusion of the observed unusable candidates.
Existing import tests continue to check per-feed failure isolation and operator deactivation.
The full release additionally requires TypeScript, lint, build, repository tests and CI.

This catalog does not change the database schema, payout policy, source ownership, payment
or registry authority, scheduler allowance, upkeep deadline or article-fetch behavior. The
existing explicit import command remains the only onboarding operation:

~~~powershell
npm run import:public-references
npm run import:public-references -- --apply
~~~

The first command is a no-network/no-write preview. Production application is a separate
operator step after deployment with environment/profile review and database backup; this
audit performs neither. A partial import succeeds per feed and returns nonzero for failures,
retaining previous snapshots when a feed fails. Read back exact retained item counts and
collection dates before claiming that approved feeds are live.

The unchanged hourly upkeep visits at most two combined eligible feeds per consumed slot;
adding public feeds therefore lengthens a round-robin pass. With all 31 public feeds eligible,
that public subset alone needs at least 16 such slots, before creator feeds are included.
This is an arithmetic bound, not evidence that a scheduler is active or that every visit
succeeds. No schedule or budget increase is authorized by this catalog expansion.

Web Sources can browse the directory and current retained catalog. Existing web/desktop
research, CLI, API, remote and stdio MCP, extensions and bots use the same approved retained
reference discovery after actual import; they do not acquire evidence from directory links.
Package/installer identities and production import evidence belong to the coordinated release
record, not this read-only audit. To withdraw a reference, set its retained 'active=false'
through the validated catalog interface; the importer preserves that deactivation. Remove a
directory suggestion from the static catalog independently. Past citation/evidence records
remain historical. Reverting these catalog files changes no financial records.
