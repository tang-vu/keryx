# ETHOnline 2026 — Keryx continuity build log

Event window: September 4–16, 2026. Baseline: `5e83d45` (September 2), the
repository HEAD inspected on September 5 before any ETHOnline work. This log does
not assert that a track selection or submission has been completed in ETHGlobal.

## September 8 — Quote-selection diagnostics

Publisher onboarding preparation: the read-only `build-engineering-feed.mts --check-remote`
preflight confirms both published full articles exactly match the checked local feed.
Registration remains pending a publisher-controlled wallet, signed session and registry
transaction; API preparation alone is not registration. No owner wallet was inferred
from the separate buyer pilot, and no source or payment was created by this check.

v0.22.9 extends evaluation to five boundary cases and fixes two reproduced failures:
misnumbered research targets and rejection of explicit negative answers. All five cases
passed on the follow-up model run, including zero coverage for all missing-information
cases. The 18-pair reviewer comparison still observed one false negative with the current
prompt, so reliability work continues. 35 focused tests and TypeScript passed; no paid
job, registration or settlement was performed for this update.

v0.22.8 follow-up: calibrated relevance review to state the supported fact before
scoring action/actor/timing. A repeated 15-pair model comparison observed four false
negatives with the old prompt and none with the candidate, with zero observed false
positives in either group. One full-corpus check reached 0.8/0.9 on both questions.
35 focused tests and TypeScript passed. This is model-only first-party evaluation,
not paid-pilot success or external traction; see the dated evaluation for limitations.

September 8 follow-up tooling: `scripts/eval-quote-selection.mts` reproduces the
journaling citation failure with an offline quote-availability check and an opt-in,
six-run live comparison. Both baseline and evidence-first prompts still produced
inconsistent coverage. Original versus reviewed scores isolate a reviewer false-negative
alongside the prior selection problem. No experimental prompt was deployed. Detailed
results and reproduction instructions are in `docs/engineering/`.

## Existing before the event

Citation-toll research, browser co-signing, SourceRegistry payout authority, encrypted
paid content, evidence-gated creator rewards, paid A2A v2, durable async jobs, operator
recovery, Quick/Deep package v1 and portable/service receipts already existed.
See `PLAN.md` for historical context and `docs/a2a-paid-research-v2.md` for the
existing economic contract. None of these is claimed as new ETHOnline work.

## September 8 — Relevant evidence passages (v0.22.4)

### Scoped coverage and relevance review (v0.22.7)

- Give coverage a question-scoped rubric, validate links to actual gathered text, and
  derive sufficiency from the existing threshold rather than a contradictory model flag.
- Add one bounded question/quote relevance review inside JSON synthesis. Support can
  only decrease; unavailable review preserves the draft with rewards withheld and a
  visible trace. Payment limits and the original evidence ledger remain unchanged.
- Live evidence-removal control scored both recovery targets zero. On complete articles,
  the reviewer correctly rejected the observed resume/journaling mismatch. Final coverage
  was 0.8/0.9 and 0/0.7: still a partial, first-party model evaluation, not a paid pilot.
- Validation: 178 focused agent/model tests across the final suite and added trace case,
  TypeScript and six hermetic evaluation cases passed. An earlier local circuit-store
  timeout passed on focused rerun and the subsequent complete focused suite.

### Bounded quote selection (v0.22.6)

- Replace free-form quote copying in JSON synthesis with selection from bounded verbatim
  quote options derived from already-unlocked passages. Invalid IDs/source mismatches
  remain rejected by the unchanged evidence ledger; no quote is automatically shortened.
- Two live corpus questions, four DeepSeek calls: no fallback and no dropped evidence.
  Final target coverage was 1/0.6 and 0.3/0.6, so quality remains partial. This is a model
  evaluation on first-party documents, not a registered creator or paid end-to-end pilot.
- Validation: 163 focused agent/model tests, TypeScript and six hermetic evaluation cases
  passed. Options preserve exact original spans and bounded text, including Unicode and
  gaps; invalid selections cannot substitute model-written text or another source.

