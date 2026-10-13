# Zotero duplicate and field acceptance correction

This correction advances [issue 285](https://github.com/tang-vu/keryx/issues/285)
on the existing dedicated-key integration. It adds no connection, provider write,
storage activation, migration, public listing, or automatic synchronization action
outside the established explicit user workflow.

The previous complete library scan checked consistent page versions, but its
writes used only object versions. Another client could create the same work after
the scan and before Keryx's POST, so a successful send could create a duplicate.
Every batch now includes `If-Unmodified-Since-Version` from the complete item
snapshot, while retaining the existing object versions and new-object version
zero. Subsequent batches advance only to the accepted reply's library version.
A concurrent change returns a private conflict and requires another explicit
action with a new scan. No automatic retry, key remapping or rollback is claimed.
Already reserved keys remain durable. If another writer creates an identical
reference under a different key after reservation, the next action retains the
conflict instead of silently transferring that mapping.

Snapshots reject duplicate object keys, objects newer than the snapshot and
changing page totals. Replies must carry a valid, nondecreasing library version;
successful objects must carry that exact version. Every submitted field must be
present and equal in returned editable data. Adopted-item updates include the
already-matched canonical reference fields as well as collection/key/Extra
changes, so these fields are checked too. POST's partial-update semantics retain
unrelated user fields, tags and notes. Object property order and collection order
are immaterial; creator order, literal notes and array/object types are preserved.
Trashed results refuse success. An `unchanged` result contains only a key, so the
adapter reads that exact item to verify fields and version before accepting it.
These reads retain the existing credential allowlist, revocation lease, provider
backoff and request/operation bounds. Missing or changed readback refuses; an
accepted subset may remain at Zotero.

Official sources were read on October 12, 2026 without credentials, account reads,
registration or writes:

- [Syncing](https://www.zotero.org/support/dev/web_api/v3/syncing) documents
  library-wide preconditions for multi-object writes, new-object version zero,
  and `/keys/current` grant inspection.
- [Write requests](https://www.zotero.org/support/dev/web_api/v3/write_requests)
  documents 50-object batches, per-index results, returned object versions and
  POST's partial-update semantics.
- [Basics](https://www.zotero.org/support/dev/web_api/v3/basics) supports dedicated
  keys and header-only credentials, successful Backoff, Retry-After and generally
  at most four concurrent requests. The existing personal read/note-read/write
  grant remains required; file and group access remain refused.
- [OAuth](https://www.zotero.org/support/dev/web_api/v3/oauth) documents registered
  OAuth 1.0a clients. This correction keeps the dedicated-key workflow.
- [Types and fields](https://www.zotero.org/support/dev/web_api/v3/types_and_fields)
  and the [official schema](https://github.com/zotero/zotero-schema/blob/master/schema.json)
  were inspected for valid item fields. The browser's unauthenticated template
  fetches failed with an internal error; schema inspection is not live API proof.

The existing signed session, expected-wallet/origin, publication revision,
encrypted token, no-log and gated ordinary-storage boundaries remain in force.
See the [integration and rollout gates](zotero-references-2026-10-11.md),
[private BibTeX snapshot contract](private-synced-bib-2026-10-09.md) and
[CSL-JSON contract](csl-json-reference-export-2026-10-09.md). Stable private links,
stable citation keys and CSL-JSON reuse the accepted base implementation.

Only the hosted Zotero adapter's internal behavior changes. Web and desktop users
reach it through the existing signed account page. Repository CLI, Operator,
remote/stdio MCP, extensions and bots retain their established export/handoff
roles; none gain provider credentials or send authority. Shared citation/export
paths remain with their existing owners, including issue 283's related-work work.

The new hermetic SQLite/provider fixtures model an independent writer, library
preconditions, accepted partial batches and returned field/version failures.
They use synthetic tokens and no network/spending. Before correction, the two
targeted regressions demonstrated false success after a concurrent duplicate and
a missing returned title. Focused checks and dependency/input hashes are retained
in the worker's ignored `.artifacts/issue285-refill` and root capture handoff.
The initial sandbox worker failed with `spawn EPERM`; the same runner used the
normal reviewed escalation and ran. The first corrected pass had a fixture
aliasing mistake, fixed by copying provider data independently of expectations.
The final four-file focused run passed 93 cases. TypeScript passed for the changed
adapter/tests and their transitive imports, and focused ESLint passed. No full
local suite or build was run: routes, client/server boundaries, configuration and
dependencies are unchanged; required full hosted acceptance stays with root.
The verified donor's 1,710 installed entries match this worktree's exact dependency
closure, with only the root release label differing. It was reserved read-only;
runner configuration, compile outputs, caches and fixtures stayed in this worktree.
Native Git fetch and staging refused `FETCH_HEAD` and `index.lock` respectively
with permission denied. No alternate Git writer was used. The uncommitted source,
patch and hashed evidence are handed to root for the authorized checkpoint/review.

Independent root review, required exact-candidate CI, accepted combined-source
delivery, supported encrypted target storage and observability redaction remain
gates. Actual owner-consented Zotero connect/send/re-send/revocation and Overleaf
import/refresh/compilation proof remain absent. This source/fixture correction
does not close original issue 285 or claim provider/production delivery. Root
retains publication, merge, version, deployment and issue-closure ownership.
