# English personal dispatch history catalogue

This bounded [issue #272](https://github.com/tang-vu/keryx/issues/272) increment
depends on the common-shell checkpoint
55c622f3931648135096f02dcbb7908376fc8561 in
[PR #379](https://github.com/tang-vu/keryx/pull/379). It owns only
`app/me/asks/page.tsx` and `app/me/asks/my-asks-view.tsx`, their dedicated English
catalogue registration, focused tests/guard baseline and this note.

[my-history.ts](../../locales/en/my-history.ts) contributes 43 semantic keys for
metadata, introduction, accessible network controls, loading/failure/sign-in/
empty states, summaries, toast, duration presentation and row actions/tooltips.
The two files explicitly select English. Whole sentences use named values or
React nodes, with named spacers where necessary to preserve original text
boundaries. The two empty-state sentences remain complete messages, preserving
their original conditional sentence and common instruction.

Five counted families have `.one`/`.other` forms: dispatch/citation captions,
other recorded funding, cited counts and the retained-row limit. Both English
arms deliberately retain the original `dispatches`, `citations paid`, `cited`
and sentence wording. Future translations can choose grammar without editing
the English interface. Existing count/admission predicates remain unchanged;
the singular selectors only choose presentation keys. Missing rendered count
or creator-name nodes remain absent, not zero or invented labels.

Questions, creator/source names, recorded confidence values and amounts remain
data. Current-row creator/money badges are data-only. Original-network rows keep
their `test USDC recorded` distinction. Compact duration arithmetic, invalid-date
behavior and formatting are preserved; locale/date formatting remains separate
work. The intermediate `HTTP` exception is diagnostic, while the visible toast
is catalogued. All 37 owned allowances are retired without changing unrelated
entries or guard provenance/parser metadata. A two-file regression checks new
inline English, including metadata, accessibility and toast contexts.

The existing `personal-history.ts` catalogue values used by browse/recent
controls remain unchanged. `CurrentHistoryPane`, pagination, authenticated
reader, actor ownership, API/storage adapters, optional-store admission and
routes are unchanged. This does not implement or close issue #262, activate a
history capability, add a scope or authorize a read against a real database.
Network/browse toggles, explicit retry, abort cleanup and the original re-ask
link retain their behavior. No automatic retry, signing or payment is added.

Bounded qualification compares 37 exact base/candidate component/action cases:
both network selections, loading/failure/sign-out/empty states, zero/one/two
count arms, retained rows, confidence/data variants, duration boundaries and
network/browse/manual-retry controls. Controlled Promise responses also exercise
the existing read callback's success, 401, HTTP failure, rejection and abort
branches on both rails, with equal request options, state and toast results.
The fixture never sends HTTP requests or imports a storage/auth implementation.
It uses actual components, catalogue/rich helpers and money presentation with
synthetic React hooks/Link, unchanged header/history-pane boundaries and a toast
observer. A test-only export accesses the real private ledger; product exports
and source bytes remain unchanged. Metadata and CSS classes/directives match;
all five callbacks match after reversing only the toast literal replacement.

Application/operations TypeScript, 15 catalogue/rich tests, 23 guard regressions,
the actual copy scan and scoped lint pass. The earlier 112 area 5/common-shell
render/action cases are reused only with exact unchanged source and recovered
catalogue/helper inputs. They are not rerun or described as new evidence. This
is source/render qualification, not CSS/pixel, normal boot, live ownership,
database, default Next build or deployed acceptance.

The module serves web presentation through the existing typed catalogue and
browser error consumer. API, desktop, CLI, remote and stdio MCP, extensions and
bots retain their existing contracts and roles. Root owns integrating this
focused personal-history PR after PR #379 merged, fresh combined-source hosted Next build
and applicable CI, release identity and one deployment. No version, dependency,
study, target, locale activation or human translation approval changes here.
The prior bounded completion map still applies outside these two retired files;
full issue #272 and its remaining visual/payment/signature/legal gates stay open.