### Bounded JSON and overlapping evidence (v0.22.5)

- Configure DeepSeek V4 JSON steps explicitly as non-thinking, with provider-specific
  scoping, unchanged token ceilings, usage accounting and truncation fallback.
- Allow overlapping evidence windows and merge them as exact original substrings.
  This recovers GET-only resume instructions previously excluded by the overlap rule;
  the source-context budget remains at most 2,000 raw characters.
- Strengthen short, claim-specific quotation guidance; the deterministic evidence gate
  remains unchanged. The final live corpus check served all four steps on DeepSeek without
  fallback and recovered the correct resume answer/quote. An overlong reward quote was
  still rejected and coverage remained partial. No new paid job was run.
- Validation covers vendor-option isolation, preserved token caps/truncation handling,
  and the actual missed recovery passage in the checked-in first-party corpus.
  All 160 focused agent/model tests, TypeScript and six hermetic evaluation cases passed.

### First-party source material follow-up

- Added `docs/engineering/`: two complete, code-referenced Keryx articles, a generated
  public RSS feed and a publisher onboarding guide. The feed builder verifies exact
  full-body ingestion and CI refuses a stale generated feed.
- This documentation kit is not registered as a creator source and assigns no wallet.
  Its articles are openly available; no exclusive-content or external-creator claim is made.
- Live model evaluation produced partial answers. DeepSeek hit output ceilings and
  MiMo fallback served the requests. One overlong quote was rejected; another exact
  quote passed the ledger despite not directly explaining the requested recovery behavior.
  See `docs/engineering/evaluation-2026-09-08.md`; model coverage is not independent quality proof.
- No paid job, source registration, fund movement or application-runtime change was made.

- Investigation found full RSS bodies were already retained when supplied by a feed, but
  model stages received only the first 800/1,000/2,000 characters. Select bounded verbatim
  passages from already-unlocked content and share them across assessment and synthesis.
  Include delivery depth and omitted-content metadata in reasoning context.
- The selector scans at most 200,000 characters and sends at most 2,000 raw source-text
  characters per source. Lexical selection is not comprehensive semantic retrieval.
  Original-source exact-quote validation and all payment gates remain unchanged.
- Validation: 153 agent/model tests, TypeScript and six hermetic evaluation cases passed.
  Regression tests cover late evidence, separate targets, exact original spans, context
  consistency, abstract provenance and scan/output bounds.
- A three-call live DeepSeek v4 Flash check used an authored fictional protocol with two
  unique facts after character 2,000. The opening-only control scored both targets zero;
  selected passages scored both fully covered and produced exact supporting quotes.
  This is a synthetic model evaluation, not an external research result or payment.
- No additional paid pilot was run for this update. The previous pilot's 327-byte abstract
  cannot gain missing details through passage selection; deeper source material and a
  sufficiently supported real research outcome remain outstanding.

## September 7 — Second pilot and decision-target repair (v0.22.3)

- Ran one more owner-operated Quick purchase for 0.05 USDC testnet on v0.22.2, with an
  explicit question about Keryx access tolls and citation contribution weights. Deposit
  receipts succeeded; the seller returned a Circle transfer reference and the buyer
  verified the completed job's receipt integrity and request binding.
- Planning stayed on topic, but all positive source proposals lacked usable research-target
  indexes. The preview gate blocked them. The job ended in 35.279 seconds with measured
  zero coverage, zero creator payments and 0.03 unused reserve under the existing fixed-price
  terms. This was not a successful research pilot or independent customer demand.
- Added explicit indexed targets and BUY/CACHE target requirements to the decision prompt.
  Missing/invalid target links now fail the model step for bounded retry/fallback before
  source spend. Intentional SKIP and all deterministic spend/evidence gates are preserved.
