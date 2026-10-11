# Explicit Zotero reference sending — gated source, October 11, 2026

Relates to [issue285](https://github.com/tang-vu/keryx/issues/285). The existing
CSL-JSON, stable keys and private bibliography URLs remain in place. This source
adds a personal Zotero connection and an explicit selected-collection send path.
Synthetic acceptance does not establish live Zotero delivery or issue completion.

## User workflow

Open `/me/references` from the private bibliography page and sign in. Connect a
dedicated Zotero API key with personal library read, note read and library write
permissions; file access and every group permission must be off. The API checks
the actual grant and user ID. No application registration or client secret is
required for this dedicated-key workflow. An OAuth exchange is not implemented.

Choose **Load collections from Zotero**, select a collection, then explicitly
send either saved literature metadata or a report ID from owned research history.
The confirmation explains the external disclosure. Mounting the page reads only
local connection status. Saving papers, research completion, changing accounts,
loading collections and background schedules never push references.

Saved literature sending includes at most 50 `PaperRecord` snapshots. Review
titles, questions, screening decisions and personal notes are excluded. Report
sending uses the existing live `runOwnershipHistory.read` capability, bound to
the signed owner, network and configured origin. It sends canonical citations,
the public `/dispatch/{id}` link and literal recorded quotes matching the cited
marker, source, item, URL and content version. Only answer/reward-qualified
evidence enters notes. HTML escaping retains quote whitespace and punctuation.
Private originals, `prv_` IDs, foreign/missing reports and archive fallback are
withheld. Missing owner-history capability keeps report sending unavailable.

Disconnect removes Keryx's encrypted key and invalidates outstanding leases.
Every later provider request checks that lease. A request already in flight can
still complete; disconnection cannot recall external copies. Users can also
delete the dedicated key at Zotero's key settings. No provider key deletion or
library-item deletion is performed by Keryx.

## Canonical fields and duplicate handling

The adapter consumes the existing saved-paper and research-citation CSL-JSON
projections, which share the established BibTeX identity and recorded fields.
It preserves the stable citation key in Zotero's `citationKey`, literal/provider
author name parts, title, exact URL, DOI, year and supplied journal/conference,
volume, issue and page metadata. Archive name, exact arXiv identifier, content
version and fields lacking a native field for that item type remain labeled
values in `extra`. The existing canonical provenance note becomes a child note;
report links and exact cited excerpts are additional note content. No author
split, reading claim, publication status or settlement is inferred.

Before writing, the service reads a complete, version-consistent library snapshot
including trashed objects, bounded to 1,000 items. It identifies Keryx work
markers and exact URL/DOI candidates; conflicting metadata, duplicate candidates,
trashed matches, incompatible citation keys or unknown extra-field conflicts
withhold the send. An identical existing item can be adopted while retaining its
other fields, notes and collection memberships. Distinct recorded content
versions and exact arXiv URLs remain distinct. This is conservative identity
reconciliation, not general fuzzy bibliographic deduplication. Large or changing
libraries require a separately reviewed incremental reconciliation design.

Durable per-owner/per-Zotero-user work and note keys are reserved before sending.
New objects use `version: 0`; updates carry the observed object version. This
prevents overwriting a key collision and lets a later explicit send reconcile an
ambiguously accepted request. Mapping hashes and keys survive disconnection, so
reconnecting the same library preserves duplicate protection. At most 5,000 keys
are retained per owner/library. No report text, token, URL or excerpt is stored
in that mapping. Notes use a parent/content identity, so repeating an unchanged
report creates neither another reference nor another note.

Writes contain at most 50 objects per batch, with parents preceding child notes.
Every result index and returned key is checked. HTTP 200 with any per-object
failure is a failed operation, which can have accepted a subset. The UI explains
that possibility. There are no automatic retries, rollback claims or schedules.
Durable operation leases admit one operation per owner and at most four across
the store. Successful `Backoff` and error `Retry-After` persist a store-wide hold
before another request; disconnection does not clear it. Malformed delay headers
fail closed with an indefinite hold requiring separately reviewed recovery.

## API and storage boundary

| Endpoint | Explicit action and contract |
| --- | --- |
| `GET /api/me/references/zotero` | Local `{connected,userId}` status only; no token or encrypted envelope. |
| `PUT /api/me/references/zotero` | Strict `{apiKey}` dedicated-key connection; validates actual permissions. |
| `DELETE /api/me/references/zotero` | Local per-user revocation; returns `{revoked:true}`. |
| `POST /api/me/references/zotero/collections` | Explicit bounded collection read. |
| `POST /api/me/references/zotero/send` | `{kind:"papers",collection,papers}` or `{kind:"report",collection,reportId}`; successful result has `{references,writes,collection,provider:"zotero"}`. |

All routes require a revocable signed web session and
`X-Keryx-Expected-Wallet`; any Authorization header refuses cookie fallback.
Non-status actions require the exact server-configured Origin and an absent or
`same-origin` Fetch Site. Request JSON is bounded to 256 KiB and five seconds.
Unknown fields, arbitrary report URLs and client-supplied quotes are rejected.
Responses and framework headers are private/no-store, no-referrer and noindex.
Errors use fixed machine codes; raw provider text, exceptions and keys are never
logged or returned. Provider requests use only `https://api.zotero.org`, v3,
header-only credentials, no redirects/cookies, a 15-second request deadline and
a 2 MiB response limit. Each operation has a two-minute deadline.

`KeryxDB.zotero` is optional and non-enumerable on ordinary SQLite. Its separate
connection, key-map and provider-hold tables install only when
`KERYX_ZOTERO_ENABLED=1`, after ordinary schema admission. Every transaction
checks enrollment absence and exact domain tables/indexes/triggers. Unknown
schema disables this capability without repair or changes to unrelated research.
Supabase, enrolled/native adapters and reduced private roles expose no port.
There is no sync-state, REST/RPC or in-memory fallback.

Keys use the existing AES-256-GCM envelope helper and `CONTENT_MASTER_KEY`, with
authenticated data binding the Zotero token domain, normalized owner and actual
Zotero user ID. Missing encryption configuration refuses provider operations.
No master key is generated, replaced or deployed by this change. Browser keys
are cleared on submission and account remount; they are never persisted locally.

## Official provider sources checked October 11, 2026

- [Authentication and rate limits](https://www.zotero.org/support/dev/web_api/v3/basics):
  dedicated per-service keys are supported; headers avoid URL credentials.
  Backoff can accompany success; Retry-After governs throttling/maintenance;
  generally at most four requests should be concurrent.
- [OAuth permissions](https://www.zotero.org/support/dev/web_api/v3/oauth):
  OAuth 1.0a requires registration; library read, note read, write and group access
  are separately requested. This workflow uses a dedicated key. Note read is
  necessary to reconcile child notes after lost responses; group/file access is
  unnecessary and rejected.
- [Syncing and grant inspection](https://www.zotero.org/support/dev/web_api/v3/syncing):
  `/keys/current` checks actual permissions; object versions prevent stale
  overwrites; explicit new keys use version zero.
- [Write requests](https://www.zotero.org/support/dev/web_api/v3/write_requests):
  at most 50 objects, per-object results, parent/child notes and locally generated
  object keys. The twelve-hour write-token cache alone cannot guarantee durable
  duplicate avoidance; this implementation uses reserved keys and versions.
- [Field/template API](https://www.zotero.org/support/dev/web_api/v3/types_and_fields):
  unauthenticated official templates for `journalArticle`, `preprint`,
  `conferencePaper` and `webpage` were inspected, including native `citationKey`.
  No account resource was read and no provider write was performed.

## Supported surfaces and concrete rollout gates

| Surface | Source behavior / boundary |
| --- | --- |
| Hosted web/session API | Dedicated-key connection and explicit sends when the gated ordinary port is available. |
| Literature/private bibliography | Navigation to the connection page; stable exports and private bearer snapshots unchanged. |
| Desktop | Can use the hosted account page; no native token store, local Zotero API or private original export authority. |
| Repository CLI / Operator | Existing canonical exports remain; no provider connection/send command or private-role expansion. |
| Remote/stdio MCP / A2A / OpenAI | Existing export contracts remain; no tool, API-key scope or automatic integration action added. |
| Extensions / bots | Existing hosted/answer roles; no connection or send command. |

Root owns main merge, source-graph/version selection, distribution and deployment.
Before activation: accept exact-source CI and independent review; admit supported
encrypted persistence for the target deployment (Supabase/enrolled remain absent);
review retained-key/master-key backup and rotation; exclude connection request
bodies/auth headers from observability; and obtain explicit account consent for
actual connect/send/re-send/revocation acceptance. No shared production DDL,
credential acquisition, real account action, spending or activation occurs here.
Overleaf import/refresh/compilation acceptance from the prior `.bib` outcome also
remains external. Original285 stays open until delivered original criteria pass.

## Validation qualification

Focused isolated tests cover canonical fields, author ordering, exact escaped
excerpts, encrypted owner binding, permission refusal, durable duplicate keys,
partial/ambiguous writes, existing-library conflicts, revocation, provider delays,
50-object batches and owner/global leases. Browser fixtures exercise explicit
actions, private-prose exclusion, account remount and delayed responses at
320/1366 pixels. Their screenshots use an isolated style harness, not a deployed
Next page or live SIWE/provider session. Existing bibliography/export tests are
reused for private snapshot and stable-key regressions.

Local checks use Node24.21, blank Supabase, Arc testnet/offline, no environment-file
loading, native Vitest configuration loading and disabled cache. The read-only QA
junction currently supplies Vitest4.1.11 rather than the manifest's4.1.9; it was
not modified or installed. The first runner-config attempt failed on a CJS loader,
then sandbox worker startup refused; native-loader approved worker execution
resolved those harness issues. The first provider fixture had an invalid Zotero
collection character and was corrected. Initial test casts failed TypeScript
and were replaced with a typed item-field contract. Missing default Chromium was
resolved using the retained browser cache, without installation.

The local webpack production build failed on the unchanged QA dependency graph:
`@coinbase/cdp-sdk` cannot resolve `@x402/svm/exact/client`. Dependencies were not
repaired or mutated. Actual hosted default build, aggregate and applicable
domain/platform CI remain acceptance gates; no local build success is claimed.
The failed webpack build also left legacy generated validators rejecting two
unchanged `/api/runs` and `/sources` signatures. Fresh `next typegen` route types
and the complete app source graph pass in an isolated TypeScript project that
excludes those failed-build validators; the ops TypeScript graph also passes.
Next's temporary tsconfig formatting/include changes were restored byte-for-byte
in Git, without deleting build output or changing either existing route.
Exact counts, commits, check runs and review corrections are recorded in the
worker's status/handoff rather than treating synthetic writes as real delivery.
