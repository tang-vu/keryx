# Source-selection validation and failure diagnostics

The closed ordinary-Chrome round on v0.26.17 / `8cc6b90a` passed planning for the
SQLite question but stopped before original reads with an invalid target-link
selection. The retained UI reports eight targets, two supplied SQLite URLs and
ten public leads. Neither the target text nor the provider's decision payload
was retained. Missing, empty, wrong-type and out-of-range targets are therefore
historical hypotheses, not established causes. See [#172](https://github.com/tang-vu/keryx/issues/172).

The full new round remains **0/3 useful, 1/3 completed report**: Next.js failed
at its first model call, systemd produced a Low excerpt-only report, and SQLite
failed at selection. The conservative held-attempt ceiling was **$0.217940**,
not an invoice. All three submissions and failed/unknown holds remain closed.
Q1/Q3 have no completed research or complete payment receipt. This repair does
not revise those originals or establish a successful live retest.

## Decision contract

The selector receives the unchanged question, indexed research targets, an
explicit allowed-index list and exact candidate IDs. Examples distinguish free
public-page read proposals from cache hits and verified evidence. A supplied
original can be proposed for predicted relevance while its contents are still
unknown; it is neither forced into a read nor certified by its preview.

Validation checks an actionable proposal's whole target list. It never supplies
a missing link, converts string/one-based indexes, or filters an invalid list
into a valid subset. A malformed proposal for an exact known candidate becomes
an explicit validator-withheld SKIP with zero expected value/confidence and no
targets. Every duplicate group for a candidate is withheld rather than choosing
one of its conflicting proposals. Independently valid distinct-candidate rows
can continue through the existing preview, portfolio, source, budget and payment
gates. The research plan is retained in full and unsupported targets stay gaps.

A genuine all-SKIP response remains a valid frugal choice. If invalid proposals
leave no valid actionable selection, or no response rows name an input
candidate, the request ends with `ResearchSelectionError` /
`research_source_selection_invalid`. Malformed/truncated completed output is
classified separately from an empty decision list. These are terminal local
contract refusals: no paid retry/tier, heuristic substitute, circuit failure,
success/reset or hidden completed report. Transport/input-limit handling keeps
its existing categories. Completed supplier call/token records remain retained;
rejected application output does not establish zero compute cost.

## Inspectable evidence

`keryx-source-selection-v1` diagnostics contain an opaque local UUID, timestamp,
stage/outcome, bounded counts and up to sixteen allowlisted reason/index records.
They omit question text, provider values/bodies, source identities/URLs, wallet
data and credentials. A browser-safe parser explicitly copies allowed fields
and rejects invalid types, bounds, IDs, times and accessors. Metadata is a
validator observation, not evidence of source relevance or financial settlement.

Mixed selections retain diagnostics in the completed run's trace and fixed
withheld-source rationales in decisions/receipts. Terminal selections emit a
trace refusal and caller error without saving an empty `QueryRun` as a completed
answer. Web/chat and embed offer an explicit **Download failure diagnostic** JSON
file. It is a caller-local artifact, labeled as a failure rather than a report
or payment receipt; download does not resubmit the question. No server failure
database or automatic browser-history retention is introduced. Retention across
browser closure requires the caller to save the artifact.

The OpenAI-compatible non-streaming API returns HTTP 422 with the code and
`error.selectionDiagnostic`; a started stream retains HTTP 200, error text and
`keryx_error` metadata, without completion metadata/`[DONE]`. Remote MCP retains
`isError` and adds diagnostic JSON as text, without a successful structured
result. The buyer CLI exits one and writes refusal guidance and diagnostic JSON
to stderr.

## Validation and release gates

The offline fixture uses the exact frozen SQLite question/hash with eight
**representative** qualified targets and synthetic provider/page responses.
Its targets and response are not a replay of missing historical payloads.
Tests must show that both exact originals reach actual reader adapters when
their proposals are valid, invalid distractor rows never read/pay, all-invalid
selection preserves token usage and stops before reads/payments, and the frozen
question/plan remain intact. Duplicate/unknown/malformed rows, immutable bounded
diagnostics, caller surfaces and real React/hook/Chromium downloads are gates.

The change uses shared research on web/API/remote MCP and their bots/adapters.
Desktop/Operator, stdio buyer MCP and extensions keep their existing task,
custody and reader roles. A2A/private failures retain their existing failed-order
and payment-history behavior; a diagnostic never converts them into completion.
No new financial/storage schema, funding, schedules or custody is required.
Distribution identities and deployed commit require separate readback.

The candidate also integrates separately merged [PR #173](https://github.com/tang-vu/keryx/pull/173),
which bounds daily sponsorship, expires paid cache reads, excludes the asking
wallet's sources from sponsored runs and retains dispatches after observed
creator payments. Its planning/context/attention/search expansion trial was
withdrawn. This source-selection repair preserves those accepted behaviors;
the combined runtime requires its own CI/review and deployed-source verification.
Separately merged PR #176 withdraws per-payer cache keys because the enrolled
store never evicts, reuses fresh cache during gap expansion, corrects unread
reservation release and counts IPv6 callers by /64. The candidate retains those
corrections; the cache remains shared within its existing reuse window.

Combined review found two payment-boundary gaps in that update. Sponsored source
exclusion now uses current registry toll/citation recipients, with DB author
fallback only without registry citation authority. A trusted per-payment denied
recipient travels through fetch, gap expansion and citation adapters; resolved
payees, challenges and signed payloads are checked before authorization/admission
or paid submission. Browser-funded self-payment retains its existing consent.

The web route retains a dispatch from the trusted pre-gateway payment boundary,
before ledger/cache persistence can suspend. This conservative retention is not
settlement evidence. Browser signing still cancels on disconnect, and subsequent
creator payment boundaries refuse new attempts; pending receipts remain pending.
Early cancellation before a boundary does not create a completed dispatch.
Shared agent/adapters cover web/API/MCP/CLI/bots; disconnect retention specifically
belongs to the web SSE connection, including embed. Custody, spend limits, nonce
authority, source-owned payout authority and schema remain unchanged.

The combined candidate also retains separately merged PR #175's shared five-minute
Google authentication continuation fix. Application version advances to 0.26.20
without changing its vendor/storage authentication policy. Its separate deployment
must restore before this release starts its own serialized maintenance.

Local candidate validation passed 218 focused tests across selection/parser,
resilience, orchestrator and caller surfaces; both TypeScript graphs, production
build and lint passed (five existing warnings). The complete hermetic research
browser suite passed, including actual hook/React failure downloads at 320/1366
pixels, without model/search/payment calls. Stdio's 31 canonical Git runtime
inputs and Operator helper's 46, renderer and bridge inputs remain unchanged
against `2a2ba75e`; renderer/bridge graph inspection externalized Tauri package
imports. Exact committed-head CI/review, deployment and public package/installer
readback remain release gates.

After integrating PR #173, 196 focused agent/cache/admission/economics/surface
tests and both TypeScript graphs plus a fresh production build passed. Three
former CI expectations of selection fallback were replaced with terminal
refusal/usage checks while preserving generic non-selection fallback coverage;
the additional two-file set passed 33 tests. The original failing CI evidence
remains retained rather than being reclassified as a passing run.

Useful supported comparisons/checklists, actual ordinary-client exports,
independent legitimate Arc settlement and user evidence remain open under
#172/#169/#128. #158's initial model-call failure also remains unexplained by
this source-selection repair. Richer synthesis stays disabled under D-300.
