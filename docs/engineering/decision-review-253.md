# Identity-bound decisions and review-first research

Issue253 source candidate, 2026-10-09, initially based on `4c633958`. This is an implementation
candidate, not deployed payment authority or evidence of independent agreement.
The explicit local workflow pilot applies to this sibling worktree.

Keep each new decision's model proposal and the actual code outcome in a separate
ordinary-store record. Bind its run, round, ordinal, exact asset/version, configured
network, current payee and integer micro-USDC terms. Existing originals, portable
receipts, payment journals and old decisions stay unchanged; missing history stays
unavailable. Human hold, decline and expiry are not deterministic code refusals.

Interactive review-first is limited to the same authenticated browser owner and
live ask stream. Both initial and re-evaluation paths must await a decision before
funding or gateway effects. Selected owned cached/free reads also need approval
because they can expose later citation rewards. Approval is an expiring, single-use
admission, not a payment signature or a new budget. Recheck current terms, grant,
caps and cancellation after it; use the normal gateway. A disconnected/restarted
run cannot resume from a stored verdict. Other execution adapters explicitly
refuse this mode before provider or payment effects until they support interactive
continuation. Opinion/read contracts remain reusable across supported readers.

Store bounded optional reasons and verified reviewer identity privately. Verdict
retries are idempotent, acknowledgements can be read back, and a post-settlement
Disagree never refunds or retries a purchase. Public whole-period aggregates expose
counts/rates and machine refusal reasons only, split outside/team/scripted/unknown.
Unknown actor classification stays unknown; client labels or wallet absence cannot
attest outside use or a unique human. Zero verdicts give a null agreement rate.

Acceptance requires real ordinary SQLite concurrency/idempotency fixtures; owner,
origin, expiry, duplicate, disconnect and changed-terms cases; both purchase paths
and cached reward paths proven effect-free before approval; existing receipt and
co-sign compatibility; browser owner/readiness checks; both TypeScript graphs,
lint, default Next production build, independent exact-head review and applicable
hosted CI. Supabase DDL application, sealed/native enrollment, funded live checks,
all distribution versions and production activation remain separate gates. No
new funding, signing authority, retry, refund, scheduler or outbound notice is
authorized by this source task. The full issue stays open until its full gates pass.

## Captured and human authority

The immutable input records engine/requested model/policy version, model action
(or unavailable), initial code action/rule, asset/item version, network, access
payee, offer identity, claim-policy digest, actual access price, list ceiling and
citation pool cap. Amounts are exact safe integer micro-USDC strings; malformed
negative, scientific, sub-micro or unsafe amounts refuse. CACHE access is zero
even if its list price is positive. The pool is a maximum possible allocation,
not a promised reward. Existing traces explain decisions; this sidecar does not
claim to preserve every model token or reconstruct a historical response.
Ambiguous external proposals have an unavailable model action; internal proposals
bind the exact asset selected by normalization.

Bounded capture fields and private reasons use UTF-16 code-unit limits in both
shared schemas and PostgreSQL. Non-BMP scalars count as two units; malformed lone
surrogates refuse before JS persistence. Stored reasons retain canonical trimmed
text, with no silent replacement or PostgreSQL code-point allowance.

Last-mile code refusals update a separate projection while the immutable input
stays intact. A source that changes terms/version/rights while awaiting review
becomes a terminal per-source SKIP and cannot consume approval or earn a reward;
other valid evidence can complete the answer. Owner/grant revocation, disconnect
and global authority failures remain terminal. Human waiting/decline/expiry is
separate from code refusal. Original reports record actual reads; no sidecar
changes an original receipt, payment journal or settlement evidence.

Each selected owned request starts its 60-second deadline only when activated on
the original live stream. Later queued selections have no accepted authority or
deadline until their own activation. Activation cannot be repeated or extended.
The ask route's existing 120-second execution limit is unchanged; several reviews
can exhaust the overall host limit. This is bounded interactive execution, not
background research. A restart cannot recreate its broker. Explicit owner GET
readback closes past held/approved crash remnants for later nonfinancial opinions.

Agree is consumed once after current SIWE/grant readback, awaited source term,
claim, item-version and rights refresh, a second authority readback, exact term
equality and cancellation checks. Owner, original web-session hash, grant epoch,
signer, session ID, cap and expiry stay bound; invalid spent amounts refuse.
Legitimate prior spend does not renew the request budget. The normal gateway still
performs atomic per-payment reservation and signature checks. Review precedes
initial/second-pass funding and reward-eligible CACHE/free reads; a request boundary
also fences reward-only funding after disconnection. Opinion never restarts a run.

## Readers and measurement

`GET /api/me/decision-reviews?runId=UUID` and `POST /api/me/decision-reviews` require
the current SIWE cookie owner plus `X-Keryx-Expected-Wallet` precondition, which
cannot select another owner. Writes require exact configured Origin and, when
present, `Sec-Fetch-Site: same-origin`. Reasons/source names stay private. Replies
are private/no-store, vary on Cookie and expected wallet, and suppress referrers
and indexing. Bearer/API keys cannot access this sidecar. Gate writes require the
original same-wallet **and same-web-session** live continuation.

