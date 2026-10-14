# Account-consented owned history

This change connects the existing private account consent to interactive owned
history reads. It does not create a login method or wallet authority. An exact
authenticated durable web session must have explicitly consented to history
sharing; linking a wallet alone does not opt another session in.

The request constructs its own history view. It never changes the selected DB,
stores a global membership projection, or extends API-key scopes. Bearer tools
(API, CLI, remote/stdio MCP and integrations) continue to read only their wallet's
history under their existing `history:read` grant and final credential check.
Interactive web and desktop requests using the same session routes can read
currently linked owners through the existing private ownership/privacy ports.
List, report, receipts, references and JSON/CSV export share that boundary.

The native account journal offers an optional prepare/seal capability. A missing
capability cannot grant account reads: a consented account on an unsupported
backend refuses rather than pretending parity. A session without account consent
retains ordinary wallet behavior. No new schema, DDL, flag or financial write is
introduced. Existing receipt amounts retain their recorded settlement semantics;
account membership does not establish who funded a run.

The wrapper retains the first positive full original and privacy state from the
genuine owner port. Later changed positives cannot replace it. Before release,
the native read transaction compares the observed payload semantically against
the actual raw original, then captures typed row presence/nulls, full original
hash, privacy sidecar, matching claimed-owner metadata and A2A association. JSON
key order is irrelevant; raw JSONB/coercion cannot substitute storage types.

After building the complete response, the route prepares the witness, repeats
the owner/privacy checks and awaits the exact final session check. Its last
authority operation is a one-use synchronous native seal: a short guarded read
transaction rechecks account/session/revision/generations and every captured
input. There is no await between that seal and returning the response. This is
a point-in-time authorization boundary, not a promise to lock storage until the
client receives bytes or a historical snapshot of all pagination pages.

Work is bounded to 1,000 observed IDs, 4 MB per physical original, 16 MB aggregate
original bytes, and the existing 25-second read deadline. Overflow refuses; it
does not return an empty success. Existing list/export output/page limits remain.
No claim of unlimited archive export or live Supabase parity is made.

The first focused validation passed 29 genuine native cases, four unchanged
request-boundary negatives and the corrected ordinary SQLite regression. The
ordinary fixture initially lacked its explicit privacy domain and returned 503;
after provisioning that domain in disposable setup, the same real-session
list/detail assertions passed. No runtime privacy fallback was added. The named
application graph case first exceeded the unchanged Windows 20-second deadline;
one unchanged verbose observation passed. Focused types passed. Every accepted
run ended naturally with exit 0, no signal and both output streams complete.

Tests use disposable enrolled SQLite, source-known
full19 shape and fences, genuine frozen facades, real JWT/durable sessions and
public test-key EOA membership proofs. Synthetic payment rows do not prove
settlement. Distinct runtime source review accepted the required optional-port
absence correction. Current-main composition, canonical evidence and exact-head
required CI remain pending; production delivery belongs to the batch
coordinator. Original #267/#268 acceptance remains open beyond this integration.
The existing Google/Circle embedded user-controlled wallet flow may satisfy the
no-prior-wallet criterion after real user acceptance; config availability alone
does not prove that acceptance.