- Live DeepSeek v4 Flash completed the frozen x402-with-distractor evaluation: relevant source
  read and cited, unrelated gardening source skipped, 50% grounded targets and low confidence.
  The evaluation used an isolated database and OfflineGateway: all payment amounts were
  simulated, and its passing score is not evidence of a settled creator payout.
- Validation: 54 focused model/orchestrator/preview tests, TypeScript and focused lint passed.
  Regression cases reject missing, empty, string, negative, fractional and out-of-range target
  indexes for BUY/CACHE and exercise successful fallback; intentional SKIP stays valid.

### Post-deploy validation at `0aadd53`

- Full CI and production health passed. The same explicit Keryx question now selected two
  cached sources with valid target indexes. The agent correctly declined a Keryx-specific
  answer because those sources did not document Keryx. No creator reward was issued.
- One final 0.05-USDC Quick request asked about the HTTP 402/x402 access flow covered by
  the available corpus. It completed in 55.925 seconds with a cited answer and one
  0.015-USDC citation reward to the curated Agent Economy Weekly seed source. Access was
  cached, so there was no new content-access toll. The unused reserve was 0.015 USDC.
- The complete receipt ledger reports the reward settled with no pending creator amount.
  A separate read from Circle matched its transfer ID, recipient, Arc network and 15,000
  micro-USDC amount. Circle reported `received` with no batch transaction hash at inspection;
  this is accepted Gateway transfer evidence, not proof of completed on-chain batch finality.
- Receipt integrity and request binding passed. Final coverage was 0.3, 0.3 and 0 for the
  three research targets: none met the grounding threshold, so grounded-claim rate was 0%
  and confidence remained Low despite qualifying excerpts/citation reward. The payout path
  is demonstrated; a sufficiently supported research outcome still needs work.
- These are owner-operated tests against curated seed content, not independent customer
  demand. Three additional jobs in this continuation cost 0.15 testnet USDC in package
  charges plus deposit/approval gas (four total pilots, 0.20 USDC in package charges).
  Private job IDs, journals and credentials remain excluded from Git.

## September 7 — Owner-operated pilot and research-quality follow-up (v0.22.2)

- A separate owner-controlled EOA funded through the Arc testnet faucet deposited 0.05
  USDC and made one Quick purchase. Approval/deposit receipts succeeded, Circle Gateway
  available balance moved from 0.05 to zero after purchase, and the seller relayed a Circle
  transfer reference. GET-only recovery retrieved the job and verified receipt integrity
  and request binding. Private job journals are excluded from this public log.
- The job completed in 52.656 seconds but produced no supported answer or creator payments.
  Its planner interpreted the ambiguous question as patent-citation settlement and the
  preview gate rejected every source. The unused 0.03 creator reserve is part of the
  non-refundable package, not a refund. This is internal validation, not customer traction.
- Changed planning to research questions with scope/ambiguity guidance and validated
  provider output. Empty evidence now records zero support; pending and settled source
  payments keep distinct explanations. The buyer workspace makes zero/unknown quality visible.
- A bounded live DeepSeek v4 Flash planning check kept the citation-payment question in
  Keryx context and preserved explicit patent and gardening questions. This checks planning
  only, not a second paid end-to-end pilot or a guarantee against interpretation errors.
- Validation: 131 focused LLM/orchestrator/A2A/buyer tests, TypeScript, focused lint and
  production build passed. Mobile browser checks with intercepted fixtures confirmed distinct
  zero-support and unavailable-quality messages and no paid POST.

## September 5 — Buyer workspace (v0.21.0)

- Added `/research`: server-priced Quick/Deep packages using the same quote function as
  the paid endpoint; exact six-decimal creator-cap validation; visible fee, cap, total,
  package version, network, payee and non-refundable provisional service terms.
- Added copyable async request JSON for an external funded x402 client. This surface
  does not sign, fund a wallet, submit paid requests, or start research.
- Added explicit job-ID lookup using the existing endpoint: bounded sequential polling,
  cancellation on switch/unmount, terminal/review stop, manual refresh and clear.
