# Native selected-store policy and temporary contention

The selected native public Usage constructor needs positive proof of a source-known
mainnet application profile and the runtime guard captured at verified opening.
A genuine identity alone, or caller-supplied properties, is insufficient. The
metadata-only `assertVerifiedSqliteSelectedApplicationPolicy(db)` accepts the fixed
BEFORE and complete user bundle families, checks closed/FK/timeout policy, and
does no SQL. Callers must still run the existing full connection guard for each
operation. That guard pins the exact captured source profile, so additional
caller-approved shapes cannot preserve this proof after schema drift. This adds
no accepted schema family, cap, provisioning or journal change.

Native privacy already preserves the healthy connection on actual SQLite BUSY or
LOCKED (5/6), but converting those errors into the fixed public PrivacyError loses
that distinction for a composing native reader. `isEnrolledSqlitePrivacyContention`
recognizes only refusals branded inside the native privacy boundary. A caller's
PrivacyError, SQL-looking properties or cause cannot create that brand. Raw SQL,
native errors and their details remain private; all other guard failures keep
permanent refusal. Readonly denial and existing ordinary bodies are unchanged.

Validation uses genuine isolated SQLite, including an actual EXCLUSIVE lock and
subsequent healthy read, all four profile families, missing captured policy,
extra arguments, caller forgery and irreversible non-contention revocation.
It adds no production operation, payment, funding, schedule or provider call.
Public Usage remains gated until its own corrected constructor and applicable
native/CI checks accept these helpers. The existing coordinator owns merge and
the single batched deployment.
