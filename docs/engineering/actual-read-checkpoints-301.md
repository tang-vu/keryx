# Actual READ checkpoints — issue301, bounded milestone

This source milestone records the ordinary engine's post-portfolio admission
checkpoints. Issue301 remains open. The prospective `bounded-read-admission-v1`
helper, corpus and historical receipts remain unchanged.

The same pure evaluator drives execution and the captured outcome. Model proposal
and already-selected plan action remain separate inputs; this does not replay
proposal normalization, the portfolio optimizer, source truth, funding, signatures,
payment retries or citation allocation. Asynchronous source, rights, duplicate,
cache and human-review observations are explicitly **assertions**. Admission is
permission to proceed through the existing guards, never proof of a read or payment.

Coverage includes ordinary and reevaluation selection, duplicate/missing-source,
funding uncertainty, terms/rights refusal, public/free/cache/payment channel,
zero-budget, human-review escalation/verdict, sufficiency/assessment stops,
reevaluation entry, attention, engine recommendation and exact remaining-budget
comparison. Existing finite numeric operands and the existing 1e-9 tolerance are
replayed without replacing admission with rounded integer arithmetic. Exact
micro-USDC assertions are present only where the existing converter accepts them
without rounding; other monetary assertions are unavailable. Full issue301 integer
coverage remains open where the underlying policy lacks that authority.

Capture is bounded, best effort and ordinary-public only. Missing capabilities,
private job effects, original/native/sealed storage and collector failures cannot
change actions, effect order, payment arguments or answer delivery. Records contain
only run-local candidate numbers, finite policy labels/flags/operands and qualified
amounts: no question, rationale, model text, URLs, owner identifiers or source IDs.
The existing trace JSON carries the final packet; no schema, enrollment, fallback,
backfill or storage authority is added. Both ordinary adapters must prove exact
retention before default capture is accepted.

The report's Verify action uses local Web Crypto and a digest retained separately
from submitted sidecar JSON. A rewritten sidecar/hash pair cannot self-attest.
The mounted verifier binds its file, status and asynchronous attempt to the expected
capture identity and retained-digest prop. A new capture or unavailable/null capture
clears the selection and result; completion for an earlier report cannot show PASS
under the new report. Same-mounted browser checks exercise completed-result changes
and deferred real file-read/WebCrypto completion across new-digest and null props.
Unknown versions/fields, tampering, oversize, accessors and mutation fail closed.
Integrity and deterministic checkpoint agreement do not attest source facts or
payment anchoring (issue291).

Owned files: new pure policy/record/collector/projection and focused tests;
`run-agent.ts`, `types.ts`, `surface-result.ts`, `lib/research/public-query-run.ts`; report Verify component/dispatch;
offline audit CLI; adapter/browser/packaged-consumer checks; shared-contract
documentation/catalogue copy. The initially reviewed source checkpoint changed no
versions or study artifacts. The final combined release source coordinates the
identities and controlled-study binding documented below.

Acceptance: differential normal/reevaluation tests cover the runtime branches
listed below and preserve actions, payees, amounts, call counts and effect order
with absent, throwing or asynchronously rejected capture. Real SQLite and isolated Supabase transport exercise persisted
JSON. Browser/offline CLI reject forged inputs and use separately retained digests.
Audit web/API/CLI/remote/stdio/desktop/extension/bot projections and role boundaries.
Run app and ops TypeScript plus the default production build for the final source.
Root coordinates the build and combined distribution/release. No operational or
financial clearance is granted by this source milestone.

The current valid ordinary catalogue withholds the synthetic itemless zero-price
gateway source before post-portfolio reading. Its actual zero-budget fixture proves
selection SKIP and no funding/payment; it does not claim the later defensive
zero-budget gateway refusal ran. That evaluator has true/false pure vectors, and
ordinary paid fixtures exercise its false branch. A valid admitted runtime fixture
for its true branch remains a coverage gate; catalogue admission is not weakened
to manufacture one.

## Coverage ledger

