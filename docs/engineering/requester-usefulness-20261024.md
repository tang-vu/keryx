# Original-requester feedback and recorded job observations

Ordinary public research now delivers a separate private observation packet to
the original response channel after the original run is saved. It contains the
run ID, recorded generation duration and partial model-cost bounds, plus an
optional capability for recording one usefulness opinion. Historical public IDs,
saved turns and exports cannot recover that capability. No answer or citation is
changed by this observation layer.

The web form starts without a selected opinion. The caller explicitly chooses
Useful, Needs revision or Unusable, optionally supplies a private reason, then
records it. Silence remains no response. A lost response never confirms a choice
or retries a write automatically; an explicit read can discover whether the
original submission reached storage. A later different choice/reason conflicts.
An opinion requests no executed revision, refund, research or payment.

## Authority and persistence

`KERYX_REQUESTER_FEEDBACK_DIRECTORY` explicitly selects a persistent absolute
directory containing a `.local` path segment, with no trailing separator. Missing
configuration makes feedback unavailable while leaving recorded observations
usable. Configure it once through the existing ROOT release, under the canonical
local-data policy; it is independent of the selected main application database.
There is no native/enrolled fallback or main-database schema/write capability.

The journal uses a dedicated SQLite application ID, exact immutable schema,
store UUID, origin/network identity, WAL/FULL synchronization, bounded contention,
64 MiB file/10,000-opinion ceilings, and append-only first-choice transactions.
Foreign or changed schema/files are refused without repair. POSIX deployment
requires owner-only directory0700/file0600 and stable single-link file identity;
Windows deployment retains the existing private host ACL requirement. Preserve
the database with its WAL/SHM companions during maintenance. Deleting/recreating
the store changes its identity and invalidates old capabilities. It is metadata,
not a funding/custody database or a replacement for original evidence.

HMAC keys derive from the existing strong `JWT_SECRET` using a separate HKDF
purpose. Tokens bind the store UUID, deployment origin/network, original content
digest, run ID, captured observations, issue time and 30-day expiry. Key rotation
invalidates old tokens. Token validation precedes body, metadata and original-run
access; the current retained original must still match. No API key, session,
wallet claim, URL token or public-ID lookup substitutes for this capability.
The journal records the opinion, private reason, original observations and their
run/content linkage; it does not automatically copy credentials or original
question/answer/payment tuples. User-supplied reasons remain private text.

## Surface contracts

| Surface | Delivery and action |
| --- | --- |
| Ordinary web | `private-requester-observations` after the public `done` event; at most20 original packets in memory, never saved with turns. Explicit form uses `/api/research-feedback`. |
| OpenAI-compatible API | Optional `keryx_private_requester` beside the public JSON result or final SSE chunk before `[DONE]`; never inside `choices` or public `keryx`. |
| Remote MCP | Separate private content and `_meta["keryx/privateRequesterObservations"]`; public structured research result is unchanged. |
| stdio MCP sponsored research | Private packet captured only from a matching complete terminal API response; separate content/meta. `research_feedback_read` and `research_feedback_submit` use the original bearer and never execute research. |
| Desktop/CLI using the shared client | Public result remains unchanged; callers without the optional private callback ignore the packet. Existing original paid-result recovery remains authoritative. |
| Extension and bots | Existing research/API handoff roles remain; packets are not added to bot/public responses. No new background feedback or automatic opinion. |
| Private, prepaid A2A, failed planning | No new feedback capability. Existing private ownership and prepaid deliverable-acceptance contracts remain authoritative. |

Clients must not place capabilities in URLs, cookies, browser storage, analytics,
QueryRun, traces or exports. Requests use a fixed origin endpoint, explicit bearer,
no credentials/referrer/redirects, bounded JSON and no automatic retries. HTTP
responses are private/no-store/no-referrer/noindex. MCP validation errors cannot
echo supplied credentials. OpenAPI documents the distinct bearer and closed
read/submit operations; observation metadata grants no broader authority.

## Cost and duration limits

Duration is the run's recorded orchestrator completion time, not time to first
token or full browser latency. Model costs reuse captured per-call price policies
and recorded usage, including lower/upper cache bounds. Failed/pending calls,
missing usage and unpriced records stay explicit. Missing figures are null;
search, infrastructure, gas and unrecorded provider charges are excluded. These
are partial estimates, not invoices, total operating cost or profit. The original
observation snapshot is bound to the feedback capability and retained with the
opinion instead of silently recomputing later prices.

## Validation boundary

Synthetic original runs exercise authentication, content/store/origin/network
binding, expiry, no-opinion reads, idempotency/conflicts, restart, foreign-file
refusal and cross-process first-choice races. Shared sponsored-client tests cover
terminal completion, wrong/truncated packets and failing optional callbacks.
Real Chromium uses the actual form and production CSS for explicit submission,
private transport, response-loss readback, wrong-run refusal and narrow layout.
Required full CI/platform gates and deployed configuration/readback remain
release acceptance. Synthetic feedback is not user usefulness evidence, verified
human identity, a response rate, demand, measured savings or profitability.
