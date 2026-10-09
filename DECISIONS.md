# Keryx — Decision Log

**Record verified run ingress without inferring account ownership — 2026-10-09.**
New shared research runs carry optional closed JSON provenance separately from
payment origin and editable MCP client telemetry. Ownership continues to use the
existing verified `asker`: session wallet, ask-scoped key wallet, or the original
paid payer. Attribute synchronous and queued public A2A results to that payer;
Monthly uses the same original-bound worker. Compare the retained claimed payer
before execution. Ownership adds no budget, signer authority or downstream spend
claim. Authenticated chat ingress does not establish a linked wallet account.

Store the same metadata snapshot in existing SQLite/Supabase run JSON; no new
columns, migration or backfill. Missing old fields remain absent/unknown, and
old receipts/protected original projections retain their contracts. Record the
verified hosted ingress for stdio/desktop/CLI/extension clients using a shared
remote endpoint; a client name cannot prove the originating app. Defer account
linking, later claims and admin reassignment. Scope and remaining acceptance are
in [run ownership and ingress](docs/engineering/run-owner-provenance-261.md).

**Keep recovered completion latency separate from ordinary delivery — 2026-10-09.**
An original repaired after 52 hours must not define the reported speed of ordinary
jobs. Preserve the legacy mixed percentiles and add identifier-free completion
cohorts from recorded versioned service receipts and explicit repair/fulfillment
resolutions. Missing or contradictory markers stay unknown; missing storage
capability stays null. Measure stored order `createdAt` to `updatedAt` (acceptance
to recorded completion/update), including queueing, recovery and later bookkeeping
delay, without claiming first-answer or settlement timing.

SQLite extracts existing metadata. Ordinary Supabase aggregates the whole set in
its existing service-role public snapshot RPC; a capped REST page cannot augment
that truth. Its source migration does not rewrite orders or grant new authority.
Keep enrolled PostgreSQL's markerless contract and unsupported public snapshot
unchanged until separate protected storage migration/enrollment proof. This is
only the latency-reporting part of #257, with target-time alerts, customer remedies
and first-user measurements still open. Original receipts, budgets, custody,
settlement and recovery remain unchanged. See [rules and release gates](docs/engineering/completion-latency-cohorts-257.md).

**Exact recorded-money presentation without rounding repair — 2026-10-09.**
Public reward summaries previously rounded one micro-USDC to zero on several surfaces.
Use one browser-safe integer formatter and a strict adapter for legacy recorded decimal
numbers. Preserve existing decimal padding while retaining every known micro digit;
missing or fractional-micro data displays an unavailable amount. Sum known payment legs
as integers. Do not feed display strings into storage, receipts, signing or budget checks,
and do not infer settlement from an amount. The extension ships an exact checked copy;
human OpenAI/MCP footer text changes separately from unchanged machine-readable money.
Desktop's helper also produces a buyer command and remains outside this display-only
change. Locale/date/plural breadth and per-locale consent review remain open under #274.
See [scope and acceptance](docs/engineering/recorded-usdc-display.md).

**Decline standalone SSE on stateless remote MCP — 2026-10-09.**
JSON response mode in SDK1.31.0 governs POST, but its GET path can create an
indefinite notification stream even without session management. Keryx's remote
endpoint has no durable notification session, so answer GET with protocol-compatible
405 before key verification, database access or transport construction. Preserve
Origin403 and advertise only POST, DELETE and OPTIONS. Keep existing in-flight
POST, paid-history retention, authorization and recovery behavior unchanged.
Local SDK/HTTP acceptance is distinct from production drain proof; an observed
socket without a request path cannot be attributed to MCP. Coordinate remote
identity0.3.8 with the next application release. The wider issue281 maintenance
front door and hosted/client acceptance remain open. See
[scope and evidence](docs/engineering/mcp-standalone-stream-lifetime.md).

**Bind payment glossary review to exact content — 2026-10-09.**
Prepare English, Vietnamese and Simplified Chinese payment/trust terminology as
explicit agent-authored drafts, independently of locale routing and runtime
catalogue migration. Critical labels reference canonical terms; protocol names
and BUY/SKIP/CACHE remain unchanged. Human review covers the whole locale plus
its English source, with content digests invalidating stale approvals. Offline
CI validates structure and review bindings; actual human review, semantic
accuracy and runtime integration remain separate gates. Existing interfaces
are not retrospectively marked reviewed. No locale is activated by this
development-only change. See [translation instructions](docs/translation-instructions.md).

**Project obligations before investing Operator float — 2026-10-09.**
Stage a read-only ownership-scoped projection using the existing complete prepaid
inventory and original payment, withdrawal, funding and supplier journals. Keep
uncertain exposure, failed paid-delivery remedies and valid refunds protected;
authorization capacity and inbound receipts are not spendable balances. Preserve
the liquid owner reserve independently of vault value, keep burned-but-unminted
funds in transit, and count Arc native/ERC-20 USDC once. Unified Balance is a
Gateway inventory input, not all treasury property or payout authority. Defer
Earn/USYC deposits, CCTP sweeps and new schedules: vendor previews do not guarantee
future redemption, USYC has eligibility/allowlist gates even on Arc Testnet, and
whole-route fees, journal cutover and finite owner funding authority remain open.
No treasury adapter or executor is enabled by this evaluation. A later funded
testnet deposit/redemption/refusal drill must prove obligations and the reserve
stay covered before mainnet consideration. See the
[evaluation and buildable gates](docs/operator-treasury-float-evaluation.md).

**Preserve source history and gate model activation separately — 2026-10-08.**
After the completed Operator original positively closed its source window, merge
the reviewed research aggregate with history. Integrate the manual Cloudflare
GPT-OSS adapter as dormant support, preserving its false default and requiring
direct multilingual supplier/quote acceptance before activation. Add the owner's
official Product Hunt badge after homepage research controls so the mobile action
remains visible. Source inclusion and a launch link do not establish useful live
research, independent adoption or real payment traction.

**Retain ordinary presentation without weakening grounded delivery — 2026-10-08.**
Derive supported language and compact layout from the trusted original caller,
before sentence review. Group source-bound sentence/excerpt pairs by their shared
target or literal nested quote, retaining each original pair without connecting
prose. Ambiguous identity, oversized components, count mismatch or evidence gaps
preserve target layout. Offer bounded whole visible enumeration items only
through an ordinary opt-in. Private continuation defaults and rendered originals
remain unchanged. These presentation gates do not certify usefulness or complete
synthesis; real task acceptance remains required. Prioritize useful delivered work
and independent repeat use for competition quality without promising a rank.
See [acceptance and coordinated release](docs/engineering/research-deliverable-quality-2026-10-08.md).

The bounded MDN model trial recovered all four facts but failed the requested
three-item format. Preserve that failure and its consumed three-call grant.
Replay of those unchanged reviewed pairs validates the deterministic layout repair;
it does not establish a fresh deployed end-to-end result or general brevity.

**Add an explicitly selected Cloudflare GPT-OSS model — 2026-10-08.**
The owner approved one experimental GPT-OSS 120B choice while retaining DeepSeek
as default. Give it the new `cloudflare-gpt-oss-120b` public ID; preserve withdrawn
Ollama IDs and private/bounded original model authority. Its separate exact opt-in
controls catalog/runtime availability, while the automatic Cloudflare tier remains
Llama. Exclude the manual experiment from ordinary scheduled supplier probes.
Use per-model conservative prompt/output bounds, low GPT-OSS reasoning effort,
the existing JSON validator/usage ledger and a fresh immutable gross price capture.
Catalog/schema documentation is insufficient vendor acceptance: direct finite
English/Vietnamese JSON and evidence checks precede runtime activation. Keep
existing billing, source/payment limits and the active Operator source window.
See [configuration, supported surfaces and gates](docs/cloudflare-workers-ai.md).

**Reject incomplete prepared originals without discarding their history — 2026-10-08.**
The retained original produced an exactly grounded answer that omitted documented
payment and validation steps. Per-target coverage and statement support scores
cannot establish completion of the requested task. Keep the rejected prepared
result and every parent reservation immutable, bind separate root and independent
quality rejections, and activate a separate finite quality episode only after its
previous command tree is positively closed. Carry a genuine positive sufficiency
checkpoint only when the complete question, targets, four source bodies and exact
sufficiency prompt remain unchanged. Never carry the rejected generation or review.
Charge the two unused calls to fresh generation and independent review, retaining
325900 micro-USD history, the 367220 full-use ceiling and original owner expiry.
Protected original guidance and statement selection must cover available requested
parts. Canonical proposed acceptance checks are explicitly labeled inferences from
admitted factual premises, never assertions that those checks were executed.
Ordinary research, native claims, inbound payments and schedules keep their authority.
See [the recovery contract](docs/engineering/operator-original-continuation.md).

**List the first-party engineering feed on mainnet as an owner-operated source — 2026-10-07.**
Production mainnet had no registered source or offer, so every question read only free
public references and no access toll or citation reward could occur. The owner asked
for Keryx's own writing to be listed from a dedicated publisher wallet. This supersedes
the part of D-68 that left the feed without a payout wallet; the rest of D-68 stands.
The source is listed like any other and carries no special interface label. Its
ownership is recorded in the [publisher kit](docs/engineering/README.md), and the feed
itself states that it is first-party. Treasury-sponsored payments to it move funds
between owner-controlled wallets: they exercise the paid path but are not independent
creator adoption, creator earnings or external traction, and traction reports must
exclude them. One payout wallet serves every owner-operated source so the public
creator count cannot exceed one for the owner. Not decided: whether the public
"Creators earning" and "Creator payouts" totals should exclude owner-operated sources.

**Sponsored research and separately settled operating fees — 2026-10-07.**
Keep public no-wallet trial access bounded by the existing shared quota and sealed
prefunded treasury caps. The owner authorized real operating transfers for the
original citation-pool share of eligible unclaimed public references, including
sponsored questions. Keep creator payees/claims independent and retain historical
originals; the fee does not claim publisher ownership. Use a distinct payment kind
and protected identity/origin/expiry-bound recipient policy, with atomic ownership
checks and one original per query. Pending/failed originals cannot be replaced.
Display neutral research settlements, Keryx operating fees and creator rewards,
while retaining exact payer/payee and funding provenance. Existing browser grants
and fixed-price A2A/private packages admit no extra service debit in this release.
See [scope, recovery and pilot gates](docs/sponsored-research-trial.md).

**Keep PDF physical wraps out of evidence sentence boundaries — 2026-10-07.**
An offline reproduction showed a newline-separated sentence tail passing the
complete-span gate and strict quote menu. For observed PDF extractions, compute
boundaries on an equal-length CR/LF-to-space view while retaining exact original
text, UTF-16 offsets and hashes. Share those boundaries across span validation,
strict menus, passage nomination and bounded review context; preserve independent
physical-line heading hints. Keep existing caps, cut/Unicode rejection, non-PDF
behavior and evidence/payment authority. This repairs structural selection, not
reading order, semantic completeness, target coverage or independent usefulness.
See [the validation and residual-risk record](docs/engineering/pdf-evidence-boundaries-2026-10-07.md).

**Separate exact-paper discovery intent from already-read target identity — 2026-10-07.**
An explicit arXiv prefix can carry through a locally adjacent comparison list;
each inherited identifier must still state its exact version. Keep fixed official
metadata transport and request limits, deduplicate in question order, and stop
inheritance at unrelated prose. Library overflow detection must still see a third
identifier and refuse the oversized lookup. For already-read context, use every
exact target identity, including identifiers whose prefix was omitted during decomposition,
instead of discovery's two-ID cap. This aligns ranking with the ledger's target
grammar without turning ranking or metadata into citation, payout or document
authority. Extraction/context ceilings, private/unattended disclosure policy,
reviewed sentence/excerpt delivery and remaining usefulness gates stay intact.

**Use an importer-recognized RIS type and literal provenance notes — 2026-10-07.**
The active literature-review segment depends on reusable citation exports. A pinned
Zotero translator reproduction showed our preprint `UNPB` tag defaults to
`journalArticle`. Use `MANSCPT`, mapped to manuscript, while preserving the explicit
preprint/read-scope/unknown-peer-review note and exact arXiv version. Escape literal
N1 text for the translator's HTML-note path and do not substitute a source name
for an absent scholarly journal. Leave BibTeX and recorded evidence/receipt/payment
contracts intact. Check actual browser downloads, shared transport/checked-receipt
parity and the digest-pinned upstream parser; the minimal host is not Zotero
application acceptance or a complete field-validation test. The actual desktop
helper imports this formatter, requiring a separate 0.4.8 candidate and package
verification. Original paid snapshots stay immutable. See
[compatibility evidence and release gates](docs/engineering/reference-export-2026-10-07.md).

**Pin the hosted MCP SDK to the reviewed fixed release — 2026-10-07.**
Exact-main CI for the source-inspection release failed the high production audit
after GHSA-6qxp-vccf-f47h entered the advisory feed. Require root SDK 1.31.0,
matching the stdio package's existing pin, with a scoped lock update and real SDK
server/transport compatibility checks. An exact pin avoids silently taking a
later minor release while repairing this gate. Existing server/stdio roles do
not use the affected OAuth client flow; preserve them and the audit threshold.
No new OAuth authority, payment, provider, custody, schedule or installed-client
version is introduced. Source-bound deployment acceptance must separately admit
the new main; previous source and UI-only comparisons do not do that.
See [security scope and gates](docs/engineering/mcp-sdk-security-2026-10-07.md).

**Inspect a recorded report without one source — 2026-10-06.**
The owner requested one memorable small UX improvement after a deep Tameion
assessment, then authorized an autonomous delivery goal. Reuse the exact excerpt
matrix to show which research targets retain recorded excerpts when a source is
temporarily omitted. Keep all original prose, confidence, coverage and payment
fields unchanged; selection never runs research, recalculates rewards or refunds.
Exclude synthetic identities, retain exact article versions and distinguish new
gaps, old gaps and missing historical ledgers. Targets are requested topics, not
verified assertions; the view is not a counterfactual answer or factual grade.
Minimal private/paid result clients lack the full identity graph and retain their
existing roles, rather than reconstructing source IDs from names. No API/payment
contract or native/stdio artifact changes. See [guide and surface roles](docs/research-source-inspection.md).

**Freeze a finite business acceptance original before any signature — 2026-10-06.**
The owner authorized a 24-hour bounded mainnet canary and separately creating a
local buyer wallet. Narrow the first run to one Quick original, an empty creator
catalog and no creator payments. Freeze quote/body/nonce/rail/host before signing;
use one protected POSIX ledger for retained financial and provider holds, a local
exclusive submission record, targeted native claim proof and GET-only recovery.
Historical supplier allowances stay unchanged. Expiry/removing selectors cannot
release holds; verified same-original completion is required to close. Generic
model transports and watchdog probes remain held. Funding source authority,
useful live delivery, creator rights, independent demand and a general on-chain
policy wallet remain separate gates. See [finite acceptance](docs/operator-canary.md).

**Keep a bounded failure category in the finite-allowance engine — 2026-10-06.**
The bounded production engine replaced every supplier failure with one generic
error, so a reply cut at the output ceiling or rejected as invalid JSON bypassed
planning's and selection's request-local refusals and reached the client as an
unreachable provider. Keep the bounded category instead: output validation,
timeout, network, or the HTTP status. The original message still never leaves the
wrapper because a provider body can echo request context. Reservations, the single
attempt and the absence of provider fallback are unchanged. This does not explain
the historical first-call failure, whose original exception was not retained.

**Expand source discovery with separate unread publisher links — 2026-10-06.**
The owner requested a substantial expansion across AI/agents, data/infrastructure,
payments and creator research, together with better browsing. Keep an audited
publisher directory separate from retained feed snapshots and public citation
history. A listed URL is an unread starting point; it supplies no evidence,
ownership, price or payout authority. Question links open editable drafts without
automatic submission. Existing original-read and evidence gates still decide
whether the material supports an answer.

Use bounded literal metadata search, topic hints, collection filters, recorded-date
sorting and shareable GET URLs, rendered on the server without serializing private
claim records. Count registrable domain groups as a breadth proxy, not verified
independent publishers. Add feeds only after the existing bounded public transport
and snapshot rules admit usable content; retain failed/oversized feeds as directory
links where appropriate. Import is an explicit one-time operation. Existing upkeep
budgets, deactivation, historical reads and creator payment boundaries remain
authoritative. See [catalog audit and release scope](docs/engineering/source-catalog-2026-10-06.md).

The existing CI audit discovered critical/high transitive findings during this
release. Apply compatible proxy-addr 2.0.8 and source-map-js 1.2.2 lock patches,
including the desktop's development source-map entry, and retain the audit gate
with behavior regressions. Keep the moderate stream-json residual explicit:
its patched major changes the caller API and cannot safely replace Jayson's 1.x
range without separate compatibility work. Payment SDK declarations and policy
remain unchanged. See [dependency evidence and surface boundaries](docs/engineering/dependency-audit-2026-10-06.md).

**Audit frozen evidence independently of reported agent scores — 2026-10-06.**
Use a native evaluation helper, separate from the production evidence gate, to
validate retained quote/source/item/claim/marker consistency and this run's paid
fetch observations against the frozen corpus. Duplicate coverage cannot inflate
the grounded rate, and coverage stays within verified evidence's reported support
at six-place precision. Invalid provenance fails acceptance regardless of score.
Refresh ADK/Promptfoo references and adopt their separate response/trajectory and
deterministic/model-grade patterns without a framework dependency or model judge.
Literal membership is provenance, not semantic entailment or truth; free/cache/live
trajectory and usefulness remain separate work. Preserve the six-case baseline
and all production payment, custody, provider and schedule gates. This is a
development-only CLI/CI change with no app/distribution identity or deployment.
See [evidence, scope and rollback](docs/engineering/frozen-eval-grounding-2026-10-06.md).

**Show recorded reading and retained sources before empty earnings — 2026-10-05.**
The owner requested visible real source information, including public references and
unverified creator listings. Treat Sources as a reading library and the ledger as
research activity with separately inspectable payment proof. Public feed snapshots
can show publisher links, topics, retained article titles, publisher dates, delivery
scope and collection time without granting ownership, factual accuracy or payment
authority. Count retained public references separately from creator listings; broad
web discoverability is not a stored catalog count. Do not bulk-import sources or
rewrite historical evidence to fill the page.

The live retained feed/creator collections were empty at readback, while public
answers retained original citation URLs. Show a third, explicitly bounded collection
of documents cited in recent public answers, with original links, recorded reading
scope and answer permalinks. It reads the existing public `query_runs` store, never
private research results; omit synthetic citations and unsafe links. Historical
citation metadata is not a source enrollment or payment/control authority.

The owner also requested user statistics from Google or connected wallets. Expose
the existing authenticated wallet account index as an aggregate of distinct valid
normalized addresses. Repeated verified sign-ins to the same wallet count once;
multiple wallets can belong to one person. A connection click and activation event
are not account identities. Provider breakdowns and active/unique-person counts
remain unavailable because the index does not store that evidence. Return unknown
when an exact aggregate cannot be supplied, without replacing payment totals with
zero. Public responses contain only the count, never account rows. Enrolled
Supabase needs a separately reviewed aggregate operation before this count is
available; this release adds no RPC, enrollment or auth change.

Confirmed-empty settlement tickers disappear; loading and unavailable states remain
explicit. Financial totals stay settled-only and inspectable, with pending/failed
records and full payment evidence retained. Independent reads preserve available
activity through partial failures and date retained data after a failed refresh.
Stream the source preview separately so its storage reads cannot delay the ledger
shell. Registry registration and grandfathered verification flags do not certify
current publisher control. See [scope and acceptance](docs/engineering/ledger-sources-2026-10-05.md).

**Isolate invalid source proposals and retain classified caller failures — 2026-10-05.**
An actionable model decision needs a complete valid target list and exact input
candidate identity. Reject the entire invalid proposal, withhold every duplicate
candidate group, and retain independently valid proposals through existing read,
evidence and payment gates. Never infer links from the rationale, filter invalid
targets into a usable subset, rewrite the plan or promote a model SKIP. A genuine
all-SKIP remains valid; invalid output with no valid actionable proposal ends as a
terminal request-local refusal without another paid tier or circuit mutation.

Keep bounded allowlisted reason/count/index diagnostics, supplier call/token
counters and explicit withheld-source rationales. Export terminal diagnostic JSON
to the caller without creating a completed dispatch or financial receipt; omit
question/provider/source/custody values. Missing historical payloads stay unknown
and representative offline fixtures do not prove live usefulness. See
[selection repair and gates](docs/engineering/source-selection-2026-10-05.md).

**Monitoring observations and mainnet defaults — 2026-10-05.** Describe service
availability separately from recorded financial checks. Add bounded freshness for
the four existing summary records without vendor requests, scheduler changes or
financial transitions in health. A missing, invalid, future or stale timestamp is
unavailable/currently unobserved, never an inferred successful check. A recent
summary dates an observation and does not prove a pass, active scheduling or settlement.
New desktop tasks target the public mainnet service; persisted task networks remain
immutable history. Creator proof keeps the 24-hour control boundary and manual
refresh, with clear owner recovery rather than implicit renewal or earnings activation.
Monthly/Slack/external discovery copy reflects its actual role; marketplace metadata
does not authorize payments. See [release scope](docs/engineering/mainnet-consistency-2026-10-05.md).

**Caller source leads, serving visibility and native authority checks — 2026-10-05.**
URLs in the original question are bounded unread discovery leads even without a search
provider. Never manufacture a source from a domain or model-created target, force a BUY,
or treat a supplied URL as document contents, official authorship or creator authority.
Keep existing public transport, final identity, evidence and portfolio bounds; fragment
requests share a document read and do not claim section-specific extraction. Retain
refusal and omission reasons so discovery failure does not become another request for
the same already-supplied URLs. Private and unattended external-effect gates remain.

Expose allowlisted recorded reasoning attempts and step-specific serving/fallback state
through shared results. Aggregate engine names or model synthesis cannot certify model
source selection; missing, invalid and bounded-out telemetry remains unknown. This is
observability, not a circuit reset, provider policy change or recovered usefulness claim.

Batch trusted exact schema triples in one native SQLite statement per guard. Compare the
first matching stored definition with binary exact SQL semantics, preserving missing,
null and drift refusals. Do not materialize stored SQL into JavaScript or cache authority.
Keep storage enrollment, authorizers, markers, counts and observation deadlines intact.
Windows acceptance and Linux CI must verify both correctness and the reported improvement.

**Bind legacy evidence to complete source spans and private neighboring context — 2026-10-05.**
Ordinary-client results exposed an unconfirmed proposal without its qualification
and a mid-sentence excerpt. Bind new internal proposals to exact read offsets,
refuse structurally cut quotes independently of model support, and include bounded
neighbors plus source identity in the existing review. Never reconstruct runtime
offsets by text lookup or add paid retries. Withhold known discussion pages from
targets that explicitly require official documentation, retaining mixed-source
research. This negative gate does not certify other URLs. Keep payout authority,
allocation, public schemas and historical answers unchanged. Lower recall is an
explicit limit; usefulness remains unproven. See [design and evidence](docs/engineering/source-context-2026-10-05.md).


**Public discovery, verified control and explicit future earnings — 2026-10-05.**
Keep public RSS and on-demand broad-web evidence readable without a creator account,
wallet, price or payout authority. Do not attempt to pre-crawl the entire internet or
populate an empty mainnet marketplace with simulated paid creators. A public reference
keeps its original identity and archived receipts after a publisher claims control.

Claims prove control of an exact HTTPS source using an expiring, wallet/network/origin
bound challenge in an origin-root file or publisher-controlled RSS/Atom channel metadata.
Post bodies, comments and redirects cannot establish control. Store one owner atomically,
retain proof and revision history, and bind a separate creator listing to its exact
on-chain source ID and reviewed registry address. Strong proof may verify that listing
only after fresh live creator authority agrees. Verification and linking default to free;
earning requires a separate explicit distribution permission and policy selection.
Citation-only requires an owner-set zero registry toll; paid access requires a positive
registry toll. On-chain payout and author splits remain authoritative.

A zero-price article is a current version-bound free delivery, with no access signature,
deposit, simulated settlement or paid-cache receipt. Only a qualified actual citation may
trigger a later citation reward when enabled. Preserve the original free public candidate
until a creator read succeeds, and admit an exact URL/body only once. Disabled or unavailable
creator delivery cannot erase public evidence. A first uncertain funding boundary blocks
further automatic payments and stays visible alongside the completed answer.

Capture the policy revision before reading and bind new financial admission to that snapshot.
Managed paid endpoints require the selected claim ID/revision, but unsigned URL metadata
alone is insufficient: atomic SQLite admission compares the current policy and the nonce's
retained browser/hosted original. Existing economic originals keep their policy for recovery;
policy updates never bill old reads or rewrite exposed authorization/settlement evidence.
Pause new managed earnings when control proof is over 24 hours old, the registry changes,
permission is disabled, or authority cannot be verified. Refresh proof manually; disabling
earnings remains available during outages. Unsupported storage refuses claim writes and
managed admission. Use existing sealed storage without adding a mainnet schema migration.

Claim management belongs to the wallet web flow and its authenticated API. Shared research
behavior and original policy checks apply to hosted API/A2A/MCP/bots and the headless browser
Session runtime. Existing stdio buyer, desktop and extension protocols keep their roles;
their packaged reader contracts do not become claim-management or payout authority. Scholarly
rights enrollment remains separately gated. Acceptance requires native concurrent admission,
real React/browser journeys, original-signature substitution tests, existing payment checks,
TypeScript/lint/build, independent review and verified production commit. See
[the source claim guide](docs/public-source-claims.md).

**Stage a bounded brief behind measured usefulness and contribution review — 2026-10-05.**
The owner authorized ordinary mainnet client use within one USD 2 round, at most
three questions and 0.15 source USDC, with no topup. Keep external compute/search
costs separate from source payees and count both against the finite allowance.
Use protected durable per-request reservations for the exact supplier transport;
failed/unknown requests retain their holds. An expired policy cannot fall through
to another provider. Preserve explicit private-provider role boundaries.

D-300 remains the default. An opt-in bounded fact/action contract requires exact
quote provenance, the same neighboring context for generation/review, immutable
packet binding, complete whole-row AND per-quote contribution review, dependency
closure and a final downward-only projection through existing evidence gates.
Missing optional generation actions normalize to an empty set before review;
no invalid present row, unknown field or incomplete review is repaired. Duplicate
context may be omitted on the wire only when identical bytes remain at their exact
offsets in the shared source context. No arbitrary prose gains evidence/reward
authority. Retain the original full packet privately and publish only bounded
excerpts/finalized output. Model review estimates support; it does not certify truth.

The initial independent set failed at 3/12 useful with six material unsupported
rows. A separate high-effort review set exhausted its output cap and was stopped
after four failures made its gate unreachable. Neither result authorizes richer
production answers. The final lower-effort candidate also failed: five completed
cases yielded no useful brief, with four exhausted reviews and one malformed
generation. Keep the feature disabled. Future activation still needs a fresh
independently authored set with at least 10/12 useful artifacts and zero material
errors, plus separately graded insufficient cases. Keep all
failures, unknown costs and versioned evidence. See
[the bounded-brief findings and release gates](docs/engineering/decision-brief-2026-10-05.md).

Compute failure after a paid read must preserve the final dispatch and receipts.
Stop extra purchases after an unavailable reading assessment, retain existing
final-assessment reward withholding, and let attribution outages reach the already
documented equal-share fallback only over admitted delivered contributions. Keep
unreviewed conflict and attribution prose outside the brief's delivery boundary.

Reviewed deployment binds the fetched remote main to an explicit accepted full
commit before source mutation, then resets that immutable object. Preserve every
retained temporary/backup build until its operator-reviewed archive is verified;
refuse a new temporary build appearing between preflight and build. These checks
prevent a moving main branch or stale build cleanup from changing a reviewed release.

**Current-network documentation convention — 2026-10-04.** The owner confirmed
that production is already mainnet and requested a documentation-wide refresh.
[Current status](docs/mainnet-status.md) records the direct `arc`/`real` health
observation, mainnet contracts and independently observed distribution identities.
Use mainnet for present-tense production instructions; keep isolated testnet
development, staged domains and historical receipts labelled with their actual
network. Publication/deployment is distinct from paid acceptance, revenue, useful
synthesis and external audit. This documentation update changes no runtime default,
spend authority, custody, scheduler or distribution version.

**Observed paper identity and bounded contextual evidence — 2026-10-04.** The
additional authorized live comparison reproduced CAVA excerpts admitted under
explicit Weng paper targets because HTML URLs bypassed the original-paper checks.
Use the recorded canonical arXiv document URL and exact version for those
targets, with one modern/legacy identifier grammar across discovery and admission.
Keep discovery's two-ID bound separate from target admission, which must inspect
every explicit identity. A query, fragment, lookalike host, absent URL or discovery
metadata cannot supply original-document authority. Production original reads
already bind an observed URL before attaching discovery metadata; remove the old
metadata-only compatibility path. Public reads bind the fetched final URL; paid and
cached reads retain existing catalog URL/receipt trust, not independent origin or
authorship proof. Secondary or mirrored provenance needs a separate
explicit contract. Refused exact-paper evidence cannot qualify an answer or reward;
legitimate own-paper evidence keeps its existing eligibility and public-reference
reward exclusion. Never rewrite archived answer, receipt or settlement bytes.

The same comparison retained source qualifications that bounded context selection
discarded before synthesis. Preserve selected short source blocks as contiguous
units within the existing source/passage/context limits and expose omissions. Keep
candidate work bounded independently of formatting density. If an intact block
does not fit, retain the gap instead of trimming away its qualification or forcing
benchmark coverage. This improves supplied context, not semantic entailment or
complete synthesis. D-300 remains authoritative; a literal excerpt and Low label
do not establish a useful decision. Preserve the full-attempt failures and separate
any diagnostic rerun under the unchanged approved cumulative model allowance.
See [the measured follow-up](docs/engineering/research-evidence-follow-up-2026-10-04.md).

**Bounded reading and actionable incomplete research — 2026-10-04.** Replay the
failed original-document bytes before changing reader limits. Replace HTML's full
browser DOM with standards-based parse5 normalization and Mozilla's lightweight
Readability DOM inside the existing disposable child. Keep the 2 MiB transport cap,
500 kB normalized markup cap, 20,000-element/256-depth limits, 64 MiB old-space
setting, four-second HTML deadline, one parser slot and 60,000-character output
ceiling. Exclude explicitly hidden content and select a unique main region ahead
of an unrelated article card. This is static text extraction, not rendered-page or
whole-document verification. Accept publisher Markdown as inert text. Validate every
DNS answer as public before preferring a pinned IPv4 address; do not add retries or
weaken redirect, TLS, URL-identity or SSRF checks.

Append deterministic follow-up guidance for observed failed reads, truncated text
and abstract-only delivery after answer attribution and settlement. A model-reported
conflict remains explicitly unverified; it cannot choose document authority. Paid
unknowns require inspection of the original records before another paid attempt.
Guidance performs no action, adds no evidence markers, changes no creator weights,
and survives saved answers and shared exports. Offline fallback decomposition
preserves the complete requested wording and explicit question/semicolon targets;
punctuation-based refinements cannot create an artificial excess-target rejection.
The eight-target limit still rejects excess explicit scope. D-300 remains in force: increased
read yield and suggested next steps do not demonstrate useful complete synthesis.
See [quality follow-up and release gates](docs/engineering/research-quality-2026-10-04.md).

**Execute workload acceptance separately from usefulness — 2026-10-04.** The owner
requested end-to-end execution of the 24 internal tasks and approved one live-model
batch capped at USD 1, with no mainnet source USDC. Capture original public reads,
retain errors, and replay the supplied candidates through the production orchestrator
with an isolated database, a deny-payment gateway and complete local effects. Label
model use, snapshot replay and payment mode separately. A complete run and a valid
receipt do not establish a useful requested artifact, autonomous discovery recall,
independent demand or real settlement. Preserve failed attempts and D-300's delivery
boundary. The dated live harness reserves conservative peak-rate cost before each
HTTP request, retains failures, flushes state and excludes concurrent owners; uncertain
state stays held. See the [execution findings](docs/engineering/research-workload-2026-10-04.md).

Bot projections lack authoritative historical chain/settlement evidence. Display
network-neutral planned USDC rewards and link to original receipts; do not infer a
network from today's configuration or settlement from a citation/recorded total.

**Economic recovery preserves original authority — 2026-10-04.** The owner
authorized repairs after the deployed-mainnet economic audit. An exposed withdrawal
marker can precede cryptography; distinguish it from publication of a retained burn
signature. Permit an owner-authenticated local signing abort only after the original
custody store atomically fences publication, and only when the server has no signed
request, transfer claim, attestation or completion. Retain an immutable, original-bound
abort outcome. Never label it a completed mint or a never-exposed cancellation. A
lost acknowledgment keeps the local barrier until the same outcome is read back.
Existing browser writers must recognize the local tombstone and refuse publication.
Headless state upgrades retain custody and originals and fence old writers.

This is an authenticated assertion from the existing trusted browser/session holder,
not an independent cryptographic proof that no signature exists. Already published
or ambiguously submitted signatures remain held. Expiry, empty vendor searches,
balance changes and unused direct-burn hashes alone do not authorize release.

Exact terminal-failed browser payments may release local lifetime capacity once,
using the same original nonce/economic binding and trusted server/Circle journal as
cashout. Keep nonce and terminal evidence permanently; settled debit is not failed
capacity. Old per-question reservations stay conservative when the browser did not
retain a reliable question association. Renewed consent can use recovered capacity
for a new question; a retry cannot reuse the original nonce.

Sponsored web, chat, remote MCP and bot research share durable caller and global
admission. API keys identify one wallet rather than creating independent allowances.
The default global 60 dispatches/minute is a throughput bound, not a dollar-cost
guarantee; existing reviewed treasury query/lifetime USDC caps remain authoritative.
Storage outages refuse sponsorship. Paid A2A and caller-funded Session roles retain
their own admission. Quote and async worker validation use the same exact integer
micro-USDC roundtrip, and lifetime funding accounting streams all original evidence
instead of expiring at a fixed history count. See
[implementation and release gates](docs/engineering/mainnet-economic-recovery.md).

**Authored web sources define generated CSS — 2026-10-04.** A production
Turbopack build timed out in its PostCSS subprocess while clean CI builds passed.
Tailwind's automatic project scan admitted retained `.next.*` builds that the
existing ignore rules did not cover. Restrict web utility discovery to authored
`app`, `components`, `lib` and `shared` sources and ignore generated `.next.*`
directories. Keep retained builds as recovery evidence; their contents must not
affect a subsequent stylesheet. A bounded, in-memory PostCSS check on the actual
VPS completed in 2.1 seconds at about 115 MB RSS. The complete production build
and live deployment remain separate acceptance checks. No bundler, payment,
custody, API or non-web distribution contract changes follow from this choice.

**Mainnet lifecycle and onboarding recovery — 2026-10-04.** The owner confirmed
the public product is already on mainnet and requested fixes for awkward or broken
flows. Direct health observation confirms the deployed Arc profile; historical
pre-launch gates do not describe current deployment. Keep automatic Session restore
visible and serialize lifecycle actions before any await. An invalidated operation
may be followed by a read of the current owner's saved custody, never a replay of
funding or consent. Only a successful empty custody read permits initial derivation;
storage failures, corrupt ciphertext and cancelled operations refuse. Inactive
consent retains a recoverable session with clear renewal guidance.

Bulk creator registration uses the same compiled mainnet registry and exact
registration-event checks as the single-source path. Capture owner/SIWE/network
across wallet and RPC awaits; unknown outcomes retain the original transaction
for observation. Unrelated manually supplied receipts cannot release uncertainty.
Faucet actions are testnet-only, and mainnet guidance distinguishes wallet gas
from Gateway credit. These repairs preserve custody formats, settlement/cap
authority, historical records and the API purchase contract.

**D-300** - Admit source excerpts without certifying synthesized assertions - *2026-10-03*

The #128 follow-up reproduced an omitted evidence proposal: one accepted source marker
preserved both a qualified methods statement and an unsupported attack-elimination claim.
No span or marker was rejected, and the unsupported draft survived even when the ledger
reported a separate evaluation gap. Covering every requested target does not repair this
boundary: another unsupported assertion can still reuse the same accepted marker.

Supersede D-297's fully-qualified-draft exception with unconditional extractive delivery
after reads. The current proposal contract has no complete assertion-to-evidence mapping;
neither target coverage, literal overlap nor a second model relevance estimate proves
entailment of arbitrary prose. Publish only qualified, openly quoted source excerpts,
grouped under numbered research targets whose model-proposed labels are explicitly quoted
as unverified topics. Show absent/low-assessed-support gaps and a prominent unverified
complete-synthesis limitation. Cap completion confidence at Low even when coverage is high;
recorded support and coverage remain estimates of the excerpt ledger. Source truth,
contradictions, per-assertion entailment and useful complete synthesis remain separate gates.

This is a conservative staged product limitation, not a demonstrated answer-quality or
usefulness improvement. Do not add a sentence/lexical compatibility parser that launders
negation, changed numbers, extra clauses, translations or formatting into accepted claims.
Qualified quoted contributions retain existing source/article/version bindings and creator
reward eligibility. Attribute only the projected answer; retain paid access debits when all
quotes are withheld. No new payout, signer, reservation, settlement or discovery authority.
Enforce the stored trimmed quote's 240-character ceiling before normalized matching,
as well as the existing normalized ceiling/minimum. Whitespace inflation must not create
answer/reward admission for an excerpt that receipts/UI/exports cannot retain. Preserve
within-bound multiline quotes exactly in the ledger and portable export data.

Web SSE/history, public/private APIs, A2A, remote/stdio MCP, OpenAI extension, CLI, desktop
receipt exports and thin bot/extension consumers retain the shared finalized answer and
admitted citations/evidence. Reports, receipts and reference/evidence exports reuse those
records without enrichment. Archived answer bytes are not retrospectively rewritten or
semantically certified. The minified source/browser regression, focused source tests,
application/operations TypeScript, independent review and integrated CI are code gates;
current deployment, useful original-paper comparisons, actual export inspection, independent
settlement and user review are separate unverified gates. Issue #128 remains open. Production
maintenance remains held by the separately active network transition; this code candidate
does not authorize runtime deployment, funding, mainnet activation or service changes.

Reversible: restore richer synthesis only after a separately reviewed assertion-completeness
and entailment policy has demonstrated acceptance, not by relaxing source-marker admission.
See [issue 128 investigation](docs/engineering/research-attention-2026-10-02.md).

**D-299** - Resume creator drafts and persisted feed proof - *2026-10-03*

Preserve public registration context in a canonical URL rather than ephemeral component
state or a stored signed authorization. Permit only normalized relative registration
returns through sign-in, bind the draft to the wallet that starts the flow, and require
connected-wallet/current-session agreement before registration. Explicit continuation
restores RSS, Wanted match and supported extension fields for first-time asker accounts
as well as returning creators. Authentication never automatically publishes a source.

Reopen feed proof from the persisted source in My sources and Manage through the shared
verification panel. Only its persisted payout wallet may inspect/verify it; author-share
membership conveys notification management, not proof authority. Distinguish a missing
token from an unavailable feed/index, retain safe retry and idempotent verified responses,
and suppress delayed results after identity changes. Atomically set only verified state
when source ID, payout and effective feed still match after the network read; never restore
a stale registry snapshot. No duplicate source, registry write
or registration gas. Both synthetic compiled network profiles exercise the same recovery
flow without weakening selected-chain SIWE, registry receipt or mainnet custody/storage
admission gates. An offline mainnet registration response remains refused. See
[creator recovery](docs/creator-onboarding-recovery.md).

**D-298** - Keep synthetic evidence provenance separate from settlement - *2026-10-03*

Use trusted sticky `synthetic-demo` source/item provenance for illustrative seeds, with
exact seed identity/content matching in the backfill. Do not infer factual support from
an authentic receipt or a real payment. Bounded metadata-only historical projections
demote synthetic factual evidence and coverage while preserving immutable archived answer
bytes, payment evidence and ciphertext; public answers and exports disclose that retained
prose is illustrative. New factual synthesis excludes those records. Source and preview
consumers carry the same additive marker, without changing payout authority.
After original receipt integrity checks, derived local exports may recognize only exact
title/URL/body-hash fingerprints from the checked corpus manifest. Missing strong
fingerprints require a fresh projected receipt; original bytes and digests stay unchanged.

Stored historical quality counters can still include subsequently demoted demo evidence.
Publish aggregate factual grounding as unavailable (`groundedClaimRate: null`) with an
explicit recorded-unreassessed basis until a reviewed provenance-aware analytics
reassessment exists. Retain raw sample telemetry and authentic settlement totals;
neither scanning paid bodies nor rewriting archived rows is part of a metrics read.
Per-run projected receipt quality remains separate from this aggregate limitation.

Ordinary SQLite schema startup and Supabase migration 0079 carry the candidate backfill.
The public selected-mainnet path requires sealed enrolled SQLite admission; existing stores
need explicit paused migration and fresh matching enrollment. Existing enrolled Supabase
schema-77 profiles cannot be expanded silently: fresh schema/catalog/read-profile acceptance
is required before staged Supabase activation. See [backend acceptance](docs/enrolled-runtime-backends.md). Production
migration, receipt projection readback and exact-source client distribution remain release
gates. Synthetic acceptance establishes neither independent usage nor settled traction.
See [synthetic evidence provenance](docs/synthetic-evidence-provenance.md).

**D-297** - Publish factual answers from qualified evidence, not citation cleanup - *2026-10-03*

A rejected factual draft cannot remain apparently supported merely because its citation
marker was removed. Conservatively replace such a draft with qualified literal ledger
excerpts and explicit target gaps; retain fully qualified drafts. Answer qualification is
separate from creator-reward eligibility. Exact paper requests have bounded per-paper
method/evaluation/limitation targets, source-specific version ranking and contiguous
sentence/quote windows; no joins manufacture supporting context. Empty and partial English/
Vietnamese answers use recorded search/read/gating diagnostics and task-relevant recovery,
without promising that more source USDC repairs free original reads.

Permit bounded zero-price Deep gap expansion when the monetary fetch allowance reaches
zero, preserving attention, deadline, cache and paid-price bounds. Reject malformed web/
OpenAI request shapes with their HTTP 400 validation contracts before research starts.
Live useful comparisons, complete-paper coverage, actual report/reference exports and
independent payment evidence remain acceptance gates. See
[issue 128 investigation](docs/engineering/research-attention-2026-10-02.md).

**Owner-managed creator cash-out batch** — *2026-10-02*

The user confirmed both comprehensive creator cash-out testing and withdrawing
the eligible Arc-testnet balances whose original keys the owner controls. Keep
this operator scope separate from public browser creation: use the existing
durable request/admission/attestation/mint engine, an externally reviewed immutable
plan digest, original owner/self-recipient signatures, a fresh isolated relay and
one exclusive broadcast marker per original. Retain uncertainty independently;
no missing response, expiry or balance drift permits another signature, salt,
Circle POST or raw broadcast. Shared nonce uncertainty can hold later legs.

The reviewed absolute scope is 23 owners and 55,000,000 micro-USDC, with the exact
current selected snapshot at 54,994,260 micro-USDC and a 3,900 per-owner fee cap.
Native funding is exactly 0.21 test USDC with at most 0.00063 funding gas, including a 0.207
immutable relay lifetime ceiling. Preserve the older 0.010 rehearsal and its
exhausted journal. PC keys remain in original custody; transfer only retained
signed requests and public plans. Actual Windows ACL/ancestor checks replace no
source ACLs and do not infer protection from POSIX bits. Reserve the quoted fee
maximum when selecting value and measure actual residuals; a quote cannot promise
an empty balance or creator revenue. Receipt-matched reporting writes only the
cash-out ledger. See [owner cash-out operations](docs/engineering/creator-owner-cashout-batch.md).

Treat each reviewed snapshot balance as an immutable selected debit. Preparation
and pre-signing require a known live balance at least that debit; later credits
or a smaller sufficient surplus never enlarge the value, fee, policy or retained
plan digest. Refuse unknown/below-selected balances before signing and report
new credits as residual. Earlier unsigned snapshots remain historical evidence;
they do not authorize replacing a retained original or uncertain marker.

No production HTTP/timer or browser/desktop/MCP/extension/bot cash-out authority
is enabled by this operator delivery. Source tests/review/CI and actual funded
evidence remain separate acceptance gates; legacy browser/API migration is a
separate demonstrated risk and follow-up.

## Selected public treasury observation — 2026-10-03

The installed Unified Balance Kit defines Arc testnet only. Mainnet `/api/treasury`
therefore reads the public role's configured policy and actual sealed SQLite identity
through the read-only application boundary, checks historical role separation, and
requests that exact address/domain from the selected Circle Gateway balance API.
It never reads the retained testnet wallet, loads a custody key or admits spending.
The current policy/identity is revalidated after asynchronous reads, and mainnet
does not reuse a last-good cache when policy or Circle observation is unavailable.
Available USDC is distinct from kit confirmed/pending-deposit totals; an unanswered
or mismatched Circle row is unknown, while an explicit matching zero is zero.
Public balance and health observations do not establish hosted payment readiness.
The status page consumes this public observation; CLI/MCP/desktop/extension callers
have no treasury-endpoint consumer and retain their independently bounded payment
and original-network recovery contracts. The historical Circle grant-media script
explicitly requires the testnet App Kit response and refuses a mainnet response;
its archived screenshots and traction are not relabeled as mainnet proof.

## Full public mainnet storage and recovery — 2026-10-02

An unsigned session withdrawal has a retained pre-crypto exposure transition. The
normal worker must acquire the server marker before signing; submit requires it.
Owner cancellation is atomic only before that marker, signed request and transfer
claim, retains the cancelled original salt, and cannot revive that request. Local
worker cancellation also requires no local cryptographic exposure. Uncertain or
signed originals never release by time or empty vendor lookup. This lets an owner
decline an unsigned withdrawal without retiring the stable funded signer.

The owner requested the normal public product on mainnet, superseding the invited
pilot proposal. The current production backend is SQLite, so the public release
targets a fresh sealed mainnet SQLite namespace on the existing deployment while
retaining testnet state and custody separately. Optional Supabase mainnet remains
closed until its independently source-generated PostgreSQL schema and concurrent
writer acceptance pass; it does not block the ordinary SQLite release.

Session cashout authenticates retained owner and signer proofs after payment
expiry or revocation. An unsigned original preparation reserves capacity and
pauses new payment admission in one native transaction. That transaction compares
confirmed lifetime debits as well as pending holds, including changes after the
last quote read. Signed burns and matched attestations reuse the existing creator
withdrawal journal. Unknown outcomes retain the original request and liabilities;
only an exact owner mint with canonical selected-chain receipt/finality evidence
releases the withdrawal barrier. Original nonces and lifetime payment consumption
remain, so the stable signer can fund and renew rather than being retired.

Ordinary creator cashout uses its connected owner wallet for burn consent and the
mint transaction's gas; a custodial relay is a separate optional operator role.
Its signed original admission compares all retained local liabilities and confirmed
debits atomically with the fresh quote. Recovery never repeats a vendor burn, and
only an exact observed owner mint releases that original withdrawal hold.
Hosted mainnet payments use an independently sealed, owner-prefunded treasury
identity and bounded normal product budgets, with no legacy key loader or automatic
funding executor. A reviewed canonical policy binds the native storage identity,
origin, dedicated signer, lifetime cap, per-query cap and expiry. Sealed native
history permanently separates public and private signer roles across rotation.
Expiry ends new admission, not already signed vendor authority. SQLite commits the
complete original typed authorization before SDK signing and its header hash and
submission marker before any paid HTTP call. Policy renewal retains cumulative
signer exposure; unknown outcomes never restore it. Public and private hosted
signers remain separate, and private creator confirmations retain their existing
private journals without leaking payments into the public ledger. Native synthetic
acceptance exercises the installed SDK, concurrent capacity and response loss;
owner-selected operating policy and prefunding remain release decisions. No
funding, activation, deployment, autonomous scheduling or XSS-proof custody follows
from this preparation. See [full server migration](docs/mainnet-server-runtime.md).

**Showcase extraction maintenance** - *2026-10-02*

Maintain the standalone Arc primitives alongside relevant upstream changes as a small,
independently reviewed and versioned extraction. Require durable host journal contracts,
exact payment identity and retained uncertain outcomes; do not port application custody,
recovery services or unfinished mainnet authority wholesale. Pin a concrete upstream anchor,
verify its install/tests/package independently, then update the root gitlink and docs.
This preserves a useful forkable library without implying synchronized app/MCP/installer
runtime distribution. Maintenance is authorized session work, not an autonomous scheduler
or artificial activity. The 0.3 release has synthetic acceptance; funded, durability,
custody, reconciliation and finality gates remain explicit. See
[maintenance and surface boundaries](docs/arc-primitives-maintenance.md).

**D-296** - Pilot one bounded Research Monthly plan - *On 2026-10-02 the user
confirmed four requests/month at 10% below buying four separately.* Use four Deep
v1 requests over 30 days from confirmed Arc-testnet purchase, with manual renewal
and a creator cap pinned at purchase. Absorb the total-price discount in Keryx's
service allocation and round upward to equal integer micro-USDC allocations;
refuse configurations that consume creator reserves. This does not establish
profitability. Confirmed settlement activates the entitlement; atomic slot/order
admission and exact request replay prevent duplicate downstream spend. Failed or
pending jobs retain their slots, so promise requests rather than successful reports.
Bind every public seller debit before settlement by network, asset, payer and nonce,
with exact purpose, payee, amount and request/resource data. Monthly additionally
requires a server-random nonce issued durably for that exact purchase before signing,
excluding historical external seller debits that were never recorded locally.
Its short challenge admission expiry does not shorten Circle's multi-day signature
validity; the durable submitted boundary retains uncertainty beyond challenge expiry.
Ambiguous claims stay
retained; one debit cannot buy two products. No mainnet, recurring debit, scheduler,
unlimited plan or private-research entitlement. Web/API are authority; local and
MCP surfaces use explicit shared API or handoff boundaries. Disabling admission
preserves recovery; old claim-bypassing seller rollback is forbidden. See
[Research Monthly](docs/research-monthly.md).
**Original public research admission** - *2026-10-02*

Treat free original-document selection as bounded preview ranking, distinct from
cached creator/feed reuse. A heuristic positive topical proposal around EV .13
must not be reinterpreted as a cached-content proposal requiring .45 before any
read. Use the existing positive-preview .12 floor for public originals, preserving
raw ranking scores, positive proposals, claim targets and portfolio/read bounds.
Do not uplift model scores or promote SKIP. Only extracted, version-bound content
can qualify for answer evidence; public originals confer no payout authority.
Resolve at most two explicit modern versioned arXiv targets with exact provider
version matching. Missing provider/read availability stays visible. Empty answers
use recorded failure details and targeted next steps, never an invented claim that
more source USDC repairs a free gate. See [issue #128 evidence and remaining gates](docs/engineering/research-attention-2026-10-02.md).
Reversible: restore the public ranking floor; retained receipts and read provenance
remain unchanged. Live useful research and separately authorized payment evidence
are acceptance gates, not inferred from synthetic checks or public paper availability.

**D-295** — Reasoning — *Cloudflare Workers AI is an explicitly enabled experimental third provider* — *2026-10-02*

Add account-restricted Workers AI inference through the existing OpenAI-compatible transport,
shared model catalog, timeout, durable provider/step circuit and usage ledger. DeepSeek remains
the default; Cloudflare follows DeepSeek and MiMo in the public fallback chain. Credentials alone
do not enable a new processor. The operator must explicitly enable it and include it in any
configured provider allowlist. The buyer-approved private policy remains restricted to its
existing providers and never inherits this public fallback.

Choose Llama 3.3 70B FP8 fast for bounded experimental use after direct English and Vietnamese
synthetic smoke checks. Refuse UTF-8 input bytes plus requested output above 23,000 before HTTP,
leaving framing headroom below the documented 24,000-token context. Do not truncate evidence.
Redirects are prohibited; quota exhaustion, invalid/truncated JSON and provider errors remain
visible failures handled by the existing bounded resilience policy. A healthy primary sends no
Cloudflare requests. This is not broad quality parity or promotion to primary.

Capture the observed gross token tariff with each request; free Neuron allowances, remaining
quota and billed invoices are unknown, never inferred as zero. Keep the existing free account
plan for this deployment and do not upgrade billing automatically. Use a restricted API token,
never deploy an interactive CLI OAuth/refresh token. See [provider setup and evidence](docs/cloudflare-workers-ai.md).
Reversible: disable the provider and remove it from the public allowlist; historical usage retains
its immutable tariff policy. No payment authority, mainnet activation or background scheduler changes.
## Full public mainnet storage and recovery — 2026-10-02

An unsigned session withdrawal has a retained pre-crypto exposure transition. The
normal worker must acquire the server marker before signing; submit requires it.
Owner cancellation is atomic only before that marker, signed request and transfer
claim, retains the cancelled original salt, and cannot revive that request. Local
worker cancellation also requires no local cryptographic exposure. Uncertain or
signed originals never release by time or empty vendor lookup. This lets an owner
decline an unsigned withdrawal without retiring the stable funded signer.

The owner requested the normal public product on mainnet, superseding the invited
pilot proposal. The current production backend is SQLite, so the public release
targets a fresh sealed mainnet SQLite namespace on the existing deployment while
retaining testnet state and custody separately. Optional Supabase mainnet remains
closed until its independently source-generated PostgreSQL schema and concurrent
writer acceptance pass; it does not block the ordinary SQLite release.

Session cashout authenticates retained owner and signer proofs after payment
expiry or revocation. An unsigned original preparation reserves capacity and
pauses new payment admission in one native transaction. That transaction compares
confirmed lifetime debits as well as pending holds, including changes after the
last quote read. Signed burns and matched attestations reuse the existing creator
withdrawal journal. Unknown outcomes retain the original request and liabilities;
only an exact owner mint with canonical selected-chain receipt/finality evidence
releases the withdrawal barrier. Original nonces and lifetime payment consumption
remain, so the stable signer can fund and renew rather than being retired.

Ordinary creator cashout uses its connected owner wallet for burn consent and the
mint transaction's gas; a custodial relay is a separate optional operator role.
Its signed original admission compares all retained local liabilities and confirmed
debits atomically with the fresh quote. Recovery never repeats a vendor burn, and
only an exact observed owner mint releases that original withdrawal hold.
Hosted mainnet payments use an independently sealed, owner-prefunded treasury
identity and bounded normal product budgets, with no legacy key loader or automatic
funding executor. A reviewed canonical policy binds the native storage identity,
origin, dedicated signer, lifetime cap, per-query cap and expiry. Sealed native
history permanently separates public and private signer roles across rotation.
Expiry ends new admission, not already signed vendor authority. SQLite commits the
complete original typed authorization before SDK signing and its header hash and
submission marker before any paid HTTP call. Policy renewal retains cumulative
signer exposure; unknown outcomes never restore it. Public and private hosted
signers remain separate, and private creator confirmations retain their existing
private journals without leaking payments into the public ledger. Native synthetic
acceptance exercises the installed SDK, concurrent capacity and response loss;
owner-selected operating policy and prefunding remain release decisions. No
funding, activation, deployment, autonomous scheduling or XSS-proof custody follows
from this preparation. See [full server migration](docs/mainnet-server-runtime.md).

**D-294** — Browser custody — *An isolated candidate session authenticates its exact identity before derivation* — *2026-10-02*

Provide dormant browser-worker building blocks that verify the intended wallet's
signature of a readable message containing the exact static network, origin, owner,
candidate digest, epoch, per-payment cap and signing expiry. Salt key derivation with
that identity; do not migrate or reuse the funded legacy testnet message/key. Bind
the wrapping-key namespace and AES-GCM additional data to the same context and derived
address. Context changes require an explicitly new funded identity; retained expired
context can be recovered but cannot sign new payments.

Capture policy and authoritative payee provider once, snapshot payload/ciphertext
before awaits, and enforce lifecycle exclusion so logout cannot race a restored signer
or wrapping-key deletion. Existing public workers remain testnet; these helpers alone
confer no runtime invite, nonce, lifetime cap, registry, RPC or settlement authority.
Synthetic native signature/encryption tests are not packaged-worker/IndexedDB acceptance.
See [dormant signer boundary](docs/mainnet-runtime-domains.md#dormant-isolated-signer-component).
Reversible: easy before enrollment; after funding, the exact context must remain
recoverable and changes require a separately reviewed custody migration.

**D-293** — Mainnet preparation — *Public dual-network pins do not confer runtime authority* — *2026-10-02*

Centralize immutable Arc testnet and mainnet public profiles without an environment-
controlled browser signing policy. The deployed testnet configuration, browser header,
worker policy, server verifier, seller and reconciler retain explicit testnet selection;
the payment-runtime selector refuses mainnet until dependent domains pass their own
cutover. A mainnet reference is useful for candidate/preflight preparation, but official
addresses and observed code presence cannot authorize spending, import testnet payout
authority, enroll a database or reuse a browser session key.

The narrow intended migration is an isolated invited browser-funded `/api/ask` pilot.
Externally pre-funded sessions can stage it without activating automatic funding or
treasury-sponsored MCP, A2A, bots or autonomous work. Network-bound session identity,
durable journal/environment isolation, creator registry authority, SDK settlement and
recovery still require code, adversarial checks, operational evidence and a concrete
owner launch decision. See [runtime domain gates](docs/mainnet-runtime-domains.md).
Reversible: easy for static pins; real network cutover requires separate reviewed
migration and rollback evidence. This slice does not claim mainnet readiness.

**D-292** - Operations - *Caller-driven research can be idle; provider probes must use runtime transport policy.*
D-237 removed continuous self-generated research, so completed-query inactivity no longer
asserts a scheduler failure. Preserve explicit expected-dispatch monitoring only for an
independently configured schedule; the flag grants neither scheduling nor spend authority.
Keep reasoning anomalies and failed/pending real payment legs actionable, count completed
zero-spend answers, and label completed receipts rather than settlement. A shared catalog
constructor prevents watchdog probes losing DeepSeek vendor options while runtime picks
retain them. Failed synchronous requests before a receipt remain an explicit telemetry gap;
A2A worker/queue and settlement checks keep their independent responsibilities. Reversible:
easy (monitoring and shared construction only; no payment authority or scheduler changes).

**D-290** — Preserve treasury custody rather than replacing unavailable keys — *2026-10-02*

The reachable server gateway previously caught every wallet read/parse error and
generated a replacement, overwriting malformed existing custody and allowing
concurrent bootstrap races. Require a bounded read of the existing legacy wallet,
matching derived address and retained regular-file identity before constructing
any signer or SDK/funding client. Never create, repair or mutate wallet state from
runtime admission. Reconciliation and acknowledgement share this identity parser;
public balance metadata remains a read-only display boundary.

Existing valid files remain compatible. Missing custody requires owner recovery;
a genuinely new isolated testnet deployment needs separate deliberate provisioning
and private host permissions. Do not infer unused-key history, global nonce
exclusivity, Windows ACL enforcement or mainnet authority from a successful load.
Synthetic native/process evidence and independent release review remain required.
Reversible only through a reviewed custody migration; restoring automatic key
replacement is not a supported rollback. See [treasury custody](docs/treasury-wallet-custody.md).

Retire the legacy environment wallet generator as part of that same custody
boundary: it printed both new private keys and replaced existing environment
custody using obsolete buyer labels. Its help and refusal perform no key creation
or private file access. Deliberate owner-managed role-specific environment setup
and recovery remain separate; a demo convenience cannot replace funded history.

**D-291** — Bind the actual signed treasury operation independently of RPC preparation — *2026-10-02*

A synthetic actual-SDK reproduction demonstrated a foreign-chain transaction
signed after a successful testnet preflight. Freeze the caller's exact operation,
validate the provider's fill and prepared signature input, then verify the raw
sender/tuple before a single broadcast. Keep private keys out of SDK transaction
delegation; independently restrict SDK batching typed-data callbacks. Reuse the
current balance reader and exact approve/deposit operations rather than activate
the dormant funding or storage stack.

Retain post-submit and missing/mismatched receipt uncertainty with the original
hash. A funding instance keeps its first same-budget outcome, including failure;
it cannot silently retry or change caps. This is not durable global nonce/spend
admission or restored-key authority. Supported local transaction scripts share
the guard, treasure-hunt needs an explicit payee and unrestricted legacy live
withdrawal is retired in favor of the separately authorized durable workflow.
Native synthetic checks, review, release and independent M2/M4 acceptance remain
distinct. See [treasury transaction isolation](docs/treasury-transaction-isolation.md).

**Supervised scholarly rights are signed version authority, separate from wallet payment authority** — *2026-10-02*

The owner authorized implementing opt-in research-author payments and creating a separate
local reviewer wallet. Reuse the creator-controlled registry, SIWE, signed encrypted content,
browser journal and x402 rails. A dedicated one-item source first receives a sticky draft
restriction, then an immutable creator declaration and independently allowlisted signed operator
decision. DOI metadata, author names, feed control and developer roles confer no distribution
approval or payout authority. Local review keys remain only in ignored operator environment;
the application host receives a public allowlist and detached artifacts.

Start with the deployed legacy SQLite backend and funded browser journal. Atomically bind
the effective approval, exact version and fresh single-recipient registry policy to the original
nonce and cap reservation before exposure. Revocation serializes against new admissions and
does not replace exposed authorizations, release unknown spend or reverse settlement. Sellers
reject legacy bundles, arbitrary SDK/treasury admissions and unsupported backends for enrolled
manuscripts. Preserve unrelated legacy sources and exact enrolled native schema/cutover gates.
Install scholarly schema only atomically with the first author enrollment, preserving ordinary
corpus intake compatibility; an actual scholarly corpus remains outside native cutover acceptance.
Bound the corpus to four effective operator approvals; unreviewed drafts and DOI claims cannot
squat approval capacity or namespaces. Duplicate effective approved offers need review before
activation; an actual identical public body prevents duplicate paid access/rewards.

Public license/version/review summaries and receipt approval references exclude private
permission evidence and contact data. Approval is distinct from settlement and peer review.
This software release does not claim a live participant or funded scholarly pilot. Broader
identity, public policy/privacy/appeals, multi-author splits, backend parity and live recovery
evidence remain open; mainnet and real funds need separate authorization. See
[paid scholarly papers](docs/paid-scholarly-papers.md) and the
[review procedure](docs/scholarly-pilot-review.md). Reversible: disable new scholarly research;
preserve sticky enrollment, signed history and outstanding payment reservations.

**Observed scholarly metadata with separately grounded paper reads** — *2026-10-01*

The owner requested DOI integration and scholarly repositories, then supported
developing payments for research authors who choose to join. Ship the bounded
public discovery/read slice first: exact Crossref DOI matching, opt-in Crossref
bibliographic/arXiv search, and provider metadata snapshots bound to selected
original reads. Prefer exact versioned arXiv PDFs; retain byte/page/text caps and
make a separately counted abstract-page fallback explicit. Metadata-only previews
cannot qualify as paper evidence, author control, distribution rights or payees.
Journal type does not establish peer review; preprint and read limits remain visible.
For grounding confidence, observed shared-DOI work links conservatively merge existing
publisher groups without discarding exact versions or treating distinct works on one
domain as independent publishers. Metadata links can only reduce apparent diversity;
missing DOI is not guessed, and grouping does not prove scientific independence.

Preserve supplied structured Crossref author names, repository versions, observation
time and read scope in citations, receipts and browser BibTeX/RIS. Never infer DOI,
authors, journal or rights from a model answer or silently enrich archived runs.
Reuse public document transport, literal evidence and creator payment gates. Private
jobs and unattended engines make no new scholarly calls. Process-local vendor
pacing and shared operation/read caps fail gracefully without queues or retries.

The author-earnings direction needs independent identity, version-specific rights,
coauthor consent and payout acceptance gates before opt-in registration can earn.
Existing feed control and DOI metadata cannot substitute for them. The staged
[paid scholarly paper plan](docs/paid-scholarly-papers.md) remains proposed; this
release adds no author-claim payment flow. Reversible: remove discovery and display;
optional observed metadata remains readable without changing payment authority.
See [scholarly research](docs/scholarly-research.md).

**D-289** — Admit the complete application backend before issuing private delivery evidence — *2026-10-01*

A verified connection or a caller-supplied adapter does not establish which
deployment owns the retained payment original. Add closed runtime factories that
derive the pinned deployment manifest themselves and publish the complete reviewed
database interface only after actual identity and schema readiness checks. Keep
provenance private to the factory; an object shape, copied facade or ordinary
adapter cannot qualify. The existing deployed selector remains authoritative until
a separately verified domain cutover.

Share existing adapter business logic instead of copying its method surface.
SQLite composes the admitted native connection with an exact application schema
profile. PostgreSQL uses fixed identity-checked domain RPCs and protected writer
capabilities; an enrolled call never executes the legacy raw-client closure.
Guard computed results, early returns and iterator publication as well as SQL.
For enrolled browser admission, read source, item and current offer through one
private fixed protected catalog statement. Native evidence showed separate full
checks exhausted the existing five-second observation lifetime. Preserve that
lifetime and all identity, schema, registry, version and admission checks; reduce
independent catalog reads instead of extending authority freshness. The coherent
snapshot does not remove the later catalog-to-admission race. Regenerate the
independent SOURCE profile and verify the complete native workflow before cutover.
Read-only access denies every reviewed mutator, including methods that update
usage while checking credentials. Initialization inspects readiness and never
migrates, repairs or normalizes historical authority.

Use a distinct authenticated cache envelope bound to source, complete storage
identity and format, including both wrapped key and body. Preserve the legacy
envelope semantics. Cache bounds must survive atomic writes and restart, and
cache membership supplies no paid-read or article-version provenance. A guard
failure after a committed write requires reconciliation; it cannot imply rollback.

This is staged source work, not enrollment, private delivery issuance, selector
activation or mainnet authorization. Native backend, role, race, recovery and
deployment evidence remain explicit gates. See
[enrolled runtime backend acceptance](docs/enrolled-runtime-backends.md).

PostgreSQL snapshot CAS excludes only the relation maintenance fields
`relpages`, `reltuples`, `relallvisible`, `relfrozenxid` and `relminmxid`.
Native diagnostics found changes within these fields while logical rows,
sequences, other catalog records and normalized schema stayed identical around
a successful READ ONLY transaction. Retain relation OIDs, file mappings,
structural metadata, privileges and retained data in the CAS. A maintenance
update must not invalidate an otherwise unchanged financial-state review.
Frozen profiles come from a separate source reference; a deterministic source
function edit still requires fresh native PRE/POST equality before enrollment.

**D-288** - Reuse recorded research for academic and technical/market workflows -
*The user selected both researcher segments; existing receipts and claim evidence
were useful but did not provide reference-manager imports or a comparison export.*
Add browser-local BibTeX/RIS references and a claim-by-cited-source evidence matrix
with spreadsheet CSV to the shared web reading. Export only already recorded article
identities and bounded citation-matched excerpts. Omit missing article identities,
retain distinct versions, and never infer authors, DOI, journal or peer-review status
from a registered publication or generated answer. Missing excerpts are inspection
gaps, not truth or conflict verdicts. Keep payment and receipt authority unchanged.
Scholarly metadata enrichment and account synchronization remain open work, not an
academic-complete claim. Reversible: remove the browser export surfaces; no stored
run, payment or receipt format changes. See [researcher exports](docs/researcher-exports.md).

**Chat-first research with visible spending and inspectable evidence** — *2026-10-01*

The owner approved making a conversation the primary research interface. Lead with
the question and a few starting examples, then present the structured cited report
in the conversation. Keep previous turns available during the tab session, with a
compact research status and expandable decisions, source evidence and payment trace.
The question's source-USDC cap and payer remain visible beside the composer; model
and budget controls may be secondary, but settled, pending and simulated amounts
must remain distinguishable.

The rotating globe is the owner's confirmed signature for Keryx. Simplifying the
chat must preserve that identity: reuse the existing locally bundled globe as a
bounded decorative header motif on desktop and mobile, leaving text and controls
clear. Keep reduced-motion behavior and avoid restoring a large masthead that
pushes the question, cap or send action out of the initial reading flow.

Use the existing previous-run anchor for follow-ups rather than promising full chat
memory. Starting a new research topic must clear that anchor. Copy or export must
retain citations and the observed evidence/payment limitations. Stopping the client
stream does not establish a refund or the final state of submitted payments.

Stopping and submitting again makes obsolete asynchronous error-body completions
reachable. Guard client updates by request identity after asynchronous reads, while
keeping the existing signing-budget identity gate and durable reservation authority.

Use the same chat surface on the home page and `/research`, keeping the existing
paid-package, recovery and private-job workspace accessible as a secondary section.
This is a presentation change: package terms, session grants, signing, source-owned
payout authority and backend evidence gates remain authoritative. Responsive and
synthetic browser behavior, relevant tests, production build, review and deployment
are implementation gates; the approved direction alone does not establish delivery
or improved user adoption. See [research reading UX](docs/research-reading-ux.md).

**D-287** — Separate Circle API observations from citation payment authority — *2026-10-01*

A seller response header and a database settled flag cannot independently prove
that the buyer's exact authorization settled. Add a dormant read-only observer
that obtains the coherent retained original from the installed backend, verifies
its owner query proof, and compares a bounded native Circle API response with
the exact nonce and economic tuple. A header UUID remains a lookup hint. Bind
the opaque result to that original and runtime adapter; do not invent an
enrolled storage identity or independent ledger proof.

Retain all provider statuses honestly and label the basis as Circle API, with
chain finality unverified. Bound total requests, streams, pagination and
concurrency. Token lifetime begins at the actual matching observation; later
backend reads cannot refresh it, and a caller timeout cannot release a slot
while underlying work remains. This does not change payment journals or caps.

The future buyer-owned provenance issuer must combine actual delivery with
approved settlement evidence and private artifact publication. External creators
must not need to share a seller artifact key or internal callback. Citation
eligibility, current private access and mainnet/finality policy remain separate
owner-approved gates. See [Circle observation scope](docs/browser-x402-observation.md).

**Question-driven broad web research with observed document evidence** — *2026-10-01*

The owner authorized expanding research beyond Keryx's small registered/public-feed
catalog. Discover documents through an operator-configured search provider, read
selected original content under deterministic limits, and retain claim-linked evidence
from the actual extracted text. Search snippets are previews, not read documents.
Public web evidence remains free of creator payout authority; paid source decisions,
ownership, signing, budgets and settlement retain their existing safeguards.

Require document identity/version and observation provenance through synthesis,
receipts and UI. Exclude identical extracted bodies and avoid treating multiple
same-publisher URLs as independent corroboration. A registrable domain is a concentration proxy,
and a literal matching quote proves source grounding rather than universal truth.
Keep conflicting evidence, unsupported claims, extraction limits and provider failures
visible. Bound discovery, extraction, cancellation and portfolio computation without
silently weakening evidence or monetary gates.

HTML/text and contained PDF text extraction are staged implementation requirements;
unconfigured search or an HTML-only stage does not complete the authorized outcome.
Provider provisioning and actual broad-search smoke evidence remain release gates.
Pin the reproducible installer to npm 11.19.0 and CI Node 24.21.0. Clean npm 11.6
and 11.19 resolved incompatible optional-peer closures; an older-resolver lock also
upgraded an x402 dependency and failed the newer installer. Retain the existing
payment dependency versions and require matching installer tooling on production
before installation. Production Node 24.16 and minimum supported Node 22.19 do not
need to change for this installer correction.
Do not add a search subscription, spend real funds, activate mainnet, leak private
research or claim customer demand from technical fixtures. See
[broad web research](docs/broad-web-research.md) and
[product validation](docs/product-validation.md).

**D-286** — Require separate owner approval for citation rules — *2026-10-01*

The retained browser query-policy signature covers a question digest and spend
limits, not the citation pool, allocation, evidence validator or issuer. Keep
that v2 signature unchanged and add a separate versioned EIP-712 supplement
bound to its exact verified query policy. Require the owner to approve the actual
run budget, rational pool ratio, nearest-half-up micro-USDC rounding, maximum
pool, algorithm and trust-policy digests, nonce and expiry. Verification must
recover both owner proofs, reject mismatched trusted expectations and preserve
the existing run-budget basis. A pool exceeding the signed maximum refuses;
public and unproven shares remain withheld without redistribution.

The dormant policy primitive is only an approval verifier. Current grant access,
controlled paid-read provenance, encrypted private evidence, semantic issuer
trust, immutable pre-payment plans, unique author legs and atomic reservation
admission remain separate requirements. Quote occurrence and a content manifest
do not prove semantic support or paid delivery. Historical signer metadata
access does not imply permission to read the owner's question or paid bodies.
No route, signer, version floor, custody or mainnet cutover follows from this
change. See [citation policy and remaining gates](docs/browser-citation-policy.md).

**Observe creator registration before reporting success** — *2026-10-01*

Preparing the independent seller pilot exposed a presentation error: receiving a wallet transaction
hash was reported as successful on-chain registration, with indexing assumed after a
fixed delay. A returned hash does not prove mined registration. Observe a receipt on the pinned Arc testnet
client and require a successful `SourceRegistered` event from the expected registry,
source identity and creator. A successful replacement self-transfer is not registration.
Reverted, rejected, pending and unknown outcomes remain distinct; unknown submission
does not authorize automatic resubmission.

After the registration event, check the existing owner-only listing endpoint for the
same registry, creator and on-chain identity before reporting indexing success. Each
manual status check is bounded and performs no new registration. Duplicate submission
and stale completions are guarded. Retain ownership instructions and the one-time webhook
secret through observation; preserve the explicitly labeled offline path.

Creator feedback counts BUY/CACHE decisions and answer citations, independently of
settled payment records. Keep the historical API fields and count logic, but correct
their labels and comments so they cannot stand in for paid reads or citation earnings.
This changes observation and reporting, not registry, source ownership, payment or
payout authority. Synthetic browser acceptance is not a live registration, provider
adoption, independent settlement audit or mainnet authorization.

**D-285** — Retain verified source context before exposing a new browser original — *2026-10-01*

A separate signer cannot reproduce the deployed payee and creator-price checks
from an offer ID or Gateway economic tuple alone. Add an explicit original-format
union: preserve prior originals and exact callbacks, while new originals require
complete immutable fetch context verified against a trusted pinned registry
observation and, for discounts, the actual creator-signed article offer. Derive a
context digest bound to the nonce, namespace, query, request, epoch and economic
tuple; atomically retain it with the original and existing reservations. This
does not change the Gateway signature schema or prove article provenance to Circle.

Historical reads use retained evidence and admission time, never a mutable offer
join or invented backfill. Current registry/expiry checks belong to a separate
fresh-sign gate and may refuse without replacing the original. Keep the minimum
original version monotonic in the existing control/barrier: eventual cutover must
fence fresh incompatible admission and exposure even after rollback, while
already exposed historical originals keep exact callback eligibility. Installation
is inactive; no runtime activation issuer is supplied.

Fresh citation signing in the new lane requires a separately retained pre-payment
evidence and reward-allocation plan. Current completed QueryRun history cannot
reconstruct that authority, so missing citation evidence refuses rather than
becoming a new plan. That necessary next stage and full signer delivery remain
release requirements. Registry/catalog/service-role trust, signer verification,
custody/recovery, owner approval, hosting, UTC, external review and M1–M8 remain
open. See [original source context](docs/browser-original-source-context.md).

**YouTube public metadata as bounded free evidence** — *2026-10-01*

The first owner-selected research task is niche/idea exploration for an English-language
channel, tentatively for children. Age remains open; the owner requested comparison.
The registered corpus does not demonstrate YouTube trend coverage. A read-only audit
followed publisher links to official channel identities: Super Simple's feed returned
usable Atom metadata; Numberblocks returned an error and remains deferred. A working
feed proves availability, not independent demand, educational quality or market momentum.

Reuse the existing bounded DNS-pinned public-reference transport and separate free
snapshots. A dedicated adapter admits only the approved YouTube channel/feed identity
and canonical video links, then labels publisher titles, dates and descriptions as
metadata-only evidence. It must not fetch videos, transcripts or linked articles, infer
their contents, copy media assets, or introduce publisher payout/ownership authority.
Community statistics are not consumed in this increment; their presence in a raw feed
does not become an independently validated view count or growth metric.

Public-reference identity, captured versions, existing attention/context bounds and
reward exclusion remain authoritative. No payment row, creator registration, signer,
key custody, package terms or mainnet permission changes. Individual feed failures
remain isolated under existing ingestion rules. Discovery still selects at most one
item per reference, so this increment supports attributed descriptions of selected
uploads, not comparative channel research or a viral prediction service. Wider coverage,
usefulness to the actual creator and observed repeated use remain acceptance work.

**D-284** - Authenticate historical original observation without exposing prepared authorizations - *2026-10-01*

Use a separate, fixed-audience EIP-712 GET proof from the session signer to authenticate a narrowly scoped original observation. Recover the signer before reading, derive its historical owner from retained authority, and validate the original and both owner policies in one coherent backend snapshot. Return originals only when the journal records prior exposure: exposed, signed, submission-attempted or an exposed terminal state. Prepared and cancelled-unexposed records must reveal no nonce or authorization tuple; GET never marks exposure or releases capacity. Keep the trusted owner reader separate from this credential.

Bind the proof to the exact method, path, session, request and fresh challenge with a five-second server window. Bound the complete client exchange using monotonic and wall elapsed time, recheck proof expiry after the backend read, and retain concurrency slots until timed-out backend work actually settles. Captured proof replay within its short window remains possible. A historical signer key may authenticate already exposed history after grant replacement or revocation; that privacy policy needs production review. Observation is historical evidence, never permission to sign or a revocation barrier.

This source stage installs reusable helpers and protected backend reads only. It adds no public route, live worker integration, custody issuer, activation or production deployment. Pinned HTTPS and clock echoes do not establish independent asset integrity, key custody, absolute UTC accuracy or exclusive restored authority. Real origin/mobile acceptance, funded recovery and independent security review remain release gates; mainnet authorization is unchanged. See [original observation](docs/browser-original-observation.md).

**Product validation: research outcomes and information-selling infrastructure** — *2026-10-01*

The owner authorized a focused evaluation of both directions beyond bounty preparation.
Research must demonstrate a useful outcome for an independent participant; infrastructure
must demonstrate an independently maintained seller integration and genuine buyer use.
Neither code capability nor owner-generated testnet volume establishes demand. Start with
small experiments over existing rails rather than a broad marketplace or new payment
authority. A narrow research application can serve as a reference client, but each side
needs its own evidence before becoming the primary business direction.

Expose public source previews before a non-refundable research purchase so a participant
can judge apparent relevance. This is metadata browsing, not an answerability verdict,
ownership attestation, payable-source guarantee or automatic purchase. Keep source rights,
sponsorship, testnet use and payment uncertainty explicit. Existing Operator work and
mainnet gates remain staged; no price, authority, funds or launch permission changes.
See [product validation](docs/product-validation.md) for experiments and direction gates.

**D-282** — Separate browser elapsed time from server UTC expiry — *2026-10-01*

Browser clock skew must not determine whether a server-prepared unsigned withdrawal or a server-issued login date is usable. Bound withdrawal request age with monotonic elapsed time while retaining the abort, original selected policy and server chain-height checks. Issue dated SIWE challenges from the server, preserve the five-minute single-use challenge and existing session lifetime caps, and leave server JWT/database expiry authoritative. Echo the exact retained grant expiry once; derive an advisory client deadline from bounded server remaining duration minus the full request time. Read-only focus/visibility checks may clamp that deadline or pause the UI, never renew the grant or reset financial capacity.

Browser monotonic clocks and timers can pause during operating-system sleep. These UI bounds do not replace trusted server UTC, chain/vendor expiry or the signer's independent payment lifetime checks. A failed status read retains the key, original nonces and funded balance; an invalid supplied spending session must not become treasury spending. Host synchronization and the remaining payment-signing clock boundary require independent acceptance. No clock mutation, freshness relaxation or mainnet authorization follows from this decision. See [account sessions](docs/engineering/session-management-2026-09-09.md) and [withdrawal recovery](docs/creator-withdrawal-recovery.md).

**D-281** — Bound offline SQLite provenance capacity with actual Linux process containment — *2026-10-01*

Keep the existing 64 MiB intake profile and add an explicit operator-declared offline snapshot profile for larger stores with substantial unselected content. A 512 MiB physical ceiling alone does not contain native SQLite work. Stock Node disables SQLite memory accounting, so reporting `hard_heap_limit` does not demonstrate enforcement. Use a fixed Linux systemd transient child with verified cgroup-v2 memory/swap/task limits, private network, no new privileges, and a service runtime limit instead. Sanitize the manager environment independently of the parent's environment. Refuse the larger mode on unsupported platforms or unavailable containment; do not weaken selected-evidence bounds or spill to disk.

Before target open, verify the actual child unit/cgroup. Retain the canonical file descriptor, finalized rollback-journal header geometry, size/mtime checks, and sidecar refusal; return no report until the captured transient unit is cleaned up. The operator declaration does not prove offline ownership, historical origin, settlement authenticity, or enrollment authority. Preserve `unknown_legacy` and all M2/mainnet gates. Dedicated hosted Linux acceptance must prove realistic synthetic capacity, actual native-memory OOM refusal, unchanged bytes/evidence, and cleanup; Windows boundary tests do not replace that evidence. No production snapshot, intake, migration, or enrollment is authorized by this change. See [provenance intake](docs/storage-provenance-inspection.md).

**D-283** - Admit immutable browser signing originals under independently signed query policy - *2026-10-01*

Extend the existing browser authorization journal rather than introduce another payment ledger. Before exposing a new authorization, atomically retain its full original tuple, fixed UTC window, query binding, payment and existing signer/epoch reservation. The new callback verifies the actual ECDSA signature and canonical complete header; metadata-only callbacks cannot record or replay v2 originals. Preserve historical legacy callbacks without inventing missing original windows or hashes. This guarantees a retained authorization identity, not one signature computation or exactly-once external settlement.

Verify a separate owner-signed EIP-712 query policy with a fixed service audience, signer, grant epoch, question digest, nonce, expiry and integer limits. Retain cumulative allocation and job count in an owner/signer/service/network namespace across aliases and grant replacement. Later approvals specify absolute ceilings rather than additional capacity. Query allocations and consumed policy capacity are conservatively never released in this stage. A coherent read validates both the original query approval and the latest namespace ceiling approval; a newer ceiling is not attributed to the old proof.

Install this backend candidate inactive, with no activation issuer, public observation route or production signer integration. After activation, a permanent barrier prevents fresh admission through old writers, while historical callbacks remain available. PostgreSQL service-role composition remains trusted to verify signatures. Actual PostgreSQL and both-platform synthetic acceptance are required receipts, not evidence of production activation, exclusive restored authority or independent users. Separate-origin signer custody, trusted owner approval, live clock validity, funded recovery, wallet/mobile acceptance and independent security review remain release gates. Mainnet authorization is unchanged. See [browser signing originals](docs/browser-signing-originals.md).

**D-280** - Integrate funding source while retaining deployed storage authority -
*The reviewed staged funding implementation depended on a strict application
storage cutover whose trusted legacy enrollment and production drain gates are
still open.* Gather its unused policy, canonical transactions, corroborated
receipts, preflight/readiness, one-shot executor, bounded orchestrator and
keyless inspection with isolated journal helpers in a main-based source release.
Existing application adapters, DB selector and RealGateway retain their deployed
behavior. Candidate PostgreSQL authority SQL lives only in isolated test fixtures,
outside deployment migration discovery.

The Operator composition is explicitly disabled and refuses before caller
binding inspection, dynamic executor import or key loading. No environment flag
creates authority, and this release supplies no activation issuer. A separately
reviewed issuer and enrolled binding, trusted key/history intake, paused/drained
cutover, both-backend acceptance and identity-aware restore/rollback remain
required before runtime prefunding integration. Synthetic fixture evidence does
not authorize production enrollment, funding or mainnet. See
[dormant funding release](docs/gateway-funding-dormant-release.md).

**D-279** - Preserve public research while funding readiness is unknown -
*An initial mixed public/owned portfolio previously lost all usable public evidence when wallet funding threw before gathering.* Treat an initial or lazy funding failure as query-local uncertainty: withhold owned BUY/CACHE reads and creator rewards, retain planned fetch reservations, and continue bounded free public evidence gathering and synthesis. Do not retry funding during the run or convert funding exceptions into creator payment records. Future gap selection considers only eligible public references after the failure.

Persist the uncertainty in the existing trace and final answer, and distinguish measured creator payments from unknown wallet funding effects in the completion message. Keep the planned portfolio as historical planning and report the actual evidence outcome. If no usable public evidence remains, return an explicit unsupported answer rather than inventing support. Explicit AbortError cancellation still propagates before further reasoning or persistence.

This improves degraded query behavior; it does not establish zero wallet movement, release signer capacity, reconcile an original deposit, or authorize another paid attempt. Funding recovery and mainnet acceptance remain separate gates. Reversible: revert this query policy without modifying retained payment history.

**D-274** - Enforce canonical session-worker signing semantics -
*Contract destination alone is not transaction authority: a call to USDC may transfer
or approve an attacker.* Pin the worker's public Arc-testnet policy independently of
server configuration. Permit only canonical USDC approve to the pinned Gateway and
Gateway deposit of pinned USDC, zero native value, exact chain/sender and supported
integer fee fields. Reject extra calldata, unsupported transaction features and
arbitrary typed-data schemas/domains before any signature. Gateway batching payments
retain exact TransferWithAuthorization fields and bounded current validity; the
worker's registry payee check remains additional to per-source browser checks.
No server journal, nonce admission or retained-epoch accounting is changed.
The existing budget plus 0.01 native-USDC funding buffer is not a durable lifetime
gas ledger: repeated allowed calls can burn funded gas. The one-time wallet
signature still crosses the page and derivation-time XSS can reproduce the key.
Internal fixture tests and build validation are remediation evidence, not an
independent audit, funded drill or M3/mainnet acceptance.
See [security review scope](docs/engineering/mainnet-security-review-scope.md).


**D-273** - Rehearse creator withdrawals with retained originals and an isolated funded relay -
*Funded recovery evidence must exercise the protected admission, original Circle claim,
saved mint identity and cash-out ledger without enabling production withdrawal creation.*
Use an explicitly bounded Arc-testnet operator rehearsal, with buyer signing on its
original PC environment and a fresh dedicated relay key retained only on Linux. Persist
the unsigned draft before review, one signing attempt before the signature, one Circle
claim before transport, and exact signed mint bytes/hash before broadcast. Discard the
application response only after attestation storage and the mint RPC response after one
actual broadcast. A new keyless process reconciles that same original and idempotently
records its cash-out; this never becomes another payment or creator-revenue claim.
Current Circle metadata spells the domain-26 chain `Arc`; accept that spelling and the
legacy `ARC` while preserving exact testnet/domain/contract/token checks and height caps.
The documented API cannot recover an original transfer UUID from its spec hash, so a
Circle response lost before UUID retention remains an explicit vendor-evidence gate.
Absence, expiry and restart grant no permission to POST or sign another authorization.
See [funded withdrawal rehearsal](docs/engineering/creator-funded-withdrawal-drill.md).

**D-272** - Journal browser authorization before exposure and retain signer capacity through recovery -
*The legacy live path reserved a grant, let the browser choose a nonce, and inserted its
payment record after signing/submission; timeout or lost callback could release an
authorization that still existed outside the process.*
Atomically bridge admission to the authoritative `payment_events` row before SSE,
then conditionally record exposure, verified signature metadata and submission intent.
Sign the admitted server nonce exactly. Persist no signature header or key. Only
confirmed prepared cancellation releases locally; exposed rows remain reserved until
exact Circle terminal failure. Retain original epochs and cumulative consumption per
normalized signer across recovery, aliases, expiry and revoke. Budget remains a
cumulative cap: recovery credits only exact, deduplicated confirmed consumption when
comparing it with independently observed remaining Circle availability; pending or
unknown exposure is never available credit.
Schema installation remains inactive. A testnet-only operator activation requires
draining/replacing all old writers, protocol-compatible clients and independent
candidate acceptance. Persistent database fences reject old financial writes;
rollback preserves the schema and journal with signing paused. Historical missing
nonces are not reconstructed. Callback recovery acknowledges metadata without an
autonomous paid retry. Conservative unresolved holds can remain indefinite.
Signature metadata recovery uses the immutable admission time and original challenge bounds,
including at most 300 seconds of initial signing latency. Identical callbacks may be
acknowledged after hours or expiry without resubmission. Expired or not-yet-valid headers
cannot resolve a live signing slot; delivery also requires the original slot and current
grant, and the gateway checks current validity again before submitting payment.

Synthetic acceptance is neither a funded drill nor M3/M4/mainnet authorization.
See [cutover and recovery](docs/engineering/browser-authorization-cutover.md).

**D-271** - Public RSS references are free answer evidence, separate from creator payout authority -
*Adding independent and official public feeds must not assign Keryx wallets to publishers
or imply an ownership agreement.* Store validated, bounded feed snapshots in a separate
SQLite catalog with no payout/verification fields. Read selected public items through the
same attention and evidence gates as paid sources, but never route them through paid
storage, registry terms or gateway calls. Separate answer support from reward eligibility.
Allocate original citation weights in exact micro-USDC and withhold public shares instead
of inflating owned rewards. Reserved public IDs fail closed on every toll path. One combined
hourly upkeep cursor retains the two-feed allowance across both catalogs. Supabase public
writes remain unsupported until equivalent schema acceptance. The initial four-feed batch
is explicitly imported after release; Circle RSS is deferred after the checked endpoints
returned 404. Public collection dates never replace publisher dates. Reversible by
deactivating public references; historical runs retain their original evidence snapshots.
See [free public references](docs/public-reference-sources.md).

**D-270** - Cloudflare Free schedules bounded RSS upkeep; the VPS retains content and payment authority -
*A September 30 production audit found 13 refreshable sources but no active feed-refresh
schedule; historical volume-daemon references did not keep the source corpus current.*
Use a dedicated hourly Worker to make one authenticated fixed-endpoint maintenance call.
The VPS atomically consumes an hourly SQLite allowance and durable round-robin cursor
before fetching at most two verified active feeds, with bounded input, deadlines,
rechecked eligibility and encrypted local storage. Failures do not retry within the
hour or starve later feeds. Cloudflare receives counts only; it does not fetch source
URLs, store paid content, index registry payout authority, sign, spend, or settle.
No Workers Paid subscription is enabled or required for this increment. This is orchestration and
source freshness, not a general background-job migration. Supabase admission remains
unsupported until equivalent atomic claims exist. Removing the isolated cron and
revoking its dedicated secret rolls it back without altering stored articles or payments.
See [scheduled source upkeep](docs/cloudflare-source-upkeep.md).

**D-269** - Capture provider price observations per call and keep uncertain costs as intervals -
*The economics observer applied an August 29 rate table to every matching wire model,
including untagged history, after the supplier changed prices and Flash routing.*
Use a new observer/report v2 with locally captured request/response times, explicit
configured provider identity, requested wire model and a preserved price-policy
snapshot. The September 30 Flash observation records its source, date precision,
documented aliases and off-peak/peak rates; actual tariff effective dates and billing
window remain unknown. Reports use the full off-peak–peak interval, without inferring
holidays or supplier billing times. Future observations require new policy IDs;
historical captures are resolved through their retained registry entry, not the
current capture selector. Supplier Pro descriptions conflict, so Pro remains unpriced.

Retain August 29 v1 as a historical scenario and preserve saved v1 artifacts.
Untagged history stays unpriced; report time cannot supply missing per-call evidence.
Missing or inconsistent compatible-provider cache splits are `null`, while valid
input/output counters and answers remain usable. Correlated call coverage still
requires every provider call and rejects failed/incomplete work for pricing.

Cost and hypothetical margin bounds cover priced runs only. Hypothetical fees
separately identify all-sampled and priced-run cohorts. The whole-period LLM upper
bound remains unknown because the stored projection omits unsampled history and
does not prove complete billing coverage. Supplier invoices, fixed costs and realized
profit remain unreconciled/unknown; the infrastructure allowance is a scenario.
Keep actual operating observations private. This correction changes no model request,
payment authority, settlement, database schema or mainnet authorization.
See [the observer contract](docs/testnet-economics.md).

**D-268** - Stage atomic browser authorization admission before signing cutover -
*September 30 acceptance correction:* the first real PostgreSQL CI run rejected
the intent insert because JSON `created_at` text was not explicitly converted to
`timestamptz`. Migration `0068` replaces the RPC with the explicit cast, preserving
its invoker permissions and atomic grant reservation. Migration `0067` is retained
unchanged. The acceptance harness checks the persisted timestamp and malformed
timestamp rollback; PostgreSQL acceptance requires passing the corrected CI run.

*The live browser path can sign a nonce before there is a durable nonce-indexed
intent and cap reservation in one transaction.* Add an unused admission operation
to both database adapters. It generates a server nonce, validates the Arc testnet
payment tuple, and commits a `prepared` intent with exact integer micro-USDC cap
reservation atomically. SQLite uses `BEGIN IMMEDIATE` and WAL with connection-wide
`synchronous=FULL` because changing it inside the admission transaction is forbidden;
that raises commit I/O cost for the SQLite adapter but gives the journal the stronger
WAL durability policy needed for a future signer cutover. A process reopen test only
checks process-crash persistence, not power-loss durability.
Supabase uses a service-role-only function with one row update and intent insert in
one PostgreSQL transaction. Duplicate request or nonce insertion aborts the
reservation. The grant epoch and signer fence prevents a replaced grant from
admitting an old request.

The additive `browser_authorization_intents` table is **not** a second payment
ledger: it is not queried for settlement, reconciliation, metrics, or UI, and no
browser signing caller invokes the operation yet. `payment_events` remains the
only payment/recovery authority. This split keeps legacy pending rows and their
reconciler intact while the later cutover is designed. Before exposing a signature,
the next stage must bridge each admitted intent into the authoritative payment
event, implement durable phase/terminal transitions, disable incompatible rolling
writers, and prove no dual ledger gap. Existing grant expiry deletion and replacement
can still lose held-cap context; this slice does not change that policy. M3/M4
remain open. See [browser authorization design](docs/engineering/browser-authorization-durability.md).

**D-267** - Verify browser x402 callbacks against the live challenge before acknowledgement -
*The server previously resolved `/api/ask/sign` with any header for a known live
request, leaving cryptographic checks to the paid retry.* Capture the original
server-validated 402 requirements and grant signer in the scoped pending slot
before sending the SSE sign request. Before acknowledging or resolving a callback,
require a bounded canonical inner-only header, exact signer/payee/amount and validity bounds,
and recover the EIP-712 signer using the pinned Arc testnet chain, Circle batching
name/version and GatewayWallet contract. Reject a nested or extra payload because
the seller would select it instead of the verified outer fields. An invalid callback leaves the slot
unresolved for a valid response or its existing timeout. This is an in-process
testnet guard, not settlement evidence or a multi-instance broker.

The browser still chooses its own nonce after SSE delivery. Signature recovery
proves that nonce was signed, but cannot compare it with a server-admitted nonce,
prevent replay, or create the durable payment row needed after a crash. A timeout
or disconnect can still leave an unindexed signed authorization; this change does
not fix the reservation-release or recovery policy. M3/M4 remain open pending
atomic durable nonce admission, state transitions, funded drills and independent
review. See [browser authorization design](docs/engineering/browser-authorization-durability.md)
and [dated mainnet evidence](docs/engineering/mainnet-readiness-2026-09-29.md).

**D-266** - Pin browser x402 signing to the Arc testnet session and challenge -
*The browser previously accepted any parseable `eip155` network and copied the
challenge's EIP-712 domain into a session-key signature; concurrent SSE requests
could also pass the same local cap before asynchronous source checks finished.*
Keep the current browser path testnet-only: require `exact`, the canonical Arc
testnet network, USDC asset, Circle batching name/version and testnet
GatewayWallet verifying contract before signing. Compare the active wallet
account with both the browser's saved session signer and the grant signer
captured by the ask route. Require source payment authority and reserve exact
integer micro-USDC against the per-ask local cap synchronously before any
asynchronous check. Release that local reservation only when signing provably
has not begun; retain it after signer invocation or an uncertain POST. The
headless two-argument caller keeps the pinned rail/domain checks but has no
browser grant snapshot to compare.

This is staged testnet browser hardening, not M3 or M4 acceptance. The timeout
range caps `validBefore` at signing to at most 691,200 seconds from the browser
clock, but does not bind it to grant expiry or revoke an existing signature.
Old streams, multiple asks/tabs, the server's post-signature ledger gap and
missing durable nonce-indexed admission/signature verification remain separate
gates. See [browser authorization design](docs/engineering/browser-authorization-durability.md)
and [dated mainnet evidence](docs/engineering/mainnet-readiness-2026-09-29.md).

**D-265** - Stage Arc testnet RPC chain attestation at authority boundaries -
*A viem client labeled Arc testnet does not verify the configured RPC, and a
custom or tokenized testnet host cannot be judged by its URL.* Check live
`eth_chainId` before each guarded HTTP RPC request. Check again after registry
and indexer responses, before their data reaches the cache, and immediately
before each indexer cursor write. Treat WebSocket registry pushes only as wake
signals for the guarded HTTP sync. For covered server and CLI SDK signing,
deposit and withdrawal calls, use a fresh four-second, no-retry preflight. This
reduces risk but cannot guard the SDK's internal requests. Each guarded request
adds a chain-ID round trip, authority reads add two, and an unavailable or
mismatched RPC fails closed.

M2 remains open: SDK-owned writes (including a withdrawal destination RPC outside
the configured URL), browser and standalone signers, adversarial RPC switch-back,
and non-atomic cache/cursor writes require separate controls and review. See
[dated mainnet evidence](docs/engineering/mainnet-readiness-2026-09-29.md).

**D-264** - Pin the Arc testnet payment contract profile - *Independent
environment overrides for USDC, GatewayWallet and GatewayMinter could create a
mixed-chain signing or withdrawal configuration while Keryx still advertises
Arc testnet.* Keep these addresses fixed in `lib/config.ts` and reject conflicting
overrides at startup; standalone buyer entry points use the same profile. This
is a testnet safeguard, not mainnet enablement or M2 acceptance. M2 still
requires RPC chain verification at write boundaries, separate deployment keys
and databases, network-scoped nonces and receipts, signer/Gateway domain checks,
and failure and recovery drills before a mainnet release decision.

**D-263** - Make a paid research business cycle the Tameion product focus -
*A citation-toll answer alone does not show the financial operation Tameion asks
an agent to run; a general-purpose chat clone would dilute the Arc/USDC workflow
and be difficult to validate with a real business during the event.* Keep the
citation-toll reading agent as Keryx's core capability and make its research
interaction useful for a customer: natural questions, source-backed answers,
follow-ups, visible source decisions, and a deliverable the customer can reopen.
For Tameion, center the end-to-end operating cycle behind that service: a real
customer research task and verified incoming USDC, available funds kept separate
from source and service obligations, bounded source purchases, evidence-gated
creator rewards, delivery, reconciliation, and human escalation when policy
requires it. Use RFB 04 as the closest prompt, not a mandatory track or a claim
that all of its example features are implemented.

Evaluate the event-period change in both product and genuine business use against
the pre-event baseline. Report independently initiated customers separately from
owner-operated pilots, and testnet separately from mainnet. Show decision,
authorization, settlement, pending/ambiguous and receipt evidence for the complete
cycle; a simulation or a payment rail demo cannot establish business traction.
The current application/database spend controls and funded browser session are not
an on-chain policy wallet. Do not claim contract-enforced category caps, a full
Operator, mainnet readiness, or autonomous scheduling without their separate
implementation and release evidence. Existing package terms and the mainnet
approval gates remain in force. This is product direction and acceptance scope,
not authorization for a new signer, payment authority, or real-fund launch. See
[Tameion plan](docs/tameion-2026.md).

**D-262** - Bundle the web's Mint fonts for reproducible builds - *A clean Next.js
16 Turbopack build failed while resolving `next/font/google` for Bodoni Moda;
remote font CSS and file responses make that build path dependent on an external
service.* Use `next/font/local` with checked-in WOFF2 files and SIL Open Font
License notices for Bodoni Moda, Spectral and Spline Sans Mono. Preserve the
existing CSS variables, normal and italic faces, weight ranges, and swap display.
Bundle the Latin subset used by the current web layout; other scripts continue to
use CSS fallback fonts. The files and provenance are recorded in `app/fonts/README.md`.
Require a fresh production build to validate future font changes. Reversible:
restore Google font loading if its clean-runner reliability is demonstrated.

**D-261** - Bind browser grant reservations to one epoch and signer; retain
uncertain signed authorizations - *A revoke/regrant can replace a session row
between grant inspection and cap reservation, and the browser may keep a bearer
authorization after the server decides to withhold submission.* Require atomic
reservation and release against the expected grant epoch, session signer and cap;
refuse a missing or changed grant without selecting the treasury signer. Once
the browser has produced a valid signed header, record a withheld authorization
as pending by its nonce with the original economic tuple and keep its capacity
reserved. Only exact authoritative Circle terminal failure evidence may release
that capacity for the same grant epoch; missing search results, local expiry or a
server decision not to submit are not failure evidence.

A final grant check still races with HTTP submission and cannot prove the
browser discarded its copy of the bearer header. A pending authorization may
therefore persist indefinitely if Circle never supplies a definitive outcome;
operator recovery and support policy must address that uncertainty without
reusing the nonce or silently freeing the cap. The grant-epoch binding and
signed-withheld pending behavior merged in `27ed52c` (PR #25), with focused
regression tests; they are not mainnet acceptance. A ledger-write failure after
the signed header is produced can still leave a held reservation without a
durable payment row. Closing that gap, the final grant-check/submission race,
and indefinitely pending signed-withheld recovery requires further work.
The separate seller SDK upgrade and explicit testnet facilitator pin merged in
`a79e882` (PR #26); it does not close these browser-grant risks or approve
mainnet payment.
See [mainnet readiness evidence](docs/engineering/mainnet-readiness-2026-09-29.md).

**D-260** - Replace the Windows Electron shell with a bounded Tauri shell and a
shared Mint desktop surface - *The desktop alpha worked but its dark visual system
diverged from the web reading product, and packaging Electron was heavier than the
local Operator surface required.* Use Tauri 2 and Windows WebView2 for the local
window, with an exact-source bundled Node runtime and a bounded stdio helper for
the existing TypeScript WorkspaceStore. The helper remains the single production
authority for task inspection, saved results, private exports, and GET-only buyer
recovery. The source-pinned Rust engine remains the single authority for immutable
task and private-workspace creation. A Rust window does not imply that receipt,
payment, or recovery domains have migrated to Rust.

Expose only named main-window commands, native dialogs, bounded request/response
frames and timeouts; keep Node, keys, arbitrary path selection or write authority,
and network APIs out of the renderer. Workspace paths may be displayed for the
deliberate buyer CLI handoff. A timed-out creation or interrupted helper remains uncertain:
do not select a second writer or repeat a possible purchase. Bundle and verify the
helper, runtime and native-writer artifacts from one clean source commit. Keep v1
task/journal/result formats and existing CLI readers unchanged so the prior release
can reopen them during rollback. Align desktop with the web's shared Mint colors,
local fonts and citation mark; prioritize the question and show pinned payee, caps,
unknown state and seller-reported observations explicitly. Tauri/WebView2, package,
fresh-runner, recovery, visual and CI evidence are release gates, not assumed from
the design. A same-machine, three-launch pre-release comparison of Electron desktop
0.2 and Tauri source `bd3e80cfb00327f613b2bdd9fef898b6a4a6d754` on Windows
with WebView2 153.0.4234.48 measured portable folders of 386,264,152 versus
105,143,561 bytes (72.8% smaller), mean UI readiness of 512 versus 1,637 ms,
and process-tree working set/private memory after seven seconds of 297.9/213.5
versus 368.6/239.6 MiB. This is one machine, and summing process working sets
counts shared pages more than once; it does not measure unique physical RAM.
WebView2 browser processes dominate the Tauri tree sample. The migration yields
a smaller distribution and the shared Mint/native shell, not demonstrated lower
RAM or faster startup; follow-up profiling must avoid unsafe WebView2 flags or
moving domain authority. Reversible: distribute the pinned prior Electron build
and reopen unchanged local workspaces. See [desktop alpha](docs/desktop-alpha.md).

**D-259** - Ship immutable task creation as one CLI and Electron integration -
*The preceding evaluators prove pieces of publication but do not give users a
native task creator.* Integrate the shared Rust preparation/publication domain
through a separate bounded writer protocol, a source-pinned artifact and the actual
Operator CLI and current Electron package in one release. Preserve the read-only
protocol and TypeScript inspection/recovery authority. TypeScript callers supply
identity, time and input; Rust owns new-task admission and immutable publication.
Never select another writer after refusal, timeout or an uncertain acknowledgement.

Provide a native operation for a **new** private workspace with security established
at creation. Do not fix existing user ACLs, follow parent links, adjust creator
tokens or silently elevate. Existing workspaces remain readable; new creation must
pass the stricter private-parent policy. Keep explicit incomplete outcomes and
accept Windows visible-file completion with directory-entry power-loss durability
unproven. Local publication does not establish payment or delivery.

Require integrated Linux/MSVC caller evidence, real packaged Electron IPC and a
fresh-runner package handoff, independent review and required CI before release.
Retain a pinned prior release and legacy v1 readers through the documented rollback
observation window. Test-only TypeScript fixture writers do not provide production
fallback. This is one domain cutover, not a Tauri, payment, scheduler or web/MCP
migration. Reversible: stop native creation and use the pinned prior release without
rewriting tasks or repeating purchases. See [native task creation](docs/native-task-creation.md).

**D-258** - Complete native publication from actual caller envelopes before routing callers -
*D-255's injected pre-mkdir checkpoint did not exercise a successful native write.*
Extend those same real CLI and desktop oracles through exclusive publication to
fresh private siblings. Require exact persisted bytes and identity, unchanged
original tasks, collision refusal, native/TypeScript status parity and actual
desktop discovery/refresh. Fresh guarded TypeScript processes must reopen the
native-created v1 records with the native executable unavailable. Keep legacy
admission and refusal cases, explicit synthetic Windows owner adjustment and
platform completion labels. This test-only increment changes no production caller
or monetary rule and proves no Windows directory-entry durability. Reversible:
remove the additional evaluator checks; TypeScript remains authoritative. See
[caller publication evaluation](docs/rust-task-admission-evaluation.md#full-publication-from-caller-envelopes).

**D-257** - Refuse unsupported Windows creator tokens before native publication -
*The private-parent check does not establish the owner of a newly created child;
the previous Windows evaluation selected a compatible owner inside its test process.*
At publication time, before exclusive mkdir, require no thread impersonation token
and a process default owner equal to its token user. Only an explicit no-token
result establishes the former; lookup failures refuse unchanged. Query normal token
state without changing it, then retain every created-object owner, ACL and identity
check. A later token or ACL change may still produce a retained partial result.

Exercise unadjusted and explicitly adjusted disposable processes separately, with
real impersonation refusal and honest owner-mismatch coverage. Preserve strict
private-parent admission and the Windows visible-entry-unproven completion state.
The packaged read-only CLI and TypeScript creation, legacy reading and payment
paths keep their existing authority. The accompanying target, new-task monetary,
single-writer and rollback choices are a proposal for a later reviewed caller
cutover, not permission to route callers now. Reversible: remove the candidate
increment while preserving all existing v1 records. See
[writer admission policy](docs/rust-writer-admission-policy.md).

**D-256** - Refuse Unix request pipes before the CLI can wait for a writer -
*The regular-file check happened only after a blocking request-file open.* Open
Operator CLI request input with `O_RDONLY | O_NONBLOCK` on Unix, then retain the
existing held-handle file-type check, bounded 8 KiB read, fatal UTF-8 decoding and
checked close. A FIFO with no writer can now reach the regular-file refusal instead
of hanging before it. Windows keeps its existing read-open flags; regular files
and links to regular request files retain their existing behavior. This is not a
general deadline for arbitrary filesystem I/O or a change to saved-task readers.

Use an actual CLI subprocess over an owned synthetic FIFO, with no writer, and
require exit 1 without a signal or watchdog timeout, no success receipt, no task
directory and an unchanged fixture tree. Include ordinary and linked regular-file
controls, bounded output and a kill/reap deadline; retain the fixture if process
exit cannot be confirmed. Hosted Linux must exercise the FIFO and link cases.
Local Windows can validate the ordinary control but a privilege-blocked symlink
setup is a recorded skip, not link evidence. Task formats, monetary validation,
payment authority and TypeScript writer ownership do not change. Reversible:
restore the previous open flags, with the known FIFO hang returning. See
[Operator task alpha](docs/operator-task-alpha.md).

**D-255** - Exercise real caller inputs before choosing native writer admission -
*Filesystem publication evidence does not establish compatibility with every CLI
or desktop input.* Use the actual Operator CLI and workspace creation paths as
synthetic oracles, preserving their persisted request/task bytes, UUID and time.
Compare those bytes with pure native preparation, then exercise the test-only
publication checkpoint immediately before mkdir on an absent sibling. Require the
exact injected failure and unchanged tree. That checkpoint is neither a name
reservation, a collision check nor evidence of successful later publication.

Distinguish caller parsing from candidate policy after normalization. Relative CLI
paths can resolve to an absolute parent; desktop workspace selection does not
establish the native candidate's stronger ACL contract. Keep tiny-positive legacy
CLI admission, desktop decimal refusal and Rust zero-rounded-micro refusal explicit.
Do not change the shared reader or buyer recovery schema to make the new writer
appear compatible. No production routing or monetary policy changes in this slice.

Use bounded actual processes, owned synthetic permission/link fixtures, original
file hashes and fresh guarded TypeScript reopening. Review platform evidence before
deciding target/owner admission, Windows durability presentation, one-writer ownership
and a rollback window. Reversible: remove the evaluator while production TypeScript
continues to use the unchanged v1 records. See
[task caller admission evaluation](docs/rust-task-admission-evaluation.md).

**D-254** - Evaluate exclusive native task publication with explicit incomplete outcomes -
*Correct task bytes do not establish safe filesystem publication.* Build the next
isolated candidate around D-253's immutable prepared pair and a held, validated
private-parent directory capability. Reuse no-follow traversal, check owner and
permissions before exposing private task content, and create one safe child and
its two files exclusively. Never overwrite an existing target, repair a partial
task automatically, or delete a directory that this call created after a failure.

Keep the TypeScript writer and payment callers authoritative. The native adapter
is evaluated through a test-only bridge, with no create command in the packaged
read-only CLI. Report whether this call created anything, the last confirmed
publication phase and any retained incomplete or uncertain state. A collision
does not mean the target is absent. Check file writes, sync and close separately;
on Linux also sync directory entries. Windows can demonstrate file flushing and
visible verified files here, while its directory-entry durability remains
unproven. Do not turn that observation into a durable-success or cutover claim.

Use private synthetic parents for exact-byte/TypeScript reopening, concurrent
creation, links and permissions, injected I/O faults, process termination and
restart. Process-kill tests do not prove power-loss persistence. Held handles and
observed-swap detection work under a trusted OS and private-parent assumption;
they do not defend against a hostile same-user owner or administrator changing
ACLs or files. Windows permission and durability policy, production target/payee
selection and writer admission still require their own evidence and review.
Reversible: disable the candidate and retain original v1 directories for
TypeScript inspection; never rewrite or repurchase as rollback. See
[task publication evaluation](docs/rust-task-publication-evaluation.md).

**D-253** - Prepare immutable v1 task bytes in a pure, separately evaluated core -
*Read-only artifact acceptance does not establish safe native task creation.*
After D-251/D-252's platform, transfer and rollback checks, evaluate the validation
and encoding part of task creation before adding a filesystem writer. Supply the
request, independently verified payee, integer total cap, UUID and creation time
explicitly. Reuse the Rust v1 validation and lossless JSON representation; prepare
ordered task/request values and return exact Node-compatible two-space JSON bytes with a
terminal newline, refusing either file above 8,192 bytes before any publication.
The core has no target directory, clock, randomness, network or payment capability.

Correct the existing reader's raw creator-budget upper bound at the same shared
validation point: a number slightly above `0.5` must be refused even when it rounds
to 500,000 micro-USDC, matching the TypeScript schema. Keep the documented positive
value that rounds to zero as an explicit candidate refusal; do not silently change
legacy TypeScript admission, rewrite records or normalize their budget values.
The new-writer monetary policy remains a gate before production admission.

Compare prepared bytes with the actual TypeScript writer using that writer's UUID
and time. Materializing those bytes in a test harness and reopening them with the
TypeScript reader proves encoding compatibility, not native publication durability.
Keep the preparation bridge test-only and outside the packaged CLI. Exclusive
creation, permissions, retained partial writes, crash recovery and writer cutover
remain separate acceptance work. Reversible: remove the evaluator; existing
TypeScript task creation, reading and payment authority continue unchanged. See
[task preparation evaluation](docs/rust-task-preparation-evaluation.md).

**D-252** - Test native artifact handoff on a separate runtime runner -
*A copied executable in its build job does not prove that the intended artifact
can be transferred and used without rebuilding it.* Extend D-251 acceptance with
separate producer and consumer jobs on Windows and Linux. After its tests pass,
the producer uploads only the canonical executable and a manifest generated from
that exact checkout/build. The consumer downloads the exact same-run artifact for
its source commit and target, verifies the two-file inventory, and supplies the
expected source independently from workflow metadata. It must fail on a missing
or mismatched artifact; it never installs Rust or rebuilds the candidate.

Restore Linux execute permission only on the selected canonical executable in
the isolated artifact directory, then enforce the existing strict manifest/hash/
host/protocol checks. Reuse TypeScript-written synthetic fixtures for exact read
outputs and guarded manual rollback on unchanged v1 data. Keep fault executables,
private task files and generated fixtures out of the uploaded artifact. Record the
actual runner/runtime environment and exercise both platform jobs; passing these
jobs proves CI transfer and runtime use, not authenticated public distribution,
an independently clean OS installation, arbitrary Linux compatibility, a signed
installer or production routing. The existing TypeScript authority is unchanged.
Reversible: remove the evaluation jobs; no persisted data or runtime migration
needs rollback. See [native inspection evaluation](docs/native-inspection-evaluation.md).

**D-251** - Evaluate a pinned read-only native artifact through a bounded caller -
*A compatible CLI alone does not establish safe caller lifecycle or artifact
rollback.* Add an explicit evaluation CLI and reusable transport for `status`,
saved `result` and stdout `brief`. Require a trusted manifest, exact executable
hash, explicit expected source commit and matching host/target identity, then
check the versioned no-task `protocol` command before inspection. Build metadata
comes from the trusted build procedure; hashing an arbitrary executable does not
prove its source, authenticate an untrusted manifest or prevent a same-user
replacement between verification and launch. Keep the installation directory and
manifest provenance trusted.

Launch without a shell, with fixed arguments and a minimal environment. Permit
one active request per transport instance, cap stdout/stderr bytes and share one
monotonic process deadline across handshake and command. Artifact verification
is byte bounded and precedes that deadline. Cancellation and failures must wait
for confirmed child exit before reuse; if termination remains unconfirmed after
the grace period, release local handles and permanently disable that instance.
Validate complete UTF-8 and command response shapes without copying monetary
domain rules. Preserve exact brief bytes and D-248's local, nonauthorizing meaning.

Actual Windows/Linux subprocess tests and a copied-artifact rollback drill are
release gates; unit mocks alone cannot prove process cleanup. Fault executables
are test-only and never part of the artifact. The existing TypeScript Operator
and Electron remain the production callers. There is no automatic fallback,
writer, payment recovery or Tauri cutover. Reversible: disable the evaluator and
explicitly reopen the unchanged v1 directory with the TypeScript reader; never
rewrite records or repurchase to recover. See
[native inspection evaluation](docs/native-inspection-evaluation.md).

**D-250** - Preserve the positive micro-USDC candidate boundary with explicit v1 fallback -
*The existing TypeScript request tolerance accepts positive values such as `1e-15`
that round to zero micro-USDC; Rust already refuses that creator budget.* Retain
Rust's nonzero integer micro-USDC rule and document this as an intentional,
separately tested candidate refusal. The diagnostic directs users of a
TypeScript-readable v1 directory to the existing read/export commands, preserving
the original records and avoiding repurchase. Do not weaken the candidate rule to
claim parity, silently normalize a stored request, or tighten a shared TypeScript
schema that legacy inspection uses. Synthetic production-writer fixtures must prove
status/result/brief refusal with no success output or brief creation, exact one-micro
control parity, and explicit guarded TypeScript reopening after the candidate is
disabled. This is a monetary representation boundary, not a demonstrated payment or
cap bypass. New TypeScript writer/admission policy remains a separate decision with
legacy compatibility and buyer quote/create/recovery tests required. D-248 outputs
remain nonauthorizing; no signing, funding, settlement or production routing changes.

**D-249** - Match the existing v1 timestamp grammar without rewriting records -
*A general RFC3339 parser both refused valid minute-only v1 timestamps and accepted
spellings the TypeScript schema rejects.* Validate the read-only candidate's
`createdAt`, `observedAt` and `savedAt` against the installed Zod default datetime
contract: a four-digit Gregorian date, uppercase `T`/`Z`, hours and minutes, optional
seconds, and an optional nonempty decimal fraction only after seconds. Reject
offsets, leap seconds, alternate separators and trailing data. Preserve the original
accepted string, including minute precision and long fractions. A bounded ASCII
validator with Gregorian leap-year checks replaces the broader Chrono parser; remove
that now-unused dependency without changing other dependency versions. Differential
tests must check the live TypeScript oracle, all three fields and commands that do
not consume a given field. This corrects candidate compatibility only: TypeScript
schemas, persisted formats, monetary rules and production routing stay unchanged.
Reversible: disable the candidate and inspect the unchanged v1 directory with the
existing TypeScript commands.

**D-248** - Limit v1 file inspection to local, nonauthorizing observations -
*Individual files can pass integrity checks while belonging to different moments
in a mutable directory.* The read-only Rust candidate may report locally bound
status or a saved result, including an older coherent result. It must refuse the
inconsistent bindings it observes, retain explicit timestamps and local/seller-
reported authority labels, and never treat a successful read as a directory-wide
transaction snapshot. Status keeps payment and delivery unknown; result presence
is only `present_unchecked`, not receipt verification. A result's unkeyed hashes
bind the local values but cannot authenticate a same-user writer or reauthenticate
the historical HTTPS observation. Use these outputs for inspection only, never as
admission for signing, spending, repurchase, reconciliation or a mutable writer.
Keep D-244 per-file checks and D-246 resource bounds; deterministic tests must
exercise changes between completed reads, both rejected mismatches and accepted
older values. Future authorizing operations need their own coordinated state or
transaction protocol and failure/rollback evidence. This scopes an evaluation
contract, not production routing, universal v1 parity or a waiver of the remaining
adapter, artifact and cutover gates. Reversible: disable the candidate and inspect
the unchanged v1 files with TypeScript.

**D-247** - Share complete-file publication between CLI and desktop exports -
*The desktop's direct write to a new destination could leave a partial Markdown
brief or status JSON when writing failed.* Move the D-245 TypeScript publisher into
`lib/operator/private-text-export.ts` and use it for CLI briefs and both desktop
exports. Keep one publication state machine: private exclusive staging, complete
write, file sync and checked close, exclusive hard-link publication, then staging
cleanup. Preserve no-overwrite, unconfirmed publication-call errors and complete
final files after cleanup failures; never remove the final path as rollback.
Electron main owns the native save dialog and chosen path; the renderer still sends
only its opaque task handle. Cancellation returns false, successful publication
returns true, and every failure reaches the existing UI error surface without a
success notice. A missing path from an accepted dialog is a failure, not a cancel.
Fault tests and a packaged Windows smoke test must cover both export formats.
Trusted private parents, inherited Windows ACLs, Unix mode `0600`, and the D-245
crash-durability limits remain unchanged. No Rust routing or payment authority moves.
Reversible: the helper can be replaced while preserving its publication contract;
existing task, journal and result files need no migration.

**D-246** - Preserve JavaScript string code units in the read-only Rust candidate -
*Refusing valid v1 strings with lone UTF-16 surrogates leaves existing private tasks
dependent on the legacy reader.* Supersede D-243's scalar-only candidate model with
a lossless value representation backed by pinned `rustpython-wtf8`. Validate bounded
file bytes as UTF-8, use `serde_json` RawValue for JSON grammar, and decode strings
and keys through its documented WTF-8 byte interface. Do not write a second JSON
grammar or introduce application-owned unsafe decoding. Preserve duplicate-key
last-wins behavior, UTF-16 canonical key ordering, ordinary JSON property ordering,
and original code units through request comparison, receipt hashes and result JSON.
Node-compatible UTF-8 answer hashing and Markdown export replace lone surrogates
with U+FFFD; that encoding step must never mutate the parsed value or receipt.
Keep numeric operations distinct: JSON numeric overflow remains nonfinite internally,
ordinary JSON serialization emits null, canonical hashing refuses it, and monetary
validation still requires finite exact micro-USDC amounts. Bound parser input,
nesting and value count; document and test stricter resource refusals and retain
explicit TypeScript fallback on the original files. This closes only the covered
representation gap. TypeScript remains production authority; no automatic runtime
routing, file rewrite, payment migration or desktop cutover follows from this change.
Reversible: disable the candidate and reopen unchanged v1 directories with TypeScript.

**D-245** - Publish completed brief files without overwriting an existing target -
*Writing directly to a newly created final path can leave a partial brief when a
write or file sync fails.* Both TypeScript and the Rust candidate stage the complete
Markdown in an exclusively created private sibling, sync its file contents, then
publish it with an exclusive hard link to the lexically resolved final path. An
existing file, directory or symlink target must remain untouched. Unsupported hard
links cause refusal; there is no direct-write fallback. Write, sync or checked-close
failure means this attempt has not published the final target. A publication-call
error is reported as unconfirmed: do not infer absence merely from an error return.
Errors attempt cleanup of only the owned staging file; never remove an existing
target or another exporter's winning file. After
publication, a staging-cleanup error leaves the complete final file intact and
reports failure without a success receipt; never delete the final pathname as
rollback because it could now name another writer's file. Diagnostics distinguish
these states and identify files requiring inspection. Use private trusted output
parents: this is atomic publication of complete bytes, not protection against a
hostile parent-directory race or a cross-platform guarantee of directory-entry
durability after a crash. Unix staging files use mode `0600`; Windows inherits the
parent ACL. Inject failures through internal test seams, not production environment
switches. Task/journal/receipt files and payment authority are unchanged. Reversible:
the old reader still opens original v1 data; preserving no-overwrite and truthful
failure receipts remains a release requirement.

**D-244** - Anchor candidate local reads to directory handles and reject observed changes -
*Checking a pathname and then opening it separately can read a different file after
a concurrent rename or link replacement.* The Rust inspection candidate now
walks task directories through held handles, refuses links/reparse points, and opens
fixed task/buyer children relative to those handles. Use pinned capability-based
filesystem libraries rather than new application-owned unsafe OS bindings. Bound
each read, reject non-regular files before consuming content, and detect observed
entry or content changes during inspection. On Unix, opening a raced FIFO must not
block waiting for a writer. Tests must control the mutation point rather than rely
on scheduler timing. This is a file-access boundary, not an atomic transaction over
all mutable v1 files or a sandbox against a malicious same-user writer that can
restore data/metadata. Task/receipt binding checks, the explicit Unicode restriction
and the TypeScript production authority remain in force. A failed inspection emits
no result and does not rewrite input files or initiate recovery/purchase. Reversible:
easy while candidate-only; production cutover still requires the remaining parity,
snapshot, rollback and platform evidence.

**D-243** - Keep the Rust reader's Unicode restriction explicit and preserve v1 data -
*JavaScript strings can contain unpaired UTF-16 surrogates that the candidate's
Rust `String`/JSON value representation cannot preserve.* Keep the read-only
candidate restricted to Unicode scalar strings, including valid surrogate pairs,
and refuse unsupported input with guidance to use the existing TypeScript reader.
Never replace, drop, normalize or rewrite code units to make a receipt pass:
request equality, canonical JSON, answer hashes and receipt digests depend on the
original values. This is a candidate compatibility restriction, not a claim that
TypeScript-accepted v1 records are corrupt or unsafe. Assert the refusal and the
unchanged TypeScript fallback with synthetic task, journal, observation, result and
receipt fixtures. Do not add a second handwritten JSON implementation just to
extend the candidate. A full v1 cutover still requires lossless compatibility or
a separately reviewed, versioned input contract with legacy readability and
rollback; an explicit refusal alone does not pass that gate. Reversible: easy
while TypeScript remains authoritative and candidate reads never rewrite files.

**D-242** - Evaluate one shared Rust engine through bounded domain cutovers - *A
single long-term domain implementation across native CLI, desktop and service
adapters may reduce duplicated authority and improve maintainability, but requires
measured equivalence and a safe transition.* Authorize a pure Rust domain core with
platform-specific file I/O and a thin native CLI. The first read-only slice opens
existing v1 Operator task directories for status, saved result and brief. The
TypeScript implementation is the compatibility oracle during migration and remains
production authority until a domain passes its explicit parity, corruption, limits,
no-write, rollback and platform checks. At cutover, one engine must own that domain;
retire the old duplicate after a documented rollback window. Desktop Tauri would call
the crate directly; web/MCP would use a versioned service adapter only after its
security and operations gates. Existing signing, buyer journal admission, spend
reservation, settlement and recovery retain their current authority until separate
end-to-end tests and review. Rust implementation alone does not prove speed, safety,
payment correctness or a desktop migration. Reversible: medium for read-only slices;
payment and persisted-format cutovers require stronger rollback proof. See
[`docs/rust-engine-migration.md`](docs/rust-engine-migration.md).

**D-241** - Keep the current Electron shell while evaluating desktop alternatives by evidence -
*The quality-first choice is the tested architecture that shares one TypeScript task and
receipt engine with CLI, rather than a speculative framework rewrite during active
delivery.* Electron remains the Windows alpha shell with a sandboxed renderer and
validated main-process boundary. Tauri/Rust remains a future candidate for a measured
standalone spike against the same task contract, including security, packaging,
maintenance, and actual resource use. No memory, size, or speed benefit is claimed
without a comparable build, and payment logic is not rewritten in Rust. Reversible:
medium (desktop shell can change around the portable TypeScript task engine).

**D-240** - Persist private completed Operator results only after verified GET recovery -
*An answer that vanishes when the desktop closes makes the local task lifecycle
incomplete; status alone cannot recover its content offline.* A bounded, atomically
replaced `result.json` binds the completed buyer job and archived receipt digest to
the original task, request, pinned payee, and cap. Offline open rechecks local file
integrity, the original journal, answer/package/economics binding, and the saved
receipt; it does not reauthenticate the past HTTPS header or independently prove
settlement or factual correctness. Older completed snapshots survive interrupted or
incomplete later checks. CLI and desktop share private result read and Markdown brief
export, while status keeps top-level payment and delivery unknown. A local save failure
returns the completed server outcome with an explicit retry message; it never
authorizes another purchase. Reversible: easy (additive local result file and read
surface; buyer payment path unchanged).

**D-239** - Add a local Windows desktop surface over the Operator task engine - *The
first desktop interface should expose the durable CLI task lifecycle without becoming
a second buyer or settlement authority.* Electron main alone reads and writes private
workspace files, validates opaque task handles and task input, and calls the existing
Operator create/status/GET-only resume functions. A sandboxed React renderer receives
only narrow operations through a context-isolated bridge; it has no keys, Node access,
arbitrary path/URL calls, navigation, or network access. User-picked text/Markdown is
copied into bounded immutable local snapshots with a digest and provenance, but is not
used as answer evidence yet. Local status/export retain unknown payment and delivery;
the last seller observation is explicitly time-bound. Desktop dependencies and the
unpacked Windows artifact remain outside the web server's root install. Reversible:
easy (isolated desktop package and additive local files; buyer rail unchanged).

**D-238** - Start Operator with a private task handoff - *The existing caller-funded buyer
already has a durable purchase journal and GET-only recovery; a second payment runner would
create duplicate-spend risk.* A local Operator task records a normalized research request,
pinned payee and total cap in an exclusive directory. The deliberate existing buyer `buy`
command writes only to its fixed `buyer/` child; Operator refuses recovery if the journal
request or recipient differs, or its amount exceeds the task cap. `resume` delegates to buyer GET-only
recovery and stores a bounded local diagnostic observation. Local `status` and JSON export
keep payment and delivery as unknown, label observations as stale seller-reported data, and
make no independent settlement claim. This is an initial CLI lifecycle, not a shared web/
desktop scheduler or treasury authority. Windows files inherit parent ACLs. Reversible:
easy (isolated task files and CLI; buyer payment path unchanged).

**D-237** - Remove self-initiated research drivers - *Usage should come from a caller who
chooses to ask.* The VPS traction daemon and workstation caller were stopped and removed
from saved PM2 state. Delete their driver scripts, seed question bank, helper, npm commands,
and engine-only configuration. Keep the ordinary web, MCP, and paid A2A entry points.
Creator offers on `/wanted` can still be recorded, but no worker automatically spends to
retry them. Historical settled records remain intact.

**D-236** - Show one public metrics overview - *Readers need one clear set of
totals.* Ledger, Proof, and Status show combined query, settled-payment, and
creator payout figures. Ledger's expandable section contains records; Proof retains
the build, registry, settlement, and cash-out evidence. Public metrics APIs
return combined totals; stored run and payment origins remain available for audit.

**D-234** - Keep the Ledger's first view scannable - *A settlement reference,
wallet flow, and transaction hash are useful for verification but obscure the
payment story in the first viewport.* Recent payments and cash-outs now render
compact source/amount/status rows; the full tables remain available below.
Public Proof stays at its existing URL and is linked from the Ledger rather than
occupying a second primary navigation slot. This changes presentation only;
payment classification, evidence links, and payout totals are untouched.

**D-232** - Stream the public answer archive - *Raw traces must not all coexist in
memory merely to build small public cards.* Keep the 2,500-run window and ranking,
but retain only slim winning entries. SQLite sorts identifiers and reads each payload
under the active cursor snapshot, avoiding a large payload sorter without a migration.
Supabase uses bounded keyset pages with quoted cursors and per-request timeouts; its
HTTP pages are not a single database snapshot. Equal timestamps now use descending
ID order, where the prior database order was unspecified. Only complete scans replace
the shared cache; failures keep its previous version and allow retry. Synthetic memory
and equivalence checks support the change, not a claim that every production heap
failure has been eliminated. See the archive-memory engineering note.

**D-231** - Separate revision-checked registry candidate - *An off-chain freshness
read cannot make a pending full-record update atomic.* V2 requires an expected per-source
revision for every edit and adds a price-only method plus a single-call record/revision
snapshot. It excludes unchecked legacy edit selectors and prevents edits after delisting.
Failed transactions roll revision changes back. The candidate is a distinct contract,
not a silent change to the deployed V1 source or a permission to switch registry addresses.
Creator-authorized migration, registry identity binding, client recovery, independent
review and funded acceptance remain required; see the V2 candidate document. Both
contracts require nonempty author splits, so browser snapshot validation now agrees.

**D-230** - Revalidate listing state before the wallet prompt - *A price-only UI must
not silently resubmit obsolete payout, split or content fields.* Existing registry
updates replace the whole record. Both management actions now fetch a bounded fresh
snapshot and refuse to sign if any authority/update field differs, is malformed or
cannot be read. Changed fields are displayed for review and require another deliberate
action. A synchronous action lock and wallet/source identity check prevent overlapping
prompts and continuation after an identity change during the read. This is a pre-prompt
check, not contract-level compare-and-set: edits made while the wallet prompt is open
can still race. A future registry revision and migration must address that atomicity;
this release neither changes the deployed contract nor claims to eliminate that race.

**D-229** - Listing management follows registry creator authority - *A payout wallet
is not necessarily the wallet that registered a source.* On-chain listing reads now
authorize the authenticated session against the live registry creator, rather than
first excluding creators absent from cached payout/author fields. Missing records,
RPC errors and differing read/write registries withhold management data. Offline
recipient ownership is unchanged; on-chain POST remains prohibited. Browser writes
pin the creator account and Arc Testnet, disable disconnected/wrong-wallet/network
actions, and read receipts on that same chain. Receipt query success is not transaction
success: reverted receipts display an error, while successful receipts trigger a
registry refresh without claiming cache parity. No registry contract, payout allocation
or global source ownership policy changes. Concurrent full-record updates and broader
account discovery/recovery still need separate acceptance.

**D-228** - Retire the sponsored A2A demo - *A legacy command must not bypass the
buyer recovery and spending boundaries.* The old CLI regenerated a JSON wallet on
any read/parse error, automatically funded it from the server treasury and paid
without a durable buyer intent. The entry point now only prints migration guidance
and refuses execution (except help); npm no longer loads the server environment.
Existing wallets and unresolved authorizations are untouched. Scheduled legacy A2A
ticks refuse rather than silently switching identities, funding authority or origin
classification. New purchases use the existing caller-funded buyer CLI with explicit
payee, total limit and journal; it cannot recover an old payment by buying again.
Other engine/web demo paths are outside this change and remain owner automation.

**D-227** - Owner-only economics files - *Retiring a public endpoint must not remove
the operator's ability to inspect telemetry privately.* The report command creates a
new 0700 directory under an existing protected Linux parent and writes an exclusive
0600 file with fsync and read-back verification. It prints no figures and refuses
existing paths, symlinks and permissive parents; partial locations are retained on
failure. Only explicit aggregate fields are projected, with invoices, fixed costs and
realized profit left unknown. Normal adapter initialization is deliberately skipped:
SQLite opens an existing database read-only, while Supabase uses read methods without
cache migration. This is legacy testnet telemetry, not complete or atomic business
accounting. Windows execution needs an ACL implementation rather than POSIX mode bits.

**D-226** - Private operational economics - *A testnet or simulation label is not
permission to publish internal operating estimates.* The legacy public economics
endpoint exposed usage-derived cost and shadow-margin totals, and `/status` polled
that snapshot. Both public surfaces are retired: the endpoint returns a static 410
with no-store and no database read; the status widget and polling are removed.
Internal telemetry and allocation calculations remain available to operator code.
The public business calculator retains formulas and explicitly illustrative user
assumptions. No invoice, private bill or realized profit is required for publication.

**D-225** - Historical deposit lookup without local originals - *Observing a past
deposit does not recreate a signing plan or prove current available credit.* A
wallet-supplied hash can be inspected using the current payer, pinned Arc testnet
Gateway/USDC addresses, exact deposit calldata and finalized canonical RPC evidence.
The result is transient UI state, keyed by payer; no funding record, active lock,
signature or retry permission is created. Success and revert remain distinct, and
neither a missing lookup nor the absence of local records rules out other pending
transactions. Unknown results require checking wallet activity and current credit.
This supports historical lookup after storage loss, not recovering an unknown hash
or resolving every lost pending operation. RPC and browser-origin trust remain.

**D-224** - Explicit funding replacement recovery - *A consumed nonce is not proof
that the planned deposit executed.* The browser may inspect a wallet-supplied hash
without signing or rebroadcasting. It requires the original payer/nonce and post-intent
block boundary, matching transaction/receipt/canonical block identity, an RPC finalized
head at or beyond that block and Arc testnet identity before and after the lookup.
Only the exact target/calldata/zero-value call is a confirmed or reverted planned step;
any other finalized call is recorded as replaced, never as a successful deposit.
Original hashes are retained. An exact-snapshot IndexedDB transaction prevents stale
lookups from overwriting concurrent original confirmation or another resolution.
Timeouts, missing evidence and aborts cannot release the active attempt. This trusts
the configured RPC's finality report; it is not independent consensus verification.
Lost browser storage and independent wallet/funded replacement acceptance remain open.

**D-223** - Final sufficiency in confidence - *High coverage and valid citations cannot
override the final assessment's conclusion that the requested answer is incomplete.*
The verdict now requires the final sufficiency result explicitly, rather than deriving
completeness solely from numeric claim coverage. An insufficient final result keeps
confidence Low and the existing provisional-answer notice visible. The evidence ledger
and reward allocation remain separate: useful, supported citations can still earn
their existing bounded rewards. Agent-loop regression compares sufficient/insufficient
final assessments with identical valid quotes and confirms identical citation counts
and total spend. This respects the assessment, not independent factual truth; mistaken
or incomplete model assessments still require broader evaluation.

**D-222** - Direct-answer stopping gate - *A partial coverage score cannot by itself
justify skipping the remaining selected sources.*
JSON reasoning previously stopped at 0.4 even though its own guidance called 0.4-0.6
a partial answer, and discarded the requested supportedAnswer/missingRequestedParts
fields when deciding to stop. Stopping now requires every target to have coverage at
least 0.7, a nonempty supported answer, known supporting markers and an explicit empty
missing-parts list. Missing/malformed assessments continue within existing source and
spending caps. Coverage values, citation reward thresholds and the explicit offline
heuristic retain their existing meaning. This is a model-assessment gate, not proof
that an answer is true or all contradictions were discovered. Agent-loop regression
covers reading past partial/high-score-with-gap assessments and stopping once complete.

**D-221** - Progress after local-original loss - *Match server progress to server
history without upgrading the report into independently verified evidence.*
The new history progress reader uses only the stored request selector and authenticated
account, matching recipient and amount before returning a server-reported result. It
does not reconstruct missing signed terms, grant retry authority or replace the existing
original-bound verifier. Shared progress schemas retain complete operator-RPC metadata
requirements when the server reports observed finality. The history UI action is
mounted in v0.22.54 with intercepted Chromium acceptance. Unknown, missing and failed
reads do not become cancellation or payment-failure claims; expired sessions clear
all previously displayed metadata and observations.

**D-220** - Framework privacy headers - *Private response policies must survive
Next.js configured-header precedence.*
The v0.22.53 live check found the global Referrer-Policy overriding the handler's
no-referrer value, including on the direct local server port. Withdrawal account/API
paths now override that global rule in next.config.ts as well. Runtime header checks
are required; handler unit tests alone do not prove the deployed response policy.

**D-219** - Account history without wallet signing - *A live account session can read
its server history while signing remains gated by the matching connected wallet.*
The history route binds directly to account authentication and has no configured
payment service or relay dependency. The account page renders history before the
wallet connection gate. This enables finding saved server requests after browser
storage loss, without reconstructing authorizations or claiming settlement. Local
originals remain necessary for the existing original-bound recovery verifier.

**D-218** - Private history response boundary - *Revalidate the exact account session
after reading owner-scoped withdrawal metadata.*
The history handler accepts only a bounded JSON cursor in a same-origin POST, derives
the owner from authentication and applies a separate durable read quota. Response
projection strips unexpected storage fields, rejects foreign/duplicate rows and
requires a continuation cursor to match the final row. Revocation, account changes,
same-wallet session replacement and cancellation withhold the result. Every response,
including errors and rate limits, disables caching and referrer propagation. These
rows remain request metadata, not settlement proof or permission to sign again.
The handler is not yet mounted in a route or browser interface; integration and
browser loss-of-local-storage acceptance remain open.

**D-217** - Owner withdrawal history storage - *Enumerate authenticated-account
recovery metadata without exporting bearer signatures in a history page.*
Both adapters now select only a caller-supplied owner, ordered by admission timestamp
and id with a bounded keyset cursor. Each stored original is signature/identity-checked
before projecting id, owner, time, amount, maximum fee and recipient. Foreign or corrupt
rows fail the page rather than becoming another account's history. Cursor validation
precedes query construction; PostgreSQL timestamp precision is retained. A history row
is an admitted request, not evidence of transfer or mint completion. Authentication,
HTTP projection and the account interface still need integration; this internal read
method grants no signing, retry, payment or public feed authority.

**D-216** - Confidence with conflicting evidence - *A reported disagreement is
not resolved merely because its coverage score is high.*
The English diagnostic exposed unresolved same-revision policy conflicts with coverage
varying from 0.5 to 0.8. Final verdicts now remain Low when the reported preference is
absent, unknown, unsupported by accepted citations or lacks an explanation. Even an
explained preference between known sources caps confidence at Moderate: choosing one
side is not independent corroboration. Missing model preferences remain explicit
unresolved conflicts, and trace text reports the preference without declaring resolution.
Citation evidence and reward allocation retain their existing authority; useful
evidence of a disagreement is not discarded. This applies to reported conflicts only;
undetected contradictions and early stopping still require broader evaluation.

**D-215** - Backup-copy inspection - *Match an independently retained manifest
digest before trusting the copied database's own metadata.*
Successful backup output now includes the manifest SHA-256 for separate private
retention. The offline inspector requires that expected digest, bounded protected
files, matching policy/database hash and full journal validation. It hashes the
database again and rechecks file identity after logical inspection. This detects
altered copies against a trusted record; it is not a signature, remote retention
service or proof that no newer authorizations exist. An intact stale snapshot still
cannot authorize signing. Native Linux checks use synthetic signed data with network
disabled and cover successful inspection, wrong expected digest and modified files.

**D-214** - Private withdrawal snapshots - *Back up the logical SQLite database
under the relay's cooperative lock and verify the original records after reopening.*
The operator snapshot command uses SQLite backup, including committed WAL contents,
into a newly created private directory. It validates admissions, nonce slots, saved
raw transactions and observations, compares source/copy fingerprints, rechecks source
identity and syncs a hash manifest. Existing targets and retained locks are not removed.
Cancellation waits for the database copy before closing handles; uncertain artifacts
remain for inspection. The manifest explicitly does not authorize resuming signing:
an older snapshot cannot prove that later admissions or signatures never existed.
Off-host retention, application-journal pairing and restore/chain reconciliation remain
separate acceptance work. Native Linux verification used synthetic payments with
network disabled and exercised WAL data, exact raw preservation and duplicate refusal.

**D-213** - Explicit provisioning command - *Default to a read-only preflight and
require complete operator choices before creating a new journal.*
The standalone CLI accepts only public address/RPC and integer lifetime gas terms for
inspection. Initialization additionally requires an absolute new directory, bounded
slot count and explicit assertion of fresh-key custody verification. It validates these
before RPC, refuses underfunding, then invokes exclusive durable initialization.
Cancellation retains partial files. No environment keys are loaded, no authorization
is signed and no relay or HTTP flag is enabled. The command cannot verify the custody
assertion; that evidence remains an operator prerequisite rather than a chain claim.

**D-212** - Fresh relay chain preflight - *Read current account state before treating
a newly generated key as eligible for an empty journal.*
The read-only helper checks Arc Testnet identity, a fresh rechecked block, latest and
pending nonce zero, absence of account code, and native gas backing against an explicit
integer lifetime ceiling. Repeated pending balance samples use the lowest observed
value; underfunding is explicit. RPC calls have no automatic retries and the overall
read has a ten-second cancellation deadline. The observation does not prove exclusive
custody, absence of off-chain signatures or future funding; provisioning and every
later admission retain their separate checks. No key, journal or enable flag is changed.

**D-211** - Fresh relay journal initialization - *Create an exclusive private directory
and verify the empty journal without treating missing history as recoverable emptiness.*
The operator-only provisioner validates a testnet policy with initial nonce zero before
filesystem writes, requires an existing private canonical parent and creates the new
directory without an existing-directory fallback. Policy/database files use exclusive
creation, durable writes and reopen verification. Duplicate, corrupt or partially
created directories remain untouched; cancellation never removes uncertain artifacts.
This helper neither generates keys nor proves a key is unused: a newly generated
dedicated key, custody isolation and live latest/pending nonce checks are separate
operator prerequisites. It does not enable relay/HTTP, fund a wallet or sign anything.

**D-210** - Withdrawal supervision and deployment - *Pause scheduling before draining
the cycle, and restore only a previously active timer after web health succeeds.*
Prepared systemd units run bounded oneshot cycles after prior completion. Expected
pending exit 2 permits later checks of original requests; unexpected process failure
pauses the timer for inspection. Shutdown uses SIGTERM with no forced kill. The deploy
helper stops the timer, cancels even queued service activation, and verifies inactive
state/zero MainPID before source changes. Manual cycles are never automatically
repeated. Failed deploys remain paused rather than inferring earlier scheduling intent.
Hermetic lifecycle checks and unit verification on the actual VPS pass; no units have
been installed or enabled. Dedicated runtime provisioning, funded shutdown/restore
acceptance and incident alert delivery remain open.

**D-209** - Operator withdrawal cycle - *Compose bounded queue, relay and reporting
passes without treating a pending phase as a payment failure.*
The explicit --cycle CLI mode scans at most 32 pages of 32 rows, runs one existing
bounded relay pass, then scans cash-out observations. Every later invocation starts
fresh sweeps to revisit absent evidence. Cursor validation prevents non-progressing
loops; original journals, cooperative phase locks and mint identities retain authority.
Queue or relay unavailability does not discard independent completed observations
that reporting can still record. Cancellation waits for the current phase to settle
and prevents later phases. Exit 2 signals pending/unavailable work, not failed payment;
scan counts are not new transactions or revenue. The command requires explicit operator
database/gas terms and the dedicated enabled testnet runtime. It installs no schedule,
creates no wallet/journal and never resubmits a Circle transfer. Funded acceptance and
managed cycle supervision remain open.

**D-208** - Deployment worker heap - *Use one Next worker thread to preserve the
explicit parent heap, and verify the installed wrapper before every VPS build.*
Serial generation alone still exhausted the child process heap. A diagnostic using
the actual installed Next Worker on the VPS measured 529 MiB for the isolated child
and 1584 MiB for the thread, matching the capped parent. Temporary builds now enable
workerThreads alongside one worker/one page concurrency. The deploy preflight checks
that the thread retains the bounded parent heap before running the expensive build.
Normal web runtime and local/CI defaults are unchanged. This uses Node's documented
worker heap behavior (https://nodejs.org/api/worker_threads.html) and the installed
Next wrapper; no dependency files are patched. Production build/health remain the
acceptance gate, and a failed build must not restart a drained private worker.

**D-207** - Bounded deployment prerendering - *Generate one page at a time in one
worker for temporary VPS builds.*
The v0.22.51 deployment compiled successfully but failed during static generation at
the isolated worker's approximately 480 MiB heap limit. Installed Next code removes
the parent's max-old-space-size from that worker, so increasing the parent flag alone
cannot address this failure. Temporary .next.tmp builds now use the documented
staticGenerationMaxConcurrency=1 and cpus=1 settings to reduce simultaneous page work.
Normal local/CI settings are unchanged. The failed deploy left the old web build in
place; successful constrained build and health verification are required before swap.

**D-206** - Account withdrawal page - *Expose recovery through a wallet-matched
account page while keeping new withdrawals under explicit operator configuration.*
The dynamic, non-indexed /me/withdrawals page links from My sources and mounts the
English workspace only when the signed-in account and connected wallet agree. Session
loss or account mismatch removes the workspace and cancels pending work. Server props
contain only six allowlisted public policy fields; relay keys, gas budgets and private
paths never cross that boundary. Disabled or invalid creation configuration yields
recovery-only mode. This release does not enable the relay, claim full funded withdrawal
acceptance, replace the legacy withdrawal flow or establish mainnet readiness.

**D-205** - Withdrawal route binding - *Keep authenticated recovery independent of
creation enablement and signer configuration.*
The Node.js POST routes for prepare, submit and status now bind concrete revocable
sessions to the existing services. Preparation/submission require explicit validated
HTTP and relay configuration. Status constructs only the authenticated reader and
optional read-only mint journal; disabled creation or malformed unused signer/caps
cannot block recovery. Configured but unreadable mint history returns unavailable,
never silently degrades to transfer-only success. Every route returns no-store,
Cookie/Origin-varying responses without raw operator errors. Tests import actual route
exports with real cookie/SQLite state, checking disabled creation, owner isolation,
revocation, missing history and one-attempt enabled transport. RPC heights and gas
admission remain synthetic in these tests. Production UI mounting, deployment and
funded operational acceptance are still pending.

**D-204** - Creator withdrawal workspace - *Keep preparation, stored-original review
and recovery together while making each new authorization an explicit action.*
The internal English workspace accepts decimal USDC with at most six fractional
digits, converts it to integer micro-USDC without rounding and enforces configured
amount/fee bounds. Preparation does not prompt the wallet. A saved ID opens the
existing review/sign/send panel, while recovery rows can reopen the retained original
after remounting without another estimate or salt. Owner or limit changes remount the
workspace and cancel pending preparation. Missing/invalid creation limits leave only
recovery; a separate new-request action never deletes earlier originals. Chromium
checks invalid amounts, prepare/reopen/sign/send, disabled creation and wallet changes
during preparation. Production mounting, HTTP route integration and funded operational
acceptance remain required before release.

**D-203** - Browser preparation authority - *Validate the unsigned response against
locally selected terms and reserve it durably before exposing signing.*
The browser posts only the selected integer amount to a fixed same-origin endpoint.
It checks the entire returned policy and typed-data identity against the caller's
reviewed owner, recipient, contracts and amount/fee caps, with finite expiry and bounded
response age. Transport has a 40-second deadline, 8 KiB cap and no retries or redirects.
Live account/cancellation checks surround response handling and IndexedDB reservation;
an interrupted write may remain saved but cannot return signing authority. Duplicate
drafts cannot overwrite existing originals. Chromium exercises prepare, cross-tab
readback, duplicate rejection, review/sign and one-attempt submission with intercepted
HTTP. Response age does not prove current chain expiry; submission-time server checks
remain necessary. Public workspace/routes and funded acceptance remain open.

**D-202** - Authenticated draft preparation - *Derive unsigned terms from the live
owner and server caps, then recheck their height window before returning a draft.*
The internal prepare handler accepts only integer amountMicros. Owner/recipient come
from the revocable session; contract and fee limits come from server configuration.
It validates the unsigned candidate, reads a fresh height window, estimates through
Circle and rechecks the window and original session before releasing the draft. It
creates no signature, gas hold, application request or transfer claim. Durable prepare
limits are independent from submit/status limits (3 per wallet and 20 service-wide per
minute), so estimation does not consume the user's submission allowance. The returned
draft still needs browser validation, durable reservation and explicit review/signing;
public route activation and funded acceptance remain open.

**D-201** - Withdrawal review and execution UI - *Review the retained original and
separate wallet signing from its one permitted submission.*
The panel loads an already-reserved request and displays amount, maximum Circle fee,
maximum Gateway debit, recipient and finite source-block expiry. It generates no salt
and cannot reconstruct a missing original. Only a locally created unsigned finite draft
can sign; only its saved signature can expose Send. Imported/attempted originals are
recovery-only. Every operation rereads storage before presenting the next action, and
wallet mismatch unmounts the owner view and cancels pending work. Chromium verifies
the exact typed-data identity, no HTTP during signing and one intercepted POST followed
by recovery-only state after response loss. Quote preparation, public route/workspace
mounting and full funded acceptance remain open.

**D-200** - Submission-time expiry - *Revalidate finite signed terms before gas
admission and again before the one permitted Circle call.*
The concrete HTTP service requires explicit maximum-ahead and processing-lag block
limits and rejects the legacy unlimited-expiry sentinel for new submissions. Each
fresh submission checks the signed block height against current Circle/RPC bounds
before holding gas, then repeats the check after claim storage. The live session is
rechecked after asynchronous height validation before transport. If terms/session
become unavailable after a claim, that claim and gas hold remain; an existing claim
uses recovery without another validation/admission/transfer attempt. Expiry is not
evidence of a failed payment and cannot release uncertain obligations. Legacy retained
requests remain readable. UI finite-draft preparation and full funded acceptance are
still required before production activation.

**D-199** - Fresh source-chain expiry bounds - *Compare Circle's minimum expiry and
processed height with a fresh consistent Arc-testnet RPC block.*
The reader validates exactly one Arc-testnet domain, expected Gateway wallet/minter
addresses and USDC support. Operator-selected limits cap processing lag and the maximum
future block distance; a vendor minimum outside that window is rejected rather than
expanded automatically. The RPC chain and sampled block identity/timestamp are rechecked,
with a total deadline and bounded vendor response. This is operator-selected RPC/Circle
metadata trust, not independent consensus proof or a promise that terms remain valid
after a wallet prompt. A live unsigned synthetic-address estimate passed the fresh
window with diagnostic caps. Production cap selection and submission-time rechecks
remain required; no funds or signatures were used.

**D-198** - Finite withdrawal estimation - *Obtain unsigned fee/expiry estimates and
accept them only when the exact transfer spec and operator height/fee bounds match.*
The new pre-signing estimator calls only Circle testnet /v1/estimate with an unsigned
spec, with bounded response size/deadline and no redirects/retries. It normalizes only
valid 20-byte EVM addresses into zero-padded bytes32 before shared validation. Live
testnet returned a direct array, while the reference also documents a body envelope;
both require one validated intent. Changed spec fields, excessive fees and expiry
outside the selected finite height window are rejected. A fresh unsigned, unfunded
synthetic-address probe returned matching finite terms; no signature or transfer was
sent. Fresh server-owned height bounds, durable draft reservation and review UI remain
to be integrated. Existing signatures and journals are never rewritten by estimation.

**D-197** - HTTP admission configuration - *Require independent HTTP opt-in and exact
operator-selected caps before constructing the submission service.*
The configured service factory requires KERYX_WITHDRAWAL_HTTP_ENABLED=1 in addition
to the dedicated relay's existing enablement and custody checks. Amount and gas ceilings
must be positive canonical integers; the vendor fee cap may be zero. Missing, fractional
or overflowing limits, forced offline mode, another network/domain and credential-bearing
RPC URLs are rejected. Settings are snapshotted before use. This is configuration
validation, not proof of journal funding, worker supervision, finite authorization expiry
or end-to-end readiness. Production route activation remains separate and disabled.

**D-196** - Partial local recovery - *Keep valid originals accessible when another
saved payload cannot be validated, without repairing or deleting the failed row.*
Owner-indexed listing validates each row separately and returns an unavailable count.
Pagination advances using the IndexedDB primary key rather than the last valid payload,
so corruption at a page boundary cannot hide later originals. A mismatched payload ID
is rejected. Invalid primary-key structure and unavailable storage still fail the scan;
this does not grant permission to reconstruct or resubmit missing authorizations. The
panel reports unreadable rows and does not present an entirely unreadable page as an
empty history. Chromium tests cover mixed validity and a corrupt 25th row followed by
another page. No signatures, claims or saved rows are modified by listing.

**D-195** - Creator recovery interface - *Keep wallet-scoped recovery separate from
new withdrawal authorization and clear the view across account changes.*
The recovery panel lists locally retained originals, checks authenticated status and
downloads/imports private recovery files. It has no signing or payment-submission action.
Wallet-keyed remounting cancels pending work and prevents another owner's rows from
remaining visible. Operation guards survive React Strict Mode cleanup/restart without
letting an old completion release the current operation. Imported requests remain
recovery-only. Missing status does not imply a payment was never sent; finalized mint
links require the validated status projection. The component is Chromium-tested but
not mounted in production until the complete withdrawal workspace is ready.

**D-194** - Portable withdrawal recovery - *Export the retained signed original and
import it only into recovery-only browser storage.*
The versioned Arc-testnet envelope is bounded to 16 KiB of UTF-8 and accepts only an
original signature matching the selected owner. A recoveryOnly marker is mandatory,
but the storage import itself enforces the consumed submission state regardless of
file provenance. Export reads and revalidates the saved signed request; unsigned drafts
are not exported as authorizations. Live account and cancellation checks surround
asynchronous operations. Existing local rows are not overwritten. The file is private
signed authorization data, not a public receipt or proof of payment, and neither
operation sends HTTP. UI download/import controls remain integration work.

**D-193** - Operator cash-out reconciliation - *Use a bounded reporting-only sweep
over protected original journals and an explicitly selected application database.*
The reporting CLI opens the mint journal read-only and exposes only original-request
reads and idempotent cash-out writes on the existing application store. It needs no
key, relay enablement or RPC. It refuses missing/uninitialized history, never migrates
tables, and contains per-request reporting failures so later observations can proceed.
Private cursors resume bounded pages; later full sweeps revisit earlier unknown/error
rows. Scan counts include already-recorded cash-outs and must not be promoted as new
transactions or revenue. The command supplies operator reconciliation, not supervision,
live mint acceptance or completion of the creator UI.

**D-192** - Observed-mint reporting - *Derive cash-out rows from retained validated
mint evidence and the matching application original.*
The operator reporting bridge accepts only a request selector and server-owned journal
and store capabilities. Missing/unobserved mint history performs no ledger write. A
validated worker observation must match the complete application original; transaction,
recipient, amount and observation timestamp come from retained evidence. The legacy
number-valued ledger is used only when every micro-USDC round-trips exactly and stays
within safe integer precision. Generic creator labels exclude private source metadata.
Ledger uncertainty preserves the mint observation and may repeat only the idempotent
report, never a transfer or broadcast. Runtime scheduling and ledger reconciliation
remain required; synthetic observation tests do not establish live paid acceptance.

**D-191** - Cash-out record idempotency - *Keep the first transaction row and verify
its economic identity on every repeated write.*
SQLite now uses a targeted transaction-hash conflict clause instead of ignoring any
constraint failure. Supabase uses ignore-duplicates rather than an overwriting upsert
and checks both write and read errors. Both adapters read back the selected transaction
and reject changed owner, recipient, amount or network. Earlier display metadata and
timestamp remain unchanged on a valid repeat. Errors do not justify replaying a payment;
only the same reporting write may be recovered. Cash-outs remain separate from payment
events and revenue. This fixes persistence behavior, not provenance: callers still need
validated mint evidence, and the new worker-to-ledger bridge remains to be implemented.

**D-190** - Mint status integration - *Read protected relay history without signer
capabilities and reauthenticate before releasing the owner projection.*
When the server config supplies a relay directory, status opens that existing journal
read-only, verifies file identity/policy and derives the original-owner mint projection.
This does not require submission enablement or a private key. Missing configured history
fails closed; absent configuration retains explicit not-checked status. The HTTP handler
looks up the original by authenticated wallet before journal access and checks the live
session after reading. Browser status parsing accepts complete, original-bound finality
metadata with its operator-selected-RPC basis; preparation remains nonfinal. Initial
submission responses still cannot establish mint finality. Routes and UI remain unwired;
cash-out ledger recording is separate work and no paid acceptance is claimed.

**D-189** - Owner mint progress - *Project only validated original journal state and
distinguish prepared bytes from observed finality.*
The read-only projection requires the authenticated original owner before any journal
read, compares the complete stored request, and relies on the journal's revalidation of
prepared transactions and immutable worker observations. No slot means not-queued;
an unobserved slot is queued or prepared, never failed or completed. Finalized-observed
returns transaction/block identity and the explicit operator-selected-RPC trust basis,
without signed payloads, attestations, gas costs or internal nonce terms. Cancellation
withholds results. The HTTP boundary must still reauthenticate before release. This
projection does not write the cash-out ledger or independently refresh chain finality;
protected runtime/status wiring and browser presentation remain required.

**D-188** - Withdrawal HTTP composition - *Bind submission and recovery to live
revocable cookie sessions and concrete server-owned payment dependencies.*
The service factory uses accountSessionContext directly for the authenticated database,
wallet and hashed session selector. Submission binds the protected runtime admission
factory and the fixed Circle transfer transport; status shares the same live owner
authentication without acquiring payment capabilities. Server-selected testnet network
and limits remain separate from signed request input. Integration tests issue actual
signed session cookies and use real SQLite revocation/claims, while intercepting Circle
HTTP and substituting the separately tested admission boundary. A replacement session
or revocation during admission/claim storage never grants a vendor retry. Route
registration, operator provisioning and complete finalized-status/UI integration remain
open; this composition alone is not live funded acceptance.

**D-187** - Withdrawal admission runtime - *Open and verify the existing protected
relay journal for each server-owned backed admission.*
The bootstrap snapshots operator configuration, requires the dedicated enabled testnet
relay and checks its derived address against the persisted journal policy. Protected
Linux files are inspected before and after opening SQLite; database identity and policy
must remain unchanged. The original journal is validated without initialization or
upgrade, and the shared-lock backing callback retains the connection until its awaited
work settles. Missing history never falls back to a new database or public treasury.
This composes runtime custody checks with durable gas admission; it does not configure
a funded relay, register an HTTP endpoint or complete the creator recovery journey.

**D-186** - Browser withdrawal submission - *Bind the committed one-attempt flow to
a fixed same-origin transport and recover every uncertain HTTP outcome.*
The browser sends only the retained signed wire request to the planned submission
endpoint. Signature validation snapshots the original; a live account check immediately
before fetch prevents account changes during asynchronous validation from transmitting.
Cookies are same-origin, redirects/retries/caching are disabled, and a 30-second total
HTTP deadline and 2 KiB response cap bound waiting. Only a matching 202 transfer-progress
projection is accepted by the transport; the flow still requires separate recovery and
never promotes it to mint finality. Real Chromium cross-tab tests observe the durable
claim before intercepted HTTP and prove a lost response does not permit a second POST.
The production endpoint and UI remain unregistered/unwired pending runtime integration.

**D-185** - Withdrawal gas backing - *Observe relay balance against all unresolved
ceilings before admitting another original request.*
The backed admission callback shares the protected directory lock with queue/worker
operations. It samples native balance at a fresh Arc-testnet block, rechecks that block
and chain, and atomically compares the journal commitment count and total before saving
the hold. Unresolved requests retain their full ceilings. A validated finalized original
mint removes its ceiling only from future gas backing, never from lifetime expenditure
or slot limits; the sampled balance block must be at least as recent as those observations.
An existing nonce slot cannot authorize a new initial Circle call if application claim
history is missing. Cancellation retains the lock until awaited work settles. This is
an operator-selected RPC and exclusive-key-custody assumption, not independent consensus
proof, a future gas-price guarantee or live funding evidence. Production runtime/HTTP
integration and funded acceptance remain required.

**D-184** - Withdrawal request limits - *Use durable wallet and service counters and
deny storage uncertainty without falling back to process memory.*
Submission and status handlers now call the durable limiter directly through their
authenticated database context. Fixed 60-second budgets are 3 submissions per wallet /
20 across the service, and 30 status reads per wallet / 200 across the service. Wallet
counters are charged before service counters; denied/lost-readback points are not
rolled back. Wallet bucket keys use a domain-separated address hash, not raw addresses
or bearer tokens. Malformed decisions and storage errors return no-store 503; exhausted
windows return 429 with Retry-After. SQLite missing RETURNING rows now throw instead
of silently admitting, allowing withdrawal callers to deny uncertainty. Other routes
retain their existing fallback policy. These counters are abuse controls, not a gas
budget, settlement ledger or guarantee against coordinated wallet-based denial of service.

**D-183** - Withdrawal submission boundary - *Derive request policy from server limits
and revalidate the original session around admission and initial Circle submission.*
The server handler accepts only the signed wire intent, not client policy fields.
Its first supported cash-out path binds depositor/signer/recipient to the authenticated
wallet, applies operator amount/fee/contract limits and creates the canonical original
record itself. A required server limiter runs before body/signature processing; streamed
input is capped at 8 KiB. Same-owner replacement sessions do not inherit an in-flight
submission. Session checks bracket durable gas admission and precede the vendor call;
a consumed claim remains retained if revocation occurs after claim storage. Responses
are no-store transfer progress, never completed-mint evidence. The handler remains
unregistered until concrete backed admission, rate limiting and production routing
are connected; injected test callbacks are not live readiness evidence.

**D-182** - Browser withdrawal status - *Bind HTTP transfer progress to the retained
draft and never translate missing evidence into retry or completion authority.*
The browser uses one fixed same-origin read-only POST carrying only the request ID,
with cookies, no cache/redirects/retries, a five-second total deadline and 2 KiB body
cap. The strict result matches owner, recipient, amount and original digest and accepts
only transfer progress with mint finality explicitly unchecked. A 404 remains unavailable;
401 requests authentication. Recovery rechecks the live account after reading and
never changes the local submission marker. This transport is implemented and tested
against intercepted HTTP; the public route and production UI are not activated here.

**D-181** - Browser withdrawal execution - *Sign only the stored draft and reread the
committed original before invoking an app-owned one-attempt transport.*
The browser flow checks a live account accessor and cancellation around asynchronous
work. A valid signature returned during account change/cancellation is retained for
the original owner, but no submission follows. Existing signatures never trigger a
new wallet prompt. Submission consumes the cross-tab marker and rereads storage before
transport; lost responses or a post-claim account change leave recovery-only state.
Transport response bodies are not treated as mint/finality evidence. These coordinators
are implemented and Chromium-tested but remain separate from production HTTP/browser
wiring and the final authenticated settlement-status projection.

**D-180** - Browser withdrawal journal - *Persist the unsigned draft before the wallet
prompt, then the original signature before a single cross-tab submission claim.*
The intent builder now exposes an unsigned preparation step while its legacy wrapper
preserves the existing signed-wire behavior. The browser journal validates the same
EIP-712 identity and owner/policy as the server, records drafts and signatures in
strict IndexedDB transactions and compares the complete prior row before transitions.
Only the caller whose submission marker commits may transmit; reload and imports
cannot renew that permission. Imports always remain recovery-only, including after
local storage loss. Owner-indexed pagination includes unsigned reservations. This is
local recovery state, not payment/finality evidence or protection against same-origin
script compromise, browser eviction or operator-driven storage replacement. Server
single-use claims remain the payment authority. The new journal is not yet connected
to the production withdrawal panel; deletion/export UX and full browser/server
acceptance remain open.

**D-179** - Withdrawal status boundary - *Read the original owner's transfer state
without accepting payment capabilities or exposing selectors in URLs.*
The server handler accepts a same-origin read-only POST with a strict 1 KiB JSON
selector and five-second streamed-body deadline. A server-owned live-session resolver
supplies the owner and a read-only store; it is called again before releasing data so
revocation/account changes deny the previous result. Foreign and absent requests have
the same unavailable response. The projection excludes signatures, attestations and
claim tokens, disables caching and labels mint status as not checked. Stored transfer
evidence alone cannot establish a completed withdrawal. This handler remains unbound
to a public Next.js route pending the full request/recovery integration; its injected
authentication tests do not substitute for live-cookie browser acceptance.

**D-178** - Queue operator command - *Read an explicitly selected existing application
database without initialization while writing only the protected relay journal.*
The relay CLI gains a mutually exclusive queue mode with explicit operator gas terms,
application database path and bounded cursor paging. Its application-store connection
opens SQLite read-only, enables query-only mode and validates existing withdrawal
tables. Linux owner/mode/link/ancestor and file-identity checks apply before using the
selected database. There is no default path, adapter initialization, migration or
silent file creation in this mode. Queue recovery does not sign, broadcast or call
Circle. This connects the SQLite deployment's operator entrypoint; scheduling,
funded relay provisioning and authenticated HTTP/browser integration remain open.

**D-177** - Withdrawal queue recovery - *Enumerate held requests and attach stored
attestations without repeating the transfer or assigning duplicate nonces.*
The protected relay journal provides bounded cursor pages of admissions that do not
yet have nonce slots. A server-owned queue pass reads the original owner's matched
application attestation under the same cooperative lock used by the signing worker.
Missing evidence and per-request errors remain pending while later ready requests
can be attached. Nonce assignment uses the existing atomic slot reservation; committed
slots survive readback loss and retain original fee terms. Queue recovery performs no
Circle submission, signing or broadcast. The private cursor bounds work, and later
full sweeps restart without a cursor to revisit unknown requests and newer admissions.
This implements the recovery core; operator scheduling, protected application-store
selection and production HTTP/browser wiring remain integration work.

**D-176** - Pre-transfer gas admission - *Reserve one immutable gas ceiling before
Circle submission, then attach a nonce without charging the request twice.*
Schema version 2 adds original-request admissions to the same protected SQLite
journal as nonce slots. Admission needs no attestation or nonce; both allocation
paths atomically count the union of admissions and legacy slots against the existing
lifetime gas and request-capacity policy. Later mint terms must fit the original
ceiling. Unknown outcomes and cheaper/completed mints do not release capacity or gas.
Explicit version-0/1 upgrades retain original slot and observation history; missing
current-version tables are not silently recreated. This closes the durable accounting
dependency of the transfer coordinator, while actual funding, isolated runtime
provisioning and production HTTP/browser integration remain separate acceptance work.

**D-175** - Initial withdrawal transfer - *Claim once after durable gas admission;
response loss never authorizes another Circle POST.*
The server coordinator validates and stores the original owner-signed request before
invoking server-owned, request-idempotent gas admission. Only a freshly inserted,
read-back application transfer claim permits the vendor call. Existing claims skip
both admission and submission; malformed, lost or oversized responses retain unknown
state. A returned matched response is stored even if the caller disconnects, and a
committed response with lost readback can be recovered without repeating the transfer.
The transport sends one canonical signed-request array with no redirects or retries
and bounds headers/body by a ten-second deadline and 16 KiB. Owner-only progress omits
signatures/attestations and never represents stored evidence as a completed mint.
The concrete pre-Circle gas reservation and production HTTP integration remain open:
the current relay journal requires an attestation, so it cannot yet supply this
admission callback. A no-op or balance-only check is not an acceptable production gate.

**D-174** - Relay operator bootstrap - *Require an explicit dedicated key and protected
existing journal before enabling the testnet worker command.*
The CLI defaults to read-only local inspection, with separate explicit run and schema
upgrade modes. It derives signer inventory from loaded private keys, requires public
funder/private-active treasury coverage and rejects relay reuse. The configured relay
address and journal policy must match that key. Linux ownership/mode, link, ancestor
and database-identity checks bind the existing protected directory to the command;
Windows needs a real ACL implementation before runtime execution. No key/journal is
created and no crash lock is reclaimed automatically. Configuration completeness and
off-host key isolation remain operator trust boundaries. The command is implemented,
but no funded production relay is provisioned or enabled by this change.

**D-173** - Withdrawal RPC lifetime - *Bound and abort the whole response, including
its body, without automatic transaction retries.*
The installed viem HTTP implementation uses an explicit fetch signal instead of its
internal timeout signal and ends its timeout after headers. The withdrawal transport
therefore combines caller, internal and per-request deadline signals inside fetchFn,
reads at most 4 MiB under a five-second deadline, and only then returns the buffered
response for JSON parsing. Header/body stalls and oversized responses abort or fail;
transport retries are disabled. Mint eligibility, receipt observation and the relay
worker share this transport. This does not infer whether a remote node accepted a
transaction before an HTTP failure; the original prepared journal remains authoritative.

**D-172** - Withdrawal relay pass - *Recover original state before signing and hold
the cooperative worker lock through every awaited operation.*
The worker traverses original nonce slots, retains recorded observations and reconciles
prepared transactions before further action. Current/pending nonce, chain, eligibility,
gas funding and exact-term simulation gate signing/broadcast. Only journal-readback
bytes are submitted; response loss cannot create another authorization or nonce.
Unknown state pauses the pass, while a later pass may rebroadcast the same original
bytes when the nonce remains available. Cancellation cannot release the process lock
while an awaited dependency is still running. Runtime provisioning must still bind
the dedicated key and actual inventory to the protected journal/directory. The core
and its real RPC wiring are implemented; production service and HTTP/browser migration
are not activated by this change.

**D-171** - Durable observed mint - *Retain the first worker-observed finalized mint
and distinguish historical evidence from an unknown latest RPC check.*
Journal reconciliation invokes the server-owned read-only observer using original
prepared bytes. Its first matched result is immutable and bound to the original
request, hash, recipient, value and gas terms on every readback. Later compatible
anchors do not replace the first observation; conflicting mint facts fail. Missing
or aborted RPC checks retain historical evidence with an explicit unknown latest
check. This is protected worker/RPC evidence, not a self-authenticating client proof.
No reservation is released and no application withdrawal is recorded here. SQLite
schema version 1 adds observation storage atomically; upgrading the original version-0
three-table journal is explicit and cannot reconstruct missing version-1 history.

**D-170** - Arc receipt finality - *Verify original transaction inclusion and a
consistent RPC finalized anchor under Arc's documented committed-block policy.*
The observer rematches the signed transaction and receipt, verifies exact block/index
inclusion and rechecks the receipt, inclusion block, finalized anchor and chain ID.
Arc documents one committed block as final and finalized as the latest block, so the
receipt's own block is sufficient when consistently observed. The finality result
explicitly trusts the operator-selected RPC; it is not independent consensus-signature
verification or minter implementation attestation. Bounded time, cancellation and head
freshness checks prevent stale/late evidence. Unknown, missing or conflicting RPC data
does not release funds or establish a failed withdrawal. Persisting observations and
connecting the dedicated signer worker remain separate runtime integration work.

**D-169** - Withdrawal receipt evidence - *Require the exact original transaction
and canonical minter event before accepting receipt-level cash-out evidence.*
Successful receipt status alone is insufficient. The matcher verifies the signed-byte
hash, relayer, minter, bounded gas accounting and attestation expiration height. One
canonical AttestationUsed event must match all routing, ownership and value fields;
every log must agree with its enclosing receipt identity. This remains receipt-level
evidence, separate from RPC observation, canonical inclusion, finality and deployed
code verification. Missing/reverted/malformed evidence cannot release a reservation,
record a completed withdrawal or imply a refund. Gas uses native wei; creator value
uses integer micro-USDC.

**D-168** - Relay nonce and gas journal - *Place a dedicated relay key's prepared
transactions and lifetime gas reservations in one durable local authority.*
The application request/attestation journal remains in its configured database. A
separate private SQLite journal belongs to the dedicated relay worker, so SQLite and
Supabase application deployments use the same nonce authority. All processes holding
the key must share that file. Explicit initialization pins policy and starting nonce;
normal reopening and partial-history loss cannot reset it. Immediate transactions
reserve contiguous nonces and maximum gas cost under immutable lifetime and slot caps.
Original request, attestation, terms and signed bytes are revalidated on recovery.
Missing responses never release gas or nonce reservations. No signer, broadcaster or
production integration is activated yet. Key exclusivity, protected storage/restore,
chain reconciliation and replacement/cancellation still require runtime enforcement.

**D-167** - Prepared mint identity - *Bind exact signed transaction bytes before any
storage or broadcast authority can depend on their hash.*
The validator accepts canonical Arc-testnet EIP-1559 mint transactions only. It rechecks
the original request/attestation, recovered relayer, nonce, minter, calldata, zero native
value and exact bounded gas terms; low-s is checked separately from address recovery.
The raw-byte hash is the transaction identity. Native gas wei and ERC-20 micro-USDC
remain separate integer units. The validator grants no nonce or broadcast authority;
exclusive signer custody, atomic gas/nonce slots and durable prepared-byte readback
still precede submission. An expired inner attestation cannot be used to release an
unknown outer signed transaction, which may still consume gas if mined and reverted.

**D-166** - Withdrawal journal concurrency - *Preserve both unique identities while
making duplicate storage recovery reliable under PostgreSQL contention.*
CI exposed unique-index races for the same request/spec and request/transfer UUID:
ON CONFLICT(id) alone does not handle a violation reported by the other unique index.
Migration 0065 serializes attestation saves on the existing request row. First request
insertion has no row to lock, so its unique-violation handler accepts only an already
stored original request ID; strict adapter readback remains mandatory. Different IDs
reusing a spec or transfer UUID still fail. No row is overwritten, no claim renewed,
and no network operation is retried by storage recovery. Fresh multi-caller PostgreSQL
insertion tests cover both paths and preserve original timestamps and permissions.

**D-165** - Withdrawal mint observation - *Check the exact original attestation at a
rechecked block without granting broadcast authority.*
The read-only observer recovers the payload signer, checks the intended minter's allowlist
and simulates the exact mint call from the selected relayer. Chain identity, code, expiry,
block freshness and hash readback must agree. A bounded deadline and transport cancellation
prevent late RPC completion from returning eligibility. Missing evidence stays unknown;
it never records settlement or releases an obligation. RPC and clock trust remain explicit,
and observed proxy bytecode is not implementation verification. This is a prerequisite
for prepared mint transactions, not an alternative to exclusive nonce/gas authority,
durable signed-transaction identity, exact receipt matching or finality verification.
The production withdrawal relay remains unchanged until the recovery journey is integrated.

**D-164** - Creator cash-out recovery - *Identify the original signed burn intent and persist
initial transfer admission before contacting Circle.*
The recovery journal uses the BurnIntent EIP-712 digest as its request identity, distinct
from Circle's transfer UUID and encoded TransferSpec hash. The underlying canonical spec
is separately unique: changing signed fee/expiry terms cannot obtain another admission
for that same transfer. Shared types preserve the
browser's existing signing format. Validation snapshots the request and operator policy,
checks exact padded addresses, same-chain routing, recipient, integer value/fee limits and
the recovered owner signature. Private immutable request/attempt rows preserve the original
policy and authorization. Only a successful new atomic claim with matching readback grants
initial transfer authority; an existing claim, elapsed time or a lost RPC response does not.
SQLite and service-only PostgreSQL RPCs implement the same admission rule. This is the first
layer of a larger recovery flow: the existing HTTP relay is not yet rewired. The original
request-matched attestation is stored immutably under the same claim, with exact readback;
matching bytes is explicitly separate from signer authorization or settlement. Deployed
minter checks, mint nonce authority and prepared-transaction recovery, authenticated
lookup, durable browser recovery and end-to-end failure acceptance remain required before
claiming cash-out recovery complete. The journal is private backend data, not settled earnings
or a public receipt; mainnet support and real-fund activation remain separate gates.

**D-163** - Private interruption recovery - *Restore the original backup first; an operator
may close an interrupted execution to new creator payments without replaying it.*
The operator uses the actual worker database, spool and encryption key under the same
exclusive worker lock. The command never stops a process or removes a retained crash lock.
A matching authenticated backup is restored with the original execution authority. Without
a result, closing requires a complete bounded scan of recognized backups; unknown files,
corruption and authority mismatch refuse the action. Preview is the default. Applying records
an immutable interruption against the original owner and worker, serialized with creator
admission. Only never-committed budget becomes reusable; every admitted authorization remains
backed regardless of expiry or observed status. Original payments, nonces and execution claims
are preserved. Late confirmations and restoration of the original result remain allowed,
while the spend fence remains permanent. Owner views explicitly report interruption and no
refund from this action. This extends D-162's result-only release eligibility. It is not
automatic retry, a completed answer, reimbursement or proof of lost off-site backups.
Operator quiescence, use of the correct storage and protected locator handling remain required;
full support/refund policy and independent paid crash acceptance remain open.

**D-162** - Private treasury reuse - *Release only never-committed budget after durable
result sealing; keep every admitted authorization charged to the lifetime ceiling.*
Creator admission and result persistence already serialize against the execution identity.
Once a validated result exists, no new creator leg can enter that job. An append-only,
job-keyed release records original creator budget minus the sum of all admitted legs.
No caller supplies the release amount. Confirmed, pending, processing, expired and
failed-observed submissions all remain allocated; neither answer totals nor absence of a
receipt can free their backing. A worker claim or encrypted backup without a restored
database result is insufficient. Original reservations, nonces and execution claims stay
intact. The coordinator applies the release idempotently after its creator page completes,
and retries storage failures on later sweeps without signing or resubmitting payments.
SQLite uses a conditional atomic insert; PostgreSQL takes the pool and execution locks,
with service-only RPC authority. New reservations and operator summaries subtract the
recorded release; conservative backing remains capacity minus confirmed outflows. This
is internal capacity reuse, not a transfer, refund, top-up, revenue or profit. Releasing
admitted failed legs, capital replenishment and long-history scheduling remain separate work.

**D-161** - Remote wallet SDK startup - *Restore remembered connectors; initialize other
remote SDKs only after explicit wallet selection.*
The installed wagmi reconnect action probes every connector's provider, and WalletConnect
also initializes its provider in setup. Wrap MetaMask and WalletConnect while keeping the
injected connector unchanged. Capture recent and persisted connection IDs through wagmi
storage before createConfig can persist its empty initial state. IDs are startup hints,
not account authorization. Preserve all saved connections, including a non-current one.
A never-selected remote provider refuses automatic probing; explicit connect activates it,
initializes provider/event listeners once, and forwards original arguments, capability
results and runtime connector context. Automatic setup errors are contained because wagmi
does not await setup; explicit selection reports failure and can retry initialization.
If connection hints were lost, selecting the wallet explicitly restores its normal SDK flow.
Existing wallet/session/chain/balance/signature/payment checks remain authoritative. This
reduces unnecessary SDK startup; it is not a diagnosed fix for prior headless renderer stalls.
Vendor connector and storage-format upgrades require renewed restore/event tests.

**D-160** - Private local deletion - *Remove question/signature payloads without removing the
local submission barrier.*
An explicit two-step browser action replaces a validated local journal with a minimal
account/job marker in the same strict-durability IndexedDB transaction. Complete-row
comparison refuses concurrent state changes. The marker contains no question, salt,
authorization or signature; local recovery pagination skips it. Exclusive reservations,
signature saving and submission claiming cannot reuse a deleted job. An explicitly imported,
validated backup may replace the marker atomically, but only as recovery-only imported state.
This preserves the server's independent admission authority and does not cancel an already
claimed/in-flight payment or release any budget. The UI clears its displayed result and draft;
other open tabs, exported files, server history, browser/OS backups and storage-level remnants
are outside this deletion boundary. This is application-level removal, not secure disk erasure.
Corrupt or foreign-account journals remain fail-closed. Server retention, automatic expiry,
cross-tab memory clearing and secure-erasure guarantees are not established by this feature.

**D-159** - Private browser purchase integration - *Separate proposal, consent, signing and
one-attempt submission; recover the existing intent after uncertainty.*
The signed-in browser requests private terms with POST. A quote proposes the provider/model
and endpoint for explicit review; it does not silently authorize a later policy. The buyer
retains the full reviewed request, merchant pins and total/fee limits, then requires a fresh
available quote to match exactly before generating an authorization. Account session, connected
wallet, Arc chain and Gateway balance are checked around the signature. The first signature
is saved even if the prompt outlives cancellation, then the durable browser claim precedes
the sole private purchase POST. Failed, missing or malformed responses never trigger retry.
Credentialed transport allows only exact same-origin session/quote/private-purchase/result
routes, with no redirects or private query parameters. Recovery shares the CLI request/spend
validator and sends no payment. The UI exposes configured pilot availability, provider policy,
retained unused budget, best-effort quality and plaintext local-storage consent; export is
explicit and imports remain recovery-only. The public page passes only merchant addresses,
not provider credentials or treasury keys. Server admission/allowlisting remains authoritative.
The Chromium acceptance uses synthetic wallet RPC and intercepted HTTP, including response
loss, reload, account/wallet changes and viewport checks. It does not establish independent
wallet-extension/mobile acceptance, a new live paid pilot, portable cryptographic private
receipts, local deletion/retention completion or mainnet readiness.

**D-158** - Private browser recovery foundation - *Reserve before signing and commit a
single submission claim before HTTP.*
Use a separate IndexedDB database for private jobs. A fresh unsigned draft binds the payer,
private/public merchant separation, exact question, provider policy, budget, salt and nonce.
Reserve it exclusively before a wallet prompt. Save and verify the first EOA signature against
that draft, then use a strict-durability transaction with a complete-row comparison to admit
only one submitting tab. Transaction completion, not individual write success, is the boundary.
Any imported CLI/browser intent is recovery-only. Reload never generates a replacement
authorization. Local enumeration includes reservations that never reached the server.
The browser and CLI share signature validation, commitment checking and the existing job-ID
preimage; Web Crypto preserves the server SHA-256 identity. Caller-supplied trusted merchant
pins remain separate from saved or imported data. IndexedDB and explicit exports contain
plaintext private questions and bearer signatures: they are not encrypted or protected from
same-origin script compromise. The eventual UI must disclose this before storing and require
an explicit export action. Browser persistence cannot prove payment, survive storage eviction
or replace server-side admission. This stage provides storage primitives and Chromium tests;
browser quote/review, wallet signing orchestration, HTTP submission and deletion UX are not
enabled by importing the module.

**D-157** - Provider call accounting - *Correlate usage with actual model calls, not reasoning steps.*
The first private paid pilot recorded six served reasoning steps and seven usage records.
Synthesis can perform a second evidence-review request, and its failure is intentionally caught
to retain the answer. Each shared JSON transport invocation now receives a local random call ID,
with pending/returned/failed state and asynchronously isolated correlation on its usage record.
No prompts, response bodies or provider request IDs are retained. Anthropic SDK retries are
disabled so retry attempts pass through the existing resilient engine and call ledger.
Complete cost coverage requires one matching usage record per returned call, no failed or pending
call, and explicit reasoning evidence. Failed work remains conservatively unpriced even with
reported counters. Compact projections carry coverage version 2; old complete classifications
cannot prove this stronger invariant and remain unpriced, without rewriting historical results.
This fixes coverage eligibility, not vendor invoices, current rate verification, or profit.

**D-156** - Private worker supervision and deploy ordering - *Drain before replacing live
worker code; retain crash evidence instead of forcing a restart.*
Use a systemd unit on the existing VPS with explicit environment-file loading, SIGTERM,
an unlimited stop timeout and no automatic SIGKILL or restart. The worker's existing
permanent execution claims and cooperative lock remain untouched. Before changing Git or
dependencies, deployment stops a previously active private service and verifies inactive state
and zero MainPID. It starts that service again only after web health passes. Absent/inactive
services stay that way. Failed/transitional states or a failed stop block source replacement;
later deployment failures leave the private service stopped for operator inspection, including
web rollback. A service being active is not an idle/readiness assertion. Infinite drain can
delay deploy or shutdown indefinitely; an operator must inspect actual process/job state before
any forced intervention. This unit uses the current root-owned single-host layout, not a claim
of production identity isolation, automatic recovery, alert delivery or mainnet acceptance.

**D-155** - Private pilot HTTP integration - *Use the same account-aware operational bootstrap
for quote availability and payment admission.*
Mount the owner-session-only POST purchase route with same-origin checks, bounded JSON,
per-wallet throttling and the disabled-by-default pilot bootstrap. Read purchase bodies before
readiness so a slow body cannot age the operational observation; revalidate the session afterward.
Quotes use the ready service's own policy snapshot and advertise availability only for an allowed
authenticated payer. An unavailable bootstrap can still produce a non-purchasable quote preview.
Both routes recheck the session after asynchronous readiness. Neither quotes nor HTTP 202 promise
completed research or chain finality. Production flags remain off; supervision and an end-to-end
owner pilot are required before enabling them. This supersedes D-154's unmounted-route status,
not its best-effort availability limits or durable database payment authority.

**D-154** - Restricted private purchase bootstrap - *Compose operational observations for
explicit pilot accounts while keeping durable payment authority in the existing service.*
The prepared bootstrap requires a separate purchase enable flag and a bounded server-configured
list of payer addresses. It snapshots validated policy, derives configured signer identities,
and requires a matching idle worker observation, fully backed treasury and nonzero unallocated
capacity before exposing the service for that request. Run these read-only checks through the
existing five-second readiness wrapper; never cache the returned service across requests.
This is a best-effort availability gate for a restricted pilot, not a durable admission lease:
the worker can stop or funds can change after observation. Atomic treasury reservation, exact
authorization verification and the permanent incoming submission claim remain the payment
authority. Worker supervision, owner session/origin checks and recovery remain necessary.
No HTTP route mounts the new bootstrap, and neither quote availability nor production purchase
flags change in this commit. General availability and mainnet acceptance require stronger
operational evidence than this restricted gate.

**D-153** - Private worker reconciliation scheduling - *Recover results, observe pending payments,
then execute eligible work with separate accounting authority.*
Enabled workers now visit one treasury-reserved job per iteration, including unconfirmed incoming
payments and already executed jobs. Exact existing reconcilers perform read-only Circle searches
and persist matching evidence; the coordinator has no signer or payment submission capability.
Creator scans continue in pages of 25 using private in-memory cursors; empty job pages restart
the sweep so earlier inserted IDs are revisited. A cooperative 30-second search signal and process
shutdown stop additional searches without racing paid work. Database waits may outlast that signal.
Errors advance past a bad job, remain redacted and mark the iteration degraded; they do not prevent
unrelated settled jobs from executing. Processing, failed observations and mismatches never release
capacity or authorize retry. This is polling, not a readiness lease or latency guarantee; completed
reservations remain in the sweep and large histories will need indexed pending-only selection.

**D-152** - Private creator evidence progression - *Keep checking processing observations and
only advance the same transfer to confirmed evidence.*
A real SQLite regression reproduced received/batched creator records being permanently skipped,
so owner spend and treasury backing could never reflect later confirmation. Reconciliation now
distinguishes processing from confirmed counts and rechecks processing records. Both adapters allow
one atomic update from received/batched to confirmed/completed only for the same search source,
transfer identifier and complete admitted submission. Facilitator and confirmed records stay
immutable; mismatched transfers and downgrades cannot replace evidence. The existing timestamp
remains the first observation time, not a finality timestamp. This supersedes the earlier blanket
first-writer rule for processing search stages only. No authorization, budget or execution claim is
released or replayed. This remains Circle-observed evidence, not independent chain verification.

**D-151** - Economics usage coverage - *Missing provider usage is unknown cost, not free work.*
Price a run only when its reasoning attempts account for all recorded provider responses and
contain no failed provider attempt. Circuit-open skips are not calls; explicit heuristic-only
execution can have zero token cost. Persist a compact coverage classification without copying
attempt traces. Old projections lack this evidence and remain unpriced. This conservative
observer cannot prove invoice completeness or whole-service profit; dated rates and the explicit
testnet shadow-pricing assumption remain unchanged.

Transport follow-up: real engine tests reproduced empty, partial and malformed compatible-provider
usage being normalized into apparently measured counters. Require explicit valid input/output
counters before recording a response; preserve the valid answer when usage is unavailable. Optional
cached counts may be absent but must be valid and bounded when present. This closes the parser gap
before compact coverage is calculated; historical projections are not rewritten.

**D-150** - Private worker reasoning counters - *Report observed provider and fallback
use separately from successful result persistence.*
For newly executed jobs that return a run, the worker counts primary-tier served,
failed/circuit-open and fallback-tier served attempts as job-level flags. Missing
attempt traces are unknown. These counters can overlap for mixed runs and do not
include re-read stored jobs or claim-only responses. Execution exceptions remain
errors and may provide no reasoning trace. Only aggregate counts leave the worker;
no engine names or provider error bodies are copied. Allowed heuristic fallback does
not turn a saved result into a failed payment/job, and zero observed failures is not
a provider-health guarantee.

**D-149** - Private purchase session revalidation - *Recheck the original live owner
session after readiness/body waits and before invoking payment admission.*
A regression test with actual SQLite revocation reproduced the prepared handler
accepting a purchase after its session was revoked during asynchronous readiness.
The handler now requires an active session with the same owner and session identifier;
revocation or session lookup failure stops submission. This is a boundary check, not
an atomic transaction spanning revocation and settlement. It does not revoke already
issued payment signatures or cancel a submission that has already entered the service.
The public private-purchase route remains unmounted.

**D-148** - Private operations inspection - *Compose worker-policy and treasury
observations in an explicit operator diagnostic command without enabling checkout.*
The command derives configured signer addresses without signing, validates private
runtime policy, and opens the normal database adapter. It reads worker state before
and after the backing check to flag a changed instance/configuration/phase. Reports
omit process IDs, wallet identities, provider endpoints and private job data. Exit zero
only means these observations show matching idle state, backing and spare capacity;
checkoutReady remains false. Disabled configuration does not import signer/database
modules. Database initialization may apply normal adapter schema setup. No spool is
created and no execution or payment operation is invoked. Provider acceptance, durable
admission fencing and the remaining product/mainnet gates are not inferred.

**D-147** - Private treasury backing observation - *Compare recorded conservative
coverage with Gateway available micro-USDC, preserving unknown and insufficient states.*
The read-only inspector snapshots trusted treasury policy, verifies the pinned network
and domain, and requires stored capacity to match configuration. An absent pool uses
the full configured ceiling, never zero. A null balance remains unavailable. Accounting
is read again after the uncached balance request; observed changes invalidate the
comparison. Cancellation prevents subsequent reads, though an already-started Gateway
request retains its own transport timeout. A backed observation never reports checkout
ready: it is not an atomic cross-system reservation and cannot establish exclusive
signer authority, provider health or future available funds.

**D-146** - Private treasury observation - *Read lifetime capacity, allocations and
creator commitments in one SQL snapshot, keeping uncertain payments separate.*
Both adapters expose an operator-only summary; PostgreSQL uses a service-role-only
SECURITY INVOKER function. Confirmed amounts count facilitator success or confirmed/
completed transfer-search evidence, never received/batched or missing proof. The
conservative backing target is capacity minus recorded confirmed creator outflows.
Pending/processing commitments remain covered, including potentially already deducted
amounts, so this is conservative rather than a measured free balance. No allocation
is released. Inconsistent totals or mismatched stored proof are refused. This is a
database observation, not independent receipt verification, profit, refund authority,
live funding evidence or a checkout-readiness decision.

**D-145** - Private worker configuration identity - *Bind advisory worker observations
to a canonical digest of validated public operating policy.*
The digest includes the pinned network, private/public merchants, treasury signer and
capacity, service fee and full reasoning disclosure. Addresses are normalized and
field order is canonical; credentials and signing/encryption keys are excluded.
Bootstrap computes it from the validated policy used to construct the worker, and
status-v2 records include it. Inspection requires an exact expected digest and commit;
old status-v1 records are unavailable. Matching remains advisory and explicitly never
returns checkout ready: it cannot verify provider credentials, actual funds, complete
signer inventory, process fencing or storage health.

**D-144** - Private purchase readiness boundary - *Await bounded server-owned checks
before obtaining a purchase service.*
The prepared HTTP handler supports asynchronous bootstrap and supplies a cancellation
signal to read-only readiness checks. Errors, request cancellation and a five-second
timeout return unavailable; late resolution cannot call submit. Bootstrap must not
sign, reserve or settle because timed-out underlying work can continue if it ignores
cancellation. Request cancellation is checked again before submission. No concrete
worker/funding/configuration acceptance policy or public purchase route is enabled
by this boundary; the advisory status file alone remains insufficient authority.

**D-143** - Private operator exclusion - *Hold an exclusive spool-directory lock for
the complete worker run or manual restore operation.*
The command acquires `private-worker.lock` before database initialization and releases
it only after draining work and closing the database. Exclusive creation rejects a
second operator; release verifies the original random instance record before deletion.
Partial lock writes and process crashes require manual inspection, never age/PID-based
takeover. The lock coordinates these commands on a controlled local filesystem; it
does not fence arbitrary code, separate spool directories or distributed workers.
The permanent database execution claim remains execution authority. No private payment
nonce or claim may be reset as part of cleaning an abandoned filesystem lock.

**D-142** - Private worker observation - *Persist bounded local lifecycle observations
without treating them as a checkout lease.*
The operator loop writes starting/recovering/working/idle/degraded/stopped transitions
to an atomically replaced file in the controlled spool directory. Starting new work
requires its pre-work observation write to succeed; active execution is never raced
against a telemetry timer. Records contain only process identity, commit, phase and
timestamp. The reader rejects malformed, oversized, future and older-than-30-second
observations and never reports checkout ready. A long active job may make the last
observation stale without proving the worker died. Cross-process fencing, shared
configuration identity, funding/provider checks and public admission remain separate
unfinished gates. This is operational evidence, not payment authority.

**D-141** - Private buyer checkout - *Compose independently pinned request and price
limits, temporary owner sign-in, availability checks and a single journaled submission.*
The CLI accepts a bounded private request file, never a question on the command line.
It snapshots buyer policy before asynchronous work and refuses an existing state
directory before login. Server availability is necessary before payment signing;
the current quote route still disables purchasing. A changed owner, provider, request
or price fails validation. The payment authorization and attempt marker are durable
before HTTP submission. Ambiguous responses require read-only recovery, not a retry.
Sign-out must be confirmed before success returns; a late sign-out failure does not
mean payment was never attempted. The command does not activate checkout or mainnet.

**D-140** - Automatic result recovery - *Run bounded encrypted-backup recovery before
admitting more private worker jobs.*
The operator loop scans at most 25 directory entries per iteration with a retained
iterator. Failed restores remain on disk; scanning advances rather than repeatedly
selecting the first failed file. New work waits for a complete error-free sweep.
Restoration uses existing immutable database admission and never reexecutes research.
Shutdown drains a current restore before closing the iterator. Directory errors and
restore failures produce counters only. This assumes one operator worker per spool;
it is not a cross-process lock or a snapshot of concurrently modified directories.
Production provisioning, key lifecycle, disk monitoring and crash acceptance remain open.

**D-139** - Private recovery operations - *Require encrypted result storage for the
operator worker and provide a separate single-backup restore command.*
The enabled bootstrap rejects a missing spool. The command requires an absolute
operator directory and an explicit encryption key before opening the database.
Restore authenticates the backup before database initialization and uses immutable
result admission without starting a worker or constructing a signer. It remains usable
with the worker disabled and prints no private content. Operators must select the
original database and stop concurrent work before manual recovery. Automatic recovery,
key lifecycle and production provisioning are not implied by this command.

**D-138** - Private result recovery - *Optionally persist an authenticated encrypted
result backup before attempting the primary database write.*
AES-256-GCM uses a dedicated environment-supplied encryption key, random IV and random
filename token bound as authenticated data. Recovery calls the existing immutable
result admission method, preserving original owner and permanent worker-claim checks.
Only an exact database acknowledgment permits backup deletion. A database outage must
not cause paid research to execute again. This is an optional executor dependency,
not enabled by the production bootstrap. Key provisioning, recovery scheduling,
retention and filesystem failure acceptance remain launch gates. See
`docs/engineering/private-result-spool.md` for durability and privacy limits.

**D-137** - Private worker process - *Poll sequential bounded ticks with explicit
operator environment configuration and drain active work on SIGINT/SIGTERM.*
The command is disabled by default before configuration/database imports and does not
automatically load a legacy environment file. Idle sleep is abortable, but active
execution is awaited rather than raced against shutdown. Unexpected tick exceptions
are redacted; summaries contain counters only. Errors/unpersisted results set a nonzero
eventual exit code while the daemon continues polling. Once mode executes one tick,
not a readiness probe. No PM2 registration or checkout activation ships with the command;
funding, supervisor grace period and claimed-job recovery require operator acceptance.

**D-136** - Private worker bootstrap - *Require explicit private worker and research
configuration, derive the dedicated EOA from its environment key, and construct the
batching signer without loading or creating legacy wallets.*
The bootstrap validates runtime merchant/provider/treasury policy against configured
public funder and seller identities, cached reserved payees, Arc-testnet network and
domain 26. Worker balance reads use the existing bounded Gateway reader; unknown funds
throw and zero remains zero. No deposit or transfer is initiated. The returned worker
has not run, does not prove backing for its configured capacity, and is not checkout
readiness. Tests verify a real SDK-generated signature locally with an unfunded EOA.
Full operator signer inventory, prefunding, daemon health, recovery and launch gates
remain required before activation; environment flags are not evidence those gates passed.

**D-135** - Private worker ticks - *Process one bounded candidate page serially through
the existing executor; retain the cursor privately and isolate per-job failures.*
Overlapping ticks on one worker instance are refused. Configuration and signer methods
are snapshotted at construction, with explicit provider validation and no legacy engine
fallback configuration. The cursor advances after errors so a bad job cannot starve
later IDs, and resets after a short page. Pause only between jobs; never race a paid
execution against a polling timeout. Executor claims remain the cross-process authority.
Summaries contain counters only. A returned run counts as completed only when private
result storage can be read; absent storage is reported as unpersisted. Claimed jobs
are never reset or reexecuted. The polling primitive is tested with the actual executor
and SQLite using a blocked provider transport, local fallback and an empty corpus.
A daemon, operator bootstrap, readiness gate and recovery for claimed-but-unpersisted
jobs remain outstanding; these counters alone are not an operational readiness signal.

**D-134** - Private worker discovery - *Page backend-only candidate IDs by dedicated
treasury signer, requiring stored settlement fields and no existing execution claim.*
SQLite and a service-role-only PostgreSQL function select at most 25 IDs/owners in
ascending ID order with an exclusive cursor. Restart each sweep after its last page
to pick up newly inserted IDs below the cursor. No question, signature, provider key
or receipt is returned. Selection is a hint, not signature/settlement validation or
execution authority; runPrivateResearch must revalidate and win its atomic claim.
Pending payments and already-claimed jobs cannot be selected, and claims are not leased
or reset. Tests cover database reopen, cursor bounds and PostgreSQL permissions.
The polling loop, worker bootstrap and operational readiness gate remain to be wired.

**D-133** - Private purchase HTTP boundary - *Use a live account session and same-origin
check before a server-provided limiter/bootstrap, bounded input and backend admission.*
The handler takes its payer from the durable session, not body fields, and passes the
submission to the existing signature/pricing/treasury service. Responses are no-store
and expose only job ID and server-reported payment status. Known confirmation that failed
initial persistence gets one storage-only retry; no second payment operation runs. If
storage remains unavailable, the original pending attempt requires reconciliation.
Private exceptions and recovery confirmation are omitted from responses. A common
64-KiB/five-second body reader now serves this handler and MCP without changing MCP's
public error response. The purchase handler is not mounted at a public route: a
worker-ready bootstrap, rate-limit wiring and operational acceptance remain required.

**D-132** - Private buyer submission - *Send the verified saved payload only after an
exclusive durable local attempt marker, and recover by reading after any uncertainty.*
The internal Node transport requires an existing account cookie, pins the private URL,
disallows redirects and sends no caller-supplied quote requirements. It does not sign,
fund or retry. Non-success HTTP responses, timeouts, invalid/oversized bodies and foreign
job IDs preserve the marker and require recovery. Existing markers prevent another
HTTP attempt, including after rejection. An authorization outside its validity window
is not sent and its claimed marker remains reserved. Successful responses are explicitly
server-reported; they do not independently verify settlement or permit another payment.
The private HTTP purchase route, CLI composition and worker activation remain unwired.

**D-131** - Private buyer preparation - *Validate independently chosen quote terms,
reserve a new local directory before signing, and verify/persist the signed intent
before returning a journal reference.*
The Node helper snapshots merchant policy and signer identity, uses the private v2
commitment and existing Arc-testnet typed data, then verifies the actual EOA signature.
An existing directory denies a fresh attempt before signing. Signing, validation or
write failures retain the reservation and produce a generic error; callers must not
delete it and regenerate an authorization as recovery. Output is a local journal
reference, not a paid or submitted job. Plaintext journal and Windows ACL limitations
remain unchanged. This helper performs no network call, funding, payment submission
or feature activation, and is not yet exposed in the CLI or browser checkout.

**D-130** - MCP input limits - *Read POST bodies once with a 64-KiB byte cap and
a five-second deadline before access resolution or tool dispatch.*
Count streamed bytes independently of Content-Length, reject invalid UTF-8/JSON with
a generic JSON-RPC error, and pass the parsed value into the SDK transport. Cancel
without awaiting an untrusted cancellation promise so the deadline also bounds error
cleanup. Walk nested batches iteratively to avoid recursive stack exhaustion. These
limits complement existing origin, rate and treasury checks; they are not a global
concurrency cap or a replacement for deployment-level request limits.

**D-129** - Private recovery CLI - *Validate the journal before login, recover in a
temporary session, then optionally write a new private snapshot after sign-out.*
The command reads KERYX_BUYER_PRIVATE_KEY only from its environment and requires explicit
trusted merchant addresses. It never creates/funds wallets, signs payment typed data or
changes original intent/attempt files. Default stdout contains state and integer spend
summaries without job ID, question, answer or cookies. Explicit output is exclusive,
plaintext and labelled server-reported evidence; an existing destination fails before
login. Session revocation must be confirmed before output is written. Failure diagnostics
omit private exception bodies. The command supports existing private journals only; it
does not make private checkout, journal creation UI or independently verified private
receipts available.

**D-128** - Temporary buyer account sessions - *Use pinned SIWE login for private
read recovery, keep the cookie in memory and confirm revocation before returning.*
The Node helper signs only a keryx.cc Arc-testnet SIWE message with a fresh validated
challenge and 15-minute expiry. It does not accept arbitrary signable server text or
payment typed data. Requests have bounded deadlines and bodies; raw auth errors and
cookies are not propagated. Success or operation failure both enter sign-out cleanup;
one idempotent revocation retry is allowed, and unconfirmed revocation is an explicit
failure. A lost login response can create a server session whose cookie is unknown,
so expiry remains the fallback and full revocation is not claimed in that case. This
helper is not yet a CLI command and does not persist credentials or activate purchases.

**D-127** - Private buyer read recovery - *Use the validated local intent and a live
account cookie to request the existing private result, never to resubmit payment.*
The Node recovery helper calls only the pinned account result endpoint with the job ID
in a POST body, a bounded deadline and redirect rejection. It never sends the original
payment signature/salt or changes journal state. The returned owner, research fields,
package, price and budget must match the signed intent; integer creator accounting and
per-leg status totals must reconcile. Session expiry, missing results and malformed or
mismatched responses produce generic failures without copying response bodies. This is
a server-reported view, not an independently verified portable receipt; the existing
response does not bind a result digest or expose a signed per-job result proof. CLI login,
commands and encrypted local backup remain incomplete.

**D-126** - Private buyer journal recovery - *Persist the original provider-bound
signed intent and claim a local submission marker before any HTTP payment attempt.*
The Node-side journal validates EOA ownership, canonical commitment, private resource,
trusted merchant and derived job ID on create and restore. Restoring an expired intent
is allowed for recovery; it never refreshes nonce, salt or signature. A bounded 64 KiB
read prevents unbounded file parsing. Exclusive directory/file creation and fsync precede
submission authority; existing or partial attempt markers deny another local attempt.
This is a plaintext private journal with restricted creation modes, not encryption or
a Windows ACL guarantee. Copies and tampering cannot replace server-side nonce checks.
No CLI command, browser storage or payment request is activated by these helpers; clients
must use the claimed validated snapshot and recovery-only paths after an attempt.

**D-125** - Authenticated quote preview HTTP boundary - *Require live sessions and
same-origin bounded POST bodies; expose preview terms only.* The new account quote
route derives its owner from the revocable session, accepts at most 16 KiB within five
seconds and returns no-store responses. Bootstrap defaults off and derives private and
public treasury identities from explicitly configured keys without signing, funding or
legacy wallet creation. Invalid/missing keys and stale public merchant reservations
fail closed with generic errors. Only the quote method leaves bootstrap. Every successful
response explicitly reports purchasingAvailable=false; no private payment endpoint is
introduced. Production remains disabled until private runtime provisioning and the rest
of checkout/worker/operational acceptance are complete.

**D-124** - Private service composition - *Derive payment requirements from the
validated runtime and an explicit integer service fee, never from submitted metadata.*
The backend service snapshots runtime configuration, builds quotes with signed creator
budget plus operator service fee, then rebuilds those same requirements for admission
before invoking capacity-gated incoming settlement. Client-supplied payment requirements
are rejected by the strict submission envelope; an otherwise valid signature for a
lower amount cannot pass admission. Runtime fee input is mandatory, positive and bounded
to keep total within the existing one-USDC testnet limit. Repeated signed submissions
reuse durable intent/payment state. Only the response projection is intended for HTTP;
unpersisted success evidence remains in a separate backend recovery field. No HTTP
route, session authentication, browser checkout or worker activation is introduced.
Those layers must consume this service and preserve its authority boundaries.

**D-123** - Explicit private runtime configuration - *Default off; require distinct
merchant/treasury authority and an operator allowlisted reasoning endpoint.* The backend
policy parser accepts only an explicit 0/1 enable flag, pinned Arc testnet context and
complete private credentials/configuration. The private merchant must appear in the
public seller reservation set. Its payee and creator treasury signer cannot reuse known
public treasury authorities; the creator signer must also match the configured private
address and must not be a reserved merchant. Context signer addresses must be derived
from actual backend signer instances. The private engine factory resolves the endpoint,
which must match an explicit operator allowlist. Parser failures never expose raw input
or credentials. This validates configuration consistency only, not funding, legal/provider
retention approval or a complete signer inventory. The parser is not yet a route switch;
no purchase endpoint is activated by setting these variables alone.

**D-122** - Treasury admission enforcement - *Reserve shared creator capacity after
payer verification but before incoming settle; bind v2 execution to the saved signer.*
Fresh private payment submission requires an explicit operator treasury policy. Verified
payments that cannot obtain capacity return capacity-unavailable before claiming or
submitting settlement. A lost allocation acknowledgement cannot authorize settlement;
a later attempt can recover the same immutable allocation. Existing incoming attempts
return their previous state without reallocation. Before any funding check or execution
claim, v2 execution reads an owner-scoped allocation and requires its signer to match
the actual creator-payment signer. Readback also validates the signed budget. Stored
results and existing execution claims remain recoverable without creating allocations.
No configured ceiling proves funds exist: dedicated signer backing, safe replenishment
and release handling remain operational prerequisites. Public purchase routes remain
closed; no real allocation or payment was created by these synthetic tests.

**D-121** - Shared private treasury capacity - *Allocate signed creator budgets
atomically against an immutable ceiling for a dedicated signer.* Per-job caps alone
cannot prevent concurrent jobs from assuming the same available funds. The new database
primitive binds one permanent reservation per job to its verified signed creator budget.
SQLite uses a single conditional insert; PostgreSQL locks the signer pool before summing
allocations. Retries return the matching original allocation; signer/ceiling substitution
fails. Supabase requires matching readback after RPC success and never treats a lost
response as a new allocation authority. Integer micro-USDC values are bounded below the
JavaScript safe integer limit. This is a conservative lifetime allocation, not a balance
oracle: completed and uncertain jobs keep their allocations. It requires a dedicated,
verified-funded signer with no other spending paths. No pool has been provisioned and
the primitive is not yet wired into purchase/execution. Safe replenishment, unused-budget
recovery and abuse-resistant prepayment admission remain prerequisites for public use.

**D-120** - Authenticated private admission - *Rebuild trusted quote terms and
match the verified signed request before reserving an intent.* The backend boundary
requires the authenticated payer to equal the locally verified signing EOA. It resolves
provider disclosure from a copied operator configuration, reconstructs the quote from
the signed research fields and trusted payment requirement, and applies the strict v2
quote validator. Foreign owners, tampered requests, legacy requests and changed provider
policies fail before any database write. Identical admissions retain the original intent;
reservation neither submits payment nor grants execution. The helper returns only an ID
and reserved status, not bearer authorization. The real database test now composes quote,
EOA signing, admission, synthetic facilitator settlement, pinned engine execution and
stored-result recovery. Live-session routing, operator pricing and endpoint approval,
capacity reservation and browser consent still need wiring before purchase activation.

**D-119** - Private incoming recovery - *Persist exact confirmed/completed Circle
transfer-search evidence without resubmitting payment.* Owner-scoped reconciliation
uses the shared bounded, paginated search and independently matches nonce, payer,
recipient, networks, token and integer amount. Received/batched observations remain
processing; missing, mismatched and failed observations keep the durable attempt
pending and never authorize retry or release. Only confirmed/completed search evidence
can satisfy incoming payment for execution. Its provenance and observed transfer stage
remain distinct from facilitator success; neither asserts independently verified chain
finality. Existing first confirmation is immutable. SQLite validation and PostgreSQL
RPC migration 0054 accept the new evidence variant. No public endpoint, scheduler or
purchase activation is introduced; operator wiring and acceptance drills remain open.

**D-118** - Private incoming settlement - *Claim once before settle; retain ambiguous
attempts permanently and return unpersisted confirmation for storage-only recovery.*
The backend helper reads a verified durable intent owned by the caller, requires v2
provider binding for fresh submission, checks authorization time and verifies the payer
before atomically claiming submission. Only the fresh claimant calls settle. Existing
pending or settled attempts return without another facilitator call, including after
expiry. Success requires a valid payer/network/transaction and exact saved authorization
tuple. Invalid, lost or failed settlement responses remain pending. Confirmation write
failure returns backend evidence for retrying persistence, never resubmitting payment.
The fixed testnet transport uses a 30-second deadline, 64 KiB response limit, no redirects
and no retry or discovery extensions. Payload metadata excludes question, salt, private
job ID and provider disclosure. The installed batching SDK wire format was inspected;
this path uses bounded HTTP instead of its unbounded default fetch. No public route is
activated. Caller authentication, trusted quote/merchant/provider admission, incoming
reconciliation and operational readiness remain prerequisites for opening purchases.

**D-117** - Private quote terms - *Build secret-free provider-bound quotes and
validate them against independently selected buyer terms before authorization.*
The backend uses the same private engine factory as execution to resolve provider
and wire model. The portable buyer validator requires v2 disclosure, exact resource,
Arc testnet requirement and separate trusted merchant. Integer micro-USDC arithmetic
checks total, creator budget and service fee against independent total and fee caps.
Quotes explicitly retain unused budget and promise best-effort research only; misleading
refund or quality terms are rejected. Successful parsing is neither buyer consent nor
payment evidence. No HTTP route, signing, payment admission or provider call is enabled.
Operator endpoint approval, retention disclosure and an actual consent flow remain open.

**D-116** - Private execution transport authority - *Construct the v2 engine
inside the executor from explicit backend configuration, then compare its disclosure
to the signed request before any funding check or execution claim.* A separately
supplied policy could previously match while an injected engine used another provider.
The v2 path now exclusively uses the pinned private factory, with no arbitrary engine
callback. Configuration is copied before storage awaits. Legacy v1 callback execution
remains for historical internal callers and does not establish provider consent; it
cannot execute a v2 request. Stored-result and claimed-job recovery need no provider
credentials. The factory does not perform HTTP during construction. Endpoint approval,
retention terms, admission and buyer-facing consent remain necessary before purchases.

**D-115** ? Signed private reasoning policy ? *Bind resolved provider, model,
endpoint, local fallback and prohibited redirects into the authorization nonce.*
Requests with an explicit strict reasoning disclosure use commitment domain v2;
legacy v1 canonical bytes remain unchanged for historical verification. Unknown
fields or a model/disclosure mismatch cannot silently downgrade to v1. Fresh backend
execution requires its supplied policy to match the signed disclosure before funding
checks, model construction or claiming work. Stored-result and existing-claim recovery
remain read-only and do not depend on the current provider configuration. The trusted
caller must supply the matching private engine factory; a matching policy alone does
not prove which engine was injected. Legacy requests do not establish provider consent.
No private purchase route is enabled by this change. Approved endpoint inventory,
retention disclosure, buyer consent UI and actual payment admission remain outstanding.

**D-114** · Private reasoning provider boundary · *Construct one explicit catalog
model/endpoint with local fallback, no automatic provider rotation or redirects.*
The backend factory requires an exact current catalog ID, matching provider, HTTPS
base URL without credentials/query/fragment and an explicit server credential. It
rejects retired/default aliases rather than silently remapping them. Planning and
synthesis use the same pinned wire model. Each job gets its own memory circuit store
and deterministic heuristic fallback; public durable circuits and provider defaults
are not selected. Fetch rejects redirects under the private option, and transport
options are copied so caller mutation cannot reroute later steps. A secret-free
disclosure records the resolved endpoint/model/fallback. It is not yet bound into
buyer-approved quote/intent state, so this factory is not activated by private purchase
or execution routes. Approved endpoint inventory, provider retention terms and durable
disclosure binding remain release prerequisites. Existing public redirect behavior is
preserved; the private factory explicitly selects the stricter policy.

**D-113** · Reasoning failure log privacy · *Retain operational categories, never
raw provider or circuit-store error bodies.* Provider fallback previously interpolated
the full thrown message into a warning, even though structured attempts already used
categories. Errors can echo request text or credentials. Warnings now use the same
category and a runtime-validated integer HTTP status only; malformed status values
cannot enter structured attempts. Circuit-store failures log the failed operation and
memory fallback without copying arbitrary database error text. Fallback and circuit
behavior remain tested, including success after an outage. This removes these known
disclosure paths; it does not certify SDK telemetry, provider retention, all application
logs or historical log deletion. Those remain part of private-purchase acceptance.

**D-112** · Private research account workspace · *Recover and read private jobs in
memory under the signed-in account, without a new payment or public dispatch link.*
The history endpoint shares live session checks, same-origin policy, bounded body
selectors and no-store responses with private result reading. Both responses identify
the authenticated wallet. The browser validates their schema, wallet and selected
request fields, holds IDs only in component state, and cancels/ignores obsolete reads.
Wallet-session changes remount the workspace; 401 responses clear history and results.
The UI exposes source decisions, answer/evidence and current spend separately from
snapshot citation attribution. Text is rendered without executing markup. It does not
poll claimed workers as if they were alive or retry payments. Result reads permit a
bounded 16 MiB UTF-8 body to accommodate the existing 4 MiB JS-string snapshot limit;
other buyer reads retain their 2 MB default. Private purchases, portable private
receipts, CLI integration and full provider/public-projection acceptance remain open.

**D-111** · Private history enumeration · *Recover private job identities from the
owner's durable intents, independently of browser storage and job completion.* Both
adapters expose a backend-only 25-row keyset page plus sentinel, filtered by the
normalized payer and ordered by creation timestamp then ID. Every returned intent is
revalidated against its signature, identity and owner before projection. An explicit
allowlist returns the original question/package and price commitment, not signatures,
salts or payment authority. A history entry does not imply a paid or completed job;
the result endpoint provides current state separately. Cursor timestamps preserve DB
precision; cursors never grant access to another payer's records. A matching composite
index supports the order. This is backend groundwork for account recovery; authenticated
history transport and browser/CLI integration remain to be connected.

**D-110** · Authenticated private result reading · *Read-only POST with a live owner
session, a bounded body selector and an explicit result schema.* The new account route
derives the payer from the revocable session, requires same-origin access, and never
starts execution or submits payment. Wrong-owner/missing jobs share a 404 response;
storage/schema failures return a generic 503 with no raw error. Responses are no-store.
The result projection binds signed intent identity, requires real treasury A2A provenance,
validates displayed decisions/evidence/claim indices and strips unselected nested fields.
It exposes answer/evidence/agency to the owner, omits raw trace and authorization data,
and composes current spend independently of historical snapshot totals. Citation reward
figures are explicitly recorded snapshot amounts, not current payment confirmation.
Execution-claimed is not a worker heartbeat or permission to retry. Private purchases,
private account enumeration, UI/CLI recovery and provider/public-projection acceptance
remain incomplete; the read route alone does not activate private research sales.

**D-109** · Private buyer spend projection · *Read current durable payment evidence
separately from immutable research output.* The backend owner projection allowlists
economic and source fields, excludes signed authorizations/worker identities/private
text, and never reads historical result totals. Exact micro-USDC strings separate
unresolved admission, Circle processing (`received`/`batched`) and confirmation
evidence. Neither facilitator success nor a stored Circle stage is represented as
independently verified chain finality. Every admission stays committed, including
expired or confirmed legs; uncommitted budget is an observation, not a refund or
permission to spend. Sequential reads are not a transactional financial snapshot.
Missing ownership returns no projection before ledger access; storage errors propagate
instead of manufacturing zero spend. The caller must authenticate the payer. This
internal view does not expose a route, enable private purchases, or provide creator
analytics; authenticated result delivery and its disclosure review remain required.

**D-108** ? Private research executor and effects ? *Run the signed job once with a
complete private storage/disclosure strategy, never via public dependency defaults.*
The backend executor reads verified intent/payment state, returns stored results or an
existing-claim status without restarting research, checks prefunding, and atomically
claims execution before invoking the agent. Question, budget, depth, model selection
and execution limits come from the signed intent/package. It assembles the explicit
private gateway and effects rather than calling the public dependency selector.
Effects use only a job-local in-memory content cache, no shared memory/reputation or
external discovery, no outbound citation notifications/alerts and no public activation
writes. Payment observations must match durable admission and, when settled, a saved
confirmation; a flag on an arbitrary PaymentRecord cannot promote private settlement.
Only the scoped private result store receives the completed run. Diagnostic observers
retain counts only. The caller still authenticates the payer and supplies trusted
signer/balance/model dependencies. Synthetic SQLite integration covers concurrent
workers, actual transport/journal operations, grounded citation rewards, forbidden
shared effects and saved-result replay without payment. No private HTTP quote/purchase
or production signer factory is activated; provider disclosure review, isolated read
projections, creator earnings and authenticated browser/CLI recovery remain required.

**D-107** ? Private server payment gateway ? *Share creator payment operations while
keeping legacy wallet custody/funding out of private construction.* `ServerPaymentGateway`
now owns source/article purchases, citation payments, price/content identity checks and
receipt-preserving error handling. The existing `RealGateway` retains its legacy
spend-wallet loading and funding implementation and inherits those operations.
`PrivateServerGateway` instead requires an explicit signer/address and a read-only
Gateway-balance callback; it never creates a wallet, loads the legacy key file, deposits
or transfers funds itself. It refuses another job before HTTP, attaches the durable
private journal to both fetch and citation legs, and retains confirmed debit evidence
when confirmation persistence or paid delivery fails. Insufficient funds require
explicit prefunding. This does not provision a signer or merchant, prove the freshness
of a caller-supplied worker, or replace source/registry payout checks. The execution
factory must obtain a fresh durable claim and supply trusted environment-owned signer
and balance dependencies. Full isolated research effects, creator projections and
private HTTP/client recovery remain unconnected; no private endpoint is enabled.

**D-106** ? Private creator reconciliation ? *Recover from the durable submission
using complete Circle search and retain the origin/stage of the evidence.* The private
backend reconciler reuses the existing paginated search and exact nonce/payer/payee/
network/USDC/integer-amount matcher. It sends no private job/source identity to search,
never signs or retries payments, and never writes public payment metrics. A separate
`circle-transfer-search` confirmation variant stores the transfer ID and first-observed
Circle status; `received`/`batched` are accepted processing stages, not on-chain finality.
Existing facilitator receipts retain their original provenance. Missing, failed,
unknown, mismatched or ambiguous search evidence cannot promote storage or release
budget. DB/search outages remain unresolved. A bounded owner-scoped cursor permits
continued scanning beyond old pending rows; callers must follow it and begin a fresh
scan later to revisit unresolved rows. Immutable existing confirmations are skipped,
so this does not track later finality changes. Tests cover reopen recovery and a match
on the second Circle page. No production scheduler/private route is enabled. Exact
terminal-failure handling, finality tracking, safe projections and full private
execution remain separate required work.

**D-105** ? Private creator confirmations ? *Persist the first trusted settlement
observation against an admitted tuple; preserve observed receipts if persistence is
uncertain.* The separate confirmation store requires the same owner and worker and
matches nonce, expiry, payer, payee, integer amount, network and asset to admission.
It acknowledges exact retries, rejects conflicting references on readback and never
releases creator budget or reopens execution. Confirmations can arrive after result
saving; immutable historical snapshots are not rewritten. The private journal adapter
connects pre-submit admission to outcome persistence and returns the original observed
attempt with `confirmation-unpersisted` if a DB write/readback fails. Retrying outcome
persistence does not sign or send HTTP; the same journal cannot admit a second signed
request. Unknown/mismatched observations do not promote the ledger. The source label
is not cryptographic proof: only trusted transport outcomes may construct these records.
Synthetic integration covers paid HTTP 500 plus DB outage and subsequent persistence
without a second paid request. Production gateways are not connected to this factory;
Circle reconciliation, restart recovery of unpersisted observations, safe creator
projections and full private execution remain outstanding.

**D-104** ? Private creator admission ledger ? *Atomically consume the signed
creator budget before HTTP submission, once per economic leg and nonce.* A separate
`private_creator_submissions` table records only non-bearer tuple evidence under an
owner-validated permanent worker. The leg key binds kind, source, optional article
and recipient; changing only the nonce cannot pay that leg again. Nonces are unique
across this ledger. SQLite uses one insert-select; Supabase serializes on the worker
row before summing integer micro-USDC against the original signed creator budget.
Result sealing takes the same PostgreSQL lock and new legs are denied after a saved
result. Only a fresh insert and matching validated readback admit HTTP; duplicates,
cap exhaustion or lost acknowledgement do not. Every admitted amount remains held,
including uncertain outcomes and expired authorizations. No release or settlement
promotion is implemented in this slice. The caller must supply independently checked
source payout/spender authority; ledger identity is not a replacement for registry
checks or trusted signer evidence. The transport and SQLite ledger are integrated in
synthetic tests, but no production gateway/factory supplies this journal yet. Creator
settlement promotion, earnings projections, reconciliation and private execution
remain unfinished. Never clear this table during restore/restart to obtain capacity.

**D-103** ? Creator submission persistence boundary ? *Allow an exact non-bearer
journal admission immediately before treasury signed HTTP submission.* The server
x402 transport accepts an optional backend `beforeSubmit` callback. When supplied,
it matches the signer's from/to/value to the expected payment and passes only nonce,
expiry, normalized payer/payee, integer micro-USDC, network and asset. The signed
header and immutable scalar evidence are captured before awaiting the callback.
Callback rejection prevents HTTP submission and is not retried or converted into a
post-submit pending result. Once submission happens, response loss remains pending
and confirmed settlement evidence remains available even on a failed paid response.
The callback itself must enforce durable uniqueness, private job/worker authority
and the atomic creator budget; this hook does not implement those policies or prove
payment. Existing public callers omit it. No real gateway/private factory currently
supplies a journal, so the private ledger and recovery gap remain open until integrated.

**D-102** ? Citation transport privacy ? *Keep job identity in the local payment
record, not in the citation request URL.* The citation seller uses only the source,
author and amount; its unused `query` parameter unnecessarily exposed correlation
metadata to request logs and transport providers. Both browser co-sign and treasury
requests now omit it for the challenge and paid retry. Internal payment records retain
the original query ID, including pending and settled-but-undelivered outcomes, so
accounting and reconciliation keep their attribution. Existing incoming URLs remain
compatible because the seller never consumed this field. Source, payee, amount and
nonce checks are unchanged. This reduces URL disclosure; it does not make public
results private or hide amounts/payees from the payment provider. Private creator
ledger and end-to-end result access isolation still require integration.

**D-101** ? Private result durability ? *Keep the first completed snapshot in an
isolated store, scoped to the verified intent owner and permanent worker claim.*
Both adapters require validated settled payment/intent/worker state before saving.
The snapshot is copied before asynchronous lookups and checked against the signed
job ID, question, creator budget and research mode. Atomic insert-if-absent retains
the first exact serialization; exact retries acknowledge it and conflicting data
cannot overwrite it. Readback is required before acknowledging persistence. Missing
or failed readback leaves the save uncertain, never permission to execute research or
pay again. Owner-scoped reads revalidate admission; no public run/order/payment table,
archive, memory or notification hook is touched. The stored `query-run-v1` text is an
opaque backend snapshot, not a validated buyer receipt or settlement proof. Future
owner-facing projections must validate their required fields and bind financial claims
to the isolated creator ledger. Supabase clients cannot read or mutate the table; only
service-role reads and a worker/owner-scoped insertion RPC are granted. This is storage
isolation, not end-to-end encryption: backend operators and authorized backups retain
access. Private execution, creator ledger, authenticated polling and transport remain
unavailable until the complete flow is integrated and tested.

**D-100** ? Private worker admission ? *Claim execution once, only after validating
an owner-bound settled payment; never use elapsed time as permission to execute again.*
SQLite and Supabase store a separate permanent execution claim. An atomic insert
selects an existing owner intent with a confirmed payment; the adapter additionally
revalidates the original signed intent and full confirmation tuple. Only a fresh insert
followed by a matching validated readback returns a server-generated worker identity.
Duplicate claims return no execution authority, including after restart or authorization
expiry. Lost RPC/readback responses fail closed and must be inspected/recovered without
replaying paid work. Supabase grants service-role reads and one restricted claim RPC,
with no client access or direct application updates/deletes. Worker identity is backend
state, not an account response or a substitute for authenticated payer access. These
claims are groundwork for private effects/result persistence; no scheduler, execution
route, receipt transport or private merchant is enabled yet. Do not clear or rewind
claims during a restore: a worker may already have paid creators. Recovery requires
per-leg evidence and durable result state before any retry can be authorized.

**D-99** · Research execution effects · *Select one complete, job-scoped effects
strategy before reasoning or funding; never fill missing private handlers with public
defaults.* The orchestrator now routes payment persistence, cache reads/writes,
discovery, shared memory, citation notifications, alerts and activation through an
explicit server-owned interface. `collectRun` retains the same selected strategy for
final persistence after its existing save checkpoint. Historical public callers use
the unchanged public implementation. Reserved `prv_` IDs require an explicit job scope;
missing methods, a public scope or another job ID fail before execution. Scope metadata
is not payer authentication, payment evidence or proof that an implementation is
private. The future private factory must verify admission and supply isolated durable
stores and disclosure-safe observers. Gateway/provider behavior, public SSE delivery,
creator earnings and authenticated result recovery still require separate integration.
This refactor does not enable a private route or advertise private results.

**D-98** · Public seller merchant reservation · *Reject reserved private recipients
before any public x402 verification, settlement or content delivery.* The server-only
`KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES` list includes current and retired private
merchants. Public research, source/article and citation sellers check both their quoted
payee and the authorization's signed recipient; unsigned resource/discovery metadata
cannot bypass the decision. The unused legacy wrapper applies the same guard. Active
reservations also reject missing/malformed authorization recipients rather than rely
on vendor address coercion. Invalid lists or a public/private merchant collision return
503 instead of disabling the guard. Keep this configuration through rotation and
restore; do not repurpose reserved wallets as public creator payees. An empty list
preserves current public-only operation and must never coexist with enabled private
quotes. No private merchant is provisioned or private flow enabled in v0.22.31.

**D-97** · Private payment submission journal · *Persist one submission boundary
per private intent and keep ambiguity durable.* A separate payment-attempt record is
claimed atomically before any future facilitator I/O. Exactly one caller can obtain
a fresh pending claim; replay, restart, elapsed authorization validity and an already
confirmed readback never authorize another submission. Confirmation is a one-way
compare-and-set bound to the original network, payer, payee, amount and nonce. Exact
repeats retain the first reference; conflicting confirmations fail. The confirmation
envelope is an internal backend contract, not cryptographic evidence and not a client
receipt format. Only an actual trusted facilitator success may populate it in real
execution. PostgreSQL exposes restricted owner-scoped transitions and denies direct
application updates. This internal storage has no network executor or route yet.
Future transport must preserve an observed Circle receipt even when journaling fails;
missing readback remains unknown. No expiry-driven failure, retry, refund, worker
enqueue or public traction follows from this journal alone.

**D-96** · Durable private intent reservation · *Keep signed private input outside
the public run, order and payment tables, with an immutable first writer.* A dedicated
private intent table stores the normalized signed request, original salt, authorization,
quote and merchant snapshot. Its `prv_` identity is domain-separated from legacy order
IDs and binds network, payer, payee and nonce. Both adapters reverify stored signature
and request binding, scope reads to an independently authenticated payer supplied by
the server, and reject conflicting retries without replacing the original. SQLite
blocks updates with a trigger; PostgreSQL grants the application only insert/select
and denies anonymous/authenticated direct access. A reservation is not settlement or
a runnable order. No caller uses this storage yet; seller reservation, payment state,
private execution/results, notifications, cross-query learning and authenticated
recovery still require integration. Backup copies contain bearer authorizations and
private questions and must retain the existing private-data handling protections.

**D-95** · Private merchant and signature verification · *Verify the private request
against a server-selected quote and a distinct trusted merchant before admission.*
The new, currently unwired verifier checks canonical commitment equality and the EOA
EIP-712 signature locally. The submitted body cannot choose authoritative quote terms,
merchant policy or payer identity. Both server verification and fresh buyer intent
creation reject a private/public research merchant collision. This keeps the original
nonce format intact and prepares stateless purpose separation through signed `to`.
All public seller paths must reserve the private merchant before enabling private
quotes; that enforcement and merchant configuration are not implemented yet. A nonce
purpose table alone is insufficient because restoring older state could lose it.
Original quote terms and access policy must survive retries, rotation and restore.
Signature verification is not settlement, balance, fresh validity or access proof;
a paid job must remain recoverable after its original authorization expires. No route,
signer integration, funds or privacy feature is activated by this internal change.

**D-94** · Private request commitment foundation · *A proposed private job binds
its normalized request and quoted transfer terms into a domain-separated SHA-256
nonce with a fresh 32-byte Web Crypto salt.* The existing EIP-3009 typed signature
then covers that nonce. The pure browser/Node module pins the future resource, access
policy, network, asset, Gateway domain, payer/payee, amount, time bounds, package
contract and requested model. Unknown fields fail validation; legacy request schemas
remain unchanged. Binding equality alone is neither signature verification nor
settlement, authentication or confidentiality. No route uses this module yet. Keep
salt/request data in private storage, preserve old nonces and paid journals, and do
not advertise private quotes until admission, cross-version replay handling, storage,
all public projections and authenticated recovery are implemented and reviewed.

**D-93** · Payer history and research privacy · *Account enumeration and result
confidentiality are different authorities.* `/api/me/jobs` enumerates durable orders
only for the active signed-in payer, independent of browser journal availability or
whether a result was saved. Timestamp/ID keyset pagination handles tied timestamps;
cursor contents never select another wallet. The projection excludes authorization
nonces, worker fields and raw responses. GET-only result inspection does not recreate
a pre-payment intent or establish original-request receipt verification. Historical
jobs retain their existing publication/access contract; the UI says so. The complete
private-result migration, including public projections, notifications, payer-bound
recovery and versioned request identity, is tracked in `docs/private-research-access.md`.

**D-92** · Account session management · *A session selector is not a credential.*
The authenticated wallet may list active sessions and revoke a selected session or
all other sessions. Every operation verifies a live signed session and scopes its
database predicate to that wallet. Browser mutations require a matching Origin.
Only hashed selectors and issue/expiry times leave the server; raw JWT identifiers,
tokens, IP addresses and invented device/location labels do not. Inventory is capped
at 100 with an explicit truncation notice, while bulk revocation reaches all matching
rows atomically and preserves the current session. Read-back failures and no-op writes
cannot report successful revocation. Another wallet's selector gives no access and
gets the same idempotent response as an absent selector. Already accepted work and
payment authorizations retain their separately documented authority. Private research
history and device key recovery remain distinct requirements.

**D-91** · Revocable account sessions · *A signed JWT is necessary but insufficient
for account access.* Each new login persists a hash of a random session identifier,
the exact wallet and second-aligned issue/expiry times before issuing its JWT.
Verification pins algorithm, issuer, audience, token type and validated claims, then
requires the exact active database row. Logout removes that row before clearing the
cookie; storage uncertainty returns an error and retains the cookie for retry.
Other device sessions remain independent. Legacy JWTs without this binding must
sign in again; no silent upgrade or compatibility bypass is allowed. Browser hook
revisions prevent late lookups from resurrecting logged-out UI, and other tabs refresh
through ephemeral browser messaging. Account logout does not erase spend grants,
pending authorizations or completed research. Already accepted work may finish.
Before restoring service from a backup, discard ephemeral login challenges and web
sessions so an older snapshot cannot resurrect revoked authority. Private research
access policy and multi-device session management remain further account work.

**D-90** · Sign-in replay prevention · *A cookie binds the browser flow; only a
durable, issued, unexpired challenge can authorize a new session.* A local real-SIWE
fixture reproduced replay by retaining the old nonce cookie. The server now stores
only a domain-separated nonce hash with a five-minute server expiry, then atomically
deletes one eligible challenge before signature verification. Cookie deletion is not
the authority. SQLite and service-role-only Supabase RPCs implement the same condition;
database failures deny sign-in. Bounded uploads and separate hashed-IP rate buckets
limit admission. A rejected signature consumes its challenge; malformed/oversized or
cross-origin requests do not reach that boundary. Current JWTs are not rotated or
revoked by this change. Session revocation, private buyer history and broader auth
review remain separate mainnet work. Restores must discard ephemeral login challenges
before serving traffic, without discarding payment authorizations or journals.

**D-89** · Portable buyer recovery · *Copy the original intent and any saved seller
acknowledgement across runtimes without restoring submission authority.* The bounded,
versioned bundle contains no signatures, keys, URL override or permission to pay.
Both runtimes recompute the original job ID. Browser insertion is exclusive and
atomic; Node import creates a new single-use state directory. Existing and partially
written directories remain unavailable to `buy`. Legacy intent-only files remain
valid for GET recovery. Missing evidence stays unknown, and copied acknowledgements
remain unverified seller assertions: payer/network matching does not establish
cryptographic job-level settlement. Receipt binding remains a separate check. This
addresses the owner browser pilot's lost portable acknowledgement without claiming
wallet/funding backup or authenticated server history. Reversible: easy; legacy
intent files and existing journals remain supported.

**D-88** · Deployment dependency state · *Reuse a recorded successful installation,
not a Git reflog comparison.* The VPS clears an installation stamp before `npm ci`
and writes it only after success. Reuse matches manifest/lock, runtime/ABI/npm/config,
installed hidden lock and presence of direct dependency manifests. Version-only root
release metadata is ignored only without install hooks, workspaces or local deps.
This avoids unnecessary reinstallations and prevents a failed installation from
being mistaken for a completed one after Git advances. The helper is dependency-free
Node code; config values are hashed, not exposed. It is not an installed-file security
audit or a deployment concurrency lock. A transient SSH/public-tunnel interruption
during v0.22.22 recovered while the original deploy continued; its root cause remains
unknown. Reversible: easy (remove stamp to force a clean installation).

**D-87** · Business planning UI · *Use the same exact arithmetic on the page and in
the CLI, keeping estimates separate from the testnet ledger.* `/economics` exposes
the existing USD scenario model with editable assumptions, alternative service-fee
and retained-reserve contributions, monthly results and rounded break-even volume.
Unknown costs stay unknown; invalid edits suppress stale results. Inputs live only
in page memory with deliberate local JSON import/export, and a late import cannot
overwrite intervening edits. Initial fees are illustrative. The calculator neither
changes offers nor reads telemetry, signs, pays or establishes actual profitability.
Reversible: easy (new page and presentation over the existing pure model).

**D-86** · Browser Gateway funding · *Persist each explicit approval/deposit attempt
before asking the wallet, and recover uncertain attempts without replay.* Funding
uses the connected EOA on Arc testnet, exact USDC approval and `deposit(token,value)`
to its own Gateway balance, capped at 1 testnet USDC per plan. A separate IndexedDB
store has one active plan per payer across tabs. Each claimed step records the pending
nonce and observed block; confirmation requires matching sender, target, calldata,
value, nonce, transaction/receipt block and two confirmations. Only provider code 4001
reopens a rejected prompt. Missing responses remain locked for hash-based RPC recovery;
approval never automatically starts a deposit. Unknown credit stops funding, and mined
deposit evidence is distinct from Circle's available credit. Browser storage, RPC and
wallet providers remain trust dependencies; lost storage and replaced/cancelled wallet
transactions need further recovery work. Fresh paid wallet runtime and independent
buyer acceptance remain open. Shared wallet options now wait for hydration because
browser-only connector discovery differed from SSR and caused a reproduced React error.
Reversible: medium (browser additions; no server settlement or existing journal migration).

**D-85** · Browser buyer workspace · *Bind a visible purchase review to the connected
EOA, then keep recovery independent of that wallet.* `/research` now connects the
one-shot engine to the user's wallet rather than the playground worker. The adapter
reads `eth_accounts` and `eth_chainId` before/after Gateway lookup and before signing;
captured hook metadata is not live authority. Question, package, price and payee must
still match the accepted review. A private recovery download is offered before signing
and retained as an explicit action. Browser history/import/export/removal uses the
validated IndexedDB journal; only GET can follow saved or imported jobs. Completed
results require original-request receipt verification before a verified download is
offered. All payment/quality uncertainty remains visible. The existing manual job-ID
viewer reuses the same answer/economics presentation. Local history is not account
authentication or a permanent backup. Initial checkout requires a funded Gateway EOA;
browser deposits and a fresh end-to-end paid wallet pilot remain unfinished B1 work.
Reversible: medium (UI/adapter additions; no server settlement or journal migration).

**D-84** · Gateway balance uncertainty · *An unreadable balance is not zero and must
not suggest another deposit.* Before connecting the browser buyer engine, tracing its
funding dependency found that the session credit endpoint and creator panel converted
Circle errors into zero. The single-depositor reader now requires a matching USDC,
domain and depositor row with exact six-decimal units, bounded bytes and a deadline.
The credit endpoint returns non-cacheable HTTP 503 with `available: null` on unknown
funds, while an explicit matching zero remains a successful known balance. Browser
consumers check identity/network and keep lookup failure distinct from empty funds.
Signature recovery preserves the worker when balance lookup fails; creator earnings
show an unavailable state with retry. No deposit, grant cap or withdrawal is invented
from this observation. Reversible: medium (credit-response semantics and its callers).

**D-83** · Browser purchase durability · *Commit local recovery state before signing,
and a one-shot submission boundary before sending.* IndexedDB stores only validated
intents and allowlisted seller acknowledgements, never signatures. An exclusive insert
and verified read-back precede the wallet prompt; a strict read/write transaction grants
only one tab permission to submit an intent. Request success is insufficient: transaction
completion is required. Imported files are recovery-only, and local deletion does not
cancel a payment or server job. The browser orchestrator rechecks the exact reviewed
price, EOA, Arc-testnet chain and the EOA's Gateway balance; it recovers the returned
EIP-712 signer before committing the submission gate. Changed prices require review,
including lower prices. After that gate, response/storage failures remain uncertain;
acknowledgements survive HTTP 500 and recovery uses GET only. The transport pins origin,
rejects redirects/URL credentials and combines caller cancellation with its deadline.
This is the purchase engine, not yet a connected-wallet UI or a completed B1 journey.
Same-origin scripts and browser storage eviction remain explicit residual risks.
Reversible: medium (local journal version and purchase orchestration; no ledger migration).

**D-82** · Deployment cache · *Do not write a persistent compiler cache for a disposable
build directory.* The `a6fdd80` deploy spent 5.1 minutes writing Turbopack's cache after
compilation. `redeploy-vps.sh` recreates `.next.tmp` before each build, so that cache
cannot warm the next deployment. Disable build filesystem caching only when
`NEXT_DIST_DIR=.next.tmp`, following the installed Next.js build-environment guide.
Normal builds and development retain their cache defaults. This does not disable
runtime caching or relax typecheck/build/health gates. Reversible: easy (one build option).

**D-81** · Buyer runtime portability · *Share policy and result binding while keeping
runtime cryptography separate.* Browser checkout needs the same refusal rules and
recovery identity as the independent CLI. Shared modules now own request/challenge
schemas, typed data, the v2 order-ID preimage, immutable package definitions/fingerprint
serialization and result/request binding. Node keeps its synchronous public APIs and
filesystem journal; browser adapters use Web Crypto and contain no server configuration
or filesystem imports. Header decoding uses bounded UTF-8/base64 primitives in both
runtimes. Package checks resolve the journal's recorded version rather than assuming
the current package. Imported browser intents are validation/recovery inputs, not
permission to sign or resubmit. Existing IDs, package fingerprints and receipt bytes
remain compatible. This foundation introduces no checkout UI or payment submission.
Package lookup additionally refuses inherited object property names as unregistered
versions; a prototype property is not a published package contract.
Reversible: medium (shared API imports; no ledger or wire-format migration).

**D-80** · Browser receipt evidence · *Share canonicalization and envelope policy,
but hash in each runtime.* The research workspace now checks source-decision receipt
bytes with Web Crypto, the HTTPS digest header, displayed job/answer and answer hash.
The Node verifier retains its synchronous API and existing `keryx-json-v1` digest
format through the same pure core. A shared 2 MB streaming decoder bounds input before
parsing/hashing. Missing crypto, malformed data or mismatched receipts withhold only
the decision panel; they do not discard the answer or trigger payment. This verifies
integrity and displayed-result binding, not original buyer intent, research truth or
independent settlement. Full request verification still requires a buyer journal.
Reversible: easy (browser verification UI and runtime adapters).

**D-79** · Business readiness · *Keep business scenarios separate from measured testnet
economics and actual pricing.* The owner expanded the goal to a complete ecosystem,
revenue/profit model and mainnet readiness. The observer currently leaves most sampled
runs unpriced; its partial shadow margin is not monthly profit. A pure local calculator
uses explicit USD assumptions, exact micro-dollar arithmetic and null unknowns. It
shows service-fee-only contribution separately from fixed-package retained reserve,
counts creator spend once and rounds break-even volume upward. No quote, settlement
or network configuration changes. The new delivery acceptance map includes product
journeys, independent cohorts, full costs, security/operations evidence and external
Arc/Gateway availability; launch still needs explicit owner approval. Reversible:
easy (planning tool and acceptance documentation).

**D-78** · Buyer support · *Share an allowlisted diagnostic instead of a private job
response or journal.* `buyer report` reuses GET-only recovery and receipt verification,
then emits only bounded numeric fields and known status values. Its independent
schema strips job IDs, wallet/transfer identifiers, digests, paths, research text and
unstructured messages at every nested boundary. Missing measurements remain null and
uncertain payments remain unconfirmed. Job pricing and verified receipt totals stay
separate; micro-USDC comparison reports agreement or disagreement without rewriting
either. This is a local buyer assertion, not a portable receipt, independent settlement
proof or anonymity guarantee; economic/quality figures may still be sensitive. No
signer, purchase retry, new public endpoint or payment-authority change. Reversible:
easy (additional CLI projection).

**D-77** · Evidence selection · *Spend the context budget on missing target terms and
preserve nearby sentence boundaries.* An English receipt/SQL diagnostic omitted the
available digest-verification sentence. Tracking the best word-match ratio per target
treated repeated generic terms as coverage; fixed windows also cut recovery context.
Track the union of covered target terms instead, prefer sentence boundaries within
bounded overlapping windows, and charge merged source characters against the unchanged
2,000-character per-source budget. Retain a smaller opening for provenance/context.
The scan stays capped at 200,000 characters; long or unrecognized sentences fall back
to character windows. These are lexical heuristics, not proof of semantic relevance.
Assessment, re-evaluation, synthesis and attribution still receive verbatim source
slices through the same helper. No reward threshold, payout authority, model request
count or receipt schema changes. Two English rounds recovered receipt and recovery
answers while missing SQL, metrics and empty-corpus questions remained unsupported;
this does not establish general research quality. Reversible: easy (selection only).

**D-76** · Buyer-visible agency · *Read source decisions from the existing portable
receipt instead of adding another paid-job response contract.* Completed jobs in the
buyer workspace show recorded BUY/SKIP/CACHE choices, quoted access prices, rationales
and target links. The browser checks the display schema and matches job ID and answer;
this is not digest verification or proof of settlement. Receipt errors remain isolated
from the completed answer, retries are GET-only, and clearing/switching the job aborts
the request. No new database, payment or public receipt fields. Reversible: easy.

**D-75** · Planning scope · *Separate source/style constraints from information needs
inside the existing planning request.* The paid Engineering pilot produced a redundant
documentation-summary target and understated coverage. The planner first lists internal
`constraints`, then substantive `claims`; only claims become research targets. The original
user question still accompanies discovery, decisions, coverage and synthesis, so this
internal list does not replace or enforce user instructions. Explicit reliability and
source-comparison questions remain substantive. No post-hoc target deletion, raised
coverage score or payment gate change is introduced. Final repeated model diagnostics
observed no instruction-only target in 18 outputs, but one Vietnamese output merged
two requested topics and source qualifiers were not consistently repeated in targets.
Reversible: easy (prompt only, unchanged public/storage contracts).

**D-74** · Complete portable accounting · *Build portable receipts from all creator
payment attempts, not the legacy citation-only query.* A paid Engineering pilot reported
0.017 USDC creator spend while its receipt included only the 0.015 citation leg. The
receipt route used `listPaymentsByQuery`, whose documented meaning is citation payouts;
switch to the existing `listCreatorPaymentAttemptsByQuery` used for complete accounting.
The projection still excludes inbound funding and preserves settled/pending/failed
classification. No payment is resent, no database row is rewritten, and the buyer keeps
the old receipt snapshot when the corrected projection produces a new digest. Regression
tests cover both settled and pending access tolls. Reversible: easy (read-path fix only).

**D-73** · Question identity and negative answers · *Supply explicit target/index pairs
to synthesis, and score evidence for answering a question rather than agreeing with its
premise.* A broader live diagnostic found synthesis numbering answer sentences instead
of the two requested targets, and review assigning zero to explicit negative answers
about coverage/finality. Synthesis now receives named `researchTargets` with their
caller-owned indices; invalid indices still fail the existing ledger. Review explicitly
allows a source-backed negative answer or limitation. No index is silently remapped,
no score is raised after review, and no payment gate changes. Five boundary cases passed
after the prompt changes; repeated fixed-pair review still had one false negative, so
general reliability remains unproven. Reversible: easy (internal prompt contract only).

**D-72** · Review calibration · *Have the relevance reviewer state the supported fact
before scoring its relationship to the requested action, actor and timing.* Repeated
diagnostics isolated false negatives even when synthesis selected the correct journal
sentence. The reviewer now distinguishes equivalent wording and explicit mechanisms
from merely related topics, without demanding unasked implementation details. The
internal `supportedFact` is a model assessment, not a new quote, public receipt field or
independent authority. Existing support minimum, fail-closed parsing, quote checks and
payment allocation remain unchanged. This uses the existing review request and token
ceiling; the extra text may consume more output tokens, and truncation still withholds
support. A 15-pair repeated diagnostic found fewer false negatives without observed
false positives; this small model-only check does not prove general quality. Reversible:
easy (prompt/schema only; no payment or storage migration).

**D-71** · Coverage and relevance · *Assess the requested scope, then separately review
whether each selected quote supports its assigned target.* JSON coverage now uses an explicit
rubric and asks for supported answers and missing requested parts. Source links must resolve
to nonempty gathered content; malformed/missing scores remain zero. The sufficient flag is
derived from all validated targets meeting the existing 0.4 threshold, avoiding contradictory
model flags. JSON synthesis adds one bounded relevance-review request for up to 32 proposals.
It sees each question/quote pair, not the original support score, and can only lower support.
Missing, duplicate, malformed or out-of-bound reviews cannot authorize evidence. A review
transport failure preserves the draft with zero support and an explicit stream message;
there is no inner retry or new payment. Provider token usage includes this extra call under
the synthesis step; it adds up to one configured transport deadline and model cost. The same
provider can serve both passes: this is not independent factual verification. The original
quote ledger, assessment minimum, integer allocation and payout authority remain intact.
Why: calibration alone raised coverage while accepting a resume-after-failure quote for a
pre-submission journaling question. The review correctly rejected that link. Reversible:
medium (reasoning behavior/trace only; no persisted receipt schema or payment migration).

**D-70** · Evidence selection · *Let JSON synthesis select bounded verbatim quote options
instead of copying arbitrary quote text.* Options come only from the already-unlocked
passages supplied to synthesis: sentence segments, split at word boundaries when necessary,
8–240 characters each, at most 64 per source. Their combined text cannot exceed the selected
passage text; the additional prompt menu can repeat up to 2,000 characters per source.
The model selects an ID, source marker, research target and support score. Unknown IDs,
cross-source selections, raw quote text and malformed entries yield invalid proposals for
the existing ledger to reject. No overlong model proposal is silently shortened or assigned
new support. IDs are local to the model request; public receipts retain ordinary quote text.
The ledger still checks original-source occurrence, target/marker membership, support and
assessment availability. Neither an offered option nor exact text proves semantic relevance;
coverage remains model-assessed. Why: repeated prompt instructions did not prevent overlong
quotes from erasing otherwise relevant evidence. Reversible: easy (internal model contract;
no receipt schema, payment authority, content-access or storage migration).

**D-69** · Bounded reasoning · *Explicitly disable DeepSeek V4 thinking for JSON steps,
and retain relevant evidence that overlaps another selected window.* DeepSeek documents
thinking as enabled by default; the live corpus evaluation exhausted output allowances
before JSON completed. Only explicitly identified DeepSeek flash/pro requests receive
the vendor option; generic compatible endpoints and other providers do not. Token caps,
usage accounting and truncation-triggered failover remain intact. The passage selector
now permits overlap, discounts repeated context and merges adjacent/overlapping spans
as exact original substrings. Four selected windows still carry at most 2,000 raw source
characters. This fixes a reproduced omission of GET-only resume instructions between
selected windows. Short, directly relevant quotations are reinforced in the prompt;
semantic relevance remains model-assessed and overlong quotes still fail the ledger.
Why: the two observed failures had concrete transport/context causes; raising spend or
weakening evidence gates would not resolve them. Reversible: easy (no storage/payment change).
Vendor reference checked September 8: https://api-docs.deepseek.com/guides/thinking_mode/

**D-68** · Research corpus · *Publish dated first-party engineering notes with pinned code
references and complete RSS bodies before another paid pilot.* The seed abstracts do not
document Keryx sufficiently. The publisher kit supplies that missing material without
rewriting old seed receipts, impersonating independent publishers or assigning a payout
wallet. Public feed availability is separate from creator registration, feed verification,
publisher-signed manifests and payment. Live model evaluation remains partial and records
semantic/quotation failures alongside model scores. Why: useful source material and honest
quality evaluation must precede further paid-pilot claims. Reversible: easy (documentation
and feed build/check tooling; no runtime, storage or payment migration).

**D-67** · Evidence context · *Select bounded verbatim passages from already-unlocked
content instead of sending different opening-only slices to each model step.* Scan at most
200,000 JavaScript string characters per source; retain its opening and up to three
non-overlapping 500-character windows ranked by lexical question/target coverage. At most
2,000 source-text characters reach each model step, plus structured metadata. Sufficiency,
re-evaluation and synthesis share the selection for identical inputs; attribution uses the
question because its interface has no decomposed targets. Explicit offsets, original/scanned
lengths and delivery kind distinguish omitted content and abstracts. Quotes still validate
against the original unlocked text; no fetch, storage migration, payout authority or budget
change is introduced. Selection can miss paraphrases, clipped boundary spans, or evidence
past the scan limit; an omitted passage is not evidence of absence. A short abstract remains
short. Why: fixed 800/1,000/2,000-character prefixes hid late evidence and gave model stages
inconsistent source context. Reversible: easy (shared model-context helper).

**D-66** · Preview target contract · *Reject an actionable LLM decision that omits valid
research-target indexes before any source payment.* The second owner-operated buyer pilot
planned the intended Keryx topic, but every positive proposal lacked usable targets and the
preview gate correctly blocked it. The decision prompt now supplies indexed targets and
explains the required zero-based links. BUY/CACHE output with missing, empty or invalid
targets fails the reasoning step, using existing bounded retry/provider fallback and visible
attempt telemetry. Intentional SKIP remains valid. No target is inferred from rationale;
the preview gate, authoritative prices, budget/attention bounds and evidence-gated rewards
remain intact. Why: malformed positive proposals must not masquerade as deliberate no-spend
decisions. Reversible: easy (LLM output contract, no payment or storage migration).

**D-65** · Research quality · *Plan questions before evidence, and report an empty evidence
set as measured zero support.* The first owner-operated buyer pilot paid successfully but
decomposed an ambiguous citation-settlement question into invented patent-dispute assertions.
Planning now asks for research questions, preserves explicit user scope, and supplies Keryx's
product context for unqualified citation-payment questions. Malformed targets fall back to the
original question. This is prompt guidance, not a deterministic guarantee of interpretation.
Runs with no eligible/read sources retain zero coverage for each target, low confidence and
distinct pending/settled source-payment messages. The workspace distinguishes completed
execution from supported research. Historical missing measurements remain unknown; package
prices, non-refundable terms, authorization and payout gates are unchanged. Why: completion
and receipt integrity passed while useful research failed. Reversible: easy (no schema migration).

**D-64** · Independent buyer · *Journal a single authorization before submission; recovery
only reads the original deterministic order.* The caller provides its own already-funded EOA,
trusted treasury payee and all-in price ceiling. A separate CLI imports no server config,
funds no wallet and signs only pinned Arc-testnet USDC/Gateway batching requirements.
Each exclusive job directory stores request, economic tuple and nonce before signing;
submission is checkpointed before the bearer header leaves memory. Resume cannot sign,
POST or infer payment failure from missing orders or authorization expiry. This preserves
uncertainty even in a crash before actual submission and may require operator review.
The response proof is retained before reading delivery and labeled seller-relayed; receipt
hash/request binding is separate from independent financial verification. Payout authority,
treasury caps, paid package semantics and server reconciliation remain unchanged.
Why: the existing demo bootstraps itself from Keryx funds and cannot safely recover client
process loss. Reversible: easy (additive CLI/journal and workspace download/guide).

**D-63** · Buyer workspace · *Expose server-priced package preparation and existing paid-job
inspection as a read-only workspace before adding another signer.* `/research` reuses the
paid endpoint's quote function and accepted job responses. It never authorizes a payment,
starts a job, or turns unknown creator economics into zero. Job IDs retain the existing
bearer-access semantics and stay in component memory; no public directory or persistent
browser history is introduced. Polling uses a locally constructed same-origin endpoint,
stops on terminal/review states, and cannot resubmit a purchase. The current GET may repair
order metadata from an already-durable run under the existing D-61 evidence gate; the
workspace introduces no new recovery authority. Why: the paid API already has durable jobs
and service receipts, but buyers lack a cohesive way to inspect them. Separate client
payment/recovery and receipt verification need their own bounded implementation. Reversible:
easy (additive UI, no schema or settlement changes).

Autonomous architecture/product/UX decisions, with rationale. Newest first.
Format: **D-NN** · area · decision · why · reversibility.

**D-62** · A2A product contract · *Bind every newly paid order to an immutable, versioned
research-package snapshot and return measured service receipts, while keeping the initial service
level explicitly provisional.* Package `1.0.0` publishes two modes: Quick uses at most two
attention slots and no re-evaluation round with a 180-second target; Deep uses at most four slots
and one round with a 300-second target. Both measure claim grounding against evidence-ledger v1's
`0.4` threshold. The snapshot is stored on the private order and its canonical fingerprint is part
of the request hash/replay tuple, so an async worker cannot silently execute changed deployment
defaults after the buyer paid. A caller may pin `packageVersion`; an unsupported version fails
before any 402 settlement.

Queued work returns the accepted contract, elapsed time, deadline and breach state. Completed work
returns accepted/start/finish timing, queue/execution/end-to-end durations, target result, exact
grounded-claim counts/rate when the complete claim ledger is available, evidence/citation counts,
confidence, and the portable receipt URL. Failed work returns timing without fabricating quality
results or an SLO success. Historical orders keep a null package and never inherit v1 labels.
The service receipt remains application response data rather than being folded into x402's payment
proof: the emerging x402 offer/receipt extension is not yet a stable place for Keryx-specific
latency and evidence semantics.

`provisional_slo`, `best_effort`, and `remedy:none` are machine-readable parts of the contract: this
is not yet a contractual SLA or refund promise. Promotion requires four consecutive weeks of
genuine external paid cohorts, at least 30 terminal orders per package, published completion and
within-target rates, no unresolved review queue, and explicit support/legal/remedy ownership.
Creator `payTo`, registry/offer authority, x402/Circle settlement, prepaid caps, integer allocation,
and evidence-gated rewards do not change. Why: a repeat buyer must know what execution they bought
and be able to measure delivery, but two observed external Deep runs and zero Quick runs are not a
credible SLA basis. Reversible: medium (additive public contract/receipt and private JSON snapshot;
payment and payout authority are unchanged).

**D-61** · A2A operations/recovery · *Resolve ambiguous paid jobs with evidence-bound terminal
metadata transitions, never by rerunning research.* `payment_events` plus Circle reconciliation
remain the source of truth for creator settlement; the saved real-mode `QueryRun` is the source of
truth for a deliverable answer; `a2a_orders` is the authorization-keyed control plane. An operator
may inspect one exact `a2a_<sha256>` order without mutation, then perform only one of two
compare-and-set transitions from a started `running` order:

1. `repair_completed` reconstructs the response from that order's already-durable real-mode
   `QueryRun`. It does not call the agent or any payment gateway.
2. `close_failed` is available only after the 15-minute review threshold, only when no QueryRun
   exists, and only for a journal-v1 order whose durable payment-boundary field is still null and
   whose creator-attempt ledger is empty. Historical orders and every job that reached a creator
   gateway call remain under review even if currently recorded attempts look definitive: absence
   of a row cannot prove a process did not die between value movement and ledger persistence.

Every new A2A run awaits the order's `payment_started_at` compare-and-set immediately before each
creator gateway call. A null value is therefore negative evidence only when the same order carries
`execution_journal_version=1`; old rows are never backfilled into that guarantee. It also crosses a
`result_saving_at` checkpoint immediately before QueryRun persistence, so a stale close cannot race
a late no-payment answer into existence. Saved-run repair
also requires the QueryRun's integer settled+pending total to equal the durable ledger's
settled+pending+failed total, so a lost payment write cannot become an incomplete buyer receipt.

The same row atomically stores a bounded resolution record (action, fixed evidence-derived reason,
resolver class, timestamp, and integer micro-USDC evidence) with the terminal outcome. Mutating CLI
commands require the exact order id twice, expose no private question, wallet, transaction, or
worker identity, and provide no retry command. Public failure polling itemizes current settled and
pending creator economics plus the sanitized resolution record. Queue health exposes aggregate
counts and recent latency only; one `review_required` order or a queue older than two minutes marks
operations degraded without taking liveness down.

Settlement state transitions remain owned by the existing Circle reconciliation path; a review
cannot promote, fail, refund, or synthesize a payment. Late definitive Circle evidence therefore
continues to update the financial ledger independently of the terminal job record. Adversarial
gates cover terminal-CAS races, saved offline runs, missing-ledger totals, historical/no-boundary
rows, pending/simulated attempts, stale thresholds, cap overflow, private-data omission, and
aggregate queue/latency classification. Why: the prior
durable worker prevented duplicate spend but left a paid pilot order with no executable runbook or
error-budget signal. Reversible: medium (additive private audit data, a private CLI, aggregate
health fields, and additive public failure receipt fields; payment authority and the no-rerun
invariant do not change).

**D-60** · A2A product reliability · *Acknowledge long paid research with a durable opt-in async
job, but never lease-retry an order after creator spending may have begun.* Existing callers retain
`responseMode=wait`; production callers may send `responseMode=async` or `Prefer: respond-async`.
Only after Circle settles the exact package does Keryx store private normalized worker input and
return `202 Accepted` with a poll location plus the same `PAYMENT-RESPONSE` settlement proof.

For migration compatibility, the internal status remains `running`: a null `started_at` means
queued, while the private worker atomically stamps `started_at` and `worker_id` before calling the
agent. It recomputes the D-58 canonical request hash before any creator spend. Historical running
orders are backfilled as started and cannot enter the queue. A pre-claim crash is safe to claim;
an after-claim crash is never automatically requeued because a downstream Circle response may
have been lost after value moved. Polling surfaces that ambiguity as `review_required` after 15
minutes. Circle settlement, treasury signing, registry/offer `payTo`, creator caps, exact
micro-USDC allocation, and evidence-gated rewards remain unchanged. Why: an 80–150 second paid HTTP
request is not an operable external-agent product, while a generic retrying queue would weaken the
once-only spend invariant. Reversible: medium (additive private columns/worker and public async
contract; synchronous compatibility and every payment authority remain intact).

**D-59** · Settlement/Operations · *Acknowledge permanently ambiguous legacy treasury attempts
without rewriting financial truth or suppressing user-cap risk.* A private sync-state audit record
may stop stale/critical readiness escalation only when an operator names one exact payment id, a
fresh cursor-complete Circle search returns no matching transfer, the row is older than 24 hours,
the signed expiry is unavailable, no browser grant generation is attached, and the payer exactly
matches the address derived from the server's persistent spend key (with stored metadata parity).
The acknowledgement
is bound to the complete payer/payee/network/nonce/integer-amount tuple by SHA-256 and is idempotent;
a conflicting replay fails rather than replacing the first audit record.

The payment remains `pending`, stays outside settled earnings and traction, and is searched again
on every reconciliation pass. Exact Circle accepted/failed evidence still wins immediately;
conflicting evidence always degrades health. Browser reservations and rows with exact signed expiry
cannot use this lane. Public health reports `acknowledged` plus separate acknowledged/unacknowledged
counts instead of calling an investigated, non-cap-holding legacy treasury ambiguity a permanent
readiness failure. Why: the first pre-expiry-telemetry treasury timeout has no retained bearer
signature or terminal Circle receipt and therefore can never honestly be backfilled as failed, but
leaving the same reviewed incident as a forever-critical readiness alarm creates alert fatigue.
Reversible: easy (remove or ignore the private acknowledgement; the underlying payment row was
never changed).

**D-58** · A2A economics/idempotency · *Sell testnet research as a dynamically quoted fixed-price
package and bind one downstream run to one settled inbound authorization.* POST validates the body
before constructing its x402 requirements. Price is exact integer micro-USDC: the Quick/Deep
orchestration fee plus the caller-selected creator-spend cap, clamped to the server ceiling. Keryx's
treasury remains the downstream signer, but the confirmed inbound amount covers its worst-case
creator liability before research begins. The package is explicitly non-refundable; receipts split
service fee, actual creator spend, and unused reserve rather than presenting reserve as payout.

An authorization-scoped order id hashes network, payer, treasury payee, and EIP-3009 nonce (falling
back to Circle's settled transaction id only when the facilitator omits the nonce). The inbound
ledger id and query id derive from that order. A private durable order row atomically claims the
authorization; replays return completed/processing/failed state and never call the orchestrator
again. Completed QueryRun persistence can repair the narrow order-completion crash window, but an
order that failed before a QueryRun exists is never automatically retried because downstream legs
may already have settled. Why: the old fixed $0.02 inbound toll could authorize up to $0.50 of
treasury creator spend, and replayed successful authorizations had no durable once-only run claim.
Reversible: medium (public A2A pricing contract and additive private order table; creator payment,
registry authority, Gateway signing, and browser sessions are unchanged).

**D-57** · Testnet economics · *Observe unit economics without changing payment authority or
presenting projections as revenue.* Every new dispatch records trusted server-side funding
provenance (`browser`, `treasury`, or explicit `offline`) plus provider-reported token counters;
prompts and completions are never retained. The economics observer joins those sampled runs to the
existing payment ledger. Only rows with exact settled evidence count as inbound revenue or creator
spend, pending payments remain pending, and historical funding is `unknown` rather than inferred.

DeepSeek cost estimates use a dated, versioned table from the vendor's canonical pricing page.
Unknown providers/models make a run unpriced instead of silently costing zero. A separate shadow
policy models $0.02 Quick / $0.05 Deep orchestration fees and a $0.005 infrastructure allowance;
it excludes creator pass-through and is displayed as “simulation · not revenue.” Why: testnet needs
evidence for a viable mainnet price before adding a fee, while Keryx must not corrupt the creator's
100% payout rail or confuse treasury-subsidized volume with customer economics. Reversible: easy
(additive run metadata, read-only API/status surface, no settlement/schema/contract change).

**D-56** · Agent quality/evaluation · *Gate reasoning changes with a hermetic frozen-corpus
evaluation harness; keep payment safety deterministic and separate from semantic scoring.* Every
case runs the production orchestrator against an isolated in-memory SQLite database and the
explicit offline gateway. A second fail-closed grader rejects settled or pending payments, real
transaction evidence, budget overruns, forbidden reads, unexpected citations, and insufficient
evidence coverage before a weighted quality score is considered. The reviewed baseline is bound to
the complete corpus by SHA-256, and CI rejects both material per-case regressions and unreviewed
corpus changes. Provider-backed model comparisons are opt-in and never inherit the default
heuristic baseline. Why: unit tests protect economic invariants, but prompt/model/selection changes
could still degrade evidence yield or citation decisions without breaking types or safety tests.
Reversible: easy (tooling and CI gate only; no runtime, registry, key, pricing, or settlement
authority changes).

---

**D-55** · Settlement/Operations · *Persist the signed authorization expiry exactly, but never use
expiry as settlement or failure evidence.* Both browser and treasury x402 buyers now normalize the
`validBefore` carried by the signed EIP-3009 payload into `payment_events.authorization_expires_at`
before submission. Historical rows stay NULL because deriving a deadline from `created_at` would
fabricate evidence. Reconciliation reports exact expired/unknown-expiry counts and separates
browser-funded rows, whose grant reservations remain held, from treasury rows, which consume no
browser capacity.

Crossing `validBefore` does not terminalize a row or release a reservation: Circle may have accepted
the authorization before expiry even when Keryx lost the response. Only the existing exact Circle
transfer tuple can prove accepted or failed state. Why: the first long-lived production ambiguity
made the authorization window and the funding owner operationally important, while a generic
“reservation remains held” alert incorrectly described a treasury attempt. Reversible: easy
(additive nullable metadata and presentation; settlement authority is unchanged).

**D-54** · Settlement/Reconciliation · *Search Circle's documented transfer index completely;
query filters may narrow candidates but never prove a nonce or settlement state.* Circle's x402
transfer-search API filters by payer, payee, network, token, date and cursors, but not by EIP-3009
nonce. Keryx previously sent an undocumented `nonce` parameter and read only ten rows. If Circle
ignored that parameter, later payments between the same wallets could push the ambiguous transfer
off page one and leave a valid settlement permanently pending.

Reconciliation now starts one day before the locally recorded submission, leaves the end open so
a bearer authorization submitted later is still discoverable, requests 50 rows, and follows every
Circle `pageAfter` cursor up to a fail-closed bound. Next links must remain on the configured Circle
transfer endpoint. Only after retrieval does Keryx require exactly one matching nonce, payer,
payee, Arc network on both sides, USDC token and integer micro-USDC amount. A malformed response,
untrusted cursor, or exhausted scan bound changes no ledger state; an empty complete scan remains
pending rather than becoming failed. Why: production's first long-lived ambiguous receipt exposed
that the lookup assumed an API filter the installed Circle SDK and current documentation do not
offer. Reversible: easy (transport-only search policy; no schema, key, grant, price, or payout
authority change).

**D-53** · Reasoning/Spend selection · *Choose an evidence portfolio under separate money and
attention budgets; preview predictions still cannot authorize evidence or payment.* After the
reasoning engine proposes BUY/CACHE/SKIP with normalized claim targets, the existing preview gates
first downgrade untargeted, below-floor, and unusable-cache proposals. A deterministic selector may
then choose only a subset of the remaining BUY/CACHE proposals. It cannot promote SKIP, add a
candidate, change the registry/offer price, select `payTo`, increase the dispatch/fetch cap, or
authorize a citation reward.

The selector maximizes predicted claim coverage with diminishing returns, so corroboration can add
value without letting four redundant sources automatically occupy every context slot. BUY consumes
its authoritative micro-USDC price plus one attention slot; CACHE consumes zero fetch USDC plus one
attention slot, regardless of its public list price. A small explicit attention cost leaves a slot
unused when another read adds too little predicted coverage. Quick remains capped at two sources and
Deep at four. The selected set is input-order invariant, bounded to a deterministic candidate window
for future large catalogs, and read in marginal-coverage order; CACHE wins only a true ordering tie
so sufficient free evidence can stop a later signature.

The pre-spend plan and its per-claim predictions are visible in the SSE trace, archived run, UI and
portable receipt. After synthesis, a separate outcome records which selected reads produced
reward-qualified evidence. Preview coverage remains a forecast; final confidence, citations and
creator rewards still come exclusively from exact paid/cached body quotes under D-23, and actual
money remains Circle-evidenced under D-37/D-43/D-44. Why: value-per-list-price ranking treated a
cached article as if it still cost its listed toll and could crowd an exact, higher-value source out
of the scarce attention budget; production quality was limited by evidence coverage rather than
settlement reliability. Reversible: easy (restore the former subset policy; no key, grant, payment,
registry, cache, or database migration changes).

**D-52** · Product/Provenance · *A portable research receipt binds one exported snapshot, but its
digest is integrity evidence rather than identity or settlement authority.* `GET
/api/dispatch/[id]/receipt` deterministically projects an archived dispatch into visible
BUY/SKIP/CACHE decisions, the exact answer and its separate SHA-256, claim-indexed public evidence,
cited article versions/content receipts, and sanitized creator-payment rows. Recursive sorted-key
canonicalization hashes the entire payload. A local verifier catches changes that do not also
replace the integrity block; `--expect` compares against a digest retained separately, and an HTTPS
verification also compares the response header. The self-hash is explicitly not a Keryx or
publisher signature and cannot prove who served the original bytes after export.

Payment truth remains the durable ledger state from D-37/D-43/D-44. Only rows classified settled
from Circle evidence enter settled totals; pending, terminal failed and offline simulation amounts
remain separate. New runs' finish-time settled+pending count is compared with the durable rows, and
a mismatch is labeled `incomplete` instead of trusting `QueryRun.totalToCreators`. The public bundle
omits payer addresses, authorization nonces and internal row ids, calls no Gateway/decryption/registry
write path, and carries Circle transfer ids as settlement references rather than Arc transaction
hashes. Exact reconciliation may legitimately change the settlement snapshot and therefore its
digest, while the archived answer hash stays stable. Why: Keryx had all the parts of a research
receipt but no single artifact another agent could download, archive and integrity-check without
scraping UI or trusting aggregate money fields. Reversible: easy (remove the read-only projection,
export affordance and verifier; no economic or archived state changes).

**D-51** · Product/Provenance · *An archived answer is immutable; freshness is a metadata audit,
and only a new paid dispatch may judge replacement evidence.* Each versioned citation already
records the exact SHA-256 or encrypted IPFS CID bought for that answer. Keryx now compares that
receipt with the same article id in its current index and reports `current`, `superseded`, or
`unavailable`. A superseded version means only that the asset changed. It cannot lower confidence,
erase a quote, reverse a payout, or assert that the answer became incorrect; an unavailable current
asset and any failed source/publication lookup remain unknown rather than being treated as unchanged.
The public freshness API exposes the same metadata and its limits without decrypting or buying content.

When a reader explicitly re-asks the same normalized question, the new permalink compares the two
immutable receipts: cited sources, exact versions, matched-claim coverage, confidence, evidence-span
counts and Circle-settled creator payouts. Missing payment rows make the monetary delta unknown,
and simulations remain zero settled money. A different follow-up question never receives this delta.
The re-ask itself remains a normal dispatch with the same Quick/Deep attention policy, hard budget,
browser custody, registry payout authority, evidence gate, and Circle-only settlement truth. Why:
the archive can now show both content drift and what a paid reread actually changed without silently
refreshing conclusions or spending on a reader's behalf. Reversible: easy (remove the audit/delta
projections; no economic or archived state is rewritten).

**D-50** · Product/Attention/Telemetry · *Research depth may bound attention and latency, while
free previews may only remove spend authority; activation telemetry is aggregate operational
state, never identity.* Web dispatches default to Quick: at most two claim-targeted paid or cached
reads, no off-Arc marketplace probe, and no gap-expansion round. Deep preserves the existing
four-source attention ceiling, external discovery, and bounded re-evaluation. Both modes retain the
same hard USDC budget, browser signer custody, atomic grant reservation, registry payout authority,
evidence gate, integer citation allocation, and Circle-only settlement truth.

Before the first paid fetch, Keryx maps engine-proposed source targets from free previews onto the
decomposed claims. Invalid claim indexes are discarded; an untargeted or below-floor BUY/CACHE is
deterministically changed to SKIP. The pre-check can warn, narrow, or stop a spend plan, but cannot
add a source, increase a price/budget, select `payTo`, or authorize a reward. Final confidence and
creator rewards still come only from paid/cached body evidence under D-23, never from preview
coverage.

The activation funnel stores one row per `(UTC day, allowlisted event)` with an integer count. It
stores no actor, wallet, IP, cookie, fingerprint, user agent, referrer, question, source, or payment
identifier; its public dashboard calls these event totals, not unique users. Wallet-based returning
asks are classified from the existing SIWE-attributed dispatch ledger and only the aggregate event
is incremented. Why: current latency, grounding, and adoption data need a faster default plus a
measurable path from landing to answer and creator cash-out without weakening payment authority or
introducing surveillance. Reversible: easy (switch the web default, remove the downward-only gate,
or stop incrementing aggregate counters; economic state is unchanged).

**D-49** · Security/Operations · *Authentication secrets, payment authority, compute allowance,
and settlement evidence are separate state machines.* A raw API bearer value is verified before
the durable limiter sees it; valid callers are keyed by non-secret database id and legacy secret
buckets are purged. Supabase keeps browser roles read-only only for explicitly public metadata,
while private tables and every economic RPC are service-role-only under RLS. Browser sessions still
derive payment authority exclusively from the SIWE owner, the browser-held signer, the persisted
atomic grant, and Circle evidence; separately, their server compute is wallet-rate-limited and each
dispatch is bounded by the remaining grant plus a lower per-run ceiling. Grant create/recovery now
fails closed when independent balance evidence is unavailable.

An old pending authorization degrades public/operational health after one hour and becomes critical
after 24 hours, but age alone never settles, fails, or releases it. Only the exact Circle tuple under
D-43/D-44 changes financial state. Deploys now run an explicit TypeScript gate before the low-
downtime build, and the web origin ships a CSP/security-header baseline without forcing every public
archive page into dynamic nonce rendering. Why: a secret identifier, a compute quota, a spend cap,
and a settlement receipt contain different authority; using one as another created data exposure or
unbounded operational work even when the financial cap itself remained sound. Reversible: medium
(limits/headers are tunable; database privilege and secret-storage fixes should not be reversed).

**D-48** · Settlement evidence · *An unavailable verification leg is `unknown`, never a zero
balance or a settlement finding.* The Circle parity sweep first identifies Gateway shortfalls,
then reads those creators' Arc USDC balances because they may have cashed out through another
client. `undefined` remains the internal first-pass marker that selects those wallets for a chain
read; after the read is attempted, `null` means the RPC did not answer and the public verdict is
`unknown`. Only a numeric Arc balance that still leaves a gap can produce `short` and an alert.
Why: otherwise an expired or unavailable RPC credential turns missing evidence into a false claim
that a creator payout never settled, contradicting the settled-only reporting invariant. This
changes watchdog classification only; ledger rows, settlement state, payout authority and funds
are untouched. Reversible: easy (pure reconciliation semantics plus presentation copy).

**D-47** · Public proof · *No aggregate is self-proving; publish each claim beside the
authority that can actually verify it and the limit of that authority.* `/proof` composes four
existing, independent evidence layers without creating a new payment or identity source of truth:
the runtime commit binds the deployed build to GitHub and CI; Arc RPC plus SourceRegistry establish
creator, payout, price and split authority; the Circle balance API checks whether creator wallets
still hold what Keryx's settled ledger says they earned; and ArcScan withdrawal hashes prove
earnings can leave Gateway on-chain. Payment and payout totals remain settled-only under D-20/D-42.

The registry watchdog now retains the Arc head block it observed so a public reader can compare the
RPC head with the index checkpoint. `/api/health` publishes only a coarse RPC provider label; it
never returns the configured URL because Canteen endpoints contain server credentials. The page
states what each layer cannot prove—especially that a Circle transfer id is not an Arc transaction
hash. Payment authority, browser custody,
spend caps, reconciliation, delivery and settlement state transitions are unchanged. Why: the
proofs existed across `/status`, `/dashboard`, ArcScan and GitHub, but an outside evaluator could not
map a headline claim to its verifying system without already understanding Keryx's architecture.
Reversible: easy (remove the composed page and additive health fields; underlying watchdogs and
ledgers are unchanged).

**D-46** · Content authenticity/Confidentiality · *A paid-body receipt proves what is stored, while
SourceRegistry remains the only payout authority.* RSS ingest now labels bodies conservatively as
`full_text`, `excerpt`, `abstract`, or `metadata_only`; it never calls an ordinary snippet full
text. A registry creator may replace one indexed article with a full body and sign EIP-712 over
`sourceId + itemId + canonicalUrl + SHA-256 bodyHash + plaintextBytes + deliveryKind + nonce`.
The owner API refreshes registry authority, verifies the signature against the exact bytes, then
encrypts the body before committing its envelope/manifest. Pinata availability chooses public IPFS
ciphertext or a private encrypted-DB fallback; it never chooses plaintext. The public receipt carries
only delivery/storage kind, byte count, hash, and manifest identity. It cannot set price, `payTo`,
active state, or author splits.

Every registration and refresh path now crosses one content-storage boundary. Production and
treasury-funded processes fail closed when the content key is absent; a Pinata outage retains
ciphertext in the DB, while explicit offline development remains labeled plaintext. Decrypted
caches are envelope-encrypted in SQLite/Supabase,
legacy cache rows are sealed at initialization, and direct public reads of `source_items` and
`cache_items` are removed. Key wrapping now uses a fresh AES-GCM nonce per envelope while retaining
read compatibility with legacy zero-nonce rows. Why: the old RSS path sold `contentSnippet` as full
text, refresh/registry paths bypassed encryption, public DB policies exposed paid storage, cached
plaintext survived settlement, and repeated GCM nonces under one master key were cryptographically
unsafe. Reversible: medium (manifest/receipt columns are additive; ciphertext migration is
one-way unless decrypted with the retained server key).

**D-45** · Reasoning/Attention · *Free cache reuse still spends an explicit attention budget.* The
orchestrator admits at most four paid-or-cached sources into one synthesis context by default,
ranked by expected value per dollar. A `CACHE` proposal must name at least one decomposed claim and
clear a configurable expected-value floor; re-evaluation cannot expand past the same cap. Every
rejection is surfaced as a normal SKIP rationale, independent of the USDC fetch budget. Why: zero
toll does not make text free to read—irrelevant cached bodies consume model context, increase
latency, and dilute evidence even though they do not move money. Reversible: easy (two environment
thresholds; no payment or persistence authority changes).

**D-44** · Settlement/Capacity · *A Circle-terminal failed transfer closes the pending receipt,
but may release browser capacity only into the exact grant generation that reserved it.* Each
create/recover operation assigns a fresh opaque `grantEpoch`; a browser pending payment retains
that epoch beside its non-secret authorization nonce. Reconciliation first requires the same exact
Circle economic tuple as D-43, then atomically changes `pending` to `failed`. It subtracts the
reserved micro-USDC only when the current grant still has the recorded epoch and session EOA.
Legacy rows and failures from an earlier recovered grant close without changing the current cap.
Failed receipts remain visible but count as neither spend, creator earnings, settlement success,
notifications, fulfillment, nor traction.

Why: Circle's terminal `failed` state is definitive evidence that this authorization did not settle,
so retaining its reservation forever is unnecessary; applying that refund to a newly recovered
grant could instead grant extra capacity after the user has already rebased and spent. Reversible:
medium (the failed ledger state is additive; disabling release safely returns to conservative cap
retention).

**D-43** · Settlement/Recovery · *An ambiguous signed submission may become settled only from
Circle's nonce-indexed transfer ledger and one exact economic tuple.* A post-submit timeout keeps
its existing durable pending row and never stores the bearer signature. The reconciliation worker
searches Circle by EIP-3009 nonce, then independently binds the result to the recorded payer,
payee, Arc network as both sending and recipient network, USDC, and integer micro-USDC amount.
`received`, `batched`, `confirmed`, and `completed` all prove the same Gateway acceptance that a
successful settle response would have returned; the Circle transfer id becomes the receipt.
Missing, duplicate, malformed, or mismatched results stay pending and outside traction, earnings,
notifications, and wanted-claim fulfillment. An exact terminal failure follows D-44. Promotion is a compare-and-set on payment
id, nonce, and pending state, so concurrent watchdogs are idempotent and cannot replace a receipt.

Why: retaining uncertainty prevented double-spend but could permanently under-report a real debit
when only the HTTP response was lost. Aggregate Gateway balances cannot identify which concurrent
authorization settled; Circle's transfer search now exposes the nonce and full tuple needed to do
so without retaining replayable payment material. Reversible: low (disable the scheduled worker;
pending rows remain conservatively pending and the original payment path is unchanged).

**D-41** · Demand market/Agency · *A creator may answer a measured wanted claim with one exact
article version; the response guarantees candidacy, never purchase or payout.* Existing registry
creators can submit an already-indexed article from the wanted brief instead of relisting its feed.
Admission recomputes the live gap from completed dispatch receipts, matches only the article's free
title/preview, refreshes SourceRegistry creator/active/list-price authority, and snapshots
`sourceId + itemId + contentVersion + current articleOfferId?`. One semantic gap plus registry
creator admits at most one bounded treasury retry, with the existing per-wallet daily valve.

The worker atomically leases the intent, then refreshes the same registry creator, article version,
and signed discount before spending. A transient registry failure retries within the lease bound;
a changed creator, article, offer, or already-filled gap closes the coordination row without spend.
The exact article is placed first in the reasoning candidates so prompt limits cannot hide it, but
the agent still emits BUY/SKIP/CACHE under its normal hard budget. Fulfillment remains evidence plus
real settlement: the offered article's claim-indexed quote must qualify and its citation reward must
carry Circle evidence. Legacy source-only intents retain their historical generic retry.

Why: `/wanted` exposed demand and `/market` exposed exact supply, but registration was the only
bridge and the retry did not actually carry the offered article. This closes the market loop without
letting creator coordination become recommendation, spend, or payout authority. Reversible: medium
(nullable intent fields and additive route/UI; old retries and the article market remain usable).

**D-40** · Article market/Authority · *Publishers may sign temporary article discounts; the
SourceRegistry creator, list-price ceiling, active flag, and payout wallet remain authoritative.*
An offer is EIP-712 over `sourceId + itemId + contentVersion + priceUsdc6 + expiresAt + nonce` on
Arc testnet. Only the live registry `creator` may publish or revoke an on-chain source's current
offer revision; pricing fails closed when that authority cannot be freshly read. The offer price is
integer micro-USDC, at least the x402 minimum, never above the live registry price, and expires
within 30 days. Replacing or revoking the one current revision makes an earlier `offerId` return
409 before a paid challenge. A content change does the same through the existing version binding.

The server verifies the signature during owner admission, marketplace discovery, agent selection,
and again before 402. Browser co-signers independently refresh SourceRegistry, verify the creator
signature, price ceiling, exact article identity, expiry, challenge amount, and payee before
creating a bearer authorization. Treasury buyers verify challenge amount/payee and paid response
pricing. Fetch receipts persist offer id, effective amount, and list price. Pre-registry sources
retain the documented public-index wallet/price residual; their wallet signs offers directly.
Why: article identity created a stable object, but a source-level price still prevented a publisher
from pricing a flagship investigation differently from a routine post. A public signed offer book
makes price competition inspectable without introducing custody, escrow, buyer order matching, or
article metadata as payout authority. Reversible: medium (drop the additive offer table/routes and
all articles immediately fall back to their registry list price).

**D-39** · Content economics/Evidence · *The exact article version is the unit Keryx discovers,
buys, caches, cites, and rewards; SourceRegistry remains the authority for list-price ceiling and payee.*
For each verified publication, discovery chooses one relevant `source_items` row from free title and
preview metadata. The reasoning candidate carries a separate `item:<id>` asset identity while its
registry `sourceId` remains attached for source-owned `fetchPrice`, `walletAddress`, and author
splits. Paid reads use `/api/source/[id]/item/[itemId]?version=<contentVersion>`; the route rejects a
changed or missing version before issuing a 402 challenge, settles to the source owner, then serves
only that article. Plaintext rows use a SHA-256 content version and encrypted rows use their
content-addressed IPFS CID. Cache keys include source, item, and version, so an old whole-feed cache
or another revision can never silently satisfy the purchase. Fetch and citation receipts,
evidence, public footnotes, activity, and creator notifications carry the same article identity.

The first slice intentionally permits at most one article candidate per publication in one run, so
existing source-level attribution and payout splitting remain unambiguous. Publications with no
item rows keep the historical source-bundle path, and old nullable receipts remain readable. Item
metadata is never payout authority. Post-settlement delivery failure still follows D-38: retain the
settled receipt, exclude unavailable text from evidence, and continue the answer from other reads.
Why: buying an entire feed made the paid object, cited evidence, cache, and creator work disagree;
an article-level receipt makes the market leg inspectable and gives future bidding/reputation a
stable object to price. Reversible: medium (additive route/metadata and legacy fallback; removing it
would collapse new article receipts back into ambiguous source bundles).

**D-38** · Settlement/Delivery · *A confirmed Circle receipt remains settled even when the paid
resource fails after settlement; delivery success never rewrites payment truth.*
`settleThenServe` now builds the `PAYMENT-RESPONSE` immediately after a successful facilitator
settlement and attaches it to both the normal response and any later producer 5xx. Browser co-sign
and server-funded buyers evaluate that receipt before the HTTP status: a valid
payer/network/transaction proof creates a typed settled-delivery error, while a non-success
response without valid proof remains pending. The server-funded path still uses Circle's official
`BatchEvmScheme` to create the authorization; Keryx owns only the response classification because
the SDK's high-level `pay()` discards headers on non-2xx. The agent persists the settled leg, counts
it in spend and creator earnings, keeps
the session/query reservation consumed, and continues without unavailable source content. A
settled citation acknowledgement failure still qualifies the paid creator notification because
the reward itself landed; a fetch delivery failure never enters the evidence set.

Why: source DB, IPFS, decryption, or answer-production work happens after the irreversible payment
boundary. Treating its failure as ambiguous discarded definitive evidence Keryx already held and
could permanently under-report a real creator payment. Treating the failed body as usable content
would instead corrupt grounding. Payment and delivery therefore need explicit, independent state
transitions. Reversible: low (typed error and response-header preservation; no rail/schema change).

**D-37** · Browser co-sign/Settlement · *After a signed authorization crosses the submission
boundary, uncertainty is `pending`, never `failed`, `simulated`, or settled traction.*
The server now binds every 402 challenge to the orchestrator-authorised network, USDC asset,
integer micro-USDC amount, source/author `payTo`, Gateway contract, signing domain, and lifetime.
It then decodes the browser response before submission and requires its signer, payee, value,
nonce, signature shape, and validity window to match that challenge. A mismatch is pre-submission:
the atomic session reservation is released. Once the validated header is sent to the paid route,
any timeout, non-success HTTP response, or 2xx response without a valid Circle settlement reference
creates a durable `payment_events` row with `settlement_status=pending` and the public EIP-3009
nonce, but never the signature. The reservation remains consumed because the facilitator may have
settled before its response was lost. Re-evaluation also treats that reserved amount as spent for
the per-query cap, preventing an ambiguous first attempt plus a replacement from exceeding budget.

Pending amounts appear in the trace, receipt, creator ledger, live payments feed, dashboard warning,
and health telemetry, while remaining outside `settled=true`, spent totals, creator earnings,
notifications, fulfillment, parity claims, and traction. Post-payment cache/ledger write failures
are isolated from the payment call: the dispatch retains the receipt and content instead of
relabelling a completed settlement as a failed purchase. Exact per-nonce reconciliation remains a
separate operation because Circle's public balance endpoint is aggregate; refreshing a session
re-bases its cap from the live balance but does not invent a settlement verdict for the old row.
Why: transport failure after a bearer authorization exists is not evidence that no money moved,
and a missing response is equally not evidence that money settled. Reversible: medium (additive
ledger state and conservative accounting; removing it would reintroduce false payment claims).

**D-36** · Reasoning/Latency · *Provider-step circuit health is durable across workers; an
expired cooldown leases one half-open probe and a failed probe backs off exponentially.*
The Next server and the autonomous volume daemon are separate processes, and each normal volume
tick launches a fresh `seed --count 1` worker. Circuit state therefore lives in the shared database
under `(engine, reasoning step)`, not only in a module `Map`. A closed circuit admits calls. Once
open, it routes immediately to the next configured provider. When the cooldown expires, one worker
atomically leases the probe while concurrent callers keep using the alternate; a crashed probe is
recoverable when its lease expires. A successful real response deletes the streak. Another failed
probe retains it and doubles the cooldown from 30 minutes up to four hours. When a real alternate
exists, one exhausted call is enough to open; a last-provider-to-heuristic transition retains the
configurable two-failure threshold. Database failure degrades to the mirrored in-process circuit,
never turns a successful model response into a failure, and never changes spend or payout state.

Why: production receipts after D-31 still showed zero circuit skips while the same DeepSeek
`decide` and `synthesize` steps repeatedly spent 40–60 seconds on 503s/timeouts before MiMo served
them. The implementation was locally correct but lifecycle-wrong: the worker that learned the
failure exited, and even a long-lived process forgot the streak when the sixty-second cooldown
expired. The result was completed, fully settled answers taking 100–280 seconds despite a healthy
alternate. Durable state and retained half-open history make the resilience mechanism match the
actual deployment topology. Reversible: medium (drop `reasoning_circuits` and inject the memory
store; provider order, receipts, payment authority, budgets, and evidence gates are unchanged).

**D-35** · Public updates/Canteen · *Publish selectively: useful public product progress and
verified real traction belong on Canteen; private operations and security details do not.*
Canteen is an external product channel, not an automatic mirror of commits, deploys, logs, or
internal experiments. A product update must be understandable and useful to an outside reader. A
traction update must use verified, genuinely settled figures and enough public context to interpret
them. Do not publish local caller identities or addresses, daemon cadence or schedules, machine and
PM2 topology, configuration or environment details, credentials, raw operational logs, internal
failure traces, or security-sensitive/anti-abuse implementation details. If an update mixes public
progress with private details, publish only the safe public summary; if no meaningful safe summary
remains, skip the Canteen update.

Why: consistent public progress helps distribution, while indiscriminate operational disclosure
creates privacy and security risk and turns the product feed into noise. Reversible: easy (revise
the editorial boundary), but already-published sensitive data may not be retractable.

**D-34** · Traction provenance/Local caller · *One workstation daemon is one persistent actor;
it may add requests, but it never rotates wallets to manufacture people.*
The owner's workstation may run a low-frequency SIWE-authenticated client against the sponsored
web endpoint. It creates one ignored local wallet, reuses it permanently, asks a title-anchored
question from a current free source preview, and runs once every eight to twelve hours with a
$0.03 budget. Scheduling is persisted before network work, so a crash/restart sleeps rather than
looping treasury spend. It never sends the Keryx bot key and therefore lands as `origin=web` with a
server-verified `asker`. It also never signs unattended x402 charges: creator settlement comes from
the existing bounded sponsored-web path.

Why: a user-directed agent on another machine is real external demand, but wallet rotation whose
only purpose is raising the actors tile is Sybil traffic. This policy can add exactly one identified
actor and, after its second completed run, one returning actor. Later ticks increase that actor's
usage, not the actor count. Current-preview questions make the small spend useful to creators rather
than turning the daemon into a gap generator. Reversible: easy (stop/delete the local PM2 process;
the public identity and schedule remain in ignored local state for audit continuity, while its
signing key remains only in the ignored `.env.local`).

**D-33** · Feed refresh/SSRF · *Pinned DNS answers support both single-result and `all: true`
Node lookup callbacks; never fall back to an unpinned fetch for compatibility.*
The outbound public-URL guard resolves and validates every address, then gives Undici a custom
lookup function that can return only one already-approved IP. That function now responds with
`[{ address, family }]` when Node requests `all: true`, and retains `(address, family)` for the
single-result form. Feed refresh also includes the immediate transport cause below Undici's generic
`fetch failed` wrapper so future network failures remain diagnosable without a reproduction shell.

Why: production moved to Node 24, whose connection family autoselection invokes custom DNS lookup
with `all: true`. The old Node 20-shaped callback returned a string and family; Node 24 interpreted
that as a missing array entry and rejected all twelve external feeds with
`ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`. Using native DNS as a fallback would make
feeds work but reopen the DNS-rebinding gap the pinned dispatcher closes. Supporting both callback
contracts restores refresh while preserving the same vetted address as socket authority.
Reversible: low (only if the minimum Node runtime and Undici contract change together).

**D-32** · First-party quality/Metrics · *Normal autonomous questions are seeded from one current
free preview; broad exploration is explicit, bounded, and still labeled first-party.*
The volume engine now rotates through active, ownership-verified sources that have current items.
For a normal tick it gives the question model one publication's name, description, tags, and up to
four free title/summary previews. The result must share concrete vocabulary with that preview or it
is replaced by a deterministic title-anchored question. Paid item content never enters generation.
Ten percent of fresh ticks may still use registry-wide themes to discover genuine corpus gaps;
`KERYX_ENGINE_QUESTION_EXPLORATION_RATIO` controls that slice. Provider failure on a normal tick
falls back only to the core, corpus-aligned bank, never accidentally to the broad exploration bank.

Why: production's 33% evidence-grounded claim rate was not primarily a permissive/strict gate
problem. Recent first-party runs asked about CCTP, account abstraction and agent toolchains, then
correctly found zero supporting text across the material they bought. Sampling unrelated tags from
the whole registry made a plausible question, not an answerable one. Preview seeding improves the
economic loop honestly: the daemon should pay more often because it found useful evidence, while a
small exploration budget preserves the `/wanted` demand signal. These runs remain `origin=engine`;
the change cannot increment Independent usage, actors, votes, or conversion. Reversible: easy
(raise the exploration ratio or restore registry-wide theme generation).

**D-31** · Reasoning/Latency · *Circuit health is scoped to a provider and reasoning step, and
sub-threshold failures survive until that same step succeeds.*
A model that reliably handles small decomposition and sufficiency prompts may still time out on the
much larger all-source decision payload. Circuit state is therefore keyed by `(engine, step)`:
success in `decompose` cannot erase repeated `decide` failures, and an open `decide` circuit does
not suppress that provider for work it still serves well. Transient failures below the threshold
remain counted while the circuit is closed; the previous implementation accidentally deleted that
counter at the start of the next call, so a transient circuit with threshold two could never open.
Hard 4xx failures still open immediately, cooldown still admits a half-open probe, and every skip
remains visible in the run receipt.

Why: twelve live receipts carried 20 failed `decide` attempts and about 1.57 million milliseconds
in that step alone, yet the six-hour watchdog reported zero circuit skips. Successful lightweight
steps kept clearing the engine-wide state, while the below-threshold deletion also prevented
failure accumulation. Step-scoped containment bypasses only the payload/provider combination that
is failing and preserves independent healthy capability. Payment authority is unchanged: the
selected engine still only proposes decisions; budget, registry payTo, evidence and settlement
remain deterministic. Reversible: easy (return to engine-wide keys, though that restores the live
failure pattern).

**D-30** · Reasoning/Latency · *An available alternate model provider is the retry; do not retry
the same failing transport first.*
When a reasoning tier has another configured model provider behind it, a transient 429, 5xx or
network failure crosses providers after one attempt. Only the last real provider before the
deterministic heuristic retains the three-attempt retry budget, preserving resilience for a
single-provider deployment and giving the model path a final chance before deterministic
degradation. Full transport timeouts and hard 4xx errors already cross immediately.

Why: after cross-provider failover shipped, the live six-hour window showed 21 failed provider
attempts across 82 samples and eight steps saved by the alternate model, with no heuristic
fallbacks, while independent p95 dispatch latency was 83.66 seconds. Repeating a failing primary
was adding wall-clock delay before taking the action that actually recovered the step. The
structured attempt receipt and provider-scoped circuit breaker remain unchanged. Payment
authority is also unchanged: provider rotation cannot choose a payee, exceed a budget, or bypass
the evidence gate. Reversible: easy (restore per-tier retries or make the policy configurable).

**D-29** · Reasoning/Reliability · *A paid dispatch crosses configured model providers before it
may degrade to deterministic reasoning, and the receipt records every tier it actually tried.*
The default chain is credential-aware: Anthropic, DeepSeek Flash, MiMo V2.5, then the heuristic.
A deployment may set `KERYX_LLM_PROVIDER_ORDER` to an explicit ordered allowlist of those real
providers; omitted names are intentionally disabled, invalid/duplicate names are ignored, and an
empty/all-invalid value restores the default. The deterministic heuristic always remains last.
A caller-picked model leads the chain and excludes only that exact engine from the default
fallbacks. Each transport aborts at a configurable sixty-second deadline; rate limits, 5xx and
network failures retry three times, while a full timeout crosses providers immediately rather than
waiting through the same deadline again. A process-wide circuit opens after two exhausted
reasoning calls for sixty seconds. A hard
4xx configuration error opens immediately. The circuit is keyed by engine wire name, so one noisy
provider cannot suppress another.

Every completed run persists bounded per-step attempt telemetry: engine, tier, attempt, latency,
outcome, HTTP status and a coarse error category. Provider bodies are never stored because they may
echo paid source context. The dispatch watchdog aggregates real-model failover saves, failures and
circuit skips onto `/status`. The compact `engine` label remains the public summary, but it is now
backed by structured evidence rather than string parsing alone. Payment authority is unchanged:
models still only propose decisions/evidence, while the orchestrator alone enforces spend caps,
payTo, evidence qualification and integer settlement. Why: production showed 4/6 recent runs losing
a reasoning step to the heuristic while both DeepSeek and MiMo passed live probes; resilience was
available but the healthy second provider was not in the default failure path. Reversible: medium
(remove the secondary tiers/telemetry; no database migration or payment-rail change).

**D-27** · Browser co-sign/Security · *A persisted session grant is payment state, not bearer
authentication.*
The `/api/ask` browser co-sign path now requires the active SIWE wallet to equal the client-supplied
session id and the persisted grant owner before the request receives the user-funded exemption or
any sign-request id. A wallet address is public; treating it as sufficient proof let another caller
reserve that wallet's spend cap with invalid payment headers and use the co-sign route to bypass the
anonymous treasury rate tier. The attacker could not sign with or steal the session funds, but could
strand the victim's capacity and consume server-side reasoning. Pending signature slots also bind to
the SSE abort signal, so a disconnect removes the slot and releases the pre-signature reservation
immediately rather than waiting thirty seconds. Why: ownership must come from SIWE, while the grant
only bounds an already-authenticated owner's spend. Reversible: low (removing the binding would
reopen a cross-session denial-of-service path).

**D-26** · Distribution/Demand · *A shareable wanted brief is a live coordination view, never a
bounty promise or payment authority.*
Every published gap may be opened at `/wanted/[gapId]` with claim-specific metadata, a social card,
the failed dispatch receipt, current offer state, and a feed probe scoped to that claim. The URL
carries only the existing opaque semantic id. Both the page and probe rebuild the current
evidence-bounded demand board; a claim that is no longer open cannot be offered from stale shared
state. Registration still re-reads the feed, independently matches the selected post, resolves
SourceRegistry ownership, and applies the one-offer-per-gap-owner plus five-per-wallet daily
admission limits.

The page says explicitly that this is not a guaranteed bounty. Keryx may sponsor one treasury retry
up to 0.05 testnet USDC after indexing and ownership verification, but `filled` still requires
claim-matched evidence, at least 0.4 evidence-bounded coverage, and a genuinely settled citation
leg. Shared metadata, social previews, and feed-probe results cannot select `payTo`, increase a
budget, queue spend, or mark fulfillment. Why: the gap-to-payout loop existed but one undifferentiated
board was difficult to route to the specific writer who could close a claim. Reversible: easy
(remove the permalink and scoped presentation; the queue and settlement path are unchanged).

**D-25** · Treasury/Security · *Treasury-funded work is admitted as a bounded unit, and an
ambiguous post-broadcast transfer keeps its reservation.*
Wanted-claim registration now independently re-runs the public-preview claim matcher instead of
accepting mere feed membership. Admission is atomic at one intent per `(gap, verified owner)`
across every source and post, with a durable five-offer-per-wallet daily limit at the registration
boundary. This makes a creator's semantic offer—not each attacker-selected URL—the unit that can
enter the treasury retry queue. Remote MCP applies the same principle by rejecting a JSON-RPC
batch containing more than one treasury-funded `research` call, so an HTTP-request rate-limit
token cannot fan out into multiple spends.

Untrusted URL classification expands IPv6 before checking IPv4-compatible and IPv4-mapped
addresses, preventing hexadecimal forms such as `::ffff:7f00:1` from bypassing private-network
rules. The testnet onramp reserves an address before sending and releases it only when no
transaction was broadcast or a receipt confirms a revert. A receipt timeout after a transaction
hash is returned becomes `pending` and retains the reservation, because retrying an ambiguous
transfer can double-drip. Why: financial rate limits must cover the actual funded unit, URL
canonicalization must not weaken SSRF policy, and uncertain settlement is not failure.
Reversible: medium (limits are configurable in code; the conservative reservation rule requires
reconciliation before a retry can be made safe).

**D-24** · Demand/Settlement · *A creator's wanted-claim offer is durable coordination, never
payment authority; fulfillment requires evidence and real settlement.*
Each open semantic claim gets a stable SHA-256 id. The feed-match handoff carries only that opaque
id and the matched post URL; registration re-resolves the claim from the current demand board and
requires the post to exist in the RSS payload Keryx just ingested. The resulting `gap_intents` row
snapshots the failed question and offered source, but cannot choose a payee or spend a creator's
funds. The volume daemon atomically leases only intents whose source cache row is active, ownership
verified, and still owned by the wallet that made the offer. It retries with Keryx's existing
server-side x402 treasury path, capped at 0.05 USDC, a ten-minute crash-reclaim lease, and three
attempts; registration and verification requests never spend.

Completion is deliberately stricter than the generic demand board: `filled` requires the offered
source to carry reward-qualified evidence for the same semantic claim, evidence-bounded coverage
of at least 0.4, and a `settled=true` citation ledger leg with a Circle settlement identifier for
that source and retry run. Grounded-without-settlement is `unpaid`; weak/mismatched evidence is
`missed`; an offer whose gap closes before verification becomes `stale` without spend; repeated
execution errors become `failed`. SourceRegistry/payTo validation and integer
micro-USDC splitting remain unchanged. Why: feed matching previously ended at a registration link,
while probabilistic retries could neither target the creator's offer nor prove that the advertised
gap-to-payout loop completed. Reversible: medium (additive queue/table/UI; no new payment rail).

**D-23** · Grounding/Settlement · *A model citation cannot authorize a reward without a
deterministically verified evidence span.*
Synthesis now proposes `claimIndex + marker + exact quote + support`; the orchestrator accepts it
only when the claim index exists, the marker names content actually read, the normalized quote is
present in that source, the marker appears inline in the answer, and synthesis declared it cited.
Public evidence excerpts are capped at 240 characters so a receipt cannot substitute for gated
content. Rejected markers are removed from the public answer and never enter `citations`, so they
cannot reach `payCitation`; a failed final-assessment call also fails reward authorization closed
without discarding the completed answer. Final confidence and the demand board use coverage bounded by both the final
assessment and the strongest reward-qualified evidence, never source count or a stale pre-purchase
snapshot. Fetch tolls already settled remain valid payment for access; when no citation passes the
gate the citation pool stays unspent. Attribution may only weight the evidence-qualified set; an
invalid/incomplete attribution falls back to an equal split inside that set and can never introduce
a payee. Why: a live CCTP retry correctly measured every claim at 0% and wrote a negative answer,
but an empty `citedMarkers` fallback promoted all 13 reads to citations, labelled the answer High
confidence, and settled equal rewards. The model may propose economic state; code must authorize it.
New nullable scalar counters power the dashboard without loading every receipt, while historical
runs remain explicitly unsampled. Reversible: medium (additive run schema, but the reward gate is
now a financial invariant).

**D-22** · Distribution/Telemetry · *Attribute Remote MCP activation with a bounded setup-URL
channel, never with protocol client metadata.*
The stateless Streamable HTTP transport does not retain `initialize.clientInfo` for a later
`tools/call`, so each published setup URL declares one bounded channel:
`?client=codex|claude|cursor`. Missing and unrecognized values normalize to `direct` and `other`;
historical rows remain unknown. This is intentionally self-declared activation telemetry only.
Stable actor attribution still comes exclusively from a verified API-key wallet, and the channel
cannot change auth, rate limits, budget caps, or payment authority. Reversible: easy (stop
publishing tagged URLs; the nullable column is additive).

**D-21** · Distribution/Payments · *Add stateless Remote MCP beside, not instead of, the caller-funded
stdio MCP package.*
`https://keryx.cc/mcp` creates a fresh Web Standard Streamable HTTP server per request and exposes
the shared `collectRun` research core. Remote calls are treasury-funded because a hosted server
cannot safely hold each caller's local x402 buyer wallet: anonymous calls reuse the IP-limited
free tier and `anonMaxBudget`; ask-scoped API keys get the keyed limit, `a2aMaxBudget`, and
server-verified wallet attribution. A separate `mcp` origin keeps this channel measurable without
mislabeling it as inbound-paid A2A traffic. The npm stdio path remains available for agents that
must pay Keryx's x402 toll from their own wallet. Stateless JSON mode fits Next/serverless and gives
up durable sessions/server notifications, which the two request/response tools do not need.
Reversible: easy (remove `/mcp` and the registry remote; additive origin rows stay readable).

**D-20** · Traction · *External completed queries, not aggregate self-generated payments, are the
primary product KPI.*
Persist `origin` on `query_runs` so zero-spend dispatches remain in the correct conversion
denominator; payment-origin alone cannot do that. External means a real web asker or third-party
A2A caller, while the autonomous volume engine remains visible but secondary. Returning actors are
counted only from a server-verified SIWE wallet or a settled inbound A2A payer—anonymous users are
not fingerprinted. Money metrics read only `settled=true` rows. Latency and settlement-success
samples start when telemetry ships; historical rows stay NULL rather than receiving invented
values. Why: the system already proves the rail works, so the next bottleneck is repeat external
demand and answer quality. Remote MCP is a distinct external origin; authenticated MCP actors use
the verified API-key wallet and anonymous MCP callers remain unattributed. Reversible: easy (the
fields are additive; presentation can change).

**D-19** · Notify · *Citation email alerts are a second independent channel beside the webhook, not a column on it.*
Own table (`source_notify_email`) + own dispatcher mirroring the webhook's contract (settled-legs-only,
fire-and-forget, never throws), so a creator can run either channel or both and existing webhook code
stays untouched. Provider = Resend over one HTTP POST (no SDK, no SMTP dep); ships dark until
`KERYX_RESEND_API_KEY`+`KERYX_EMAIL_FROM` are set — same proven pattern as the Slack front door.
Per-source rate cap (default 1/h) because the 24/7 engine re-cites the same sources; unsubscribe is an
unauthenticated tokened link (per-row random secret, constant-time compare, uniform response) because
the recipient must always be able to stop mail even without the owner's wallet. Reversible: easy
(drop table + panel; run path is one fire-and-forget call).

**D-18** · Dashboard/Data · *Creator cash-outs (Gateway withdraws) live in their own `withdrawals` table, never in `payment_events`.* (user: surface real /tx/ proof on the dashboard)
A withdraw moves already-earned USDC OUT on-chain; it is not a new payment. Folding it into `payment_events` would double-count — `metrics()` aggregates that table for total payments, total volume, creator payouts, and reader→payer conversion, so every cash-out would inflate traction. A dedicated table keeps those figures honest while letting the dashboard surface the withdraw's real EVM mint hash — which, unlike the batched Circle settlement UUIDs in the payments feed, resolves at the explorer `/tx/` — as the hard per-tx on-chain proof that rewards are real, withdrawable USDC. Keyed by `tx_hash`, so re-recording the same withdraw is an idempotent no-op (the `withdraw` script persists on each live mint). Reversible: easy (drop the table + panel; no coupling to the payment path).

**D-17** · Trust · *Listing a source is permissionless, but EARNING requires feed-ownership proof.* (user: "do the best one")
Anyone can paste any RSS feed into the register form, so anyone could list a feed they don't own (Stripe's blog, Vitalik's site) with their own wallet and skim citation rewards — the content is real, but the wrong wallet gets paid. Fix: a `verified` flag gates the money path, not the directory. The agent (`run-agent.ts` discovery) only reads/cites/pays sources where `verified !== false`; unverified ones still appear in the registry, just off the rail. Proof = the owner places `keryx-verify:<payoutWallet>` anywhere in the feed (only whoever controls the feed's publishing pipeline can, and the token binds to the wallet so it can't be replayed) then POSTs `/api/sources/verify`. Migration-safe: the column defaults true, grandfathering the 17 curated seed rows + live VPS traction so the volume engine never stalls; only public web submissions start unverified. On-chain `register()` is the same squatting vector, so the indexer writes new rows unverified too (never downgrades an already-verified row). Reversible: easy (flip the discovery filter off). Note: `id = keccak256(creator, urlHash)` namespaces sources per wallet, so a verified owner can list their feed alongside any impostor copy and be the only one that earns.

**D-12** · Settlement · *Reuse x402 plumbing for BOTH toll moments instead of a new transfer primitive.*
Each source has its own wallet as `payTo`. (a) Fetch toll: agent `gateway.pay(/api/source/[id])` → real x402 settle to creator. (b) Citation reward: agent `gateway.pay(/api/cite/[id])` with dynamic price = weighted reward → real x402 settle to creator. Both land in `payment_events`. Why: every payment is a genuine batched on-chain settlement (no mocks), reusing verified code; no bespoke transfer path. Reversible: medium.

**D-11** · Settlement · *Two-tier economics: small fetch toll + weighted citation pool.*
Per query budget B. Fetch tolls are small per-source access fees (only on BUY). A citation pool (portion of B) is distributed AFTER synthesis by LLM-assigned contribution weight to sources actually cited. Sources fetched-but-not-cited keep only their toll; cited sources earn toll + weighted reward. Why: makes "paid per citation, weighted by contribution" literal and demoable; creates emergent budget behavior. Reversible: easy (tune pool %).

**D-10** · Multi-author · *Default to programmatic per-author nanopayments; on-chain splitter contract is an optional enhancement.*
When a source has N authors with split weights, send N weighted nanopayments to N wallets. Why: showcases nanopayment sub-cent floor, no contract deploy risk, fully real. On-chain `PaymentSplitter` (Circle Contracts) offered as enhancement for atomic splits. Reversible: easy.

**D-09** · Agent · *LLM-provider-agnostic `lib/llm` with Anthropic Claude default + deterministic heuristic fallback.*
Why: build/run/test the whole flow offline today (no key blocker); flip to real Claude reasoning for the demo. Claude (not OpenAI) since user is in the Anthropic ecosystem and we want best reasoning for the 30% sophistication score. Reversible: easy (swap provider).

**D-08** · Data · *Swappable `lib/db`: SQLite (better-sqlite3) for local dev, hosted Supabase for deploy.*
Why: no Docker locally → can't run Supabase locally; need to develop unblocked AND have a hosted DB for the Vercel demo. Single `db` interface keeps call sites clean. Reversible: medium.

**D-07** · Dashboard · *Poll every 1–2s instead of Supabase realtime subscriptions.*
Why: adapter-agnostic (works with SQLite + Supabase), simpler than scaffold's realtime, same screenshot-ready live effect. Reversible: easy (add realtime later for Supabase).

**D-06** · Traction · *Wire `arc-canteen push` for traction events + `circle feedback submit` for the dev-feedback prize.*
Why: `arc-canteen` is the literal mechanism the hackathon uses to track the 30% Traction score; feedback CLI captures the free $500 dev-feedback prize. Reversible: easy.

**D-05** · Discovery · *Internal source registry is the primary discovery channel; `circle services search` is a bonus external channel.*
Why: we control owned/registered creator sources (real payouts to real creators = traction); external x402 discovery is a nice-to-have. Reversible: easy.

**D-04** · Ingest · *Onboard sources via RSS (RSSHub or direct feed parse).*
Why: trivial one-click creator onboarding ("paste your RSS") → fast traction; RSSHub turns almost any site into a feed. Reversible: easy.

**D-03** · Product · *Name = Keryx; brand = "creators get paid every time an AI cites them."*
Why: repo is `keryx` (Greek herald/town-crier — announces + is paid); fits the per-citation narrative. Reversible: hard (naming).

**D-02** · Scope · *Keep the scaffold's working x402/Gateway plumbing verbatim; rebuild only the agent + creator economy on top.*
Why: payments are the risky/verified part — don't re-derive them; spend effort on the reasoning brain (the differentiator). Reversible: n/a.

**D-01** · Chain · *Build on Arc testnet (5042002); mainnet is a separate audited migration, not a config flag.*
Why: a one-variable switch cannot safely change every chain, token, Gateway, registry, browser, monitoring, and operating assumption. This supersedes the original hackathon-era config-flag shortcut. Reversible only through an explicit mainnet release and go/no-go review.

**D-15** · Enhancements · *Implement all four enhancements, sequenced by score-impact.* (user: "all four; you decide how to win")
Order: (1) Agent-to-agent mode — expose Keryx as a paid x402 endpoint other agents call; (2) External x402 discovery via `circle services search`; (3) Onchain PaymentSplitter (Circle Contracts) for atomic splits; (4) ERC-8004 agent identity + creator reputation feeding source selection. Core (web app + real settlement + volume) lands first. Reversible: easy (each is additive).

**D-14** · LLM · *Add DeepSeek (OpenAI-compatible) as the default cheap provider; Anthropic still supported.* (user choice — cheaper)
Shared `JsonChatEngine` base holds all prompts once; `AnthropicEngine` + `OpenAICompatibleEngine` are thin transports. Provider priority: Anthropic > DeepSeek > heuristic. Reversible: easy.

**D-13** · Deploy · *Primary deploy = run locally + Cloudflare Tunnel (cloudflared) for the public URL; keep SQLite.* (user suggestion — good fit)
Drops the Supabase + Vercel hard-dependency: the app + funded wallet + volume engine run on the local machine, exposed publicly via tunnel. Trade-off: live only while the machine/tunnel run (fine for demo + volume window). Supabase/Vercel path stays available behind config for always-on hosting. Reversible: easy (config flag).

**D-12b** · Recording · *The agent (client) is the single recorder of payments in both modes; x402 server endpoints settle but don't double-write.*
The agent has full context (queryId, rationale, weight, contribution) and runs the same recording offline & online with the real tx hash from `gateway.pay`. A2A external payers get server-side recording in that endpoint variant. Reversible: medium.

**D-16** · Discovery · *External x402 marketplace = discovery + reasoning only; never purchased (off-Arc rail enforced in code).* (user choice — "discover + decide, don't buy")
Each query the agent probes the live Circle x402 bazaar (`circle services search`, one cached snapshot), ranks endpoints locally by topical relevance, and the engine reasons BUY/SKIP over them alongside registered creators. The orchestrator then forces every external endpoint to SKIP — they settle on other chains (Base/ETH/… mainnet, none on Arc), so they're evaluated and logged but not settled (mirrors the budget-cap enforcement). Honors the no-real-money rule while adding Circle `services` tooling + open-economy agency with zero cross-chain spend. Reversible: easy (a Base-Sepolia testnet pay path can be added behind a flag later).

---

## Open questions (for the human) — RESOLVED
- LLM key: ✅ Anthropic primary + DeepSeek fallback (D-09, D-14).
- DB: ✅ local SQLite on the VPS is the source of truth; Supabase adapter kept behind config (D-08, D-13).
- Funder wallet: ✅ funded; real settlement is live (`KERYX_FORCE_OFFLINE=0`), 500+ settled payments.
- Deploy target: ✅ VPS at keryx.cc via Cloudflare Tunnel, not Vercel (D-13).

## Reading UX — 2026-09-28

**Put the question and cited answer first while keeping spending evidence available** - *The previous first screen delayed the question, and a completed answer followed two tall trace panels.* The home masthead now contains the question, visible Quick/Deep choice, and action; budget and AI model are available in an advanced disclosure, with the selected question cap and payer shown at submission. A live summary shows the latest research step and separates settled, pending, and simulated amounts, while the full decision and settlement panels remain expandable. Completed answers lead with citations and payment evidence stays distinguishable by state. This changes presentation only: the existing session grant, browser co-signing, SSE, and payment authority continue to govern spending. The guide is an inline, user-invoked control. Chromium layout and synthetic browser checks are release gates; real mobile hardware, live source previews, and research quality require separate evidence. Reversible: easy (client presentation and tests). See [research reading UX](docs/research-reading-ux.md).

## Encrypted R2 backups - 2026-09-30

**Protect the application SQLite snapshot off-host with authenticated encryption and bounded daily uploads.** The user authorized encrypted R2 backup and an offline restore drill, then accepted per-job limits and account alerts despite residual account-wide billing risk. Other projects share the account, so Cloudflare budget notifications cannot guarantee a zero-dollar invoice. Keep a dedicated private Standard bucket, bucket-scoped S3 credentials and an independently retained random encryption key. A single serialized host writer reserves a conservative request budget durably before every operation, caps daily attempts and object size/count, refuses pagination/retries/multipart, and preserves previous remote backups until a new PUT succeeds. A 30-day lifecycle is a fallback retention bound. Offline restore authenticates before decompression, checks SQLite read-only integrity and produces evidence without starting services or authorizing signing. Withdrawal journals and full payment/service recovery remain separate acceptance gates. See [encrypted backup limits and recovery](docs/encrypted-backups.md). Reversible: disable remote uploads while preserving hourly local snapshots; do not reset the request ledger to retry.


## Research transport parity ? 2026-10-01

Use one public recorded-result projection for A2A, remote MCP and OpenAI. Preserve article/version and observed scholarly identity; use the reading UI bounded claim-matched answer-evidence gate rather than payment eligibility. Public references can support answers without rewards. Operator/desktop exports derive from checked task-bound receipts and remain private. No projection enriches records, authorizes payments or changes private search scope. Distinct settled creators cannot be inferred from citation allocations or payment-leg totals: creatorsPaid is nullable and allocations/references get separate names. Consumers must tolerate null. Ship applicable adapters/artifacts together under [surface parity](docs/surface-parity.md).


## Stable native inspection versus derived exports ? 2026-10-02

Preserve the established v1 raw result/default brief contract across the TypeScript and evaluated Rust readers. Derived reference/evidence exports are a separate application presentation domain, explicitly read through `readOperatorResearchResult` for non-brief CLI and desktop formats. Both raw and enriched readers share one integrity/task-binding snapshot reader; enrichment uses its exact checked receipt object without a second file read. This prevents transport enrichment from accidentally broadening a staged native domain or requiring duplicate bibliographic generators. Exact native/inter-file assertions remain release gates, with added copied-artifact proof of the raw base, derived formats, receipt digest/authority and unchanged source tree. Native direct-format cutover remains unproven.

## Empty evidence production completion - 2026-10-02

Initialize the shared orchestrator's Low confidence fallback before its early returns. Next's production optimizer coalesced an uninitialized confidence binding with a later verdict, causing no-source and failed-original-read paths to throw despite passing source tests. Protect actual compiled behavior with a hermetic post-build regression in CI. Result/payment/export contracts remain unchanged across shared consumers. See [production empty-evidence regression](docs/engineering/empty-evidence-production-2026-10-02.md).

## Full public mainnet scope and matched deployment profiles - 2026-10-02

The user corrected the earlier invited-pilot proposal: migrate normal public Keryx
on `keryx.cc` and all applicable supported surfaces, including ordinary wallet login,
funding/grants, creator registration/payout and research/API/CLI/MCP clients. Preserve
the superseded proposal and synthetic evidence without treating its invite list or
tiny hard limits as permanent product policy. Reuse verified isolation and signing
pieces where appropriate; preserve funded testnet identities and historical records.

Select immutable canonical `arc` or `arcTestnet` pins from trusted deployment settings,
with both unspecified retaining testnet. Enforce matching private `KERYX_NETWORK` and
public build `NEXT_PUBLIC_KERYX_NETWORK` before Node payment authority; standalone
commands set both labels too. Pin mainnet registry public/server twins to the same
reviewed nonzero addresses. Capture browser/worker authority from the lightweight
public build module alone, without a server/request network fallback. An optional
mainnet WebSocket endpoint is not inferred; the indexer can poll the selected HTTP RPC.

This contract enables reviewable source migration, not real deployment or spending.
Require coordinated durable state identity, ordinary owner consent, observed funding,
registry/content authority, bounded nonce/cap allocation, settlement/recovery and
withdrawal/operational evidence before the final owner launch decision. See the
[corrected mainnet delivery plan](docs/mainnet-delivery-plan.md).

## Normal public mainnet authority and retained custody - 2026-10-02

Use trusted startup network twins across normal web, API, CLI/MCP, bots and adapters;
retain existing testnet defaults until the coordinated owner cutover. Legacy unlabelled
task/journal originals remain testnet and cannot be automatically relabelled. Mainnet
callers use fresh rail/origin-scoped state, including `~/.keryx/arc`. Source candidate
versions do not claim published packages, installers or synchronized deployment.

Normal browser grants require both readable owner consent and a separate session-key
possession proof over the exact one-use grant epoch, owner, signer, network, origin,
cumulative cap and expiry. A publicly observable funded signer address alone lets a
foreign owner hold another signer's global capacity before signing; verify both proofs
before admission. The secret derivation signature stays local. Renewal/top-up reviews
an absolute lifetime signer cap backed by confirmed debit plus fresh current capacity;
previous spend, nonce exposure and unknown signed liabilities never reset by epoch.

Keep the original mainnet signer encrypted in owner/network/origin-scoped IndexedDB
before funding. Logout locks and retains custody; expiry closes payments but does not
erase withdrawal access. Recovery depends on that browser's wrapping key and ciphertext:
lost/wiped storage is not guaranteed recoverable by repeating `personal_sign` elsewhere.
Same-origin script can obtain the nonexportable AES CryptoKey handle and decrypt available
ciphertext, and sees the initial wallet derivation signature. Worker isolation is neither
an XSS-proof vault nor an on-chain cap; compromised origin/browser/signer endangers funds.

Owner-reviewed funding uses exact ERC-20 approval plus `depositFor`, with native gas
separate and the existing uncertainty/replacement journal retained. Offline registry
preparation emits only source/compiler-bound curated SourceRegistry ABI/bytecode and
unsigned deploy/register/exact-approve/depositFor requests for owner review. It has no
wallet/key, broadcast, funding or launch authority. Preserve old proposal evidence as
superseded rather than rebranding it as the public release. See
[normal mainnet browser custody](docs/mainnet-browser-custody.md).

## Original mainnet funding credit and bounded top-up consent - 2026-10-02

Keep the existing owner funding transaction journal and its cross-tab lock until original
Circle credit is evidenced. Concurrent research can legitimately reduce current availability
below the saved balance plus deposit. Permit only authenticated, original settled debits
admitted strictly after the saved balance observation to offset that threshold. Later
confirmation of older pending debits, raw lifetime total changes and unknown holds cannot
prove deposit credit. Bind the projection to the original network, signer and observation;
retain uncertainty instead of repeating an owner deposit.

Adding funds retains an exact absolute ceiling of previous owner consent plus the chosen
deposit. A settlement between credit reconciliation and the grant proposal cannot enlarge
that ceiling: refresh current capacity against new confirmed spend at most three times,
then refuse before owner signing if it cannot be honored. Preserve the acknowledged deposit.
Retain every public historical grant selector for original-proof recovery after logout or
replacement; selectors alone confer no authority. Synthetic actual React/native-handler
acceptance exercises both concurrent settlement intervals with one approval/deposit pair.

## Retained owner-only browser session cashout - 2026-10-02

Use the ordinary authenticated withdrawal journal and retained dual owner/session proofs
for a narrowly bounded burn to the original owner, even after payment expiry or logout.
The browser independently binds its custody origin, amount/fee review, static mainnet
contracts and finite compiled block window. Lifetime signed spending is not outstanding
liability: only exact original settled nonce/economic evidence distinguishes historical
debit; missing and unknown authorizations remain held. A strict-durability cross-tab
IndexedDB transaction fences payment admission before reserving the withdrawal barrier.

Persist possible exposure before the server authorization marker and burn cryptography.
Lost authorization/transfer responses remain original recovery operations. Cancel only
never-exposed originals, retain cancelled identities, and never release uncertainty by
timeout. Fresh Circle balance/processing data uses a fixed same-origin relay and trusts
the application server and vendor JSON; independent RPC checks do not convert that into
vendor cryptographic evidence.

The connected owner separately submits reviewed mint calldata and gas. Persist the exact
nonce/calldata/fee attempt before prompting the wallet; rejection or a lost response does
not authorize a second mint. Release only the completed withdrawal barrier after original
owner transaction/event/finality evidence and independent browser RPC verification. Keep
old salts, nonces, question budgets and lifetime exposure so the same retained signer can
renew, fund and research afterward. Actual React/native-handler/Chromium and emitted Next
worker checks use synthetic external transport and confer no launch or live-funds authority.

## Paused normal browser payment registration - 2026-10-02

Unavailable status and expiry invalidate the local published registration, clock and
consent, and lock heap custody without deleting funded recovery. A cached authorization
callback must bind its originating published generation and current owner/signer/clock
both before worker dispatch and before header publication. Explicit recovery publishes
a fresh generation even when the server owner and epoch are unchanged. This prevents
paused UI state from silently retaining usable payment authority during worker awaits.
Actual React/production-worker/native-handler acceptance proves zero cached dispatch
while paused and no returned header or settlement after a lookup fails during an
original live challenge await.
## Guarded Arc unsigned fill compatibility - 2026-10-02

Bind only an absent unsigned `eth_fillTransaction` sender to the originally captured
local account. Arc's unsigned transaction serialization omits `from`, so requiring
that field stranded reviewed funding operations before signing. Explicit null,
malformed or mismatched senders still refuse; exact chain/tuple validation and
independent recovery of the actual signed sender remain mandatory before broadcast.
Do not infer that a missing journal hash authorizes another attempt: retain original
funding evidence and require owner recovery of any uncertain admission. See
[treasury transaction isolation](docs/treasury-transaction-isolation.md).

## Ordinary mainnet creator owner-wallet cashout - 2026-10-02

The full public mainnet scope includes ordinary creator earnings withdrawal. Use the
creator's own wallet for the finite BurnIntent and the separately reviewed minter
transaction with native gas; no treasury relay, key loading or automatic transfer retry.
Persist the exact reviewed amount, fee, original signature and one submission claim
before delivery. Mainnet creator custody/recovery records live in a fresh network
namespace and never relabel retained testnet originals. Session and creator flows share
one focused owner-mint authority helper, which binds the original burn/attestation,
static contracts, current owner/network and gas terms. Claim its original nonce and
calldata before the wallet prompt; retain any returned hash even after an owner change.
Reload permits original status/finality recovery, not another mint. Verified finality
requires the original raw owner transaction, receipt/event and independent selected RPC
finalized-block evidence. Actual React/native-handler/Chromium checks use synthetic
external transport and do not authorize launch or live funds. See
[browser custody](docs/mainnet-browser-custody.md).

## Public network display and experimental rights boundary - 2026-10-02

Public deployment labels, registry references and normal creator wallet actions use
the independently compiled canonical profile. Financial receipt links use the
original recorded network, never the current deployment. Retained unlabelled legacy
receipts remain testnet; unknown explicit networks have no invented explorer link.
Gateway contract references are references, not proof of individual Circle settlement
IDs. Creator update/deactivate commands also pin the mainnet registry locally before
opening a wallet prompt. Read-only withdrawal history matches the complete original
creator status and retains its server-reported finality label.

Keep the experimental scholarly rights protocol staged on testnet until a separate
rights/payment domain migration is reviewed. Preserve its existing testnet messages
and archived evidence; close paid manuscript opt-in and rights enrollment on mainnet
with a product explanation before payment. This is an intentional experimental role
boundary, not a restriction on ordinary public wallets or registered article publishing.

## Fresh mainnet research purchase and Monthly authority - 2026-10-02

Keep Monthly's four manually requested Deep research allocations and thirty-day term. Fresh sealed mainnet SQLite installs a canonical original-network purchase claim and v2 entitlement schema, with no historical backfill or testnet catalog adoption. Every seller claims its immutable original authorization before Circle settlement. Monthly adds single-use issued challenge consumption, an exact network/USDC/Gateway entitlement and atomic four-slot redemption; replay cannot change the quote, package, recipient, transaction or original request. Historical ordinary testnet records remain on their original rail; existing enrolled testnet storage refuses this newer domain. Mainnet Supabase remains staged until independently generated native schema evidence exists.

Require actual native purchase writer capability before quoting or accepting a prepaid purchase. The hosted readiness check derives only the dedicated key's public address, compares it to the reviewed sealed policy, refuses historical public/private role reassignment and checks retained accounting/current known capacity. It neither signs, reserves nor funds, and is not a promise of future operating capacity. Actual execution still admits each full original through the hosted journal before signing. Preserve original uncertainty, cumulative signer caps and owner-operated prefunding. Normal mainnet wallet/API/CLI/MCP access has no invitation restriction or special small pilot ceiling.

## Immutable release version alignment - 2026-10-02

A concurrent isolated application-storage runtime merged after product source `080bc5d`
was already accepted as application `0.25.0`, MCP `0.3.1` and desktop `0.3.1`. Preserve those immutable
artifacts and publish the new runtime under application `0.25.1`, MCP `0.3.2` and desktop `0.3.2`.
Version metadata changes only the owned root package records, not dependency
versions or payment/signature domains. Verify each new source, installer and registry
archive independently; a shared version alone does not establish matching delivery.
Arc testnet authority remains the production/default lane; no mainnet activation
or funded-operation permission follows from storage capability or version bumps.
## Mainnet hosted purchase admission and explicit experimental boundaries - 2026-10-02

Ordinary A2A and private purchase admission use the actual freshly sealed application identity, dedicated reviewed role policy and key-to-signer public-address comparison before any incoming authorization can settle. Public/private retained exposure and known capacity limit each original creator budget; absent legacy testnet keys do not disable accepted mainnet roles. Private quote preview remains separate from authenticated purchasing availability, and private execution has no payer invitation list. Actual execution still reserves its exact full original before crypto and persists submission before paid HTTP. Synthetic native HTTP/SDK acceptance proves this composition without authorizing mainnet funds.

Health must distinguish the selected real caller-funded rail from hosted authority whose operating availability has not been probed. Read-only payout monitoring preserves each explicit canonical original profile and treats unavailable or inexact balances as unknown. Keep the experimental scholarly-rights v1 domain explicitly unavailable on mainnet before storage or signing rather than relabelling its testnet protocol. This boundary does not restrict ordinary creator registration, content or cashout. Optional PostgreSQL remains staged while the public release targets fresh sealed SQLite.

## Retained headless session cashout and explicit migration - 2026-10-02

Headless session cashout reuses the restricted browser withdrawal policy and shared unsigned owner mint preparation. It retains the original funded ciphertext, exact authorization tuples, nonce history, question budgets and lifetime consumption. An explicit v2-to-v3 migration excludes older writers; ordinary commands refuse unmigrated state rather than silently adopting or replacing custody. Native tests exercise an actual archived v2 writer before migration and its refusal afterward.

Local exposure and server authorization precede burn cryptography, and an atomic local delivery claim precedes transfer HTTP. Lost authorization/submission responses remain original recovery, never permission for a second burn. Before an unsigned owner mint packet is displayed, its nonce, calldata, gas and fee ceilings are retained; a manually supplied owner transaction hash is committed before completion HTTP. Only evidenced original cancellation/completion removes the relevant barrier. The CLI has no owner transaction signing or broadcast authority. Own-EOA MCP balances retain the separate same-owner SIWE withdrawal handoff; delegated session support does not imply key-only MCP cashout. These native synthetic checks do not prove live settlement or distributed cloned-state exclusion.

## Explicit reviewed deployment roles and scheduler preservation - 2026-10-03

Reviewed public web launches separate Next's public metadata (`keryx.cc:443`) from
the physical loopback listener (`127.0.0.1:3939`). Using the physical address as
Next metadata caused a normal Session-original origin mismatch in controlled QA.
The fixed shared server checks public Host and forwarded HTTPS before Next, without
rewriting request URLs or headers; deployment health sends those same trusted
constant headers rather than bypassing the check. Its 100-second idle keep-alive
exceeds the observed cloudflared origin pool default of 90 seconds; Node retains
unlimited requests per socket, independently of the separate QA proxy fix. Only
the exact shared launcher is admitted for new reviewed production roles. Both
preceding clean Next CLI tails are recognized solely for stopped-definition recovery.
Local development and default CLI launch behavior remain separate.

Network and managed-role transitions need supported deployment inputs instead of
replaying a saved PM2 environment or silently resuming held financial schedulers.
The optional reviewed PM2 JSON is byte-hash bound and protected, restricts two fixed
clean ENV-file launchers, and replaces only positively stopped or absent roles.
Sanitized stopped definition references precede replacement; raw PM2 environments
are not exported. Operator-owned positive drain and separate custody/identity/rail
review remain prerequisites. Scheduler preservation leaves all existing worker,
timer and cron holds untouched. Reviewed deployment retains build recovery evidence
and holds failed starts/health checks for inspection rather than destructively
rolling back after a transition. Default code-only deployment remains compatible.
No product payment authority or supported-client contract changes follow from these
operational inputs.

## Read-only storage selection and compiled browser fixtures - 2026-10-02

Private economics reporting selects its reviewed read-only adapter through the same source-owned application storage boundary. It must not initialize the ordinary database, acquire writer authority or silently fall back from an unavailable mainnet identity. Keep the dormant funding/enrollment import guard unchanged; resolve `.mjs` imports to their authored `.mts` sources so the guard examines the actual transitive graph.

Hermetic browser fixtures compile explicit public profile/registry pins as Next does, rather than installing a Node `process` global or accepting request-selected authority. Historical testnet signing, clock and malicious-parent assertions retain their original rail and limits. Faithful gateway/route fixtures provide inherited methods, canonical profiles and the required native authority interface; successful setup must not remove nonce, privacy or durable-issuance assertions. The desktop question remains visible in the first reading area with the original layout/keyboard acceptance thresholds.


## Explicit originals and request-local reasoning failures - 2026-10-05

A caller-supplied URL is a bounded discovery requirement, independent of search
ranking; it is never document evidence, publisher authority or payment permission.
Preserve each original and its fragment scope through decisions and final status,
including model omission. Retain whole-document read limits, attention selection,
exact arXiv identity and private/unattended disclosure boundaries. Secondary reads
cannot silently satisfy an unread requested original. Optional receipt metadata
adds scope without rewriting historical records or changing reward eligibility.

Distinguish post-response output validation, internal errors and proven local
input limits from supplier transport/health failures. Request-specific failures
must not poison a shared provider-step circuit. Test the actual bounded prompt
before claiming a fallback usable, retain all required input, and expose per-step
serving to consumers. Preserve returned-call usage and existing durable failures;
neither a new release nor an offline reproduction authorizes clearing circuits
or reopening a closed paid evaluation. See the issue-followup scope document.

Immutable source/artifact staging is independent preparation, not production
admission. Keep the reviewed early writer drain until clean immutable role bindings,
economic compatibility/rollback, off-box evidence and measured no-spend plus ordinary
production rollout pass. Synthetic process timing establishes only that fixture.

After the parallel v0.26.12 native-schema batching repair, retain the complete
keyless inspection path: async unseal/fresh backend, semantic manifest reread,
full assembled original comparison and final five-second freshness check. Exact
schema guards still run on every operation; no authority cache or new issuance
API is needed. The native Windows mutation/drift checks pass with the stronger
original path. Timings are fixture evidence, not production performance guarantees.
Browser fixtures model concurrent work at the synthetic wallet boundary, outside
the production transport deadline, with fresh state for each journey and unchanged
assertions. Windows timing failures do not justify weakening the deployed limits.


### Reconcile parallel issue and mainnet releases - 2026-10-05

v0.26.12 merged while issue repairs were in CI. v0.26.15 must retain its mainnet
surface/monitor/schema fixes and resolve overlap through one URL-admission helper
and one bounded public `reasoning` contract, preserving remote protocol0.3.0.
Named originals have the existing eight-lead cap and independent admission from
search publisher slots; actual attention, public transport, evidence and spend
limits remain. Canonical bodies retain up to four requested fragment URLs as
scope metadata, with truthful final read status. New MCP 0.4.5 / desktop 0.4.6 identities
avoid reuse of already selected 0.4.4 / 0.4.5 bytes. Combined regressions, independent
review, exact-source CI and serialized deployment/publication remain required.

## Reusable research budgets and optional Google wallets - 2026-10-05

The owner authorized reducing repeated wallet confirmations and adding a Google-linked
user-controlled wallet. Model mainnet delegation as an explicit research budget reused
across conversations, with signed 1-hour/24-hour/7-day duration and per-question limit.
Use a versioned v2 consent with independent server and worker checks; preserve v1
message/proof bytes, original networks, retained custody and all cumulative liabilities.
Renewal verifies the retained original and cannot increase its ceiling from external
funding. A reviewed top-up and fresh owner signature are required for an increase.

Circle user-controlled EOA wallets keep the owner-wallet interface compatible with
existing payment/funding checks. Authenticate the actual Circle wallet server-side;
Google authentication alone is not spending consent. Optional configuration and vendor
acceptance gate activation. Research session custody remains same-browser storage;
longer delegation is not an on-chain/XSS-proof policy wallet or portable recovery.
See docs/research-budget-onboarding.md for setup, compatibility and surface roles.

## Separate zero-source research from finite compute authority - 2026-10-05

Preserve an explicit zero source budget end to end instead of replacing it with a positive
default. Zero authorizes no source purchase, creator reward or browser signing scope; model
and search costs remain separate. Shared hosted and local execution applies the same payment
guard, while caller-funded checkout products retain their independently positive fee contracts.

For the owner's new USD 1 / three-question acceptance, use a distinct strict dated v2 policy
with exact public-web question hashes and atomic durable model/search/question reservations.
Bind transport to the admitted execution context and retain failed, interrupted and unknown
holds. Keep the old model-only policy unchanged and closed. Pause direct private inference
and watchdog schedules during the round instead of claiming the public factory covers them.
No automatic renewal, retry, refund, new custody or scheduler activation follows from this
policy. Technical completion and useful complete answers are separate acceptance criteria.
See docs/engineering/bounded-live-research-2026-10-05.md for scope and release gates.

## Preserve atomic targets and make planning refusal terminal - 2026-10-05

The 0.26.16 ordinary-browser round graded 0/3 useful; two comparisons exceeded eight
planning targets before discovery. Raw plans were not retained, so their exact expansion
cause remains unproved. Distinguish compared subjects from complementary references in
the existing planning call. Preserve every independently inspectable information need;
neither a larger target/context/cost limit nor semantic grouping is an accepted repair.
Malformed/excess/incomplete planning is a terminal request-local output refusal, retaining
usage and circuit history instead of paid tier fanout or an aggregate heuristic answer.
Caller-only narrowing excerpts are private error state, absent from ordinary inspection/logs.

A unique normalized short extracted heading matching a supplied fragment may prioritize
contiguous already-read text under existing context/candidate/scan bounds. This improves
cross-language recall without certifying an HTML anchor or full section. Preserve literal
quote/source/version/reward checks and D-300. Offline fixtures do not replace ordinary-client
usefulness, prove the historical Next.js loss point or reopen the closed paid scope.
See docs/engineering/research-planning-2026-10-05.md for adapter and release gates.

## Public Google wallet rollout and disclosures - 2026-10-05

Publish hosted terms and accurate optional Google/Circle processing disclosures,
with homepage/footer links, before enabling the configured Google wallet path.
Distinguish Keryx account storage from provider identity processing, short-lived
device continuation from in-memory signing credentials, and wallet identity from
the separate retained browser research key. Login validity does not guarantee
automatic removal of abandoned SDK OAuth metadata from browser storage.

The owner selected direct mainnet activation and product acceptance on keryx.cc
after publishing the Google audience and configuring Circle. This replaces the
default isolated-testnet-first rollout for this setup, not the need to verify
real Google return, wallet initialization, message/typed/raw signing and repeated
recovery derivation. Keep each unverified operation open. Configuration deployment
does not fund a wallet, issue spending consent or authorize automatic paid research;
existing caps, journals, schedules and custody remain authoritative. Mainnet
funding/spending acceptance still needs its applicable finite authorization.
See docs/research-budget-onboarding.md for setup and supported-surface boundaries.

## Bounded sponsorship, recurring tolls and accurate unread receipts - 2026-10-05

Money-path corrections found in an orchestrator review. All are downward or neutral for treasury exposure except the cache window.

- A selection that was never read (early stop, or a purchase that failed before any authorization) is recorded as SKIP and its query-local toll reservation is released; receipts previously counted it as bought and the gap-expansion pass saw less budget than remained.
- A client disconnect cancels research only while no creator payment has been observed; afterwards the run completes and is saved so payment receipts keep their dispatch.
- The final coverage check reuses the interim assessment when nothing was read since, instead of repeating an identical model call.
- Paid reads expire from the cache after `KERYX_CACHE_TTL_SECONDS` (default seven days), and a browser-funded read is cached per paying wallet. Without expiry an article version earned one toll for the life of the platform. This raises treasury toll spend on sponsored runs within the existing per-query and lifetime caps; the window is an owner-tunable business parameter.
- A run not funded by the asker's own browser grant leaves out sources whose payout or author wallet is the verified asker (`/api/ask`, keyed chat completions, remote MCP). Chat bots and anonymous callers have no wallet identity, so sponsored research also has durable daily dispatch caps per caller and service-wide (`KERYX_SPONSORED_DISPATCHES_PER_CALLER_PER_DAY`, `KERYX_SPONSORED_DISPATCHES_PER_DAY`), making sponsorship a bounded daily cost instead of a per-minute rate.
- Source passages carry an instruction to disregard embedded requests to cite, score or weight a source, since their authors are paid when cited.

Deliberately not changed. A local trial of a "which systems ..." comparison improved when Deep research searched once per target, showed 4000 characters per source and read one source per target, but the same-day planning decision records that a larger target, context or cost limit is not an accepted repair, and bounded live acceptance reserves model and search usage atomically. Those changes were withdrawn from this update and remain an owner decision. No service fee on browser-funded research and no refund of an unused A2A creator reserve: both add a new mainnet money movement and need their own design and review.

## Authoritative sponsored recipients and pre-gateway history retention - 2026-10-05

The combined source-selection review found that DB-only self-recipient exclusion
could miss a fresh registry payout, and a payment trace arrives after asynchronous
ledger/cache writes. Use the existing current registry toll/citation authority at
discovery and revalidation, then pass the verified outside-funded asker as a
trusted denied recipient to every creator payment adapter. Deny resolved,
challenged and signed recipients before signing/admission/submission. An immutable
independent signed payee cannot be redirected by a later registry change. DB author
fallback applies only without registry citation authority; a browser-funded owner
keeps existing authorization to pay their own sources.

For web SSE, retain history from the trusted pre-gateway callback, before payment
or persistence can suspend. Retention means an attempt may exist, not that it
settled. Cancel browser signing on connection loss and deny further creator
payment boundaries while allowing the in-flight attempt and its truthful pending
or settled receipt to finish recording. Cancellation before any boundary creates
no completed dispatch. Existing spend caps, custody, nonce and financial evidence
rules remain authoritative; the closed live allowance is not reopened.

## Align Google continuation with durable authentication limits - 2026-10-05

Direct mainnet onboarding exposed a ten-minute Circle continuation that violated
the existing SQLite auth-challenge ceiling of five minutes, returning 503 before
OAuth began. Reuse the shared five-minute authentication policy for server
issuance, cookie expiry and browser continuation admission. Preserve the sealed
storage schema and single-use consumption rather than widen durable authority.
Real-schema route coverage must exercise issuance, exact expiry and replay.

Expiry requires an explicit fresh login; completed Circle initialization can be
resolved as the same canonical wallet on that attempt. No automatic signing or
initialization retry, challenge renewal, budget/custody change or funding follows.
The continuation window is distinct from vendor token and Keryx session lifetimes.

## Source-backed OSS adoption and historical context roles - 2026-10-05

The owner requested learning from current OSS AI projects and skills and applying
useful patterns to Keryx. Keep a dated, source-pinned adoption record and a focused
repo-local skill; choose native adaptations or dependencies according to an
observed need and verified quality. Framework activity and token-saving claims
are not adoption acceptance. See the [survey and gates](docs/engineering/oss-ai-adoption-2026-10-05.md).

Historical source performance includes publisher-controlled current source names.
Keep the complete history in serialized user data instead of interpolating it
into system policy. Static instructions may explain historical relevance, while
current previews/targets and existing authoritative price, budget and reward
checks retain control. No runtime skills execution, memory access-scope expansion,
payment authority, custody, provider allowance or scheduler follows. Deterministic
regressions demonstrate role separation; live model robustness and usefulness
remain separate evidence requirements.

## Independent review corrections to bounded sponsorship and unread receipts - 2026-10-05

An independent review of the preceding update found no double payment, overspend or wrong payee, and four defects that are corrected here.

- A disconnect while the first creator payment was still in flight cancelled the run that owned its receipt, because the route learned of a payment only from the trace step emitted after it. The route now also marks the existing creator-payment boundary, which is awaited immediately before every gateway call.
- Per-payer cache keys are withdrawn. Enrolled storage admits at most 512 cached rows and 8 MiB and never evicts, so payer-by-version keys would exhaust it and make every later read a fresh toll for all callers. The shared cache with the reuse window remains: an expired row is replaced in place by its next purchase. Charging each reader for a paid read needs a per-payer entitlement record with the content stored once; that is an open design item.
- Gap expansion reads a fresh cached copy instead of buying the same article again. Early stop releases a toll reservation only for a decision that is still an unread purchase, so a decision already withheld by a funding failure keeps its reservation and rationale.
- Sponsored admission keys an IPv6 caller by its /64, since a subscriber is routinely delegated the whole prefix and a per-address key handed out a fresh allowance for each address.

Considered and kept. Daily buckets stay after the caller's per-minute buckets and before the shared ones: a caller refused by the shared per-minute bucket loses one of its own daily points, which only its own retries can cost it, whereas the reverse order would let a caller with an exhausted day spend the shared per-minute allowance of everyone else. The own-source exclusion compares recorded wallets and can be avoided by asking signed out or from another wallet; the daily caps are the bound for those callers. It also applies to prepaid private research and to keyed chat completions, whose runs are now attributed to the key wallet in its history without counting as its spend.

## Search every Deep research target and name candidates for open comparisons - 2026-10-05

The owner reopened one part of "Preserve atomic targets and make planning refusal terminal": Deep discovery cost. That decision recorded that a larger target, context or cost limit is not an accepted repair. This change keeps the eight-target limit, the terminal planning refusal, the 2,000-character source context and Quick research (two sequential searches, two reads) exactly as they were, so the closed bounded live allowance and its per-question search holds are unaffected. It raises only Deep discovery and attention.

Deep research previously searched the question and the first three targets, and one broad query could fill the 24-candidate cap, so later targets had no discovery. It now searches the question and every target (at most nine queries) together and shares the candidate cap equally between queries. Unless the caller pinned its execution limits, Deep may read one source per target instead of stopping at the configured attention default; A2A packages keep their pinned limits. For a "which items satisfy these criteria" question that names none, planning names at most six specific candidates to verify, one target each, plus one target for candidates it did not name, and does not spend a target on the meaning of an ordinary evaluative word.

Recorded local comparison on one question ("Which open source accounting systems have an API an agent can safely write payments to, and where does each one fall short?"), isolated offline payment mode with the real model and search provider, one run each: targets 3 generic to 7 named systems; searches 4 to 8; pages read 3 to 7; final per-target assessment 5-10% to 10-40%. Qualifying excerpts rose only from 6 to 7, four of seven targets still had no qualifying excerpt, and both runs delivered Low-confidence excerpts rather than a reviewed brief. One run each is not a measured rate.

So this improves what the agent looks for and reads, not yet what it can deliver. A larger source context was tried and withdrawn: at 4,000 characters the fragment-hint selection lost one of four required headings and a decision-brief fixture lost its separate passages, so the context union stays at 2,000 until that selection is redesigned. Unreadable originals (two of nine read attempts here) and the excerpt gate remain the limits on a useful answer. Cost rises with the plan: up to nine basic searches and up to eight reads per Deep question.

The comparison above used `deepseek-chat`. With the project default `deepseek-v4-flash`, one run on the branch skipped all 24 candidates, including pages its own rationale called directly or strongly relevant, because the search snippet did not itself contain the answer; unmodified main read four pages and cited none. The selection prompt now states that frugality applies to paid tolls, that a snippet is not expected to contain the answer, and that a free read described as directly relevant is selected. The following flash run read seven pages with no failed read. It still delivered no evidence, for a separate reason recorded below.

Not changed, and still open: with the decision brief enabled on `deepseek-v4-flash`, three consecutive runs on this question each ended with an empty answer through a different fail-closed exit: the brief's 12,000-character context bound was exceeded (and was still exceeded after reducing to two reads), the review reply reached its 4,096-token ceiling, and a reply was not a valid JSON object. Falling back to excerpt synthesis and keeping only the reads that fit were both tried and withdrawn, since tests pin the brief as failing closed without retrying generation and no fixture reproduced the bound. Three single runs are observations, not a rate; the cause of each exit is not established beyond its error message.

## Preserve Deep search attempts and atomic comparison scope - 2026-10-05

Review of the merged Deep-discovery update found that cancellation could discard
all search counters after parallel provider calls had already been dispatched.
Count each invocation and its returned/rejected outcome at that boundary; preview
admission remains separately cancelled. Synchronous provider failure is isolated
per query. These counters describe calls and provider outcomes, not invoices or
financial settlement. Quick keeps its sequential two-query ceiling and never
dispatches a later query after cancellation.

Deep preview admission shares only the capacity remaining after caller originals.
A deterministic round-robin pass gives every successful query a chance before a
broad query fills the cap, reusing spare capacity from empty or duplicate results
without another search. Quick retains its original shared 24-candidate cap; it
does not inherit a per-query quota that reduces useful first-query results.

Provisional candidate names aid discovery for an open comparison, but one target
cannot conceal multiple independently requested dimensions. Keep each candidate
and independent dimension separate within the unchanged eight-target cap. Choose
only a bounded, explicitly provisional shortlist that fits all dimensions; when
the requested breadth cannot fit without changing scope, retain the existing
terminal refinement path. Candidate names establish neither findings nor complete
coverage of a category. This corrects the preceding compound-target instruction;
the separately owner-authorized Deep discovery cost change remains intact.

Give integrated source a fresh release identity rather than reusing the immutable
v0.26.20 tag/archives from `562ac756`. Exact combined review/CI, deployed commit and
public distribution readback remain independent gates. None of these repairs
reopens the closed client/model/search scopes, creates a paid retry or circuit
reset, authorizes funding/spending, changes custody or adds a schedule. Richer
synthesis stays disabled and ordinary-client usefulness remains unaccepted.
**Supervise prepaid research with existing financial authority — 2026-10-06.**

Owner direction: resolve the current bottlenecks and develop Operator into an
autonomous business for Tameion. Use the existing prepaid research service as
the concrete revenue-to-delivery business. Route every mainnet paid A2A original
through its durable queue; a wait preference must not bypass the business guard.
Observe all running caps and unredeemed Monthly reserve together, retain pending
treasury exposure, and hold unknown/insufficient/stale capacity. Never infer
spender credit from seller revenue. Original signer caps, nonces, registry authority
and execution journals remain authoritative; no new custody, funding or schedule.

Persist a private exclusive audit before claiming work. Preserve recovery identity
before fallible outcome writes, and refresh observations without refreshing a false
working state after errors. Public web/CLI/MCP share identifier-free observations;
whole aggregates avoid REST-page truncation. Sealed PostgreSQL explicitly refuses
new aggregate reads until separate domain enrollment. See [business Operator](docs/operator-business.md)
for acceptance and surface boundaries.

The prior brief context design eagerly expanded every quote before both model
passes and could exhaust its unchanged 12,000-character cap with unused neighborhoods. Preserve
the same complete selected base passages in both passes; add only candidate-used
quote neighborhoods to the reviewer as a superset. This retains adverse material,
offsets, per-clause review and the cap while avoiding menu-driven overflow. Compact
review wire keys reduce repetition without reducing verdict granularity. Do not
retry invalid generation or activate production brief delivery from fixtures alone.
A protected worker-only format choice stages rollout behind live usefulness gates.
Real complete business proof, genuine creators, external adoption and a general
contract-enforced policy wallet remain open; never claim them from implementation.

## D-307 — Observed research-paper bibliography (2026-10-06)

The owner approved expanding Sources with actual paper records and better discovery.
Use a checked-in, strictly validated metadata catalog plus an explicit bounded
arXiv/Crossref lookup, separate from original-reading and creator/payment records.
Repository homepages and blogs do not substitute for individual research papers.
Preserve observed author names, DOI, exact arXiv versions and provenance; group only
observed identities while keeping original snapshots inspectable. Unknown peer
review remains explicit. Do not add metadata to citations or source payee allowlists.

Use process-local bounded RAM admission instead of the database-backed public
request limiter: browsing and metadata lookup need no durable database write.
Provider failures and incomplete ranked samples remain visible. OpenAlex/DOAJ are
external index links; their API integration retains its separate quota/provenance
acceptance gate. Web/API/human CLI share this bibliography contract; MCP, desktop,
extensions, bots and unattended jobs keep existing explicit research roles and
unchanged distribution bytes. See [paper library](docs/paper-library.md).

## Deliver sentence-cited summaries in place of excerpt-only answers - 2026-10-06

Owner decision: supersede D-300's unconditional extractive delivery. The last closed
ordinary-client round graded 0/3 useful and readers received only quoted excerpts,
while the reviewed decision brief stays disabled after three failed evaluations.

D-300 withheld prose because a source marker gave no assertion-to-evidence mapping.
Supply that mapping at the smallest unit instead of withholding all prose: one
model-written sentence per server-resolved quote, proposed in the existing synthesis
call and scored in the existing evidence review call. Deliver a sentence only when
its quote passed every ledger gate for the same target and marker and the review
scored the sentence itself at 0.7 or more; missing, duplicate or failed review is 0.
Render each sentence in the same paragraph as its verbatim source text. When no
sentence survives, delivery is byte-identical to the previous excerpt answer.

Unchanged: the evidence ledger, reward eligibility, payees, spend caps, custody,
receipts and exports; the eight-target limit and terminal planning refusal; the
2,000-character source context; the Low confidence cap; no added model call, retry
or fallback tier. D-300's rule against a lexical compatibility parser stands: the
check is a model review of one sentence against one quote, not string overlap.
The decision brief keeps its fail-closed contract and remains disabled.

Three local single runs (real model and search, forced offline payment, source
budget 0) delivered 4, 11 and 2 sentences; one accepted sentence carried a short
gloss its quote implies but does not state. That is an observation by the
developer, not a rate, independent grading or ordinary-client acceptance, and no
closed live allowance was reopened. Sentences stay close to their quotes, so
cross-source comparison and checklists remain gaps, and reading limits (an arXiv
PDF over the byte limit) bound the result more than synthesis does.
See [sentence-cited summaries](docs/engineering/cited-summary-2026-10-06.md).

## Read arXiv's HTML rendition when the PDF exceeds the byte limit - 2026-10-06

The owner delegated two follow-ups to the sentence-cited summary. Observed need:
the official PDF of arXiv 1706.03762v7 is 2,215,244 bytes, over the 2 MiB reader
limit, so that run had abstract-only evidence and three of five targets stayed
empty. The unchanged reader extracted 41,800 untruncated characters, including the
results and conclusion, from arXiv's HTML rendition of the same version.

On an `article-byte-limit` failure of an official versioned arXiv PDF, try
`https://arxiv.org/html/<id>` once before the abstract fallback, for provider
records and for the same PDF found by web search. Require the exact final URL and
HTML delivery; count the attempt against the existing read cap and deadline; cite
the HTML URL and state the substitution in the trace. Raising the PDF byte limit was
not chosen: the parser runs in a 64 MB, five-second contained worker, and larger
inputs need their own memory and timing evidence. Other PDF failures, page and
character limits and the abstract labelling are unchanged. The rendition is arXiv's
conversion and can omit or garble equations, tables and figures.

The Low confidence cap stays. Three developer-read local runs are not grounds to
raise a confidence claim; revisit it with an independently graded round.

**Retain paid failure obligations and preflight complete selection inputs — 2026-10-06.**

The owner-authorized single original settled its inbound charge but failed before
an answer was saved. Stock worker handling erased the underlying exception; the
exact retrospective cause cannot be claimed. A pure actual selection harness
demonstrated that legal discovery previews can exceed the unchanged 32,000-byte
canary message ceiling before its next provider hold. Partition complete authored
messages deterministically, preserving every candidate identity and full target
list, and validate all batches before any request. Do not raise token/call caps,
truncate evidence or treat a validation refusal as permission for a fallback tier.

Keep only typed, closed stage/category failure diagnostics in private outcome
audit/logs. Public errors remain generic and terminal originals never execute
through a direct worker call. No raw prompts, exception bodies or secret values
belong in diagnostics. This change cannot reconstruct evidence lost by the prior run.

A positively drained, exactly settled failed original can close its finite
execution lifecycle through a distinct metadata-only proof. Require journal v1,
started execution, no result/payment boundary, no saved run/creator attempts, and
an immutable commitment to every retained provider hold. Keep the failed order,
charge and unresolved paid-delivery obligation unchanged. Restoring public
observation/GET with selectors removed does not release new paid execution: the
retained failed marker continues admission and supplier holds until a separately
reviewed, properly authorized fulfillment/refund resolution. No blind replay,
automatic refund from another custody, fabricated success or new schedule occurs.

See [finite failure policy](docs/operator-canary.md#failed-delivery-and-retained-admission).

**Fulfill one paid failed original through a distinct retained claim — 2026-10-06.**

The owner authorized useful fulfillment of the same original within its retained
limits. A failed order has no saved answer or recoverable discovery/decomposition;
requeueing it would silently grant another research/payment attempt. Instead use
a separate protected, source/host-bound additive authorization over reviewed
reconstructed targets and genuine frozen whole official public documents. Keep
the original failed closure, charge and all old model/search holds immutable.
Current cited statements, deterministic source-span checks and separate model
statement review remain authoritative; decision briefs stay disabled.

SQLite grants one permanent UNIQUE claim by original, retaining the complete
failed snapshot. A finite private CLI can only run sufficiency, synthesis and
review, with three durable fixed model holds and the original supplier deadline;
no search, new inbound payment, creator/source spending, fallback, takeover or
retry is admitted. PostgreSQL fulfillment is explicitly unsupported. Execution
stages an immutable result for exact-digest human review. Native metadata
completion inserts the same-id result and completes only that exact failed
original in one transaction, with a distinct historical resolution. Only fresh
native proof and unchanged old/new ledgers can create a separate delivered
marker and resolve the admission hold. Useful delivery with visible evidence
gaps does not establish independent quality acceptance or new customer traction.

Enrolled startup never repairs its schema. A positively drained, source-bound
explicit migration verifies a no-replace flushed backup, manifest, identity,
historical rows and exact predecessor/current catalogs under the native exclusive
transaction; old runtime code cannot restart after upgrade. Public API/client
projections omit private recovery authority hashes. New usage counters cannot
erase the original provider bill's unknown status. See
[same-original fulfillment](docs/operator-original-fulfillment.md).

## Recorded guest research is a question count - 2026-10-06

The owner requested guest activity on the ledger and confirmed keeping the
existing "recorded accounts" label. Add an independent `guestQuestions` aggregate
from completed public `query_runs` with explicit `web` origin and no recorded
signed-in wallet (NULL/missing/empty `asker`). Unknown historical origins,
engine, MCP and A2A callers do not establish guest web activity. Non-empty legacy
wallet values are not reclassified as guests.

Guest questions are a subset of recorded questions, not additional accounts,
visits, active users or unique people. Use existing SQLite/Supabase metric rows;
no identity tracking, cookies, schema change or historical backfill is required.
Missing/invalid API aggregates stay unavailable, independently of account and
payment totals. See [release scope](docs/engineering/ledger-guest-questions-2026-10-06.md).

## Focus first outreach on literature-review writers and web3 analysts - 2026-10-06

On October 5 the owner named graduate students/PhD candidates and web3 research
analysts as the segments closest to their own network and committed that week's
outreach to them. This narrows who is asked first; it changes no price, payment
authority, package term or release gate. The September Arc-founder hypothesis is
neither validated nor withdrawn, and no segment has a recorded independent user.

Rationale: the owner has first-hand experience of the literature-review task and
direct contacts who perform it, and the shipped scholarly discovery, DOI/arXiv
resolution and BibTeX/RIS export already serve it. Two general open calls produced
no recorded participant, so direct asks on a participant's own question are
preferred. Choosing a single lead segment, and any remedy for first-time USDC
wallet funding, stay open. See [Tameion direction](docs/tameion-2026.md).

## Lead first outreach with literature-review writers - 2026-10-07

On October 6 the owner chose computer-science and blockchain graduate students and
PhD candidates with a literature review due in one to two months as the single lead
segment. Web3 research analysts are deferred, not withdrawn. This changes no price,
payment authority, package term or release gate, and no independent user is recorded.

Rationale: the owner has done this task for a published paper and can ask former
co-authors and labmates directly, which the earlier general calls could not reach.
First sessions use the existing treasury-paid free trial, so they need no participant
wallet and no new spending authority; they are sponsored use, not paid demand.
Pausing the card on-ramp, relabelling budgets as credits and prepaying participant
budgets stay open. See [Tameion direction](docs/tameion-2026.md).

## Freeze explicit supplier extensions in a distinct authority - 2026-10-07

The same-original recovery lane's historical v1 deadline expired before useful
delivery. Changing its literal would rewrite retained authority; changing only an
environment or private helper would disagree with native admission. Preserve v1
exactly and introduce a discriminated v2 carrying the actual permission-receipt
time and explicit expiry, with a positive interval bounded to 90 minutes. Build
and deployment time consume this interval. No clock default or automatic renewal
creates financial permission.

Copy the exact window into the hashed native authority and validate the recorded
claim time inside it. The existing permanent unique original claim prevents a
renewed window from replacing an unfinished execution. No database schema change
is needed. Fresh host, source, protected-file, ledger and deadline-abort checks
remain required for supplier calls. Historical verification and exact-digest
metadata completion after expiry remain valid without reopening admission.

The same three-call limit, fixed tariff, old holds, original settlement and frozen
public evidence stay bound. No new order/payment, search, reward, retry, provider
fallback or public recovery endpoint is added. Independent usefulness, actual
billing, ordinary-service restoration and Tameion acceptance remain separate gates.
See [procedure](docs/operator-original-fulfillment.md) and
[release scope](docs/engineering/operator-fulfillment-window-2026-10-07.md).

## Retain synthesis failure stages without implying absent document evidence - 2026-10-07

Completed reads and unavailable synthesis are different observations. Preserve
only an application-assigned input/generation/review stage; a thrown engine call
whose internal stage is unknown stays unknown. Empty output after such a failure
means assessment unavailable, not that the source lacks evidence. Valid no-fact
generation and negative review retain their original assessed-result semantics.

Expose fixed diagnostic wording and retained-read count through the existing
trace and final answer. Direct delivery review to the original job and receipts;
do not retry generation, buy again, infer a refund or relax evidence/reward gates.
See [scope and verification](docs/engineering/synthesis-failure-2026-10-07.md).

## Offer Circle's Arc Onramp as an optional card purchase into the owner wallet - 2026-10-06

The owner asked whether Circle supports card payment into Arc and directed that it
be built first, with eligibility questions settled afterwards. Circle's Onramp Kit
(`@circle-fin/onramp-kit` 1.0.3) sells USDC on Arc for a debit card, Apple Pay or
Google Pay through Transak, with identity verification inside Circle's hosted flow.

Keryx mints a session for the authenticated web-session wallet and opens Circle's
flow in a separate window. The destination is never taken from the request, the
widget is scoped to USDC on Arc, the launch URL is pinned to `https://onramp.arc.io`
on the server, and only modeled session fields reach the browser. Keryx holds no
purchase ledger: widget events are best-effort text, and the wallet's on-chain
balance is the evidence. Funding a Gateway balance or research budget stays the
existing separate owner-signed operation, so custody, session caps and payment
authority are unchanged.

A separate window was chosen over the embedded iframe. The iframe needs new
`frame-src`/`connect-src` origins, a `referrerDomain` allowlist entry, and camera
access for identity checks that the site-wide `Permissions-Policy` denies; the
kit also documents iOS Safari storage problems inside frames. The window needs
none of these and keeps card and identity entry visibly on Circle's origin. The
cost is a two-click flow, because the window must open synchronously in a click.

Activation is explicit and mainnet-only with a production key, because that key
buys with real money. Sandbox use is not wired: its endpoints and test-network
delivery were not verified here. The existing Circle developer key is reused
unless a dedicated `ARC_ONRAMP_API_KEY` is set. One production session was minted
successfully with the owner's key on 2026-10-06 (no session id is returned, so it
is optional). No purchase was made. Whether an individual can complete Circle's
business verification, which countries are served, and provider fees and limits
are unverified and remain gates. See [Arc card onramp](docs/arc-card-onramp.md).

## Browser-local literature screening and deliberate research handoff - 2026-10-07

The owner requested deeper practical utility, traction-oriented product work and
UI/UX while another session owns Operator. The owner-confirmed outreach segments
include literature-review researchers. The paper library already offers bounded
metadata discovery; a personal shortlist connects that entry point to screening,
revisiting and exporting an actual review without initiating model or payment work.
This is a usefulness hypothesis, not observed demand.

Keep one bounded local review with exact landing-URL snapshots, user-authored
decisions/notes, explicit saves, formula-safe screening CSV and a strict portable
backup. Retain different repository versions and the first saved observation;
mutable grouping IDs never overwrite a saved paper. Metadata and personal notes
gain no read, citation or payout authority. All cooperating tab mutations share an
exclusive Web Lock; unsupported browsers refuse writes. Preserve dirty editors
through filtering and external changes and refuse stale same-field updates.

Only the saved review question and two chosen links enter a deliberate editable
Deep draft. Preserve the full existing 2,000-character form limit for nonautomatic
prefill, while legacy automatic links keep their existing 500-character bound.
No automatic research, private-note upload, cloud list, new database/schema,
spending, custody or scheduler follows. Other surfaces keep their documented roles.
Keep the chosen pair visible independently of the screening filter, label hidden
selections and expose the exact prepared question/saved focus before navigation.
Titles, versions and screening labels help local inspection; they do not add fields
to the draft or acquire evidence authority. Individual removal changes selection
only and starts no research or persistence mutation.
Independent task usefulness, return use and the serialized Operator release gate
remain open. See [behavior and acceptance](docs/literature-workspace.md).

The saved shortlist also needs a usable reference-manager handoff. Export RIS from
the explicitly shown filter, with its count visible, using only validated saved
PaperRecords. Keep this adapter separate from cited-reference serialization: these
records have no read scope or Citation authority. Preserve exact versions, observed
publication kinds and metadata/author limitations; omit review focus, screening and
personal notes. No PDF attachment or enrichment is requested. Pinned Zotero parser
checks establish only their specified synthetic import behavior, not application or
independent participant acceptance. The paid citation formatter owned by PR204 is
unchanged by this browser-local adapter.

An October 7 bounded read of the saved SuRe OpenReview landing URL redirected to
`openreview.net/challenge` and extracted 146 characters of verification instructions,
not paper text. The saved PDF also failed transport in that observation. Reject this
exact publisher route before parsing with a fixed `publisher-verification-required`
category and deterministic English/Vietnamese recovery. Keep successful originals
readable even if their prose discusses verification. Do not turn the access page
into evidence or silently replace a landing identity with an imported PDF link;
the bibliography does not attest that relationship. Existing public DNS/byte/time
limits, one-source failure containment and research response structures stay intact.
This closes the observed false-read path, not every publisher interstitial or the
remaining full-paper comparison/usefulness gates.

## 2026-10-07: Observe admission separately from connectivity

MCP discovery and service health can succeed while new research is held by an
unresolved original delivery. Public availability reads the existing fail-closed
hold without granting permission, initializing storage or consuming quota.
Keep request authority checks in their current paths. Use a typed local refusal
for safe public categories and terminal reasoning behavior, while retaining the
private diagnostic for operations. A manual availability refresh never retries a
question; the composer keeps the original draft and failure context. Hosted MCP
advances its own version for this additive status/error contract. See
[scope and release gates](docs/engineering/research-availability-2026-10-07.md).

**Isolate an expired failed Operator claim from interactive research - 2026-10-07.**
A permanent unprepared same-original claim with fewer than three additive model holds and expired supplier authority cannot recover through a generative retry. Keep its paid obligation unresolved, original settlement and both provider ledgers immutable, and Operator/new paid/private admission held. After fresh native verification and explicit private metadata acceptance, allow unrelated public interactive runs/search/model transports under their existing compute, quota, session and payment authority. This reduces the failed trial's impact without claiming delivery, refund, new funding or supplier permission. Pending/changed evidence fails closed; positive writer drain and actual accepted metadata/role restoration receipts are required. See docs/engineering/failed-canary-research-isolation.md for surfaces and gates.

## Bound backup capture without discarding unverified recovery history - 2026-10-06

The source audit found that count-only retention could allow 48 gzip plus 48 encrypted
copies and create a full snapshot before pruning, exhausting usable VPS space.
The reviewed mainnet scheduler already identity-routes storage and disables R2/alerts;
retain that authority, custody and cadence. Before snapshot output, admit bounded
conservative staging while protecting 2 GiB usable space and a shared 512 MiB budget over
all regular retained/staging bytes. Existing count limits are additional admission fences.

Reuse the readonly identity/fence/snapshot primitive for enrolled stores, including
its 64 MiB ceiling, and require explicit isolated offline/testnet selection for the
legacy 256 MiB path. Never omit a manifest to treat a marked store as legacy. Preserve
prior/unknown/financial artifacts. PUT acknowledgement is not independently verified
offhost durability, so this release grants no automatic local or remote pruning.
R2 holds at 24 recognized objects without PUT/DELETE; a historical 25th object
remains untouched and request/day accounting stays consumed. Capacity,
retention or an interrupted original holds new capture. Private status preserves the
genuine successful capture time without claiming public monitoring or restore/signing
authority. Exclusive durable publication and retained uncertainty are preferable to
silently discarding recovery history to sustain a cadence. Receipt-based cleanup,
deployment and offhost drills remain gates. See [backup limits](docs/encrypted-backups.md).

## Additive continuation for the same retained paid original - 2026-10-07

The retained one-shot execution lost its exception and has no prepared result. Do not reinterpret its reservations as successful requests or change the old claim/window. A new explicit owner instruction permits repair and same-original completion under a distinct finite source/host/old-evidence-bound supplier grant. Preserve every expired hold and the permanent native claim; reserve each new dispatch before transport, checkpoint only complete validated normalized JSON, and serialize attempts with durable uncertainty retained on crash/fsync failure. Exact successful stages may be reused only under identical grant/source/packet/prompt bounds. Generation uses the already-authorized8192 output ceiling while ordinary research remains unchanged. Complete the same claim through exact prepared-result metadata only after all five targets have reviewed support and gaps remain explicit. New payments, searches, creator rewards, funding and general schedules are outside this lane. The separate ledger catalogue detects deletion or replacement instead of silently resetting consumed allowance. See docs/engineering/operator-original-continuation.md.

A Windows redeploy previously lost reviewed environment controls entering WSL and selected the legacy path. The Node launcher now forwards and verifies all nonsecret reviewed-role and optional economic-migration controls before mutation, preserving explicit native paths. This is transport validation, not authority to drain, migrate, deploy unreviewed code or call suppliers.

## Complete source context and additive supplier episodes — 2026-10-08

Observed new continuation attempts reused an acknowledged assessment with mandatory target coverage0.1, while final evidence coverage is capped by that assessment. Later generation/review could never pass the existing0.4 threshold. The ordinary context sampler also omitted relevant lines from the already selected frozen documents. Give this private original-completion engine both complete selected bodies consistently through sufficiency, quote options, generation and review; refuse oversized full prompts before dispatch. Retain an actual negative mandatory assessment and stop before generation/review, then block unchanged-context retries. Preserve ordinary research context selection and all evidence/support thresholds.

The owner explicitly requested repair to same-original completion without routine confirmation. Stage any additional supplier episode under a fresh reviewed source and immutable parent-ledger binding rather than extending, deleting or reusing the exhausted grant. The next fixed episode has six fresh holds,243260 microUSD history and400000 microUSD aggregate ceiling (367220 at full use); those conservative staged numbers are agent-chosen within that repair instruction, not an owner quotation or supplier invoice. External activation intent precedes the new journal, and a separately retained latest-head frontier prevents restoring an old journal snapshot from resetting its allowance. Uncertain publication blocks both new dispatch and parent fallback. Native same-claim completion remains exact-digest metadata after private reviewed answer acceptance, with no new payment, funding, search or schedule. Applicable web/API/MCP/client adapters continue to use the existing shared closure and original buyer GET contract; no new client package or native schema is introduced.

## Explicit output stops without invented provider outages - 2026-10-08

A completed length/max_tokens response can be billable and still fail the output
contract. Preserve usage and the observed requested ceiling, but stop assigning
synthetic provider503 status. Equal counters or historical status cannot prove the
stop reason. Ordinary caps, fallback/circuit and financial authority remain intact.

An inner evidence-review failure must not relabel successful generation or invent
a serving attempt. Retain only a closed stage and positive integer ceiling in the
existing persisted synthesis trace; use it for direct bounded engines too. The
shared public projection validates, bounds and deduplicates those diagnostics;
early terminal callers receive a safe ceiling sentence through their current
error adapters. Private/native reduced projections retain their existing roles.
See [scope and acceptance gates](docs/engineering/model-output-limits.md).

## Free bibliography before research - 2026-10-08

A bibliographic question should have a direct metadata path that requires no model,
original read, buyer custody or creator payment. Reuse the bounded paper library
rather than send a metadata-only request through paid research. Ask carries one
explicit DOI/versioned arXiv identity to a local library link; it never copies the
whole question or auto-submits. Remote and stdio MCP share paper_lookup with a
catalog-only default and explicit repository-search opt-in. Hosted MCP and HTTP
share the same RAM admission and normalized caller identity; a single public
metadata call does not verify research credentials or open the database.

Preserve the closed bibliography v1 and saved-workspace contracts. The new tool
validates exact selected identity, version despite a matching DOI, retained snapshot
membership, observed-alias grouping, total snapshot bounds and exact provenance
links. It keeps legitimate alternate versions and their observation times.
Incomplete names cannot establish first-slot authorship; missing DOI and page
status remain unknown. Metadata grants no evidence, payout or reward authority.
Reduced private/native and thin integration roles remain explicit. See
[scope and release gates](docs/engineering/free-paper-lookup.md).

## Supplemental primary evidence for the same retained Operator original — 2026-10-08

The full original source bodies still produced an acknowledged negative assessment for Arc-profile and acceptance checks. Retrying unchanged context cannot repair a documented evidence gap. Add a separately protected manifest of bounded free official verbatim sections, retaining raw body hashes, exact offsets, retrieval times and requested/final URLs. Keep original S1/S2, question, targets, payer, native claim and settled inbound untouched. Distinct S3+ public references have zero spending and reward authority; selected sections remain visibly bounded, and no official documentation proves that a live acceptance check has run.

Epoch3 transfers only the five unused holds from the six-call repair scope:263920microUSD historical reservation, maximum5 additional calls and367220 at full use within the existing400000 outer ceiling. Keep the same received owner instruction and expiry; bind epoch2 authorization, external active/frontier, full journal and acknowledged negative checkpoint/diagnostic/closed attempt. A missing, pending or rolled-back third epoch refuses earlier fallback. New context gets a fresh sufficiency assessment with the same complete source union throughout generation, quote binding and independent review; prior checkpoints are not reused across contexts.

Native result-v2 keeps the original authority/input hashes and existing completion CAS. A protected reader mints an opaque runtime evidence capability bound to that exact claim, run and supplemental context. SQLite completion, transactional readback, idempotency and historical readonly proof all revalidate the full source identities, verbatim quotes and provenance. No JSON/user API can grant this capability. Historical evidence validation survives supplier expiry but grants no dispatch permission. Legacy result-v1 remains bounded to the original sources; Supabase remains unsupported. All five original targets still require coverage>=0.4, every delivered statement independent review>=0.7, canonical rendering and explicit gaps. No new migration, client package, funding, purchase, creator payment or scheduler follows. Actual reviewed same-original delivery and buyer GET/receipt verification remain release gates.

Protected supplemental tables require exact header-bearing contiguous quotes, not rewritten vendor prose. A separate opaque span capability enrolls only verbatim units inside one recorded raw section. Generation, independent review and the evidence ledger share that runtime authority; ordinary sentence-only checks have no new JSON override. Adjacent context may expose limitations but never substitutes for a quoted fact. Shared span helpers remain filesystem-free. Constructor or predispatch evidence failures close the known attempt before any model reservation.

## Source-scoped recency eligibility - proposed, 2026-10-08

Issue #217 and a frozen synthetic counterexample show that one-article topical
ranking can buy an older release despite an explicit newest-entry request. Apply
immutable original source/version/temporal eligibility before ranking, with a
validated structured per-call contract preferred over a general latest regex or
model-generated targets. Stage a visible refusal of unresolved current-newest
paid selection before adding explicit retained-set ordering and coherent bounded
feed observations. Paid catalog accumulation has no collection cohort; publication
dates and public-reference refreshedAt alone cannot prove current newest. Preserve
wanted-response item/version/offer binding, registry payout authority, every
execution/payment bound and original recovery. Independent architecture review
supports this direction; runtime, intent recognition, freshness/completeness,
storage/adapters and useful-answer gates remain open. See
[the staged proposal](docs/engineering/source-recency-2026-10-08.md).

## Explicit Ubuntu browser CI dependency bootstrap - 2026-10-08

A required Ubuntu browser job exceeded its existing 15-minute limit while APT
repeatedly ignored the first Azure HTTP mirror; no test assertions had run.
Keep browser checks and deadlines intact. Pin both affected Linux jobs to Ubuntu
24.04 and prepare their existing official HTTPS archive/security mirrors with
bounded APT transport timeouts/retries and a stricter five-minute install-step
limit; per-acquisition timeouts alone do not bound the whole installation.
A shared Node builtin helper guards the
GitHub-hosted runner, OS and expected configuration before any privileged write.
It preserves source/keyring/TLS trust and reads back the two fixed files. Windows
coverage remains. Local adverse tests and actual full runner CI are required;
the successful same-head rerun is separate evidence, not proof of the original
network cause. This CI-only change has no production/runtime/distribution version
change. See [runner setup and boundaries](docs/deployment-guide.md#browser-dependencies-on-github-hosted-runners).

## Withhold unqualified newest-feed articles before ranking - 2026-10-08

Stage1 freezes a narrow positive original-text requirement before model targets
exist. Known unsupported temporal/multiple-feed forms remain explicit gaps;
unresolved bounded binding refuses retained catalog candidates conservatively.
Exact RSS/registered resource identity scopes refusal without granting feed or
payment authority. Hold paid/free/cache/legacy candidates before item ranking and
omit them from every purchase/reevaluation asset map. Preserve the validated raw
web follow-up child separately from parent context; public overrides cannot set
this trusted copy. An unmatched request still receives a visible gap.

This staged repair favors an honest unresolved task over buying an older topical
article for the recognized newest-feed request. It neither orders a retained set
nor proves a coherent current-feed observation, and it preserves unrelated targets,
exact wanted-response binding, incoming service charges and all existing payment
limits/history. Shared TypeScript callers inherit the diagnostic; unchanged thin
client contracts and reduced Operator/Rust roles do not establish pre-admission
qualification. Build/CI/deployment and useful delivery remain separate gates. See
[coverage and acceptance](docs/engineering/source-recency-2026-10-08.md#stage1-safety-candidate).

## Native section headings in shared report rendering — 2026-10-08

Styled paragraphs concealed the answer's section structure from assistive heading
navigation. Render recognized headings as native h2–h4 elements, normalizing the
shallowest depth to h2 and retaining relative depth. A conversation can contain
several reports, so report text does not acquire a new page-level h1. Keep the
small renderer's existing block grammar, styling, safe text and citation callbacks;
do not rewrite saved answers or exported Markdown. This shared visual change has
no protocol or native-local rendering migration. Exact browser and release gates
remain explicit in [reading UX](docs/research-reading-ux.md#answer-heading-navigation--october-8-2026).

## Share paid-question validation before stdio funding — 2026-10-08

The stdio buyer's 8192-character allowance exceeded the paid API's 2000-character
canonical limit. A configured synthetic caller reached the funding boundary with
a server-invalid question. Reuse the server parser before loading custody or
funding and publish the maximum in the tool schema. Keep the earlier journal/lock
recovery barriers, existing client minimum/raw transport bound and exact original
recovery. Hosted direct research keeps its separate existing limit. No merchant,
funding, settlement, quote or saved-request authority changes. See
[scope and acceptance](docs/engineering/mcp-question-preflight.md).

## Confirm anonymous report feedback — 2026-10-08

The old client left a locally increased vote count after failed POST responses.
Use only validated observed totals and select a rating after confirmation. The
append-only API can persist before aggregate readback fails, so an error is an
unknown outcome: retain its uncertainty and prevent another mounted-report
attempt. Do not present a response failure as an unsaved vote or safe retry.
Scope state to the report, cancel obsolete GET observation, and keep submitted
POSTs independent of unmounting. Bound headers and body observation to 15 seconds;
ending local waiting cannot undo persistence, so retain the one-attempt guard.
Explicitly check resolved Supabase feedback errors before confirmation or aggregate
publication; preserve the append-only protocol and existing enrolled authority.
In the metrics response, omit unavailable optional feedback fields while retaining
successful core metric reads; neither substitute zero nor discard the whole response.
This improves the shared reading UI without inventing identity,
server-side deduplication or independent-user traction. See
[scope and acceptance](docs/engineering/report-feedback-confirmation.md).

## Observe HTML structure for bounded evidence retrieval — 2026-10-08

The saved RFC and NASA reproductions expose two structural losses: physical pre
wraps discard conditions, while duplicate TOC/heading labels omit substantive
following text. Record actual pre and h1–h6 ranges during inert extraction, bound
them to the exact returned body and enroll frozen metadata only at the validated
worker boundary. Use shared logical groups for selection, strict quote spans and
review context. Keep historical JSON/layoutless behavior and PDF policy unchanged.
Named quoted headings are retrieval cues; preserve both bytes and a slot for lexical
targets, sample duplicate matches and label optional role limits without discarding
a readable source. Preserve the 2,000-character context and all support/payment
authority. Source replay proves retrieval behavior only; useful live answers and
coordinated production delivery remain gates. See
[scope and acceptance](docs/engineering/html-evidence-context-2026-10-08.md).

## Required evidence selection and finite failed-quality recovery - 2026-10-08

The retained original's generation omitted documented requirements despite an
explicit row-count instruction; the paid review could only score the rows it
received. Select an exact admitted quote for each required meaning before
generation and reject missing, duplicated, changed or semantically incomplete
rows before spending on direct review. Preserve independent review, exact source
provenance and final completeness gates. A related statement cannot substitute for
an omitted required fact. Ordinary research keeps its existing behavior.

The existing owner instruction explicitly authorizes repair to completion without
routine reconfirmation. Stage further supplier work through a distinct V5 grant
and private receipt, never by resetting the exhausted V4 journal. The receipt's
timestamp is its genuine recording time, not an inferred chat time. Agent-chosen
limits are six new holds at 20660 micro-USD each, 367220 historical reservations,
491180 aggregate and at most 24 hours. Preserve every prior receipt/window and
the same paid claim. This changes neither custody nor buyer/source payments.

Bind the complete failed parent ledger/frontier, two acknowledged checkpoints and
outcomes, closed attempt, quality diagnostic and exact positive carried assessment.
Unknown locks, partial publication, rollback or a changed source/context refuse
new work and prior fallback. Operational executor/guardian lifetime closure is
separately required. Source release, deployment and successful transport remain
separate from actual reviewed native delivery and original buyer receipt recovery.
See [the private recovery contract](docs/engineering/operator-original-continuation.md).

## Preserve stored excerpt layout during inspection - 2026-10-08

Actual components with built CSS exposed collapsed line breaks, unbroken-string
horizontal overflow and a 16-pixel Evidence target. Preserve recorded whitespace
and wrap long strings across all six web excerpt views; use a contextual 44-pixel
citation inspection action. Keep original quote bytes, eligibility and payment
status unchanged. Browser geometry and text fidelity are acceptance evidence,
not factual or independent-usefulness validation. See
[scope and surface roles](docs/engineering/evidence-readability-2026-10-08.md).

## Preserve feature ancestry in the coordinated reading release - 2026-10-08

Main advanced to app0.27.35 while eight reviewed reading/client candidates retained
older checkpoints. Integrate their complete source with current main and release
one app0.27.36 through a merge commit, preserving every feature tip and avoiding
version downgrade. This supersedes active parent-first sequencing, with explicit
per-PR inclusion/closure records and final-head CI/review for the complete source.
Historical candidate and failure evidence remains unchanged. Operational admission,
public recovery, package/installer delivery, original financial delivery and fee
activation retain their distinct authority and acceptance gates. See
[the coordinated release](docs/engineering/research-reading-release-2026-10-08.md).

## Keep the mobile research action reachable - 2026-10-08

The built 320x640 composer failed the existing first-viewport gate on CI and
locally. Compact the introductory copy and mobile spacing, with enough header
height to contain its decorative globe. Preserve the question field, 44px targets,
free metadata handoff, source cap, payer disclosures and desktop spacing. Require
the fresh default build and existing responsive/wrapped-cap acceptance. Keep the
original failing screenshots and logs; earlier quote-view or unit acceptance does
not qualify this changed geometry. See
[the mobile regression](docs/engineering/evidence-readability-2026-10-08.md#mobile-composer).

## Distinguish trace diagnostics from source decisions - 2026-10-08

A decide phase can carry a bounded selection diagnostic as well as a source
Decision. Validate the display shape in the hook and renderer, preserve refused
and partial explanations/counts, and keep diagnostics out of streamed and final
decision arrays. Preserve existing validator SKIP and empty-rationale records.
This classification provides no payment authority and leaves SSE signing/abort
paths unchanged. See [acceptance](docs/engineering/selection-diagnostic-trace.md).

## Generate ordinary checked evidence without a redundant draft - 2026-10-08

The two-read Quick path requests a draft answer plus the same quote-bound sentences,
although ordinary delivery discards that draft. Explicitly select an internal
evidence-only generation packet in ordinary orchestration, retain the same output
ceiling and review calls, and form only a server marker envelope after exact quote
resolution and review. Existing ledger, requested-source, statement and reward
gates remain authoritative. A compact fixture does not prove a provider will finish
or that a live run produces a complete useful answer.

Direct inputs for retained private originals keep their legacy schema/guidance;
decision briefs keep their distinct disabled acceptance boundary. Prospective
teaching proposals are planning constraints, while claims that NASA actually
tested an activity remain factual targets. This adds no reviewed proposal delivery
or experimental claim. See [behavior and residual gates](docs/engineering/evidence-only-synthesis-2026-10-08.md).

## Group document channels without merging payment authority - 2026-10-08

The registered/public alias reproduction consumed both Quick attention slots and
paid a second channel that supplied no final evidence. Treat conservative canonical
locations as alternatives for attention and predicted coverage, retaining each
channel's targets, expected value, item/version, price and source identity. Prefer
public delivery only on an equivalent useful route; do not transfer registered
relevance or reward rights to a URL. Refuse already gathered locations in initial,
redirect and Deep reads. The grouping cannot prove identical bytes, revisions,
ownership or independent corroboration. See [scope and gates](docs/issue-232-document-aliases.md).

## Preserve the active original while preparing issue repairs - 2026-10-08

The owner confirmed the separate Operator session still runs and explicitly asked
to preserve production. The initial admitted source was ab2195d6; the separate
Operator owner subsequently merged PR240/main3b839ccd. This issue session does
not advance main or deploy over that owner's source window. Prepare source,
synthetic verification and PR/CI independently;
defer main advance, deployment, supplier work and financial rebinding until a
positively closed or parked admitted boundary. The new aggregate preserves the
entire pending reading stack and records every issue's actual remaining gate in
[the resolution inventory](docs/engineering/open-issues-2026-10-08.md).

## Deliver bibliography through metadata roles with explicit field limits - 2026-10-08

Exact DOI/arXiv metadata tasks currently fail when ordinary research requires a
publisher-body excerpt. Improve the existing free lookup into a field-scoped
card with exact provider identity, recorded observation, known field paths,
complete-list author-order claims and escaped reusable references. Withhold
truncated values, absent publication dates and unknown page-specific status.
Optional language labels are local formatting; they grant no provider, research,
payment or custody authority. Preserve HTTP JSON v1 and the separate ordinary
evidence boundary. Actual metadata research routing and live usefulness remain
open in [the metadata handoff record](docs/issue-218-metadata.md).
## Direct premise review and unused-reservation source repair - 2026-10-08

The acknowledged original-answer pair selected all required quotes but added a
mainnet qualification to a network table that did not contain it. Another correct
documented example received partial evidence support against the broader target.
Give each fixed required quote a server-owned factual question while retaining
the original target assignment. Independent statement review must still reject
any unsupported assertion; all numerical thresholds and final completeness/manual
review gates remain intact. Canonical acceptance checks remain labeled unexecuted
inferences, and missing deployment values remain gaps. Preserve actual failed
model outputs and scores rather than rewriting or carrying them.

Transfer the four unused holds to a source-bound V6 episode, preserving 408540
micro-USD history, the original 491180 ceiling and exact owner receipt/expiry.
Bind the complete acknowledged failed V5 ledger/frontier and genuine operational
closure. Unknown/pending epochs, changed context, rollback and superseded suppliers
refuse. Old writers must actually close before deployment and activation; newer
anchor handling cannot make an old binary safe by assertion. No new buyer charge,
creator payment, custody, public activation or scheduler authority is introduced.
Actual same-original delivery and buyer recovery remain separate release gates.

## Proportionate CI and coherent release batches - 2026-10-08

The owner requested reducing long PR/CI/merge waits. Keep one focused PR for a
coherent outcome and its review corrections, with risk-proportionate local checks
and reuse of unchanged valid evidence. Preserve required acceptance and standing
routine merge authorization. Split main CI into isolated parallel lanes, shard
the complete Vitest suite three ways, and retain every prior assertion. An
always-running stable aggregate refuses failed, cancelled, missing or unintended
skipped lanes, with a final whole-workflow-cancellation failure step. Require
actual aggregate success, never a skipped/cancelled status. Main validation cancels
per lane/shard, leaving the aggregate ungrouped so an obsolete `always()` gate
cannot hold a workflow concurrency lock ahead of the newer PR. Other PR workflows
retain same-PR workflow cancellation. A newer docs-only candidate may leave old
skipped runtime-lane work finishing; it supplies no acceptance for the new source.
Informational lint remains visible outside merge acceptance.

Only regular prose-only document PR changes use the lighter lane, with scope/gate
regressions and feed integrity; unknown/mixed/runtime changes retain full coverage.
Do not infer UI or shared-library isolation from broad path filters. Cancel only
superseded same-PR workflow validation, preserving main, scheduled/manual runs
and exact-source publication/provenance. Every main push retains full runtime
acceptance so the existing package publishers cannot use a light PR pass as
publication authority. CI/docs-only maintenance does not change
runtime/distribution identity or require production deployment. Runtime releases
retain coordinated surface acceptance, reviewed deployment, health/provenance
readback and authorized product publication. Actual runner acceptance and measured
critical-path timing remain the evidence for improvement. See
[the development workflow](docs/development-workflow.md).

## Preserve original permalinks through a separate historical reader — 2026-10-08

The owner requires old testnet dispatch URLs and question history to remain usable
after mainnet migration. Mainnet's fresh sealed storage stays authoritative for
current execution, payments, sessions, registries and recovery. Do not import old
financial rows or decorate the global database selector. Resolve current public
records first, then an explicitly pinned native read-only original-testnet snapshot.
Keep receipts with their matching original payment rows, original settlement states
and frozen source provenance; label the historical network on every display surface.

Provide complete paginated historical questions, separately labeled cited archives
and separate authenticated wallet history/totals. Preserve current answers when an
optional historical index/thread lookup is unavailable. New follow-ups can use only
the bounded old parent question, under current admission and funding; no cross-network
monetary delta or historical feedback write follows. Receipt v1 remains byte-compatible:
archive provenance is in headers/page/API, not extra digest-envelope fields. Zero-payment
downloads need accompanying provenance; historical prepaid funding and private job
recovery are not reconstructed from current authority. See
[the restoration contract](docs/historical-testnet-archive.md).

## Keep original metadata and proposed teaching roles separate — 2026-10-08

Exact bibliography requests need displayed original fields rather than a paid
scientific research plan. The public ordinary agent now reads the exact versioned
arXiv/Crossref original once with pinned transport and no model or creator payment.
Records, localized field gaps and reusable references have a distinct optional
role in saved results and receipt hashes. Page/version observations do not imply
full-paper reading, peer review, scientific coverage or settlement. Protected
private originals, paid packages and wanted-asset execution retain their contracts.

Current-feed newest selection requires complete native membership and explicit
publication dates, followed by a unique exact catalog join. Feed title/date/hash
cannot confer body, price, payee or creator reward authority. Native probes consume
existing attention slots before selection, including failures; an unindexed winner
is exposed as a gap rather than replaced by an older topical match. Only explicit
single-feed current-publication requests are supported in this stage.

Hypothetical lesson activities and examples use the existing generation/review
calls and final factual dependency gate. Keep their exact admitted factual basis
inside their optional delivery bundle for portable coverage, identity, request and
word-count checks. Append proposals after attribution/settlement. Their labels and
text never create facts, citation coverage or reward allocation. The teaching and
Cloudflare experiments remain disabled until their direct usefulness gates pass.
Portable JSON and a receipt digest record data; they do not restore runtime-issued
review/observation capabilities or independently attest provider/network truth.

The owner confirmed a live Product Hunt launch and supplied the official badge.
Place it below the homepage Ask action with fixed250x54 sizing, accessible focus,
separate-tab navigation and no referrer. Keep the question and full primary action
within the compact mobile first viewport. Record surfaced and distributed roles
with the coordinated app0.27.43 release; publication and deploy are separate gates.

## Prepare independent planned-maintenance admission without changing deployed authority - 2026-10-08

A maintenance route in the application cannot explain a planned outage while that
process is stopped. Prepare an independent loopback front door with a bounded,
advance-announced protected marker, static browser notice and API/MCP 503 status.
Malformed or expired controls keep new admission closed; unknown upstream outcomes
retain their original payment recovery and never trigger a retry. Accepted streams
drain unchanged. A narrowly source-pinned retained signature callback is optional
and disabled in the manual launcher. Existing stock/guardian, custody and release
roles remain unchanged. This source and synthetic non-production candidate supplies
no production admission, installation or schedule. Final ingress/build/role binding,
native CI, app/client notice and coordinated hosted acceptance remain explicit gates
in [the issue281 runbook](docs/engineering/planned-maintenance-2026-10-08.md).

## Bind paid text to the selected plaintext commitment — 2026-10-09

Matching an echoed article ID and price does not bind its returned body. The
source/payment adversarial suite reproduced empty and substituted text passing
buyer admission. Capture explicit article and manifest plaintext hash/byte
commitments before I/O; reject malformed or conflicting contracts before signing,
and check the exact delivered UTF-8 bytes in both server and browser co-sign
gateways. The response cannot choose replacement commitments. Empty/non-text
delivery remains unusable even when a legacy row has no body commitment.

An integrity failure after submission retains the same payment authorization,
amount, payee and pending/settled state. Record its refusal rule and use existing
source-level failure handling; no refund, reservation release, retry, cache entry,
evidence or creator reward follows from failed delivery. Shared gateways apply
this rule to their web/API, CLI and MCP consumers without changing signing or
receipt schemas. Protected originals and private Operator authority stay bound
to their existing contracts.

Do not mistake a receipt byte count inferred from legacy ciphertext or a summary
for an explicit plaintext commitment. Those legacy rows retain identity/pricing
checks without gaining body integrity. Hash consistency does not independently
authenticate a publisher or establish general prompt-injection/semantic farming
resistance. The public [adversarial catalog](docs/engineering/source-money-adversarial-2026-10-09.md)
records checked boundaries and the still-open live testnet refusal gate.

## 2026-10-09 — CSL reference files derive from recorded metadata

Issue285's file-export outcome uses a shared CSL-JSON formatter over exact recorded
article/version identities and separately validated saved-paper records. Preserve
observed calendar precision and supplied structured names; omit missing fields,
retain literal names and provenance/read limits, and never infer peer review.
Stable reference keys support reordered or filtered files without granting source,
rights or payment authority. Saved-workspace questions, notes and screening
decisions stay outside reference downloads.

Keep new derived exports outside the original stored bibliography object and
receipt projection. Legacy bibliography text and BibTeX/RIS snapshots, saved
private receipt bytes and native inspection semantics remain unchanged. Hosted
surfaces share the formatter; CLI and desktop exports require their existing
integrity-checked original task binding and exclusive private file publication.
The [surface and acceptance record](docs/engineering/csl-json-reference-export-2026-10-09.md)
keeps account-linked Zotero synchronization and private revocable `.bib` URLs open.

## Keep owner profiles private behind an additive ordinary-storage capability — 2026-10-09

Issue260 adds owner-edited display fields without changing wallet authentication,
source/creator ownership or payout authority. SIWE and explicit profile-scoped API
keys select the owner; no body/URL wallet selector or public profile exists.
Cookie writes additionally compare the editor's required expected-wallet header
against independently authenticated SIWE authority before profile access; this
precondition cannot select an owner. Changed owners refuse rather than applying
a stale editor's fields to another wallet. The bound web editor also compares
GET, withholding the new owner's activity even when that owner has no profile.
Other GET clients may omit this comparison. Scoped key writes retain their verified
actor and may use the same comparison without gaining rights.
Historical/default API-key rights remain ask/export. Profile write does not imply
read, and the developer portal never preselects new private permissions.

The separate non-enumerable `privateProfiles` port is installed only on ordinary
adapters. Its SQLite table and service-role-only Supabase RPC source migration do
not change sealed schemas, exhaustive method inventories or provenance digests.
Unsupported enrolled/native storage refuses before profile guard/DB/REST I/O,
with no fallback. Production profile CRUD remains an explicit migration/enrollment
and deployed-acceptance gate; source preparation does not close issue260.

Case-folded handles use atomic uniqueness and reserved names. Text is bounded
plain data; allowlisted HTTPS links are assertions, never verified identity or
server-fetch authority. Deletion removes private fields only. Activity derives
from the whole attributed current store; recorded creator payee counts do not
establish that the profile owner funded those runs. Public receipts and immutable
research/payment originals retain their existing contracts. See
[implementation and acceptance boundaries](docs/engineering/private-profiles-2026-10-09.md).

## Evaluate local-currency estimates separately from EURC conversion — 2026-10-09

Issue294's written evaluation keeps the current USDC reward, source-owned payee,
Gateway, consent, nonce and receipt authority intact. Documentary Arc Swap support
for USDC/EURC does not make EURC a Gateway balance or authorize Keryx to convert a
creator's funds. Stage optional labeled estimates first; a future creator conversion
would follow receipt/withdrawal of their USDC reward, while buyer conversion precedes
the existing USDC deposit and separately signed research budget. Neither expands
an existing spending ceiling. Merchant conversion, pooled rewards and automatic FX
remain deferred; no transaction writer or custody change is implemented.

The [evaluation](docs/currency-support-evaluation.md) records current vendor sources,
exact-unit and recovery constraints, all supported surface roles and release gates.
Participant currency demand, rate-provider/fee policies, tiny-amount feasibility,
browser-compatible custody and bounded testnet proof remain unaccepted. This records
the evaluation boundary, not an accepted economic policy or enabled EURC product.

## Grade retained deliverable structure separately from semantic acceptance — 2026-10-09

Issue #287 needs one inspectable rubric rather than interpreting each successful
request or coverage score as a useful answer. Start with a bounded local corpus
projected from two already retained public MDN/RFC reports. Hash the original
capture provenance, exact projection, reviewed contract and grader inputs. Count
requested bullet structure and full-answer whitespace tokens deterministically;
compare the recorded source/item/version/quote bindings without reissuing their
runtime evidence or payment roles.

Language, factual correctness and semantic completeness remain `UNJUDGED`.
A structural pass cannot make `deliverableAccepted` true. Keep malformed, missing,
duplicate or stale inputs closed, preserve the two observed failures, and label
fixture validation exit 0 separately from contract acceptance. The CLI never calls
the agent, providers, databases or payment machinery, and changes no saved answer,
receipt or supported research surface. This evaluation maintenance outcome does
not bump or deploy a runtime version.

The [initial rubric and corpus](docs/engineering/retained-deliverable-contracts-2026-10-09.md)
cover single-page structure only. Public scorecard, full failure-class coverage,
consented private cases, reviewed semantic/language criteria, agreed regression
margins and bounded exact-release live acceptance remain issue #287 gates.

## Keep unsupported output requests above inferred scaffold language — 2026-10-09

The Spanish NASA retest exposed shared Spanish/Portuguese vocabulary in ordinary
presentation inference. Require distinctive Portuguese cues; a positive explicit
output request supersedes inferred cues and accumulated context. Unsupported
directives select the existing English labels while leaving statement-language
guidance unset, rather than imposing a different generation language. Preserve
last-positive precedence and negation, with a bounded parser rather than a general
language detector. Reviewed statement and excerpt bytes are never translated by
finalization, and private originals retain their existing presentation path.

The [surface and release record](docs/engineering/output-language-2026-10-09.md)
keeps broader issue276 catalogs, preferences and human-reviewed localization open.
This repairs wrong Portuguese selection without claiming full Spanish delivery.

## Prevent new literal UI copy while migrating catalogues — 2026-10-09

Issue272's first independent increment adds a lockfile-pinned TypeScript AST
guard for known presentation contexts in tracked web and desktop JSX. Explicit
legacy allowances bind file, syntax context, text and count; new or changed copy
fails main CI without loading the app or user data. A baseline is not proof of
catalogue migration, visual parity or human translation review. Area migrations
must retire old allowances and demonstrate unchanged rendered English. Keep
arbitrary data flow and non-JSX surfaces as explicit follow-up boundaries rather
than claiming universal extraction. See [authoring rules](docs/ui-copy-authoring.md).

## Preserve exact short-item identity for ordinary presentation — 2026-10-09

Separate reviewed sentences from one complete visible enumerated item can satisfy
different research targets without requiring a new semantic relationship. Retain
that structural identity as process-local metadata from the already offered whole
item quote option, through its exact resolved span and existing statement admission.
Do not serialize or restore it from receipts, raise support, widen retrieval or
change payment authority. Require observed complete public HTML, exact source and
item binding, and unchanged qualifying ledger identities at consumption.

Preserve existing presentation groups first. A new item edge joins only groups
whose every sentence belongs to that item; target transitivity cannot pull another
block into the new edge. Retain every exact sentence/excerpt pair and all final
coverage, count and row limits. Defaults and private originals remain unchanged.
The [candidate and retained-fixture record](docs/engineering/short-item-presentation-2026-10-09.md)
distinguishes synthetic layout/review inputs from public displayed pairs and keeps
issue238's live usefulness, localization and coordinated-delivery gates open.

## Prepare locale contracts without activating unreviewed language delivery — 2026-10-09

Keep English as the sole shipped interface while preparing typed English keys,
bounded explicit/stored/header preference admission, exact locale display and
public language metadata contracts. Default allowlists refuse prepared Vietnamese
and Simplified Chinese; glossary drafts are not translation release authority.
Selected catalogue data may cross a server/client boundary without importing all
locales. Runtime preference storage and a switcher remain separate integration gates.

Preserve existing public report/profile paths without mandatory locale-prefix
redirects. Advertise only actual published page variants, with an English
`x-default` and a canonical among them. Reports need recorded output language and
explicit public visibility; never infer either from a viewer or question. Current
stored runs lack these fields, so metadata adapters remain unconnected. Unknown
historical language is undetermined rather than retroactively labelled English.

Locale USDC display adapts the existing exact bounded integer contract, keeps all
micro digits and cannot influence signing/storage/comparison. Signing verification
remains ungrouped invariant decimal text with an explicit currency. Dates require
an explicit viewer zone and observed relative clock. The [source/gate record](docs/engineering/locale-foundation-2026-10-09.md)
keeps full issue acceptance, privacy authority, human translation review and the
operational main freeze open.
