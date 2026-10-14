# Same-store enrolled profile identities — 2026-10-14

The candidate supplies `createEnrolledSqliteProfileIdentities(db)` for the selected
native database. The enrolled facade now calls that actual factory on its own
verified connection and attaches a truthy optional `profileIdentities` port before
freezing. The property is nonenumerable, nonwritable and nonconfigurable; the
factory freezes the port. Exact BEFORE leaves the property absent, while exact
full19 admits it. Partial, unknown or drifted stores still refuse. This source
wiring repairs the selected-store availability gap seen by VerifiedIdentityPanel
after a saved profile; changed-source execution and deployment remain unverified.
It preserves existing contracts, Core, ordinary SQL, other ports and all financial
wrappers. It installs no tables, opens no second database and makes no provider calls.

## Source and admission

The original identities source is checkpoint `e965ae01310ba9164e9adb8ad822a41bcdc44f6d`,
based on `5136a4a10a34230e1eceb6bac2f7a60b8252e9e5`. Its R91 review and R94
contention correction review remain applicable to unchanged behavior. The R94
factory pin is `ef33edec3fec9360baec9e5e9a1de2c2b12f37524b42fbc36487370dc3aa373e`.
The external guard successor is pinned at
`c95d7f085f9ecf70fd49ade15e68fd24621971688b5002ba797835a83af2b57c`.
This facade worker preserves its bytes. That successor, platform changes and the
new facade/graph delta require the parent's different focused review and actual
changed controls before publication; the older review does not accept changed code.

Core #477 is merged at `b54710b0585e5398070e8da87092a72ce856ceed`. Its four
fixed mainnet profiles represent archive absent/present × the complete user-domain
bundle absent/present. Tests use that actual family without replacing its generator.
`profile-identities-storage-domain.ts` remains the unchanged reviewed declaration.
The private-profile implementation belongs to the separate #260 outcome; a local
diagnostic copy is not identities implementation or dependency merge evidence.
The facade controls save profiles through the actual declared native #260 helper
on the same disposable file, then obtain identities solely from the genuine
selected facade. They do not fabricate a `privateProfiles` binding. The current
source still omits that separate binding; its reviewed composition belongs to the
parent. Core uses the existing `SqliteAdapter.assembleConnectionCore` API.

The existing finite graph permit adds only the actual executable edge
`profile-identities-enrolled-sqlite.ts` → `enrolled-sqlite-schema-profile.ts`.
All negative funding, enrollment and executor rules remain. The incoming
`private-profiles-enrolled-sqlite.ts` diagnostic helper also imports that closed
profile, but this worker grants it no permit. The parent must resolve that edge
through its own reviewed dependency composition; graph success is not claimed.

Construction checks genuine native provenance, positive sealed foreign-key policy,
exact profile/session/identity schemas and fences, and the supported whole profile.
An absent domain returns no port; partial or changed domains refuse without repair.
A present port also requires Core #477’s immutable full-bundle admission metadata.
Repeated operations use the trusted connection runtime guard and that metadata.
The guard continues to check the exact admitted whole schema, all writer fences,
storage identity, held file and manifest before every SQL operation. This avoids
repeatedly scanning the same full schema through an already guarded proxy. A
complete schema on a connection without trusted full-profile admission refuses.

## Identity and failure behavior

LIST is an owner-specific read transaction with bounded validated rows. Asserted
profile URLs and pending links never become verified identities. Writers refuse
readonly capability before parsing or SQL, then use `BEGIN IMMEDIATE` and SQLite
time. They recheck the saved owner profile, live durable session, exact
wallet/provider/session/state/deadline and current nonce inside the transaction.
Consume is single use. Replacement preserves old verification until completion.
Unique provider IDs cannot be owned by two profiles. Unlink/profile deletion
invalidate in-flight callbacks through the existing cascades.

Only native `ERR_SQLITE_ERROR` with numeric code 5 or 6 is recoverable contention,
and only after proving intact guards and no owned transaction. An acquired
transaction requires a successful guarded rollback. The external-ID conflict
requires native UNIQUE code 2067 and the exact constraint. Generic errors, guard
drift and failed rollback permanently revoke the port and close its connection.
No retry, authority fallback or busy-timeout change is introduced. Readonly writer
refusal preserves reads. Repair never revives a revoked port.

## Verification and remaining gates

The first genuine native fixture run retained **13 actual passing admission
cases** at `output/resume-distribution63-audit-20261012/first-core-native-checks-20261014/identity`.
The corrected dependency run separately reports **59 total, 11 passed, 35 failed
and 13 unselected**, natural exit 1, no signal and complete output, at
`output/resume-distribution63-audit-20261012/native-first-dependency-recovery-20261014/identityfailed`.
Its outer timeout flag is retained; it is failed evidence. Those separate 13+11
observations are historical input-specific results, not full19 facade acceptance.
The first-fixture/full19 context is retained at
`output/resume-distribution63-audit-20261012/full19-native-first-fixture-composition-20261014`.
A representative lifecycle refresh confirmed a 20-second
test timeout, with 54.93 seconds of execution. The scoped guard correction passed
that same case in 14.25 seconds under the unchanged deadline; this is one case,
not acceptance of the remaining changed cases. The later external actor's
changed49 attempt has no retained terminal evidence in the accepted handback and
cannot establish a pass. Its guard successor remains subject to parent review.
Windows file-replacement coverage asserts native `EBUSY` prevention
and continued guarded reads; Linux retains actual replacement and permanent
revocation assertions, matching the existing enrolled-adapter platform contract.

