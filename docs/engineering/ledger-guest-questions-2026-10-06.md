# Guest question activity on the ledger

Application **0.27.16 candidate**, October 6, 2026. The owner requested guest
activity and confirmed retaining the "recorded accounts" label.

## Definition and behavior

`guestQuestions` counts completed public question records with explicit `web`
origin and no recorded signed-in wallet (`asker` is NULL/missing/empty).
It is a subset of `totalQueries`, which includes all recorded origins. Engine,
MCP, A2A and unknown historical origins are excluded from the guest count.
Non-empty legacy identity values are not treated as guests. The absence of a
recorded wallet is the observable definition, not proof of a unique visitor or
of historical authentication state outside the retained record.

The web ledger adds "guest questions" beside recorded question/account totals
and explains the overlap. It preserves "recorded accounts". The shared metric
helper supplies the additive optional nullable `DashboardMetrics.guestQuestions`
using existing SQLite and Supabase query-metric projections, including enrolled
readonly surfaces. No new storage RPC, schema, identity tracking, cookies,
historical backfill, payment authority, custody or schedule is introduced.

Missing, null, non-integer, negative or greater-than-total API values remain
unavailable while other valid totals stay visible. Confirmed zero is explicit;
failed refreshes retain a visibly dated last successful read.
Legacy Supabase rejects failed/malformed question-metric pages rather than
publishing zero or a partial question aggregate, matching enrolled scan behavior.

## Surface audit

| Surface | Impact and boundary |
| --- | --- |
| Web | `/dashboard` gains the guest question aggregate and definition. Responsive layout and existing account labels stay covered. |
| Public API / A2A | `/api/metrics` and its OpenAPI response add optional nullable `guestQuestions`; only a count, no account/run rows. Research, receipts and checkout keep their contracts. |
| Remote MCP / OpenAI | Hosted research/output/payment contracts retain their roles; no metric tool is added. |
| Buyer / Operator CLI and stdio MCP | No runtime/package changes; public ledger remains reachable through hosted links. |
| Windows desktop | Task/receipt/export and buyer handoff retain their roles; no installer change. |
| Browser extension | Existing hosted handoff; no tracking or native identity role. |
| Telegram / Discord / Slack | Existing hosted results/links; no new bot messages or runtime behavior. |

## Acceptance and release gates

Focused fixtures cover explicit guest classification, signed/legacy identities,
non-web/unknown origins, exact zero and identity-free aggregates; both adapters
and enrolled readonly boundaries are included. Hermetic Chromium covers both
profile labels at 320/768/1440 pixels, real zero, missing/null/malformed/excess
guest values, independent existing totals and dated retained reads. Fixture HTTP
is intercepted and read-only.

TypeScript (both graphs), lint, production build, required CI, independent review,
merged-source deployment, public health identity and API/UI readback are release
gates. A paid canary is not required for this aggregate/presentation change.
No package/installer republish is needed when its bytes and contracts are unchanged.
This candidate document does not claim pending gates have passed.