An owner/key/intent retry returns the current record; conflicting key reuse
refuses. Gate votes concern immutable initial offered code/terms. Later opinion
requests require `expectedCode: {action, rule}` equal to the displayed current
projection inside the storage transaction; stale snapshots refuse. Each verdict
retains its actual code basis, so later projection changes never rewrite a vote.
The browser retains lost-ACK keys/bodies for explicit exact retry/readback, aborts
and discards old-owner responses after an owner switch, and updates elapsed waiting
state. An explicit changed-snapshot readback can clear an unconfirmed opinion
attempt without claiming that its earlier write succeeded or sending a new vote.

`/decision-reviews` and `GET /api/decision-reviews/metrics?since=...&until=...` expose
whole counts on the configured network. Windows are canonical complete UTC days,
start included/end excluded, at most 366 days and no future end. The rate uses the
latest recorded verdict per decision: gate basis is initial code/terms; opinion
basis is the displayed code at voting. These are not unique people, useful answers,
factual accuracy, customer acceptance or settlement. Zero verdicts give null rate.
Code-refusal counts exclude model SKIP and human hold/decline/expiry.

Configured development wallets are team, authenticated bot activity is scripted,
and other captured identities stay unknown. The web route creates no outside
classification. Storage requires trusted cohort evidence for non-unknown cohorts;
client labels and anonymous feedback do not attest outside use. Public aggregates
expose no question, wallet, run/item ID, source name or private reason. Ordinary
SQLite may initialize additive tables on first access; sealed/native stores remain
closed. Missing captures are unavailable, not reconstructed or zero agreement.

## Surface and storage contract

| Surface | Source behavior |
| --- | --- |
| Funded authenticated browser/live SSE | Review-first checkbox, typed private events, exact retry/readback, before-effect admission |
| Archived web report | Explicit owner-only load and opinion; no continuation or reconstruction |
| Public web/API | Whole aggregate counts only; no private rows |
| Direct ask API | Owner, grant/protocol, configured Origin and ready ordinary capability before provider admission |
| A2A queued/paid and OpenAI-compatible API | Review-first intent/aliases refuse before provider/payment admission |
| Remote/stdio MCP | Input schemas refuse interactive review intent; no private verdict tool |
| CLI/headless browser | Reserved review flags refuse before execution; no automatic approval |
| Desktop/public/private/monthly buyer | Closed request schemas refuse review fields before signing/queuing/native writing |
| Telegram/Slack/Discord | Parsers refuse review flags/fields/options before research; help states the browser role |
| Extension | No interactive broker/control; supplied server review intent cannot fall back to a noninteractive treasury run |
| Sealed/native stores | Ordinary optional capability absent; review-first refuses before providers |

Shared contracts live in `lib/research/decision-review-types.ts`, with additive
OpenAPI paths. Ordinary Supabase uses service-role-only security-invoker RPC0086;
there is no REST repair/fallback or native activation. Its readiness probe must
succeed before review-first creates model/gateway dependencies. Normal research
can continue without optional captures when unavailable, without claiming reviews.

## Checks and remaining gates

Synthetic fixtures use real SQLite plus the live broker for both BUY paths,
zero-access CACHE and citation-only free rewards, decline, stale source terms,
funding uncertainty, foreign sessions, revocation during awaited refresh, expiry,
consumed duplicates, disconnect/restart and immutable originals. Browser fixtures
inspect actual components at 320/1366 pixels, including exact lost-ACK retry and
delivered old-owner refusal. They are not customer or funded-live evidence.

`npm run test:decision-reviews:postgres` uses an owned network-none PostgreSQL17
container in CI, or explicit `--psql-bin ABSOLUTE_BIN --port LOCAL_PORT --cluster-dir
ABSOLUTE_DATA_DIRECTORY` against a verified synthetic loopback cluster. It strips
PG credentials, checks data-directory/server identity before DDL, creates/drops
only a unique synthetic database, and tests actual0086 owner/role/strict input,
concurrent CAS, deadline, replay, opinion snapshot, individual cancellation and
sealed refusal. Presence of either native marker refuses migration and runtime
operations even when empty or enrollment-invalid, without reading marker rows.
Non-BMP boundary fixtures prove shared-schema-compatible capture/reason storage.
A 1,201-decision whole cohort matches SQLite without row sampling.
Failed prior SQL/fixture evidence remains retained, including the real metrics
alias correction; changed source requires new proof.

`npm run test:decision-reviews:built` requires a default production build and
explicit offline/testnet inputs. An isolated cwd/SQLite store and synthetic cookie
sessions exercise actual owner/Origin/privacy/readback/closed-gate routes, public
counts and authenticated explicit archived DOM at 320/390/768/1366 pixels. Cleanup
requires observed child exit. It creates no grant/payment signature/provider call
or settlement and cannot certify a funded production review.

Final qualification still requires source-bound focused results, both TypeScript
graphs, lint, literal-copy guard, actual 48-case study write/check at the changed
reachable graph, default build, built fixture, independent exact-head review and
hosted applicable aggregate success. Deployed DB/adapter readiness, funded live
browser evidence, independently attested outside verdicts, coordinated package/
installer publication and production activation remain separate open gates. No
full issue closure or synchronized deployed delivery follows from source checks.
