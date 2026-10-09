# Private bibliography URLs — source candidate, October 9, 2026

This staged outcome advances [issue285](https://github.com/tang-vu/keryx/issues/285)
after CSL-JSON export. It provides an explicit saved-paper snapshot workflow and
stable BibTeX keys. Zotero authorization, duplicate-safe library writes, report
links/excerpt notes, provider-token encryption and live Overleaf acceptance remain
open. This document does not claim deployment or issue completion.

## Owner workflow and snapshot scope

On a deployment supporting the ordinary SQLite capability, sign in and open
`/me/bibliographies` (also linked from the saved literature workspace). Enter a
private review name and choose **Create private BibTeX link**. The page uploads
only the currently saved `PaperRecord` metadata, at most 50 records. It excludes
the local research question, screening decisions, personal notes, paper bodies,
profiles, answers, receipts and payment history. The name is owner-only metadata;
it does not enter the `.bib` file. This is the whole saved list, irrespective of
the literature page's screening filter, and the page says so.

The URL appears once as selectable text, with an explicit clipboard action. It
is never a prefetchable link, written to browser storage, appended to navigation
history or included in an owner listing. Leaving the page or changing accounts
clears it. If the creation response is lost, reload the owner list, revoke that
snapshot and explicitly create another; there is no recoverable plaintext token
or automatic retry. A lost response can still leave an accepted snapshot.

Choose **Replace references from this browser** to update the selected snapshot
under its existing URL. The action confirms the saved-paper count and requires
the displayed revision. Local edits do not publish automatically. An empty
replacement removes all references while retaining the link. Revocation deletes
the server snapshot and blocks future pulls; it cannot recall files already
downloaded or retained in another service.

Saved-paper BibTeX now uses the same exact-landing-URL `referenceKey` as CSL-JSON.
Filtering, ordering and new sessions retain the key; distinct arXiv versions remain
separate, and an identifier collision refuses the complete export. Fields,
escaping, metadata-only notes and publication limits remain unchanged. Earlier
downloaded ordinal keys (`keryxPaper1`, etc.) do not change retrospectively; a
writer adopting a new export must update their existing LaTeX citation commands.
Original-page bibliography generation and sanitized archive/checked-receipt
projections explicitly retain their legacy ordinal keys; saved bibliography and
receipt bytes and existing research-citation keys remain unchanged. Exact-URL
identity does not merge DOI aliases across providers.

## API and privacy boundary

| Endpoint | Behavior |
| --- | --- |
| `GET /api/me/bibliographies` | Signed session's private metadata list; no wallet selector, content, token hash or URL. |
| `POST /api/me/bibliographies` | Explicit `{title,papers}` creation; returns metadata and one-time relative `urlPath`. |
| `PUT /api/me/bibliographies/{id}` | Complete metadata-snapshot replacement; requires `If-Match: "<revision>"`. |
| `DELETE /api/me/bibliographies/{id}` | Revokes/deletes this owner's snapshot with the same revision precondition. |
| `GET /api/bibliographies/{256-bit-token}.bib` | Reads only the published snapshot selected by this bearer capability; no account session needed. |

Management is session-only. Historical API keys gain no new sharing authority;
any present Authorization header refuses rather than falling back to a cookie.
Every management request compares `X-Keryx-Expected-Wallet` to the independently
authenticated, revocable signed-session owner. Writes require the exact request
origin. The UUID identifies a document, never an owner; another owner's mutations
receive a non-identifying 404. Atomic revision checks prevent stale replacements
and revocations. The editor remounts on owner changes, cancels its requests and
withholds stale responses; cancellation does not promise server-side rollback.

Request JSON is bounded to 256 KiB with a five-second read deadline and strict
UTF-8/metadata validation; generated BibTeX is bounded to 512 KiB. Each owner has
at most 20 snapshots. No arbitrary `.bib` upload or stored report/draft selector
is accepted. Invalid and revoked download capabilities receive the same 404.
All route responses are private/no-store, no-referrer and noindex; Next's
configured header overrides preserve those policies. Content is an attachment
with a fixed filename and `nosniff`, not HTML.

Bearer possession allows downloading this metadata until revocation. Anyone
given the URL, including a chosen external writing service and its collaborators,
can retain a copy. The service stores only a domain-bound SHA256 of a random
32-byte token. Application code logs neither tokens nor URLs and records no
download events. **Before enabling this on any externally reachable deployment,
verify and redact the `/api/bibliographies/` path in proxy/CDN/access/error logs
and observability tooling; Next development request logging can expose paths.**
No claim that server headers prevent another service from retaining its import.

## Storage and supported surfaces

`KeryxDB.privateBibliographies` is an optional, non-enumerable ordinary SQLite
port. Its separate table installs only after ordinary schema admission. Each
transaction checks enrollment absence and the exact domain schema, including
indexes/triggers. Unknown optional schema disables only this port, without
repairing it or taking existing ordinary research/account reads offline. No
query, profile, receipt, creator or payment tables are joined or modified.

Enrolled/native SQLite and all Supabase adapters omit this capability. Routes
refuse unsupported storage without schema migration, REST/RPC fallback or an
in-memory success. Production enablement needs separately reviewed storage
authority and operational acceptance; this candidate changes no sealed schema,
method inventory, enrollment identity, private-profile authority or custody.

| Surface | Source behavior / remaining gate |
| --- | --- |
| Hosted web | Explicit owner management and saved-workspace entry link; provider integration is not automatic. |
| Hosted API | Session-only owner writes and snapshot-scoped bearer pulls; no new research or public-listing contract. |
| Desktop | Hosted account-page use when supported; the helper shares stable paper-key formatting. Native writers/inspection and original receipts retain authority. Packaging/distribution gates remain. |
| Repository CLI / Operator | New generated saved-paper BibTeX shares stable keys. Saved export snapshots and checked-receipt recovery are not rewritten; no local sharing-store bypass or sync command. |
| Remote and stdio MCP / A2A / OpenAI | Original-page bibliography projections retain ordinal keys; research-citation exports retain their existing keys. No tools or key scopes create private links. |
| Extensions / bots | Existing hosted/page/answer roles; no account connection or private sharing command. |

Runtime version selection, main merge, deployment, installer/package publication
and synchronized version claims belong to the coordinated release after the
current release45 freeze. This branch performs none of them.
The shared formatter and original-page helper edits are source candidates subject
to exact-source review and projection/receipt parity gates; they authorize no
native or active original-completion-window cutover.

## Current provider documentation and remaining integration gates

Official documentation was rechecked on October 9, 2026; no user account was
connected or called. [Overleaf's external URL workflow](https://docs.overleaf.com/managing-projects-and-files/adding-files-to-a-project/adding-a-file-from-a-url)
requires a direct download without a login or intermediate page and documents
refreshing an externally linked file. The bearer download is designed for that
pull model: the user must explicitly give Overleaf the URL and refresh its
imported `.bib` after a snapshot update. There is no Overleaf OAuth scope or
access token in this implementation. Actual external import, refresh, revocation
and compilation remain live owner-consented acceptance gates.

For a separate Zotero adapter, [OAuth key exchange](https://www.zotero.org/support/dev/web_api/v3/oauth)
currently uses OAuth 1.0a and a registered client. Permission inputs distinguish
personal library read, note read, library write and all-group access. A prospective
personal-library adapter should request only the required read/write access,
avoid note-read/all-group access unless its workflow demonstrates a need, and
verify the granted permissions. The provider key remains sensitive until the
user revokes it. No provider key is requested, stored or used here; encrypted
storage and revocation integration remain prerequisites, not completed criteria.

[Zotero write requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)
allow batches of up to 50 items and return individual successful/unchanged/failed
results. Write-token replay protection is cached for 12 hours; it cannot alone
prove duplicate avoidance across sessions. Durable per-user exact-work item
mapping, reconciliation of ambiguous writes and actual existing-library duplicate
checks remain open. [Rate-limit guidance](https://www.zotero.org/support/dev/web_api/v3/basics)
requires respecting Backoff/Retry-After and generally no more than four concurrent
requests. These are future-adapter design constraints, not requests made by this
candidate.

## Reproducible validation

With the pinned dependencies and explicit offline/testnet settings:

```powershell
node node_modules/vitest/vitest.mjs run lib/db/private-bibliographies-sqlite.test.ts lib/bibliographies/bibliography-routes.test.ts lib/bibliographies/bibliography-browser.test.ts lib/papers/reference-export.test.ts lib/db/private-profiles-sqlite.test.ts lib/db/enrolled-sqlite-adapter.test.ts
node node_modules/vitest/vitest.mjs run lib/research/surface-result.test.ts lib/research/bibliographic-original.test.ts lib/research/bibliographic-task.test.ts lib/research/receipt-exports.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit --project tsconfig.ops-scripts.json
node node_modules/next/dist/bin/next build
node --import tsx scripts/test-private-bibliography-built.mts
```

SQLite/route tests cover hashed secrets, exact snapshots, ownership, revision
conflicts, revocation, bounds, enrollment/schema refusal and unchanged unrelated
history. An old-ordinal archive fixture checks that the safe projection preserves
the original BibTeX key without mutating stored run or receipt bytes. Hermetic
Chromium fixtures exercise explicit actions and private-prose
exclusion at 320/1366 pixels, plus delayed owner-change responses. The built
fixture uses an isolated ordinary database and synthetic durable JWT sessions,
verifies actual Next route/header behavior and revoked-session refusal, and
never connects a provider or shared store. It is not live SIWE/production or
external Overleaf/Zotero acceptance. Main aggregate, independent review and
applicable storage/domain/platform checks remain mandatory release gates.

The first old-ordinal fixture failed because safe projection regenerated a stable
key. The explicit original-page legacy mode corrected that regression; all 54
formatter/original-bibliography/surface/receipt tests passed on the correction.

The local Windows worktree's dependency junction crosses Turbopack's filesystem
root and refuses the default build before compilation. `next build --webpack`
may be used here for actual built-route/privacy validation without changing
project configuration; this is distinct from the required hosted default
Turbopack build against a physical locked dependency installation. The local
webpack attempt also stops on a baseline Wagmi/Base Account/Coinbase dependency
import of missing `@x402/svm/exact/client`, before this candidate's routes can be
built. Neither local build nor the built fixture passed; hosted exact-source CI
and the built fixture remain open. A webpack result does not satisfy the
default-build release gate.

The app TypeScript check passed before those build attempts generated route
validators. The later full check reports baseline `SourcesPage`'s defaulted props
as possibly undefined in `.next/types/app/sources/page.ts` (TS2344); the source is
unchanged from `f5565998`. This remains a full generated-route gate, separate from
ops and a source-only check excluding generated build directories.