The checkpoint is the finite predicate at its actual callsite, not a fabricated
replacement for the selection pass or the portfolio optimizer. Pure vectors cover
the finite predicates. Runtime differential fixtures execute ordinary admission with missing,
enabled and synchronously failing collection; rejected asynchronous observers also
make evidence unavailable without awaiting or escaping into execution.

| Predicate | Actual local runtime evidence | Remaining distinction |
| --- | --- | --- |
| Selection | Initial BUY/CACHE/SKIP, external-only rejection and zero-budget catalogue SKIP | External offers remain discovery-only; no external delivery is admitted. |
| Duplicate | Ordinary/reevaluation duplicate refusal and nonduplicate paid/free/cache paths | Canonical-identity and exact-body observations are assertions; they do not attest source truth. |
| Present / remaining budget | Ordinary presence; reevaluation missing-source, accepted purchase and budget refusal | Missing initial asset is defensive; tolerance/threshold/nonmicro cases additionally have pure vectors. |
| Funding / terms / rights | Unknown-funding refusal, ordinary/reevaluation terms and rights refusal, admitted paths | Existing recipient/registry/claim authority is preserved and is not replayed from source facts. |
| Human review | Ordinary/reevaluation escalation and admitted/source-changed/human-withheld verdicts | Review ownership and effect admission remain in the existing broker; records assert the observed verdict. |
| Public / creator-free / cache / BUY channel | Public reference routes, ordinary/reevaluation cache, ordinary creator-free and paid purchase | Separate public-route predicates handle public reads; no unused public flag is added to paid delivery. |
| Zero-budget gateway | Actual initial catalogue SKIP; paid gateway false branch | Defensive true gateway branch remains an admitted-runtime-fixture gate as stated above. |
| Sufficiency / expansion | Covered-answer and unavailable-assessment stops; initial and second-pass continuation | No model truth, prompt normalization or optimizer replay. |
| Attention / recommendation | Reevaluation attention stop, empty recommendation, explicit stop and accepted recommendation | Finite count/limit operands retain existing source semantics. |
| Discussion exclusion | Excluded discussion recommendation and nonexcluded reevaluation paths | Official-document scope stays authoritative; the model cannot promote a blocked forum source. |

The valid sidecar contains at most 256 checkpoints and 256 KiB of canonical JSON.
Sequence, candidate and round indices are bounded; duplicate/unknown fields,
unsupported versions, prototypes, symbols, accessors, sparse arrays, altered
outcomes and monetary inconsistency are refused. Overflow or capture failure
discards the whole packet. Finite rule names and OpenAPI grammar derive from the
same pure contract. A record supplied with its own newly computed hash cannot
establish agreement with the separate expected digest retained by the report.

## Supported surfaces and ownership

| Surface | Projection / role |
| --- | --- |
| Web SSE and dispatch | `run-agent.ts` attaches only the final ordinary packet to the existing done trace. `/api/ask` retains its stream and completed-run flow. `lib/research/public-query-run.ts` sanitizes checkpoint fields before removing any original marker; `dispatch-view.tsx` uses the shared pure projection and local Verify component. |
| Direct dispatch API | Existing public projection strips forged/future/private/original checkpoint fields without mutating retained trace or original receipt bytes. |
| A2A / API / OpenAI / remote MCP | `lib/research/surface-result.ts` shares the same bounded packet or explicit unavailable state through `lib/a2a/result.ts`, `lib/openai-compat.ts` and `lib/mcp/remote-server.ts`; OpenAPI includes the closed grammar. Existing ingress and financial roles stay independent. |
| Repository CLI | `scripts/ask.mts` reports availability and the separately retained digest. `research-audit verify-actual <packet-file> <retained-digest>` performs bounded offline verification without importing the agent or granting authority. Existing prospective-v1 commands/receipts remain unchanged. |
| Caller-funded stdio | `mcp/keryx-buyer.mts` projects ask/recovery fields before public output. Built stdio recovery tests inspect a fixed synthetic held original journal using GET only, preserve its bytes and refuse unknown private fields. Buyer/funding/signing guards are unchanged. |
| Extension | Its existing hosted OpenAI-compatible summary/report-link role inherits the public server contract. The report provides Verify; the extension does not create a verifier, read or payment capability. Its shipped source and version are unchanged. |
| Telegram / Discord | Existing answer-and-dispatch-link projections lead to report Verify. No checkpoint body, owner inference or new bot command is emitted. |
| Desktop / Operator / native Rust | Checked original-task/receipt and native export roles remain unchanged. These are not ordinary-public checkpoint stores; no fallback, enrollment, native sidecar, backfill or original-proof rewriting is added. |