The 13 newly authored disposable selected-facade controls are **UNRUN**. They
cover both archive variants for optional BEFORE and the full19 hidden frozen port,
authenticated saved-owner LIST, begin/consume/complete and owner isolation,
healthy readonly pre-SQL mutation refusal with GET survival, partial/unknown
admission refusal, manifest/schema/closed-provenance revocation, platform-specific
held-file replacement, and original profile/domain/financial data retention.
They use actual fixed schema installers, native factories and Core session reads;
route sessions and all payment/provider values remain synthetic fixture input.
No provenance mock, injected runtime clock, timeout increase, build, study or test
execution accompanies this source-only worker. Existing assertions and deadlines
remain intact. Raw before/after, minimal patch, whole inverse and pins are in
`output/resume-root-release63-20261012/refill-successors-20261013-107/worker-completeNativeIdentityFacadeAndGraph`.

Publication requires the actual reviewed #260 dependency and selected binding,
parent review of this identity binding, actual selected-facade LIST evidence,
focused changed controls/TypeScript/graph, final-input reproduction of the
existing offline 48-trial study with zero outbound and exact source/lock binding,
and actual required aggregate/domain CI. No study has been run before final
composition. The parent owns current-main PR and required CI; the sole coordinator
owns serialized merges and the combined deployment. This partial repair does not
hold or delay the already-ready release65 batch.

Web/API and desktop’s hosted panel consume the selected port. CLI and remote/stdio
MCP reads retain explicit `profile:read`; OAuth consent and mutations remain
interactive SIWE. Extensions, bots and A2A gain no identity authority. No provider
activation, production migration, keys, spending, custody, schedules, version or
deployment change is part of this worker outcome. Issue #265 remains open for
real provider/SIWE/key acceptance, public-profile composition and deployed
owner-visible acceptance. OAuth/social verification, vendor human gates and
original #265 remain OPEN. Source controls do not satisfy those original gates.

## Narrow pre-transaction contention correction — R111

The separate c95 runtime review found one inherited P2: EXCLUSIVE contention in
the leading full guard made `check()` close the borrowed connection permanently.
Its immutable failure assessment remains at
`output/resume-release-library-review-20261012/native-profile-identities-hotguard-independent-source-review-20261014.json`
(SHA-256 `09d9190d6af6e618c9b4014be535543bc8a14375da4c5431dc0218543dc904cf`).
Historical failures and R107 facade/graph source acceptance remain unchanged.

The only runtime change is that `check()` now uses the existing private
`nativeContention` classifier: an actual Error with `code === "ERR_SQLITE_ERROR"`
and numeric `errcode` 5 or 6 refuses this request as `identity_unavailable` without
closing or revoking the connection. Each subsequent request still needs the full
guard. Every other failure permanently revokes. Constructor/metadata admission,
business SQL, fixed 5000 ms busy policy, readonly pre-SQL refusal and GET survival
are unchanged. Rollback, failed-BEGIN cleanup and uncertain-COMMIT handling retain
their strict latch, including permanent revocation if cleanup cannot pass its full
guard while a lock persists.

Two new disposable full19 controls for LIST/write-first BEGIN are **UNRUN**. A
separate raw fixture actor confirms the same storage identity and holds real
`BEGIN EXCLUSIVE`. Observation-only spies assert actual native numeric-5 refusal,
guard-only BEGIN/ROLLBACK, no logical writes and no close. After unlock the same
port/provenance must read the original synthetic identity, owner-isolated profiles
and unrelated core record. Whole-schema/all-row snapshots and file/manifest bytes
remain asserted. Existing negative classes, all R107 cases and deadlines are
untouched. Actual platform lock reproduction remains pending, without property mocks.

Raw before/after, minimal patch, whole inverse and pins are retained at
`output/resume-root-release63-20261012/refill-successors-20261013-111/worker-repairNativeIdentityPretransactionContention`.
Parent owns tiny changed-source peer review, affected EXCLUSIVE controls, unchanged
negative classes if needed, types/graph and current-main required CI. Reuse unchanged
evidence; no repeated old49/full-family/study run merely for this fixture. A runtime
input change needs final canonical acceptance once after source freeze. Original
#265/provider/production gates stay OPEN; credentials do not establish native acceptance.


## Measured first EXCLUSIVE fixture successor

The first two R111 controls timed out at the unchanged 20-second bound; neither is accepted. One changed LIST-only phase observation also retained a timeout (37.221-second case, 45.154-second outer capture, natural exit1/null/exit-close/both EOF). Measured phases: saved fixture 10.195s; original verification 2.012s; pending lineage 0.804s; native refusal 7.473s; first exact-byte assertion 4.511s; healthy identity readers 0.694s; two profile readers 6.788s; second exact-byte assertion 4.708s. These are observed intervals, not a production latency claim.

This successor replaces only the two generic recursive Buffer equality assertions in those new callbacks with Buffer.equals(...).toBe(true), preserving exact length and every byte. The temporary fixed phase labels are removed only after retaining their full source/capture/inverse. The copied private-profile dependency is now byte-exact independently reviewed hot-guard source5eb5 from merged PR480, rather than the older accepted dependency. Identity runtime49e488, genuine5000 contention, all20s limits, snapshots, spy/result checks, SQL, owner records and same healthy-after-unlock assertions remain. No guard/timer relaxation or runtime authority change is made here. New two-case/types acceptance is UNRUN; the old failures, separate facade thirteen authored cases and original issue gates remain open.
