# Supported-surface release parity

User-confirmed policy, October 1, 2026: every update audits every applicable surface and ships its shared contracts, adapters, tests, documentation and distribution together. No applicable surface may be skipped. Intentional role boundaries remain explicit; identical UI and payment authority are not required across distinct roles.

## Audit baseline

Audited research baseline `59757f8`; release branch rebased on `0417cee` (chat globe #110). Source baseline `59757f8` (root version 0.24.5), October 1. Recent merged changes include bounded public web research (#101), retained source context and captured browser signing authority (#100/#104), owner-signed citation policies (#102), observer-only retained-transfer checks (#103), chat-first reading (#105), researcher exports (#106), staged enrolled SQLite runtime (#107), and DOI/scholarly discovery (#109). Earlier Windows Tauri/Rust task creation, registry-owned creator listings, Gateway funding readiness and SDK testnet pin remain applicable dependencies. This is a source audit, not a claim that all product/mainnet gates passed.

| Capability | Applicable surfaces and implementation | Intentional boundaries / release evidence still needed |
| --- | --- | --- |
| Research decisions, answer, source identity and bounded claim evidence | Web SSE/history, shared `collectRun`, remote MCP, OpenAI extension, paid A2A; caller CLI and stdio MCP consume A2A results | Public answer evidence may have no creator reward. The isolated `/api/agent/private-ask` path withholds external question search. Local Operator storage is private, but its deliberate buyer handoff calls the public `/api/agent/ask` endpoint. Bots and extension label cited sources, planned rewards and real/offline/legacy mode; they link to the full dispatch rather than duplicating its export UI. Extension 0.1.1 is packed as an exact-source release ZIP for deliberate unpacked installation; Chrome Web Store submission remains separate and unverified. |
| Public web and DOI discovery | Public web, remote MCP and OpenAI reuse shared bounded public effects. Exact question DOI lookup is automatic; `scholarly: true` opts into Crossref/arXiv discovery. Remote MCP/OpenAI accept `mode: quick|deep`. | Default scholarly search stays off. Public paid A2A/buyer/stdio/Operator purchases reuse automatic bounded web and exact-question DOI discovery when configured; their current versioned contract has no general scholarly opt-in field. Adding that field requires durable request/order binding, privacy disclosure and package-version acceptance, so it remains staged. The separate isolated private endpoint withholds external question search. Local private files do not make a public purchase private. Scheduled engine search requires its existing explicit opt-in. |
| BibTeX, RIS and evidence CSV | Web downloads; A2A, OpenAI and remote MCP structured `researchExports`; stdio MCP forwards structured payload. CLI Operator `brief --format` and desktop native exports rebuild from integrity/task-bound saved receipts. | No enrichment, purchase or account upload during export. Missing historic article metadata is omitted. Local exports are private and use the complete-file publisher with overwrite refusal. |
| Payment authority and classified evidence | Existing buyer/server/browser shared paths; receipt settlement is authoritative recorded evidence, not allocation metadata | `creatorsPaid` is now null when distinct settled creators are unavailable; `creatorsReferenced` and `creatorRewardAllocations` are explicitly separate counts. Allocated rewards are planned, public references earn none. No new signer or mainnet rail. |
| Browser original signing, transfer observer and funding readiness | Browser wallet checkout + server retention/reconciliation paths; relevant shared payment code reused by API flows | Desktop does not sign/fund/buy; it hands off deliberate caller-funded purchases. Observer tooling cannot authorize payments. No invented desktop wallet requirement. |
| Creator registry listings and registration confirmation | Creator web + existing registry/API authority | Reader MCP/desktop do not acquire creator administration authority. Registration receipt/index evidence does not replace ownership proof. |
| Chat-first UI, globe and Mint design | Web conversation; desktop uses Mint styling with local task interactions | Web conversation UI is not a desktop scheduler; extension embeds and bot text retain their existing thin roles. |
| Rust task creation and local result recovery | Operator CLI and packaged Tauri desktop share pinned writer and TypeScript inspection/GET-only recovery | Web/MCP do not host local workspace creation or an independent Rust payment engine. Raw native/TypeScript inspection and default brief remain exactly compatible. Explicit TypeScript-owned application enrichment supplies direct reference/evidence formats; native direct-format migration is not claimed. Domain cutover gates remain open. |
| Enrolled storage runtime | Staged isolated factory and enrolled signing record support | Proposed Supabase enrollment is not treated as deployed while its PR/gates remain open. Storage staging is not a new end-user feature on every surface. |

## Release checklist

October 2 direction supersedes the earlier invited-browser proposal: migrate normal
public mainnet Keryx on the existing domain across all applicable surfaces. The
[current full-mainnet operational matrix](mainnet-operations.md) records each role,
selected profile, fresh-state boundary and release evidence. Dormant pilot helpers
and superseded proposals remain historical evidence; their invite lists and tiny
caps are not the ordinary product policy. Source implementation does not establish
mainnet funding/settlement or synchronized hosted/package/installer delivery.

1. Compare current main/history with all supported adapters and documented capabilities. For each changed contract identify producer, consumers, legacy behavior, private/public scope and payment authority.
2. Update every applicable surface together; record intentional exclusions and remaining work rather than silently omitting them. Exercise actual transport/CLI/IPC behavior, not just a helper mirror.
3. Pass focused regression tests, type checking, relevant production build, independent review and required CI. Desktop changes require exact-source packaged Windows and fresh standard-user installer acceptance. Caller MCP changes require clean-install packed-package startup, synthetic signing, original-response-loss fencing and new-process GET-only recovery acceptance.
4. Record root source commit/version, production `/api/health` commit, desktop installer/manifest version and exact release asset checksums, remote MCP protocol version, and caller MCP published npm version or verified release tarball. A green desktop CI build without downloadable current assets is not distribution completion; a repo package bump without npm publication is not an npm release.
5. Merge/deploy/release under `AGENTS.md`, verify each applicable artifact and update the evidence record. Never advertise a not-yet-published registry package. Preserve mainnet M1-M8 and final owner approval independently.

Observed before this update: production health matched `59757f8`; latest GitHub application release was v0.24.5 without desktop assets, while desktop 0.3.0 assets were attached to v0.24.0. npm `keryx-mcp` was 0.1.1. These are pre-release observations, not acceptance of the new update. Final distribution evidence must be recorded after release; missing npm credentials must remain explicit.

Candidate versions: application 0.24.7, desktop 0.3.1, caller MCP release tarball 0.3.0 (server identity derives from package), extension ZIP 0.1.1. Remote MCP retains its separate protocol identity 0.2.0. npm latest was independently observed as 0.3.2 on October 2 at 13:56 UTC; 0.4.1 publication/integrity and Chrome Web Store submission remain unverified. These are release candidates until exact artifact/deployment checks complete.


### Fresh isolated-storage alignment, 2026-10-02

The accepted product `080bc5d` retains immutable GitHub `v0.25.0`, desktop `0.3.1` and
MCP source fallback `0.3.1` artifacts. Runtime changes merged afterward require fresh
application `0.25.1`, desktop `0.3.2` and caller MCP `0.3.2` candidates. Extension `0.1.1` and remote
MCP protocol `0.2.0` keep their separate identities and documented web/service roles.
Registry publication, exact-source installer acceptance, deployment health and
artifact hashes remain gates; repository version metadata is not delivery evidence.

Current coordinated source candidate versions: application 0.26.2, desktop 0.4.2, caller MCP 0.4.2 (server identity derives from package), extension ZIP 0.1.1. Remote MCP retains its separate protocol identity 0.2.0. October 3 registry discovery confirmed npm latest 0.4.1 and no 0.4.2; GitHub v0.26.1 contains immutable MCP/desktop 0.4.1 assets from `f9dca8d`. New versions remain candidates until exact artifact/publication acceptance. Chrome Web Store submission remains unverified.


### Coordinated research/creator repair candidate, 2026-10-03

Application 0.26.1 contains the shared factual-answer finalizer, bounded free expansion,
malformed-request validation and trusted synthetic-evidence projection. These additive
source/evidence/receipt/export fields flow through web SSE/history and API, public A2A,
remote MCP/OpenAI, caller CLI/stdio structured results, and receipt-based Operator exports.
Archived answer bytes and recorded money remain intact; synthetic content cannot count as
factual coverage. The private/unattended discovery boundaries and payment contracts remain.

Desktop 0.4.1 packages `lib/operator/result.ts` through its TypeScript helper and shared
`research/receipt-exports`/surface result code, so saved receipt exports need rebuilt and
accepted installers. After original receipt digest verification, derived exports accept a
trusted provenance marker or the checked manifest's exact title/URL/body-hash fingerprint.
Missing strong fingerprints require a refreshed hosted receipt; original bytes/digests
remain unchanged. Caller MCP 0.4.1 is a fresh coordinated package candidate with updated
contract-facing guidance; it forwards hosted structured results under its existing caller
custody and recovery role. It does not become a publisher, independently reauthenticate
historical facts or gain a new signer. Existing exact-source 0.3.2 artifacts remain immutable.
Extension 0.1.1 and remote MCP protocol 0.2.0 retain their separate identities; thin bot and
extension clients hand off full hosted dispatch/registration views rather than duplicating
owner proof or exporting new private publisher authority.

Prepared feed/Wanted sign-in and returning feed verification are web/browser SIWE roles.
My sources and Manage inspect the persisted payout; other split recipients cannot verify.
Reader desktop/CLI/MCP/bots gain no creator transaction or feed-proof authority. The
extension's existing hosted registration link retains its supported manual draft fields.

The candidate schema 0079 preserves encrypted rows and payment evidence, with exact-match
seed provenance backfill and an isolated PostgreSQL 17 CI gate. Selected mainnet requires
sealed enrolled SQLite admission; existing stores need explicit paused migration and fresh
matching enrollment. Existing enrolled Supabase schema-77 profiles remain pinned; fresh
catalog/schema/read-profile acceptance must precede staged Supabase activation. See
[backend acceptance](enrolled-runtime-backends.md). Deployment must verify the real store migration and retained receipt
projection, then `/api/health` against the pushed commit. Full integrated CI/default build,
independent review, complete useful research outputs, exact-source packed MCP recovery and
npm integrity/provenance, installer export/standard-user checks and asset hashes are required
before synchronized-delivery claims. Candidate version metadata satisfies none of those
observations by itself.

### Claim-grounding follow-up audit, 2026-10-03

Application 0.26.2 and MCP/desktop 0.4.2 are prepared source candidates for the
shared claim-grounding repair. Every new evidence-bearing answer projects qualified
literal source excerpts and explicitly labelled quoted research targets/gaps; arbitrary
synthesis is withheld because marker-level support cannot prove every assertion.
High target coverage does not establish per-assertion entailment or complete useful
synthesis; the Low/incomplete boundary remains explicit. Accepted excerpt citations
remain reward-eligible. Paid-fetch debits, source/version bindings and original
settlement/receipt identities are retained. No schema or API transport change is added.

| Surface | Audited answer/evidence path | Retained role boundary |
| --- | --- | --- |
| Web and embed | `app/api/ask/route.ts`, `lib/hooks/use-ask-stream.ts`, `app/embed/embed-client.tsx` consume shared agent SSE and retained answer; `components/keryx/answer-card.tsx`, `components/keryx/citation-evidence-panel.tsx`, `components/keryx/evidence-matrix-export.tsx` label research targets/coverage estimates | Browser co-sign and displayed payment state retain existing authority. |
| API/A2A | `app/api/agent/ask/route.ts` calls `collectRun`; `lib/research/surface-result.ts` exposes bounded structured evidence/exports | Existing order, receipt and settlement bindings; no new transport contract. |
| Remote MCP | `app/mcp/route.ts`, `lib/mcp/remote-server.ts` forward the shared answer and `surfaceResearch`; footer distinguishes target excerpt-support from entailment/complete synthesis | Protocol identity 0.2.0 remains; no new caller custody. |
| OpenAI and extension | `app/api/v1/chat/completions/route.ts`, `lib/openai-compat.ts`; `extension/popup.js` forwards content deltas | Extension 0.1.1 remains a thin hosted client; exact-source ZIP role, no Chrome Store claim. |
| Caller CLI/stdio MCP | `scripts/buyer-agent.mts`, `lib/buyer/client.ts`, `mcp/keryx-buyer.mts`, `mcp/keryx-mcp-server.mts` consume the retained hosted answer/results | MCP 0.4.2 candidate needs exact packed acceptance/publication; caller custody/recovery stays unchanged. Retired `scripts/a2a-client.mts` remains deliberately inert. |
| Local Operator and desktop | `scripts/operator.mts`, `lib/operator/result.ts`, `desktop/src/helper.ts`, `desktop/src/workspace.ts`, `desktop/src/renderer.tsx` reuse checked saved answers/receipt exports | Existing historical bytes are not independently repaired or recertified offline. Desktop 0.4.2 requires rebuilt exact-source installer, export and standard-user acceptance; no signer/scheduler. |
| Discord, Telegram, Slack | `app/api/discord/interactions/route.ts` + `lib/discord/ask-interaction.ts`; `app/api/telegram/webhook/route.ts` + `lib/telegram/ask-message.ts`; `app/api/slack/commands/route.ts` + `lib/slack/ask-command.ts` call `collectRun` and truncate/escape its answer | Thin messages link the full dispatch and retain planned/settled/offline labels; no independent synthesis or creator administration. |

The previously observed public HTTP 503 is an independent live maintenance gate
for the active mainnet transition. This release preparation neither changes that
maintenance state nor claims a new deployed SHA, current live research quality,
network activation or payment readiness. Required CI/review, fresh package/installer
acceptance, immutable publication readback and the independent deployment handoff
remain open. Metadata parity alone does not establish synchronized delivery.

Artifact acceptance/publication and hosted deployment are separate gates. Verified
0.4.2 MCP/desktop artifacts may be published while runtime maintenance remains held;
check immutable release manifests and npm integrity/provenance for artifact status.
Qualified-excerpt hosted behavior starts only after accepted hosted deployment, not
from a package installation or source version alone.

## October 4 mainnet onboarding repair

Application candidate **0.26.3** fixes browser Session lifecycle, creator funding
guidance and bulk registration confirmation. Direct production health before this
update reported Arc mainnet `55fc80c`. npm readback reported `keryx-mcp` **0.4.2**;
GitHub release `v0.26.2` supplies MCP/desktop **0.4.2** artifacts at `412fd4e`.
Those immutable distributions have distinct source provenance from the web release.

| Surface | Audit and release boundary |
| --- | --- |
| Web | Ship Session hook, worker/client error classification, recovery UI, creator bulk/faucet and funding copy together. Actual browser regression and emitted mainnet worker/CSP checks apply. |
| API / remote MCP | Session public routes, grants, settlement authorization, research orders and remote MCP contract are unchanged. Settlement health observations gain an optional recorded network for correct inspection guidance; old networkless observations remain unknown. |
| Buyer CLI / stdio MCP | They retain their own caller custody and selected-network policy, and do not use the browser Session or creator-registration UI. Correct the linked buyer guide for mainnet environment selection; MCP package 0.4.2 remains unchanged. |
| Operator / desktop | Private local workspace and explicit buyer handoff remain their roles. No browser custody or creator transaction UI is bundled; desktop 0.4.2 remains unchanged. No new installer is required for this browser-only fix. |
| Extension / OpenAI / bots | Hosted research adapters keep their existing request/result and payment contracts. Creator/session management stays in the hosted web UI; extension 0.1.1 and bot commands require no new distribution. |

Acceptance covers synthetic failures, owner changes, receipt identity and no
duplicate wallet requests, plus existing normal-handler payment/cashout journeys.
It does not claim new live spending, independent settlement verification or proof
that every product journey is complete. Deployment is verified separately by the
pushed commit at public `/api/health`; preserve existing runtime funding and schedules.

An esbuild dependency-graph check found no changed runtime inputs in the caller
MCP server (30 inputs), Operator desktop helper (41) or repository buyer CLI (30).
This supports retaining their existing package versions; it is not a claim that
their immutable artifacts were rebuilt from the new web commit.
