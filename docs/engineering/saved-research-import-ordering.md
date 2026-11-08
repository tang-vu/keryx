# Saved-research import ordering

Reading a recovery file and validating/committing its IndexedDB journal are
asynchronous. Previously, their completion unconditionally opened the imported
job. An older import could therefore replace a newer selected report, reopen a
closed reader, override a later import, or show a stale failure after success.

The workspace now records an import selection intent separately from its list
revision. Beginning another import or explicitly selecting/closing a report
supersedes the earlier intent. A completed import always refreshes the saved list;
it opens a report only when its intent is still current. Ordinary list refreshes
and conditional completion of a local removal preserve a pending import intent.
All workspace updates remain pure queued state transitions. Existing monotonic
view keys and selection-bound removal behavior stay intact.

The saved-jobs component scopes import errors to the latest attempt and active
intent. A stale completion does not reset the current lookup or removal prompt.
Unmounted controls do not select a report or display an import error. A committed
import remains retained locally even if its automatic selection was superseded.

The browser regression uses minified production React components, native File
reads and real IndexedDB transactions. It covers delayed file reads and queued
writes, different/same-ID/sibling-control selections, closing, list refresh,
overlapping imports and failure order. The unchanged implementation fails eleven
of fourteen cases; the other three preserve ordinary import behavior. Remaining
original journals are compared byte-for-byte, imported records remain
`submission_possible` and refuse submission claims, and all observed requests are
GET-only recovery calls.

This changes browser view ordering only. Recovery parsing, exclusive journal
insertion, seller-assertion limits, signatures, submission permission, payment,
receipt verification and public/private research contracts stay unchanged.
