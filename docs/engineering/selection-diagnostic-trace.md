# Source-selection diagnostics in the decision log

App0.27.37 is a follow-up source candidate on the reviewed app0.27.36 reading
branch. Required exact-head CI, current-main reconciliation, operational admission
and deployed-commit readback remain release gates. Source checkpoints are not
claims of separate production deployments.

Issue236 records a real browser refusal whose decision row showed an unnamed SKIP
and EV NaN. The server correctly emitted a bounded source-selection diagnostic;
the browser cast every decide detail to a source Decision, losing its message.

The shared browser display guard now accepts only complete Decision records with
known actions, finite values and typed targets. Streamed and canonical final
decision arrays use the same guard. A diagnostic grants no source action, read,
signature or payment. Canonical empty rationales and validator SKIP records with
empty targets remain compatible.

The trace shows refused or partial selection with its original explanation,
bounded candidate/target/proposal counts and reason codes. Only the existing
allowlisted diagnostic parser supplies these fields. Failure downloads retain
their existing projection and never become completed reports or payment receipts.
Unknown details retain their step message.

Acceptance uses the real hook, ResearchTurn and trace renderer with built CSS at
320 and1366px: refused, invalid diagnostic, partial-withholding and valid BUY,
CACHE and SKIP records, exact diagnostic download and no extra request. A separate
real-hook test covers final done-record filtering. Guard tests pin malformed
values, accessor refusal and historical empty-rationale/validator-SKIP behavior.
The original missing-message reproduction remains retained.

This is web trace presentation and browser state projection. Web pages opened
from desktop receive it; native desktop, CLI, remote/stdio MCP, API, extensions
and bots retain their existing trace and diagnostic wire contracts. Their backend
refusal and funding gates remain unchanged. No client package bump, model retry,
target-validator relaxation, paid canary, custody change or schedule is introduced.
Final-source browser/type/build checks and source review are required. Public
version and installer/package readbacks still govern any synchronized-delivery
claim. This fixes explanation, not the failed research outcome or independent
usefulness/traction acceptance.