Exact edited shared boundaries are `lib/agent/run-agent.ts`, `lib/agent/deps.ts`,
`lib/types.ts`, `lib/research/public-query-run.ts`, `lib/research/surface-result.ts`,
`app/dispatch/[id]/dispatch-view.tsx`, `lib/openapi-spec.ts`, `scripts/ask.mts`,
`scripts/research-audit.mts` and `mcp/keryx-buyer.mts`. New modules own the pure
policy/record/projection/OpenAPI/copy, ordinary collector, Verify component and
focused unit/adapter/browser/built-package checks. Existing fixtures gain focused
privacy and differential checks. CI and ops TypeScript include the new acceptance
scripts. No account editor or ops/production inventory is owned by this outcome.

## Combined source identity and graph audit

The last combined-source PR373 integrates reviewed checkpoint source onto PR374's
app49 mobile source, then owns app/OpenAPI0.27.50, stdio/Registry0.4.15, remote
MCP0.3.11 and desktop0.4.14 metadata. The mobile files and prior notes remain intact;
no intermediate app50 tag should precede both coherent outcomes.

Actual in-memory esbuild comparison against the checkpoint's canonical main218
baseline shows changed stdio, remote, web/API/A2A, CLI and hosted bot graphs. The
desktop helper also changes by 85 bytes through checked receipt exports importing
the shared surface module, even though its original-task role gains no ordinary
capture or Verify capability. Holding the same source-commit define excludes
stamp-only drift. Renderer and bridge project payloads are unchanged; the local
bridge probe externalizes the unavailable Tauri package and is not platform
acceptance. Extension0.1.3's twelve allowlisted canonical blobs and money formatter
are unchanged. Binary/source version choices do not assert delivered versions.

The root-allocated metadata changes only identity fields, not dependency closures,
native ABI, original/financial/A2A protocols or custody. The actual controlled
paying-source study is regenerated and checked for final combined source/lock
pins using its unchanged fresh-process testnet/offline/blank-credential boundary,
in-memory stores and zero outbound attempts. All 48 trials remain simulations;
no policy threshold or source/settlement truth is added. Prior study artifacts and
reviewed checkpoint evidence remain preserved in the local immutable release record.

## Acceptance and release status

Local evidence must identify exact input bytes and actual child exit/close/EOF.
The focused checks include real SQLite, isolated Supabase REST retention, engine
differentials, original/public privacy, ordinary public surface parity, offline
CLI, actual React/WebCrypto browser and actual built stdio consumer. The stdio
fixture uses an owned synthetic held journal, absent wallet, a fixed loopback
GET-only transport and zero funding/payment calls. A prior bounded startup
deadline refusal remains preserved; it is not relabeled as packaged acceptance.

App/ops TypeScript, proportionate lint/copy checks, the default Next production
build, independent source review and actual applicable hosted aggregate/platform
CI remain candidate gates. Root coordinates physical dependency QA and the one
combined version/distribution release. Coordinated source metadata does not qualify
npm/Registry publication, installers, extension artifacts, actual deployed/installed source readback or
production health are not inferred from local checks and are not performed here.

Full issue301 also requires actual optimizer/normalization and complete runtime
branch coverage, underlying exact integer monetary authority where absent, and
the issue291 payment-hash/source-authenticity boundary. Replay assertions establish
neither source truth nor read/payment/settlement authority. Issue301 remains open;
unknown or unsupported evidence remains unavailable.
