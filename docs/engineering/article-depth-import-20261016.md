# Task-focused original article import — October 16, 2026

The owner requested another bounded article import after the nine-feed expansion.
The final isolated staging library contains **129 selected original-page excerpts**:
82 new article identities and 47 deeper versions of articles already in the captured
feeds. Six publishers contribute browser/audio (47), storage/architecture (37) and
AI/evaluation (45) material. The [metadata manifest](../research/article-depth-manifest-20261016.md)
lists every original URL, publication date or unknown date, length and content version.

| Publisher | Selected excerpts |
| --- | ---: |
| GitHub Engineering | 30 |
| Lilian Weng | 24 |
| Martin Fowler | 7 |
| MDN Blog | 22 |
| Mozilla AI | 21 |
| WebKit | 25 |

## Selection and preservation

Three literal CLI slots collected disjoint sources into separate ordinary offline
testnet SQLite stores. Fresh feed observations were saved before original-page
reads. Four official MDN API documents were separately chosen for known browser/audio
tasks before inspecting probe results. Existing public backfill/parser/transport and
archive APIs were used; no runtime crawler, budget, payment authority or schedule changed.

Each selected revision was actually read from its original page and checked against
its stored immutable article version and content hash. Selection required a substantive
reviewed article path, at least 1,000 characters, and either a new URL or at least 25%
and 1,000 characters more text than the captured feed body. Listings, navigation,
access failures, duplicate URLs/bodies and comparable or longer feed content were
excluded. Publisher caps (30) and group caps (70) were fixed before scoring probes.
This is a bounded selection, not a complete or random publisher archive.

The first trial selected 137 excerpts. Eight Eugene Yan originals used single-slash
paths while their feed used double-slash paths. Existing archive identity rules would
store a duplicate instead of deepen that feed item. They were excluded without
rewriting URLs, bodies or runtime keys. The initial trial and its results remain
private; only the corrected 129-item corpus is the delivery candidate. This correction
addresses duplicate identities and was not chosen to improve the probe score.

Independent review also rejected three GitHub depth claims where author biographies,
related posts and promotional footers supplied the apparent growth. The editorial
section itself added fewer than 1,000 characters. The fixed selection order supplied
three other qualifying articles; captured bodies were not rewritten. Editorial
growth must now satisfy the same depth threshold wherever that audit boundary exists.

The final corpus retains 2,258,762 characters. Publication dates are known for
47 excerpts and unknown for 82. Extraction/character limits were observed
for 5; a limit flag is unavailable for 1. Every body retains the excerpt label;
absence of a limit flag does not establish completeness. V8 robots unavailability,
Chip Huyen feed timeout, other failed reads and incomplete discovery queues remain
recorded privately and do not count as recovered original articles. Publisher robots,
pacing, HTTPS origin restrictions and extraction limits were preserved.

## Controlled retrieval result

Twenty task-derived questions and concept groups were fixed before corpus selection.
Their themes follow documented browser/audio and storage work and the evidence study.
They are not verbatim user requests, accepted answers or a held-out benchmark. Choosing
the four MDN documents for known tasks makes this a task-guided coverage check.

The same captured feeds from the six selected publishers supplied 187 baseline article
identities. Adding the selected originals produced 269 identities: **82 added, 47 updated**.
Repeating that import produced **0 added, 0 updated**. Neither payable source rows nor
payments existed in the isolated store. The evaluation child used the existing fresh
study environment and outbound-denial boundary; it recorded **0 outbound attempts**.
Public collection occurred earlier in separate finite workers.

The comparison calls the existing archive discovery and bounded evidence-context
helpers, then inspects all returned free candidates. A hit requires all predefined
concept groups in one returned passage. It does not run paid decisions, reading
attention, synthesis, provider calls or human acceptance. Literal passage hits changed
from **5/20 to 9/20**, with 6 gains and **2 losses**. Lost hits are retained
below; adding content can change which article or passage is surfaced.

| Task-derived probe | Feed baseline hit | Expanded library hit |
| --- | --- | --- |
| browser-object-url | no | yes |
| browser-autoplay | yes | yes |
| browser-transactions | yes | yes |
| browser-memory | no | no |
| storage-backup-replica | no | yes |
| storage-restore | no | no |
| storage-wal | no | no |
| storage-migration | no | yes |
| retry-idempotency | no | yes |
| queue-backpressure | no | no |
| network-access | no | no |
| transaction-isolation | no | no |
| retrieval-evaluation | yes | yes |
| rag-chunking | no | no |
| llm-evaluation | no | yes |
| agent-reliability | no | yes |
| inference-cache | no | no |
| offline-online-evaluation | yes | no |
| model-drift | no | no |
| grounded-evidence | yes | no |

This proxy can match an irrelevant passage: for example, an audio-related probe also
matched a Mozilla AI ground-truth article. The MySQL-pool hit does not itself answer
whether replication replaces a backup. The score therefore establishes literal
passage availability only. It is not answer correctness, source independence,
accepted user work, a measured speed/cost improvement or production performance.
The observed losses (offline-online-evaluation, grounded-evidence) remain open
retrieval concerns; they are not hidden by the net increase. More ingestion alone
does not establish that Keryx answers better.

## Delivery and supported surfaces

Source baseline: 701a7fa9fbe9106771aadfd56a6419d59e9c3025 (PR #541).
Private payload SHA-256: 7b094af0fcec57a78c846971d455546e933c7e686407f5dbc745c12f7faee6d6.
The task's local coordination record locates the private stores, exact feed snapshots,
selected bodies, reports, initial trial and review evidence. Public Git contains
metadata and this report only.

**Production import is pending with the existing release owner.** The active release72
merge/deployment hold remains authoritative. A local import is not live delivery.
The staging database and source-bound checkpoints must not replace or select the
enrolled production store. Replay must use the normal admitted application profile,
existing archive API, active approved sources, verified exact payload, and existing
backup/archive-storage gates. It must preserve deactivation and financial/private holds;
missing catalog onboarding or archive support is a concrete prerequisite, not grounds
for a fallback database or schema mutation. The remaining exact replay operation is
recorded in the private handoff for the coordinator.

This PR changes documentation only and requires no runtime deploy, version bump or
product announcement. Once the coordinator verifies a production data import, hosted
web/API, remote MCP and bot research can use their existing shared archive discovery.
CLI/stdio MCP, desktop and extension research retain their existing hosted handoff;
standalone local stores require their own explicit onboarding. No public interface,
payment/custody authority, reading cap or client distribution changed.
