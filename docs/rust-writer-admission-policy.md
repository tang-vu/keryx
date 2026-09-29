# Native task writer admission and cutover proposal

**D-259 update:** the [native task creation release](./native-task-creation.md)
implements the proposal below as one CLI and Electron integration, gated on actual
platform, package and caller acceptance. That release defines the current creation
boundary and rollback window. The D-257 observations below remain historical
evidence; existing v1 readers and payment authority do not migrate with the writer.

**September 29, 2026: candidate hardening and proposed release gates.** D-257
narrows Windows publication admission before the first filesystem mutation. It
does not switch Operator CLI or desktop callers. `createOperatorTask` in
`lib/operator/task.ts` remains the production writer; existing TypeScript readers,
buyer journals, signing and GET-only recovery retain their authority.

## Candidate target and Windows token policy

The evaluated target is one new safe child under an explicitly selected, existing
private parent. The parent must be absolute, pass componentwise no-follow checks
and retain its verified directory identity. The child uses the existing one-to-64
ASCII letter/digit/hyphen/underscore policy, including reserved-device refusal.
Do not create missing ancestors, follow a linked parent, repair an existing target,
or change a user's parent permissions to make admission pass. A selected desktop
workspace or a resolved CLI path alone does not prove this contract.

On Windows the existing held-handle policy requires a current-user owner and a
protected parent DACL containing one current-user full-access ACE, inheritable by
both files and directories. Other ACL shapes remain unsupported by this candidate;
their refusal is not a claim that every other shape is insecure.
Microsoft's [file security](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
and [ACE inheritance rules](https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules)
describe inheritance; the publisher still checks each created object's security.

Before exclusive mkdir, the publisher also requires no thread impersonation token
and a process default owner equal to the process token's user. `OpenThreadToken`
must establish absence; any other query failure refuses admission. The publisher
only queries token state. It does not adjust the default owner, enable privileges,
revert impersonation, elevate, or change an ACL. Elevation alone is not the decision:
an elevated process whose default owner differs from its user is unsupported, while
a matching owner still needs every other check.

Microsoft documents that a new object's owner comes from the creating primary or
impersonation token's default owner, and distinguishes `TokenUser` from
`TokenOwner`. This is why checking the parent's owner alone is insufficient.
See [object ownership](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object),
[thread token lookup](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openthreadtoken)
and [token information classes](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class).

Admission is rechecked when publishing through an already opened private parent.
The actual created directory and both files still require held-handle owner, ACL
and identity checks. A token/ACL change after admission can still cause a retained
partial outcome. This is no atomic reservation, same-user sandbox, or guarantee
that a later operation will succeed.

## Evidence required for this increment

- Exercise an unadjusted process token separately from fixture processes whose
  default owner is deliberately set to the user. Report the observed owner match
  as a boolean; keep user SIDs and private paths out of acceptance summaries.
- On Windows, exercise actual thread impersonation in a disposable process and
  require `refused_unchanged` before mkdir, no success output, no new child and an
  unchanged source tree. Hosted Windows acceptance also requires an actual
  process-owner mismatch refusal. Observe the unadjusted token rather than infer
  its shape from elevation. If that host supplies no mismatch and no disposable
  valid alternate-owner fixture can exercise it, leave this gate open.
- Retain exact-byte successful publication, strict parent/child ACL refusals,
  collision preservation, retained incomplete results and fresh TypeScript
  reopening. Run the original publication and caller-admission corpora.
- Keep local Windows GNU observations separate from hosted Windows MSVC and
  Linux results. A feature-only fixture must never become a packaged CLI flag or
  a production token adjustment.

### Local Windows GNU evidence

The local Windows GNU release rehearsal admitted the unadjusted process and
reported `ordinaryTokenOwnerMatchesUser: true`. The explicitly adjusted fixture
process then activated real same-user thread impersonation after opening the
private parent. Both an absent target and an existing target refused at `token`
with empty success output and unchanged tree digests; the absent child remained
absent. These are three token checks, not a local owner-mismatch observation.

The publication corpus passed three successes, 32 refusals, one concurrency drill,
21 reopenings, two link cases, 18 permission observations, three crash checkpoints
and three typed fault checks. The actual caller corpus retained three exact-byte
comparisons, three injected pre-mkdir checkpoints, five candidate-only refusals,
eight caller refusals and two guarded legacy reopenings. The local Windows
owner-mismatch branch remains unexercised. Hosted Windows MSVC must explicitly
observe it before this increment is accepted; Linux must retain its existing corpus.

## Proposed production admission

These choices define the next reviewable caller migration; they are not enabled
by D-257 and do not weaken the preceding acceptance gates.

| Boundary | Proposed choice | Evidence still needed before routing callers |
| --- | --- | --- |
| Target | Existing audited private parent plus one generated or explicitly selected safe child; refuse unsupported paths without automatic ACL repair. | Actual CLI and desktop publication through this contract, including actionable refusal presentation and preserving selected workspace identity. |
| New-task money | Adopt the existing Rust preparation rule: finite positive raw creator budget at most 0.5 testnet USDC, JavaScript-compatible rounded micros at least one, and integer total cap strictly above it and at most 1,000,000 micros. Never normalize saved request bytes to achieve acceptance. | Actual caller boundary cases and explicit user-facing errors for stricter admission, including tiny positive budgets that round to zero. |
| Legacy data | Keep existing v1 TypeScript reading and buyer recovery policy independent of new-task admission. | Fresh offline reopening and bound GET-only recovery with the new writer disabled, including legacy tiny-positive tasks; preserve and explicitly refuse unreadable incomplete directories. |
| Windows completion | Preserve `windows_visible_entry_unproven` as a distinct observation; visible flushed files do not establish directory-entry power-loss durability. | Caller presentation and an explicit release decision about this residual risk; no stronger persistence claim based on process-kill tests. |
| Payee and spending | Caller supplies an independently checked payee; local creation authorizes no purchase. Existing buyer policy governs quotes, signatures, caps and recovery. | A caller trace showing the migration adds no signer, journal, network or payment capability. |

Linux's existing `unix_synced` completion also assumes a trusted filesystem and
storage stack; a finite crash corpus is not universal power-loss proof. Artifact
distribution, clean-machine use and any Tauri package remain separate gates.

## One writer and rollback

A cutover release must name one authority for immutable task creation across its
supported CLI and desktop callers. The proposed authority is the shared Rust
preparation/publication path. TypeScript remains the only authority until a
separate reviewed release explicitly changes this. Do not silently retry creation
through TypeScript after a native refusal or uncertain result, or select writers
according to which parser accepts the input.

For the future cutover, the proposed minimum rollback window retains the previous
TypeScript release and v1 readers for at least two accepted release cycles and
14 calendar days of recorded use
after the first cutover. Time alone closes no gate. Record actual supported-host
use, refusal and incomplete outcomes, offline reopening, and a release rollback
drill. Stop new native creation when rolling back; preserve original directories
and use the pinned prior release for inspection. Existing names are never reused
automatically, partial tasks are never repaired automatically, and rollback never
buys again or rewrites a request, journal, receipt or result.

D-257 itself needs no production rollback: disable the evaluator and continue
using the unchanged TypeScript callers.

Retire duplicate TypeScript *creation* rules only after that window, no unresolved
creation correctness issues, reviewed platform/caller evidence and a successful
rollback drill. Keep any TypeScript legacy-reader or buyer rules whose domains
have not migrated; they are not duplicate creation authority. Any required format
change needs its own versioned migration and restore evidence. No autonomous
scheduler or completed production migration follows from this proposal.
