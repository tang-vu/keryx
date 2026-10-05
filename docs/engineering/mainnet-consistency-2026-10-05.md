# Mainnet consistency and observed operations

The October 5 read-only audit observed production on Arc mainnet at `1101342e`,
with an operational datastore, idle A2A worker and zero recorded payments/payouts.
The unpaid `/api/research/monthly?quote=1` returned a mainnet quote successfully.
Earlier dated unavailable responses do not establish current unavailability;
a quote does not establish a completed purchase or redemption.

## Correction scope

Application 0.26.12, MCP 0.4.4 and desktop 0.4.5 are coordinated release candidates:

- Slack distinguishes planned rewards from verified settlement and stops claiming
  every cited creator was paid on-chain. Historical records receive no inferred network.
- Monthly tool metadata and owner-proof documentation follow the selected-profile
  contract without a testnet instruction. Actual signing authority is unchanged.
- External discovery compares advertised networks with the trusted deployment rail.
  Advertised compatibility never enables purchasing an external endpoint.
- New desktop tasks default to the public mainnet service's network; saved task
  networks and deliberate testnet choices retain their original identity.
- Creator claims retain the 24-hour ownership-control limit. The owner can inspect
  claim freshness and deliberately reopen verification; there is no automatic proof,
  policy opt-in, publication, renewal or new scheduler.
- `/api/health` adds the freshness of four retained monitoring summaries. `/status`
  describes service availability separately from those observations. Missing, invalid,
  future-dated or stale timestamps cannot become current successful checks.
- Supplied HTTP(S) URLs become bounded unread discovery leads even when search is
  unconfigured or omits them. Admit at most eight leads within the existing 24-candidate,
  two-per-publisher and read-attention limits. Refused and unselected leads have visible
  reasons. HTTPS/public-transport and evidence gates still govern actual reads; a fragment
  requests scope but does not establish section extraction or official authorship.
- Shared hosted results expose bounded recorded reasoning attempts and the source-selection
  engine/fallback state. Missing, malformed or truncated telemetry stays unknown; model
  serving in another step cannot certify model source selection. Remote MCP uses protocol
  identity 0.3.0 for this additive result, with no new signer or provider retries.
- SQLite authority guards compare the same trusted exact schema definitions in one native
  query on every operation. Stored SQL stays inside SQLite; no authority cache, DDL or
  observation deadline changes are introduced. Windows regression acceptance is separate.
- An empty settlement ledger records an explicitly labelled observation without asking
  Circle for balances. It is neither payment evidence nor a passed balance reconciliation.

Monitoring freshness uses two hours for hourly registry/dispatch/settlement records
and thirty minutes for reconciliation records. These are display/observation bounds,
not payment expiry or reservation-release rules. A recent check may have failed;
its detailed result remains separate. No vendor reads, writes, funding, signing,
settlement, notifications or scheduler activation occur in the health probe.

## Supported surfaces and release gates

Web/API receive additive monitoring observations and the creator recovery UI.
Remote and stdio MCP share Monthly metadata; the changed stdio bundle requires a
new package. Slack copy changes; Discord and Telegram retain their existing honest
settlement boundary. The OpenAI API and extension inherit hosted research without
gaining caller custody. Repository CLI retains its explicit network selection;
desktop's buyer handoff uses the saved task's network. A2A/private/Monthly payment
and entitlement authority, Supabase staging and Rust-domain cutover gates are unchanged.
Extension 0.1.1 retains its independent identity. Hosted OpenAI/API/A2A and stdio
forward additive reasoning metadata; archived receipts retain their original contracts.

## Local acceptance and independent review

Focused source/reader/context suites passed 218 tests; telemetry passed 15 tests
including actual in-memory remote MCP transport. Claim React journeys passed both
profiles at 390/1366px, including initial-clock and owner-change fences. Desktop UI
save/handoff checks and typechecking passed. Status React checks at both widths
distinguish missing/stale/recent observations and clear prior summaries after a failed
poll; every HTTP response in these browser checks was synthetic.

Issue #163 had two measured causes. Repeated schema guard work crossed the unchanged
five-second readiness lifetime. Native batching passed the funding inspection's 13
cases, including the original mutation case (5.125s overall versus 8.437s baseline),
plus native missing/drift/extra-definition refusal regressions. Funding ledger (22)
and browser-storage (18) cases passed. Four mainnet-storage cases that timed out
under an intermediate query all passed individually on the final query.

The browser fixture originally held a bounded quote request through the entire
concurrent answer. Its response arrived after the unchanged eight-second transport
deadline. Synchronize on actual confirmed spend while preserving the sampled stale
accounting response, then assert the completed answer outside that HTTP request.
Split cumulative grant/top-up and cashout/recovery into independent fresh fixtures;
all original cap reduction, one-consent, original-transfer and finality assertions
remain. Both passed on Windows within their original 120-second bounds (85.506s and
76.293s). No production deadline or freshness rule was relaxed.

Independent review found and corrected malformed credential-URL display and a legacy
Supabase ledger read that could mistake errors for emptiness. Both table reads now
must succeed with arrays; errors are sanitized, and enrolled identity refusals stay
typed. Focused Supabase tests passed 21 cases. Review cleared the final source,
telemetry, UI, native schema and empty-ledger paths. Full CI, packaged distribution
and live deployed-commit verification remain required.

Final application/operations TypeScript and lint passed (five existing warnings).
The production build passed after installing the locked dependency closure with
npm 11.19.0 in the isolated worktree; Turbopack rejects a dependency junction outside
its project root. Actual built HTML/PDF readers and minified empty-evidence branches
passed without network access. The unmodified packed MCP consumer passed on Windows
for both profiles, including synthetic SDK signing, response-loss barriers and keyless
GET-only recovery. An earlier initialization timeout was not reproduced; no deadline
was increased and its cause remains unproven.

The packaged desktop fixture selects the same explicit mainnet profile as a fresh
UI-created task, and asserts that persisted task identity before synthetic saved-result
recovery. Its prior unconfigured testnet buyer was correctly refused by the unchanged
network guard. Portable/installed acceptance on the final CI source remains required.
The manual MCP publishing workflow also verifies npm/official Registry identities,
reuses matching immutable versions and refuses unknown/conflicting/deleted state.
Its seven lightweight failure/recovery tests are part of CI; live publication stays
an independent release gate.

Source versions are not distribution or deployment proof. Required focused tests,
TypeScript, lint, production build, independent review, CI, exact-source packaged
desktop acceptance, npm/artifact readback and production health must precede a
claim of synchronized delivery. Installed clients are not assumed upgraded.

## Work that this release cannot establish

The financial-watchdog schedules remain deliberately held. An empty cron and absent
health summaries are not financial monitoring acceptance. Enabling new schedules
requires the owner's explicit scope; preserve original journals, reviewed roles and
held uncertain authorizations. Prepare and review selected-network one-shot checks,
their writes/alerts, cadence and failure response before scheduling them.

The latest ordinary production evaluation accepted 0/3 complete useful answers;
richer decision briefs remain disabled. Supplied-source admission and reasoning visibility
address issues #157 and #158 in part; they do not demonstrate recovered live usefulness
or resolve provider-circuit policy. This release adds no paid evaluation and
does not reopen closed model/search allowances or source USDC budgets.
Independent security review, live funded purchase/withdrawal/recovery acceptance,
off-host restore/capacity exercises and portable encrypted browser-custody recovery
remain separate gates. Local Windows regression evidence is tracked in issue #163;
immutable release staging and maintenance-duration acceptance are tracked in #164.
Historical testnet records and deliberately testnet-only scholarly rights retain
their actual profiles.
