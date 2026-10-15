# Private assignment association view — source handoff, 2026-10-15

Source only, **UNRUN**. This follow-up is based on local reviewed PR #503 source
`fc572ee8f7475030d8d7131d83226845cce7e531`; that dependency was not merged when
this work was assigned. It neither accepts nor closes the original #269 outcome.
PR #503 delivery does not wait for this consumer.

`OwnerRunAssignmentInbox` and its editor accept `readOnlyView`, defaulting to
`false`. `/me/profile` mounts it below `PrivateProfileView`; `/me/asks` mounts it
separately below `MyAsksView`. The existing English title, scope, attribution
labels and counts are reused. The existing Run assignments link leads to the
separate manage page, including for the operations mentioned by the existing
suppressed-association label. No locale or activation change is needed.

The consumer reuses `GET /api/me/run-assignments`, the strict `inboxSchema`, the
25-row bound and the separate `profile` counts. Only effective rows expose their
run IDs and original networks. Suppressed rows retain the existing inactive
association label and assignment ID; they contribute no positive attribution
counts. These associations grant no paid-run ownership, report visibility,
publication or inherited financial authority. Ordinary history views, counts and
exports are untouched.

Read-only mode renders no consent form, acknowledgements, proposal preview,
recovery JSON, replay, confirm, reject or withdraw controls. Handler and transport
guards refuse mutation requests. A wallet/role/mode key retires the old editor;
cleanup clears its active flag, pending recovery and qualified recipient,
increments its epoch, aborts requests and removes listeners/channel. Retained old
handlers cannot start another GET or POST after retirement. Existing credentials,
no-store, expected-wallet, strict schema, four-field recipient comparisons,
response epoch/abort, auth event, focus and BroadcastChannel fences remain in use.
Default manage request bodies and controls retain their existing behavior.

The DOM fixture uses the actual React component, Next Link, schemas, formatter
and copy. Only browser authentication and HTTP/auth-channel transport are
controlled. Authenticated HTTP envelopes and real held JSON response bodies are
synthetic. The fixture covers positive assigned/claimed rendering and counts,
suppression, unknown/malformed/foreign-wallet envelopes, account-generation
replacement, auth/focus/channel invalidation, abort/late-body isolation,
wallet/role/mode retirement, retained DOM handlers, unknown recovery destruction,
no new POST in read-only mode, and default manage decisions/consent/replay.
A fresh same-wallet native GET may identify a recreated account or generation;
the browser does not independently establish that four-tuple's native authority.
ROOT's current17/native positive GET evidence remains separately scoped.

All new tests, imports, type checks, builds and browser checks remain **UNRUN**.
Renaming the fixture to `readonly-view.test.ts` and replacing its sole JSX render
with `createElement` places it under the existing `lib/**/*.test.ts` include in
`vitest.config.mts` for durable discovery without a global configuration change.
Parent acceptance
requires a different reviewer, actual focused controls (including the existing
inbox controls) and types, then one final UI build/browser pass after transplant.
No runtime or native validation is inferred from source inspection.

The parent will verify #503 squash provenance, carry only this follow-up onto
actual main, and own its focused PR and required CI. No Git, provider, database,
browser, build, test or production operation was performed by this source worker.
Public profiles, JSON/CSV exports, MCP/CLI/extension/bot contracts, native/API/store
schemas and all financial writers are outside this UI-only change. Existing
desktop web rendering follows the same private pages; standalone surface
delivery and activation are not claimed.

Local handoff artifacts are in `output/private-association-view-source/`: raw
before/after files, absence markers, SHA-256 pins and full-file unique inverses.
They are retained local evidence, not additional publishable source paths.
