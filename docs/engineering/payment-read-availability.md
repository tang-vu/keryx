# Payment history availability

An ordinary Supabase payment read previously discarded the SDK's `error` and
used `(data ?? [])`. A failed fetch, HTTP error, malformed JSON or absent result
could therefore become an apparently successful empty history. The transport
wrapper throwing on non-2xx was insufficient: pinned supabase-js/PostgREST2.112.3
can catch that rejection and resolve a result with `data: null` and an error.
The [official error guide](https://supabase.com/docs/guides/api/handling-errors-in-supabase-js)
and [throwOnError reference](https://supabase.com/docs/reference/javascript/using-modifiers-throwonerror)
describe result-based errors. The regression uses the real installed SDK and
adapter, replacing only synthetic HTTP and database acquisition boundaries.

`SupabaseAdapter.listPayments` now requires an error-free array before converting
rows. A true empty array remains valid. Error, null,204, malformed or non-array
results become the fixed `Payment history unavailable` failure. Successful row
normalization, requested limit, order and exclusion of prepared/unexposed-cancelled
authorizations retain their existing behavior. No SDK upgrade, global error mode,
transport retry or enrolled-authority change is introduced. The SDK's existing
three retries for a rejected idempotent fetch remain; one logical read can make
four synthetic HTTP attempts. The guard acts on its final result.

The public `/api/payments` route returns a fixed no-store503 error when database
acquisition or reading fails. It does not emit an empty success array or publish
upstream diagnostics. Successful history keeps all existing states/networks and
public metadata; it is separate from the selected-network settled-only activity
projection. Limit validation remains before acquisition. The existing activity
route catches the read failure, so the real ticker shows unavailable activity;
a genuinely empty successful read still hides the ticker.

The19 focused cases include the actual SDK's caught-fetch behavior, HTTP/network/
abort/parse/null/204 errors, non-array refusal, genuine empty and exact mixed-state
history, public error sanitization/acquisition failures, limit refusal and two
minified Chromium ticker cases consuming actual activity-route output. They keep
SDK retries distinct from application calls. All HTTP is intercepted on synthetic
domains; there is no real Supabase, source, model, payment or signing request.
Earlier fixture count/deadline corrections are retained separately from the
qualified failing baseline.

The enrolled RPC lane already rejects result errors and retains its identity,
initialization and no-legacy-fallback gates. This changes an ordinary read result
and the public availability response, not settlement, writes, migration, custody,
nonce/cap/payee authority or reconciliation. Other adapter operations still need
their own checked result handling; the old transport comment was corrected rather
than claiming this repairs every SDK operation. Existing CLI/API/MCP/desktop,
extension and bot role contracts remain, with read failures propagated instead
of invented empty history. No live enrollment or funded acceptance is claimed.

The changed adapter is in the paying-source study's537-file closure. Its actual
offline48-trial write/check must refresh source binding, with all48 outcomes,
corpus/design/lock and outbound0 unchanged. Required local types, privacy/payment/
authority regressions and full PR/main/domain CI remain separate gates. Deployment
and publication require the existing explicit owner command.