- Added answer, claim evidence, measured quality/latency, settled/pending creator amounts,
  unknown/incomplete accounting and a portable receipt link. A receipt link is not an
  independent receipt-verification result.
- Job IDs remain bearer access to the existing API. The workspace stores them only in
  component memory, never localStorage or page query parameters; it adds no job directory.
- Validation: 29 focused workspace/existing A2A tests passed; TypeScript and lint passed;
  production build passed. Browser smoke checks use explicit intercepted test fixtures
  for queued/completed and failed jobs, pending/unknown amounts, terminal polling stop,
  memory clearing, invalid caps and mobile overflow. No paid POST is made by these checks.

## Release dependency follow-up

Release follow-up: the first CI run passed functional tests but its unchanged dependency
tree failed the high-severity audit gate. Pin transitive `toml` to 4.3.0, retaining
Anchor's CommonJS `parse(Buffer)` contract, and refresh compatible `fast-uri`/`qs`
versions. Add parser compatibility and pollution/depth regression checks. The audit
gate remains enabled; this dependency remediation is part of the release validation.

Advisories: https://github.com/advisories/GHSA-v5mp-jgw5-2x6j,
https://github.com/advisories/GHSA-82x6-q7mm-w9cf,
https://github.com/advisories/GHSA-f65p-4m7j-42xc.

## September 7 — Independent buyer client (v0.22.0)

Added `npm run buyer -- quote|buy|resume`, with caller-provided key/payee/price cap,
exclusive pre-submission journals, GET-only recovery, seller-relayed payment evidence
retained independently of delivery, and receipt integrity/request binding checks.
The workspace now downloads request JSON and links to `docs/buyer-agent.md`.
Fault-injection tests use a deterministic unfunded signer and mocked HTTP; they are
not settled transactions or external demand. Live paid pilot validation still requires
an independently funded buyer and is not claimed by these tests.

The unsigned client was also checked against production: the Quick request with a
0.03-USDC creator cap returned a 0.05-USDC total challenge, accepted without signing
or paying. This validates live challenge compatibility, not paid delivery.
An all-in limit below that quote was refused before signing. Local validation passed:
31 focused buyer/order/receipt tests, TypeScript, focused lint, production build and
a browser check of the exact request download on mobile. Production dependency audit
had zero high/critical findings; low/moderate transitive findings remain.

Post-review patch v0.22.1 makes receipt archival atomic: re-download repairs a partial
same-digest file without overwriting older receipt versions or submitting a payment.
The fault test corrupts the local archive and verifies recovery via GET requests only.

## Next deliverables

A [three-minute rehearsal script and architecture diagram](./ethonline-demo.md) now
cover request preparation, buyer recovery, evidence and settlement reporting. This is
a recording plan, not a completed video; the new full-corpus paid scene remains pending
publisher onboarding and verification. Existing failed pilots must retain their actual results.

1. Validate the new buyer client with an independently funded testnet pilot, including
   reconnecting to an existing paid job. The old self-funded demo client is not independent demand.
2. Pilot onboarding and repeat usage from 3–5 external teams (target, not achieved traction).
3. Before/after demo, architecture diagram, integration guide and submission by September 16.
4. Separate mainnet-readiness assessment for September 30. No mainnet enablement or real
   funds are authorized by this hackathon plan.

## Prize and eligibility notes

The Arc page checked September 5 lists Continuity prizes of $1,666 for Best DeFi or
Agentic Application and $1,500 for Launch on Arc Testnet & Push to Mainnet. The latter
says deployed or deployment-ready by September 30. Confirm eligibility for a project
already using Arc, the meaning of deployment-ready, deadline time zone and track
selection with organizers. These are unresolved questions, not assumed qualifications.

Source: https://ethglobal.com/events/ethonline2026/prizes/arc

The Lepton rubric, volume goals and submission form in `docs/hackathon-playbook.md`
are historical and do not govern this event. Report externally initiated use separately
from internal drivers; report testnet settlement separately from mainnet revenue.
